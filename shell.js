(() => {
  "use strict";
  const THEME_KEY = "wallet-investigator-theme";
  const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch {  } };
  const byId = (id) => document.getElementById(id);
  const ICON_CLOSE = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function applyTheme(theme) {
    const value = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = value;
    document.body.dataset.theme = value;
    write(THEME_KEY, value);
    document.querySelectorAll("[data-theme-set]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.themeSet === value)));
  }
  window.addEventListener("storage", (event) => { if (event.key === THEME_KEY && event.newValue) applyTheme(event.newValue); });

  document.body.insertAdjacentHTML("beforeend", `
    <dialog class="sheet" id="api-settings-dialog" aria-labelledby="settings-title">
      <div class="sheet-head"><h2 id="settings-title">设置</h2><button type="button" class="btn btn-ghost btn-icon" id="api-settings-close" aria-label="关闭">${ICON_CLOSE}</button></div>
      <div class="sheet-body">
        <div class="sheet-group">
          <h3>外观</h3>
          <div class="seg" role="group" aria-label="深浅色"><button type="button" data-theme-set="dark">深色</button><button type="button" data-theme-set="light">浅色</button></div>
        </div>
        <div class="sheet-group">
          <h3>数据源密钥</h3>
          <div class="key-row"><div><strong>GMGN API Key</strong><small id="gmgn-key-status">读取中</small></div><input id="gmgn-api-key" type="password" autocomplete="off" spellcheck="false" placeholder="粘贴新的唯读 Key"></div>
          <div class="key-row"><div><strong>Etherscan V2 Key</strong><small id="explorer-key-status">读取中</small></div><input id="explorer-api-key" type="password" autocomplete="off" spellcheck="false" placeholder="粘贴新的 Key"></div>
          <div class="key-row"><div><strong>NodeReal API Key</strong><small id="nodereal-key-status">读取中</small></div><input id="nodereal-api-key" type="password" autocomplete="off" spellcheck="false" placeholder="粘贴新的 Key"></div>
          <div class="sheet-actions">
            <button type="button" class="btn btn-primary" id="save-api-credentials">保存</button>
            <button type="button" class="btn btn-text btn-danger" id="clear-gmgn-key">清除 GMGN Key</button>
            <button type="button" class="btn btn-text btn-danger" id="clear-explorer-key">清除 Etherscan Key</button>
            <button type="button" class="btn btn-text btn-danger" id="clear-nodereal-key">清除 NodeReal Key</button>
          </div>
          <p class="api-settings-status" id="api-settings-status" role="status"></p>
          <p class="sheet-note">Key 只存在这台电脑的 data/private 文件夹（Windows 上会用你的帐户加密），不会写进网页、GitHub 或云端。哪个 Key 去哪里申请，请看使用说明。</p>
        </div>
      </div>
    </dialog>
    <div class="scrim" id="scrim" hidden></div>
    <aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" hidden>
      <div class="drawer-head"><h2 id="drawer-title"></h2><button type="button" class="btn btn-ghost btn-icon" id="drawer-close" aria-label="关闭">${ICON_CLOSE}</button></div>
      <div class="drawer-body" id="drawer-body"></div>
    </aside>
    <div class="app-toast" role="status" aria-live="polite"></div>`);

  const dialog = byId("api-settings-dialog");
  document.addEventListener("click", (event) => {
    if (event.target.closest("#app-settings")) { if (!dialog.open) dialog.showModal(); ownCredentials?.refresh(); }
    if (event.target.closest("#api-settings-close")) dialog.close();
    const themeButton = event.target.closest("[data-theme-set]");
    if (themeButton) applyTheme(themeButton.dataset.themeSet);
  });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });

  let ownCredentials = null;
  function setupOwnCredentials() {
    const status = (text, tone = "") => { const el = byId("api-settings-status"); el.textContent = text; el.dataset.tone = tone; };
    const post = async (body) => {
      const response = await fetch("/api/credentials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
    };
    const refresh = async () => {
      try {
        const response = await fetch("/api/credentials/status", { cache: "no-store" });
        const data = await response.json();
        byId("gmgn-key-status").textContent = data.gmgnConfigured ? (data.gmgnSource === "local-cli" ? "已使用这台电脑的 GMGN CLI 设置" : "已加密保存在这台电脑") : "尚未设置；请使用自己的唯读 Key";
        byId("explorer-key-status").textContent = data.explorerConfigured ? "已加密保存在这台电脑" : "尚未设置";
        byId("nodereal-key-status").textContent = data.noderealConfigured ? "已加密保存在这台电脑" : "尚未设置";
      } catch (error) { status(`本机设置服务无法连接：${error.message}`, "error"); }
    };
    byId("save-api-credentials").addEventListener("click", async () => {
      const gmgnApiKey = byId("gmgn-api-key").value.trim();
      const explorerApiKey = byId("explorer-api-key").value.trim();
      const noderealApiKey = byId("nodereal-api-key").value.trim();
      if (!gmgnApiKey && !explorerApiKey && !noderealApiKey) return status("请至少输入一个要保存的 Key。", "error");
      try {
        status("正在加密保存…");
        await post({ ...(gmgnApiKey ? { gmgnApiKey } : {}), ...(explorerApiKey ? { explorerApiKey } : {}), ...(noderealApiKey ? { noderealApiKey } : {}) });
        byId("gmgn-api-key").value = ""; byId("explorer-api-key").value = ""; byId("nodereal-api-key").value = "";
        await refresh();
        status("已加密保存在这台电脑。", "success");
      } catch (error) { status(`保存失败：${error.message}`, "error"); }
    });
    byId("clear-gmgn-key").addEventListener("click", async () => {
      try { await post({ clearGmgnApiKey: true }); await refresh(); status("已清除 GMGN Key。", "success"); } catch (error) { status(`清除失败：${error.message}`, "error"); }
    });
    byId("clear-explorer-key").addEventListener("click", async () => {
      try { await post({ clearExplorerApiKey: true }); await refresh(); status("已清除 Etherscan Key。", "success"); } catch (error) { status(`清除失败：${error.message}`, "error"); }
    });
    byId("clear-nodereal-key").addEventListener("click", async () => {
      try { await post({ clearNoderealApiKey: true }); await refresh(); status("已清除 NodeReal Key。", "success"); } catch (error) { status(`清除失败：${error.message}`, "error"); }
    });
    return { refresh };
  }

  const toastEl = document.querySelector(".app-toast");
  let toastTimer = 0;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("visible"), 2200);
  }

  const drawerEl = byId("drawer");
  const scrimEl = byId("scrim");
  const drawerBody = byId("drawer-body");
  let lastFocus = null;
  let closeTimer = 0;
  const drawer = {
    onClose: null,
    get isOpen() { return !drawerEl.hidden && drawerEl.classList.contains("is-open"); },
    open(title) {
      clearTimeout(closeTimer);
      byId("drawer-title").textContent = title || "明细";
      if (drawerEl.hidden) {
        lastFocus = document.activeElement;
        drawerEl.hidden = false;
        scrimEl.hidden = false;
        void drawerEl.offsetWidth;
        drawerEl.classList.add("is-open");
        scrimEl.classList.add("is-open");
        document.documentElement.style.overflow = "hidden";
        byId("drawer-close").focus({ preventScroll: true });
      }
      drawerBody.scrollTop = 0;
      return drawerBody;
    },
    close() {
      if (drawerEl.hidden) return;
      drawerEl.classList.remove("is-open");
      scrimEl.classList.remove("is-open");
      document.documentElement.style.overflow = "";
      closeTimer = setTimeout(() => { drawerEl.hidden = true; scrimEl.hidden = true; drawerBody.innerHTML = ""; }, 240);
      if (lastFocus?.focus) lastFocus.focus({ preventScroll: true });
      const handler = drawer.onClose;
      if (typeof handler === "function") handler();
    },
    body: drawerBody,
  };
  byId("drawer-close").addEventListener("click", () => drawer.close());
  scrimEl.addEventListener("click", () => drawer.close());
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (closePopovers()) return;
    if (!drawerEl.hidden && !dialog.open) drawer.close();
  });

  async function copyText(value) {
    try { await navigator.clipboard.writeText(value); return true; } catch {
      const area = document.createElement("textarea");
      area.value = value;
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    }
  }
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;
    const value = button.dataset.copy || "";
    const ok = await copyText(value);
    toast(ok ? (value.length > 60 ? "已拷贝完整交易哈希" : "已拷贝完整地址") : "浏览器拒绝拷贝，请手动选取");
  });

  function selectPane(button) {
    const bar = button.closest(".tabbar");
    if (!bar) return;
    bar.querySelectorAll("[data-pane]").forEach((tab) => {
      const active = tab === button;
      tab.setAttribute("aria-selected", String(active));
      const pane = byId(tab.dataset.pane);
      if (pane) pane.hidden = !active;
    });
    bar.dispatchEvent(new CustomEvent("pane-change", { bubbles: true, detail: { pane: button.dataset.pane } }));
  }
  document.addEventListener("click", (event) => {
    const tab = event.target.closest(".tabbar [data-pane]");
    if (tab) selectPane(tab);
  });

  function closePopovers(except) {
    let closed = false;
    document.querySelectorAll("[data-popover]").forEach((trigger) => {
      const pop = byId(trigger.dataset.popover);
      if (!pop || pop === except || pop.hidden) return;
      pop.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      closed = true;
    });
    return closed;
  }
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-popover]");
    if (trigger) {
      const pop = byId(trigger.dataset.popover);
      if (!pop) return;
      const willOpen = pop.hidden;
      closePopovers(pop);
      pop.hidden = !willOpen;
      trigger.setAttribute("aria-expanded", String(willOpen));
      return;
    }
    if (!event.target.closest(".popover")) closePopovers();
  });

  const COLUMN_RULES = [
    { has: ["顺位", "首买时间"], show: ["顺位", "钱包", "首买时间", "累计买入", "估算总 PnL", "标签"] },
    { has: ["已实现 PnL", "数据状态"], show: ["钱包", "已实现 PnL", "未实现 PnL", "ROI", "仍持仓"] },
    { has: ["公开身份 / 标签"], show: ["钱包", "公开身份 / 标签", "持仓比例", "总盈利"] },
    { has: ["首买", "已卖", "估算 PnL"], show: ["钱包", "首买", "累计买入", "持仓", "估算 PnL"] },
    { has: ["完整地址", "平台帐号"], show: ["#", "完整地址", "持有%", "USD", "平台", "平台帐号"] },
    { has: ["方向 / 路径", "跨链对手"], show: ["时间", "方向 / 路径", "跨链对手", "输出"] },
    { has: ["资金关系", "公开名称"], show: ["地址", "资金关系", "公开名称", "GMGN／公开标签"] },
    { has: ["买入成本", "卖出收入"], show: ["代币", "现值", "总盈利", "ROI"] },
    { has: ["类型", "交易哈希"], show: ["类型", "资产", "金额", "时间"] },
    { has: ["持仓现值", "24h"], show: ["资产", "持有数量", "持仓现值", "24h"] },
    { has: ["查找地址", "对手地址"], show: ["层级", "方向", "对手地址", "资产", "数量", "时间"] },
    { has: ["相对开盘进场", "未实现"], show: ["代币", "相对开盘进场", "持有", "总盈利"] },
    { has: ["层", "钱包库", "证据"], show: ["层", "方向", "地址", "数量", "时间", "钱包库"] },
    { has: ["约值", "判定"], show: ["时间", "方向", "代币", "约值", "判定"] },
    { has: ["这颗币已实现", "这颗币帐面"], show: ["钱包", "标签", "实力", "这颗币已实现", "这颗币帐面", "累计盈利"] },
    { has: ["出现 CA 数", "备注"], show: ["链", "钱包", "标签", "实力", "出现 CA 数", "累计盈利", ""] },
    { has: ["库内标签", "过往纪录"], show: ["钱包", "库内标签", "过往纪录"] },
    { has: ["本次地址", "库内地址"], show: ["本次地址", "关联类型", "库内地址"] },
  ];
  const headText = (cell) => (cell.textContent || "").replace(/\s+/g, " ").trim();
  function tableRule(headers) {
    return COLUMN_RULES.find((rule) => rule.has.every((name) => headers.includes(name))) || null;
  }
  function enhanceTable(table) {
    if (table.closest(".drawer")) return;
    const headCells = [...table.querySelectorAll(":scope > thead > tr > th")];
    if (!headCells.length) return;
    const headers = headCells.map(headText);
    const rule = tableRule(headers);
    const hidden = rule ? headers.map((name) => !rule.show.includes(name)) : headers.map(() => false);
    const tbody = table.tBodies[0];
    const merge = tbody?.dataset.mergeFrom;
    const clickable = hidden.some(Boolean) || Boolean(merge);
    if (table.dataset.enhanced !== "1") {
      headCells.forEach((cell, index) => cell.classList.toggle("col-more", hidden[index]));
      table.dataset.enhanced = "1";
    }
    if (!tbody) return;
    [...tbody.rows].forEach((row) => {
      if (row.dataset.enh === "1") return;
      row.dataset.enh = "1";
      const cells = [...row.cells];
      if (cells.length < 2) return;
      cells.forEach((cell, index) => {
        if (headers[index]) cell.dataset.label = headers[index];
        cell.classList.toggle("col-more", Boolean(hidden[index]));
      });
      if (clickable && !tbody.hasAttribute("data-own-click")) {
        row.classList.add("is-clickable");
        row.tabIndex = 0;
      }
    });
  }
  function updateCounts() {
    document.querySelectorAll(".count[data-count]").forEach((badge) => {
      const body = byId(badge.dataset.count);
      if (!body) return;
      const rows = [...body.rows].filter((row) => row.cells.length > 1).length;
      badge.textContent = rows ? String(rows) : "";
    });
  }
  let enhancePending = false;
  function scheduleEnhance() {
    if (enhancePending) return;
    enhancePending = true;
    requestAnimationFrame(() => {
      enhancePending = false;
      document.querySelectorAll("table").forEach(enhanceTable);
      updateCounts();
    });
  }
  new MutationObserver(scheduleEnhance).observe(document.body, { childList: true, subtree: true });
  scheduleEnhance();

  function rowPairs(row) {
    const table = row.closest("table");
    const headers = [...table.querySelectorAll(":scope > thead > tr > th")].map(headText);
    const pairs = [...row.cells].map((cell, index) => [headers[index] || "", cell]);
    const mergeId = row.parentElement?.dataset.mergeFrom;
    const mergeCols = (row.parentElement?.dataset.mergeCols || "").split(",").filter(Boolean);
    const other = mergeId ? byId(mergeId)?.rows[row.sectionRowIndex] : null;
    if (other) {
      const otherHeaders = [...other.closest("table").querySelectorAll(":scope > thead > tr > th")].map(headText);
      const seen = new Set(headers);
      [...other.cells].forEach((cell, index) => {
        const name = otherHeaders[index];
        if (name && !seen.has(name) && (!mergeCols.length || mergeCols.includes(name))) pairs.push([name, cell]);
      });
    }
    return pairs.filter(([name, cell]) => name && headText(cell) !== "");
  }
  function openRow(row) {
    const pairs = rowPairs(row);
    if (!pairs.length) return;
    const body = drawer.open(row.closest("[data-drawer-title]")?.dataset.drawerTitle || "明细");
    const list = document.createElement("dl");
    list.className = "kv";
    pairs.forEach(([name, cell]) => {
      const dt = document.createElement("dt");
      dt.textContent = name;
      const dd = document.createElement("dd");
      dd.innerHTML = cell.innerHTML;
      list.append(dt, dd);
    });
    body.replaceChildren(list);
  }
  document.addEventListener("click", (event) => {
    const row = event.target.closest("tr.is-clickable");
    if (!row || event.target.closest("a, button, input, select, textarea, summary, label, [data-copy], [data-wallet-edit]")) return;
    if (window.getSelection && String(window.getSelection()).length > 0) return;
    openRow(row);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const row = event.target.closest?.("tr.is-clickable");
    if (row && event.target === row) openRow(row);
  });

  window.Shell = { drawer, toast, applyTheme, selectPane, copyText };
  applyTheme(read(THEME_KEY) || "dark");
  document.addEventListener("DOMContentLoaded", () => {
    if (typeof window.wireExplorerKeyStorage !== "function") {
      ownCredentials = setupOwnCredentials();
      ownCredentials.refresh();
    }
    applyTheme(read(THEME_KEY) || "dark");
  });
})();
