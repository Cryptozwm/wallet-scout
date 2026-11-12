(function (root) {
  "use strict";
  const ADDR = "(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})";
  const CHAIN = { bsc: "bsc", bnb: "bsc", sol: "sol", solana: "sol", base: "base", eth: "eth", ethereum: "eth", robinhood: "robinhood", rh: "robinhood" };
  const CHAIN_TEXT = { bsc: "BSC", sol: "SOL", base: "Base", eth: "ETH", robinhood: "RH" };
  const FULL = /^(0x[0-9a-f]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;

  const norm = (address) => {
    const text = String(address || "").trim();
    return text.startsWith("0x") ? text.toLowerCase() : text;
  };

  function result(chain, ca, site) {
    const key = CHAIN[String(chain || "").toLowerCase()] || "";
    const address = norm(ca);
    if (!FULL.test(address)) return null;
    if (key === "sol" && address.startsWith("0x")) return null;
    if (key && key !== "sol" && !address.startsWith("0x")) return null;
    return { chain: key || (address.startsWith("0x") ? "bsc" : "sol"), ca: address, site, known: Boolean(key) };
  }

  function parse(url) {
    let u;
    try { u = new URL(url); } catch (_) { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.replace(/^www\./, "");
    let path = u.pathname;
    try { path = decodeURIComponent(path); } catch (_) {  }
    let m;
    if (host === "gmgn.ai" && (m = path.match(new RegExp(`^/([a-z]+)/token/(?:[A-Za-z0-9]+_)?${ADDR}(?![1-9A-HJ-NP-Za-km-z])`)))) return result(m[1], m[2], "gmgn");
    if (host === "debot.ai" && (m = path.match(new RegExp(`^/token/([a-z]+)/${ADDR}`)))) return result(m[1], m[2], "debot");
    if (host === "ave.ai" && (m = path.match(new RegExp(`^/token/${ADDR}-([a-z]+)`)))) return result(m[2], m[1], "ave");
    if (host === "pump.fun" && (m = path.match(/^\/(?:coin\/)?([1-9A-HJ-NP-Za-km-z]{32,44})(?![1-9A-HJ-NP-Za-km-z])/))) return result("sol", m[1], "pump");
    if (host === "four.meme" && (m = path.match(/(0x[0-9a-fA-F]{40})/))) return result("bsc", m[1], "four");
    if (/\/(address|wallet|account|maker|portfolio|profile|user|tx)s?\//i.test(path)) return null;
    const text = `${path} ${u.search}`;
    const hint = `${host}${path}${u.search}`.toLowerCase().match(/(?:^|[^a-z])(bsc|bnb|base|eth|ethereum|robinhood|solana|sol)(?![a-z])/);
    if ((m = text.match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/))) return result(hint && CHAIN[hint[1]] !== "sol" ? hint[1] : "bsc", m[0], "url");
    if ((m = text.match(/(?:^|[^1-9A-HJ-NP-Za-km-z])([1-9A-HJ-NP-Za-km-z]{32,44})(?![1-9A-HJ-NP-Za-km-z])/)) && /(pump|bonk|moon|[0-9])$/.test(m[1])) {
      return result("sol", m[1], "url");
    }
    return null;
  }

  function parseWallet(url) {
    let u;
    try { u = new URL(url); } catch (_) { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.replace(/^www\./, "");
    let path = u.pathname;
    try { path = decodeURIComponent(path); } catch (_) {  }
    const wallet = (chain, address, site) => {
      const a = norm(address);
      if (!FULL.test(a)) return null;
      const key = CHAIN[String(chain || "").toLowerCase()] || "";
      return { chain: key && (key === "sol") === !a.startsWith("0x") ? key : a.startsWith("0x") ? "bsc" : "sol", address: a, site };
    };
    let m;
    if (host === "gmgn.ai" && (m = path.match(new RegExp(`^/([a-z]+)/address/(?:[A-Za-z0-9]+_)?${ADDR}`)))) return wallet(m[1], m[2], "gmgn");
    if (host === "debot.ai" && (m = path.match(new RegExp(`^/address/([a-z]+)/${ADDR}`)))) return wallet(m[1], m[2], "debot");
    if (/(^|\.)bscscan\.com$/.test(host) && (m = path.match(/^\/address\/(0x[0-9a-fA-F]{40})/))) return wallet("bsc", m[1], "bscscan");
    if (host === "solscan.io" && (m = path.match(/^\/account\/([1-9A-HJ-NP-Za-km-z]{32,44})/))) return wallet("sol", m[1], "solscan");
    if ((m = path.match(new RegExp(`/(?:address|wallet|account|maker|portfolio|profile|user)s?/(?:([a-z]+)/)?${ADDR}`, "i")))) {
      const hint = `${host}${path}`.toLowerCase().match(/(?:^|[^a-z])(bsc|bnb|base|eth|robinhood|solana|sol)(?![a-z])/);
      return wallet(m[1] || (hint && hint[1]) || "", m[2], host);
    }
    return null;
  }

  function findAddress(text) {
    const m = String(text || "").match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])|(?:^|[^1-9A-HJ-NP-Za-km-z])([1-9A-HJ-NP-Za-km-z]{32,44})(?![1-9A-HJ-NP-Za-km-z])/);
    if (!m) return "";
    return norm(m[1] || m[0]);
  }

  function matchShort(short, candidates) {
    const m = String(short || "").trim().match(/^(0x)?([0-9A-Za-z]{2,8})\s*(?:\.{2,3}|…)\s*([0-9A-Za-z]{3,8})$/);
    if (!m) return "";
    const evm = Boolean(m[1]);
    const head = evm ? `0x${m[2]}`.toLowerCase() : m[2];
    const tail = evm ? m[3].toLowerCase() : m[3];
    const hits = candidates.filter((a) => a.startsWith(head) && a.endsWith(tail));
    return hits.length === 1 ? hits[0] : "";
  }

  function siteUrl(site, chain, ca) {
    const gmgnChain = chain === "robinhood" ? "robinhood" : chain;
    if (site === "debot") return `https://debot.ai/token/${chain === "sol" ? "solana" : chain}/${ca}`;
    if (site === "ave") return `https://ave.ai/token/${ca}-${chain === "sol" ? "solana" : chain}`;
    return `https://gmgn.ai/${gmgnChain}/token/${ca}`;
  }

  function hasStanding(w) {
    if (!w) return false;
    return Boolean(w.name || w.twitter || (w.platforms || []).length || w.private || w.grade || w.bot || w.avoid || w.follow
      || (w.sm && w.sm.watch) || w.trade || (w.labels || []).some((l) => l.group !== "ref" || l.manual));
  }

  const SHORT_ADDR = /^(0x)?[0-9A-Za-z]{1,8}\s*(\.{2,}|…)\s*[0-9A-Za-z]{1,8}$/;
  const isShortAddr = (text) => {
    const t = String(text || "").split(/[\u200b-\u200d\u2060\ufeff]/)[0].trim();
    return SHORT_ADDR.test(t) || FULL.test(t);
  };
  function nameInfo(w, site) {
    if (w && w.name) return { name: w.name, src: "" };
    const plat = w && (w.platforms || []).find((p) => p.handle);
    if (plat) return { name: plat.handle, src: plat.platform };
    if (w && w.private && w.private.label) return { name: w.private.label, src: "private" };
    const own = w && (w.labels || []).find((l) => l.group === "custom");
    if (own) return { name: own.text, src: "label", id: own.id };
    if (site && site.name && !isShortAddr(site.name)) return { name: String(site.name).trim(), src: site.src || "site" };
    return { name: "", src: "" };
  }
  const NAME_SRC_TEXT = { private: "私人标签", label: "你加的标签", GMGN: "GMGN 上的名字", DeBot: "DeBot 上的名字", Ave: "Ave 上的名字", site: "网站上的名字" };

  const TAG_PRESETS = [
    { id: "insider", text: "庄家/内部", group: "avoid" },
    { id: "bundle_member", text: "捆绑", group: "avoid" },
    { id: "sniper", text: "狙击手", group: "avoid" },
    { id: "bot", text: "机器人", group: "avoid" },
    { id: "smart_money", text: "聪明钱", group: "follow" },
    { id: "long_pnl", text: "长期获利", group: "follow" },
    { id: "kol", text: "KOL", group: "ref" },
  ];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function editHtml(w, address) {
    const have = new Set(((w && w.labels) || []).map((l) => l.id));
    const watch = Boolean(w && w.sm && w.sm.watch);
    const presets = TAG_PRESETS.filter((p) => !have.has(p.id)).map((p) => `<button type="button" class="ed-p${p.group === "avoid" ? " av" : p.group === "follow" ? " fo" : ""}" data-tag-add="${esc(p.id)}" data-tag-text="${esc(p.text)}" title="加上「${esc(p.text)}」">+ ${esc(p.text)}</button>`).join("");
    return `<div class="ed" data-ed="${esc(address)}">
      <div class="ed-top"><button type="button" class="ed-star${watch ? " on" : ""}" data-star="${watch ? 0 : 1}" aria-pressed="${watch}" title="${watch ? "点一下取消聪明钱名单追踪" : "加进聪明钱名单追踪（本机服务会开始追他的买卖）"}">${watch ? "★ 聪明钱追踪中" : "☆ 加入聪明钱追踪"}</button></div>
      <div class="ed-k">加标签<span>（存到本机服务钱包库）</span></div>
      ${presets ? `<div class="ed-presets">${presets}</div>` : ""}
      <form class="ed-form" data-tag-form><input name="tag" maxlength="40" autocomplete="off" spellcheck="false" placeholder="自订标签，例如 小号" aria-label="自订标签"><button type="submit">加</button></form>
      <div class="ed-msg" data-ed-msg role="status" aria-live="polite"></div>
    </div>`;
  }

  function rmHtml(l, address) {
    if (!l || !l.removable) return "";
    const tip = l.manual ? `拿掉「${l.text}」` : `拿掉「${l.text}」（自动标签，之后不再自动加）`;
    return `<button type="button" class="rm" data-tag-rm="${esc(l.id)}" data-tag-text="${esc(l.text)}" data-for="${esc(address)}" title="${esc(tip)}" aria-label="${esc(tip)}">×</button>`;
  }

  function actText(act, r) {
    if (act.kind === "star") return act.on ? "已加进聪明钱追踪" : "已取消聪明钱追踪";
    return `${act.on ? "已加上" : "已拿掉"}「${act.text || act.label}」${r && r.created ? "（钱包库添加了这个地址）" : ""}`;
  }

  const shortAddr = (a) => { const s = String(a || ""); return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s; };
  root.WLCA = { parse, parseWallet, findAddress, norm, matchShort, siteUrl, hasStanding, editHtml, rmHtml, actText, nameInfo, isShortAddr, shortAddr, NAME_SRC_TEXT, TAG_PRESETS, FULL, CHAIN_TEXT };
})(typeof self !== "undefined" ? self : window);
