"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const KIND = { token: "代币合约", wallet: "钱包", eip7702: "EIP-7702 委派钱包", contract: "其他合约", program: "Solana 程序", empty: "空地址" };
  const KIND_NOTE = { eip7702: "帐户仍是私人钱包，只是委派给合约运行", contract: "不是代币，也不是一般钱包", program: "Solana 程序帐户，没有可分析的持仓", empty: "链上没有活动纪录" };
  const NATIVE = { BSC: "BNB", ETH: "ETH", Base: "ETH", Robinhood: "ETH", Solana: "SOL" };
  const GMGN_SLUG = { BSC: "bsc", ETH: "eth", Base: "base", Robinhood: "robinhood", Solana: "sol" };
  const DEX_SLUG = { BSC: "bsc", ETH: "ethereum", Base: "base", Solana: "solana" };
  const EXPLORER = { BSC: "https://bscscan.com/address/", ETH: "https://etherscan.io/address/", Base: "https://basescan.org/address/", Solana: "https://solscan.io/account/" };
  const RECENT_KEY = "wallet-investigator-recent";
  const timing = (window.__analyzeTimings = {});
  let t0 = 0;
  let current = null;
  const sec = (ms) => `${(ms / 1000).toFixed(1)} 秒`;
  const localTime = (d = new Date()) => new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "medium", hour12: false }).format(d);
  const toast = (msg) => window.Shell?.toast(msg);
  const copyBtn = (value) => `<button type="button" class="copy-btn" data-copy="${esc(value)}" aria-label="拷贝完整地址" title="拷贝完整地址">⧉</button>`;
  const addr = (value) => (value ? `<span class="focus-address"><code class="full-address">${esc(value)}</code>${copyBtn(value)}</span>` : "—");
  const wallet = (value, chain = current?.chain) => {
    const lib = typeof libChainName === "function" ? libChainName(chain) : "";
    const evm = /^0x/i.test(String(value || ""));
    if (!value || (!lib && !evm)) return addr(value);
    const tag = evm ? (lib === "Robinhood" ? "Robinhood" : "BSC") : lib;
    const star = typeof walletStarButton === "function" ? walletStarButton(value, tag) : "";
    return `<span class="focus-address"><code class="full-address" data-wallet-edit="${esc(value)}" data-chain="${esc(tag)}" role="button" tabindex="0" title="点一下：改标签、备注（存进钱包库）">${esc(value)}</code>${copyBtn(value)}${editBtn(value, tag)}${star}</span>`;
  };
  const editBtn = (value, chain) => `<button class="copy-btn edit-btn" type="button" data-wallet-edit="${esc(value)}" data-chain="${esc(chain)}" aria-label="改标签、备注" title="改标签、备注（存进钱包库）">✎</button>`;
  const walletChainTag = (q) => { const lib = typeof libChainName === "function" ? libChainName(q.chain) : ""; return /^0x/i.test(q.address) ? (lib === "Robinhood" ? "Robinhood" : "BSC") : lib; };
  const usd = (v, digits = 0) => { const x = Number(v); return v === null || v === undefined || v === "" || !Number.isFinite(x) ? "—" : `$${x.toLocaleString("en-US", { maximumFractionDigits: digits })}`; };

  function status(text, tone = "") { const el = $("analyze-status"); el.textContent = text; el.dataset.tone = tone; }
  function findKey(obj, keys, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 6) return undefined;
    for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
    for (const v of Object.values(obj)) { const r = findKey(v, keys, depth + 1); if (r !== undefined) return r; }
    return undefined;
  }
  const isKol = (tags) => Array.isArray(tags) && tags.some((t) => ["kol", "renowned"].includes(String(t).toLowerCase()));

  function readRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").filter((r) => r && r.q); } catch { return []; } }
  function saveRecent(entry) {
    const list = [entry, ...readRecent().filter((r) => r.q.toLowerCase() !== entry.q.toLowerCase())].slice(0, 6);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch {  }
  }
  function renderRecent() {
    const box = $("recent");
    const list = readRecent();
    box.hidden = !list.length || !$("result").hidden;
    box.innerHTML = list.length ? `<span>最近查过</span>${list.map((r) => `<button type="button" data-recent="${esc(r.q)}">${r.label ? `<b>${esc(r.label)}</b> ` : ""}${esc(r.q)}</button>`).join("")}` : "";
  }
  $("recent").addEventListener("click", (event) => {
    const button = event.target.closest("[data-recent]");
    if (!button) return;
    $("analyze-input").value = button.dataset.recent;
    $("analyze-form").requestSubmit();
  });

  function renderQuick(q) {
    libraryGroupOpen = "";
    const c = q.chains?.[q.chain] || {};
    const g = q.gmgn || {};
    const data = g.data || {};
    const facts = [];
    let title = KIND[q.kind] || q.kind || "未知类型";
    if (g.type === "wallet") {
      const tags = findKey(data, ["tags"]) || [];
      const tw = findKey(data, ["twitter_username"]);
      const twName = findKey(data, ["twitter_name", "name"]);
      const pnl = findKey(data, ["realized_profit"]);
      if (twName || tw) title = twName || `@${tw}`;
      if (q.userLabel?.source === "你确认的关联") renderVerdict({ level: "你确认", text: `你确认跟「${q.userLabel.group}」有关联（你判断可能是本人）`, bullets: [{ text: "上下游往来等资金追查完成后补上；要改判定，等追查完在下面按 ✓／✗" }], checked: "你按过的关联判定" });
      else if (q.userLabel) renderVerdict({ level: "你的标签", text: q.userLabel.own ? `你的标签：${q.userLabel.label}（你自己的钱包）` : `你的标签：${q.userLabel.label}${q.userLabel.group && q.userLabel.group !== q.userLabel.label ? `（群组 ${q.userLabel.group}）` : ""}`, bullets: [{ text: "上下游是否属于你标的群组，等资金追查完成后补上" }], checked: "你的私人标签" });
      else if (tw || isKol(tags)) renderVerdict({ level: "确认", text: `本人钱包：${twName || tw || "GMGN KOL 标签钱包"}${tw ? `（@${tw}）` : ""}`, twitter: tw, bullets: [{ text: `GMGN 公开数据直接标示此地址；标签 ${(tags || []).join("、") || "—"}` }], checked: "GMGN 公开钱包数据" });
      else renderVerdict({ level: "…", text: "身分判定中：等资金与迷因币往来追查完成后给出结论", bullets: [], checked: "进行中" });
      const platTags = (Array.isArray(tags) ? tags : []).filter((t) => /fomo|pump/i.test(String(t)));
      if (platTags.length) facts.push(["GMGN 标签", platTags.slice(0, 6).map((t) => `<span class="tag">${esc(t)}</span>`).join(" ")]);
      if (tw) facts.push(["X", `<a href="https://x.com/${encodeURIComponent(tw)}" target="_blank" rel="noopener">@${esc(tw)}</a>`]);
      if (pnl !== undefined) facts.push(["30 天已实现", `<span class="num ${Number(pnl) >= 0 ? "up" : "down"}">${esc(usd(pnl))}</span>`]);
    } else if (g.type === "token") {
      const pick = (k) => findKey(data, k);
      const numOf = (v) => { if (v && typeof v === "object") v = v.price ?? v.usd ?? v.price_usd; const x = Number(v); return v === null || v === undefined || v === "" || !Number.isFinite(x) ? null : x; };
      const symbol = pick(["symbol"]) || c.symbol || "";
      const name = pick(["name"]) || "";
      if (symbol) title = q.symbol = String(symbol);
      const price = numOf(pick(["price", "price_usd"]));
      facts.push(["价格", `<span class="num">${price === null ? "—" : `$${price.toLocaleString("en-US", { maximumSignificantDigits: 6 })}`}</span>`]);
      facts.push(["流动性", `<span class="num">${esc(usd(numOf(pick(["liquidity"]))))}</span>`]);
      facts.push(["持有人", `<span class="num">${esc(pick(["holder_count", "holders"]) ?? "—")}</span>`]);
      if (name && name.toLowerCase() !== String(symbol).toLowerCase()) facts.unshift(["名称", esc(name)]);
      const creator = pick(["creator_address", "creator"]);
      if (creator) facts.push(["创建者", wallet(creator, q.chain)]);
    } else if (g.error) {
      facts.push(["GMGN", `<span class="muted">未取得：${esc(g.error)}</span>`]);
    }
    if (q.kind === "eip7702" && c.delegate) facts.push(["委派合约", addr(c.delegate)]);
    const lib = q.library || {};
    if (q.kind === "token") facts.push(["钱包库", `<span id="quick-library">${tokenLibraryHtml(lib, q.address)}</span>`]);
    else if (lib.ok || lib.missing || lib.error) facts.push(["钱包库", `<span id="quick-wallet-library">${walletLibraryHtml(lib)}</span>`]);

    const chainRows = Object.entries(q.chains || {}).map(([chain, v]) => `<tr><td>${esc(chain)}</td><td>${esc(KIND[v.kind] || v.kind)}</td><td class="num">${v.balance == null ? "—" : `${Number(v.balance).toLocaleString("zh-CN", { maximumFractionDigits: 4 })} ${NATIVE[chain] || ""}`}</td><td class="num">${v.nonce ?? "—"}</td></tr>`).join("");
    const errs = Object.entries(q.errors || {}).map(([k, v]) => `${k}：${v}`).join("；");
    const kindLabel = KIND[q.kind] || q.kind;
    $("quick-card").innerHTML = `<div class="rh-title"><h2>${esc(title)}</h2>${q.chain ? `<span class="chain-tag">${esc(q.chain)}</span>` : ""}${title !== kindLabel ? `<span class="tag">${esc(kindLabel)}</span>` : ""}</div>
      <div class="rh-addr">${["wallet", "eip7702"].includes(q.kind) ? wallet(q.address, q.chain) : addr(q.address)}</div>
      ${KIND_NOTE[q.kind] ? `<p class="trace-data-note">${esc(KIND_NOTE[q.kind])}</p>` : ""}
      ${c.zeroSol ? '<p class="trace-data-note">帐户里 0 SOL：手续费由别人代付（FOMO 这类 App 钱包常见），链上查不到帐户本体，但有交易纪录，照钱包分析。</p>' : ""}
      ${facts.length ? `<dl class="rh-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>` : ""}
      ${q.kind === "token" ? '<section class="lib-group-list" id="quick-library-list" aria-live="polite" hidden></section>' : ""}
      <details class="rh-more"><summary>各链状态与查找时间</summary>
        <div class="compact-table"><table><thead><tr><th>链</th><th>类型</th><th>主币余额</th><th>交易数</th></tr></thead><tbody>${chainRows}</tbody></table></div>
        ${errs ? `<p class="trace-data-note">部分链查找失败：${esc(errs)}</p>` : ""}
        <p class="trace-data-note" id="timing-note">查找时间 ${esc(localTime())}；判断 ${q.timings?.detectMs ?? "—"} ms、GMGN ${q.timings?.gmgnMs ?? "—"} ms${q.detectCached ? "（类型取自缓存）" : ""}。</p>
      </details>`;
    const links = [];
    const gmgnSlug = GMGN_SLUG[q.chain];
    if (gmgnSlug && q.kind === "token") links.push(`<a class="btn btn-sm btn-ghost" href="https://gmgn.ai/${gmgnSlug}/token/${encodeURIComponent(q.address)}" target="_blank" rel="noopener">GMGN</a>`);
    if (gmgnSlug && ["wallet", "eip7702"].includes(q.kind)) links.push(`<a class="btn btn-sm btn-ghost" href="https://gmgn.ai/${gmgnSlug}/address/${encodeURIComponent(q.address)}" target="_blank" rel="noopener">GMGN</a>`);
    if (DEX_SLUG[q.chain] && q.kind === "token") links.push(`<a class="btn btn-sm btn-ghost" href="https://dexscreener.com/${DEX_SLUG[q.chain]}/${encodeURIComponent(q.address)}" target="_blank" rel="noopener">DexScreener</a>`);
    if (EXPLORER[q.chain]) links.push(`<a class="btn btn-sm btn-ghost" href="${EXPLORER[q.chain]}${encodeURIComponent(q.address)}" target="_blank" rel="noopener">浏览器</a>`);
    if (["wallet", "eip7702"].includes(q.kind) && walletChainTag(q)) links.unshift(`<button type="button" class="btn btn-sm" data-wallet-edit="${esc(q.address)}" data-chain="${esc(walletChainTag(q))}">✎ 改标签／备注</button>`);
    $("quick-links").innerHTML = links.join("");
    return { title: q.kind === "token" || g.type === "wallet" ? title : "" };
  }

  const GROUP_TONE = { follow: "profit", avoid: "candidate", ref: "linked" };
  const dayFmt = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" });
  const clockFmt = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const stamp = (sec) => { const d = new Date(sec * 1000); return dayFmt.format(d) === dayFmt.format(new Date()) ? clockFmt.format(d) : `${dayFmt.format(d)} ${clockFmt.format(d)}`; };
  let libraryGroupOpen = "";
  const groupChip = (id, tone, text, title) => `<button type="button" class="data-tag ${tone} lib-chip" data-lib-group="${id}" aria-expanded="${libraryGroupOpen === id}" title="${esc(title)}">${esc(text)}</button>`;
  function tokenLibraryHtml(lib, ca) {
    if (lib.ok && Array.isArray(lib.groups)) {
      const chips = lib.groups.filter((g) => g.wallets).map((g) => groupChip(g.id, GROUP_TONE[g.id] || "strong", `${g.label} ${g.wallets}`,
        `点一下列出是哪些钱包：${(g.labels || []).map((l) => `${l.label} ${l.count}`).join("、")}`));
      if (lib.quiet) chips.push(groupChip("quiet", "muted", `低盈利 ${lib.quiet}`, "点一下列出是哪些钱包。总体盈利未达门槛的钱包在钱包库预设隐藏，进库满一段时间还是不到就定期清掉"));
      const when = lib.writtenAt ? `，上次写入 ${esc(stamp(lib.writtenAt))}${lib.writtenBy ? `（${esc(lib.writtenBy)}）` : ""}` : "";
      return `${Number(lib.wallets).toLocaleString()} 个地址${when}${chips.length ? ` ${chips.join(" ")}` : ""} <a href="library.html?q=${encodeURIComponent(ca)}">打开钱包库</a>`;
    }
    if (lib.error) return `<span class="muted">查找失败：${esc(lib.error)}</span>`;
    return '<span class="muted">尚无纪录，分析完会自动写入</span>';
  }
  let librarySeq = 0;
  async function refreshTokenLibrary(q) {
    if (!q || q.kind !== "token") return;
    const seq = ++librarySeq;
    try {
      const res = await fetch("/api/library/token-summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chain: q.chain, ca: q.address }), cache: "no-store" });
      const lib = await res.json().catch(() => null);
      if (!res.ok || !lib || seq !== librarySeq || current !== q) return;
      q.library = lib;
      const el = $("quick-library");
      if (el) el.innerHTML = tokenLibraryHtml(lib, q.address);
      if (libraryGroupOpen) showLibraryGroup(q, libraryGroupOpen, true);
    } catch {  }
  }

  const GROUP_NAME = { follow: "高手", avoid: "要避开", ref: "参考", quiet: "低盈利" };
  let libraryGroupSeq = 0;
  const hereRank = (h) => h?.realized ?? -Infinity;
  const hereMoney = (value) => {
    const n = safeNumber(value);
    return n === null ? '<span class="muted">--</span>' : `<span class="${pnlClass(n)}">${n > 0 ? "+" : ""}${formatUsd(n)}</span>`;
  };
  const cardCell = (item) => (typeof libraryCardCompact === "function" ? libraryCardCompact(item.card) : '<span class="muted">--</span>');
  function hereRow(item) {
    const h = item.here;
    const mine = new Set([...(h?.labels || []), ...(h?.partly || [])]);
    const other = (item.labels || []).filter((label) => !mine.has(label));
    const partly = h?.partly?.length ? ` ${libraryLabelTags(h.partly)}<small class="muted">（要好几颗币才成立，这颗算一颗）</small>` : "";
    const here = h?.labels?.length ? libraryLabelTags(h.labels) + partly : partly || '<span class="muted">没有</span>';
    let realized = '<span class="muted">--</span>', unreal = realized;
    if (h && h.total === null && h.realized === null) {
      realized = unreal = '<span class="muted" title="平台没给盈亏、GMGN 只看到转入，算不出来">不知道</span>';
    } else if (h) {
      realized = `${hereMoney(h.realized)}${h.sold ? "" : '<small class="muted">还没卖</small>'}`;
      unreal = `${hereMoney(h.unrealized)}${h.holding ? "" : '<small class="muted">已出清</small>'}`;
    }
    const src = h?.source && h.source !== "GMGN" ? `<small class="muted">${esc(h.source)} 算的</small>` : "";
    return `<tr>
      <td data-label="钱包">${walletCell(item.address, item.chain)}${libraryPlatformLine(item.platforms)}</td>
      <td data-label="标签">${item.quiet ? `${dataTag("低盈利", "muted")} ` : ""}
        <div class="lib-src"><span class="lib-src-k">这颗币</span><span>${here}</span></div>
        <div class="lib-src is-other"><span class="lib-src-k" title="别颗币，或钱包整体（推特、GMGN 30 天盈利、GMGN 钱包标签）">别处</span><span>${other.length ? libraryLabelTags(other, item.manualLabels || []) : '<span class="muted">没有</span>'}</span></div></td>
      <td data-label="实力">${cardCell(item)}</td>
      <td data-label="这颗币已实现" class="num">${realized}${src}</td>
      <td data-label="这颗币帐面" class="num">${unreal}</td>
      <td data-label="出现 CA 数" class="num">${esc(item.caCount)}</td>
      <td data-label="累计盈利" class="num">${formatUsd(item.totalPnl)}</td>
      <td data-label="备注">${esc(item.note || "")}</td></tr>`;
  }
  function hereSummary(items, group) {
    const parts = [];
    if (group !== "quiet") {
      const inGroup = (labels) => (labels || []).some((label) => LIBRARY_LABEL_GROUP[label] === group);
      const full = items.filter((item) => inGroup(item.here?.labels)).length;
      const part = items.filter((item) => !inGroup(item.here?.labels) && inGroup(item.here?.partly)).length;
      parts.push(`${full} 个的「${GROUP_NAME[group]}」标签是这颗币给的${part ? `、${part} 个有一部分是这颗` : ""}、${items.length - full - part} 个是别处给的`);
    }
    const won = items.filter((item) => (item.here?.realized || 0) > 0).length;
    const unsold = items.filter((item) => item.here && !item.here.sold).length;
    parts.push(`在这颗币卖掉有赚的 ${won} 个、一颗都还没卖的 ${unsold} 个`);
    return parts.join("；");
  }
  async function showLibraryGroup(q, group, refresh = false) {
    const box = $("quick-library-list");
    if (!box || !q) return;
    if (!refresh && libraryGroupOpen === group && !box.hidden) group = "";
    libraryGroupOpen = group;
    document.querySelectorAll("[data-lib-group]").forEach((chip) => chip.setAttribute("aria-expanded", String(chip.dataset.libGroup === group)));
    const seq = ++libraryGroupSeq;
    if (!group) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    if (!refresh) box.innerHTML = '<p class="trace-data-note">读取中…</p>';
    try {
      const data = await libraryPost("/api/library/search", { q: q.address, chain: libChainName(q.chain), token: q.address, label: group === "quiet" ? "" : `group:${group}`, showQuiet: true, limit: 500 });
      if (seq !== libraryGroupSeq || current !== q) return;
      const items = (data.items || []).filter((item) => group !== "quiet" || item.quiet);
      const hasHere = items.some((item) => "here" in item);
      if (hasHere) items.sort((a, b) => hereRank(b.here) - hereRank(a.here) || (b.here?.total ?? -Infinity) - (a.here?.total ?? -Infinity));
      if (typeof libraryUseCard === "function") libraryUseCard(data);
      const rows = items.map((item) => hasHere ? hereRow(item) : `<tr>
        <td data-label="钱包">${walletCell(item.address, item.chain)}${libraryPlatformLine(item.platforms)}</td>
        <td data-label="标签">${item.quiet ? `${dataTag("低盈利", "muted")} ` : ""}${libraryLabelTags(item.labels, item.manualLabels)}</td>
        <td data-label="实力">${cardCell(item)}</td>
        <td data-label="出现 CA 数" class="num">${esc(item.caCount)}</td>
        <td data-label="累计盈利" class="num">${formatUsd(item.totalPnl)}</td>
        <td data-label="备注">${esc(item.note || "")}</td></tr>`).join("");
      const head = hasHere
        ? `<th>钱包</th><th>标签</th><th>实力</th><th class="num">这颗币已实现</th><th class="num">这颗币帐面</th><th class="num">出现 CA 数</th><th class="num">累计盈利</th><th>备注</th>`
        : `<th>钱包</th><th>标签</th><th>实力</th><th class="num">出现 CA 数</th><th class="num">累计盈利</th><th>备注</th>`;
      const note = hasHere
        ? "「这颗币」两栏只算这颗：已实现＝卖掉赚赔的，帐面＝还没卖的部分照现价算。标签分成这颗币给的、别颗币或钱包整体给的。实力＝他自己 30 天赚不赚，不代表跟了会赚。累计盈利是这个钱包在库里所有币加总。按 ☆ 加进聪明钱追踪"
        : "标签是钱包整体的，可能来自别颗币；实力＝他自己 30 天赚不赚，不代表跟了会赚；累计盈利是这个钱包在库里所有币加总。按 ☆ 加进聪明钱追踪";
      box.innerHTML = `<div class="lib-list-head"><h3>${esc(GROUP_NAME[group] || group)} ${items.length} 个</h3>
          <span class="muted">${note}</span>
          <button type="button" class="btn btn-sm btn-ghost" data-lib-group-close>收起</button></div>
        ${hasHere && items.length ? `<p class="lib-here-sum">${hereSummary(items, group)}</p>` : ""}
        ${items.length ? `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`
          : '<p class="trace-data-note">钱包库里没有符合的钱包（可能刚被改了标签），按「打开钱包库」看全部。</p>'}`;
    } catch (error) {
      if (seq === libraryGroupSeq) box.innerHTML = `<p class="trace-data-note">读取失败：${esc(error.message)}</p>`;
    }
  }
  $("quick-card").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-lib-group]");
    if (chip) { event.preventDefault(); showLibraryGroup(current, chip.dataset.libGroup); return; }
    if (event.target.closest("[data-lib-group-close]")) showLibraryGroup(current, "");
  });

  function walletLibraryHtml(lib) {
    if (lib.ok && lib.wallet) {
      if (lib.rules && typeof libraryUseRules === "function") libraryUseRules(lib.rules);
      const name = (l) => (typeof libraryLabelText === "function" ? libraryLabelText(l) : l);
      const labels = lib.wallet.labels || [];
      const note = String(lib.wallet.note || "").trim();
      const other = current?.chain && lib.wallet.chain && lib.wallet.chain !== current.chain ? `（${esc(lib.wallet.chain)}，同一个地址）` : "";
      return `${other}出现在 ${lib.appearances?.length || 0} 个 CA${labels.length ? `，标签 ${labels.map((l) => `<span class="tag">${esc(name(l))}</span>`).join(" ")}` : ""}${note ? `<small class="quick-note">备注：${esc(note.length > 80 ? `${note.slice(0, 80)}…` : note)}</small>` : ""}`;
    }
    if (lib.error && !lib.missing) return `<span class="muted">查找失败：${esc(lib.error)}</span>`;
    return '<span class="muted">尚无纪录，分析完会自动写入；可以按右上「改标签／备注」先自己标注</span>';
  }
  async function refreshWalletLibrary(q) {
    const chain = typeof libChainName === "function" ? libChainName(q?.chain) || (/^0x/i.test(String(q?.address || "")) ? "BSC" : "") : "";
    if (!q || !chain || !["wallet", "eip7702"].includes(q.kind)) return;
    try {
      const chains = chain === "Solana" ? [chain] : [chain, chain === "BSC" ? "Robinhood" : "BSC"];
      let lib = null;
      for (const c of chains) {
        const res = await fetch("/api/library/wallet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chain: c, address: q.address }), cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.ok) { lib = data; break; }
      }
      if (current !== q) return;
      q.library = lib || { missing: true };
      const el = $("quick-wallet-library");
      if (el) el.innerHTML = walletLibraryHtml(q.library);
    } catch {  }
  }
  document.addEventListener("wallet-annotated", (event) => {
    const q = current;
    const a = String(event.detail?.address || "");
    if (q && a && (a === q.address || a.toLowerCase() === String(q.address).toLowerCase())) refreshWalletLibrary(q);
  });

  function reviewHtml(v) {
    const targets = v.review?.targets || [];
    if (!targets.length) return "";
    const state = (t) => (t.verdict === "yes" ? "你确认有关联" : t.verdict === "no" ? "你判定不是" : "不确定");
    return `<div class="verdict-review">
      <p>这个钱包跟下面的对象有关联吗？✓＝有关联（可能是本人），✗＝不是，没按＝不确定。再按一次同一颗就清掉。</p>
      ${targets.map((t, i) => `<div class="verdict-review-row">
        <span class="verdict-review-who">${t.kind === "group" ? "你标的群组" : "KOL"}「${esc(t.label)}」</span>
        <span class="verdict-review-buttons">
          <button type="button" class="btn btn-sm review-yes" data-review="${i}" data-verdict="yes" aria-pressed="${t.verdict === "yes"}">✓ 有关联</button>
          <button type="button" class="btn btn-sm review-no" data-review="${i}" data-verdict="no" aria-pressed="${t.verdict === "no"}">✗ 不是</button>
        </span>
        <small>${state(t)}${t.verdict && t.at ? `（${esc(stamp(t.at))}）` : ""}</small>
      </div>`).join("")}
    </div>`;
  }
  $("verdict-card").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-review]");
    const v = window.__verdict;
    if (!button || !v?.review || typeof setLinkReview !== "function") return;
    const t = v.review.targets[Number(button.dataset.review)];
    if (!t) return;
    const verdict = t.verdict === button.dataset.verdict ? null : button.dataset.verdict;
    button.closest(".verdict-review").querySelectorAll("button").forEach((b) => { b.disabled = true; });
    try {
      const r = await setLinkReview(v, t, verdict);
      if (window.__verdict !== v) return;
      renderVerdict(r.verdict);
      toast(verdict === "yes" ? `已记下：跟「${t.label}」有关联${r.created ? "，这个钱包已加进钱包库" : ""}` : verdict === "no" ? `已记下：跟「${t.label}」无关` : "已清掉，回到不确定");
    } catch (error) {
      if (window.__verdict === v) renderVerdict(v);
      toast(`没存到：${error.message}`);
    }
  });
  function renderVerdict(v) {
    const card = $("verdict-card");
    if (!v) { card.hidden = true; return; }
    const lv = { 你的标签: "lv-high", 你确认: "lv-high", 确认: "lv-high", 高: "lv-high", 中: "lv-medium" }[v.level] || "";
    const levelText = v.level === "…" ? "判定中" : ["你的标签", "你确认", "确认"].includes(v.level) ? v.level : `信心 ${v.level}`;
    const keepOpen = card.__verdict === v && card.querySelector(":scope > details")?.open;
    card.__verdict = v;
    const bullets = (v.bullets || []).map((b) => `<li>${esc(b.text)}${b.txs?.length ? `<br>${b.txs.map((t) => `<a href="${esc(t.href)}" target="_blank" rel="noopener"><code class="full-address">${esc(t.hash)}</code></a>`).join("<br>")}` : ""}</li>`).join("");
    const hasDetail = bullets || v.peer || v.others?.length || (v.checked && v.checked !== "进行中");
    card.className = `verdict ${lv}`;
    card.hidden = false;
    card.innerHTML = `<span class="verdict-level">${esc(levelText)}</span>
      <div class="verdict-text">${esc(v.text)}${v.gmgnText ? `<small>${esc(v.gmgnText)}</small>` : ""}${v.twitter ? `<small><a href="https://x.com/${encodeURIComponent(v.twitter)}" target="_blank" rel="noopener">X 个人页 @${esc(v.twitter)}</a></small>` : ""}</div>
      ${reviewHtml(v)}
      ${hasDetail ? `<details${keepOpen ? " open" : ""}><summary>判定依据</summary>
        ${v.peer ? `<p>关联 KOL 钱包：${wallet(v.peer)}${v.peerTags ? `（标签：${esc(v.peerTags)}）` : ""}</p>` : ""}
        ${bullets ? `<ul>${bullets}</ul>` : ""}
        ${v.others?.length ? `<p class="trace-data-note">其他有标签的往来钱包：${v.others.map((o) => `${wallet(o.address)} ${esc(o.label)}（${esc(o.level)}）`).join("；")}</p>` : ""}
        <p class="trace-data-note">已检查：${esc(v.checked)}。资金或代币往来只代表「相关」，不代表同一主人；KOL 只采 GMGN 公开标签。${v.review?.targets?.some((t) => t.verdict === "yes") ? "「可能是本人」是你按 ✓ 的判断。" : ""}</p>
      </details>` : ""}`;
  }

  const FOMO_BOOKMARKLET = "javascript:(async()=>{try{const m=location.pathname.match(/\\/tokens\\/(bnb|robinhood|solana)\\/([0-9a-zA-Z]{32,44})(?:\\/|$)/);const sol=!!m&&m[1]==='solana';if(!m||!(sol?/^[1-9A-HJ-NP-Za-km-z]{32,44}$/:/^0x[0-9a-fA-F]{40}$/).test(m[2]))return alert('请在 fomo.family 的 BSC、Solana 或 Robinhood 币页使用');const nid={bnb:56,robinhood:4663,solana:1399811149}[m[1]];const ca=m[2];const t=JSON.parse(localStorage.getItem('privy:token')||'null');if(!t)return alert('未登录 FOMO');const r=await fetch('https://prod-api.fomo.family/hodlers/top?tokens='+encodeURIComponent(JSON.stringify([{address:ca,networkId:nid}])),{headers:{Accept:'application/json','X-Supported-Chains':nid===56?'solana,base,bnb':'1,56,143,4663,5042,8453,1399811149',Authorization:'Bearer '+t}});const j=await r.json();const d=(j.responseObject||[])[0]||{};const h=d.topHolders||[];const o={ca:sol?ca:ca.toLowerCase(),networkId:nid,at:Date.now(),total:d.totalHolders,holders:h.map(x=>({handle:x.user&&x.user.userHandle,followers:x.user&&x.user.followers,amount:+x.humanAmount,pnl:x.pnl}))};await navigator.clipboard.writeText(JSON.stringify(o));alert('已拷贝 '+o.ca+' 的 '+o.holders.length+' 笔 FOMO 持有人（不含登录凭证）。回查地址页按「从剪贴板粘贴并比对」，或直接按 Ctrl+V')}catch(e){alert('失败：'+e.message)}})();";
  const FOMO_CHAINS = {
    bsc: { slug: "bnb", networkId: 56, name: "BSC", sample: "0x..." },
    sol: { slug: "solana", networkId: 1399811149, name: "Solana", sample: "...pump" },
    robinhood: { slug: "robinhood", networkId: 4663, name: "Robinhood", sample: "0x..." },
  };
  const fomoTokenUrl = (chain, ca) => `https://fomo.family/tokens/${FOMO_CHAINS[chain].slug}/${encodeURIComponent(ca)}`;
  function fomoManualBlock(q, fomo, chain, libCount = 0) {
    const done = Boolean(fomo && fomo.ok);
    const steps = `<ol class="fomo-steps">
        <li><a class="btn btn-sm" id="fomo-open" href="${esc(fomoTokenUrl(chain, q.address))}" target="_blank" rel="noopener">打开这颗币的 FOMO 页</a></li>
        <li>在那页按书签列的「持币」。第一次用先把 <a id="fomo-bm">持币</a> 拖到书签列（书签列没出现就按 Ctrl+Shift+B）；在这颗币的 pump.fun 页按同一颗，会自动开查地址页补上 pump.fun 名字。</li>
        <li>回到这里按 <button type="button" class="btn btn-sm btn-primary" id="fomo-clip">从剪贴板粘贴并比对</button>，或直接按 Ctrl+V。</li>
      </ol>
      <details class="fomo-fallback"><summary>剪贴板读不到时，手动粘贴</summary>
        <textarea id="fomo-paste" rows="3" spellcheck="false" placeholder='{"ca":"${FOMO_CHAINS[chain].sample}","networkId":${FOMO_CHAINS[chain].networkId},"at":0,"total":0,"holders":[...]}'></textarea>
        <div class="row-actions"><button type="button" class="btn btn-sm" id="fomo-apply">用粘贴的名单比对</button></div>
      </details>
      <p class="fomo-manual-note">名单附 CA、链和抓取时间，贴错币或错链会被挡下；登录凭证不会传到这里。</p>`;
    if (done) {
      return `<details class="fomo-manual"><summary>FOMO 已比对（${esc(fomo.source || "")}，抓取 ${esc(fomo.fetchedAt || "")}），门槛以上 ${fomo.aboveCutoff ?? 0} 人、对上 ${fomo.matched ?? 0} 人。<span class="fomo-manual-more">重新补上</span></summary>${steps}</details>`;
    }
    const title = libCount
      ? `这次还没贴 FOMO 名单：下表先标出钱包库原本记着的 ${libCount} 个 FOMO 帐号（标「钱包库记录」，之前贴过的都存着，不会不见）。要抓新进前 100 的人，照下面三步再贴一次，大约 10 秒。`
      : "还没有 FOMO 名单。照下面三步补上，大约 10 秒。";
    return `<section class="fomo-manual is-open" aria-label="补上 FOMO 名字"><p class="fomo-manual-title">${title}</p>${steps}</section>`;
  }
  function applyFomoText(text, quiet) {
    let j = null;
    try { j = JSON.parse(String(text || "").trim()); } catch {  }
    if (Array.isArray(j)) { toast("这是旧版书签的名单（没有 CA），请换新版书签重按"); return true; }
    if (j && j.kind === "wi-fomo") {
      if (!j.holders) {
        if (quiet) return false;
        toast("剪贴板里没有这颗币的 FOMO 持有人：要在这颗币的 FOMO 币页按「持币」书签");
        return true;
      }
      j = j.holders;
    }
    if (!j || !Array.isArray(j.holders)) {
      if (!quiet) toast("剪贴板里不是 FOMO 名单，请在这颗币的 FOMO 页重按书签");
      return false;
    }
    if (String(j.ca || "").toLowerCase() !== String(platformQ.address).toLowerCase()) {
      toast("剪贴板里是别颗币的 FOMO 名单，请到这颗币的 FOMO 页重按书签");
      return true;
    }
    const want = FOMO_CHAINS[platformChain(platformQ)];
    if (!want) return false;
    if (j.networkId == null && want.networkId !== 56) {
      toast(`旧版书签只会抓 BSC，${want.name} 的币请先把新版书签拖到书签列再重按`);
      return true;
    }
    if (j.networkId != null && Number(j.networkId) !== want.networkId) {
      toast(`剪贴板里是别条链的 FOMO 名单，这颗币在 ${want.name}，请到这颗币的 FOMO 页重按书签`);
      return true;
    }
    toast(`收到 ${j.holders.length} 笔 FOMO 持有人，比对中`);
    loadPlatform(platformQ, j);
    return true;
  }
  function wireFomoManual() {
    $("fomo-bm").setAttribute("href", typeof wiBookmarklet === "function" ? wiBookmarklet(location.origin, "hold") : FOMO_BOOKMARKLET);
    $("fomo-bm").addEventListener("click", (event) => { event.preventDefault(); toast("要拖到书签列，到 FOMO 币页再按"); });
    $("fomo-open").addEventListener("click", () => { fomoAwaiting = true; });
    $("fomo-clip").addEventListener("click", async () => {
      let text = "";
      try { text = await navigator.clipboard.readText(); } catch { return toast("浏览器没让这页读剪贴板，改按 Ctrl+V，或展开下方手动粘贴"); }
      applyFomoText(text);
    });
    $("fomo-apply").addEventListener("click", () => applyFomoText($("fomo-paste").value));
  }
  let fomoAwaiting = false;
  window.addEventListener("focus", () => {
    if (!fomoAwaiting) return;
    fomoAwaiting = false;
    $("fomo-clip")?.focus();
  });
  document.addEventListener("paste", (event) => {
    if (!platformQ || !FOMO_CHAINS[platformChain(platformQ)] || $("tab-platform").hidden) return;
    if (event.target.closest?.("input, textarea, select, [contenteditable]")) return;
    const text = event.clipboardData?.getData("text") || "";
    if (!text.includes('"holders"')) return;
    if (applyFomoText(text, true)) event.preventDefault();
  });

  const pumpHold = (() => {
    const p = new URLSearchParams(location.search);
    if (p.get("pump") !== "1" || !p.get("q") || !window.opener || typeof wiRelayClient !== "function") return null;
    return { mint: p.get("q"), client: wiRelayClient(), started: false };
  })();
  const sameCa = (a, b) => { const x = String(a || ""), y = String(b || ""); return x.startsWith("0x") ? x.toLowerCase() === y.toLowerCase() : x === y; };
  async function fetchPumpHolders(q, cutoff) {
    if (!pumpHold || pumpHold.started || !sameCa(pumpHold.mint, q.address)) return;
    pumpHold.started = true;
    const ready = await pumpHold.client.ready;
    if (!ready.ok) {
      toast(ready.old ? "你按的是旧版书签：请把这页的「持币」拖到书签列，再到 pump.fun 币页按一次" : "没接上 pump.fun 页（是不是关掉或换页了？）：回这颗币的 pump.fun 页再按一次「持币」");
      return;
    }
    const positions = [];
    try {
      for (let page = 0; page < 40; page += 1) {
        toast(`读 pump.fun 持有人第 ${page + 1} 页…`);
        const qs = new URLSearchParams({ sortBy: "TOP", withThesis: "false", pageSize: "50", page: String(page) });
        const j = await pumpHold.client.get(`https://frontend-api-v3.pump.fun/mint-positions/${encodeURIComponent(pumpHold.mint)}?${qs}`, { wait: toast });
        const rows = Array.isArray(j && j.positions) ? j.positions.filter((x) => x && typeof x === "object") : [];
        for (const x of rows) {
          positions.push({ userName: x.userName, xUsername: x.xUsername, isVerified: x.isVerified, amountHeld: x.amountHeld,
            pnlUsd: x.pnlUsd, realizedPnlUsd: x.realizedPnlUsd, costBasisUsd: x.costBasisUsd });
        }
        if (!rows.length || !j.hasMore || Math.min(...rows.map((x) => Number(x.amountHeld) || 0)) < cutoff) break;
      }
    } catch (err) {
      toast(`读 pump.fun 持有人失败：${err.message}`);
      return;
    }
    if (platformQ !== q) return;
    q.pumpList = { ca: pumpHold.mint, at: Date.now(), positions };
    toast(`收到 ${positions.length} 笔 pump.fun 持有人，比对中`);
    loadPlatform(q);
  }

  let platformQ = null;
  function platformChain(q) {
    const c = String(q.chain || "").toLowerCase();
    return c.startsWith("bsc") || c === "bnb" ? "bsc" : c.startsWith("sol") ? "sol" : c.startsWith("robin") ? "robinhood" : "";
  }
  async function loadPlatform(q, fomoList) {
    const card = $("platform-card");
    const chain = platformChain(q);
    $("tab-platform").hidden = q.kind !== "token" || !chain;
    if ($("tab-platform").hidden) return;
    platformQ = q;
    $("platform-count").textContent = "";
    card.innerHTML = `<div class="skel-table" aria-hidden="true">${"<div><span class=\"skel\"></span><span class=\"skel\"></span><span class=\"skel\"></span><span class=\"skel\"></span><span class=\"skel\"></span></div>".repeat(4)}</div>`;
    try {
      if (fomoList) q.fomoList = fomoList;
      const body = { ca: q.address, chain, symbol: q.symbol || "" };
      if (q.fomoList) body.fomoList = q.fomoList;
      if (q.pumpList) body.pumpList = q.pumpList;
      const res = await fetch("/api/match/platform-users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const r = await res.json().catch(() => ({}));
      if (!res.ok || !r.ok) throw new Error(r.error || `HTTP ${res.status}`);
      if (platformQ !== q && !fomoList) return;
      const prevStored = q.platformStored || null;
      let stored = {}, storedOk = false;
      try {
        const addrs = r.rows.filter((x) => !x.isExchangeOrContract).map((x) => x.address);
        const lr = await fetch("/api/ext/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chain, ca: q.address, addresses: addrs }) });
        const lj = await lr.json().catch(() => ({}));
        if (lr.ok && lj.ok) { stored = lj.items || {}; storedOk = true; q.platformStored = stored; }
      } catch {  }
      if (platformQ !== q && !fomoList) return;
      const livePlats = (x) => String(x.platform || "").split("/").filter(Boolean);
      const libPlats = (x) => (x.isExchangeOrContract ? [] : ((stored[x.address] || {}).platforms || []).filter((p) => p && p.handle && !livePlats(x).includes(p.platform)));
      const libFomo = r.rows.filter((x) => libPlats(x).some((p) => p.platform === "FOMO")).length;
      const livePairs = (x) => (x.isExchangeOrContract ? [] : [x.fomoHandle && { a: x.address, p: "FOMO", h: x.fomoHandle }, x.pumpName && { a: x.address, p: "pump.fun", h: x.pumpName }].filter(Boolean));
      const inLib = (m, e) => ((m[e.a] || {}).platforms || []).some((p) => p && p.platform === e.p && String(p.handle || "").toLowerCase() === String(e.h).toLowerCase());
      const pairs = r.rows.flatMap(livePairs);
      const saved = storedOk ? pairs.filter((e) => inLib(stored, e)) : [];
      const missing = storedOk ? pairs.filter((e) => !inLib(stored, e)) : [];
      const fresh = storedOk && prevStored ? saved.filter((e) => !inLib(prevStored, e)) : null;
      const savedMark = (x) => {
        const ps = livePairs(x);
        if (!ps.length || !storedOk) return "";
        const miss = ps.filter((e) => !inLib(stored, e));
        return miss.length ? `<small class="lib-miss" title="存完重新读钱包库，没有读到这个帐号">没存到钱包库</small>` : `<small class="lib-ok" title="存完重新读钱包库，读得到这个帐号">✓ 已存进钱包库</small>`;
      };
      const n = (v) => (v == null ? "" : Math.round(v).toLocaleString());
      const st = Object.entries(r.status).map(([k, v]) => `<li>${esc(k)}：${v.ok ? `成功（${v.source ? `${esc(v.source)} ` : ""}${esc(v.fetchedAt || "")}${v.aboveCutoff != null ? `，门槛以上 ${v.aboveCutoff}，对上 ${v.matched}` : ""}）${(v.warnings || []).map((w) => `<br><strong>注意：${esc(w)}</strong>`).join("")}` : v.skipped ? `不适用：${esc(v.note)}` : `失败或缺口：${esc(v.error)}`}</li>`).join("");
      const hasPump = !r.status.pumpfun?.skipped;
      const hasFomo = Boolean(FOMO_CHAINS[chain]) && !r.status.fomo?.skipped;
      const plats = [r.status.fomo?.skipped ? "" : "FOMO", hasPump ? "pump.fun" : ""].filter(Boolean).join(" 或 ");
      const rows = r.rows.map((x) => { const lp = libPlats(x); const lpFomo = lp.find((p) => p.platform === "FOMO"); return `<tr class="${x.isExchangeOrContract ? "row-exchange" : ""}${x.platform || lp.length ? " hit" : ""}"><td class="num">${x.rank}</td><td>${x.isExchangeOrContract ? addr(x.address) : wallet(x.address, q.chain)}${x.isExchangeOrContract ? `<small>${x.isPool ? "池子或交易所" : "合约（机器人或打包）"}，不列入真人身分</small>` : ""}</td><td class="num">${n(x.amount)}</td><td class="num">${x.pct}%</td><td class="num">${n(x.usd)}</td><td class="num">${n(x.pnl)} / ${n(x.realized)} / ${n(x.unrealized)}${x.pumpPnl != null || x.fomoPnl != null ? `<small>平台：${n(x.pumpPnl ?? x.fomoPnl)}（${x.pumpPnl != null ? "pump.fun" : "FOMO"}，以这个为准）</small>` : ""}</td><td>${esc(x.tags.join(", "))}</td><td>${esc(x.gmgnName || "")}</td><td>${x.twitter ? `@${esc(x.twitter)}` : ""}</td><td>${esc(x.platform)}${savedMark(x)}${lp.length ? `${x.platform ? " / " : ""}${esc(lp.map((p) => p.platform).join(" / "))}<small title="之前贴名单对上、存在钱包库的帐号；这次名单没有比到">钱包库记录</small>` : ""}</td><td>${esc(x.fomoHandle || "")}${x.fomoHandle && x.pumpName ? " / " : ""}${esc(x.pumpName || "")}${lp.length ? `${x.fomoHandle || x.pumpName ? " / " : ""}${esc(lp.map((p) => p.handle).join(" / "))}` : ""}</td><td class="num">${x.fomoFollowers ?? (lpFomo && lpFomo.followers != null ? lpFomo.followers : "")}</td>${hasPump ? `<td>${x.pumpX ? `@${esc(x.pumpX)}` : esc(lp.filter((p) => p.platform === "pump.fun" && p.x).map((p) => `@${p.x}`).join(" "))}</td>` : ""}<td><a href="${esc(x.explorer)}" target="_blank" rel="noopener">${String(x.explorer).startsWith("https://gmgn.ai/") ? "GMGN" : "浏览器"}</a></td></tr>`; }).join("");
      const unmatched = ["fomo", "pumpfun"].map((k) => (r.unmatched[k] || []).map((u) => `${k}：${esc(u.handle)}（${n(u.amount)} 颗，${esc(u.reason)}）`).join("；")).filter(Boolean).join("<br>");
      const live = r.rows.filter((x) => x.platform && !x.isExchangeOrContract).length;
      const libOnly = r.rows.filter((x) => !x.platform && libPlats(x).length).length;
      const hits = live + libOnly;
      $("platform-count").textContent = hits ? String(hits) : "";
      const lib = r.library;
      if (lib?.ok) refreshTokenLibrary(q);
      const libUrl = `library.html?q=${encodeURIComponent(q.address)}`;
      const savedBox = !pairs.length || !lib?.ok ? ""
        : !storedOk ? `<div class="lib-check warn">比对完已写进钱包库，但重新读钱包库失败，没办法确认。按上面「重新查找」再看一次，或<a href="${libUrl}">到钱包库看这颗币的地址</a>。</div>`
        : missing.length ? `<div class="lib-check bad">有 ${missing.length} 个帐号没存进钱包库（存完重新读钱包库没读到）：${esc(missing.map((e) => `${e.p} ${e.h}`).join("、"))}。其他 ${saved.length} 个已存。</div>`
        : `<div class="lib-check ok"><b>✓ 已存进钱包库</b>：这次名单对上的 ${saved.length} 个平台帐号，存完重新读钱包库逐一核对过，都在${fresh ? `（新存 ${fresh.length} 个，${saved.length - fresh.length} 个原本就有）` : ""}。下表标「✓ 已存进钱包库」的就是。<a href="${libUrl}">到钱包库看这颗币的地址</a></div>`;
      const libLine = !lib ? "" : lib.ok
        ? `${pairs.length
            ? "存在对上的钱包上：钱包库页搜帐号名字或这颗 CA 都找得到，导出到 GMGN／DeBot 的备注会带「FOMO:名字」。"
            : r.status.fomo?.ok || r.status.pumpfun?.ok ? "这次名单没有对上前 100 的人，没有新的平台帐号要存（之前存的都还在）。" : "这次没贴平台名单，没有新的平台帐号要存（之前存的都还在）。"}前 100 地址 ${lib.stored} 个${lib.added ? `（新加进库 ${lib.added} 个）` : "原本就都在库里"}，库内共 ${Number(lib.libraryWallets).toLocaleString()} 个钱包。<a href="library.html?q=${encodeURIComponent(q.address)}">打开钱包库</a>`
        : `写进钱包库失败：${esc(lib.error || "原因不明")}`;
      card.innerHTML = `<p class="trace-data-note">GMGN 前 100 持有人里，${hits} 个地址有 ${plats} 帐号${libOnly ? `（这次名单对上 ${live} 个；另外 ${libOnly} 个是钱包库原本记着的，标「钱包库记录」）` : ""}。快照 ${esc(r.snapshotLocal)}。</p>
        ${savedBox}
        ${libLine ? `<p class="trace-data-note">${libLine}</p>` : ""}
        ${hasPump && r.status.pumpfun && !r.status.pumpfun.ok && !pumpHold ? `<p class="trace-data-note">pump.fun 名字：到这颗币的 pump.fun 页按「持币」书签，会自动开查地址页补上（pump.fun 不让服务器直接查）。</p>` : ""}
        ${hasFomo ? fomoManualBlock(q, r.status.fomo, chain, libFomo) : ""}
        <div class="table-wrap trace-section"><table><thead><tr><th>#</th><th>完整地址</th><th>持有数量</th><th>持有%</th><th>USD</th><th>GMGN 盈亏 总/已实现/未实现</th><th>GMGN 标签</th><th>GMGN 名称</th><th>推特</th><th>平台</th><th>平台帐号</th><th>FOMO 粉丝</th>${hasPump ? "<th>pump.fun X</th>" : ""}<th>链接</th></tr></thead><tbody>${rows}</tbody></table></div>
        <details class="footnote"><summary>比对规则与数据状态</summary>
          <p>门槛＝第 100 名 ${n(r.cutoff)} 颗。规则：${esc(r.rule)}</p>
          <ul>${st}</ul>
          ${unmatched ? `<p>没对上（不标）：<br>${unmatched}</p>` : ""}
        </details>`;
      if (hasFomo) wireFomoManual();
      if (hasPump && !q.pumpList) fetchPumpHolders(q, Number(r.cutoff) || 0);
    } catch (error) {
      card.innerHTML = `<div class="trace-empty-card"><strong>平台用户比对失败</strong><span>${esc(error.message)}</span></div>`;
    }
  }

  const SKEL_ROWS = (cols, rows = 6) => `<tr><td colspan="${cols}"><div class="skel-table" aria-hidden="true">${"<div><span class=\"skel\"></span><span class=\"skel\"></span><span class=\"skel\"></span><span class=\"skel\"></span><span class=\"skel\"></span></div>".repeat(rows)}</div></td></tr>`;
  function firstTab(barId) {
    const first = document.querySelector(`#${barId} [data-pane]`);
    if (first) window.Shell?.selectPane(first);
  }
  function setChain(chain) {
    const select = $("chain");
    select.value = [...select.options].some((o) => (o.value || o.textContent) === chain) ? chain : "Auto";
  }
  function setRunning(on) {
    const line = $("progress-line");
    line.classList.toggle("is-running", on);
    line.classList.toggle("is-done", !on);
    line.classList.remove("is-open");
    $("analyze-submit").disabled = on;
  }
  $("progress-line").addEventListener("click", () => {
    const line = $("progress-line");
    if (line.classList.contains("is-done")) line.classList.toggle("is-open");
  });
  async function runToken(q) {
    $("token-view").hidden = false;
    $("scan-status").hidden = false;
    $("trace-status").hidden = true;
    firstTab("token-tabs");
    $("contract").value = q.address;
    setChain(q.chain);
    const started = Date.now();
    const job = window.runCaScan();
    $("token-stats").classList.add("is-loading");
    $("early-body").innerHTML = SKEL_ROWS(9);
    $("profit-body").innerHTML = SKEL_ROWS(8, 4);
    $("gmgn-wallet-body").innerHTML = SKEL_ROWS(7, 4);
    $("cluster-cards").innerHTML = '<div class="cluster-card"><span class="skel w60"></span><span class="skel w80"></span></div><div class="cluster-card"><span class="skel w40"></span><span class="skel w60"></span></div>';
    $("groups-count").textContent = "";
    await job;
    refreshTokenLibrary(q);
    $("token-stats").classList.remove("is-loading");
    const scan = typeof runtime !== "undefined" ? runtime.scan : null;
    const ok = Boolean(scan && scan.status === "complete" && scan.queriedAt >= started);
    if (!ok) {
      const reason = $("scan-status").textContent || "查找未完成";
      ["early-body", "profit-body", "gmgn-wallet-body"].forEach((id) => { $(id).innerHTML = `<tr><td colspan="9"><div class="table-empty">${esc(reason)}</div></td></tr>`; });
      $("cluster-cards").innerHTML = `<div class="empty-state">${esc(reason)}</div>`;
    }
    return ok;
  }
  async function runWallet(q) {
    $("wallet-view").hidden = false;
    $("scan-status").hidden = true;
    $("trace-status").hidden = false;
    $("trace-wallet").value = q.address;
    setChain(q.chain);
    const started = Date.now();
    await window.runSourceTrace();
    const trace = typeof runtime !== "undefined" ? runtime.trace : null;
    return Boolean(trace && trace.queriedAt >= started && trace.deep);
  }

  window.addEventListener("wallet-analysis", (event) => {
    const { stage, verdict } = event.detail || {};
    const now = performance.now() - t0;
    if (stage === "verdict") { window.__verdict = verdict; renderVerdict(verdict); timing.verdict = now; }
    if (stage === "partial") {
      timing.deepPartial = timing.deepPartial || now;
      $("token-stats").classList.remove("is-loading");
      const groups = document.querySelectorAll("#cluster-cards .cluster-card").length;
      $("groups-count").textContent = groups ? String(groups) : "";
    }
  });

  function resetView() {
    $("result").hidden = true;
    $("token-view").hidden = true;
    $("wallet-view").hidden = true;
    $("verdict-card").hidden = true;
    $("export-report").hidden = true;
    $("trace-export-report").hidden = true;
    $("tab-platform").hidden = true;
    $("quick-links").innerHTML = "";
    $("scan-status").textContent = "";
    $("trace-status").textContent = "";
    window.__verdict = null;
    window.__walletContextChain = "";
    window.Shell?.drawer.close();
  }

  $("analyze-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("analyze-input").value.trim();
    if (!input) return status("请粘贴地址。", "error");
    if (input.includes("...") || input.includes("…")) return status("这是缩写地址，请粘贴完整地址。", "error");
    Object.keys(timing).forEach((k) => delete timing[k]);
    t0 = performance.now();
    resetView();
    setRunning(true);
    $("recent").hidden = true;
    status("正在判断链与地址类型…");
    const params = new URLSearchParams({ q: input });
    if ($("analyze-chain").value) params.set("chain", $("analyze-chain").value);
    history.replaceState(null, "", `?${params}`);
    try {
      const res = await fetch("/api/analyze/quick", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input, chain: $("analyze-chain").value }) });
      const q = await res.json().catch(() => ({}));
      if (!res.ok || !q.ok) throw new Error(q.error || `HTTP ${res.status}`);
      timing.firstResult = performance.now() - t0;
      current = q;
      window.__walletContextChain = q.chain;
      $("result").hidden = false;
      const head = renderQuick(q);
      if (q.library?.missing) refreshWalletLibrary(q);
      status("");
      saveRecent({ q: q.address || input, label: head.title || "", kind: q.kind, chain: q.chain, at: Date.now() });
      let ok = true;
      if (q.kind === "token") {
        loadPlatform(q);
        ok = await runToken(q);
      } else if (["wallet", "eip7702"].includes(q.kind)) {
        ok = await runWallet(q);
      } else {
        $("progress-line").classList.remove("is-running");
        $("scan-status").hidden = false;
        $("scan-status").textContent = `判断为「${KIND[q.kind] || q.kind}」，没有对应的深入分析。`;
      }
      if (current !== q) return;
      timing.complete = performance.now() - t0;
      const note = $("timing-note");
      if (note) note.textContent += ` 全部完成 ${sec(timing.complete)}。`;
      if (!ok && ["token", "wallet", "eip7702"].includes(q.kind)) status("部分数据没有取得，点下方灰色进度列看原因。", "warning");
    } catch (error) {
      status(`分析失败：${error.message}`, "error");
    } finally {
      setRunning(false);
    }
  });

  const initialParams = new URLSearchParams(location.search);
  const initial = initialParams.get("q");
  const initialChain = initialParams.get("chain");
  if (initialChain && [...$("analyze-chain").options].some((o) => o.textContent === initialChain)) $("analyze-chain").value = initialChain;
  const advSummary = document.querySelector(".lookup-adv > summary");
  const advLabel = () => { if (advSummary) advSummary.textContent = $("analyze-chain").value ? `高级（链：${$("analyze-chain").value}）` : "高级"; };
  $("analyze-chain").addEventListener("change", advLabel);
  advLabel();
  if (initial) { $("analyze-input").value = initial; $("analyze-form").requestSubmit(); }
  else { renderRecent(); $("analyze-input").focus(); }
})();
