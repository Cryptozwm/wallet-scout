importScripts("lib/ca.js");

const DEFAULT_SERVER = "http://127.0.0.1:8787";
const LOOKUP_TTL = 60 * 1000;
const TOKEN_TTL = 30 * 1000;
const lookupCache = new Map();
const tokenCache = new Map();

const MENU_ID = "wl-lookup-address";

async function getPanelMode() {
  const s = await chrome.storage.local.get({ panelMode: "side" });
  return s.panelMode === "float" ? "float" : "side";
}
async function applyActionBehavior() {
  const mode = await getPanelMode();
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: mode !== "float" }).catch(() => {});
  return mode;
}

chrome.runtime.onInstalled.addListener(() => {
  applyActionBehavior();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: "在钱包库查这个地址", contexts: ["selection", "link"] }, () => void chrome.runtime.lastError);
  });
  chrome.tabs.query({ url: SITE_TABS }).then((tabs) => { for (const t of tabs) inject(t.id).catch(() => {}); }).catch(() => {});
  chrome.tabs.query({ url: LOCAL_TABS }).then((tabs) => {
    for (const t of tabs) chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["content/bridge.js"] }).catch(() => {});
  }).catch(() => {});
});

const CONTENT_FILES = ["lib/ca.js", "content/badges.js", "content/float.js"];
async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
  return { ok: true };
}
chrome.runtime.onStartup.addListener(() => {
  applyActionBehavior();
});

let panelModeNow = "side";
applyActionBehavior().then((m) => { panelModeNow = m; }).catch(() => {});

const SITE_URL = /^https:\/\/(?:www\.)?(?:gmgn|debot|ave)\.ai\//;
chrome.action.onClicked.addListener((tab) => {
  const site = tab && tab.id != null && SITE_URL.test(tab.url || "");
  if (panelModeNow === "float" && site) {
    chrome.tabs.sendMessage(tab.id, { type: "wl-float-toggle" }).catch(() => {});
    return;
  }
  if (tab && tab.windowId != null) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.panelMode) return;
  applyActionBehavior();
  const mode = changes.panelMode.newValue === "float" ? "float" : "side";
  panelModeNow = mode;
  chrome.tabs.query({ url: SITE_TABS }).then((tabs) => {
    for (const t of tabs) chrome.tabs.sendMessage(t.id, { type: "wl-float-mode", mode }).catch(() => {});
  }).catch(() => {});
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  if (tab && tab.windowId != null) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  const text = String(info.selectionText || "");
  let address = WLCA.findAddress(text);
  let chain = "";
  if (!address && info.linkUrl) {
    const w = WLCA.parseWallet(info.linkUrl);
    if (w) ({ address, chain } = w);
    else if (!WLCA.parse(info.linkUrl)) address = WLCA.findAddress(info.linkUrl);
  }
  chrome.storage.session.set({ pendingLookup: { address, chain, raw: (text || info.linkUrl || "").slice(0, 200), at: Date.now() } });
});

async function settings() {
  const s = await chrome.storage.local.get({ server: DEFAULT_SERVER, badges: true });
  return { ...s, server: String(s.server || DEFAULT_SERVER).replace(/\/+$/, "") };
}

async function post(path, body, missing = "本机服务还没加载插件接口（要重启本机服务）") {
  const { server } = await settings();
  let resp;
  try {
    resp = await fetch(server + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch (_) {
    throw new Error(`连不到本机服务（${server}）：钱包侦查服务器没开？`);
  }
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 404) throw new Error(missing);
  if (!resp.ok || data.ok === false) throw new Error(data.error || `本机服务回 HTTP ${resp.status}`);
  return data;
}

function sweep(map, ttl) {
  if (map.size < 5000) return;
  const now = Date.now();
  for (const [key, item] of map) if (now - item.at > ttl) map.delete(key);
}

async function lookup({ chain, ca, addresses, fresh = false }) {
  const now = Date.now();
  const items = {};
  const need = [];
  for (const raw of addresses || []) {
    const address = WLCA.norm(raw);
    if (!WLCA.FULL.test(address)) continue;
    const hit = fresh ? null : lookupCache.get(`${chain}|${ca}|${address}`);
    if (hit && now - hit.at < LOOKUP_TTL) {
      if (hit.value) items[address] = hit.value;
    } else need.push(address);
  }
  for (let i = 0; i < need.length; i += 300) {
    const chunk = need.slice(i, i + 300);
    const data = await post("/api/ext/lookup", { chain, ca, addresses: chunk });
    for (const address of chunk) {
      const value = (data.items || {})[address] || null;
      lookupCache.set(`${chain}|${ca}|${address}`, { at: Date.now(), value });
      if (value) items[address] = value;
    }
  }
  sweep(lookupCache, LOOKUP_TTL);
  return { ok: true, items };
}

function token({ chain, ca, holders = true, refresh = false, fresh = false, addresses }) {
  const key = `${chain}|${ca}|${holders ? 1 : 0}`;
  const hit = tokenCache.get(key);
  if (!refresh && !fresh && hit && Date.now() - hit.at < TOKEN_TTL) return hit.promise;
  const promise = post("/api/ext/token", { chain, ca, holders, refresh, addresses: addresses || [] });
  tokenCache.set(key, { at: Date.now(), promise });
  promise.then((data) => {
    for (const [address, value] of Object.entries(data.wallets || {})) lookupCache.set(`${chain}|${ca}|${address}`, { at: Date.now(), value });
    for (const h of data.holders || []) if (!h.hit) lookupCache.set(`${chain}|${ca}|${h.address}`, { at: Date.now(), value: null });
  }, () => tokenCache.delete(key));
  return promise;
}

const sentNames = new Map();
let namesOffUntil = 0;
async function saveSiteNames(msg) {
  if (!msg || !msg.names || Date.now() < namesOffUntil) return;
  const fresh = {};
  for (const [raw, name] of Object.entries(msg.names)) {
    const address = WLCA.norm(raw);
    if (address && name && sentNames.get(address) !== name) fresh[address] = name;
  }
  const list = Object.entries(fresh);
  for (let i = 0; i < list.length; i += 150) {
    const part = Object.fromEntries(list.slice(i, i + 150));
    try {
      const data = await post("/api/ext/names", { chain: msg.chain, ca: msg.ca || "", src: msg.src || "", names: part });
      for (const [a, n] of Object.entries(part)) sentNames.set(a, n);
      for (const address of Object.keys(data.saved || {})) {
        for (const key of [...lookupCache.keys()]) if (key.endsWith(`|${address}`)) lookupCache.delete(key);
      }
      if (Object.keys(data.saved || {}).length) tokenCache.clear();
    } catch (_) {
      namesOffUntil = Date.now() + 10 * 60 * 1000;
      return;
    }
  }
  if (sentNames.size > 20000) for (const k of [...sentNames.keys()].slice(0, 5000)) sentNames.delete(k);
}

const LOCAL_TABS = ["http://127.0.0.1/*", "http://localhost/*"];
const SITE_TABS = ["https://gmgn.ai/*", "https://www.gmgn.ai/*", "https://debot.ai/*", "https://www.debot.ai/*", "https://ave.ai/*", "https://www.ave.ai/*"];
async function mark(msg) {
  const address = WLCA.norm(msg.address);
  const path = msg.type === "wl-star" ? "/api/ext/star" : "/api/ext/tag";
  const body = { chain: msg.chain, ca: msg.ca || "", address, on: msg.on !== false, ...(msg.type === "wl-tag" ? { label: msg.label } : {}) };
  const data = await post(path, body, "本机服务还没加载卡片标记功能（要重启本机服务才有）");
  for (const key of [...lookupCache.keys()]) if (key.endsWith(`|${address}`)) lookupCache.delete(key);
  if (msg.ca) lookupCache.set(`${msg.chain}|${msg.ca}|${address}`, { at: Date.now(), value: data.item || null });
  tokenCache.clear();
  const note = { type: "wl-wallet-changed", address, chain: msg.chain, ca: msg.ca || "", item: data.item || null, from: msg.from || "" };
  chrome.runtime.sendMessage(note).catch(() => {});
  const tabs = await chrome.tabs.query({ url: SITE_TABS }).catch(() => []);
  for (const t of tabs) chrome.tabs.sendMessage(t.id, note).catch(() => {});
  return data;
}

async function platMatch(msg) {
  const body = { ca: String(msg.ca || ""), chain: String(msg.chain || ""), symbol: String(msg.symbol || "").slice(0, 40) };
  if (msg.fomoList) body.fomoList = msg.fomoList;
  if (msg.pumpList) body.pumpList = msg.pumpList;
  const data = await post("/api/match/platform-users", body, "本机服务没有平台比对接口");
  lookupCache.clear(); tokenCache.clear();
  const tabs = await chrome.tabs.query({ url: SITE_TABS }).catch(() => []);
  for (const t of tabs) chrome.tabs.sendMessage(t.id, { type: "wl-refresh" }).catch(() => {});
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const matched = { fomo: rows.filter((r) => r && r.fomoHandle).map((r) => r.address), pump: rows.filter((r) => r && r.pumpName).map((r) => r.address) };
  return { ok: true, status: data.status || {}, library: data.library || null, snapshot: data.snapshotLocal || "", matched };
}

const PUMP_TABS = ["https://pump.fun/*", "https://www.pump.fun/*"];
async function waitTabLoaded(tabId, ms = 30000, site = /^https:\/\/(www\.)?pump\.fun\//, name = "pump.fun") {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) throw new Error(`${name} 分页被关掉了`);
    if (t.status === "complete" && site.test(t.url || "")) return t;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${name} 页 ${Math.round(ms / 1000)} 秒还没载完`);
}
async function pumpFetchInPage(ca, cutoff) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const positions = [];
  let more = false, pages = 0;
  for (let page = 0; page < 40; page += 1) {
    const qs = new URLSearchParams({ sortBy: "TOP", withThesis: "false", pageSize: "50", page: String(page) });
    let j = null;
    for (let k = 0; ; k += 1) {
      let status = 0, text = "";
      try {
        const r = await fetch(`https://frontend-api-v3.pump.fun/mint-positions/${encodeURIComponent(ca)}?${qs}`, { headers: { Accept: "application/json" } });
        status = r.status; text = await r.text();
      } catch (_) { status = 0; }
      if (status >= 200 && status < 300) {
        try { j = JSON.parse(text); } catch (_) { return { ok: false, challenge: true }; }
        break;
      }
      if (status === 403) return { ok: false, challenge: true };
      if (status && status !== 429 && status < 500) return { ok: false, error: `pump.fun 回 HTTP ${status}` };
      if (k >= 3) return { ok: false, error: status ? `pump.fun 一直回 HTTP ${status}` : "连不上 pump.fun" };
      await sleep(3000 * 2 ** k);
    }
    pages += 1;
    const rows = Array.isArray(j && j.positions) ? j.positions.filter((x) => x && typeof x === "object") : [];
    for (const x of rows) {
      positions.push({ userName: x.userName, xUsername: x.xUsername, isVerified: x.isVerified, amountHeld: x.amountHeld,
        pnlUsd: x.pnlUsd, realizedPnlUsd: x.realizedPnlUsd, costBasisUsd: x.costBasisUsd });
    }
    more = Boolean(j && j.hasMore);
    if (!rows.length || !more || (cutoff > 0 && Math.min(...rows.map((x) => Number(x.amountHeld) || 0)) < cutoff)) break;
    await sleep(350);
  }
  return { ok: true, at: Date.now(), positions, pages, more };
}
async function pumpGrab(msg) {
  const ca = String(msg.ca || "").trim();
  if (!/^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(ca)) throw new Error("CA 格式不对");
  const tabs = await chrome.tabs.query({ url: PUMP_TABS }).catch(() => []);
  const same = (u) => { const m = String(u || "").match(/\/coin\/([^/?#]+)/); return Boolean(m) && m[1].toLowerCase() === ca.toLowerCase(); };
  let tab = tabs.find((t) => same(t.url)) || tabs.find((t) => t.status === "complete") || null;
  let opened = false;
  if (!tab) {
    tab = await chrome.tabs.create({ url: `https://pump.fun/coin/${encodeURIComponent(ca)}`, active: false });
    opened = true;
  }
  try {
    await waitTabLoaded(tab.id);
    if (opened) await new Promise((r) => setTimeout(r, 1500));
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pumpFetchInPage, args: [ca, Number(msg.cutoff) || 0] });
    const r = res && res.result;
    if (!r) throw new Error("pump.fun 页没回应");
    if (r.challenge) {
      opened = false;
      await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      return { ok: false, challenge: true, error: "pump.fun 要先过人机验证：已切到 pump.fun 页，验证完回来再按一次「抓名字」" };
    }
    if (!r.ok) return { ok: false, error: r.error || "读 pump.fun 持有人失败" };
    return { ok: true, ca, at: r.at, positions: r.positions, pages: r.pages, more: r.more, borrowed: !opened };
  } finally {
    if (opened) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

const FOMO_TABS = ["https://fomo.family/*", "https://www.fomo.family/*"];
const FOMO_NET = { bsc: { slug: "bnb", nid: 56 }, sol: { slug: "solana", nid: 1399811149 }, robinhood: { slug: "robinhood", nid: 4663 } };
async function fomoFetchInPage(ca, nid) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const token = () => {
    try {
      let t = JSON.parse(localStorage.getItem("privy:token") || "null");
      for (let i = 0; !t && i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (/^privy:[^:]+:token$/.test(k || "")) t = JSON.parse(localStorage.getItem(k) || "null");
      }
      return t;
    } catch (_) { return null; }
  };
  for (let k = 0; k < 3; k += 1) {
    if (k) await sleep(2500);
    const t = token();
    if (!t) { if (k < 2) continue; return { ok: false, login: true }; }
    let r;
    try {
      r = await fetch("https://prod-api.fomo.family/hodlers/top?tokens=" + encodeURIComponent(JSON.stringify([{ address: ca, networkId: nid }])), {
        headers: { Accept: "application/json", "X-Supported-Chains": nid === 56 ? "solana,base,bnb" : "1,56,143,4663,5042,8453,1399811149", Authorization: "Bearer " + t } });
    } catch (_) { if (k < 2) continue; return { ok: false, error: "连不上 FOMO" }; }
    if (r.status === 401) { if (k < 2) continue; return { ok: false, login: true }; }
    if (r.status === 403) return { ok: false, refused: true };
    if (r.status === 429) return { ok: false, error: "FOMO 叫我们慢一点（HTTP 429）：等一两分钟再按" };
    if (!r.ok) return { ok: false, error: `FOMO 回 HTTP ${r.status}` };
    let j;
    try { j = await r.json(); } catch (_) { return { ok: false, refused: true }; }
    const d = (j.responseObject || [])[0] || {};
    return { ok: true, list: { ca: nid === 1399811149 ? ca : ca.toLowerCase(), networkId: nid, at: Date.now(), total: d.totalHolders,
      holders: (d.topHolders || []).map((x) => ({ handle: x.user && x.user.userHandle, followers: x.user && x.user.followers, amount: +x.humanAmount, pnl: x.pnl })) } };
  }
  return { ok: false, error: "读 FOMO 持有人失败" };
}
async function fomoGrabBg(msg) {
  const ca = String(msg.ca || "").trim();
  const net = FOMO_NET[String(msg.chain || "")];
  if (!net) throw new Error("FOMO 只有 BSC、Solana、Robinhood 的币");
  if (!(net.nid === 1399811149 ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ : /^0x[0-9a-fA-F]{40}$/).test(ca)) throw new Error("CA 格式不对");
  const tabs = await chrome.tabs.query({ url: FOMO_TABS }).catch(() => []);
  const same = (u) => String(u || "").toLowerCase().includes(`/tokens/${net.slug}/${ca.toLowerCase()}`);
  let tab = tabs.find((t) => same(t.url)) || tabs.find((t) => t.status === "complete") || null;
  let opened = false;
  if (!tab) {
    tab = await chrome.tabs.create({ url: `https://fomo.family/tokens/${net.slug}/${encodeURIComponent(ca)}`, active: false });
    opened = true;
  }
  try {
    await waitTabLoaded(tab.id, 30000, /^https:\/\/(www\.)?fomo\.family\//, "FOMO");
    if (opened) await new Promise((r) => setTimeout(r, 2500));
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fomoFetchInPage, args: [ca, net.nid] });
    const r = res && res.result;
    if (!r) throw new Error("FOMO 页没回应");
    if (r.login || r.refused) {
      opened = false;
      await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      return { ok: false, login: Boolean(r.login), refused: Boolean(r.refused),
        error: r.login ? "FOMO 没登录（或登录过期）：已切到 FOMO 页，登录后回来再按一次" : "FOMO 拒绝这次读取（HTTP 403）：已切到 FOMO 页，确认有登录、过完验证再按一次" };
    }
    if (!r.ok) return { ok: false, error: r.error || "读 FOMO 持有人失败" };
    return { ok: true, ca, list: r.list, borrowed: !opened };
  } finally {
    if (opened) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function fomoBoardInPage() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const token = () => {
    try {
      let t = JSON.parse(localStorage.getItem("privy:token") || "null");
      for (let i = 0; !t && i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (/^privy:[^:]+:token$/.test(k || "")) t = JSON.parse(localStorage.getItem(k) || "null");
      }
      return t;
    } catch (_) { return null; }
  };
  const want = { "24h": /^pnl_?24h$/i, "7d": /^pnl_?7d$/i, "30d": /^pnl_?30d$/i, all: /^(pnl_?(all|alltime|total)|total_?pnl(_?usd)?)$/i };
  const users = new Map(), periods = {}, skipped = [], pnlKeys = {};
  let why = "";
  const P = ["24h", "7d", "30d", "all"];
  for (let i = 0; i < P.length; i += 1) {
    const p = P[i];
    if (i) await sleep(1200);
    let r = null;
    for (let k = 0; k < 3; k += 1) {
      if (k) await sleep(2500);
      const t = token();
      if (!t) { r = { status: 401 }; continue; }
      try {
        r = await fetch(`https://prod-api.fomo.family/v2/leaderboard${p === "all" ? "" : `/${p}`}?tradeType=spot`, {
          headers: { Accept: "application/json", "X-Supported-Chains": "1,56,143,4663,5042,8453,1399811149", Authorization: "Bearer " + t } });
      } catch (_) { r = null; continue; }
      if (r.status !== 401) break;
    }
    if (!r) { skipped.push(`${p} 连不上`); continue; }
    if (r.status === 401) { if (!users.size) return { ok: false, login: true }; why = "FOMO 登录过期"; break; }
    if (r.status === 403) { if (!users.size) return { ok: false, refused: true }; why = "FOMO 拒绝（HTTP 403）"; break; }
    if (r.status === 429) { why = "FOMO 叫我们慢一点（HTTP 429）"; break; }
    if (!r.ok) { skipped.push(`${p} HTTP ${r.status}`); continue; }
    let j;
    try { j = await r.json(); } catch (_) { skipped.push(`${p} 回的不是 JSON`); continue; }
    const list = j && j.responseObject && Array.isArray(j.responseObject.leaderboard) ? j.responseObject.leaderboard : null;
    if (!list) { skipped.push(`${p} 没有名单`); continue; }
    periods[p] = list.length;
    list.forEach((x, idx) => {
      const hd = x && typeof x.userHandle === "string" ? x.userHandle.trim().slice(0, 40) : "";
      if (!hd) return;
      const key = hd.toLowerCase();
      const tw = x.twitter && typeof x.twitter === "object" ? x.twitter.username || x.twitter.handle || x.twitter.screenName || "" : "";
      const u = users.get(key) || { h: hd, n: String(x.displayName || "").slice(0, 40), f: Number(x.followers) || 0, v: !!x.verified, x: String(tw).slice(0, 20),
        ranks: {}, pnl: {}, pk: {}, hold: [] };
      u.ranks[p] = idx + 1;
      const keys = Object.keys(x).filter((kk) => /pnl/i.test(kk) && typeof x[kk] === "number");
      if (!idx) pnlKeys[p] = Object.keys(x).filter((kk) => /pnl|profit/i.test(kk)).slice(0, 12);
      const pk = keys.find((kk) => want[p].test(kk)) || keys.find((kk) => /^pnl_?(usd|value)?$/i.test(kk));
      if (pk) { u.pnl[p] = Math.round(x[pk]); u.pk[p] = pk; }
      if (!u.hold.length && Array.isArray(x.topHoldings)) {
        u.hold = x.topHoldings.slice(0, 5).filter((t) => t && typeof t.tokenAddress === "string" && typeof t.humanAmount === "number" && t.humanAmount > 0)
          .map((t) => [t.tokenAddress.slice(0, 64), Number(t.networkId) || 0, t.humanAmount]);
      }
      users.set(key, u);
    });
  }
  if (!users.size) return { ok: false, error: `没读到 FOMO 排行榜${[why, ...skipped].filter(Boolean).length ? `（${[why, ...skipped].filter(Boolean).join("、")}）` : ""}` };
  return { ok: true, why: [why, ...skipped].filter(Boolean).join("、"),
    board: { kind: "fomo-board", v: 2, at: Date.now(), tradeType: "spot", periods, pnlKeys, users: [...users.values()] } };
}
async function fomoBoardBg() {
  const tabs = await chrome.tabs.query({ url: FOMO_TABS }).catch(() => []);
  let tab = tabs.find((t) => t.status === "complete") || tabs[0] || null;
  let opened = false;
  if (!tab) {
    tab = await chrome.tabs.create({ url: "https://fomo.family/", active: false });
    opened = true;
  }
  try {
    await waitTabLoaded(tab.id, 30000, /^https:\/\/(www\.)?fomo\.family\//, "FOMO");
    if (opened) await new Promise((r) => setTimeout(r, 2500));
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fomoBoardInPage });
    const r = res && res.result;
    if (!r) throw new Error("FOMO 页没回应");
    if (r.login || r.refused) {
      opened = false;
      await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      return { ok: false, login: Boolean(r.login), refused: Boolean(r.refused),
        error: r.login ? "FOMO 没登录（或登录过期）：已切到 FOMO 页，登录后回来再按一次" : "FOMO 拒绝这次读取（HTTP 403）：已切到 FOMO 页，确认有登录、过完验证再按一次" };
    }
    if (!r.ok) return { ok: false, error: r.error || "读 FOMO 排行榜失败" };
    return { ok: true, board: r.board, why: r.why || "", borrowed: !opened };
  } finally {
    if (opened) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

const PUMP_HOT_ALARM = "wl-pump-hot";
function ensurePumpAlarm() {
  chrome.alarms.get(PUMP_HOT_ALARM).then((a) => { if (!a) chrome.alarms.create(PUMP_HOT_ALARM, { periodInMinutes: 0.5 }); }).catch(() => {});
}
ensurePumpAlarm();
chrome.runtime.onInstalled.addListener(ensurePumpAlarm);
chrome.runtime.onStartup.addListener(ensurePumpAlarm);
async function pumpHotInPage(chains, query) {
  const keys = ["m", "t", "i", "age", "ath", "pl", "lp"];
  const boards = {};
  for (const chain of chains) {
    let status = 0, text = "";
    try {
      const r = await fetch(`/api/indexer/boards/trending?${new URLSearchParams({ ...query, chains: chain })}`, { headers: { Accept: "application/json" } });
      status = r.status; text = await r.text();
    } catch (_) { status = 0; }
    if (status === 403) return { ok: false, challenge: true };
    if (status < 200 || status >= 300) return { ok: false, error: status ? `pump.fun 回 HTTP ${status}` : "连不上 pump.fun" };
    let j = null;
    try { j = JSON.parse(text); } catch (_) { return { ok: false, challenge: true }; }
    const entries = Array.isArray(j && j.entries) ? j.entries.filter((e) => e && typeof e === "object").slice(0, 200) : [];
    boards[chain] = { serverTs: j && j.serverTs, entries: entries.map((e) => Object.fromEntries(keys.map((k) => [k, e[k] == null ? null : e[k]]))) };
  }
  return { ok: true, boards };
}
let pumpHotBusy = false;
async function pumpHotTick() {
  if (pumpHotBusy) return;
  let want;
  try { want = await post("/api/ext/pump-hot-want", {}); } catch (_) { return; }
  if (!want || !want.want) return;
  pumpHotBusy = true;
  let tab = null, opened = false;
  try {
    const tabs = await chrome.tabs.query({ url: PUMP_TABS }).catch(() => []);
    tab = tabs.find((t) => t.status === "complete") || null;
    if (!tab) { tab = await chrome.tabs.create({ url: "https://pump.fun/", active: false }); opened = true; }
    await waitTabLoaded(tab.id);
    if (opened) await new Promise((r) => setTimeout(r, 1500));
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pumpHotInPage, args: [want.chains || [], want.query || {}] });
    const r = res && res.result;
    if (!r || !r.ok) {
      if (r && r.challenge) {
        opened = false;
        await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
        await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      }
      await post("/api/ext/pump-hot", { error: r && r.challenge ? "pump.fun 要先过人机验证：已在 Chrome 切到 pump.fun 页，验证完再挖一次" : (r && r.error) || "pump.fun 页没回应" }).catch(() => {});
      return;
    }
    for (const [chain, b] of Object.entries(r.boards)) await post("/api/ext/pump-hot", { chain, serverTs: b.serverTs, entries: b.entries });
  } catch (err) {
    await post("/api/ext/pump-hot", { error: String((err && err.message) || err).slice(0, 150) }).catch(() => {});
  } finally {
    if (opened && tab) chrome.tabs.remove(tab.id).catch(() => {});
    pumpHotBusy = false;
  }
}
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === PUMP_HOT_ALARM) { pumpHotTick(); selfUpdateBg(); } });

async function selfUpdateBg() {
  try {
    if (pumpHotBusy) return;
    const running = chrome.runtime.getManifest().version;
    const disk = (await (await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" })).json()).version;
    if (!disk || disk === running) return;
    const { selfReload } = await chrome.storage.local.get({ selfReload: null });
    if (selfReload && selfReload.v === disk && Date.now() - selfReload.at < 10 * 60 * 1000) return;
    await chrome.storage.local.set({ selfReload: { v: disk, from: running, at: Date.now(), by: "bg" } });
    chrome.runtime.reload();
  } catch (_) {  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const run = async () => {
    switch (msg && msg.type) {
      case "wl-settings": return { ok: true, ...(await settings()) };
      case "wl-lookup": return lookup(msg);
      case "wl-token": return token(msg);
      case "wl-signals": return post("/api/ext/signals", { hours: msg.hours || 6, chain: msg.chain || "" });
      case "wl-tag":
      case "wl-star": return mark(msg);
      case "wl-wallet-changed": return { ok: true };
      case "wl-inject": return inject(Number(msg.tabId));
      case "wl-whoami": return { ok: true, tabId: sender.tab ? sender.tab.id : null };
      case "wl-ping": {
        const { server } = await settings();
        const resp = await fetch(`${server}/api/ext/ping`).catch(() => null);
        if (!resp) throw new Error(`连不到本机服务（${server}）`);
        if (resp.status === 404) throw new Error("本机服务还没加载插件接口（要重启本机服务）");
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.ok) throw new Error(data.error || `HTTP ${resp.status}`);
        return data;
      }
      case "wl-page":
        if (sender.tab) chrome.runtime.sendMessage({ type: "wl-page-changed", tabId: sender.tab.id, chain: msg.chain, ca: msg.ca }).catch(() => {});
        return { ok: true };
      case "wl-site-names":
        if (sender.tab) chrome.runtime.sendMessage({ ...msg, tabId: sender.tab.id }).catch(() => {});
        saveSiteNames(msg);
        return { ok: true };
      case "wl-clear-cache":
        lookupCache.clear(); tokenCache.clear();
        return { ok: true };
      case "wl-plat-match": return platMatch(msg);
      case "wl-pump-grab": return pumpGrab(msg);
      case "wl-fomo-grab": return fomoGrabBg(msg);
      case "wl-fomo-board": return fomoBoardBg();
      default:
        return { ok: false, error: "不认得的消息" };
    }
  };
  run().then(reply, (err) => reply({ ok: false, error: String((err && err.message) || err) }));
  return true;
});
