
from __future__ import annotations

import gzip
import json
import math
import os
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any
from oss_config import DATA_DIR, cfg

DB_PATH = DATA_DIR / "wallet-library.sqlite3"
ARCHIVE_DIR = DATA_DIR / "library-archive"
LOCK = threading.Lock()

PROFIT_USD = cfg('PROFIT_USD', 2000)
LONG_PNL_USD = cfg('LONG_PNL_USD', 10000)
EARLY_PROFIT_SECONDS = cfg('EARLY_PROFIT_SECONDS', 900)
EARLY_PROFIT_USD = cfg('EARLY_PROFIT_USD', 8000)
EARLY_PROFIT_ROI = cfg('EARLY_PROFIT_ROI', 300)
PNL_TIERS = (3000, 5000, 10000, 30000, 50000, 100000, 200000, 500000, 1000000)


def tier_money(value: int) -> str:
    return f"${value // 1_000_000}M" if value >= 1_000_000 else f"${value // 1000}K"


def tier_id(value: int) -> str:
    return "pnl_" + tier_money(value)[1:].lower()


TIER_IDS = {tier_id(v) for v in PNL_TIERS}
QUIET_PNL_USD = cfg('QUIET_PNL_USD', 2000)
QUIET_TEXT = f"${QUIET_PNL_USD // 1000}K"
EARLY_SECONDS = cfg('EARLY_SECONDS', 3600)
GOLD_X = cfg('GOLD_X', 8)
GOLD_MC_USD = cfg('GOLD_MC_USD', 2000000)
FRESH_DAYS = cfg('FRESH_DAYS', 10)
PAPER_SOLD = cfg('PAPER_SOLD', 0.85)
PAPER_X = cfg('PAPER_X', 4)
TOP_SELL_RATIO = cfg('TOP_SELL_RATIO', 0.6)
DIAMOND_SOLD_MAX = cfg('DIAMOND_SOLD_MAX', 0.4)
GOLD_REGULAR_MIN = cfg('GOLD_REGULAR_MIN', 3)
DEV_TAGS = {"creator", "dev_team"}
BOT_TAGS = {"sandwich_bot", "wash_trader", "arbitrager"}
INSIDER_TAGS = {"creator", "dev_team", "insider", "rat_trader"}
BOT_TRADES_30D = cfg('BOT_TRADES_30D', 5000)
BOT_TOKENS_30D = cfg('BOT_TOKENS_30D', 1500)
BOT_STRONG_TRADES_30D = 15_000
BOT_CHECK_PER_ROUND = 60
BOT_MAX_TRIES = 3
BOT_RULE = (f"GMGN 30 天买卖 ≥{BOT_TRADES_30D:,} 笔、"
            f"或 30 天交易 ≥{BOT_TOKENS_30D:,} 颗币（高频）；GMGN 的夹子／刷量／套利标签不准，不单独算。机器人不进钱包库：CA 扫描不写进来，已在库里的先封存再移除、记进机器人名单以后也不再收；"
            f"FOMO／pump.fun 用户一定留、一定导出（就算交易很频繁，标签会写机器人）；"
            f"你标过的（手动标签、备注、私人标签、确认相关、聪明钱追踪中）留着但标成机器人、不导出；你把机器人标签移掉的就不当机器人。"
            f"BSC／Robinhood 同一个 0x 地址任一边是机器人就整个算")
BOT_TIER_RULE = (f"分两级：买进后不到 5 秒就卖（秒卖，聪明钱动态算的）或 30 天买卖 ≥{BOT_STRONG_TRADES_30D:,} 笔（约每 3 分钟一笔、24 小时不停）标「机器人」（要避开）；"
                 f"其他 30 天买卖 ≥{BOT_TRADES_30D:,} 笔或交易 ≥{BOT_TOKENS_30D:,} 颗币的标「高频交易」（参考，常是用交易终端、自动止盈的真人）。"
                 f"进不进钱包库、汇不导出两种一样：")
GOLD_RULE =(f"「早买金狗」＝币创建后 {EARLY_SECONDS // 60} 分钟内开始持有，这颗币历史最高价 ≥ 他平均买价 {GOLD_X} 倍、"
             f"最高市值 ≥ ${GOLD_MC_USD:,}，而且 GMGN 没标开发者（creator／dev_team）或机器人（sandwich_bot／wash_trader／arbitrager）")

LABEL_GROUPS: list[dict[str, str]] = [
    {"id": "follow", "label": "高手", "note": "看他动作，不照买：赚钱、早买金狗、出场好的钱包"},
    {"id": "avoid", "label": "要避开", "note": "庄家、捆绑、狙击、机器人：前排有它们要小心"},
    {"id": "ref", "label": "参考", "note": "身分或持仓特征，本身不代表好坏"},
]
RULES: list[dict[str, str]] = [
    {"id": "gold_regular", "group": "follow", "label": "金狗常客", "rule": f"在 ≥{GOLD_REGULAR_MIN} 颗不同的币都「早买金狗」。{GOLD_RULE}"},
    {"id": "fresh_gold", "group": "follow", "label": "新钱包早买金狗",
     "rule": f"早买金狗，而且开始持有时钱包第一次入金不到 {FRESH_DAYS} 天（或 GMGN 标 fresh_wallet）。{GOLD_RULE}"},
    {"id": "top_seller", "group": "follow", "label": "卖在高点",
     "rule": f"早买金狗，已卖出 ≥ {DIAMOND_SOLD_MAX:.0%}（查 CA 的纪录看已不持有），平均卖价的市值 ≥ 这颗币最高市值的 {TOP_SELL_RATIO:.0%}。{GOLD_RULE}"},
    {"id": "diamond", "group": "follow", "label": "钻石手",
     "rule": f"早买金狗，现在还持有、卖出 ≤ {DIAMOND_SOLD_MAX:.0%}（查 CA 的纪录看还没卖过），或 GMGN 标 diamond_hands；GMGN 标 paper_hands 的不算。{GOLD_RULE}"},
    {"id": "paper_gold", "group": "follow", "label": "早买金狗但卖飞",
     "rule": f"早买金狗，已卖出 ≥ {PAPER_SOLD:.0%}（或 GMGN 标 paper_hands），而且历史最高价 ≥ 他平均卖价 {PAPER_X} 倍。"
             f"没有最高点的时间，抱过高点才卖低的也会算进来。{GOLD_RULE}"},
    {"id": "smart_money", "group": "follow", "label": "聪明钱", "rule": "在 ≥2 个不同 CA 都符合「早期高盈利」"},
    {"id": "gmgn_smart", "group": "follow", "label": "GMGN 聪明钱", "rule": "GMGN 标 smart_degen（GMGN 算法判定，没公布门槛）"},
    {"id": "long_pnl", "group": "follow", "label": "长期获利", "rule": f"GMGN 30 天已实现盈利 ≥ ${LONG_PNL_USD:,}（快到清理日、不到 {QUIET_TEXT} 的钱包会自动补查）"},
    {"id": "early_profit", "group": "follow", "label": "早期高盈利", "rule": f"开盘后 {EARLY_PROFIT_SECONDS // 60} 分钟内进场，且该 CA 总盈利 ≥ ${EARLY_PROFIT_USD:,} 或 ROI ≥ {EARLY_PROFIT_ROI}%"},
    {"id": "long_hold_big", "group": "follow", "label": "长抱大赚", "rule": "持有 ≥ 24 小时，且该 CA 总盈利 ≥ $10,000"},
    *[{"id": tier_id(v), "group": "follow", "label": f"赚{tier_money(v)}+",
       "rule": f"总体盈利 ≥ {tier_money(v)}（跟清理用同一个数字：库里每颗币盈亏加总、GMGN 30 天已实现、GMGN 历史总盈利、平台战绩取最高，"
               f"BSC、RH 合起来或任一条链单独都算；pump.fun 用户算过帐号总盈亏的以它为准）。只标最高一级"} for v in reversed(PNL_TIERS)],
    {"id": "insider", "group": "avoid", "label": "疑似庄家/内部", "rule": "GMGN 该币标签含 creator / dev_team / insider / rat_trader，或开盘后 60 秒内进场且持仓 ≥ 5%"},
    {"id": "bundle_member", "group": "avoid", "label": "捆绑成员（同源资金）", "rule": "在某 CA 中，与至少 1 个其他早期地址由同一个非交易所地址提供主币／USD 稳定币"},
    {"id": "sniper", "group": "avoid", "label": "狙击手", "rule": "GMGN 标 sniper（开池后最早几个区块买入；还没卖就是卖压）"},
    {"id": "bot", "group": "avoid", "label": "机器人", "rule": BOT_TIER_RULE + BOT_RULE},
    {"id": "hft", "group": "ref", "label": "高频交易", "rule": BOT_TIER_RULE + BOT_RULE},
    {"id": "kol", "group": "ref", "label": "KOL", "rule": "GMGN 回传 twitter_username，或 GMGN 标签含 kol / renowned"},
    {"id": "fomo_user", "group": "ref", "label": "FOMO 用户", "rule": "某 CA 的 GMGN 前 100 持仓中，持有数量与 FOMO 帐号相差 ≤1 颗，且只对上这一个地址"},
    {"id": "pump_user", "group": "ref", "label": "pump.fun 用户", "rule": "某 CA 的 GMGN 前 100 持仓中，持有数量与 pump.fun 帐号相差 ≤1 颗，且只对上这一个地址"},
    {"id": "whale", "group": "ref", "label": "巨鲸", "rule": "GMGN 标 whale（GMGN 没公布门槛）；只有这个标签不算信号"},
    {"id": "top_holder", "group": "ref", "label": "前排大户", "rule": "GMGN 标 top_holder（持有比例高）；只有这个标签不算信号"},
    {"id": "bluechip", "group": "ref", "label": "蓝筹持有者", "rule": "GMGN 标 bluechip_owner（持有成熟蓝筹币）；只有这个标签不算信号"},
    {"id": "transfer_in", "group": "ref", "label": "转入", "rule": "GMGN 标 transfer_in（这颗币有转入纪录，不一定是买的）；只有这个标签不算信号"},
]
RULE_LABELS = {rule["id"]: rule["label"] for rule in RULES}
LABEL_GROUP = {rule["id"]: rule["group"] for rule in RULES}
FLAGGED = {"insider", "bundle_member", "early_profit", "smart_money", "long_hold_big", "long_pnl", "fresh_gold", "paper_gold",
           "gold_regular", "top_seller", "diamond"}
HIDDEN_LABELS = {"gmgn_bundler", "profit_1k"}
TAG_LABELS = {"smart_degen": "gmgn_smart", "sniper": "sniper", "kol": "kol", "renowned": "kol",
              "whale": "whale", "top_holder": "top_holder", "bluechip_owner": "bluechip", "transfer_in": "transfer_in",
              **{tag: "insider" for tag in INSIDER_TAGS}}
PLATFORM_LABEL = {"FOMO": "fomo_user", "pump.fun": "pump_user"}
LIB_CHAIN = {"bsc": "BSC", "bnb": "BSC", "sol": "Solana", "solana": "Solana", "robinhood": "Robinhood"}
GMGN_SLUG = {"BSC": "bsc", "Solana": "sol", "Robinhood": "robinhood", "ETH": "eth", "Base": "base"}
PLATFORM_SOURCE = "GMGN 前 100 持仓"
WRITER_SCAN, WRITER_PLATFORM = "CA 扫描", "平台比对"
QUIET_SINCE = cfg('QUIET_SINCE', 0)
PRUNE_AFTER_DAYS = cfg('PRUNE_AFTER_DAYS', 14)
PRUNE_HOUR = 4
STATS_BEFORE_DAYS = 2
STATS_MAX_TRIES = 3
TOKEN_REFRESH_SECONDS = 12 * 3600
TOKEN_REFRESH_DAYS = 30
PF_REFRESH_DAYS = 7
PF_PER_ROUND = 10
PF_MAX_TRIES = 3
PLAT_REFRESH_SECONDS = 6 * 3600
PLAT_CAS_PER_ROUND = 6
PUMP_SYNC_STALE_HOURS = 72
PUMP_SYNC_RETRY_HOURS = 24
PUMP_BLOCK_SECONDS = 24 * 3600
PLAT_ACCT_RULE = ("pump.fun 帐号总盈亏＝pump.fun 自己算的每颗交易过的币盈亏加总（含还没卖的帐面）；"
                  "在 pump.fun 页按「盈利」书签时更新；照钱包地址查 pump.fun 帐号，帐号改过名的照收，钱包库记的名称更正成 pump.fun 现在的名称")
PLAT_RULE = "平台用户的盈亏以 FOMO／pump.fun 自己算的为准；平台没给时，只有 GMGN 没标 transfer_in（转入）才用 GMGN 的数字"
LABELS_VERSION = "1"
KEEP_LABELS = {"insider", "bundle_member", "sniper", "fomo_user", "pump_user", "gold_regular", "fresh_gold", "top_seller", "diamond", "paper_gold"}
KEEP_GMGN_TAGS = {"sniper", *INSIDER_TAGS}
QUIET_RULE = (f"总体盈利不到 ${QUIET_PNL_USD:,} 就不留：库里每颗币的盈亏加总、FOMO／pump.fun 平台战绩、GMGN 30 天已实现盈利、GMGN 历史总盈利（按「更新盈亏」查过的），四个都不到 ${QUIET_PNL_USD:,}"
              f"（同一个 0x 地址在 BSC、Robinhood 合起来算；任一条链单独达标也算，另一条链的亏损不会拖累）。"
              f"例外照样留：你标过的（手动标签、移除过的标签、备注、私人标签、确认相关）、聪明钱追踪中、有名字的（KOL／推特／网站名字）、"
              f"要避开的（疑似庄家/内部、捆绑成员、狙击手）、FOMO／pump.fun 用户、早买金狗那几条。"
              f"这种钱包预设隐藏；进库满 {PRUNE_AFTER_DAYS} 天、查过 GMGN 30 天统计还是不到 ${QUIET_PNL_USD:,}，"
              f"每天 {PRUNE_HOUR:02d}:00 后先封存再删，可以还原。资金关联纪录另外存着，不会跟着删。")
FULL_ADDRESS = re.compile(r"^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS wallets (
  chain TEXT NOT NULL, address TEXT NOT NULL,
  name TEXT DEFAULT '', twitter TEXT DEFAULT '',
  auto_labels TEXT DEFAULT '[]', manual_labels TEXT DEFAULT '[]', removed_labels TEXT DEFAULT '[]',
  note TEXT DEFAULT '', first_seen INTEGER, updated_at INTEGER,
  PRIMARY KEY (chain, address)
);
CREATE TABLE IF NOT EXISTS appearances (
  chain TEXT NOT NULL, address TEXT NOT NULL, ca TEXT NOT NULL, symbol TEXT DEFAULT '',
  queried_at INTEGER, open_ts INTEGER, entry_ts INTEGER, elapsed INTEGER,
  buy_mc REAL, sell_mc REAL, hold_seconds INTEGER, still_holding INTEGER,
  buy_usd REAL, sell_usd REAL, realized REAL, unrealized REAL, total REAL, roi REAL, holding_pct REAL,
  early_rank INTEGER, top_profit_rank INTEGER, gmgn_tags TEXT DEFAULT '[]', cluster TEXT DEFAULT '',
  source TEXT DEFAULT '',
  PRIMARY KEY (chain, address, ca)
);
CREATE TABLE IF NOT EXISTS relations (
  chain TEXT NOT NULL, src TEXT NOT NULL, dst TEXT NOT NULL, rel_type TEXT NOT NULL, ca TEXT NOT NULL DEFAULT '',
  evidence TEXT DEFAULT '', provider TEXT DEFAULT '', tx_hash TEXT DEFAULT '', asset TEXT DEFAULT '', amount REAL, ts INTEGER,
  src_label TEXT DEFAULT '', public_entity INTEGER DEFAULT 0,
  PRIMARY KEY (chain, src, dst, rel_type, ca)
);
CREATE TABLE IF NOT EXISTS service_wallets (
  chain TEXT NOT NULL, address TEXT NOT NULL, service INTEGER DEFAULT 0, sent INTEGER, span_h REAL, note TEXT DEFAULT '',
  checked_at INTEGER, PRIMARY KEY (chain, address)
);
CREATE TABLE IF NOT EXISTS spoof_addresses (
  chain TEXT NOT NULL, address TEXT NOT NULL, mimics TEXT DEFAULT '', victim TEXT DEFAULT '', reason TEXT DEFAULT '',
  found_at INTEGER, PRIMARY KEY (chain, address)
);
CREATE TABLE IF NOT EXISTS tokens (
  chain TEXT NOT NULL, ca TEXT NOT NULL, symbol TEXT DEFAULT '', open_ts INTEGER, queried_at INTEGER, data_note TEXT DEFAULT '',
  PRIMARY KEY (chain, ca)
);
CREATE TABLE IF NOT EXISTS platform_names (
  chain TEXT NOT NULL, address TEXT NOT NULL, platform TEXT NOT NULL, handle TEXT NOT NULL,
  x TEXT DEFAULT '', followers INTEGER, verified INTEGER, cas TEXT DEFAULT '[]', first_seen INTEGER, last_seen INTEGER,
  PRIMARY KEY (chain, address, platform, handle)
);
CREATE TABLE IF NOT EXISTS lib_state (key TEXT PRIMARY KEY, value TEXT);
-- 机器人名单（BOT_RULE）：移出钱包库的机器人记在这里，之后 CA 扫描不再写进来
CREATE TABLE IF NOT EXISTS bot_wallets (
  chain TEXT NOT NULL, address TEXT NOT NULL, reason TEXT DEFAULT '', at INTEGER,
  PRIMARY KEY (chain, address)
);
-- 手动「清理」删掉的钱包：绑平台名字时不会自动加回钱包库；从封存文件还原就移出这份名单
CREATE TABLE IF NOT EXISTS lib_removed (
  chain TEXT NOT NULL, address TEXT NOT NULL, at INTEGER, archive TEXT DEFAULT '',
  PRIMARY KEY (chain, address)
);
CREATE TABLE IF NOT EXISTS link_reviews (
  chain TEXT NOT NULL, address TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL, label TEXT DEFAULT '',
  verdict TEXT NOT NULL, tag TEXT DEFAULT '', at INTEGER,
  PRIMARY KEY (chain, address, target)
);
-- 平台帐号总盈亏（PLAT_ACCT_RULE）：at＝最近一次算成功、tried＝最近一次尝试、note＝最近一次失败的原因（成功就清空）
CREATE TABLE IF NOT EXISTS plat_accounts (
  chain TEXT NOT NULL, address TEXT NOT NULL, platform TEXT NOT NULL,
  handle TEXT DEFAULT '', wallet TEXT DEFAULT '', total REAL, realized REAL, cost REAL, coins INTEGER, wins INTEGER, untrusted INTEGER,
  trades INTEGER, since INTEGER, partial INTEGER DEFAULT 0, at INTEGER, tried INTEGER, note TEXT DEFAULT '',
  PRIMARY KEY (chain, address, platform)
);
-- FOMO 排行榜上的盈利：FOMO 自己算的，照名字（小写）记，24h／7d／30d／all 各一笔、新的盖旧的；导出时照 FOMO 名字对到钱包
CREATE TABLE IF NOT EXISTS fomo_board_pnl (
  handle TEXT NOT NULL, period TEXT NOT NULL, pnl REAL, rank INTEGER, field TEXT DEFAULT '', at INTEGER,
  PRIMARY KEY (handle, period)
);
CREATE INDEX IF NOT EXISTS idx_rel_src ON relations(chain, src);
CREATE INDEX IF NOT EXISTS idx_rel_dst ON relations(chain, dst);
CREATE INDEX IF NOT EXISTS idx_app_ca ON appearances(chain, ca);
-- BSC 和 Robinhood 都是 EVM，同一个 0x 地址是同一个钱包：新进库的一边如果还没有你的标注，就带上另一边的手动标签／移除的自动标签／备注
CREATE TRIGGER IF NOT EXISTS wallets_evm_share_notes_v1 AFTER INSERT ON wallets
WHEN NEW.chain IN ('BSC', 'Robinhood') AND COALESCE(NEW.manual_labels, '[]') IN ('', '[]')
     AND COALESCE(NEW.removed_labels, '[]') IN ('', '[]') AND COALESCE(NEW.note, '') = ''
BEGIN
  UPDATE wallets SET
    manual_labels = (SELECT s.manual_labels FROM wallets s WHERE s.address = NEW.address AND s.chain IN ('BSC', 'Robinhood') AND s.chain <> NEW.chain),
    removed_labels = (SELECT s.removed_labels FROM wallets s WHERE s.address = NEW.address AND s.chain IN ('BSC', 'Robinhood') AND s.chain <> NEW.chain),
    note = (SELECT s.note FROM wallets s WHERE s.address = NEW.address AND s.chain IN ('BSC', 'Robinhood') AND s.chain <> NEW.chain)
  WHERE chain = NEW.chain AND address = NEW.address
    AND EXISTS (SELECT 1 FROM wallets s WHERE s.address = NEW.address AND s.chain IN ('BSC', 'Robinhood') AND s.chain <> NEW.chain
                AND (COALESCE(s.manual_labels, '[]') NOT IN ('', '[]') OR COALESCE(s.removed_labels, '[]') NOT IN ('', '[]') OR COALESCE(s.note, '') <> ''));
END;
"""


def norm(chain: str, address: str) -> str:
    text = str(address or "").strip()
    return text.lower() if text.startswith("0x") else text


MIGRATIONS: dict[str, dict[str, str]] = {
    "wallets": {"gmgn_tags": "TEXT DEFAULT '[]'", "created_at": "INTEGER", "pnl30_realized": "REAL", "pnl30_winrate": "REAL",
                "pnl30_tokens": "INTEGER", "pnl30_at": "INTEGER", "pnl30_tries": "INTEGER DEFAULT 0", "pnl30_note": "TEXT DEFAULT ''",
                "pf_total": "REAL", "pf_realized": "REAL", "pf_buys": "INTEGER", "pf_sells": "INTEGER", "pf_best_symbol": "TEXT DEFAULT ''",
                "pf_best_ca": "TEXT DEFAULT ''", "pf_best_profit": "REAL", "pf_at": "INTEGER", "pf_tries": "INTEGER DEFAULT 0", "pf_note": "TEXT DEFAULT ''",
                "pnl30_buys": "INTEGER", "pnl30_sells": "INTEGER", "bot_tries": "INTEGER DEFAULT 0",
                "pnl30_raw": "TEXT DEFAULT ''",
                "gm_total": "REAL", "gm_realized": "REAL", "gm_buys": "INTEGER", "gm_sells": "INTEGER", "gm_at": "INTEGER", "gm_note": "TEXT DEFAULT ''"},
    "appearances": {"sold_pct": "REAL", "plat_pnl": "REAL", "plat_realized": "REAL", "plat_cost": "REAL",
                    "plat_src": "TEXT DEFAULT ''", "plat_at": "INTEGER"},
    "tokens": {"ath_mc": "REAL", "launch_ts": "INTEGER", "supply": "REAL", "info_at": "INTEGER", "backfill_at": "INTEGER",
               "written_at": "INTEGER", "written_by": "TEXT DEFAULT ''"},
}


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    for table, columns in MIGRATIONS.items():
        have = {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        for column, decl in columns.items():
            if column not in have:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
    return conn


def num(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def loads(text: Any) -> list[str]:
    try:
        value = json.loads(text or "[]")
        return value if isinstance(value, list) else []
    except json.JSONDecodeError:
        return []


def gmgn_sees_trades(app: sqlite3.Row | dict[str, Any]) -> bool:
    return "transfer_in" not in {str(tag).lower() for tag in loads(app["gmgn_tags"])}


def platform_app(app: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    d = dict(app)
    plat = num(d.get("plat_pnl"))
    if plat is not None:
        cost = num(d.get("plat_cost"))
        d["total"], d["roi"] = plat, (plat / cost * 100 if cost else None)
    elif not gmgn_sees_trades(d):
        d["total"] = d["roi"] = None
    return d


def gmgn_overall_ok(pf_buys: Any, apps: list[Any]) -> bool:
    return (pf_buys is None or (num(pf_buys) or 0) > 0) and all(gmgn_sees_trades(app) for app in apps)


def same_wallet_sql(t: str) -> str:
    return (f"p.chain IN ({t}.chain, CASE {t}.chain WHEN 'BSC' THEN 'Robinhood' WHEN 'Robinhood' THEN 'BSC' ELSE {t}.chain END) "
            f"AND p.address={t}.address")


EFFECTIVE_TOTAL_SQL = ("CASE WHEN EXISTS (SELECT 1 FROM platform_names p WHERE " + same_wallet_sql("a") + ") "
                       "THEN COALESCE(a.plat_pnl, CASE WHEN instr(lower(COALESCE(a.gmgn_tags,'')), '\"transfer_in\"')>0 THEN NULL ELSE a.total END) "
                       "ELSE a.total END")


def appearance_flags(app: sqlite3.Row | dict[str, Any]) -> set[str]:
    flags: set[str] = set()
    elapsed, total, roi = num(app["elapsed"]), num(app["total"]), num(app["roi"])
    hold, pct = num(app["hold_seconds"]), num(app["holding_pct"])
    tags = {str(tag).lower() for tag in loads(app["gmgn_tags"])}
    if elapsed is not None and 0 <= elapsed <= EARLY_PROFIT_SECONDS and ((total or 0) >= EARLY_PROFIT_USD or (roi or 0) >= EARLY_PROFIT_ROI):
        flags.add("early_profit")
    if hold is not None and hold >= 86400 and (total or 0) >= 10000:
        flags.add("long_hold_big")
    flags |= {TAG_LABELS[tag] for tag in tags if tag in TAG_LABELS}
    if elapsed is not None and 0 <= elapsed <= 60 and (pct or 0) >= 5:
        flags.add("insider")
    if app["cluster"]:
        flags.add("bundle_member")
    return flags


def is_early_gold(app: sqlite3.Row | dict[str, Any], token: sqlite3.Row | dict[str, Any] | None) -> bool:
    if token is None:
        return False
    ath_mc, buy_mc = num(token["ath_mc"]), num(app["buy_mc"])
    if not ath_mc or ath_mc < GOLD_MC_USD or not buy_mc or ath_mc < buy_mc * GOLD_X:
        return False
    entry, launch = num(app["entry_ts"]), num(token["launch_ts"])
    elapsed = entry - launch if entry and launch else num(app["elapsed"])
    if elapsed is None or not -60 <= elapsed <= EARLY_SECONDS:
        return False
    return not {str(tag).lower() for tag in loads(app["gmgn_tags"])} & (DEV_TAGS | BOT_TAGS)


def gold_flags(app: sqlite3.Row | dict[str, Any], token: sqlite3.Row | dict[str, Any] | None, wallet_created: Any = None) -> set[str]:
    if not is_early_gold(app, token):
        return set()
    ath_mc, entry = num(token["ath_mc"]), num(app["entry_ts"])
    tags = {str(tag).lower() for tag in loads(app["gmgn_tags"])}
    flags: set[str] = set()
    created = num(wallet_created)
    if "fresh_wallet" in tags or (created and entry and 0 <= entry - created <= FRESH_DAYS * 86400):
        flags.add("fresh_gold")
    sold, sell_mc, holding = num(app["sold_pct"]), num(app["sell_mc"]), bool(app["still_holding"])
    sold_out = "paper_hands" in tags or (sold is not None and sold >= PAPER_SOLD) or (sold is None and not holding)
    if sold_out and sell_mc and ath_mc >= sell_mc * PAPER_X:
        flags.add("paper_gold")
    sold_half = (sold is not None and sold >= DIAMOND_SOLD_MAX) or (sold is None and not holding)
    if sold_half and sell_mc and sell_mc >= ath_mc * TOP_SELL_RATIO:
        flags.add("top_seller")
    kept = (sold is not None and sold <= DIAMOND_SOLD_MAX) or (sold is None and not num(app["sell_usd"])) or "diamond_hands" in tags
    if holding and kept and "paper_hands" not in tags:
        flags.add("diamond")
    return flags


def token_rows(conn: sqlite3.Connection, chain: str, cas: list[str]) -> dict[str, sqlite3.Row]:
    if not cas:
        return {}
    return {r["ca"]: r for r in conn.execute(f"SELECT * FROM tokens WHERE chain=? AND ca IN ({','.join('?' * len(cas))})", (chain, *cas))}


SM_CHAIN = {slug: chain for chain, slug in GMGN_SLUG.items()}


def bot_reason(tags: Any, trades: Any, tokens: Any) -> str:
    trades, tokens = num(trades), num(tokens)
    if trades is not None and trades >= BOT_TRADES_30D:
        return f"30 天买卖 {int(trades):,} 笔"
    if tokens is not None and tokens >= BOT_TOKENS_30D:
        return f"30 天交易 {int(tokens):,} 颗币"
    return ""


def bot_tier(reason: str, flip: bool = False) -> str:
    if flip or "秒卖" in str(reason or ""):
        return "bot"
    if not reason:
        return ""
    m = re.search(r"买卖 ([\d,]+) 笔", str(reason))
    return "bot" if m and int(m.group(1).replace(",", "")) >= BOT_STRONG_TRADES_30D else "hft"


def flip_wallets(conn: sqlite3.Connection) -> set[str]:
    try:
        import smart_money
        return {norm(SM_CHAIN.get(c, "BSC"), a) for c, a in smart_money._fast_flip_set(conn)}
    except Exception:
        return set()


def stats_raw(stats: Any) -> str:
    if not isinstance(stats, dict):
        return ""
    keep: dict[str, Any] = {k: v for k, v in stats.items() if isinstance(v, (int, float, str)) and k not in ("wallet_address", "address")}
    pnl = stats.get("pnl_stat")
    if isinstance(pnl, dict):
        keep["pnl_stat"] = {k: v for k, v in pnl.items() if isinstance(v, (int, float, str))}
    common = stats.get("common")
    if isinstance(common, dict) and common.get("created_token_count") is not None:
        keep["created_token_count"] = common.get("created_token_count")
    return json.dumps(keep, ensure_ascii=False, separators=(",", ":"))


def _has_table(conn: sqlite3.Connection, name: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def sm_activity(conn: sqlite3.Connection, chain: str = "", address: str = "") -> dict[tuple[str, str], tuple[int, int]]:
    if not _has_table(conn, "sm_wallets") or not {"stats", "scored_at"} <= {r[1] for r in conn.execute("PRAGMA table_info(sm_wallets)")}:
        return {}
    sql, args = "SELECT chain, address, stats FROM sm_wallets WHERE scored_at IS NOT NULL", []
    if chain or address:
        if chain not in GMGN_SLUG:
            return {}
        sql += " AND chain=? AND address=?"
        args += [GMGN_SLUG[chain], address]
    out: dict[tuple[str, str], tuple[int, int]] = {}
    for r in conn.execute(sql, args):
        lib = SM_CHAIN.get(r[0])
        try:
            st = json.loads(r[2] or "{}")
        except (TypeError, json.JSONDecodeError):
            continue
        if not lib or not isinstance(st, dict) or "buys" not in st:
            continue
        out[(lib, norm(lib, r[1]))] = (int(num(st.get("buys")) or 0) + int(num(st.get("sells")) or 0), int(num(st.get("tokens")) or 0))
    return out


def wallet_activity(row: sqlite3.Row | dict[str, Any] | None, sm: tuple[int, int] | None) -> tuple[float | None, float | None]:
    trades = tokens = None
    if row is not None:
        buys, sells = num(row["pnl30_buys"]), num(row["pnl30_sells"])
        trades = buys + sells if buys is not None and sells is not None else None
        tokens = num(row["pnl30_tokens"])
    if sm:
        trades, tokens = max(trades or 0, sm[0]), max(tokens or 0, sm[1])
    return trades, tokens


def bot_wallets_now(conn: sqlite3.Connection, sm: dict[tuple[str, str], tuple[int, int]] | None = None) -> dict[tuple[str, str], str]:
    sm = sm_activity(conn) if sm is None else sm
    members: dict[str, list[tuple[str, str]]] = {}
    reasons: dict[str, str] = {}
    cleared: set[str] = set()
    for r in conn.execute("SELECT chain, address, gmgn_tags, removed_labels, pnl30_buys, pnl30_sells, pnl30_tokens FROM wallets"):
        key = (r["chain"], r["address"])
        group = norm(*key)
        members.setdefault(group, []).append(key)
        if {"bot", "hft"} & set(loads(r["removed_labels"])):
            cleared.add(group)
            continue
        reason = bot_reason((), *wallet_activity(r, sm.get(key)))
        if reason and group not in reasons:
            reasons[group] = f"{r['chain']} {reason}"
    return {key: reasons[group] for group, keys in members.items() if group in reasons and group not in cleared for key in keys}


def user_marked(conn: sqlite3.Connection) -> set[str]:
    marked = {norm(r[0], r[1]) for r in conn.execute("SELECT chain, address, manual_labels, removed_labels, note FROM wallets")
              if loads(r[2]) or loads(r[3]) or str(r[4] or "").strip()}
    marked |= {norm(r[0], r[1]) for r in conn.execute("SELECT chain, address FROM link_reviews WHERE verdict='yes'")}
    if _has_table(conn, "user_labels"):
        marked |= {norm("", r[0]) for r in conn.execute("SELECT address FROM user_labels")}
    if _has_table(conn, "sm_wallets"):
        marked |= {norm(r[0], r[1]) for r in conn.execute("SELECT chain, address FROM sm_wallets WHERE watch=1")}
    return marked


BOT_LIST_ACTIVE = "reason NOT LIKE '%GMGN 标%'"


def bot_keep(conn: sqlite3.Connection) -> set[str]:
    return user_marked(conn) | {norm(r[0], r[1]) for r in conn.execute("SELECT chain, address FROM platform_names")}


def bot_blocklist(conn: sqlite3.Connection) -> set[str]:
    return {norm(r[0], r[1]) for r in conn.execute(f"SELECT chain, address FROM bot_wallets WHERE {BOT_LIST_ACTIVE}")}


def _bot_pending(conn: sqlite3.Connection, quiet: dict[tuple[str, str], int | None], sm: dict[tuple[str, str], tuple[int, int]],
                 bots: dict[tuple[str, str], str]) -> list[tuple[str, str, int, int]]:
    plats = {norm(r[0], r[1]) for r in conn.execute("SELECT chain, address FROM platform_names")}
    out = []
    for r in conn.execute("SELECT w.*, (SELECT COUNT(*) FROM appearances a WHERE a.chain=w.chain AND a.address=w.address) AS ca_count "
                          "FROM wallets w WHERE w.pnl30_buys IS NULL AND COALESCE(w.bot_tries,0) < ?", (BOT_MAX_TRIES,)):
        key = (r["chain"], r["address"])
        if r["chain"] not in GMGN_SLUG or key in bots or key in sm or norm(*key) in plats:
            continue
        groups = {LABEL_GROUP.get(label) for label in effective_labels(r) if label != "gmgn_bundler"}
        if key not in quiet and groups & {"follow", "avoid"}:
            out.append((r["chain"], r["address"], r["bot_tries"] or 0, r["ca_count"], key not in quiet and "follow" in groups))
    out.sort(key=lambda item: (not item[4], -item[3], item[0], item[1]))
    return [item[:4] for item in out]


def bot_status(conn: sqlite3.Connection, quiet: dict[tuple[str, str], int | None] | None = None) -> dict[str, Any]:
    quiet = quiet_wallets(conn) if quiet is None else quiet
    sm = sm_activity(conn)
    bots = bot_wallets_now(conn, sm)
    plats = {norm(r[0], r[1]) for r in conn.execute("SELECT chain, address FROM platform_names")}
    kept_platform = sum(norm(*key) in plats for key in bots)
    return {"rule": BOT_RULE, "removed": conn.execute(f"SELECT COUNT(*) FROM bot_wallets WHERE {BOT_LIST_ACTIVE}").fetchone()[0],
            "kept": len(bots) - kept_platform, "keptPlatform": kept_platform,
            "pending": len(_bot_pending(conn, quiet, sm, bots)), "perRound": BOT_CHECK_PER_ROUND,
            "last": _state_get(conn, "bots:last"), "error": _state_get(conn, "bots:error")}


FOLLOW_DAYS = 30
FOLLOW_DELAY = 60
FOLLOW_WITHIN = 1800
FOLLOW_HOLD_MAX = 86400
FOLLOW_COST = cfg('FOLLOW_COST', 0.03)
FOLLOW_MIN_N = cfg('FOLLOW_MIN_N', 8)
FOLLOW_REFRESH_SECONDS = 6 * 3600
HIGH_FREQ_TRADES = cfg('HIGH_FREQ_TRADES', 1500)
USE_AVOID = ("insider", "bundle_member", "sniper", "bot")
USE_EXIT = ("top_seller",)
USE_CONFIRM = ("gold_regular", "fresh_gold", "top_seller", "diamond", "paper_gold", "smart_money", "early_profit", "gmgn_smart")
USE_LABEL = {"avoid": "避开", "exit": "看出场", "confirm": "看进场只当确认", "ref": "参考"}
CARD_RULE = (
    "实力＝他自己赚不赚，不代表跟了会赚。等级 S～D 照 GMGN 30 天统计打分，跟聪明钱页同一套（30 天实现盈利、资金报酬、抓到 2 倍以上的比例、"
    "胜率、少有大亏、样本数；自己发币、机器人、小额、样本太少会扣分）；在聪明钱名单里评过分的用那份，不然用钱包库补查的，两份都有取比较新的。"
    ""
    f"跟单纪录只算聪明钱名单（追踪中）里的钱包：最近 {FOLLOW_DAYS} 天他每颗币第一次买进后 {FOLLOW_DELAY} 秒、照名单钱包的下一笔成交价进场，"
    f"他第一次卖出后 {FOLLOW_DELAY} 秒出场（{FOLLOW_WITHIN // 60} 分钟内没成交就用他的卖价打 8 折；24 小时都没卖就用那时的价），每笔扣 {FOLLOW_COST:.0%}；"
    f"满 {FOLLOW_MIN_N} 笔才显示，每 {FOLLOW_REFRESH_SECONDS // 3600} 小时重算。"
    "用途：避开＝有疑似庄家／捆绑成员／狙击手／机器人标签；看出场＝卖在高点；"
    "看进场只当确认＝S／A 级，或有金狗类、聪明钱、早期高盈利、GMGN 聪明钱标签（有避开的就不算）；其他是参考。")


def card_use(labels: Any, grade: str) -> list[str]:
    have = set(labels or [])
    out: list[str] = []
    if have & set(USE_AVOID):
        out.append("avoid")
    if have & set(USE_EXIT):
        out.append("exit")
    if "avoid" not in out and (grade in ("S", "A") or have & set(USE_CONFIRM)):
        out.append("confirm")
    return out or ["ref"]


def sm_cards(conn: sqlite3.Connection) -> dict[tuple[str, str], dict[str, Any]]:
    if not _has_table(conn, "sm_wallets"):
        return {}
    cols = {r[1] for r in conn.execute("PRAGMA table_info(sm_wallets)")}
    if not {"watch", "score", "grade", "style", "stats", "scored_at"} <= cols:
        return {}
    out: dict[tuple[str, str], dict[str, Any]] = {}
    for r in conn.execute("SELECT chain, address, watch, score, grade, style, stats, scored_at FROM sm_wallets"):
        lib = SM_CHAIN.get(r[0])
        if not lib:
            continue
        try:
            stats = json.loads(r[6] or "{}")
        except (TypeError, json.JSONDecodeError):
            stats = {}
        out[(lib, norm(lib, r[1]))] = {"watch": bool(r[2]), "score": r[3], "grade": (r[4] or "") if r[7] else "", "style": loads(r[5]),
                                       "stats": stats if isinstance(stats, dict) else {}, "at": r[7], "smChain": r[0], "smAddress": r[1]}
    return out


def raw_score(raw: Any) -> dict[str, Any] | None:
    try:
        st = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(st, dict) or not st:
        return None
    import smart_money
    result = smart_money.compute_score({**st, "common": {"created_token_count": st.get("created_token_count")}})
    return {"score": result["score"], "grade": result["grade"], "style": result["style"], "stats": result["stats"]}


def wallet_card(row: sqlite3.Row | dict[str, Any], labels: Any, sm: dict[str, Any] | None, follow: dict[str, Any] | None) -> dict[str, Any]:
    keys = row.keys() if hasattr(row, "keys") else []
    raw = row["pnl30_raw"] if "pnl30_raw" in keys else ""
    raw_at = num(row["pnl30_at"]) if raw else None
    sm_at = num(sm.get("at")) if sm and sm.get("grade") else None
    base, src, at = None, "", None
    if sm_at is not None and (raw_at is None or sm_at >= raw_at):
        base, src, at = sm, "聪明钱评分", sm_at
    elif raw_at is not None:
        base, src, at = raw_score(raw), "钱包库补查", raw_at
    card: dict[str, Any] = {"grade": "", "score": None, "style": [], "src": "", "at": None, "realized": None, "winrate": None,
                            "tokens": None, "trades": None, "gt5": None, "big": None, "deepLoss": None, "avgHold": None, "lastTs": None}
    if base:
        st = base.get("stats") or {}
        buys, sells = num(st.get("buys")), num(st.get("sells"))
        card.update(grade=base.get("grade") or "", score=base.get("score"), style=list(base.get("style") or []), src=src,
                    at=int(at) if at else None, realized=num(st.get("realized")), winrate=num(st.get("winrate")), tokens=num(st.get("tokens")),
                    trades=buys + sells if buys is not None and sells is not None else None, gt5=num(st.get("gt5")), big=num(st.get("bigWins")),
                    deepLoss=num(st.get("deepLoss")), avgHold=num(st.get("avgHold")), lastTs=num(st.get("lastTs")) or None)
    elif "pnl30_buys" in keys:
        buys, sells = num(row["pnl30_buys"]), num(row["pnl30_sells"])
        card.update(trades=buys + sells if buys is not None and sells is not None else None, tokens=num(row["pnl30_tokens"]),
                    realized=num(row["pnl30_realized"]), winrate=num(row["pnl30_winrate"]))
    card["follow"] = follow
    card["watch"] = bool(sm and sm.get("watch"))
    card["use"] = card_use(labels, card["grade"])
    return card


def follow_index(conn: sqlite3.Connection) -> dict[tuple[str, str], dict[str, Any]]:
    state = _state_get(conn, "follow:records") or {}
    out: dict[tuple[str, str], dict[str, Any]] = {}
    for key, rec in (state.get("records") or {}).items():
        chain, _, address = str(key).partition("|")
        if chain and address and isinstance(rec, dict):
            out[(chain, address)] = rec | {"at": state.get("at")}
    return out


def compute_follow_records(conn: sqlite3.Connection, now: int) -> dict[str, dict[str, Any]]:
    import bisect
    import statistics
    lib_keys = {(r[0], norm(r[0], r[1])) for r in conn.execute("SELECT chain, address FROM wallets")}
    makers: dict[str, dict[str, tuple[str, str]]] = {}
    for key, info in sm_cards(conn).items():
        if info["watch"] and key in lib_keys:
            makers.setdefault(info["smChain"], {})[info["smAddress"]] = key
    tables = [t for t in ("sm_trades", "sm_trades_archive") if _has_table(conn, t)]
    since = now - FOLLOW_DAYS * 86400
    results: dict[tuple[str, str], list[tuple[float, float, int]]] = {}
    for sm_chain, who in makers.items():
        mine: dict[tuple[str, str], list[tuple[int, str, float]]] = {}
        seen: set[tuple[Any, ...]] = set()
        marks = ",".join("?" * len(who))
        for t in tables:
            for r in conn.execute(f"SELECT tx, maker, token, side, ts, price FROM {t} WHERE chain=? AND ts>=? AND price>0 AND maker IN ({marks})",
                                  (sm_chain, since, *who)):
                sig = (r[0], r[1], r[2], r[3])
                if sig not in seen:
                    seen.add(sig)
                    mine.setdefault((r[1], r[2]), []).append((r[4], r[3], r[5]))
        tokens = sorted({token for _, token in mine})
        series: dict[str, tuple[list[int], list[float]]] = {}
        for i in range(0, len(tokens), 400):
            part = tokens[i:i + 400]
            rows: list[tuple[str, int, float]] = []
            for t in tables:
                rows += conn.execute(f"SELECT token, ts, price FROM {t} WHERE chain=? AND ts>=? AND price>0 AND token IN ({','.join('?' * len(part))})",
                                     (sm_chain, since, *part)).fetchall()
            rows.sort(key=lambda x: (x[0], x[1]))
            for token, ts, price in rows:
                s = series.setdefault(token, ([], []))
                s[0].append(ts)
                s[1].append(price)

        def next_price(token: str, ts: float) -> float | None:
            ts_list, px = series.get(token, ([], []))
            i = bisect.bisect_left(ts_list, ts)
            return px[i] if i < len(ts_list) and ts_list[i] <= ts + FOLLOW_WITHIN else None

        def last_price(token: str, upto: float) -> float | None:
            ts_list, px = series.get(token, ([], []))
            i = bisect.bisect_right(ts_list, upto) - 1
            return px[i] if i >= 0 else None

        for (maker, token), trades in mine.items():
            trades.sort()
            buys = [x for x in trades if x[1] == "buy"]
            if not buys:
                continue
            b_ts, _, b_px = buys[0]
            sells = [x for x in trades if x[1] == "sell" and b_ts < x[0] <= b_ts + FOLLOW_HOLD_MAX]
            if not sells and now - b_ts < FOLLOW_HOLD_MAX:
                continue
            ein = next_price(token, b_ts + FOLLOW_DELAY)
            if not ein:
                continue
            if sells:
                own = sells[0][2]
                out = next_price(token, sells[0][0] + FOLLOW_DELAY) or own * 0.8
            else:
                own = out = last_price(token, b_ts + FOLLOW_HOLD_MAX)
            if not own or not out:
                continue
            results.setdefault(who[maker], []).append((max(out / ein - 1, -1) - FOLLOW_COST, max(own / b_px - 1, -1) - FOLLOW_COST, b_ts))
    records: dict[str, dict[str, Any]] = {}
    for (chain, address), rows in results.items():
        follow = [x[0] for x in rows]
        records[f"{chain}|{address}"] = {"n": len(rows), "follow": round(statistics.mean(follow), 4), "med": round(statistics.median(follow), 4),
                                         "own": round(statistics.mean(x[1] for x in rows), 4), "win": round(sum(x > 0 for x in follow) / len(rows), 4),
                                         "from": min(x[2] for x in rows), "to": max(x[2] for x in rows)}
    return records


def refresh_follow_records(now: float | None = None, force: bool = False) -> dict[str, Any]:
    now = int(time.time() if now is None else now)
    with LOCK:
        conn = connect()
        try:
            last = _state_get(conn, "follow:records") or {}
        finally:
            conn.close()
    if not force and now - int(last.get("at") or 0) < FOLLOW_REFRESH_SECONDS:
        return {"skipped": True, "at": last.get("at")}
    started = time.time()
    conn = connect()
    try:
        records = compute_follow_records(conn, now)
    finally:
        conn.close()
    with LOCK:
        conn = connect()
        try:
            _state_put(conn, "follow:records", {"at": now, "days": FOLLOW_DAYS, "minN": FOLLOW_MIN_N, "records": records})
            conn.commit()
        finally:
            conn.close()
    return {"wallets": len(records), "enough": sum(r["n"] >= FOLLOW_MIN_N for r in records.values()), "at": now,
            "seconds": round(time.time() - started, 1)}


def recompute_labels(conn: sqlite3.Connection, chain: str, address: str, sibling: bool = True) -> list[str]:
    apps = conn.execute("SELECT * FROM appearances WHERE chain=? AND address=?", (chain, address)).fetchall()
    row = conn.execute("SELECT twitter, gmgn_tags, created_at, pnl30_realized, pf_buys, pnl30_buys, pnl30_sells, pnl30_tokens, removed_labels FROM wallets "
                       "WHERE chain=? AND address=?", (chain, address)).fetchone()
    pchains = same_wallet_chains(chain)
    platforms = [prow["platform"] for prow in conn.execute(f"SELECT DISTINCT platform FROM platform_names WHERE chain IN ({','.join('?' * len(pchains))}) AND address=?",
                                                           (*pchains, address))]
    gmgn_ok = True
    if platforms:
        gmgn_ok = gmgn_overall_ok(row["pf_buys"] if row else None, apps)
        apps = [platform_app(app) for app in apps]
    tokens = token_rows(conn, chain, [app["ca"] for app in apps])
    labels: set[str] = set()
    early_profit_cas = gold_cas = 0
    for app in apps:
        token = tokens.get(app["ca"])
        flags = appearance_flags(app) | gold_flags(app, token, row["created_at"] if row else None)
        labels |= flags
        early_profit_cas += "early_profit" in flags
        gold_cas += is_early_gold(app, token)
    if early_profit_cas >= 2:
        labels.add("smart_money")
    if gold_cas >= GOLD_REGULAR_MIN:
        labels.add("gold_regular")
    if row and gmgn_ok and (num(row["pnl30_realized"]) or 0) >= LONG_PNL_USD:
        labels.add("long_pnl")
    if row and row["twitter"]:
        labels.add("kol")
    wtags = {str(tag).lower() for tag in loads(row["gmgn_tags"])} if row else set()
    labels |= {TAG_LABELS[tag] for tag in wtags if tag in TAG_LABELS}
    if row and not ({"bot", "hft"} & set(loads(row["removed_labels"]))):
        tier = bot_tier(bot_reason((), *wallet_activity(row, sm_activity(conn, chain, address).get((chain, address)))),
                        norm(chain, address) in flip_wallets(conn))
        if tier:
            labels.add(tier)
    for platform in platforms:
        labels.add(PLATFORM_LABEL.get(platform, ""))
    best, _src = wallet_best(conn, chain, address)
    tier = next((v for v in reversed(PNL_TIERS) if best is not None and best >= v), None)
    if tier:
        labels.add(tier_id(tier))
    ordered = [rule["id"] for rule in RULES if rule["id"] in labels]
    conn.execute("UPDATE wallets SET auto_labels=? WHERE chain=? AND address=?", (json.dumps(ordered), chain, address))
    if sibling and chain in EVM_CHAINS:
        for other in EVM_CHAINS:
            if other != chain and conn.execute("SELECT 1 FROM wallets WHERE chain=? AND address=?", (other, address)).fetchone():
                recompute_labels(conn, other, address, sibling=False)
    return ordered


def effective_labels(row: sqlite3.Row) -> list[str]:
    removed = set(loads(row["removed_labels"])) | HIDDEN_LABELS
    labels = [label for label in loads(row["auto_labels"]) if label not in removed]
    labels += [label for label in loads(row["manual_labels"]) if label not in labels]
    return labels


def wallet_summary(row: sqlite3.Row, platforms: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "chain": row["chain"], "address": row["address"], "name": row["name"], "twitter": row["twitter"],
        "autoLabels": [label for label in loads(row["auto_labels"]) if label not in HIDDEN_LABELS], "manualLabels": loads(row["manual_labels"]),
        "removedLabels": loads(row["removed_labels"]), "labels": effective_labels(row),
        "note": row["note"], "firstSeen": row["first_seen"], "updatedAt": row["updated_at"],
        "platforms": platforms or [],
        "pnl30": {"realized": row["pnl30_realized"], "winrate": row["pnl30_winrate"], "tokens": row["pnl30_tokens"],
                  "at": row["pnl30_at"], "note": row["pnl30_note"] or ""} if row["pnl30_at"] else None,
        "pf": {"total": row["pf_total"], "realized": row["pf_realized"], "buys": row["pf_buys"], "sells": row["pf_sells"],
               "bestSymbol": row["pf_best_symbol"] or "", "bestCa": row["pf_best_ca"] or "", "bestProfit": row["pf_best_profit"],
               "at": row["pf_at"], "note": row["pf_note"] or ""} if row["pf_at"] else None,
        "gm": {"total": row["gm_total"], "realized": row["gm_realized"], "buys": row["gm_buys"], "sells": row["gm_sells"],
               "at": row["gm_at"], "note": row["gm_note"] or ""} if "gm_at" in row.keys() and row["gm_at"] else None,
    }


def platform_index(conn: sqlite3.Connection, chain: str = "", address: str = "") -> dict[tuple[str, str], list[dict[str, Any]]]:
    sql, args = "SELECT * FROM platform_names WHERE 1=1", []
    if chain:
        chains = same_wallet_chains(chain)
        sql += f" AND chain IN ({','.join('?' * len(chains))})"; args += list(chains)
    if address:
        sql += " AND address=?"; args.append(address)
    out: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for r in conn.execute(sql + " ORDER BY last_seen DESC", args):
        item = {"platform": r["platform"], "handle": r["handle"], "x": r["x"], "followers": r["followers"],
                "verified": bool(r["verified"]), "cas": loads(r["cas"]), "firstSeen": r["first_seen"], "lastSeen": r["last_seen"]}
        for c in same_wallet_chains(r["chain"]):
            lst = out.setdefault((c, r["address"]), [])
            dup = next((p for p in lst if p["platform"] == item["platform"] and str(p["handle"]).lower() == str(item["handle"]).lower()), None)
            if dup is None:
                lst.append(dict(item, cas=list(item["cas"])))
                continue
            dup["cas"] += [ca for ca in item["cas"] if ca not in dup["cas"]]
            firsts = [v for v in (dup["firstSeen"], item["firstSeen"]) if v]
            dup["firstSeen"] = min(firsts) if firsts else None
            for k in ("x", "followers"):
                if dup[k] in (None, "") and item[k] not in (None, ""):
                    dup[k] = item[k]
    return out


def cross_match(conn: sqlite3.Connection, chain: str, ca: str, addresses: list[str], funders: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    repeat: list[dict[str, Any]] = []
    for address in addresses:
        apps = conn.execute("SELECT * FROM appearances WHERE chain=? AND address=? AND ca<>?", (chain, address, ca)).fetchall()
        hits = [dict(app) for app in apps if "early_profit" in appearance_flags(app)]
        if hits:
            row = conn.execute("SELECT * FROM wallets WHERE chain=? AND address=?", (chain, address)).fetchone()
            repeat.append({"address": address, "labels": effective_labels(row) if row else [], "name": row["name"] if row else "",
                           "twitter": row["twitter"] if row else "", "previous": hits})
    links: list[dict[str, Any]] = []
    for address, sources in funders.items():
        for source in sources:
            funder = source["src"]
            if relation_noise(conn, chain, funder, source.get("asset"), source.get("amount"), source.get("public_entity")):
                continue
            row = conn.execute("SELECT * FROM wallets WHERE chain=? AND address=?", (chain, funder)).fetchone()
            if row:
                flagged = [label for label in effective_labels(row) if label in FLAGGED or label not in RULE_LABELS]
                if flagged:
                    links.append({"address": address, "relation": "资金关联：上游资助者是库内标记地址", "linked": funder,
                                  "linkedLabels": flagged, "evidence": source.get("evidence", ""), "txHash": source.get("tx_hash", ""), "otherCas": []})
            siblings = [] if funder_fanout(conn, chain, funder) > FUNDER_MAX else conn.execute(
                f"SELECT r.dst, r.ca FROM relations r WHERE r.chain=? AND r.src=? AND r.rel_type='funding' AND r.ca<>? AND r.dst<>? AND {rel_counts_sql('r')}",
                (chain, funder, ca, address)).fetchall()
            for sib in siblings:
                srow = conn.execute("SELECT * FROM wallets WHERE chain=? AND address=?", (chain, sib["dst"])).fetchone()
                flagged = [label for label in effective_labels(srow) if label in FLAGGED or label not in RULE_LABELS] if srow else []
                if flagged:
                    links.append({"address": address, "relation": "资金关联：与库内标记地址共用同一上游资助者", "linked": sib["dst"],
                                  "via": funder, "linkedLabels": flagged, "evidence": source.get("evidence", ""),
                                  "txHash": source.get("tx_hash", ""), "otherCas": [sib["ca"]]})
    return {"repeatEarlyProfit": repeat, "fundingLinks": links,
            "note": "资金关联只代表链上有转帐或共同上游，不代表同一主人。"}


def ingest(payload: dict[str, Any]) -> dict[str, Any]:
    chain = str(payload.get("chain") or "").strip()
    ca = norm(chain, payload.get("ca"))
    if not chain or not ca:
        raise ValueError("钱包库写入缺少 chain 或 ca")
    now = int(time.time())
    wallets = payload.get("wallets") if isinstance(payload.get("wallets"), list) else []
    relations = payload.get("relations") if isinstance(payload.get("relations"), list) else []
    with LOCK:
        conn = connect()
        try:
            addresses = [norm(chain, w.get("address")) for w in wallets if w.get("address")]
            funders: dict[str, list[dict[str, Any]]] = {}
            for rel in relations:
                if rel.get("type") == "funding" and rel.get("src") and rel.get("dst"):
                    funders.setdefault(norm(chain, rel["dst"]), []).append({
                        "src": norm(chain, rel["src"]), "public_entity": bool(rel.get("publicEntity")),
                        "asset": str(rel.get("asset") or ""), "amount": num(rel.get("amount")),
                        "evidence": rel.get("evidence", ""), "tx_hash": rel.get("txHash", "")})
            match = cross_match(conn, chain, ca, addresses, funders)
            blocked, marked, sm = bot_blocklist(conn), bot_keep(conn), sm_activity(conn)
            skipped: dict[str, str] = {}
            for w in wallets:
                address = norm(chain, w.get("address"))
                if not address or address in skipped or norm(chain, address) in marked:
                    continue
                row = conn.execute("SELECT * FROM wallets WHERE chain=? AND address=?", (chain, address)).fetchone()
                if row is not None and {"bot", "hft"} & set(loads(row["removed_labels"])):
                    continue
                reason = ("在机器人名单" if norm(chain, address) in blocked
                          else bot_reason(w.get("gmgnTags"), *wallet_activity(row, sm.get((chain, address)))))
                if reason:
                    skipped[address] = reason
                    if row is None:
                        conn.execute("INSERT OR IGNORE INTO bot_wallets(chain, address, reason, at) VALUES (?,?,?,?)", (chain, address, reason, now))
            wallets = [w for w in wallets if norm(chain, w.get("address")) not in skipped]
            addresses = [address for address in addresses if address not in skipped]
            conn.execute("INSERT INTO tokens(chain, ca, symbol, open_ts, queried_at, data_note, written_at, written_by) VALUES (?,?,?,?,?,?,?,?) "
                         "ON CONFLICT(chain, ca) DO UPDATE SET symbol=excluded.symbol, open_ts=excluded.open_ts, queried_at=excluded.queried_at, data_note=excluded.data_note, "
                         "written_at=excluded.written_at, written_by=excluded.written_by",
                         (chain, ca, str(payload.get("symbol") or ""), num(payload.get("openTs")), now, str(payload.get("dataNote") or ""), now, WRITER_SCAN))
            for w in wallets:
                address = norm(chain, w.get("address"))
                if not address:
                    continue
                conn.execute("INSERT INTO wallets(chain, address, name, twitter, first_seen, updated_at) VALUES (?,?,?,?,?,?) "
                             "ON CONFLICT(chain, address) DO UPDATE SET name=COALESCE(NULLIF(excluded.name,''), wallets.name), "
                             "twitter=COALESCE(NULLIF(excluded.twitter,''), wallets.twitter), updated_at=excluded.updated_at",
                             (chain, address, str(w.get("name") or ""), str(w.get("twitter") or "").lstrip("@"), now, now))
                conn.execute("INSERT OR REPLACE INTO appearances(chain,address,ca,symbol,queried_at,open_ts,entry_ts,elapsed,buy_mc,sell_mc,hold_seconds,"
                             "still_holding,buy_usd,sell_usd,realized,unrealized,total,roi,holding_pct,early_rank,top_profit_rank,gmgn_tags,cluster,source) "
                             "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                    chain, address, ca, str(payload.get("symbol") or ""), now, num(payload.get("openTs")), num(w.get("entryTs")),
                    num(w.get("elapsed")), num(w.get("buyMc")), num(w.get("sellMc")), num(w.get("holdSeconds")),
                    1 if w.get("stillHolding") else 0, num(w.get("buyUsd")), num(w.get("sellUsd")), num(w.get("realized")),
                    num(w.get("unrealized")), num(w.get("total")), num(w.get("roi")), num(w.get("holdingPct")),
                    num(w.get("earlyRank")), num(w.get("topProfitRank")), json.dumps([str(t) for t in (w.get("gmgnTags") or [])]),
                    str(w.get("cluster") or ""), str(w.get("source") or "")))
            for rel in relations:
                src, dst = norm(chain, rel.get("src")), norm(chain, rel.get("dst"))
                if not src or not dst or src == dst:
                    continue
                conn.execute("INSERT OR REPLACE INTO relations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                    chain, src, dst, str(rel.get("type") or "funding"), ca, str(rel.get("evidence") or ""),
                    str(rel.get("provider") or ""), str(rel.get("txHash") or ""), str(rel.get("asset") or ""),
                    num(rel.get("amount")), num(rel.get("ts")), str(rel.get("srcLabel") or ""), 1 if rel.get("publicEntity") else 0))
            for address in set(addresses):
                recompute_labels(conn, chain, address)
            refresh_spoofs(conn, now)
            conn.commit()
            total = conn.execute("SELECT COUNT(*) FROM wallets").fetchone()[0]
        finally:
            conn.close()
    return {"ok": True, "stored": len(addresses), "skippedBots": len(skipped), "relations": len(relations), "libraryWallets": total, "match": match}


MULTI_CA_LABELS = {"smart_money": "early_profit", "gold_regular": "gold"}


def token_here(app: sqlite3.Row, token: sqlite3.Row | None, plats: list[dict[str, Any]], created_at: Any, labels: list[str], ca: str) -> dict[str, Any]:
    eff = platform_app(app) if plats else app
    flags = appearance_flags(eff) | gold_flags(eff, token, created_at)
    flags |= {PLATFORM_LABEL[p["platform"]] for p in plats if p["platform"] in PLATFORM_LABEL and ca in p["cas"]}
    gold = is_early_gold(eff, token)
    partly = [label for label, need in MULTI_CA_LABELS.items() if label in labels and (gold if need == "gold" else need in flags)]
    if plats and num(app["plat_pnl"]) is not None:
        total, realized, source = num(app["plat_pnl"]), num(app["plat_realized"]), app["plat_src"] or "平台"
        unrealized = total - realized if realized is not None else None
    elif plats and not gmgn_sees_trades(app):
        total = realized = unrealized = None
        source = ""
    else:
        total, realized, unrealized, source = num(app["total"]), num(app["realized"]), num(app["unrealized"]), "GMGN"
        if total is None and (realized is not None or unrealized is not None):
            total = (realized or 0) + (unrealized or 0)
    sold = bool((num(app["sell_usd"]) or 0) > 0 or (num(app["sold_pct"]) or 0) > 0 or (realized or 0) != 0)
    return {"labels": [label for label in labels if label in flags], "partly": partly,
            "realized": realized, "unrealized": unrealized, "total": total, "roi": num(eff["roi"]),
            "sold": sold, "holding": bool(app["still_holding"]), "source": source}


def search(payload: dict[str, Any]) -> dict[str, Any]:
    q = str(payload.get("q") or "").strip()
    chain = str(payload.get("chain") or "").strip()
    token_ca = norm(chain, payload.get("token")) if chain and payload.get("token") else ""
    label = str(payload.get("label") or "").strip()
    group = label[len("group:"):] if label.startswith("group:") else ""
    limit = max(1, min(int(payload.get("limit") or 50), 500))
    offset = max(0, int(payload.get("offset") or 0))
    show_quiet = bool(payload.get("showQuiet"))
    exact = norm(chain, q) if FULL_ADDRESS.fullmatch(q) else ""
    with LOCK:
        conn = connect()
        try:
            sql = "SELECT w.*, (SELECT COUNT(*) FROM appearances a WHERE a.chain=w.chain AND a.address=w.address) AS ca_count, " \
                  f"(SELECT SUM({EFFECTIVE_TOTAL_SQL}) FROM appearances a WHERE a.chain=w.chain AND a.address=w.address) AS total_pnl FROM wallets w WHERE 1=1"
            args: list[Any] = []
            if chain:
                sql += " AND w.chain=?"; args.append(chain)
            if q:
                sql += " AND (w.address LIKE ? OR w.name LIKE ? OR w.twitter LIKE ? OR w.note LIKE ? OR EXISTS (SELECT 1 FROM appearances a WHERE a.chain=w.chain AND a.address=w.address AND (a.ca LIKE ? OR a.symbol LIKE ?))" \
                       " OR EXISTS (SELECT 1 FROM platform_names p WHERE " + same_wallet_sql("w") + " AND (p.handle LIKE ? OR p.x LIKE ?)))"
                like = f"%{norm(chain, q.lstrip('@')) if q.startswith('0x') else q.lstrip('@')}%"; args += [like] * 8
            rows = conn.execute(sql + " ORDER BY ca_count DESC, total_pnl DESC", args).fetchall()
            plats = platform_index(conn, chain)
            accts = plat_accounts_index(conn, chain)
            quiet = quiet_wallets(conn)
            here_apps = {a["address"]: a for a in conn.execute("SELECT * FROM appearances WHERE chain=? AND ca=?", (chain, token_ca))} if token_ca else {}
            here_token = token_rows(conn, chain, [token_ca]).get(token_ca) if token_ca else None
            cards, follows = sm_cards(conn), follow_index(conn)
            items, hidden = [], 0
            for row in rows:
                summary = wallet_summary(row, plats.get((row["chain"], row["address"])))
                if group:
                    if not any(LABEL_GROUP.get(item) == group for item in summary["labels"]):
                        continue
                elif label and label not in summary["labels"]:
                    continue
                first_seen = quiet.get((row["chain"], row["address"]), -1)
                if first_seen != -1:
                    if not show_quiet and row["address"] != exact:
                        hidden += 1
                        continue
                    summary["quiet"] = {"firstSeen": first_seen, "pruneAt": first_seen + PRUNE_AFTER_DAYS * 86400 if first_seen else None}
                summary["caCount"] = row["ca_count"]; summary["totalPnl"] = row["total_pnl"]
                key = (row["chain"], row["address"])
                summary["acct"] = accts.get(key)
                summary["card"] = wallet_card(row, summary["labels"], cards.get(key), follows.get(key))
                if token_ca:
                    app = here_apps.get(row["address"])
                    summary["here"] = token_here(app, here_token, summary["platforms"], row["created_at"], summary["labels"], token_ca) if app else None
                items.append(summary)
            if payload.get("keysOnly"):
                return {"ok": True, "keys": [[i["chain"], i["address"]] for i in items], "hidden": hidden}
            tokens = conn.execute("SELECT COUNT(*) FROM tokens").fetchone()[0]
            status = quiet_status(conn, quiet) | {"hidden": hidden, "shown": show_quiet}
            bots = bot_status(conn, quiet)
        finally:
            conn.close()
    return {"ok": True, "total": len(items), "items": items[offset:offset + limit], "rules": RULES, "groups": LABEL_GROUPS,
            "tokens": tokens, "quiet": status, "bots": bots, "cardRule": CARD_RULE, "useLabels": USE_LABEL,
            **({"token": token_ca} if token_ca else {})}


def wallet_detail(payload: dict[str, Any]) -> dict[str, Any]:
    chain = str(payload.get("chain") or "")
    address = norm(chain, payload.get("address"))
    with LOCK:
        conn = connect()
        try:
            row = conn.execute("SELECT * FROM wallets WHERE chain=? AND address=?", (chain, address)).fetchone()
            if not row:
                raise ValueError("钱包库没有这个地址")
            raw = conn.execute("SELECT * FROM appearances WHERE chain=? AND address=? ORDER BY queried_at DESC", (chain, address)).fetchall()
            tokens = token_rows(conn, chain, [a["ca"] for a in raw])
            plats = platform_index(conn, chain, address).get((chain, address))
            acct = plat_accounts_index(conn, chain, address).get((chain, address))
            eff = [platform_app(a) if plats else a for a in raw]
            apps = [dict(a) | {"gmgn_tags": loads(a["gmgn_tags"]),
                               "flags": sorted(appearance_flags(e) | gold_flags(e, tokens.get(a["ca"]), row["created_at"])),
                               "gmgnSeesTrades": gmgn_sees_trades(a),
                               "athMc": tokens[a["ca"]]["ath_mc"] if a["ca"] in tokens else None,
                               "launchTs": tokens[a["ca"]]["launch_ts"] if a["ca"] in tokens else None}
                    for a, e in zip(raw, eff)]
            up = [dict(r) for r in conn.execute("SELECT * FROM relations WHERE chain=? AND dst=?", (chain, address))]
            down = [dict(r) for r in conn.execute("SELECT * FROM relations WHERE chain=? AND src=?", (chain, address))]
            for rel in up + down:
                rel["noise"] = relation_noise(conn, chain, rel["src"], rel["asset"], rel["amount"], rel["public_entity"], rel["dst"])
            siblings = [dict(r) for r in conn.execute(
                "SELECT r2.dst AS address, r2.src AS via, r2.ca FROM relations r1 JOIN relations r2 ON r1.chain=r2.chain AND r1.src=r2.src "
                f"WHERE r1.chain=? AND r1.dst=? AND r1.rel_type='funding' AND r2.rel_type='funding' AND r2.dst<>? AND {rel_counts_sql('r1')} "
                f"AND {rel_counts_sql('r2')} AND (SELECT COUNT(DISTINCT r3.dst) FROM relations r3 WHERE r3.chain=r1.chain AND r3.src=r1.src "
                f"AND r3.rel_type='funding')<=? LIMIT 200", (chain, address, address, FUNDER_MAX))]
            reviews = _review_rows(conn, chain, address)
            same = [{"chain": r["chain"], "appearances": conn.execute("SELECT COUNT(*) FROM appearances WHERE chain=? AND address=?", (r["chain"], address)).fetchone()[0]}
                    for r in _rows_for(conn, chain, address) if r["chain"] != chain]
            card_sm, card_follow = sm_cards(conn).get((chain, address)), follow_index(conn).get((chain, address))
        finally:
            conn.close()
    wallet = wallet_summary(row, plats) | ({"gmgnOk": gmgn_overall_ok(row["pf_buys"], raw)} if plats else {})
    wallet["card"] = wallet_card(row, wallet["labels"], card_sm, card_follow)
    wallet["acct"] = acct
    return {"ok": True, "wallet": wallet, "appearances": apps, "upstream": up, "downstream": down, "linkReviews": reviews, "sameWallet": same,
            "sharedFunder": siblings, "relationRule": RELATION_RULE, "spoofRule": SPOOF_RULE, "funderMax": FUNDER_MAX, "rules": RULES, "platRule": PLAT_RULE, "cardRule": CARD_RULE, "useLabels": USE_LABEL, "acctRule": PLAT_ACCT_RULE,
            "note": "上下游与共同上游只代表资金关联，不代表同一主人。"}


def token_summary(payload: dict[str, Any]) -> dict[str, Any]:
    raw = str(payload.get("chain") or "").strip()
    chain = LIB_CHAIN.get(raw.lower(), raw)
    ca = norm(chain, payload.get("ca"))
    if not chain or not ca:
        raise ValueError("缺少 chain 或 ca")
    with LOCK:
        conn = connect()
        try:
            token = conn.execute("SELECT * FROM tokens WHERE chain=? AND ca=?", (chain, ca)).fetchone()
            rows = conn.execute("SELECT w.* FROM wallets w JOIN (SELECT DISTINCT address FROM appearances WHERE chain=? AND ca=?) a "
                                "ON a.address=w.address WHERE w.chain=?", (chain, ca, chain)).fetchall()
            last_app = conn.execute("SELECT MAX(queried_at) FROM appearances WHERE chain=? AND ca=?", (chain, ca)).fetchone()[0]
            names = conn.execute("SELECT COUNT(*) FROM platform_names WHERE chain=? AND cas LIKE ?", (chain, f'%"{ca}"%')).fetchone()[0]
            quiet = quiet_wallets(conn) if rows else {}
        finally:
            conn.close()
    if not token and not rows:
        return {"ok": False, "missing": True, "chain": chain, "ca": ca}
    order = {rule["id"]: i for i, rule in enumerate(RULES)}
    label_name = {rule["id"]: rule["label"] for rule in RULES}
    per_label: dict[str, dict[str, int]] = {g["id"]: {} for g in LABEL_GROUPS}
    members = {g["id"]: 0 for g in LABEL_GROUPS}
    unlabeled = manual_only = 0
    for row in rows:
        labels = effective_labels(row)
        groups = set()
        for label in labels:
            group = LABEL_GROUP.get(label)
            if group:
                per_label[group][label] = per_label[group].get(label, 0) + 1
                groups.add(group)
        for group in groups:
            members[group] += 1
        unlabeled += not labels
        manual_only += bool(labels) and not groups
    written = (token["written_at"] if token else None) or max([t for t in (last_app, token["queried_at"] if token else None) if t], default=None)
    return {"ok": True, "chain": chain, "ca": ca, "symbol": token["symbol"] if token else "",
            "wallets": len(rows), "quiet": sum((chain, row["address"]) in quiet for row in rows),
            "unlabeled": unlabeled, "manualOnly": manual_only, "platformNames": names,
            "writtenAt": written, "writtenBy": (token["written_by"] or "") if token and token["written_at"] else "",
            "groups": [{"id": g["id"], "label": g["label"], "wallets": members[g["id"]],
                        "labels": [{"id": k, "label": label_name.get(k, k), "count": v}
                                   for k, v in sorted(per_label[g["id"]].items(), key=lambda kv: (-kv[1], order.get(kv[0], 99)))]}
                       for g in LABEL_GROUPS],
            "note": f"标签是钱包整体的，可能来自别颗币；总体盈利不到 {QUIET_TEXT} 的钱包在钱包库预设隐藏。"}


ADDRESS_RE = {"BSC": re.compile(r"^0x[0-9a-f]{40}$"), "Robinhood": re.compile(r"^0x[0-9a-f]{40}$"),
              "Solana": re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")}
REVIEW_SOURCE = "你确认的关联"
EVM_CHAINS = ("BSC", "Robinhood")


def lib_chain(chain: Any) -> str:
    text = str(chain or "").strip()
    return text if text in ADDRESS_RE else LIB_CHAIN.get(text.lower(), "")


def same_wallet_chains(chain: str) -> tuple[str, ...]:
    return EVM_CHAINS if chain in EVM_CHAINS else (chain,)


def review_chain(chain: str) -> str:
    return "EVM" if chain in EVM_CHAINS else chain


def _rows_for(conn: sqlite3.Connection, chain: str, address: str) -> list[sqlite3.Row]:
    chains = same_wallet_chains(chain)
    rows = conn.execute(f"SELECT * FROM wallets WHERE address=? AND chain IN ({','.join('?' * len(chains))})", (address, *chains)).fetchall()
    return sorted(rows, key=lambda r: r["chain"] != chain)


def _ensure_wallet(conn: sqlite3.Connection, chain: str, address: str, now: int) -> bool:
    if not ADDRESS_RE[chain].match(address):
        raise ValueError(f"不是 {chain} 的钱包地址")
    return conn.execute("INSERT OR IGNORE INTO wallets(chain, address, first_seen, updated_at) VALUES (?,?,?,?)",
                        (chain, address, now, now)).rowcount > 0


def update_wallet(payload: dict[str, Any]) -> dict[str, Any]:
    chain = lib_chain(payload.get("chain"))
    if not chain:
        raise ValueError("钱包库只收 BSC、Solana、Robinhood 的地址")
    address = norm(chain, payload.get("address"))
    clean = lambda values: [str(v).strip()[:40] for v in (values or []) if str(v).strip()][:20]
    now = int(time.time())
    chains = same_wallet_chains(chain)
    with LOCK:
        conn = connect()
        try:
            created = _ensure_wallet(conn, chain, address, now) if payload.get("create") and not _rows_for(conn, chain, address) else False
            cur = conn.execute(f"UPDATE wallets SET manual_labels=?, removed_labels=?, note=?, updated_at=? WHERE address=? AND chain IN ({','.join('?' * len(chains))})",
                               (json.dumps(clean(payload.get("manualLabels"))), json.dumps(clean(payload.get("removedLabels"))),
                                str(payload.get("note") or "")[:2000], now, address, *chains))
            if not cur.rowcount:
                raise ValueError("钱包库没有这个地址")
            conn.commit()
            rows = _rows_for(conn, chain, address)
            row = rows[0]
            plats = platform_index(conn, row["chain"], address).get((row["chain"], address))
        finally:
            conn.close()
    return {"ok": True, "created": created, "wallet": wallet_summary(row, plats), "chains": [r["chain"] for r in rows]}


def _review_rows(conn: sqlite3.Connection, chain: str, address: str) -> list[dict[str, Any]]:
    return [{"kind": r["kind"], "target": r["target"].split(":", 1)[1], "label": r["label"], "verdict": r["verdict"], "tag": r["tag"], "at": r["at"]}
            for r in conn.execute("SELECT * FROM link_reviews WHERE chain=? AND address=? ORDER BY at DESC", (review_chain(chain), address))]


def _set_manual_tag(conn: sqlite3.Connection, chain: str, address: str, tag: str, add: bool) -> None:
    if not tag:
        return
    for row in _rows_for(conn, chain, address):
        labels = [label for label in loads(row["manual_labels"]) if label != tag] + ([tag] if add else [])
        conn.execute("UPDATE wallets SET manual_labels=?, updated_at=? WHERE chain=? AND address=?",
                     (json.dumps(labels[-20:]), int(time.time()), row["chain"], address))


def review_link(payload: dict[str, Any]) -> dict[str, Any]:
    import user_labels

    chain = lib_chain(payload.get("chain"))
    if not chain:
        raise ValueError("钱包库只收 BSC、Solana、Robinhood 的地址")
    address = norm(chain, payload.get("address"))
    kind = str(payload.get("kind") or "")
    if kind not in {"group", "wallet"}:
        raise ValueError("kind 要是 group 或 wallet")
    target = str(payload.get("target") or "").strip()[:80]
    target = norm(chain, target) if kind == "wallet" else target
    if not target or target == address:
        raise ValueError("缺少要确认的对象")
    label = str(payload.get("label") or target).strip()[:40]
    verdict = payload.get("verdict")
    if verdict not in {"yes", "no", None}:
        raise ValueError("verdict 要是 yes、no 或 null")
    key = f"{kind}:{target}"
    now = int(time.time())
    rchain = review_chain(chain)
    with LOCK:
        conn = connect()
        try:
            user_labels.ensure(conn)
            if not ADDRESS_RE[chain].match(address):
                raise ValueError(f"不是 {chain} 的钱包地址")
            old = conn.execute("SELECT * FROM link_reviews WHERE chain=? AND address=? AND target=?", (rchain, address, key)).fetchone()
            if old and old["verdict"] == "yes":
                _set_manual_tag(conn, chain, address, old["tag"], add=False)
                conn.execute("DELETE FROM user_labels WHERE address=? AND source=? AND group_key=?", (address, REVIEW_SOURCE, old["label"]))
            created = False
            if verdict is None:
                conn.execute("DELETE FROM link_reviews WHERE chain=? AND address=? AND target=?", (rchain, address, key))
            else:
                tag = f"确认相关：{label}"[:40] if verdict == "yes" else ""
                if verdict == "yes":
                    created = _ensure_wallet(conn, chain, address, now) if not _rows_for(conn, chain, address) else False
                    _set_manual_tag(conn, chain, address, tag, add=True)
                    if not conn.execute("SELECT 1 FROM user_labels WHERE address=?", (address,)).fetchone():
                        conn.execute("INSERT INTO user_labels VALUES (?,?,?,?,?,?,?,?,?)",
                                     (address, user_labels.family_of(address), f"{label}（你确认相关）", label, 0, "[]", 0, REVIEW_SOURCE, now))
                conn.execute("INSERT OR REPLACE INTO link_reviews(chain, address, target, kind, label, verdict, tag, at) VALUES (?,?,?,?,?,?,?,?)",
                             (rchain, address, key, kind, label, verdict, tag, now))
            conn.commit()
            reviews = _review_rows(conn, chain, address)
        finally:
            conn.close()
    return {"ok": True, "created": created, "chain": chain, "address": address, "reviews": reviews}


def link_reviews(payload: dict[str, Any]) -> dict[str, Any]:
    chain = lib_chain(payload.get("chain"))
    if not chain:
        return {"ok": True, "reviews": [], "unsupported": True}
    address = norm(chain, payload.get("address"))
    with LOCK:
        conn = connect()
        try:
            reviews = _review_rows(conn, chain, address)
        finally:
            conn.close()
    return {"ok": True, "chain": chain, "address": address, "reviews": reviews}


def export_all() -> dict[str, Any]:
    with LOCK:
        conn = connect()
        try:
            plats = platform_index(conn)
            accts = plat_accounts_index(conn)
            quiet = quiet_wallets(conn)
            sm = sm_activity(conn)
            bots = bot_wallets_now(conn, sm)
            pending = {(c, a) for c, a, _, _ in _bot_pending(conn, quiet, sm, bots)}
            cards, follows = sm_cards(conn), follow_index(conn)
            wallets = []
            for r in conn.execute("SELECT * FROM wallets ORDER BY chain, address"):
                key = (r["chain"], r["address"])
                w = wallet_summary(r, plats.get(key)) | {"quiet": key in quiet, "bot": bots.get(key, ""), "botPending": key in pending}
                w["card"] = wallet_card(r, w["labels"], cards.get(key), follows.get(key))
                w["acct"] = accts.get(key)
                wallets.append(w)
            status = bot_status(conn, quiet)
            apps = [dict(r) for r in conn.execute("SELECT * FROM appearances ORDER BY chain, address, queried_at")]
            rels = [dict(r) for r in conn.execute("SELECT * FROM relations ORDER BY chain, src, dst")]
            tokens = [dict(r) for r in conn.execute("SELECT * FROM tokens ORDER BY queried_at DESC")]
            names = [dict(r) | {"cas": loads(r["cas"])} for r in conn.execute("SELECT * FROM platform_names ORDER BY chain, address")]
            fomo_pnl = fomo_board_pnl_index(conn)
        finally:
            conn.close()
    platform_keys = {(n["chain"], n["address"]) for n in names}
    best: dict[tuple[str, str], dict[str, Any]] = {}
    bundles: dict[tuple[str, str], list[dict[str, Any]]] = {}
    plat: dict[tuple[str, str], dict[str, Any]] = {}
    plat_apps: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for app in apps:
        key = (app["chain"], app["address"])
        on_platform = key in platform_keys
        p = num(app.get("plat_pnl")) if on_platform else None
        total = num((platform_app(app) if on_platform else app)["total"])
        if total is not None and total > (best.get(key) or {}).get("total", 0):
            best[key] = {"symbol": app["symbol"] or "", "ca": app["ca"], "total": total, "src": (app.get("plat_src") or "") if p is not None else "GMGN"}
        group = cluster_number(app["cluster"])
        if group:
            bundles.setdefault(key, []).append({"symbol": app["symbol"] or "", "ca": app["ca"], "group": group})
        if on_platform:
            plat_apps.setdefault(key, []).append(app)
        if p is not None:
            s = plat.setdefault(key, {"sum": 0.0, "n": 0, "best": None, "at": None})
            s["sum"] += p
            s["n"] += 1
            if s["best"] is None or p > s["best"]["pnl"]:
                s["best"] = {"symbol": app["symbol"] or "", "ca": app["ca"], "pnl": p, "src": app.get("plat_src") or ""}
            s["at"] = max(s["at"] or 0, app.get("plat_at") or 0) or None
    for w in wallets:
        key = (w["chain"], w["address"])
        w["best"], w["bundles"] = best.get(key), bundles.get(key, [])
        w["plat"] = plat.get(key)
        w["gmgnOk"] = gmgn_overall_ok((w["pf"] or {}).get("buys"), plat_apps.get(key, [])) if key in platform_keys else True
        w["fomo"] = fomo_pnl_for(plats.get(key), fomo_pnl)
    return {"ok": True, "wallets": wallets, "appearances": apps, "relations": rels, "tokens": tokens, "platformNames": names, "rules": RULES,
            "groups": LABEL_GROUPS, "platRule": PLAT_RULE, "bots": status, "cardRule": CARD_RULE, "useLabels": USE_LABEL,
            "highFreq": HIGH_FREQ_TRADES, "acctRule": PLAT_ACCT_RULE}


def cluster_number(cluster: Any) -> int | None:
    head = str(cluster or "").split(":", 1)[0]
    if len(head) == 1 and "A" <= head <= "Z":
        return ord(head) - 64
    if head[:1] == "G" and head[1:].isdigit():
        return int(head[1:])
    return None


def trace_ingest(payload: dict[str, Any]) -> dict[str, Any]:
    chain = str(payload.get("chain") or "").strip()
    target = norm(chain, payload.get("target"))
    if not chain or not target:
        raise ValueError("追查写入缺少 chain 或 target")
    now = int(time.time())
    wallets = [w for w in (payload.get("wallets") or []) if isinstance(w, dict) and w.get("address")]
    apps = [a for a in (payload.get("appearances") or []) if isinstance(a, dict) and a.get("ca")]
    relations = [r for r in (payload.get("relations") or []) if isinstance(r, dict)]
    trace_key = f"trace:{target}"
    with LOCK:
        conn = connect()
        try:
            addresses: list[str] = []
            spoofs = spoof_set(conn) - _spoof_protected(conn)
            for w in wallets:
                address = norm(chain, w.get("address"))
                if address in spoofs:
                    continue
                addresses.append(address)
                tags = json.dumps(sorted({str(t) for t in (w.get("gmgnTags") or [])}))
                conn.execute("INSERT INTO wallets(chain, address, name, twitter, first_seen, updated_at, gmgn_tags) VALUES (?,?,?,?,?,?,?) "
                             "ON CONFLICT(chain, address) DO UPDATE SET name=COALESCE(NULLIF(excluded.name,''), wallets.name), "
                             "twitter=COALESCE(NULLIF(excluded.twitter,''), wallets.twitter), updated_at=excluded.updated_at, "
                             "gmgn_tags=CASE WHEN excluded.gmgn_tags<>'[]' THEN excluded.gmgn_tags ELSE wallets.gmgn_tags END",
                             (chain, address, str(w.get("name") or ""), str(w.get("twitter") or "").lstrip("@"), now, now, tags))
            stored_apps = 0
            for a in apps:
                address, ca = norm(chain, a.get("address") or target), norm(chain, a.get("ca"))
                cur = conn.execute("INSERT OR IGNORE INTO appearances(chain,address,ca,symbol,queried_at,open_ts,entry_ts,elapsed,hold_seconds,still_holding,buy_usd,sell_usd,realized,unrealized,total,roi,source) "
                                   "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                    chain, address, ca, str(a.get("symbol") or ""), now, num(a.get("openTs")), num(a.get("entryTs")), num(a.get("elapsed")),
                    num(a.get("holdSeconds")), 1 if a.get("stillHolding") else 0, num(a.get("buyUsd")), num(a.get("sellUsd")),
                    num(a.get("realized")), num(a.get("unrealized")), num(a.get("total")), num(a.get("roi")), str(a.get("source") or "")))
                if cur.rowcount == 0:
                    conn.execute("UPDATE appearances SET hold_seconds=COALESCE(hold_seconds,?), entry_ts=COALESCE(entry_ts,?), elapsed=COALESCE(elapsed,?), total=COALESCE(total,?) "
                                 "WHERE chain=? AND address=? AND ca=?", (num(a.get("holdSeconds")), num(a.get("entryTs")), num(a.get("elapsed")), num(a.get("total")), chain, address, ca))
                stored_apps += 1
            stored_rel = 0
            for rel in relations:
                src, dst = norm(chain, rel.get("src")), norm(chain, rel.get("dst"))
                if not src or not dst or src == dst:
                    continue
                label = str(rel.get("srcLabel") or rel.get("dstLabel") or "")
                conn.execute("INSERT OR REPLACE INTO relations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                    chain, src, dst, str(rel.get("type") or "funding"), trace_key, str(rel.get("evidence") or ""),
                    str(rel.get("provider") or ""), str(rel.get("txHash") or ""), str(rel.get("asset") or ""),
                    num(rel.get("amount")), num(rel.get("ts")), label, 1 if rel.get("publicEntity") else 0))
                stored_rel += 1
            lookup = []
            for address in dict.fromkeys(addresses):
                labels = recompute_labels(conn, chain, address)
                row = conn.execute("SELECT * FROM wallets WHERE chain=? AND address=?", (chain, address)).fetchone()
                cas = conn.execute("SELECT COUNT(*) FROM appearances WHERE chain=? AND address=?", (chain, address)).fetchone()[0]
                lookup.append({"address": address, "labels": effective_labels(row) if row else labels, "caCount": cas,
                               "name": row["name"] if row else "", "twitter": row["twitter"] if row else ""})
            refresh_spoofs(conn, now)
            conn.commit()
            try:
                import user_labels
                user_labels.ensure(conn)
                for item in lookup:
                    r = conn.execute("SELECT * FROM user_labels WHERE address=?", (norm("", item["address"]),)).fetchone()
                    if r:
                        item["userLabel"] = user_labels._row(r)
            except Exception:
                pass
        finally:
            conn.close()
    return {"ok": True, "stored": len(set(addresses)), "appearances": stored_apps, "relations": stored_rel, "lookup": lookup,
            "note": "相关＝链上资金关联，不代表同一主人。"}


def platform_ingest(result: dict[str, Any]) -> dict[str, Any]:
    chain = LIB_CHAIN.get(str(result.get("chain") or "").lower(), "")
    ca = norm(chain, result.get("ca"))
    if not chain or not ca:
        raise ValueError("平台比对结果缺少 chain 或 ca")
    now = int(time.time())
    rows = [r for r in (result.get("rows") or []) if isinstance(r, dict) and r.get("address") and not r.get("isExchangeOrContract")]
    with LOCK:
        conn = connect()
        try:
            symbol = str(result.get("symbol") or "").strip()
            if not symbol:
                hit = conn.execute("SELECT symbol FROM tokens WHERE chain=? AND ca=? AND symbol<>''", (chain, ca)).fetchone()
                if not hit:
                    try:
                        hit = conn.execute("SELECT symbol FROM sm_tokens WHERE ca=? AND symbol<>''", (ca,)).fetchone()
                    except sqlite3.OperationalError:
                        hit = None
                symbol = hit["symbol"] if hit else ""
            supply = num(result.get("supply"))
            conn.execute("INSERT INTO tokens(chain, ca, symbol, open_ts, queried_at, data_note, supply, written_at, written_by) VALUES (?,?,?,?,?,?,?,?,?) "
                         "ON CONFLICT(chain, ca) DO UPDATE SET symbol=COALESCE(NULLIF(tokens.symbol,''), excluded.symbol), "
                         "supply=COALESCE(excluded.supply, tokens.supply), written_at=excluded.written_at, written_by=excluded.written_by",
                         (chain, ca, symbol, None, now, "GMGN 前 100 持仓快照（进场时间是 GMGN 的开始持有时间）", supply, now, WRITER_PLATFORM))
            known = {r["address"] for r in conn.execute("SELECT address FROM wallets WHERE chain=?", (chain,))}
            added, names = 0, 0
            for r in rows:
                address = norm(chain, r["address"])
                tags = json.dumps(sorted({str(t) for t in (r.get("tags") or [])}))
                added += address not in known
                created = num(r.get("walletCreatedAt"))
                conn.execute("INSERT INTO wallets(chain, address, name, twitter, first_seen, updated_at, created_at) VALUES (?,?,?,?,?,?,?) "
                             "ON CONFLICT(chain, address) DO UPDATE SET name=COALESCE(NULLIF(excluded.name,''), wallets.name), "
                             "twitter=COALESCE(NULLIF(excluded.twitter,''), wallets.twitter), updated_at=excluded.updated_at, "
                             "created_at=COALESCE(wallets.created_at, excluded.created_at)",
                             (chain, address, str(r.get("gmgnName") or ""), str(r.get("twitter") or "").lstrip("@"), now, now,
                              int(created) if created else None))
                cost, sold_px = num(r.get("avgCost")), num(r.get("avgSold"))
                entry = num(r.get("startHoldingAt")) or None
                buy_mc = cost * supply if cost and supply else None
                sell_mc = sold_px * supply if sold_px and supply else None
                cur = conn.execute("INSERT OR IGNORE INTO appearances(chain,address,ca,symbol,queried_at,entry_ts,buy_mc,sell_mc,still_holding,buy_usd,sell_usd,"
                                   "realized,unrealized,total,holding_pct,gmgn_tags,source,sold_pct) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                    chain, address, ca, symbol, now, entry, buy_mc, sell_mc, 1, num(r.get("boughtUsd")), num(r.get("soldUsd")),
                    num(r.get("realized")), num(r.get("unrealized")), num(r.get("pnl")), num(r.get("pct")), tags, PLATFORM_SOURCE, num(r.get("soldPct"))))
                if cur.rowcount == 0:
                    conn.execute("UPDATE appearances SET holding_pct=COALESCE(holding_pct,?), total=COALESCE(total,?), "
                                 "entry_ts=COALESCE(entry_ts,?), buy_mc=COALESCE(buy_mc,?), sell_mc=COALESCE(sell_mc,?), sold_pct=COALESCE(sold_pct,?), "
                                 "gmgn_tags=CASE WHEN gmgn_tags IS NULL OR gmgn_tags='[]' THEN ? ELSE gmgn_tags END, "
                                 "symbol=COALESCE(NULLIF(symbol,''), ?), "
                                 "source=CASE WHEN instr(COALESCE(source,''), ?)=0 THEN COALESCE(NULLIF(source,'') || ' / ', '') || ? ELSE source END "
                                 "WHERE chain=? AND address=? AND ca=?",
                                 (num(r.get("pct")), num(r.get("pnl")), entry, buy_mc, sell_mc, num(r.get("soldPct")),
                                  tags, symbol, PLATFORM_SOURCE, PLATFORM_SOURCE, chain, address, ca))
                if num(r.get("pumpPnl")) is not None:
                    plat = ("pump.fun", num(r.get("pumpPnl")), num(r.get("pumpRealized")), num(r.get("pumpCost")))
                elif num(r.get("fomoPnl")) is not None:
                    plat = ("FOMO", num(r.get("fomoPnl")), None, None)
                else:
                    plat = None
                if plat:
                    conn.execute("UPDATE appearances SET plat_src=?, plat_pnl=?, plat_realized=?, plat_cost=?, plat_at=? WHERE chain=? AND address=? AND ca=?",
                                 (*plat, now, chain, address, ca))
                for platform, handle, extra in (("FOMO", r.get("fomoHandle"), {"followers": r.get("fomoFollowers")}),
                                                ("pump.fun", r.get("pumpName"), {"x": r.get("pumpX"), "verified": r.get("pumpVerified")})):
                    handle = str(handle or "").strip()
                    if not handle:
                        continue
                    old = conn.execute("SELECT cas FROM platform_names WHERE chain=? AND address=? AND platform=? AND handle=?",
                                       (chain, address, platform, handle)).fetchone()
                    cas = loads(old["cas"]) if old else []
                    if ca not in cas:
                        cas.append(ca)
                    followers = num(extra.get("followers"))
                    conn.execute("INSERT INTO platform_names(chain, address, platform, handle, x, followers, verified, cas, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?) "
                                 "ON CONFLICT(chain, address, platform, handle) DO UPDATE SET x=COALESCE(NULLIF(excluded.x,''), platform_names.x), "
                                 "followers=COALESCE(excluded.followers, platform_names.followers), verified=COALESCE(excluded.verified, platform_names.verified), "
                                 "cas=excluded.cas, last_seen=excluded.last_seen",
                                 (chain, address, platform, handle, str(extra.get("x") or "").lstrip("@"),
                                  int(followers) if followers is not None else None,
                                  None if extra.get("verified") is None else int(bool(extra.get("verified"))), json.dumps(cas), now, now))
                    names += 1
            conn.execute("DELETE FROM bot_wallets WHERE EXISTS (SELECT 1 FROM platform_names p WHERE " + same_wallet_sql("bot_wallets") + ")")
            for r in rows:
                recompute_labels(conn, chain, norm(chain, r["address"]))
            conn.commit()
            total = conn.execute("SELECT COUNT(*) FROM wallets").fetchone()[0]
        finally:
            conn.close()
    return {"ok": True, "chain": chain, "ca": ca, "symbol": symbol, "stored": len(rows), "added": added, "platformNames": names,
            "skipped": len(result.get("rows") or []) - len(rows), "libraryWallets": total}


KEEP_REASON = {"mark": "你标过的", "sm": "聪明钱追踪中", "named": "有名字的", "avoid": "要避开的", "gold": "早买金狗那几条",
               "platform": "FOMO／pump.fun 用户"}
KEEP_LABEL_REASON = {"insider": "avoid", "bundle_member": "avoid", "sniper": "avoid", "fomo_user": "platform", "pump_user": "platform",
                     "gold_regular": "gold", "fresh_gold": "gold", "top_seller": "gold", "diamond": "gold", "paper_gold": "gold"}
assert set(KEEP_LABEL_REASON) == KEEP_LABELS


def wallet_groups(conn: sqlite3.Connection) -> dict[str, dict[str, Any]]:
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    groups: dict[str, dict[str, Any]] = {}

    def add(group: str, field: str, value: float | None, how: str = "sum") -> None:
        if value is None:
            return
        g = groups.get(group)
        if g is None:
            return
        g[field] = value if g[field] is None else (g[field] + value if how == "sum" else max(g[field], value))

    for r in conn.execute("SELECT chain, address, first_seen, auto_labels, manual_labels, removed_labels, note, gmgn_tags, pnl30_realized, pf_total, gm_total, "
                          "name, twitter FROM wallets"):
        group = norm(r["chain"], r["address"])
        g = groups.setdefault(group, {"members": [], "keep": set(), "coin": None, "pnl30": None, "pf": None, "gm": None, "acct": None,
                                      "coin1": None, "pnl30_1": None, "gm1": None})
        g["members"].append((r["chain"], r["address"], r["first_seen"]))
        add(group, "pnl30", num(r["pnl30_realized"]))
        add(group, "pnl30_1", num(r["pnl30_realized"]), "max")
        add(group, "pf", num(r["pf_total"]), "max")
        add(group, "gm", num(r["gm_total"]))
        gm_one = num(r["gm_total"])
        add(group, "gm1", gm_one if gm_one is not None and abs(gm_one) < 1e9 else None, "max")
        if str(r["name"] or "").strip() or str(r["twitter"] or "").strip():
            g["keep"].add("named")
        if loads(r["manual_labels"]) or loads(r["removed_labels"]) or str(r["note"] or "").strip():
            g["keep"].add("mark")
        g["keep"] |= {KEEP_LABEL_REASON[x] for x in set(loads(r["auto_labels"])) & KEEP_LABELS}
        if {str(t).lower() for t in loads(r["gmgn_tags"])} & KEEP_GMGN_TAGS:
            g["keep"].add("avoid")
    for r in conn.execute(f"SELECT a.chain, a.address, SUM({EFFECTIVE_TOTAL_SQL}) FROM appearances a GROUP BY a.chain, a.address"):
        g = groups.get(norm(r[0], r[1]))
        if g is not None:
            g["coin"] = (g["coin"] or 0.0) + (num(r[2]) or 0.0)
            add(norm(r[0], r[1]), "coin1", num(r[2]) or 0.0, "max")
    for r in conn.execute("SELECT chain, address, total FROM plat_accounts WHERE at IS NOT NULL AND total IS NOT NULL"):
        add(norm(r[0], r[1]), "acct", num(r[2]), "max")

    def mark(rows: Any, reason: str) -> None:
        for r in rows:
            g = groups.get(norm(r[0], r[1]))
            if g is not None:
                g["keep"].add(reason)

    mark(conn.execute("SELECT chain, address FROM platform_names"), "platform")
    mark(conn.execute("SELECT chain, address FROM link_reviews WHERE verdict='yes'"), "mark")
    if "user_labels" in tables:
        mark(conn.execute("SELECT '', address FROM user_labels"), "mark")
    if "sm_wallets" in tables:
        mark(conn.execute("SELECT chain, address FROM sm_wallets WHERE watch=1"), "sm")
    return groups


def quiet_wallets(conn: sqlite3.Connection) -> dict[tuple[str, str], int | None]:
    out: dict[tuple[str, str], int | None] = {}
    for g in wallet_groups(conn).values():
        if g["coin"] is None or g["keep"] or max(g["coin"], g["pnl30"] or 0.0, g["pf"] or 0.0, g["gm"] or 0.0,
                                                 g["coin1"] or 0.0, g["pnl30_1"] or 0.0, g["gm1"] or 0.0) >= QUIET_PNL_USD:
            continue
        seen = [first_seen for _, _, first_seen in g["members"]]
        start = None if None in seen else max(QUIET_SINCE, *seen)
        for chain, address, _ in g["members"]:
            out[(chain, address)] = start
    return out


CLEANUP_SCOPES = {"": "全部", "Solana": "Solana", "EVM": "BSC／Robinhood"}
CLEANUP_KEEP_ORDER = ("mark", "sm", "named", "avoid", "gold", "platform")


def wallet_best(conn: sqlite3.Connection, chain: str, address: str) -> tuple[float | None, str]:
    chains = same_wallet_chains(chain)
    marks = ",".join("?" * len(chains))
    g: dict[str, Any] = {"coin": None, "pnl30": None, "pf": None, "gm": None, "acct": None, "coin1": None, "pnl30_1": None, "gm1": None}

    def add(field: str, value: float | None, how: str = "sum") -> None:
        if value is not None:
            g[field] = value if g[field] is None else (g[field] + value if how == "sum" else max(g[field], value))

    for r in conn.execute(f"SELECT pnl30_realized, pf_total, gm_total FROM wallets WHERE chain IN ({marks}) AND address=?", (*chains, address)):
        add("pnl30", num(r[0]))
        add("pnl30_1", num(r[0]), "max")
        add("pf", num(r[1]), "max")
        add("gm", num(r[2]))
        gm_one = num(r[2])
        add("gm1", gm_one if gm_one is not None and abs(gm_one) < 1e9 else None, "max")
    for r in conn.execute(f"SELECT SUM({EFFECTIVE_TOTAL_SQL}) FROM appearances a WHERE a.chain IN ({marks}) AND a.address=? GROUP BY a.chain",
                          (*chains, address)):
        g["coin"] = (g["coin"] or 0.0) + (num(r[0]) or 0.0)
        add("coin1", num(r[0]) or 0.0, "max")
    for r in conn.execute(f"SELECT total FROM plat_accounts WHERE chain IN ({marks}) AND address=? AND at IS NOT NULL AND total IS NOT NULL",
                          (*chains, address)):
        add("acct", num(r[0]), "max")
    return group_best(g)


def group_best(g: dict[str, Any]) -> tuple[float | None, str]:
    if g.get("acct") is not None:
        return g["acct"], "acct"
    one = {"coin": "coin1", "pnl30": "pnl30_1", "gm": "gm1"}
    vals = [(max(v for v in (g.get(k), g.get(one.get(k, ""))) if v is not None), k) for k in ("coin", "pnl30", "gm", "pf")
            if g.get(k) is not None or g.get(one.get(k, "")) is not None]
    if not vals:
        return None, ""
    return max(vals)


def cleanup_candidates(conn: sqlite3.Connection, threshold: float, platform: bool = False, scope: str = "", young: bool = True,
                       now: float | None = None) -> dict[str, Any]:
    now = time.time() if now is None else now
    if scope not in CLEANUP_SCOPES:
        raise ValueError("链的范围不对")
    due: dict[str, dict[str, Any]] = {}
    kept = {k: 0 for k in CLEANUP_KEEP_ORDER}
    no_data = young_skipped = 0
    for group, g in wallet_groups(conn).items():
        chains = {c for c, _, _ in g["members"]}
        if scope == "Solana" and "Solana" not in chains or scope == "EVM" and not chains & set(EVM_CHAINS):
            continue
        best, src = group_best(g)
        if best is None:
            no_data += 1
            continue
        if best >= threshold:
            continue
        reasons = g["keep"] - ({"platform"} if platform else set())
        if reasons:
            kept[next(k for k in CLEANUP_KEEP_ORDER if k in reasons)] += 1
            continue
        seen = [fs for _, _, fs in g["members"] if fs is not None]
        first = max(seen) if seen else None
        if not young and first is not None and first > now - PRUNE_AFTER_DAYS * 86400:
            young_skipped += 1
            continue
        due[group] = {"members": [(c, a) for c, a, _ in g["members"]], "best": best, "src": src, "firstSeen": first,
                      **{k: g[k] for k in ("coin", "pnl30", "gm", "pf", "acct")}, "platform": "platform" in g["keep"]}
    return {"due": due, "kept": kept, "noData": no_data, "youngSkipped": young_skipped}


def cleanup_rule(threshold: float, platform: bool, scope: str, young: bool) -> str:
    return (f"手动清理：总体盈利（库里每颗币的盈亏加总、GMGN 30 天已实现、GMGN 历史总盈利、平台战绩，有数据的取最高；pump.fun 用户算过帐号总盈亏的以它为准）不到 ${threshold:,.0f}；"
            f"链：{CLEANUP_SCOPES.get(scope, scope)}；{'平台用户也一起看' if platform else '平台用户不删'}；{f'进库不满 {PRUNE_AFTER_DAYS} 天的也删' if young else f'进库不满 {PRUNE_AFTER_DAYS} 天的不删'}；"
            "你标过的、聪明钱追踪中、有名字的、要避开的、早买金狗那几条照样不删；BSC、RH 任一条链单独达标也不删")


def cleanup_apply(groups: set[str] | list[str], threshold: float, platform: bool = False, scope: str = "", young: bool = True,
                  now: float | None = None) -> dict[str, Any]:
    now = int(now if now is not None else time.time())
    picked = set(groups)
    with LOCK:
        conn = connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            cand = cleanup_candidates(conn, threshold, platform, scope, young, now)
            due = sorted(g for g in picked if g in cand["due"])
            keys = [(c, a) for g in due for c, a in cand["due"][g]["members"]]
            result: dict[str, Any] = {"ok": True, "at": now, "picked": len(picked), "deleted": 0, "wallets": 0, "archive": "",
                                      "changed": len(picked) - len(due)}
            if keys:
                wallets = [dict(r) for key in keys for r in conn.execute("SELECT * FROM wallets WHERE chain=? AND address=?", key)]
                apps = [dict(r) for key in keys for r in conn.execute("SELECT * FROM appearances WHERE chain=? AND address=?", key)]
                ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
                path = ARCHIVE_DIR / f"cleanup-{_local_time(now, '%Y%m%d-%H%M%S')}.json.gz"
                blob = gzip.compress(json.dumps({"version": 1, "kind": "cleanup", "prunedAt": now, "rule": cleanup_rule(threshold, platform, scope, young),
                                                 "wallets": wallets, "appearances": apps}, ensure_ascii=False).encode("utf-8"))
                tmp = path.with_suffix(".tmp")
                with open(tmp, "wb") as fh:
                    fh.write(blob)
                    fh.flush()
                    os.fsync(fh.fileno())
                tmp.replace(path)
                back = json.loads(gzip.decompress(path.read_bytes()).decode("utf-8"))
                if len(back.get("wallets") or []) != len(wallets) or len(back.get("appearances") or []) != len(apps):
                    raise RuntimeError("封存文件读回笔数不符，这次不删")
                for key in keys:
                    conn.execute("DELETE FROM appearances WHERE chain=? AND address=?", key)
                    conn.execute("DELETE FROM wallets WHERE chain=? AND address=?", key)
                    conn.execute("INSERT OR REPLACE INTO lib_removed(chain, address, at, archive) VALUES (?,?,?,?)", (*key, now, path.name))
                result.update({"deleted": len(due), "wallets": len(wallets), "archive": path.name})
            _state_put(conn, "cleanup:last", result | {"threshold": threshold, "platform": platform, "scope": scope, "young": young})
            conn.commit()
            return result
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def save_gm(chain: str, addresses: list[str], rows: list[dict[str, Any]], now: int | None = None) -> dict[str, int]:
    now = int(time.time() if now is None else now)
    by = {norm(chain, r.get("wallet_address") or r.get("address")): r for r in rows if isinstance(r, dict)}
    out = {"updated": 0, "noData": 0}
    with LOCK:
        conn = connect()
        try:
            for address in addresses:
                p = by.get(norm(chain, address))
                if p is None:
                    conn.execute("UPDATE wallets SET gm_total=NULL, gm_realized=NULL, gm_buys=NULL, gm_sells=NULL, gm_at=?, gm_note=? WHERE chain=? AND address=?",
                                 (now, "GMGN 没有这个钱包在这条链的纪录", chain, address))
                    out["noData"] += 1
                    continue
                total = num(p.get("total_profit"))
                realized = num(p.get("total_realized_profit"))
                realized = realized if realized is not None else num(p.get("realized_profit"))
                if total is None and realized is not None:
                    total = realized + (num(p.get("unrealized_profit")) or 0.0)
                buys, sells = num(p.get("buy")), num(p.get("sell"))
                conn.execute("UPDATE wallets SET gm_total=?, gm_realized=?, gm_buys=?, gm_sells=?, gm_at=?, gm_note='' WHERE chain=? AND address=?",
                             (total, realized, int(buys) if buys is not None else None, int(sells) if sells is not None else None, now, chain, address))
                if conn.execute("SELECT 1 FROM wallets WHERE chain=? AND address=?", (chain, address)).fetchone():
                    recompute_labels(conn, chain, address)
                out["updated"] += 1
            conn.commit()
        finally:
            conn.close()
    return out


def _waiting_stats(conn: sqlite3.Connection, keys: list[tuple[str, str]]) -> set[tuple[str, str]]:
    pending = set()
    for key in keys:
        row = conn.execute("SELECT pnl30_at FROM wallets WHERE chain=? AND address=?", key).fetchone()
        if row is not None and row["pnl30_at"] is None:
            pending.add(norm(*key))
    return {key for key in keys if norm(*key) in pending}


def _state_get(conn: sqlite3.Connection, key: str) -> Any:
    row = conn.execute("SELECT value FROM lib_state WHERE key=?", (key,)).fetchone()
    try:
        return json.loads(row["value"]) if row else None
    except (TypeError, json.JSONDecodeError):
        return None


def _state_put(conn: sqlite3.Connection, key: str, value: Any) -> None:
    if value is None:
        conn.execute("DELETE FROM lib_state WHERE key=?", (key,))
    else:
        conn.execute("INSERT OR REPLACE INTO lib_state(key, value) VALUES (?,?)", (key, json.dumps(value, ensure_ascii=False)))


def _local_time(ts: float, fmt: str = "%Y-%m-%d %H:%M") -> str:
    return time.strftime(fmt, time.localtime(ts))


def quiet_status(conn: sqlite3.Connection, quiet: dict[tuple[str, str], int | None] | None = None) -> dict[str, Any]:
    quiet = quiet_wallets(conn) if quiet is None else quiet
    due_at = [fs + PRUNE_AFTER_DAYS * 86400 for fs in quiet.values() if fs is not None]
    cutoff = time.time() - PRUNE_AFTER_DAYS * 86400
    waiting = _waiting_stats(conn, [key for key, fs in quiet.items() if fs is not None and fs <= cutoff])
    return {"total": len(quiet), "rule": QUIET_RULE, "days": PRUNE_AFTER_DAYS, "pnlUsd": QUIET_PNL_USD,
            "nextDueAt": min(due_at) if due_at else None, "waitingStats": len(waiting),
            "last": _state_get(conn, "prune:last"), "error": _state_get(conn, "prune:error")}


def prune_quiet(now: float | None = None, dry_run: bool = False) -> dict[str, Any]:
    now = int(now if now is not None else time.time())
    cutoff = now - PRUNE_AFTER_DAYS * 86400
    with LOCK:
        conn = connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            quiet = quiet_wallets(conn)
            timed = [key for key, first_seen in quiet.items() if first_seen is not None and first_seen <= cutoff]
            waiting = _waiting_stats(conn, timed)
            due = sorted(key for key in timed if key not in waiting)
            result: dict[str, Any] = {"ok": True, "at": now, "date": _local_time(now, "%Y-%m-%d"), "quiet": len(quiet), "due": len(due),
                                      "waitingStats": len(waiting), "deleted": 0, "archive": "", "dryRun": dry_run}
            if dry_run:
                conn.rollback()
                return result
            if due:
                wallets = [dict(r) for key in due for r in conn.execute("SELECT * FROM wallets WHERE chain=? AND address=?", key)]
                apps = [dict(r) for key in due for r in conn.execute("SELECT * FROM appearances WHERE chain=? AND address=?", key)]
                ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
                path = ARCHIVE_DIR / f"pruned-{_local_time(now, '%Y%m%d-%H%M%S')}.json.gz"
                blob = gzip.compress(json.dumps({"version": 1, "prunedAt": now, "rule": QUIET_RULE, "wallets": wallets, "appearances": apps},
                                                ensure_ascii=False).encode("utf-8"))
                tmp = path.with_suffix(".tmp")
                with open(tmp, "wb") as fh:
                    fh.write(blob)
                    fh.flush()
                    os.fsync(fh.fileno())
                tmp.replace(path)
                back = json.loads(gzip.decompress(path.read_bytes()).decode("utf-8"))
                if len(back.get("wallets") or []) != len(wallets) or len(back.get("appearances") or []) != len(apps):
                    raise RuntimeError("封存文件读回笔数不符，这次不删")
                for key in due:
                    conn.execute("DELETE FROM appearances WHERE chain=? AND address=?", key)
                    conn.execute("DELETE FROM wallets WHERE chain=? AND address=?", key)
                result.update({"deleted": len(wallets), "archive": path.name})
            _state_put(conn, "prune:last", result)
            _state_put(conn, "prune:error", None)
            conn.commit()
            return result
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def prune_if_due(now: float | None = None) -> dict[str, Any] | None:
    now = time.time() if now is None else now
    today = _local_time(now, "%Y-%m-%d")
    if int(_local_time(now, "%H")) < PRUNE_HOUR:
        return None
    with LOCK:
        conn = connect()
        try:
            last = _state_get(conn, "prune:last") or {}
        finally:
            conn.close()
    if last.get("date") == today:
        return None
    try:
        return prune_quiet(now)
    except Exception as exc:
        with LOCK:
            conn = connect()
            try:
                _state_put(conn, "prune:error", {"at": int(now), "error": str(exc)[:300]})
                conn.commit()
            finally:
                conn.close()
        return {"ok": False, "error": str(exc)[:300]}


def _gmgn_list(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    if isinstance(data, dict):
        return [x for x in (data.get("list") or (data.get("data") or {}).get("list") or []) if isinstance(x, dict)]
    return []


SERVICE_EVM_SENT = 20_000
SERVICE_SOL_HOURS = 72
SERVICE_BATCH = 150
SERVICE_RECHECK = 30 * 86400
FUNDER_MAX = 20
RELATION_DUST = {"BNB": 0.001, "ETH": 0.0003, "主币": 0.0003, "SOL": 0.003,
                 "USDT": 1.0, "USDC": 1.0, "USD1": 1.0, "BUSD": 1.0, "FDUSD": 1.0}
SERVICE_RPC = {"BSC": ("https://bsc-rpc.publicnode.com", "https://rpc-bsc.48.club"),
               "Robinhood": ("https://robinhood-rpc.publicnode.com", "https://rpc.mainnet.chain.robinhood.com"),
               "Solana": ("https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com")}
SERVICE_SCHEMA = """CREATE TABLE IF NOT EXISTS service_wallets (
  chain TEXT NOT NULL, address TEXT NOT NULL, service INTEGER DEFAULT 0, sent INTEGER, span_h REAL, note TEXT DEFAULT '',
  checked_at INTEGER, PRIMARY KEY (chain, address)
)"""
RELATION_RULE = (f"资金关联照样存、照样列，但这几种不拿来把钱包连在一起：交易所等公开实体（GMGN 标注）；"
                 f"仿冒地址（跟钱包真正的往来对象前后几码一样、转灰尘骗人拷贝的投毒地址）；"
                 f"高频服务钱包（不在钱包库，EVM 送出 ≥ {SERVICE_EVM_SENT:,} 笔，或 SOL 最近 1,000 笔在 {SERVICE_SOL_HOURS} 小时内）；"
                 f"灰尘转帐（主币约不到 $1、稳定币不到 $1）；共同上游另外要给 ≤ {FUNDER_MAX} 个钱包。")


def rel_counts_sql(alias: str) -> str:
    dust = " OR ".join(f"({alias}.asset='{a}' AND {alias}.amount<{v})" for a, v in RELATION_DUST.items())
    return (f"{alias}.public_entity=0 AND NOT ({alias}.amount IS NOT NULL AND ({dust})) "
            f"AND NOT EXISTS (SELECT 1 FROM service_wallets sw WHERE sw.chain={alias}.chain AND sw.address={alias}.src AND sw.service=1) "
            f"AND NOT EXISTS (SELECT 1 FROM spoof_addresses sp WHERE sp.chain={alias}.chain AND sp.address IN ({alias}.src, {alias}.dst))")


def service_note(chain: str, sent: Any, span_h: Any) -> str:
    if chain == "Solana":
        return f"高频服务钱包（最近 1,000 笔在 {float(span_h or 0):.1f} 小时内）"
    return f"高频服务钱包（送出 {int(sent or 0):,} 笔）"


def relation_noise(conn: sqlite3.Connection, chain: str, src: str, asset: Any, amount: Any, public_entity: Any = False, dst: str = "") -> str:
    if public_entity:
        return "交易所等公开实体"
    spoof = conn.execute("SELECT reason FROM spoof_addresses WHERE chain=? AND address IN (?,?)", (chain, src, dst or src)).fetchone()
    if spoof:
        return spoof["reason"] or "仿冒地址"
    limit, value = RELATION_DUST.get(str(asset or "")), num(amount)
    if limit is not None and value is not None and value < limit:
        return "灰尘转帐"
    row = conn.execute("SELECT sent, span_h FROM service_wallets WHERE chain=? AND address=? AND service=1", (chain, src)).fetchone()
    return service_note(chain, row["sent"], row["span_h"]) if row else ""


def funder_fanout(conn: sqlite3.Connection, chain: str, src: str) -> int:
    return conn.execute("SELECT COUNT(DISTINCT dst) FROM relations WHERE chain=? AND src=? AND rel_type='funding'", (chain, src)).fetchone()[0]


def _rpc(chain: str, method: str, params: list[Any]) -> Any:
    import urllib.request
    last = ""
    for url in SERVICE_RPC[chain]:
        try:
            req = urllib.request.Request(url, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                                         headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=25) as resp:
                data = json.loads(resp.read())
            if data.get("error") or data.get("result") is None:
                last = str(data.get("error") or "没有结果")[:80]
                continue
            return data["result"]
        except Exception as exc:
            last = str(exc)[:80]
    raise RuntimeError(f"{chain} 节点查不到：{last}")


def check_service(chain: str, address: str) -> tuple[int, int | None, float | None]:
    if chain == "Solana":
        sigs = _rpc(chain, "getSignaturesForAddress", [address, {"limit": 1000}]) or []
        times = [s.get("blockTime") for s in sigs if s.get("blockTime")]
        span = (max(times) - min(times)) / 3600 if len(times) > 1 else None
        return (1 if len(sigs) >= 1000 and span is not None and span < SERVICE_SOL_HOURS else 0), len(sigs), span
    sent = int(_rpc(chain, "eth_getTransactionCount", [address, "latest"]), 16)
    return (1 if sent >= SERVICE_EVM_SENT else 0), sent, None


SPOOF_EVM_CHARS = 6
SPOOF_SOL_CHARS = 5
SPOOF_STRICT_CHARS = 7
SPOOF_SCHEMA = """CREATE TABLE IF NOT EXISTS spoof_addresses (
  chain TEXT NOT NULL, address TEXT NOT NULL, mimics TEXT DEFAULT '', victim TEXT DEFAULT '', reason TEXT DEFAULT '',
  found_at INTEGER, PRIMARY KEY (chain, address)
)"""
RELATION_SCHEMA = SERVICE_SCHEMA + ";\n" + SPOOF_SCHEMA + ";\n"
SPOOF_RULE = (f"仿冒地址：同一个钱包的两个对手地址前后几码一样（EVM 合计 ≥ {SPOOF_EVM_CHARS} 码、SOL ≥ {SPOOF_SOL_CHARS} 码），"
              f"只转灰尘的那个、或两个都有金额时晚出现的那个（≥ {SPOOF_STRICT_CHARS} 码、不是 0000…8888 这种靓号）就是模仿的假地址；"
              f"有扫描纪录、有名字、你标过的、平台用户、公开实体不算。纪录照列、不拿来连钱包，也不留在钱包库（先封存、可还原）。")


def _is_dust(asset: Any, amount: Any) -> bool:
    limit, value = RELATION_DUST.get(str(asset or "")), num(amount)
    return limit is not None and value is not None and value < limit


def _addr_body(chain: str, address: str) -> str:
    return address if chain == "Solana" else address[2:].lower()


def _common_ends(a: str, b: str) -> tuple[int, int]:
    n = min(len(a), len(b))
    p = 0
    while p < n and a[p] == b[p]:
        p += 1
    s = 0
    while s < n - p and a[-1 - s] == b[-1 - s]:
        s += 1
    return p, s


def _spoof_protected(conn: sqlite3.Connection) -> set[str]:
    keep = user_marked(conn)
    keep |= {norm(r[0], r[1]) for r in conn.execute("SELECT DISTINCT chain, address FROM appearances")}
    keep |= {norm(r[0], r[1]) for r in conn.execute("SELECT chain, address FROM wallets WHERE COALESCE(name,'')<>'' OR COALESCE(twitter,'')<>''")}
    keep |= {norm(r[0], r[1]) for r in conn.execute("SELECT chain, address FROM platform_names")}
    return keep


def find_spoofs(conn: sqlite3.Connection) -> dict[tuple[str, str], tuple[str, str, str]]:
    peers: dict[tuple[str, str], dict[str, dict[str, Any]]] = {}
    for r in conn.execute("SELECT chain, src, dst, asset, amount, ts, public_entity FROM relations"):
        fam = "Solana" if r["chain"] == "Solana" else "evm"
        dust = _is_dust(r["asset"], r["amount"])
        for victim, other in ((r["dst"], r["src"]), (r["src"], r["dst"])):
            d = peers.setdefault((fam, victim), {}).setdefault(other, {"dust": True, "ts": None, "chains": set(), "public": False})
            d["dust"] = d["dust"] and dust
            if r["ts"]:
                d["ts"] = r["ts"] if d["ts"] is None else min(d["ts"], r["ts"])
            d["chains"].add(r["chain"])
            d["public"] = d["public"] or bool(r["public_entity"])
    keep = _spoof_protected(conn)
    found: dict[tuple[str, str], tuple[str, str, str]] = {}

    def mark(info: dict[str, Any], address: str, mimics: str, victim: str, reason: str) -> None:
        for chain in info["chains"]:
            if norm(chain, address) in keep:
                return
        for chain in info["chains"]:
            prev = found.get((chain, address))
            if prev is None or (mimics and not prev[0]):
                found[(chain, address)] = (mimics, victim, reason)

    for (fam, victim), others in peers.items():
        if len(others) < 2:
            continue
        tail, need = (2, SPOOF_SOL_CHARS) if fam == "Solana" else (3, SPOOF_EVM_CHARS)
        buckets: dict[str, list[str]] = {}
        for other in others:
            buckets.setdefault(_addr_body(fam, other)[-tail:], []).append(other)
        for group in buckets.values():
            for i, a in enumerate(group):
                for b in group[i + 1:]:
                    ba, bb = _addr_body(fam, a), _addr_body(fam, b)
                    p, s = _common_ends(ba, bb)
                    da, db = others[a], others[b]
                    if p + s < need or da["public"] or db["public"]:
                        continue
                    if da["dust"] and db["dust"]:
                        mark(da, a, "", victim, f"仿冒地址（跟 {b} 前 {p} 后 {s} 码一样，两个都只转灰尘）")
                        mark(db, b, "", victim, f"仿冒地址（跟 {a} 前 {p} 后 {s} 码一样，两个都只转灰尘）")
                    elif da["dust"] or db["dust"]:
                        fake, real = (a, b) if da["dust"] else (b, a)
                        mark(others[fake], fake, real, victim, f"仿冒地址（模仿 {real}，前 {p} 后 {s} 码一样、只转灰尘）")
                    elif (p + s >= SPOOF_STRICT_CHARS and not (len(set(ba[:p])) <= 1 and len(set(ba[len(ba) - s:])) <= 1)
                          and da["ts"] and db["ts"] and da["ts"] != db["ts"]):
                        fake, real = (a, b) if da["ts"] > db["ts"] else (b, a)
                        mark(others[fake], fake, real, victim, f"仿冒地址（模仿 {real}，前 {p} 后 {s} 码一样、比它晚出现）")
    return found


def refresh_spoofs(conn: sqlite3.Connection, now: int | None = None) -> int:
    now = int(now if now is not None else time.time())
    found = find_spoofs(conn)
    conn.execute("DELETE FROM spoof_addresses")
    conn.executemany("INSERT INTO spoof_addresses VALUES (?,?,?,?,?,?)",
                     [(chain, address, m, v, reason, now) for (chain, address), (m, v, reason) in found.items()])
    return len(found)


def spoof_set(conn: sqlite3.Connection) -> set[str]:
    return {norm(r[0], r[1]) for r in conn.execute("SELECT chain, address FROM spoof_addresses")}


def purge_spoofs(now: float | None = None, dry_run: bool = False) -> dict[str, Any]:
    now = int(now if now is not None else time.time())
    with LOCK:
        conn = connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            found = refresh_spoofs(conn, now)
            spoofs = spoof_set(conn) - _spoof_protected(conn)
            due = sorted((r["chain"], r["address"]) for r in conn.execute("SELECT chain, address FROM wallets") if norm(r["chain"], r["address"]) in spoofs)
            result: dict[str, Any] = {"ok": True, "at": now, "spoofs": found, "due": len(due), "deleted": 0, "archive": "", "dryRun": dry_run}
            if dry_run:
                conn.rollback()
                return result | {"addresses": [f"{c} {a}" for c, a in due]}
            if due:
                wallets = [dict(r) for key in due for r in conn.execute("SELECT * FROM wallets WHERE chain=? AND address=?", key)]
                apps = [dict(r) for key in due for r in conn.execute("SELECT * FROM appearances WHERE chain=? AND address=?", key)]
                reasons = {f"{r['chain']} {r['address']}": r["reason"] for r in conn.execute("SELECT * FROM spoof_addresses")}
                ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
                path = ARCHIVE_DIR / f"spoofs-{_local_time(now, '%Y%m%d-%H%M%S')}.json.gz"
                blob = gzip.compress(json.dumps({"version": 1, "kind": "spoof", "prunedAt": now, "rule": SPOOF_RULE, "wallets": wallets, "appearances": apps,
                                                 "reasons": {k: reasons.get(k, "") for k in (f"{c} {a}" for c, a in due)}}, ensure_ascii=False).encode("utf-8"))
                tmp = path.with_suffix(".tmp")
                with open(tmp, "wb") as fh:
                    fh.write(blob)
                    fh.flush()
                    os.fsync(fh.fileno())
                tmp.replace(path)
                back = json.loads(gzip.decompress(path.read_bytes()).decode("utf-8"))
                if len(back.get("wallets") or []) != len(wallets) or len(back.get("appearances") or []) != len(apps):
                    raise RuntimeError("封存文件读回笔数不符，这次不删")
                for key in due:
                    conn.execute("DELETE FROM appearances WHERE chain=? AND address=?", key)
                    conn.execute("DELETE FROM wallets WHERE chain=? AND address=?", key)
                result.update({"deleted": len(wallets), "archive": path.name})
            if due or not _state_get(conn, "spoofs:last"):
                _state_put(conn, "spoofs:last", result)
            conn.commit()
            return result
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def classify_funders(limit: int = SERVICE_BATCH) -> dict[str, Any]:
    now = int(time.time())
    with LOCK:
        conn = connect()
        try:
            todo = conn.execute(
                "SELECT r.chain, r.src, COUNT(DISTINCT r.dst) AS n FROM relations r WHERE r.rel_type='funding' AND r.public_entity=0 "
                "AND NOT EXISTS (SELECT 1 FROM service_wallets sw WHERE sw.chain=r.chain AND sw.address=r.src AND sw.checked_at>?) "
                "GROUP BY r.chain, r.src HAVING n>=2 ORDER BY n DESC LIMIT ?", (now - SERVICE_RECHECK, limit)).fetchall()
            inlib = {(r["chain"], r["src"]) for r in todo if _rows_for(conn, r["chain"], r["src"])}
        finally:
            conn.close()
    found: list[tuple[Any, ...]] = []
    failed = 0
    for r in todo:
        chain, src = r["chain"], r["src"]
        if (chain, src) in inlib:
            found.append((chain, src, 0, None, None, "钱包库内的钱包", now))
            continue
        if chain not in SERVICE_RPC:
            continue
        try:
            service, sent, span = check_service(chain, src)
        except RuntimeError:
            failed += 1
            continue
        found.append((chain, src, service, sent, span, service_note(chain, sent, span) if service else "", now))
        time.sleep(0.5 if chain == "Solana" else 0.1)
    if found:
        with LOCK:
            conn = connect()
            try:
                conn.executemany("INSERT OR REPLACE INTO service_wallets VALUES (?,?,?,?,?,?,?)", found)
                _state_put(conn, "funders:last", {"at": now, "checked": len(found), "service": sum(1 for f in found if f[2]), "failed": failed})
                conn.commit()
            finally:
                conn.close()
    return {"ok": True, "checked": len(found), "service": sum(1 for f in found if f[2]), "failed": failed, "left": max(0, len(todo) - len(found))}


def relabel_if_stale() -> int:
    with LOCK:
        conn = connect()
        try:
            if _state_get(conn, "labels:version") == LABELS_VERSION:
                return 0
            keys = conn.execute("SELECT chain, address FROM wallets").fetchall()
            for r in keys:
                recompute_labels(conn, r["chain"], r["address"])
            _state_put(conn, "labels:version", LABELS_VERSION)
            conn.commit()
            return len(keys)
        finally:
            conn.close()


def _rate_limited(exc: Exception) -> bool:
    text = str(exc).lower()
    return "限流" in text or "429" in text or "rate limit" in text


def _backfill(conn: sqlite3.Connection, chain: str, ca: str, items: list[dict[str, Any]], supply: float | None) -> int:
    filled, seen = 0, set()
    for h in items:
        address = norm(chain, h.get("address"))
        if not address or address in seen:
            continue
        seen.add(address)
        cost, sold_px = num(h.get("avg_cost")), num(h.get("avg_sold"))
        tags = {str(t) for t in (h.get("tags") or []) + (h.get("maker_token_tags") or [])}
        old = conn.execute("SELECT gmgn_tags FROM appearances WHERE chain=? AND address=? AND ca=? AND instr(COALESCE(source,''), ?)>0",
                           (chain, address, ca, PLATFORM_SOURCE)).fetchone()
        if old is not None:
            merged = json.dumps(sorted(set(loads(old["gmgn_tags"])) | tags))
            cur = conn.execute(
                "UPDATE appearances SET entry_ts=COALESCE(entry_ts,?), buy_mc=COALESCE(buy_mc,?), sell_mc=COALESCE(sell_mc,?), sold_pct=COALESCE(?, sold_pct), "
                "buy_usd=COALESCE(buy_usd,?), sell_usd=COALESCE(sell_usd,?), gmgn_tags=?, "
                "still_holding=CASE WHEN ?=0 THEN 0 ELSE still_holding END WHERE chain=? AND address=? AND ca=?",
                (num(h.get("start_holding_at")) or None, cost * supply if cost and supply else None, sold_px * supply if sold_px and supply else None,
                 num(h.get("sell_amount_percentage")), num(h.get("history_bought_cost")), num(h.get("history_sold_income")), merged,
                 num(h.get("amount_cur")), chain, address, ca))
            filled += cur.rowcount
        created = num(h.get("created_at"))
        if created:
            conn.execute("UPDATE wallets SET created_at=COALESCE(created_at, ?) WHERE chain=? AND address=?", (int(created), chain, address))
    return filled


def refresh_tokens(fetch: Any, now: float | None = None, limit: int = 10, pause: float = 2.0) -> dict[str, Any]:
    now = int(time.time() if now is None else now)
    with LOCK:
        conn = connect()
        try:
            rows = conn.execute(
                "SELECT chain, ca, backfill_at FROM tokens WHERE info_at IS NULL OR (info_at < ? AND (launch_ts IS NULL OR launch_ts > ?)) "
                "ORDER BY info_at IS NOT NULL, info_at", (now - TOKEN_REFRESH_SECONDS, now - TOKEN_REFRESH_DAYS * 86400)).fetchall()
            todo = []
            for r in rows:
                if r["chain"] not in GMGN_SLUG:
                    continue
                need = r["backfill_at"] is None and conn.execute(
                    "SELECT 1 FROM appearances WHERE chain=? AND ca=? AND instr(COALESCE(source,''), ?)>0 AND entry_ts IS NULL LIMIT 1",
                    (r["chain"], r["ca"], PLATFORM_SOURCE)).fetchone() is not None
                todo.append((r["chain"], r["ca"], need))
                if len(todo) >= limit:
                    break
        finally:
            conn.close()
    out: dict[str, Any] = {"todo": len(todo), "updated": 0, "backfilled": 0, "errors": [], "rateLimited": False}
    for chain, ca, need in todo:
        base = ["--chain", GMGN_SLUG[chain], "--address", ca]
        try:
            info = fetch(["token", "info", *base])
            info = info if isinstance(info, dict) else {}
            items: list[dict[str, Any]] = []
            if need:
                for command in (["token", "holders", *base, "--limit", "100", "--order-by", "amount_percentage"],
                                ["token", "traders", *base, "--limit", "100", "--order-by", "profit"]):
                    time.sleep(pause)
                    items += _gmgn_list(fetch(command))
        except Exception as exc:
            out["errors"].append(f"{chain} {ca}：{str(exc)[:120]}")
            if _rate_limited(exc):
                out["rateLimited"] = True
                break
            with LOCK:
                conn = connect()
                try:
                    conn.execute("UPDATE tokens SET info_at=? WHERE chain=? AND ca=?", (now - TOKEN_REFRESH_SECONDS + 6 * 3600, chain, ca))
                    conn.commit()
                finally:
                    conn.close()
            continue
        supply = num(info.get("total_supply")) or num(info.get("circulating_supply"))
        ath = num(info.get("ath_price"))
        launch = num(info.get("creation_timestamp")) or num(info.get("open_timestamp")) or None
        with LOCK:
            conn = connect()
            try:
                conn.execute("UPDATE tokens SET ath_mc=COALESCE(?, ath_mc), launch_ts=COALESCE(?, launch_ts), supply=COALESCE(?, supply), info_at=?, "
                             "symbol=COALESCE(NULLIF(symbol,''), ?) WHERE chain=? AND ca=?",
                             (ath * supply if ath and supply else None, int(launch) if launch else None, supply, now,
                              str(info.get("symbol") or ""), chain, ca))
                if need:
                    supply_now = num(conn.execute("SELECT supply FROM tokens WHERE chain=? AND ca=?", (chain, ca)).fetchone()["supply"])
                    out["backfilled"] += _backfill(conn, chain, ca, items, supply_now)
                    conn.execute("UPDATE tokens SET backfill_at=? WHERE chain=? AND ca=?", (now, chain, ca))
                for r in conn.execute("SELECT DISTINCT address FROM appearances WHERE chain=? AND ca=?", (chain, ca)).fetchall():
                    recompute_labels(conn, chain, r["address"])
                conn.commit()
                out["updated"] += 1
            finally:
                conn.close()
        time.sleep(pause)
    return out


def check_quiet_stats(fetch: Any, now: float | None = None, limit: int = 40, pause: float = 2.0) -> dict[str, Any]:
    now = int(time.time() if now is None else now)
    horizon = now - (PRUNE_AFTER_DAYS - STATS_BEFORE_DAYS) * 86400
    with LOCK:
        conn = connect()
        try:
            quiet = quiet_wallets(conn)
            keys = sorted((key for key, fs in quiet.items() if fs is not None and fs <= horizon and key[0] in GMGN_SLUG), key=lambda k: quiet[k])
            todo = [(key, conn.execute("SELECT COALESCE(pnl30_tries,0) FROM wallets WHERE chain=? AND address=?", key).fetchone()[0])
                    for key in _waiting_stats(conn, keys)]
        finally:
            conn.close()
    todo.sort(key=lambda item: quiet[item[0]])
    out: dict[str, Any] = {"todo": len(todo), "checked": 0, "longPnl": 0, "gaveUp": 0, "errors": [], "rateLimited": False}
    for (chain, address), tries in todo[:limit]:
        try:
            stats = fetch(["portfolio", "stats", "--chain", GMGN_SLUG[chain], "--wallet", address, "--period", "30d"])
            if not isinstance(stats, dict):
                raise RuntimeError("GMGN 30 天统计格式不对")
        except Exception as exc:
            out["errors"].append(f"{chain} {address}：{str(exc)[:120]}")
            if _rate_limited(exc):
                out["rateLimited"] = True
                break
            with LOCK:
                conn = connect()
                try:
                    if tries + 1 >= STATS_MAX_TRIES:
                        conn.execute("UPDATE wallets SET pnl30_tries=?, pnl30_at=?, pnl30_note=? WHERE chain=? AND address=?",
                                     (tries + 1, now, f"GMGN 查不到：{str(exc)[:80]}", chain, address))
                        out["gaveUp"] += 1
                    else:
                        conn.execute("UPDATE wallets SET pnl30_tries=? WHERE chain=? AND address=?", (tries + 1, chain, address))
                    conn.commit()
                finally:
                    conn.close()
            continue
        pnl = stats.get("pnl_stat") if isinstance(stats.get("pnl_stat"), dict) else {}
        with LOCK:
            conn = connect()
            try:
                conn.execute("UPDATE wallets SET pnl30_realized=?, pnl30_winrate=?, pnl30_tokens=?, pnl30_at=?, pnl30_note='', pnl30_tries=?, "
                             "pnl30_buys=?, pnl30_sells=?, pnl30_raw=? WHERE chain=? AND address=?",
                             (num(stats.get("realized_profit")), num(pnl.get("winrate")), num(pnl.get("token_num")), now, tries + 1,
                              num(stats.get("buy")), num(stats.get("sell")), stats_raw(stats), chain, address))
                labels = recompute_labels(conn, chain, address)
                conn.commit()
            finally:
                conn.close()
        out["checked"] += 1
        out["longPnl"] += "long_pnl" in labels
        time.sleep(pause)
    return out


def refresh_platform_strength(fetch: Any, now: float | None = None, limit: int = PF_PER_ROUND, pause: float = 2.0) -> dict[str, Any]:
    now = int(time.time() if now is None else now)
    with LOCK:
        conn = connect()
        try:
            rows = conn.execute(
                "SELECT DISTINCT w.chain, w.address, w.pf_at, COALESCE(w.pf_tries,0) AS tries FROM platform_names p "
                "JOIN wallets w ON " + same_wallet_sql("w") + " WHERE w.pf_at IS NULL OR w.pf_at < ? "
                "ORDER BY w.pf_at IS NOT NULL, w.pf_at, w.address", (now - PF_REFRESH_DAYS * 86400,)).fetchall()
        finally:
            conn.close()
    todo = [(r["chain"], r["address"], r["tries"]) for r in rows if r["chain"] in GMGN_SLUG][:limit]
    out: dict[str, Any] = {"todo": len(todo), "checked": 0, "gaveUp": 0, "errors": [], "rateLimited": False}

    def fail(chain: str, address: str, tries: int, exc: Exception) -> None:
        with LOCK:
            conn = connect()
            try:
                if tries + 1 >= PF_MAX_TRIES:
                    conn.execute("UPDATE wallets SET pf_tries=0, pf_at=?, pf_note=? WHERE chain=? AND address=?",
                                 (now, f"GMGN 查不到：{str(exc)[:80]}", chain, address))
                    out["gaveUp"] += 1
                else:
                    conn.execute("UPDATE wallets SET pf_tries=? WHERE chain=? AND address=?", (tries + 1, chain, address))
                conn.commit()
            finally:
                conn.close()

    for chain in dict.fromkeys(c for c, _, _ in todo):
        group = [(a, t) for c, a, t in todo if c == chain]
        slug = GMGN_SLUG[chain]
        try:
            data = fetch(["portfolio", "profits", "--chain", slug, *[x for a, _ in group for x in ("--wallet", a)], "--period", "all"])
            profits = {norm(chain, p.get("wallet_address")): p for p in _gmgn_list(data)}
        except Exception as exc:
            out["errors"].append(f"{chain} 历史总盈利：{str(exc)[:120]}")
            if _rate_limited(exc):
                out["rateLimited"] = True
                return out
            profits = {}
        for address, tries in group:
            time.sleep(pause)
            try:
                stats = fetch(["portfolio", "stats", "--chain", slug, "--wallet", address, "--period", "30d"])
                if not isinstance(stats, dict):
                    raise RuntimeError("GMGN 30 天统计格式不对")
                time.sleep(pause)
                top = _gmgn_list(fetch(["portfolio", "holdings", "--chain", slug, "--wallet", address, "--order-by", "total_profit",
                                        "--direction", "desc", "--limit", "1", "--hide-closed", "false"]))
            except Exception as exc:
                out["errors"].append(f"{chain} {address}：{str(exc)[:120]}")
                if _rate_limited(exc):
                    out["rateLimited"] = True
                    return out
                fail(chain, address, tries, exc)
                continue
            prof = profits.get(address) or {}
            pnl = stats.get("pnl_stat") if isinstance(stats.get("pnl_stat"), dict) else {}
            head = top[0] if top else {}
            token = head.get("token") if isinstance(head.get("token"), dict) else {}
            best_profit = num(head.get("total_profit"))
            if not token or best_profit is None or best_profit <= 0:
                token, best_profit = {}, None
            realized = num(prof.get("total_realized_profit"))
            with LOCK:
                conn = connect()
                try:
                    conn.execute(
                        "UPDATE wallets SET pf_total=?, pf_realized=?, pf_buys=?, pf_sells=?, pf_best_symbol=?, pf_best_ca=?, pf_best_profit=?, "
                        "pf_at=?, pf_tries=0, pf_note='', pnl30_realized=?, pnl30_winrate=?, pnl30_tokens=?, pnl30_at=?, pnl30_note='', "
                        "pnl30_buys=?, pnl30_sells=?, pnl30_raw=? WHERE chain=? AND address=?",
                        (num(prof.get("total_profit")), realized if realized is not None else num(prof.get("realized_profit")),
                         num(prof.get("buy")), num(prof.get("sell")), str(token.get("symbol") or ""),
                         norm(chain, token.get("token_address") or token.get("address")), best_profit, now,
                         num(stats.get("realized_profit")), num(pnl.get("winrate")), num(pnl.get("token_num")), now,
                         num(stats.get("buy")), num(stats.get("sell")), stats_raw(stats), chain, address))
                    recompute_labels(conn, chain, address)
                    conn.commit()
                finally:
                    conn.close()
            out["checked"] += 1
        time.sleep(pause)
    return out


def refresh_pump_pnl(lookup: Any, now: float | None = None, limit: int = PLAT_CAS_PER_ROUND) -> dict[str, Any]:
    now = int(time.time() if now is None else now)
    with LOCK:
        conn = connect()
        try:
            rows = conn.execute("SELECT chain, address, handle, cas FROM platform_names WHERE platform='pump.fun'").fetchall()
            tried = _state_get(conn, "pump_pnl_at") or {}
            blocked = int(_state_get(conn, "pump_pnl_blocked") or 0)
        finally:
            conn.close()
    if now - blocked < PUMP_BLOCK_SECONDS:
        return {"todo": 0, "coins": 0, "updated": 0, "missing": 0, "errors": [], "blocked": blocked,
                "note": "pump.fun 挡服务器直接查（HTTP 403），先停 24 小时；改在 pump.fun 页按「盈利」书签更新"}
    users: dict[tuple[str, str], dict[str, str]] = {}
    for r in rows:
        for ca in loads(r["cas"]):
            users.setdefault((r["chain"], ca), {})[r["handle"]] = r["address"]
    last = lambda key: int(tried.get(f"{key[0]}:{key[1]}") or 0)
    due = sorted((key for key in users if now - last(key) >= PLAT_REFRESH_SECONDS), key=last)
    out: dict[str, Any] = {"todo": len(due), "coins": 0, "updated": 0, "missing": 0, "errors": []}
    for chain, ca in due[:limit]:
        try:
            found = lookup(ca, set(users[(chain, ca)]))
        except Exception as exc:
            out["errors"].append(f"{chain} {ca}：{str(exc)[:120]}")
            if "HTTP 403" in str(exc):
                with LOCK:
                    conn = connect()
                    try:
                        _state_put(conn, "pump_pnl_blocked", now)
                        conn.commit()
                    finally:
                        conn.close()
                out["blocked"] = now
                break
            continue
        with LOCK:
            conn = connect()
            try:
                for handle, address in users[(chain, ca)].items():
                    hit = found.get(handle) or {}
                    if num(hit.get("pnl")) is None:
                        out["missing"] += 1
                        continue
                    cur = conn.execute("UPDATE appearances SET plat_src='pump.fun', plat_pnl=?, plat_realized=?, plat_cost=?, plat_at=? "
                                       "WHERE chain=? AND address=? AND ca=?",
                                       (num(hit.get("pnl")), num(hit.get("realized")), num(hit.get("cost")), now, chain, address, ca))
                    out["updated"] += cur.rowcount
                    recompute_labels(conn, chain, address)
                tried = (_state_get(conn, "pump_pnl_at") or {}) | {f"{chain}:{ca}": now}
                _state_put(conn, "pump_pnl_at", tried)
                conn.commit()
            finally:
                conn.close()
        out["coins"] += 1
    return out


def plat_accounts_index(conn: sqlite3.Connection, chain: str = "", address: str = "") -> dict[tuple[str, str], dict[str, dict[str, Any]]]:
    sql, args = "SELECT * FROM plat_accounts WHERE 1=1", []
    if chain:
        sql += " AND chain=?"; args.append(chain)
    if address:
        sql += " AND address=?"; args.append(address)
    out: dict[tuple[str, str], dict[str, dict[str, Any]]] = {}
    for r in conn.execute(sql, args):
        out.setdefault((r["chain"], r["address"]), {})[r["platform"]] = {
            "handle": r["handle"] or "", "wallet": r["wallet"] or "", "total": r["total"], "realized": r["realized"], "cost": r["cost"],
            "coins": r["coins"], "wins": r["wins"], "untrusted": r["untrusted"], "trades": r["trades"], "since": r["since"],
            "partial": bool(r["partial"]), "at": r["at"], "tried": r["tried"], "note": r["note"] or ""}
    return out


FOMO_BOARD_PERIODS = ("24h", "7d", "30d", "all")


def fomo_board_pnl_save(users: list[dict[str, Any]]) -> int:
    now = int(time.time())
    saved = 0
    with LOCK:
        conn = connect()
        try:
            for u in users:
                handle = str(u.get("handle") or "").strip().lower()[:80]
                pnl = u.get("pnl") if isinstance(u.get("pnl"), dict) else {}
                if not handle:
                    continue
                for period in FOMO_BOARD_PERIODS:
                    value = num(pnl.get(period))
                    if value is None or not math.isfinite(value) or abs(value) >= 1e10:
                        continue
                    rank = num((u.get("ranks") or {}).get(period)) if isinstance(u.get("ranks"), dict) else None
                    field = str((u.get("fields") or {}).get(period) or "")[:40] if isinstance(u.get("fields"), dict) else ""
                    conn.execute("INSERT INTO fomo_board_pnl (handle, period, pnl, rank, field, at) VALUES (?,?,?,?,?,?) "
                                 "ON CONFLICT(handle, period) DO UPDATE SET pnl=excluded.pnl, rank=excluded.rank, field=excluded.field, at=excluded.at",
                                 (handle, period, value, int(rank) if rank and 0 < rank < 100000 else None, field, now))
                    saved += 1
            conn.commit()
        finally:
            conn.close()
    return saved


def fomo_board_pnl_index(conn: sqlite3.Connection) -> dict[str, dict[str, dict[str, Any]]]:
    out: dict[str, dict[str, dict[str, Any]]] = {}
    for r in conn.execute("SELECT handle, period, pnl, rank, field, at FROM fomo_board_pnl"):
        out.setdefault(r["handle"], {})[r["period"]] = {"pnl": r["pnl"], "rank": r["rank"], "field": r["field"] or "", "at": r["at"]}
    return out


def fomo_pnl_for(platform_rows: list[dict[str, Any]] | None, index: dict[str, dict[str, dict[str, Any]]]) -> dict[str, dict[str, Any]] | None:
    out: dict[str, dict[str, Any]] = {}
    for p in platform_rows or []:
        if p.get("platform") != "FOMO":
            continue
        for period, entry in (index.get(str(p.get("handle") or "").lower()) or {}).items():
            if period not in out or (entry.get("at") or 0) > (out[period].get("at") or 0):
                out[period] = entry
    return out or None


def fomo_board_pnl_stats() -> dict[str, Any]:
    with LOCK:
        conn = connect()
        try:
            rows = conn.execute("SELECT DISTINCT p.chain, p.address, p.handle FROM platform_names p JOIN wallets w "
                                "ON w.chain=p.chain AND w.address=p.address WHERE p.platform='FOMO'").fetchall()
            periods: dict[str, set[str]] = {}
            last = 0
            for r in conn.execute("SELECT handle, period, at FROM fomo_board_pnl"):
                periods.setdefault(r["handle"], set()).add(r["period"])
                last = max(last, int(r["at"] or 0))
        finally:
            conn.close()
    wallets: dict[tuple[str, str], set[str]] = {}
    for r in rows:
        wallets.setdefault((r["chain"], r["address"]), set()).update(periods.get(str(r["handle"] or "").lower(), set()))
    return {"total": len(wallets), "withPnl": sum(1 for v in wallets.values() if v), "withAll": sum(1 for v in wallets.values() if "all" in v),
            "handles": len(periods), "lastAt": last or None}


def rename_platform_handle(conn: sqlite3.Connection, chain: str, address: str, platform: str, new: str) -> list[str]:
    rows = conn.execute("SELECT * FROM platform_names WHERE chain=? AND address=? AND platform=?", (chain, address, platform)).fetchall()
    if not rows or not new:
        return []
    cas: list[str] = []
    for r in rows:
        for ca in loads(r["cas"]):
            if ca not in cas:
                cas.append(ca)
    rows = sorted(rows, key=lambda r: -(r["last_seen"] or 0))
    pick = lambda k: next((r[k] for r in rows if r[k] not in (None, "")), None)
    firsts = [r["first_seen"] for r in rows if r["first_seen"]]
    conn.execute("DELETE FROM platform_names WHERE chain=? AND address=? AND platform=?", (chain, address, platform))
    conn.execute("INSERT INTO platform_names(chain, address, platform, handle, x, followers, verified, cas, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?)",
                 (chain, address, platform, new, pick("x") or "", pick("followers"), pick("verified"), json.dumps(cas),
                  min(firsts) if firsts else None, rows[0]["last_seen"]))
    return [r["handle"] for r in rows]


def _platform_handle(raw: Any, address: str) -> tuple[str, str]:
    name = re.sub(r"\s+", " ", str(raw or "")).strip()[:40]
    if not name:
        return "", "没有名称"
    if any(ord(c) < 32 or 0x7f <= ord(c) < 0xa0 for c in name):
        return "", "名称有控制字符"
    try:
        name.encode("utf-8")
    except UnicodeEncodeError:
        return "", "名称有半个字符"
    bare = re.sub(r"[\s.…_\-]+", "", name)
    if FULL_ADDRESS.fullmatch(name) or (len(bare) >= 4 and (bare.lower() in address.lower() or address.lower().startswith(bare.lower()[:4]) and "…" in name)):
        return "", "没有名称（显示的是地址）"
    if re.fullmatch(r"[+\-−]?\$?[\d.,]+[kmb]?", name.lower()):
        return "", "名称像金额"
    return name, ""


def platform_names_add(chain: str, platform: str, items: list[dict[str, Any]], ca: str = "", rename: bool = False) -> dict[str, Any]:
    if chain not in {"BSC", "Solana", "Robinhood"} or platform not in {"FOMO", "pump.fun"}:
        raise ValueError("平台名字的链或平台不对")
    now = int(time.time())
    ca = norm(chain, ca) if ca else ""
    status: dict[str, str] = {}
    renamed: list[dict[str, Any]] = []
    in_lib = 0
    created: list[str] = []
    with LOCK:
        conn = connect()
        try:
            for it in items:
                address = norm(chain, it.get("address"))
                handle = str(it.get("handle") or "").strip()[:80]
                if not FULL_ADDRESS.fullmatch(address) or not handle or address in status:
                    continue
                x = re.sub(r"[^A-Za-z0-9_]", "", str(it.get("x") or "").lstrip("@"))[:15]
                followers = num(it.get("followers"))
                verified = None if it.get("verified") is None else int(bool(it.get("verified")))
                wchains = same_wallet_chains(chain)
                rows = conn.execute(f"SELECT chain, handle, cas FROM platform_names WHERE chain IN ({','.join('?' * len(wchains))}) AND address=? AND platform=?",
                                    (*wchains, address, platform)).fetchall()
                eq = lambda r: str(r["handle"]).lower() == handle.lower()
                same_here = next((r for r in rows if r["chain"] == chain and eq(r)), None)
                same = same_here or next((r for r in rows if eq(r)), None)
                fix = [c for c in dict.fromkeys(r["chain"] for r in rows if not eq(r)) if c != chain or not same_here]
                if rename and fix:
                    old: list[str] = []
                    for c in fix:
                        old += [h for h in rename_platform_handle(conn, c, address, platform, handle) if h not in old]
                    renamed.append({"chain": chain, "address": address, "old": old, "new": handle})
                    status[address] = "renamed"
                    rows = conn.execute("SELECT chain, handle, cas FROM platform_names WHERE chain=? AND address=? AND platform=?", (chain, address, platform)).fetchall()
                    same_here = next((r for r in rows if eq(r)), None)
                    handle = same_here["handle"] if same_here else (same["handle"] if same else handle)
                else:
                    status[address] = "same" if same else "new"
                    handle = same["handle"] if same else handle
                cas = loads(same_here["cas"]) if same_here else []
                if ca and ca not in cas:
                    cas.append(ca)
                conn.execute("INSERT INTO platform_names(chain, address, platform, handle, x, followers, verified, cas, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?) "
                             "ON CONFLICT(chain, address, platform, handle) DO UPDATE SET x=COALESCE(NULLIF(excluded.x,''), platform_names.x), "
                             "followers=COALESCE(excluded.followers, platform_names.followers), verified=COALESCE(excluded.verified, platform_names.verified), "
                             "cas=excluded.cas, last_seen=excluded.last_seen",
                             (chain, address, platform, handle, x, int(followers) if followers is not None else None, verified, json.dumps(cas), now, now))
                conn.execute(f"DELETE FROM bot_wallets WHERE chain IN ({','.join('?' * len(wchains))}) AND address=?", (*wchains, address))
                lib_chains = [r[0] for r in conn.execute(f"SELECT chain FROM wallets WHERE chain IN ({','.join('?' * len(wchains))}) AND address=?", (*wchains, address))]
                if lib_chains:
                    in_lib += 1
                    for c in lib_chains:
                        recompute_labels(conn, c, address)
                elif (ADDRESS_RE[chain].match(address)
                      and not conn.execute(f"SELECT 1 FROM lib_removed WHERE chain IN ({','.join('?' * len(wchains))}) AND address=?", (*wchains, address)).fetchone()
                      and _ensure_wallet(conn, chain, address, now)):
                    recompute_labels(conn, chain, address)
                    created.append(address)
            conn.commit()
        finally:
            conn.close()
    return {"ok": True, "status": status, "renamed": renamed, "inLibrary": in_lib, "created": created}


PUMP_BOARD_LOG = DATA_DIR / "logs" / "pump-board.jsonl"


def pump_board_import(payload: dict[str, Any]) -> dict[str, Any]:
    board = payload.get("board")
    lists = board.get("lists") if isinstance(board, dict) else None
    if not isinstance(lists, list) or not lists or len(lists) > 8:
        raise ValueError("排行榜格式不对")
    skipped: dict[str, int] = {}
    picked: dict[tuple[str, str], dict[str, Any]] = {}
    for lst in lists:
        if not isinstance(lst, dict) or not isinstance(lst.get("rows"), list):
            continue
        kind = re.sub(r"[^\w\u4e00-\u9fff]", "", str(lst.get("kind") or ""))[:8] or "排行榜"
        for r in lst["rows"][:200]:
            address = str((r or {}).get("address") or "").strip() if isinstance(r, dict) else ""
            if not FULL_ADDRESS.fullmatch(address):
                skipped["地址不对"] = skipped.get("地址不对", 0) + 1
                continue
            chain = "BSC" if address.startswith("0x") else "Solana"
            address = norm(chain, address)
            handle, why = _platform_handle(r.get("name"), address)
            if why:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            rank = num(r.get("rank"))
            picked.setdefault((chain, address), {"chain": chain, "address": address, "handle": handle, "kind": kind,
                                                 "rank": int(rank) if rank else 0, "x": re.sub(r"[^A-Za-z0-9_]", "", str(r.get("x") or ""))[:15],
                                                 "value": re.sub(r"[^\d$+\-−.,KMBkmb ]", "", str(r.get("value") or ""))[:24]})
    rows = list(picked.values())
    out = {"ok": True, "bound": 0, "added": 0, "same": 0, "renamed": [], "inLibrary": 0, "libAdded": 0, "skipped": skipped, "rows": []}
    created: set[str] = set()
    for chain in ("Solana", "BSC"):
        part = [r for r in rows if r["chain"] == chain]
        if not part:
            continue
        res = platform_names_add(chain, "pump.fun", part, rename=True)
        olds = {x["address"]: "／".join(x["old"]) for x in res["renamed"]}
        out["renamed"] += res["renamed"]
        out["inLibrary"] += res["inLibrary"]
        created |= set(res.get("created") or [])
        out["libAdded"] += len(res.get("created") or [])
        for r in part:
            st = res["status"].get(r["address"])
            if not st:
                continue
            out["bound"] += 1
            out["added"] += st == "new"
            out["same"] += st == "same"
            out["rows"].append({**r, "status": st, "old": olds.get(r["address"], "")})
    if out["rows"]:
        lib = set()
        with LOCK:
            conn = connect()
            try:
                for r in out["rows"]:
                    chains = same_wallet_chains(r["chain"])
                    if conn.execute(f"SELECT 1 FROM wallets WHERE chain IN ({','.join('?' * len(chains))}) AND address=?", (*chains, r["address"])).fetchone():
                        lib.add(r["address"])
            finally:
                conn.close()
        for r in out["rows"]:
            r["libNew"] = r["address"] in created
            r["inLibrary"] = r["address"] in lib and not r["libNew"]
        try:
            PUMP_BOARD_LOG.parent.mkdir(parents=True, exist_ok=True)
            with PUMP_BOARD_LOG.open("a", encoding="utf-8") as f:
                now = int(time.time())
                for r in out["rows"]:
                    f.write(json.dumps({"at": now, **{k: r[k] for k in ("chain", "address", "handle", "kind", "rank", "x", "status", "old")}}, ensure_ascii=False) + "\n")
        except OSError:
            pass
    return out


def pump_sync_list(payload: dict[str, Any]) -> dict[str, Any]:
    everyone = bool(payload.get("all"))
    now = int(time.time())
    with LOCK:
        conn = connect()
        try:
            rows = conn.execute("SELECT p.chain, p.address, p.handle, p.cas FROM platform_names p JOIN wallets w "
                                "ON w.chain=p.chain AND w.address=p.address WHERE p.platform='pump.fun' ORDER BY p.chain, p.address").fetchall()
            accts = plat_accounts_index(conn)
        finally:
            conn.close()
    people: dict[tuple[str, str], dict[str, Any]] = {}
    for r in rows:
        p = people.setdefault((r["chain"], r["address"]), {"chain": r["chain"], "address": r["address"], "handles": [], "cas": []})
        if r["handle"] and r["handle"] not in p["handles"]:
            p["handles"].append(r["handle"])
        for ca in loads(r["cas"]):
            if ca not in p["cas"]:
                p["cas"].append(ca)
    due: list[tuple[tuple[int, int], dict[str, Any]]] = []
    synced = failed = 0
    oldest: int | None = None
    for key, p in people.items():
        a = (accts.get(key) or {}).get("pump.fun") or {}
        at, tried = a.get("at"), a.get("tried")
        if at:
            synced += 1
            oldest = at if oldest is None else min(oldest, at)
        last_failed = bool(tried) and (not at or tried > at)
        failed += last_failed
        if not tried:
            rank, ok = (0, 0), True
        elif last_failed and str(a.get("note") or "").startswith("帐号名称对不上"):
            rank, ok = (-1, tried), True
        elif last_failed:
            rank, ok = (2, tried), now - tried >= PUMP_SYNC_RETRY_HOURS * 3600
        else:
            rank, ok = (1, at), now - at >= PUMP_SYNC_STALE_HOURS * 3600
        if ok or everyone:
            due.append((rank, p | {"cas": p["cas"][:50]}))
    due.sort(key=lambda item: item[0])
    return {"ok": True, "items": [p for _, p in due], "total": len(people), "synced": synced, "failed": failed, "oldest": oldest,
            "staleHours": PUMP_SYNC_STALE_HOURS, "retryHours": PUMP_SYNC_RETRY_HOURS, "rule": PLAT_ACCT_RULE}


def pump_sync_import(payload: dict[str, Any]) -> dict[str, Any]:
    results = payload.get("results")
    if not isinstance(results, list) or not results or len(results) > 50:
        raise ValueError("pump.fun 战绩格式不对（一次 1～50 笔）")
    now = int(time.time())
    out: dict[str, Any] = {"ok": True, "saved": 0, "failed": 0, "coins": 0, "rejected": [], "renamed": []}
    with LOCK:
        conn = connect()
        try:
            for item in results:
                if not isinstance(item, dict):
                    out["rejected"].append({"error": "格式不对"})
                    continue
                chain = str(item.get("chain") or "")
                address = norm(chain, item.get("address"))
                handles = [r["handle"] for r in conn.execute(
                    "SELECT handle FROM platform_names WHERE chain=? AND address=? AND platform='pump.fun'", (chain, address))]
                if not handles or not conn.execute("SELECT 1 FROM wallets WHERE chain=? AND address=?", (chain, address)).fetchone():
                    out["rejected"].append({"chain": chain, "address": address, "error": "钱包库没有这个 pump.fun 用户"})
                    continue
                error = str(item.get("error") or "").strip()[:200]
                handle = str(item.get("handle") or "").strip()[:80]
                same = handle.lower() in {h.lower() for h in handles}
                renamed = "" if error or same else (f"pump.fun 帐号改名：钱包库原本记 {'／'.join(handles)}，已更正为 {handle}" if handle
                                                    else f"pump.fun 帐号现在没有名称，钱包库照旧记 {'／'.join(handles)}")[:200]
                total, coins = num(item.get("total")), num(item.get("coins"))
                if not error and (total is None or coins is None or coins < 0):
                    error = "pump.fun 没给盈亏数字"
                if error:
                    conn.execute("INSERT INTO plat_accounts (chain, address, platform, tried, note) VALUES (?,?,?,?,?) "
                                 "ON CONFLICT(chain, address, platform) DO UPDATE SET tried=excluded.tried, note=excluded.note",
                                 (chain, address, "pump.fun", now, error))
                    out["failed"] += 1
                    continue
                count = lambda k: max(0, int(num(item.get(k)) or 0))
                since = num(item.get("since"))
                conn.execute(
                    "INSERT INTO plat_accounts (chain, address, platform, handle, wallet, total, realized, cost, coins, wins, untrusted, trades, "
                    "since, partial, at, tried, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(chain, address, platform) DO UPDATE SET "
                    "handle=excluded.handle, wallet=excluded.wallet, total=excluded.total, realized=excluded.realized, cost=excluded.cost, "
                    "coins=excluded.coins, wins=excluded.wins, untrusted=excluded.untrusted, trades=excluded.trades, since=excluded.since, "
                    "partial=excluded.partial, at=excluded.at, tried=excluded.tried, note=excluded.note",
                    (chain, address, "pump.fun", handle, str(item.get("wallet") or "")[:64], total, num(item.get("realized")), num(item.get("cost")),
                     int(coins), count("wins"), count("untrusted"), count("trades"), int(since) if since and since > 0 else None,
                     1 if item.get("partial") else 0, now, now, renamed))
                if renamed and handle:
                    out["renamed"].append({"chain": chain, "address": address, "old": rename_platform_handle(conn, chain, address, "pump.fun", handle),
                                           "new": handle})
                for lib in (item.get("lib") or [])[:50]:
                    pnl = num(lib.get("pnl")) if isinstance(lib, dict) else None
                    if pnl is None:
                        continue
                    cur = conn.execute("UPDATE appearances SET plat_src='pump.fun', plat_pnl=?, plat_realized=?, plat_cost=?, plat_at=? "
                                       "WHERE chain=? AND address=? AND ca=? AND COALESCE(plat_src, '') IN ('', 'pump.fun')",
                                       (pnl, num(lib.get("realized")), num(lib.get("cost")), now, chain, address, norm(chain, lib.get("ca"))))
                    out["coins"] += cur.rowcount
                recompute_labels(conn, chain, address)
                out["saved"] += 1
            conn.commit()
        finally:
            conn.close()
    return out


def _tier_pending(conn: sqlite3.Connection) -> list[tuple[str, str, int, int]]:
    return [(r["chain"], r["address"], r["bot_tries"] or 0, 0) for r in conn.execute(
        "SELECT chain, address, bot_tries FROM wallets WHERE pnl30_buys IS NULL AND pnl30_tokens>=? AND COALESCE(bot_tries,0)<? "
        "ORDER BY pnl30_tokens DESC", (BOT_TOKENS_30D, BOT_MAX_TRIES)) if r["chain"] in GMGN_SLUG]


def check_bot_stats(fetch: Any, now: float | None = None, limit: int = BOT_CHECK_PER_ROUND, pause: float = 2.0) -> dict[str, Any]:
    now = int(time.time() if now is None else now)
    with LOCK:
        conn = connect()
        try:
            quiet = quiet_wallets(conn)
            sm = sm_activity(conn)
            todo = _bot_pending(conn, quiet, sm, bot_wallets_now(conn, sm))
            seen = {(c, a) for c, a, _, _ in todo}
            todo += [t for t in _tier_pending(conn) if (t[0], t[1]) not in seen]
        finally:
            conn.close()
    out: dict[str, Any] = {"todo": len(todo), "checked": 0, "bots": 0, "gaveUp": 0, "errors": [], "rateLimited": False}
    for chain, address, tries, _ in todo[:limit]:
        try:
            stats = fetch(["portfolio", "stats", "--chain", GMGN_SLUG[chain], "--wallet", address, "--period", "30d"])
            if not isinstance(stats, dict):
                raise RuntimeError("GMGN 30 天统计格式不对")
        except Exception as exc:
            out["errors"].append(f"{chain} {address}：{str(exc)[:120]}")
            if _rate_limited(exc):
                out["rateLimited"] = True
                break
            with LOCK:
                conn = connect()
                try:
                    conn.execute("UPDATE wallets SET bot_tries=? WHERE chain=? AND address=?", (tries + 1, chain, address))
                    conn.commit()
                finally:
                    conn.close()
            out["gaveUp"] += tries + 1 >= BOT_MAX_TRIES
            continue
        pnl = stats.get("pnl_stat") if isinstance(stats.get("pnl_stat"), dict) else {}
        buys, sells = num(stats.get("buy")), num(stats.get("sell"))
        with LOCK:
            conn = connect()
            try:
                conn.execute("UPDATE wallets SET pnl30_realized=?, pnl30_winrate=?, pnl30_tokens=?, pnl30_buys=?, pnl30_sells=?, pnl30_at=?, pnl30_note='', "
                             "pnl30_raw=? WHERE chain=? AND address=?",
                             (num(stats.get("realized_profit")), num(pnl.get("winrate")), num(pnl.get("token_num")),
                              buys if buys is not None else 0, sells if sells is not None else 0, now, stats_raw(stats), chain, address))
                recompute_labels(conn, chain, address)
                conn.commit()
            finally:
                conn.close()
        out["checked"] += 1
        out["bots"] += bool(bot_reason((), (buys or 0) + (sells or 0), num(pnl.get("token_num"))))
        time.sleep(pause)
    return out


def purge_bots(now: float | None = None, dry_run: bool = False) -> dict[str, Any]:
    now = int(now if now is not None else time.time())
    with LOCK:
        conn = connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            bots = bot_wallets_now(conn)
            marked = bot_keep(conn)
            due = sorted(key for key in bots if norm(*key) not in marked)
            result: dict[str, Any] = {"ok": True, "at": now, "found": len(bots), "kept": len(bots) - len(due), "due": len(due),
                                      "deleted": 0, "archive": "", "dryRun": dry_run}
            if dry_run:
                conn.rollback()
                return result | {"reasons": {f"{c} {a}": bots[(c, a)] for c, a in due}}
            if due:
                wallets = [dict(r) for key in due for r in conn.execute("SELECT * FROM wallets WHERE chain=? AND address=?", key)]
                apps = [dict(r) for key in due for r in conn.execute("SELECT * FROM appearances WHERE chain=? AND address=?", key)]
                ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
                path = ARCHIVE_DIR / f"bots-{_local_time(now, '%Y%m%d-%H%M%S')}.json.gz"
                blob = gzip.compress(json.dumps({"version": 1, "kind": "bot", "prunedAt": now, "rule": BOT_RULE, "wallets": wallets, "appearances": apps,
                                                 "reasons": {f"{c} {a}": bots[(c, a)] for c, a in due}}, ensure_ascii=False).encode("utf-8"))
                tmp = path.with_suffix(".tmp")
                with open(tmp, "wb") as fh:
                    fh.write(blob)
                    fh.flush()
                    os.fsync(fh.fileno())
                tmp.replace(path)
                back = json.loads(gzip.decompress(path.read_bytes()).decode("utf-8"))
                if len(back.get("wallets") or []) != len(wallets) or len(back.get("appearances") or []) != len(apps):
                    raise RuntimeError("封存文件读回笔数不符，这次不删")
                for key in due:
                    conn.execute("DELETE FROM appearances WHERE chain=? AND address=?", key)
                    conn.execute("DELETE FROM wallets WHERE chain=? AND address=?", key)
                    conn.execute("INSERT OR REPLACE INTO bot_wallets(chain, address, reason, at) VALUES (?,?,?,?)", (*key, bots[key], now))
                result.update({"deleted": len(wallets), "archive": path.name})
            if due or not _state_get(conn, "bots:last"):
                _state_put(conn, "bots:last", result)
            _state_put(conn, "bots:error", None)
            conn.commit()
            return result
        except Exception as exc:
            conn.rollback()
            try:
                _state_put(conn, "bots:error", {"at": now, "error": str(exc)[:300]})
                conn.commit()
            except sqlite3.Error:
                pass
            raise
        finally:
            conn.close()


def restore_archive(path: str | Path) -> dict[str, Any]:
    data = json.loads(gzip.decompress(Path(path).read_bytes()).decode("utf-8"))
    now = int(time.time())
    with LOCK:
        conn = connect()
        try:
            wcols = {c[1] for c in conn.execute("PRAGMA table_info(wallets)")}
            acols = {c[1] for c in conn.execute("PRAGMA table_info(appearances)")}
            restored = 0
            for w in data.get("wallets") or []:
                row = {k: v for k, v in w.items() if k in wcols} | {"first_seen": now}
                cur = conn.execute(f"INSERT OR IGNORE INTO wallets({','.join(row)}) VALUES ({','.join('?' * len(row))})", list(row.values()))
                restored += cur.rowcount
            apps = 0
            for a in data.get("appearances") or []:
                row = {k: v for k, v in a.items() if k in acols}
                apps += conn.execute(f"INSERT OR IGNORE INTO appearances({','.join(row)}) VALUES ({','.join('?' * len(row))})", list(row.values())).rowcount
            if data.get("kind") == "bot":
                for w in data.get("wallets") or []:
                    conn.execute("DELETE FROM bot_wallets WHERE chain=? AND address=?", (w["chain"], w["address"]))
                    row = conn.execute("SELECT removed_labels FROM wallets WHERE chain=? AND address=?", (w["chain"], w["address"])).fetchone()
                    removed = loads(row["removed_labels"]) if row else []
                    if row and "bot" not in removed:
                        conn.execute("UPDATE wallets SET removed_labels=? WHERE chain=? AND address=?", (json.dumps(removed + ["bot"]), w["chain"], w["address"]))
            if data.get("kind") == "cleanup":
                for w in data.get("wallets") or []:
                    conn.execute("DELETE FROM lib_removed WHERE chain=? AND address=?", (w["chain"], w["address"]))
            for w in data.get("wallets") or []:
                recompute_labels(conn, w["chain"], w["address"])
            conn.commit()
        finally:
            conn.close()
    return {"ok": True, "wallets": restored, "appearances": apps, "archive": Path(path).name}


if __name__ == "__main__":
    import argparse
    import sys
    parser = argparse.ArgumentParser(description=f"钱包库维护：清理总体盈利不到 {QUIET_TEXT} 的钱包／从封存文件还原")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_prune = sub.add_parser("prune", help="照规则清理（先封存再删）")
    p_prune.add_argument("--dry-run", action="store_true", help="只算数量，不封存不删")
    p_bots = sub.add_parser("bots", help="把机器人移出钱包库（先封存再删）")
    p_bots.add_argument("--dry-run", action="store_true", help="只算数量，不封存不删")
    p_restore = sub.add_parser("restore", help="把封存文件的钱包放回钱包库")
    p_restore.add_argument("archive")
    sub.add_parser("follow", help="马上重算实力卡的跟单纪录（平常维护调度每 6 小时算一次）")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    out = (prune_quiet(dry_run=args.dry_run) if args.cmd == "prune" else purge_bots(dry_run=args.dry_run) if args.cmd == "bots"
           else refresh_follow_records(force=True) if args.cmd == "follow" else restore_archive(args.archive))
    print(json.dumps(out, ensure_ascii=False))
