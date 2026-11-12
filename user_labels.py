from __future__ import annotations

import json
import re
import time
from typing import Any

import wallet_library as wl

SCHEMA = """
CREATE TABLE IF NOT EXISTS user_labels (
  address TEXT PRIMARY KEY, family TEXT, raw_label TEXT, group_key TEXT, suspected INTEGER DEFAULT 0,
  roles TEXT DEFAULT '[]', own INTEGER DEFAULT 0, source TEXT DEFAULT 'user private label', imported_at INTEGER
);
"""
EVM_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
SOL_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
STRAY = " \t\r\n\\]['\"`,;，、"
GROUPS = [
    (r"[捆捆][绑绑]集团", "捆绑集团"),
    (r"金狗\s*\d*", None),
    (r"恶", "恶"),
]
ROLE_WORDS = [("小号", "alt"), ("中转", "relay"), ("内幕", "insider"), ("阴谋", "dealer"), ("庄", "dealer"),
              ("FOMO", "fomo"), ("高营利", "high_profit"), ("高盈利", "high_profit"), ("捆", "bundle"), ("捆", "bundle"), ("绑", "bundle")]
OWN_RE = re.compile(r"^(我|我的.*)$")


def ensure(conn) -> None:
    conn.executescript(SCHEMA)


def family_of(address: str) -> str:
    return "EVM" if EVM_RE.match(address) else "SOL" if SOL_RE.match(address) else ""


def normalize_label(raw: str) -> dict[str, Any]:
    label = raw.strip(STRAY)
    own = bool(OWN_RE.match(label))
    suspected = "疑似" in label
    group = ""
    for pattern, key in GROUPS:
        m = re.search(pattern, label, re.I)
        if m:
            group = key or re.sub(r"\s+", "", m.group(0))
            break
    if not group and not own:
        group = re.sub(r"^疑似", "", label)
        group = re.sub(r"(小号|中转|小|的)$", "", group) or label
    roles = sorted({r for w, r in ROLE_WORDS if w.lower() in label.lower()} | ({"alt"} if re.search(r"小$", label) and "alt" not in label else set()) | ({"own"} if own else set()))
    return {"label": label, "group": "我" if own else group, "suspected": suspected, "roles": roles, "own": own}


def parse(text: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows, invalid = [], []
    for n, line in enumerate(str(text or "").splitlines(), 1):
        if not line.strip():
            continue
        parts = re.split(r"\t|,(?=\S)|\s{2,}", line.strip(), maxsplit=1)
        if len(parts) < 2:
            parts = line.strip().split(None, 1)
        address = parts[0].strip(STRAY)
        raw = parts[1] if len(parts) > 1 else ""
        fam = family_of(address)
        if not fam or not raw.strip(STRAY):
            invalid.append({"line": n, "text": line.strip()[:120], "reason": "地址格式不对" if not fam else "缺标签"})
            continue
        rows.append({"address": address.lower() if fam == "EVM" else address, "family": fam, "raw": raw.strip(STRAY), **normalize_label(raw)})
    return rows, invalid


def import_text(payload: dict[str, Any]) -> dict[str, Any]:
    rows, invalid = parse(payload.get("text") or "")
    seen: dict[str, dict[str, Any]] = {}
    dupes, conflicts = [], []
    for r in rows:
        prev = seen.get(r["address"])
        if prev:
            if prev["label"] == r["label"]:
                dupes.append(r["address"])
            else:
                conflicts.append({"address": r["address"], "labels": [prev["label"], r["label"]]})
                prev["label"] = f"{prev['label']} / {r['label']}"
                prev["roles"] = sorted(set(prev["roles"]) | set(r["roles"]))
                prev["own"] = prev["own"] or r["own"]
            continue
        seen[r["address"]] = dict(r)
    now = int(time.time())
    with wl.LOCK:
        conn = wl.connect()
        try:
            ensure(conn)
            if payload.get("replace"):
                conn.execute("DELETE FROM user_labels WHERE source<>?", (wl.REVIEW_SOURCE,))
            for r in seen.values():
                conn.execute("INSERT OR REPLACE INTO user_labels VALUES (?,?,?,?,?,?,?,?,?)",
                             (r["address"], r["family"], r["label"], r["group"], int(r["suspected"]), json.dumps(r["roles"], ensure_ascii=False), int(r["own"]), "user private label", now))
            conn.commit()
            total = conn.execute("SELECT COUNT(*) FROM user_labels").fetchone()[0]
        finally:
            conn.close()
    groups: dict[str, int] = {}
    for r in seen.values():
        groups[r["group"]] = groups.get(r["group"], 0) + 1
    return {"ok": True, "parsed": len(rows), "imported": len(seen), "evm": sum(r["family"] == "EVM" for r in seen.values()),
            "sol": sum(r["family"] == "SOL" for r in seen.values()), "own": sum(r["own"] for r in seen.values()),
            "suspected": sum(r["suspected"] for r in seen.values()), "duplicates": dupes, "conflicts": conflicts,
            "invalid": invalid, "groups": dict(sorted(groups.items(), key=lambda kv: -kv[1])), "totalInLibrary": total}


def _row(r) -> dict[str, Any]:
    return {"address": r["address"], "family": r["family"], "label": r["raw_label"], "group": r["group_key"], "suspected": bool(r["suspected"]),
            "roles": json.loads(r["roles"] or "[]"), "own": bool(r["own"]), "source": r["source"]}


def lookup_many(addresses: list[str]) -> dict[str, dict[str, Any]]:
    keys = list({wl.norm("", a) for a in addresses if a})
    if not keys:
        return {}
    with wl.LOCK:
        conn = wl.connect()
        try:
            ensure(conn)
            out = {}
            for i in range(0, len(keys), 500):
                chunk = keys[i:i + 500]
                for r in conn.execute(f"SELECT * FROM user_labels WHERE address IN ({','.join('?' * len(chunk))})", chunk):
                    out[r["address"]] = _row(r)
            return out
        finally:
            conn.close()


def lookup(payload: dict[str, Any]) -> dict[str, Any]:
    return {"ok": True, "labels": lookup_many(list(payload.get("addresses") or [])[:2000])}


def export(_payload: dict[str, Any] | None = None) -> dict[str, Any]:
    with wl.LOCK:
        conn = wl.connect()
        try:
            ensure(conn)
            rows = [_row(r) for r in conn.execute("SELECT * FROM user_labels ORDER BY group_key, address")]
        finally:
            conn.close()
    return {"ok": True, "private": True, "rows": rows, "tsv": "\n".join(f"{r['address']}\t{r['label']}" for r in rows)}
