"use strict";

const PLATFORM_EXPORT_TAG = { FOMO: "FOMO", "pump.fun": "pump" };
const PLATFORM_EXPORT_CHAINS = ["BSC", "Solana", "Robinhood"];
const EXPORT_KINDS = ["follow", "avoid", "platform"];
const EXPORT_LABEL_SHORT = [
  ["insider", "⚠内部"], ["bundle_member", "⚠同源"], ["gmgn_bundler", "⚠捆绑"], ["sniper", "⚠狙击"], ["bot", "⚠机器人"],
  ["gold_regular", "金狗常客"], ["fresh_gold", "新钱包金狗"], ["top_seller", "卖在高点"], ["diamond", "钻石手"], ["paper_gold", "金狗卖飞"],
  ["smart_money", "聪明钱"], ["gmgn_smart", "GMGN聪明钱"], ["long_pnl", "30天赚"], ["early_profit", "早期高盈利"],
  ["long_hold_big", "长抱大赚"], ["profit_1k", "赚1K+"],
];
const EXPORT_MAX_LABELS = 4;
const EXPORT_DROPS = [
  ["bot", "机器人"], ["pending", "还没查交易频率"], ["quiet", "低盈利"], ["highfreq", "高频（30 天买卖次数多）"],
  ["bundle", "捆绑（同源资金）"], ["insider", "疑似庄家／内部"], ["sniper", "狙击手"], ["loss30", "30 天亏损"], ["dormant", "休眠（7 天没交易）"],
];
const EXPORT_DEFAULT_DROPS = ["bot", "pending", "quiet"];
const EXPORT_GRADES = ["S", "A", "B", "C", "D"];
const EXPORT_HIGH_FREQ = 1000;
const EXPORT_CHIP_NAME = { long_pnl: "30天赚", profit_1k: "赚1K+" };
const EXPORT_PLAT_TIERS = [0, 1000, 10000, 30000, 50000, 100000];
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

function strengthExportRemark(pf, pnl30, plat = null, gmgnOk = true, acct = null) {
  const parts = [];
  const platBest = plat && plat.n > 0 ? plat.best : null;
  if (acctTotal(acct) != null) {
    parts.push(`pump总${exportMoney(acctTotal(acct))}`);
    if (platBest && Number(platBest.pnl) > 0) parts.push(`最赚${platBest.symbol}${exportMoney(platBest.pnl)}`);
  } else if (platBest && plat.n === 1) parts.push(`平台盈亏${platBest.symbol}${exportMoney(platBest.pnl)}`);
  else if (platBest) {
    parts.push(`平台盈亏${exportMoney(plat.sum)}(${plat.n}颗)`);
    if (Number(platBest.pnl) > 0) parts.push(`最赚${platBest.symbol}${exportMoney(platBest.pnl)}`);
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
  const strength = strengthExportRemark(stats.pf, stats.pnl30, stats.plat, gmgnOk, pumpAcct);
  const parts = (platName ? [platName, strength, grade, ...tagged, ...custom] : [grade, ...tagged, ...custom, strength]).filter(Boolean);
  return exportClean([...new Set(parts)].join("/"));
}

const pumpAcctOf = (w) => (w && w.acct ? w.acct["pump.fun"] : null);
function platformProfit(w) {
  const acct = acctTotal(pumpAcctOf(w));
  if (acct != null) return { value: acct, src: "pump.fun 帐号", n: pumpAcctOf(w).coins, acct: true };
  const sum = w && w.plat && w.plat.n > 0 ? Number(w.plat.sum) : NaN;
  return Number.isFinite(sum) ? { value: sum, src: "平台", n: w.plat.n } : null;
}

function platformProfitStats(wallets, names, chain, platforms = []) {
  const any = !platforms.length || platforms.includes("*");
  const addresses = new Set((names || []).filter((p) => p.chain === chain && p.address && p.handle && (any || platforms.includes(p.platform))).map((p) => p.address));
  const byAddress = new Map((wallets || []).filter((w) => w.chain === chain).map((w) => [w.address, w]));
  const stats = { total: addresses.size, loss: 0, small: 0, unknown: 0, tiers: Object.fromEntries(EXPORT_PLAT_TIERS.map((t) => [t, 0])) };
  const pumpAddresses = new Set((names || []).filter((p) => p.chain === chain && p.address && p.handle && p.platform === "pump.fun").map((p) => p.address));
  stats.pump = { total: pumpAddresses.size, synced: [...pumpAddresses].filter((a) => acctTotal(pumpAcctOf(byAddress.get(a))) != null).length };
  for (const address of addresses) {
    const profit = platformProfit(byAddress.get(address));
    stats.tiers[0] += 1;
    if (!profit) { stats.unknown += 1; continue; }
    if (profit.value < 0) stats.loss += 1;
    else if (profit.value < EXPORT_PLAT_TIERS[1]) stats.small += 1;
    for (const t of EXPORT_PLAT_TIERS) if (t && profit.value >= t) stats.tiers[t] += 1;
  }
  return stats;
}

function exportSelection(sel) {
  if (Array.isArray(sel)) {
    const picks = [];
    if (sel.includes("follow")) picks.push("group:follow");
    if (sel.includes("avoid")) picks.push("avoid");
    if (sel.includes("platform")) picks.push("plat:*");
    return { picks: new Set(picks), drops: new Set(EXPORT_DEFAULT_DROPS), platMin: 0 };
  }
  const platMin = Number(sel && sel.platMin);
  return { picks: new Set((sel && sel.picks) || []), drops: new Set((sel && sel.drops) || []),
    platMin: EXPORT_PLAT_TIERS.includes(platMin) ? platMin : 0 };
}

function exportDefaultSelection(groupOf = {}) {
  const follow = Object.keys(groupOf).filter((id) => groupOf[id] === "follow").map((id) => `label:${id}`);
  return { picks: [...follow, "avoid", "plat:FOMO", "plat:pump.fun"], drops: [...EXPORT_DEFAULT_DROPS], platMin: 0 };
}

function exportPickHit(w, pick, groupOf) {
  const labels = (w.labels || []).filter((id) => !EXPORT_SKIP.has(id));
  if (pick.startsWith("grade:")) return Boolean(w.card && w.card.grade === pick.slice(6));
  if (pick.startsWith("label:")) return (w.labels || []).includes(pick.slice(6));
  if (pick === "group:follow") return labels.some((id) => groupOf[id] === "follow");
  if (pick === "avoid") return labels.some((id) => groupOf[id] === "avoid");
  return false;
}

function exportDropHit(w, drop, highFreq = EXPORT_HIGH_FREQ) {
  const labels = w.labels || [];
  const card = w.card || {};
  switch (drop) {
    case "bot": return Boolean(w.bot);
    case "pending": return Boolean(w.botPending) && !w.bot;
    case "quiet": return Boolean(w.quiet);
    case "highfreq": return !w.bot && Number(card.trades) >= highFreq;
    case "bundle": return labels.includes("bundle_member");
    case "insider": return labels.includes("insider");
    case "sniper": return labels.includes("sniper");
    case "loss30": return card.realized != null && Number(card.realized) < 0;
    case "dormant": return (card.style || []).includes("休眠");
    default: return false;
  }
}

function libraryExportItems(wallets, names, chain, sel, groupOf = {}, labelName = {}, highFreq = EXPORT_HIGH_FREQ) {
  const { picks, drops, platMin } = exportSelection(sel);
  const platPicks = [...picks].filter((pick) => pick.startsWith("plat:")).map((pick) => pick.slice(5));
  const otherPicks = [...picks].filter((pick) => !pick.startsWith("plat:"));
  const plat = new Map();
  for (const p of names || []) {
    if (p.chain !== chain || !p.address || !p.handle) continue;
    if (!plat.has(p.address)) plat.set(p.address, []);
    plat.get(p.address).push(p);
  }
  const platHit = (rows) => Boolean(rows && platPicks.some((name) => name === "*" || rows.some((p) => p.platform === name)));
  const profitOk = (w) => {
    if (!platMin) return true;
    const profit = platformProfit(w);
    return Boolean(profit) && profit.value >= platMin;
  };
  const items = new Map();
  for (const w of wallets || []) {
    if (w.chain !== chain || !w.address || items.has(w.address)) continue;
    const viaPlatform = platHit(plat.get(w.address)) && profitOk(w);
    if (!viaPlatform) {
      if (!otherPicks.some((pick) => exportPickHit(w, pick, groupOf))) continue;
      if ([...drops].some((drop) => exportDropHit(w, drop, highFreq))) continue;
    }
    items.set(w.address, { address: w.address, rename: walletExportRemark(w.labels, w.manualLabels, plat.get(w.address), groupOf, labelName, w) });
  }
  const known = new Set((wallets || []).filter((w) => w.chain === chain).map((w) => w.address));
  for (const [address, rows] of plat) {
    if (!platMin && !items.has(address) && !known.has(address) && platHit(rows)) items.set(address, { address, rename: platformExportRemark(rows) });
  }
  return [...items.values()];
}

function botExportNote(wallets, chain) {
  const rows = (wallets || []).filter((w) => w.chain === chain && !(w.platforms || []).length);
  const bots = rows.filter((w) => w.bot).length, pending = rows.filter((w) => !w.bot && w.botPending).length;
  const parts = [];
  if (bots) parts.push(`${bots} 个机器人（你标过所以还在库里）不导出`);
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
    const count = libraryExportItems(wallets, names, chain, sel, groupOf, {}, highFreq).length;
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

  (() => {
    const dialog = document.getElementById("platform-export-dialog");
    if (!dialog || !document.getElementById("export-picks")) return;
    const byId = (id) => document.getElementById(id);
    const pickBox = byId("export-picks"), dropSeg = byId("export-drops"), chainSeg = byId("platform-export-chain"), formatSeg = byId("platform-export-format");
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
    const state = { wallets: [], names: [], groupOf: {}, labelName: {}, highFreq: EXPORT_HIGH_FREQ, output: { count: 0, text: "" },
      picks: null, drops: null, platMin: 0, chain: read("wi-platform-export-chain") || "", format: read("wi-platform-export-format") === "gmgn" ? "gmgn" : "debot" };

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
    const saveSelection = () => write(SEL_KEY, JSON.stringify({ picks: [...state.picks], drops: [...state.drops], platMin: state.platMin }));
    const sel = (picks = state.picks, drops = state.drops) => ({ picks: [...picks], drops: [...drops], platMin: state.platMin });
    const items = (chain, selection = sel()) => libraryExportItems(state.wallets, state.names, chain, selection, state.groupOf, state.labelName, state.highFreq);

    function pickGroups() {
      const follow = Object.keys(state.groupOf).filter((id) => state.groupOf[id] === "follow");
      return [
        { title: "实力等级", note: "他自己 30 天赚不赚（不代表跟了会赚）", picks: EXPORT_GRADES.map((g) => [`grade:${g}`, `${g} 级`]) },
        { title: "高手标签", picks: follow.map((id) => [`label:${id}`, EXPORT_CHIP_NAME[id] || state.labelName[id] || id]) },
        { title: "其他", picks: [["avoid", "要避开（⚠ 警示用）"], ["plat:FOMO", "FOMO 用户"], ["plat:pump.fun", "pump.fun 用户"], ["label:kol", "KOL"]] },
      ];
    }

    function chip(key, attr, text, on, count) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset[attr] = key;
      button.setAttribute("aria-pressed", String(on));
      button.textContent = `${text} ${count}`;
      return button;
    }

    function renderPicks() {
      pickBox.replaceChildren(...pickGroups().map((group) => {
        const wrap = document.createElement("div");
        wrap.className = "export-pick-group";
        const head = document.createElement("div");
        head.className = "export-pick-head";
        const title = document.createElement("span");
        title.textContent = group.title;
        const allOn = group.picks.every(([key]) => state.picks.has(key));
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "btn btn-sm btn-ghost";
        toggle.dataset.pickAll = group.picks.map(([key]) => key).join(",");
        toggle.textContent = allOn ? "全不选" : "全选";
        head.append(title, toggle);
        if (group.note) head.append(Object.assign(document.createElement("small"), { className: "muted", textContent: group.note }));
        const seg = document.createElement("div");
        seg.className = "seg seg-wrap";
        seg.setAttribute("role", "group");
        seg.setAttribute("aria-label", group.title);
        seg.append(...group.picks.map(([key, text]) => chip(key, "pick", text, state.picks.has(key), items(state.chain, sel([key])).length)));
        wrap.append(head, seg);
        return wrap;
      }), platformTierGroup());
    }

    function platformTierGroup() {
      const platforms = [...state.picks].filter((key) => key.startsWith("plat:")).map((key) => key.slice(5));
      const stats = platformProfitStats(state.wallets, state.names, state.chain, platforms);
      const wrap = document.createElement("div");
      wrap.className = "export-pick-group";
      const head = document.createElement("div");
      head.className = "export-pick-head";
      head.append(Object.assign(document.createElement("span"), { textContent: "FOMO／pump.fun 用户总盈利" }),
        Object.assign(document.createElement("small"), { className: "muted", textContent: "只导出赚到这么多的平台用户" }));
      const seg = document.createElement("div");
      seg.className = "seg seg-wrap";
      seg.setAttribute("role", "group");
      seg.setAttribute("aria-label", "FOMO／pump.fun 用户总盈利门槛");
      seg.append(...EXPORT_PLAT_TIERS.map((t) => chip(String(t), "platMin", t ? `≥ $${t / 1000}K` : "不限", state.platMin === t, stats.tiers[t])));
      const who = !platforms.length || platforms.includes("*") ? "FOMO／pump.fun 用户" : `${platforms.join("＋")} 用户`;
      const note = document.createElement("p");
      note.className = "sheet-note";
      note.textContent = [
        `${state.chain} 的 ${who} ${stats.total} 个：亏损 ${stats.loss}、赚 $0～$1K ${stats.small}、赚 $1K 以上 ${stats.tiers[1000]}、盈利不明 ${stats.unknown}。`,
        "总盈利只用平台自己算的、不看 GMGN：pump.fun 用户先用 pump.fun 帐号总盈亏（每颗交易过的币加总），还没算的和 FOMO 用户用钱包库里有平台数字的几颗币加总；都没有的算盈利不明。",
        state.platMin ? "没达到门槛和盈利不明的平台用户不会因为是平台用户就导出，符合其他勾选的照常导出。" : "",
        platforms.length ? "" : "现在没勾 FOMO／pump.fun 用户，这排不影响导出。",
      ].filter(Boolean).join("");
      wrap.append(head, seg, note);
      if (stats.pump.total) {
        const sync = document.createElement("p");
        sync.className = "sheet-note";
        sync.append(`${state.chain} 的 pump.fun 用户 ${stats.pump.total} 个，帐号总盈亏已算 ${stats.pump.synced} 个。`,
          Object.assign(document.createElement("a"), { href: "./pump-sync.html", target: "_blank", rel: "noopener", textContent: "更新 pump.fun 战绩" }));
        wrap.append(sync);
      }
      return wrap;
    }

    function renderDrops() {
      const now = items(state.chain).length;
      dropSeg.replaceChildren(...EXPORT_DROPS.map(([key, text]) => {
        const on = state.drops.has(key);
        const other = new Set(state.drops);
        if (on) other.delete(key); else other.add(key);
        const blocked = on ? items(state.chain, sel(state.picks, other)).length - now : now - items(state.chain, sel(state.picks, other)).length;
        return chip(key, "drop", text, on, blocked);
      }));
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
      press(chainSeg, "chain", (chain) => chain === state.chain);
      press(formatSeg, "format", (format) => format === state.format);
      formatNote.textContent = FORMAT_NOTE[state.format];
      state.output = libraryExportText(items(state.chain), state.format);
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
      if (!state.picks) {
        const saved = loadSelection();
        state.picks = new Set(saved.picks);
        state.drops = new Set(saved.drops);
        state.platMin = exportSelection(saved).platMin;
      }
      render();
    }

    byId("open-platform-export")?.addEventListener("click", () => { if (!dialog.open) dialog.showModal(); load(); });
    byId("platform-export-close")?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    pickBox.addEventListener("click", (event) => {
      const all = event.target.closest("button[data-pick-all]");
      const button = event.target.closest("button[data-pick]");
      const tier = event.target.closest("button[data-plat-min]");
      if (all) {
        const keys = all.dataset.pickAll.split(",");
        const on = !keys.every((key) => state.picks.has(key));
        keys.forEach((key) => (on ? state.picks.add(key) : state.picks.delete(key)));
      } else if (button) {
        const key = button.dataset.pick;
        if (state.picks.has(key)) state.picks.delete(key); else state.picks.add(key);
      } else if (tier) {
        state.platMin = Number(tier.dataset.platMin) || 0;
      } else return;
      saveSelection();
      render();
    });
    dropSeg.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-drop]");
      if (!button) return;
      const key = button.dataset.drop;
      if (state.drops.has(key)) state.drops.delete(key); else state.drops.add(key);
      saveSelection();
      render();
    });
    byId("export-reset")?.addEventListener("click", () => {
      const base = exportDefaultSelection(state.groupOf);
      state.picks = new Set(base.picks);
      state.drops = new Set(base.drops);
      state.platMin = 0;
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
