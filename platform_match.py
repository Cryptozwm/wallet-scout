from __future__ import annotations
import json, time, urllib.parse, urllib.request, urllib.error
from typing import Any

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36"
FOMO_NETWORK = {"bsc": 56, "sol": 1399811149, "robinhood": 4663}
FOMO_NETWORK_NAME = {56: "BSC", 1399811149: "Solana", 4663: "Robinhood Chain"}
PUMP_CHAINS = {"sol", "bsc", "robinhood"}
CHAIN_ALIAS = {"bnb": "bsc", "solana": "sol", "rh": "robinhood"}
EXPLORER = {"bsc": "https://bscscan.com/address/", "sol": "https://solscan.io/account/", "robinhood": "https://gmgn.ai/robinhood/address/"}
TOL = 1.0


def _get(url: str, headers: dict[str, str] | None = None, timeout: int = 25) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code}: {exc.read()[:200].decode('utf-8', 'replace')}") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"连接或格式错误: {exc}") from exc


def _norm(a: str) -> str:
    return a.lower() if a.startswith("0x") else a


def _f(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def gmgn_holders(chain: str, ca: str) -> list[dict[str, Any]]:
    q = urllib.parse.urlencode({"limit": 100, "orderby": "amount_percentage", "direction": "desc"})
    data = _get(f"https://gmgn.ai/vas/api/v1/token_holders/{chain}/{ca}?{q}", {"Referer": f"https://gmgn.ai/{chain}/token/{ca}"})
    if data.get("code") != 0:
        raise RuntimeError(f"GMGN code={data.get('code')} {data.get('message')}")
    return data["data"]["list"]


def _pump_page(ca: str, page: int) -> dict[str, Any]:
    q = urllib.parse.urlencode({"sortBy": "TOP", "withThesis": "false", "pageSize": 50, "page": page})
    return _get(f"https://frontend-api-v3.pump.fun/mint-positions/{ca}?{q}", {"Origin": "https://pump.fun", "Referer": "https://pump.fun/"})


def _pump_row(r: dict[str, Any]) -> dict[str, Any]:
    return {"handle": r.get("userName"), "x": r.get("xUsername"), "verified": r.get("isVerified"),
            "amount": float(r.get("amountHeld") or 0), "pnl": r.get("pnlUsd"), "realized": r.get("realizedPnlUsd"), "cost": r.get("costBasisUsd")}


def pump_positions(ca: str, cutoff: float, max_pages: int = 40) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for page in range(max_pages):
        data = _pump_page(ca, page)
        rows = data.get("positions") or []
        out += [_pump_row(r) for r in rows]
        if not rows or not data.get("hasMore") or min(float(r.get("amountHeld") or 0) for r in rows) < cutoff:
            break
    return out


def pump_user_pnl(ca: str, handles: set[str], max_pages: int = 10, pause: float = 1.0) -> dict[str, dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    for page in range(max_pages):
        if page:
            time.sleep(pause)
        data = _pump_page(ca, page)
        for r in data.get("positions") or []:
            if r.get("userName") in handles:
                found[r["userName"]] = _pump_row(r)
        if len(found) >= len(handles) or not data.get("positions") or not data.get("hasMore"):
            break
    return found


PUMP_PASTE_MAX = 2000


def _num_or_none(value: Any) -> float | None:
    try:
        x = float(value)
    except (TypeError, ValueError):
        return None
    return x if x == x and abs(x) != float("inf") else None


def pump_pasted(items: Any, ca: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not isinstance(items, dict) or not isinstance(items.get("positions"), list):
        raise ValueError("pump.fun 名单格式错误，请在这颗币的 pump.fun 页重按「持币」书签")
    src_ca = str(items.get("ca") or "")
    if _norm(src_ca) != _norm(ca):
        raise ValueError(f"pump.fun 名单是别的币 ({src_ca})，请在这颗币的 pump.fun 页重按「持币」书签")
    out = []
    for r in items["positions"][:PUMP_PASTE_MAX]:
        if not isinstance(r, dict) or not r.get("userName"):
            continue
        out.append({"handle": str(r["userName"])[:80], "x": str(r["xUsername"])[:80] if r.get("xUsername") else None,
                    "verified": bool(r.get("isVerified")), "amount": _f(r.get("amountHeld")),
                    "pnl": _num_or_none(r.get("pnlUsd")), "realized": _num_or_none(r.get("realizedPnlUsd")), "cost": _num_or_none(r.get("costBasisUsd"))})
    try:
        at = float(items.get("at")) / 1000
    except (TypeError, ValueError):
        at = None
    return out, {"at": at}


def fomo_pasted(items: Any, ca: str, chain: str = "bsc") -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if isinstance(items, list) or not isinstance(items, dict) or not isinstance(items.get("holders"), list):
        raise ValueError("粘贴的 FOMO 名单没有附 CA（旧版书签或格式错误），请换新版书签在这个币的 FOMO 页重按")
    src_ca = str(items.get("ca") or "")
    if src_ca.lower() != ca.lower():
        raise ValueError(f"贴的是别的币 ({src_ca})，请到这个币的 FOMO 页重按书签")
    want = FOMO_NETWORK.get(chain)
    got = items.get("networkId")
    if got is not None:
        try:
            got = int(got)
        except (TypeError, ValueError):
            raise ValueError("FOMO 名单的网络编号格式错误，请到这颗币的 FOMO 页重按书签") from None
    if got is None and chain != "bsc":
        raise ValueError(f"旧版书签只会抓 BSC 的名单，{FOMO_NETWORK_NAME.get(want, chain)} 的币请先重拖新版书签再按")
    if got is not None and got != want:
        raise ValueError(f"贴的是 {FOMO_NETWORK_NAME.get(got, got)} 的 FOMO 名单，跟这颗币的链不同，请到这颗币的 FOMO 页重按书签")
    out = []
    for it in items["holders"][:500]:
        if isinstance(it, dict) and it.get("handle"):
            out.append({"handle": str(it["handle"])[:80], "followers": it.get("followers"), "verified": it.get("verified"),
                        "amount": float(it.get("amount") or 0), "pnl": it.get("pnl")})
    try:
        at = float(items.get("at")) / 1000
    except (TypeError, ValueError):
        at = None
    return out, {"at": at, "total": items.get("total")}


def _assign(holders: list[dict[str, Any]], users: list[dict[str, Any]], cutoff: float, zero_reason: str = "对到 0 个地址（可能两次快照间有交易）") -> tuple[dict[str, dict], list[dict]]:
    labeled: dict[str, dict] = {}; unmatched = []
    for u in users:
        if u["amount"] < cutoff - TOL:
            continue
        hits = [_norm(h["address"]) for h in holders if abs(float(h.get("amount_cur") or 0) - u["amount"]) <= TOL]
        if len(hits) == 1 and hits[0] not in labeled:
            labeled[hits[0]] = u
        else:
            unmatched.append({**u, "reason": zero_reason if not hits else f"对到 {len(hits)} 个地址，不标" if len(hits) > 1 else "该地址已被另一用户标记"})
    return labeled, unmatched


def match(payload: dict[str, Any], gmgn_cli: Any = None) -> dict[str, Any]:
    ca = _norm(str(payload.get("ca") or "").strip())
    if not ca:
        raise ValueError("缺少 ca")
    chain = str(payload.get("chain") or ("bsc" if ca.startswith("0x") else "sol")).lower()
    chain = CHAIN_ALIAS.get(chain, chain)
    if chain not in EXPLORER:
        raise ValueError(f"平台比对目前只支持 BSC、Solana、Robinhood Chain（{chain} 未实作）")
    t0 = time.time()
    gsrc = "gmgn.ai 网页接口"
    try:
        holders = gmgn_holders(chain, ca)
    except Exception as web_exc:
        if gmgn_cli is None:
            raise
        try:
            d = gmgn_cli(["token", "holders", "--chain", chain, "--address", ca, "--limit", "100", "--order-by", "amount_percentage"])
            holders = (d.get("list") or (d.get("data") or {}).get("list") or []) if isinstance(d, dict) else []
            gsrc = f"GMGN CLI（网页接口失败：{str(web_exc)[:60]}）"
        except Exception as cli_exc:
            raise RuntimeError(f"GMGN 网页接口失败：{str(web_exc)[:100]}；CLI 也失败：{str(cli_exc)[:100]}") from cli_exc
    if not holders:
        raise RuntimeError("GMGN 回传 0 笔持仓")
    gmgn_at = time.time()
    cutoff = float(holders[-1].get("amount_cur") or 0)
    status: dict[str, Any] = {"gmgn": {"ok": True, "source": gsrc, "count": len(holders), "fetchedAt": time.strftime("%H:%M:%S", time.localtime(time.time()))}}
    pump, fomo, um_p, um_f = {}, {}, [], []
    if chain in PUMP_CHAINS:
        pasted = payload.get("pumpList") is not None
        try:
            if pasted:
                p, pmeta = pump_pasted(payload["pumpList"], ca)
                pat = pmeta.get("at")
                close = pat is not None and abs(gmgn_at - pat) <= 180
                pump, um_p = _assign(holders, p, cutoff, "对到 0 个地址（可能两次快照间有交易）" if close else "对到 0 个地址（快照时间差太大或未知，无法判断原因）")
                pwarn = [] if close else ["pump.fun 名单没有抓取时间，无法确认与 GMGN 是否同一时段" if pat is None
                                          else f"GMGN 快照与 pump.fun 名单相差 {int(abs(gmgn_at - pat) // 60)} 分钟（超过 3 分钟），期间有交易的人会对不上；建议在 pump.fun 页重按「持币」书签"]
                if p and min(x["amount"] for x in p) > cutoff:
                    pwarn.append("pump.fun 名单可能不完整（名单中最小持有量仍大于门槛，门槛以上的人可能没全列出）")
                status["pumpfun"] = {"ok": True, "source": "书签代查", "fetched": len(p), "aboveCutoff": sum(x["amount"] >= cutoff - TOL for x in p), "matched": len(pump),
                                     "fetchedAt": time.strftime("%H:%M:%S", time.localtime(pat)) if pat else "未知", "warnings": pwarn}
            else:
                p = pump_positions(ca, cutoff); pump, um_p = _assign(holders, p, cutoff)
                status["pumpfun"] = {"ok": True, "fetched": len(p), "aboveCutoff": sum(x["amount"] >= cutoff - TOL for x in p), "matched": len(pump), "fetchedAt": time.strftime("%H:%M:%S", time.localtime(time.time()))}
        except Exception as exc:
            msg = str(exc)[:200]
            if not pasted and "HTTP 403" in msg:
                msg = "pump.fun 不让服务器直接查（HTTP 403）：到这颗币的 pump.fun 页按「持币」书签，会自动开这页补上 pump.fun 名字"
            status["pumpfun"] = {"ok": False, "error": msg}
    else:
        status["pumpfun"] = {"ok": False, "skipped": True, "note": "pump.fun 没有这条链的币"}
    fsrc = None
    try:
        meta: dict[str, Any] = {}
        if payload.get("fomoList") is not None and chain in FOMO_NETWORK:
            f, meta = fomo_pasted(payload["fomoList"], ca, chain); fsrc = "书签小工具粘贴"
        else:
            f = None
            status["fomo"] = {"ok": False, "error": "没有 FOMO 名单：在这颗币的 FOMO 页按书签小工具，回来按「从剪贴板粘贴并比对」。FOMO 字段为数据缺口。"} if chain in FOMO_NETWORK \
                else {"ok": False, "skipped": True, "note": "FOMO 比对只支持 BSC、Solana、Robinhood Chain"}
        if f is not None:
            warnings = []
            gap = abs(gmgn_at - meta["at"]) if meta.get("at") else None
            if gap is None:
                warnings.append("FOMO 名单没有抓取时间，无法确认与 GMGN 是否同一时段")
            elif gap > 180:
                warnings.append(f"GMGN 快照与 FOMO 名单相差 {int(gap // 60)} 分钟（超过 3 分钟），期间有交易的人会对不上；建议重按书签后立刻比对")
            if f and min(x["amount"] for x in f) > cutoff:
                warnings.append("FOMO 名单可能不完整（名单中最小持有量仍大于门槛，门槛以上的人可能没全列出）")
            close = gap is not None and gap <= 180
            fomo, um_f = _assign(holders, f, cutoff, "对到 0 个地址（可能两次快照间有交易）" if close else "对到 0 个地址（快照时间差太大或未知，无法判断原因）")
            fat = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(meta["at"])) if meta.get("at") else "未知"
            status["fomo"] = {"ok": True, "source": fsrc, "fetchedAt": fat, "total": meta.get("total"), "fetched": len(f),
                              "aboveCutoff": sum(x["amount"] >= cutoff - TOL for x in f), "matched": len(fomo), "warnings": warnings}
    except Exception as exc:
        status["fomo"] = {"ok": False, "error": str(exc)[:200]}
    supply = next((_f(h.get("amount_cur")) / _f(h.get("amount_percentage")) for h in holders
                   if _f(h.get("amount_percentage")) > 0 and _f(h.get("amount_cur")) > 0), None)
    rows = []
    for i, h in enumerate(holders, 1):
        a = _norm(h["address"]); pu = pump.get(a); fo = fomo.get(a)
        tags = sorted(set((h.get("tags") or []) + (h.get("maker_token_tags") or [])))
        is_pool = any(("pool" in str(t).lower()) or ("exchange" in str(t).lower()) for t in tags)
        is_ex = is_pool or h.get("addr_type") == 2
        plats = [p for p, v in (("FOMO", fo), ("pump.fun", pu)) if v]
        rows.append({"rank": i, "address": a, "amount": h.get("amount_cur"), "pct": round((h.get("amount_percentage") or 0) * 100, 4),
                     "usd": h.get("usd_value"), "pnl": h.get("profit"), "realized": h.get("realized_profit"), "unrealized": h.get("unrealized_profit"),
                     "tags": tags, "gmgnName": h.get("name"), "twitter": h.get("twitter_username"),
                     "isExchangeOrContract": is_ex, "isPool": is_pool, "contractLabel": ("池子／交易所" if is_pool else ("合约（机器人／打包）" if is_ex else "")), "exchange": "",
                     "platform": "/".join(plats), "fomoHandle": fo and fo["handle"], "fomoFollowers": fo and fo.get("followers"),
                     "pumpName": pu and pu["handle"], "pumpX": pu and pu.get("x"), "pumpVerified": pu and pu.get("verified"),
                     "fomoPnl": fo and fo.get("pnl"), "pumpPnl": pu and pu.get("pnl"),
                     "pumpRealized": pu and pu.get("realized"), "pumpCost": pu and pu.get("cost"),
                     "explorer": EXPLORER.get(chain, "") + h["address"],
                     "startHoldingAt": h.get("start_holding_at"), "walletCreatedAt": h.get("created_at"),
                     "avgCost": h.get("avg_cost"), "avgSold": h.get("avg_sold"), "soldPct": h.get("sell_amount_percentage"),
                     "boughtUsd": h.get("history_bought_cost"), "soldUsd": h.get("history_sold_income")})
    return {"ok": True, "ca": ca, "chain": chain, "cutoff": cutoff, "supply": supply, "rule": "持有数量差 ≤1 颗且只对到唯一地址才标；0 或 ≥2 个一律不标",
            "status": status, "rows": rows, "unmatched": {"fomo": um_f, "pumpfun": um_p},
            "snapshotLocal": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time())), "elapsedMs": int((time.time() - t0) * 1000)}
