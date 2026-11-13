(() => {
  "use strict";
  document.dispatchEvent(new CustomEvent("wl-bridge-takeover"));
  const life = new AbortController();
  document.addEventListener("wl-bridge-takeover", () => life.abort(), { once: true, signal: life.signal });
  const VER = chrome.runtime.getManifest().version;
  const FEATURES = ["pump-grab"];
  let mine = null;
  const ask = (msg) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (reply) => { void chrome.runtime.lastError; resolve(reply || { ok: false, error: "插件背景没回应" }); });
    } catch (_) {
      resolve({ ok: false, error: "插件刚更新、这页还连着旧的：刷新这页再按一次" });
    }
  });
  async function isServer() {
    if (mine === null) {
      const s = await ask({ type: "wl-settings" });
      try { mine = Boolean(s && s.ok && s.server) && new URL(s.server).origin === location.origin; } catch (_) { mine = false; }
    }
    return mine;
  }
  const say = (m) => window.postMessage({ ...m, from: "wl-ext" }, location.origin);
  window.addEventListener("message", async (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const m = e.data;
    if (!m || typeof m !== "object" || m.from === "wl-ext") return;
    if (m.type === "wi-ext-hello") {
      if (await isServer()) say({ type: "wi-ext-ready", version: VER, features: FEATURES });
      return;
    }
    if (m.type !== "wi-ext-pump-grab" || !(await isServer())) return;
    const r = await ask({ type: "wl-pump-grab", ca: String(m.ca || "").slice(0, 64), cutoff: Number(m.cutoff) || 0 });
    say({ ...r, type: "wi-ext-pump-result", id: String(m.id || "") });
  }, { signal: life.signal });
  isServer().then((ok) => { if (ok && !life.signal.aborted) say({ type: "wi-ext-ready", version: VER, features: FEATURES }); });
})();
