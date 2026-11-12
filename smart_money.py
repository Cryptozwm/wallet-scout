from __future__ import annotations

import json
import math
import re
import sqlite3
import statistics
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

import user_labels
import wallet_library as wl
from oss_config import DATA_DIR, cfg

HOST = "https://openapi.gmgn.ai"
CHAINS = ("bsc", "sol", "robinhood")
EVM_CHAINS = {"bsc", "robinhood"}
DEX_CHAIN = {"bsc": "bsc", "sol": "solana"}
LIB_CHAIN = {"bsc": "BSC", "sol": "Solana", "robinhood": "Robinhood"}
LOCAL_TZ = datetime.now().astimezone().tzinfo
EVM_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
SOL_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
MIN_STORE_USD = cfg('MIN_STORE_USD', 20.0)
MAX_MEME_MCAP = cfg('MAX_MEME_MCAP', 100000000)
BASE_TOKENS = {
    "So11111111111111111111111111111111111111112",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    "0x55d398326f99059ff775485246999027b3197955",
    "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    "0xe9e7cea3dedca5984780bafc599bd69add087d56",
    "0x2170ed0880ac9a755fd29b2688956bd959f933f8",
    "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c",
}
KEEP_SECONDS = 3 * 86400
TRADE_ARCHIVE_SECONDS = 30 * 86400
FOLLOW_DELAY = 60
FOLLOW_GAP = 1800
WALLET_KEY_SQL = "CASE WHEN chain IN ('bsc','robinhood') THEN 'evm:' || address ELSE chain || ':' || address END"
MINE_TOKENS = cfg('MINE_TOKENS', 20)
MINE_SKIP_SECONDS = 86400
MINE_MANUAL_MAX = cfg('MINE_MANUAL_MAX', 30)
MINE_MIN_ATH = cfg('MINE_MIN_ATH', 500000)
PUMP_HOT_URL = "https://pump.fun/api/indexer/boards/trending"
PUMP_HOT_CHAIN = {"bsc": "bsc", "sol": "solana", "robinhood": "robinhood"}
MINE_SOURCES = ("auto", "pump", "fomo")
MINE_RULE = 2
MINE_RECHECK = 15
MINE_TRAP_SELLERS = cfg('MINE_TRAP_SELLERS', 0.4)
MINE_TRAP_TAX = cfg('MINE_TRAP_TAX', 0.3)
SIGNAL_LOG_EVERY = 120
SIGNAL_LOG_WINDOW = cfg('SIGNAL_LOG_WINDOW', 3600)
SIGNAL_LOG_MIN_USD = cfg('SIGNAL_LOG_MIN_USD', 50.0)
SIGNAL_LOG_STRENGTHS = ("strong", "medium")
SIGNAL_BACKFILL_STEP = 300
SIGNAL_DEDUP_SECONDS = 86400
SIGNAL_BOT_TRADES = cfg('SIGNAL_BOT_TRADES', 5000)
FLIP_SECONDS = cfg('FLIP_SECONDS', 10)
FLIP_MIN_TOKENS = cfg('FLIP_MIN_TOKENS', 6)
FLIP_SHARE = cfg('FLIP_SHARE', 0.7)
FLIP_CACHE_SECONDS = 600
PICK_MCAP = cfg('PICK_MCAP', (500000, 5000000))
PICK_SINCE = cfg('PICK_SINCE', 0)
STRENGTH_RANK = {"weak": 1, "medium": 2, "strong": 3}
REVIEW_HOURS = cfg('REVIEW_HOURS', (0, 8, 16))
REVIEW_MIN_AGE = 1800
SETTLE_SECONDS = 86400
WIN_UP, WIN_DOWN = 0.30, -0.30
REVIEW_PACE = 0.2
REVIEW_FINE = 3600
REJUDGE_MAX = 150
REVIEW_KEEP = 120
WALLET_MIN_SIGNALS = cfg('WALLET_MIN_SIGNALS', 5)
SIM_COST = cfg('SIM_COST', 0.03)
WALLET_SHRINK = cfg('WALLET_SHRINK', 8)
RELATED_MIN_SHARED = cfg('RELATED_MIN_SHARED', 4)
RELATED_OVERLAP = cfg('RELATED_OVERLAP', 0.75)
RELATED_FUNDER_MAX = cfg('RELATED_FUNDER_MAX', 15)
SELL_RULES = [
    {"id": "half2", "label": "2 倍卖一半、其余 5 倍", "half": 2.0, "tp": 5.0,
     "rule": "涨到 2 倍先卖一半拿回本金，剩下的涨到 5 倍再卖；没碰到就在 24 小时收盘卖"},
    {"id": "tp2", "label": "2 倍全卖", "tp": 2.0, "rule": "涨到 2 倍全部卖掉；没碰到就在 24 小时收盘卖"},
    {"id": "tp3", "label": "3 倍全卖", "tp": 3.0, "rule": "涨到 3 倍全部卖掉；没碰到就在 24 小时收盘卖"},
    {"id": "tp5", "label": "5 倍全卖", "tp": 5.0, "rule": "涨到 5 倍全部卖掉；没碰到就在 24 小时收盘卖"},
    {"id": "sl50", "label": "跌一半停损、3 倍全卖", "sl": 0.5, "tp": 3.0,
     "rule": "先跌到一半就停损，先涨到 3 倍就全卖；都没碰到在 24 小时收盘卖；同一根 K 线两边都碰到算停损"},
    {"id": "hold", "label": "拿满 24 小时", "rule": "不管涨跌，24 小时收盘卖"},
    {"id": "follow", "label": "跟着聪明钱卖", "follow": True,
     "rule": "信号里的聪明钱（买家）在我们买进后第一次卖出，过 1 分钟就全部卖掉（用那之后第一根 K 线的开盘价）；"
             "24 小时都没人卖就在 24 小时收盘卖。只算有交易纪录的信号，中间收集停过的不算"},
]
SELL_RULE_IDS = [x["id"] for x in SELL_RULES]
DEFAULT_SELL_RULE = "half2"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36"

SCHEMA = """
CREATE TABLE IF NOT EXISTS sm_trades (
  chain TEXT NOT NULL, tx TEXT NOT NULL, maker TEXT NOT NULL, token TEXT NOT NULL, side TEXT NOT NULL,
  symbol TEXT DEFAULT '', usd REAL, amount REAL, price REAL, cost REAL, full INTEGER DEFAULT 0,
  ts INTEGER NOT NULL, source TEXT DEFAULT '',
  PRIMARY KEY (chain, tx, maker, token, side)
);
CREATE INDEX IF NOT EXISTS idx_smt_ts ON sm_trades(chain, ts);
CREATE INDEX IF NOT EXISTS idx_smt_token ON sm_trades(chain, token, ts);
CREATE INDEX IF NOT EXISTS idx_smt_maker ON sm_trades(chain, maker, ts);
CREATE TABLE IF NOT EXISTS sm_tokens (
  chain TEXT NOT NULL, ca TEXT NOT NULL, symbol TEXT DEFAULT '', logo TEXT DEFAULT '', launchpad TEXT DEFAULT '',
  supply REAL, price REAL, mcap REAL, liquidity REAL, ath_mc REAL, open_ts INTEGER, price_src TEXT DEFAULT '', price_at INTEGER,
  PRIMARY KEY (chain, ca)
);
CREATE TABLE IF NOT EXISTS sm_wallets (
  chain TEXT NOT NULL, address TEXT NOT NULL, sources TEXT DEFAULT '[]', watch INTEGER DEFAULT 0,
  name TEXT DEFAULT '', twitter TEXT DEFAULT '', gmgn_tags TEXT DEFAULT '[]',
  score INTEGER, grade TEXT DEFAULT '', style TEXT DEFAULT '[]', stats TEXT DEFAULT '{}', scored_at INTEGER,
  want_score INTEGER DEFAULT 0, mined TEXT DEFAULT '{}', first_seen INTEGER, last_trade_ts INTEGER,
  next_poll INTEGER DEFAULT 0, polled_at INTEGER, screen_count INTEGER,
  PRIMARY KEY (chain, address)
);
CREATE INDEX IF NOT EXISTS idx_smw_poll ON sm_wallets(watch, next_poll);
CREATE TABLE IF NOT EXISTS sm_mine_hits (
  chain TEXT NOT NULL, address TEXT NOT NULL, ca TEXT NOT NULL, symbol TEXT DEFAULT '', profit REAL, roi REAL, cost REAL,
  entry_delay INTEGER, tags TEXT DEFAULT '[]', scanned_at INTEGER, entry_mc REAL, ath_mc REAL,
  PRIMARY KEY (chain, address, ca)
);
CREATE TABLE IF NOT EXISTS sm_mine_scans (
  chain TEXT NOT NULL, ca TEXT NOT NULL, symbol TEXT DEFAULT '', scanned_at INTEGER NOT NULL, hits INTEGER DEFAULT 0,
  rule INTEGER DEFAULT 0, trap TEXT DEFAULT '',
  PRIMARY KEY (chain, ca)
);
CREATE TABLE IF NOT EXISTS sm_state (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS sm_evm_kind (
  address TEXT PRIMARY KEY, kind TEXT NOT NULL, delegate TEXT DEFAULT '', checked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_smt_ts_all ON sm_trades(ts);
CREATE TABLE IF NOT EXISTS sm_signal_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain TEXT NOT NULL, ca TEXT NOT NULL, symbol TEXT DEFAULT '', launchpad TEXT DEFAULT '',
  strength TEXT NOT NULL, at INTEGER NOT NULL, last_seen INTEGER, source TEXT DEFAULT 'live',
  price REAL, price_src TEXT DEFAULT '', mcap REAL, conviction REAL, wallets INTEGER, holders INTEGER,
  strong_wallets INTEGER, buy_usd REAL, sell_usd REAL, buyers TEXT DEFAULT '[]',
  base REAL, checked_at INTEGER, settled INTEGER DEFAULT 0, result TEXT DEFAULT '', result_at INTEGER,
  peak REAL, trough REAL, peak_at INTEGER, ch1h REAL, ch4h REAL, ch24h REAL, note TEXT DEFAULT '',
  judged_with TEXT DEFAULT '', dip REAL, sims TEXT
);
CREATE INDEX IF NOT EXISTS idx_sml_token ON sm_signal_log(chain, ca, at);
CREATE INDEX IF NOT EXISTS idx_sml_open ON sm_signal_log(settled, at);
CREATE TABLE IF NOT EXISTS sm_signal_reviews (
  at INTEGER PRIMARY KEY, slot TEXT DEFAULT '', checked INTEGER DEFAULT 0, summary TEXT DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS sm_signal_klines (
  id INTEGER PRIMARY KEY, at INTEGER NOT NULL, saved_at INTEGER, settled INTEGER DEFAULT 0, n INTEGER DEFAULT 0, candles BLOB
);
CREATE TABLE IF NOT EXISTS sm_trades_archive (
  chain TEXT NOT NULL, tx TEXT NOT NULL, maker TEXT NOT NULL, token TEXT NOT NULL, side TEXT NOT NULL,
  symbol TEXT DEFAULT '', usd REAL, amount REAL, price REAL, cost REAL, full INTEGER DEFAULT 0,
  ts INTEGER NOT NULL, source TEXT DEFAULT '',
  PRIMARY KEY (chain, tx, maker, token, side)
);
CREATE INDEX IF NOT EXISTS idx_smta_token ON sm_trades_archive(chain, token, ts);
CREATE INDEX IF NOT EXISTS idx_smta_ts ON sm_trades_archive(ts);
"""
TRADE_COLS = "chain, tx, maker, token, side, symbol, usd, amount, price, cost, full, ts, source"

SCORE_DUE_SQL = ("watch>=0 AND (want_score=1 OR (watch=1 AND scored_at IS NULL AND chain<>'robinhood')) "
                 "AND (scored_at IS NULL OR scored_at<?)")
RESCORE_SECONDS = 7 * 86400
PNL_DUE_SQL = "watch>=0 AND score IS NOT NULL AND COALESCE(pnl30_at, scored_at)<?"

SCORE_WEIGHTS = cfg('SCORE_WEIGHTS', {'profit': 0.3, 'roi': 0.2, 'runners': 0.15, 'win': 0.15, 'discipline': 0.1, 'sample': 0.1})
SCORE_SCALE = cfg('SCORE_SCALE', {'profitFullUsd': 100000, 'roiZero': -0.1, 'roiFull': 0.5, 'runnersFull': 0.1, 'winFull': 0.6, 'sampleMin': 10, 'sampleFull': 60})
SCORE_PENALTY = cfg('SCORE_PENALTY', {'devMinTokens': 3, 'devShare': 0.5, 'dev': 0.5, 'bot': 0.6, 'dustUsd': 20, 'dust': 0.6, 'thinTokens': 5, 'thin': 0.7})
GRADE_FLOORS = cfg('GRADE_FLOORS', {'S': 80, 'A': 65, 'B': 50, 'C': 35})
SIGNAL = cfg('SIGNAL', {'unscoredWeight': 0.8, 'kolWeight': 0.6, 'badStyleFactor': 0.5, 'allyBonus': 0.5, 'insiderMin': 0.8, 'solidWeight': 0.8, 'exitShare': 0.7, 'exitedWeight': 0.3, 'strongWallets': 3, 'strongUsd': 2000, 'strongBuySellRatio': 1.5, 'mediumWallets': 2, 'mediumUsd': 500, 'singleMinWeight': 1.25})
SCORE_RULES = [
    {"id": "profit", "label": "30 天实现盈利", "weight": SCORE_WEIGHTS["profit"],
     "rule": f"取对数，$1 起算、${SCORE_SCALE['profitFullUsd']:,.0f} 满分；亏损 0 分"},
    {"id": "roi", "label": "资金报酬", "weight": SCORE_WEIGHTS["roi"],
     "rule": f"实现盈利 ÷ 买入成本，{SCORE_SCALE['roiZero']:+.0%}→0、{SCORE_SCALE['roiFull']:+.0%} 满分"},
    {"id": "runners", "label": "抓大狗", "weight": SCORE_WEIGHTS["runners"], "rule": f"赚 2 倍以上的币占比，{SCORE_SCALE['runnersFull']:.0%} 满分"},
    {"id": "win", "label": "胜率", "weight": SCORE_WEIGHTS["win"], "rule": f"{SCORE_SCALE['winFull']:.0%} 满分"},
    {"id": "discipline", "label": "停损纪律", "weight": SCORE_WEIGHTS["discipline"], "rule": "没有亏超过 50% 的币占比"},
    {"id": "sample", "label": "样本数", "weight": SCORE_WEIGHTS["sample"],
     "rule": f"交易过的币 {SCORE_SCALE['sampleMin']} 颗以下 0 分、{SCORE_SCALE['sampleFull']} 颗满分"},
]
PENALTIES = [
    {"id": "dev", "label": "发币方",
     "rule": f"自己发的币至少 {SCORE_PENALTY['devMinTokens']} 颗、超过交易币数的 {SCORE_PENALTY['devShare']:.0%}，分数 ×{SCORE_PENALTY['dev']:g}"},
    {"id": "bot", "label": "机器人", "rule": f"30 天买卖 {SIGNAL_BOT_TRADES:,} 笔以上，分数 ×{SCORE_PENALTY['bot']:g}"},
    {"id": "dust", "label": "小额杂讯", "rule": f"平均每笔买入不到 ${SCORE_PENALTY['dustUsd']:,.0f}，分数 ×{SCORE_PENALTY['dust']:g}"},
    {"id": "thin", "label": "样本少", "rule": f"交易过的币不到 {SCORE_PENALTY['thinTokens']} 颗，分数 ×{SCORE_PENALTY['thin']:g}"},
]
GRADES = sorted(((GRADE_FLOORS[g], g) for g in ("S", "A", "B", "C")), reverse=True) + [(0, "D")]
GRADE_WEIGHT = cfg('GRADE_WEIGHT', {'S': 1.5, 'A': 1.25, 'B': 1.0, 'C': 0.6, 'D': 0.3})
GRADE_TEXT = (f"等级：S {GRADE_FLOORS['S']} 分以上、A {GRADE_FLOORS['A']}、B {GRADE_FLOORS['B']}、C {GRADE_FLOORS['C']}，其余 D。"
              "只是筛选工具，不是买卖建议。")
PROFIT_TIERS = [(100_000, "S"), (30_000, "A"), (10_000, "B"), (3_000, "C"), (1_000, "D")]
PNL_REFRESH_DAYS = 7
PNL_REFRESH_GAP = 60
SIGNAL_RULES = [
    f"时间窗内同一颗币：还拿着的「有份量」钱包 {SIGNAL['strongWallets']} 个以上、还拿着的合计买进至少 ${SIGNAL['strongUsd']:,.0f}、"
    f"总买进是卖出的 {SIGNAL['strongBuySellRatio']:g} 倍以上 → 强",
    f"还拿着的有份量钱包 {SIGNAL['mediumWallets']} 个以上、合计至少 ${SIGNAL['mediumUsd']:,.0f} → 中",
    f"只有 1 个有份量的还拿着，而且份量 {SIGNAL['singleMinWeight']:g} 以上 → 单一高手；"
    f"{SIGNAL['mediumWallets']} 个以上但合计不到 ${SIGNAL['mediumUsd']:,.0f} 的不列",
    f"份量：S {GRADE_WEIGHT['S']:g}、A {GRADE_WEIGHT['A']:g}、B {GRADE_WEIGHT['B']:g}、C {GRADE_WEIGHT['C']:g}、D {GRADE_WEIGHT['D']:g}、"
    f"还没评分 {SIGNAL['unscoredWeight']:g}（只有 KOL 标签、没评分的 {SIGNAL['kolWeight']:g}）；"
    f"评分风格是「发币方」或「机器人」的再乘 {SIGNAL['badStyleFactor']:g}；你标的高手 +{SIGNAL['allyBonus']:g}，标内幕／庄的至少 {SIGNAL['insiderMin']:g}",
    f"「有份量」＝份量 {SIGNAL['solidWeight']:g} 以上",
    f"买了又卖掉 {SIGNAL['exitShare']:.0%} 以上的算「已出场」：份量只算 {SIGNAL['exitedWeight']:.0%}，也不算进有份量的钱包数",
    f"每个钱包在时间窗内的买进要到筛选里的「单笔至少」（预设 ${SIGNAL_LOG_MIN_USD:,.0f}）才算；只看发射台出来的币（筛选可以关）、市值 {MAX_MEME_MCAP / 1e8:g} 亿以下；筛选的「市值上限」可以再压低（预设不限），不知道市值的照样列",
    "你标成捆绑／恶／机器人的钱包不算份量，只当警示；标「我」的、静音的完全排除",
    f"还拿着的钱包里有机器人会标警示；筛选打开「排除有机器人的信号」就不列（覆盘照样记）。机器人＝评分时查到 30 天买卖 {SIGNAL_BOT_TRADES:,} 笔以上，"
    f"或最近 3 天的动态里至少 {FLIP_MIN_TOKENS} 颗币买过又卖过、{FLIP_SHARE:.0%} 以上买进后不到 {FLIP_SECONDS} 秒就卖（秒卖，每 {FLIP_CACHE_SECONDS // 60} 分钟重算）",
    "BSC、SOL 的交易来自 GMGN 聪明钱／KOL 动态和你的名单；RH 没有 GMGN 动态，只看你名单里的钱包（私人标签、BSC 名单同步过去的、RH 挖掘候选），每 10 分钟看一次谁有交易",
]
REVIEW_RULES = [
    f"背景每 2 分钟用固定条件记一次信号：{SIGNAL_LOG_WINDOW // 60} 分钟时间窗、单笔至少 ${SIGNAL_LOG_MIN_USD:,.0f}、只看发射台的币，跟你页面上选什么无关（包括市值上限：覆盘照样记，「信号当下市值」分组看得到）",
    "只记中、强；单一高手不记",
    "同一颗币 24 小时内同样强度只记一次；从中升到强会另记一笔，用升级当下的价格当起点",
    "起点价：信号出来后第一根 1 分 K 的开盘价（最多晚 1 分钟，等于看到信号才买）；不用记下的成交价，因为那可能是半小时前、或刚好买在尖头的那笔",
    f"每天 {'、'.join(f'{h:02d}:00' for h in REVIEW_HOURS)} 覆盘：抓信号后 24 小时的 K 线（第一小时 1 分 K、到 8 小时 5 分 K、之后 15 分 K；第一小时抓不到 1 分 K 才用 5 分 K）",
    "主要看倍数和盈利：记信号后 24 小时内最高涨到起点的几倍、涨到最高点之前先跌到几倍（跟单的人会不会先被洗掉）；最高价用 K 线的最高点，含影线，实际不一定卖得到",
    f"模拟盈亏：每个信号固定买 $100、从起点价买进，照几种卖法算 24 小时内赚赔，每笔扣 {SIM_COST * 100:.0f}% 来回手续费（滑价没算）；只算满 24 小时的信号",
    *[f"卖法「{x['label']}」：{x['rule']}" for x in SELL_RULES],
    f"钱包排行：照选的卖法算跟这个钱包的模拟盈亏；样本少的往整体平均拉（每个钱包先当成多了 {WALLET_SHRINK} 笔平均的信号），至少 {WALLET_MIN_SIGNALS} 笔满 24 小时的才排；"
    "只算信号当下还拿着的钱包，同一颗币只算第一次，同一个 0x 地址 BSC 和 RH 合在一起算",
    f"相关钱包合成一组：一起出现在至少 {RELATED_MIN_SHARED} 个信号、而且占信号比较少那个的 {RELATED_OVERLAP:.0%} 以上（同进同出），"
    f"或钱包库里有资金相关（直接转过钱，或同一个非交易所的钱包给过两边钱；给超过 {RELATED_FUNDER_MAX} 个钱包的不算）；同一组同一颗币只算一次",
    "胜负只当辅助：先涨到 +30% 算胜、先跌到 −30% 算败、24 小时都没碰到算平；同一根 K 线两边都碰到，不知道哪个先，保守算败",
    f"旧版纪录没有倍数模拟：满 24 小时的每次覆盘从最早的开始重算，最多 {REJUDGE_MAX} 笔；页面会写还剩几笔",
    "服务器停过或刚上线，会用 3 天内的交易纪录往回补，标「回补」：用的是现在的钱包评分，可能比当下实时看到的好看，可以在筛选里排除",
    f"精选（纸上追踪）：信号当下市值 {PICK_MCAP[0] / 1e4:,.0f} 万～{PICK_MCAP[1] / 1e4:,.0f} 万，而且还拿着的钱包里没有机器人。"
    "条件是事先挑的，挑条件用到的那段一定好看；要看验证期那组也是正的，才算真的有用。只是分组统计，信号页不设市值限制",
    f"机器人＝评分时查到 30 天买卖 {SIGNAL_BOT_TRADES:,} 笔以上，或最近 3 天的动态里至少 {FLIP_MIN_TOKENS} 颗币买过又卖过、"
    f"{FLIP_SHARE:.0%} 以上买进后不到 {FLIP_SECONDS} 秒就卖（秒卖）",
    "只是事后统计，不代表之后会一样；不发讯、不下单",
]
LABEL_KINDS = [
    ("own", re.compile(r"^(我|我的)")),
    ("bundle", re.compile(r"[捆捆绑]")),
    ("bad", re.compile(r"恶|砸盘")),
    ("insider", re.compile(r"内幕|庄|阴谋|车头|\bdev\b", re.I)),
    ("bot", re.compile(r"机器|三明治|狙击")),
]
KIND_TEXT = {"ally": "我标的", "insider": "内幕／庄", "bundle": "捆绑", "bad": "恶", "bot": "机器人", "own": "我"}


def now_ts() -> int:
    return int(time.time())


def local_time(ts: float | None, fmt: str = "%m/%d %H:%M:%S") -> str:
    if not ts:
        return ""
    return datetime.fromtimestamp(float(ts), LOCAL_TZ).strftime(fmt)


def num(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return lo if x < lo else hi if x > hi else x


def norm_addr(address: Any) -> str:
    text = str(address or "").strip()
    return text.lower() if text.startswith("0x") else text


def chain_of(address: str) -> str:
    return "bsc" if EVM_RE.match(address) else "sol" if SOL_RE.match(address) else ""


def fits_chain(chain: str, address: str) -> bool:
    return bool(EVM_RE.match(address)) if chain in EVM_CHAINS else chain == "sol" and bool(SOL_RE.match(address))


def evm_siblings(chain: str) -> list[str]:
    return [c for c in sorted(EVM_CHAINS) if c != chain] if chain in EVM_CHAINS else []


def loads(text: Any, default: Any) -> Any:
    try:
        value = json.loads(text) if text else default
    except (TypeError, json.JSONDecodeError):
        return default
    return value if isinstance(value, type(default)) else default


def label_kind(label: dict[str, Any] | None) -> str:
    if not label:
        return ""
    if label.get("own"):
        return "own"
    text = str(label.get("label") or "")
    for kind, pattern in LABEL_KINDS:
        if pattern.search(text):
            return kind
    return "ally"


_schema_ready = False


def connect() -> sqlite3.Connection:
    global _schema_ready
    conn = sqlite3.connect(wl.DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    if not _schema_ready:
        wl.connect().close()
        conn.executescript(SCHEMA)
        user_labels.ensure(conn)
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(sm_mine_hits)")}
        if "entry_mc" not in cols:
            conn.execute("ALTER TABLE sm_mine_hits ADD COLUMN entry_mc REAL")
            conn.execute("ALTER TABLE sm_mine_hits ADD COLUMN ath_mc REAL")
            conn.commit()
        if conn.execute("SELECT 1 FROM sm_mine_scans LIMIT 1").fetchone() is None:
            _seed_mine_scans(conn)
            conn.commit()
        if "rule" not in {r["name"] for r in conn.execute("PRAGMA table_info(sm_mine_scans)")}:
            conn.execute("ALTER TABLE sm_mine_scans ADD COLUMN rule INTEGER DEFAULT 0")
            conn.execute("ALTER TABLE sm_mine_scans ADD COLUMN trap TEXT DEFAULT ''")
            conn.commit()
        if not get_state(conn, "rh_mined_watch_v1", 0):
            conn.execute("UPDATE sm_wallets SET watch=1 WHERE chain='robinhood' AND watch=0 AND sources LIKE '%\"mined\"%'")
            set_state(conn, "rh_mined_watch_v1", now_ts())
            conn.commit()
        if not get_state(conn, "signal_log_no_weak_v1", 0):
            conn.execute(f"DELETE FROM sm_signal_log WHERE strength NOT IN ({','.join('?' * len(SIGNAL_LOG_STRENGTHS))})", SIGNAL_LOG_STRENGTHS)
            set_state(conn, "signal_log_no_weak_v1", now_ts())
            conn.commit()
        if "judged_with" not in {r["name"] for r in conn.execute("PRAGMA table_info(sm_signal_log)")}:
            conn.execute("ALTER TABLE sm_signal_log ADD COLUMN judged_with TEXT DEFAULT ''")
            conn.commit()
        if "sims" not in {r["name"] for r in conn.execute("PRAGMA table_info(sm_signal_log)")}:
            conn.execute("ALTER TABLE sm_signal_log ADD COLUMN dip REAL")
            conn.execute("ALTER TABLE sm_signal_log ADD COLUMN sims TEXT")
            conn.commit()
        if "pnl30_at" not in {r["name"] for r in conn.execute("PRAGMA table_info(sm_wallets)")}:
            conn.execute("ALTER TABLE sm_wallets ADD COLUMN pnl30_usd REAL")
            conn.execute("ALTER TABLE sm_wallets ADD COLUMN pnl30_at INTEGER")
            conn.execute("UPDATE sm_wallets SET pnl30_usd=json_extract(stats, '$.realized'), pnl30_at=scored_at "
                         "WHERE scored_at IS NOT NULL AND json_valid(stats) AND json_extract(stats, '$.realized') IS NOT NULL")
            conn.commit()
        _schema_ready = True
    return conn


def _seed_mine_scans(conn: sqlite3.Connection) -> None:
    conn.execute("INSERT OR IGNORE INTO sm_mine_scans (chain, ca, symbol, scanned_at, hits) "
                 "SELECT chain, ca, MAX(symbol), MAX(scanned_at), COUNT(*) FROM sm_mine_hits WHERE scanned_at IS NOT NULL GROUP BY chain, ca")
    for chain in CHAINS:
        last = get_state(conn, f"mine_last_{chain}", {})
        if not last.get("at"):
            continue
        for t in last.get("tokens") or []:
            if isinstance(t, dict) and t.get("ca"):
                conn.execute("INSERT OR IGNORE INTO sm_mine_scans (chain, ca, symbol, scanned_at, hits) VALUES (?,?,?,?,0)",
                             (chain, norm_addr(t["ca"]), str(t.get("symbol") or ""), int(last["at"])))


def db(fn: Callable[[sqlite3.Connection], Any]) -> Any:
    with wl.LOCK:
        conn = connect()
        try:
            result = fn(conn)
            conn.commit()
            return result
        finally:
            conn.close()


def get_state(conn: sqlite3.Connection, key: str, default: Any) -> Any:
    row = conn.execute("SELECT value FROM sm_state WHERE key=?", (key,)).fetchone()
    return loads(row["value"], default) if row else default


def set_state(conn: sqlite3.Connection, key: str, value: Any) -> None:
    conn.execute("INSERT OR REPLACE INTO sm_state VALUES (?, ?)", (key, json.dumps(value, ensure_ascii=False)))


class RateLimited(RuntimeError):
    pass


class Gmgn:
    CAPACITY = 5.0
    LEAK = 0.4

    def __init__(self, key_provider: Callable[[], str]) -> None:
        self.key_provider = key_provider
        self.lock = threading.Lock()
        self.level = 0.0
        self.last = time.monotonic()
        self.blocked_until = 0.0
        self.calls = 0
        self.weight_used = 0
        self.last_error = ""
        self.remaining: int | None = None
        self.plan_blocked: set[str] = set()
        self.waiting = 0

    def _acquire(self, weight: float, stop: threading.Event | None, max_wait: float | None = None) -> None:
        background = stop is not None
        cap = max(weight, self.CAPACITY - 1 if background else self.CAPACITY)
        give_up = None if max_wait is None else time.time() + max_wait
        if not background:
            with self.lock:
                self.waiting += 1
        try:
            while True:
                with self.lock:
                    now = time.monotonic()
                    self.level = max(0.0, self.level - (now - self.last) * self.LEAK)
                    self.last = now
                    block = self.blocked_until - time.time()
                    if block <= 0 and self.level + weight <= cap + 1e-9:
                        self.level += weight
                        return
                    wait = max(block, (self.level + weight - cap) / self.LEAK, 0.1)
                if give_up is not None and time.time() + wait > give_up + 0.5:
                    raise RateLimited(f"GMGN 限流，{local_time(time.time() + wait, '%H:%M:%S')} 后恢复，到时再查")
                if background and stop.wait(min(wait, 3.0)):
                    raise RuntimeError("追踪已停止")
                if not background:
                    time.sleep(min(wait, 3.0))
        finally:
            if not background:
                with self.lock:
                    self.waiting -= 1

    def reserve(self, weight: float, max_wait: float | None = None) -> None:
        self._acquire(weight, None, max_wait)

    def block(self, until: float) -> None:
        with self.lock:
            self.blocked_until = max(self.blocked_until, until)
            self.level = self.CAPACITY
            until = self.blocked_until
        self.last_error = f"GMGN 限流，{local_time(until, '%H:%M:%S')} 后恢复"

    def call(self, path: str, query: dict[str, Any] | None = None, weight: float = 1, method: str = "GET",
             body: Any = None, stop: threading.Event | None = None, timeout: int = 25, max_wait: float | None = None) -> Any:
        if path in self.plan_blocked:
            raise RuntimeError("目前 GMGN 方案不支持这个接口")
        key = self.key_provider()
        if not key:
            raise RuntimeError("还没设置 GMGN API Key")
        self._acquire(weight, stop, max_wait)
        params = {k: v for k, v in (query or {}).items() if v is not None}
        params["timestamp"] = now_ts()
        params["client_id"] = str(uuid.uuid4())
        url = f"{HOST}{path}?{urllib.parse.urlencode(params, doseq=True)}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(url, data=data, method=method, headers={
            "X-APIKEY": key, "Content-Type": "application/json", "User-Agent": "gmgn-cli/1.6.9"})
        headers: Any = {}
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                text = response.read().decode("utf-8")
                headers = response.headers
        except urllib.error.HTTPError as exc:
            text = exc.read().decode("utf-8", "replace")
            headers = exc.headers
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            self.last_error = f"GMGN 连接失败：{type(exc).__name__}"
            raise RuntimeError(self.last_error) from exc
        self._sync(headers)
        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            self.last_error = "GMGN 回传不是 JSON"
            raise RuntimeError(self.last_error) from exc
        code = payload.get("code")
        if code == 0:
            self.calls += 1
            self.weight_used += weight
            data = payload.get("data")
            if isinstance(data, dict) and "code" in data and "data" in data and len(data) <= 5:
                data = data.get("data")
            return data
        error = str(payload.get("error") or payload.get("message") or code)
        if code == 429 or "RATE_LIMIT" in error:
            reset = payload.get("reset_at") or (headers.get("x-ratelimit-reset") if headers else None)
            until = num(reset, time.time() + 20)
            until = max(until, time.time() + 3) + 1
            with self.lock:
                self.blocked_until = max(self.blocked_until, until)
                self.level = self.CAPACITY
            self.last_error = f"GMGN 限流，{local_time(until, '%H:%M:%S')} 后恢复"
            raise RateLimited(self.last_error)
        if "PLAN_UPGRADE" in error or "PRO_PLAN" in error:
            self.plan_blocked.add(path)
        self.last_error = f"GMGN 错误：{error}"[:200]
        raise RuntimeError(self.last_error)

    def _sync(self, headers: Any) -> None:
        try:
            remaining = headers.get("x-ratelimit-remaining") if headers else None
            limit = headers.get("x-ratelimit-limit") if headers else None
        except AttributeError:
            return
        if remaining is None:
            return
        with self.lock:
            self.remaining = int(num(remaining, 0))
            cap = num(limit, self.CAPACITY) or self.CAPACITY
            self.level = max(0.0, min(self.CAPACITY, cap - self.remaining))
            self.last = time.monotonic()

    def snapshot(self) -> dict[str, Any]:
        return {"calls": self.calls, "weightUsed": self.weight_used, "remaining": self.remaining,
                "blockedUntil": self.blocked_until if self.blocked_until > time.time() else None,
                "blockedUntilText": local_time(self.blocked_until, "%H:%M:%S") if self.blocked_until > time.time() else "",
                "lastError": self.last_error}


def profit_tier(realized: Any) -> str:
    if realized is None:
        return ""
    for floor, tier in PROFIT_TIERS:
        if num(realized) >= floor:
            return tier
    return ""


def grade_of(score: float) -> str:
    for floor, grade in GRADES:
        if score >= floor:
            return grade
    return "D"


def compute_score(st: dict[str, Any]) -> dict[str, Any]:
    pnl = st.get("pnl_stat") or {}
    common = st.get("common") or {}
    tn = int(num(pnl.get("token_num")))
    buys, sells = int(num(st.get("buy"))), int(num(st.get("sell")))
    rp = num(st.get("realized_profit"))
    roi = num(st.get("realized_profit_pnl"))
    bought = num(st.get("bought_cost") or st.get("total_cost"))
    winrate = num(pnl.get("winrate"))
    big = int(num(pnl.get("pnl_2x_5x_num"))) + int(num(pnl.get("pnl_gt_5x_num")))
    gt5 = int(num(pnl.get("pnl_gt_5x_num")))
    deep_loss = int(num(pnl.get("pnl_lt_nd5_num")))
    hold = num(pnl.get("avg_holding_period"))
    created = int(num(common.get("created_token_count")))
    last_ts = int(num(st.get("last_timestamp")))
    avg_buy = bought / buys if buys else 0.0
    t = max(1, tn)
    parts = {
        "profit": clamp(math.log10(rp) / math.log10(max(10, SCORE_SCALE["profitFullUsd"]))) if rp >= 1 else 0.0,
        "discipline": 1 - deep_loss / t if tn else 0.0,
        "runners": clamp((big / t) / SCORE_SCALE["runnersFull"]) if tn else 0.0,
        "roi": clamp((roi - SCORE_SCALE["roiZero"]) / ((SCORE_SCALE["roiFull"] - SCORE_SCALE["roiZero"]) or 1)),
        "win": clamp(winrate / SCORE_SCALE["winFull"]),
        "sample": clamp((tn - SCORE_SCALE["sampleMin"]) / ((SCORE_SCALE["sampleFull"] - SCORE_SCALE["sampleMin"]) or 1)),
    }
    weights = {r["id"]: r["weight"] for r in SCORE_RULES}
    raw = 100 * sum(weights[k] * clamp(v) for k, v in parts.items())
    penalties: list[str] = []
    factor = 1.0
    pen = SCORE_PENALTY
    if created >= pen["devMinTokens"] and created > pen["devShare"] * t:
        penalties.append("dev"); factor *= pen["dev"]
    if buys + sells >= SIGNAL_BOT_TRADES:
        penalties.append("bot"); factor *= pen["bot"]
    if buys and avg_buy < pen["dustUsd"]:
        penalties.append("dust"); factor *= pen["dust"]
    if tn < pen["thinTokens"]:
        penalties.append("thin"); factor *= pen["thin"]
    score = round(raw * factor)
    style: list[str] = []
    if winrate >= 0.6 and tn >= 15:
        style.append("高胜率")
    if gt5 >= 2 or (tn >= 10 and big / t >= 0.05):
        style.append("抓大狗")
    if tn >= 15 and parts["discipline"] >= 0.95:
        style.append("少有大亏")
    if avg_buy >= 3000:
        style.append("大户")
    if 0 < hold < 900 and tn >= 10:
        style.append("快进快出")
    if hold >= 2 * 86400:
        style.append("长抱")
    if last_ts and last_ts < now_ts() - 7 * 86400:
        style.append("休眠")
    if rp < 0:
        style.append("30 天亏损")
    elif tn >= 20 and roi < 0.02:
        style.append("接近打平")
    labels = {p["id"]: p["label"] for p in PENALTIES}
    style = [labels[p] for p in penalties] + style
    stats = {"realized": round(rp, 2), "roi": round(roi, 4), "winrate": round(winrate, 4), "tokens": tn,
             "buys": buys, "sells": sells, "avgBuy": round(avg_buy, 2), "bigWins": big, "gt5": gt5,
             "deepLoss": deep_loss, "avgHold": round(hold), "created": created, "lastTs": last_ts,
             "parts": {k: round(clamp(v), 3) for k, v in parts.items()}, "penalties": penalties,
             "fundFrom": common.get("fund_from") or "", "walletAge": int(num(common.get("created_at")))}
    return {"score": score, "grade": grade_of(score), "style": style, "stats": stats,
            "name": common.get("name") or common.get("twitter_name") or common.get("nick_name") or "",
            "twitter": common.get("twitter_username") or "", "tags": common.get("tags") or []}


def add_source(sources_json: str, source: str) -> str:
    sources = loads(sources_json, [])
    if source not in sources:
        sources.append(source)
    return json.dumps(sources)


def upsert_wallet(conn: sqlite3.Connection, chain: str, address: str, *, source: str = "", name: str = "",
                  twitter: str = "", tags: list[str] | None = None, trade_ts: int = 0, want_score: bool = False,
                  watch: int | None = None) -> None:
    row = conn.execute("SELECT sources, watch, name, twitter, gmgn_tags, last_trade_ts, want_score FROM sm_wallets WHERE chain=? AND address=?",
                       (chain, address)).fetchone()
    if row is None:
        conn.execute("INSERT INTO sm_wallets (chain, address, sources, watch, name, twitter, gmgn_tags, first_seen, last_trade_ts, want_score) VALUES (?,?,?,?,?,?,?,?,?,?)",
                     (chain, address, json.dumps([source] if source else []), watch or 0, name, twitter,
                      json.dumps(tags or []), now_ts(), trade_ts or None, int(want_score)))
        return
    new_watch = row["watch"]
    if watch is not None and row["watch"] != -1:
        new_watch = max(row["watch"], watch) if watch >= 0 else watch
    conn.execute("UPDATE sm_wallets SET sources=?, watch=?, name=?, twitter=?, gmgn_tags=?, last_trade_ts=?, want_score=? WHERE chain=? AND address=?",
                 (add_source(row["sources"], source) if source else row["sources"], new_watch,
                  name or row["name"], twitter or row["twitter"], json.dumps(tags) if tags else row["gmgn_tags"],
                  max(row["last_trade_ts"] or 0, trade_ts) or None, int(want_score or bool(row["want_score"])), chain, address))


def upsert_token(conn: sqlite3.Connection, chain: str, ca: str, **fields: Any) -> None:
    row = conn.execute("SELECT * FROM sm_tokens WHERE chain=? AND ca=?", (chain, ca)).fetchone()
    if row is None:
        conn.execute("INSERT INTO sm_tokens (chain, ca) VALUES (?, ?)", (chain, ca))
        row = {}
    updates = {k: v for k, v in fields.items() if v not in (None, "", 0) or (k == "price_src" and v)}
    if not updates:
        return
    sets = ", ".join(f"{k}=?" for k in updates)
    conn.execute(f"UPDATE sm_tokens SET {sets} WHERE chain=? AND ca=?", (*updates.values(), chain, ca))


def insert_trade(conn: sqlite3.Connection, t: dict[str, Any]) -> bool:
    if t["token"] in BASE_TOKENS:
        return False
    cur = conn.execute("INSERT OR IGNORE INTO sm_trades VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                       (t["chain"], t["tx"], t["maker"], t["token"], t["side"], t.get("symbol") or "", t["usd"],
                        t.get("amount"), t.get("price"), t.get("cost"), int(t.get("full") or 0), t["ts"], t.get("source") or ""))
    return cur.rowcount > 0


def feed_trade(chain: str, kind: str, it: dict[str, Any]) -> dict[str, Any] | None:
    side = str(it.get("side") or "").lower()
    if side not in ("buy", "sell"):
        return None
    bt = it.get("base_token") or {}
    return {"chain": chain, "tx": str(it.get("transaction_hash") or ""), "maker": norm_addr(it.get("maker")),
            "token": norm_addr(it.get("base_address")), "side": side, "symbol": str(bt.get("symbol") or "")[:40],
            "usd": num(it.get("amount_usd")), "amount": num(it.get("token_amount") or it.get("base_amount")),
            "price": num(it.get("price_usd")), "cost": num(it.get("buy_cost_usd")), "full": int(num(it.get("is_open_or_close"))),
            "ts": int(num(it.get("timestamp"))), "source": kind, "logo": str(bt.get("logo") or ""),
            "launchpad": str(bt.get("launchpad") or ""), "supply": num(bt.get("total_supply")),
            "makerInfo": it.get("maker_info") or {}}


def activity_trade(chain: str, wallet: str, it: dict[str, Any]) -> dict[str, Any] | None:
    side = str(it.get("event_type") or it.get("type") or "").lower()
    if side not in ("buy", "sell"):
        return None
    tok = it.get("token") or {}
    return {"chain": chain, "tx": str(it.get("tx_hash") or ""), "maker": wallet, "token": norm_addr(tok.get("address")),
            "side": side, "symbol": str(tok.get("symbol") or "")[:40], "usd": num(it.get("cost_usd")),
            "amount": num(it.get("token_amount")), "price": num(it.get("price_usd")), "cost": num(it.get("buy_cost_usd")),
            "full": int(num(it.get("is_open_or_close"))), "ts": int(num(it.get("timestamp"))), "source": "watch",
            "logo": str(tok.get("logo") or ""), "launchpad": str(it.get("launchpad_platform") or it.get("launchpad") or ""),
            "supply": num(tok.get("total_supply"))}


FEEDS = [("sol", "smartmoney", 20, 12, 90), ("bsc", "smartmoney", 45, 20, 150),
         ("sol", "kol", 75, 30, 180), ("bsc", "kol", 120, 45, 300)]


class Tracker:
    def __init__(self, gmgn: Gmgn) -> None:
        self.gmgn = gmgn
        self.stop = threading.Event()
        self.paused = False
        self.thread: threading.Thread | None = None
        self.mine_thread: threading.Thread | None = None
        self.started_at = now_ts()
        self.feeds = {f"{c}:{k}": {"chain": c, "kind": k, "interval": base, "min": lo, "max": hi, "nextAt": 0,
                                   "lastAt": None, "lastNew": 0, "lastCount": 0, "newest": 0, "gap": False, "error": ""}
                      for c, k, base, lo, hi in FEEDS}
        self.screen = {c: {"nextAt": time.time() + 15, "offset": 0, "lastAt": None, "active": 0, "error": ""} for c in CHAINS}
        self.next_watch = 0.0
        self.next_score = 0.0
        self.next_pnl = 0.0
        self.next_price = 0.0
        self.next_labels = 0.0
        self.next_prune = 0.0
        self.watch_polls: list[float] = []
        self.scored: list[float] = []
        self.pnl_checked: list[float] = []
        self.last_error = ""
        self.mine: dict[str, Any] = {"running": False}
        self.mine_fomo: dict[tuple[str, str], dict[str, Any]] = {}
        self.next_log = 0.0
        self.log_caught_up = False
        self.next_review_check = 0.0
        self.review_retry_at = 0.0
        self.review: dict[str, Any] = {"running": False}
        self.review_thread: threading.Thread | None = None
        self._cov: tuple[float, int, set[int]] | None = None

    def start(self) -> None:
        if self.thread and self.thread.is_alive():
            return
        self.thread = threading.Thread(target=self.run, name="smart-money", daemon=True)
        self.thread.start()

    def run(self) -> None:
        while not self.stop.is_set():
            try:
                if not self.paused and self.gmgn.key_provider():
                    self.tick()
            except RateLimited as exc:
                self.last_error = str(exc)
            except Exception as exc:
                self.last_error = str(exc)[:200]
            self.stop.wait(1.0)

    def tick(self) -> None:
        now = time.time()
        if now >= self.next_labels:
            self.next_labels = now + 600
            sync_labels()
        if now >= self.next_prune:
            self.next_prune = now + 3600
            prune()
            try:
                backfill_follow()
            except Exception as exc:
                self.last_error = f"补算跟着聪明钱卖失败：{str(exc)[:120]}"
        if now >= self.next_price:
            self.next_price = now + 30
            try:
                refresh_prices()
            except Exception as exc:
                self.last_error = f"价格更新失败：{str(exc)[:120]}"
        if now >= self.next_log:
            try:
                self.log_signals()
            except Exception as exc:
                self.next_log = now + 60
                self.last_error = f"信号纪录失败：{str(exc)[:120]}"
        if self.log_caught_up and now >= self.next_review_check:
            self.next_review_check = now + 60
            slot, _ = review_slot(now)
            if (not self.review.get("running") and now >= self.review_retry_at
                    and slot != db(lambda conn: get_state(conn, "signal_review_slot", ""))):
                self.start_review(slot)
        due = sorted((f for f in self.feeds.values() if now >= f["nextAt"]), key=lambda f: f["nextAt"])
        if due:
            self.pull_feed(due[0])
            return
        if self.gmgn.waiting:
            return
        if self.mine.get("running"):
            return
        for chain, sc in self.screen.items():
            if now >= sc["nextAt"]:
                self.screen_watch(chain)
                return
        if now >= self.next_watch and self.poll_watch():
            self.next_watch = time.time() + 8
            return
        if now >= self.next_score and self.score_next():
            self.next_score = time.time() + 10
            return
        if now >= self.next_pnl:
            self.next_pnl = now + PNL_REFRESH_GAP
            if not self.refresh_pnl_next():
                self.next_pnl = time.time() + 600

    def pull_feed(self, feed: dict[str, Any]) -> None:
        feed["nextAt"] = time.time() + feed["interval"]
        try:
            data = self.gmgn.call(f"/v1/user/{feed['kind']}", {"chain": feed["chain"], "limit": 100}, 1, stop=self.stop)
        except RateLimited as exc:
            feed["error"] = str(exc)
            feed["nextAt"] = max(feed["nextAt"], self.gmgn.blocked_until + 2)
            raise
        except RuntimeError as exc:
            feed["error"] = str(exc)
            return
        rows = (data or {}).get("list") if isinstance(data, dict) else data
        trades = [t for t in (feed_trade(feed["chain"], feed["kind"], it) for it in rows or []) if t and t["tx"] and t["token"]]
        stamps = sorted(t["ts"] for t in trades)
        oldest = stamps[len(stamps) // 10] if stamps else 0
        newest = stamps[-1] if stamps else 0
        prev_newest = feed["newest"]
        gap = bool(prev_newest and stamps and stamps[0] > prev_newest)
        if gap:
            feed["interval"] = max(feed["min"], round(feed["interval"] * 0.7))
        elif prev_newest and oldest and prev_newest - oldest > 4 * feed["interval"]:
            feed["interval"] = min(feed["max"], round(feed["interval"] * 1.15))
        source = "gmgn_smart" if feed["kind"] == "smartmoney" else "gmgn_kol"

        def write(conn: sqlite3.Connection) -> int:
            added = 0
            for t in trades:
                info = t.pop("makerInfo", {}) or {}
                upsert_wallet(conn, t["chain"], t["maker"], source=source,
                              name=str(info.get("name") or info.get("twitter_name") or "")[:60],
                              twitter=str(info.get("twitter_username") or "")[:60], tags=info.get("tags") or None,
                              trade_ts=t["ts"], want_score=t["side"] == "buy" and t["usd"] >= 50)
                upsert_token(conn, t["chain"], t["token"], symbol=t["symbol"], logo=t["logo"], launchpad=t["launchpad"], supply=t["supply"])
                if t["usd"] >= MIN_STORE_USD and insert_trade(conn, t):
                    added += 1
            return added

        added = db(write)
        feed.update(lastAt=time.time(), lastCount=len(trades), lastNew=added, newest=max(newest, prev_newest), gap=gap, error="")

    def screen_watch(self, chain: str) -> None:
        sc = self.screen[chain]
        sc["nextAt"] = time.time() + 600

        def pick(conn: sqlite3.Connection) -> list[str]:
            rows = conn.execute("SELECT address FROM sm_wallets WHERE chain=? AND watch=1 ORDER BY address", (chain,)).fetchall()
            return [r["address"] for r in rows]

        addresses = db(pick)
        if not addresses:
            return
        offset = sc["offset"] % len(addresses)
        batch = addresses[offset:offset + 100]
        sc["offset"] = offset + 100
        if sc["offset"] < len(addresses):
            sc["nextAt"] = time.time() + 20
        else:
            sc["offset"] = 0
        try:
            data = self.gmgn.call("/v1/user/wallet_profits", {}, 3, "POST", {"chain": chain, "period": "1d", "wallet_addresses": batch}, stop=self.stop)
        except RuntimeError as exc:
            sc["error"] = str(exc)
            if isinstance(exc, RateLimited):
                raise
            return
        rows = (data or {}).get("list") if isinstance(data, dict) else data
        counts = {norm_addr(r.get("wallet_address")): int(num(r.get("buy"))) + int(num(r.get("sell"))) for r in rows or []}
        now = now_ts()

        def write(conn: sqlite3.Connection) -> int:
            active = 0
            for address in batch:
                n = counts.get(address, 0)
                row = conn.execute("SELECT screen_count, polled_at FROM sm_wallets WHERE chain=? AND address=?", (chain, address)).fetchone()
                if row is None:
                    continue
                changed = n > 0 and (row["screen_count"] is None or n != row["screen_count"] or not row["polled_at"])
                active += n > 0
                conn.execute("UPDATE sm_wallets SET screen_count=?, next_poll=CASE WHEN ? THEN ? ELSE next_poll END WHERE chain=? AND address=?",
                             (n, int(changed), now, chain, address))
            return active

        active = db(write)
        sc.update(lastAt=time.time(), error="", active=(sc["active"] if offset else 0) + active)

    def poll_watch(self) -> bool:
        now = now_ts()

        def pick(conn: sqlite3.Connection) -> sqlite3.Row | None:
            return conn.execute("SELECT chain, address FROM sm_wallets WHERE watch=1 AND next_poll>0 AND next_poll<=? ORDER BY next_poll LIMIT 1", (now,)).fetchone()

        row = db(pick)
        if row is None:
            return False
        chain, address = row["chain"], row["address"]
        try:
            data = self.gmgn.call("/v1/user/wallet_activity", {"chain": chain, "wallet_address": address, "limit": 30}, 3, stop=self.stop)
        except RuntimeError as exc:
            if isinstance(exc, RateLimited):
                raise
            db(lambda conn: conn.execute("UPDATE sm_wallets SET next_poll=? WHERE chain=? AND address=?", (now + 1800, chain, address)))
            return True
        acts = (data or {}).get("activities") if isinstance(data, dict) else data
        trades = [t for t in (activity_trade(chain, address, it) for it in acts or []) if t and t["tx"] and t["token"]]

        def write(conn: sqlite3.Connection) -> None:
            last = 0
            for t in trades:
                last = max(last, t["ts"])
                upsert_token(conn, chain, t["token"], symbol=t["symbol"], logo=t["logo"], launchpad=t["launchpad"], supply=t["supply"])
                if t["usd"] >= MIN_STORE_USD:
                    insert_trade(conn, t)
            scored = conn.execute("SELECT scored_at FROM sm_wallets WHERE chain=? AND address=?", (chain, address)).fetchone()
            conn.execute("UPDATE sm_wallets SET polled_at=?, next_poll=?, last_trade_ts=MAX(COALESCE(last_trade_ts,0), ?), want_score=CASE WHEN ? THEN 1 ELSE want_score END WHERE chain=? AND address=?",
                         (now, now + 6 * 3600, last, int(not (scored and scored["scored_at"]) and bool(trades)), chain, address))

        db(write)
        self.watch_polls = [t for t in self.watch_polls if t > time.time() - 3600] + [time.time()]
        return True

    def score_next(self) -> bool:
        stale = now_ts() - RESCORE_SECONDS

        def pick(conn: sqlite3.Connection) -> sqlite3.Row | None:
            return conn.execute(
                f"SELECT chain, address FROM sm_wallets WHERE {SCORE_DUE_SQL} ORDER BY (mined!='{{}}') DESC, watch DESC, last_trade_ts DESC LIMIT 1", (stale,)).fetchone()

        row = db(pick)
        if row is None:
            return False
        self.score_wallet(row["chain"], row["address"])
        return True

    def score_wallet(self, chain: str, address: str) -> dict[str, Any] | None:
        try:
            data = self.gmgn.call("/v1/user/wallet_stats", {"chain": chain, "wallet_address": address, "period": "30d"}, 3, stop=self.stop)
        except RuntimeError as exc:
            if isinstance(exc, RateLimited):
                raise
            db(lambda conn: conn.execute("UPDATE sm_wallets SET want_score=0, scored_at=? WHERE chain=? AND address=?", (now_ts(), chain, address)))
            return None
        st = data[0] if isinstance(data, list) and data else data
        if not isinstance(st, dict):
            return None
        result = compute_score(st)

        def write(conn: sqlite3.Connection) -> None:
            upsert_wallet(conn, chain, address, name=str(result["name"])[:60], twitter=str(result["twitter"])[:60], tags=result["tags"] or None)
            conn.execute("UPDATE sm_wallets SET score=?, grade=?, style=?, stats=?, scored_at=?, want_score=0, pnl30_usd=?, pnl30_at=? WHERE chain=? AND address=?",
                         (result["score"], result["grade"], json.dumps(result["style"], ensure_ascii=False),
                          json.dumps(result["stats"]), now_ts(), result["stats"]["realized"], now_ts(), chain, address))

        db(write)
        self.scored = [t for t in self.scored if t > time.time() - 3600] + [time.time()]
        return result

    def refresh_pnl_next(self) -> bool:
        def pick(conn: sqlite3.Connection) -> sqlite3.Row | None:
            return conn.execute(f"SELECT chain, address FROM sm_wallets WHERE {PNL_DUE_SQL} ORDER BY watch DESC, COALESCE(pnl30_at, scored_at) LIMIT 1",
                                (now_ts() - PNL_REFRESH_DAYS * 86400,)).fetchone()

        row = db(pick)
        if row is None:
            return False
        chain, address = row["chain"], row["address"]
        try:
            data = self.gmgn.call("/v1/user/wallet_stats", {"chain": chain, "wallet_address": address, "period": "30d"}, 3, stop=self.stop)
        except RuntimeError as exc:
            if isinstance(exc, RateLimited):
                raise
            data = None
        st = data[0] if isinstance(data, list) and data else data
        realized = round(num(st["realized_profit"]), 2) if isinstance(st, dict) and st.get("realized_profit") is not None else None
        db(lambda conn: conn.execute("UPDATE sm_wallets SET pnl30_usd=COALESCE(?, pnl30_usd), pnl30_at=? WHERE chain=? AND address=?",
                                     (realized, now_ts(), chain, address)))
        self.pnl_checked = [t for t in self.pnl_checked if t > time.time() - 3600] + [time.time()]
        return True

    def start_mine(self, chain: str, cas: list[str], source: str = "auto", symbols: dict[str, str] | None = None,
                   jobs: list[tuple[str, list[str], dict[str, str]]] | None = None,
                   fomo: dict[tuple[str, str], dict[str, Any]] | None = None) -> dict[str, Any]:
        if self.mine.get("running"):
            return {"ok": False, "error": "已经在挖了，等这轮跑完", "mine": self.mine}
        source = source if source in MINE_SOURCES else "auto"
        jobs = jobs or [(chain, cas, symbols or {})]
        self.mine_fomo = dict(fomo or {}) if source == "fomo" else {}
        self.mine = {"running": True, "chain": jobs[0][0], "startedAt": time.time(), "step": "准备中", "done": 0, "total": 0,
                     "hits": 0, "candidates": 0, "error": "", "manual": bool(jobs[0][1]) and source != "fomo", "source": source,
                     "skipped": 0, "note": "", "traps": [], "recheck": 0, "chains": [j[0] for j in jobs], "chainNo": 1, "results": [],
                     "fomoCoins": len(self.mine_fomo), "fomoNamed": 0}
        if len(jobs) == 1:
            target, args = self._mine, (jobs[0][0], jobs[0][1], source, jobs[0][2])
        else:
            target, args = self._mine_jobs, (jobs, source)
        self.mine_thread = threading.Thread(target=target, args=args, name="smart-money-mine", daemon=True)
        self.mine_thread.start()
        return {"ok": True, "mine": self.mine}

    def _mine(self, chain: str, cas: list[str], source: str = "auto", symbols: dict[str, str] | None = None) -> None:
        try:
            self._mine_chain(chain, cas, source, symbols or {})
        except Exception as exc:
            self.mine.update(step="失败", error=str(exc)[:200])
        finally:
            self.mine["running"] = False

    def _mine_jobs(self, jobs: list[tuple[str, list[str], dict[str, str]]], source: str) -> None:
        try:
            for i, (chain, cas, symbols) in enumerate(jobs):
                if self.stop.is_set():
                    break
                if i:
                    self.mine.update(chain=chain, chainNo=i + 1, step="准备中", current="", done=0, total=0, hits=0, candidates=0,
                                     error="", skipped=0, note="", traps=[], recheck=0, fresh=None, fomoNamed=0)
                try:
                    self._mine_chain(chain, cas, source, symbols)
                except Exception as exc:
                    self.mine.update(step="失败", error=str(exc)[:200])
                self.mine["results"].append({**{k: self.mine.get(k) for k in ("chain", "step", "candidates", "fresh", "hits", "skipped", "note", "error", "fomoNamed")},
                                             "traps": len(self.mine.get("traps") or [])})
            self.mine.update(step="完成", current="", finishedAt=time.time())
        finally:
            self.mine["running"] = False

    def _mine_chain(self, chain: str, cas: list[str], source: str = "auto", symbols: dict[str, str] | None = None) -> None:
        before = db(lambda conn: mined_addresses(conn, chain))
        tokens = self._mine_tokens(chain, cas, source, symbols or {})
        if not tokens:
            empty = {"fomo": "粘贴的 FOMO 热门", "pump": "pump.fun 热门"}.get(source, "排行和热门")
            self.mine.update(step="完成", current="", finishedAt=time.time(), candidates=len(before),
                             note=(f"{empty}的币 24 小时内都扫过了，晚点再挖，或改成指定几颗币" if self.mine.get("skipped")
                                   else self.mine.get("note") or f"{empty}没有符合条件的币"))
            return
        self.mine.update(total=len(tokens), step="抓每颗币的获利排行")
        for token in tokens:
            if self.stop.is_set():
                break
            self.mine["current"] = token.get("symbol") or token["ca"]
            try:
                hits = self._mine_token(chain, token)
                self.mine["hits"] += hits
            except RateLimited:
                self.stop.wait(max(5.0, self.gmgn.blocked_until - time.time() + 1))
                try:
                    self.mine["hits"] += self._mine_token(chain, token)
                except RuntimeError as exc:
                    self.mine["error"] = str(exc)
            except RuntimeError as exc:
                self.mine["error"] = str(exc)
            self.mine["done"] += 1
        self.mine.update(step="整理候选名单", current="")
        self.mine["candidates"] = promote_mined(chain)
        fresh = sorted(db(lambda conn: mined_addresses(conn, chain)) - before)
        self.mine["fresh"] = len(fresh)
        sources: dict[str, int] = {}
        for t in tokens:
            sources[t.get("src") or "lib"] = sources.get(t.get("src") or "lib", 0) + 1
        db(lambda conn: set_state(conn, f"mine_last_{chain}", {"at": now_ts(), "tokens": [
            {k: t.get(k) for k in ("ca", "symbol", "ath", "launchpad", "src")} for t in tokens], "candidates": self.mine["candidates"],
            "skipped": self.mine.get("skipped", 0), "new": fresh, "source": source, "sources": sources, "note": self.mine.get("note", ""),
            "traps": self.mine.get("traps", []), "rule": MINE_RULE}))
        self.mine.update(step="完成", finishedAt=time.time())

    def _mine_tokens(self, chain: str, cas: list[str], source: str = "auto", symbols: dict[str, str] | None = None) -> list[dict[str, Any]]:
        if source == "fomo":
            self.mine["step"] = "整理粘贴的 FOMO 热门"
            tokens = []
            for ca in cas:
                t = {**self._known_token(chain, ca), "src": "fomo"}
                t["symbol"] = t["symbol"] or str((symbols or {}).get(ca) or "")[:40]
                tokens.append(t)
            return self._skip_recent(chain, tokens, MINE_MANUAL_MAX, force={ca for c, ca in self.mine_fomo if c == chain})
        if cas:
            return [{**self._known_token(chain, norm_addr(ca)), "src": "manual"} for ca in cas[:MINE_MANUAL_MAX]]
        rank = self._rank_tokens(chain) if source == "auto" else []
        self.mine["step"] = "读 pump.fun 热门"
        try:
            hot = [t for t in pump_hot(chain) if MINE_MIN_ATH <= t["ath"] <= MAX_MEME_MCAP]
        except RuntimeError as exc:
            if source == "pump":
                raise
            hot = []
            self.mine["note"] = f"{exc}，这轮只用 GMGN 排行"
        for t in hot:
            known = self._known_token(chain, t["ca"])
            t["supply"], t["open"] = known["supply"] or 0, known["open"] or t["open"]
            db(lambda conn, t=t: upsert_token(conn, chain, t["ca"], symbol=t["symbol"], logo=t["logo"], launchpad=t["launchpad"],
                                              ath_mc=max(t["ath"], known["ath"] or 0)))
        tokens: list[dict[str, Any]] = []
        seen: set[str] = set()
        for i in range(max(len(rank), len(hot))):
            for t in (rank[i] if i < len(rank) else None, hot[i] if i < len(hot) else None):
                if t and t["ca"] not in seen:
                    seen.add(t["ca"])
                    tokens.append(t)
        if source == "auto":
            lib_chain = LIB_CHAIN[chain]

            def lib(conn: sqlite3.Connection) -> list[sqlite3.Row]:
                return conn.execute("SELECT ca, symbol, open_ts FROM tokens WHERE chain=?", (lib_chain,)).fetchall()

            for r in db(lib):
                ca = norm_addr(r["ca"])
                if ca not in seen:
                    seen.add(ca)
                    tokens.append({**self._known_token(chain, ca), "symbol": r["symbol"] or "", "open": int(r["open_ts"] or 0), "src": "lib"})
            recheck = self._recheck_tokens(chain)
            again = {t["ca"] for t in recheck}
            self.mine["recheck"] = len(recheck)
            return self._skip_recent(chain, [t for t in tokens if t["ca"] not in again], MINE_TOKENS - len(recheck)) + recheck
        return self._skip_recent(chain, tokens, MINE_TOKENS)

    def _recheck_tokens(self, chain: str) -> list[dict[str, Any]]:
        def old(conn: sqlite3.Connection) -> list[str]:
            return [r[0] for r in conn.execute("SELECT ca FROM sm_mine_scans WHERE chain=? AND rule<? AND hits>0 ORDER BY hits DESC, scanned_at DESC LIMIT ?",
                                               (chain, MINE_RULE, MINE_RECHECK))]

        return [{**self._known_token(chain, ca), "src": "recheck"} for ca in db(old)]

    def _rank_tokens(self, chain: str) -> list[dict[str, Any]]:
        self.mine["step"] = "找最近涨起来的土狗"
        data = self.gmgn.call("/v1/market/rank", {"chain": chain, "interval": "24h", "limit": 100,
                                                  "order_by": "history_highest_market_cap", "direction": "desc",
                                                  "max_created": "7d", "min_history_highest_marketcap": MINE_MIN_ATH}, 4, stop=self.stop)
        rows = data.get("rank") if isinstance(data, dict) else data
        tokens: list[dict[str, Any]] = []
        for r in rows or []:
            ca = norm_addr(r.get("address"))
            if not ca or r.get("is_honeypot") in (1, True, "1"):
                continue
            tokens.append({"ca": ca, "symbol": str(r.get("symbol") or "")[:40], "open": int(num(r.get("open_timestamp") or r.get("creation_timestamp"))),
                           "ath": num(r.get("history_highest_market_cap")), "supply": num(r.get("total_supply")),
                           "launchpad": r.get("launchpad_platform") or r.get("launchpad") or "", "src": "gmgn"})
            db(lambda conn, r=r, ca=ca: upsert_token(conn, chain, ca, symbol=str(r.get("symbol") or "")[:40], logo=str(r.get("logo") or ""),
                                                      launchpad=str(r.get("launchpad_platform") or r.get("launchpad") or ""), supply=num(r.get("total_supply")),
                                                      ath_mc=num(r.get("history_highest_market_cap")), open_ts=int(num(r.get("open_timestamp")))))
        return tokens

    def _skip_recent(self, chain: str, tokens: list[dict[str, Any]], limit: int, force: set[str] | frozenset[str] = frozenset()) -> list[dict[str, Any]]:
        def recent(conn: sqlite3.Connection) -> set[str]:
            return {r[0] for r in conn.execute("SELECT ca FROM sm_mine_scans WHERE chain=? AND scanned_at>=? AND (rule>=? OR hits=0)",
                                               (chain, now_ts() - MINE_SKIP_SECONDS, MINE_RULE))}

        skip = db(recent) - set(force)
        fresh = [t for t in tokens if t["ca"] not in skip]
        self.mine["skipped"] = len(tokens) - len(fresh)
        return fresh[:limit]

    def _mine_token(self, chain: str, token: dict[str, Any]) -> int:
        trap = self._security_trap(chain, token)
        if trap:
            return self._save_scan(chain, token, [], trap)
        if not token.get("supply") or not token.get("ath"):
            self._fill_token_info(chain, token)
        return self._mine_one(chain, token)

    def _security_trap(self, chain: str, token: dict[str, Any]) -> str:
        try:
            data = self.gmgn.call("/v1/token/security", {"chain": chain, "address": token["ca"]}, 1, stop=self.stop)
        except RateLimited:
            raise
        except RuntimeError:
            return ""
        d = data[0] if isinstance(data, list) and data else data
        return security_trap(chain, d) if isinstance(d, dict) else ""

    def _fill_token_info(self, chain: str, token: dict[str, Any]) -> None:
        try:
            data = self.gmgn.call("/v1/token/info", {"chain": chain, "address": token["ca"]}, 1, stop=self.stop)
        except RateLimited:
            raise
        except RuntimeError:
            return
        d = data[0] if isinstance(data, list) and data else data
        if not isinstance(d, dict):
            return
        supply = num(d.get("total_supply") or d.get("circulating_supply"))
        ath = num(d.get("ath_price")) * supply if supply else 0
        token["supply"] = token.get("supply") or supply
        token["ath"] = max(token.get("ath") or 0, ath)
        token["open"] = int(num(d.get("open_timestamp") or d.get("creation_timestamp"))) or token.get("open") or 0
        token["symbol"] = token.get("symbol") or str(d.get("symbol") or "")[:40]
        db(lambda conn: upsert_token(conn, chain, token["ca"], symbol=token["symbol"], logo=str(d.get("logo") or ""),
                                     launchpad=str(d.get("launchpad_platform") or d.get("launchpad") or ""), supply=token["supply"] or None,
                                     ath_mc=token["ath"] or None, open_ts=token["open"] or None))

    @staticmethod
    def _known_token(chain: str, ca: str) -> dict[str, Any]:
        row = db(lambda conn: conn.execute("SELECT symbol, open_ts, ath_mc, supply, launchpad FROM sm_tokens WHERE chain=? AND ca=?", (chain, ca)).fetchone())
        if row is None:
            return {"ca": ca, "symbol": "", "open": 0, "ath": 0, "supply": 0, "launchpad": ""}
        return {"ca": ca, "symbol": row["symbol"] or "", "open": int(row["open_ts"] or 0), "ath": row["ath_mc"] or 0,
                "supply": row["supply"] or 0, "launchpad": row["launchpad"] or ""}

    def _mine_one(self, chain: str, token: dict[str, Any]) -> int:
        data = self.gmgn.call("/v1/market/token_top_traders", {"chain": chain, "address": token["ca"], "limit": 100,
                                                               "order_by": "profit", "direction": "desc"}, 5, stop=self.stop)
        rows = ((data or {}).get("list") if isinstance(data, dict) else data) or []
        if self.mine_fomo.get((chain, token["ca"])):
            self._fomo_names(chain, token, rows)
        trap = traders_trap(rows)
        if trap:
            return self._save_scan(chain, token, [], trap)
        open_ts = token.get("open") or 0
        supply, ath = token.get("supply") or 0, token.get("ath") or 0
        hits = []
        for w in rows:
            if int(num(w.get("addr_type"))) != 0:
                continue
            tags = [str(x) for x in (w.get("tags") or []) + (w.get("maker_token_tags") or [])]
            if set(tags) & {"bundler", "dev", "creator", "dev_team", "rat_trader", "fresh_wallet", "transfer_in"}:
                continue
            if w.get("is_suspicious") or num(w.get("history_transfer_in_amount")) > num(w.get("buy_amount_cur")):
                continue
            cost = num(w.get("history_bought_cost"))
            profit = min(num(w.get("realized_profit")), num(w.get("history_sold_income")), num(w.get("profit")))
            roi = profit / cost if cost > 0 else 0.0
            if profit < 1000 or roi < 1.0 or cost < 50:
                continue
            entry_mc = num(w.get("avg_cost")) * supply if supply else 0
            if entry_mc and ath and entry_mc > 0.3 * ath:
                continue
            start = int(num(w.get("start_holding_at")))
            delay = start - open_ts if start and open_ts else None
            hits.append((chain, norm_addr(w.get("address")), token["ca"], token.get("symbol") or "", profit, roi, cost, delay,
                         json.dumps(tags), now_ts(), entry_mc or None, ath or None))
        return self._save_scan(chain, token, hits)

    def _fomo_names(self, chain: str, token: dict[str, Any], rows: list[dict[str, Any]]) -> None:
        info = self.mine_fomo.get((chain, token["ca"])) or {}
        try:
            pairs = fomo_name_match(rows, info.get("users") or [])
            if not pairs:
                return
            res = wl.platform_names_add(LIB_CHAIN[chain], "FOMO", [{"address": a, "handle": u["handle"], "followers": u.get("followers")} for a, u, _ in pairs],
                                        ca=token["ca"])
            self.mine["fomoNamed"] = self.mine.get("fomoNamed", 0) + len(pairs)
            try:
                FOMO_NAMES_LOG.parent.mkdir(parents=True, exist_ok=True)
                with FOMO_NAMES_LOG.open("a", encoding="utf-8") as f:
                    for a, u, amount in pairs:
                        f.write(json.dumps({"at": now_ts(), "chain": chain, "ca": token["ca"], "symbol": token.get("symbol") or "", "address": a,
                                            "handle": u["handle"], "gmgnAmount": amount, "fomoAmount": u["amount"], "fomoAt": int(info.get("at") or 0),
                                            "status": (res.get("status") or {}).get(a, "")}, ensure_ascii=False) + "\n")
            except OSError:
                pass
        except Exception as exc:
            self.mine["note"] = (self.mine.get("note") or "") or f"FOMO 名字没对成：{str(exc)[:80]}"

    def _save_scan(self, chain: str, token: dict[str, Any], hits: list[tuple], trap: str = "") -> int:
        if trap:
            self.mine.setdefault("traps", []).append({"ca": token["ca"], "symbol": token.get("symbol") or "", "reason": trap})

        def write(conn: sqlite3.Connection) -> None:
            conn.execute("DELETE FROM sm_mine_hits WHERE chain=? AND ca=?", (chain, token["ca"]))
            conn.executemany("INSERT INTO sm_mine_hits (chain, address, ca, symbol, profit, roi, cost, entry_delay, tags, scanned_at, entry_mc, ath_mc) "
                             "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", hits)
            conn.execute("INSERT OR REPLACE INTO sm_mine_scans (chain, ca, symbol, scanned_at, hits, rule, trap) VALUES (?,?,?,?,?,?,?)",
                         (chain, token["ca"], token.get("symbol") or "", now_ts(), len(hits), MINE_RULE, trap))

        db(write)
        return len(hits)

    def log_signals(self) -> None:
        started = time.monotonic()
        cursor = int(db(lambda conn: get_state(conn, "signal_log_cursor", 0)) or 0)
        t = max(cursor, now_ts() - KEEP_SECONDS + 3600)
        while True:
            now = now_ts()
            if now - t <= 2 * SIGNAL_BACKFILL_STEP:
                record_signals(None, "live")
                db(lambda conn: set_state(conn, "signal_log_cursor", now))
                self.log_caught_up = True
                self.next_log = time.time() + SIGNAL_LOG_EVERY
                return
            t += SIGNAL_BACKFILL_STEP
            record_signals(t, "backfill")
            db(lambda conn, t=t: set_state(conn, "signal_log_cursor", t))
            if time.monotonic() - started > 1.5:
                self.next_log = 0.0
                return

    def start_review(self, slot: str, manual: bool = False) -> dict[str, Any]:
        if self.review.get("running"):
            return {"ok": False, "error": "已经在覆盘了，等这轮跑完", "review": dict(self.review)}
        if not self.log_caught_up:
            return {"ok": False, "error": "信号纪录还在往回补，补完才能覆盘", "review": dict(self.review)}
        self.review = {"running": True, "slot": slot, "manual": manual, "startedAt": time.time(), "step": "准备中",
                       "current": "", "done": 0, "total": 0, "decided": 0, "error": ""}
        self.review_thread = threading.Thread(target=self._review, args=(slot, manual), name="smart-money-review", daemon=True)
        self.review_thread.start()
        return {"ok": True, "review": dict(self.review)}

    def _review(self, slot: str, manual: bool) -> None:
        try:
            now = now_ts()
            rows = db(lambda conn: conn.execute(
                "SELECT * FROM sm_signal_log WHERE settled=0 AND at<=? AND (result='' OR at<=?) ORDER BY at",
                (now - REVIEW_MIN_AGE, now - SETTLE_SECONDS)).fetchall())
            old = db(lambda conn: conn.execute(
                "SELECT * FROM sm_signal_log WHERE settled=1 AND (judged_with='' OR sims IS NULL) AND result IN ('win', 'loss', 'flat') "
                "ORDER BY at LIMIT ?", (REJUDGE_MAX,)).fetchall())
            self.review.update(total=len(rows) + len(old), rejudge=len(old), perItem=30, step="抓信号后的 K 线")
            for r in [*rows, *old]:
                while self.paused and not self.stop.wait(5):
                    self.review["step"] = "收集暂停中，覆盘也先停"
                if self.stop.is_set():
                    return
                judged = r["result"] in ("win", "loss", "flat") and (not r["judged_with"] or r["sims"] is None)
                self.review.update(step="重算旧纪录（补倍数和模拟盈亏）" if r["settled"] else "抓信号后的 K 线", current=r["symbol"] or r["ca"])
                upd: dict[str, Any] | None
                limited = False
                try:
                    upd = self._check_signal(r)
                except RateLimited:
                    self.stop.wait(max(5.0, self.gmgn.blocked_until - time.time() + 1))
                    try:
                        upd = self._check_signal(r)
                    except RuntimeError as exc:
                        upd, self.review["error"], limited = None, str(exc)[:200], isinstance(exc, RateLimited)
                except RuntimeError as exc:
                    upd, self.review["error"] = None, str(exc)[:200]
                if self.stop.is_set():
                    return
                if upd is None and not limited and now_ts() > r["at"] + SETTLE_SECONDS + 86400:
                    if judged:
                        upd = keep_judgment(r, "重算时 GMGN 一直出错，保留原本的结果（没有倍数模拟）")
                    else:
                        upd = judge_signal(r["price"], r["at"], [], r["at"] + SETTLE_SECONDS)
                        upd.update(note="K 线一直抓不到，放弃这笔", judged_with="1m")
                elif upd is not None and judged and upd["base"] is None and r["base"] is not None:
                    upd = keep_judgment(r, "重算时 GMGN 没回 K 线，保留原本的结果（没有倍数模拟）")
                if upd is not None:
                    def save(conn: sqlite3.Connection, r: sqlite3.Row = r, u: dict[str, Any] = upd) -> None:
                        conn.execute(
                            "UPDATE sm_signal_log SET base=?, checked_at=?, settled=?, result=?, result_at=?, peak=?, trough=?, peak_at=?, "
                            "ch1h=?, ch4h=?, ch24h=?, note=?, judged_with=?, dip=?, sims=? WHERE id=?",
                            (u["base"], now_ts(), u["settled"], u["result"], u["result_at"], u["peak"], u["trough"], u["peak_at"],
                             u["ch1h"], u["ch4h"], u["ch24h"], u["note"], u["judged_with"], u.get("dip"),
                             None if u.get("sims") is None else json.dumps(u["sims"]), r["id"]))
                        if u.get("_candles"):
                            conn.execute("INSERT OR REPLACE INTO sm_signal_klines (id, at, saved_at, settled, n, candles) VALUES (?,?,?,?,?,?)",
                                         (r["id"], r["at"], now_ts(), u["settled"], len(u["_candles"]), pack_candles(u["_candles"])))

                    db(save)
                    if upd["result"] in ("win", "loss", "flat"):
                        self.review["decided"] += 1
                self.review["done"] += 1
            self.review.update(step="整理覆盘", current="")

            def finish(conn: sqlite3.Connection) -> None:
                at = now_ts()
                conn.execute("INSERT OR REPLACE INTO sm_signal_reviews (at, slot, checked, summary) VALUES (?,?,?,?)",
                             (at, slot, self.review["done"], json.dumps(review_snapshot(conn, at), ensure_ascii=False)))
                conn.execute("DELETE FROM sm_signal_reviews WHERE at NOT IN (SELECT at FROM sm_signal_reviews ORDER BY at DESC LIMIT ?)", (REVIEW_KEEP,))
                if not manual:
                    set_state(conn, "signal_review_slot", slot)

            db(finish)
            self.review.update(step="完成", finishedAt=time.time())
        except Exception as exc:
            self.review.update(step="失败", error=str(exc)[:200])
            self.review_retry_at = time.time() + 1800
        finally:
            self.review["running"] = False

    def _check_signal(self, r: sqlite3.Row) -> dict[str, Any]:
        t0 = int(r["at"])
        end = min(t0 + SETTLE_SECONDS, now_ts())
        fine = (t0 + REVIEW_FINE) // 300 * 300
        split = (t0 + 8 * 3600) // 900 * 900
        candles: list[tuple[int, int, float, float, float, float]] = []
        first = "1m"
        for resolution, step, a, b in (("1m", 60, t0, min(fine, end)), ("5m", 300, fine, min(split, end)), ("15m", 900, split, end)):
            if b <= a:
                continue
            got = self._klines(r, resolution, step, a, b)
            if not got and resolution == "1m":
                first, got = "5m", self._klines(r, "5m", 300, a, b)
            candles += got
        candles.sort()
        sells = None
        if end >= t0 + SETTLE_SECONDS:
            cov = self._coverage(t0)
            sells = db(lambda conn: follow_sells(conn, r, cov))
        return {**judge_signal(r["price"], t0, candles, end, sells), "judged_with": first, "_candles": candles}

    def _coverage(self, since: int) -> set[int]:
        cached = self._cov
        if not cached or cached[1] > since or time.time() - cached[0] > 600:
            cached = self._cov = (time.time(), since, db(lambda conn: trade_coverage(conn, since)))
        return cached[2]

    def _klines(self, r: sqlite3.Row, resolution: str, step: int, a: int, b: int) -> list[tuple[int, int, float, float, float, float]]:
        data = self.gmgn.call("/v1/market/token_kline", {"chain": r["chain"], "address": r["ca"], "resolution": resolution,
                                                         "from": a * 1000, "to": b * 1000}, 2, stop=self.stop)
        out = []
        for k in ((data or {}).get("list") if isinstance(data, dict) else data) or []:
            ts = int(num(k.get("time")))
            ts = ts // 1000 if ts > 10 ** 11 else ts
            if a <= ts < b:
                out.append((ts, step, num(k.get("open")), num(k.get("high")), num(k.get("low")), num(k.get("close"))))
        self.stop.wait(2 / REVIEW_PACE)
        return out

    def snapshot(self) -> dict[str, Any]:
        def counts(conn: sqlite3.Connection) -> dict[str, Any]:
            return {
                "watch": conn.execute(f"SELECT COUNT(DISTINCT {WALLET_KEY_SQL}) FROM sm_wallets WHERE watch=1").fetchone()[0],
                "dueWatch": conn.execute("SELECT COUNT(*) FROM sm_wallets WHERE watch=1 AND next_poll>0 AND next_poll<=?", (now_ts(),)).fetchone()[0],
                "scoreQueue": conn.execute(f"SELECT COUNT(*) FROM sm_wallets WHERE {SCORE_DUE_SQL}", (now_ts() - RESCORE_SECONDS,)).fetchone()[0],
                "scored": conn.execute("SELECT COUNT(*) FROM sm_wallets WHERE scored_at IS NOT NULL AND score IS NOT NULL").fetchone()[0],
                "pnlDue": conn.execute(f"SELECT COUNT(*) FROM sm_wallets WHERE {PNL_DUE_SQL}", (now_ts() - PNL_REFRESH_DAYS * 86400,)).fetchone()[0],
                "trades": conn.execute("SELECT COUNT(*) FROM sm_trades").fetchone()[0],
            }

        c = db(counts)
        return {"running": bool(self.thread and self.thread.is_alive()), "paused": self.paused, "keyOk": bool(self.gmgn.key_provider()),
                "startedAt": self.started_at, "lastError": self.last_error, "gmgn": self.gmgn.snapshot(),
                "feeds": [{k: v for k, v in f.items() if k in ("chain", "kind", "interval", "lastAt", "lastNew", "lastCount", "gap", "error")} for f in self.feeds.values()],
                "screen": {k: {"lastAt": v["lastAt"], "active": v["active"], "error": v["error"]} for k, v in self.screen.items()},
                "watchPollsHour": len(self.watch_polls), "scoredHour": len(self.scored), "pnlCheckedHour": len(self.pnl_checked), "mine": dict(self.mine),
                "review": dict(self.review), "logCaughtUp": self.log_caught_up, **c}


def sync_labels() -> int:
    def work(conn: sqlite3.Connection) -> int:
        rows = conn.execute("SELECT address, family, raw_label, own FROM user_labels").fetchall()
        n = 0
        for r in rows:
            chains = sorted(EVM_CHAINS) if r["family"] == "EVM" else ["sol"] if r["family"] == "SOL" else []
            for chain in chains:
                if r["own"]:
                    conn.execute("UPDATE sm_wallets SET watch=-1 WHERE chain=? AND address=?", (chain, r["address"]))
                    continue
                upsert_wallet(conn, chain, r["address"], source="label", watch=1)
                n += 1
        for r in conn.execute("SELECT address FROM sm_wallets WHERE chain='bsc' AND watch=1").fetchall():
            upsert_wallet(conn, "robinhood", r["address"], source="bsc_list", watch=1)
        return n
    return db(work)


def prune() -> None:
    def work(conn: sqlite3.Connection) -> None:
        now = now_ts()
        base = ",".join("?" * len(BASE_TOKENS))
        conn.execute(f"INSERT OR IGNORE INTO sm_trades_archive ({TRADE_COLS}) SELECT {TRADE_COLS} FROM sm_trades "
                     f"WHERE ts<? AND ts>=? AND token NOT IN ({base})", (now - KEEP_SECONDS, now - TRADE_ARCHIVE_SECONDS, *BASE_TOKENS))
        conn.execute("DELETE FROM sm_trades WHERE ts<?", (now - KEEP_SECONDS,))
        conn.execute(f"DELETE FROM sm_trades WHERE token IN ({base})", tuple(BASE_TOKENS))
        conn.execute("DELETE FROM sm_trades_archive WHERE ts<?", (now - TRADE_ARCHIVE_SECONDS,))
    db(work)


def trade_coverage(conn: sqlite3.Connection, since: int) -> set[int]:
    q = "SELECT DISTINCT ts/{g} FROM {t} WHERE ts>=?"
    return {r[0] for t in ("sm_trades", "sm_trades_archive") for r in conn.execute(q.format(g=FOLLOW_GAP, t=t), (since,))}


def follow_sells(conn: sqlite3.Connection, r: sqlite3.Row, coverage: set[int]) -> list[int] | None:
    makers = sorted({b["a"] for b in loads(r["buyers"] if "buyers" in r.keys() else None, []) if b.get("a")})
    if not makers:
        return None
    t0 = int(r["at"])
    marks = ",".join("?" * len(makers))
    q = f"SELECT ts FROM {{t}} WHERE chain=? AND token=? AND side='sell' AND ts>=? AND ts<=? AND maker IN ({marks})"
    sells = sorted({row[0] for t in ("sm_trades", "sm_trades_archive")
                    for row in conn.execute(q.format(t=t), (r["chain"], r["ca"], t0, t0 + SETTLE_SECONDS, *makers))})
    upto = sells[0] if sells else t0 + SETTLE_SECONDS
    if any(g not in coverage for g in range(t0 // FOLLOW_GAP, upto // FOLLOW_GAP + 1)):
        return None
    return sells


def backfill_follow(limit: int = 3000) -> int:
    def work(conn: sqlite3.Connection) -> int:
        cursor = int(get_state(conn, "follow_backfill_cursor", 0) or 0)
        rows = conn.execute(
            "SELECT s.*, k.candles FROM sm_signal_log s JOIN sm_signal_klines k ON k.id=s.id "
            "WHERE s.id>? AND s.settled=1 AND k.settled=1 AND s.base>0 AND s.sims IS NOT NULL AND s.sims<>'{}' "
            "AND json_valid(s.sims) AND json_extract(s.sims, '$.follow') IS NULL ORDER BY s.id LIMIT ?", (cursor, limit)).fetchall()
        if not rows:
            return 0
        cov = trade_coverage(conn, min(r["at"] for r in rows))
        rule = next(x for x in SELL_RULES if x.get("follow"))
        n = 0
        for r in rows:
            candles = [c for c in unpack_candles(r["candles"]) if c[3] > 0 and c[4] > 0]
            sells = follow_sells(conn, r, cov) if candles else None
            if sells is not None:
                sims = loads(r["sims"], {})
                sims["follow"] = round(simulate_sell(rule, r["base"], candles, follow_exit_at(candles, sells)), 4)
                conn.execute("UPDATE sm_signal_log SET sims=? WHERE id=?", (json.dumps(sims), r["id"]))
                n += 1
        set_state(conn, "follow_backfill_cursor", rows[-1]["id"])
        return n
    return db(work)


def refresh_prices() -> None:
    since = now_ts() - 6 * 3600

    def hot(conn: sqlite3.Connection) -> list[sqlite3.Row]:
        return conn.execute("SELECT chain, token, COUNT(DISTINCT maker) n FROM sm_trades WHERE ts>=? AND side='buy' "
                            "GROUP BY chain, token ORDER BY n DESC, MAX(ts) DESC LIMIT 120", (since,)).fetchall()

    rows = db(hot)
    by_chain: dict[str, list[str]] = {}
    for r in rows:
        by_chain.setdefault(r["chain"], []).append(r["token"])
    for chain, tokens in by_chain.items():
        fetch_dex_prices(chain, tokens)


def fetch_dex_prices(chain: str, tokens: list[str]) -> None:
    if chain not in DEX_CHAIN:
        return
    for i in range(0, len(tokens), 30):
        chunk = tokens[i:i + 30]
        url = f"https://api.dexscreener.com/tokens/v1/{DEX_CHAIN[chain]}/{','.join(urllib.parse.quote(t, safe='') for t in chunk)}"
        request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                pairs = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
            continue
        best: dict[str, dict[str, Any]] = {}
        for p in pairs if isinstance(pairs, list) else []:
            ca = norm_addr((p.get("baseToken") or {}).get("address"))
            liq = num((p.get("liquidity") or {}).get("usd"))
            if ca and (ca not in best or liq > best[ca]["liq"]):
                best[ca] = {"liq": liq, "price": num(p.get("priceUsd")), "mcap": num(p.get("marketCap") or p.get("fdv"))}
        stamp = now_ts()

        def write(conn: sqlite3.Connection, best: dict[str, dict[str, Any]] = best) -> None:
            for ca, b in best.items():
                if b["price"] > 0:
                    upsert_token(conn, chain, ca, price=b["price"], mcap=b["mcap"], liquidity=b["liq"], price_src="DexScreener", price_at=stamp)

        db(write)


FOMO_NAME_TOL = 1.0
FOMO_NAME_MIN = 1000.0
FOMO_NAME_MAX_AGE = 3 * 3600
FOMO_NAME_COINS = 200
FOMO_NAME_USERS = 120
FOMO_NAMES_LOG = DATA_DIR / "logs" / "mine-fomo-names.jsonl"


def parse_fomo_holders(raw: Any, now: float | None = None) -> dict[tuple[str, str], dict[str, Any]]:
    out: dict[tuple[str, str], dict[str, Any]] = {}
    if not isinstance(raw, dict):
        return out
    now = time.time() if now is None else now
    for key, v in list(raw.items())[:FOMO_NAME_COINS]:
        chain, _, ca = str(key).partition(":")
        ca = norm_addr(ca)
        if chain not in CHAINS or not fits_chain(chain, ca) or not isinstance(v, dict) or not isinstance(v.get("list"), list):
            continue
        at = num(v.get("at")) / 1000
        if not at or now - at > FOMO_NAME_MAX_AGE or at > now + 300:
            continue
        users = []
        for u in v["list"][:FOMO_NAME_USERS]:
            if not isinstance(u, list) or len(u) < 2:
                continue
            handle = str(u[0] or "").strip()[:80]
            amount = num(u[1])
            if not handle or amount <= 0 or any(ord(c) < 32 for c in handle):
                continue
            try:
                handle.encode("utf-8")
            except UnicodeEncodeError:
                continue
            followers = num(u[2], -1) if len(u) > 2 and u[2] is not None else -1
            users.append({"handle": handle, "amount": amount, "followers": int(followers) if followers >= 0 else None})
        if users:
            out[(chain, ca)] = {"at": at, "users": users}
    return out


def fomo_name_match(rows: list[dict[str, Any]], users: list[dict[str, Any]]) -> list[tuple[str, dict[str, Any], float]]:
    traders = []
    for w in rows or []:
        if not isinstance(w, dict) or int(num(w.get("addr_type"))) == 2:
            continue
        tags = " ".join(str(x) for x in (w.get("tags") or []) + (w.get("maker_token_tags") or [])).lower()
        if "pool" in tags or "exchange" in tags:
            continue
        a, amount = norm_addr(w.get("address")), num(w.get("amount_cur"))
        if a and amount >= FOMO_NAME_MIN:
            traders.append((a, amount))
    users = [u for u in users or [] if num(u.get("amount")) >= FOMO_NAME_MIN]
    out: list[tuple[str, dict[str, Any], float]] = []
    used: set[str] = set()
    for u in users:
        hits = [(a, amount) for a, amount in traders if abs(amount - u["amount"]) <= FOMO_NAME_TOL]
        if len(hits) != 1 or hits[0][0] in used:
            continue
        if sum(1 for v in users if abs(v["amount"] - hits[0][1]) <= FOMO_NAME_TOL) != 1:
            continue
        used.add(hits[0][0])
        out.append((hits[0][0], u, hits[0][1]))
    return out


def _platform_names(conn: sqlite3.Connection, chain: str, addresses: list[str]) -> dict[str, list[dict[str, str]]]:
    chains = ("BSC", "Robinhood") if chain in EVM_CHAINS else (LIB_CHAIN[chain],)
    keys = list(dict.fromkeys(a for a in addresses if a))
    out: dict[str, list[dict[str, str]]] = {}
    try:
        for i in range(0, len(keys), 400):
            chunk = keys[i:i + 400]
            for r in conn.execute(f"SELECT address, platform, handle, x FROM platform_names WHERE chain IN ({','.join('?' * len(chains))}) "
                                  f"AND address IN ({','.join('?' * len(chunk))}) ORDER BY last_seen DESC", (*chains, *chunk)):
                lst = out.setdefault(r["address"], [])
                if len(lst) < 4 and not any(p["platform"] == r["platform"] and p["handle"].lower() == str(r["handle"]).lower() for p in lst):
                    lst.append({"platform": r["platform"], "handle": r["handle"], "x": r["x"] or ""})
    except sqlite3.OperationalError:
        return {}
    return out


def mine_jobs(first: str, source: str, tokens: Any) -> list[tuple[str, list[str], dict[str, str]]]:
    order = [first] + [c for c in CHAINS if c != first]
    if source != "fomo":
        return [(c, [], {}) for c in order]
    by: dict[str, dict[str, str]] = {c: {} for c in order}
    for t in tokens if isinstance(tokens, list) else []:
        if not isinstance(t, dict) or not isinstance(t.get("chain"), str) or t["chain"] not in by:
            continue
        ca = norm_addr(t.get("ca"))
        if fits_chain(t["chain"], ca) and len(by[t["chain"]]) < 200:
            by[t["chain"]].setdefault(ca, str(t.get("symbol") or "")[:40])
    return [(c, list(m), m) for c, m in by.items() if m]


def pump_hot(chain: str) -> list[dict[str, Any]]:
    query = urllib.parse.urlencode({"tier": "web", "surface": "TRENDING", "platform": "WEB", "limit": 150,
                                    "chains": PUMP_HOT_CHAIN[chain], "ranking": "social", "window": "1h", "hot": "label"})
    request = urllib.request.Request(f"{PUMP_HOT_URL}?{query}", headers={"User-Agent": UA, "Accept": "application/json",
                                                                          "Origin": "https://pump.fun", "Referer": "https://pump.fun/"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"pump.fun 热门读不到（HTTP {exc.code}）") from exc
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"pump.fun 热门读不到（{str(exc)[:80]}）") from exc
    if not isinstance(data, dict):
        raise RuntimeError("pump.fun 热门回传格式不对")
    server_now = int(num(data.get("serverTs")) / 1000) or now_ts()
    out = []
    for e in data.get("entries") or []:
        ca = norm_addr(e.get("m"))
        if not fits_chain(chain, ca) or ca in BASE_TOKENS:
            continue
        age = int(num(e.get("age")))
        out.append({"ca": ca, "symbol": str(e.get("t") or "")[:40], "open": server_now - age if age else 0, "ath": num(e.get("ath")),
                    "supply": 0, "launchpad": str(e.get("pl") or e.get("lp") or ""), "logo": str(e.get("i") or ""), "src": "pump"})
    return out


def _yes(value: Any) -> bool:
    return value is True or str(value).strip().lower() in ("1", "true", "yes")


def security_trap(chain: str, sec: dict[str, Any]) -> str:
    if _yes(sec.get("is_honeypot")) or _yes(sec.get("honeypot")):
        return "GMGN 安全检查：貔貅"
    if _yes(sec.get("can_not_sell")):
        return "GMGN 安全检查：卖不掉"
    tax = num(sec.get("sell_tax"))
    if tax >= MINE_TRAP_TAX:
        return f"卖税 {tax * 100:.0f}%"
    if chain == "sol" and sec.get("renounced_freeze_account") is False:
        return "冻结权限没放弃"
    return ""


def traders_trap(rows: list[dict[str, Any]]) -> str:
    people = [w for w in rows if int(num(w.get("addr_type"))) == 0]
    if len(people) < 20:
        return ""
    sellers = sum(1 for w in people if num(w.get("history_sold_income")) > 0 or num(w.get("sell_tx_count_cur")) > 0)
    if sellers < MINE_TRAP_SELLERS * len(people):
        return f"获利排行前 {len(people)} 名只有 {sellers} 个卖出过"
    return ""


def mined_addresses(conn: sqlite3.Connection, chain: str) -> set[str]:
    return {r[0] for r in conn.execute("SELECT address FROM sm_mine_hits WHERE chain=? GROUP BY address HAVING COUNT(DISTINCT ca)>=2", (chain,))}


def promote_mined(chain: str) -> int:
    def work(conn: sqlite3.Connection) -> int:
        rows = conn.execute("SELECT address, COUNT(DISTINCT ca) n, SUM(profit) p, GROUP_CONCAT(symbol, '、') s FROM sm_mine_hits "
                            "WHERE chain=? GROUP BY address HAVING n>=2", (chain,)).fetchall()
        keep = {r["address"] for r in rows}
        for old in conn.execute("SELECT address, sources FROM sm_wallets WHERE chain=? AND sources LIKE '%\"mined\"%'", (chain,)).fetchall():
            if old["address"] not in keep:
                sources = [s for s in loads(old["sources"], []) if s != "mined"]
                conn.execute("UPDATE sm_wallets SET sources=?, mined='{}' WHERE chain=? AND address=?", (json.dumps(sources), chain, old["address"]))
        for r in rows:
            prev = conn.execute("SELECT mined FROM sm_wallets WHERE chain=? AND address=?", (chain, r["address"])).fetchone()
            auto = chain == "robinhood" and (prev is None or prev["mined"] in (None, "", "{}"))
            upsert_wallet(conn, chain, r["address"], source="mined", want_score=True, watch=1 if auto else None)
            conn.execute("UPDATE sm_wallets SET mined=? WHERE chain=? AND address=?",
                         (json.dumps({"hits": r["n"], "profit": round(r["p"] or 0, 2), "tokens": (r["s"] or "").split("、")[:8]}, ensure_ascii=False), chain, r["address"]))
        return len(rows)
    return db(work)


def record_signals(at: int | None = None, source: str = "live") -> int:
    res = overview({"window": SIGNAL_LOG_WINDOW, "minUsd": SIGNAL_LOG_MIN_USD}, None, at=at, full=True)
    now = res["now"]

    def work(conn: sqlite3.Connection) -> int:
        added = 0
        for s in res["signals"]:
            if s["strength"] not in SIGNAL_LOG_STRENGTHS:
                continue
            prev = conn.execute("SELECT id, strength FROM sm_signal_log WHERE chain=? AND ca=? AND at>=? AND at<=? ORDER BY at DESC",
                                (s["chain"], s["ca"], now - SIGNAL_DEDUP_SECONDS, now)).fetchall()
            if prev and max(STRENGTH_RANK.get(p["strength"], 0) for p in prev) >= STRENGTH_RANK[s["strength"]]:
                conn.execute("UPDATE sm_signal_log SET last_seen=MAX(COALESCE(last_seen, 0), ?) WHERE id=?", (now, prev[0]["id"]))
                continue
            buyers = [{"a": b["address"], "w": b["weight"], "g": b["grade"], "k": b["kind"], "u": b["usd"], "t": b["first"], "x": b["exited"],
                       "b": bool(b.get("bot"))} for b in s["allBuyers"]]
            conn.execute("INSERT INTO sm_signal_log (chain, ca, symbol, launchpad, strength, at, last_seen, source, price, price_src, mcap, "
                         "conviction, wallets, holders, strong_wallets, buy_usd, sell_usd, buyers) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                         (s["chain"], s["ca"], s["symbol"], s["launchpad"] or "", s["strength"], now, now, source, s["price"] or None,
                          s["priceSrc"], s["mcap"], s["conviction"], s["wallets"], s["holders"], s["strongWallets"], s["buyUsd"], s["sellUsd"],
                          json.dumps(buyers, ensure_ascii=False)))
            added += 1
        return added
    return db(work)


def review_slot(ts: float) -> tuple[str, int]:
    d = datetime.fromtimestamp(ts, LOCAL_TZ)
    for back in range(3):
        day = (d - timedelta(days=back)).replace(minute=0, second=0, microsecond=0)
        for hour in sorted(REVIEW_HOURS, reverse=True):
            slot = day.replace(hour=hour)
            if slot <= d:
                return slot.strftime("%Y-%m-%d %H:%M"), int(slot.timestamp())
    raise ValueError("REVIEW_HOURS 不能是空的")


def next_review_ts(ts: float) -> int:
    d = datetime.fromtimestamp(ts, LOCAL_TZ)
    for ahead in range(3):
        day = (d + timedelta(days=ahead)).replace(minute=0, second=0, microsecond=0)
        for hour in sorted(REVIEW_HOURS):
            slot = day.replace(hour=hour)
            if slot > d:
                return int(slot.timestamp())
    raise ValueError("REVIEW_HOURS 不能是空的")


def judge_signal(price: float | None, t0: int, candles: list[tuple[int, int, float, float, float, float]], end: int,
                 sells: list[int] | None = None) -> dict[str, Any]:
    settled = end >= t0 + SETTLE_SECONDS
    out: dict[str, Any] = {"base": None, "settled": int(settled), "result": "", "result_at": None, "peak": None, "trough": None,
                           "peak_at": None, "ch1h": None, "ch4h": None, "ch24h": None, "note": "", "dip": None, "sims": None}
    candles = [c for c in candles if c[3] > 0 and c[4] > 0]
    if not candles:
        if settled:
            out.update(result="nodata", note="信号后 24 小时 GMGN 没有 K 线（没成交或查不到）")
        return out
    base = candles[0][2] or candles[0][5]
    if price and base and not (1 / 3 <= base / price <= 3):
        out["note"] = "信号后第一根 K 线跟记下的价格差 3 倍以上"
    if not base or base <= 0:
        out.update(result="nodata" if settled else "", note="K 线没有价格")
        return out
    out["base"] = base
    peak: float | None = None
    trough: float | None = None
    low_before = 0.0
    for ts, step, opn, hi, lo, close in candles:
        up, down = hi / base - 1, lo / base - 1
        if peak is None or up > peak:
            peak, out["peak_at"] = up, ts
            out["dip"] = min(low_before, opn / base - 1 if opn > 0 else 0.0)
        low_before = min(low_before, down)
        trough = down if trough is None else min(trough, down)
        if not out["result"]:
            if up >= WIN_UP and down <= WIN_DOWN:
                out.update(result="loss", result_at=ts,
                           note="；".join(x for x in (out["note"], "同一根 K 线涨到 +30% 也跌到 −30%，保守算败") if x))
            elif up >= WIN_UP:
                out.update(result="win", result_at=ts)
            elif down <= WIN_DOWN:
                out.update(result="loss", result_at=ts)
        for key, hours in (("ch1h", 1), ("ch4h", 4), ("ch24h", 24)):
            if ts + step <= t0 + hours * 3600 <= end and close > 0:
                out[key] = close / base - 1
    out["peak"], out["trough"] = peak, trough
    if settled and not out["result"]:
        out["result"] = "flat"
    if settled:
        follow_at = follow_exit_at(candles, sells) if sells is not None else None
        out["sims"] = {x["id"]: round(simulate_sell(x, base, candles, follow_at), 4) for x in SELL_RULES
                       if not x.get("follow") or sells is not None}
    return out


def follow_exit_at(candles: list[tuple[int, int, float, float, float, float]], sells: list[int]) -> int | None:
    entry = candles[0][0]
    return next((s for s in sells if s >= entry), None)


def simulate_sell(rule: dict[str, Any], base: float, candles: list[tuple[int, int, float, float, float, float]],
                  follow_at: int | None = None) -> float:
    if rule.get("follow"):
        if follow_at is not None:
            for ts, _step, opn, _hi, _lo, close in candles:
                if ts >= follow_at + FOLLOW_DELAY:
                    return (opn if opn > 0 else close) / base - 1
        return candles[-1][5] / base - 1
    half, tp, sl = rule.get("half"), rule.get("tp"), rule.get("sl")
    got, sold = 0.0, 0.0
    for _ts, _step, _open, hi, lo, _close in candles:
        if sl and lo / base <= sl:
            return got + (1 - sold) * (sl - 1)
        if half and not sold and hi / base >= half:
            got, sold = 0.5 * (half - 1), 0.5
        if tp and hi / base >= tp:
            return got + (1 - sold) * (tp - 1)
    return got + (1 - sold) * (candles[-1][5] / base - 1)


def pack_candles(candles: list[tuple[int, int, float, float, float, float]]) -> bytes:
    rows = [[int(ts), int(step), *(float(f"{x:.7g}") for x in (o, hi, lo, c))] for ts, step, o, hi, lo, c in candles]
    return zlib.compress(json.dumps(rows, separators=(",", ":")).encode(), 9)


def unpack_candles(blob: bytes | None) -> list[tuple[int, int, float, float, float, float]]:
    return [tuple(x) for x in json.loads(zlib.decompress(blob))] if blob else []


def keep_judgment(r: sqlite3.Row, note: str) -> dict[str, Any]:
    out = {k: r[k] for k in ("base", "result", "result_at", "peak", "trough", "peak_at", "ch1h", "ch4h", "ch24h", "dip")}
    settled = int(bool(r["settled"]) or now_ts() >= r["at"] + SETTLE_SECONDS)
    out.update(settled=settled, note="；".join(x for x in (r["note"], note) if x), judged_with=r["judged_with"] or "5m",
               sims={} if settled else None)
    return out


def _outcome_stats(rows: list[sqlite3.Row]) -> dict[str, Any]:
    win = sum(r["result"] == "win" for r in rows)
    loss = sum(r["result"] == "loss" for r in rows)
    flat = sum(r["result"] == "flat" for r in rows)
    done = win + loss + flat
    peaks = [r["peak"] for r in rows if r["result"] in ("win", "loss", "flat") and r["peak"] is not None]
    ch24 = [r["ch24h"] for r in rows if r["settled"] and r["ch24h"] is not None]
    return {"n": len(rows), "done": done, "win": win, "loss": loss, "flat": flat,
            "pending": sum(r["result"] == "" for r in rows), "nodata": sum(r["result"] == "nodata" for r in rows),
            "winRate": round(win / done, 4) if done else None,
            "medPeak": round(statistics.median(peaks), 4) if peaks else None,
            "medCh24": round(statistics.median(ch24), 4) if ch24 else None}


def _sims(r: sqlite3.Row) -> dict[str, float] | None:
    s = loads(r["sims"], {}) if r["settled"] else {}
    return s or None


def _rule_ret(r: sqlite3.Row, rule: str) -> float | None:
    s = _sims(r)
    return None if s is None or rule not in s else s[rule] - SIM_COST


def _multi_stats(rows: list[sqlite3.Row], rule: str) -> dict[str, Any]:
    sim = [(r, ret) for r in rows if (ret := _rule_ret(r, rule)) is not None]
    rets = [ret for _, ret in sim]
    mults = [1 + r["peak"] for r, _ in sim if r["peak"] is not None]
    dips = [1 + r["dip"] for r, _ in sim if r["dip"] is not None]
    top = sorted(rets, reverse=True)[:10]
    n = len(sim)
    return {"simN": n, "settledN": sum(1 for r in rows if r["settled"] and r["result"] in ("win", "loss", "flat")),
            "avgRet": round(statistics.mean(rets), 4) if rets else None, "totalUsd": round(sum(rets) * 100, 2),
            "profitable": sum(x > 0 for x in rets),
            "medMult": round(statistics.median(mults), 3) if mults else None, "maxMult": round(max(mults), 2) if mults else None,
            **{f"x{k}": sum(m >= k for m in mults) for k in (2, 3, 5, 10)},
            "x2Rate": round(sum(m >= 2 for m in mults) / n, 4) if n else None, "x5Rate": round(sum(m >= 5 for m in mults) / n, 4) if n else None,
            "medDip": round(statistics.median(dips), 3) if dips else None,
            "top10Usd": round(sum(top) * 100, 2), "restUsd": round((sum(rets) - sum(top)) * 100, 2)}


def _sell_table(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    out = []
    for x in SELL_RULES:
        rets = [ret for r in rows if (ret := _rule_ret(r, x["id"])) is not None]
        out.append({"id": x["id"], "label": x["label"], "n": len(rets), "avgRet": round(statistics.mean(rets), 4) if rets else None,
                    "totalUsd": round(sum(rets) * 100, 2), "profitable": sum(v > 0 for v in rets)})
    return out


def _related_groups(conn: sqlite3.Connection, per: dict[str, list[tuple[sqlite3.Row, dict[str, Any]]]]) -> dict[str, tuple[str, list[str]]]:
    parent = {k: k for k in per}
    why: dict[str, set[str]] = {}

    def find(k: str) -> str:
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    def union(a: str, b: str, reason: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra
            why.setdefault(ra, set()).update(why.pop(rb, set()))
        why.setdefault(ra, set()).add(reason)

    tokens = {k: {(r["chain"], r["ca"]) for r, _ in items} for k, items in per.items()}
    by_token: dict[tuple[str, str], list[str]] = {}
    for k, ts in tokens.items():
        if len(ts) >= RELATED_MIN_SHARED:
            for t in ts:
                by_token.setdefault(t, []).append(k)
    shared: dict[tuple[str, str], int] = {}
    for ks in by_token.values():
        ks.sort()
        for i, a in enumerate(ks):
            for b in ks[i + 1:]:
                shared[(a, b)] = shared.get((a, b), 0) + 1
    for (a, b), n in shared.items():
        if n >= RELATED_MIN_SHARED and n >= RELATED_OVERLAP * min(len(tokens[a]), len(tokens[b])):
            union(a, b, "同进同出")
    keys = {}
    for k in per:
        fam, addr = k.split(":", 1)
        keys[("evm" if fam == "evm" else fam, wl.norm("BSC" if fam == "evm" else "Solana", addr))] = k
    lib_fam = {"BSC": "evm", "Robinhood": "evm", "Solana": "sol"}
    denied = {(r["address"], r["target"].split(":", 1)[1]) for r in conn.execute("SELECT address, target FROM link_reviews WHERE verdict='no' AND kind='wallet'")}
    funded: dict[tuple[str, str], set[str]] = {}
    for rel in conn.execute("SELECT chain, src, dst FROM relations WHERE public_entity=0"):
        fam = lib_fam.get(rel["chain"])
        if not fam:
            continue
        src, dst = wl.norm(rel["chain"], rel["src"]), wl.norm(rel["chain"], rel["dst"])
        if (src, dst) in denied or (dst, src) in denied:
            continue
        a, b = keys.get((fam, src)), keys.get((fam, dst))
        if a and b and a != b:
            union(a, b, "资金相关")
        funded.setdefault((fam, src), set()).add(dst)
    for (fam, src), dsts in funded.items():
        got = sorted({keys[(fam, d)] for d in dsts if (fam, d) in keys})
        if len(got) >= 2 and len(dsts) <= RELATED_FUNDER_MAX:
            for b in got[1:]:
                union(got[0], b, "资金相关")
    size: dict[str, int] = {}
    for k in per:
        size[find(k)] = size.get(find(k), 0) + 1
    return {k: (find(k), sorted(why.get(find(k), set()))) for k in per if size[find(k)] > 1}


MCAP_BUCKETS = [(0, 1e5, "10 万以下"), (1e5, 1e6, "10 万～100 万"), (1e6, 2e6, "100 万～200 万"), (2e6, 1e7, "200 万～1,000 万"),
                (1e7, math.inf, "1,000 万以上")]


def _grouped(rows: list[sqlite3.Row], key: Callable[[sqlite3.Row], str], order: list[tuple[str, str]], rule: str) -> list[dict[str, Any]]:
    out = []
    for k, label in order:
        part = [r for r in rows if key(r) == k]
        if part:
            out.append({"key": k, "label": label, **_outcome_stats(part), **_multi_stats(part, rule)})
    return out


def _mcap_key(r: sqlite3.Row) -> str:
    mc = r["mcap"]
    if not mc:
        return "none"
    return next(label for lo, hi, label in MCAP_BUCKETS if lo <= mc < hi)


def _bot_wallet_set(conn: sqlite3.Connection) -> set[tuple[str, str]]:
    out: set[tuple[str, str]] = set()
    for r in conn.execute("SELECT chain, address, stats FROM sm_wallets WHERE stats LIKE '%\"buys\"%'"):
        st = loads(r["stats"], {})
        if num(st.get("buys")) + num(st.get("sells")) >= SIGNAL_BOT_TRADES:
            out.add((r["chain"], r["address"]))
    return out | _fast_flip_set(conn)


_FLIP_CACHE: dict[str, Any] = {"at": 0, "db": None, "set": frozenset()}


def _fast_flip_set(conn: sqlite3.Connection) -> frozenset[tuple[str, str]]:
    now = now_ts()
    path = str(wl.DB_PATH)
    if _FLIP_CACHE["db"] == path and now - _FLIP_CACHE["at"] < FLIP_CACHE_SECONDS:
        return _FLIP_CACHE["set"]
    first_buy: dict[tuple[str, str, str], int] = {}
    for r in conn.execute("SELECT chain, maker, token, MIN(ts) FROM sm_trades WHERE side='buy' GROUP BY chain, maker, token"):
        first_buy[(r[0], r[1], r[2])] = r[3]
    first_sell: dict[tuple[str, str, str], int] = {}
    for r in conn.execute("SELECT chain, maker, token, ts FROM sm_trades WHERE side='sell'"):
        key = (r[0], r[1], r[2])
        b = first_buy.get(key)
        if b is not None and r[3] >= b and (key not in first_sell or r[3] < first_sell[key]):
            first_sell[key] = r[3]
    count: dict[tuple[str, str], list[int]] = {}
    for key, s in first_sell.items():
        c = count.setdefault((key[0], key[1]), [0, 0])
        c[0] += 1
        c[1] += s - first_buy[key] < FLIP_SECONDS
    out = frozenset(k for k, (n, fast) in count.items() if n >= FLIP_MIN_TOKENS and fast >= FLIP_SHARE * n)
    _FLIP_CACHE.update(at=now, db=path, set=out)
    return out


def _bot_holders(r: sqlite3.Row, bots: set[tuple[str, str]]) -> int:
    return sum(1 for b in loads(r["buyers"], []) if not b.get("x") and (b["b"] if "b" in b else (r["chain"], b.get("a")) in bots))


def _pick_key(r: sqlite3.Row, bot_n: int) -> str:
    if bot_n or not r["mcap"] or not PICK_MCAP[0] <= r["mcap"] < PICK_MCAP[1]:
        return "other"
    return "new" if r["at"] >= PICK_SINCE else "old"


PICK_GROUPS = [("new", "精选・验证期（看这组）"), ("old", "精选・验证期以前"), ("other", "其他信号")]


def _wallet_key(chain: str, address: str) -> str:
    return ("evm:" if chain in EVM_CHAINS else f"{chain}:") + address


def review_snapshot(conn: sqlite3.Connection, now: int) -> dict[str, Any]:
    rows = conn.execute("SELECT * FROM sm_signal_log WHERE at>=?", (now - 7 * 86400,)).fetchall()

    def st(part: list[sqlite3.Row]) -> dict[str, Any]:
        m = _multi_stats(part, DEFAULT_SELL_RULE)
        return {**_outcome_stats(part), **{k: m[k] for k in ("simN", "avgRet", "x2Rate", "x5Rate", "medMult")}, "rule": DEFAULT_SELL_RULE}

    bots = _bot_wallet_set(conn)
    return {"overall": st(rows), "byStrength": {k: st([r for r in rows if r["strength"] == k]) for k in SIGNAL_LOG_STRENGTHS},
            "live": st([r for r in rows if r["source"] == "live"]),
            "pick": st([r for r in rows if _pick_key(r, _bot_holders(r, bots)) != "other"])}


def review_report(payload: dict[str, Any], tracker: Tracker | None) -> dict[str, Any]:
    days = int(clamp(num(payload.get("days"), 7), 0, 365))
    chain = payload.get("chain") if payload.get("chain") in CHAINS else None
    live_only = payload.get("liveOnly") is True
    rule = payload.get("rule") if payload.get("rule") in SELL_RULE_IDS else DEFAULT_SELL_RULE
    now = now_ts()

    def work(conn: sqlite3.Connection) -> dict[str, Any]:
        q, args = "SELECT * FROM sm_signal_log WHERE at>=?", [now - days * 86400 if days else 0]
        if chain:
            q, args = q + " AND chain=?", args + [chain]
        if live_only:
            q += " AND source='live'"
        rows = conn.execute(q + " ORDER BY at DESC", args).fetchall()
        bots = _bot_wallet_set(conn)
        bot_n = {r["id"]: _bot_holders(r, bots) for r in rows}
        groups = {
            "pick": _grouped(rows, lambda r: _pick_key(r, bot_n[r["id"]]), PICK_GROUPS, rule),
            "bots": _grouped(rows, lambda r: "some" if bot_n[r["id"]] else "none",
                             [("none", "还拿着的没有机器人"), ("some", "有机器人还拿着")], rule),
            "strength": _grouped(rows, lambda r: r["strength"], [("strong", "强"), ("medium", "中")], rule),
            "chain": _grouped(rows, lambda r: r["chain"], [("bsc", "BSC"), ("sol", "SOL"), ("robinhood", "RH")], rule),
            "wallets": _grouped(rows, lambda r: str(min(r["strong_wallets"] or 0, 4)),
                                [("1", "1 个"), ("2", "2 个"), ("3", "3 个"), ("4", "4 个以上")], rule),
            "mcap": _grouped(rows, _mcap_key, [(label, label) for _, _, label in MCAP_BUCKETS] + [("none", "不明")], rule),
            "source": _grouped(rows, lambda r: r["source"], [("live", "实时记下的"), ("backfill", "回补的")], rule),
        }
        overall = {**_outcome_stats(rows), **_multi_stats(rows, rule)}
        mu = overall["avgRet"] or 0.0
        first: dict[tuple[str, str, str], tuple[sqlite3.Row, dict[str, Any]]] = {}
        for r in reversed(rows):
            for b in loads(r["buyers"], []):
                if b.get("x") or not b.get("w") or b["w"] <= 0 or not b.get("a"):
                    continue
                first.setdefault((_wallet_key(r["chain"], b["a"]), r["chain"], r["ca"]), (r, b))
        per: dict[str, list[tuple[sqlite3.Row, dict[str, Any]]]] = {}
        for (wkey, _c, _ca), item in first.items():
            per.setdefault(wkey, []).append(item)
        related = _related_groups(conn, per)
        teams: dict[str, list[str]] = {}
        for k in per:
            teams.setdefault(related[k][0] if k in related else k, []).append(k)
        board = []
        for members in teams.values():
            seen: dict[tuple[str, str], sqlite3.Row] = {}
            for m in members:
                for r, _b in per[m]:
                    if (r["chain"], r["ca"]) not in seen or r["at"] < seen[(r["chain"], r["ca"])]["at"]:
                        seen[(r["chain"], r["ca"])] = r
            items = list(seen.values())
            rets = [(r, ret) for r in items if (ret := _rule_ret(r, rule)) is not None]
            if len(rets) < WALLET_MIN_SIGNALS:
                continue
            total = sum(ret for _, ret in rets)
            mults = [(1 + r["peak"], r) for r, _ in rets if r["peak"] is not None]
            top_mult, top_r = max(mults, key=lambda x: x[0]) if mults else (None, None)
            lead = max(members, key=lambda m: (len(per[m]), max(r["at"] for r, _ in per[m])))
            lead_latest = max(per[lead], key=lambda it: it[0]["at"])
            board.append({
                "key": lead, "address": lead_latest[1]["a"], "chain": lead_latest[0]["chain"], "chains": sorted({r["chain"] for r in items}),
                "members": [{"address": max(per[m], key=lambda it: it[0]["at"])[1]["a"], "chain": max(per[m], key=lambda it: it[0]["at"])[0]["chain"],
                             "signals": len(per[m])} for m in sorted(members, key=lambda m: -len(per[m])) if m != lead],
                "relatedWhy": related[lead][1] if lead in related else [],
                **_outcome_stats(items),
                "simN": len(rets), "avgRet": round(total / len(rets), 4), "totalUsd": round(total * 100, 2),
                "shrunk": round((total + WALLET_SHRINK * mu) / (len(rets) + WALLET_SHRINK), 4),
                "x2": sum(m >= 2 for m, _ in mults), "x5": sum(m >= 5 for m, _ in mults),
                "bestMult": round(top_mult, 2) if top_mult else None, "bestSymbol": (top_r["symbol"] or top_r["ca"]) if top_r else "",
                "lastAt": max(r["at"] for r in items),
                "tokens": [{"symbol": r["symbol"], "result": r["result"], "chain": r["chain"], "ca": r["ca"],
                            "mult": round(1 + r["peak"], 2) if r["peak"] is not None and _sims(r) else None, "ret": _rule_ret(r, rule)}
                           for r in sorted(items, key=lambda r: -r["at"])[:8]]})
        pairs = {(w["chain"], w["address"]) for w in board}
        wrows = _wallet_rows(conn, pairs)
        labels = _labels(conn, {w["address"] for w in board})
        for w in board:
            brief = wallet_brief(w["chain"], w["address"], wrows.get((w["chain"], w["address"])), labels.get(w["address"]))
            w.update({k: brief[k] for k in ("grade", "score", "label", "kind", "kindText", "name", "twitter", "kol", "watch", "weight", "style")})
        best = sorted(board, key=lambda w: (-w["shrunk"], -w["simN"]))[:20]
        shown = {w["key"] for w in best}
        worst = [w for w in sorted(board, key=lambda w: (w["shrunk"], -w["simN"])) if w["key"] not in shown][:10]
        recent_rows = rows[:120]
        logos: dict[tuple[str, str], str] = {}
        for c in {r["chain"] for r in recent_rows}:
            cas = list({r["ca"] for r in recent_rows if r["chain"] == c})
            for i in range(0, len(cas), 400):
                chunk = cas[i:i + 400]
                for t in conn.execute(f"SELECT ca, logo FROM sm_tokens WHERE chain=? AND ca IN ({','.join('?' * len(chunk))})", (c, *chunk)):
                    logos[(c, t["ca"])] = t["logo"] or ""
        recent = [{"id": r["id"], "chain": r["chain"], "ca": r["ca"], "symbol": r["symbol"], "logo": logos.get((r["chain"], r["ca"]), ""),
                   "launchpad": r["launchpad"], "strength": r["strength"], "at": r["at"], "source": r["source"],
                   "price": r["base"] or r["price"], "mcap": r["mcap"], "wallets": r["wallets"], "holders": r["holders"],
                   "strongWallets": r["strong_wallets"], "buyUsd": r["buy_usd"], "result": r["result"], "resultAt": r["result_at"],
                   "settled": bool(r["settled"]), "checkedAt": r["checked_at"], "peak": r["peak"], "trough": r["trough"],
                   "ch1h": r["ch1h"], "ch4h": r["ch4h"], "ch24h": r["ch24h"], "note": r["note"], "judgedWith": r["judged_with"] or "",
                   "dip": r["dip"], "sims": {k: round(v - SIM_COST, 4) for k, v in s.items()} if (s := _sims(r)) else None,
                   "buyers":[{"address": b["a"], "grade": b.get("g") or "", "kind": b.get("k") or "", "weight": b.get("w"), "exited": bool(b.get("x"))}
                              for b in loads(r["buyers"], [])[:6]]} for r in recent_rows]
        history = [{"at": h["at"], "slot": h["slot"], "checked": h["checked"], "summary": loads(h["summary"], {})}
                   for h in conn.execute("SELECT * FROM sm_signal_reviews ORDER BY at DESC LIMIT 20")]
        total = conn.execute("SELECT COUNT(*), MIN(at) FROM sm_signal_log").fetchone()
        old = sum(1 for r in rows if r["result"] in ("win", "loss", "flat") and (not r["judged_with"] or (r["settled"] and r["sims"] is None)))
        return {"overall": overall, "groups": groups, "best": best, "worst": worst, "walletsRanked": len(board),
                "walletsMerged": sum(len(w["members"]) for w in board), "sells": _sell_table(rows), "rule": rule,
                "oldJudged": old, "rejudgeMax": REJUDGE_MAX,
                "recent": recent, "history": history, "lastSlot": get_state(conn, "signal_review_slot", ""),
                "logCursor": get_state(conn, "signal_log_cursor", 0), "logged": total[0], "firstAt": total[1]}

    result = db(work)
    return {"ok": True, "now": now, "days": days, "chain": chain, "liveOnly": live_only, **result,
            "nextReviewAt": next_review_ts(now), "reviewHours": list(REVIEW_HOURS),
            "review": dict(tracker.review) if tracker else None, "logCaughtUp": bool(tracker and tracker.log_caught_up),
            "rules": REVIEW_RULES, "sellRules": [{k: x[k] for k in ("id", "label", "rule")} for x in SELL_RULES], "defaultRule": DEFAULT_SELL_RULE,
            "thresholds": {"up": WIN_UP, "down": WIN_DOWN, "minSignals": WALLET_MIN_SIGNALS, "cost": SIM_COST, "shrink": WALLET_SHRINK,
                           "relatedShared": RELATED_MIN_SHARED, "relatedOverlap": RELATED_OVERLAP}}


def _wallet_rows(conn: sqlite3.Connection, pairs: set[tuple[str, str]]) -> dict[tuple[str, str], sqlite3.Row]:
    out: dict[tuple[str, str], sqlite3.Row] = {}
    by_chain: dict[str, list[str]] = {}
    for chain, address in pairs:
        by_chain.setdefault(chain, []).append(address)
    for chain, addresses in by_chain.items():
        for i in range(0, len(addresses), 400):
            chunk = addresses[i:i + 400]
            for r in conn.execute(f"SELECT * FROM sm_wallets WHERE chain=? AND address IN ({','.join('?' * len(chunk))})", (chain, *chunk)):
                out[(chain, r["address"])] = r
    return out


def _labels(conn: sqlite3.Connection, addresses: set[str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    keys = list(addresses)
    for i in range(0, len(keys), 400):
        chunk = keys[i:i + 400]
        for r in conn.execute(f"SELECT address, raw_label, group_key, own FROM user_labels WHERE address IN ({','.join('?' * len(chunk))})", chunk):
            out[r["address"]] = {"label": r["raw_label"], "group": r["group_key"], "own": bool(r["own"])}
    return out


def wallet_brief(chain: str, address: str, row: sqlite3.Row | None, label: dict[str, Any] | None,
                 flip: frozenset[tuple[str, str]] | None = None) -> dict[str, Any]:
    kind = label_kind(label)
    tags = loads(row["gmgn_tags"], []) if row else []
    grade = (row["grade"] if row else "") or ""
    style = loads(row["style"], []) if row else []
    muted = bool(row and row["watch"] == -1)
    weight: float | None
    if kind == "own" or muted:
        weight = None
    elif kind in ("bundle", "bad", "bot"):
        weight = 0.0
    else:
        weight = GRADE_WEIGHT.get(grade, SIGNAL["unscoredWeight"])
        if not grade and ({"kol", "renowned"} & set(tags)) and "smart_degen" not in tags:
            weight = SIGNAL["kolWeight"]
        if {"发币方", "机器人"} & set(style):
            weight *= SIGNAL["badStyleFactor"]
        if kind == "ally":
            weight += SIGNAL["allyBonus"]
        if kind == "insider":
            weight = max(weight, SIGNAL["insiderMin"])
    stats = loads(row["stats"], {}) if row else {}
    bot = ("buys" in stats and num(stats.get("buys")) + num(stats.get("sells")) >= SIGNAL_BOT_TRADES) or bool(flip and (chain, address) in flip)
    pnl30 = row["pnl30_usd"] if row and row["pnl30_usd"] is not None else stats.get("realized")
    pnl30_at = (row["pnl30_at"] if row and row["pnl30_usd"] is not None else None) or (row["scored_at"] if row else None)
    return {"chain": chain, "address": address, "grade": grade, "score": row["score"] if row else None, "style": style,
            "name": (row["name"] if row else "") or "", "twitter": (row["twitter"] if row else "") or "",
            "tags": tags, "kol": bool({"kol", "renowned"} & set(tags)), "smart": "smart_degen" in tags,
            "label": (label or {}).get("label", ""), "kind": kind, "kindText": KIND_TEXT.get(kind, ""),
            "watch": row["watch"] if row else 0, "weight": None if weight is None else round(weight, 2),
            "realized30": stats.get("realized"), "winrate": stats.get("winrate"), "sources": loads(row["sources"], []) if row else [],
            "pnl30": pnl30, "pnl30At": pnl30_at if pnl30 is not None else None, "pnlTier": profit_tier(pnl30), "bot": bot}


def overview(payload: dict[str, Any], tracker: Tracker | None, *, at: int | None = None, full: bool = False) -> dict[str, Any]:
    chain = payload.get("chain") if payload.get("chain") in CHAINS else None
    window = int(clamp(num(payload.get("window"), 1800), 300, 86400))
    min_usd = clamp(num(payload.get("minUsd"), 30), 0, 1_000_000)
    launchpad_only = payload.get("launchpadOnly", True) is not False
    max_mcap = clamp(num(payload.get("maxMcap"), 0), 0, MAX_MEME_MCAP)
    no_bots = payload.get("noBots") is True
    now = at or now_ts()
    since = now - window

    def work(conn: sqlite3.Connection) -> dict[str, Any]:
        q = "SELECT * FROM sm_trades WHERE ts>=? AND ts<=?" + (" AND chain=?" if chain else "") + " ORDER BY ts DESC LIMIT 40000"
        upper = now if at else now + 86400
        trades = conn.execute(q, (since, upper, chain) if chain else (since, upper)).fetchall()
        pairs = {(t["chain"], t["maker"]) for t in trades}
        wallets = _wallet_rows(conn, pairs)
        labels = _labels(conn, {t["maker"] for t in trades})
        tokens_needed = {(t["chain"], t["token"]) for t in trades}
        token_rows: dict[tuple[str, str], sqlite3.Row] = {}
        for c in {c for c, _ in tokens_needed}:
            cas = [ca for cc, ca in tokens_needed if cc == c]
            for i in range(0, len(cas), 400):
                chunk = cas[i:i + 400]
                for r in conn.execute(f"SELECT * FROM sm_tokens WHERE chain=? AND ca IN ({','.join('?' * len(chunk))})", (c, *chunk)):
                    token_rows[(c, r["ca"])] = r
        briefs: dict[tuple[str, str], dict[str, Any]] = {}
        flip = _fast_flip_set(conn)

        def brief(c: str, a: str) -> dict[str, Any]:
            key = (c, a)
            if key not in briefs:
                briefs[key] = wallet_brief(c, a, wallets.get(key), labels.get(a), flip)
            return briefs[key]

        groups: dict[tuple[str, str], dict[str, Any]] = {}
        for t in trades:
            g = groups.setdefault((t["chain"], t["token"]), {"makers": {}, "buyUsd": 0.0, "sellUsd": 0.0, "last": None, "symbol": t["symbol"]})
            m = g["makers"].setdefault(t["maker"], {"buy": 0.0, "sell": 0.0, "first": None, "last": 0, "qty": 0.0, "full": False, "prices": []})
            if t["side"] == "buy":
                m["buy"] += t["usd"]
                m["qty"] += t["usd"]
                m["first"] = t["ts"] if m["first"] is None else min(m["first"], t["ts"])
                m["full"] = m["full"] or bool(t["full"])
                if t["price"]:
                    m["prices"].append((t["usd"], t["price"]))
            else:
                m["sell"] += t["usd"]
            m["last"] = max(m["last"], t["ts"])
            if g["last"] is None or t["ts"] >= g["last"]["ts"]:
                g["last"] = {"ts": t["ts"], "price": t["price"]}
        signals = []
        over_cap = bot_skipped = 0
        for (c, ca), g in groups.items():
            buyers, risk, points = [], [], []
            buy_usd = sell_usd = 0.0
            sellers = 0
            entry_num = entry_den = 0.0
            first_buy = None
            for addr, m in g["makers"].items():
                b = brief(c, addr)
                if b["weight"] is None:
                    continue
                buy_usd += m["buy"]
                sell_usd += m["sell"]
                if m["sell"] >= min_usd and m["sell"] > m["buy"]:
                    sellers += 1
                if m["buy"] < min_usd:
                    continue
                exited = m["sell"] >= SIGNAL["exitShare"] * m["buy"]
                entry = {"address": addr, "usd": round(m["buy"], 2), "sell": round(m["sell"], 2), "first": m["first"], "full": m["full"],
                         "grade": b["grade"], "label": b["label"], "kind": b["kind"], "name": b["name"] or b["twitter"],
                         "weight": b["weight"], "kol": b["kol"], "exited": exited, "bot": b["bot"]}
                points.append({"t": m["first"], "usd": round(m["buy"], 2), "grade": b["grade"], "kind": b["kind"], "w": b["weight"], "x": exited})
                if b["weight"] <= 0:
                    risk.append(entry)
                    continue
                buyers.append(entry)
                first_buy = m["first"] if first_buy is None else min(first_buy, m["first"])
                for usd, price in m["prices"]:
                    entry_num += usd
                    entry_den += usd / price if price else 0
            if not buyers:
                continue
            holders = [b for b in buyers if not b["exited"]]
            conviction = round(sum(b["weight"] * (SIGNAL["exitedWeight"] if b["exited"] else 1) for b in buyers), 2)
            strong_wallets = sum(1 for b in holders if b["weight"] >= SIGNAL["solidWeight"])
            top = max((b["weight"] for b in holders), default=0)
            holder_usd = sum(b["usd"] for b in holders)
            if (strong_wallets >= SIGNAL["strongWallets"] and buy_usd > SIGNAL["strongBuySellRatio"] * sell_usd
                    and holder_usd >= SIGNAL["strongUsd"]):
                strength = "strong"
            elif strong_wallets >= SIGNAL["mediumWallets"] and holder_usd >= SIGNAL["mediumUsd"]:
                strength = "medium"
            elif strong_wallets == 1 and top >= SIGNAL["singleMinWeight"]:
                strength = "weak"
            else:
                continue
            tok = token_rows.get((c, ca))
            if ca in BASE_TOKENS or (launchpad_only and not (tok is not None and tok["launchpad"])):
                continue
            last_price = (g["last"] or {}).get("price") or 0
            cur, cur_src = last_price, "最近一笔聪明钱成交"
            if tok is not None and tok["price"] and tok["price_at"] and now - 180 <= tok["price_at"] <= now + 60:
                cur, cur_src = tok["price"], "DexScreener"
            entry_price = entry_num / entry_den if entry_den else 0
            supply = (tok["supply"] if tok is not None else 0) or 0
            mcap = cur * supply if cur and supply else (tok["mcap"] if tok is not None else None)
            if (mcap or 0) > MAX_MEME_MCAP:
                continue
            if max_mcap and (mcap or 0) > max_mcap:
                over_cap += 1
                continue
            bot_holders = sum(1 for b in holders if b["bot"])
            if no_bots and bot_holders:
                bot_skipped += 1
                continue
            buyers.sort(key=lambda b: (b["exited"], -b["weight"], b["first"] or 0))
            mix: dict[str, int] = {}
            for b in buyers:
                key = b["grade"] or "none"
                mix[key] = mix.get(key, 0) + 1
                if b["exited"]:
                    mix["exited"] = mix.get("exited", 0) + 1
                if b["kind"] in ("ally", "insider"):
                    mix[b["kind"]] = mix.get(b["kind"], 0) + 1
                if b["kol"]:
                    mix["kol"] = mix.get("kol", 0) + 1
            flags = []
            if risk:
                kinds = {r["kind"] for r in risk}
                flags.append({"level": "danger", "text": f"你标的{'／'.join(KIND_TEXT[k] for k in sorted(kinds))}也在买（{len(risk)} 个）"})
            if all(b["kol"] and not b["grade"] for b in buyers):
                flags.append({"level": "warn", "text": "只有 KOL 在买，还没有评过分的聪明钱"})
            if sell_usd > buy_usd and sell_usd > 0:
                flags.append({"level": "warn", "text": "这段时间卖出比买进多"})
            if bot_holders:
                flags.append({"level": "warn", "text": f"还拿着的有 {bot_holders} 个机器人（30 天买卖 {SIGNAL_BOT_TRADES:,} 笔以上，或几乎每颗币都 {FLIP_SECONDS} 秒内就卖）"})
            signals.append({
                "chain": c, "ca": ca, "symbol": (tok["symbol"] if tok is not None and tok["symbol"] else g["symbol"]) or ca[:6],
                "logo": tok["logo"] if tok is not None else "", "launchpad": tok["launchpad"] if tok is not None else "",
                "strength": strength, "conviction": conviction, "wallets": len(buyers), "holders": len(holders), "strongWallets": strong_wallets,
                "botHolders": bot_holders,
                "buyUsd": round(buy_usd, 2), "sellUsd": round(sell_usd, 2), "sellers": sellers,
                "firstBuy": first_buy, "lastTs": (g["last"] or {}).get("ts"),
                "entryPrice": entry_price, "price": cur, "priceSrc": cur_src,
                "change": (cur / entry_price - 1) if cur and entry_price else None,
                "entryMcap": entry_price * supply if entry_price and supply else None,
                "mcap": mcap,
                "liquidity": tok["liquidity"] if tok is not None else None,
                "buyers": buyers[:12], "risk": risk[:6], "flags": flags, "mix": mix,
                "points": sorted(points, key=lambda p: p["t"] or 0)[-48:],
                **({"allBuyers": buyers} if full else {}),
            })
        order = {"strong": 0, "medium": 1, "weak": 2}
        signals.sort(key=lambda s: (order[s["strength"]], -s["conviction"], -(s["lastTs"] or 0)))
        feed = []
        for t in trades if not full else []:
            if t["usd"] < min_usd:
                continue
            b = brief(t["chain"], t["maker"])
            if b["weight"] is None:
                continue
            tok = token_rows.get((t["chain"], t["token"]))
            if launchpad_only and not (tok is not None and tok["launchpad"]):
                continue
            feed.append({"chain": t["chain"], "tx": t["tx"], "maker": t["maker"], "token": t["token"],
                         "symbol": (tok["symbol"] if tok is not None and tok["symbol"] else t["symbol"]) or t["token"][:6],
                         "logo": tok["logo"] if tok is not None else "", "side": t["side"], "usd": round(t["usd"], 2),
                         "price": t["price"], "full": bool(t["full"]), "ts": t["ts"], "source": t["source"],
                         "mcap": t["price"] * tok["supply"] if tok is not None and tok["supply"] and t["price"] else None,
                         "wallet": {k: b[k] for k in ("grade", "label", "kind", "name", "twitter", "kol", "weight", "watch")}})
            if len(feed) >= 160:
                break
        return {"signals": signals if full else signals[:40], "feed": feed, "window": window, "minUsd": min_usd,
                "counts": {"trades": len(trades), "wallets": len(pairs), "tokens": len(groups),
                           "strong": sum(s["strength"] == "strong" for s in signals), "medium": sum(s["strength"] == "medium" for s in signals),
                           "overCap": over_cap, "maxMcap": max_mcap, "botSkipped": bot_skipped, "noBots": no_bots}}

    result = db(work)
    return {"ok": True, "now": now, **result, "tracker": tracker.snapshot() if tracker else None,
            "rules": {"signal": SIGNAL_RULES, "score": SCORE_RULES, "penalties": PENALTIES, "grade": GRADE_TEXT}}


def token_detail(payload: dict[str, Any]) -> dict[str, Any]:
    ca = norm_addr(payload.get("ca"))
    chain = payload.get("chain") if payload.get("chain") in CHAINS else chain_of(ca)
    if not chain or not ca:
        raise ValueError("代币地址格式不正确")
    fresh = db(lambda conn: conn.execute("SELECT price_at FROM sm_tokens WHERE chain=? AND ca=?", (chain, ca)).fetchone())
    if not fresh or not fresh["price_at"] or fresh["price_at"] < now_ts() - 120:
        fetch_dex_prices(chain, [ca])

    def work(conn: sqlite3.Connection) -> dict[str, Any]:
        trades = conn.execute("SELECT * FROM sm_trades WHERE chain=? AND token=? ORDER BY ts", (chain, ca)).fetchall()
        tok = conn.execute("SELECT * FROM sm_tokens WHERE chain=? AND ca=?", (chain, ca)).fetchone()
        info = dict(tok) if tok is not None else {"chain": chain, "ca": ca}
        priced = [t for t in trades if t["price"]]
        if not info.get("price") and priced:
            info.update(price=priced[-1]["price"], price_src="最近一笔聪明钱成交", price_at=priced[-1]["ts"])
        if info.get("price") and info.get("supply"):
            info["mcap"] = info["price"] * info["supply"]
        wallets = _wallet_rows(conn, {(chain, t["maker"]) for t in trades})
        labels = _labels(conn, {t["maker"] for t in trades})
        per: dict[str, dict[str, Any]] = {}
        timeline = []
        for t in trades:
            b = wallet_brief(chain, t["maker"], wallets.get((chain, t["maker"])), labels.get(t["maker"]))
            if b["weight"] is None:
                continue
            p = per.setdefault(t["maker"], {**b, "buy": 0.0, "sell": 0.0, "first": t["ts"], "last": t["ts"], "trades": 0})
            p["buy" if t["side"] == "buy" else "sell"] += t["usd"]
            p["last"] = t["ts"]
            p["trades"] += 1
            timeline.append({"ts": t["ts"], "side": t["side"], "usd": round(t["usd"], 2), "price": t["price"], "maker": t["maker"],
                             "grade": b["grade"], "label": b["label"], "kind": b["kind"], "tx": t["tx"], "full": bool(t["full"])})
        rows = sorted(per.values(), key=lambda p: (-(p["weight"] or 0), p["first"]))
        for p in rows:
            p["buy"], p["sell"] = round(p["buy"], 2), round(p["sell"], 2)
        return {"token": info, "wallets": rows, "timeline": timeline[-400:]}

    return {"ok": True, **db(work)}


KLINE_STEPS = {"5m": 300, "15m": 900, "1h": 3600}
KLINE_BARS = 100
KLINE_MIN_BARS = 36
KLINE_CACHE_SECONDS = 60
KLINE_WAIT = 15
_kline_cache: dict[tuple[str, str, str, int], tuple[float, dict[str, Any]]] = {}
_kline_lock = threading.Lock()


def kline_resolution(span: float) -> str:
    if span <= 8 * 3600:
        return "5m"
    if span <= 25 * 3600:
        return "15m"
    return "1h"


def token_kline(payload: dict[str, Any]) -> dict[str, Any]:
    ca = norm_addr(payload.get("ca"))
    chain = payload.get("chain") if payload.get("chain") in CHAINS else chain_of(ca)
    if not chain or not ca or not fits_chain(chain, ca):
        raise ValueError("代币地址格式不正确")
    now = now_ts()
    since = int(num(payload.get("since")))
    if since <= 0 or since > now:
        row = db(lambda conn: conn.execute("SELECT MIN(ts) FROM sm_trades WHERE chain=? AND token=?", (chain, ca)).fetchone())
        since = int(row[0] or now)
    want = str(payload.get("resolution") or "auto")
    auto = want not in KLINE_STEPS
    resolution = kline_resolution(now - since) if auto else want
    step = KLINE_STEPS[resolution]
    end = (now // step + 1) * step
    bars = int(min(KLINE_BARS, max(KLINE_MIN_BARS, (end - since) // step + 4)))
    start = end - bars * step
    key = (chain, ca, resolution, start)
    with _kline_lock:
        hit = _kline_cache.get(key)
    if hit and time.time() - hit[0] < KLINE_CACHE_SECONDS:
        return {**hit[1], "auto": auto, "cached": True}
    data = limiter().call("/v1/market/token_kline", {"chain": chain, "address": ca, "resolution": resolution,
                                                     "from": start * 1000, "to": now * 1000}, 2, max_wait=KLINE_WAIT)
    bars_by_ts: dict[int, list[float]] = {}
    for k in ((data or {}).get("list") if isinstance(data, dict) else data) or []:
        ts = int(num(k.get("time")))
        ts = ts // 1000 if ts > 10 ** 11 else ts
        o, hi, lo, c = (num(k.get(x)) for x in ("open", "high", "low", "close"))
        if ts >= start and min(o, hi, lo, c) > 0:
            bars_by_ts[ts] = [ts, o, max(hi, o, c), min(lo, o, c), c, num(k.get("volume"))]
    result = {"ok": True, "chain": chain, "ca": ca, "resolution": resolution, "step": step, "from": start, "end": end,
              "candles": [bars_by_ts[t] for t in sorted(bars_by_ts)][-KLINE_BARS:], "fetchedAt": now}
    with _kline_lock:
        _kline_cache[key] = (time.time(), result)
        if len(_kline_cache) > 300:
            for old in sorted(_kline_cache, key=lambda k: _kline_cache[k][0])[:100]:
                del _kline_cache[old]
    return {**result, "auto": auto, "cached": False}


def wallet_detail(payload: dict[str, Any], tracker: Tracker | None = None) -> dict[str, Any]:
    address = norm_addr(payload.get("address"))
    chain = payload.get("chain") if payload.get("chain") in CHAINS else chain_of(address)
    if not chain or not address:
        raise ValueError("钱包地址格式不正确")
    if payload.get("rescore") and tracker:
        tracker.score_wallet(chain, address)

    def work(conn: sqlite3.Connection) -> dict[str, Any]:
        row = conn.execute("SELECT * FROM sm_wallets WHERE chain=? AND address=?", (chain, address)).fetchone()
        label = _labels(conn, {address}).get(address)
        trades = conn.execute("SELECT t.*, k.logo, k.symbol AS tsym FROM sm_trades t LEFT JOIN sm_tokens k ON k.chain=t.chain AND k.ca=t.token "
                              "WHERE t.chain=? AND t.maker=? ORDER BY t.ts DESC LIMIT 120", (chain, address)).fetchall()
        hits = conn.execute("SELECT h.*, COALESCE(s.rule, 0) AS rule FROM sm_mine_hits h LEFT JOIN sm_mine_scans s ON s.chain=h.chain AND s.ca=h.ca "
                            "WHERE h.chain=? AND h.address=? ORDER BY h.profit DESC", (chain, address)).fetchall()
        brief = wallet_brief(chain, address, row, label)
        return {"wallet": {**brief, "stats": loads(row["stats"], {}) if row else {}, "scoredAt": row["scored_at"] if row else None,
                           "mined": loads(row["mined"], {}) if row else {}, "firstSeen": row["first_seen"] if row else None,
                           "lastTradeTs": row["last_trade_ts"] if row else None, "polledAt": row["polled_at"] if row else None},
                "trades": [{"ts": t["ts"], "side": t["side"], "usd": round(t["usd"] or 0, 2), "token": t["token"],
                            "symbol": t["tsym"] or t["symbol"], "logo": t["logo"] or "", "price": t["price"], "tx": t["tx"],
                            "full": bool(t["full"]), "source": t["source"]} for t in trades],
                "hits": [dict(h) for h in hits]}

    return {"ok": True, **db(work), "rules": {"score": SCORE_RULES, "penalties": PENALTIES}}


def wallets_list(payload: dict[str, Any]) -> dict[str, Any]:
    chain = payload.get("chain") if payload.get("chain") in CHAINS else None
    group = str(payload.get("group") or "watch")
    query = str(payload.get("q") or "").strip().lower()
    sort = str(payload.get("sort") or "score")
    since = now_ts() - 86400

    def work(conn: sqlite3.Connection) -> dict[str, Any]:
        where, args = [], []
        if chain:
            where.append("w.chain=?"); args.append(chain)
        if group == "watch":
            where.append("w.watch=1")
        elif group == "label":
            where.append("w.sources LIKE '%\"label\"%'")
        elif group == "mined":
            where.append("w.sources LIKE '%\"mined\"%'")
        elif group == "gmgn":
            where.append("(w.sources LIKE '%gmgn_smart%' OR w.sources LIKE '%gmgn_kol%') AND w.scored_at IS NOT NULL")
        elif group == "muted":
            where.append("w.watch=-1")
        elif group == "top":
            where.append("w.grade IN ('S','A')")
        sql = ("SELECT w.*, (SELECT COUNT(*) FROM sm_trades t WHERE t.chain=w.chain AND t.maker=w.address AND t.ts>=?) AS t24 "
               "FROM sm_wallets w" + (" WHERE " + " AND ".join(where) if where else ""))
        rows = conn.execute(sql, (since, *args)).fetchall()
        labels = _labels(conn, {r["address"] for r in rows})
        in_bsc = {r["address"] for r in rows if r["chain"] == "bsc"} if not chain else set()
        out = []
        for r in rows:
            if (r["chain"] == "robinhood" and r["address"] in in_bsc and r["scored_at"] is None and not r["last_trade_ts"]
                    and "mined" not in loads(r["sources"], [])):
                continue
            b = wallet_brief(r["chain"], r["address"], r, labels.get(r["address"]))
            if b["kind"] == "own" and group != "muted":
                continue
            if query and query not in r["address"].lower() and query not in (b["label"] or "").lower() and query not in (b["name"] or "").lower() and query not in (b["twitter"] or "").lower():
                continue
            mined = loads(r["mined"], {})
            out.append({**b, "trades24": r["t24"], "lastTradeTs": r["last_trade_ts"], "scoredAt": r["scored_at"],
                        "mined": mined, "stats": {k: v for k, v in loads(r["stats"], {}).items() if k in ("realized", "roi", "winrate", "tokens", "avgBuy", "bigWins")}})
        if sort == "recent":
            out.sort(key=lambda x: -(x["lastTradeTs"] or 0))
        elif sort == "profit":
            out.sort(key=lambda x: -(x["pnl30"] if x["pnl30"] is not None else -1e12))
        else:
            out.sort(key=lambda x: (-(x["score"] if x["score"] is not None else -1), -(x["lastTradeTs"] or 0)))
        totals = {
            "watch": conn.execute(f"SELECT COUNT(DISTINCT {WALLET_KEY_SQL}) FROM sm_wallets WHERE watch=1" + (" AND chain=?" if chain else ""), (chain,) if chain else ()).fetchone()[0],
            "top": conn.execute("SELECT COUNT(*) FROM sm_wallets WHERE grade IN ('S','A')" + (" AND chain=?" if chain else ""), (chain,) if chain else ()).fetchone()[0],
            "mined": conn.execute("SELECT COUNT(*) FROM sm_wallets WHERE sources LIKE '%\"mined\"%'" + (" AND chain=?" if chain else ""), (chain,) if chain else ()).fetchone()[0],
        }
        return {"rows": out[:400], "total": len(out), "totals": totals}

    return {"ok": True, **db(work)}


FOMO_7702_DELEGATES = frozenset({"0xe6cae83bde06e4c305530e199d7217f42808555b"})
BSC_CODE_RPCS = ("https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org", "https://rpc.48.club")
RH_CODE_RPCS = ("https://robinhood-rpc.publicnode.com", "https://rpc.mainnet.chain.robinhood.com")
EVM_KIND_RULE_AT = 0
EVM_KIND_TTL = 7 * 86400
EVM_KIND_BATCH = 25


def evm_code_kind(code: Any) -> tuple[str, str]:
    c = str(code or "").lower()
    if c.startswith("0xef0100") and len(c) == 48:
        delegate = "0x" + c[8:]
        return ("fomo" if delegate in FOMO_7702_DELEGATES else "7702"), delegate
    return ("eoa" if c in ("", "0x") else "contract"), ""


def bsc_codes(addresses: list[str]) -> dict[str, str]:
    return chain_codes(addresses, BSC_CODE_RPCS, "BSC")


def chain_codes(addresses: list[str], rpcs: tuple[str, ...], name: str) -> dict[str, str]:
    body = json.dumps([{"jsonrpc": "2.0", "id": i, "method": "eth_getCode", "params": [a, "latest"]} for i, a in enumerate(addresses)]).encode()
    last: Exception | None = None
    for url in rpcs:
        try:
            request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json", "User-Agent": UA})
            with urllib.request.urlopen(request, timeout=10) as response:
                out = json.loads(response.read().decode("utf-8"))
            got = {addresses[x["id"]]: x["result"] for x in (out if isinstance(out, list) else [])
                   if isinstance(x, dict) and isinstance(x.get("id"), int) and 0 <= x["id"] < len(addresses) and isinstance(x.get("result"), str)}
            if len(got) == len(addresses):
                return got
            last = RuntimeError(f"只回了 {len(got)}/{len(addresses)} 个")
        except Exception as exc:
            last = exc
    raise RuntimeError(f"{name} 节点都查不到钱包代码：{last}")


def merge_code_kinds(found: list[tuple[str, str]]) -> tuple[str, str]:
    for want in ("fomo", "7702", "contract"):
        hit = next((f for f in found if f[0] == want), None)
        if hit:
            return hit
    return ("eoa", "")


def evm_kinds(addresses: list[str]) -> dict[str, str]:
    keys = list(dict.fromkeys(a for a in (norm_addr(x) for x in addresses) if a.startswith("0x")))[:400]
    if not keys:
        return {}
    now = now_ts()

    def read(conn: sqlite3.Connection) -> dict[str, tuple[str, int]]:
        out: dict[str, tuple[str, int]] = {}
        for i in range(0, len(keys), 400):
            chunk = keys[i:i + 400]
            for r in conn.execute(f"SELECT address, kind, checked_at FROM sm_evm_kind WHERE address IN ({','.join('?' * len(chunk))})", chunk):
                out[r["address"]] = (r["kind"], int(r["checked_at"] or 0))
        return out

    cached = db(read)
    kinds = {a: k for a, (k, at) in cached.items() if now - at < EVM_KIND_TTL and (k == "fomo" or at >= EVM_KIND_RULE_AT)}
    todo = [a for a in keys if a not in kinds]
    fresh: list[tuple[str, str, str, int]] = []
    for i in range(0, len(todo), EVM_KIND_BATCH):
        part = todo[i:i + EVM_KIND_BATCH]
        got: list[dict[str, str] | None] = []
        for rpcs, name in ((BSC_CODE_RPCS, "BSC"), (RH_CODE_RPCS, "RH")):
            try:
                got.append(chain_codes(part, rpcs, name))
            except RuntimeError:
                got.append(None)
        if all(g is None for g in got):
            break
        for a in part:
            found = [evm_code_kind(g[a]) for g in got if g is not None and a in g]
            kind, delegate = merge_code_kinds(found)
            if kind != "fomo" and any(g is None for g in got):
                continue
            kinds[a] = kind
            fresh.append((a, kind, delegate, now))
    if fresh:
        db(lambda conn: conn.executemany("INSERT OR REPLACE INTO sm_evm_kind (address, kind, delegate, checked_at) VALUES (?,?,?,?)", fresh))
    for a, (k, _) in cached.items():
        kinds.setdefault(a, k)
    return kinds


def mined_list(payload: dict[str, Any]) -> dict[str, Any]:
    chain = payload.get("chain") if payload.get("chain") in CHAINS else "bsc"

    def work(conn: sqlite3.Connection) -> dict[str, Any]:
        rows = conn.execute("SELECT h.address, COUNT(DISTINCT h.ca) n, SUM(h.profit) p, AVG(h.roi) r, MIN(h.entry_delay) d, GROUP_CONCAT(h.symbol, '、') s, "
                            "SUM(COALESCE(sc.rule, 0) < ?) old FROM sm_mine_hits h LEFT JOIN sm_mine_scans sc ON sc.chain=h.chain AND sc.ca=h.ca "
                            "WHERE h.chain=? GROUP BY h.address HAVING n>=2 ORDER BY n DESC, p DESC", (MINE_RULE, chain)).fetchall()
        last = get_state(conn, f"mine_last_{chain}", {})
        fresh = set(last.get("new") or [])
        rows = sorted(rows, key=lambda r: r["address"] not in fresh)[:200]
        wallets = _wallet_rows(conn, {(chain, r["address"]) for r in rows})
        labels = _labels(conn, {r["address"] for r in rows})
        plats = _platform_names(conn, chain, [r["address"] for r in rows])
        pending = conn.execute("SELECT COUNT(*) FROM sm_mine_scans WHERE chain=? AND rule<? AND hits>0", (chain, MINE_RULE)).fetchone()[0]
        return {"rows": [{**wallet_brief(chain, r["address"], wallets.get((chain, r["address"])), labels.get(r["address"])),
                          "hits": r["n"], "profit": round(r["p"] or 0, 2), "roi": r["r"], "fastestEntry": r["d"],
                          "tokens": [s for s in (r["s"] or "").split("、") if s][:8], "isNew": r["address"] in fresh, "oldHits": r["old"] or 0,
                          "platforms": plats.get(r["address"], [])} for r in rows],
                "last": last, "pending": pending, "named": sum(1 for r in rows if plats.get(r["address"]))}

    out = db(work)
    if chain in EVM_CHAINS and out["rows"]:
        kinds = evm_kinds([r["address"] for r in out["rows"]])
        for r in out["rows"]:
            r["fomoWallet"] = kinds.get(r["address"]) == "fomo"
        out["fomoWallets"] = sum(1 for r in out["rows"] if r["fomoWallet"])
        out["fomoUnchecked"] = sum(1 for r in out["rows"] if r["address"] not in kinds)
    return {"ok": True, "chain": chain, "mineSources": list(MINE_SOURCES), "mineRule": MINE_RULE, "mineAll": True, "mineFomoNames": True, **out}


def set_watch(payload: dict[str, Any]) -> dict[str, Any]:
    address = norm_addr(payload.get("address"))
    chain = payload.get("chain") if payload.get("chain") in CHAINS else chain_of(address)
    watch = int(num(payload.get("watch"), 1))
    if not chain or watch not in (-1, 0, 1):
        raise ValueError("参数不正确")

    def work(conn: sqlite3.Connection) -> None:
        upsert_wallet(conn, chain, address, source="manual" if watch == 1 else "")
        conn.execute("UPDATE sm_wallets SET watch=?, next_poll=CASE WHEN ?=1 THEN ? ELSE next_poll END, want_score=CASE WHEN ?=1 AND scored_at IS NULL THEN 1 ELSE want_score END WHERE chain=? AND address=?",
                     (watch, watch, now_ts(), watch, chain, address))
        for other in evm_siblings(chain):
            if watch == 1:
                upsert_wallet(conn, other, address, source="manual")
            conn.execute("UPDATE sm_wallets SET watch=? WHERE chain=? AND address=?", (watch, other, address))

    db(work)
    return {"ok": True, "chain": chain, "address": address, "watch": watch}


def watching(payload: dict[str, Any]) -> dict[str, Any]:
    raw = payload.get("addresses") if isinstance(payload.get("addresses"), list) else []
    keys = list(dict.fromkeys(norm_addr(a) for a in raw if isinstance(a, str) and a.strip()))[:500]

    def work(conn: sqlite3.Connection) -> dict[str, Any]:
        state: dict[str, int] = {}
        for i in range(0, len(keys), 400):
            chunk = keys[i:i + 400]
            for r in conn.execute(f"SELECT address, MAX(watch) AS hi, MIN(watch) AS lo FROM sm_wallets WHERE address IN ({','.join('?' * len(chunk))}) "
                                  "GROUP BY address", chunk):
                state[r["address"]] = 1 if r["hi"] == 1 else -1 if r["lo"] == -1 else 0
        return {"watching": [a for a, s in state.items() if s == 1], "muted": [a for a, s in state.items() if s == -1]}

    return {"ok": True, **db(work)}


def add_wallets(payload: dict[str, Any]) -> dict[str, Any]:
    found, invalid = [], []
    for line in str(payload.get("text") or "").splitlines():
        token = line.strip().split()[0] if line.strip() else ""
        if not token:
            continue
        address = norm_addr(token.strip(",;"))
        chain = chain_of(address)
        (found if chain else invalid).append((chain, address) if chain else token[:60])
    found = list(dict.fromkeys(found))[:500]

    def work(conn: sqlite3.Connection) -> None:
        for chain, address in found:
            upsert_wallet(conn, chain, address, source="manual", watch=1, want_score=True)
            conn.execute("UPDATE sm_wallets SET next_poll=? WHERE chain=? AND address=? AND watch=1", (now_ts(), chain, address))
            for other in evm_siblings(chain):
                upsert_wallet(conn, other, address, source="manual", watch=1)

    db(work)
    return {"ok": True, "added": len(found), "invalid": invalid[:20]}


_tracker: Tracker | None = None


def start(key_provider: Callable[[], str]) -> Tracker:
    global _tracker
    cache: dict[str, Any] = {"at": 0.0, "key": ""}

    def cached_key() -> str:
        if time.time() - cache["at"] > 60:
            try:
                cache["key"] = key_provider() or ""
            except Exception:
                cache["key"] = ""
            cache["at"] = time.time()
        return cache["key"]

    _tracker = Tracker(Gmgn(cached_key))
    db(lambda conn: None)
    _tracker.start()
    return _tracker


def tracker() -> Tracker | None:
    return _tracker


_spare_lock = threading.Lock()
_spare: Gmgn | None = None


def limiter() -> Gmgn:
    global _spare
    if _tracker is not None:
        return _tracker.gmgn
    with _spare_lock:
        if _spare is None:
            _spare = Gmgn(lambda: "")
        return _spare


def handle(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    t = _tracker
    if path == "/api/smart/overview":
        return overview(payload, t)
    if path == "/api/smart/token":
        return token_detail(payload)
    if path == "/api/smart/kline":
        return token_kline(payload)
    if path == "/api/smart/wallet":
        return wallet_detail(payload, t)
    if path == "/api/smart/wallets":
        return wallets_list(payload)
    if path == "/api/smart/mined":
        return mined_list(payload)
    if path == "/api/smart/watch":
        return set_watch(payload)
    if path == "/api/smart/watching":
        return watching(payload)
    if path == "/api/smart/add":
        return add_wallets(payload)
    if path == "/api/smart/control":
        if t is None:
            raise RuntimeError("追踪没有启动")
        if "paused" in payload:
            t.paused = bool(payload.get("paused"))
        return {"ok": True, "tracker": t.snapshot()}
    if path == "/api/smart/mine":
        if t is None:
            raise RuntimeError("追踪没有启动")
        chain = payload.get("chain") if payload.get("chain") in CHAINS else "bsc"
        source = payload.get("source") if payload.get("source") in MINE_SOURCES else "auto"
        cas = list(dict.fromkeys(norm_addr(x) for x in re.split(r"[\s,]+", str(payload.get("cas") or "")) if fits_chain(chain, norm_addr(x))))[:200]
        fomo = parse_fomo_holders(payload.get("fomoHolders")) if source == "fomo" else {}
        if payload.get("all") is True and (source == "fomo" or not cas):
            jobs = mine_jobs(chain, source, payload.get("tokens"))
            if not jobs:
                raise ValueError("粘贴的 FOMO 热门里没有 BSC、SOL、RH 的币：先在 FOMO 页左边打开「代币 → 热门」按书签，再回来粘贴")
            return t.start_mine(jobs[0][0], jobs[0][1], source, jobs[0][2], jobs=jobs, **({"fomo": fomo} if fomo else {}))
        if source == "fomo" and not cas:
            raise ValueError(f"没有 {chain.upper() if chain != 'robinhood' else 'RH'} 的 FOMO 热门：先在 FOMO 页左边打开「代币 → 热门」按书签，再回来粘贴")
        raw = payload.get("symbols") if isinstance(payload.get("symbols"), dict) else {}
        symbols = {norm_addr(k): str(v)[:40] for k, v in raw.items() if norm_addr(k) in cas}
        fomo = {k: v for k, v in fomo.items() if k[0] == chain}
        return t.start_mine(chain, cas, source, symbols, **({"fomo": fomo} if fomo else {}))
    if path == "/api/smart/review":
        return review_report(payload, t)
    if path == "/api/smart/review-run":
        if t is None:
            raise RuntimeError("追踪没有启动")
        return t.start_review(f"手动 {local_time(time.time(), '%m/%d %H:%M')}", manual=True)
    raise ValueError("找不到此 API")


PATHS = {"/api/smart/overview", "/api/smart/token", "/api/smart/kline", "/api/smart/wallet", "/api/smart/wallets", "/api/smart/mined",
         "/api/smart/watch", "/api/smart/watching", "/api/smart/add", "/api/smart/control", "/api/smart/mine", "/api/smart/review", "/api/smart/review-run"}
