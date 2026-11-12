(() => {
  "use strict";
  if (!document.dispatchEvent(new CustomEvent("wl-float-ping", { cancelable: true }))) return;
  for (const el of document.querySelectorAll("#wl-float-host")) el.remove();
  document.addEventListener("wl-float-ping", (e) => { let ok = false; try { ok = !!chrome.runtime.id; } catch (_) {  } if (ok) e.preventDefault(); });
  window.__wlFloat = true;

  const DEFAULT = { w: 384, h: 620 };
  const MIN = { w: 300, h: 380 };
  const EDGE = 16;
  let myTabId = null;
  let host = null, shadow = null, panelEl = null, iframeEl = null, bubbleEl = null, dotEl = null;
  let st = { open: false, x: null, y: null, w: DEFAULT.w, h: DEFAULT.h };
  let lastCount = 0;

  const lsGet = (keys) => new Promise((r) => { try { chrome.storage.local.get(keys, (v) => { void chrome.runtime.lastError; r(v || {}); }); } catch (_) { r({}); } });
  const lsSet = (obj) => { try { chrome.storage.local.set(obj, () => void chrome.runtime.lastError); } catch (_) {  } };
  const extOrigin = () => { try { return chrome.runtime.getURL("").replace(/\/$/, ""); } catch (_) { return ""; } };

  async function whoami() {
    if (myTabId != null) return myTabId;
    const r = await new Promise((res) => { try { chrome.runtime.sendMessage({ type: "wl-whoami" }, (x) => { void chrome.runtime.lastError; res(x); }); } catch (_) { res(null); } });
    myTabId = r && r.tabId != null ? r.tabId : null;
    return myTabId;
  }

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .bubble {
    position: fixed; right: ${EDGE}px; bottom: ${EDGE}px; width: 52px; height: 52px; border-radius: 50%;
    background: #12161c; border: 1px solid #2a3340; color: #e8edf3; cursor: pointer; z-index: 2147483000;
    display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 20px rgba(0,0,0,.45);
    transition: transform .12s ease, box-shadow .12s ease; -webkit-user-select: none; user-select: none;
  }
  .bubble:hover { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(0,0,0,.55); }
  .bubble img { width: 30px; height: 30px; border-radius: 7px; pointer-events: none; display: block; }
  .dot {
    position: absolute; top: -5px; right: -5px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px;
    background: #f0b90b; color: #1a1300; font: 700 12px/20px -apple-system,"Microsoft JhengHei",sans-serif;
    text-align: center; border: 2px solid #12161c; box-shadow: 0 1px 4px rgba(0,0,0,.4);
  }
  .panel {
    position: fixed; z-index: 2147483001; width: ${DEFAULT.w}px; height: ${DEFAULT.h}px;
    background: #0e1217; border: 1px solid #2a3340; border-radius: 12px; overflow: hidden;
    box-shadow: 0 16px 48px rgba(0,0,0,.6); display: flex; flex-direction: column;
  }
  .bar {
    height: 34px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 6px 0 11px;
    background: #12161c; border-bottom: 1px solid #222b36; cursor: move; -webkit-user-select: none; user-select: none;
  }
  .bar img { width: 16px; height: 16px; border-radius: 4px; }
  .bar b { font: 700 13px/1 -apple-system,"Microsoft JhengHei",sans-serif; color: #e8edf3; }
  .bar .sp { flex: 1; }
  .bar button {
    width: 26px; height: 24px; border: none; background: transparent; color: #9aa7b4; cursor: pointer;
    border-radius: 6px; font-size: 15px; line-height: 1; display: flex; align-items: center; justify-content: center;
  }
  .bar button:hover { background: #222b36; color: #e8edf3; }
  iframe { flex: 1; width: 100%; border: 0; background: #0e1217; }
  .grip {
    position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize; z-index: 2;
  }
  .grip::after { content: ""; position: absolute; right: 3px; bottom: 3px; width: 7px; height: 7px;
    border-right: 2px solid #4a5765; border-bottom: 2px solid #4a5765; }
  [hidden] { display: none !important; }
  `;

  function clampPos() {
    if (st.x == null) return;
    st.w = Math.max(MIN.w, Math.min(st.w, innerWidth - 2 * 8));
    st.h = Math.max(MIN.h, Math.min(st.h, innerHeight - 2 * 8));
    st.x = Math.max(8, Math.min(st.x, innerWidth - st.w - 8));
    st.y = Math.max(8, Math.min(st.y, innerHeight - st.h - 8));
  }
  function applyPanel() {
    if (!panelEl) return;
    clampPos();
    panelEl.style.width = st.w + "px";
    panelEl.style.height = st.h + "px";
    if (st.x == null) {
      panelEl.style.left = Math.max(8, innerWidth - st.w - EDGE) + "px";
      panelEl.style.top = Math.max(8, innerHeight - st.h - EDGE - 8) + "px";
    } else {
      panelEl.style.left = st.x + "px";
      panelEl.style.top = st.y + "px";
    }
  }
  function render() {
    if (!host) return;
    bubbleEl.hidden = st.open;
    panelEl.hidden = !st.open;
    if (st.open) applyPanel();
    dotEl.hidden = !(lastCount > 0);
    dotEl.textContent = lastCount > 99 ? "99+" : String(lastCount);
  }
  function persist() { lsSet({ floatOpen: st.open, floatX: st.x, floatY: st.y, floatW: st.w, floatH: st.h }); }

  function setOpen(open) {
    st.open = open;
    if (open && iframeEl && !iframeEl.src) iframeEl.src = iframeSrc();
    render();
    persist();
  }
  function iframeSrc() { return chrome.runtime.getURL(`sidepanel.html?embed=1&tab=${myTabId != null ? myTabId : ""}`); }

  function dragBar(e) {
    if (e.button !== 0) return;
    const r = panelEl.getBoundingClientRect();
    st.x = r.left; st.y = r.top;
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const move = (ev) => { st.x = ev.clientX - ox; st.y = ev.clientY - oy; applyPanel(); };
    const up = () => { window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); persist(); };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    e.preventDefault();
  }
  function dragGrip(e) {
    if (e.button !== 0) return;
    const r = panelEl.getBoundingClientRect();
    st.x = r.left; st.y = r.top;
    const sx = e.clientX, sy = e.clientY, sw = r.width, sh = r.height;
    const move = (ev) => { st.w = sw + (ev.clientX - sx); st.h = sh + (ev.clientY - sy); applyPanel(); };
    const up = () => { window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); persist(); };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    e.preventDefault(); e.stopPropagation();
  }

  function build() {
    host = document.createElement("div");
    host.id = "wl-float-host";
    host.style.cssText = "all:initial;position:fixed;z-index:2147483000;";
    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style"); style.textContent = CSS; shadow.appendChild(style);

    let icon = ""; try { icon = chrome.runtime.getURL("icons/icon48.png"); } catch (_) {  }

    bubbleEl = document.createElement("div");
    bubbleEl.className = "bubble"; bubbleEl.title = "钱包库扫链助手（点开）";
    bubbleEl.innerHTML = `<img src="${icon}" alt=""><span class="dot" hidden>0</span>`;
    dotEl = bubbleEl.querySelector(".dot");
    bubbleEl.addEventListener("click", () => setOpen(true));

    panelEl = document.createElement("div");
    panelEl.className = "panel"; panelEl.hidden = true;
    panelEl.innerHTML = `
      <div class="bar"><img src="${icon}" alt=""><b>钱包库</b><span class="sp"></span>
        <button data-act="min" title="收合到右下角">－</button></div>
      <iframe title="钱包库" allow="clipboard-read; clipboard-write"></iframe>
      <div class="grip" title="拉这里调整大小"></div>`;
    iframeEl = panelEl.querySelector("iframe");
    panelEl.querySelector('[data-act="min"]').addEventListener("click", () => setOpen(false));
    panelEl.querySelector(".bar").addEventListener("pointerdown", dragBar);
    panelEl.querySelector(".grip").addEventListener("pointerdown", dragGrip);

    shadow.appendChild(bubbleEl);
    shadow.appendChild(panelEl);
    (document.documentElement || document.body).appendChild(host);
  }

  async function mount() {
    if (host) return;
    await whoami();
    await restoreState();
    build();
    if (iframeEl && !iframeEl.src) iframeEl.src = iframeSrc();
    render();
    window.addEventListener("resize", onResize, true);
  }
  function unmount() {
    if (!host) return;
    window.removeEventListener("resize", onResize, true);
    host.remove(); host = shadow = panelEl = iframeEl = bubbleEl = dotEl = null;
  }
  let rzT = 0;
  function onResize() { clearTimeout(rzT); rzT = setTimeout(() => { if (st.open) applyPanel(); }, 120); }

  async function restoreState() {
    const v = await lsGet({ floatOpen: false, floatX: null, floatY: null, floatW: DEFAULT.w, floatH: DEFAULT.h });
    st.open = !!v.floatOpen;
    st.x = v.floatX == null ? null : Number(v.floatX);
    st.y = v.floatY == null ? null : Number(v.floatY);
    st.w = Number(v.floatW) || DEFAULT.w;
    st.h = Number(v.floatH) || DEFAULT.h;
  }

  function setCount(n) { lastCount = Math.max(0, Number(n) || 0); if (dotEl) { dotEl.hidden = !(lastCount > 0); dotEl.textContent = lastCount > 99 ? "99+" : String(lastCount); } }

  window.addEventListener("message", (e) => {
    if (!e || !e.data || e.data.type !== "wl-count") return;
    if (extOrigin() && e.origin !== extOrigin()) return;
    setCount(e.data.n);
  });
  window.addEventListener("wl-badge-count", (e) => { if (!lastCount && e && e.detail) setCount(e.detail); });

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg) return false;
      if (msg.type === "wl-float-toggle") { if (host) setOpen(!st.open); return false; }
      if (msg.type === "wl-float-mode") { applyMode(msg.mode); return false; }
      return false;
    });
  } catch (_) {  }

  function applyMode(mode) { if (mode === "float") mount(); else unmount(); }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.panelMode) return;
      applyMode(changes.panelMode.newValue);
    });
  } catch (_) {  }

  (async () => {
    const v = await lsGet({ panelMode: "side" });
    if (v.panelMode === "float") mount();
  })();
})();
