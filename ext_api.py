from __future__ import annotations

import json
import re
import sqlite3
import threading
import time
import urllib.parse
from pathlib import Path
from typing import Any, Callable

import wallet_library as wl
from oss_config import DATA_DIR

VERSION = "1"
PATHS = {"/api/ext/token", "/api/ext/lookup", "/api/ext/signals", "/api/ext/tag", "/api/ext/star", "/api/ext/names",
         "/api/ext/pump-hot", "/api/ext/pump-hot-want"}
HOLDERS_TTL = 300
HOLDERS_FAIL_TTL = 30
HOLDERS_MIN_REFRESH = 60
MAX_ADDRESSES = 400
SIGNAL_HOURS = 6
EVM_SM = ("bsc", "robinhood")

CHAINS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "bsc": ("bsc", "bsc", ("BSC", "Robinhood")),
    "robinhood": ("robinhood", "robinhood", ("Robinhood", "BSC")),
    "sol": ("sol", "sol", ("Solana",)),
    "base": ("base", "", ("Base", "BSC", "Robinhood")),
    "eth": ("eth", "", ("ETH", "BSC", "Robinhood")),
}
ALIASES = {"bnb": "bsc", "bsc": "bsc", "rh": "robinhood", "robinhood": "robinhood", "sol": "sol", "solana": "sol",
           "base": "base", "eth": "eth", "ethereum": "eth"}
STRENGTH_RANK = {"weak": 1, "medium": 2, "strong": 3}
AVOID_KINDS = {"bundle", "bad", "bot"}

_lock = threading.Lock()
_cache: dict[str, tuple[float, Any]] = {}
_holders: dict[str, dict[str, Any]] = {}
_holder_locks: dict[str, threading.Lock] = {}


def _spec(chain: Any) -> tuple[str, tuple[str, str, tuple[str, ...]]]:
    key = ALIASES.get(str(chain or "").strip().lower())
    if not key:
        raise ValueError("不支持这条链（支持 BSC、SOL、Robinhood、Base、ETH）")
    return key, CHAINS[key]


def _addr(value: Any) -> str:
    return wl.norm("", str(value or "").strip())


def _valid(key: str, address: str) -> bool:
    if key == "sol":
        return bool(wl.FULL_ADDRESS.fullmatch(address)) and not address.startswith("0x")
    return address.startswith("0x") and len(address) == 42 and bool(wl.FULL_ADDRESS.fullmatch(address))


def _family_chains(spec: tuple[str, str, tuple[str, ...]], address: str) -> tuple[str, ...]:
    if address.startswith("0x"):
        return tuple(c for c in spec[2] if c != "Solana") or ("BSC", "Robinhood")
    return ("Solana",)


def _connect() -> sqlite3.Connection:
    uri = "file:" + urllib.parse.quote(wl.DB_PATH.as_posix(), safe="/:") + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def _memo(key: str, ttl: float, make: Callable[[], Any]) -> Any:
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
    value = make()
    with _lock:
        _cache[key] = (now + ttl, value)
    return value


def _tables(conn: sqlite3.Connection) -> set[str]:
    return _memo("tables", 600, lambda: {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")})


def _rows_in(conn: sqlite3.Connection, sql: str, chains: tuple[str, ...], addresses: list[str]) -> list[sqlite3.Row]:
    out: list[sqlite3.Row] = []
    for i in range(0, len(addresses), 400):
        chunk = addresses[i:i + 400]
        q = sql.format(c=",".join("?" * len(chains)), a=",".join("?" * len(chunk)))
        out += conn.execute(q, (*chains, *chunk)).fetchall()
    return out


def _num(value: Any) -> float | None:
    return wl.num(value)


def _describe(conn: sqlite3.Connection, key: str, spec: tuple[str, str, tuple[str, ...]], ca: str,
              addresses: list[str]) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    import smart_money
    tables = _tables(conn)
    primary = spec[2][0]
    sm_chain = spec[1]

    trades: dict[str, dict[str, Any]] = {}
    if sm_chain and ca and "sm_trades" in tables:
        sql = "SELECT tx, maker, side, usd, ts FROM sm_trades WHERE chain=? AND token=?"
        args: tuple[Any, ...] = (sm_chain, ca)
        if "sm_trades_archive" in tables:
            sql += " UNION SELECT tx, maker, side, usd, ts FROM sm_trades_archive WHERE chain=? AND token=?"
            args += (sm_chain, ca)
        for r in conn.execute(sql, args):
            t = trades.setdefault(r["maker"], {"buy": 0.0, "sell": 0.0, "first": r["ts"], "last": r["ts"], "n": 0})
            t["buy" if r["side"] == "buy" else "sell"] += _num(r["usd"]) or 0.0
            t["first"], t["last"], t["n"] = min(t["first"], r["ts"]), max(t["last"], r["ts"]), t["n"] + 1

    explicit = {a for a in addresses if a}
    addrs = list(dict.fromkeys([*(a for a in addresses if a), *trades]))
    evm = [a for a in addrs if a.startswith("0x")]
    sol = [a for a in addrs if not a.startswith("0x")]
    groups = [(g, _family_chains(spec, g[0])) for g in (evm, sol) if g]

    wallets: dict[str, dict[str, sqlite3.Row]] = {}
    plats: dict[str, list[dict[str, Any]]] = {}
    bots: dict[str, str] = {}
    smw: dict[str, dict[str, sqlite3.Row]] = {}
    for group, chains in groups:
        for r in _rows_in(conn, "SELECT * FROM wallets WHERE chain IN ({c}) AND address IN ({a})", chains, group):
            wallets.setdefault(r["address"], {})[r["chain"]] = r
        for r in _rows_in(conn, "SELECT * FROM platform_names WHERE chain IN ({c}) AND address IN ({a}) ORDER BY last_seen DESC", chains, group):
            plats.setdefault(r["address"], []).append({"chain": r["chain"], "platform": r["platform"], "handle": r["handle"], "x": r["x"] or "",
                                                       "followers": r["followers"], "verified": bool(r["verified"]), "cas": wl.loads(r["cas"])})
        if "bot_wallets" in tables:
            for r in _rows_in(conn, "SELECT chain, address, reason FROM bot_wallets WHERE chain IN ({c}) AND address IN ({a})", chains, group):
                bots[r["address"]] = r["reason"] or "机器人"
        if "sm_wallets" in tables:
            sm_chains = EVM_SM if group is evm else ("sol",)
            for r in _rows_in(conn, "SELECT chain, address, watch, grade, score, scored_at, name, twitter FROM sm_wallets "
                                    "WHERE chain IN ({c}) AND address IN ({a})", sm_chains, group):
                smw.setdefault(r["address"], {})[r["chain"]] = r
    private: dict[str, dict[str, Any]] = {}
    if "user_labels" in tables and addrs:
        for r in _rows_in(conn, "SELECT * FROM user_labels WHERE {c}address IN ({a})", (), addrs):
            label = {"label": r["raw_label"] or "", "group": r["group_key"] or "", "own": bool(r["own"])}
            kind = smart_money.label_kind(label)
            private[r["address"]] = {**label, "kind": kind, "kindText": smart_money.KIND_TEXT.get(kind, "")}

    apps = {r["address"]: r for r in conn.execute("SELECT * FROM appearances WHERE chain=? AND ca=?", (primary, ca))} if ca else {}
    token_row = wl.token_rows(conn, primary, [ca]).get(ca) if ca else None

    accts = _memo("accts", 60, lambda: wl.plat_accounts_index(conn))
    quiet = _memo("quiet", 120, lambda: wl.quiet_wallets(conn))
    cards = _memo("cards", 120, lambda: wl.sm_cards(conn))
    follows = _memo("follows", 300, lambda: wl.follow_index(conn))

    out: dict[str, dict[str, Any]] = {}
    flips = wl.flip_wallets(conn) if bots else set()
    for a in addrs:
        chains = _family_chains(spec, a)
        row = next((wallets[a][c] for c in chains if c in wallets.get(a, {})), None)
        sm_rows = smw.get(a, {})
        sm_row = sm_rows.get(sm_chain) or next(iter(sm_rows.values()), None)
        sm_useful = bool(sm_row and (sm_row["watch"] == 1 or (sm_row["grade"] and sm_row["scored_at"])))
        p = plats.get(a, [])
        user = private.get(a)
        bot = bots.get(a, "")
        trade = trades.get(a)
        if a in explicit:
            keep = row or p or user or bot or sm_useful or trade
        else:
            keep = user or p or (sm_row is not None and sm_row["watch"] == 1)
        if not keep:
            continue
        labels = wl.effective_labels(row) if row else []
        bot_removed = bool(row and {"bot", "hft"} & set(wl.loads(row["removed_labels"])))
        if bot_removed:
            bot = ""
        hft = ""
        if bot and wl.bot_tier(bot, a in flips) == "hft":
            hft, bot = bot, ""
        if bot and "bot" not in labels:
            labels.append("bot")
        if hft and "hft" not in labels and "bot" not in labels:
            labels.append("hft")
        lib_chain = row["chain"] if row else (p[0]["chain"] if p else chains[0])
        card = wl.wallet_card(row, labels, cards.get((lib_chain, a)), follows.get((lib_chain, a))) if row else None
        grade = (card or {}).get("grade") or ((sm_row["grade"] or "") if sm_row and sm_row["scored_at"] else "")
        use = (card or {}).get("use") or wl.card_use(labels, grade)
        avoid = "avoid" in use or bool(bot) or bool(user and user["kind"] in AVOID_KINDS)
        if avoid and "avoid" not in use:
            use = ["avoid", *[u for u in use if u != "confirm"]]
        here = None
        app = apps.get(a)
        if app is not None and row is not None:
            h = wl.token_here(app, token_row, [x for x in p if x["chain"] == row["chain"]], row["created_at"], labels, ca)
            here = {k: h[k] for k in ("realized", "unrealized", "total", "roi", "sold", "holding", "source")} | {"labels": h["labels"] + h["partly"]}
        acct_map = accts.get((lib_chain, a), {})
        platforms = [{"platform": x["platform"], "handle": x["handle"], "x": x["x"], "followers": x["followers"], "verified": x["verified"],
                      "acct": ({k: acct_map[x["platform"]].get(k) for k in ("total", "realized", "coins", "wins", "partial", "at")}
                               if x["platform"] in acct_map and acct_map[x["platform"]].get("at") else None)}
                     for x in p]
        name = ((row["name"] or row["twitter"]) if row else "") or next((x["handle"] for x in p if x["handle"]), "") \
            or ((sm_row["name"] or sm_row["twitter"] or "") if sm_row else "")
        out[a] = {
            "address": a, "chain": lib_chain, "lib": row is not None, "quiet": (lib_chain, a) in quiet,
            "name": name, "twitter": (row["twitter"] if row else "") or "", "note": ((row["note"] or "") if row else "")[:200],
            "labels": [{"id": x, "text": wl.RULE_LABELS.get(x, x), "group": wl.LABEL_GROUP.get(x, "custom"),
                        "manual": x in wl.loads(row["manual_labels"]) if row else False,
                        "removable": row is not None} for x in labels],
            "private": user,
            "grade": grade, "use": use, "useText": [wl.USE_LABEL.get(u, u) for u in use],
            "card": ({k: card.get(k) for k in ("score", "src", "at", "realized", "winrate", "tokens", "trades", "gt5", "big", "avgHold", "watch")}
                     | {"follow": card.get("follow")}) if card else None,
            "platforms": platforms,
            "here": here,
            "sm": {"chain": sm_row["chain"], "watch": sm_row["watch"] == 1, "muted": sm_row["watch"] == -1, "grade": grade,
                   "score": sm_row["score"]} if sm_row else None,
            "trade": {k: (round(v, 2) if isinstance(v, float) else v) for k, v in trade.items()} if trade else None,
            "bot": bot,
            "hft": hft,
            "avoid": avoid,
            "follow": not avoid and (grade in ("S", "A") or any(wl.LABEL_GROUP.get(x) == "follow" for x in labels)),
        }
    ctx = {"apps": apps, "token": token_row, "trades": trades}
    return out, ctx


def _parse_holders(raw: Any) -> list[dict[str, Any]]:
    if isinstance(raw, dict):
        raw = raw.get("list") or (raw.get("data") or {}).get("list") or []
    items: list[dict[str, Any]] = []
    for h in raw if isinstance(raw, list) else []:
        address = _addr(h.get("address"))
        if not address:
            continue
        tags = [str(t).lower() for t in (h.get("tags") or []) + (h.get("maker_token_tags") or [])]
        pool = any("pool" in t or "exchange" in t for t in tags) or h.get("addr_type") == 2
        name = str(h.get("twitter_name") or h.get("name") or "").strip()[:40]
        items.append({"rank": len(items) + 1, "address": address, "pct": round((_num(h.get("amount_percentage")) or 0) * 100, 4),
                      "usd": _num(h.get("usd_value")), "pool": pool, "name": name, "twitter": str(h.get("twitter_username") or "").strip()[:40]})
    return items


def _holders_for(gslug: str, ca: str, fetch: Callable[[str, str], Any], refresh: bool) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    key = f"{gslug}:{ca}"
    with _lock:
        lock = _holder_locks.setdefault(key, threading.Lock())
    with lock:
        now = time.time()
        hit = _holders.get(key)
        if hit and (hit["exp"] > now and not refresh or refresh and now - hit["meta"].get("at", 0) < HOLDERS_MIN_REFRESH):
            return hit["list"], {**hit["meta"], "cached": True}
        try:
            items = _parse_holders(fetch(gslug, ca))
            meta = {"ok": True, "at": int(now), "count": len(items), "source": "GMGN 前 100 持仓", "ttl": HOLDERS_TTL}
            entry = {"list": items, "meta": meta, "exp": now + HOLDERS_TTL}
        except Exception as exc:
            error = str(exc)[:200]
            if hit and hit["list"]:
                hit["exp"] = now + HOLDERS_FAIL_TTL
                return hit["list"], {**hit["meta"], "cached": True, "error": error}
            meta = {"ok": False, "at": int(now), "count": 0, "error": error}
            entry = {"list": [], "meta": meta, "exp": now + HOLDERS_FAIL_TTL}
        _holders[key] = entry
        if len(_holders) > 300:
            for old in sorted(_holders, key=lambda k: _holders[k]["exp"])[:100]:
                _holders.pop(old, None)
        return entry["list"], {**entry["meta"], "cached": False}


def _signal_rows(conn: sqlite3.Connection, sql: str, args: tuple[Any, ...]) -> list[dict[str, Any]]:
    out = []
    for r in conn.execute(sql, args):
        out.append({"chain": r["chain"], "ca": r["ca"], "symbol": r["symbol"] or "", "launchpad": r["launchpad"] or "",
                    "strength": r["strength"], "at": r["at"], "lastSeen": r["last_seen"], "mcap": r["mcap"], "wallets": r["wallets"],
                    "holders": r["holders"], "strongWallets": r["strong_wallets"], "buyUsd": r["buy_usd"], "sellUsd": r["sell_usd"],
                    "result": r["result"] or "", "peak": r["peak"], "trough": r["trough"], "settled": bool(r["settled"]),
                    "ch1h": r["ch1h"], "ch4h": r["ch4h"], "ch24h": r["ch24h"]})
    return out


SIGNAL_COLS = ("chain, ca, symbol, launchpad, strength, at, last_seen, mcap, wallets, holders, strong_wallets, buy_usd, sell_usd, "
               "result, peak, trough, settled, ch1h, ch4h, ch24h")


def _sm_token(conn: sqlite3.Connection, sm_chain: str, ca: str) -> dict[str, Any] | None:
    if not sm_chain or "sm_tokens" not in _tables(conn):
        return None
    r = conn.execute("SELECT * FROM sm_tokens WHERE chain=? AND ca=?", (sm_chain, ca)).fetchone()
    if r is None:
        return None
    price, supply = _num(r["price"]), _num(r["supply"])
    return {"symbol": r["symbol"] or "", "launchpad": r["launchpad"] or "", "logo": r["logo"] or "", "price": price,
            "priceAt": r["price_at"], "priceSrc": r["price_src"] or "", "mcap": price * supply if price and supply else _num(r["mcap"]),
            "athMc": _num(r["ath_mc"]), "liquidity": _num(r["liquidity"])}


_ADDRISH = ("…", "...")


def _persist_holder_names(holders: list[dict[str, Any]]) -> int:
    items: dict[str, tuple[str, str]] = {}
    for h in holders:
        if h.get("pool"):
            continue
        name = str(h.get("name") or "").strip()[:40]
        tw = str(h.get("twitter") or "").strip().lstrip("@")[:40]
        if not name or not tw or any(ord(ch) < 32 for ch in name + tw):
            continue
        if wl.FULL_ADDRESS.fullmatch(name) or any(s in name for s in _ADDRISH):
            continue
        try:
            name.encode("utf-8"); tw.encode("utf-8")
        except UnicodeEncodeError:
            continue
        items[h["address"]] = (name, tw)
    if not items:
        return 0
    now = int(time.time())
    filled = 0
    with wl.LOCK:
        conn = wl.connect()
        try:
            addrs = list(items)
            rows = conn.execute(f"SELECT chain, address FROM wallets WHERE address IN ({','.join('?' * len(addrs))}) "
                                "AND (name IS NULL OR name='')", addrs).fetchall()
            for r in rows:
                name, tw = items[r["address"]]
                filled += conn.execute(
                    "UPDATE wallets SET name=?, twitter=CASE WHEN twitter IS NULL OR twitter='' THEN ? ELSE twitter END, updated_at=? "
                    "WHERE chain=? AND address=? AND (name IS NULL OR name='')", (name, tw, now, r["chain"], r["address"])).rowcount
            if filled:
                conn.commit()
        finally:
            conn.close()
    return filled


NAMES_MAX = 300
_names_stats: dict[str, Any] = {"calls": 0, "names": 0, "saved": 0, "notInLibOrNamed": 0, "skipped": {}, "lastAt": None, "lastSrc": ""}
NAMES_LOG = DATA_DIR / "logs" / "ext-site-names.jsonl"
_EXPORT_SHORT = {"内部", "同源", "捆绑", "狙击", "机器人", "金狗常客", "新钱包金狗", "卖在高点", "钻石手", "金狗卖飞",
                 "聪明钱", "GMGN聪明钱", "30天赚", "早期高盈利", "长抱大赚", "赚1K+"}
_EXPORT_BITS = ("最赚", "胜率", "平台盈亏", "GMGN总", "GMGN已实现", "pump总", "赚1K+", "捆")
_EXPORT_RE = re.compile(r"^(?:[SABCD]级|⚠|FOMO:|pump:)|^\d+天|^[赚赚]\$?\d+(?:\.\d+)?[KkMm]\+$")
_GENERIC = {"dev", "creator", "sniper", "insider", "bot", "kol", "whale", "smartmoney", "smart", "freshwallet", "fresh",
            "bundler", "bundle", "ratrader", "top", "holder", "trader", "unknown", "you", "me", "new",
            "聪明钱", "聪明钱", "狙击", "狙击", "狙击手", "狙击手", "内幕", "内幕", "老鼠仓", "老鼠仓", "巨鲸", "巨鲸", "鲸鱼", "鲸鱼",
            "开发者", "开发者", "新钱包", "新钱包", "捆绑", "捆绑", "机器人", "机器人", "庄家", "庄家", "我"}
_POOLISH = re.compile(r"pancake|uniswap|raydium|meteora|pumpswap|pump\.?fun|four\.?meme|liquidity|bonding|binance|bybit|bitget|"
                      r"kucoin|coinbase|gate\.?io|\b(?:orca|flap|pool|lp|router|vault|burn|dead|null|okx|htx|mexc|gate|"
                      r"migration|treasury|multisig|bridge)\b|资金池|资金池|流动池|流动池|交易所", re.I)
_ZW = re.compile(r"[\u200b-\u200d\u2060\ufeff]")
_BURNISH = re.compile(r"^(?:0x0{8,}[0-9a-f]*|1{32})$")


def _flat(text: Any) -> str:
    return re.sub(r"[\s_]+", "", str(text)).lower()


_RULE_NAMES = {_flat(x) for r in getattr(wl, "RULES", []) for x in (r.get("id", ""), r.get("label", "")) if x}


def _site_name(raw: Any, address: str) -> tuple[str, str]:
    name = _ZW.split(str(raw or ""))[0]
    name = re.sub(r"\s+", " ", name).strip()[:40]
    if not name:
        return "", "空的"
    if any(ord(ch) < 32 or 0x7f <= ord(ch) < 0xa0 for ch in name):
        return "", "控制字符"
    try:
        name.encode("utf-8")
    except UnicodeEncodeError:
        return "", "半个字符"
    low = name.lower()
    bare = re.sub(r"[\s.…_\-]+", "", low)
    if wl.FULL_ADDRESS.fullmatch(name) or any(s in name for s in _ADDRISH) or (len(bare) >= 4 and bare in address.lower()):
        return "", "像地址"
    if re.fullmatch(r"0x[0-9a-f]{2,}", bare) or re.fullmatch(r"(?=.*\d)[\d.,%$kmb+\-]+", low):
        return "", "像地址或数字"
    if ("/" in name or _EXPORT_RE.search(name) or name.lstrip("⚠") in _EXPORT_SHORT or any(b in name for b in _EXPORT_BITS)
            or _flat(name.lstrip("⚠")) in _RULE_NAMES):
        return "", "像自己导出的备注"
    if re.sub(r"[\s_]+", "", low) in _GENERIC:
        return "", "网站通用标签"
    if _POOLISH.search(name):
        return "", "像池子或交易所"
    return name, ""


def names(payload: dict[str, Any]) -> dict[str, Any]:
    key, _spec_ = _spec(payload.get("chain"))
    src = re.sub(r"[^A-Za-z0-9.]", "", str(payload.get("src") or ""))[:16] or "site"
    ca = _addr(payload.get("ca"))
    raw = payload.get("names")
    if not isinstance(raw, dict):
        raise ValueError("names 要是 {地址: 名字}")
    items: dict[str, str] = {}
    skipped: dict[str, int] = {}
    for a, n in list(raw.items())[:NAMES_MAX]:
        address = _addr(a)
        if not _valid(key, address):
            skipped["地址不对"] = skipped.get("地址不对", 0) + 1
            continue
        if _BURNISH.match(address):
            skipped["烧毁或系统地址"] = skipped.get("烧毁或系统地址", 0) + 1
            continue
        name, why = _site_name(n, address)
        if why:
            skipped[why] = skipped.get(why, 0) + 1
            continue
        items[address] = name
    saved: dict[str, str] = {}
    filled = 0
    if items:
        now = int(time.time())
        with wl.LOCK:
            conn = wl.connect()
            try:
                addrs = list(items)
                rows = conn.execute(f"SELECT chain, address, auto_labels, manual_labels FROM wallets WHERE address IN "
                                    f"({','.join('?' * len(addrs))}) AND (name IS NULL OR name='')", addrs).fetchall()
                for r in rows:
                    name = items[r["address"]]
                    own = {_flat(x) for x in wl.loads(r["manual_labels"]) + wl.loads(r["auto_labels"])}
                    if _flat(name) in own:
                        skipped["是自己的标签"] = skipped.get("是自己的标签", 0) + 1
                        continue
                    n = conn.execute("UPDATE wallets SET name=?, updated_at=? WHERE chain=? AND address=? AND (name IS NULL OR name='')",
                                     (name, now, r["chain"], r["address"])).rowcount
                    if n:
                        filled += n
                        saved[r["address"]] = name
                if filled:
                    conn.commit()
            finally:
                conn.close()
        if saved:
            try:
                NAMES_LOG.parent.mkdir(parents=True, exist_ok=True)
                with NAMES_LOG.open("a", encoding="utf-8") as f:
                    for a, n in saved.items():
                        f.write(json.dumps({"at": now, "src": src, "chain": key, "ca": ca, "address": a, "name": n}, ensure_ascii=False) + "\n")
            except OSError:
                pass
    with _lock:
        st = _names_stats
        st["calls"] += 1
        st["names"] += min(len(raw), NAMES_MAX)
        st["saved"] += len(saved)
        st["notInLibOrNamed"] += max(0, len(items) - len(saved) - skipped.get("是自己的标签", 0))
        for k, v in skipped.items():
            st["skipped"][k] = st["skipped"].get(k, 0) + v
        st["lastAt"] = int(time.time())
        st["lastSrc"] = src
    return {"ok": True, "version": VERSION, "saved": saved, "rows": filled, "skipped": skipped}


def token(payload: dict[str, Any], fetch_holders: Callable[[str, str], Any] | None) -> dict[str, Any]:
    key, spec = _spec(payload.get("chain"))
    ca = _addr(payload.get("ca"))
    if not _valid(key, ca):
        raise ValueError("CA 格式不正确")
    page = [a for a in (_addr(x) for x in list(payload.get("addresses") or [])[:MAX_ADDRESSES]) if _valid(key, a) or wl.FULL_ADDRESS.fullmatch(a)]
    holders: list[dict[str, Any]] = []
    hmeta: dict[str, Any] = {"ok": False, "skipped": True}
    if payload.get("holders", True) is not False and fetch_holders is not None:
        holders, hmeta = _holders_for(spec[0], ca, fetch_holders, payload.get("refresh") is True)
    if holders and hmeta.get("ok") and not hmeta.get("cached"):
        try:
            hmeta["namesSaved"] = _persist_holder_names(holders)
        except Exception as exc:
            hmeta["namesError"] = str(exc)[:120]
    conn = _connect()
    try:
        info, ctx = _describe(conn, key, spec, ca, [*(h["address"] for h in holders), *page, *_known(conn, spec, ca)])
        signals = _signal_rows(conn, f"SELECT {SIGNAL_COLS} FROM sm_signal_log WHERE chain=? AND ca=? ORDER BY at DESC LIMIT 8",
                               (spec[1], ca)) if spec[1] and "sm_signal_log" in _tables(conn) else []
        smtok = _sm_token(conn, spec[1], ca)
    finally:
        conn.close()
    top = {h["address"] for h in holders}
    hits_top = [h for h in holders if h["address"] in info and not h["pool"]]
    apps, trades = ctx["apps"], ctx["trades"]

    def order(a: str) -> tuple[Any, ...]:
        w = info[a]
        app = apps.get(a)
        return (not (app is not None and app["still_holding"]), not w["avoid"] and not w["follow"], -(w["trade"] or {}).get("buy", 0))
    others = sorted((a for a in info if a not in top), key=order)
    token_row = ctx["token"]
    symbol = (token_row["symbol"] if token_row is not None else "") or (smtok or {}).get("symbol") or (signals[0]["symbol"] if signals else "")
    sm_wallets = [a for a, t in trades.items() if a in info and (info[a]["sm"] or {}).get("watch")]
    return {
        "ok": True, "version": VERSION, "chain": key, "ca": ca, "symbol": symbol,
        "holders": [{**h, "hit": h["address"] in info} for h in holders], "holdersMeta": hmeta,
        "wallets": info, "others": others[:120],
        "summary": {
            "top": len(hits_top), "avoid": sum(info[h["address"]]["avoid"] for h in hits_top),
            "follow": sum(info[h["address"]]["follow"] for h in hits_top),
            "platform": sum(bool(info[h["address"]]["platforms"]) for h in hits_top),
            "smart": sum(bool((info[h["address"]]["sm"] or {}).get("watch")) for h in hits_top),
            "libForCa": len(apps), "others": len(others),
        },
        "smFlow": {"wallets": len(sm_wallets), "buy": round(sum(trades[a]["buy"] for a in sm_wallets), 2),
                   "sell": round(sum(trades[a]["sell"] for a in sm_wallets), 2),
                   "last": max((trades[a]["last"] for a in sm_wallets), default=None)},
        "signals": signals, "market": smtok,
        "tokenInfo": {"athMc": _num(token_row["ath_mc"]), "launchTs": token_row["launch_ts"], "writtenAt": token_row["written_at"]}
        if token_row is not None else None,
        "useLabels": wl.USE_LABEL, "groups": wl.LABEL_GROUPS, "now": int(time.time()),
        "note": "标签是钱包整体的，可能来自别颗币；资金关联只代表相关，不代表同一个主人。",
    }


def _known(conn: sqlite3.Connection, spec: tuple[str, str, tuple[str, ...]], ca: str) -> list[str]:
    return [r[0] for r in conn.execute("SELECT address FROM appearances WHERE chain=? AND ca=?", (spec[2][0], ca))]


def lookup(payload: dict[str, Any]) -> dict[str, Any]:
    key, spec = _spec(payload.get("chain"))
    ca = _addr(payload.get("ca"))
    if ca and not _valid(key, ca):
        ca = ""
    addresses = [a for a in (_addr(x) for x in list(payload.get("addresses") or [])[:MAX_ADDRESSES]) if wl.FULL_ADDRESS.fullmatch(a)]
    if not addresses:
        return {"ok": True, "version": VERSION, "items": {}, "now": int(time.time())}
    conn = _connect()
    try:
        info, _ctx = _describe(conn, key, spec, ca, addresses)
    finally:
        conn.close()
    wanted = set(addresses)
    return {"ok": True, "version": VERSION, "chain": key, "ca": ca, "items": {a: v for a, v in info.items() if a in wanted},
            "now": int(time.time())}


def signals(payload: dict[str, Any]) -> dict[str, Any]:
    hours = max(1, min(int(_num(payload.get("hours")) or SIGNAL_HOURS), 48))
    chain = ALIASES.get(str(payload.get("chain") or "").lower(), "")
    sm_chain = CHAINS[chain][1] if chain else ""
    since = int(time.time()) - hours * 3600
    conn = _connect()
    try:
        if "sm_signal_log" not in _tables(conn):
            return {"ok": True, "items": [], "hours": hours}
        rows = _signal_rows(conn, f"SELECT {SIGNAL_COLS} FROM sm_signal_log WHERE at>=?" + (" AND chain=?" if sm_chain else "") + " ORDER BY at DESC LIMIT 400",
                            (since, sm_chain) if sm_chain else (since,))
        groups: dict[tuple[str, str], dict[str, Any]] = {}
        for r in rows:
            g = groups.get((r["chain"], r["ca"]))
            if g is None:
                groups[(r["chain"], r["ca"])] = {**r, "first": r["at"], "count": 1}
                continue
            g["count"] += 1
            g["first"] = min(g["first"], r["at"])
            if STRENGTH_RANK.get(r["strength"], 0) > STRENGTH_RANK.get(g["strength"], 0):
                g["strength"] = r["strength"]
        items = list(groups.values())
        for g in items:
            g["market"] = _sm_token(conn, g["chain"], g["ca"])
        libcount: dict[tuple[str, str], int] = {}
        for g in items:
            lib_chain = wl.SM_CHAIN.get(g["chain"], "")
            if lib_chain:
                libcount[(g["chain"], g["ca"])] = conn.execute("SELECT COUNT(*) FROM appearances WHERE chain=? AND ca=?", (lib_chain, g["ca"])).fetchone()[0]
    finally:
        conn.close()
    for g in items:
        g["lib"] = libcount.get((g["chain"], g["ca"]), 0)
    items.sort(key=lambda g: (-(g["lastSeen"] or g["at"]), -STRENGTH_RANK.get(g["strength"], 0)))
    return {"ok": True, "version": VERSION, "hours": hours, "items": items[:60], "now": int(time.time())}


def _forget() -> None:
    with _lock:
        for key in ("cards", "quiet", "follows"):
            _cache.pop(key, None)


def _target(payload: dict[str, Any]) -> tuple[str, tuple[str, str, tuple[str, ...]], str, str]:
    key, spec = _spec(payload.get("chain"))
    address = _addr(payload.get("address"))
    if not (wl.FULL_ADDRESS.fullmatch(address) and (address.startswith("0x") and len(address) == 42 or not address.startswith("0x"))):
        raise ValueError("钱包地址格式不正确")
    ca = _addr(payload.get("ca"))
    if ca and not _valid(key, ca):
        ca = ""
    return key, spec, address, ca


def _fresh(key: str, spec: tuple[str, str, tuple[str, ...]], ca: str, address: str) -> dict[str, Any] | None:
    _forget()
    conn = _connect()
    try:
        info, _ctx = _describe(conn, key, spec, ca, [address])
    finally:
        conn.close()
    return info.get(address)


def tag(payload: dict[str, Any]) -> dict[str, Any]:
    key, spec, address, ca = _target(payload)
    label = str(payload.get("label") or "").strip()[:40]
    if not label or any(ord(ch) < 32 for ch in label):
        raise ValueError("标签是空的")
    on = payload.get("on") is not False
    chain = "Solana" if not address.startswith("0x") else ("Robinhood" if key == "robinhood" else "BSC")
    now = int(time.time())
    created = False
    with wl.LOCK:
        conn = wl.connect()
        try:
            rows = wl._rows_for(conn, chain, address)
            if not rows:
                if not on:
                    raise ValueError("钱包库没有这个地址，这个标签不是钱包库的（机器人名单的请到本机服务钱包库处理）")
                created = wl._ensure_wallet(conn, chain, address, now)
                rows = wl._rows_for(conn, chain, address)
            auto = any(label in wl.loads(r["auto_labels"]) for r in rows)
            manual = [x for x in wl.loads(rows[0]["manual_labels"]) if x != label]
            removed = [x for x in wl.loads(rows[0]["removed_labels"]) if x != label]
            if on and not auto:
                if len(manual) >= 20:
                    raise ValueError("这个钱包的手动标签已经 20 个了，先拿掉一些")
                manual.append(label)
            if not on and (auto or label in ("bot", "hft")):
                removed.append(label)
            for r in rows:
                conn.execute("UPDATE wallets SET manual_labels=?, removed_labels=?, updated_at=? WHERE chain=? AND address=?",
                             (json.dumps(manual, ensure_ascii=False), json.dumps(removed[-40:], ensure_ascii=False), now, r["chain"], address))
            conn.commit()
        finally:
            conn.close()
    return {"ok": True, "version": VERSION, "address": address, "label": label, "on": on, "created": created,
            "item": _fresh(key, spec, ca, address)}


def star(payload: dict[str, Any]) -> dict[str, Any]:
    import smart_money
    key, spec, address, ca = _target(payload)
    on = payload.get("on") is not False
    sm_chain = "sol" if not address.startswith("0x") else (spec[1] or "bsc")
    smart_money.set_watch({"chain": sm_chain, "address": address, "watch": 1 if on else 0})
    return {"ok": True, "version": VERSION, "address": address, "on": on, "item": _fresh(key, spec, ca, address)}


def ping() -> dict[str, Any]:
    with _lock:
        names_stats = json.loads(json.dumps(_names_stats))
    import smart_money
    return {"ok": True, "service": "wallet-ext", "version": VERSION, "now": int(time.time()), "names": names_stats,
            "pumpHot": smart_money.pump_feed_status()}


def handle(path: str, payload: dict[str, Any], fetch_holders: Callable[[str, str], Any] | None = None) -> dict[str, Any]:
    if path == "/api/ext/token":
        return token(payload, fetch_holders)
    if path == "/api/ext/lookup":
        return lookup(payload)
    if path == "/api/ext/signals":
        return signals(payload)
    if path == "/api/ext/tag":
        return tag(payload)
    if path == "/api/ext/star":
        return star(payload)
    if path == "/api/ext/names":
        return names(payload)
    if path in ("/api/ext/pump-hot", "/api/ext/pump-hot-want"):
        import smart_money
        return smart_money.pump_feed_put(payload) if path == "/api/ext/pump-hot" else smart_money.pump_feed_want(payload)
    raise ValueError("找不到此 API")
