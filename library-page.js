"use strict";

const PLATFORM_EXPORT_TAG = { FOMO: "FOMO", "pump.fun": "pump" };
const PLATFORM_EXPORT_CHAINS = ["BSC", "Solana", "Robinhood"];
const EXPORT_KINDS = ["follow", "avoid", "platform"];
const EXPORT_LABEL_SHORT = [
  ["insider", "⚠内部"], ["bundle_member", "⚠同源"], ["gmgn_bundler", "⚠捆绑"], ["sniper", "⚠狙击"], ["bot", "⚠机器人"],
  ["pnl_1m", "赚1M+"], ["pnl_500k", "赚500K+"], ["pnl_200k", "赚200K+"], ["pnl_100k", "赚100K+"], ["pnl_50k", "赚50K+"], ["pnl_30k", "赚30K+"], ["pnl_10k", "赚10K+"], ["pnl_5k", "赚5K+"], ["pnl_3k", "赚3K+"],
  ["gold_regular", "金狗常客"], ["fresh_gold", "新钱包金狗"], ["top_seller", "卖在高点"], ["diamond", "钻石手"], ["paper_gold", "金狗卖飞"],
  ["smart_money", "聪明钱"], ["gmgn_smart", "GMGN聪明钱"], ["long_pnl", "30天赚"], ["early_profit", "早期高盈利"],
  ["long_hold_big", "长抱大赚"], ["hft", "高频"],
];
const EXPORT_MAX_LABELS = 4;
const EXPORT_DROPS = [
  ["bot", "机器人／高频交易"], ["pending", "还没查交易频率"], ["bundle", "捆绑（同源资金）"], ["insider", "疑似庄家／内部"], ["sniper", "狙击手"],
];
const EXPORT_DEFAULT_DROPS = ["bot", "pending", "quiet"];
const EXPORT_GRADES = ["S", "A", "B", "C", "D"];
const EXPORT_HIGH_FREQ = 1000;
const EXPORT_CHIP_NAME = { long_pnl: "30天赚", profit_1k: "赚1K+" };
const EXPORT_PLAT_TIERS = [0, 1, 500, 1000, 2000, 3000, 5000, 10000, 20000, 30000, 50000, 100000, 200000, 500000, 1000000];
const EXPORT_PLATFORMS = ["FOMO", "pump.fun"];
const EXPORT_SINCE_DAYS = [0, 1, 3, 7, 14, 30];
const EXPORT_PNL_LABELS = [["pnl_1m", 1e6], ["pnl_500k", 5e5], ["pnl_200k", 2e5], ["pnl_100k", 1e5], ["pnl_50k", 5e4], ["pnl_30k", 3e4], ["pnl_10k", 1e4], ["pnl_5k", 5e3], ["pnl_3k", 3e3]];
function exportUsd(value) {
  const n = Math.abs(Number(value) || 0);
  return `$${n >= 1e6 ? `${exportOne(n / 1e6)}M` : n >= 1000 ? `${exportOne(n / 1000)}K` : n}`;
}
const exportTierText = (t) => (!t ? "不限" : t === 1 ? "有赚" : `≥ ${exportUsd(t)}`);

function exportDropRows(highFreq = EXPORT_HIGH_FREQ) {
  const trades = [...new Set([300, 500, 1000, 2000, 5000, Number(highFreq) || EXPORT_HIGH_FREQ])].sort((a, b) => a - b);
  return [
    { id: "pnl", title: "总体盈利不到", note: "「库门槛」＝钱包库隐藏、清理用的门槛；更高的照盈利分级标签算，没有盈利纪录的也挡",
      opts: [["quiet", "库门槛"], ...[5e3, 1e4, 3e4, 5e4, 1e5, 2e5, 5e5, 1e6].map((v) => [`pnl:${v}`, exportUsd(v)])] },
    { id: "real", title: "30 天已实现盈利", note: "GMGN 30 天统计，没有数字的不挡",
      opts: [["real:-10000", "亏超过 $10K"], ["real:-1000", "亏超过 $1K"], ["loss30", "亏损"], ...[1e3, 3e3, 1e4, 3e4].map((v) => [`real:${v}`, `< ${exportUsd(v)}`])] },
    { id: "win", title: "30 天胜率低于", note: "没有数字的不挡", opts: [10, 20, 30, 40, 50].map((v) => [`win:${v}`, `${v}%`]) },
    { id: "trades", title: "30 天买卖笔数", note: "还没到机器人门槛、但买卖很多的",
      opts: trades.map((v) => [v === Number(highFreq) ? "highfreq" : `trades:${v}`, `≥ ${v.toLocaleString("en-US")}`]) },
    { id: "idle", title: "多久没交易", note: "照查到的最后一笔交易算到现在，没有纪录的不挡", opts: [3, 7, 14, 30].map((v) => [`idle:${v}`, `${v} 天`]) },
  ];
}
const EXPORT_SKIP = new Set(["gmgn_bundler"]);
const EXPORT_MAX_BUNDLES = 2;
const exportClean = (text) => String(text).replace(/[\s\u0000-\u001f]+/g, "_");
const exportOne = (value) => value.toFixed(1).replace(/\.0$/, "");

function exportMoney(value) {
  const n = value == null ? NaN : Number(value);
  if (!Number.isFinite(n)) return "";
  const abs = Math.abs(n);
  const body = abs >= 999950 ? `${exportOne(abs / 1e6)}M` : abs >= 999.5 ? `${exportOne(abs / 1e3)}K` : String(Math.round(abs));
  return `${n < 0 ? "-" : "+"}${body}`;
}

function platformExportRemark(rows) {
  const parts = (rows || []).map((p) => `${PLATFORM_EXPORT_TAG[p.platform] || p.platform}:${p.handle}${p.x ? `(X:${p.x})` : ""}`);
  return exportClean([...new Set(parts)].join("/"));
}

function acctTotal(acct) {
  const n = acct && acct.at && acct.total != null ? Number(acct.total) : NaN;
  return Number.isFinite(n) ? n : null;
}

const FOMO_PERIOD_NAME = { all: "全部", "30d": "30 天", "7d": "7 天", "24h": "24 小时" };
const FOMO_PERIOD_SHORT = [["30d", "30天"], ["7d", "7天"], ["24h", "24h"]];
function fomoBoardPnl(w, period) {
  const e = w && w.fomo ? w.fomo[period] : null;
  const n = e && e.pnl != null ? Number(e.pnl) : NaN;
  return Number.isFinite(n) ? n : null;
}

function strengthExportRemark(pf, pnl30, plat = null, gmgnOk = true, acct = null, fomo = null) {
  const parts = [];
  const platBest = plat && plat.n > 0 ? plat.best : null;
  const fomoAll = fomoBoardPnl({ fomo }, "all");
  const fomoPeriod = fomoAll == null ? FOMO_PERIOD_SHORT.find(([p]) => fomoBoardPnl({ fomo }, p) != null) : null;
  if (acctTotal(acct) != null || fomoAll != null) {
    parts.push(acctTotal(acct) != null ? `pump总${exportMoney(acctTotal(acct))}` : `FOMO总${exportMoney(fomoAll)}`);
    if (platBest && Number(platBest.pnl) > 0) parts.push(`最赚${platBest.symbol}${exportMoney(platBest.pnl)}`);
  } else {
    if (fomoPeriod) parts.push(`FOMO${fomoPeriod[1]}${exportMoney(fomoBoardPnl({ fomo }, fomoPeriod[0]))}`);
    if (platBest && plat.n === 1) parts.push(`平台盈亏${platBest.symbol}${exportMoney(platBest.pnl)}`);
    else if (platBest) {
      parts.push(`平台盈亏${exportMoney(plat.sum)}(${plat.n}颗)`);
      if (Number(platBest.pnl) > 0) parts.push(`最赚${platBest.symbol}${exportMoney(platBest.pnl)}`);
    }
  }
  if (gmgnOk !== false && pf && !pf.note) {
    if (pf.total != null) parts.push(`GMGN总${exportMoney(pf.total)}`);
    else if (pf.realized != null) parts.push(`GMGN已实现${exportMoney(pf.realized)}`);
    const rate = pnl30 && !pnl30.note && pnl30.winrate != null ? Number(pnl30.winrate) : NaN;
    const realized30 = pnl30 && pnl30.realized != null ? Number(pnl30.realized) : NaN;
    if (Number.isFinite(rate) && !(rate === 0 && realized30 > 0)) parts.push(`30天胜率${Math.round(rate <= 1 ? rate * 100 : rate)}%`);
    if (pf.bestSymbol && Number(pf.bestProfit) > 0 && pf.bestCa !== (platBest && platBest.ca)) parts.push(`最赚${pf.bestSymbol}${exportMoney(pf.bestProfit)}`);
  }
  return exportClean(parts.join("/"));
}

function walletExportRemark(labels, manual, platformRows, groupOf, labelName = {}, stats = {}) {
  const short = new Map(EXPORT_LABEL_SHORT);
  const order = new Map(EXPORT_LABEL_SHORT.map(([id], index) => [id, index]));
  const rank = (id) => order.has(id) ? order.get(id) : groupOf[id] === "avoid" ? 4.5 : 100;
  const gmgnOk = (platformRows || []).length ? false : stats.gmgnOk;
  const pumpAcct = stats.acct ? stats.acct["pump.fun"] : null;
  const pfBest = Boolean(acctTotal(pumpAcct) != null || (stats.plat && stats.plat.n > 0) || (gmgnOk !== false && stats.pf && !stats.pf.note && stats.pf.bestSymbol));
  const best = stats.best && stats.best.symbol && Number(stats.best.total) >= 1000 ? stats.best : null;
  const tagged = (labels || [])
    .filter((id) => (groupOf[id] === "follow" || groupOf[id] === "avoid") && !EXPORT_SKIP.has(id) && !(id === "profit_1k" && pfBest))
    .sort((a, b) => rank(a) - rank(b)).slice(0, EXPORT_MAX_LABELS)
    .flatMap((id) => {
      if (id === "bundle_member") {
        const rows = (stats.bundles || []).slice(0, EXPORT_MAX_BUNDLES);
        return rows.length ? rows.map((b) => `⚠${b.symbol || "?"}捆${b.group}`) : ["⚠捆绑"];
      }
      if (id === "profit_1k" && best) return [`最赚${best.symbol}${exportMoney(best.total)}`];
      return [short.get(id) || `${groupOf[id] === "avoid" ? "⚠" : ""}${labelName[id] || id}`];
    });
  const custom = (labels || []).filter((id) => !groupOf[id] && (manual || []).includes(id));
  const grade = stats.card && stats.card.grade ? `${stats.card.grade}级` : "";
  const platName = platformExportRemark(platformRows);
  const strength = strengthExportRemark(stats.pf, stats.pnl30, stats.plat, gmgnOk, pumpAcct, stats.fomo);
  const parts = (platName ? [platName, strength, grade, ...tagged, ...custom] : [grade, ...tagged, ...custom, strength]).filter(Boolean);
  return exportClean([...new Set(parts)].join("/"));
}

const pumpAcctOf = (w) => (w && w.acct ? w.acct["pump.fun"] : null);
function platformProfit(w, mode = "") {
  const acct = acctTotal(pumpAcctOf(w));
  if (acct != null) return { value: acct, src: "pump.fun 帐号", n: pumpAcctOf(w).coins, acct: true };
  const all = fomoBoardPnl(w, "all");
  if (all != null) return { value: all, src: "FOMO 全部榜", fomo: "all" };
  const sum = w && w.plat && w.plat.n > 0 ? Number(w.plat.sum) : NaN;
  if (Number.isFinite(sum)) return { value: sum, src: "平台", n: w.plat.n };
  for (const [period] of FOMO_PERIOD_SHORT) {
    const v = fomoBoardPnl(w, period);
    if (v != null) return { value: v, src: `FOMO ${FOMO_PERIOD_NAME[period]}榜`, fomo: period };
  }
  const gm = mode === "gmgn" && w && w.chain === "Solana" && w.gmgnOk && w.gm && w.gm.total != null ? Number(w.gm.total) : NaN;
  return Number.isFinite(gm) ? { value: gm, src: "GMGN 补", gmgn: true } : null;
}

function platformProfitStats(wallets, names, chain, platforms = [], mode = "") {
  const any = !platforms.length || platforms.includes("*");
  const addresses = new Set((names || []).filter((p) => p.chain === chain && p.address && p.handle && (any || platforms.includes(p.platform))).map((p) => p.address));
  const byAddress = new Map((wallets || []).filter((w) => w.chain === chain).map((w) => [w.address, w]));
  const stats = { total: addresses.size, loss: 0, small: 0, unknown: 0, fomoAll: 0, fomoPeriod: 0, gmgn: 0, gmgnCan: 0,
    tiers: Object.fromEntries(EXPORT_PLAT_TIERS.map((t) => [t, 0])) };
  const pumpAddresses = new Set((names || []).filter((p) => p.chain === chain && p.address && p.handle && p.platform === "pump.fun").map((p) => p.address));
  stats.pump = { total: pumpAddresses.size, synced: [...pumpAddresses].filter((a) => acctTotal(pumpAcctOf(byAddress.get(a))) != null).length };
  for (const address of addresses) {
    const w = byAddress.get(address);
    const profit = platformProfit(w, mode);
    stats.tiers[0] += 1;
    if (!profit) {
      stats.unknown += 1;
      if (platformProfit(w, "gmgn")) stats.gmgnCan += 1;
      continue;
    }
    if (profit.fomo === "all") stats.fomoAll += 1;
    else if (profit.fomo) stats.fomoPeriod += 1;
    else if (profit.gmgn) stats.gmgn += 1;
    if (profit.value < 0) stats.loss += 1;
    else if (profit.value < 1000) stats.small += 1;
    for (const t of EXPORT_PLAT_TIERS) if (t && profit.value >= t) stats.tiers[t] += 1;
  }
  return stats;
}

function exportPlatMin(value) {
  const ok = (v) => (EXPORT_PLAT_TIERS.includes(Number(v)) ? Number(v) : 0);
  return Object.fromEntries(EXPORT_PLATFORMS.map((p) => [p, ok(value && typeof value === "object" ? value[p] : value)]));
}
function exportSelection(sel) {
  const now = Number(sel && sel.now) || Date.now() / 1000;
  if (Array.isArray(sel)) {
    const picks = [];
    if (sel.includes("follow")) picks.push("group:follow");
    if (sel.includes("avoid")) picks.push("avoid");
    if (sel.includes("platform")) picks.push("plat:*");
    return { picks: new Set(picks), drops: new Set(EXPORT_DEFAULT_DROPS), platMin: exportPlatMin(0), platUnknown: false, since: 0, now };
  }
  const since = Number(sel && sel.since);
  return { picks: new Set((sel && sel.picks) || []), drops: new Set((sel && sel.drops) || []), platMin: exportPlatMin(sel && sel.platMin),
    platUnknown: sel && sel.platUnknown === "gmgn" ? "gmgn" : Boolean(sel && sel.platUnknown), since: EXPORT_SINCE_DAYS.includes(since) ? since : 0, now };
}

function exportDefaultSelection(groupOf = {}) {
  const follow = Object.keys(groupOf).filter((id) => groupOf[id] === "follow").map((id) => `label:${id}`);
  return { picks: [...follow, "avoid", "plat:FOMO", "plat:pump.fun"], drops: [...EXPORT_DEFAULT_DROPS], platMin: 0 };
}

const exportExpandDrops = (drops) => [...new Set([...(drops || [])].map((id) => (id === "dormant" ? "idle:7" : id)))];

function exportExpandPicks(picks, groupOf = {}) {
  const ids = (group) => Object.keys(groupOf).filter((id) => groupOf[id] === group && !EXPORT_SKIP.has(id)).map((id) => `label:${id}`);
  const out = new Set();
  for (const pick of picks || []) {
    const expanded = pick === "avoid" ? ids("avoid") : pick === "group:follow" ? ids("follow") : [];
    if (expanded.length) expanded.forEach((p) => out.add(p)); else out.add(pick);
  }
  return [...out];
}

function exportPickHit(w, pick, groupOf) {
  if (pick.startsWith("label:")) return (w.labels || []).includes(pick.slice(6));
  if (pick === "grade:none") return !(w.card && w.card.grade);
  if (pick.startsWith("grade:")) return Boolean(w.card && w.card.grade === pick.slice(6));
  const labels = (w.labels || []).filter((id) => !EXPORT_SKIP.has(id));
  if (pick === "group:follow") return labels.some((id) => groupOf[id] === "follow");
  if (pick === "avoid") return labels.some((id) => groupOf[id] === "avoid");
  return false;
}

function exportPnlTier(labels) {
  const have = new Set(labels || []);
  const hit = EXPORT_PNL_LABELS.find(([id]) => have.has(id));
  return hit ? hit[1] : 0;
}
function exportWinrate(card) {
  const r = card && card.winrate != null ? Number(card.winrate) : NaN;
  if (!Number.isFinite(r) || (r === 0 && Number(card.realized) > 0)) return null;
  return r <= 1 ? r * 100 : r;
}

function exportDropHit(w, drop, highFreq = EXPORT_HIGH_FREQ, now = Date.now() / 1000) {
  const labels = w.labels || [];
  const card = w.card || {};
  const [kind, raw] = String(drop).split(":");
  const v = Number(raw);
  switch (kind) {
    case "bot": return Boolean(w.bot);
    case "pending": return Boolean(w.botPending) && !w.bot;
    case "quiet": return Boolean(w.quiet);
    case "highfreq": return !w.bot && Number(card.trades) >= highFreq;
    case "bundle": return labels.includes("bundle_member");
    case "insider": return labels.includes("insider");
    case "sniper": return labels.includes("sniper");
    case "loss30": return card.realized != null && Number(card.realized) < 0;
    case "dormant": return (card.style || []).includes("休眠");
    case "pnl": return exportPnlTier(labels) < v;
    case "real": return card.realized != null && Number(card.realized) < v;
    case "win": { const r = exportWinrate(card); return r != null && r < v; }
    case "trades": return !w.bot && Number(card.trades) >= v;
    case "idle": return Boolean(card.lastTs) && (now - Number(card.lastTs)) / 86400 >= v;
    default: return false;
  }
}

function libraryExportPick(wallets, names, chain, sel, groupOf = {}, highFreq = EXPORT_HIGH_FREQ) {
  const { picks, drops, platMin, platUnknown, since, now } = exportSelection(sel);
  const platPicks = [...picks].filter((pick) => pick.startsWith("plat:")).map((pick) => pick.slice(5));
  const otherPicks = [...picks].filter((pick) => !pick.startsWith("plat:"));
  const dropList = [...drops];
  const plat = new Map();
  for (const p of names || []) {
    if (p.chain !== chain || !p.address || !p.handle) continue;
    if (!plat.has(p.address)) plat.set(p.address, []);
    plat.get(p.address).push(p);
  }
  const picked = (name) => platPicks.includes("*") || platPicks.includes(name);
  const profitOk = (w, name) => {
    const min = platMin[name] || 0;
    if (!min) return true;
    const profit = platformProfit(w, platUnknown === "gmgn" ? "gmgn" : "");
    return profit ? profit.value >= min : platUnknown === true;
  };
  const viaPlatform = (w, rows) => Boolean(rows) && rows.some((p) => picked(p.platform) && profitOk(w, p.platform));
  const fresh = (ts) => !since || (Number(ts) > 0 && now - Number(ts) <= since * 86400);
  const out = new Map();
  for (const w of wallets || []) {
    if (w.chain !== chain || !w.address || out.has(w.address) || !fresh(w.firstSeen)) continue;
    const rows = plat.get(w.address);
    if (!viaPlatform(w, rows)) {
      if (!otherPicks.some((pick) => exportPickHit(w, pick, groupOf))) continue;
      if (dropList.some((drop) => exportDropHit(w, drop, highFreq, now))) continue;
    }
    out.set(w.address, { w, rows });
  }
  const known = new Set((wallets || []).filter((w) => w.chain === chain).map((w) => w.address));
  for (const [address, rows] of plat) {
    if (out.has(address) || known.has(address) || !viaPlatform(null, rows)) continue;
    if (!fresh(Math.min(...rows.map((p) => Number(p.first_seen) || Infinity)))) continue;
    out.set(address, { w: null, rows });
  }
  return out;
}

function libraryExportItems(wallets, names, chain, sel, groupOf = {}, labelName = {}, highFreq = EXPORT_HIGH_FREQ) {
  return [...libraryExportPick(wallets, names, chain, sel, groupOf, highFreq)].map(([address, { w, rows }]) => ({ address,
    rename: w ? walletExportRemark(w.labels, w.manualLabels, rows, groupOf, labelName, w) : platformExportRemark(rows) }));
}

function botExportNote(wallets, chain) {
  const rows = (wallets || []).filter((w) => w.chain === chain && !(w.platforms || []).length);
  const bots = rows.filter((w) => w.bot).length, pending = rows.filter((w) => !w.bot && w.botPending).length;
  const parts = [];
  if (bots) parts.push(`${bots} 个机器人／高频交易（你标过所以还在库里）不导出`);
  if (pending) parts.push(`${pending} 个还在查交易频率，查完确定不是机器人才会导出（每 30 分钟查一批）`);
  return parts.length ? `${parts.join("；")}。` : "";
}

function libraryExportText(items, format) {
  const text = format === "gmgn" ? JSON.stringify(items, null, 2) : items.map((item) => `${item.address} ${item.rename}`).join("\n");
  return { count: items.length, text };
}

function libraryExportCounts(wallets, names, sel, groupOf = {}, highFreq = EXPORT_HIGH_FREQ) {
  const chains = new Set([...PLATFORM_EXPORT_CHAINS, ...(wallets || []).map((w) => w.chain), ...(names || []).map((p) => p.chain)].filter(Boolean));
  const counts = new Map();
  for (const chain of chains) {
    const count = libraryExportPick(wallets, names, chain, sel, groupOf, highFreq).size;
    if (count || PLATFORM_EXPORT_CHAINS.includes(chain)) counts.set(chain, count);
  }
  return counts;
}

const platformExportText = (names, chain, format) => libraryExportText(libraryExportItems([], names, chain, ["platform"]), format);
const platformExportCounts = (names) => libraryExportCounts([], names, ["platform"]);

function pumpSyncProgressText(r) {
  const total = Number(r && r.total) || 0, synced = Number(r && r.synced) || 0, failed = Number(r && r.failed) || 0;
  const due = Array.isArray(r && r.items) ? r.items.length : 0;
  if (!total) return "钱包库里还没有 pump.fun 用户。";
  const head = `钱包库里的 pump.fun 用户 ${total} 位，已算好 ${synced} 位${failed ? `、${failed} 位没算成功` : ""}`;
  if (!due) return `${head}，现在没有要算的（算过的 ${Number(r.staleHours) || 72} 小时后才会再算）。`;
  return `${head}，还有 ${due} 位要算。`;
}

function fomoBoardStoredText(s) {
  const total = Number(s && s.total) || 0, withPnl = Number(s && s.withPnl) || 0, withAll = Number(s && s.withAll) || 0;
  const handles = Number(s && s.handles) || 0, at = Number(s && s.lastAt) || 0;
  const head = total ? `钱包库里的 FOMO 用户 ${total} 位` : "钱包库里还没有 FOMO 用户";
  if (!at) return `${head}，还没读过 FOMO 排行榜。`;
  const d = new Date(at * 1000);
  const two = (n) => String(n).padStart(2, "0");
  const when = `${d.getMonth() + 1}/${d.getDate()} ${two(d.getHours())}:${two(d.getMinutes())}`;
  return `${head}，${withPnl} 位有 FOMO 排行榜盈利（${withAll} 位有「全部」榜）；排行榜上存了 ${handles} 人，上次读是 ${when}。`;
}


const BULK_SRC = { coin: "库内币加总", pnl30: "GMGN 30 天已实现", gm: "GMGN 历史总盈利", pf: "平台战绩", acct: "pump.fun 帐号" };
const BULK_CHAIN = { Solana: "SOL", BSC: "BSC", Robinhood: "RH" };
function bulkDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s < 60) return `${s} 秒`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}
function gmRefreshEstimate(n) {
  const batches = Math.ceil((Number(n) || 0) / 100);
  return { batches, text: batches ? `约 ${batches} 批、${bulkDuration(batches * 10)}左右（看聪明钱收集忙不忙）` : "" };
}
function gmRefreshText(job) {
  if (!job || !job.kind) return "";
  const n = (v) => Number(v) || 0;
  if (job.running) {
    if (job.phase === "check") return "算符合的钱包中…";
    if (job.phase === "compute") return "整理结果中…";
    if (job.phase !== "refresh") return "准备中…";
    const head = job.kind === "preview" ? "先更新这些钱包的 GMGN 历史总盈利" : "更新中";
    return `${head}：${n(job.done)}／${n(job.total)} 个（第 ${Math.min(n(job.batchDone) + 1, n(job.batches))}／${n(job.batches)} 批）`
      + `${job.eta ? `，约剩 ${bulkDuration(job.eta)}` : ""}${job.note ? `；${job.note}` : ""}`;
  }
  const parts = [];
  if (job.kind === "refresh") {
    parts.push(`${job.stopped ? "已停止" : "更新好了"}：查到 ${n(job.updated)} 个、GMGN 没有纪录 ${n(job.noData)} 个`
      + `${n(job.failed) ? `、${n(job.failed)} 个 GMGN 出错没更新到` : ""}`
      + `${job.stopped ? `、${Math.max(0, n(job.total) - n(job.done))} 个还没查` : ""}`);
    if (n(job.skipped)) parts.push(`${n(job.skipped)} 个 6 小时内更新过，跳过`);
    if (n(job.unsupported)) parts.push(`${n(job.unsupported)} 个在 GMGN 查不了的链`);
  }
  if (job.error) parts.push(`出错：${job.error}`);
  if (job.lastError && n(job.failed)) parts.push(`GMGN 最后一次错误：${job.lastError}`);
  return parts.length ? `${parts.join("；")}。` : "";
}
function cleanupSummary(r) {
  if (!r) return "";
  const n = (v) => Number(v) || 0;
  const by = Object.entries(r.byChain || {}).map(([k, v]) => `${k} ${v}`).join("、");
  const lines = [];
  lines.push(r.count ? `符合的有 ${r.count} 个钱包${by ? `（${by}）` : ""}${n(r.young) ? `，其中 ${n(r.young)} 个进库不到 ${n(r.days)} 天` : ""}${n(r.platformRows) ? `、${n(r.platformRows)} 个是平台用户` : ""}。`
    : "没有符合的钱包，不用删。");
  const names = r.keepNames || {};
  const kept = Object.entries(r.kept || {}).filter(([, v]) => n(v)).map(([k, v]) => `${names[k] || k} ${v}`);
  if (kept.length) lines.push(`不到门槛但照样留着：${kept.join("、")}。`);
  const other = [];
  if (n(r.noData)) other.push(`${n(r.noData)} 个没有任何盈利数据（追资金来源或手动加的），不删`);
  if (n(r.youngSkipped)) other.push(`${n(r.youngSkipped)} 个进库不到 ${n(r.days)} 天，这次不删`);
  if (n(r.notRefreshed)) other.push(`${n(r.notRefreshed)} 个 GMGN 出错没更新到，这次不删`);
  if (other.length) lines.push(`另外 ${other.join("；")}。`);
  return lines.join("");
}
function cleanupChains(chains) {
  return (chains || []).map((c) => BULK_CHAIN[c] || c).join("＋");
}
function cleanupDetail(row) {
  return ["coin", "pnl30", "gm", "pf", "acct"].filter((k) => row[k] != null && k !== row.src)
    .map((k) => `${BULK_SRC[k]} ${typeof formatUsd === "function" ? formatUsd(row[k]) : row[k]}`).join("、");
}
function cleanupAppliedText(res) {
  if (!res) return "";
  const n = (v) => Number(v) || 0;
  const head = n(res.deleted) ? `已删 ${n(res.deleted)} 个钱包（${n(res.wallets)} 笔，BSC／RH 同地址两边一起算），封存在 library-archive\\${res.archive}，可以还原。`
    : "没有删任何钱包。";
  return head + (n(res.changed) ? `${n(res.changed)} 个预览后有变（你标了、或盈利更新后过了门槛），没删。` : "");
}

if (typeof module === "object" && module.exports) {
  module.exports = { EXPORT_LABEL_SHORT, EXPORT_SKIP, EXPORT_DROPS, EXPORT_DEFAULT_DROPS, exportMoney, platformExportRemark, strengthExportRemark,
    walletExportRemark, libraryExportItems, libraryExportText, libraryExportCounts, platformExportText, platformExportCounts, botExportNote,
    exportSelection, exportDefaultSelection, exportPickHit, exportDropHit, EXPORT_PLAT_TIERS, platformProfit, platformProfitStats, acctTotal,
    fomoBoardPnl, FOMO_PERIOD_NAME, fomoBoardStoredText,
    EXPORT_PLATFORMS, EXPORT_SINCE_DAYS, exportPlatMin, exportExpandPicks, exportExpandDrops, exportDropRows, exportPnlTier, exportWinrate, exportUsd, exportTierText, libraryExportPick,
    pumpSyncProgressText, bulkDuration, gmRefreshEstimate, gmRefreshText, cleanupSummary, cleanupChains, cleanupDetail, cleanupAppliedText, BULK_SRC };
}

if (typeof document !== "undefined") {
  (() => {
    const out = document.getElementById("lib-bm-pump");
    if (!out) return;
    const marks = [["lib-bm-pnl", "pnl", "到任何 pump.fun 页再按"], ["lib-bm-hold", "hold", "到 FOMO 或 pump.fun 的币页再按"], ["lib-bm-hot", "hot", "到 FOMO 页再按"]];
    for (const [id, kind, where] of marks) {
      const link = document.getElementById(id);
      if (!link || typeof wiBookmarklet !== "function") continue;
      link.href = wiBookmarklet(location.origin, kind);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        if (typeof showToast === "function") showToast(`这颗要按住拖到书签列，${where}`);
      });
    }
    let busy = false;
    async function refresh() {
      if (busy) return;
      busy = true;
      try {
        const r = await fetch("/api/pump/sync-list", { headers: { Accept: "application/json" }, cache: "no-store" }).then((res) => res.json());
        if (!r || !r.ok) throw new Error((r && r.error) || "读不到");
        out.textContent = pumpSyncProgressText(r);
      } catch (err) {
        out.textContent = `读不到同步进度（${err && err.message ? err.message : err}），刷新这页再试。`;
      } finally {
        busy = false;
      }
    }
    refresh();
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
    setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 60000);
  })();
  (() => {
    const dialog = document.getElementById("labels-dialog");
    document.getElementById("open-labels")?.addEventListener("click", () => { if (!dialog.open) dialog.showModal(); });
    document.getElementById("labels-close")?.addEventListener("click", () => dialog.close());
    dialog?.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  })();

  const libFomo = (() => {
    const waiting = new Map();
    let info = null;
    window.addEventListener("message", (e) => {
      if (e.source !== window || e.origin !== location.origin) return;
      const m = e.data;
      if (!m || m.from !== "wl-ext") return;
      if (m.type === "wi-ext-ready") { info = m; return; }
      if (m.type === "wi-ext-fomo-board-result" && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    });
    window.postMessage({ type: "wi-ext-hello" }, location.origin);
    const has = (feature) => Boolean(info && (info.features || []).includes(feature));
    function ask() {
      const id = `fb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return new Promise((resolve) => {
        const late = setTimeout(() => { waiting.delete(id); resolve({ ok: false, error: "插件 2 分钟没回应" }); }, 120000);
        waiting.set(id, (m) => { clearTimeout(late); resolve(m); });
        window.postMessage({ type: "wi-ext-fomo-board", id }, location.origin);
      });
    }
    const st = { busy: false, msg: "" };
    const subs = new Set();
    const emit = (phase) => subs.forEach((fn) => { try { fn(phase); } catch (err) { console.error(err); } });
    const say = (msg, phase = "msg") => { st.msg = msg; emit(phase); };
    async function run() {
      if (st.busy) return;
      if (!has("fomo-board")) {
        say(info ? `插件（${info.version || "旧版"}）太旧、没有这个功能：更新插件后刷新这页再按。`
          : "要先装好钱包库插件（Chrome 扩充功能），装好刷新这页再按。");
        return;
      }
      st.busy = true;
      say("插件正在读 FOMO 排行榜（四个榜，约 10 秒）…");
      try {
        const r = await ask();
        if (!r || !r.ok || !r.board) throw new Error((r && r.error) || "读 FOMO 排行榜失败");
        const periods = Object.entries(r.board.periods || {}).map(([p, n]) => `${FOMO_PERIOD_NAME[p] || p} ${n} 位`).join("、");
        const head = `读到 FOMO 排行榜 ${periods}，共 ${r.board.users.length} 人${r.why ? `（${r.why}，后面的榜没读）` : ""}`;
        say(`${head}，存进钱包库中…`);
        const res = await libraryPost("/api/fomo/board-import", { board: r.board });
        let job = res.job || {};
        const saved = job.pnlSaved || 0;
        say(`${head}；存了 ${saved} 笔 FOMO 盈利，正在绑新名字（Solana 链上反查、BSC／Robinhood 问 GMGN，会跑几分钟）…`, "saved");
        for (let i = 0; i < 400 && job.running; i += 1) {
          await new Promise((ok) => setTimeout(ok, 3000));
          job = (await libraryPost("/api/fomo/board-status", {})).job || {};
        }
        st.msg = `${head}；存了 ${saved} 笔 FOMO 盈利，绑到 ${job.bound || 0} 个地址（新绑 ${job.added || 0}、新加进钱包库 ${job.libAdded || 0}）`
          + `${job.error ? `；绑定出错：${job.error}` : ""}。`;
      } catch (error) {
        st.msg = `没补到：${error.message || error}`;
      } finally {
        st.busy = false;
        emit("done");
      }
    }
    return { st, run, on: (fn) => subs.add(fn) };
  })();

  (() => {
    const btn = document.getElementById("lib-fomo-board"), out = document.getElementById("lib-fomo-stored"), msg = document.getElementById("lib-fomo-msg");
    if (!btn || !out || !msg) return;
    let busy = false;
    async function refresh() {
      if (busy) return;
      busy = true;
      try {
        const r = await libraryPost("/api/fomo/board-status", {});
        out.textContent = r.stored ? fomoBoardStoredText(r.stored) : "读不到 FOMO 排行榜盈利的数字（服务器是旧版，重新启动就有）。";
      } catch (err) {
        out.textContent = `读不到 FOMO 排行榜盈利（${err && err.message ? err.message : err}），刷新这页再试。`;
      } finally {
        busy = false;
      }
    }
    function show() {
      btn.disabled = libFomo.st.busy;
      btn.textContent = libFomo.st.busy ? "读取中…" : "补盈利";
      msg.textContent = libFomo.st.msg;
      msg.hidden = !libFomo.st.msg;
    }
    btn.addEventListener("click", () => libFomo.run());
    libFomo.on((phase) => { show(); if (phase !== "msg") refresh(); });
    show();
    refresh();
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
    setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 60000);
  })();

  (() => {
    const dialog = document.getElementById("platform-export-dialog");
    if (!dialog || !document.getElementById("export-picks")) return;
    const byId = (id) => document.getElementById(id);
    const pickBox = byId("export-picks"), dropSeg = byId("export-drops"), chainSeg = byId("platform-export-chain"), formatSeg = byId("platform-export-format");
    const sinceSeg = byId("export-since");
    const preview = byId("platform-export-preview"), copyButton = byId("platform-export-copy");
    const status = byId("platform-export-status"), formatNote = byId("platform-export-format-note");
    const FORMAT_NAME = { debot: "DeBot", gmgn: "GMGN" };
    const FORMAT_NOTE = {
      debot: "一行一个：完整地址、空格、备注。DeBot 只会写入备注，不会分组或追踪钱包。",
      gmgn: "JSON 数组（address、rename），贴到 GMGN 的「批量导入」。",
    };
    const SEL_KEY = "wi-export-sel-v2";
    const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
    const write = (key, value) => { try { localStorage.setItem(key, value); } catch {  } };
    const zeroMin = () => exportPlatMin(0);
    const board = libFomo.st;
    const profitMode = () => (state.platUnknown === "gmgn" ? "gmgn" : "");
    const state = { wallets: [], names: [], groupOf: {}, labelName: {}, highFreq: EXPORT_HIGH_FREQ, output: { count: 0, text: "" }, now: Date.now() / 1000,
      picks: null, drops: null, platMin: zeroMin(), platUnknown: false, since: 0, seen: new Set(),
      chain: read("wi-platform-export-chain") || "", format: read("wi-platform-export-format") === "gmgn" ? "gmgn" : "debot" };

    function loadSelection() {
      let saved = null;
      try { saved = JSON.parse(read(SEL_KEY) || "null"); } catch { saved = null; }
      if (saved && Array.isArray(saved.picks) && Array.isArray(saved.drops)) return saved;
      const base = exportDefaultSelection(state.groupOf);
      const old = read("wi-platform-export-kinds");
      if (old === null) return base;
      const kinds = old.split(",");
      return { picks: base.picks.filter((pick) => (pick.startsWith("label:") ? kinds.includes("follow") : pick === "avoid" ? kinds.includes("avoid") : kinds.includes("platform"))),
        drops: base.drops };
    }
    const saveSelection = () => write(SEL_KEY, JSON.stringify({ picks: [...state.picks], drops: [...state.drops], platMin: state.platMin,
      platUnknown: state.platUnknown, since: state.since }));
    const sel = (over = {}) => ({ picks: [...(over.picks || state.picks)], drops: [...(over.drops || state.drops)], platMin: over.platMin || state.platMin,
      platUnknown: over.platUnknown ?? state.platUnknown, since: over.since ?? state.since, now: state.now });
    const count = (over = {}) => libraryExportPick(state.wallets, state.names, state.chain, sel(over), state.groupOf, state.highFreq).size;
    const items = () => libraryExportItems(state.wallets, state.names, state.chain, sel(), state.groupOf, state.labelName, state.highFreq);
    const labelIds = (group) => Object.keys(state.groupOf).filter((id) => state.groupOf[id] === group && !EXPORT_SKIP.has(id) && state.seen.has(id));
    const labelText = (id) => EXPORT_CHIP_NAME[id] || state.labelName[id] || id;

    function pickGroups() {
      return [
        { title: "实力等级", note: "他自己 30 天赚不赚（不代表跟了会赚）",
          picks: [...EXPORT_GRADES.map((g) => [`grade:${g}`, `${g} 级`]), ["grade:none", "还没评"]] },
        { title: "高手标签", picks: labelIds("follow").map((id) => [`label:${id}`, labelText(id)]) },
        { title: "要避开（⚠ 警示用）", note: "汇进去当警示，看到他们买就小心", picks: labelIds("avoid").map((id) => [`label:${id}`, `⚠ ${labelText(id)}`]) },
        { title: "参考标签", picks: labelIds("ref").filter((id) => !["fomo_user", "pump_user"].includes(id)).map((id) => [`label:${id}`, labelText(id)]) },
        { title: "平台用户", note: "有设总盈利门槛时，数字是「达到门槛的／全部」", picks: EXPORT_PLATFORMS.map((name) => [`plat:${name}`, `${name} 用户`]) },
      ];
    }

    function chip(key, attr, text, on, count) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset[attr] = key;
      button.setAttribute("aria-pressed", String(on));
      button.textContent = count === undefined || count === "" ? text : `${text} ${count}`;
      return button;
    }

    function groupBox({ title, note = "", chips, allKeys = null, label = title }) {
      const wrap = document.createElement("div");
      wrap.className = "export-pick-group";
      const head = document.createElement("div");
      head.className = "export-pick-head";
      head.append(Object.assign(document.createElement("span"), { textContent: title }));
      if (allKeys && allKeys.length) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "btn btn-sm btn-ghost";
        toggle.dataset.pickAll = allKeys.join(",");
        toggle.textContent = allKeys.every((key) => state.picks.has(key)) ? "全不选" : "全选";
        head.append(toggle);
      }
      if (note) head.append(Object.assign(document.createElement("small"), { className: "muted", textContent: note }));
      const seg = document.createElement("div");
      seg.className = "seg seg-wrap";
      seg.setAttribute("role", "group");
      seg.setAttribute("aria-label", label);
      seg.append(...chips);
      wrap.append(head, seg);
      return wrap;
    }

    function platCount(key) {
      const name = key.slice(5);
      const reached = count({ picks: [key] });
      if (!(state.platMin[name] > 0)) return reached;
      return `${reached}／${count({ picks: [key], platMin: { ...state.platMin, [name]: 0 } })}`;
    }

    function renderPicks() {
      pickBox.replaceChildren(...pickGroups().filter((group) => group.picks.length).map((group) => groupBox({ title: group.title, note: group.note,
        allKeys: group.picks.map(([key]) => key),
        chips: group.picks.map(([key, text]) => chip(key, "pick", text, state.picks.has(key), key.startsWith("plat:") ? platCount(key) : count({ picks: [key] }))) })),
      ...platformTierGroups());
    }

    function platformTierGroups() {
      const picked = [...state.picks].filter((key) => key.startsWith("plat:")).map((key) => key.slice(5));
      const boxes = EXPORT_PLATFORMS.map((name) => {
        const stats = platformProfitStats(state.wallets, state.names, state.chain, [name], profitMode());
        const box = groupBox({ title: `${name} 用户总盈利`, note: "只把赚到这么多的当平台用户导出", label: `${name} 用户总盈利门槛`,
          chips: EXPORT_PLAT_TIERS.map((t) => chip(`${name}|${t}`, "platMin", exportTierText(t), state.platMin[name] === t, stats.tiers[t])) });
        const note = document.createElement("p");
        note.className = "sheet-note";
        const filled = [stats.fomoAll && `FOMO 全部榜 ${stats.fomoAll} 个`, stats.fomoPeriod && `FOMO 30 天／7 天／24 小时榜 ${stats.fomoPeriod} 个`,
          stats.gmgn && `GMGN ${stats.gmgn} 个`].filter(Boolean);
        note.textContent = `${state.chain} 的 ${name} 用户 ${stats.total} 个：亏损 ${stats.loss}、赚 $0～$1K ${stats.small}、赚 $1K 以上 ${stats.tiers[1000]}、盈利不明 ${stats.unknown}。`
          + (filled.length ? `盈利是补上的：${filled.join("、")}。` : "")
          + (picked.includes(name) || picked.includes("*") ? "" : `现在没勾「${name} 用户」，这排不影响导出。`);
        box.append(note);
        if (name === "FOMO") {
          const line = document.createElement("p");
          line.className = "sheet-note";
          const btn = Object.assign(document.createElement("button"), { type: "button", className: "btn btn-sm", textContent: board.busy ? "读取中…" : "从 FOMO 排行榜补盈利" });
          btn.dataset.fomoBoard = "1";
          btn.disabled = board.busy;
          line.append(btn, " ", board.msg || "用插件读 FOMO 排行榜（24 小时／7 天／30 天／全部）上每个人 FOMO 自己算的盈利，顺便绑新名字；Chrome 要登录 FOMO。");
          box.append(line);
        }
        if (name === "pump.fun" && stats.pump.total) {
          const sync = document.createElement("p");
          sync.className = "sheet-note";
          sync.append(`${state.chain} 的 pump.fun 用户 ${stats.pump.total} 个，帐号总盈亏已算 ${stats.pump.synced} 个。`,
            Object.assign(document.createElement("a"), { href: "./pump-sync.html", target: "_blank", rel: "noopener", textContent: "更新 pump.fun 战绩" }));
          box.append(sync);
        }
        return box;
      });
      const all = platformProfitStats(state.wallets, state.names, state.chain, picked);
      const unknown = groupBox({ title: "盈利不明的平台用户", note: "有设门槛才有差", label: "盈利不明的平台用户",
        chips: [chip("0", "platUnknown", "当没达到", state.platUnknown === false), chip("gmgn", "platUnknown", "Solana 用 GMGN 补", state.platUnknown === "gmgn", all.gmgnCan),
          chip("1", "platUnknown", "当达到", state.platUnknown === true, all.unknown)] });
      const note = document.createElement("p");
      note.className = "sheet-note";
      note.textContent = "总盈利照这个顺序拿平台自己算的：pump.fun 帐号总盈亏（每颗交易过的币加总）→ FOMO 排行榜「全部」榜的盈利（FOMO 算的总盈利）→ 钱包库里有平台数字的几颗币加总"
        + " → FOMO 30 天／7 天／24 小时榜的盈利（只是那段时间的）；都没有的算盈利不明。「Solana 用 GMGN 补」只补 Solana、GMGN 看得到他买卖的"
        + "（BSC／Robinhood 的 GMGN 数字常常不准，不补），备注照样只写平台自己算的。没达到门槛的平台用户不会因为是平台用户就导出，符合其他勾选的照常导出。";
      unknown.append(note);
      return [...boxes, unknown];
    }

    function renderDrops() {
      const now = count();
      const single = EXPORT_DROPS.map(([key, text]) => {
        const on = state.drops.has(key);
        const other = new Set(state.drops);
        if (on) other.delete(key); else other.add(key);
        const n = count({ drops: [...other] });
        return chip(key, "drop", text, on, on ? n - now : now - n);
      });
      const boxes = [groupBox({ title: "这几种", chips: single, label: "不要导出哪些钱包" })];
      for (const row of exportDropRows(state.highFreq)) {
        const ids = row.opts.map(([id]) => id);
        const base = [...state.drops].filter((id) => !ids.includes(id));
        const free = count({ drops: base });
        const current = ids.find((id) => state.drops.has(id)) || "";
        const box = groupBox({ title: row.title, note: row.note, label: row.title,
          chips: [["", "不挡"], ...row.opts].map(([id, text]) => chip(id || "-", "dropOpt", text, current === id, id ? free - count({ drops: [...base, id] }) : undefined)) });
        box.querySelector(".seg").dataset.dropRow = row.id;
        boxes.push(box);
      }
      dropSeg.replaceChildren(...boxes);
    }

    function renderSince() {
      if (!sinceSeg) return;
      sinceSeg.replaceChildren(...EXPORT_SINCE_DAYS.map((d) => chip(String(d), "since", d ? `${d} 天内` : "不限", state.since === d, count({ since: d }))));
    }

    function renderChains() {
      const counts = libraryExportCounts(state.wallets, state.names, sel(), state.groupOf, state.highFreq);
      if (!counts.get(state.chain)) state.chain = [...counts].find(([, count]) => count)?.[0] || state.chain || PLATFORM_EXPORT_CHAINS[0];
      chainSeg.replaceChildren(...[...counts].map(([chain, count]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.chain = chain;
        button.textContent = `${chain} ${count}`;
        button.disabled = !count;
        return button;
      }));
    }

    const press = (seg, key, isOn) => seg.querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(isOn(button.dataset[key]))));

    function render() {
      renderChains();
      renderPicks();
      renderDrops();
      renderSince();
      press(chainSeg, "chain", (chain) => chain === state.chain);
      press(formatSeg, "format", (format) => format === state.format);
      formatNote.textContent = FORMAT_NOTE[state.format];
      state.output = libraryExportText(items(), state.format);
      preview.value = state.output.text;
      copyButton.disabled = !state.output.count;
      copyButton.textContent = state.output.count ? `拷贝 ${state.output.count} 个` : "拷贝";
      const base = !state.picks.size ? "至少选一种要导出的钱包。" : state.output.count ? "" : `${state.chain} 没有符合的钱包。`;
      const botNote = state.drops.has("bot") || state.drops.has("pending") ? botExportNote(state.wallets, state.chain) : "";
      status.textContent = [base, botNote].filter(Boolean).join(" ");
    }

    async function load() {
      chainSeg.replaceChildren();
      pickBox.replaceChildren();
      dropSeg.replaceChildren();
      preview.value = "";
      copyButton.disabled = true;
      status.textContent = "读取钱包库中…";
      let data;
      try {
        data = await libraryPost("/api/library/export", {});
      } catch (error) {
        status.textContent = `读取失败：${error.message}`;
        return;
      }
      libraryUseRules(data.rules);
      state.groupOf = { ...LIBRARY_LABEL_GROUP };
      state.labelName = Object.fromEntries((data.rules || []).map((rule) => [rule.id, rule.label]));
      state.wallets = data.wallets || [];
      state.names = data.platformNames || [];
      state.highFreq = Number(data.highFreq) || EXPORT_HIGH_FREQ;
      state.now = Date.now() / 1000;
      state.seen = new Set(state.wallets.flatMap((w) => w.labels || []));
      if (!state.picks) {
        const saved = loadSelection();
        const norm = exportSelection(saved);
        state.picks = new Set(exportExpandPicks(saved.picks, state.groupOf));
        state.drops = new Set(exportExpandDrops(saved.drops));
        state.platMin = norm.platMin;
        state.platUnknown = norm.platUnknown;
        state.since = norm.since;
      }
      render();
    }

    libFomo.on((phase) => {
      if (!dialog.open || !state.picks) return;
      if (phase === "saved" || phase === "done") load(); else render();
    });

    byId("open-platform-export")?.addEventListener("click", () => { if (!dialog.open) dialog.showModal(); load(); });
    byId("platform-export-close")?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    pickBox.addEventListener("click", (event) => {
      const all = event.target.closest("button[data-pick-all]");
      const button = event.target.closest("button[data-pick]");
      const tier = event.target.closest("button[data-plat-min]");
      const unknown = event.target.closest("button[data-plat-unknown]");
      if (event.target.closest("button[data-fomo-board]")) { libFomo.run(); return; }
      if (all) {
        const keys = all.dataset.pickAll.split(",");
        const on = !keys.every((key) => state.picks.has(key));
        keys.forEach((key) => (on ? state.picks.add(key) : state.picks.delete(key)));
      } else if (button) {
        const key = button.dataset.pick;
        if (state.picks.has(key)) state.picks.delete(key); else state.picks.add(key);
      } else if (tier) {
        const [name, t] = tier.dataset.platMin.split("|");
        state.platMin = { ...state.platMin, [name]: Number(t) || 0 };
      } else if (unknown) {
        const v = unknown.dataset.platUnknown;
        state.platUnknown = v === "1" ? true : v === "gmgn" ? "gmgn" : false;
      } else return;
      saveSelection();
      render();
    });
    dropSeg.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-drop]");
      const opt = event.target.closest("button[data-drop-opt]");
      if (button) {
        const key = button.dataset.drop;
        if (state.drops.has(key)) state.drops.delete(key); else state.drops.add(key);
      } else if (opt) {
        const rowId = opt.closest("[data-drop-row]")?.dataset.dropRow;
        const row = exportDropRows(state.highFreq).find((r) => r.id === rowId);
        if (!row) return;
        const id = opt.dataset.dropOpt;
        const wasOn = state.drops.has(id);
        row.opts.forEach(([key]) => state.drops.delete(key));
        if (id !== "-" && !wasOn) state.drops.add(id);
      } else return;
      saveSelection();
      render();
    });
    sinceSeg?.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-since]");
      if (!button) return;
      state.since = Number(button.dataset.since) || 0;
      saveSelection();
      render();
    });
    byId("export-reset")?.addEventListener("click", () => {
      const base = exportDefaultSelection(state.groupOf);
      state.picks = new Set(exportExpandPicks(base.picks, state.groupOf));
      state.drops = new Set(base.drops);
      state.platMin = zeroMin();
      state.platUnknown = false;
      state.since = 0;
      saveSelection();
      render();
    });
    chainSeg.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-chain]");
      if (!button || button.disabled) return;
      state.chain = button.dataset.chain;
      write("wi-platform-export-chain", state.chain);
      render();
    });
    formatSeg.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-format]");
      if (!button) return;
      state.format = button.dataset.format;
      write("wi-platform-export-format", state.format);
      render();
    });
    copyButton.addEventListener("click", async () => {
      const { count, text } = state.output;
      if (!count) return;
      const ok = await window.Shell.copyText(text);
      const name = FORMAT_NAME[state.format];
      status.textContent = ok ? `已拷贝 ${state.chain} ${count} 个（${name} 格式），到 ${name} 的导入框粘贴。` : "浏览器拒绝拷贝，请在上面的框里全选后手动拷贝。";
      if (ok) showToast(`已拷贝 ${count} 个钱包备注（${name}）`);
    });
  })();
  (() => {
    const byId = (id) => document.getElementById(id);
    const R = { dlg: byId("gm-refresh-dialog"), scope: byId("gm-refresh-scope"), scopeNote: byId("gm-refresh-scope-note"), skip: byId("gm-refresh-skip"),
      bar: byId("gm-refresh-bar"), start: byId("gm-refresh-start"), stop: byId("gm-refresh-stop"), status: byId("gm-refresh-status") };
    const C = { dlg: byId("cleanup-dialog"), threshold: byId("cleanup-threshold"), customWrap: byId("cleanup-custom-wrap"), custom: byId("cleanup-custom"),
      scope: byId("cleanup-scope"), young: byId("cleanup-young"), platform: byId("cleanup-platform"), bar: byId("cleanup-bar"),
      preview: byId("cleanup-preview"), stop: byId("cleanup-stop"), apply: byId("cleanup-apply"), status: byId("cleanup-status"), result: byId("cleanup-result") };
    if (!R.dlg || !C.dlg) return;
    const st = { job: null, library: null, last: null, timer: 0, wasRunning: false, refreshScope: "all", threshold: "2000", cleanupScope: "", armed: 0, shownId: "" };
    const press = (seg, attr, value) => seg.querySelectorAll(`button[${attr}]`).forEach((b) => b.setAttribute("aria-pressed", String(b.getAttribute(attr) === value)));
    const setBar = (bar, job) => {
      const on = Boolean(job && job.running && job.phase === "refresh" && job.total);
      bar.hidden = !on;
      if (on) bar.firstElementChild.style.width = `${Math.round((Number(job.done) || 0) / job.total * 100)}%`;
    };
    const filters = () => ({ q: byId("library-q")?.value.trim() || "", chain: byId("library-chain")?.value || "", label: byId("library-label")?.value || "",
      showQuiet: Boolean(byId("library-show-quiet")?.checked) });

    function renderRefresh() {
      const job = st.job || {};
      const mine = job.kind === "refresh";
      const busy = Boolean(job.running);
      const lib = st.library || {};
      const total = st.refreshScope === "all" ? Number(lib.wallets) || 0 : Number(libraryState.total) || 0;
      const est = gmRefreshEstimate(total);
      R.scopeNote.textContent = st.refreshScope === "all"
        ? `全部 ${total.toLocaleString()} 个钱包（含隐藏的），已查过 ${Number(lib.gmDone || 0).toLocaleString()} 个；${est.text}。`
        : `照你现在的搜索、链、标签，${total.toLocaleString()} 个钱包${byId("library-show-quiet")?.checked ? "" : "（没勾「显示低盈利」，不含隐藏的）"}；${est.text}。`;
      R.start.disabled = busy || !total;
      R.stop.hidden = !(busy && mine);
      setBar(R.bar, mine ? job : null);
      R.status.textContent = busy && !mine ? "清理预览正在跑，等它跑完再更新。" : mine ? gmRefreshText(job) : "";
    }

    function cleanupParams() {
      const t = st.threshold === "custom" ? C.custom.value.trim() : st.threshold;
      return { threshold: t === "" ? NaN : Number(t), scope: st.cleanupScope, young: C.young.checked, platform: C.platform.checked };
    }

    function renderCleanupRows(r) {
      if (!r || !r.rows || !r.rows.length) { C.result.replaceChildren(); return; }
      const more = r.count > r.rows.length ? `<p class="sheet-note">照总体盈利由低到高列前 ${r.rows.length} 个，还有 ${r.count - r.rows.length} 个没列出；按删除会删全部 ${r.count} 个。</p>` : "";
      C.result.innerHTML = `<div class="compact-table cleanup-table"><table><thead><tr><th>链</th><th>钱包</th><th>总体盈利</th><th>其他数字</th><th>进库</th></tr></thead><tbody>${
        r.rows.map((row) => `<tr><td data-label="链">${escapeHtml(cleanupChains(row.chains))}</td>
          <td data-label="钱包">${plainAddressCell(row.address)}${row.names.length ? `<small>${escapeHtml(row.names.join("、"))}</small>` : ""}</td>
          <td data-label="总体盈利"><strong class="${pnlClass(row.best)}">${formatUsd(row.best)}</strong><small>${escapeHtml(BULK_SRC[row.src] || row.src)}</small></td>
          <td data-label="其他数字">${escapeHtml(cleanupDetail(row)) || "--"}</td>
          <td data-label="进库">${row.firstSeen ? libraryDay(row.firstSeen) : "--"}</td></tr>`).join("")}</tbody></table></div>${more}`;
    }

    function renderCleanup() {
      const job = st.job || {};
      const mine = job.kind === "preview";
      const busy = Boolean(job.running);
      const p = cleanupParams();
      C.customWrap.hidden = st.threshold !== "custom";
      C.preview.disabled = busy || !Number.isFinite(p.threshold);
      C.stop.hidden = !(busy && mine);
      setBar(C.bar, mine ? job : null);
      const r = mine && !busy ? job.result : null;
      const applied = mine && job.applied;
      if (busy && !mine) C.status.textContent = "更新盈亏正在跑，等它跑完再预览。";
      else if (busy) C.status.textContent = gmRefreshText(job);
      else if (applied) C.status.textContent = cleanupAppliedText(job.applied);
      else if (r) C.status.textContent = cleanupSummary(r) + (r.count ? `门槛：总体盈利不到 ${formatUsd(r.params.threshold)}。` : "");
      else if (mine) C.status.textContent = gmRefreshText(job);
      else C.status.textContent = st.last && st.last.at ? `上次手动清理 ${formatLocalTime(st.last.at * 1000)}：${cleanupAppliedText(st.last)}` : "";
      const canApply = Boolean(r && r.count && !applied);
      C.apply.hidden = !canApply;
      if (canApply && !st.armed) C.apply.textContent = `删除这 ${r.count} 个钱包`;
      const id = r && !applied ? r.id : "";
      if (id !== st.shownId) { st.shownId = id; renderCleanupRows(r); }
      if (applied) C.result.replaceChildren();
    }

    function render() { renderRefresh(); renderCleanup(); }

    async function poll() {
      clearTimeout(st.timer);
      try {
        const data = await libraryPost("/api/library-bulk/status", {});
        st.job = data.job; st.library = data.library; st.last = data.lastCleanup;
      } catch (error) {
        R.status.textContent = C.status.textContent = `读不到进度：${error.message}`;
      }
      const running = Boolean(st.job && st.job.running);
      if (st.wasRunning && !running && typeof loadLibrary === "function") loadLibrary();
      st.wasRunning = running;
      render();
      if (running || R.dlg.open || C.dlg.open) st.timer = setTimeout(poll, 1500);
    }

    async function post(path, body, out) {
      try {
        const data = await libraryPost(path, body);
        if (data.job) st.job = data.job;
        return data;
      } catch (error) {
        out.textContent = error.message;
        return null;
      } finally {
        poll();
      }
    }

    byId("open-gm-refresh")?.addEventListener("click", () => { if (!R.dlg.open) R.dlg.showModal(); poll(); });
    byId("open-cleanup")?.addEventListener("click", () => { if (!C.dlg.open) C.dlg.showModal(); poll(); });
    byId("gm-refresh-close")?.addEventListener("click", () => R.dlg.close());
    byId("cleanup-close")?.addEventListener("click", () => C.dlg.close());
    for (const d of [R.dlg, C.dlg]) d.addEventListener("click", (event) => { if (event.target === d) d.close(); });
    R.scope.addEventListener("click", (event) => {
      const b = event.target.closest("button[data-scope]");
      if (!b) return;
      st.refreshScope = b.dataset.scope;
      press(R.scope, "data-scope", st.refreshScope);
      render();
    });
    R.start.addEventListener("click", async () => {
      R.start.disabled = true;
      await post("/api/library-bulk/refresh", { scope: st.refreshScope, skipHours: R.skip.checked ? 6 : 0, filters: filters() }, R.status);
    });
    R.stop.addEventListener("click", () => post("/api/library-bulk/stop", {}, R.status));
    C.threshold.addEventListener("click", (event) => {
      const b = event.target.closest("button[data-threshold]");
      if (!b) return;
      st.threshold = b.dataset.threshold;
      press(C.threshold, "data-threshold", st.threshold);
      if (st.threshold === "custom") C.custom.focus();
      render();
    });
    C.scope.addEventListener("click", (event) => {
      const b = event.target.closest("button[data-scope]");
      if (!b) return;
      st.cleanupScope = b.dataset.scope;
      press(C.scope, "data-scope", st.cleanupScope);
      render();
    });
    C.custom.addEventListener("input", render);
    C.preview.addEventListener("click", async () => {
      const p = cleanupParams();
      if (!Number.isFinite(p.threshold)) { C.status.textContent = "门槛要填数字（美元）。"; return; }
      C.preview.disabled = true;
      st.armed = 0;
      await post("/api/library-bulk/preview", p, C.status);
    });
    C.stop.addEventListener("click", () => post("/api/library-bulk/stop", {}, C.status));
    C.apply.addEventListener("click", async () => {
      const r = st.job && st.job.result;
      if (!r || !r.id) return;
      if (!st.armed || Date.now() - st.armed > 6000) {
        st.armed = Date.now();
        C.apply.textContent = `再按一次确认删除 ${r.count} 个`;
        setTimeout(() => { if (st.armed && Date.now() - st.armed >= 6000) { st.armed = 0; render(); } }, 6100);
        return;
      }
      st.armed = 0;
      C.apply.disabled = true;
      const res = await post("/api/library-bulk/apply", { id: r.id }, C.status);
      C.apply.disabled = false;
      if (res && typeof showToast === "function") showToast(res.deleted ? `已删 ${res.deleted} 个钱包（已封存，可以还原）` : "没有删任何钱包");
      if (res && typeof loadLibrary === "function") loadLibrary();
    });
  })();
}
