"use strict";

function pumpRelay(W, path, name, features, board) {
  if (!/(^|\.)pump\.fun$/.test(location.hostname)) { alert("请在 pump.fun 的页面按这个书签"); return; }
  const readBoard = () => {
    const lists = [];
    const used = new Set();
    for (const head of document.querySelectorAll("*")) {
      if (head.children.length || head.textContent.trim() !== "Leaderboard") continue;
      let p = head;
      for (let i = 0; p && i < 12 && !p.querySelector('a[href*="/profile/"]'); i++) p = p.parentElement;
      if (!p) continue;
      const rows = [];
      let paid = false;
      for (const li of p.querySelectorAll("li")) {
        if (used.has(li)) continue;
        used.add(li);
        const a = li.querySelector('a[href*="/profile/"]');
        const m = a && (a.getAttribute("href") || "").match(/\/profile\/([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})(?:[/?#]|$)/);
        if (!m) continue;
        const parts = String(li.innerText || li.textContent || "").split("\n").map((s) => s.trim()).filter(Boolean);
        const ranked = /^\d+$/.test(parts[0] || "");
        const money = (s) => /^[+\-−]?\$/.test(s);
        let who = String((ranked ? parts[1] : parts[0]) || "");
        if (money(who)) who = "";
        if (parts.some((s) => /笔支付|笔支付|payment/i.test(s))) paid = true;
        const xa = li.querySelector('a[href*="x.com/"],a[href*="twitter.com/"]');
        const xm = xa && (xa.getAttribute("href") || "").match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/);
        rows.push({ rank: ranked ? +parts[0] : rows.length + 1, address: m[1], name: who.slice(0, 60), x: xm ? xm[1] : "",
          value: (parts.slice(ranked ? 2 : 1).find(money) || "").slice(0, 30) });
      }
      if (rows.length) lists.push({ kind: paid ? "获奖者" : "交易者", rows: rows.slice(0, 200) });
    }
    return { at: Date.now(), lists };
  };
  const all = window.__wiPumpRelay || (window.__wiPumpRelay = {});
  const prev = all[name];
  if (prev && prev.pop && !prev.pop.closed) {
    if (board) { try { prev.pop.postMessage({ type: "wi-pump-board", board: readBoard() }, W); } catch (e) {  } }
    prev.pop.focus();
    return;
  }
  if (prev && prev.off) prev.off();
  const pop = window.open(W + path, name, features);
  if (!pop) { alert("浏览器挡了弹出窗口：请允许 pump.fun 开弹出窗口，再按一次书签"); return; }
  const st = { pop, board: board ? readBoard() : null };
  all[name] = st;
  const OK = /^https:\/\/(frontend-api-v3|profile-api)\.pump\.fun\/[^\s#]*$/;
  const send = (m) => { try { if (!pop.closed) pop.postMessage(m, W); } catch (e) {  } };
  const onMsg = async (e) => {
    if (e.origin !== W || e.source !== pop) return;
    const m = e.data || {};
    if (m.type === "wi-pump-hello") { send({ type: "wi-pump-ready", v: 3, board: st.board }); return; }
    if (m.type !== "wi-pump-fetch") return;
    const url = String(m.url || "");
    if (!OK.test(url)) { send({ type: "wi-pump-fetched", id: m.id, status: -1 }); return; }
    let status = 0, json = null, bad = false;
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      status = r.status;
      const text = await r.text();
      try { json = JSON.parse(text); } catch (err) { bad = true; }
    } catch (err) { status = 0; }
    send({ type: "wi-pump-fetched", id: m.id, status, json, bad });
  };
  window.addEventListener("message", onMsg);
  st.off = () => window.removeEventListener("message", onMsg);
}

function fomoGrab(want) {
  (async () => {
    const out = { kind: "wi-fomo", v: 1, at: Date.now() };
    const notes = [];
    const holders = async () => {
      const m = location.pathname.match(/\/tokens\/(bnb|robinhood|solana)\/([0-9a-zA-Z]{32,44})(?:\/|$)/);
      const sol = !!m && m[1] === "solana";
      if (!m || !(sol ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ : /^0x[0-9a-fA-F]{40}$/).test(m[2])) return;
      const nid = { bnb: 56, robinhood: 4663, solana: 1399811149 }[m[1]];
      const ca = m[2];
      const t = JSON.parse(localStorage.getItem("privy:token") || "null");
      if (!t) { notes.push("持有人：没登录 FOMO，抓不到"); return; }
      const r = await fetch("https://prod-api.fomo.family/hodlers/top?tokens=" + encodeURIComponent(JSON.stringify([{ address: ca, networkId: nid }])), {
        headers: { Accept: "application/json", "X-Supported-Chains": nid === 56 ? "solana,base,bnb" : "1,56,143,4663,5042,8453,1399811149", Authorization: "Bearer " + t } });
      const j = await r.json();
      const d = (j.responseObject || [])[0] || {};
      const h = d.topHolders || [];
      out.holders = { ca: sol ? ca : ca.toLowerCase(), networkId: nid, at: Date.now(), total: d.totalHolders,
        holders: h.map((x) => ({ handle: x.user && x.user.userHandle, followers: x.user && x.user.followers, amount: +x.humanAmount, pnl: x.pnl })) };
      notes.push("这颗币 " + out.holders.ca + " 的 FOMO 持有人 " + out.holders.holders.length + " 位 → 回查地址页粘贴比对");
    };
    const hotHolders = async (tokens) => {
      const tk = JSON.parse(localStorage.getItem("privy:token") || "null");
      if (!tk) { notes.push("持有人：没登录 FOMO，这次只抓清单"); return; }
      const nids = { bsc: 56, sol: 1399811149, robinhood: 4663 };
      const box = document.createElement("div");
      box.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:340px;padding:10px 14px;border-radius:8px;"
        + "background:#16191d;color:#e8eaed;font:13px/1.55 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.45)";
      document.body.appendChild(box);
      const hs = {};
      const list = tokens.slice(0, 80);
      let got = 0, why = "";
      for (let i = 0; i < list.length; i++) {
        const x = list[i];
        box.textContent = "顺便抓每颗币的 FOMO 持有人 " + (i + 1) + "/" + list.length + "（还要约 " + Math.ceil((list.length - i) * 1.8) + " 秒，这页先别关）";
        if (i) await new Promise((r) => setTimeout(r, 1500));
        const nid = nids[x.chain];
        let r;
        try {
          r = await fetch("https://prod-api.fomo.family/hodlers/top?tokens=" + encodeURIComponent(JSON.stringify([{ address: x.raw || x.ca, networkId: nid }])), {
            headers: { Accept: "application/json", "X-Supported-Chains": nid === 56 ? "solana,base,bnb" : "1,56,143,4663,5042,8453,1399811149", Authorization: "Bearer " + tk } });
        } catch (e) { continue; }
        if (r.status === 429 || r.status === 401 || r.status === 403) { why = "FOMO 回 HTTP " + r.status + "，抓到第 " + i + " 颗先停"; break; }
        if (!r.ok) continue;
        let j;
        try { j = await r.json(); } catch (e) { continue; }
        const d = (j.responseObject || [])[0] || {};
        hs[x.chain + ":" + x.ca] = { at: Date.now(), total: d.totalHolders,
          list: (d.topHolders || []).map((h) => [h.user && h.user.userHandle, +h.humanAmount, h.user && h.user.followers, h.pnl]).filter((u) => u[0] && u[1] > 0) };
        got++;
      }
      box.remove();
      if (got) out.hot.holders = hs;
      notes.push("其中 " + got + "/" + list.length + " 颗抓到 FOMO 持有人" + (why ? "（" + why + "）" : "") + "，挖的时候顺便对名字");
    };
    const hot = async () => {
      const names = ["\u70ed\u95e8", "\u71b1\u9580", "\u6700\u591a\u4eba\u6301\u6709", "\u5df2\u6bd5\u4e1a", "\u5df2\u7562\u696d", "\u5185\u76d8", "\u5167\u76e4", "Hot", "Trending"];
      const tabs = [...document.querySelectorAll("button,[role=tab]")].filter((b) => names.includes(b.textContent.trim()));
      if (!tabs.length) return;
      let panel = tabs[0];
      for (let i = 0; panel && i < 15 && panel.querySelectorAll('a[href*="/tokens/"]').length < 3; i++) panel = panel.parentElement;
      if (!panel) return;
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
          seen.set(m[1] + ca, { chain: chainOf[m[1]], ca, raw: m[2], symbol: (leaf ? leaf.textContent.trim() : "").slice(0, 40) });
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
      if (!tokens.length) return;
      const tab = on ? on.textContent.trim() : "";
      const n = (c) => tokens.filter((x) => x.chain === c).length;
      out.hot = { kind: "fomo-hot", v: 2, at: Date.now(), tab, tokens: tokens.map((x) => ({ chain: x.chain, ca: x.ca, symbol: x.symbol })) };
      notes.push("FOMO「" + (tab || "代币清单") + "」" + tokens.length + " 颗（BSC " + n("bsc") + "、SOL " + n("sol") + "、RH " + n("robinhood") + "）→ 回挖掘页粘贴");
      if (want === "hot") await hotHolders(tokens);
    };
    const boardGrab = async () => {
      const leaves = [...document.querySelectorAll("body *")].filter((e) => !e.children.length);
      if (!leaves.some((e) => /^(你的排名|your rank)$/i.test(e.textContent.trim()))) return;
      let tk = localStorage.getItem("privy:token") || "";
      try { tk = JSON.parse(tk) || ""; } catch (e) {  }
      if (!tk) { notes.push("排行榜：没登录 FOMO，读不到名单"); return; }
      const seen = performance.getEntriesByType("resource").map((e) => e.name).filter((u) => /^https:\/\/prod-api\.fomo\.family\/v2\/leaderboard\/(24h|7d|30d|all)\b/.test(u)).pop();
      let tt = "spot";
      try { if (seen) tt = (new URL(seen).searchParams.get("tradeType") || tt).replace(/[^\w-]/g, "").slice(0, 20) || "spot"; } catch (e) {  }
      const box = document.createElement("div");
      box.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:340px;padding:10px 14px;border-radius:8px;"
        + "background:#16191d;color:#e8eaed;font:13px/1.55 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.45)";
      document.body.appendChild(box);
      const P = [["24h", "24小时"], ["7d", "7天"], ["30d", "30天"], ["all", "全部"]];
      const users = new Map(), periods = {}, skipped = [];
      let why = "";
      try {
        for (let i = 0; i < P.length; i++) {
          const [p, label] = P[i];
          box.textContent = "读 FOMO 排行榜「" + label + "」（" + (i + 1) + "/4，这页先别关）";
          if (i) await new Promise((r) => setTimeout(r, 1200));
          let r;
          try {
            r = await fetch("https://prod-api.fomo.family/v2/leaderboard/" + p + "?tradeType=" + encodeURIComponent(tt), {
              headers: { Accept: "application/json", "X-Supported-Chains": "1,56,143,4663,5042,8453,1399811149", Authorization: "Bearer " + tk } });
          } catch (e) { skipped.push(label + " 连不上"); continue; }
          if (r.status === 429 || r.status === 401 || r.status === 403) { why = "FOMO 回 HTTP " + r.status; break; }
          if (!r.ok) { skipped.push(label + " HTTP " + r.status); continue; }
          let j;
          try { j = await r.json(); } catch (e) { skipped.push(label + " 回的不是 JSON"); continue; }
          const list = j && j.responseObject && Array.isArray(j.responseObject.leaderboard) ? j.responseObject.leaderboard : null;
          if (!list) { skipped.push(label + " 没有名单"); continue; }
          periods[p] = list.length;
          list.forEach((x, k) => {
            const hd = x && typeof x.userHandle === "string" ? x.userHandle.trim().slice(0, 40) : "";
            if (!hd) return;
            const key = hd.toLowerCase();
            const tw = x.twitter && typeof x.twitter === "object" ? x.twitter.username || x.twitter.handle || x.twitter.screenName || "" : "";
            const u = users.get(key) || { h: hd, n: String(x.displayName || "").slice(0, 40), f: Number(x.followers) || 0, v: !!x.verified, x: String(tw).slice(0, 20), ranks: {}, pnl: {}, hold: [] };
            u.ranks[p] = k + 1;
            const pk = Object.keys(x).find((kk) => /^pnl/i.test(kk) && typeof x[kk] === "number");
            if (pk) u.pnl[p] = Math.round(x[pk]);
            if (!u.hold.length && Array.isArray(x.topHoldings)) {
              u.hold = x.topHoldings.slice(0, 5).filter((t) => t && typeof t.tokenAddress === "string" && typeof t.humanAmount === "number" && t.humanAmount > 0)
                .map((t) => [t.tokenAddress.slice(0, 64), Number(t.networkId) || 0, t.humanAmount]);
            }
            users.set(key, u);
          });
        }
      } finally { box.remove(); }
      if (!users.size) { notes.push("排行榜名单：没读到（" + [why, ...skipped].filter(Boolean).join("、") + "），改做排行榜探查"); return; }
      const all = [...users.values()];
      out.board = { kind: "fomo-board", v: 1, at: Date.now(), tradeType: tt, periods, users: all };
      const sol = all.filter((u) => u.hold.some((t) => t[1] === 1399811149)).length;
      notes.push("FOMO 排行榜：" + P.filter(([p]) => periods[p] != null).map(([p, l]) => l + " " + periods[p] + " 位").join("、") + "，合计 " + all.length + " 人（"
        + sol + " 人有 SOL 持仓）" + (skipped.length ? "（" + skipped.join("、") + "）" : "") + (why ? "（" + why + "，后面的榜先停）" : "")
        + " → 回挖掘页粘贴，会用持仓在链上反查钱包、绑 FOMO 名字");
    };
    const boardProbe = async () => {
      const leaves = [...document.querySelectorAll("body *")].filter((e) => !e.children.length);
      const mine = leaves.find((e) => /^(你的排名|your rank)$/i.test(e.textContent.trim()));
      if (!mine) return;
      let tk = localStorage.getItem("privy:token") || "";
      try { tk = JSON.parse(tk) || ""; } catch (e) {  }
      const abs = (u) => { try { return new URL(u, location.href); } catch (e) { return null; } };
      const short = (u) => { const x = abs(u); return x ? x.host + x.pathname : ""; };
      const isApi = (e) => e.initiatorType === "fetch" || e.initiatorType === "xmlhttprequest";
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const isAddr = (s) => typeof s === "string" && (/^0x[0-9a-fA-F]{40}$/.test(s) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s));
      const secret = /token|auth|secret|session|email|phone|jwt|password|cookie|key/i;
      const bestOf = (j) => {
        let best = null;
        const walk = (v, p, d) => {
          if (d > 6 || !v || typeof v !== "object") return;
          if (Array.isArray(v)) {
            if (v.length && v[0] && typeof v[0] === "object" && (!best || v.length > best.arr.length)) best = { p, arr: v };
            v.slice(0, 3).forEach((x) => walk(x, p + "[]", d + 1));
            return;
          }
          for (const k of Object.keys(v)) walk(v[k], p + "." + k, d + 1);
        };
        walk(j, "$", 0);
        return best;
      };
      const hasHandle = (best) => !!best && /"(userHandle|handle|username|userName)"/.test(JSON.stringify(best.arr.slice(0, 3)));
      const usable = (u) => !/hodlers|price|quote|balance|candle|kline|chart/i.test((abs(u) || {}).pathname || "");
      const old = performance.getEntriesByType("resource");
      const probe = { v: 4, at: Date.now(), page: location.pathname, perf: old.length, hosts: {}, endpoints: [], ranges: [], onGuess: "", clicked: [], fresh: [], rows: [] };
      out.probe = probe;
      try { performance.setResourceTimingBufferSize(5000); } catch (e) {  }
      const fresh = [], got = [];
      let po = null;
      try { po = new PerformanceObserver((l) => l.getEntries().forEach((e) => fresh.push(e))); po.observe({ type: "resource" }); } catch (e) { po = null; }
      const RJ = Response.prototype.json, RT = Response.prototype.text, XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
      Response.prototype.json = function () {
        const p = RJ.apply(this, arguments), url = this.url, status = this.status;
        p.then((j) => got.push({ url, status, json: j })).catch(() => {});
        return p;
      };
      Response.prototype.text = function () {
        const p = RT.apply(this, arguments), url = this.url, status = this.status;
        p.then((t) => got.push({ url, status, text: t })).catch(() => {});
        return p;
      };
      XMLHttpRequest.prototype.open = function (m, u) { this.__wiUrl = abs(u); return XO.apply(this, arguments); };
      XMLHttpRequest.prototype.send = function () {
        this.addEventListener("load", () => {
          try {
            if (!this.__wiUrl) return;
            if (this.responseType === "json") got.push({ url: this.__wiUrl.href, status: this.status, json: this.response });
            else if (this.responseType === "" || this.responseType === "text") got.push({ url: this.__wiUrl.href, status: this.status, text: this.responseText });
          } catch (e) {  }
        });
        return XS.apply(this, arguments);
      };
      const parsed = (g) => { if (g.json !== undefined) return g.json; try { return JSON.parse(g.text); } catch (e) { return null; } };
      const listIn = () => {
        let res = null;
        for (const g of got) {
          if (!g.url || !usable(g.url)) continue;
          const best = bestOf(parsed(g));
          if (hasHandle(best) && (!res || best.arr.length > res.best.arr.length)) res = { url: g.url, status: g.status, best, via: "FOMO 自己问的" };
        }
        return res;
      };
      const RANGE = /^(24h|1d|7d|30d|90d|all|all time|24小时|24小时|1天|7天|30天|90天|全部|今日|今天|本周|本周|本月)$/i;
      const rowOf = (box) => {
        const cand = [...box.querySelectorAll("button,[role=tab],[role=radio]")]
          .filter((x) => RANGE.test(x.textContent.trim()) && !x.hasAttribute("aria-haspopup") && !x.hasAttribute("aria-expanded"));
        for (const up of [1, 2]) {
          const g = new Map();
          for (const x of cand) {
            let k = x;
            for (let i = 0; i < up && k; i++) k = k.parentElement;
            if (k) g.set(k, (g.get(k) || []).concat(x));
          }
          const top = [...g.values()].sort((p, q) => q.length - p.length)[0] || [];
          if (top.length >= 2) return top;
        }
        return [];
      };
      let box = mine, btns = [];
      for (let i = 0; box && i < 14 && btns.length < 2; i++) { box = box.parentElement; if (box) btns = rowOf(box); }
      probe.ranges = btns.map((x) => x.textContent.trim());
      let on = btns.find((x) => x.getAttribute("aria-selected") === "true" || x.getAttribute("aria-checked") === "true" || x.getAttribute("aria-pressed") === "true"
        || x.dataset.state === "active" || x.dataset.state === "on" || x.dataset.state === "checked");
      if (!on && btns.length >= 2) {
        const key = (x) => { const s = getComputedStyle(x); return [s.backgroundColor, s.color, s.fontWeight, s.borderTopColor, s.boxShadow].join("|"); };
        const ks = btns.map(key);
        const odd = btns.filter((x, i) => ks.filter((k) => k === ks[i]).length === 1);
        if (odd.length === 1) on = odd[0];
      }
      probe.onGuess = on ? on.textContent.trim() : "";
      let pickRes = null;
      try {
        if (on) {
          for (const x of btns.filter((y) => y !== on).slice(0, 3)) {
            const n0 = got.length + fresh.length;
            x.click();
            probe.clicked.push(x.textContent.trim());
            for (let t = 0; t < 4000 && got.length + fresh.length === n0; t += 100) await sleep(100);
            await sleep(800);
            if ((pickRes = listIn())) break;
          }
          on.click();
          probe.clicked.push(on.textContent.trim() + "（点回原本的）");
          await sleep(300);
        }
        pickRes = pickRes || listIn();
      } finally {
        Response.prototype.json = RJ;
        Response.prototype.text = RT;
        XMLHttpRequest.prototype.open = XO;
        XMLHttpRequest.prototype.send = XS;
        if (po) po.disconnect();
      }
      const all = old.concat(fresh).filter(isApi);
      for (const e of all) { const h = (abs(e.name) || {}).host || "?"; probe.hosts[h] = (probe.hosts[h] || 0) + 1; }
      probe.endpoints = [...new Set(all.map((e) => short(e.name)))].slice(-60);
      probe.fresh = [...new Set(fresh.filter(isApi).map((e) => short(e.name)).concat(got.map((g) => short(g.url))))].slice(0, 40);
      if (!pickRes) {
        const byPath = new Map();
        for (const e of all) { const x = abs(e.name); if (x && usable(e.name) && /leader|rank|trader|pnl/i.test(x.pathname)) { byPath.delete(x.host + x.pathname); byPath.set(x.host + x.pathname, e.name); } }
        const cands = [...byPath.values()].slice(-5);
        if (!cands.length) {
          notes.push("排行榜探查：没找到排行榜的接口（" + (!btns.length ? "也没找到 7天／30天 这种按钮" : !on ? "看不出哪个时间范围是选中的，没点" : "点了「" + probe.clicked.join("、") + "」也没看到")
            + "；这页记到 " + all.length + " 笔接口请求），已记下诊断 → 回挖掘页粘贴");
          return;
        }
        probe.tried = [];
        let score = -1;
        for (const u of cands) {
          if (probe.tried.length) await sleep(500);
          let r, j = null;
          try { r = await fetch(u, { headers: { Accept: "application/json", "X-Supported-Chains": "1,56,143,4663,5042,8453,1399811149", ...(tk ? { Authorization: "Bearer " + tk } : {}) } }); }
          catch (e) { probe.tried.push({ path: short(u), error: String(e.message).slice(0, 80) }); continue; }
          try { j = await r.json(); } catch (e) {  }
          const best = bestOf(j);
          const hh = hasHandle(best);
          probe.tried.push({ path: short(u), status: r.status, list: best ? best.arr.length : 0, handle: hh, keys: j && typeof j === "object" ? Object.keys(j).slice(0, 12) : [] });
          const sc = best ? (hh ? 1e6 : 0) + best.arr.length : 0;
          if (!pickRes || sc > score) { pickRes = { url: u, status: r.status, best, via: "用这页登录重问" }; score = sc; }
        }
        if (!pickRes) { notes.push("排行榜探查：排行榜接口都问不到（" + probe.tried.length + " 个），已记下诊断 → 回挖掘页粘贴"); return; }
      }
      const q = new URL(pickRes.url);
      probe.endpoint = q.pathname;
      probe.host = q.host;
      probe.via = pickRes.via;
      probe.status = pickRes.status;
      probe.params = [...q.searchParams].map(([k, v]) => [k, /token|auth|sig|key/i.test(k) ? "(略)" : v.slice(0, 40)]);
      const best = pickRes.best;
      if (!best) {
        probe.note = "回应里没有名单";
        notes.push("排行榜探查：试了 " + ((probe.tried || []).length || 1) + " 个接口都没读到名单（最后是 " + probe.endpoint + " HTTP " + probe.status + "），已记下诊断 → 回挖掘页粘贴");
        return;
      }
      const flat = (v, p, d, f) => {
        if (v && typeof v === "object" && !Array.isArray(v) && d < 5) { for (const k of Object.keys(v)) flat(v[k], p ? p + "." + k : k, d + 1, f); return; }
        f(p, v);
      };
      const shape = {};
      const hush = /auth|secret|session|email|phone|jwt|password|cookie|accesstoken|refreshtoken|apikey|privatekey/i;
      const skip = /thumbhash|image|icon|logo|link|avatar|picture|description|bio/i;
      const inner = {};
      for (const row of best.arr.slice(0, 150)) {
        const addrs = {}, arrays = {};
        let handle = "";
        flat(row, "", 0, (p, v) => {
          shape[p] = shape[p] || (Array.isArray(v) ? "array(" + v.length + ")" : v === null ? "null" : typeof v);
          if (isAddr(v)) addrs[p] = v;
          if (Array.isArray(v)) v.slice(0, 20).forEach((x, i) => { if (isAddr(x)) addrs[p + "[" + i + "]"] = x; });
          if (!handle && typeof v === "string" && /handle|username/i.test(p)) handle = v.slice(0, 40);
          if (Array.isArray(v) && v.length && v[0] && typeof v[0] === "object" && !Array.isArray(v[0])) {
            arrays[p] = v.slice(0, 5).map((it) => {
              const o = {};
              flat(it, "", 0, (p2, v2) => {
                if (skip.test(p2)) return;
                inner[p + "[]." + p2] = inner[p + "[]." + p2] || (Array.isArray(v2) ? "array" : v2 === null ? "null" : typeof v2);
                o[p2] = hush.test(p2) && !isAddr(v2) ? "(略)" : typeof v2 === "string" ? v2.slice(0, 80) : Array.isArray(v2) ? "array(" + v2.length + ")" : v2;
              });
              return o;
            });
          }
        });
        probe.rows.push({ handle, addrs, ...(Object.keys(arrays).length ? { arrays } : {}) });
      }
      probe.inner = Object.fromEntries(Object.entries(inner).slice(0, 150));
      probe.list = best.p;
      probe.count = best.arr.length;
      probe.shape = Object.fromEntries(Object.entries(shape).slice(0, 150));
      const sample = {};
      flat(best.arr[0], "", 0, (p, v) => {
        sample[p] = secret.test(p) && !isAddr(v) ? "(略)" : typeof v === "string" ? v.slice(0, 80) : Array.isArray(v) ? "array(" + v.length + ")" : v;
      });
      probe.sample = sample;
      const withAddr = probe.rows.filter((x) => Object.keys(x.addrs).length).length;
      notes.push("FOMO 排行榜探查：接口 " + probe.endpoint + "（HTTP " + probe.status + "，" + probe.via + "）" + probe.count + " 位，其中 " + withAddr + " 位带钱包地址"
        + "，" + probe.rows.filter((x) => x.arrays).length + " 位带持仓明细 → 回挖掘页粘贴");
    };
    await Promise.all([want !== "hot" ? holders().catch((e) => notes.push("持有人：失败 " + e.message)) : null,
      want !== "hold" ? hot().catch((e) => notes.push("热门清单：失败 " + e.message)) : null]);
    if (want === "hot" && !out.hot) {
      await boardGrab().catch((e) => notes.push("排行榜名单：失败 " + e.message));
      if (!out.board) await boardProbe().catch((e) => notes.push("排行榜探查：失败 " + e.message));
    }
    if (!out.holders && !out.hot && !out.probe && !out.board) {
      const where = want === "hot" ? "在 FOMO 左边点「代币 → 热门」，清单开着再按「热门」（开着「排行榜」按＝读排行榜绑名字）"
        : want === "hold" ? "到这颗币的 FOMO 币页（网址 /tokens/…）再按「持币」"
        : "到任一颗币的 FOMO 页（要看热门就在左边点「代币 → 热门」）再按";
      alert("这页没有东西可以抓" + (notes.length ? "（" + notes.join("；") + "）" : "") + "：" + where);
      return;
    }
    const text = JSON.stringify(out);
    let tk0 = localStorage.getItem("privy:token") || "";
    try { tk0 = JSON.parse(tk0) || ""; } catch (e) {  }
    if (typeof tk0 === "string" && tk0.length > 20 && text.includes(tk0)) { alert("结果里出现登录凭证，已停止、什么都没拷贝"); return; }
    const done = "已拷贝（不含登录凭证）：\n" + notes.join("\n") + "\n粘贴可以按页面上的「从剪贴板粘贴」，或直接 Ctrl+V";
    try {
      await navigator.clipboard.writeText(text);
      alert(done);
    } catch (e) {
      const b = document.createElement("button");
      b.textContent = "抓好了，点这里拷贝结果";
      b.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;padding:10px 16px;border:0;border-radius:8px;"
        + "background:#f0b90b;color:#0b0e11;font:600 14px/1.4 system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.45)";
      b.onclick = async () => {
        b.remove();
        try { await navigator.clipboard.writeText(text); alert(done); } catch (err) { prompt("浏览器不让书签直接拷贝，请按 Ctrl+C 拷贝下面这段：" + notes.join("；"), text); }
      };
      document.body.appendChild(b);
    }
  })();
}

function wiDispatch(W, kind, relay, fomo) {
  const h = location.hostname;
  const onPump = /(^|\.)pump\.fun$/.test(h), onFomo = /(^|\.)fomo\.family$/.test(h);
  const label = { hold: "持币", hot: "热门", pnl: "盈利" }[kind] || "钱包侦查";
  if (kind === "pnl") {
    if (onPump) return relay(W, "/pump-sync.html", "wi_pump_relay", "width=600,height=780", true);
    if (onFomo) return alert("「盈利」目前只有 pump.fun：到任何 pump.fun 页按。FOMO 帐号盈利还没做");
  } else if (kind === "hold") {
    if (onPump) {
      const m = location.pathname.match(/\/coin\/([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})(?:[/?#]|$)/);
      if (!m) return alert("「持币」要在 pump.fun 的币页（网址 pump.fun/coin/…）按");
      return relay(W, "/analyze.html?q=" + encodeURIComponent(m[1]) + "&pump=1", "wi_pump_hold_" + m[1].slice(-12), "");
    }
    if (onFomo) return fomo("hold");
  } else if (kind === "hot") {
    if (onFomo) return fomo("hot");
    if (onPump) return alert("「热门」目前只认 FOMO：到 FOMO 左边点「代币 → 热门」再按。pump.fun 热门还没接上书签");
  }
  alert("「" + label + "」书签要在 FOMO（fomo.family）或 pump.fun 的页面按");
}

function wiBookmarklet(origin, kind) {
  const k = ["hold", "hot", "pnl"].includes(kind) ? kind : "hold";
  const relay = k === "hot" ? "null" : pumpRelay.toString();
  const fomo = k === "pnl" ? "null" : k === "hot" ? fomoGrab.toString() : fomoGrab.toString().replace(/\/\*<board>\*\/[\s\S]*?\/\*<\/board>\*\//g, "");
  return "javascript:" + encodeURIComponent("(" + wiDispatch.toString() + ")(" + JSON.stringify(origin) + "," + JSON.stringify(k) + "," + relay + "," + fomo + ")");
}

function wiRelayClient() {
  const PUMP = /^https:\/\/([a-z0-9-]+\.)*pump\.fun$/;
  const GAP = 350, REPLY_MS = 60000;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waiting = new Map();
  let origin = "", seq = 0, last = 0, settled = false, settle = null, boardFn = null;
  const ready = new Promise((resolve) => { settle = (v) => { if (!settled) { settled = true; resolve(v); } }; });
  const gone = () => !window.opener || window.opener.closed;
  window.addEventListener("message", (e) => {
    if (!window.opener || e.source !== window.opener || !PUMP.test(e.origin)) return;
    if (origin && e.origin !== origin) return;
    const m = e.data || {};
    if (m.type === "wi-pump-fetched") {
      const done = waiting.get(m.id);
      if (done) { waiting.delete(m.id); done(m); }
      return;
    }
    if (m.type === "wi-pump-board") { if (origin && boardFn) boardFn(m.board); return; }
    if (m.type === "wi-pump-ready" && !origin && !settled) {
      if (!(m.v >= 2)) { settle({ old: true }); return; }
      origin = e.origin;
      settle({ ok: true, v: m.v, board: m.board || null });
    }
  });
  let tries = 0;
  const hello = () => {
    if (origin || settled) return;
    tries += 1;
    if (tries > 8 || gone()) { settle({ none: true }); return; }
    try { window.opener.postMessage({ type: "wi-pump-hello" }, "*"); } catch (e) {  }
    setTimeout(hello, 500);
  };
  if (gone()) settle({ none: true }); else hello();
  const relay = (url) => new Promise((resolve) => {
    const id = ++seq;
    const t = setTimeout(() => { waiting.delete(id); resolve({ status: 0, timeout: true }); }, REPLY_MS);
    waiting.set(id, (m) => { clearTimeout(t); resolve(m); });
    try { window.opener.postMessage({ type: "wi-pump-fetch", id, url }, origin); } catch (e) { clearTimeout(t); waiting.delete(id); resolve({ status: 0 }); }
  });
  async function get(url, hooks = {}) {
    for (let k = 0; ; k += 1) {
      if (hooks.stopped && hooks.stopped()) throw new Error("已停止");
      if (gone()) throw Object.assign(new Error("pump.fun 页关掉了"), { fatal: true, gone: true });
      const wait = GAP - (Date.now() - last);
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const r = await relay(url);
      const status = r.status;
      if (status >= 200 && status < 300) {
        if (r.bad) throw Object.assign(new Error("pump.fun 回的不是数据，可能要先过人机验证：在 pump.fun 页刷新、验证完再按一次书签"), { fatal: true });
        return r.json;
      }
      if (status === -1) throw Object.assign(new Error("书签不肯查这个网址"), { fatal: true });
      if (status === 403) throw Object.assign(new Error("pump.fun 挡下来了（HTTP 403），可能要先过人机验证：在 pump.fun 页刷新、验证完再按一次书签"), { fatal: true });
      if (status && status !== 429 && status < 500) throw Object.assign(new Error("pump.fun 回 HTTP " + status), { status });
      if (k >= 4) {
        if (r.timeout) throw Object.assign(new Error("pump.fun 页一直没回应（是不是换页了？）"), { fatal: true });
        throw new Error(status ? "pump.fun 一直回 HTTP " + status : "连不上 pump.fun");
      }
      const secs = 5 * 2 ** k;
      if (hooks.wait) hooks.wait("pump.fun 叫我们慢一点（" + (status ? "HTTP " + status : r.timeout ? "没回应" : "连接失败") + "），等 " + secs + " 秒再继续…");
      await sleep(secs * 1000);
    }
  }
  return { ready, get, gone, onBoard: (fn) => { boardFn = fn; } };
}

if (typeof module === "object" && module.exports) module.exports = { pumpRelay, fomoGrab, wiDispatch, wiBookmarklet, wiRelayClient };
