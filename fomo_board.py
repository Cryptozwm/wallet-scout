from __future__ import annotations

import json
import math
import re
import struct
import threading
import time
import urllib.error
import urllib.request
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal, InvalidOperation, localcontext
from pathlib import Path
from typing import Any, Callable

import wallet_library
from oss_config import DATA_DIR

PATHS = {"/api/fomo/board-import", "/api/fomo/board-status"}
SOL_NID = 1399811149
EVM_NID = {56: "bsc", 4663: "robinhood"}
EVM_LIB = {"bsc": "BSC", "robinhood": "Robinhood"}
EVM_ADDR = re.compile(r"0x[0-9a-fA-F]{40}")
EVM_TOL = 1.0
EVM_MIN = 1000.0
EVM_MAX_TOKENS = 60
RPC_URLS = ("https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com")
TOKEN_PROGRAMS = {"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": "spl", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb": "2022"}
WSOL = "So11111111111111111111111111111111111111112"
B58 = re.compile(r"[1-9A-HJ-NP-Za-km-z]{32,44}")
LOG = DATA_DIR / "logs" / "fomo-board.jsonl"
PERIODS = ("24h", "7d", "30d", "all")
MAX_USERS = 800
GAP = 0.35
ULPS = 4
RANGE_MAX = 1 << 24

_lock = threading.Lock()
_job: dict[str, Any] = {"running": False}
_last_call = 0.0


def _post(url: str, body: dict[str, Any]) -> Any:
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json", "User-Agent": "wallet-scout/1.0"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read())


def _rpc(method: str, params: list[Any]) -> Any:
    global _last_call
    last = ""
    for url in RPC_URLS:
        for attempt in range(4):
            wait = GAP - (time.time() - _last_call)
            if wait > 0:
                time.sleep(wait)
            _last_call = time.time()
            _job["rpc"] = _job.get("rpc", 0) + 1
            try:
                j = _post(url, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
            except urllib.error.HTTPError as e:
                last = f"HTTP {e.code}"
                if e.code == 429:
                    time.sleep(3 * (attempt + 1))
                    continue
                break
            except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
                last = str(e)[:80]
                break
            if isinstance(j, dict) and j.get("error"):
                err = j["error"]
                msg = str(err.get("message") if isinstance(err, dict) else err)[:120]
                if "429" in msg or "rate" in msg.lower():
                    time.sleep(3 * (attempt + 1))
                    last = msg
                    continue
                last = msg
                break
            return j.get("result") if isinstance(j, dict) else None
    raise RuntimeError(f"Solana 节点没回应（{last or '不明'}）")


def _b58(b: bytes) -> str:
    alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    n = int.from_bytes(b, "big")
    s = ""
    while n:
        n, r = divmod(n, 58)
        s = alphabet[r] + s
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + s


def _mint_info(mint: str, cache: dict[str, Any]) -> tuple[str, int] | None:
    if mint in cache:
        return cache[mint]
    r = _rpc("getAccountInfo", [mint, {"encoding": "jsonParsed"}])
    v = (r or {}).get("value") if isinstance(r, dict) else None
    info = None
    try:
        if v and v.get("owner") in TOKEN_PROGRAMS and v["data"]["parsed"]["type"] == "mint":
            info = (v["owner"], int(v["data"]["parsed"]["info"]["decimals"]))
    except (KeyError, TypeError, ValueError):
        info = None
    cache[mint] = info
    return info


def _accounts(program: str, filters: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if TOKEN_PROGRAMS[program] == "spl":
        filters = [{"dataSize": 165}, *filters]
    r = _rpc("getProgramAccounts", [program, {"encoding": "jsonParsed", "filters": filters}])
    out = []
    for a in r or []:
        try:
            info = a["account"]["data"]["parsed"]["info"]
            out.append({"owner": info["owner"], "amount": int(info["tokenAmount"]["amount"])})
        except (KeyError, TypeError, ValueError):
            continue
    return out


def _owners_of(mint: str, program: str, raw: int) -> list[str]:
    accts = _accounts(program, [{"memcmp": {"offset": 0, "bytes": mint}}, {"memcmp": {"offset": 64, "bytes": _b58(struct.pack("<Q", raw))}}])
    return sorted({a["owner"] for a in accts})


def _raw_range(amt: Decimal, dec: int) -> tuple[int, int]:
    d = float(amt)
    with localcontext() as ctx:
        ctx.prec = 80
        exact, ulp, scale = Decimal(d), Decimal(math.ulp(d)), Decimal(10) ** dec
        lo = ((exact - ULPS * ulp) * scale).to_integral_value(rounding=ROUND_CEILING)
        hi = ((exact + ULPS * ulp) * scale).to_integral_value(rounding=ROUND_FLOOR)
    return int(lo), int(hi)


def _owners_in_range(mint: str, program: str, lo: int, hi: int) -> list[str] | None:
    lo, hi = max(lo, 1), min(hi, 2 ** 64 - 1)
    if lo > hi or hi - lo > RANGE_MAX:
        return None
    k = 1
    while k < 7 and (hi >> (8 * k)) - (lo >> (8 * k)) > 1:
        k += 1
    first, last = lo >> (8 * k), hi >> (8 * k)
    if first == 0 or last - first > 1:
        return None
    owners: set[str] = set()
    for b in range(first, last + 1):
        for a in _accounts(program, [{"memcmp": {"offset": 0, "bytes": mint}}, {"memcmp": {"offset": 64 + k, "bytes": _b58(b.to_bytes(8 - k, "little"))}}]):
            if lo <= a["amount"] <= hi:
                owners.add(a["owner"])
    return sorted(owners)


def _amount(v: Any) -> Decimal | None:
    try:
        d = Decimal(str(v))
    except (InvalidOperation, ValueError):
        return None
    return d if d.is_finite() and d > 0 else None


def parse_board(board: Any) -> list[dict[str, Any]]:
    if not isinstance(board, dict) or board.get("kind") != "fomo-board" or not isinstance(board.get("users"), list):
        raise ValueError("排行榜格式不对")
    users: dict[str, dict[str, Any]] = {}
    for u in board["users"][:MAX_USERS]:
        if not isinstance(u, dict):
            continue
        handle, why = wallet_library._platform_handle(u.get("h"), "")
        if why or not re.fullmatch(r"[\w.\-]{1,40}", handle):
            continue
        key = handle.lower()
        hold: list[tuple[str, Decimal]] = []
        evm: list[tuple[str, str, Decimal]] = []
        for it in u.get("hold") if isinstance(u.get("hold"), list) else []:
            if not isinstance(it, list) or len(it) < 3:
                continue
            ca, nid, amt = str(it[0] or ""), it[1], _amount(it[2])
            if amt is None:
                continue
            if nid == SOL_NID and B58.fullmatch(ca) and ca != WSOL and not any(h[0] == ca for h in hold):
                hold.append((ca, amt))
            elif nid in EVM_NID and EVM_ADDR.fullmatch(ca) and not any(e[1] == ca.lower() for e in evm):
                evm.append((EVM_NID[nid], ca.lower(), amt))
        ranks = {p: int(r) for p, r in (u.get("ranks") or {}).items() if p in PERIODS and isinstance(r, (int, float)) and 0 < r < 10000} if isinstance(u.get("ranks"), dict) else {}
        x = re.sub(r"[^A-Za-z0-9_]", "", str(u.get("x") or "").lstrip("@"))[:15]
        f = wallet_library.num(u.get("f"))
        prev = users.get(key)
        if prev:
            prev["ranks"].update(ranks)
            for h in hold:
                if not any(p[0] == h[0] for p in prev["hold"]):
                    prev["hold"].append(h)
            for e in evm:
                if not any(p[1] == e[1] for p in prev["evm"]):
                    prev["evm"].append(e)
            continue
        users[key] = {"handle": handle, "followers": int(f) if f is not None and f >= 0 else None,
                      "verified": None if u.get("v") is None else bool(u.get("v")), "x": x, "ranks": ranks, "hold": hold[:5], "evm": evm[:5]}
    return list(users.values())


def _weak(amt: Decimal) -> bool:
    frac = amt - int(amt)
    return frac == 0 or len(format(frac.normalize(), "f").split(".")[-1]) <= 2


def resolve(user: dict[str, Any], mints: dict[str, Any]) -> dict[str, Any]:
    found: list[tuple[str, str, Decimal, bool, str]] = []
    tried = imprecise = 0
    for ca, amt in user["hold"]:
        info = _mint_info(ca, mints)
        if not info:
            continue
        program, dec = info
        scaled = amt * (Decimal(10) ** dec)
        raw = int(scaled)
        exact = Decimal(raw) == scaled and 0 < raw < 2 ** 64
        owners: list[str] | None = []
        how = "exact"
        if exact:
            tried += 1
            owners = _owners_of(ca, program, raw)
        if not owners:
            lo, hi = _raw_range(amt, dec)
            if not exact or hi > lo:
                owners = _owners_in_range(ca, program, lo, hi)
                how = "range"
                if owners is None:
                    imprecise += 1
                    continue
                tried += 1
        if not owners or len(owners) != 1:
            continue
        found.append((owners[0], ca, amt, _weak(amt), how))
        if len({f[0] for f in found}) > 1 or any(not f[3] for f in found) or len(found) >= 2:
            break
    if not found:
        return {"why": "数量对不到（多半刚交易过）" if tried else "数量太长对不准" if imprecise else "持仓的币查不到"}
    addrs = {f[0] for f in found}
    if len(addrs) > 1:
        return {"why": "两笔持仓指到不同地址", "conflict": sorted(addrs)}
    if all(f[3] for f in found) and len(found) < 2:
        return {"why": "只有一笔、数量太整，不够确定"}
    a, ca, amt, _, how = next((f for f in found if not f[3]), found[0])
    return {"address": a, "mint": ca, "amount": str(amt), "evidence": len(found), "how": how}


def _gmgn_holders(chain: str, ca: str) -> list[dict[str, Any]]:
    import smart_money

    t = smart_money.tracker()
    if t is None:
        raise RuntimeError("聪明钱收集没开（GMGN 限流器不在），BSC／RH 先不绑")
    data = t.gmgn.call("/v1/market/token_top_holders", {"chain": chain, "address": ca, "limit": 100, "order_by": "amount_percentage", "direction": "desc"},
                       5, stop=t.stop)
    rows = (data.get("list") if isinstance(data, dict) else data) or []
    return rows if isinstance(rows, list) else []


def _holder_amounts(rows: list[dict[str, Any]]) -> tuple[list[tuple[str, float]], float | None]:
    out, amounts = [], []
    for w in rows:
        if not isinstance(w, dict):
            continue
        a = str(w.get("address") or "").lower()
        amount = wallet_library.num(w.get("amount_cur"))
        if amount is None:
            amount = wallet_library.num(w.get("balance"))
        if not EVM_ADDR.fullmatch(a) or amount is None:
            continue
        amounts.append(amount)
        tags = " ".join(str(x) for x in (w.get("tags") or []) + (w.get("maker_token_tags") or [])).lower()
        if int(wallet_library.num(w.get("addr_type")) or 0) == 2 or "pool" in tags or "exchange" in tags:
            continue
        out.append((a, amount))
    return out, (min(amounts) if len(rows) >= 100 and amounts else None)


def _known_evm_handles() -> set[str]:
    with wallet_library.LOCK:
        conn = wallet_library.connect()
        try:
            return {str(r[0]).lower() for r in conn.execute("SELECT handle FROM platform_names WHERE platform='FOMO' AND chain IN ('BSC','Robinhood')")}
        finally:
            conn.close()


EVM_FATAL = ("API Key", "追踪已停止", "方案不支持", "收集没开")


def _run_evm(users: list[dict[str, Any]], fetch: Callable[[str, str], list[dict[str, Any]]]) -> list[dict[str, Any]]:
    ev = _job["evm"]
    why: dict[str, int] = _job["evmWhy"]
    known = _known_evm_handles()
    need: list[tuple[dict[str, Any], list[tuple[str, str, float]]]] = []
    for u in users:
        if not u["evm"]:
            continue
        if u["handle"].lower() in known:
            ev["known"] += 1
            continue
        holds = [(c, ca, float(amt)) for c, ca, amt in u["evm"] if float(amt) >= EVM_MIN]
        if not holds:
            why["持仓数量太小（不到 1000 颗）"] = why.get("持仓数量太小（不到 1000 颗）", 0) + 1
            continue
        need.append((u, holds))
    ev["users"] = len(need)
    tok: dict[tuple[str, str], list[tuple[dict[str, Any], float]]] = {}
    for u, holds in need:
        for c, ca, amt in holds:
            tok.setdefault((c, ca), []).append((u, amt))
    order = sorted(tok, key=lambda k: (-len(tok[k]), k))
    chosen = order[:EVM_MAX_TOKENS]
    ev.update(tokens=len(chosen), skipped=len(order) - len(chosen))
    hits: dict[str, list[tuple[str, str, str, float]]] = {}
    reason: dict[str, str] = {}
    looked: set[str] = set()
    for key in chosen:
        if ev.get("error"):
            break
        chain, ca = key
        here = [(u, amt) for u, amt in tok[key] if not hits.get(u["handle"].lower())]
        if not here:
            ev["done"] += 1
            ev["saved"] += 1
            continue
        rows = None
        for attempt in range(2):
            try:
                rows = fetch(chain, ca)
                break
            except Exception as e:
                msg = str(e)[:160]
                if any(s in msg for s in EVM_FATAL):
                    ev["error"] = msg
                    break
                if "限流" in msg and attempt == 0:
                    continue
                ev["failed"] += 1
                ev["lastError"] = msg
                break
        ev["done"] += 1
        if rows is None:
            for u, _amt in here:
                reason.setdefault(u["handle"].lower(), "中途停下，没查到" if ev.get("error") else "GMGN 查找失败")
            continue
        holders, cutoff = _holder_amounts(rows)
        for u, amt in here:
            name = u["handle"].lower()
            looked.add(name)
            near = [(a, x) for a, x in holders if abs(x - amt) <= EVM_TOL]
            if len(near) == 1:
                if sum(1 for _v, a2 in tok[key] if abs(a2 - near[0][1]) <= EVM_TOL) == 1:
                    hits.setdefault(name, []).append((chain, near[0][0], ca, amt))
                else:
                    reason.setdefault(name, "两个人数量一样，分不出是谁")
            elif len(near) > 1:
                reason.setdefault(name, "前 100 有两个地址数量一样")
            elif cutoff is not None and amt < cutoff - EVM_TOL:
                reason.setdefault(name, "不在 GMGN 前 100 持有人")
            else:
                reason.setdefault(name, "数量对不到（多半刚交易过）")
    picked = []
    for u, _holds in need:
        name = u["handle"].lower()
        h = hits.get(name) or []
        addrs = {x[1] for x in h}
        if len(addrs) == 1:
            chain, a, ca, amt = h[0]
            picked.append({**u, "chain": EVM_LIB[chain], "address": a, "mint": ca, "amount": repr(amt), "evidence": len(h), "how": "gmgn"})
            continue
        if len(addrs) > 1:
            ev["conflict"] += 1
            w = "两颗币指到不同地址"
        elif name in reason:
            w = reason[name]
        elif ev.get("error"):
            w = "中途停下，没查到"
        else:
            w = f"持仓的币排在后面没查（一批最多 {EVM_MAX_TOKENS} 颗）" if name not in looked else "数量对不到（多半刚交易过）"
        why[w] = why.get(w, 0) + 1
    return picked


def _bind(picked: list[dict[str, Any]]) -> None:
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for p in picked:
        groups.setdefault((p["chain"], p["mint"]), []).append(p)
    rows = []
    for (chain, mint), part in groups.items():
        res = wallet_library.platform_names_add(chain, "FOMO", [{"address": p["address"], "handle": p["handle"], "followers": p["followers"],
                                                                 "verified": p["verified"], "x": p["x"]} for p in part], ca=mint, rename=True)
        olds = {x["address"]: "／".join(x["old"]) for x in res["renamed"]}
        created = set(res.get("created") or [])
        _job["renamed"] += res["renamed"]
        for p in part:
            addr = p["address"].lower() if chain != "Solana" else p["address"]
            st = res["status"].get(addr)
            if not st:
                continue
            rows.append({"chain": chain, "handle": p["handle"], "address": addr, "status": st, "old": olds.get(addr, ""), "mint": p["mint"],
                         "amount": p["amount"], "evidence": p["evidence"], "how": p["how"], "ranks": p["ranks"], "libNew": addr in created})
    with wallet_library.LOCK:
        conn = wallet_library.connect()
        try:
            for r in rows:
                chains = ("Solana",) if r["chain"] == "Solana" else ("BSC", "Robinhood")
                q = ",".join("?" * len(chains))
                r["inLibrary"] = bool(conn.execute(f"SELECT 1 FROM wallets WHERE chain IN ({q}) AND address=?", (*chains, r["address"])).fetchone()) and not r["libNew"]
                kept = [x[0] for x in conn.execute("SELECT handle FROM platform_names WHERE chain=? AND address=? AND platform='FOMO'", (r["chain"], r["address"]))]
                r["handle"] = next((k for k in kept if k.lower() == r["handle"].lower()), r["handle"])
        finally:
            conn.close()
    allrows = _job["rows"] + rows
    allrows.sort(key=lambda r: (r["chain"] != "Solana", r["status"] != "renamed", r["status"] != "new", r["handle"].lower()))
    _job.update(rows=allrows, bound=len(allrows), added=sum(r["status"] == "new" for r in allrows), same=sum(r["status"] == "same" for r in allrows),
                renamedCount=sum(r["status"] == "renamed" for r in allrows), inLibrary=sum(r["inLibrary"] for r in allrows),
                libAdded=sum(bool(r.get("libNew")) for r in allrows),
                solBound=sum(r["chain"] == "Solana" for r in allrows), evmBound=sum(r["chain"] != "Solana" for r in allrows))
    if rows:
        try:
            LOG.parent.mkdir(parents=True, exist_ok=True)
            now = int(time.time())
            with LOG.open("a", encoding="utf-8") as f:
                for r in rows:
                    f.write(json.dumps({"at": now, **{k: r[k] for k in ("chain", "address", "handle", "status", "old", "mint", "amount", "evidence", "how", "ranks")}},
                                       ensure_ascii=False) + "\n")
        except OSError:
            pass


def _snapshot() -> dict[str, Any]:
    keys = ("running", "phase", "startedAt", "finishedAt", "total", "withSol", "withEvm", "done", "bound", "added", "same", "renamedCount", "inLibrary",
            "libAdded", "solBound", "evmBound", "missed", "conflict", "weak", "noSol", "rpc", "error", "periods")
    s = {k: _job.get(k) for k in keys if k in _job}
    s["rows"] = list(_job.get("rows", []))[:600]
    s["renamed"] = list(_job.get("renamed", []))[:100]
    s["why"] = dict(_job.get("why", {}))
    s["evm"] = dict(_job.get("evm", {}))
    s["evmWhy"] = dict(_job.get("evmWhy", {}))
    return s


def _run(users: list[dict[str, Any]], fetch: Callable[[str, str], list[dict[str, Any]]]) -> None:
    mints: dict[str, Any] = {}
    picked: list[dict[str, Any]] = []
    try:
        for u in users:
            if not u["hold"]:
                _job["noSol"] += 1
                _job["done"] += 1
                continue
            try:
                r = resolve(u, mints)
            except RuntimeError as e:
                _job["error"] = str(e)
                break
            _job["done"] += 1
            if "address" not in r:
                _job["why"][r["why"]] = _job["why"].get(r["why"], 0) + 1
                _job["conflict" if "conflict" in r else "weak" if "太整" in r["why"] else "missed"] += 1
                continue
            picked.append({**u, **r, "chain": "Solana"})
        _bind(picked)
        if any(u["evm"] for u in users):
            _job["phase"] = "evm"
            _bind(_run_evm(users, fetch))
    except Exception as e:
        _job["error"] = f"{type(e).__name__}: {e}"[:200]
    finally:
        _job["phase"] = "done"
        _job["running"] = False
        _job["finishedAt"] = int(time.time())


def start(board: Any, runner: Callable[[Callable[[], None]], None] | None = None,
          fetch: Callable[[str, str], list[dict[str, Any]]] | None = None) -> dict[str, Any]:
    users = parse_board(board)
    if not users:
        raise ValueError("排行榜里没有可以用的名字")
    with _lock:
        if _job.get("running"):
            raise RuntimeError("上一批 FOMO 排行榜还在反查，等它跑完再贴")
        periods = board.get("periods") if isinstance(board.get("periods"), dict) else {}
        _job.clear()
        _job.update(running=True, phase="sol", startedAt=int(time.time()), finishedAt=None, total=len(users), withSol=sum(bool(u["hold"]) for u in users),
                    withEvm=sum(bool(u["evm"]) for u in users), done=0, bound=0, added=0, same=0, renamedCount=0, inLibrary=0, libAdded=0, solBound=0, evmBound=0,
                    missed=0, conflict=0, weak=0, noSol=0, rpc=0, error="",
                    periods={k: int(v) for k, v in periods.items() if k in PERIODS and isinstance(v, (int, float))}, rows=[], renamed=[], why={},
                    evm={"users": 0, "known": 0, "tokens": 0, "done": 0, "saved": 0, "skipped": 0, "failed": 0, "conflict": 0, "error": "", "lastError": ""},
                    evmWhy={})
    (runner or (lambda fn: threading.Thread(target=fn, name="fomo-board", daemon=True).start()))(lambda: _run(users, fetch or _gmgn_holders))
    return {"ok": True, "job": _snapshot()}


def handle(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    if path == "/api/fomo/board-import":
        return start(payload.get("board"))
    if path == "/api/fomo/board-status":
        return {"ok": True, "job": _snapshot()}
    raise ValueError("找不到此 API")
