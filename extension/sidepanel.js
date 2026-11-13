"use strict";

const $ = (id) => document.getElementById(id);
const DEFAULTS = { server: "http://127.0.0.1:8787", badges: true, site: "gmgn", auto: true, panelMode: "side" };
const AUTO_MS = 60 * 1000;
const EMBED = new URLSearchParams(location.search).get("embed") === "1";
const DEV_URL = new URLSearchParams(location.search).get("url");
const DEV_TAB = Number(new URLSearchParams(location.search).get("tab")) || 0;
const STRENGTH = { strong: "强", medium: "中", weak: "单一高手" };
const RESULT = { win: "胜", loss: "败", flat: "平", nodata: "没数据", "": "进行中" };
const HIDE_REF = new Set(["transfer_in"]);
const GROUP_ORDER = { avoid: 0, follow: 1, custom: 2, ref: 3 };

const state = {
  windowId: null, tabId: null, page: null, data: null, seq: 0, loading: false,
  filter: "lib", showAll: false, open: new Set(), tab: "holders",
  settings: { ...DEFAULTS }, sig: null, sigSeq: 0, lastLoad: 0,
  wallet: null, walletSeq: 0, searchOpen: false, ready: false,
  siteNames: new Map(),
  scrollMsg: null,
  plat: { key: "", fomo: null, pump: null, busy: "", paste: false, wait: false },
};

const send = (msg) => new Promise((resolve) => {
  try {
    chrome.runtime.sendMessage(msg, (reply) => { void chrome.runtime.lastError; resolve(reply || { ok: false, error: "插件背景没回应" }); });
  } catch (err) { resolve({ ok: false, error: String(err) }); }
});
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function usd(v, sign = true) {
  if (v == null || !isFinite(v)) return "";
  const a = Math.abs(v);
  const s = a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K` : `$${a.toFixed(a >= 100 ? 0 : 1)}`;
  return (v < 0 ? "−" : sign && v > 0 ? "+" : "") + s;
}
const pct = (v) => (v == null || !isFinite(v) ? "" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(0)}%`);
const TZ = { hour12: false };
function when(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const day = (x) => x.toLocaleDateString("zh-CN", TZ);
  const hm = d.toLocaleTimeString("zh-CN", { ...TZ, hour: "2-digit", minute: "2-digit" });
  return day(d) === day(new Date()) ? hm : `${d.toLocaleDateString("zh-CN", { ...TZ, month: "2-digit", day: "2-digit" })} ${hm}`;
}
function ago(ts) {
  if (!ts) return "";
  const s = Math.max(0, Date.now() / 1000 - ts);
  return s < 60 ? "刚刚" : s < 3600 ? `${Math.floor(s / 60)} 分钟前` : s < 86400 ? `${Math.floor(s / 3600)} 小时前` : `${Math.floor(s / 86400)} 天前`;
}
const platText = (p) => (p === "pump.fun" ? "pump" : p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n) => (String(s || "").length > n ? `${String(s).slice(0, n)}…` : String(s || ""));
const serverUrl = () => String(state.settings.server || DEFAULTS.server).replace(/\/+$/, "");
const gmgnWallet = (chain, address) => `https://gmgn.ai/${["sol", "robinhood", "base", "eth"].includes(chain) ? chain : "bsc"}/address/${address}`;
const siteName = (address) => {
  const h = state.data && (state.data.holders || []).find((x) => x.address === address);
  if (h && h.name) return { name: h.name, src: "GMGN" };
  return state.siteNames.get(address) || null;
};
const nameInfo = (w, address) => WLCA.nameInfo(w, siteName(address || (w && w.address)));
const nameOf = (w, address) => nameInfo(w, address).name;

const PRED = {
  lib: () => true,
  follow: (w) => w.follow,
  avoid: (w) => w.avoid,
  platform: (w) => (w.platforms || []).length > 0,
  smart: (w) => Boolean((w.sm && w.sm.watch) || w.trade),
};

async function loadSettings() {
  try { state.settings = await chrome.storage.local.get(DEFAULTS); } catch (_) { state.settings = { ...DEFAULTS }; }
  $("set-server").value = state.settings.server;
  $("set-site").value = state.settings.site;
  $("set-auto").checked = state.settings.auto !== false;
  $("set-badges").checked = state.settings.badges !== false;
  if ($("set-panelmode")) { $("set-panelmode").value = state.settings.panelMode === "float" ? "float" : "side"; panelModeHint(); }
}
function panelModeHint() {
  const el = $("panelmode-hint"); if (!el) return;
  const float = state.settings.panelMode === "float";
  el.hidden = false;
  el.textContent = float
    ? "浮动模式：到 GMGN／DeBot／Ave 分页，右下角会有圆钮，点开就是这个面板；点工具列图标（或 Alt+W）也可展开／收合。"
    : "侧边栏模式：点工具列图标（或 Alt+W）开右侧侧边栏。";
}
async function saveSetting(key, value) {
  state.settings[key] = value;
  try { await chrome.storage.local.set({ [key]: value }); } catch (_) {  }
}
function reportCount(n) {
  if (!EMBED) return;
  try { parent.postMessage({ type: "wl-count", n: Number(n) || 0 }, "*"); } catch (_) {  }
}
async function selfUpdate() {
  try {
    const running = chrome.runtime.getManifest().version;
    if (EMBED) { try { parent.postMessage({ type: "wl-ver", v: running }, "*"); } catch (_) {  } }
    const disk = (await (await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" })).json()).version;
    if (!disk || disk === running) return;
    const { selfReload } = await chrome.storage.local.get({ selfReload: null });
    if (selfReload && selfReload.v === disk && Date.now() - selfReload.at < 10 * 60 * 1000) return;
    await chrome.storage.local.set({ selfReload: { v: disk, from: running, at: Date.now() } });
    chrome.runtime.reload();
  } catch (_) {  }
}
selfUpdate();
async function ping() {
  const r = await send({ type: "wl-ping" });
  setServer(r.ok !== false, r.ok === false ? r.error : `已连上（接口版本 ${r.version || "?"}）`);
  return r;
}
function setServer(ok, text) {
  $("srv").className = `srv ${ok ? "ok" : "bad"}`;
  $("srv-text").textContent = ok ? "本机服务" : "没连上";
  $("srv").title = text || (ok ? "本机服务已连上" : "本机服务没连上");
}

async function syncTab() {
  if (DEV_URL) return setTab({ id: 0, url: DEV_URL });
  if (DEV_TAB) return chrome.tabs.get(DEV_TAB).then(setTab, () => setPage(null));
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId: state.windowId ?? chrome.windows.WINDOW_ID_CURRENT });
    setTab(tab);
  } catch (_) { setPage(null); }
}
function setTab(tab) {
  state.tabId = tab ? tab.id : null;
  const url = (tab && tab.url) || "";
  const p = url ? WLCA.parse(url) : null;
  const wp = !p && url ? WLCA.parseWallet(url) : null;
  setPage(p);
  if (wp) {
    if (!state.wallet || state.wallet.address !== wp.address) lookupWallet(wp.address, wp.chain, "page");
  } else if (state.wallet && state.wallet.source === "page") {
    state.wallet = null;
    state.walletSeq++;
    renderAll();
  }
}
function setPage(p) {
  const cur = state.page;
  if (p && cur && cur.ca === p.ca && (cur.chain === p.chain || cur.manual)) return;
  if (!p && !cur) return renderHeader();
  state.page = p;
  state.wallet = null;
  state.walletSeq++;
  state.data = null;
  state.open.clear();
  state.seq++;
  renderHeader();
  renderHoldersPane();
  if (state.sig) renderSignals();
  if (p) { load(); pullSiteNames(); }
}

async function load({ refresh = false, quiet = false, fresh = false } = {}) {
  const p = state.page;
  if (!p) return;
  const seq = ++state.seq;
  state.loading = true;
  if (!quiet) $("btn-refresh").classList.add("spin");
  const base = { type: "wl-token", chain: p.chain, ca: p.ca };
  try {
    if (!state.data) {
      const fast = await send({ ...base, holders: false });
      if (seq !== state.seq) return;
      if (fast.ok === false) return showError(fast.error);
      setServer(true);
      state.data = { ...fast, stage: 1 };
      renderHeader();
      renderHoldersPane();
    }
    const full = await send({ ...base, holders: true, refresh, fresh });
    if (seq !== state.seq) return;
    if (full.ok === false) return showError(full.error);
    setServer(true);
    state.data = { ...full, stage: 2 };
    state.lastLoad = Date.now();
    renderHeader();
    renderHoldersPane();
  } finally {
    if (seq === state.seq) { state.loading = false; $("btn-refresh").classList.remove("spin"); }
  }
}
let siteRender = 0;
function addSiteNames(msg) {
  let changed = false;
  for (const [a, name] of Object.entries((msg && msg.names) || {})) {
    const cur = state.siteNames.get(a);
    if (!cur || cur.name !== name) { state.siteNames.set(a, { name, src: msg.src || "site" }); changed = true; }
  }
  if (changed && !siteRender) siteRender = setTimeout(() => { siteRender = 0; renderAll(); }, 300);
}
async function pullSiteNames() {
  if (!state.tabId || DEV_URL) return;
  const r = await chrome.tabs.sendMessage(state.tabId, { type: "wl-site-names-get" }).catch(() => null);
  if (r && r.ok) addSiteNames(r);
}

function showError(error) {
  const text = String(error || "查找失败");
  if (/本机服务/.test(text) && /连不到|没开/.test(text)) setServer(false, text);
  $("holders-empty").hidden = true;
  $("holders-body").hidden = false;
  const box = $("err");
  box.hidden = false;
  box.className = "err";
  box.textContent = state.data ? `更新失败：${text}（下面是上一次的数据）` : text;
}

function renderHeader() {
  const p = state.page;
  const d = state.data;
  const market = (d && d.market) || {};
  const symbol = (d && d.symbol) || market.symbol || "";
  $("tok-name").textContent = p ? symbol || "这颗币" : "钱包库";
  const logo = $("tok-logo");
  if (p && market.logo) { if (logo.getAttribute("src") !== market.logo) logo.src = market.logo; logo.hidden = false; } else logo.hidden = true;
  $("tok-chain").hidden = !p || (!p.known && p.ca.startsWith("0x"));
  $("tok-chain").textContent = p ? WLCA.CHAIN_TEXT[p.chain] || p.chain : "";
  $("tok-chain-pick").hidden = !p || p.known || !p.ca.startsWith("0x");
  if (p && !p.known) $("tok-chain-pick").value = p.chain;
  const sub = [];
  if (p && d) {
    const mcap = market.mcap;
    if (mcap) sub.push(`市值 ${usd(mcap, false)}${market.priceAt && Date.now() / 1000 - market.priceAt > 1800 ? `（${when(market.priceAt)}）` : ""}`);
    if (market.liquidity) sub.push(`池子 ${usd(market.liquidity, false)}`);
    if (market.launchpad) sub.push(market.launchpad);
  }
  $("tok-sub").textContent = p ? (sub.length ? sub.join("，") : d ? "钱包库没有这颗币的市值数据" : "读取中") : "打开 GMGN、DeBot 或 Ave 的币页";
  $("ca-box").hidden = !p;
  $("ca-text").textContent = p ? p.ca : "";
  const wv = state.wallet;
  if (!p && wv) {
    $("tok-name").textContent = "查钱包";
    $("tok-chain").hidden = !wv.chain;
    $("tok-chain").textContent = WLCA.CHAIN_TEXT[wv.chain] || wv.chain || "";
    $("tok-sub").textContent = wv.source === "page" ? "目前分页是钱包页" : "钱包库查找";
  }
  const showSearch = state.searchOpen || (!p && !wv);
  $("search").hidden = !showSearch;
  $("btn-search").setAttribute("aria-expanded", String(showSearch));
}
const renderAll = () => { renderHeader(); renderHoldersPane(); };

const PLAT_CHAINS = { bsc: { fomo: "bnb", nid: 56, name: "BSC" }, sol: { fomo: "solana", nid: 1399811149, name: "Solana" }, robinhood: { fomo: "robinhood", nid: 4663, name: "Robinhood" } };
const PLAT_KEY = { fomo: "FOMO", pump: "pump.fun" };
const hhmm = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
function platKey() { const p = state.page; return p ? `${p.chain}|${p.ca}` : ""; }
function platHolders(d, platform) {
  const out = new Set();
  for (const r of rowsFor(d || {})) if (!r.pool && ((r.w && r.w.platforms) || []).some((x) => x.platform === platform)) out.add(r.address);
  return out;
}
function setPlatMsg(kind, text, bad = false) {
  state.plat[kind] = text ? { text, bad } : null;
  renderPlat();
}
function renderPlat() {
  const box = $("plat");
  const p = state.page;
  const c = p && PLAT_CHAINS[p.chain];
  if (!c || state.wallet) { box.hidden = true; return; }
  if (state.plat.key !== platKey()) state.plat = { key: platKey(), fomo: null, pump: null, busy: "", paste: false, wait: false };
  const d = state.data;
  const ready = d && d.stage === 2 && (d.holders || []).length;
  const cnt = (platform) => ready ? `<span class="pc" title="前 100 持有人里，钱包库记着 ${esc(platform)} 帐号的地址">前100有<b>${platHolders(d, platform).size}</b>个</span>` : `<span class="pc">…</span>`;
  const st = state.plat;
  const msg = (m) => (m ? `<div class="pmsg${m.bad ? " bad" : ""}">${esc(m.text)}</div>` : "");
  const bm = typeof wiBookmarklet === "function" ? wiBookmarklet(serverUrl(), "hold") : "";
  const bmLink = bm ? `<a class="pbm" data-plat-bm href="${esc(bm)}" draggable="true" title="按住拖到上面的书签列（书签列没出现按 Ctrl+Shift+B）。之后在 FOMO 币页按它，就会拷贝这颗币的持有人名单；在 pump.fun 币页按会开查地址页补 pump.fun 名字">持币</a>` : "";
  const html = `
    <div class="prow"><span class="pn">FOMO</span>${cnt("FOMO")}
      <button type="button" class="btn sm" data-plat="fomo-open" title="开这颗币的 FOMO 页，在那页按书签列的「持币」拷贝名单">开页</button>
      <button type="button" class="btn sm" data-plat="fomo-paste"${st.busy ? " disabled" : ""} title="不用插件抓的话：在 FOMO 页按「持币」书签后，回来按这颗粘贴名单（也可以在面板上直接 Ctrl+V）">粘贴</button>
      <button type="button" class="btn sm pri" data-plat="fomo-grab"${st.busy ? " disabled" : ""} title="用你这个 Chrome 的 FOMO 登录读这颗币的 FOMO 持有人（前 99 位，跟「持币」书签同一个请求），跟前 100 比对（没开 FOMO 页会在背景开一页，读完关掉；没登录会切到 FOMO 页给你登录）">${st.busy === "fomo" ? "抓取中…" : "抓名字"}</button></div>
    ${msg(st.fomo)}
    ${bmLink && (st.paste || st.bmHint || (st.fomo && st.fomo.bad)) ? `<div class="phint">不用插件抓的话：把 ${bmLink} 拖到书签列，到 FOMO 币页按它，再回来按「粘贴」</div>` : ""}
    ${st.paste ? `<textarea class="ppaste" data-plat="fomo-text" rows="2" spellcheck="false" placeholder="剪贴板读不到：点这格按 Ctrl+V 粘贴 FOMO 名单"></textarea>` : ""}
    <div class="prow"><span class="pn">pump.fun</span>${cnt("pump.fun")}
      <button type="button" class="btn sm" data-plat="pump-open" title="开这颗币的 pump.fun 页">开页</button>
      <button type="button" class="btn sm pri" data-plat="pump-grab"${st.busy ? " disabled" : ""} title="用你浏览器里的 pump.fun 页读这颗币的 pump.fun 持有人，跟前 100 比对（没开 pump.fun 页会在背景开一页，读完关掉）">${st.busy === "pump" ? "抓取中…" : "抓名字"}</button></div>
    ${msg(st.pump)}`;
  if (box.dataset.html !== html) {
    box.dataset.html = html;
    box.innerHTML = html;
  }
  box.hidden = false;
}
async function platOpen(kind) {
  const p = state.page;
  const c = p && PLAT_CHAINS[p.chain];
  if (!c) return;
  const url = kind === "fomo" ? `https://fomo.family/tokens/${c.fomo}/${encodeURIComponent(p.ca)}` : `https://pump.fun/coin/${encodeURIComponent(p.ca)}`;
  if (kind === "fomo") {
    state.plat.wait = true;
    state.plat.bmHint = true;
    setPlatMsg("fomo", "在 FOMO 页按书签列的「持币」，回到这页按「粘贴」（或直接 Ctrl+V）；也可以直接按「抓名字」让插件读");
  }
  try {
    const opts = { url, active: true };
    if (state.tabId && !DEV_URL) opts.openerTabId = state.tabId;
    await chrome.tabs.create(opts).catch(() => chrome.tabs.create({ url, active: true }));
  } catch (_) { window.open(url, "_blank", "noopener"); }
}
function platBack() {
  if (!state.plat.wait || document.visibilityState !== "visible") return;
  state.plat.wait = false;
  const b = document.querySelector('[data-plat="fomo-paste"]');
  if (!b) return;
  b.focus();
  b.classList.add("pulse");
  setTimeout(() => b.classList.remove("pulse"), 2400);
}
function parseFomo(text) {
  const p = state.page;
  const want = p && PLAT_CHAINS[p.chain];
  let j = null;
  try { j = JSON.parse(String(text || "").trim()); } catch (_) {  }
  if (Array.isArray(j)) return { error: "这是旧版书签的名单（没有 CA），请换新版「持币」书签再按一次" };
  if (j && j.kind === "wi-fomo") {
    if (!j.holders) return { error: "剪贴板里没有 FOMO 持有人：要在这颗币的 FOMO 币页按「持币」书签" };
    j = j.holders;
  }
  if (!j || !Array.isArray(j.holders)) return { skip: true, error: "剪贴板里不是 FOMO 名单：到这颗币的 FOMO 页按「持币」书签再回来贴" };
  if (!p || String(j.ca || "").toLowerCase() !== String(p.ca).toLowerCase()) return { error: `剪贴板里是别颗币的 FOMO 名单（${j.ca || "没有 CA"}），请到这颗币的 FOMO 页重按「持币」` };
  if (j.networkId == null && want.nid !== 56) return { error: `旧版书签只会抓 BSC，${want.name} 的币请换新版「持币」书签再按` };
  if (j.networkId != null && Number(j.networkId) !== want.nid) return { error: `剪贴板里是别条链的 FOMO 名单，这颗币在 ${want.name}，请到这颗币的 FOMO 页重按「持币」` };
  return { list: j };
}
function applyFomo(text, quiet = false) {
  const r = parseFomo(text);
  if (r.skip && quiet) return false;
  if (r.error) { setPlatMsg("fomo", r.error, true); return true; }
  const age = r.list.at ? Math.round((Date.now() - Number(r.list.at)) / 60000) : null;
  runMatch("fomo", { fomoList: r.list }, `收到 ${r.list.holders.length} 笔 FOMO 持有人${age != null && age >= 3 ? `（${age} 分钟前抓的）` : ""}，跟前 100 比对中…`);
  return true;
}
async function fomoPaste() {
  let text = "";
  try { text = await navigator.clipboard.readText(); }
  catch (_) {
    state.plat.paste = true;
    setPlatMsg("fomo", "浏览器没让面板读剪贴板：点下面那格按 Ctrl+V", true);
    const t = document.querySelector('[data-plat="fomo-text"]');
    if (t) t.focus();
    return;
  }
  applyFomo(text);
}
function pumpCutoff() {
  const d = state.data;
  const hs = (d && d.holders) || [];
  const price = d && d.market && Number(d.market.price);
  const last = hs[hs.length - 1];
  if (hs.length < 100 || !last || !last.usd || !price) return 0;
  return (Number(last.usd) / price) * 0.5;
}
async function pumpGrab() {
  const p = state.page;
  const key = platKey();
  state.plat.busy = "pump";
  setPlatMsg("pump", "读 pump.fun 持有人中…（没开 pump.fun 页会在背景开一页，读完关掉）");
  const g = await send({ type: "wl-pump-grab", chain: p.chain, ca: p.ca, cutoff: pumpCutoff() });
  if (platKey() !== key) return;
  if (!g || g.ok === false) { state.plat.busy = ""; setPlatMsg("pump", (g && g.error) || "读 pump.fun 失败", true); return; }
  if (!(g.positions || []).length) { state.plat.busy = ""; setPlatMsg("pump", `${hhmm()} pump.fun 上没有 pump.fun 用户持有这颗币，没有名字可以对`); return; }
  runMatch("pump", { pumpList: { ca: p.ca, at: g.at, positions: g.positions } }, `收到 ${g.positions.length} 笔 pump.fun 持有人，跟前 100 比对中…`);
}
async function fomoGrabExt() {
  const p = state.page;
  const key = platKey();
  state.plat.busy = "fomo";
  setPlatMsg("fomo", "读 FOMO 持有人中…（用你这个 Chrome 的 FOMO 登录；没开 FOMO 页会在背景开一页，读完关掉）");
  const g = await send({ type: "wl-fomo-grab", chain: p.chain, ca: p.ca });
  if (platKey() !== key) return;
  if (!g || g.ok === false || !g.list) { state.plat.busy = ""; setPlatMsg("fomo", (g && g.error) || "读 FOMO 失败", true); return; }
  if (!(g.list.holders || []).length) { state.plat.busy = ""; setPlatMsg("fomo", `${hhmm()} FOMO 上没有 FOMO 用户持有这颗币，没有名字可以对`); return; }
  runMatch("fomo", { fomoList: g.list }, `收到 ${g.list.holders.length} 笔 FOMO 持有人，跟前 100 比对中…`);
}
async function runMatch(kind, extra, startText) {
  const p = state.page;
  const key = platKey();
  const before = platHolders(state.data, PLAT_KEY[kind]);
  state.plat.busy = kind;
  setPlatMsg(kind, startText);
  const symbol = (state.data && (state.data.symbol || (state.data.market || {}).symbol)) || "";
  const r = await send({ type: "wl-plat-match", chain: p.chain, ca: p.ca, symbol, ...extra });
  if (platKey() !== key) return;
  state.plat.busy = "";
  if (!r || r.ok === false) { setPlatMsg(kind, `比对失败：${(r && r.error) || "插件背景没回应"}`, true); return; }
  const s = (r.status || {})[kind === "fomo" ? "fomo" : "pumpfun"] || {};
  if (!s.ok) { setPlatMsg(kind, `比对失败：${s.error || s.note || "没有结果"}`, true); return; }
  const got = ((r.matched || {})[kind] || []);
  const fresh = got.filter((a) => !before.has(a)).length;
  const lib = r.library || {};
  const parts = [`名单 ${s.fetched ?? 0} 人，持有量够进前 100 的 ${s.aboveCutoff ?? 0} 人，对上 ${s.matched ?? 0} 个地址`];
  parts.push(lib.ok ? `已存进钱包库（新的 ${fresh} 个，其他原本就有）` : `存进钱包库失败：${lib.error || "不明原因"}`);
  const warn = (s.warnings || []).join("；");
  state.plat.paste = false;
  setPlatMsg(kind, `${hhmm()} ${parts.join("；")}${warn ? `。注意：${warn}` : ""}`, !lib.ok);
  load({ quiet: true, fresh: true });
}

function rowsFor(d) {
  const W = d.wallets || {};
  if (d.stage === 2 && d.holders && d.holders.length) {
    return d.holders.map((h) => ({ ...h, w: W[h.address] || null }));
  }
  return [];
}

function renderHoldersPane() {
  const d = state.data;
  $("wallet-view").hidden = !state.wallet;
  if (state.wallet) {
    renderWallet();
    $("holders-empty").hidden = true;
    $("holders-body").hidden = true;
    return;
  }
  $("holders-empty").hidden = Boolean(state.page);
  $("holders-body").hidden = !state.page;
  if (!state.page) return;
  renderPlat();
  const err = $("err");
  if (!d) {
    err.hidden = true;
    for (const id of ["st-top", "st-follow", "st-avoid", "st-smart"]) $(id).textContent = "…";
    $("list").innerHTML = `<li class="muted list-empty">读取钱包库中</li>`;
    $("others").hidden = true; $("flow").hidden = true; $("conc").hidden = true; $("tok-signals").innerHTML = ""; $("meta").textContent = ""; $("note").textContent = "";
    $("list-empty").hidden = true;
    return;
  }
  const W = d.wallets || {};
  const meta = d.holdersMeta || {};
  const rows = rowsFor(d);
  const haveTop = rows.length > 0;

  if (d.stage === 1) { err.hidden = false; err.className = "err warn"; err.textContent = "正在抓前 100 持有人（走本机服务限流，可能要几秒）"; }
  else if (!meta.ok && meta.error) { err.hidden = false; err.className = "err warn"; err.textContent = `前 100 持有人暂时抓不到：${meta.error}。先列钱包库记录过这颗币的钱包。`; }
  else if (meta.error) { err.hidden = false; err.className = "err warn"; err.textContent = `前 100 这次更新失败，先用 ${when(meta.at)} 抓的那份：${meta.error}`; }
  else err.hidden = true;

  const topHits = rows.filter((r) => WLCA.hasStanding(r.w) && !r.pool);
  const count = (k) => topHits.filter((r) => PRED[k](r.w)).length;
  $("st-top").textContent = haveTop ? topHits.length : "–";
  $("st-follow").textContent = haveTop ? count("follow") : "–";
  $("st-avoid").textContent = haveTop ? count("avoid") : "–";
  $("st-smart").textContent = haveTop ? count("smart") : "–";
  reportCount(haveTop ? topHits.length : 0);
  for (const chip of document.querySelectorAll(".filters .chip")) {
    const k = chip.dataset.filter;
    chip.classList.toggle("on", k === state.filter);
    const n = haveTop ? (k === "lib" ? topHits.length : count(k)) : null;
    chip.innerHTML = `${esc(chip.textContent.replace(/\s*\d+$/, ""))}${n != null ? `<span class="n">${n}</span>` : ""}`;
  }
  renderConcentration(rows, topHits);
  $("show-all").checked = state.showAll;
  $("show-all").disabled = !haveTop;

  const f = d.smFlow || {};
  if (f.wallets) {
    $("flow").hidden = false;
    $("flow").innerHTML = `<span class="k">追踪中的聪明钱</span><b class="num">${f.wallets}</b><span class="k">个在这颗币</span>
      <span>买 <b class="num up">${usd(f.buy, false)}</b></span><span>卖 <b class="num dn">${usd(f.sell, false)}</b></span>
      <span class="k">最后一笔 ${esc(ago(f.last))}</span>`;
  } else $("flow").hidden = true;
  $("tok-signals").innerHTML = (d.signals || []).slice(0, 3).map((s) => sigHtml(s, false)).join("");

  let list;
  if (haveTop) {
    list = state.showAll ? rows : rows.filter((r) => WLCA.hasStanding(r.w) && PRED[state.filter](r.w));
  } else {
    list = (d.others || []).map((a) => ({ address: a, w: W[a], rank: null })).filter((r) => WLCA.hasStanding(r.w) && PRED[state.filter](r.w));
  }
  $("list").innerHTML = list.map(rowHtml).join("");
  const le = $("list-empty");
  le.hidden = list.length > 0;
  le.textContent = haveTop
    ? state.filter === "lib" ? "前 100 持有人里没有钱包库认得的钱包（只在库、没有标记的不列）" : "前 100 里没有符合这个筛选的钱包"
    : d.stage === 1 ? "钱包库没记录过这颗币，等前 100 持有人" : "钱包库没记录过这颗币";

  const others = haveTop ? (d.others || []).filter((a) => WLCA.hasStanding(W[a]) && PRED[state.filter](W[a])) : [];
  $("others").hidden = !others.length;
  $("others-count").textContent = others.length;
  $("others-list").innerHTML = others.map((a) => rowHtml({ address: a, w: W[a], rank: null })).join("");

  const s = d.summary || {};
  const m = [];
  if (meta.ok) m.push(`前 100 来源：${meta.source || "GMGN"}，${when(meta.at)} 抓的${meta.cached ? "（缓存）" : ""}`);
  m.push(`钱包库记录过这颗币 ${s.libForCa || 0} 个地址`);
  $("meta").textContent = m.join("；");
  $("note").textContent = d.note || "";
}

function renderConcentration(rows, topHits) {
  const box = $("conc");
  box.hidden = !rows.length;
  if (!rows.length) return;
  const sum = (list) => list.reduce((t, r) => t + (Number(r.pct) || 0), 0);
  const av = sum(topHits.filter((r) => r.w.avoid));
  const fo = sum(topHits.filter((r) => r.w.follow && !r.w.avoid));
  const lib = sum(topHits);
  const top10 = sum(rows.filter((r) => !r.pool).slice(0, 10));
  const fmt = (v) => `${v.toFixed(v >= 10 ? 1 : 2)}%`;
  const width = (v) => `${Math.max(0, Math.min(100, v))}%`;
  const [segAv, segFo, segLib] = box.querySelectorAll(".seg");
  segAv.style.width = width(av);
  segFo.style.width = width(fo);
  segLib.style.width = width(lib - av - fo);
  $("conc-text").innerHTML = `<span class="lib" title="前 100 里钱包库认得的钱包合计持仓（不含池子和交易所）"><i style="background:var(--info)"></i>在库合计 <b>${fmt(lib)}</b></span>
    <span class="fo" title="高手合计持仓"><i style="background:var(--up)"></i>高手 <b>${fmt(fo)}</b></span>
    <span class="av" title="要避开（庄家、捆绑、狙击、机器人）合计持仓"><i style="background:var(--down)"></i>避开 <b>${fmt(av)}</b></span>
    <span title="前 10 大持有人合计持仓，不含池子和交易所">前 10 <b>${fmt(top10)}</b></span>`;
}

function chipsHtml(w, row) {
  const out = [];
  if (row && row.pool) out.push(`<span class="c pool">池子或交易所</span>`);
  (w.useText || []).forEach((u, i) => {
    const kind = (w.use || [])[i];
    if (kind === "ref" && (w.labels || []).length) return;
    out.push(`<span class="c ${kind === "avoid" ? "av" : kind === "confirm" ? "fo" : ""}">${esc(u)}</span>`);
  });
  for (const p of w.platforms || []) out.push(`<span class="c pf">${esc(platText(p.platform))}${p.acct && p.acct.total != null ? ` ${usd(p.acct.total)}` : ""}</span>`);
  if (w.private) out.push(`<span class="c pv" title="你的私人标签">${esc(w.private.own ? "我的钱包" : w.private.label)}</span>`);
  if (w.sm && w.sm.watch) out.push(`<span class="c sm">聪明钱${w.sm.grade ? ` ${esc(w.sm.grade)}` : ""}</span>`);
  if (w.trade) out.push(`<span class="c sm">这颗币买 ${usd(w.trade.buy, false)}${w.trade.sell ? ` 卖 ${usd(w.trade.sell, false)}` : ""}</span>`);
  const labels = (w.labels || [])
    .filter((l) => !HIDE_REF.has(l.id) && !((w.platforms || []).length && (l.id === "fomo_user" || l.id === "pump_user")))
    .sort((a, b) => (GROUP_ORDER[a.group] ?? 9) - (GROUP_ORDER[b.group] ?? 9));
  const shown = labels.filter((l) => l.group !== "ref").concat(labels.filter((l) => l.group === "ref").slice(0, 2));
  for (const l of shown) out.push(`<span class="c ${l.group === "avoid" ? "av" : l.group === "follow" ? "fo" : l.group === "custom" ? "pv" : ""}">${esc(l.text)}</span>`);
  if (labels.length > shown.length) out.push(`<span class="c">另 ${labels.length - shown.length} 个</span>`);
  return out.join("");
}

function rowHtml(r) {
  const w = r.w;
  const open = state.open.has(r.address);
  const rk = r.rank != null
    ? `<span class="rk"><b>#${r.rank}</b><span>${r.pct != null ? `${r.pct.toFixed(r.pct >= 10 ? 1 : 2)}%` : ""}</span></span>`
    : `<span class="rk"><b>–</b></span>`;
  if (!w || !WLCA.hasStanding(w)) {
    const inner = `${rk}<span class="g g-none">–</span>
      <span class="nm muted">${(() => { const sn = siteName(r.address); const base = r.pool ? "池子或交易所" : w ? "在钱包库，没有标记" : "不在钱包库"; return sn && !WLCA.isShortAddr(sn.name) ? `${esc(sn.name)}<span class="src">（${esc(base)}）</span>` : base; })()}</span><span class="pnl muted">${r.usd ? usd(r.usd, false) : ""}</span>
      <span class="addr">${esc(r.address)}</span>`;
    if (r.pool) return `<li class="row is-miss" data-addr="${esc(r.address)}"><div class="row-main">${inner}</div></li>`;
    const anim = state.justOpened === r.address ? " anim" : "";
    return `<li class="row is-miss" data-addr="${esc(r.address)}"><button class="row-main" aria-expanded="${open}" title="展开可以加标签或加入聪明钱追踪">${inner}</button>
      ${open ? `<div class="detail${anim}">${WLCA.editHtml(w, r.address)}${actsHtml(r.address, (w && w.chain) || "", false)}</div>` : ""}</li>`;
  }
  const ni = nameInfo(w, r.address);
  const named = ni.name;
  const name = named || WLCA.shortAddr(r.address);
  const here = w.here && w.here.total != null ? `<span class="pnl ${w.here.total >= 0 ? "up" : "dn"}" title="这颗币盈亏（${esc(w.here.source || "")}）">${usd(w.here.total)}</span>` : `<span class="pnl"></span>`;
  return `<li class="row${w.avoid ? " is-avoid" : ""}" data-addr="${esc(r.address)}">
    <button class="row-main" aria-expanded="${open}">${rk}
      <span class="g ${w.grade ? `g-${esc(w.grade)}` : "g-none"}" title="实力等级（30 天）">${esc(w.grade || "–")}</span>
      <span class="nm${named ? "" : " unnamed"}" title="${esc(WLCA.NAME_SRC_TEXT[ni.src] || "")}">${esc(name)}${w.sm && w.sm.watch ? `<span class="star" title="聪明钱名单追踪中">★</span>` : ""}${w.quiet ? ` <span class="muted" style="font-weight:400">低盈利</span>` : ""}</span>
      ${here}
      <span class="addr">${esc(r.address)}</span>
      <span class="tags">${chipsHtml(w, r)}</span>
    </button>
    ${open ? detailHtml(w, r) : ""}
  </li>`;
}

function detailHtml(w, r, wallet = false) {
  const parts = [];
  const groups = { avoid: [], follow: [], custom: [], ref: [] };
  for (const l of w.labels || []) (groups[l.group] || groups.ref).push(l);
  for (const [title, key, cls] of [["要避开", "avoid", "av"], ["高手", "follow", "fo"], ["自订", "custom", "pv"], ["参考", "ref", ""]]) {
    if (groups[key].length) parts.push(`<div><div class="k">${title}</div><div class="chips">${groups[key].map((l) => `<span class="c ${cls}">${esc(l.text)}${WLCA.rmHtml(l, w.address)}</span>`).join("")}</div></div>`);
  }
  if (w.private) parts.push(`<div><div class="k">你的私人标签</div><span class="c pv">${esc(w.private.label)}</span>${w.private.kindText ? ` <span class="muted">${esc(w.private.kindText)}</span>` : ""}</div>`);
  const h = w.here;
  if (h) parts.push(`<div><div class="k">这颗币（${esc(h.source || "GMGN")}）</div><div class="kv">
      <span>合计 <b class="num ${h.total >= 0 ? "up" : "dn"}">${usd(h.total) || "—"}</b></span>
      <span>已实现 <b class="num">${usd(h.realized) || "—"}</b></span><span>帐面 <b class="num">${usd(h.unrealized) || "—"}</b></span>
      <span class="muted">${h.holding ? "还拿着" : "已出清"}${h.sold && h.holding ? "，卖过一部分" : ""}</span></div></div>`);
  if ((w.platforms || []).length) {
    parts.push(`<div><div class="k">平台帐号</div>${w.platforms.map((p) => `<div class="kv"><span class="c pf">${esc(platText(p.platform))}</span><b>${esc(p.handle)}</b>
      ${p.x ? `<span class="muted">X @${esc(p.x)}</span>` : ""}
      ${p.acct ? `<span>帐号总盈亏 <b class="num ${p.acct.total >= 0 ? "up" : "dn"}">${usd(p.acct.total)}</b>${p.acct.partial ? `<span class="muted">（部分）</span>` : ""}</span>` : ""}</div>`).join("")}</div>`);
  }
  const c = w.card;
  if (c && (c.realized != null || c.winrate != null)) {
    parts.push(`<div><div class="k">实力（30 天，${esc(c.src || "")}）</div><div class="kv">
      ${c.realized != null ? `<span>实现盈利 <b class="num ${c.realized >= 0 ? "up" : "dn"}">${usd(c.realized)}</b></span>` : ""}
      ${c.winrate != null ? `<span>胜率 <b class="num">${(c.winrate * 100).toFixed(0)}%</b></span>` : ""}
      ${c.tokens != null ? `<span>币数 <b class="num">${c.tokens}</b></span>` : ""}
      ${c.gt5 ? `<span>5 倍以上 <b class="num">${c.gt5}</b> 颗</span>` : ""}</div></div>`);
  }
  if (w.trade) {
    parts.push(`<div><div class="k">聪明钱动态在这颗币${w.sm && w.sm.watch ? "（名单追踪中）" : ""}</div><div class="kv">
      <span>买 <b class="num up">${usd(w.trade.buy, false)}</b></span><span>卖 <b class="num dn">${usd(w.trade.sell, false)}</b></span>
      <span class="muted">第一笔 ${esc(when(w.trade.first))}</span><span class="muted">最后 ${esc(when(w.trade.last))}</span></div></div>`);
  }
  if (w.bot) parts.push(`<div><div class="k">机器人</div><div class="note">${esc(w.bot)}</div></div>`);
  if (w.hft) parts.push(`<div><div class="k">高频交易</div><div class="note">${esc(w.hft)}（不算要避开）</div></div>`);
  if (w.note) parts.push(`<div><div class="k">备注</div><div class="note">${esc(w.note)}</div></div>`);
  parts.push(WLCA.editHtml(w, w.address));
  parts.push(actsHtml(w.address, w.chain, wallet));
  const anim = state.justOpened === w.address ? " anim" : "";
  return `<div class="detail${anim}">${parts.join("")}</div>`;
}

function actsHtml(address, chain, wallet) {
  const link = `${serverUrl()}/analyze.html?q=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain || "")}`;
  return `<div class="acts"><button class="btn sm" data-copy="${esc(address)}">拷贝地址</button>
    <a class="btn sm" href="${esc(link)}" target="_blank" rel="noopener noreferrer">在本机服务查这个地址</a>
    ${wallet ? `<a class="btn sm" href="${esc(gmgnWallet(chain, address))}" target="_blank" rel="noopener noreferrer">GMGN 钱包页</a>` : `<span class="scroll-msg" data-scroll-msg>${state.scrollMsg && state.scrollMsg.address === address ? esc(state.scrollMsg.text) : ""}</span>`}</div>`;
}

const SOURCE_TEXT = { page: "目前分页的钱包页", search: "粘贴的地址", menu: "右键查找" };
function renderWallet() {
  const s = state.wallet;
  const box = $("wallet-view");
  const w = s.data;
  box.classList.toggle("is-avoid", Boolean(w && w.avoid));
  const close = s.source === "page" ? "" : `<button class="btn sm" data-wallet-close>${state.page ? "返回这颗币" : "关闭"}</button>`;
  const top = `<div class="wallet-top"><span class="src">钱包・${esc(SOURCE_TEXT[s.source] || "")}${s.chain ? `・${esc(WLCA.CHAIN_TEXT[s.chain] || s.chain)}` : ""}</span>${close}</div>`;
  if (s.error) { box.innerHTML = `${top}<div class="err">${esc(s.error)}</div>`; return; }
  const addr = `<span class="addr">${esc(s.address)}</span>`;
  if (s.loading) { box.innerHTML = `${top}<div class="wallet-head"><span class="g g-none">–</span><span class="ttl muted">查找中</span>${addr}</div>`; return; }
  if (!w) {
    box.innerHTML = `${top}<div class="wallet-head"><span class="g g-none">–</span><span class="ttl muted">钱包库没有这个地址</span>${addr}</div>
      <p class="none small">钱包库、私人标签、平台帐号、聪明钱名单、机器人名单都没有它。</p><div class="detail">${WLCA.editHtml(null, s.address)}${actsHtml(s.address, s.chain, true)}</div>`;
    return;
  }
  const named = nameOf(w, s.address);
  const title = named || (WLCA.hasStanding(w) ? WLCA.shortAddr(s.address) : "在钱包库，没有标记");
  box.innerHTML = `${top}<div class="wallet-head"><span class="g ${w.grade ? `g-${esc(w.grade)}` : "g-none"}" title="实力等级（30 天）">${esc(w.grade || "–")}</span>
    <span class="ttl${named ? "" : " muted"}">${esc(title)}${w.sm && w.sm.watch ? `<span class="star" title="聪明钱名单追踪中">★</span>` : ""}${w.quiet ? ` <span class="muted" style="font-size:12.5px;font-weight:400">低盈利</span>` : ""}</span>${addr}</div>
    <div class="tags">${chipsHtml(w, null)}</div>${detailHtml(w, null, true)}`;
}

const knownAddresses = () => { const d = state.data; return d ? [...(d.holders || []).map((h) => h.address), ...Object.keys(d.wallets || {})] : []; };

async function lookupWallet(address, chain, source, raw = "") {
  const seq = ++state.walletSeq;
  address = WLCA.norm(address || "");
  if (source !== "page" && state.tab !== "holders") setTabPane("holders");
  if (!WLCA.FULL.test(address) && raw && /\.{2,3}|…/.test(raw) && state.page) {
    state.wallet = { address: "", chain: "", source, loading: true };
    renderAll();
    for (let i = 0; i < 40 && !(state.data && state.data.stage === 2); i++) await sleep(300);
    if (seq !== state.walletSeq) return;
    address = WLCA.matchShort(raw, knownAddresses());
  }
  if (!WLCA.FULL.test(address)) {
    state.wallet = { address: "", chain: "", source, error: raw ? `「${clip(raw, 40)}」里找不到完整的钱包地址${state.page ? "，也对不上这颗币前 100 持有人的缩写" : ""}。网页上的缩写地址，请在地址链接上按右键。` : "看不出是钱包地址" };
    return renderAll();
  }
  const evm = address.startsWith("0x");
  const samePage = Boolean(state.page && state.page.ca.startsWith("0x") === evm);
  if (!chain) chain = evm ? (samePage ? state.page.chain : "bsc") : "sol";
  state.wallet = { address, chain, source, loading: true };
  renderAll();
  const ca = samePage ? state.page.ca : "";
  const r = await send({ type: "wl-lookup", chain: ca ? state.page.chain : chain, ca, addresses: [address] });
  if (seq !== state.walletSeq) return;
  if (r.ok === false) {
    state.wallet = { ...state.wallet, loading: false, error: r.error };
    if (/连不到/.test(r.error)) setServer(false, r.error);
  } else {
    setServer(true);
    state.wallet = { ...state.wallet, loading: false, data: (r.items || {})[address] || null };
  }
  renderAll();
}

async function takePending() {
  let v = null;
  try { v = (await chrome.storage.session.get("pendingLookup")).pendingLookup; } catch (_) { return; }
  if (!v) return;
  try { await chrome.storage.session.remove("pendingLookup"); } catch (_) {  }
  if (Date.now() - (v.at || 0) > 30000) return;
  lookupWallet(v.address, v.chain, "menu", v.raw || "");
}

function applyItem(address, item) {
  const d = state.data;
  if (d) {
    d.wallets = { ...(d.wallets || {}) };
    if (item) d.wallets[address] = item; else delete d.wallets[address];
    for (const h of d.holders || []) if (h.address === address) h.hit = Boolean(item);
  }
  if (state.wallet && state.wallet.address === address) state.wallet = { ...state.wallet, data: item };
}

let toastTimer = 0;
function toast(text, bad = false, undo = null) {
  const t = $("toast");
  t.className = `toast${bad ? " bad" : ""}`;
  t.innerHTML = `<span class="t">${esc(text)}</span>${undo ? `<button type="button" data-undo>复原</button>` : ""}`;
  t.hidden = false;
  state.undo = undo;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; state.undo = null; }, undo ? 8000 : 5000);
}

async function edAct(address, act, isUndo = false) {
  const boxes = [...document.querySelectorAll(`[data-ed="${CSS.escape(address)}"]`)];
  boxes.forEach((b) => b.classList.add("busy"));
  const evm = address.startsWith("0x");
  const same = Boolean(state.page && state.page.ca.startsWith("0x") === evm);
  const chain = same ? state.page.chain : (state.wallet && state.wallet.address === address && state.wallet.chain) || (evm ? "bsc" : "sol");
  const r = await send({ type: act.kind === "star" ? "wl-star" : "wl-tag", chain, ca: same ? state.page.ca : "", address, label: act.label, on: act.on, from: "panel" });
  if (r.ok === false) {
    boxes.forEach((b) => b.classList.remove("busy"));
    toast(r.error || "没有存到", true);
    return;
  }
  applyItem(address, r.item || null);
  renderAll();
  toast(`${WLCA.actText(act, r)}${isUndo ? "（已复原）" : ""}`, false, isUndo ? null : { address, act: { ...act, on: !act.on } });
}

function sigHtml(s, withSymbol, current) {
  const mkt = s.market || {};
  const now = mkt.mcap && s.mcap ? mkt.mcap / s.mcap - 1 : null;
  const line2 = [];
  if (s.mcap) line2.push(`<span>信号时市值 <b class="num">${usd(s.mcap, false)}</b>${withSymbol && mkt.mcap ? `，现在 <b class="num ${now >= 0 ? "up" : "dn"}">${usd(mkt.mcap, false)}</b>` : ""}</span>`);
  line2.push(`<span>钱包 <b class="num">${s.wallets || 0}</b> 个${s.strongWallets ? `，强 <b class="num">${s.strongWallets}</b>` : ""}</span>`);
  if (s.peak != null) line2.push(`<span>最高 <b class="num up">${pct(s.peak)}</b></span>`);
  if (!withSymbol && (s.buyUsd || s.sellUsd)) line2.push(`<span>买 <b class="num">${usd(s.buyUsd, false)}</b> 卖 <b class="num">${usd(s.sellUsd, false)}</b></span>`);
  if (withSymbol && s.count > 1) line2.push(`<span>触发 <b class="num">${s.count}</b> 次</span>`);
  const res = `<span class="res res-${s.result || "pending"}">${esc(RESULT[s.result] ?? s.result)}</span>`;
  const head = withSymbol
    ? `<span class="str str-${esc(s.strength)}">${esc(STRENGTH[s.strength] || s.strength)}</span>
       <span class="sym">${esc(s.symbol || s.ca)}${s.lib ? ` <span class="lib" title="钱包库在这颗币记录过的地址">钱包库 ${s.lib}</span>` : ""}</span>
       <span class="t">${esc(when(s.first || s.at))}</span>${res}`
    : `<span class="str str-${esc(s.strength)}">${esc(STRENGTH[s.strength] || s.strength)}信号</span><span class="t">${esc(when(s.at))}</span>${res}`;
  if (withSymbol) {
    return `<li><button class="sig${current ? " cur" : ""}" data-chain="${esc(s.chain)}" data-ca="${esc(s.ca)}" title="${esc(`${s.symbol} ${s.ca}`)}">${head}<span class="line2">${line2.join("")}</span></button></li>`;
  }
  return `<div class="sig">${head}<span class="line2">${line2.join("")}</span></div>`;
}

async function loadSignals() {
  const seq = ++state.sigSeq;
  const r = await send({ type: "wl-signals", hours: Number($("sig-hours").value), chain: $("sig-chain").value });
  if (seq !== state.sigSeq) return;
  const err = $("sig-err");
  if (r.ok === false) { err.hidden = false; err.textContent = r.error; if (/连不到/.test(r.error)) setServer(false, r.error); return; }
  err.hidden = true;
  setServer(true);
  state.sig = r;
  renderSignals();
}
function renderSignals() {
  const r = state.sig;
  if (!r) return;
  const items = r.items || [];
  const p = state.page;
  $("sig-list").innerHTML = items.length
    ? items.map((s) => sigHtml(s, true, p && p.ca === s.ca)).join("")
    : `<li class="muted list-empty">这段时间没有信号</li>`;
  $("sig-count").hidden = !items.length;
  $("sig-count").textContent = items.length;
  $("sig-meta").textContent = `点一下在目前分页打开（${{ gmgn: "GMGN", debot: "DeBot", ave: "Ave" }[state.settings.site] || "GMGN"}）；按住 Ctrl 点开新分页。${when(r.now)} 更新`;
}

function setTabPane(tab) {
  state.tab = tab;
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  $("pane-holders").hidden = tab !== "holders";
  $("pane-signals").hidden = tab !== "signals";
  if (tab === "signals") loadSignals();
}

let lastSoon = 0;
function refreshSoon() {
  if (!state.page || state.loading || state.settings.auto === false || Date.now() - lastSoon < 3000) return;
  lastSoon = Date.now();
  load({ quiet: true, fresh: true });
}

function setScrollMsg(address, text) {
  state.scrollMsg = { address, text };
  for (const el of document.querySelectorAll(`.row[data-addr="${CSS.escape(address)}"] [data-scroll-msg]`)) el.textContent = text;
}

async function scrollPage(address) {
  if (!state.tabId || DEV_URL) return;
  const h = ((state.data && state.data.holders) || []).find((x) => x.address === address);
  setScrollMsg(address, "卷到网页上的这一列…");
  const tabId = state.tabId;
  const ask = () => chrome.tabs.sendMessage(tabId, { type: "wl-scroll", address, rank: h ? h.rank : 0, pct: h && h.pct != null ? h.pct : null });
  let r = await ask().catch(() => null);
  if (!r) {
    const fix = await chrome.runtime.sendMessage({ type: "wl-inject", tabId }).catch(() => null);
    if (fix && fix.ok) {
      await new Promise((ok) => setTimeout(ok, 400));
      r = await ask().catch(() => null);
    }
  }
  setScrollMsg(address, !r ? "网页跟插件接不上：把网页刷新一次（F5）"
    : r.found ? (r.rank && h && h.rank && r.rank !== h.rank
      ? `已卷到网页上的这一列（网页上现在是第 ${r.rank} 名；这里的 #${h.rank} 是本机服务几分钟前抓的 GMGN 排名，中间有人买卖就会差几名）`
      : "已卷到网页上的这一列")
    : r.reason === "norows" ? "网页上没有持有人清单（先切到网站的持有者分页）"
    : r.reason === "error" ? `卷动出错：${r.error || "不明原因"}`
    : "网页的持有人清单里现在没有他：这里的前 100 是本机服务几分钟前抓的，他可能已经卖掉或掉出前 100（网站开了筛选、换了排序或不在持有人分页也会找不到）");
}

function bind() {
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    const ed = t.closest("[data-ed]");
    let act = null;
    let address = ed ? ed.dataset.ed : "";
    if (t.hasAttribute("data-star") && ed) act = { kind: "star", on: t.dataset.star === "1" };
    else if (t.hasAttribute("data-tag-add") && ed) act = { kind: "tag", label: t.dataset.tagAdd, text: t.dataset.tagText, on: true };
    else if (t.hasAttribute("data-tag-rm")) { address = t.dataset.for; act = { kind: "tag", label: t.dataset.tagRm, text: t.dataset.tagText, on: false }; }
    else if (t.hasAttribute("data-undo") && state.undo) { e.stopPropagation(); $("toast").hidden = true; edAct(state.undo.address, state.undo.act, true); state.undo = null; return; }
    if (!act || !address) return;
    e.stopPropagation();
    edAct(address, act);
  }, true);
  document.addEventListener("submit", (e) => {
    const form = e.target.closest("[data-tag-form]");
    if (!form) return;
    e.preventDefault();
    e.stopPropagation();
    const text = form.elements.tag.value.trim();
    const ed = form.closest("[data-ed]");
    if (text && ed) edAct(ed.dataset.ed, { kind: "tag", label: text, text, on: true });
  }, true);
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== "wl-wallet-changed" || msg.from === "panel") return;
    const a = WLCA.norm(msg.address);
    const samePage = state.page && msg.ca && msg.ca === state.page.ca;
    if (samePage || (state.wallet && state.wallet.address === a)) {
      applyItem(a, msg.item || null);
      renderAll();
    } else if (state.data && (state.data.wallets || {})[a]) load({ quiet: true });
  });

  document.querySelector(".tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (b) setTabPane(b.dataset.tab);
  });
  $("btn-refresh").addEventListener("click", () => {
    if (state.tab === "signals") loadSignals();
    if (state.page) load({ refresh: true });
    else ping();
  });
  $("btn-search").addEventListener("click", () => {
    state.searchOpen = $("search").hidden;
    if (!state.searchOpen && !state.page && !state.wallet) state.searchOpen = true;
    renderHeader();
    if (!$("search").hidden) $("q").focus();
  });
  $("search").addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = $("q").value.trim();
    if (!raw) return;
    const wp = WLCA.parseWallet(raw);
    lookupWallet(wp ? wp.address : WLCA.findAddress(raw), wp ? wp.chain : "", "search", raw);
  });
  $("q").addEventListener("keydown", (e) => { if (e.key === "Escape") { state.searchOpen = false; renderHeader(); } });
  $("wallet-view").addEventListener("click", (e) => {
    const copy = e.target.closest("[data-copy]");
    if (copy) {
      navigator.clipboard.writeText(copy.dataset.copy).then(() => { copy.textContent = "已拷贝"; }, () => { copy.textContent = "拷贝失败"; });
      return;
    }
    if (e.target.closest("[data-wallet-close]")) {
      state.wallet = null;
      state.walletSeq++;
      renderAll();
    }
  });
  $("btn-settings").addEventListener("click", () => {
    const box = $("settings");
    box.hidden = !box.hidden;
    $("btn-settings").setAttribute("aria-expanded", String(!box.hidden));
  });
  $("btn-copy-ca").addEventListener("click", async (e) => {
    try { await navigator.clipboard.writeText(state.page.ca); e.target.textContent = "已拷贝"; } catch (_) { e.target.textContent = "拷贝失败"; }
    setTimeout(() => { e.target.textContent = "拷贝"; }, 1500);
  });
  $("tok-chain-pick").addEventListener("change", (e) => {
    if (!state.page) return;
    const p = { ...state.page, chain: e.target.value, manual: true };
    state.page = null;
    setPage(p);
  });

  const pick = (k) => { state.filter = k; state.showAll = false; renderHoldersPane(); };
  document.querySelector(".filters").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) pick(b.dataset.filter); });
  document.querySelector(".stats").addEventListener("click", (e) => { const b = e.target.closest(".stat"); if (b) pick(b.dataset.filter); });
  $("show-all").addEventListener("change", (e) => { state.showAll = e.target.checked; renderHoldersPane(); });

  $("plat").addEventListener("click", (e) => {
    if (e.target.closest("[data-plat-bm]")) {
      e.preventDefault();
      setPlatMsg("fomo", "「持币」要按住拖到上面的书签列（书签列没出现按 Ctrl+Shift+B）。拖好之后在 FOMO 币页按书签列的「持币」，再回来按「粘贴名单」");
      return;
    }
    const b = e.target.closest("button[data-plat]");
    if (!b || b.disabled) return;
    const act = b.dataset.plat;
    if (act === "fomo-open") platOpen("fomo");
    else if (act === "pump-open") platOpen("pump");
    else if (act === "fomo-paste") fomoPaste();
    else if (act === "pump-grab") pumpGrab();
    else if (act === "fomo-grab") fomoGrabExt();
  });
  document.addEventListener("paste", (e) => {
    if (!state.page || !PLAT_CHAINS[state.page.chain] || state.plat.busy || state.wallet) return;
    const t = e.target;
    const box = t && t.closest && t.closest('[data-plat="fomo-text"]');
    if (!box && t && t.closest && t.closest("input, textarea, select, [contenteditable]")) return;
    const text = (e.clipboardData && e.clipboardData.getData("text")) || "";
    if (!box && !text.includes('"holders"')) return;
    e.preventDefault();
    applyFomo(text, !box);
  });
  window.addEventListener("focus", platBack);

  for (const id of ["list", "others-list"]) {
    $(id).addEventListener("click", (e) => {
      const copy = e.target.closest("[data-copy]");
      if (copy) {
        navigator.clipboard.writeText(copy.dataset.copy).then(() => { copy.textContent = "已拷贝"; }, () => { copy.textContent = "拷贝失败"; });
        return;
      }
      const main = e.target.closest(".row-main");
      if (!main || main.tagName !== "BUTTON") return;
      const li = main.closest(".row");
      const address = li.dataset.addr;
      const opening = !state.open.has(address);
      if (opening) state.open.add(address); else state.open.delete(address);
      const r = (state.data.holders || []).find((h) => h.address === address) || { address, rank: null };
      state.justOpened = opening ? address : "";
      li.outerHTML = rowHtml({ ...r, w: (state.data.wallets || {})[address] });
      state.justOpened = "";
      if (opening) {
        const fresh = $(id).querySelector(`.row[data-addr="${CSS.escape(address)}"]`);
        if (fresh) scrollPage(address);
      }
    });
  }

  $("sig-list").addEventListener("click", (e) => {
    const b = e.target.closest(".sig[data-ca]");
    if (!b) return;
    const url = WLCA.siteUrl(state.settings.site, b.dataset.chain, b.dataset.ca);
    if (e.ctrlKey || e.metaKey || !state.tabId) chrome.tabs.create({ url });
    else chrome.tabs.update(state.tabId, { url });
  });
  $("sig-hours").addEventListener("change", loadSignals);
  $("sig-chain").addEventListener("change", loadSignals);

  $("set-server").addEventListener("change", async (e) => {
    const v = e.target.value.trim().replace(/\/+$/, "") || DEFAULTS.server;
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(v)) { $("set-msg").textContent = "只能填本机地址（127.0.0.1 或 localhost）"; e.target.value = state.settings.server; return; }
    await saveSetting("server", v);
    await send({ type: "wl-clear-cache" });
    $("set-msg").textContent = "";
    state.data = null;
    await ping();
    if (state.page) load();
  });
  $("set-site").addEventListener("change", (e) => { saveSetting("site", e.target.value); renderSignals(); });
  $("set-auto").addEventListener("change", (e) => saveSetting("auto", e.target.checked));
  $("set-badges").addEventListener("change", (e) => saveSetting("badges", e.target.checked));
  if ($("set-panelmode")) $("set-panelmode").addEventListener("change", async (e) => { await saveSetting("panelMode", e.target.value === "float" ? "float" : "side"); panelModeHint(); });
  $("btn-test").addEventListener("click", async () => {
    $("set-msg").textContent = "测试中";
    const r = await ping();
    $("set-msg").textContent = r.ok === false ? r.error : `已连上，接口版本 ${r.version || "?"}`;
  });

  if (!DEV_URL) {
    chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
      if (DEV_TAB || (state.windowId != null && windowId !== state.windowId)) return;
      chrome.tabs.get(tabId).then((tab) => { const same = state.page; setTab(tab); if (same && state.page === same) refreshSoon(); platBack(); }, () => {});
    });
    chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
      if (tabId === state.tabId && (info.url || info.status === "complete")) setTab(tab);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "session" && changes.pendingLookup && changes.pendingLookup.newValue && state.ready) takePending();
    });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === "wl-page-changed" && msg.tabId === state.tabId) {
        const p = WLCA.parse(WLCA.siteUrl("gmgn", msg.chain, msg.ca));
        if (p) setPage({ ...p, known: true });
      }
      if (msg && msg.type === "wl-site-names" && msg.tabId === state.tabId) addSiteNames(msg);
    });
  }

  setInterval(() => {
    if (state.settings.auto === false || document.visibilityState !== "visible") return;
    if (state.tab === "signals") loadSignals();
    if (state.page && !state.loading) load({ quiet: true, fresh: true });
  }, AUTO_MS);

  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { refreshSoon(); platBack(); } });

  new ResizeObserver(() => document.documentElement.style.setProperty("--top-h", `${document.querySelector(".top").offsetHeight}px`))
    .observe(document.querySelector(".top"));
}

(async function init() {
  bind();
  $("tok-logo").addEventListener("error", (e) => { e.target.hidden = true; });
  await loadSettings();
  try { state.windowId = (await chrome.windows.getCurrent()).id; } catch (_) {  }
  ping();
  await syncTab();
  renderAll();
  state.ready = true;
  if (!DEV_URL) takePending();
})();
