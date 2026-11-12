"use strict";

const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_MCAP_DEFAULT = 0;
const MAX_MCAP_KEY = "smart-money-max-mcap-v2";
const state = {
  tab: "signals", chain: "", window: 3600, minUsd: 50, maxMcap: MAX_MCAP_DEFAULT, noBots: false, feedFilter: "all", launchpadOnly: true,
  data: null, fetchedAt: 0, loaded: false, prevBuyers: new Map(), prevFeed: new Set(), prevVals: new Map(),
  group: "watch", sort: "score", q: "", mineChain: "bsc", mineSrc: "auto", mineSrcOk: true, mineAll: true, mineAllOk: false, fomoHot: null, mineNamesOk: false, timer: null, drawer: null, lastFocus: null,
  rvDays: 7, rvBackfill: true, rvRule: "", review: null, reviewAt: 0,
};
const GRADE_TEXT = { S: "S 级", A: "A 级", B: "B 级", C: "C 级", D: "D 级" };
const KIND_TAG = { ally: "ally", insider: "insider", bundle: "risk", bad: "risk", bot: "risk" };
const WINDOW_TEXT = { 900: "15 分钟前", 1800: "30 分钟前", 3600: "1 小时前", 14400: "4 小时前", 86400: "24 小时前" };
const TZ = undefined;
const TZ_SHIFT = -new Date().getTimezoneOffset() * 60;
const clockFmt = new Intl.DateTimeFormat("zh-CN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const dateFmt = new Intl.DateTimeFormat("zh-CN", { timeZone: TZ, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function s(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, String(v));
  return el;
}

async function api(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  let json;
  try { json = await res.json(); } catch { throw new Error(`服务器回应格式不对（HTTP ${res.status}）`); }
  if (!json.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function toast(text) {
  window.Shell?.toast(text);
}

function nowSec() {
  if (!state.data) return Math.floor(Date.now() / 1000);
  return state.data.now + Math.floor((Date.now() - state.fetchedAt) / 1000);
}

function usd(n, signed) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  n = Number(n);
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : signed && n > 0 ? "+" : "";
  let body;
  if (a >= 1e9) body = `${(a / 1e9).toFixed(2)}B`;
  else if (a >= 1e6) body = `${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  else if (a >= 1e3) body = `${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  else body = a.toFixed(a >= 100 ? 0 : a >= 1 ? 1 : 2);
  return `${sign}$${body}`;
}

function priceNode(p) {
  const span = h("span", { class: "price" });
  if (!p || !Number.isFinite(Number(p))) { span.textContent = "—"; return span; }
  p = Number(p);
  if (p >= 1) { span.textContent = `$${p.toLocaleString("en-US", { maximumFractionDigits: 4 })}`; return span; }
  const str = p.toExponential(3);
  const exp = Number(str.split("e")[1]);
  const zeros = -exp - 1;
  const digits = str.split("e")[0].replace(".", "").replace(/0+$/, "").slice(0, 4) || "0";
  if (zeros >= 4) span.append("$0.0", h("sub", { text: String(zeros) }), digits);
  else span.textContent = `$${p.toFixed(zeros + 4).replace(/0+$/, "")}`;
  return span;
}

function pct(x) {
  if (x == null || !Number.isFinite(x)) return "—";
  const v = x * 100;
  const a = Math.abs(v);
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${a >= 100 ? a.toFixed(0) : a.toFixed(1)}%`;
}

function ago(ts) {
  if (!ts) return "—";
  const d = Math.max(0, nowSec() - ts);
  if (d < 60) return `${d} 秒前`;
  if (d < 3600) return `${Math.floor(d / 60)} 分钟前`;
  if (d < 86400) return `${Math.floor(d / 3600)} 小时前`;
  return `${Math.floor(d / 86400)} 天前`;
}

function clock(ts) { return ts ? clockFmt.format(new Date(ts * 1000)) : ""; }
function stamp(ts) { return ts ? dateFmt.format(new Date(ts * 1000)) : "—"; }
function dur(sec) {
  if (sec == null || !Number.isFinite(sec)) return "—";
  if (sec < 60) return `${Math.round(sec)} 秒`;
  if (sec < 3600) return `${Math.round(sec / 60)} 分钟`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} 小时`;
  return `${(sec / 86400).toFixed(1)} 天`;
}
function entryText(sec) { return sec < 0 ? `毕业前 ${dur(-sec)}` : `开盘 ${dur(sec)}`; }

const CHAIN_NAME = { bsc: "BSC", sol: "SOL", robinhood: "RH" };
const DEX_SLUG = { bsc: "bsc", sol: "solana" };
function chainName(c) { return CHAIN_NAME[c] || "BSC"; }
function gmgnToken(c, ca) { return `https://gmgn.ai/${c}/token/${encodeURIComponent(ca)}`; }
function gmgnWallet(c, a) { return `https://gmgn.ai/${c}/address/${encodeURIComponent(a)}`; }
function dexToken(c, ca) { return DEX_SLUG[c] ? `https://dexscreener.com/${DEX_SLUG[c]}/${encodeURIComponent(ca)}` : ""; }
function analyzeLink(x) { return `./analyze.html?q=${encodeURIComponent(x)}`; }

function logoNode(url, sym, size) {
  const box = h("span", { class: `logo${size ? ` ${size}` : ""}`, "aria-hidden": "true" });
  const letter = String(sym || "?").replace(/^\$/, "").slice(0, 1).toUpperCase();
  if (typeof url === "string" && url.startsWith("https://gmgn.ai/")) {
    const img = h("img", { src: url, alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => { img.remove(); box.textContent = letter; }, { once: true });
    box.append(img);
  } else {
    box.textContent = letter;
  }
  return box;
}

function gradeBadge(grade, big) {
  const g = grade || "none";
  return h("span", { class: `gb g-${g}${big ? " big" : ""}`, title: grade ? `${GRADE_TEXT[grade]}（自建评分）` : "还没评分", text: grade || "?" });
}

function walletTitle(w) {
  return w.label || w.name || (w.twitter ? `@${w.twitter}` : "");
}

const PNL_TIER_FLOOR = { S: "$100K", A: "$30K", B: "$10K", C: "$3K", D: "$1K" };
function pnlTierTag(w) {
  if (!w.pnlTier) return null;
  const when = w.pnl30At ? `，${dateFmt.format(new Date(w.pnl30At * 1000))} 查` : "";
  return h("span", { class: `tag pnl pt-${w.pnlTier}`, title: `30 天盈利 ${w.pnlTier} 级（≥${PNL_TIER_FLOOR[w.pnlTier]}）：已实现 ${usd(w.pnl30, true)}${when}；每 7 天重查，不影响信号`, text: `盈利 ${w.pnlTier}` });
}

function walletTags(w) {
  const out = [];
  const plats = Array.isArray(w.platforms) ? w.platforms : [];
  for (const p of plats.slice(0, 2)) {
    const fomo = p.platform === "FOMO";
    out.push(h("span", { class: `tag ${fomo ? "fomo" : "pump"}`, text: `${fomo ? "FOMO" : "pump"}：${p.handle}`, title: `${p.platform} 帐号 ${p.handle}${p.x ? `（X @${p.x}）` : ""}` }));
  }
  if (w.fomoWallet && !plats.some((p) => p.platform === "FOMO")) out.push(h("span", { class: "tag fomo", text: "FOMO 钱包", title: "这个 0x 地址在 BSC 或 RH 链上绑定 FOMO 的钱包合约（EIP-7702），是 FOMO App 的用户；名字要到他赚钱那颗币的 FOMO 币页按「持币」书签对（还拿着才对得到）" }));
  const tier = pnlTierTag(w);
  if (tier) out.push(tier);
  if (w.kindText && w.kind !== "ally") out.push(h("span", { class: `tag ${KIND_TAG[w.kind] || ""}`, text: w.kindText }));
  if (w.kind === "ally") out.push(h("span", { class: "tag ally", text: "我标的" }));
  if (w.kol) out.push(h("span", { class: "tag kol", text: "KOL" }));
  if (w.watch === 1) out.push(h("span", { class: "tag watch", text: "追踪中" }));
  return out;
}

function copyBtn(text) {
  return h("button", { class: "copy-btn", type: "button", "data-copy": text, "aria-label": "拷贝完整地址", title: "拷贝完整地址", text: "⧉" });
}

const STAR_PATH = "M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z";
function starIcon() {
  const svg = s("svg", { class: "ico", viewBox: "0 0 24 24", "aria-hidden": "true" });
  svg.append(s("path", { d: STAR_PATH }));
  return svg;
}

function flashIf(el, key, value, index) {
  const prev = state.prevVals.get(key);
  state.prevVals.set(key, value);
  if (state.loaded && prev !== undefined && prev !== value) {
    el.classList.add("chg");
    el.style.setProperty("--i", String(index || 0));
  }
  return el;
}

async function refresh(force) {
  if (document.hidden && !force) return;
  try {
    const data = await api("/api/smart/overview", { chain: state.chain || null, window: state.window, minUsd: state.minUsd, launchpadOnly: state.launchpadOnly,
      maxMcap: state.maxMcap, noBots: state.noBots });
    state.data = data;
    state.fetchedAt = Date.now();
    renderStatus();
    renderSignals();
    renderFeed();
    renderRules();
    if (state.tab === "mine") renderMineProgress();
    if (state.tab === "review") {
      renderReviewProgress(data.tracker?.review);
      if (Date.now() - state.reviewAt > 60000) loadReview();
    }
    state.loaded = true;
  } catch (err) {
    renderStatusError(err.message);
  }
}

function schedule() {
  clearInterval(state.timer);
  state.timer = setInterval(() => refresh(false), 10000);
}

function renderStatusError(message) {
  $("pulse").className = "pulse err";
  $("status-title").textContent = "连不上本机服务器";
  $("status-sub").textContent = "";
  $("status-note").textContent = message;
}

function renderStatus() {
  const t = state.data.tracker;
  const chips = $("status-chips");
  chips.replaceChildren();
  const pulse = $("pulse");
  const btn = $("pause-btn");
  $("status-sub").textContent = t?.keyOk && !t.paused && !t.gmgn?.blockedUntil ? `${t.trades.toLocaleString()} 笔` : "";
  if (!t) {
    pulse.className = "pulse err";
    $("status-title").textContent = "背景追踪没有启动";
    $("status-note").textContent = "服务器用 --no-smart-money 启动，只能看已收集的数据";
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  btn.textContent = t.paused ? "继续收集" : "暂停收集";
  if (!t.keyOk) {
    pulse.className = "pulse err";
    $("status-title").textContent = "还没有 GMGN API Key";
    $("status-note").textContent = "到左下角「设置」存 Key，或用 GMGN CLI 设置后就会开始收集";
  } else if (t.paused) {
    pulse.className = "pulse";
    $("status-title").textContent = "已暂停";
    $("status-note").textContent = "不会再向 GMGN 要数据，下面是已经收集到的";
  } else if (t.gmgn.blockedUntil) {
    pulse.className = "pulse warn";
    $("status-title").textContent = "GMGN 限流中";
    $("status-note").textContent = `${t.gmgn.blockedUntilText} 后自动恢复`;
  } else {
    pulse.className = "pulse on";
    $("status-title").textContent = "收集中";
    $("status-note").textContent = `已存 ${t.trades.toLocaleString()} 笔交易，评过 ${t.scored.toLocaleString()} 个钱包`;
  }
  const names = { "sol:smartmoney": "SOL 聪明钱", "bsc:smartmoney": "BSC 聪明钱", "sol:kol": "SOL KOL", "bsc:kol": "BSC KOL" };
  for (const f of t.feeds) {
    const key = `${f.chain}:${f.kind}`;
    const chip = h("span", { class: `chip${f.error ? " is-err" : f.gap ? " is-warn" : ""}`, title: f.error || (f.gap ? "两次抓取之间可能有漏，已自动缩短间隔" : `每 ${f.interval} 秒抓一次`) },
      names[key] || key, h("b", { text: f.lastAt ? ago(Math.floor(f.lastAt)) : "等待中" }));
    chips.append(chip);
  }
  chips.append(h("span", { class: "chip", title: "私人标签＋手动加入的钱包，每 10 分钟批量看谁有交易，有动才抓明细；0x 钱包 BSC 和 RH 都看，同一个地址只算一个" },
    "我的名单", h("b", { text: `${t.watch} 个` })));
  if (t.scoreQueue) chips.append(h("span", { class: "chip", title: "排队等着用 GMGN 30 天数据评分：新钱包、和评过分满 7 天又有新买单的；RH 钱包要在 RH 有交易才评，没交易的不算在这里" }, "待评分", h("b", { text: String(t.scoreQueue) })));
  if (t.pnlDue) chips.append(h("span", { class: "chip", title: "30 天盈利超过 7 天没查的钱包，背景每分钟最多重查一个（盈利等级用，不影响信号）" }, "待重查盈利", h("b", { text: String(t.pnlDue) })));
  if (t.gmgn.remaining != null) chips.append(h("span", { class: "chip", title: "GMGN 免费额度很紧，背景收集会留一点给一键分析" }, "GMGN 额度", h("b", { text: `${t.gmgn.remaining}/5` })));
  if (t.lastError && !t.gmgn.blockedUntil) chips.append(h("span", { class: "chip is-err", title: t.lastError, text: t.lastError.slice(0, 40) }));
}

function renderRules() {
  const box = $("rules");
  if (box.dataset.ready || !state.data?.rules) return;
  const r = state.data.rules;
  box.append(
    h("h3", { text: "信号" }), h("ul", {}, r.signal.map((x) => h("li", { text: x }))),
    h("h3", { text: "钱包评分（0～100，用 GMGN 30 天数据）" }),
    h("ul", {}, r.score.map((x) => h("li", { text: `${x.label} ${Math.round(x.weight * 100)}%：${x.rule}` }))),
    h("ul", {}, r.penalties.map((x) => h("li", { text: `${x.label}：${x.rule}` }))),
    h("p", { text: r.grade || "只是筛选工具，不是买卖建议。" }),
  );
  box.dataset.ready = "1";
}

function timeline(sig, freshSet) {
  const wrap = h("div", { class: "tl" });
  const svg = s("svg", { role: "img", "aria-label": `${sig.wallets} 个钱包的买进时间分布` });
  const end = nowSec();
  const start = end - state.window;
  svg.append(s("line", { class: "axis", x1: "0%", x2: "100%", y1: 15, y2: 15 }));
  for (const q of [0.25, 0.5, 0.75]) svg.append(s("line", { class: "tick", x1: `${q * 100}%`, x2: `${q * 100}%`, y1: 10, y2: 20 }));
  const pts = [...(sig.points || [])].sort((a, b) => (b.usd || 0) - (a.usd || 0));
  const placed = [];
  for (const p of pts) {
    const x = Math.min(99, Math.max(1, ((p.t - start) / state.window) * 100));
    const r = 2.5 + 7.5 * Math.sqrt(Math.min(p.usd || 0, 20000) / 20000);
    const near = placed.filter((q) => Math.abs(q - x) < 1.6).length;
    placed.push(x);
    const cy = 15 + (near === 0 ? 0 : (near % 2 ? -1 : 1) * Math.min(8, 4 + near * 2));
    const risk = (p.w ?? 1) <= 0;
    const cls = ["dot", `g-${p.grade || "none"}`];
    if (risk) cls.push("k-risk");
    else if (p.kind === "ally") cls.push("k-ally");
    if (p.x) cls.push("is-exited");
    if (freshSet && freshSet.has(p.t)) cls.push("is-new");
    const c = s("circle", { class: cls.join(" "), cx: `${x}%`, cy, r: r.toFixed(1) });
    c.append(s("title"));
    c.firstChild.textContent = `${clock(p.t)} 买进 ${usd(p.usd)}${p.grade ? `（${p.grade} 级）` : ""}${risk ? "（你标的风险钱包）" : ""}${p.x ? "，已经卖掉大部分" : ""}`;
    svg.append(c);
  }
  wrap.append(svg, h("div", { class: "tl-scale" }, h("span", { text: WINDOW_TEXT[state.window] || "" }), h("span", { text: "现在" })));
  return wrap;
}

const STRENGTH_TEXT = { strong: "强", medium: "中", weak: "单一" };
const STRENGTH_LONG = { strong: "强信号", medium: "中信号", weak: "单一高手" };

function gradeMix(mix) {
  const parts = [];
  for (const g of ["S", "A", "B"]) if (mix[g]) parts.push(`${g} ${mix[g]}`);
  if (mix.ally) parts.push(`我标的 ${mix.ally}`);
  if (mix.kol) parts.push(`KOL ${mix.kol}`);
  return parts.join("、");
}

function signalRow(sig) {
  const key = `${sig.chain}:${sig.ca}`;
  const prev = state.prevBuyers.get(key);
  const addrs = new Set(sig.buyers.map((b) => b.address));
  const freshAddrs = state.loaded ? sig.buyers.filter((b) => !prev || !prev.has(b.address)) : [];
  const freshTimes = new Set(freshAddrs.map((b) => b.first));
  state.prevBuyers.set(key, addrs);
  const fresh = state.loaded && freshAddrs.length > 0;
  const open = () => openToken(sig.chain, sig.ca, sig);
  const row = h("div", {
    class: `sig-row${fresh ? " is-fresh" : ""}`, role: "button", tabindex: "0",
    "aria-label": `${sig.symbol} ${STRENGTH_LONG[sig.strength]}，${sig.wallets} 个钱包买进`,
    onclick: open,
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } },
  });
  const danger = sig.flags.some((f) => f.level === "danger");
  const warn = sig.flags.length
    ? h("span", { class: "warn-mark", title: sig.flags.map((f) => f.text).join("\n"), text: `${danger ? "风险" : "注意"} ${sig.flags.length}` })
    : null;
  if (warn && danger) warn.classList.add("down");
  const tok = h("div", { class: "c-tok sig-tok" },
    logoNode(sig.logo, sig.symbol),
    h("div", { class: "sym-line" },
      h("span", { class: "sym", text: sig.symbol, title: sig.symbol }),
      state.chain ? null : h("span", { class: "chain-tag", text: chainName(sig.chain) }),
      warn),
    h("div", { class: "when" },
      sig.launchpad ? h("span", { class: "pad", text: sig.launchpad }) : null,
      h("span", { text: `首买 ${ago(sig.firstBuy)}` })));
  const strength = h("div", { class: "c-str" },
    h("span", { class: `strength s-${sig.strength}`, title: `份量 ${sig.conviction.toFixed(1)}：等级越高、你标的高手越重`, text: STRENGTH_TEXT[sig.strength] }));
  const mix = gradeMix(sig.mix || {});
  const partial = sig.holders != null && sig.holders !== sig.wallets;
  const wallets = h("div", { class: "c-wal cell-num", title: [`${sig.wallets} 个钱包买过${partial ? `，还拿着 ${sig.holders} 个` : ""}`, mix].filter(Boolean).join("\n") },
    h("small", { class: "k", text: "钱包" }),
    flashIf(h("span", { text: String(sig.wallets) }), `${key}:w`, sig.wallets, 0),
    h("small", { text: partial ? `还拿 ${sig.holders}` : mix }));
  const flow = h("div", { class: "c-flow cell-num" },
    h("small", { class: "k", text: "买进" }),
    flashIf(h("span", { class: "buy", text: usd(sig.buyUsd) }), `${key}:b`, Math.round(sig.buyUsd || 0), 1),
    h("small", { text: sig.sellUsd > 0 ? `卖 ${usd(sig.sellUsd)}` : "还没卖" }));
  const change = sig.change;
  const chg = h("div", { class: "c-chg cell-num", title: `他们的均价到现价；现价来源：${sig.priceSrc || "—"}` },
    h("small", { class: "k", text: "均价到现价" }),
    flashIf(h("span", { class: change == null ? "" : change >= 0 ? "up" : "down", text: pct(change) }), `${key}:c`, change == null ? null : Math.round(change * 1000), 2),
    h("small", {}, "现价 ", priceNode(sig.price)));
  const mcap = h("div", { class: "c-mcap cell-num" },
    h("small", { class: "k", text: "市值" }),
    flashIf(h("span", { text: usd(sig.mcap) }), `${key}:m`, Math.round(sig.mcap || 0), 3),
    h("small", { text: sig.entryMcap ? `进场 ${usd(sig.entryMcap)}` : "" }));
  row.append(tok, strength, wallets, flow, chg, mcap, h("div", { class: "c-tl" }, timeline(sig, fresh ? freshTimes : null)));
  return row;
}

function signalHead() {
  return h("div", { class: "sig-row sig-head", "aria-hidden": "true" },
    h("span", { text: "代币" }), h("span", { text: "强度" }), h("span", { text: "钱包" }), h("span", { text: "买进" }),
    h("span", { text: "均价到现价" }), h("span", { class: "c-mcap", text: "市值" }),
    h("div", { class: "tl-scale" }, h("span", { text: WINDOW_TEXT[state.window] || "" }), h("span", { text: "现在" })));
}

function renderSignals() {
  const box = $("signals");
  const d = state.data;
  const c = { ...d.counts };
  let signals = d.signals;
  if (c.overCap === undefined) {
    signals = state.maxMcap ? d.signals.filter((s) => !(s.mcap > state.maxMcap)) : d.signals;
    c.overCap = d.signals.length - signals.length;
    c.strong = signals.filter((s) => s.strength === "strong").length;
    c.medium = signals.filter((s) => s.strength === "medium").length;
  }
  const cap = $("max-mcap").selectedOptions[0]?.textContent || usd(state.maxMcap);
  const over = c.overCap ? `；另有 ${c.overCap} 颗市值超过 ${cap} 没列` : "";
  const botOff = c.botSkipped ? `；另有 ${c.botSkipped} 个有机器人还拿着，没列` : "";
  $("signal-summary").textContent = `${WINDOW_TEXT[state.window].replace("前", "")}内 ${c.wallets.toLocaleString()} 个钱包、${c.tokens.toLocaleString()} 颗币有交易；强 ${c.strong}、中 ${c.medium}${over}${botOff}`;
  box.replaceChildren();
  if (!signals.length && c.overCap) {
    box.append(h("div", { class: "empty" },
      h("strong", { text: `这段时间的 ${c.overCap} 个信号市值都超过 ${cap}` }),
      "可以在「筛选」把市值上限调高或改成不限，或把时间窗拉长。"));
    return;
  }
  if (!signals.length && c.botSkipped) {
    box.append(h("div", { class: "empty" },
      h("strong", { text: `这段时间的 ${c.botSkipped} 个信号都有机器人还拿着` }),
      "可以在「筛选」关掉「排除有机器人的信号」，或把时间窗拉长。"));
    return;
  }
  if (!signals.length) {
    const t = d.tracker;
    const first = !t || t.trades < 20;
    if (state.chain === "robinhood") {
      box.append(h("div", { class: "empty" },
        h("strong", { text: c.trades ? "这段时间 RH 还没有共识" : "RH 名单这段时间没有交易" }),
        "GMGN 没有 RH 的聪明钱／KOL 动态，这里只看你名单里的钱包（私人标签、BSC 名单同步过去的、RH 挖掘候选），每 10 分钟看一次谁有交易。可以把时间窗拉长到 4 时或 24 时。"));
      return;
    }
    box.append(h("div", { class: "empty" },
      h("strong", { text: first ? "刚开始收集" : "这段时间还没有共识" }),
      first ? "聪明钱和 KOL 的买卖会一笔笔存下来，通常 1～2 分钟内会出现第一批信号。"
        : "还没有够多有份量的钱包同时买同一颗币。可以把时间窗拉长，或把单笔金额门槛调低。"));
    return;
  }
  box.append(signalHead());
  for (const sig of signals) box.append(signalRow(sig));
}

function sideText(t) {
  if (t.side === "buy") return t.full ? "建仓" : "加仓";
  return t.full ? "清仓" : "减仓";
}

function renderFeed() {
  const list = $("feed");
  const rows = state.data.feed.filter((t) => state.feedFilter === "all" ? true
    : state.feedFilter === "buy" ? t.side === "buy" : t.wallet.watch === 1 || !!t.wallet.label);
  const seen = new Set();
  list.replaceChildren();
  if (!rows.length) {
    list.append(h("li", { class: "empty-row" }, h("span", {}), h("span", { class: "hint", text: state.feedFilter === "mine" ? "你的名单这段时间没有交易纪录。" : "这段时间还没有符合条件的交易。" })));
    return;
  }
  for (const t of rows.slice(0, 120)) {
    const key = `${t.tx}:${t.maker}:${t.side}`;
    seen.add(key);
    const isNew = state.loaded && !state.prevFeed.has(key);
    const w = t.wallet;
    const li = h("li", { class: isNew ? "is-new" : "" },
      h("span", { class: `f-side ${t.side}`, text: sideText(t) }),
      h("span", { class: "f-main" },
        h("span", { class: "tok", role: "button", tabindex: "0", text: t.symbol, onclick: () => openToken(t.chain, t.token), onkeydown: (e) => { if (e.key === "Enter") openToken(t.chain, t.token); } }),
        h("span", { class: `f-usd ${t.side}`, text: usd(t.usd) }),
        t.mcap ? h("span", { class: "f-mc", text: `市值 ${usd(t.mcap)}` }) : null),
      h("span", { class: "f-time", title: stamp(t.ts), text: clock(t.ts) }),
      h("span", { class: "f-who", role: "button", tabindex: "0", onclick: () => openWallet(t.chain, t.maker), onkeydown: (e) => { if (e.key === "Enter") openWallet(t.chain, t.maker); } },
        gradeBadge(w.grade),
        h("span", { class: "f-id" },
          walletTitle(w) ? h("span", { class: "nm", text: walletTitle(w) }) : h("span", { class: "nm is-anon", text: w.kol ? "KOL" : "未命名钱包" }),
          state.chain ? null : h("span", { class: "chain-tag", text: chainName(t.chain) })),
        h("span", { class: "addr", text: t.maker })));
    if (isNew) requestAnimationFrame(() => requestAnimationFrame(() => li.classList.remove("is-new")));
    list.append(li);
  }
  state.prevFeed = seen;
}

async function loadWallets() {
  const box = $("wallet-list");
  try {
    const r = await api("/api/smart/wallets", { chain: state.chain || null, group: state.group, q: state.q, sort: state.sort });
    const t = r.totals;
    $("wallet-summary").textContent = `追踪中 ${t.watch} 个、S 和 A 级 ${t.top} 个、挖到的候选 ${t.mined} 个；这里列出 ${r.total} 个${r.total > 400 ? "，只显示前 400 个" : ""}`;
    box.replaceChildren();
    if (!r.rows.length) {
      box.append(h("div", { class: "empty" }, h("strong", { text: "这一类还没有钱包" }),
        state.group === "mined" ? "到「挖掘」分页跑一轮就会有候选。" : state.group === "top" ? "评分会在背景慢慢跑，GMGN 额度很紧，每个钱包大约 10 秒。" : "可以在下面手动加入，或到钱包库导入私人标签。"));
      return;
    }
    box.append(walletHeader("30 天盈利"));
    for (const w of r.rows) box.append(walletRow(w));
  } catch (err) {
    box.replaceChildren(h("div", { class: "empty" }, h("strong", { text: "读不到名单" }), err.message));
  }
}

function walletHeader(profitLabel, labels = ["胜率", "24 小时交易", "最后交易"]) {
  return h("div", { class: "w-row head", "aria-hidden": "true" },
    h("span", {}), h("span", { text: "钱包" }), h("span", { text: profitLabel }), ...labels.map((text) => h("span", { text })), h("span", {}));
}

async function setWatch(w, watch, after) {
  try {
    await api("/api/smart/watch", { chain: w.chain, address: w.address, watch });
    toast(watch === 1 ? "已加入名单，会优先评分" : watch === -1 ? "已静音，不再计入信号" : "已移出名单");
    after?.();
  } catch (err) { toast(err.message); }
}

function watchButtons(w, after) {
  const box = h("span", { class: "w-actions" });
  const set = (watch) => (e) => { e.stopPropagation(); setWatch(w, watch, after); };
  if (w.watch === 1) box.append(h("button", { class: "mini-btn is-on", type: "button", text: "追踪中", title: "移出名单", onclick: set(0) }));
  else if (w.watch === -1) box.append(h("button", { class: "mini-btn", type: "button", text: "取消静音", onclick: set(0) }));
  else box.append(h("button", { class: "mini-btn", type: "button", text: "加入名单", onclick: set(1) }));
  if (w.watch !== -1 && w.kind !== "own") box.append(h("button", { class: "mini-btn is-mute", type: "button", text: "静音", title: "不再计入信号和动态", onclick: set(-1) }));
  return box;
}

function starButton(w, after) {
  const on = w.watch === 1;
  const muted = w.watch === -1;
  return h("span", { class: "w-actions" }, h("button", {
    class: "star", type: "button", "aria-pressed": String(on),
    "aria-label": on ? "移出名单" : muted ? "取消静音" : "加入名单", title: on ? "移出名单" : muted ? "已静音，点一下取消" : "加入名单",
    onclick: (e) => { e.stopPropagation(); setWatch(w, on || muted ? 0 : 1, after); },
  }, starIcon()));
}

function walletRow(w, opts = {}) {
  const st = w.stats || {};
  const pnl = w.pnl30 ?? st.realized;
  const open = () => openWallet(w.chain, w.address);
  const row = h("div", { class: "w-row", role: "button", tabindex: "0", onclick: open, onkeydown: (e) => { if (e.key === "Enter") open(); } },
    gradeBadge(w.grade),
    h("div", { class: "w-id" },
      h("div", { class: "line1" },
        opts.lead || null,
        walletTitle(w) ? h("span", { class: "nm", text: walletTitle(w) }) : null,
        state.chain ? null : h("span", { class: "chain-tag", text: chainName(w.chain) }),
        w.score != null ? h("span", { class: "tag", text: `${w.score} 分` }) : null,
        ...walletTags(w).filter((t) => !t.classList.contains("watch")),
        ...(w.style || []).slice(0, 2).map((x) => h("span", { class: "tag neutral", text: x }))),
      h("div", { class: "addr", text: w.address }),
      opts.note ? h("div", { class: "hint", text: opts.note }) : null,
      opts.extra || null),
    opts.profitCell || h("span", { class: "w-num" }, h("small", { text: "30 天" }), h("span", { class: pnl > 0 ? "up" : pnl < 0 ? "down" : "", text: pnl == null ? "—" : usd(pnl, true) })),
    opts.winCell || h("span", { class: "w-num" }, h("small", { text: "胜率" }), st.winrate == null ? "—" : `${Math.round(st.winrate * 100)}%`),
    opts.midCell || h("span", { class: "w-num" }, h("small", { text: "24 小时" }), `${w.trades24 ?? 0} 笔`),
    opts.lastCell || h("span", { class: "w-num", title: stamp(w.lastTradeTs) }, h("small", { text: "最后" }), ago(w.lastTradeTs)),
    starButton(w, opts.after || loadWallets));
  return row;
}

async function addWallets() {
  const text = $("add-text").value.trim();
  if (!text) { $("add-note").textContent = "先粘贴地址"; return; }
  $("add-btn").disabled = true;
  try {
    const r = await api("/api/smart/add", { text });
    $("add-note").textContent = `加入 ${r.added} 个${r.invalid.length ? `，${r.invalid.length} 行格式不对：${r.invalid.slice(0, 3).join("、")}` : ""}`;
    if (r.added) $("add-text").value = "";
    loadWallets();
  } catch (err) {
    $("add-note").textContent = err.message;
  } finally {
    $("add-btn").disabled = false;
  }
}

async function loadMined() {
  const box = $("mine-list");
  try {
    const r = await api("/api/smart/mined", { chain: state.mineChain });
    state.mineBlocked = r.chain !== state.mineChain;
    if (state.mineBlocked) {
      $("mine-summary").textContent = `${chainName(state.mineChain)} 挖掘要等服务器重启成新版才能用。`;
      $("mine-btn").disabled = true;
      box.replaceChildren();
      return;
    }
    if (!state.data?.tracker?.mine?.running) $("mine-btn").disabled = false;
    state.mineSrcOk = Array.isArray(r.mineSources);
    state.mineAllOk = r.mineAll === true;
    state.mineNamesOk = r.mineFomoNames === true;
    $("mine-all-wrap").hidden = !state.mineAllOk;
    mineSrcNote();
    renderFomoHot();
    const last = r.last || {};
    const fresh = Array.isArray(last.new) ? last.new.length : null;
    const skipped = last.skipped ? `（跳过 24 小时内扫过的 ${last.skipped} 颗）` : "";
    const from = last.sources ? `：${Object.entries(last.sources).map(([k, v]) => `${MINE_SRC_TEXT[k] || k} ${v}`).join("、")}` : "";
    const tail = fresh == null ? "；下面依命中颗数排序" : fresh ? `，这轮添加 ${fresh} 个，标「新出现」的排在前面` : "，这轮没有添加的地址";
    const sold = r.mineRule >= 2;
    if ($("mine-rule-note")) $("mine-rule-note").hidden = !sold;
    const traps = Array.isArray(last.traps) && last.traps.length
      ? `。挡掉 ${last.traps.length} 颗卖不掉的币（${last.traps.slice(0, 4).map((t) => t.symbol || t.ca).join("、")}${last.traps.length > 4 ? " 等" : ""}）` : "";
    const pending = sold && r.pending ? `。还有 ${r.pending} 颗旧命中的币等重新验算（旧规则把帐面获利也算进去），自动挖掘每轮会顺便算一部分` : "";
    const fomo = r.fomoWallets == null ? "" : `。下面 ${r.rows.length} 个里有 ${r.fomoWallets} 个是 FOMO 钱包${r.fomoUnchecked ? `（${r.fomoUnchecked} 个这次没查到，下次再查）` : ""}`;
    const named = r.named ? `，${r.named} 个有 FOMO／pump.fun 名字` : "";
    $("mine-summary").textContent = last.at
      ? `上次在 ${stamp(last.at)} 扫了 ${last.tokens?.length || 0} 颗币${from}${skipped}，${last.candidates} 个地址在 2 颗以上都赚${tail}${traps}${last.note ? `。${last.note}` : ""}${pending}${fomo}${named}`
      : "这条链还没挖过。";
    box.replaceChildren();
    if (!r.rows.length) return;
    box.append(walletHeader(!sold ? "命中币的总获利" : r.pending ? "命中币的获利" : "命中币卖掉赚到的", ["命中", "最快进场", "平均报酬"]));
    for (const w of r.rows) {
      const oldNote = sold && w.oldHits ? `${w.oldHits} 笔命中还是旧规则算的，可能含还没卖掉的帐面获利；自动挖掘会重新验算` : "";
      box.append(walletRow({ ...w, stats: {} }, {
        profitCell: h("span", { class: "w-num", title: oldNote },
          h("small", { text: !sold ? "总获利" : w.oldHits ? "含旧规则" : "已实现" }), h("span", { class: "up", text: usd(w.profit, true) })),
        winCell: h("span", { class: "w-num", title: w.tokens.join("、") }, h("small", { text: "命中" }), `${w.hits} 颗`),
        midCell: h("span", { class: "w-num", title: "最早一次在开盘后多久进场；「毕业前」是还在内盘就买了（比 GMGN 的开盘时间早）" }, h("small", { text: "最快进场" }), w.fastestEntry == null ? "—" : entryText(w.fastestEntry)),
        lastCell: h("span", { class: "w-num" }, h("small", { text: "平均报酬" }), w.roi == null ? "—" : `${Math.round(w.roi * 100)}%`),
        note: w.tokens.length ? `赚钱的币：${w.tokens.map((x) => x.trim()).join("、")}` : "",
        lead: w.isNew ? h("span", { class: "tag good", text: "新出现", title: "上一轮挖掘才变成候选的地址" }) : null,
        after: loadMined,
      }));
    }
  } catch (err) {
    box.replaceChildren(h("div", { class: "empty" }, h("strong", { text: "读不到挖掘结果" }), err.message));
  }
}

async function startMine() {
  if (state.mineBlocked) return;
  if (!state.mineSrcOk && state.mineSrc !== "auto") return mineSrcNote();
  const cas = $("mine-cas").value.trim();
  const allOn = state.mineAll && state.mineAllOk;
  const all = allOn && (state.mineSrc === "fomo" || !cas);
  let body = { chain: state.mineChain, source: state.mineSrc, cas, all };
  let pool = null;
  if (state.mineSrc === "fomo") {
    const list = fomoHotFor(state.mineChain);
    pool = all ? state.fomoHot?.tokens || [] : list;
    if (!pool.length) {
      $("mine-note").textContent = state.fomoHot ? `粘贴的 FOMO 热门没有 ${chainName(state.mineChain)} 的币，换一条链或重按书签` : "先照下面三步把 FOMO 热门贴过来";
      return;
    }
    body = { chain: state.mineChain, source: "fomo", all, cas: list.map((t) => t.ca).join(" "), symbols: Object.fromEntries(list.map((t) => [t.ca, t.symbol])),
             ...(all ? { tokens: pool } : {}) };
    const hs = fomoHoldersFor(pool);
    if (hs) body.fomoHolders = hs;
  }
  $("mine-btn").disabled = true;
  try {
    await api("/api/smart/mine", body);
    $("mine-note").textContent = all
      ? `开始了，${mineOrder(pool)} 依序挖。一颗币大约 10 秒，${pool ? `共 ${pool.length} 颗，最多约 ${Math.max(1, Math.round(pool.length / 6))} 分钟` : "每条链最多 30 颗，全部挖完最多约 15 分钟"}；`
        + (body.fomoHolders ? `有 ${Object.keys(body.fomoHolders).length} 颗带 FOMO 持有人，这几颗 24 小时内扫过也会重扫、顺便对名字，其他扫过的跳过。` : "24 小时内扫过的会跳过。")
      : `开始了。${allOn ? `指定几颗币只挖 ${chainName(state.mineChain)}。` : ""}GMGN 额度很紧，一颗币大约 10 秒，30 颗约 5 分钟；不知道总供给量的币会多查一次币信息。`;
    await refresh(true);
  } catch (err) {
    $("mine-note").textContent = err.message;
    $("mine-btn").disabled = false;
  }
}

function renderMineProgress() {
  const m = state.data?.tracker?.mine;
  const wrap = $("mine-progress");
  if (!m || (!m.running && !m.step)) { wrap.hidden = true; $("mine-btn").disabled = !!state.mineBlocked; return; }
  wrap.hidden = false;
  const total = m.total || 0;
  $("mine-bar-fill").style.width = total ? `${Math.round((m.done / total) * 100)}%` : m.running ? "4%" : "100%";
  const multi = m.chains?.length > 1;
  if (multi && !m.running && m.step === "完成") {
    const res = (m.results || []).map((r) => `${chainName(r.chain)} ${r.step === "失败" ? `失败：${r.error}`
      : `候选 ${r.candidates} 个${r.fresh != null ? `（添加 ${r.fresh} 个）` : ""}${r.traps ? `，挡掉 ${r.traps} 颗卖不掉的币` : ""}${r.fomoNamed ? `，对上 FOMO 名字 ${r.fomoNamed} 位` : ""}${r.note ? `，${r.note}` : ""}`}`);
    $("mine-step").textContent = `${m.chains.length} 条链挖完：${res.join("；")}`;
  } else {
    const parts = [`${multi ? `第 ${m.chainNo}/${m.chains.length} 条链 ` : ""}${m.chain ? `${chainName(m.chain)} ` : ""}${m.step}${m.current ? `：${m.current}` : ""}`];
    if (total) parts.push(`${m.done}/${total} 颗`);
    if (m.skipped) parts.push(`跳过 24 小时内扫过的 ${m.skipped} 颗`);
    if (m.recheck) parts.push(`其中 ${m.recheck} 颗是重新验算旧命中`);
    if (m.hits) parts.push(`符合条件 ${m.hits} 笔`);
    if (m.traps?.length) parts.push(`挡掉 ${m.traps.length} 颗卖不掉的币`);
    if (m.fomoNamed) parts.push(`对上 FOMO 名字 ${m.fomoNamed} 位`);
    if (!m.running && m.step === "完成") parts.push(`候选 ${m.candidates} 个${m.fresh != null ? `（这轮添加 ${m.fresh} 个）` : ""}`);
    if (m.note) parts.push(m.note);
    if (m.error) parts.push(`最近的错误：${m.error}`);
    $("mine-step").textContent = parts.join("，");
  }
  $("mine-btn").disabled = !!m.running || !!state.mineBlocked;
  if (m.running && renderMineProgress.chain === state.mineChain && m.chain !== state.mineChain) loadMined();
  renderMineProgress.chain = m.running ? m.chain : null;
  if (!m.running && renderMineProgress.wasRunning) loadMined();
  renderMineProgress.wasRunning = !!m.running;
}

const MINE_SRC_TEXT = { gmgn: "GMGN 排行", pump: "pump.fun 热门", fomo: "FOMO 热门", lib: "钱包库", manual: "指定", recheck: "重新验算" };
const MINE_SRC_OLD = "pump.fun／FOMO 热门要等服务器重启成新版才能挖（现在的服务器不管选什么都只挖 GMGN 排行）";

function mineSrcNote() {
  const note = $("mine-note");
  if (!state.mineSrcOk && state.mineSrc !== "auto") note.textContent = MINE_SRC_OLD;
  else if (note.textContent === MINE_SRC_OLD) note.textContent = "";
}

function fomoHotGrab() {
  (async () => {
    try {
      if (!/(^|\.)fomo\.family$/.test(location.hostname)) return alert("请在 fomo.family 的页面使用");
      const names = ["\u70ed\u95e8", "\u71b1\u9580", "\u6700\u591a\u4eba\u6301\u6709", "\u5df2\u6bd5\u4e1a", "\u5df2\u7562\u696d", "\u5185\u76d8", "\u5167\u76e4", "Hot", "Trending"];
      const tabs = [...document.querySelectorAll("button,[role=tab]")].filter((b) => names.includes(b.textContent.trim()));
      if (!tabs.length) return alert("找不到左边的代币清单：先打开任一颗币的 FOMO 页，左边点「代币 → 热门」再按");
      let panel = tabs[0];
      for (let i = 0; panel && i < 15 && panel.querySelectorAll('a[href*="/tokens/"]').length < 3; i++) panel = panel.parentElement;
      if (!panel) return alert("清单还没加载，等一下再按");
      const on = tabs.find((b) => b.getAttribute("aria-selected") === "true" || b.dataset.state === "active" || b.classList.contains("bg-bg-tertiary-solid"));
      const scroller = [...panel.querySelectorAll("*")].find((x) => x.scrollHeight > x.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(x).overflowY));
      const chainOf = { bnb: "bsc", solana: "sol", robinhood: "robinhood" };
      const seen = new Map();
      const grab = () => {
        for (const a of panel.querySelectorAll('a[href*="/tokens/"]')) {
          const m = (a.getAttribute("href") || "").match(/\/tokens\/(bnb|solana|robinhood)\/([0-9a-zA-Z]{32,44})(?:[/?#]|$)/);
          if (!m) continue;
          const ca = m[1] === "solana" ? m[2] : m[2].toLowerCase();
          if (seen.has(m[1] + ca)) continue;
          const leaf = [...a.querySelectorAll("*")].find((e) => !e.children.length && e.textContent.trim() && !/^[$▲▼+\-]/.test(e.textContent.trim()));
          seen.set(m[1] + ca, { chain: chainOf[m[1]], ca, symbol: (leaf ? leaf.textContent.trim() : "").slice(0, 40) });
        }
      };
      grab();
      if (scroller) {
        const top = scroller.scrollTop;
        for (let y = 0, i = 0; y < scroller.scrollHeight && i < 40; y += Math.max(200, scroller.clientHeight * 0.7), i++) {
          scroller.scrollTop = y;
          await new Promise((r) => setTimeout(r, 200));
          grab();
        }
        scroller.scrollTop = top;
      }
      const tokens = [...seen.values()];
      if (!tokens.length) return alert("清单里没有读到币，等清单加载后再按");
      const tab = on ? on.textContent.trim() : "";
      const n = (c) => tokens.filter((t) => t.chain === c).length;
      const text = JSON.stringify({ kind: "fomo-hot", v: 1, at: Date.now(), tab, tokens });
      const msg = `FOMO「${tab || "代币清单"}」${tokens.length} 颗：BSC ${n("bsc")}、SOL ${n("sol")}、RH ${n("robinhood")}（只有链、CA 和币名）`;
      try {
        await navigator.clipboard.writeText(text);
        alert(`已拷贝 ${msg}。回挖掘页按「从剪贴板粘贴」或 Ctrl+V`);
      } catch {
        prompt(`浏览器不让书签直接拷贝，请按 Ctrl+C 拷贝下面这段（${msg}），回挖掘页按 Ctrl+V`, text);
      }
    } catch (e) { alert("失败：" + e.message); }
  })();
}
const FOMO_HOT_BOOKMARKLET = "javascript:" + encodeURIComponent(`(${fomoHotGrab.toString()})()`);

function parseFomoHot(text) {
  let o;
  try { o = JSON.parse(text); } catch { return null; }
  if (o && o.kind === "wi-fomo") o = o.hot;
  if (!o || o.kind !== "fomo-hot" || !Array.isArray(o.tokens)) return null;
  const ok = { bsc: /^0x[0-9a-f]{40}$/, robinhood: /^0x[0-9a-f]{40}$/, sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ };
  const tokens = o.tokens.filter((t) => t && ok[t.chain]?.test(String(t.ca)))
    .map((t) => ({ chain: t.chain, ca: String(t.ca), symbol: String(t.symbol || "").slice(0, 40) }));
  const holders = {};
  if (o.holders && typeof o.holders === "object") {
    for (const t of tokens) {
      const v = o.holders[`${t.chain}:${t.ca}`];
      if (v && Array.isArray(v.list)) holders[`${t.chain}:${t.ca}`] = { at: Number(v.at) || 0, total: v.total, list: v.list.slice(0, 120) };
    }
  }
  return tokens.length ? { at: Number(o.at) || Date.now(), tab: String(o.tab || "").slice(0, 20), tokens, holders, v: Number(o.v) || 1 } : null;
}

const FOMO_HOLDERS_MAX_AGE = 2 * 3600e3;
function fomoHoldersFor(pool) {
  const hot = state.fomoHot;
  if (!state.mineNamesOk || !hot?.holders || Date.now() - hot.at > FOMO_HOLDERS_MAX_AGE) return null;
  const keys = new Set((pool || []).map((t) => `${t.chain}:${t.ca}`));
  const out = Object.fromEntries(Object.entries(hot.holders).filter(([k]) => keys.has(k)));
  return Object.keys(out).length ? out : null;
}

function fomoProbeOf(text) {
  let o;
  try { o = JSON.parse(text); } catch { return null; }
  return o && o.kind === "wi-fomo" && o.probe && typeof o.probe === "object" && Array.isArray(o.probe.rows) ? o.probe : null;
}

function applyFomoProbe(text) {
  const probe = fomoProbeOf(text);
  if (!probe) return false;
  try { localStorage.setItem("smart-money-fomo-probe", JSON.stringify(probe)); } catch {  }
  const withAddr = probe.rows.filter((r) => r && r.addrs && Object.keys(r.addrs).length).length;
  toast(probe.count ? `已存下 FOMO 排行榜探查：${probe.rows.length} 位、${withAddr} 位带地址（排查用：FOMO 排行榜接口可能改版了）` : "已存下 FOMO 排行榜探查（没读到名单，FOMO 排行榜接口可能改版了）");
  return true;
}


function fomoBoardOf(text) {
  let o;
  try { o = JSON.parse(text); } catch { return null; }
  return o && o.kind === "wi-fomo" && o.board && o.board.kind === "fomo-board" && Array.isArray(o.board.users) ? o.board : null;
}

const FOMO_BOARD_STATUS_TEXT = { new: "新绑", same: "已有", renamed: "改名" };
const FOMO_BOARD_CHAIN = { Solana: "SOL", BSC: "BSC", Robinhood: "RH" };
function fomoBoardBoundText(job) {
  const rows = job.rows || [];
  if (rows.length < (job.bound || 0)) return `绑到 ${job.bound} 个地址`;
  const people = new Set(rows.map((r) => String(r.handle || "").toLowerCase())).size;
  return people === job.bound ? `绑到 ${people} 人` : `绑到 ${people} 人、${job.bound} 个地址`;
}

function renderFomoBoard(job) {
  const box = $("fomo-board-box");
  if (!job || !job.startedAt) { box.hidden = true; return; }
  box.hidden = false;
  const list = (o) => Object.entries(o || {}).map(([k, v]) => `${k} ${v}`).join("、");
  const why = list(job.why);
  const ev = job.evm || {};
  const evmOn = job.withEvm != null;
  const head = `${stamp(job.startedAt)} 粘贴的 FOMO 排行榜 ${job.total} 人（${job.withSol} 人有 SOL 持仓` + (evmOn ? `、${job.withEvm} 人有 BSC／RH 持仓）` : "）");
  const evmText = !evmOn || !job.withEvm ? ""
    : `BSC／RH：${ev.known ? `${ev.known} 人已经有 BSC／RH 名字不再查，` : ""}要比的 ${ev.users || 0} 人，`
      + `用 GMGN 前 100 持有人比数量查了 ${ev.done || 0}/${ev.tokens || 0} 颗币` + (ev.skipped ? `（还有 ${ev.skipped} 颗排在后面没查）` : "")
      + (ev.failed ? `、${ev.failed} 颗查找失败` : "") + (list(job.evmWhy) ? `；没绑的：${list(job.evmWhy)}` : "") + (ev.error ? `；停下：${ev.error}` : "") + "。";
  $("fomo-board-status").textContent = job.running && job.phase === "evm"
    ? `${head}：SOL 绑好 ${job.solBound || 0} 人；BSC／RH 用 GMGN 前 100 持有人比数量中 ${ev.done || 0}/${ev.tokens || 0} 颗币（一颗约 13 秒，跟收集共用 GMGN 额度，这页可以先做别的）…`
    : job.running
    ? `${head}：反查 SOL 持仓地址中 ${job.done}/${job.total}（已问 Solana 节点 ${job.rpc || 0} 次，这页可以先做别的）…`
    : `${head}：${fomoBoardBoundText(job)}（` + (evmOn ? `SOL ${job.solBound || 0}、BSC／RH ${job.evmBound || 0}；` : "")
      + `新绑 ${job.added}、已有 ${job.same}、改名 ${job.renamedCount}；`
      + (job.libAdded != null ? `新加进钱包库 ${job.libAdded} 个、本来就在库里 ${job.inLibrary} 个）。` : `其中 ${job.inLibrary} 个地址在钱包库里）。`)
      + (why ? `SOL 没绑的：${why}。` : "") + (evmOn ? evmText : (job.noSol ? `没有 SOL 持仓的 ${job.noSol} 人这版不绑。` : ""))
      + (job.error ? `中途停下：${job.error}。` : "");
  const rows = job.rows || [];
  const det = $("fomo-board-rows");
  det.hidden = !rows.length;
  if (!rows.length) return;
  det.querySelector("summary").textContent = `绑到的地址 ${rows.length} 个`;
  det.querySelector(".table-wrap").replaceChildren(h("table", {},
    h("thead", {}, h("tr", {}, h("th", { text: "FOMO 名字" }), h("th", { text: "链" }), h("th", { text: "持仓地址" }), h("th", { text: "状态" }), h("th", { text: "钱包库" }))),
    h("tbody", {}, rows.map((r) => h("tr", {},
      h("td", { text: r.handle }),
      h("td", { text: FOMO_BOARD_CHAIN[r.chain || "Solana"] || r.chain }),
      h("td", {}, h("span", { class: "addr", text: r.address })),
      h("td", { text: (FOMO_BOARD_STATUS_TEXT[r.status] || r.status) + (r.old ? `（原本 ${r.old}）` : "") + (r.evidence > 1 ? "・两笔持仓都对上" : "") + (r.how === "range" ? "・数量有浮点误差，用范围对上" : "") }),
      h("td", { text: r.libNew ? "新加入" : r.inLibrary ? "有" : "—" }))))));
}

let fomoBoardTimer = 0;
async function pollFomoBoard() {
  clearTimeout(fomoBoardTimer);
  let r;
  try { r = await api("/api/fomo/board-status"); } catch { return; }
  renderFomoBoard(r.job);
  if (r.job && r.job.running) fomoBoardTimer = setTimeout(pollFomoBoard, 2000);
  else if (r.job && r.job.finishedAt && Date.now() / 1000 - r.job.finishedAt < 5) toast(`FOMO 排行榜绑定完成：${fomoBoardBoundText(r.job)}` + (r.job.withEvm != null ? `（SOL ${r.job.solBound || 0}、BSC／RH ${r.job.evmBound || 0}）` : ""));
}

async function applyFomoBoard(text) {
  const board = fomoBoardOf(text);
  if (!board) return false;
  $("fomo-board-box").hidden = false;
  $("fomo-board-rows").hidden = true;
  $("fomo-board-status").textContent = `已粘贴 FOMO 排行榜 ${board.users.length} 人，送去反查持仓地址…`;
  try {
    const r = await api("/api/fomo/board-import", { board });
    renderFomoBoard(r.job);
    toast(`已粘贴 FOMO 排行榜 ${board.users.length} 人，开始反查持仓地址、绑名字`);
    fomoBoardTimer = setTimeout(pollFomoBoard, 1500);
  } catch (e) {
    const old = /找不到此 API|HTTP 404/.test(e.message);
    $("fomo-board-status").textContent = old ? "这版本机服务还不会绑 FOMO 排行榜：要等本机服务重启成新版，再贴一次就好（剪贴板里的名单先留着）。" : `FOMO 排行榜绑定没开始：${e.message}`;
    toast($("fomo-board-status").textContent);
  }
  return true;
}

function applyFomoHot(text) {
  const probed = applyFomoProbe(text);
  const boarded = !!fomoBoardOf(text);
  if (boarded) applyFomoBoard(text);
  const hot = parseFomoHot(text);
  if (!hot) { if (!probed && !boarded) toast("剪贴板里不是 FOMO 热门清单：到 FOMO 币页左边点「代币 → 热门」，按「热门」书签，再回来粘贴"); return probed || boarded; }
  state.fomoHot = hot;
  try { localStorage.setItem("smart-money-fomo-hot", JSON.stringify(hot)); } catch {  }
  renderFomoHot();
  toast(`已粘贴 FOMO 热门 ${hot.tokens.length} 颗`);
  return true;
}

function fomoHotFor(chain) { return (state.fomoHot?.tokens || []).filter((t) => t.chain === chain); }

function mineOrder(tokens) {
  return [state.mineChain, ...["bsc", "sol", "robinhood"].filter((c) => c !== state.mineChain)]
    .filter((c) => !tokens || tokens.some((t) => t.chain === c)).map(chainName).join(" → ");
}

function renderFomoHot() {
  const box = $("mine-fomo");
  box.hidden = state.mineSrc !== "fomo";
  const hot = state.fomoHot;
  box.classList.toggle("has-list", !!hot);
  if (!hot) { $("fomo-hot-status").textContent = "还没粘贴 FOMO 热门。"; return; }
  const n = (c) => fomoHotFor(c).length;
  const list = fomoHotFor(state.mineChain);
  const hours = (Date.now() - hot.at) / 3600e3;
  const stale = hours >= 3 ? `这份是 ${Math.round(hours)} 小时前的清单，热门可能换了，建议重按书签。` : "";
  const nh = Object.keys(hot.holders || {}).length;
  const who = nh ? (hours * 3600e3 > FOMO_HOLDERS_MAX_AGE ? `持有人名单超过 2 小时，挖的时候不拿来对名字（重按书签再贴就会对）。`
    : state.mineNamesOk ? `其中 ${nh} 颗带 FOMO 持有人，挖的时候顺便对名字。` : `其中 ${nh} 颗带 FOMO 持有人，要等服务器重启成新版才会拿来对名字。`)
    : hot.v >= 2 ? "" : "这份是旧版「热门」书签抓的、没有 FOMO 持有人：把下面的「热门」重新拖到书签列，之后按会顺便抓持有人、挖的时候对名字。";
  const names = list.slice(0, 8).map((t) => t.symbol || `${t.ca.slice(0, 6)}…`).join("、");
  $("fomo-hot-status").textContent = `${stamp(hot.at / 1000)} 粘贴的 FOMO「${hot.tab || "热门"}」${hot.tokens.length} 颗：BSC ${n("bsc")}、SOL ${n("sol")}、RH ${n("robinhood")}。`
    + (state.mineAll && state.mineAllOk ? `按「开始挖掘」会照 ${mineOrder(hot.tokens)} 依序把 ${hot.tokens.length} 颗都挖完，24 小时内扫过的会跳过。`
      : list.length ? `按「开始挖掘」会挖 ${chainName(state.mineChain)} 的 ${list.length} 颗（${names}${list.length > 8 ? " …" : ""}），24 小时内扫过的会跳过。` : `里面没有 ${chainName(state.mineChain)} 的币，换一条链。`)
    + stale + who;
}

const RESULT_TEXT = { win: "胜", loss: "败", flat: "平", nodata: "没数据", "": "进行中" };
const RESULT_CLASS = { win: "r-win", loss: "r-loss", flat: "r-flat", nodata: "r-nodata", "": "r-pending" };
const REVIEW_GROUPS = [["pick", "精选纸上追踪（设定的市值区间＋还拿着的没有机器人）"], ["bots", "还拿着的钱包里有没有机器人"],
  ["strength", "强度"], ["wallets", "信号当下有份量的钱包"], ["mcap", "信号当下市值"], ["chain", "链"], ["source", "怎么记下的"]];

function rate(x) { return x == null ? "—" : `${Math.round(x * 100)}%`; }
function signCls(x) { return x == null ? "" : x > 0 ? "up" : x < 0 ? "down" : ""; }

function wlBar(st) {
  const bar = h("span", { class: "wl-bar", role: "img", "aria-label": `胜 ${st.win}、败 ${st.loss}、平 ${st.flat}` });
  if (st.done) for (const [k, v] of [["w", st.win], ["l", st.loss], ["f", st.flat]]) {
    if (!v) continue;
    const seg = h("span", { class: k });
    seg.style.width = `${(v / st.done) * 100}%`;
    bar.append(seg);
  }
  return bar;
}

function resultChip(x) {
  return h("span", { class: `res ${RESULT_CLASS[x.result] ?? ""}`, text: RESULT_TEXT[x.result] ?? x.result });
}

async function loadReview() {
  state.reviewAt = Date.now();
  try {
    const r = await api("/api/smart/review", { days: state.rvDays, chain: state.chain || null, liveOnly: !state.rvBackfill, rule: state.rvRule || undefined });
    state.review = r;
    renderReview(r);
  } catch (err) {
    $("rv-sched").textContent = /找不到此 API/.test(err.message) ? "覆盘要等服务器重启成新版才会开始记录信号。" : `读不到覆盘：${err.message}`;
    $("rv-run").disabled = true;
    for (const id of ["rv-stats", "rv-groups", "rv-best", "rv-worst", "rv-recent", "rv-history", "rv-sells"]) $(id).replaceChildren();
    $("rv-best-note").textContent = "";
    $("rv-aux").hidden = true;
    $("rv-sells-sec").hidden = true;
  }
}

function multText(m) {
  if (m == null || !Number.isFinite(m)) return "—";
  return `${m >= 10 ? m.toFixed(0) : m >= 2 ? m.toFixed(1) : m.toFixed(2)} 倍`;
}

function ruleLabel(r, id) { return (r.sellRules || []).find((x) => x.id === id)?.label || id; }

function setRule(id) {
  if (id === state.rvRule) return;
  state.rvRule = id;
  $("rv-rule").value = id;
  try { localStorage.setItem("smart-money-rv-rule", id); } catch {  }
  loadReview();
}

function renderReview(r) {
  const multi = Array.isArray(r.sells);
  const hours = r.reviewHours.map((x) => `${String(x).padStart(2, "0")}:00`).join("、");
  const parts = [`每天 ${hours}自动覆盘`, r.lastSlot ? `上次 ${r.lastSlot.slice(5).replace("-", "/")}` : "还没覆盘过", `下次 ${stamp(r.nextReviewAt)}`,
    r.logged ? `已经记了 ${r.logged.toLocaleString()} 笔信号，最早 ${stamp(r.firstAt)}` : "还没有信号纪录"];
  if (!r.logCaughtUp) parts.push("信号纪录还在往回补，补完就会覆盘");
  if (r.oldJudged) parts.push(multi
    ? `这段期间还有 ${r.oldJudged.toLocaleString()} 笔还没有倍数和模拟盈亏（旧版判定，或满 24 小时还没重算的），之后的覆盘会慢慢重算（每次最多 ${r.rejudgeMax} 笔）`
    : `这段期间还有 ${r.oldJudged.toLocaleString()} 笔是旧版用 5 分 K 判定的，之后的覆盘会用 1 分 K 慢慢重算（每次最多 ${r.rejudgeMax} 笔）`);
  $("rv-sched").textContent = `${parts.join("，")}。`;
  const rules = $("rv-rules");
  if (!rules.dataset.ready) { rules.append(h("ul", {}, r.rules.map((x) => h("li", { text: x })))); rules.dataset.ready = "1"; }
  renderReviewProgress(r.review, r.logCaughtUp);

  const o = r.overall;
  const scope = `${r.days ? `近 ${r.days} 天` : "全部"}${r.chain ? ` ${chainName(r.chain)}` : ""}${r.liveOnly ? "、只看实时" : ""}`;
  $("rv-rule-wrap").hidden = !multi;
  $("rv-groups-h").textContent = multi ? "哪种信号比较赚" : "哪种信号比较准";
  $("rv-best-h").textContent = multi ? "模拟盈亏最高的钱包" : "胜率最高的钱包";
  $("rv-worst-h").textContent = multi ? "模拟盈亏最低的钱包" : "胜率最低的钱包";
  renderSells(r);
  if (multi) {
    const sel = $("rv-rule");
    if (!sel.options.length) for (const x of r.sellRules) sel.append(h("option", { value: x.id, text: x.label }));
    sel.value = r.rule;
    state.rvRule = r.rule;
    renderMultiStats(r, scope);
  } else {
    $("rv-aux").hidden = true;
    renderWinStats(r, scope);
  }
  renderReviewGroups(r, multi);
  renderReviewWallets(r, multi);

  const rec = $("rv-recent");
  rec.replaceChildren();
  if (!r.recent.length) rec.append(h("div", { class: "empty" }, h("strong", { text: "这段期间还没有信号" }), "服务器重启成新版后，背景会自动开始记。"));
  else {
    rec.append(h("div", { class: "sig-row rv-row sig-head", "aria-hidden": "true" },
      ...(multi ? ["代币", "强度", "这种卖法", "最高倍数", "当下市值", "钱包", "之后涨跌"] : ["代币", "强度", "结果", "最高涨幅", "当下市值", "钱包", "之后涨跌"])
        .map((text) => h("span", { text }))));
    for (const x of r.recent) rec.append(reviewRow(x, multi ? r.rule : ""));
  }
  renderReviewHistory(r, multi);
}

function renderMultiStats(r, scope) {
  const o = r.overall;
  const n = o.simN;
  const label = ruleLabel(r, r.rule);
  $("rv-stats").replaceChildren(
    h("div", { class: "stat" }, h("span", { text: `每笔平均盈亏（${scope}）` }), h("strong", { class: signCls(o.avgRet), text: pct(o.avgRet) }),
      h("small", { text: n ? `照「${label}」卖，每笔 $100、扣 ${Math.round(r.thresholds.cost * 100)}% 成本；${n} 笔合计 ${usd(o.totalUsd, true)}` : "还没有满 24 小时、算过模拟的信号" })),
    h("div", { class: "stat" }, h("span", { text: "碰到 2 倍的比例" }), h("strong", { text: rate(o.x2Rate) }),
      h("small", { text: n ? `2 倍 ${o.x2} 笔、5 倍 ${o.x5} 笔、10 倍 ${o.x10} 笔；最高 ${multText(o.maxMult)}` : "—" })),
    h("div", { class: "stat" }, h("span", { text: "最高倍数（中位数）" }), h("strong", { text: multText(o.medMult) }),
      h("small", { text: o.medDip == null ? "用 K 线最高价算，含影线" : `涨上去前先跌到 ${multText(o.medDip)}（中位数）；含影线` })),
    h("div", { class: "stat" }, h("span", { text: "最好的 10 笔贡献" }), h("strong", { class: signCls(o.top10Usd), text: n ? usd(o.top10Usd, true) : "—" }),
      h("small", { text: n > 10 ? `其他 ${n - 10} 笔合计 ${usd(o.restUsd, true)}` : n ? `只有 ${n} 笔，还看不出集中度` : "—" })));
  const aux = $("rv-aux");
  aux.hidden = false;
  aux.replaceChildren(h("span", { text: `胜率只当辅助（先碰到 +${Math.round(r.thresholds.up * 100)}% 算胜）：${rate(o.winRate)}` }), wlBar(o),
    h("span", { text: `胜 ${o.win}、败 ${o.loss}、平 ${o.flat}，进行中 ${o.pending}${o.nodata ? `，${o.nodata} 笔查不到 K 线` : ""}；满 24 小时的 ${o.settledN} 笔里 ${n} 笔算过模拟` }));
}

function renderWinStats(r, scope) {
  const o = r.overall;
  $("rv-stats").replaceChildren(
    h("div", { class: "stat" }, h("span", { text: `胜率（${scope}）` }), h("strong", { text: rate(o.winRate) }), wlBar(o),
      h("small", { text: `胜 ${o.win}、败 ${o.loss}、平 ${o.flat}` })),
    h("div", { class: "stat" }, h("span", { text: "有结果的信号" }), h("strong", { text: o.done.toLocaleString() }),
      h("small", { text: `共记 ${o.n.toLocaleString()} 笔${o.nodata ? `，${o.nodata} 笔查不到 K 线` : ""}` })),
    h("div", { class: "stat" }, h("span", { text: "24 小时内最高涨幅（中位数）" }), h("strong", { class: signCls(o.medPeak), text: pct(o.medPeak) }),
      h("small", { text: o.medCh24 == null ? `从信号后第一根 ${r.oldJudged == null ? "5" : "1"} 分 K 开盘价算` : `24 小时后的中位数 ${pct(o.medCh24)}` })),
    h("div", { class: "stat" }, h("span", { text: "进行中" }), h("strong", { text: o.pending.toLocaleString() }),
      h("small", { text: "还在 24 小时内、还没碰到 ±30%" })));
}

function renderSells(r) {
  const sec = $("rv-sells-sec");
  sec.hidden = !r.sells?.length;
  if (sec.hidden) return;
  $("rv-sells-note").textContent = `每笔 $100、扣 ${Math.round(r.thresholds.cost * 100)}% 来回成本；碰到目标用 K 线最高价算（含影线），同一根 K 线同时碰到停损和目标算停损。「跟着聪明钱卖」要有买家的交易纪录（收集没停过），笔数会比别的少。点卖法名称，分组和钱包排行就改用那种卖法。`;
  $("rv-sells").replaceChildren(h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, h("th", { text: "卖法" }), ...["笔数", "每笔平均", "每笔 $100 合计", "赚钱的笔数"].map((text) => h("th", { class: "num", text })))),
    h("tbody", {}, r.sells.map((x) => {
      const on = x.id === r.rule;
      return h("tr", { class: on ? "is-current" : null },
        h("td", {}, h("button", { class: "rule-pick", type: "button", "aria-pressed": String(on), title: on ? "目前用这种卖法" : "改用这种卖法排", onclick: () => setRule(x.id) }, x.label)),
        h("td", { class: "num", "data-label": "笔数", text: String(x.n) }),
        h("td", { class: "num", "data-label": "每笔平均" }, h("span", { class: signCls(x.avgRet), text: pct(x.avgRet) })),
        h("td", { class: "num", "data-label": "每笔 $100 合计" }, h("span", { class: signCls(x.totalUsd), text: x.n ? usd(x.totalUsd, true) : "—" })),
        h("td", { class: "num", "data-label": "赚钱的笔数", text: x.n ? `${x.profitable}（${rate(x.profitable / x.n)}）` : "—" }));
    })))));
}

function renderReviewGroups(r, multi) {
  const gbox = $("rv-groups");
  gbox.replaceChildren();
  for (const [key, title] of REVIEW_GROUPS) {
    const rows = r.groups[key] || [];
    if (!rows.length || (key === "chain" && r.chain) || (key === "source" && r.liveOnly)) continue;
    const head = multi
      ? [h("th", { text: "类别" }), ...["每笔平均盈亏", "碰到 2 倍", "碰到 5 倍", "最高倍数中位数", "胜率（辅助）"].map((text) => h("th", { class: "num", text }))]
      : [h("th", { text: "类别" }), h("th", { text: "胜率" }), h("th", { class: "num", text: "胜／败／平" }), h("th", { class: "num", text: "最高涨幅中位数" }), h("th", { class: "num", text: "进行中" })];
    const row = (g) => multi
      ? h("tr", {},
        h("td", { text: g.label }),
        h("td", { class: "num", "data-label": "每笔平均盈亏", title: g.simN ? `${g.simN} 笔合计 ${usd(g.totalUsd, true)}` : null },
          h("span", { class: signCls(g.avgRet), text: pct(g.avgRet) }), h("small", { class: "sub", text: `${g.simN} 笔` })),
        h("td", { class: "num", "data-label": "碰到 2 倍", text: rate(g.x2Rate) }),
        h("td", { class: "num", "data-label": "碰到 5 倍", text: rate(g.x5Rate) }),
        h("td", { class: "num", "data-label": "最高倍数中位数", text: multText(g.medMult) }),
        h("td", { class: "num aux", "data-label": "胜率（辅助）", text: g.done ? `${rate(g.winRate)}（${g.done}）` : "—" }))
      : h("tr", {},
        h("td", { text: g.label }),
        h("td", { "data-label": "胜率" }, h("span", { class: "wl-cell" }, h("b", { text: rate(g.winRate) }), wlBar(g))),
        h("td", { class: "num", "data-label": "胜／败／平", text: `${g.win}／${g.loss}／${g.flat}` }),
        h("td", { class: "num", "data-label": "最高涨幅中位数" }, h("span", { class: signCls(g.medPeak), text: pct(g.medPeak) })),
        h("td", { class: "num", "data-label": "进行中", text: String(g.pending) }));
    gbox.append(h("div", { class: "rv-group" }, h("h4", { class: "rv-group-h", text: title }),
      h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ...head)), h("tbody", {}, rows.map(row))))));
  }
  if (!gbox.childElementCount) gbox.append(h("div", { class: "empty" }, h("strong", { text: "这段期间还没有信号纪录" }), "背景每 2 分钟记一次，覆盘后这里就会有统计。"));
}

function renderReviewWallets(r, multi) {
  const min = r.thresholds.minSignals;
  if (multi) {
    $("rv-best-note").textContent = r.walletsRanked
      ? `照「${ruleLabel(r, r.rule)}」模拟，每组至少 ${min} 笔满 24 小时的信号才排名，这段期间 ${r.walletsRanked} 组够格。`
        + `排序用「收缩后每笔」：样本越少越往整体平均（${pct(r.overall.avgRet)}）拉，免得两三笔运气好就排第一。`
        + `相关的钱包（同进同出、资金相关）合成一组，同一颗币只算一次${r.walletsMerged ? `，这次合并了 ${r.walletsMerged} 个` : ""}；「相关」只代表行为或资金有关联，不代表是同一个人。`
      : `还没有钱包参与到 ${min} 笔算过模拟的信号（旧纪录要等覆盘慢慢重算）。`;
  } else {
    $("rv-best-note").textContent = r.walletsRanked
      ? `至少 ${min} 笔有结果才排名，这段期间有 ${r.walletsRanked} 个钱包够格。只算信号当下还拿着的钱包，同一个 0x 地址 BSC、RH 合在一起算。`
      : `还没有钱包参与到 ${min} 笔有结果的信号。`;
  }
  for (const [id, list] of [["rv-best", r.best], ["rv-worst", r.worst]]) {
    const box = $(id);
    box.replaceChildren();
    if (!list.length) continue;
    box.append(multi ? walletHeader("收缩后每笔", ["合计盈亏", "2 倍／5 倍", "最高倍数"]) : walletHeader("胜率", ["胜／败／平", "最高涨幅中位数", "最近一次"]));
    for (const w of list) box.append(multi ? reviewMultiWalletRow(w, ruleLabel(r, r.rule)) : reviewWalletRow(w));
  }
}

function renderReviewHistory(r, multi) {
  const hist = $("rv-history");
  hist.replaceChildren();
  if (!r.history.length) { hist.append(h("p", { class: "hint", text: "还没有覆盘纪录。" })); return; }
  const cell = (st) => (st?.done ? `${rate(st.winRate)}（${st.done} 笔）` : "—");
  const dflt = multi ? ruleLabel(r, r.defaultRule) : "";
  hist.append(h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, ...["覆盘时间", "时段", "这次看了", ...(multi ? [`近 7 天每笔盈亏（${dflt}）`, "碰到 2 倍"] : []), "近 7 天胜率", "强", "中", "只看实时"]
      .map((text) => h("th", { text })))),
    h("tbody", {}, r.history.map((x) => {
      const sm = x.summary || {};
      const b = sm.byStrength || {};
      const ov = sm.overall || {};
      return h("tr", {}, h("td", { text: stamp(x.at) }), h("td", { "data-label": "时段", text: x.slot }), h("td", { "data-label": "这次看了", text: `${x.checked} 笔` }),
        ...(multi ? [
          h("td", { "data-label": `每笔盈亏（${dflt}）` }, ov.simN ? h("span", { class: signCls(ov.avgRet), text: `${pct(ov.avgRet)}（${ov.simN} 笔）` }) : "—"),
          h("td", { "data-label": "碰到 2 倍", text: ov.simN ? rate(ov.x2Rate) : "—" })] : []),
        h("td", { "data-label": "近 7 天胜率", text: cell(sm.overall) }),
        ...["strong", "medium"].map((k) => h("td", { "data-label": STRENGTH_LONG[k], text: cell(b[k]) })),
        h("td", { "data-label": "只看实时", text: cell(sm.live) }));
    })))));
}

function reviewMultiWalletRow(w, label) {
  const chips = h("div", { class: "tok-chips" }, w.tokens.map((t) => {
    const cls = t.ret == null ? RESULT_CLASS[t.result] ?? "" : t.ret > 0 ? "r-win" : t.ret < 0 ? "r-loss" : "";
    return h("span", {
      class: `tok-chip ${cls}`,
      title: `${t.symbol || t.ca}：${t.mult == null ? "还没算倍数" : `最高 ${multText(t.mult)}，照「${label}」${pct(t.ret)}`}（胜负：${RESULT_TEXT[t.result] ?? t.result}）`,
      text: `${t.symbol || t.ca.slice(0, 6)}${t.mult == null ? "" : ` ${multText(t.mult)}`}`,
    });
  }));
  const stop = (e) => e.stopPropagation();
  const rel = w.members?.length ? h("details", { class: "rv-rel", onclick: stop, onkeydown: stop },
    h("summary", { text: `相关钱包 ${w.members.length} 个（${(w.relatedWhy || []).join("、") || "相关"}），信号合在一起算` }),
    h("ul", {}, w.members.map((m) => h("li", {},
      h("button", { class: "rel-addr", type: "button", title: "打开这个钱包", onclick: () => openWallet(m.chain, m.address) }, m.address),
      h("small", { text: ` ${chainName(m.chain)}，${m.signals} 笔信号` }))))) : null;
  return walletRow({ ...w, stats: {} }, {
    profitCell: h("span", { class: "w-num", title: `原始每笔 ${pct(w.avgRet)}（${w.simN} 笔）` }, h("small", { text: "收缩后每笔" }), h("span", { class: signCls(w.shrunk), text: pct(w.shrunk) })),
    winCell: h("span", { class: "w-num" }, h("small", { text: "合计" }), h("span", { class: signCls(w.totalUsd), text: usd(w.totalUsd, true) })),
    midCell: h("span", { class: "w-num" }, h("small", { text: "2 倍／5 倍" }), `${w.x2}／${w.x5}`),
    lastCell: h("span", { class: "w-num", title: w.bestSymbol || "" }, h("small", { text: "最高" }), multText(w.bestMult)),
    lead: w.chains.length > 1 ? h("span", { class: "tag neutral", text: "BSC、RH 合并", title: "同一个 0x 地址在两条链的信号合在一起算" }) : null,
    note: `${w.simN} 笔算过模拟，原始每笔 ${pct(w.avgRet)}${w.bestSymbol ? `，最高那颗是 ${w.bestSymbol}` : ""}；胜率 ${rate(w.winRate)}（辅助）；最近 ${ago(w.lastAt)}`,
    extra: h("div", {}, chips, rel),
    after: loadReview,
  });
}

function reviewWalletRow(w) {
  const chips = h("div", { class: "tok-chips" }, w.tokens.map((t) => h("span", {
    class: `tok-chip ${RESULT_CLASS[t.result] ?? ""}`, title: `${t.symbol || t.ca}：${RESULT_TEXT[t.result] ?? t.result}`, text: t.symbol || t.ca.slice(0, 6) })));
  return walletRow({ ...w, stats: {} }, {
    profitCell: h("span", { class: "w-num" }, h("small", { text: "胜率" }), h("span", { class: w.winRate >= 0.5 ? "up" : "", text: rate(w.winRate) })),
    winCell: h("span", { class: "w-num" }, h("small", { text: "胜／败／平" }), `${w.win}／${w.loss}／${w.flat}`),
    midCell: h("span", { class: "w-num" }, h("small", { text: "最高涨幅中位数" }), h("span", { class: signCls(w.medPeak), text: pct(w.medPeak) })),
    lastCell: h("span", { class: "w-num", title: stamp(w.lastAt) }, h("small", { text: "最近" }), ago(w.lastAt)),
    lead: w.chains.length > 1 ? h("span", { class: "tag neutral", text: "BSC、RH 合并", title: "同一个 0x 地址在两条链的信号合在一起算" }) : null,
    extra: chips,
    after: loadReview,
  });
}

function reviewRow(x, rule) {
  const open = () => openReviewSignal(x);
  const row = h("div", {
    class: "sig-row rv-row", role: "button", tabindex: "0", "aria-label": `${x.symbol} ${STRENGTH_LONG[x.strength]}，${RESULT_TEXT[x.result] ?? x.result}`,
    onclick: open, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } },
  });
  const backfill = x.source === "backfill" ? h("span", { class: "tag backfill", text: "回补", title: "服务器没在跑的时段，用交易纪录和现在的评分重算" }) : null;
  row.append(
    h("div", { class: "c-tok sig-tok" }, logoNode(x.logo, x.symbol),
      h("div", { class: "sym-line" }, h("span", { class: "sym", text: x.symbol || x.ca.slice(0, 6), title: x.symbol }),
        state.chain ? null : h("span", { class: "chain-tag", text: chainName(x.chain) }), backfill),
      h("div", { class: "when" }, h("span", { text: stamp(x.at) }), x.launchpad ? h("span", { class: "pad", text: x.launchpad }) : null)),
    h("div", { class: "c-str" }, h("span", { class: `strength s-${x.strength}`, text: STRENGTH_TEXT[x.strength] })),
    rule ? simCell(x, rule) : h("div", { class: "c-res cell-num" }, h("small", { class: "k", text: "结果" }), resultChip(x),
      h("small", { text: x.resultAt ? `${dur(x.resultAt - x.at)}后` : x.result === "" ? (x.checkedAt ? `${ago(x.checkedAt)}看过` : "还没看") : "" })),
    rule ? h("div", { class: "c-peak cell-num" }, h("small", { class: "k", text: "最高倍数" }),
      h("span", { class: x.peak >= 1 ? "up" : "", text: x.peak == null ? "—" : multText(1 + x.peak) }),
      h("small", { text: x.dip != null ? `先跌到 ${multText(1 + x.dip)}` : x.trough == null ? "" : `最低 ${pct(x.trough)}` }))
      : h("div", { class: "c-peak cell-num" }, h("small", { class: "k", text: "最高涨幅" }), h("span", { class: signCls(x.peak), text: pct(x.peak) }),
        h("small", { text: x.trough == null ? "" : `最低 ${pct(x.trough)}` })),
    h("div", { class: "c-mcap cell-num" }, h("small", { class: "k", text: "当下市值" }), h("span", { text: usd(x.mcap) }), h("small", {}, "起点 ", priceNode(x.price))),
    h("div", { class: "c-wal cell-num" }, h("small", { class: "k", text: "钱包" }), h("span", { text: String(x.wallets) }), h("small", { text: `有份量 ${x.strongWallets}` })),
    h("div", { class: "c-chs rv-chs" }, ...[["1 时", x.ch1h], ["4 时", x.ch4h], ["24 时", x.ch24h]].map(([k, v]) =>
      h("span", {}, h("small", { text: `${k} ` }), h("span", { class: signCls(v), text: pct(v) })))));
  return row;
}

function simCell(x, rule) {
  const ret = x.sims?.[rule];
  const why = ret != null ? `胜负：${RESULT_TEXT[x.result] ?? x.result}` : !x.settled ? "未满 24 小时" : x.result === "nodata" ? "没数据" : "还没重算";
  return h("div", { class: "c-res cell-num" }, h("small", { class: "k", text: "这种卖法" }),
    h("span", { class: signCls(ret), text: ret == null ? "—" : pct(ret) }), h("small", { text: why }));
}

function simSection(x) {
  const r = state.review;
  if (!r?.sellRules) return null;
  const why = !x.settled ? "还没满 24 小时，满了才模拟。" : x.result === "nodata" ? "查不到 K 线，没办法模拟。"
    : "还没用新算法重算（覆盘会慢慢补），或重算时 GMGN 一直出错。";
  return h("section", { class: "d-section" }, h("h3", { text: `各种卖法的模拟盈亏（每笔 $100、扣 ${Math.round(r.thresholds.cost * 100)}% 成本）` }),
    x.sims ? h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", { text: "卖法" }), h("th", { class: "num", text: "盈亏" }), h("th", { class: "num", text: "$100 变成" }))),
      h("tbody", {}, r.sellRules.map((s) => {
        const v = x.sims[s.id];
        return h("tr", { class: s.id === r.rule ? "is-current" : null }, h("td", { text: s.label }),
          h("td", { class: "num", "data-label": "盈亏" }, h("span", { class: signCls(v), text: pct(v) })),
          h("td", { class: "num", "data-label": "$100 变成", text: v == null ? "—" : usd(100 * (1 + v)) }));
      })))) : h("p", { class: "hint", text: why }));
}

function openReviewSignal(x) {
  state.drawer = { type: "review", id: x.id };
  const body = openDrawer("信号覆盘");
  const multi = !!state.review?.sellRules;
  const list = h("div", { class: "list" });
  for (const b of x.buyers) {
    const go = () => openWallet(x.chain, b.address);
    list.append(h("div", { class: "list-row clickable", role: "button", tabindex: "0", onclick: go, onkeydown: (e) => { if (e.key === "Enter") go(); } },
      h("div", { class: "l1" }, gradeBadge(b.grade), b.kind && KIND_TAG[b.kind] ? h("span", { class: `tag ${KIND_TAG[b.kind]}`, text: b.kind === "ally" ? "我标的" : b.kind === "insider" ? "内幕／庄" : "风险" }) : null,
        b.exited ? h("span", { class: "tag neutral", text: "当下已出场" }) : null),
      h("div", { class: "r" }, h("small", { text: b.weight == null ? "" : `份量 ${b.weight}` })),
      h("span", { class: "addr", text: b.address })));
  }
  body.replaceChildren(
    h("div", { class: "d-hero" }, logoNode(x.logo, x.symbol, "lg"),
      h("div", {},
        h("div", { class: "sym-line" }, h("span", { class: "sym", text: x.symbol || "未知代币" }), h("span", { class: "chain-tag", text: chainName(x.chain) }),
          h("span", { class: `strength s-${x.strength}`, text: STRENGTH_LONG[x.strength] }),
          x.source === "backfill" ? h("span", { class: "tag backfill", text: "回补" }) : null),
        h("div", { class: "d-addr" }, h("span", { class: "addr", text: x.ca }), copyBtn(x.ca)))),
    h("div", { class: "d-links" },
      h("a", { href: gmgnToken(x.chain, x.ca), target: "_blank", rel: "noopener noreferrer", text: "GMGN" }),
      dexToken(x.chain, x.ca) ? h("a", { href: dexToken(x.chain, x.ca), target: "_blank", rel: "noopener noreferrer", text: "DexScreener" }) : null,
      h("a", { href: analyzeLink(x.ca), target: "_blank", rel: "noopener", text: "查这个地址" })),
    h("dl", { class: "stat-grid" },
      multi ? stat("最高倍数", h("span", { class: x.peak >= 1 ? "up" : "", text: x.peak == null ? "—" : multText(1 + x.peak) }), "24 小时内 K 线最高价，含影线") : null,
      multi ? stat("涨上去前先跌到", x.dip == null ? "—" : multText(1 + x.dip), "最高价那根之前的最低") : null,
      stat(multi ? "胜负（辅助）" : "结果", resultChip(x), x.resultAt ? `${dur(x.resultAt - x.at)}后碰到 ${x.result === "win" ? "+30%" : "−30%"}` : x.result === "" ? "还在 24 小时内" : ""),
      stat("信号时间", stamp(x.at)),
      stat("起点价", priceNode(x.price), basisText(x)),
      multi ? null : stat("最高涨幅", h("span", { class: signCls(x.peak), text: pct(x.peak) })),
      stat("最低", h("span", { class: signCls(x.trough), text: pct(x.trough) })),
      stat("当下市值", usd(x.mcap)),
      stat("1 小时后", h("span", { class: signCls(x.ch1h), text: pct(x.ch1h) })),
      stat("4 小时后", h("span", { class: signCls(x.ch4h), text: pct(x.ch4h) })),
      stat("24 小时后", h("span", { class: signCls(x.ch24h), text: pct(x.ch24h) }))),
    x.note ? h("p", { class: "hint", text: x.note }) : "",
    (multi && simSection(x)) || "",
    h("section", { class: "d-section" }, h("h3", { text: `信号当下的钱包（${x.wallets} 个，有份量的 ${x.strongWallets} 个）` }),
      x.buyers.length ? list : h("p", { class: "hint", text: "没有存到钱包明细。" })),
  );
}

function basisText(x) {
  if (x.checkedAt == null) return "还没覆盘，先显示记下的聪明钱成交价";
  if (x.judgedWith === "1m") return "信号后第一根 1 分 K 开盘";
  if (x.judgedWith === "5m") return "信号后第一根 5 分 K 开盘（抓不到 1 分 K）";
  return x.judgedWith === "" ? "信号后第一根 5 分 K 开盘（旧判定，之后会用 1 分 K 重算）" : "信号后第一根 5 分 K 开盘";
}

function renderReviewProgress(rv, caughtUp) {
  const wrap = $("rv-progress");
  const caught = caughtUp ?? state.data?.tracker?.logCaughtUp ?? state.review?.logCaughtUp;
  if (!rv || (!rv.running && !rv.step)) { wrap.hidden = true; $("rv-run").disabled = !caught; return; }
  wrap.hidden = false;
  const total = rv.total || 0;
  $("rv-bar-fill").style.width = total ? `${Math.round((rv.done / total) * 100)}%` : rv.running ? "4%" : "100%";
  const parts = [`${rv.manual ? "手动覆盘" : `${rv.slot} 覆盘`}：${rv.step}${rv.current ? `（${rv.current}）` : ""}`];
  if (total) parts.push(`${rv.done}/${total} 笔`);
  if (rv.decided) parts.push(`这次有结果的 ${rv.decided} 笔`);
  if (rv.rejudge) parts.push(state.review?.sells ? `其中 ${rv.rejudge} 笔是重算旧纪录（补倍数和模拟盈亏）` : `其中 ${rv.rejudge} 笔是用 1 分 K 重算旧判定`);
  if (rv.running && total > rv.done) parts.push(`GMGN 额度留给实时收集，慢慢抓，大约还要 ${dur((total - rv.done) * (rv.perItem || 20))}`);
  if (rv.error) parts.push(`最近的错误：${rv.error}`);
  $("rv-step").textContent = parts.join("，");
  $("rv-run").disabled = !!rv.running || !caught;
  if (!rv.running && renderReviewProgress.wasRunning) loadReview();
  renderReviewProgress.wasRunning = !!rv.running;
}

async function runReview() {
  $("rv-run").disabled = true;
  try {
    await api("/api/smart/review-run", {});
    toast("开始覆盘：会慢慢抓 K 线，额度先留给实时收集");
    await refresh(true);
  } catch (err) {
    toast(err.message);
    $("rv-run").disabled = false;
  }
}

function openDrawer(title) {
  const body = window.Shell.drawer.open(title);
  window.Shell.drawer.onClose = () => { state.drawer = null; };
  body.replaceChildren(h("div", { "aria-hidden": "true" },
    h("span", { class: "skel h28 w60" }), h("span", { class: "skel w80" }), h("span", { class: "skel" }), h("span", { class: "skel w40" })));
  return body;
}

function closeDrawer() {
  window.Shell.drawer.close();
}

const KLINE_RES = [["auto", "自动"], ["5m", "5 分"], ["15m", "15 分"], ["1h", "1 时"]];
const RES_TEXT = { "5m": "5 分 K", "15m": "15 分 K", "1h": "1 小时 K" };
const SUB_DIGITS = "₀₁₂₃₄₅₆₇₈₉";
const hmFmt = new Intl.DateTimeFormat("zh-CN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const mdFmt = new Intl.DateTimeFormat("zh-CN", { timeZone: TZ, month: "2-digit", day: "2-digit" });

function priceText(p) {
  if (!(p > 0)) return "—";
  if (p >= 1) return `$${p.toLocaleString("en-US", { maximumFractionDigits: p >= 100 ? 2 : 4 })}`;
  const [m, e] = p.toExponential(3).split("e");
  const zeros = -Number(e) - 1;
  const digits = m.replace(".", "").replace(/0+$/, "").slice(0, 4) || "0";
  if (zeros >= 4) return `$0.0${[...String(zeros)].map((d) => SUB_DIGITS[d]).join("")}${digits}`;
  return `$${p.toFixed(zeros + 4).replace(/0+$/, "")}`;
}

function priceChart(chain, ca, timeline, current, entry) {
  const pts = timeline.filter((t) => t.price > 0);
  if (!pts.length) return null;
  if (!(entry > 0)) {
    const buys = pts.filter((p) => p.side === "buy" && p.usd > 0);
    const den = buys.reduce((a, p) => a + p.usd / p.price, 0);
    entry = den ? buys.reduce((a, p) => a + p.usd, 0) / den : 0;
  }
  const st = { res: "auto", data: null, cache: new Map(), loading: true, error: "" };
  const src = h("span", { class: "kc-src", text: "读 GMGN K 线…" });
  const seg = h("div", { class: "seg seg-small", role: "group", "aria-label": "K 线周期" });
  for (const [res, text] of KLINE_RES) seg.append(h("button", { type: "button", "data-res": res, "aria-pressed": String(res === "auto"), text, onclick: () => load(res) }));
  const box = h("div", { class: "chart kc-box" });
  const tip = h("div", { class: "kc-tip", hidden: true });
  const legend = h("div", { class: "chart-legend" });
  const note = h("p", { class: "hint kc-note", hidden: true });
  const wrap = h("div", { class: "kchart" }, h("div", { class: "kc-bar" }, src, seg), h("div", { class: "kc-stage" }, box, tip), legend, note);

  function paintBar() {
    for (const b of seg.children) b.setAttribute("aria-pressed", String(b.dataset.res === st.res));
    const d = st.data;
    if (st.loading) src.textContent = "读 GMGN K 线…";
    else if (st.error) src.textContent = `K 线读不到：${st.error}。先只画成交点`;
    else if (d) src.textContent = `GMGN ${RES_TEXT[d.resolution] || d.resolution}${st.res === "auto" ? "（自动选）" : ""}${d.cached ? "，1 分钟内抓过" : ""}`;
  }

  async function load(res) {
    st.res = res;
    const hit = st.cache.get(res);
    if (hit) { st.data = hit; st.error = ""; st.loading = false; paintBar(); draw(); return; }
    st.loading = true;
    paintBar();
    try {
      const r = await api("/api/smart/kline", { chain, ca, resolution: res, since: pts[0].ts });
      st.cache.set(res, r);
      if (res === "auto" && !st.cache.has(r.resolution)) st.cache.set(r.resolution, { ...r, auto: false });
      if (st.res !== res) return;
      st.data = r;
      st.error = "";
    } catch (err) {
      if (st.res !== res) return;
      st.error = err.message === "找不到此 API" ? "服务器还是旧版，重启后才有" : err.message;
      if (st.data && st.data.resolution !== res && res !== "auto") st.data = null;
    } finally {
      if (st.res === res) { st.loading = false; paintBar(); draw(); }
    }
  }

  function draw() {
    const W = box.clientWidth, H = box.clientHeight;
    if (!W || !H) return;
    const d = st.data && !st.error ? st.data : null;
    let t0, t1;
    if (d) {
      const anchor = pts.find((p) => p.ts >= d.from)?.ts ?? d.candles[0]?.[0];
      t1 = d.end;
      t0 = anchor != null ? Math.max(d.from, Math.min(anchor - 6 * d.step, t1 - 12 * d.step)) : d.from;
    } else {
      const a = pts[0].ts, b = Math.max(pts[pts.length - 1].ts, nowSec());
      const pad = Math.max(300, (b - a) * 0.04);
      t0 = a - pad; t1 = b + pad;
    }
    const candles = d ? d.candles.filter((c) => c[0] + d.step > t0) : [];
    const padL = 6, padR = 70, padT = 10, axisH = 20, volH = candles.length ? 38 : 0, gap = candles.length ? 8 : 0;
    const pBot = H - axisH - volH - gap, vBot = H - axisH;
    const plotR = W - padR;
    const x = (ts) => padL + ((ts - t0) / (t1 - t0)) * (plotR - padL);
    const shown = pts.filter((p) => p.ts >= t0 && p.ts <= t1);
    const vals = [...shown.map((p) => p.price), ...candles.flatMap((c) => [c[2], c[3]])];
    if (current > 0) vals.push(current);
    if (entry > 0) vals.push(entry);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const log = hi / lo > 3;
    const f = log ? Math.log10 : (v) => v, inv = log ? (v) => 10 ** v : (v) => v;
    let L = f(lo), U = f(hi);
    const span = U - L || Math.abs(U) * 0.04 || 1;
    L -= span * 0.06; U += span * 0.06;
    const y = (p) => pBot - ((f(p) - L) / (U - L)) * (pBot - padT);

    const svg = s("svg", { role: "img", "aria-label": `${d ? `${RES_TEXT[d.resolution]}，` : ""}聪明钱 ${shown.length} 笔买卖叠在价格上` });
    const tags = [];
    if (current > 0) tags.push({ v: current, cls: "kc-tag-now", line: "kc-now" });
    if (entry > 0) tags.push({ v: entry, cls: "kc-tag-entry", line: "kc-entry" });
    for (const t of tags) t.y = y(t.v);
    tags.sort((a, b) => a.y - b.y);
    for (let i = 1; i < tags.length; i++) {
      const prev = tags[i - 1].ty ?? tags[i - 1].y;
      if (tags[i].y - prev < 18) tags[i].ty = prev + 18;
    }
    for (let i = 0; i <= 4; i++) {
      const v = inv(L + ((U - L) * (i + 0.5)) / 5), yy = y(v);
      svg.append(s("line", { class: "grid-line", x1: padL, x2: plotR, y1: yy, y2: yy }));
      if (tags.every((t) => Math.abs((t.ty ?? t.y) - yy) > 14)) {
        const tx = s("text", { class: "kc-axis", x: plotR + 6, y: yy + 4 });
        tx.textContent = priceText(v);
        svg.append(tx);
      }
    }
    const STEPS = [300, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400];
    const every = STEPS.find((v) => (v / (t1 - t0)) * (plotR - padL) >= 70) || 86400;
    const multiDay = t1 - t0 > 86400;
    for (let ts = Math.ceil((t0 + TZ_SHIFT) / every) * every - TZ_SHIFT; ts <= t1; ts += every) {
      const xx = x(ts);
      if (xx < padL + 16 || xx > plotR - 16) continue;
      svg.append(s("line", { class: "kc-tick", x1: xx, x2: xx, y1: padT, y2: vBot }));
      const tx = s("text", { class: "kc-axis", x: xx, y: H - 5, "text-anchor": "middle" });
      const dt = new Date(ts * 1000);
      tx.textContent = multiDay && (ts + TZ_SHIFT) % 86400 === 0 ? mdFmt.format(dt) : hmFmt.format(dt);
      svg.append(tx);
    }
    if (candles.length) {
      const g = s("g", { class: "kc-candles" }), vg = s("g", { class: "kc-vol" });
      const bw = Math.max(1, (x(t0 + d.step) - x(t0)) * 0.64);
      const vmax = Math.max(...candles.map((c) => c[5])) || 1;
      for (const [ts, o, hh, ll, c, v] of candles) {
        const cx = x(ts + d.step / 2), cls = c >= o ? "k-up" : "k-down";
        g.append(s("line", { class: `kc-wick ${cls}`, x1: cx, x2: cx, y1: y(hh), y2: y(ll) }));
        const top = Math.min(y(o), y(c));
        g.append(s("rect", { class: cls, x: cx - bw / 2, y: top, width: bw, height: Math.max(1, Math.abs(y(o) - y(c))) }));
        const vh = Math.max(v > 0 ? 1 : 0, (v / vmax) * volH);
        if (vh) vg.append(s("rect", { class: cls, x: cx - bw / 2, y: vBot - vh, width: bw, height: vh }));
      }
      svg.append(vg, g);
    }
    for (const t of tags) {
      svg.append(s("line", { class: t.line, x1: padL, x2: plotR, y1: t.y, y2: t.y }));
      const ty = t.ty ?? t.y, g = s("g", { class: t.cls });
      g.append(s("rect", { x: plotR + 2, y: ty - 8, width: padR - 4, height: 16, rx: 3 }));
      const tx = s("text", { x: plotR + 6, y: ty + 4 });
      tx.textContent = priceText(t.v);
      g.append(tx);
      svg.append(g);
    }
    for (const p of [...shown].sort((a, b) => b.usd - a.usd)) {
      const r = 4 + 6 * Math.sqrt(Math.min(p.usd, 20000) / 20000), cx = x(p.ts), cy = y(p.price);
      const g = s("g", { class: "kc-dot" });
      g.append(s("circle", { class: p.side === "buy" ? "kc-buy" : "kc-sell", cx, cy, r: r.toFixed(1) }), s("circle", { class: "hit", cx, cy, r: (r + 5).toFixed(1) }));
      g.addEventListener("mouseenter", () => showTip(p, cx, cy, r));
      g.addEventListener("mouseleave", () => { tip.hidden = true; });
      g.addEventListener("click", () => openWallet(chain, p.maker));
      svg.append(g);
    }
    box.replaceChildren(svg);

    legend.replaceChildren(
      h("span", {}, h("i", { class: "lg-dot buy" }), "聪明钱买进"), h("span", {}, h("i", { class: "lg-dot sell" }), "卖出（圆越大金额越大，点了看钱包）"),
      current > 0 ? h("span", {}, h("i", { class: "lg-line now" }), "现价") : null,
      entry > 0 ? h("span", {}, h("i", { class: "lg-line entry" }), "他们的买进均价") : null,
      log ? h("span", { text: "价格轴是对数刻度" }) : null);
    const hidden = pts.length - shown.length;
    note.hidden = !hidden;
    note.textContent = hidden ? `较早的 ${hidden} 笔不在这段 K 线里，切到「自动」或「1 时」看得到。` : "";
  }

  function showTip(p, cx, cy, r) {
    tip.replaceChildren(
      h("div", { class: "kc-tip-h" }, h("span", { class: p.side === "buy" ? "buy" : "sell", text: `${p.side === "buy" ? "买进" : "卖出"} ${usd(p.usd)}` }), h("small", { text: stamp(p.ts) })),
      h("div", {}, gradeBadge(p.grade), " ", p.label || "没有名字的钱包"),
      h("div", {}, "成交价 ", priceNode(p.price)),
      h("span", { class: "addr", text: p.maker }));
    tip.hidden = false;
    const W = box.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
    const left = cx + r + 10 + tw > W ? cx - r - 10 - tw : cx + r + 10;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${Math.min(Math.max(0, cy - th / 2), box.clientHeight - th)}px`;
  }

  const ro = new ResizeObserver(() => { if (!box.isConnected && st.drawn) { ro.disconnect(); return; } st.drawn = true; draw(); });
  ro.observe(box);
  load("auto");
  return wrap;
}

async function openToken(chain, ca, sig) {
  state.drawer = { type: "token", chain, ca };
  openDrawer("代币明细");
  try {
    const r = await api("/api/smart/token", { chain, ca });
    if (state.drawer?.ca !== ca) return;
    const tok = r.token || {};
    const body = $("drawer-body");
    const buyers = r.wallets.filter((w) => w.buy > 0);
    const sumBuy = r.wallets.reduce((a, w) => a + w.buy, 0);
    const sumSell = r.wallets.reduce((a, w) => a + w.sell, 0);
    body.replaceChildren(
      h("div", { class: "d-hero" }, logoNode(tok.logo, tok.symbol, "lg"),
        h("div", {},
          h("div", { class: "sym-line" }, h("span", { class: "sym", text: tok.symbol || "未知代币" }), h("span", { class: "chain-tag", text: chainName(chain) }), tok.launchpad ? h("span", { class: "pad", text: tok.launchpad }) : null),
          h("div", { class: "d-addr" }, h("span", { class: "addr", text: ca }), copyBtn(ca)))),
      h("div", { class: "d-links" },
        h("a", { href: gmgnToken(chain, ca), target: "_blank", rel: "noopener noreferrer", text: "GMGN" }),
        dexToken(chain, ca) ? h("a", { href: dexToken(chain, ca), target: "_blank", rel: "noopener noreferrer", text: "DexScreener" }) : null,
        h("a", { href: analyzeLink(ca), target: "_blank", rel: "noopener", text: "查这个地址" })),
      h("dl", { class: "stat-grid" },
        stat("现价", priceNode(tok.price), sig?.entryPrice ? h("small", {}, "他们的均价 ", priceNode(sig.entryPrice)) : null),
        stat("市值", usd(tok.mcap)),
        stat("流动性", usd(tok.liquidity)),
        stat("买过的钱包", `${buyers.length} 个`),
        stat("他们买进", h("span", { class: "buy", text: usd(sumBuy) })),
        stat("他们卖出", h("span", { class: "sell", text: usd(sumSell) }))),
      tok.price_at ? h("p", { class: "hint", text: `价格来自 ${tok.price_src || "DexScreener"}，${ago(tok.price_at)}更新。只算这个工具收集到的聪明钱、KOL 和你的名单，不是全部买家。` }) : h("p", { class: "hint", text: "只算这个工具收集到的聪明钱、KOL 和你的名单，不是全部买家。" }),
    );
    if (sig?.flags?.length) body.append(h("div", { class: "flags" }, sig.flags.map((f) => h("span", { class: `flag ${f.level}`, text: f.text }))));
    const chart = priceChart(chain, ca, r.timeline, tok.price, sig?.entryPrice);
    if (chart) body.append(h("section", { class: "d-section" }, h("h3", { text: "他们在什么价位买卖" }), chart));
    const list = h("div", { class: "list" });
    for (const w of r.wallets) {
      list.append(h("div", { class: "list-row clickable", role: "button", tabindex: "0", onclick: () => openWallet(chain, w.address), onkeydown: (e) => { if (e.key === "Enter") openWallet(chain, w.address); } },
        h("div", { class: "l1" }, gradeBadge(w.grade), walletTitle(w) ? h("strong", { text: walletTitle(w) }) : null, ...walletTags(w)),
        h("div", { class: "r" }, h("span", { class: "buy", text: w.buy > 0 ? `买 ${usd(w.buy)}` : "" }), w.buy > 0 && w.sell > 0 ? " ／ " : "", h("span", { class: "sell", text: w.sell > 0 ? `卖 ${usd(w.sell)}` : "" }), h("small", { text: `${clock(w.first)} 首次，共 ${w.trades} 笔` })),
        h("span", { class: "addr", text: w.address })));
    }
    body.append(h("section", { class: "d-section" }, h("h3", { text: "谁在交易（依份量排序）" }), r.wallets.length ? list : h("p", { class: "hint", text: "还没有纪录。" })));
  } catch (err) {
    $("drawer-body").replaceChildren(h("div", { class: "empty" }, h("strong", { text: "读不到这颗币" }), err.message));
  }
}

function stat(label, value, sub) {
  return h("div", { class: "stat" }, h("dt", { text: label }), h("dd", {}, value), sub ? h("dd", { class: "stat-sub" }, sub) : null);
}

async function openWallet(chain, address, rescore) {
  state.drawer = { type: "wallet", chain, address };
  if (!rescore) openDrawer("钱包明细");
  try {
    const r = await api("/api/smart/wallet", { chain, address, rescore: !!rescore });
    if (state.drawer?.address !== address) return;
    renderWallet(r, chain, address);
  } catch (err) {
    $("drawer-body").replaceChildren(h("div", { class: "empty" }, h("strong", { text: "读不到这个钱包" }), err.message));
  }
}

function renderWallet(r, chain, address) {
  const w = r.wallet;
  const st = w.stats || {};
  const pnl = w.pnl30 ?? st.realized;
  const pnlNewer = w.pnl30At && w.scoredAt && w.pnl30At > w.scoredAt + 60;
  const body = $("drawer-body");
  const title = walletTitle(w);
  body.replaceChildren(
    h("div", { class: "d-hero" }, gradeBadge(w.grade, true),
      h("div", {},
        h("div", { class: "sym-line" }, h("span", { class: "sym", text: title || (w.grade ? `${GRADE_TEXT[w.grade]}钱包` : "未评分钱包") }), h("span", { class: "chain-tag", text: chainName(chain) }), ...walletTags(w)),
        h("div", { class: "d-addr" }, h("span", { class: "addr", text: address }), copyBtn(address)))),
    h("div", { class: "d-links" },
      h("a", { href: gmgnWallet(chain, address), target: "_blank", rel: "noopener noreferrer", text: "GMGN" }),
      h("a", { href: analyzeLink(address), target: "_blank", rel: "noopener", text: "查这个地址" })),
  );
  if (w.label) body.append(h("p", { class: "hint", text: `你的私人标签：${w.label}` }));

  const sec = h("section", { class: "d-section" }, h("h3", { text: "自建评分" }));
  if (w.score == null) {
    sec.append(h("p", { class: "hint", text: w.scoredAt ? "GMGN 没有回这个钱包的 30 天数据。" : "还没评分，已排进背景队列。也可以现在评。" }));
  } else {
    sec.append(h("div", { class: "score-total" }, h("span", { class: "num", text: String(w.score) }),
      h("span", { class: "hint", text: `${w.scoredAt ? `${ago(w.scoredAt)}评的` : ""}${(w.style || []).length ? `，${w.style.join("、")}` : ""}` })));
    const rows = h("div", { class: "score-rows" });
    for (const rule of r.rules.score) {
      const v = st.parts?.[rule.id] ?? 0;
      const fill = h("span", {});
      fill.style.width = `${Math.round(v * 100)}%`;
      rows.append(h("div", { class: "score-row", title: rule.rule }, h("span", { text: rule.label }), h("span", { class: "w", text: `${Math.round(rule.weight * 100)}%` }), h("div", { class: "bar" }, fill), h("span", { class: "v", text: `${Math.round(v * 100)}` })));
    }
    sec.append(rows);
    const pens = (st.penalties || []).map((id) => r.rules.penalties.find((p) => p.id === id)).filter(Boolean);
    if (pens.length) sec.append(h("div", { class: "flags" }, pens.map((p) => h("span", { class: "flag warn", text: p.rule }))));
    sec.append(h("dl", { class: "stat-grid" },
      stat("30 天实现盈利", h("span", { class: pnl > 0 ? "up" : pnl < 0 ? "down" : "", text: usd(pnl, true) }),
        pnlNewer ? `${dateFmt.format(new Date(w.pnl30At * 1000))} 重查；评分时 ${usd(st.realized, true)}` : ""),
      stat("资金报酬", pct(st.roi)),
      stat("胜率", st.winrate == null ? "—" : `${Math.round(st.winrate * 100)}%`),
      stat("交易过的币", `${st.tokens ?? 0} 颗`),
      stat("平均每笔买入", usd(st.avgBuy)),
      stat("赚 2 倍以上", `${st.bigWins ?? 0} 颗`),
      stat("买／卖笔数", `${st.buys ?? 0}／${st.sells ?? 0}`),
      stat("平均持有", dur(st.avgHold)),
      stat("自己发过的币", `${st.created ?? 0} 颗`)));
  }
  const rescoreBtn = h("button", { class: "btn btn-sm", type: "button", text: w.score == null ? "现在评分" : "重新评分", onclick: async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = "评分中";
    await openWallet(chain, address, true);
  } });
  sec.append(h("div", { class: "d-actions" }, rescoreBtn, watchButtons({ ...w, chain, address }, () => openWallet(chain, address))));
  body.append(sec);

  if (r.hits.length) {
    const list = h("div", { class: "list" });
    for (const hit of r.hits) {
      list.append(h("div", { class: "list-row clickable", role: "button", tabindex: "0", onclick: () => openToken(chain, hit.ca), onkeydown: (e) => { if (e.key === "Enter") openToken(chain, hit.ca); } },
        h("div", { class: "l1" }, h("strong", { text: hit.symbol || "未知" }),
          hit.entry_delay != null ? h("span", { class: "tag", text: `${entryText(hit.entry_delay)} 进场` }) : null,
          hit.entry_mc ? h("span", { class: "tag", text: `进场市值 ${usd(hit.entry_mc)}${hit.ath_mc ? `，最高 ${usd(hit.ath_mc)}` : ""}` }) : null,
          hit.rule != null && hit.rule < 2 ? h("span", { class: "tag warn", text: "旧规则，含帐面", title: "这笔是旧规则挖到的，获利可能含还没卖掉的帐面数字；自动挖掘会重新验算" }) : null),
        h("div", { class: "r" }, h("span", { class: "up", text: usd(hit.profit, true) }), h("small", { text: `报酬 ${Math.round((hit.roi || 0) * 100)}%，成本 ${usd(hit.cost)}` })),
        h("span", { class: "addr", text: hit.ca })));
    }
    body.append(h("section", { class: "d-section" }, h("h3", { text: "挖掘时命中的赚钱土狗" }), list));
  }

  const trades = h("div", { class: "list" });
  for (const t of r.trades) {
    trades.append(h("div", { class: "list-row clickable", role: "button", tabindex: "0", onclick: () => openToken(chain, t.token), onkeydown: (e) => { if (e.key === "Enter") openToken(chain, t.token); } },
      h("div", { class: "l1" }, logoNode(t.logo, t.symbol, "sm"), h("strong", { text: t.symbol || "未知" }), h("span", { class: `f-side ${t.side}`, text: sideText(t) })),
      h("div", { class: "r" }, h("span", { class: t.side, text: usd(t.usd) }), h("small", { text: stamp(t.ts) }))));
  }
  body.append(h("section", { class: "d-section" }, h("h3", { text: "最近收集到的交易" }),
    r.trades.length ? trades : h("p", { class: "hint", text: "最近 3 天没有收集到这个钱包的交易。" })));
}

function setPressed(groupId, attr, value) {
  for (const b of $(groupId).querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset[attr] === String(value)));
}

function setTab(tab) {
  state.tab = tab;
  document.body.dataset.tab = tab;
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  if (tab === "wallets") loadWallets();
  if (tab === "mine") { loadMined(); renderMineProgress(); }
  if (tab === "review") loadReview();
  try { localStorage.setItem("smart-money-tab", tab); } catch {  }
}

function filterBadge() {
  const n = (state.launchpadOnly ? 0 : 1) + (state.minUsd !== 50 ? 1 : 0) + (state.maxMcap !== MAX_MCAP_DEFAULT ? 1 : 0) + (state.noBots ? 1 : 0);
  $("filter-badge").textContent = n ? String(n) : "";
  $("filter-badge").hidden = !n;
}

function bind() {
  for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => setTab(b.dataset.tab));
  $("chain-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.chain = b.dataset.chain; setPressed("chain-seg", "chain", state.chain);
    state.prevBuyers.clear(); state.loaded = false; refresh(true);
    if (state.tab === "wallets") loadWallets();
    if (state.tab === "review") loadReview();
  });
  $("window-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.window = Number(b.dataset.window); setPressed("window-seg", "window", state.window);
    state.prevBuyers.clear(); state.loaded = false; refresh(true);
  });
  $("min-usd").addEventListener("change", (e) => { state.minUsd = Number(e.target.value); filterBadge(); state.prevBuyers.clear(); state.loaded = false; refresh(true); });
  $("max-mcap").addEventListener("change", (e) => {
    state.maxMcap = Number(e.target.value);
    filterBadge();
    try { localStorage.setItem(MAX_MCAP_KEY, String(state.maxMcap)); } catch {  }
    state.prevBuyers.clear(); state.loaded = false; refresh(true);
  });
  $("nobot-toggle").addEventListener("click", () => {
    state.noBots = !state.noBots;
    $("nobot-toggle").setAttribute("aria-pressed", String(state.noBots));
    filterBadge();
    try { localStorage.setItem("smart-money-no-bots", state.noBots ? "1" : "0"); } catch {  }
    state.prevBuyers.clear(); state.loaded = false; refresh(true);
  });
  $("lp-toggle").addEventListener("click", () => {
    state.launchpadOnly = !state.launchpadOnly;
    $("lp-toggle").setAttribute("aria-pressed", String(state.launchpadOnly));
    filterBadge();
    try { localStorage.setItem("smart-money-lp", state.launchpadOnly ? "1" : "0"); } catch {  }
    state.prevBuyers.clear(); state.loaded = false; refresh(true);
  });
  $("feed-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.feedFilter = b.dataset.feed; setPressed("feed-seg", "feed", state.feedFilter);
    if (state.data) { state.prevFeed = new Set(); renderFeed(); }
  });
  $("group-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.group = b.dataset.group; setPressed("group-seg", "group", state.group); loadWallets();
  });
  let qTimer;
  $("wallet-q").addEventListener("input", (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value.trim(); loadWallets(); }, 250); });
  $("wallet-sort").addEventListener("change", (e) => { state.sort = e.target.value; loadWallets(); });
  $("add-btn").addEventListener("click", addWallets);
  $("mine-chain-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.mineChain = b.dataset.mchain; setPressed("mine-chain-seg", "mchain", state.mineChain); loadMined(); renderFomoHot();
  });
  $("mine-src-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.mineSrc = b.dataset.msrc; setPressed("mine-src-seg", "msrc", state.mineSrc);
    try { localStorage.setItem("smart-money-mine-src", state.mineSrc); } catch {  }
    renderFomoHot(); mineSrcNote();
  });
  $("mine-all").addEventListener("click", () => {
    state.mineAll = !state.mineAll;
    $("mine-all").setAttribute("aria-pressed", String(state.mineAll));
    try { localStorage.setItem("smart-money-mine-all", state.mineAll ? "1" : "0"); } catch {  }
    renderFomoHot();
  });
  $("fomo-hot-bm").setAttribute("href", typeof wiBookmarklet === "function" ? wiBookmarklet(location.origin, "hot") : FOMO_HOT_BOOKMARKLET);
  $("fomo-hot-bm").addEventListener("click", (e) => { e.preventDefault(); toast("要拖到书签列，到 FOMO 页再按"); });
  pollFomoBoard();
  $("fomo-hot-paste").addEventListener("click", async () => {
    let text = "";
    try { text = await navigator.clipboard.readText(); } catch { return toast("浏览器没让这页读剪贴板，改按 Ctrl+V"); }
    applyFomoHot(text);
  });
  document.addEventListener("paste", (e) => {
    if (state.tab !== "mine" || state.mineSrc !== "fomo") return;
    if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
    const text = e.clipboardData?.getData("text") || "";
    if (parseFomoHot(text) || fomoProbeOf(text) || fomoBoardOf(text)) { e.preventDefault(); applyFomoHot(text); }
  });
  $("mine-btn").addEventListener("click", startMine);
  $("rv-days-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.rvDays = Number(b.dataset.days); setPressed("rv-days-seg", "days", state.rvDays); loadReview();
  });
  $("rv-backfill").addEventListener("click", () => {
    state.rvBackfill = !state.rvBackfill;
    $("rv-backfill").setAttribute("aria-pressed", String(state.rvBackfill));
    loadReview();
  });
  $("rv-rule").addEventListener("change", () => setRule($("rv-rule").value));
  $("rv-run").addEventListener("click", runReview);
  $("rv-rules-btn").addEventListener("click", () => {
    const box = $("rv-rules"); box.hidden = !box.hidden;
    $("rv-rules-btn").setAttribute("aria-expanded", String(!box.hidden));
  });
  $("rules-btn").addEventListener("click", () => {
    const box = $("rules"); box.hidden = !box.hidden;
    $("rules-btn").setAttribute("aria-expanded", String(!box.hidden));
  });
  $("pause-btn").addEventListener("click", async () => {
    const paused = !state.data?.tracker?.paused;
    try { await api("/api/smart/control", { paused }); toast(paused ? "已暂停收集" : "继续收集"); refresh(true); } catch (err) { toast(err.message); }
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(true); });
}

try { state.launchpadOnly = localStorage.getItem("smart-money-lp") !== "0"; } catch {  }
try { state.rvRule = localStorage.getItem("smart-money-rv-rule") || ""; } catch {  }
$("lp-toggle").setAttribute("aria-pressed", String(state.launchpadOnly));
try {
  const cap = localStorage.getItem(MAX_MCAP_KEY);
  if (cap !== null && [...$("max-mcap").options].some((o) => Number(o.value) === Number(cap))) state.maxMcap = Number(cap);
  state.noBots = localStorage.getItem("smart-money-no-bots") === "1";
} catch {  }
$("max-mcap").value = String(state.maxMcap);
$("nobot-toggle").setAttribute("aria-pressed", String(state.noBots));
try {
  const src = localStorage.getItem("smart-money-mine-src");
  if (["auto", "pump", "fomo"].includes(src)) state.mineSrc = src;
  state.mineAll = localStorage.getItem("smart-money-mine-all") !== "0";
  state.fomoHot = parseFomoHot(JSON.stringify({ kind: "fomo-hot", ...JSON.parse(localStorage.getItem("smart-money-fomo-hot") || "null") }));
} catch {  }
setPressed("mine-src-seg", "msrc", state.mineSrc);
$("mine-all").setAttribute("aria-pressed", String(state.mineAll));
renderFomoHot();
filterBadge();
bind();
let startTab = "signals";
try { startTab = localStorage.getItem("smart-money-tab") || "signals"; } catch {  }
setTab(["signals", "feed", "wallets", "mine", "review"].includes(startTab) ? startTab : "signals");
refresh(true);
schedule();
