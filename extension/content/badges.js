(() => {
  "use strict";
  document.dispatchEvent(new CustomEvent("wl-badges-takeover"));
  const life = new AbortController();
  const listen = (target, type, fn, capture = false) => target.addEventListener(type, fn, { capture, signal: life.signal });
  const alive = () => { if (window.__wlSend) return true; try { return Boolean(chrome.runtime && chrome.runtime.id); } catch (_) { return false; } };

  const HOST = location.hostname.replace(/^www\./, "");
  const TAG = "wl-mark";
  const CARD_TAG = "wl-mark-card";
  const legacyCss = document.createElement("style");
  legacyCss.textContent = "wl-badge, wl-card { display: none !important; }";
  (document.head || document.documentElement).appendChild(legacyCss);
  const HIDE_IN_BADGE = new Set(["whale", "top_holder", "bluechip", "transfer_in"]);
  const GROUP_ORDER = { avoid: 0, follow: 1, custom: 2, ref: 3 };
  const ME = `card-${Math.random().toString(36).slice(2)}`;

  const send = window.__wlSend || ((msg) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (reply) => {
        void chrome.runtime.lastError;
        resolve(reply || { ok: false, error: "插件背景没回应" });
      });
    } catch (err) {
      resolve({ ok: false, error: String(err) });
    }
  }));

  function stackAfter(el, stop) {
    for (let child = el, p = el.parentElement; p && child !== stop; child = p, p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === "block" || s.display === "flow-root" || s.display === "list-item" || (/flex/.test(s.display) && s.flexDirection.startsWith("column"))) return child;
    }
    return null;
  }

  const FOREIGN = /frontrun|wl-badge|wl-mark|wlb-/i;
  function siteText(el) {
    if (!el) return "";
    const own = (x) => FOREIGN.test(`${x.tagName} ${x.getAttribute("class") || ""} ${x.id || ""}`);
    if (![...el.querySelectorAll("*")].some(own)) return el.textContent;
    const copy = el.cloneNode(true);
    for (const x of [...copy.querySelectorAll("*")]) if (own(x)) x.remove();
    return copy.textContent;
  }

  const ADAPTERS = {
    "gmgn.ai": {
      rows() {
        const out = [];
        for (const row of document.querySelectorAll("[data-recycler-key]")) {
          const maker = row.querySelector('[data-testid="table-cell-maker"]');
          if (maker) {
            const link = maker.querySelector('a[href*="/address/"]');
            const m = link && (link.getAttribute("href") || "").match(/\/address\/(?:[A-Za-z0-9]+_)?(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})(?![0-9A-Za-z])/);
            const place = maker.querySelector(".truncate");
            if (m && place) out.push({ address: WLCA.norm(m[1]), row, place, inline: true, site: siteText(place) });
            continue;
          }
          const address = WLCA.norm(String(row.getAttribute("data-recycler-key") || "").split("-")[0]);
          if (!WLCA.FULL.test(address)) continue;
          const cell = row.querySelector('[data-testid="table-cell-holder"], [data-testid="table-cell-trader"]') || row.querySelector('[data-testid^="table-cell"]');
          if (!cell) continue;
          const name = cell.querySelector(".truncate") || cell.querySelector('[class*="text-[13px]"]');
          const line = name && stackAfter(name, cell);
          if (line) out.push({ address, row, place: line, site: siteText(name) });
        }
        return out;
      },
      list() {
        const els = [...document.querySelectorAll(".g-table-recycler-scroll")].filter((el) => el.getClientRects().length);
        const pick = els.find((el) => el.closest('[data-testid="top-holders-table"]')) || els[0];
        return pick ? pick.closest('[data-testid$="-table"]') || pick : null;
      },
      pageCa() {
        const el = document.querySelector("#token-base-address[data-addr]");
        return el ? el.getAttribute("data-addr") : "";
      },
    },
    "debot.ai": {
      rows() {
        const out = [];
        for (const row of document.querySelectorAll("tbody tr")) {
          const links = [...row.querySelectorAll('a[href*="/address/"]')];
          const href = links.length ? links[0].getAttribute("href") : "";
          const m = href.match(/\/address\/[a-z]+\/(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})/);
          if (!m) continue;
          const name = links.find((a) => a.getAttribute("href") === href && !a.querySelector("img") && !/^\d*$/.test(a.textContent.trim()));
          out.push({ address: WLCA.norm(m[1]), row, place: (name && name.parentElement) || links[0], site: name ? siteText(name) : "" });
        }
        return out;
      },
    },
    "ave.ai": {
      needsToken: true,
      rows(resolve) {
        const out = [];
        for (const tr of document.querySelectorAll("tr.el-table__row")) {
          const span = tr.querySelector("span.remark-com-address");
          if (!span) continue;
          const address = aveAddress(tr, span, resolve);
          if (!address) continue;
          const remark = span.closest(".remark-com");
          const place = (remark && remark.parentElement) || span;
          out.push({ address, row: tr, place });
        }
        return out;
      },
      guess(rank, pct, resolve) {
        if (!rank || pct == null || !isFinite(pct)) return null;
        let best = null;
        for (const tr of document.querySelectorAll("tr.el-table__row")) {
          const span = tr.querySelector("span.remark-com-address");
          if (!span || aveAddress(tr, span, resolve)) continue;
          const no = parseInt(((tr.children[0] && tr.children[0].innerText) || "").trim(), 10);
          if (!no || Math.abs(no - rank) > 3) continue;
          const m = (tr.innerText || "").match(/([\d.]+)%\s*\/\s*\$/);
          const p = m ? Number(m[1]) : NaN;
          if (!isFinite(p) || Math.abs(p - pct) > Math.max(0.02, pct * 0.08)) continue;
          if (best) return null;
          best = tr;
        }
        return best ? { row: best } : null;
      },
    },
  };
  function aveAddress(tr, span, resolve) {
    const short = resolve(span.textContent);
    if (short) return short;
    const cell = span.closest("td") || tr.children[0];
    for (const img of cell ? cell.querySelectorAll("img[src]") : []) {
      const m = (img.getAttribute("src") || "").match(/\/(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})_\d+x\d+\./);
      if (m) return WLCA.norm(m[1]);
    }
    return "";
  }
  const adapter = ADAPTERS[HOST];
  if (!adapter) return;

  let page = null;
  let info = new Map();
  let candidates = [];
  let pending = false;
  let enabled = true;
  let lastError = "";
  let failAt = 0;
  const REFRESH_MS = 20000;
  let lastFresh = Date.now();
  let forceFresh = false;
  const SITE ={ "gmgn.ai": "GMGN", "debot.ai": "DeBot", "ave.ai": "Ave" }[HOST] || "site";
  const siteNames = new Map();
  let siteNew = {};
  let siteTimer = 0;
  const siteOf = (address) => (siteNames.has(address) ? { name: siteNames.get(address), src: SITE } : null);
  function noteSiteNames(rows) {
    for (const r of rows) {
      const text = String(r.site || "").split(/[\u200b-\u200d\u2060\ufeff]/)[0].replace(/\s+/g, " ").trim();
      if (!text || text.length > 40 || WLCA.isShortAddr(text) || siteNames.get(r.address) === text) continue;
      siteNames.set(r.address, text);
      siteNew[r.address] = text;
    }
    if (siteNames.size > 3000) for (const k of [...siteNames.keys()].slice(0, 1000)) siteNames.delete(k);
    if (Object.keys(siteNew).length && !siteTimer) {
      siteTimer = setTimeout(() => {
        siteTimer = 0;
        const names = siteNew;
        siteNew = {};
        if (page) send({ type: "wl-site-names", chain: page.chain, ca: page.ca, src: SITE, names });
      }, 800);
    }
  }

  const currentPage = () => {
    const p = WLCA.parse(location.href);
    if (p) return p;
    const ca = adapter.pageCa && adapter.pageCa();
    return ca ? WLCA.parse(`https://${HOST}/bsc/token/${ca}`) : null;
  };

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const usd = (v, sign = true) => {
    if (v == null || !isFinite(v)) return "";
    const a = Math.abs(v);
    const s = a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K` : `$${a.toFixed(a >= 100 ? 0 : 1)}`;
    return (v < 0 ? "−" : sign && v > 0 ? "+" : "") + s;
  };
  const pct = (v) => (v == null || !isFinite(v) ? "" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(0)}%`);
  const time = (ts) => (ts ? new Date(ts * 1000).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
  const short = (s, n) => (String(s || "").length > n ? `${String(s).slice(0, n)}…` : String(s || ""));
  const platText = (p) => (p === "pump.fun" ? "pump" : p);

  function badgeChips(w) {
    const chips = [];
    const ni = WLCA.nameInfo(w);
    if (w.avoid) chips.push({ cls: "av", text: w.bot && !w.labels.some((l) => l.group === "avoid" && l.id !== "bot") ? "机器人" : "避开" });
    const plat = (w.platforms || [])[0];
    if (plat) chips.push({ cls: "pf", text: platText(plat.platform) });
    if (w.private && !w.private.own && ni.src !== "private") chips.push({ cls: w.private.kind && ["bundle", "bad", "bot"].includes(w.private.kind) ? "av" : "pv", text: short(w.private.label, 8) });
    if (w.private && w.private.own) chips.push({ cls: "pv", text: "我的" });
    const labels = (w.labels || [])
      .filter((l) => !HIDE_IN_BADGE.has(l.id) && !(plat && (l.id === "fomo_user" || l.id === "pump_user")) && !(w.avoid && l.id === "bot") && !(ni.src === "label" && l.id === ni.id))
      .sort((a, b) => (GROUP_ORDER[a.group] ?? 9) - (GROUP_ORDER[b.group] ?? 9));
    labels.slice(0, 2).forEach((l) => chips.push({ cls: l.group === "avoid" ? "av" : l.group === "follow" ? "fo" : "rf", text: short(l.text, 7) }));
    if (labels.length > 2) chips.push({ cls: "more", text: `+${labels.length - 2}` });
    if (!w.lib && w.trade && !(w.sm && w.sm.watch)) chips.push({ cls: "rf", text: `聪明钱买 ${usd(w.trade.buy, false)}` });
    return chips;
  }

  const badgeName = (w) => WLCA.nameInfo(w).name;

  const plainName = (s) => String(s || "").split(/[​-‍⁠﻿]/)[0].replace(/\s+/g, "").toLowerCase();
  const sameAsSite = (name, site) => Boolean(name && site && plainName(name) === plainName(site));

  function badgeHtml(w, inline, site) {
    const g = w.grade ? `<i class="g g-${esc(w.grade)}">${esc(w.grade)}</i>` : "";
    const all = badgeChips(w);
    const other = Boolean(g || all.length || (w.here && w.here.total != null));
    let name = inline && (g || all.length) ? "" : badgeName(w) || (other ? "" : "钱包库");
    if (other && sameAsSite(name, site)) name = "";
    const here = w.here && w.here.total != null ? `<span class="pn ${w.here.total >= 0 ? "up" : "dn"}">${usd(w.here.total)}</span>` : "";
    const star = w.sm && w.sm.watch ? `<span class="st">★</span>` : "";
    const list = inline && all.length > 1 ? [all[0], { cls: "more", text: `+${all.length - 1}` }] : all;
    const chips = list.map((c) => `<span class="c ${c.cls}">${esc(c.text)}</span>`).join("");
    return `<span class="b${w.avoid ? " is-avoid" : ""}${w.quiet ? " is-quiet" : ""}">${g}${name ? `<b class="nm">${esc(short(name, 10))}</b>` : ""}${chips}${here}${star}</span>`;
  }

  const BADGE_CSS = `
    :host { all: initial; display: block; margin-top: 2px; line-height: 0; pointer-events: auto; }
    :host([inline]) { margin: 0 0 0 4px; align-self: center; flex: 0 1 auto; min-width: 0; max-width: 132px; overflow: hidden; }
    .b { display: inline-flex; align-items: center; gap: 3px; max-width: 100%; height: 17px; padding: 0 4px 0 2px; border-radius: 4px;
         background: #1e2329; box-shadow: inset 0 0 0 1px #2b3139; color: #eaecef; cursor: pointer; overflow: hidden; white-space: nowrap;
         font: 500 11.5px/17px "Segoe UI Variable Text", "Segoe UI", "Noto Sans TC", "Microsoft JhengHei", sans-serif; }
    .b:hover { box-shadow: inset 0 0 0 1px #474d57; }
    .b.is-avoid { box-shadow: inset 0 0 0 1.5px #f6465d; background: rgba(246, 70, 93, 0.10); }
    .b.is-quiet { opacity: 0.75; }
    .g { display: inline-grid; place-items: center; width: 14px; height: 14px; border-radius: 3px; font: 700 10.5px/14px Bahnschrift, "Segoe UI", sans-serif;
         font-style: normal; color: #0b0e11; background: #848e9c; flex: none; }
    .g-S { background: #f0b90b; } .g-A { background: #e8cf7d; } .g-B { background: #5b9cf6; color: #fff; } .g-C { background: #848e9c; } .g-D { background: #474d57; color: #eaecef; }
    .nm { font-weight: 600; color: #eaecef; overflow: hidden; text-overflow: ellipsis; flex: none; }
    .nm.squeeze { flex: 0 1 auto; min-width: 2.5em; }
    [hidden] { display: none !important; }
    .c { padding: 0 4px; border-radius: 3px; background: #262b33; color: #b7bdc6; font-size: 11px; line-height: 15px; flex: none; }
    .c.av { background: rgba(246, 70, 93, 0.16); color: #f6465d; }
    .c.fo { background: rgba(14, 203, 129, 0.14); color: #0ecb81; }
    .c.pf { background: rgba(91, 156, 246, 0.16); color: #5b9cf6; }
    .c.pv { background: rgba(62, 199, 216, 0.14); color: #3ec7d8; }
    .c.more { background: transparent; color: #848e9c; padding: 0 1px; }
    .pn { font: 600 11px/17px Bahnschrift, "Segoe UI", sans-serif; flex: none; }
    .pn.up { color: #0ecb81; } .pn.dn { color: #f6465d; }
    .st { color: #f0b90b; font-size: 11px; flex: none; }
  `;

  function makeBadge(address, w, inline, site) {
    const host = document.createElement(TAG);
    host.setAttribute("data-wl-addr", address);
    if (inline) host.setAttribute("inline", "");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${BADGE_CSS}</style><span class="slot"></span>`;
    fillBadge(host, w, site);
    return host;
  }

  function fillBadge(host, w, site) {
    const sig = JSON.stringify([w.grade, w.name, w.avoid, w.labels.length, w.here && w.here.total, w.platforms.length, w.sm && w.sm.watch, w.private && w.private.label, sameAsSite(badgeName(w), site)]);
    if (host.__wlSig === sig) return;
    host.__wlSig = sig;
    host.__fit = "";
    host.shadowRoot.querySelector(".slot").innerHTML = badgeHtml(w, host.hasAttribute("inline"), site);
  }

  function clipBox(host, stop) {
    for (let p = host.parentElement; p && p !== stop && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== "visible") return p;
    }
    return null;
  }
  function fitBadge(host, row) {
    if (host.hasAttribute("inline")) return;
    const b = host.shadowRoot.querySelector(".b");
    if (!b) return;
    if (!host.__clip || !host.__clip.isConnected || !host.__clip.contains(host)) host.__clip = clipBox(host, row ? row.parentElement : null);
    const clip = host.__clip;
    const avail = clip ? Math.floor(clip.getBoundingClientRect().right - host.getBoundingClientRect().left) - 2 : 0;
    const key = `${avail}|${host.__wlSig}`;
    if (host.__fit === key) return;
    host.__fit = key;
    host.style.maxWidth = avail >= 48 ? `${avail}px` : "";
    const nm = b.querySelector(".nm");
    if (nm) nm.classList.remove("squeeze");
    for (const c of b.querySelectorAll(".c[data-fit]")) c.remove();
    const chips = [...b.querySelectorAll(".c")];
    for (const c of chips) c.hidden = false;
    if (avail < 48 || b.scrollWidth <= b.clientWidth + 1) return;
    const more = document.createElement("span");
    more.className = "c more";
    more.dataset.fit = "1";
    let hidden = 0;
    for (let i = chips.length - 1; i >= 0 && b.scrollWidth > b.clientWidth + 1; i--) {
      const m = chips[i].classList.contains("more") && chips[i].textContent.match(/^\+(\d+)$/);
      hidden += m ? Number(m[1]) : 1;
      chips[i].hidden = true;
      more.textContent = `+${hidden}`;
      chips[i].before(more);
    }
    if (nm && b.scrollWidth > b.clientWidth + 1) nm.classList.add("squeeze");
  }

  let card = null;
  const CARD_CSS = `
    :host { all: initial; }
    .card { position: fixed; z-index: 2147483000; width: 340px; max-height: min(560px, calc(100vh - 24px)); overflow: auto; box-sizing: border-box;
            padding: 12px 14px 14px; border-radius: 12px; background: #181a20; color: #eaecef; box-shadow: 0 0 0 1px #2b3139, 0 12px 32px rgba(0,0,0,.5);
            font: 400 13.5px/1.5 "Segoe UI Variable Text", "Segoe UI", "Noto Sans TC", "Microsoft JhengHei", sans-serif;
            animation: pop 140ms cubic-bezier(.2,.8,.2,1); }
    @keyframes pop { from { opacity: 0; transform: translateY(-4px) scale(.98); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
    .hd { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .g { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 6px; font: 700 15px/1 Bahnschrift, sans-serif; color: #0b0e11; background: #848e9c; flex: none; }
    .g-S { background: #f0b90b; } .g-A { background: #e8cf7d; } .g-B { background: #5b9cf6; color: #fff; } .g-C { background: #848e9c; } .g-D { background: #474d57; color: #eaecef; }
    .g-none { background: transparent; box-shadow: inset 0 0 0 1px #2b3139; color: #848e9c; }
    .ttl { flex: 1; min-width: 0; font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .x { border: 0; background: transparent; color: #848e9c; font-size: 18px; cursor: pointer; padding: 0 2px; line-height: 1; }
    .x:hover { color: #eaecef; }
    .addr { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 8px; background: #0b0e11; margin-bottom: 10px; }
    .addr code { flex: 1; min-width: 0; font: 12px/1.35 "Cascadia Mono", Consolas, monospace; color: #b7bdc6; word-break: break-all; user-select: all; }
    .btn { flex: none; border: 0; border-radius: 6px; padding: 3px 8px; background: #262b33; color: #eaecef; font: inherit; font-size: 12.5px; cursor: pointer; text-decoration: none; }
    .btn:hover { background: #2b3139; }
    .sec { border-top: 1px solid #20252c; padding-top: 8px; margin-top: 8px; }
    .k { color: #848e9c; font-size: 13px; margin-bottom: 3px; }
    .row { display: flex; flex-wrap: wrap; gap: 4px 12px; }
    .num { font-family: Bahnschrift, "Segoe UI", sans-serif; font-weight: 600; }
    .up { color: #0ecb81; } .dn { color: #f6465d; } .mu { color: #848e9c; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .c { padding: 1px 7px; border-radius: 4px; background: #262b33; color: #b7bdc6; font-size: 13px; }
    .c.av { background: rgba(246, 70, 93, 0.14); color: #f6465d; }
    .c.fo { background: rgba(14, 203, 129, 0.12); color: #0ecb81; }
    .c.pf { background: rgba(91, 156, 246, 0.14); color: #5b9cf6; }
    .c.pv { background: rgba(62, 199, 216, 0.12); color: #3ec7d8; }
    .use { font-weight: 600; }
    .note { color: #b7bdc6; white-space: pre-wrap; }
    a.lk { color: #5b9cf6; text-decoration: none; } a.lk:hover { text-decoration: underline; }
    .card.still { animation: none; }
    :focus-visible { outline: 2px solid #5b9cf6; outline-offset: 1px; }
    /* 卡片上的标记：☆、加／拿掉标签 */
    .c .rm { margin: 0 -4px 0 2px; padding: 0 3px; border: 0; background: none; color: inherit; font: inherit; line-height: 1; opacity: .55; cursor: pointer; }
    .c .rm:hover { opacity: 1; }
    .ed { display: grid; gap: 6px; }
    .ed-top { display: flex; align-items: center; gap: 8px; }
    .ed-star { height: 28px; padding: 0 12px; border: 0; border-radius: 6px; background: #262b33; color: #eaecef; font: inherit; font-size: 13px; cursor: pointer; }
    .ed-star:hover { background: #2b3139; }
    .ed-star.on { background: rgba(240, 185, 11, 0.14); color: #f0b90b; }
    .ed-k { color: #848e9c; font-size: 13px; margin-top: 2px; }
    .ed-k span { font-size: 12px; color: #5e6673; }
    .ed-presets { display: flex; flex-wrap: wrap; gap: 4px; }
    .ed-p { height: 24px; padding: 0 8px; border: 0; border-radius: 4px; background: transparent; box-shadow: inset 0 0 0 1px #2b3139; color: #b7bdc6; font: inherit; font-size: 12.5px; cursor: pointer; }
    .ed-p:hover { background: #262b33; color: #eaecef; }
    .ed-p.av:hover { background: rgba(246, 70, 93, 0.14); color: #f6465d; box-shadow: inset 0 0 0 1px rgba(246, 70, 93, 0.5); }
    .ed-p.fo:hover { background: rgba(14, 203, 129, 0.12); color: #0ecb81; box-shadow: inset 0 0 0 1px rgba(14, 203, 129, 0.45); }
    .ed-form { display: flex; gap: 6px; margin: 0; }
    .ed-form input { flex: 1; min-width: 0; height: 28px; padding: 0 8px; border-radius: 6px; border: 1px solid #2b3139; background: #0b0e11; color: #eaecef; font: inherit; font-size: 13px; outline: none; }
    .ed-form input::placeholder { color: #5e6673; }
    .ed-form input:focus { border-color: #5b9cf6; }
    .ed-form button { flex: none; height: 28px; padding: 0 12px; border: 0; border-radius: 6px; background: #262b33; color: #eaecef; font: inherit; font-size: 13px; cursor: pointer; }
    .ed-form button:hover { background: #2b3139; }
    .ed-msg { font-size: 12.5px; color: #0ecb81; }
    .ed-msg:empty { display: none; }
    .ed-msg.bad { color: #f6465d; }
    .ed-msg button { border: 0; background: none; color: #5b9cf6; font: inherit; padding: 0 2px; margin-left: 4px; cursor: pointer; }
    .ed.busy { opacity: .6; pointer-events: none; }
  `;

  function cardHtml(w) {
    const ni = WLCA.nameInfo(w, siteOf(w.address));
    const groups = { avoid: [], follow: [], custom: [], ref: [] };
    for (const l of w.labels || []) (groups[l.group] || groups.ref).push(l);
    const labelRows = [["要避开", "avoid", "av"], ["高手", "follow", "fo"], ["自订", "custom", "pv"], ["参考", "ref", ""]]
      .filter(([, key]) => groups[key].length)
      .map(([title, key, cls]) => `<div class="k">${title}</div><div class="chips">${groups[key].map((l) => `<span class="c ${cls}">${esc(l.text)}${WLCA.rmHtml(l, w.address)}</span>`).join("")}</div>`).join("");
    const h = w.here;
    const here = h ? `<div class="sec"><div class="k">这颗币（${esc(h.source || "GMGN")}）</div><div class="row">
        <span>合计 <b class="num ${h.total >= 0 ? "up" : "dn"}">${usd(h.total) || "—"}</b></span>
        <span>已实现 <b class="num">${usd(h.realized) || "—"}</b></span>
        <span>帐面 <b class="num">${usd(h.unrealized) || "—"}</b></span>
        <span class="mu">${h.holding ? "还拿着" : "已出清"}${h.sold && h.holding ? "，卖过一部分" : ""}</span></div></div>` : "";
    const plats = (w.platforms || []).map((p) => `<div class="row"><span class="c pf">${esc(platText(p.platform))}</span><b>${esc(p.handle)}</b>
        ${p.x ? `<a class="lk" href="https://x.com/${encodeURIComponent(p.x)}" target="_blank" rel="noopener noreferrer">@${esc(p.x)}</a>` : ""}
        ${p.acct ? `<span>帐号总盈亏 <b class="num ${p.acct.total >= 0 ? "up" : "dn"}">${usd(p.acct.total)}</b>${p.acct.partial ? '<span class="mu">（部分）</span>' : ""}</span>` : ""}</div>`).join("");
    const c = w.card;
    const strength = c && (c.realized != null || c.winrate != null) ? `<div class="sec"><div class="k">实力（30 天，${esc(c.src || "")}）</div><div class="row">
        ${c.realized != null ? `<span>实现盈利 <b class="num ${c.realized >= 0 ? "up" : "dn"}">${usd(c.realized)}</b></span>` : ""}
        ${c.winrate != null ? `<span>胜率 <b class="num">${(c.winrate * 100).toFixed(0)}%</b></span>` : ""}
        ${c.tokens != null ? `<span>币数 <b class="num">${c.tokens}</b></span>` : ""}
        ${c.trades != null ? `<span>买卖 <b class="num">${c.trades}</b> 笔</span>` : ""}</div></div>` : "";
    const t = w.trade;
    const sm = (w.sm || t) ? `<div class="sec"><div class="k">聪明钱${w.sm && w.sm.watch ? "（名单追踪中）" : w.sm && w.sm.muted ? "（静音）" : ""}</div>
        ${t ? `<div class="row"><span>这颗币买 <b class="num up">${usd(t.buy, false)}</b></span><span>卖 <b class="num dn">${usd(t.sell, false)}</b></span>
        <span class="mu">第一笔 ${time(t.first)}</span></div>` : `<div class="mu">这颗币在聪明钱动态里没有纪录</div>`}</div>` : "";
    const pv = w.private ? `<div class="sec"><div class="k">你的私人标签</div><span class="c pv">${esc(w.private.label)}</span>${w.private.kindText ? ` <span class="mu">${esc(w.private.kindText)}</span>` : ""}</div>` : "";
    const bot = w.bot ? `<div class="sec"><div class="k">机器人</div><div class="note">${esc(w.bot)}</div></div>` : "";
    const note = w.note ? `<div class="sec"><div class="k">备注</div><div class="note">${esc(w.note)}</div></div>` : "";
    const use = (w.useText || []).map((u, i) => `<span class="c use ${w.use[i] === "avoid" ? "av" : w.use[i] === "confirm" ? "fo" : ""}">${esc(u)}</span>`).join("");
    return `<div class="card" role="dialog" aria-label="钱包明细">
      <div class="hd"><span class="g ${w.grade ? `g-${esc(w.grade)}` : "g-none"}">${esc(w.grade || "–")}</span>
        <span class="ttl">${esc(ni.name || WLCA.shortAddr(w.address))}${ni.src && WLCA.NAME_SRC_TEXT[ni.src] ? ` <span class="mu" style="font-size:12px;font-weight:400">${esc(WLCA.NAME_SRC_TEXT[ni.src])}</span>` : ""}${w.quiet ? ' <span class="mu" style="font-size:12.5px;font-weight:400">（不到 $1K，钱包库预设隐藏）</span>' : ""}</span>
        <button class="x" title="关闭" aria-label="关闭">×</button></div>
      <div class="addr"><code>${esc(w.address)}</code><button class="btn cp">拷贝</button></div>
      ${use ? `<div class="k">用途</div><div class="chips" style="margin-bottom:6px">${use}</div>` : ""}
      ${labelRows}
      ${pv}${plats ? `<div class="sec"><div class="k">平台帐号</div>${plats}</div>` : ""}${here}${strength}${sm}${bot}${note}
      <div class="sec">${WLCA.editHtml(w, w.address)}</div>
      <div class="sec row"><a class="btn op" href="#" title="在本机服务查地址页打开">在本机服务打开</a></div>
    </div>`;
  }

  function closeCard() {
    cancelClose();
    if (card) { card.remove(); card = null; }
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onOutside, true);
  }
  const onKey = (e) => { if (e.key === "Escape") closeCard(); };
  const onOutside = (e) => { if (card && !e.composedPath().some((n) => n === card || isBadge(n))) closeCard(); };

  const isBadge = (n) => Boolean(n && n.tagName === TAG.toUpperCase());
  const badgeOf = (e) => e.composedPath().find(isBadge);
  const inCard = (e) => Boolean(card && e.composedPath().includes(card));
  const liveBadge = (addr) => document.querySelector(`${TAG}[data-wl-addr="${CSS.escape(addr)}"]`);
  const HOVER_OPEN = 140;
  const HOVER_CLOSE = 260;
  const HOVER_SWITCH = 220;
  let swallowUntil = 0;
  let hoverAddr = "";
  let openT = 0;
  let closeT = 0;
  function cancelClose() { clearTimeout(closeT); closeT = 0; }
  function laterClose() {
    if (closeT || !card || card.__pinned) return;
    closeT = setTimeout(() => { closeT = 0; if (card && !card.__pinned) closeCard(); }, HOVER_CLOSE);
  }
  function pin() {
    if (!card) return;
    card.__pinned = true;
    cancelClose();
  }
  function hover(e) {
    if (e.pointerType === "touch") return;
    const host = badgeOf(e);
    if (host) {
      cancelClose();
      const addr = host.getAttribute("data-wl-addr");
      if (hoverAddr === addr) return;
      hoverAddr = addr;
      clearTimeout(openT);
      if ((card && card.__w && card.__w.address === addr) || (card && card.__pinned)) return;
      openT = setTimeout(() => {
        const data = info.get(addr);
        const anchor = liveBadge(addr);
        if (hoverAddr === addr && data && anchor && !(card && card.__pinned)) openCard(anchor, data, false);
      }, card ? HOVER_SWITCH : HOVER_OPEN);
      return;
    }
    if (hoverAddr) { hoverAddr = ""; clearTimeout(openT); }
    if (inCard(e) || inBridge(e)) cancelClose(); else laterClose();
  }
  function inBridge(e) {
    const z = card && card.__bridge;
    return Boolean(z && e.clientX >= z.left && e.clientX <= z.right && e.clientY >= z.top && e.clientY <= z.bottom);
  }
  listen(window, "pointerover", hover, true);
  listen(window, "pointermove", hover, true);
  listen(window, "mouseout", (e) => { if (!e.relatedTarget) { hoverAddr = ""; clearTimeout(openT); laterClose(); } }, true);
  listen(window, "pointerdown", (e) => {
    const host = badgeOf(e);
    if (!host || e.button !== 0) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    swallowUntil = Date.now() + 800;
    clearTimeout(openT);
    const addr = host.getAttribute("data-wl-addr");
    if (card && card.__w && card.__w.address === addr) { pin(); return; }
    const data = info.get(addr);
    if (data) openCard(host, data, true);
  }, true);
  const overBadge = (e) => isBadge(document.elementFromPoint(e.clientX, e.clientY));
  const intoBadge = (e) => { const t = e.relatedTarget; return Boolean(t && (isBadge(t) || (t.getRootNode && isBadge(t.getRootNode().host)))); };
  for (const type of ["pointerover", "mouseover", "pointermove", "mousemove"]) {
    listen(window, type, (e) => { if (badgeOf(e)) e.stopImmediatePropagation(); }, true);
  }
  for (const type of ["pointerenter", "mouseenter"]) {
    listen(window, type, (e) => { if (overBadge(e)) e.stopImmediatePropagation(); }, true);
  }
  for (const type of ["pointerout", "mouseout"]) {
    listen(window, type, (e) => { if (intoBadge(e)) e.stopImmediatePropagation(); }, true);
  }
  for (const type of ["mousedown", "pointerup", "mouseup", "click", "dblclick", "auxclick", "contextmenu"]) {
    listen(window, type, (e) => {
      if (inCard(e)) return;
      if (badgeOf(e) || (Date.now() < swallowUntil && type !== "contextmenu")) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);
  }

  let server = "";
  async function openCard(anchor, w, pinned = true) {
    closeCard();
    card = document.createElement(CARD_TAG);
    card.__pinned = pinned;
    card.attachShadow({ mode: "open" });
    for (const type of ["keydown", "keyup", "keypress"]) card.addEventListener(type, (e) => e.stopPropagation());
    card.addEventListener("pointerdown", pin);
    card.addEventListener("focusin", pin);
    document.documentElement.appendChild(card);
    const r = anchor.getBoundingClientRect();
    const below = innerHeight - r.bottom - 14;
    const above = r.top - 14;
    const left = Math.max(8, Math.min(r.left, innerWidth - 348));
    card.__pos = { left: `${left}px` };
    const down = below >= 300 || below >= above;
    if (down) Object.assign(card.__pos, { top: `${r.bottom + 6}px`, maxHeight: `${Math.max(120, Math.min(560, below))}px` });
    else Object.assign(card.__pos, { bottom: `${innerHeight - r.top + 6}px`, maxHeight: `${Math.max(120, Math.min(560, above))}px` });
    card.__bridge = { left: Math.min(r.left, left) - 4, right: Math.max(r.right, left + 340) + 4, top: down ? r.top - 4 : r.top - 10, bottom: down ? r.bottom + 10 : r.bottom + 4 };
    paintCard(w);
    if (!server) {
      const settings = await send({ type: "wl-settings" });
      server = (settings && settings.server) || "http://127.0.0.1:8787";
      if (card && card.__w) setLink(card.shadowRoot, card.__w);
    }
    setTimeout(() => {
      document.addEventListener("keydown", onKey, true);
      document.addEventListener("pointerdown", onOutside, true);
    }, 0);
  }

  function setLink(root, w) {
    const op = root.querySelector(".op");
    if (!op || !server) return;
    op.setAttribute("href", `${server}/analyze.html?q=${encodeURIComponent(w.address)}&chain=${encodeURIComponent(w.chain || "")}`);
    op.setAttribute("target", "_blank");
    op.setAttribute("rel", "noopener noreferrer");
  }

  function paintCard(w, note) {
    if (!card) return;
    const root = card.shadowRoot;
    const again = Boolean(card.__w);
    card.__w = w;
    root.innerHTML = `<style>${CARD_CSS}</style>${cardHtml(w)}`;
    const box = root.querySelector(".card");
    Object.assign(box.style, card.__pos || {});
    if (again) box.classList.add("still");
    root.querySelector(".x").addEventListener("click", closeCard);
    root.querySelector(".cp").addEventListener("click", async (e) => {
      try { await navigator.clipboard.writeText(w.address); e.target.textContent = "已拷贝"; } catch (_) { e.target.textContent = "拷贝失败"; }
    });
    setLink(root, w);
    box.addEventListener("click", (e) => {
      const t = e.target.closest("button");
      if (!t) return;
      if (t.hasAttribute("data-star")) cardAct({ kind: "star", on: t.getAttribute("data-star") === "1" });
      else if (t.hasAttribute("data-tag-add")) cardAct({ kind: "tag", label: t.getAttribute("data-tag-add"), text: t.getAttribute("data-tag-text"), on: true });
      else if (t.hasAttribute("data-tag-rm")) cardAct({ kind: "tag", label: t.getAttribute("data-tag-rm"), text: t.getAttribute("data-tag-text"), on: false });
      else if (t.hasAttribute("data-undo") && card.__undo) cardAct(card.__undo, true);
    });
    const form = root.querySelector("[data-tag-form]");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const text = form.elements.tag.value.trim();
        if (text) cardAct({ kind: "tag", label: text, text, on: true });
      });
    }
    if (note) cardMsg(note.text, note.bad, note.undo);
  }

  function cardMsg(text, bad, undo) {
    const box = card && card.shadowRoot.querySelector("[data-ed-msg]");
    if (!box) return;
    box.className = `ed-msg${bad ? " bad" : ""}`;
    box.innerHTML = `${esc(text)}${undo ? `<button type="button" data-undo>复原</button>` : ""}`;
    card.__undo = undo || null;
  }

  async function cardAct(act, isUndo = false) {
    if (!card || !card.__w) return;
    const w = card.__w;
    const ed = card.shadowRoot.querySelector(".ed");
    if (ed) ed.classList.add("busy");
    const evm = w.address.startsWith("0x");
    const same = Boolean(page && page.ca.startsWith("0x") === evm);
    const r = await send({ type: act.kind === "star" ? "wl-star" : "wl-tag", chain: same ? page.chain : evm ? "bsc" : "sol", ca: same ? page.ca : "",
      address: w.address, label: act.label, on: act.on, from: ME });
    if (!card || !card.__w || card.__w.address !== w.address) return;
    if (!r || r.ok === false) {
      if (ed) ed.classList.remove("busy");
      cardMsg((r && r.error) || "没有存到", true);
      return;
    }
    const item = r.item || { address: w.address, chain: w.chain, labels: [], platforms: [], use: [], useText: [], sm: null, lib: false };
    info.set(w.address, WLCA.hasStanding(r.item) ? r.item : null);
    schedule(0);
    const undo = isUndo ? null : { ...act, on: !act.on };
    paintCard(item, { text: `${WLCA.actText(act, r)}${isUndo ? "（已复原）" : ""}`, undo });
  }

  function render(rows) {
    for (const { address, place, row, inline, site } of rows) {
      const w = info.get(address);
      let host = null;
      for (let n = place.nextElementSibling; n && (n.tagName === TAG.toUpperCase() || n.tagName === "WL-BADGE"); n = n.nextElementSibling) {
        if (n.tagName === TAG.toUpperCase()) { host = n; break; }
      }
      if (row) for (const other of row.querySelectorAll(TAG)) if (other !== host) other.remove();
      if (!w) {
        if (host) host.remove();
        continue;
      }
      if (host && host.getAttribute("data-wl-addr") !== address) {
        host.setAttribute("data-wl-addr", address);
        host.__wlSig = "";
      }
      if (!host) {
        host = makeBadge(address, w, inline, site);
        place.insertAdjacentElement("afterend", host);
      }
      fillBadge(host, w, site);
      fitBadge(host, row);
    }
    for (const host of document.querySelectorAll(TAG)) {
      const addr = host.getAttribute("data-wl-addr");
      if (!info.get(addr)) host.remove();
    }
  }

  async function ensureToken() {
    if (!adapter.needsToken || !page) return;
    if ((candidates.length && candidates.__ca === page.ca) || Date.now() - failAt < 15000) return;
    const data = await send({ type: "wl-token", chain: page.chain, ca: page.ca, holders: true });
    if (!data || data.ok === false) { lastError = (data && data.error) || "查不到"; failAt = Date.now(); return; }
    candidates = [...new Set([...(data.holders || []).map((h) => h.address), ...Object.keys(data.wallets || {})])];
    candidates.__ca = page.ca;
    for (const h of data.holders || []) if (!info.has(h.address)) info.set(h.address, null);
    for (const [address, w] of Object.entries(data.wallets || {})) info.set(address, WLCA.hasStanding(w) ? w : null);
  }

  let again = false;
  async function scan() {
    if (!enabled) return;
    if (pending) { again = true; return; }
    pending = true;
    again = false;
    try {
      const now = currentPage();
      if (!now) { if (page) { page = null; info = new Map(); render([]); } return; }
      if (!page || now.ca !== page.ca || now.chain !== page.chain) {
        page = now;
        info = new Map();
        candidates = [];
        lastFresh = Date.now();
        send({ type: "wl-page", chain: page.chain, ca: page.ca });
      }
      await ensureToken();
      const resolve = (text) => WLCA.matchShort(text, candidates);
      let rows = adapter.rows(resolve);
      const due = document.visibilityState === "visible" && (forceFresh || Date.now() - lastFresh > REFRESH_MS);
      const unknown = [...new Set(rows.map((r) => r.address).filter((a) => due || !info.has(a)))];
      if (unknown.length && Date.now() - failAt > 15000) {
        const data = await send({ type: "wl-lookup", chain: page.chain, ca: page.ca, addresses: unknown, fresh: due });
        if (data && data.ok !== false) {
          lastError = "";
          if (due) { lastFresh = Date.now(); forceFresh = false; }
          for (const a of unknown) { const w = (data.items || {})[a]; info.set(a, WLCA.hasStanding(w) ? w : null); }
        } else {
          lastError = (data && data.error) || "查找失败";
          failAt = Date.now();
          return;
        }
        rows = adapter.rows(resolve);
      }
      render(rows);
      noteSiteNames(rows);
    } finally {
      pending = false;
      if (again) schedule(30);
    }
  }

  let timer = 0;
  let due = 0;
  const schedule = (delay = 250) => {
    if (!alive()) { clearTimeout(timer); stop(); return; }
    const at = Date.now() + delay;
    if (timer && due <= at) return;
    clearTimeout(timer);
    due = at;
    timer = setTimeout(() => { timer = 0; scan(); }, delay);
  };
  const OWN = new Set([TAG.toUpperCase(), CARD_TAG.toUpperCase(), "WL-BADGE", "WL-CARD"]);
  const ownOnly = (nodes) => nodes.length > 0 && [...nodes].every((n) => n.nodeType === 1 && OWN.has(n.tagName));
  const observer = new MutationObserver((records) => {
    let need = false;
    for (const r of records) {
      const t = r.target;
      if (t && t.nodeType === 1 && OWN.has(t.tagName)) continue;
      if (r.type === "childList") {
        for (const n of r.removedNodes) if (n.nodeType === 1 && !OWN.has(n.tagName) && n.querySelector(TAG)) { schedule(16); return; }
        if ((ownOnly(r.addedNodes) || ownOnly(r.removedNodes)) && !(r.addedNodes.length && r.removedNodes.length)) continue;
      }
      need = true;
    }
    if (need) schedule();
  });
  listen(window, "resize", () => schedule(120));
  listen(document, "visibilitychange", () => { if (document.visibilityState === "visible") { forceFresh = true; schedule(0); } });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-recycler-key", "href"] });
  const tick = setInterval(() => schedule(0), 2500);
  schedule(600);

  function stop() {
    life.abort();
    observer.disconnect();
    clearInterval(tick);
    clearTimeout(timer);
    clearTimeout(openT);
    closeCard();
    for (const h of document.querySelectorAll(TAG)) h.remove();
    legacyCss.remove();
  }
  listen(document, "wl-badges-takeover", stop);

  try {
    chrome.storage.local.get({ badges: true }, (s) => { enabled = s.badges !== false; if (!enabled) render([]); else schedule(0); });
    chrome.storage.onChanged.addListener((changes) => {
      if (life.signal.aborted) return;
      if (changes.badges) { enabled = changes.badges.newValue !== false; if (!enabled) { for (const h of document.querySelectorAll(TAG)) h.remove(); } else schedule(0); }
      if (changes.server) { info = new Map(); candidates = []; schedule(0); }
    });
  } catch (_) {  }

  function flash(row) {
    const cells = row.tagName === "TR" ? [...row.children] : [row];
    const kf = [
      { backgroundColor: "rgba(240,185,11,0)" },
      { backgroundColor: "rgba(240,185,11,0.55)", offset: 0.18 },
      { backgroundColor: "rgba(240,185,11,0.12)", offset: 0.5 },
      { backgroundColor: "rgba(240,185,11,0.55)", offset: 0.72 },
      { backgroundColor: "rgba(240,185,11,0)" },
    ];
    for (const el of cells) el.animate(kf, { duration: 1500, easing: "ease-in-out" });
    const w = row.getBoundingClientRect().width || 1;
    const covers = [];
    for (const el of row.querySelectorAll("*")) {
      if (covers.length >= 4) break;
      if (cells.includes(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < w * 0.6 || r.height < 12) continue;
      const c = (getComputedStyle(el).backgroundColor.match(/[\d.]+/g) || []).map(Number);
      if (c.length < 3 || (c.length >= 4 && c[3] < 0.3)) continue;
      covers.push(el);
    }
    if (!covers.length) return;
    const glow = kf.map((k) => {
      const a = k.backgroundColor.match(/[\d.]+\)$/)[0].slice(0, -1);
      const f = { boxShadow: `inset 0 0 0 4000px rgba(240,185,11,${a})` };
      if (k.offset != null) f.offset = k.offset;
      return f;
    });
    for (const el of covers) el.animate(glow, { duration: 1500, easing: "ease-in-out" });
  }

  const pause = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 90)));
  const canScroll = (el) => /(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 4;
  function scrollersOf(el) {
    const out = [];
    for (let p = el && el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) if (canScroll(p)) out.push(p);
    return out;
  }
  function reveal(content, scs, q) {
    const M = 72;
    for (const p of scs) {
      const y = content.getBoundingClientRect().top + q;
      const top = Math.max(p.getBoundingClientRect().top, 0) + M;
      if (Math.abs(y - top) > 2) p.scrollTop += y - top;
    }
    const y = content.getBoundingClientRect().top + q;
    if (y < M || y > innerHeight - M) window.scrollBy(0, y - M);
  }

  function bring(el) {
    for (const p of scrollersOf(el)) {
      const d = el.getBoundingClientRect().top - (Math.max(p.getBoundingClientRect().top, 0) + 8);
      if (Math.abs(d) > 2) p.scrollTop += d;
    }
    const y = el.getBoundingClientRect().top;
    if (y < 0 || y > innerHeight - 160) window.scrollBy(0, y - 8);
  }

  function visibleSpan(scs) {
    let top = 0, bottom = innerHeight;
    for (const p of scs) {
      const b = p.getBoundingClientRect();
      top = Math.max(top, b.top);
      bottom = Math.min(bottom, b.bottom);
    }
    return Math.max(0, bottom - top - 72);
  }

  function liveRank(row) {
    if (HOST !== "gmgn.ai" || !row || !row.parentElement) return 0;
    const h = row.offsetHeight || 54;
    const n = Math.round((row.getBoundingClientRect().top - row.parentElement.getBoundingClientRect().top) / h) + 1;
    return n > 0 && n < 1000 ? n : 0;
  }

  async function scrollTo(address, rank, pct) {
    const rowsNow = () => adapter.rows((text) => WLCA.matchShort(text, candidates));
    const find = () => rowsNow().find((r) => r.address === address);
    let hit = find();
    const listEl = !hit && adapter.list ? adapter.list() : null;
    const before = listEl ? scrollersOf(listEl).map((el) => [el, el.scrollTop]) : [];
    const beforeY = scrollY;
    if (listEl) {
      bring(listEl);
      await pause();
      await pause();
      hit = find();
    }
    if (!hit) {
      const sample = rowsNow()[0];
      if (!sample) {
        for (const [el, top] of before) el.scrollTop = top;
        window.scrollTo(0, beforeY);
        return { ok: true, found: false, reason: "norows" };
      }
      const content = sample.row.parentElement;
      const scs = scrollersOf(sample.row);
      const saved = [...before, ...scs.map((el) => [el, el.scrollTop])].reverse();
      const savedY = beforeY;
      const h = sample.row.offsetHeight || 54;
      const span = () => Math.max(h * 2, visibleSpan(scs) - h);
      const sc0 = scs[0];
      if (rank) {
        const est0 = Math.max(0, (rank - 1) * h - Math.max(0, Math.floor(visibleSpan(scs) / 2) - h));
        reveal(content, scs, est0);
        await pause();
        hit = find();
        const step = span();
        for (let k = 1; k <= 3 && !hit; k++) {
          for (const q of [est0 + k * step, est0 - k * step]) {
            if (q < 0) continue;
            reveal(content, scs, q);
            await pause();
            if ((hit = find())) break;
          }
        }
      }
      if (!hit) {
        if (sc0) sc0.scrollTop = 0; else window.scrollTo(0, 0);
        await pause();
        let lastSH = -1;
        for (let g = 0; g < 120 && !(hit = find()); g++) {
          const step = span();
          if (sc0) {
            const sh = sc0.scrollHeight;
            const atEnd = sc0.scrollTop + sc0.clientHeight >= sh - 2;
            if (atEnd && sh === lastSH) break;
            lastSH = sh;
            sc0.scrollTop = Math.min(sc0.scrollTop + step, sh);
          } else {
            const sh = document.documentElement.scrollHeight;
            const atEnd = scrollY + innerHeight >= sh - 2;
            if (atEnd && sh === lastSH) break;
            lastSH = sh;
            window.scrollBy(0, step);
          }
          await pause();
        }
      }
      if (!hit && adapter.guess) hit = adapter.guess(rank, pct, (text) => WLCA.matchShort(text, candidates));
      if (!hit) {
        for (const [el, top] of saved) el.scrollTop = top;
        window.scrollTo(0, savedY);
        return { ok: true, found: false, reason: "notfound" };
      }
    }
    hit.row.scrollIntoView({ block: "center", behavior: "auto" });
    await pause();
    const again = find();
    const row = (again || hit).row;
    const b = row.getBoundingClientRect();
    if (b.top < 60 || b.bottom > innerHeight - 20) {
      const scs = scrollersOf(row);
      const target = innerHeight / 2 - b.height / 2;
      for (const p of scs) { const d = row.getBoundingClientRect().top - target; if (Math.abs(d) > 2) p.scrollTop += d; }
      const d = row.getBoundingClientRect().top - target;
      if (Math.abs(d) > 2) window.scrollBy(0, d);
      await pause();
    }
    const last = find() || again || hit;
    flash(last.row);
    return { ok: true, found: true, rank: liveRank(last.row) };
  }

  try {
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (life.signal.aborted) return false;
      if (msg && msg.type === "wl-scroll") {
        scrollTo(WLCA.norm(msg.address), Number(msg.rank) || 0, msg.pct == null ? null : Number(msg.pct)).then(reply, (err) => reply({ ok: false, found: false, reason: "error", error: String((err && err.message) || err) }));
        return true;
      }
      if (msg && msg.type === "wl-wallet-changed") {
        const a = WLCA.norm(msg.address);
        if (msg.from === ME) return false;
        if (page && msg.ca && msg.ca === page.ca) {
          if (info.has(a) || msg.item) { info.set(a, WLCA.hasStanding(msg.item) ? msg.item : null); schedule(0); }
          if (card && card.__w && card.__w.address === a && msg.item) paintCard(msg.item);
        } else if (info.has(a)) {
          info.delete(a);
          schedule(0);
        }
        return false;
      }
      if (msg && msg.type === "wl-refresh") { forceFresh = true; schedule(0); return false; }
      if (msg && msg.type === "wl-site-names-get") { reply({ ok: true, chain: page && page.chain, ca: page && page.ca, src: SITE, names: Object.fromEntries(siteNames) }); return false; }
      if (msg && msg.type === "wl-status") { reply({ ok: true, site: HOST, page, badges: document.querySelectorAll(TAG).length, rows: adapter.rows((t) => WLCA.matchShort(t, candidates)).length, known: info.size, error: lastError }); return false; }
      return false;
    });
  } catch (_) {  }

  window.__wlBadgesDebug = { scan, scrollTo, state: () => ({ page, known: info.size, hits: [...info.values()].filter(Boolean).length, lastError }) };
})();
