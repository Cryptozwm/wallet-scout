from __future__ import annotations

import secrets
import threading
import time
from typing import Any, Callable

import wallet_library as wl

PATHS = {"/api/library-bulk/refresh", "/api/library-bulk/preview", "/api/library-bulk/apply", "/api/library-bulk/status", "/api/library-bulk/stop"}
BATCH = 100
FRESH_SECONDS = 3600
RETRY_WAIT = 30.0
MAX_RETRIES = 5
PREVIEW_TTL = 1800
SHOW_ROWS = 300

_lock = threading.Lock()
_stop = threading.Event()
_job: dict[str, Any] = {"running": False, "kind": ""}
_preview: dict[str, Any] | None = None


def _gmgn_profits(slug: str, addresses: list[str]) -> list[dict[str, Any]]:
    import smart_money

    t = smart_money.tracker()
    if t is None:
        raise RuntimeError("聪明钱收集没开（GMGN 限流器不在），先不查")
    data = t.gmgn.call("/v1/user/wallet_profits", {}, 3, "POST", {"chain": slug, "period": "all", "wallet_addresses": addresses}, stop=t.stop)
    return wl._gmgn_list(data)


FETCH: Callable[[str, list[str]], list[dict[str, Any]]] = _gmgn_profits


def _refresh(keys: list[tuple[str, str]], skip_after: int | None) -> set[tuple[str, str]]:
    keys = list(dict.fromkeys(keys))
    with wl.LOCK:
        conn = wl.connect()
        try:
            at = {(r["chain"], r["address"]): r["gm_at"] for r in conn.execute("SELECT chain, address, gm_at FROM wallets")}
        finally:
            conn.close()
    keys = [k for k in keys if k in at]
    fresh = [k for k in keys if skip_after is not None and (at[k] or 0) >= skip_after]
    unsupported = [k for k in keys if k[0] not in wl.GMGN_SLUG]
    fresh_set = set(fresh)
    todo = [k for k in keys if k not in fresh_set and k[0] in wl.GMGN_SLUG]
    batches: list[tuple[str, list[str]]] = []
    for chain in dict.fromkeys(c for c, _ in todo):
        addrs = [a for c, a in todo if c == chain]
        batches += [(chain, addrs[i:i + BATCH]) for i in range(0, len(addrs), BATCH)]
    _job.update(total=len(todo), done=0, updated=0, noData=0, failed=0, skipped=len(fresh), unsupported=len(unsupported),
                batches=len(batches), batchDone=0, refreshStartedAt=time.time(), note="")
    failed: set[tuple[str, str]] = set()
    processed: set[tuple[str, str]] = set()
    for chain, batch in batches:
        if _stop.is_set():
            _job["stopped"] = True
            break
        rows = None
        for attempt in range(MAX_RETRIES + 1):
            try:
                rows = FETCH(wl.GMGN_SLUG[chain], batch)
                _job["note"] = ""
                break
            except Exception as exc:
                msg = str(exc)[:200]
                if wl._rate_limited(exc) and attempt < MAX_RETRIES and not _stop.is_set():
                    _job["note"] = f"GMGN 限流，{int(RETRY_WAIT)} 秒后同一批再试"
                    _stop.wait(RETRY_WAIT)
                    continue
                _job["lastError"] = msg
                break
        if rows is None:
            failed |= {(chain, a) for a in batch}
            _job["failed"] += len(batch)
        else:
            res = wl.save_gm(chain, batch, rows)
            _job["updated"] += res["updated"]
            _job["noData"] += res["noData"]
        processed |= {(chain, a) for a in batch}
        _job["done"] += len(batch)
        _job["batchDone"] += 1
    if _stop.is_set() and len(processed) < len(todo):
        _job["stopped"] = True
        failed |= set(todo) - processed
    return failed


def _start(kind: str, work: Callable[[], None], runner: Callable[[Callable[[], None]], None] | None, **extra: Any) -> None:
    with _lock:
        if _job.get("running"):
            raise RuntimeError("上一个「更新盈亏」或「清理预览」还在跑，等它跑完（或按停止）")
        _stop.clear()
        _job.clear()
        _job.update(running=True, kind=kind, phase="start", startedAt=int(time.time()), finishedAt=None, total=0, done=0, updated=0, noData=0,
                    failed=0, skipped=0, unsupported=0, batches=0, batchDone=0, error="", lastError="", note="", stopped=False, **extra)

    def run() -> None:
        try:
            work()
        except Exception as exc:
            _job["error"] = f"{type(exc).__name__}: {exc}"[:300]
        finally:
            _job["phase"] = "done"
            _job["running"] = False
            _job["finishedAt"] = int(time.time())

    (runner or (lambda fn: threading.Thread(target=fn, name=f"library-{kind}", daemon=True).start()))(run)


def start_refresh(payload: dict[str, Any], runner: Callable[[Callable[[], None]], None] | None = None) -> dict[str, Any]:
    scope = str(payload.get("scope") or "all")
    if scope not in {"all", "search"}:
        raise ValueError("范围不对")
    skip_hours = max(0.0, min(float(payload.get("skipHours") or 0), 24 * 30))
    if scope == "search":
        f = payload.get("filters") if isinstance(payload.get("filters"), dict) else {}
        keys = [tuple(k) for k in wl.search({"q": f.get("q") or "", "chain": f.get("chain") or "", "label": f.get("label") or "",
                                              "showQuiet": bool(f.get("showQuiet")), "keysOnly": True})["keys"]]
    else:
        with wl.LOCK:
            conn = wl.connect()
            try:
                keys = [(r["chain"], r["address"]) for r in conn.execute("SELECT chain, address FROM wallets ORDER BY chain, address")]
            finally:
                conn.close()
    if not keys:
        raise ValueError("没有符合的钱包")
    skip_after = int(time.time() - skip_hours * 3600) if skip_hours else None

    def work() -> None:
        _job["phase"] = "refresh"
        _refresh(keys, skip_after)

    _start("refresh", work, runner, scope=scope, wallets=len(keys), skipHours=skip_hours)
    return {"ok": True, "job": snapshot()}


def _params(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        threshold = float(payload.get("threshold"))
    except (TypeError, ValueError):
        raise ValueError("门槛要填数字（美元）") from None
    if not -1e9 <= threshold <= 1e9:
        raise ValueError("门槛不合理")
    scope = str(payload.get("scope") or "")
    if scope not in wl.CLEANUP_SCOPES:
        raise ValueError("链的范围不对")
    return {"threshold": threshold, "platform": bool(payload.get("platform")), "scope": scope, "young": payload.get("young") is not False}


def _row(group: str, d: dict[str, Any], names: dict[str, list[str]]) -> dict[str, Any]:
    chains = [c for c, _ in d["members"]]
    return {"address": d["members"][0][1], "chains": chains, "best": d["best"], "src": d["src"], "coin": d["coin"], "pnl30": d["pnl30"], "gm": d["gm"],
            "pf": d["pf"], "acct": d["acct"], "firstSeen": d["firstSeen"], "platform": d["platform"], "names": names.get(group, [])}


def start_preview(payload: dict[str, Any], runner: Callable[[Callable[[], None]], None] | None = None) -> dict[str, Any]:
    global _preview
    p = _params(payload)

    def work() -> None:
        global _preview
        _job["phase"] = "check"
        with wl.LOCK:
            conn = wl.connect()
            try:
                first = wl.cleanup_candidates(conn, **p)
            finally:
                conn.close()
        keys = [k for d in first["due"].values() for k in d["members"]]
        _job.update(phase="refresh", firstDue=len(first["due"]))
        failed = _refresh(keys, int(time.time() - FRESH_SECONDS))
        if _job.get("stopped"):
            _job["error"] = "已停止，这次没有预览结果；要清理请重新按预览"
            return
        _job["phase"] = "compute"
        with wl.LOCK:
            conn = wl.connect()
            try:
                cand = wl.cleanup_candidates(conn, **p)
                names: dict[str, list[str]] = {}
                for r in conn.execute("SELECT chain, address, platform, handle FROM platform_names ORDER BY first_seen"):
                    lst = names.setdefault(wl.norm(r["chain"], r["address"]), [])
                    text = f"{r['platform']}：{r['handle']}"
                    if text not in lst:
                        lst.append(text)
            finally:
                conn.close()
        skipped = {g for g, d in cand["due"].items() if any(tuple(k) in failed for k in d["members"])}
        due = {g: d for g, d in cand["due"].items() if g not in skipped}
        rows = sorted((_row(g, d, names) for g, d in due.items()), key=lambda r: (r["best"], r["address"]))
        by_chain: dict[str, int] = {}
        for r in rows:
            k = "Solana" if "Solana" in r["chains"] else "BSC／RH"
            by_chain[k] = by_chain.get(k, 0) + 1
        week = time.time() - wl.PRUNE_AFTER_DAYS * 86400
        pid = secrets.token_hex(8)
        result = {"id": pid, "params": p, "count": len(rows), "byChain": by_chain, "kept": cand["kept"], "keepNames": wl.KEEP_REASON,
                  "noData": cand["noData"], "youngSkipped": cand["youngSkipped"], "notRefreshed": len(skipped),
                  "young": sum(1 for r in rows if r["firstSeen"] and r["firstSeen"] > week), "days": wl.PRUNE_AFTER_DAYS,
                  "platformRows": sum(1 for r in rows if r["platform"]), "wallets": sum(len(r["chains"]) for r in rows),
                  "rows": rows[:SHOW_ROWS], "at": int(time.time())}
        _preview = {"id": pid, "at": time.time(), "params": p, "groups": set(due)}
        _job["result"] = result

    with _lock:
        if not _job.get("running"):
            _preview = None
    _start("preview", work, runner, params=p)
    return {"ok": True, "job": snapshot()}


def apply(payload: dict[str, Any]) -> dict[str, Any]:
    global _preview
    with _lock:
        if _job.get("running"):
            raise RuntimeError("还有工作在跑，等它跑完再删")
        pv = _preview
        if not pv or pv["id"] != str(payload.get("id") or ""):
            raise ValueError("找不到这次预览，请重新按「预览」")
        if time.time() - pv["at"] > PREVIEW_TTL:
            _preview = None
            raise ValueError("预览超过 30 分钟了，请重新按「预览」")
        _preview = None
    res = wl.cleanup_apply(pv["groups"], **pv["params"])
    _job["applied"] = res
    return res


def snapshot() -> dict[str, Any]:
    s = {k: v for k, v in _job.items() if k not in {"result"}}
    if "result" in _job:
        s["result"] = _job["result"]
    if s.get("running") and s.get("phase") == "refresh" and s.get("done") and s.get("refreshStartedAt"):
        spent = time.time() - s["refreshStartedAt"]
        s["eta"] = int(spent / s["done"] * (s["total"] - s["done"]))
    s.pop("refreshStartedAt", None)
    return s


def status() -> dict[str, Any]:
    with wl.LOCK:
        conn = wl.connect()
        try:
            total = conn.execute("SELECT COUNT(*) FROM wallets").fetchone()[0]
            done = conn.execute("SELECT COUNT(*) FROM wallets WHERE gm_at IS NOT NULL").fetchone()[0]
            last = wl._state_get(conn, "cleanup:last")
        finally:
            conn.close()
    return {"ok": True, "job": snapshot(), "library": {"wallets": total, "gmDone": done}, "lastCleanup": last}


def handle(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    if path == "/api/library-bulk/refresh":
        return start_refresh(payload)
    if path == "/api/library-bulk/preview":
        return start_preview(payload)
    if path == "/api/library-bulk/apply":
        return apply(payload)
    if path == "/api/library-bulk/stop":
        _stop.set()
        return {"ok": True, "job": snapshot()}
    if path == "/api/library-bulk/status":
        return status()
    raise ValueError("找不到此 API")
