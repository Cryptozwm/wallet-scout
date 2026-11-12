"use strict";

const pumpCalc = (() => {
  const API = "https://frontend-api-v3.pump.fun";
  const PROFILE = "https://profile-api.pump.fun";
  const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const MAX_PAGES = 30, CHUNK = 100, BAL_PAGES = 5;
  const BAD_LOSS = 1.02, BAD_SLACK = 5;
  const LIMIT = 200, RETRY_MS = [2000, 5000, 12000];
  const cfg = { wait: (ms) => new Promise((res) => setTimeout(res, ms)) };
  const num = (v) => { const x = v == null || v === "" ? NaN : Number(v); return Number.isFinite(x) ? x : null; };
  const secs = (v) => {
    const x = num(v);
    if (x != null) return Math.round(x > 1e12 ? x / 1000 : x);
    const t = Date.parse(v);
    return Number.isFinite(t) ? Math.round(t / 1000) : null;
  };
  const listOf = (x, keys = []) => {
    if (Array.isArray(x)) return x;
    if (!x || typeof x !== "object") return [];
    for (const k of keys) if (Array.isArray(x[k])) return x[k];
    const vals = Object.values(x);
    return vals.length && vals.every((v) => v && typeof v === "object" && !Array.isArray(v)) ? vals : [];
  };
  const mintOf = (p) => (p && (p.coinMint || p.mint || p.token_mint || p.tokenMint || p.tokenAddress || p.address)) || "";
  const key = (m) => (String(m).startsWith("0x") ? String(m).toLowerCase() : String(m));

  async function positions(get, owner, mints) {
    const out = [];
    for (let i = 0; i < mints.length; i += CHUNK) {
      const q = new URLSearchParams({ mints: mints.slice(i, i + CHUNK).join(","), updatesLimit: "0" });
      const r = await get(API + "/user-positions/" + owner + "?" + q);
      out.push(...listOf(r && r.positions, ["items", "data"]));
    }
    if (out.length && !out.some((p) => mintOf(p))) throw new Error("pump.fun 回的持仓数据格式变了（找不到币的地址），这次不存");
    return out;
  }

  async function holdings(get, owner) {
    const out = [];
    for (let page = 1; page <= BAL_PAGES; page += 1) {
      let r;
      try { r = await get(PROFILE + "/balance/tokens/" + owner + "?page=" + page + "&size=200&chain=all"); } catch (err) {
        if (err && err.fatal) throw err;
        break;
      }
      const data = r && r.data;
      for (const t of listOf(data, ["tokens", "items"])) { const m = mintOf(t); if (m) out.push(m); }
      const pages = num(r && r.pagination && r.pagination.totalPages) || 1;
      if (page >= pages) break;
    }
    return out;
  }

  async function one(get, it, report) {
    const cas = Array.isArray(it.cas) ? it.cas.map(String) : [];
    let owner = B58.test(it.address || "") ? it.address : "";
    let libPos = [];
    if (!owner) {
      if (!cas.length) throw new Error("钱包库没有他的币，找不到 pump.fun 帐号");
      libPos = await positions(get, it.address, cas);
      owner = libPos.map((p) => p.walletAddress).find((a) => B58.test(a || "")) || "";
      if (!owner) throw new Error("pump.fun 找不到这个地址的帐号");
    }
    let ov;
    try { ov = await get(API + "/users/" + owner + "/overview"); } catch (e) {
      if (e.status === 400 || e.status === 404) throw new Error("pump.fun 找不到这个地址的帐号");
      throw e;
    }
    const prof = (ov && ov.profile) || {};
    const uid = prof.userId || (ov && ov.userId) || "";
    const name = String(prof.username || prof.userName || "");
    if (!uid) throw new Error("pump.fun 找不到这个地址的帐号");
    const handles = (it.handles || []).map((h) => String(h).toLowerCase());
    const renamed = handles.length && !handles.includes(name.toLowerCase()) ? (it.handles || []).join("／") : "";
    const mints = new Set();
    let cursor = "", pages = 0, trades = 0, oldest = null, partial = false;
    for (;;) {
      const q = new URLSearchParams({ limit: String(LIMIT) });
      if (cursor) q.set("cursor", cursor);
      const expectMore = pages === 0 || !!cursor;
      let r, rows, ok;
      for (let i = 0; ; i += 1) {
        r = await get(API + "/user-trades/" + uid + "?" + q);
        ok = !!(r && r.trades && typeof r.trades === "object");
        rows = ok ? listOf(r.trades, ["items", "data"]) : [];
        const suspicious = !ok || (expectMore && !rows.length) || (rows.length >= LIMIT && !r.nextCursor);
        if (!suspicious || i >= RETRY_MS.length) break;
        report("pump.fun 交易纪录第 " + (pages + 1) + " 页看起来没读完，" + RETRY_MS[i] / 1000 + " 秒后再问");
        await cfg.wait(RETRY_MS[i]);
      }
      if (!ok) throw new Error("pump.fun 回的交易纪录格式不对（没有 trades），这次不存");
      if (expectMore && !rows.length) {
        throw new Error(pages === 0 ? "pump.fun 这次没回他的交易纪录（连问 4 次都是空的），这次不存，下次再算"
          : "pump.fun 交易纪录读到第 " + (pages + 1) + " 页断了（连问 4 次都是空的），这次不存，下次再算");
      }
      pages += 1;
      trades += rows.length;
      let seen = 0;
      for (const t of rows) {
        const m = t && (t.mint || t.coinMint);
        if (m) { mints.add(m); seen += 1; }
        const ts = secs(t && t.timestamp);
        if (ts && (!oldest || ts < oldest)) oldest = ts;
      }
      if (rows.length && !seen) throw new Error("pump.fun 回的交易纪录格式变了（找不到币的地址），这次不存");
      report("读交易纪录第 " + pages + " 页（" + trades + " 笔）");
      cursor = (r && r.nextCursor) || "";
      if (!cursor || !rows.length) break;
      if (pages >= MAX_PAGES) { partial = true; break; }
    }
    report("读目前持仓");
    for (const m of await holdings(get, owner)) mints.add(m);
    cas.forEach((c) => mints.add(c));
    const all = [...mints];
    report("算 " + all.length + " 颗币的盈亏");
    const pos = await positions(get, owner, all);
    if (trades && !pos.length && !libPos.length) throw new Error("pump.fun 没给他交易过的币的盈亏，这次不存");
    const byMint = new Map();
    for (const p of pos.concat(libPos)) { const m = mintOf(p); if (m && !byMint.has(key(m))) byMint.set(key(m), p); }
    let total = 0, realized = 0, cost = 0, coins = 0, wins = 0, untrusted = 0, droppedUsd = 0;
    const bad = new Set();
    for (const [k, p] of byMint) {
      const v = num(p.pnlUsd);
      const c = num(p.amountBoughtUsd) ?? num(p.costBasisUsd) ?? 0;
      if (v == null || (!v && !(c > 0))) continue;
      if (p.hasUntrustedUsdBasis || v < -(Math.max(c, 0) * BAD_LOSS + BAD_SLACK)) {
        bad.add(k);
        untrusted += 1;
        droppedUsd += v;
        continue;
      }
      coins += 1;
      total += v;
      realized += num(p.realizedPnlUsd) || 0;
      cost += c;
      if (v > 0) wins += 1;
    }
    const lib = cas.map((ca) => {
      const p = bad.has(key(ca)) ? null : byMint.get(key(ca));
      return p && num(p.pnlUsd) != null ? { ca, pnl: num(p.pnlUsd), realized: num(p.realizedPnlUsd), cost: num(p.costBasisUsd) } : null;
    }).filter(Boolean);
    return { chain: it.chain, address: it.address, handle: name, wallet: owner, total, realized, cost, coins, wins, untrusted, droppedUsd,
      trades, since: oldest, partial, lib, renamed };
  }

  return { one, listOf, mintOf, cfg };
})();

(function pumpSyncPage() {
  if (typeof document === "undefined" || !document.getElementById("ps-root")) return;
  const $ = (id) => document.getElementById(id);
  const FLUSH_EVERY = 5;
  const localTime = (sec) => (sec ? new Date(sec * 1000).toLocaleString("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "");
  const money = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "--";
    const a = Math.abs(n);
    const body = a >= 999_950 ? `${(a / 1e6).toFixed(2)}M` : a >= 999.5 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(0);
    return `${n < 0 ? "-" : "+"}$${body}`;
  };
  const run = { origin: "", total: 0, done: 0, ok: 0, failed: 0, saved: 0, coins: 0, rejected: 0, renamed: 0, started: 0, active: false, finished: false, stop: false };
  let queue = [];
  let timer = null;

  const setStatus = (text) => { $("ps-status").textContent = text; };

  function render() {
    const pct = run.total ? Math.min(100, Math.round((run.done / run.total) * 100)) : 0;
    $("ps-bar-fill").style.width = `${pct}%`;
    $("ps-bar").setAttribute("aria-valuenow", String(pct));
    if (!run.total) { $("ps-counts").textContent = ""; return; }
    const left = run.total - run.done;
    const per = run.done ? (Date.now() - run.started) / run.done : 0;
    const eta = run.active && left && per ? `，预估还要约 ${Math.max(1, Math.round((per * left) / 60000))} 分钟` : "";
    $("ps-counts").textContent = `已算 ${run.done}／${run.total} 位：成功 ${run.ok}、失败 ${run.failed}${eta}。`
      + `已存回钱包库 ${run.saved} 位，更新库内币的 pump.fun 盈亏 ${run.coins} 笔${run.renamed ? `，更正改过名的 pump.fun 名称 ${run.renamed} 位` : ""}${run.rejected ? `，钱包库不收 ${run.rejected} 笔` : ""}。`;
  }

  function summary(j) {
    $("ps-summary").textContent = `钱包库的 pump.fun 用户 ${j.total} 位：帐号总盈亏已算 ${j.synced} 位${j.oldest ? `（最旧 ${localTime(j.oldest)}）` : ""}`
      + `${j.failed ? `、上次失败 ${j.failed} 位` : ""}。算过 ${j.staleHours} 小时内的不重算。`;
  }

  async function loadList(all) {
    const r = await fetch(`/api/pump/sync-list${all ? "?all=1" : ""}`, { headers: { Accept: "application/json" } });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "读不到名单");
    return j;
  }

  async function flush(keepalive = false) {
    clearTimeout(timer);
    timer = null;
    if (!queue.length) return;
    const batch = queue.splice(0, 50);
    try {
      const r = await fetch("/api/pump/sync-import", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ results: batch }), keepalive });
      if (keepalive) return;
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "存不进去");
      run.saved += j.saved;
      run.coins += j.coins;
      run.rejected += (j.rejected || []).length;
      run.renamed += (j.renamed || []).length;
    } catch (err) {
      if (keepalive) return;
      queue = batch.concat(queue);
      setStatus(`存回钱包库失败：${err.message}。8 秒后再试`);
      timer = setTimeout(flush, 8000);
    }
    render();
    if (queue.length >= FLUSH_EVERY) flush();
  }

  let client = null;
  const get = (url) => client.get(url, { stopped: () => run.stop, wait: setStatus });

  function logResult(res) {
    const li = document.createElement("li");
    const who = document.createElement("div");
    who.className = "ps-who";
    const name = document.createElement("strong");
    name.textContent = res.handle || "（没有名称）";
    const value = document.createElement("span");
    if (res.error) {
      value.className = "ps-err";
      value.textContent = "失败";
    } else {
      value.className = res.total >= 0 ? "ps-up" : "ps-down";
      value.textContent = money(res.total);
    }
    who.append(name, value);
    const detail = document.createElement("small");
    detail.className = "ps-detail";
    detail.textContent = res.error ? res.error
      : `${res.coins} 颗币、赚钱 ${res.wins} 颗，已实现 ${money(res.realized)}${res.partial ? `，交易太多只算最近 ${res.trades} 笔` : ""}`
        + (res.untrusted ? `。${res.untrusted} 颗 pump.fun 数字不合理没算进去（亏损比买入还多或标成本不可信，加起来 ${money(res.droppedUsd)}）` : "")
        + (res.renamed ? `。改过名：钱包库原本记 ${res.renamed}，存回时更正成 ${res.handle || "（没有名称）"}` : "");
    const addr = document.createElement("span");
    addr.className = "ps-addr";
    addr.textContent = `${res.chain} ${res.address}`;
    li.append(who, detail, addr);
    const log = $("ps-log");
    log.prepend(li);
    while (log.children.length > 30) log.lastChild.remove();
  }

  function showSetup(reason) {
    $("ps-run").hidden = true;
    $("ps-setup").hidden = false;
    $("ps-reason").textContent = reason || "";
    $("ps-reason").hidden = !reason;
  }

  function finish(text) {
    run.active = false;
    run.finished = true;
    flush();
    setStatus(text);
    $("ps-stop").hidden = true;
    $("ps-all").hidden = false;
    render();
    loadList(false).then(summary).catch(() => {});
  }

  function record(res) {
    run.done += 1;
    if (res.error) run.failed += 1; else run.ok += 1;
    logResult(res);
    queue.push(res);
    if (queue.length >= FLUSH_EVERY) flush();
    else if (!timer) timer = setTimeout(flush, 8000);
    render();
  }

  async function work(items) {
    for (let i = 0; i < items.length; i += 1) {
      if (run.stop) { finish("已停止。已算好的都存了，下次按书签会从没算的接着算。"); return; }
      const it = items[i] || {};
      const who = (it.handles || [])[0] || "";
      const report = (text) => setStatus(`第 ${i + 1}／${items.length} 位 ${who}：${text}`);
      report("找 pump.fun 帐号");
      let res;
      try { res = await pumpCalc.one(get, it, report); } catch (err) {
        if (run.stop) { finish("已停止。已算好的都存了，下次按书签会从没算的接着算。"); return; }
        if (err && err.gone) { finish("pump.fun 页关掉了。已算好的都存了，到任何 pump.fun 页再按一次书签，会从没算的接着算。"); return; }
        if (err && err.fatal) { finish(`停下来了：${err.message}。已算好的都存了，下次会从没算的接着算。`); return; }
        res = { chain: it.chain, address: it.address, handle: who, error: String((err && err.message) || err).slice(0, 200) };
      }
      record(res);
    }
    finish(`算完了：成功 ${run.ok} 位、失败 ${run.failed} 位。可以关掉这个窗口了。`);
  }

  async function begin(all) {
    let j;
    try { j = await loadList(all); } catch (err) { setStatus(`读不到钱包库名单：${err.message}`); return; }
    summary(j);
    Object.assign(run, { total: j.items.length, done: 0, ok: 0, failed: 0, saved: 0, coins: 0, rejected: 0, started: Date.now(), finished: false, stop: false });
    $("ps-log").replaceChildren();
    if (!run.total) {
      run.active = false;
      setStatus(`全部都在 ${j.staleHours} 小时内算过了，要重算按「全部重算」。`);
      $("ps-stop").hidden = true;
      $("ps-all").hidden = false;
      render();
      return;
    }
    run.active = true;
    $("ps-stop").hidden = false;
    $("ps-stop").disabled = false;
    $("ps-all").hidden = true;
    setStatus(`开始算 ${run.total} 位，这个窗口开着就好（关掉就停，下次会从没算的接着算）。`);
    render();
    work(j.items);
  }

  function boardLine(text, cls = "") {
    $("ps-board").hidden = false;
    $("ps-board-sum").textContent = text;
    $("ps-board-sum").className = `ps-board-sum ${cls}`.trim();
  }

  async function importBoard(board) {
    const lists = (board && Array.isArray(board.lists)) ? board.lists.filter((l) => l && Array.isArray(l.rows) && l.rows.length) : [];
    if (!lists.length) { boardLine("这页没开 Leaderboard，排行榜没绑。要绑的话在 pump.fun 打开 Leaderboard 再按一次「盈利」。", "muted"); return; }
    const what = lists.map((l) => `${l.kind} ${l.rows.length}`).join("、");
    boardLine(`排行榜（${what}）绑名字中…`);
    let j;
    try {
      const r = await fetch("/api/pump/board-import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ board: { at: board.at, lists } }) });
      j = await r.json();
      if (!j.ok) throw new Error(j.error || "存不进去");
    } catch (err) {
      boardLine(/找不到此 API/.test(String(err.message)) ? "排行榜绑定要等本机服务重启成新版才能用。" : `排行榜绑定失败：${err.message}`, "ps-err");
      return;
    }
    const skip = Object.entries(j.skipped || {}).map(([k, v]) => `${k} ${v}`).join("、");
    boardLine(`排行榜（${what}）绑好 ${j.bound} 位：新绑 ${j.added}、改名 ${j.renamed.length}、本来就有 ${j.same}；${j.libAdded != null ? `新加进钱包库 ${j.libAdded} 位、本来就在库里 ${j.inLibrary} 位` : `其中 ${j.inLibrary} 位在钱包库`}${skip ? `。没绑：${skip}` : ""}。`);
    const box = $("ps-board-list");
    box.replaceChildren();
    for (const row of j.rows || []) {
      const li = document.createElement("li");
      const who = document.createElement("div");
      who.className = "ps-who";
      const name = document.createElement("strong");
      name.textContent = `${row.kind} #${row.rank} ${row.handle}`;
      const tag = document.createElement("span");
      tag.className = row.status === "new" ? "ps-up" : "";
      tag.textContent = { new: "新绑", renamed: "改名", same: "本来就有" }[row.status] || row.status;
      who.append(name, tag);
      const detail = document.createElement("small");
      detail.className = "ps-detail";
      detail.textContent = [row.value, row.x ? `X @${row.x}` : "", row.old ? `原本记 ${row.old}` : "", row.libNew ? "新加进钱包库" : row.inLibrary ? "在钱包库" : ""].filter(Boolean).join("　");
      const addr = document.createElement("span");
      addr.className = "ps-addr";
      addr.textContent = `${row.chain} ${row.address}`;
      li.append(who, detail, addr);
      box.append(li);
    }
    $("ps-board-more").hidden = !box.childElementCount;
  }

  function connect() {
    $("ps-run").hidden = false;
    setStatus("连接 pump.fun 页…");
    client = wiRelayClient();
    client.onBoard(importBoard);
    client.ready.then((r) => {
      if (r.ok && r.v >= 3 && r.board) importBoard(r.board);
      else if (r.ok && !(r.v >= 3)) boardLine("你按的「盈利」是旧版，不会顺便绑排行榜：要绑的话把这页最下面的「盈利」重新拖到书签列（旧的删掉），在开着 Leaderboard 的 pump.fun 页按。", "muted");
      if (r.ok) { run.origin = "relay"; begin(new URLSearchParams(location.search).get("all") === "1"); return; }
      showSetup(r.old ? "你按的是旧版「钱包侦查」书签：请把下面「盈利」这颗拖到书签列，再到 pump.fun 页刷新、按一次新的（旧的可以删掉）。"
        : "这个窗口不是从 pump.fun 页的书签打开的，或 pump.fun 页已经关掉、换页了。");
    });
  }

  const link = $("ps-bookmarklet");
  link.href = wiBookmarklet(location.origin, "pnl");
  link.addEventListener("click", (event) => {
    event.preventDefault();
    $("ps-reason").hidden = false;
    $("ps-reason").textContent = "这颗要用拖的：按住拖到浏览器的书签列，之后到 pump.fun 页再按。";
  });
  $("ps-stop").addEventListener("click", () => {
    $("ps-stop").disabled = true;
    run.stop = true;
    setStatus("停止中（这一位查完就停）…");
  });
  $("ps-all").addEventListener("click", () => {
    if (!client || client.gone() || !run.origin) { showSetup("要从 pump.fun 页按「盈利」书签才能算。"); return; }
    begin(true);
  });
  window.addEventListener("pagehide", () => flush(true));

  loadList(false).then(summary).catch((err) => { $("ps-summary").textContent = `读不到钱包库名单：${err.message}`; });
  if (window.opener) connect(); else showSetup("");
})();

if (typeof module === "object" && module.exports) module.exports = { pumpCalc };
