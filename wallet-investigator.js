"use strict";

const CHAINS = {
  ETH: {
    dexId: "ethereum",
    llamaId: "ethereum",
    chainId: "1",
    native: "ETH",
    binanceId: "1",
    legacyApi: "https://api.etherscan.io/api",
    explorerName: "Etherscan",
    explorerUrl: "https://etherscan.io",
    rpc: "https://ethereum-rpc.publicnode.com",
    rpcs: [
      "https://ethereum-rpc.publicnode.com",
      "https://eth.llamarpc.com",
      "https://1rpc.io/eth",
      "https://eth.drpc.org",
    ],
    stableContracts: [
      "0xdac17f958d2ee523a2206206994597c13d831ec7",
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    ],
    nativeContracts: ["0x0000000000000000000000000000000000000000", "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"],
  },
  BSC: {
    dexId: "bsc",
    llamaId: "bsc",
    chainId: "56",
    native: "BNB",
    binanceId: "56",
    legacyApi: "https://api.bscscan.com/api",
    explorerName: "BscScan",
    explorerUrl: "https://bscscan.com",
    rpc: "https://bsc-rpc.publicnode.com",
    rpcs: ["https://bsc-rpc.publicnode.com", "https://bsc.drpc.org", "https://bnb.rpc.subquery.network/public"],
    stableContracts: [
      "0x55d398326f99059ff775485246999027b3197955",
      "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
      "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d",
    ],
    nativeContracts: ["0x0000000000000000000000000000000000000000", "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"],
  },
  Base: {
    dexId: "base",
    llamaId: "base",
    chainId: "8453",
    native: "ETH",
    binanceId: "8453",
    legacyApi: "https://api.basescan.org/api",
    explorerName: "BaseScan",
    explorerUrl: "https://basescan.org",
    rpc: "https://base-rpc.publicnode.com",
    rpcs: [
      "https://base-rpc.publicnode.com",
      "https://mainnet.base.org",
      "https://1rpc.io/base",
    ],
    stableContracts: ["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"],
    nativeContracts: ["0x0000000000000000000000000000000000000000", "0x4200000000000000000000000000000000000006"],
  },
  Arbitrum: {
    dexId: "arbitrum",
    llamaId: "arbitrum",
    chainId: "42161",
    native: "ETH",
    binanceId: null,
    legacyApi: "https://api.arbiscan.io/api",
    explorerName: "Arbiscan",
    explorerUrl: "https://arbiscan.io",
    rpc: "https://arbitrum-one-rpc.publicnode.com",
    rpcs: [
      "https://arbitrum-one-rpc.publicnode.com",
      "https://arb1.arbitrum.io/rpc",
    ],
    stableContracts: [
      "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
      "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    ],
    nativeContracts: ["0x0000000000000000000000000000000000000000", "0x82af49447d8a07e3bd95bd0d56f35241523fbab1"],
  },
  Solana: {
    dexId: "solana",
    native: "SOL",
    binanceId: "CT_501",
    explorerName: "Solscan",
    explorerUrl: "https://solscan.io",
    rpcs: [
      "https://solana-rpc.publicnode.com",
      "https://api.mainnet-beta.solana.com",
    ],
    stableMints: [
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB",
    ],
    nativeContracts: ["So11111111111111111111111111111111111111111"],
  },
};

const KNOWN_LABELS = {};

const STABLE_SYMBOLS = new Set(["USDT", "USDC", "USD1", "FDUSD", "USDE", "DAI", "USDG"]);
const NATIVE_SYMBOLS = new Set(["ETH", "WETH", "BNB", "WBNB", "SOL", "WSOL"]);
const GMGN_CHAIN_IDS = {
  ETH: "eth",
  BSC: "bsc",
  Base: "base",
  Arbitrum: "arc",
  Solana: "sol",
  Robinhood: "robinhood",
};
const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const runtime = {
  scan: null,
  trace: null,
  moneyMode: "usd",
  activeTab: "early",
  nativePrices: {},
  priceSource: "尚未更新",
  solanaRpc: "",
  credentials: { gmgnConfigured: false, gmgnSource: "none", explorerConfigured: false, binanceMode: "public-no-key" },
};

let explorerQueue = Promise.resolve();
const rpcQueues = new Map();

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function trimTerminalPunctuation(value) {
  return String(value ?? "").trim().replace(/[。.!！?？]+$/u, "");
}

function fundingStatusText(status) {
  if (status === "complete") return "Explorer 已查";
  if (status === "partial") return "Explorer / GMGN 部分成功";
  if (status === "gmgn") return "GMGN 首笔主币入金已查";
  if (status === "unsupported") return "目前未接入（Solana）";
  return "未查（缺 Key）";
}

function fundingUnavailableText(status) {
  if (status === "gmgn") return "GMGN 已查，未回传首笔主币来源";
  return status === "unsupported" ? "未查（Solana 资金源目前未接入）" : "未查（缺 Explorer Key）";
}

function normalizeAddress(value) {
  const text = String(value || "").trim();
  return text.startsWith("0x") ? text.toLowerCase() : text;
}

function coreAssetKind(position, chain) {
  const config = CHAINS[chain] || {};
  const symbol = String(position?.symbol || position?.asset || "").toUpperCase();
  const address = normalizeAddress(position?.address || position?.contractAddress || "");
  const nativeContracts = (config.nativeContracts || []).map(normalizeAddress);
  const stableContracts = (chain === "Solana" ? config.stableMints : config.stableContracts || []).map(normalizeAddress);
  if (NATIVE_SYMBOLS.has(symbol) && (!address || nativeContracts.includes(address))) return "native";
  if (STABLE_SYMBOLS.has(symbol) && address && stableContracts.includes(address)) return "usd";
  return "";
}

function positionMatchesAssetMode(position, chain, assetMode) {
  const kind = coreAssetKind(position, chain);
  return assetMode === "all" ? Boolean(kind) : kind === assetMode;
}

function fullText(value) {
  return String(value ?? "");
}

function shortAddress(value) {
  const text = String(value || "");
  if (text.length <= 15) return text;
  return `${text.slice(0, 7)}...${text.slice(-5)}`;
}

function isEvmAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim());
}

function isSolanaAddress(value) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value || "").trim());
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatNumber(value, maximumFractionDigits = 4) {
  const number = safeNumber(value);
  if (number === null) return "--";
  return number.toLocaleString("en-US", { maximumFractionDigits });
}

function formatUsd(value, compact = false) {
  const number = safeNumber(value);
  if (number === null) return "--";
  if (compact && Math.abs(number) >= 1000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(number);
  }
  return number.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(number) < 1 ? 4 : 0,
  });
}

function formatPercent(value, digits = 2) {
  const number = safeNumber(value);
  return number === null ? "--" : `${number.toLocaleString("en-US", { maximumFractionDigits: digits })}%`;
}

function formatLocalTime(timestampMs) {
  const value = safeNumber(timestampMs);
  if (value === null) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatElapsed(seconds) {
  const signed = Math.floor(Number(seconds) || 0);
  if (signed < 0) return `开盘前 ${formatElapsed(-signed)}`;
  const value = signed;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  if (hours) return `${hours} 小时 ${minutes} 分 ${secs} 秒`;
  if (minutes) return `${minutes} 分 ${secs} 秒`;
  return `${secs} 秒`;
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function setStatus(id, message, tone = "") {
  const element = $(id);
  if (!element) return;
  element.textContent = message;
  element.dataset.tone = tone;
}

function apiUrl(base, params) {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function fetchJson(url, options = {}, timeout = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") throw new Error("API 逾时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLocalGmgn(kind, chain, address) {
  const gmgnChain = GMGN_CHAIN_IDS[chain];
  if (!gmgnChain) return { ok: false, status: "unsupported", data: {}, errors: { chain: "GMGN 不支持此链" } };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  try {
    const response = await fetch(`/api/gmgn/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chain: gmgnChain, address }),
      signal: controller.signal,
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `GMGN 本机代理 HTTP ${response.status}`);
    return payload;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("GMGN 查找逾时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRelayRequests(address) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch("/api/relay/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, maxPages: 5 }),
      signal: controller.signal,
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Relay API HTTP ${response.status}`);
    return payload;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Relay API 查找逾时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runWorker()));
  return results;
}

function gmgnList(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["list", "holders", "traders", "holdings", "activities", "data", "items"]) {
    if (Array.isArray(value[key])) return value[key];
    if (value[key] && typeof value[key] === "object") {
      const nested = gmgnList(value[key]);
      if (nested.length) return nested;
    }
  }
  return [];
}

function gmgnPercent(value) {
  const number = safeNumber(value);
  if (number === null) return null;
  return Math.abs(number) <= 1 ? number * 100 : number;
}

function gmgnFunding(row, chain) {
  const native = Array.isArray(row?.native_transfer) ? row.native_transfer[0] : row?.native_transfer;
  if (!native || typeof native !== "object") return null;
  const counterparty = [native.from_address, native.from, native.sender, native.address]
    .map((value) => String(value || "").trim())
    .find((value) => isEvmAddress(value) || isSolanaAddress(value));
  if (!counterparty) return null;
  const sourceLabel = typeof native.name === "string" ? native.name.trim() : "";
  return {
    counterparty,
    sourceLabel,
    publicEntity: Boolean(sourceLabel),
    asset: native.symbol || CHAINS[chain]?.native || "主币",
    amount: safeNumber(native.amount) || safeNumber(native.native_amount),
    timestamp: safeNumber(native.timestamp) || safeNumber(native.transfer_timestamp),
    hash: native.transaction_hash || native.tx_hash || native.hash || "",
    provider: "GMGN 首笔主币入金",
  };
}

function normalizeGmgnTokenWallet(row, info, chain) {
  const wallet = row?.address || row?.wallet_address || row?.wallet;
  if (!wallet) return null;
  const buyUsd = safeNumber(row.buy_volume_cur) ?? safeNumber(row.history_bought_cost) ?? safeNumber(row.total_cost);
  const sellUsd = safeNumber(row.sell_volume_cur) ?? safeNumber(row.history_sold_income);
  const realizedPnl = safeNumber(row.realized_profit) ?? safeNumber(row.realized_pnl);
  const unrealizedPnl = safeNumber(row.unrealized_profit) ?? safeNumber(row.unrealized_pnl);
  const totalPnl = safeNumber(row.profit) ?? ((realizedPnl || 0) + (unrealizedPnl || 0));
  const supply = safeNumber(info?.circulating_supply) ?? safeNumber(info?.total_supply) ?? safeNumber(info?.max_supply);
  const averageBuyPrice = safeNumber(row.avg_cost);
  const averageSellPrice = safeNumber(row.avg_sold);
  const tags = [...new Set([
    ...(Array.isArray(row.tags) ? row.tags : []),
    ...(Array.isArray(row.maker_token_tags) ? row.maker_token_tags : []),
    ...(Array.isArray(row.wallet_tag_v2) ? row.wallet_tag_v2 : []),
  ].filter(Boolean).map(String))];
  return {
    wallet,
    name: row.name || row.twitter_name || row.twitter_username || "",
    twitter: row.twitter_username || "",
    tags,
    isNew: Boolean(row.is_new),
    isSuspicious: Boolean(row.is_suspicious),
    pool: Number(row.addr_type) === 2,
    funding: gmgnFunding(row, chain),
    holdingPct: gmgnPercent(row.amount_percentage),
    balance: safeNumber(row.amount_cur) ?? safeNumber(row.balance),
    usdValue: safeNumber(row.usd_value),
    buyUsd,
    sellUsd,
    buyQty: safeNumber(row.buy_amount_cur),
    sellQty: safeNumber(row.sell_amount_cur),
    averageBuyPrice,
    averageSellPrice,
    buyMarketCap: averageBuyPrice !== null && supply !== null ? averageBuyPrice * supply : null,
    sellMarketCap: averageSellPrice !== null && supply !== null ? averageSellPrice * supply : null,
    realizedPnl,
    unrealizedPnl,
    totalPnl,
    roi: gmgnPercent(row.profit_change),
    startHoldingAt: safeNumber(row.start_holding_at),
    lastActiveAt: safeNumber(row.last_active_timestamp),
    symbol: info?.symbol || "代币",
    raw: row,
  };
}

function normalizeGmgnTokenResult(response, chain) {
  const data = response?.data || {};
  const info = data.info?.data || data.info || {};
  const security = data.security?.data || data.security || {};
  const rows = new Map();
  [...gmgnList(data.holders), ...gmgnList(data.traders)].forEach((row) => {
    const normalized = normalizeGmgnTokenWallet(row, info, chain);
    if (!normalized) return;
    const key = normalizeAddress(normalized.wallet);
    const previous = rows.get(key);
    rows.set(key, previous ? {
      ...previous,
      ...normalized,
      tags: [...new Set([...previous.tags, ...normalized.tags])],
      funding: previous.funding || normalized.funding,
      name: previous.name || normalized.name,
    } : normalized);
  });
  return { response, info, security, wallets: [...rows.values()] };
}

function gmgnEarlyBuyerCandidates(gmgn, market, windowMinutes) {
  const launch = Math.floor(Number(market.pairCreatedAt) / 1000);
  const end = launch + windowMinutes * 60;
  const candidates = (gmgn?.wallets || [])
    .filter((wallet) => !wallet.pool)
    .filter((wallet) => wallet.startHoldingAt >= launch - 30 && wallet.startHoldingAt <= end)
    .filter((wallet) => wallet.buyUsd > 0 && wallet.buyQty > 0)
    .sort((a, b) => a.startHoldingAt - b.startHoldingAt)
    .slice(0, 50)
    .map((wallet, index) => ({
      wallet: wallet.wallet,
      timestamp: wallet.startHoldingAt,
      txHash: wallet.raw?.token_transfer?.tx_hash || "",
      firstTokenAmount: wallet.buyQty,
      block: safeNumber(wallet.raw?.last_block) || 0,
      rank: index + 1,
      elapsed: wallet.startHoldingAt - launch,
      gmgnSample: true,
    }));
  return {
    buyers: candidates,
    discovered: candidates.length,
    transferCount: null,
    provider: "GMGN 持有人/交易者可得样本",
    truncated: true,
    gmgnSample: true,
  };
}

function explorerKey() {
  return Boolean(runtime.credentials.explorerConfigured);
}

async function localApi(path, payload, timeout = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, {
      method: payload === undefined ? "GET" : "POST",
      headers: payload === undefined ? {} : { "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: controller.signal,
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `本机服务 HTTP ${response.status}`);
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("本机服务逾时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function updateCredentialStatus() {
  const gmgnStatus = $("gmgn-key-status");
  const explorerStatus = $("explorer-key-status");
  if (gmgnStatus) gmgnStatus.textContent = runtime.credentials.gmgnConfigured
    ? runtime.credentials.gmgnSource === "local-cli" ? "已使用这台电脑的 GMGN CLI 设置" : "已加密保存在这台电脑"
    : "尚未设置；请使用自己的唯读 Key";
  if (explorerStatus) explorerStatus.textContent = runtime.credentials.explorerConfigured ? "已加密保存在这台电脑" : "尚未设置";
  const noderealStatus = $("nodereal-key-status");
  if (noderealStatus) noderealStatus.textContent = runtime.credentials.noderealConfigured ? "已加密保存在这台电脑" : "尚未设置";
}

async function refreshCredentialStatus() {
  const status = await localApi("/api/credentials/status");
  runtime.credentials = { ...runtime.credentials, ...status };
  updateCredentialStatus();
  return status;
}

async function migrateLegacyExplorerKey() {
  const legacyKey = localStorage.getItem("wallet-investigator-explorer-key") || "";
  if (!legacyKey) return;
  try {
    await localApi("/api/credentials", { explorerApiKey: legacyKey });
    localStorage.removeItem("wallet-investigator-explorer-key");
    await refreshCredentialStatus();
  } catch {
    setStatus("api-settings-status", "旧版 Explorer Key 尚未完成本机加密搬移。", "error");
  }
}

function wireExplorerKeyStorage() {
  const dialog = $("api-settings-dialog");
  $("api-settings-toggle")?.addEventListener("click", () => dialog?.showModal());
  $("api-settings-close")?.addEventListener("click", () => dialog?.close());
  $("save-api-credentials")?.addEventListener("click", async () => {
    const gmgnApiKey = $("gmgn-api-key")?.value.trim() || "";
    const explorerApiKey = $("explorer-api-key")?.value.trim() || "";
    const noderealApiKey = $("nodereal-api-key")?.value.trim() || "";
    if (!gmgnApiKey && !explorerApiKey && !noderealApiKey) return setStatus("api-settings-status", "请至少输入一个要保存的 Key。", "error");
    try {
      setStatus("api-settings-status", "正在以 Windows DPAPI 加密...", "");
      await localApi("/api/credentials", { ...(gmgnApiKey ? { gmgnApiKey } : {}), ...(explorerApiKey ? { explorerApiKey } : {}), ...(noderealApiKey ? { noderealApiKey } : {}) });
      if ($("gmgn-api-key")) $("gmgn-api-key").value = "";
      if ($("explorer-api-key")) $("explorer-api-key").value = "";
      if ($("nodereal-api-key")) $("nodereal-api-key").value = "";
      await refreshCredentialStatus();
      setStatus("api-settings-status", "已加密保存在目前 Windows 用户的本机设置，不会写入网站或云端。", "success");
    } catch (error) {
      setStatus("api-settings-status", `保存失败：${trimTerminalPunctuation(error.message)}`, "error");
    }
  });
  $("clear-gmgn-key")?.addEventListener("click", async () => {
    try {
      await localApi("/api/credentials", { clearGmgnApiKey: true });
      await refreshCredentialStatus();
      setStatus("api-settings-status", runtime.credentials.gmgnSource === "local-cli" ? "已清除网站本机加密值；仍会使用 GMGN CLI 的本机设置。" : "已清除 GMGN Key。", "success");
    } catch (error) {
      setStatus("api-settings-status", `清除失败：${trimTerminalPunctuation(error.message)}`, "error");
    }
  });
  $("clear-explorer-key")?.addEventListener("click", async () => {
    try {
      await localApi("/api/credentials", { clearExplorerApiKey: true });
      localStorage.removeItem("wallet-investigator-explorer-key");
      await refreshCredentialStatus();
      setStatus("api-settings-status", "已清除 Etherscan V2 Key。", "success");
    } catch (error) {
      setStatus("api-settings-status", `清除失败：${trimTerminalPunctuation(error.message)}`, "error");
    }
  });
  $("clear-nodereal-key")?.addEventListener("click", async () => {
    try {
      await localApi("/api/credentials", { clearNoderealApiKey: true });
      await refreshCredentialStatus();
      setStatus("api-settings-status", "已清除 NodeReal Key。", "success");
    } catch (error) {
      setStatus("api-settings-status", `清除失败：${trimTerminalPunctuation(error.message)}`, "error");
    }
  });
  refreshCredentialStatus().then(migrateLegacyExplorerKey).catch((error) => setStatus("api-settings-status", `本机设置服务无法连接：${error.message}`, "error"));
}

function explorerPayloadRows(payload, provider) {
  if (Array.isArray(payload?.result)) return payload.result;
  const message = String(payload?.result || payload?.message || `${provider} 查找失败`);
  if (/no transactions|no records|not found/i.test(message)) return [];
  throw new Error(message);
}

async function explorerRequest(chain, params) {
  const config = CHAINS[chain];
  if (!config?.chainId) throw new Error(`${chain} 不使用 EVM Explorer`);
  if (!explorerKey()) {
    const error = new Error("缺少 Explorer API Key");
    error.code = "MISSING_EXPLORER_KEY";
    throw error;
  }

  const run = explorerQueue.then(async () => {
    await sleep(230);
    return localApi("/api/explorer", { chain, params });
  });
  explorerQueue = run.catch(() => undefined);
  const result = await run;
  if (params.action === "getblocknobytime") {
    const block = Number(result.payload?.result);
    if (!Number.isFinite(block)) throw new Error(String(result.payload?.result || result.payload?.message || "Etherscan V2 区块格式错误"));
    return { block, provider: result.provider };
  }
  return { rows: explorerPayloadRows(result.payload, result.provider), provider: result.provider };
}

async function getBlockByTime(chain, timestamp, closest) {
  try {
    const result = await explorerRequest(chain, { module: "block", action: "getblocknobytime", timestamp: Math.floor(timestamp), closest });
    return result.block;
  } catch (error) {
    throw new Error(`无法定位 ${formatLocalTime(timestamp * 1000)} 的区块：${error.message}`);
  }
}

async function fetchTokenTransfers(chain, contract, startBlock, endBlock) {
  const all = [];
  let provider = "";
  let truncated = false;
  for (let page = 1; page <= 10; page += 1) {
    const result = await explorerRequest(chain, {
      module: "account",
      action: "tokentx",
      contractaddress: contract,
      startblock: startBlock,
      endblock: endBlock,
      page,
      offset: 1000,
      sort: "asc",
    });
    provider = result.provider;
    all.push(...result.rows);
    if (result.rows.length < 1000) break;
    if (page === 10) truncated = true;
  }
  return { rows: all, provider, truncated };
}

function parseEvmTransfer(tx, target) {
  const from = normalizeAddress(tx.from);
  const to = normalizeAddress(tx.to);
  const outgoing = from === target;
  const incoming = to === target;
  if (!incoming && !outgoing) return null;
  const decimals = Number(tx.tokenDecimal || 18);
  const raw = Number(tx.value || 0) / 10 ** decimals;
  return {
    direction: outgoing ? "转出" : "流入",
    counterparty: outgoing ? tx.to : tx.from,
    from: tx.from,
    to: tx.to,
    asset: tx.tokenSymbol || "Token",
    amount: raw,
    hash: tx.hash,
    timestamp: Number(tx.timeStamp || 0),
    block: Number(tx.blockNumber || 0),
    contractAddress: tx.contractAddress || "",
    provider: "Explorer API",
  };
}

async function fetchEvmWalletTransfers(address, chain, assetMode = "all", endBlock = 99999999) {
  const config = CHAINS[chain];
  const target = normalizeAddress(address);
  const includeNative = assetMode === "all" || assetMode === "native";
  const includeUsd = assetMode === "all" || assetMode === "usd";
  const jobs = [];
  if (includeNative) {
    jobs.push(explorerRequest(chain, {
      module: "account",
      action: "txlist",
      address,
      startblock: 0,
      endblock: endBlock,
      page: 1,
      offset: 200,
      sort: "desc",
    }).then((result) => result.rows.filter((tx) => tx.isError !== "1" && Number(tx.value) > 0).map((tx) => ({
      direction: normalizeAddress(tx.from) === target ? "转出" : "流入",
      counterparty: normalizeAddress(tx.from) === target ? tx.to : tx.from,
      from: tx.from,
      to: tx.to,
      asset: config.native,
      amount: Number(tx.value) / 1e18,
      hash: tx.hash,
      timestamp: Number(tx.timeStamp || 0),
      block: Number(tx.blockNumber || 0),
      contractAddress: "",
      provider: result.provider,
    })).filter((tx) => normalizeAddress(tx.from) === target || normalizeAddress(tx.to) === target)));
  }
  if (includeUsd) {
    jobs.push(explorerRequest(chain, {
      module: "account",
      action: "tokentx",
      address,
      startblock: 0,
      endblock: endBlock,
      page: 1,
      offset: 200,
      sort: "desc",
    }).then((result) => result.rows
      .filter((tx) => config.stableContracts.includes(normalizeAddress(tx.contractAddress)))
      .map((tx) => parseEvmTransfer(tx, target))
      .filter(Boolean)
      .map((tx) => ({ ...tx, provider: result.provider }))));
  }
  const rows = (await Promise.all(jobs)).flat().sort((a, b) => b.timestamp - a.timestamp);
  return rows;
}

async function rpcRequest(url, method, params) {
  const previous = rpcQueues.get(url) || Promise.resolve();
  const request = previous.then(async () => {
    await sleep(url.includes("drpc.org") ? 400 : 110);
    return fetchJson("/api/evm-rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: url, requests: [{ method, params }] }),
    }, 45000);
  });
  rpcQueues.set(url, request.catch(() => undefined));
  let payload;
  try {
    payload = await request;
  } catch (error) {
    throw new Error(`${method} @ ${new URL(url).host}：${error.message}`);
  }
  if (payload.errors?.length && payload.results?.[0] == null) throw new Error(`${method}：${payload.errors[0]}`);
  return payload.results?.[0] ?? null;
}

async function rpcBatch(url, requests) {
  if (!requests.length) return [];
  const previous = rpcQueues.get(url) || Promise.resolve();
  const request = previous.then(async () => {
    await sleep(url.includes("drpc.org") ? 400 : 110);
    return fetchJson("/api/evm-rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: url, requests }),
    }, 60000);
  });
  rpcQueues.set(url, request.catch(() => undefined));
  let payload;
  try {
    payload = await request;
  } catch (error) {
    throw new Error(`batch @ ${new URL(url).host}：${error.message}`);
  }
  if (!Array.isArray(payload.results)) throw new Error("RPC 批量回传格式错误");
  return payload.results;
}

function solanaRpcCandidates() {
  const configured = CHAINS.Solana.rpcs || [];
  return [...new Set([runtime.solanaRpc, ...configured].filter(Boolean))];
}

async function solanaRpcRequest(method, params) {
  const payload = await fetchJson("/api/solana-rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requests: [{ method, params }] }),
  }, 60000);
  runtime.solanaRpc = payload.provider || "本机代理";
  return payload.results?.[0] ?? null;
}

async function solanaRpcBatch(requests) {
  const payload = await fetchJson("/api/solana-rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requests }),
  }, 90000);
  runtime.solanaRpc = payload.provider || "本机代理";
  return payload.results || [];
}

function toHexBlock(value) {
  return `0x${Math.max(0, Number(value) || 0).toString(16)}`;
}

function topicAddress(address) {
  return `0x${normalizeAddress(address).replace(/^0x/, "").padStart(64, "0")}`;
}

function topicToAddress(topic) {
  return `0x${String(topic || "").slice(-40)}`;
}

async function getBlockByTimeRpc(chain, timestamp, closest, rpcOverride = "") {
  const rpc = rpcOverride || CHAINS[chain]?.rpc;
  if (!rpc) throw new Error(`${chain} 没有设置 RPC`);
  const llamaId = CHAINS[chain]?.llamaId;
  if (llamaId) {
    try {
      const payload = await fetchJson("/api/defillama/block", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chain: llamaId, timestamp: Math.floor(timestamp) }),
      });
      const height = Number(payload?.height);
      if (Number.isFinite(height)) return height + (closest === "after" ? 1 : 0);
    } catch {
    }
  }
  const latest = await rpcRequest(rpc, "eth_getBlockByNumber", ["latest", false]);
  const latestNumber = parseInt(latest.number, 16);
  const latestTime = parseInt(latest.timestamp, 16);
  if (timestamp >= latestTime) return latestNumber;
  const sampleNumber = Math.max(0, latestNumber - 10000);
  const sample = await rpcRequest(rpc, "eth_getBlockByNumber", [toHexBlock(sampleNumber), false]);
  if (!sample) throw new Error("RPC 不提供足够的历史区块，无法定位开盘时间");
  const sampleTime = parseInt(sample.timestamp, 16);
  const secondsPerBlock = Math.max((latestTime - sampleTime) / Math.max(latestNumber - sampleNumber, 1), 0.1);
  const estimate = Math.max(0, Math.min(latestNumber, Math.floor(latestNumber - (latestTime - timestamp) / secondsPerBlock)));
  let radius = 25000;
  let low = Math.max(0, estimate - radius);
  let high = Math.min(latestNumber, estimate + radius);
  for (let expansion = 0; expansion < 8; expansion += 1) {
    const [lowBlock, highBlock] = await Promise.all([
      rpcRequest(rpc, "eth_getBlockByNumber", [toHexBlock(low), false]),
      rpcRequest(rpc, "eth_getBlockByNumber", [toHexBlock(high), false]),
    ]);
    if (!lowBlock || !highBlock) throw new Error("RPC 历史区块深度不足，请使用 Explorer 后备来源");
    const lowTime = parseInt(lowBlock.timestamp, 16);
    const highTime = parseInt(highBlock.timestamp, 16);
    if (lowTime <= timestamp && highTime >= timestamp) break;
    radius *= 2;
    low = Math.max(0, estimate - radius);
    high = Math.min(latestNumber, estimate + radius);
  }
  let before = low;
  let after = high;
  for (let step = 0; step < 32 && low <= high; step += 1) {
    const middle = Math.floor((low + high) / 2);
    const block = await rpcRequest(rpc, "eth_getBlockByNumber", [toHexBlock(middle), false]);
    if (!block) break;
    const blockTime = parseInt(block.timestamp, 16);
    if (blockTime <= timestamp) {
      before = middle;
      low = middle + 1;
    } else {
      after = middle;
      high = middle - 1;
    }
  }
  return closest === "before" ? before : after;
}

async function getLogsRange(rpc, filter, startBlock, endBlock, depth = 0) {
  try {
    return await rpcRequest(rpc, "eth_getLogs", [{ ...filter, fromBlock: toHexBlock(startBlock), toBlock: toHexBlock(endBlock) }]);
  } catch (error) {
    if (/HTTP (401|403|429|5\d\d)|forbidden|unauthorized/i.test(error.message) || startBlock >= endBlock || depth >= 12) throw error;
    const middle = Math.floor((startBlock + endBlock) / 2);
    const left = await getLogsRange(rpc, filter, startBlock, middle, depth + 1);
    const right = await getLogsRange(rpc, filter, middle + 1, endBlock, depth + 1);
    return [...left, ...right];
  }
}

async function launchSources(logs, market, contract, chain, rpc) {
  const pool = normalizeAddress(market.pairAddress);
  const tokenContract = normalizeAddress(contract);
  const minted = [...new Set(logs
    .filter((log) => /^0x0{40}$/.test(normalizeAddress(topicToAddress(log.topics?.[1]))))
    .map((log) => normalizeAddress(topicToAddress(log.topics?.[2]))))]
    .filter((address) => isEvmAddress(address) && address !== pool && address !== tokenContract && !/^0x0{40}$/.test(address));
  const kinds = await classifyEvmWallets(minted, chain, rpc);
  return new Set([pool, ...minted.filter((address) => kinds.get(address) === false)]);
}

async function scanEvmEarlyBuyersAtRpc(market, contract, windowMinutes, onStatus, rpc) {
  const chain = market.detectedChain;
  const launch = Math.floor(Number(market.pairCreatedAt) / 1000);
  const end = launch + windowMinutes * 60;
  onStatus("正在以公开 RPC 定位开盘区块...");
  const [startBlock, endBlock] = await Promise.all([
    getBlockByTimeRpc(chain, Math.max(launch - 30, 1), "before", rpc),
    getBlockByTimeRpc(chain, end, "after", rpc),
  ]);
  onStatus(`正在读取公开 RPC 的代币转帐日志（区块 ${startBlock.toLocaleString()} 至 ${endBlock.toLocaleString()}）...`);
  const logFilter = { address: contract, topics: [ERC20_TRANSFER_TOPIC] };
  const logs = [];
  const chunkSize = 2000;
  for (let fromBlock = startBlock; fromBlock <= endBlock; fromBlock += chunkSize) {
    const toBlock = Math.min(endBlock, fromBlock + chunkSize - 1);
    const chunk = await getLogsRange(rpc, logFilter, fromBlock, toBlock);
    logs.push(...chunk);
  }
  let decimals = 18;
  try {
    const rawDecimals = await rpcRequest(rpc, "eth_call", [{ to: contract, data: "0x313ce567" }, "latest"]);
    decimals = parseInt(rawDecimals, 16);
  } catch {
    decimals = 18;
  }
  const tokenContract = normalizeAddress(contract);
  const sources = await launchSources(logs, market, contract, chain, rpc);
  const poolOutTransactions = new Set(logs
    .filter((log) => sources.has(normalizeAddress(topicToAddress(log.topics?.[1]))))
    .map((log) => normalizeAddress(log.transactionHash)));
  const candidates = new Map();
  logs.forEach((log) => {
    if (!poolOutTransactions.has(normalizeAddress(log.transactionHash))) return;
    const recipient = normalizeAddress(topicToAddress(log.topics?.[2]));
    if (!isEvmAddress(recipient) || sources.has(recipient) || recipient === tokenContract || /^0x0{40}$/.test(recipient)) return;
    const block = parseInt(log.blockNumber, 16);
    const amount = Number(BigInt(log.data || "0x0")) / 10 ** decimals;
    const current = candidates.get(recipient);
    if (!current || block < current.block) {
      candidates.set(recipient, { wallet: recipient, block, txHash: log.transactionHash, firstTokenAmount: amount });
    }
  });
  const preliminary = [...candidates.values()].sort((a, b) => a.block - b.block).slice(0, 100);
  const uniqueBlocks = [...new Set(preliminary.map((item) => item.block))];
  const blockPayloads = await rpcBatch(rpc, uniqueBlocks.map((block) => ({ method: "eth_getBlockByNumber", params: [toHexBlock(block), false] })));
  const timestampByBlock = new Map(uniqueBlocks.map((block, index) => [block, parseInt(blockPayloads[index]?.timestamp || "0x0", 16)]));
  preliminary.forEach((item) => { item.timestamp = timestampByBlock.get(item.block) || launch; });
  const walletMap = await classifyEvmWallets(preliminary.map((item) => item.wallet), chain, rpc);
  const ordered = preliminary.filter((item) => walletMap.get(normalizeAddress(item.wallet)) !== false).sort((a, b) => a.timestamp - b.timestamp || a.block - b.block);
  return {
    buyers: ordered.slice(0, 50).map((item, index) => ({ ...item, rank: index + 1, elapsed: item.timestamp - launch })),
    discovered: candidates.size,
    transferCount: logs.length,
    provider: `${chain} 公开 JSON-RPC (${new URL(rpc).host})`,
    truncated: candidates.size > 50,
    startBlock,
    endBlock,
  };
}

async function scanEvmEarlyBuyersRpc(market, contract, windowMinutes, onStatus) {
  const chain = market.detectedChain;
  const endpoints = CHAINS[chain]?.rpcs || [CHAINS[chain]?.rpc].filter(Boolean);
  const errors = [];
  for (const rpc of endpoints) {
    try {
      return await scanEvmEarlyBuyersAtRpc(market, contract, windowMinutes, onStatus, rpc);
    } catch (error) {
      errors.push(`${new URL(rpc).host}：${error.message}`);
      onStatus(`${new URL(rpc).host} 无法完成，正在切换公开 RPC...`);
    }
  }
  throw new Error(`所有公开 RPC 都无法完成：${errors.join("；")}`);
}

async function fetchDexPairs(contract, requestedChain) {
  const chainNames = requestedChain === "Auto"
    ? (isSolanaAddress(contract) ? ["Solana"] : ["ETH", "BSC", "Base", "Arbitrum"])
    : [requestedChain];
  if (chainNames.includes("Robinhood")) throw new Error("Robinhood Chain 尚无可验证的 DexScreener 代币池来源，不能产生侦查结果。");
  const results = await Promise.allSettled(chainNames.map(async (chain) => {
    const config = CHAINS[chain];
    if (!config?.dexId) return [];
    const payload = await fetchJson("/api/dexscreener/pairs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chain, address: contract }),
    });
    const pairs = Array.isArray(payload.pairs) ? payload.pairs : [];
    return pairs.map((pair) => ({ ...pair, detectedChain: chain }));
  }));
  const pairs = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const normalized = normalizeAddress(contract);
  const exact = pairs.filter((pair) => [pair.baseToken?.address, pair.quoteToken?.address].map(normalizeAddress).includes(normalized));
  if (!exact.length) throw new Error("DexScreener 找不到此完整 CA 的有效交易池；请确认地址与链。");
  const timedPairs = exact.filter((pair) => Number.isFinite(Number(pair.pairCreatedAt)) && Number(pair.pairCreatedAt) > 0);
  if (!timedPairs.length) throw new Error("DexScreener 找到交易池，但没有可验证的创建时间，因此不能排序开盘首买。");
  timedPairs.sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));
  return timedPairs[0];
}

async function detectEvmContractChain(contract) {
  const candidates = ["BSC", "ETH", "Base", "Arbitrum"];
  const probes = await Promise.allSettled(candidates.map(async (chain) => {
    const code = await rpcRequest(CHAINS[chain].rpc, "eth_getCode", [contract, "latest"]);
    return code && code !== "0x" ? chain : "";
  }));
  const detected = probes.find((probe) => probe.status === "fulfilled" && probe.value)?.value;
  if (!detected) throw new Error("各支持 EVM 链都找不到此合约代码");
  return detected;
}

function marketFromGmgn(gmgn, chain, contract) {
  const info = gmgn?.info || {};
  const pool = info.pool || {};
  const creation = safeNumber(pool.creation_timestamp) ?? safeNumber(info.creation_timestamp) ?? safeNumber(info.open_timestamp);
  if (!creation) throw new Error("GMGN 有代币数据，但没有可验证的创建时间");
  const pairAddress = pool.pool_address || info.biggest_pool_address || contract;
  const quoteSymbol = pool.quote_symbol || CHAINS[chain]?.native || "主币";
  return {
    detectedChain: chain,
    pairAddress,
    pairCreatedAt: creation * 1000,
    baseToken: { address: contract, symbol: info.symbol || "代币", name: info.name || "" },
    quoteToken: { address: pool.quote_address || "", symbol: quoteSymbol },
    liquidity: { usd: safeNumber(pool.liquidity) ?? safeNumber(info.liquidity) ?? 0 },
    source: `GMGN ${info.launchpad_platform || info.launchpad || "开盘平台"}`,
    launchpad: info.launchpad_platform || info.launchpad || "",
  };
}

function normalizeBinancePosition(position) {
  const buyQty = Number(position.buyQty || 0);
  const sellQty = Number(position.sellQty || 0);
  const remainQty = Number(position.remainQty || 0);
  const buyUsd = Number(position.buyAmtUsd || 0);
  const sellUsd = Number(position.sellAmtUsd || 0);
  const avgPrice = Number(position.avgPrice || 0);
  const price = Number(position.price || 0);
  const supply = Number(position.circulatingSupply || 0);
  const soldCost = buyQty > 0 ? buyUsd * Math.min(sellQty / buyQty, 1) : 0;
  const realizedPnl = sellUsd - soldCost;
  const unrealizedPnl = remainQty * (price - avgPrice);
  const totalPnl = realizedPnl + unrealizedPnl;
  const sellPrice = sellQty > 0 ? sellUsd / sellQty : null;
  return {
    address: position.contractAddress || position.address || "",
    symbol: String(position.symbol || "-").toUpperCase(),
    name: position.name || "",
    buyQty,
    sellQty,
    remainQty,
    buyUsd,
    sellUsd,
    avgPrice,
    price,
    supply,
    realizedPnl,
    unrealizedPnl,
    totalPnl,
    roi: buyUsd > 0 ? (totalPnl / buyUsd) * 100 : null,
    holdingPct: supply > 0 ? (remainQty / supply) * 100 : null,
    buyMarketCap: avgPrice > 0 && supply > 0 ? avgPrice * supply : null,
    sellMarketCap: sellPrice && supply > 0 ? sellPrice * supply : null,
    valueUsd: remainQty * price,
    baseCoinPrice: Number(position.baseCoinPrice || 0),
    change24h: Number(position.percentChange24h || 0),
    buyCount: Number(position.buyCnt || 0),
    sellCount: Number(position.sellCnt || 0),
    lastTxTime: Number(position.lastTxTime || 0),
    source: "Binance Web3 公开地址持仓",
  };
}

async function fetchBinancePositions(address, chain) {
  const config = CHAINS[chain];
  if (!config?.binanceId) return { positions: [], total: 0, status: "unsupported" };
  const response = await fetchJson("/api/binance/positions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chain, address }),
  });
  const payload = response.payload || {};
  if (payload.code !== "000000") throw new Error(payload.message || `Binance Web3 错误 ${payload.code || ""}`);
  const list = Array.isArray(payload.data?.list) ? payload.data.list : [];
  const positions = list.map(normalizeBinancePosition);
  const basePrice = positions.find((position) => position.baseCoinPrice > 0)?.baseCoinPrice;
  if (basePrice && config.native) runtime.nativePrices[config.native] = basePrice;
  return { positions, total: list.length, status: "ok" };
}

async function fetchEvmNativePosition(address, chain) {
  const config = CHAINS[chain];
  if (!config?.rpc || !config.native || !isEvmAddress(address)) return null;
  const raw = await rpcRequest(config.rpc, "eth_getBalance", [address, "latest"]);
  const balance = Number(BigInt(raw || "0x0")) / 1e18;
  if (!(balance > 0)) return null;
  const price = safeNumber(runtime.nativePrices[config.native]) || 0;
  return {
    address: "",
    symbol: config.native,
    name: config.native,
    buyQty: 0,
    sellQty: 0,
    remainQty: balance,
    buyUsd: 0,
    sellUsd: 0,
    avgPrice: 0,
    price,
    supply: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    totalPnl: balance * price,
    roi: null,
    holdingPct: null,
    buyMarketCap: null,
    sellMarketCap: null,
    valueUsd: balance * price,
    baseCoinPrice: price,
    change24h: 0,
    source: `${chain} 公开 RPC 原生币余额`,
  };
}

async function mapLimit(items, limit, mapper, progress) {
  const output = new Array(items.length);
  let cursor = 0;
  let completed = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        output[index] = await mapper(items[index], index);
      } catch (error) {
        output[index] = { error: error.message };
      }
      completed += 1;
      progress?.(completed, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

async function classifyEvmWallets(addresses, chain, rpcOverride = "") {
  const config = CHAINS[chain];
  const rpc = rpcOverride || config?.rpc;
  if (!rpc || !addresses.length) return new Map();
  try {
    const results = await rpcBatch(rpc, addresses.map((address) => ({ method: "eth_getCode", params: [address, "latest"] })));
    return new Map(addresses.map((address, index) => [normalizeAddress(address), results[index] === "0x"]));
  } catch {
    return new Map();
  }
}

async function scanEvmEarlyBuyersExplorer(market, contract, windowMinutes, onStatus) {
  const chain = market.detectedChain;
  const launch = Math.floor(Number(market.pairCreatedAt) / 1000);
  const end = launch + windowMinutes * 60;
  onStatus("正在把开盘时间换算成链上区块...");
  const [startBlock, endBlock] = await Promise.all([
    getBlockByTime(chain, Math.max(launch - 30, 1), "before"),
    getBlockByTime(chain, end, "after"),
  ]);
  onStatus(`正在读取区块 ${startBlock.toLocaleString()} 至 ${endBlock.toLocaleString()} 的代币转帐...`);
  const transferResult = await fetchTokenTransfers(chain, contract, startBlock, endBlock);
  const tokenContract = normalizeAddress(contract);
  const sources = await launchSources(transferResult.rows.map((tx) => ({ topics: [ERC20_TRANSFER_TOPIC, tx.from, tx.to] })), market, contract, chain, "");
  const candidates = new Map();
  transferResult.rows.forEach((tx) => {
    if (!sources.has(normalizeAddress(tx.from))) return;
    const recipient = normalizeAddress(tx.to);
    if (!isEvmAddress(recipient) || sources.has(recipient) || recipient === tokenContract || /^0x0{40}$/.test(recipient)) return;
    const timestamp = Number(tx.timeStamp || 0);
    if (timestamp < launch - 30 || timestamp > end) return;
    const amount = Number(tx.value || 0) / 10 ** Number(tx.tokenDecimal || 18);
    const current = candidates.get(recipient);
    if (!current || timestamp < current.timestamp) {
      candidates.set(recipient, {
        wallet: tx.to,
        timestamp,
        block: Number(tx.blockNumber || 0),
        txHash: tx.hash,
        firstTokenAmount: amount,
      });
    }
  });
  const ordered = [...candidates.values()].sort((a, b) => a.timestamp - b.timestamp);
  const firstCandidates = ordered.slice(0, 80);
  const walletMap = await classifyEvmWallets(firstCandidates.map((item) => item.wallet), chain);
  const buyers = firstCandidates
    .filter((item) => walletMap.get(normalizeAddress(item.wallet)) !== false)
    .slice(0, 50)
    .map((item, index) => ({ ...item, rank: index + 1, elapsed: item.timestamp - launch }));
  return {
    buyers,
    discovered: ordered.length,
    transferCount: transferResult.rows.length,
    provider: transferResult.provider,
    truncated: transferResult.truncated || ordered.length > 50,
    startBlock,
    endBlock,
  };
}

async function scanEvmEarlyBuyers(market, contract, windowMinutes, onStatus) {
  try {
    return await scanEvmEarlyBuyersRpc(market, contract, windowMinutes, onStatus);
  } catch (rpcError) {
    if (!explorerKey()) {
      throw new Error(`公开 RPC 无法完成前 50：${rpcError.message}。可填入付费 Etherscan V2 Key 作为后备来源`);
    }
    onStatus(`公开 RPC 失败，改用 Explorer 后备来源：${rpcError.message}`);
    try {
      return await scanEvmEarlyBuyersExplorer(market, contract, windowMinutes, onStatus);
    } catch (explorerError) {
      throw new Error(`公开 RPC：${rpcError.message}；Explorer：${explorerError.message}`);
    }
  }
}

function tokenOwnersFromTransaction(transaction, mint) {
  const pre = new Map();
  const post = new Map();
  (transaction?.meta?.preTokenBalances || []).forEach((item) => {
    if (item.mint === mint && item.owner) pre.set(item.owner, Number(item.uiTokenAmount?.uiAmountString || 0));
  });
  (transaction?.meta?.postTokenBalances || []).forEach((item) => {
    if (item.mint === mint && item.owner) post.set(item.owner, Number(item.uiTokenAmount?.uiAmountString || 0));
  });
  return [...new Set([...pre.keys(), ...post.keys()])].map((owner) => ({
    owner,
    delta: (post.get(owner) || 0) - (pre.get(owner) || 0),
  }));
}

async function scanSolanaEarlyBuyers(market, contract, windowMinutes, onStatus) {
  const launch = Math.floor(Number(market.pairCreatedAt) / 1000);
  const end = launch + windowMinutes * 60;
  let before;
  let signatures = [];
  let reachedLaunch = false;
  for (let page = 0; page < 8; page += 1) {
    onStatus(`正在透过 Solana RPC 回溯交易签名（第 ${page + 1} 批）...`);
    const batch = await solanaRpcRequest("getSignaturesForAddress", [market.pairAddress, { limit: 1000, ...(before ? { before } : {}) }]);
    if (!batch.length) break;
    signatures.push(...batch.filter((item) => item.blockTime >= launch - 30 && item.blockTime <= end && !item.err));
    const oldest = batch.at(-1);
    if (oldest?.blockTime && oldest.blockTime <= launch - 30) {
      reachedLaunch = true;
      break;
    }
    before = oldest?.signature;
    if (!before) break;
  }
  signatures = signatures.sort((a, b) => a.blockTime - b.blockTime).slice(0, 300);
  const buyerMap = new Map();
  let parsedTransactionCount = 0;
  let stoppedAtTarget = false;
  for (let index = 0; index < signatures.length; index += 20) {
    onStatus(`正在解析 Solana 开盘交易 ${Math.min(index + 20, signatures.length)} / ${signatures.length}...`);
    const chunk = signatures.slice(index, index + 20);
    const results = await solanaRpcBatch(chunk.map((item) => ({
      method: "getTransaction",
      params: [item.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
    })));
    results.forEach((transaction, offset) => {
      if (!transaction) return;
      parsedTransactionCount += 1;
      const signature = chunk[offset].signature;
      tokenOwnersFromTransaction(transaction, contract).forEach(({ owner, delta }) => {
        if (delta <= 0 || owner === market.pairAddress) return;
        const timestamp = Number(transaction.blockTime || 0);
        const current = buyerMap.get(owner);
        if (!current || timestamp < current.timestamp) {
          buyerMap.set(owner, { wallet: owner, timestamp, txHash: signature, firstTokenAmount: delta, block: transaction.slot });
        }
      });
    });
    if (buyerMap.size >= 50) {
      stoppedAtTarget = true;
      break;
    }
  }
  const ordered = [...buyerMap.values()].sort((a, b) => a.timestamp - b.timestamp);
  return {
    buyers: ordered.slice(0, 50).map((item, index) => ({ ...item, rank: index + 1, elapsed: item.timestamp - launch })),
    discovered: ordered.length,
    transferCount: parsedTransactionCount,
    provider: `Solana Mainnet RPC (${runtime.solanaRpc || "本机代理"})`,
    truncated: stoppedAtTarget || !reachedLaunch || ordered.length > 50 || signatures.length === 300,
  };
}

async function enrichBuyerPositions(buyers, contract, chain, onStatus) {
  const normalizedContract = normalizeAddress(contract);
  return mapLimit(buyers, 4, async (buyer) => {
    try {
      const result = await fetchBinancePositions(buyer.wallet, chain);
      const position = result.positions.find((item) => normalizeAddress(item.address) === normalizedContract) || null;
      return { ...buyer, position, positionStatus: position ? "live" : result.status === "ok" ? "not-active" : result.status };
    } catch (error) {
      return { ...buyer, position: null, positionStatus: "error", positionError: error.message };
    }
  }, (done, total) => onStatus(`正在读取 Binance Web3 买卖与持仓 ${done} / ${total}...`));
}

function gmgnPosition(wallet) {
  if (!wallet) return null;
  return {
    symbol: wallet.symbol,
    remainQty: wallet.balance,
    sellQty: wallet.sellQty,
    buyQty: wallet.buyQty,
    holdingPct: wallet.holdingPct,
    valueUsd: wallet.usdValue,
    buyUsd: wallet.buyUsd,
    sellUsd: wallet.sellUsd,
    buyMarketCap: null,
    sellMarketCap: null,
    realizedPnl: wallet.realizedPnl,
    unrealizedPnl: wallet.unrealizedPnl,
    totalPnl: wallet.totalPnl,
    roi: wallet.roi,
    provider: "GMGN",
  };
}

function mergeGmgnIntoBuyers(buyers, gmgn, chain) {
  const byWallet = new Map((gmgn?.wallets || []).map((row) => [normalizeAddress(row.wallet), row]));
  return buyers.map((buyer) => {
    const gmgnWallet = byWallet.get(normalizeAddress(buyer.wallet));
    if (!gmgnWallet) return buyer;
    const funding = buyer.funding || gmgnWallet.funding;
    return {
      ...buyer,
      gmgn: gmgnWallet,
      position: buyer.position || gmgnPosition(gmgnWallet),
      positionStatus: buyer.position ? buyer.positionStatus : "gmgn-live",
      funding,
      fundingProvider: buyer.funding ? buyer.funding.provider || "Explorer" : gmgnWallet.funding ? "GMGN" : "",
    };
  });
}

function fundingUsdValue(row, chain) {
  if (STABLE_SYMBOLS.has(String(row.asset).toUpperCase())) return row.amount;
  const price = runtime.nativePrices[CHAINS[chain]?.native];
  return price ? row.amount * price : null;
}

async function findFundingSource(buyer, chain, pairAddress) {
  if (!buyer.block) return { ...buyer, funding: null };
  const rows = await fetchEvmWalletTransfers(buyer.wallet, chain, "all", buyer.block);
  const funding = rows
    .filter((row) => row.direction === "流入")
    .filter((row) => row.timestamp <= buyer.timestamp)
    .filter((row) => normalizeAddress(row.counterparty) !== normalizeAddress(pairAddress))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.timestamp - a.timestamp)[0] || null;
  return { ...buyer, funding: funding ? { ...funding, usdValue: fundingUsdValue(funding, chain) } : null };
}

function clusterEvidenceLabel(cluster) {
  if (cluster.kind === "funding") return "同源资金";
  if (cluster.kind === "gmgn") return "GMGN 标签候选（非群组）";
  return "同步买入候选（非群组）";
}

function isHardCluster(cluster) {
  return cluster?.kind === "funding";
}

function uniqueHolding(clusters) {
  const members = new Map();
  clusters.forEach((cluster) => cluster.members.forEach((member) => members.set(normalizeAddress(member.wallet), member)));
  return [...members.values()].reduce((sum, item) => sum + Number(item.position?.holdingPct || 0), 0);
}

function clusterMetrics(members) {
  return {
    holding: members.reduce((sum, item) => sum + Number(item.position?.holdingPct || 0), 0),
    pnl: members.reduce((sum, item) => sum + Number(item.position?.totalPnl || 0), 0),
  };
}

function buildClusters(buyers) {
  const clusters = [];
  const seen = new Set();
  const pushCluster = (kind, source, members, evidence) => {
    const uniqueMembers = [...new Map(members.map((member) => [normalizeAddress(member.wallet), member])).values()];
    if (uniqueMembers.length < 2) return;
    const key = `${kind}:${uniqueMembers.map((member) => normalizeAddress(member.wallet)).sort().join("|")}`;
    if (seen.has(key)) return;
    seen.add(key);
    const { holding, pnl } = clusterMetrics(uniqueMembers);
    clusters.push({ id: "", kind, source, members: uniqueMembers, holding, pnl, evidence });
  };

  const groups = new Map();
  buyers.forEach((buyer) => {
    const counterparty = String(buyer.funding?.counterparty || "");
    if (!isEvmAddress(counterparty) && !isSolanaAddress(counterparty)) return;
    if (buyer.funding.publicEntity) return;
    const source = normalizeAddress(counterparty);
    if (!groups.has(source)) groups.set(source, []);
    groups.get(source).push(buyer);
  });
  [...groups.entries()]
    .filter(([, members]) => members.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([source, members]) => {
      pushCluster("funding", source, members, `${members.length} 个早期买入地址由同一地址 ${fullText(source)} 提供主币或稳定币；来源依据：${[...new Set(members.map((item) => item.funding?.provider || item.fundingProvider || "Explorer"))].join("、")}。`);
    });

  const gmgnTagGroups = new Map();
  buyers.forEach((buyer) => {
    const tags = (buyer.gmgn?.tags || []).map((tag) => String(tag).toLowerCase());
    ["bundler", "sniper", "wash_trader", "top_holder"].forEach((tag) => {
      if (!tags.includes(tag)) return;
      if (!gmgnTagGroups.has(tag)) gmgnTagGroups.set(tag, []);
      gmgnTagGroups.get(tag).push(buyer);
    });
  });
  [...gmgnTagGroups.entries()].forEach(([tag, members]) => {
    pushCluster("gmgn", tag, members, `${members.length} 个早期地址同时带有 GMGN「${tag}」标签；仅为行为信号，不合并为捆绑群、不计入群组持仓，需搭配资金路径确认。`);
  });

  const timeGroups = new Map();
  buyers.forEach((buyer) => {
    const elapsed = Number(buyer.elapsed);
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 120) return;
    const bucket = Math.floor(elapsed / 2) * 2;
    if (!timeGroups.has(bucket)) timeGroups.set(bucket, []);
    timeGroups.get(bucket).push(buyer);
  });
  [...timeGroups.entries()]
    .filter(([, members]) => members.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 6)
    .forEach(([bucket, members]) => {
      pushCluster("timing", `开盘后 ${formatElapsed(bucket)}-${formatElapsed(bucket + 2)}`, members, `${members.length} 个早期地址集中在开盘后 ${formatElapsed(bucket)} 到 ${formatElapsed(bucket + 2)} 买入；仅为同步进场信号，不合并为捆绑群、不计入群组持仓。`);
    });

  const hard = clusters.filter(isHardCluster)
    .sort((a, b) => b.members.length - a.members.length || b.holding - a.holding)
    .map((cluster, index) => ({ ...cluster, id: index < 26 ? String.fromCharCode(65 + index) : `G${index + 1}` }));
  const signals = clusters.filter((cluster) => !isHardCluster(cluster))
    .sort((a, b) => b.members.length - a.members.length)
    .slice(0, 12)
    .map((cluster, index) => ({ ...cluster, id: `候选${index + 1}` }));
  return [...hard, ...signals];
}

function renderGmgnToken(report) {
  const gmgn = report.gmgn;
  const status = $("gmgn-status");
  const body = $("gmgn-wallet-body");
  if (!gmgn?.response?.ok) {
    if (status) status.textContent = gmgn?.error ? `未取得：${trimTerminalPunctuation(gmgn.error)}` : "未取得";
    ["gmgn-bundlers", "gmgn-snipers", "gmgn-insiders", "gmgn-smart", "gmgn-renowned"].forEach((id) => setText(id, "--"));
    if (body) body.innerHTML = '<tr><td colspan="7"><div class="table-empty">GMGN 没有成功回传；不使用替代地址或示例数据。</div></td></tr>';
    return;
  }
  const info = gmgn.info || {};
  const stat = info.stat || {};
  const walletStat = info.wallet_tags_stat || {};
  const security = gmgn.security || {};
  setText("gmgn-bundlers", `${walletStat.bundler_wallets ?? 0} 个 / ${formatPercent(gmgnPercent(stat.top_bundler_trader_percentage) || 0)}`);
  setText("gmgn-snipers", `${walletStat.sniper_wallets ?? security.sniper_count ?? 0} 个`);
  setText("gmgn-insiders", formatPercent(gmgnPercent(security.suspected_insider_hold_rate) || 0));
  setText("gmgn-smart", `${walletStat.smart_wallets ?? 0} 个`);
  setText("gmgn-renowned", `${walletStat.renowned_wallets ?? 0} 个`);
  if (status) status.textContent = gmgn.response.status === "complete" ? "GMGN 已完成" : `GMGN 部分成功（${Object.keys(gmgn.response.errors || {}).length} 项未取得）`;
  if (!body) return;
  const wallets = [...gmgn.wallets]
    .sort((a, b) => (b.totalPnl || 0) - (a.totalPnl || 0))
    .slice(0, 50);
  body.innerHTML = wallets.length ? wallets.map((wallet) => {
    const identity = [wallet.name, wallet.twitter ? `@${wallet.twitter.replace(/^@/, "")}` : ""].filter(Boolean).join(" / ") || "无公开身份";
    const identityHtml = wallet.twitter ? xProfileLink(wallet.twitter, identity) : `<strong>${escapeHtml(identity)}</strong>`;
    const tags = wallet.tags.length ? wallet.tags.slice(0, 5).map((tag) => dataTag(tag, "linked")).join(" ") : dataTag("无公开标签", "muted");
    const holding = Math.max(0, Math.min(Number(wallet.holdingPct || 0), 100));
    return `<tr>
      <td>${walletCell(wallet.wallet)}</td>
      <td><div class="gmgn-identity">${identityHtml}<span>${tags}</span></div></td>
      <td><div class="gmgn-holding"><strong>${formatPercent(wallet.holdingPct)}</strong><progress class="holding-meter" max="100" value="${holding}" aria-label="持仓 ${escapeHtml(formatPercent(wallet.holdingPct))}"></progress><small>${formatMoney(wallet.usdValue, report.chain, true)}</small></div></td>
      <td><strong>${formatMoney(wallet.buyMarketCap, report.chain, true)}</strong><small>累计买入 ${formatMoney(wallet.buyUsd, report.chain, true)}</small></td>
      <td><strong>${formatMoney(wallet.sellMarketCap, report.chain, true)}</strong><small>累计卖出 ${formatMoney(wallet.sellUsd, report.chain, true)}</small></td>
      <td class="${(wallet.totalPnl || 0) >= 0 ? "positive" : "negative"}">${formatMoney(wallet.totalPnl, report.chain)}</td>
      <td>${wallet.funding ? `${walletCell(wallet.funding.counterparty)}<small>GMGN 首笔主币入金</small>` : "GMGN 未回传"}</td>
    </tr>`;
  }).join("") : '<tr><td colspan="7"><div class="table-empty">GMGN 已查找，但持有人与交易者清单没有数据。</div></td></tr>';
}

function buyerClusterMap(clusters) {
  const map = new Map();
  clusters.filter(isHardCluster).forEach((cluster) => cluster.members.forEach((member) => map.set(normalizeAddress(member.wallet), cluster.id)));
  return map;
}

function highProfit(position) {
  return Boolean(position && (position.totalPnl >= 10000 || position.roi >= 250));
}

function marketToken(market, contract) {
  const target = normalizeAddress(contract);
  return normalizeAddress(market.baseToken?.address) === target ? market.baseToken : market.quoteToken;
}

function formatMoney(value, chain, compact = false) {
  const number = safeNumber(value);
  if (number === null) return "--";
  if (runtime.moneyMode === "usd") return formatUsd(number, compact);
  const symbol = CHAINS[chain]?.native || "主币";
  const price = runtime.nativePrices[symbol];
  if (!price) return `${formatUsd(number, compact)}（无 ${symbol} 实时价）`;
  return `${formatNumber(number / price, 4)} ${symbol}`;
}

function walletCell(address, chain = "") {
  const edit = address ? ` data-wallet-edit="${escapeHtml(address)}"${chain ? ` data-chain="${escapeHtml(chain)}"` : ""} role="button" tabindex="0" title="点一下：改标签、备注（存进钱包库）"` : "";
  return `<span class="focus-address"><code class="full-address"${edit}>${escapeHtml(address)}</code>${copyButton(address)}${address ? walletEditButton(address, chain) + walletStarButton(address, chain) : ""}</span>`;
}

function walletEditButton(address, chain = "") {
  return `<button class="copy-btn edit-btn" type="button" data-wallet-edit="${escapeHtml(address)}"${chain ? ` data-chain="${escapeHtml(chain)}"` : ""} aria-label="改标签、备注" title="改标签、备注（存进钱包库）">✎</button>`;
}

function walletStarButton(address, chain = "") {
  return `<button class="copy-btn star-btn" type="button" data-wallet-star="${escapeHtml(address)}"${chain ? ` data-chain="${escapeHtml(chain)}"` : ""} aria-pressed="false" aria-label="加入聪明钱追踪" title="加入聪明钱追踪（我的名单）">☆</button>`;
}

function plainAddressCell(address) {
  return `<span class="focus-address"><code class="full-address">${escapeHtml(address)}</code>${copyButton(address)}</span>`;
}

function copyButton(value) {
  return `<button class="copy-btn" type="button" data-copy="${escapeHtml(value)}" aria-label="拷贝完整地址" title="拷贝完整地址">⧉</button>`;
}

function xProfileLink(handle, label) {
  const username = String(handle || "").trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,30}$/.test(username)) return `<strong>${escapeHtml(label || username)}</strong>`;
  return `<a class="identity-link" href="https://x.com/${encodeURIComponent(username)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label || `@${username}`)}</a>`;
}

function dataTag(text, tone = "") {
  return `<span class="data-tag ${escapeHtml(tone)}">${escapeHtml(text)}</span>`;
}

function holdingCell(position, chain) {
  if (!position) return "--";
  const parts = [];
  if (position.holdingPct !== null) parts.push(`<strong>${formatPercent(position.holdingPct)}</strong>`);
  parts.push(`<small>持有 ${formatNumber(position.remainQty, 4)} ${escapeHtml(position.symbol)}</small>`);
  parts.push(`<small>已卖 ${formatNumber(position.sellQty, 4)} ${escapeHtml(position.symbol)}</small>`);
  if (position.valueUsd > 0) parts.push(`<small>现值 ${formatMoney(position.valueUsd, chain, true)}</small>`);
  return `<div class="holding-stack">${parts.join("")}</div>`;
}

function emptyTable(bodyId, colspan, message) {
  const body = $(bodyId);
  if (body) body.innerHTML = `<tr><td colspan="${colspan}"><div class="table-empty">${escapeHtml(message)}</div></td></tr>`;
}

function clearScanView() {
  ["cluster-hold", "early-count", "profit-count", "fresh-rate", "top50-share", "launch-time", "pool-name", "trace-basis"].forEach((id) => setText(id, "--"));
  setText("cluster-hold-note", "等待真实资金来源分群");
  setText("early-count-note", "等待链上首买纪录");
  setText("profit-count-note", "等待 Binance Web3 买卖汇总");
  setText("fresh-rate-note", "等待 Binance Web3 回传");
  setText("top50-share-note", "等待持仓供给量换算");
  emptyTable("early-body", 9, "尚无真实早期买入数据");
  emptyTable("top50-body", 7, "尚无真实前 50 数据");
  emptyTable("profit-body", 8, "尚无真实盈利数据");
  emptyTable("cluster-body", 6, "尚无同源资金群组");
  ["gmgn-bundlers", "gmgn-snipers", "gmgn-insiders", "gmgn-smart", "gmgn-renowned"].forEach((id) => setText(id, "--"));
  setText("gmgn-status", "等待查找");
  emptyTable("gmgn-wallet-body", 7, "完成 CA 查找后显示 GMGN 实际回传");
  if ($("wallet-map")) $("wallet-map").innerHTML = '<div class="empty-state">完成 CA 查找后显示真实资金来源与买入地址。</div>';
  if ($("path-summary")) $("path-summary").innerHTML = '<div class="empty-state">查找完成后，只显示有链上交易证据的资金路径。</div>';
  if ($("focus-summary")) $("focus-summary").innerHTML = '<div><span>状态</span><strong>尚无可追踪地址</strong></div>';
  if ($("focus-list")) $("focus-list").innerHTML = "";
  if ($("cluster-cards")) $("cluster-cards").innerHTML = '<div class="empty-state">同一来源至少资助两个早期买入地址，才会形成群组。</div>';
  if ($("export-report")) $("export-report").hidden = true;
}

function quietLaunchHint(report) {
  const { market, buyers, windowMinutes } = report;
  if ((buyers || []).length >= 15 || windowMinutes >= 360) return "";
  const launch = Math.floor(Number(market?.pairCreatedAt) / 1000);
  const starts = (report.gmgn?.wallets || []).filter((wallet) => !wallet.pool && wallet.startHoldingAt > launch)
    .map((wallet) => wallet.startHoldingAt - launch).sort((a, b) => a - b);
  const tenth = starts[9];
  return tenth && tenth > windowMinutes * 60
    ? `；这颗约开盘 ${Math.round(tenth / 60)} 分钟后才热起来（GMGN 样本第 10 人进场），改选「开盘后 6 小时」看那批人`
    : "；早期买家很少，可以改选「开盘后 6 小时」";
}

function renderScan(report) {
  const { market, contract, chain, early, buyers, clusters, windowMinutes } = report;
  const token = marketToken(market, contract);
  setText("launch-time", `${formatLocalTime(Number(market.pairCreatedAt))}`);
  setText("pool-name", `${market.baseToken?.symbol || "?"} / ${market.quoteToken?.symbol || "?"}`);
  setText("trace-basis", `${early.provider}${early.gmgnSample ? "" : "实际转帐"} + Binance Web3 + GMGN 唯读数据`);
  setText("early-count", early.discovered > 50 ? "50+" : String(buyers.length));
  setText("early-count-note", (early.gmgnSample
    ? `开盘后 ${windowMinutes} 分钟；RPC 未回溯到开盘，改列 GMGN 可得样本中的 ${buyers.length} 个早期候选`
    : `开盘后 ${windowMinutes} 分钟；${early.discovered} 个接收候选中排除合约后留下 ${buyers.length} 个钱包`) + quietLaunchHint(report));
  const highProfitWallets = new Set(buyers.filter((buyer) => highProfit(buyer.position)).map((buyer) => normalizeAddress(buyer.wallet)));
  (report.gmgn?.wallets || []).filter((wallet) => highProfit(gmgnPosition(wallet))).forEach((wallet) => highProfitWallets.add(normalizeAddress(wallet.wallet)));
  const profitCount = highProfitWallets.size;
  setText("profit-count", String(profitCount));
  setText("profit-count-note", "条件：估算 PnL >= $10,000 或估算 ROI >= 250%");
  const positionCoverage = buyers.filter((buyer) => buyer.position).length;
  setText("fresh-rate", buyers.length ? formatPercent((positionCoverage / buyers.length) * 100, 0) : "--");
  setText("fresh-rate-note", `${positionCoverage}/${buyers.length} 个地址有此代币活跃持仓数据`);
  const topHolding = buyers.reduce((sum, buyer) => sum + Number(buyer.position?.holdingPct || 0), 0);
  setText("top50-share", positionCoverage ? formatPercent(topHolding) : "--");
  setText("top50-share-note", positionCoverage ? `${positionCoverage}/${buyers.length} 个地址有 Binance Web3 活跃持仓数据` : "Binance Web3 未回传此代币活跃持仓");
  const clusteredHolding = uniqueHolding(clusters.filter(isHardCluster));
  setText("cluster-hold", clusters.some(isHardCluster) && positionCoverage ? formatPercent(clusteredHolding) : "--");
  const hardClusters = clusters.filter((cluster) => cluster.kind === "funding").length;
  const candidateClusters = clusters.length - hardClusters;
  setText("cluster-hold-note", clusters.length ? `${hardClusters} 组同源资金（持仓去重后合计）；另有 ${candidateClusters} 组 GMGN / 同步信号，未计入` : report.fundingStatus === "missing-key" ? "未查资金源：需要 Explorer Key" : report.fundingStatus === "unsupported" ? "Solana 资金源追查目前未接入，不创建推测群组" : report.fundingStatus === "partial" ? "Explorer / GMGN 部分成功，但未形成群组" : report.fundingStatus === "gmgn" ? "GMGN 已查，未发现至少两个地址共用首笔主币来源或同步候选" : "已查资金源，未发现同一来源资助至少两个早期地址");
  const fundingSourceStatus = fundingStatusText(report.fundingStatus);
  const gmgnStatus = report.gmgn?.response?.status === "complete" ? "GMGN 完成" : report.gmgn?.response?.ok ? "GMGN 部分成功" : "GMGN 未取得";
  setText("data-source-status", `${market.source || "DexScreener"} / ${early.provider} / Binance Web3 / ${gmgnStatus} / 资金源：${fundingSourceStatus}；${early.truncated ? "历史笔数已达安全上限" : "查找范围完整"}`);

  const clusterByWallet = buyerClusterMap(clusters);
  const earlyBody = $("early-body");
  if (earlyBody) {
    earlyBody.innerHTML = buyers.length ? buyers.map((buyer) => {
      const position = buyer.position;
      const source = buyer.funding ? `${walletCell(buyer.funding.counterparty)}${buyer.funding.sourceLabel ? `<small>GMGN 标注：${escapeHtml(buyer.funding.sourceLabel)}（公开实体出金，不列同源群组）</small>` : ""}` : buyer.fundingError ? `资金源 API 查找失败：${escapeHtml(buyer.fundingError)}` : ["missing-key", "unsupported"].includes(report.fundingStatus) ? fundingUnavailableText(report.fundingStatus) : "已查，无可验证关联";
      const tags = [];
      const group = clusterByWallet.get(normalizeAddress(buyer.wallet));
      if (group) tags.push(dataTag(`群组 ${group}`, "linked"));
      if (Number(buyer.elapsed) < 0) tags.push(dataTag("开盘前买入：侦测到的开盘时间可能不准", "candidate"));
      if (highProfit(position)) tags.push(dataTag("高盈利", "profit"));
      if (!position) tags.push(dataTag("持仓数据未取得", "muted"));
      return `<tr>
        <td>${buyer.rank}</td>
        <td>${walletCell(buyer.wallet)}</td>
        <td>${formatElapsed(buyer.elapsed)}</td>
        <td>${formatMoney(position?.buyUsd, chain)}</td>
        <td>${formatMoney(position?.buyMarketCap, chain, true)}</td>
        <td>${formatMoney(position?.sellMarketCap, chain, true)}</td>
        <td class="${position?.totalPnl >= 0 ? "positive" : "negative"}">${formatMoney(position?.totalPnl, chain)}</td>
        <td>${source}</td>
        <td>${tags.join(" ") || dataTag("早期买入", "muted")}</td>
      </tr>`;
    }).join("") : '<tr><td colspan="9">指定时间窗内没有辨识到买入地址。</td></tr>';
  }

  const top50Body = $("top50-body");
  if (top50Body) {
    top50Body.innerHTML = buyers.map((buyer) => {
      const group = clusterByWallet.get(normalizeAddress(buyer.wallet));
      const relation = buyer.funding
        ? `${walletCell(buyer.funding.counterparty)}${group ? ` ${dataTag(`群组 ${group}`, "linked")}` : ""}`
        : buyer.fundingError ? "资金源 API 查找失败" : ["missing-key", "unsupported"].includes(report.fundingStatus) ? fundingUnavailableText(report.fundingStatus) : "已查，无可验证关联";
      return `<tr>
        <td>${buyer.rank}</td><td>${walletCell(buyer.wallet)}</td><td>${formatElapsed(buyer.elapsed)}</td>
        <td>${formatMoney(buyer.position?.buyUsd, chain)}</td><td>${holdingCell(buyer.position, chain)}</td>
        <td>${buyer.position ? "Binance Web3 活跃持仓" : "未回传活跃持仓"}</td><td>${relation}</td>
      </tr>`;
    }).join("");
  }

  const profitMap = new Map();
  buyers.filter((buyer) => buyer.position).forEach((buyer) => profitMap.set(normalizeAddress(buyer.wallet), buyer));
  (report.gmgn?.wallets || []).forEach((wallet) => {
    const key = normalizeAddress(wallet.wallet);
    if (!profitMap.has(key)) profitMap.set(key, { wallet: wallet.wallet, position: gmgnPosition(wallet), gmgn: wallet });
  });
  const profits = [...profitMap.values()].filter((buyer) => highProfit(buyer.position)).sort((a, b) => (b.position.totalPnl || 0) - (a.position.totalPnl || 0));
  const profitBody = $("profit-body");
  if (profitBody) {
    profitBody.innerHTML = profits.length ? profits.map((buyer) => `<tr>
      <td>${walletCell(buyer.wallet)}</td>
      <td>${formatMoney(buyer.position.realizedPnl, chain)}</td>
      <td>${formatMoney(buyer.position.unrealizedPnl, chain)}</td>
      <td>${formatMoney(buyer.position.buyMarketCap, chain, true)}</td>
      <td>${formatMoney(buyer.position.sellMarketCap, chain, true)}</td>
      <td>${formatPercent(buyer.position.roi)}</td>
      <td>${holdingCell(buyer.position, chain)}</td>
      <td>${dataTag(buyer.position.provider === "GMGN" ? "GMGN PnL" : "Binance Web3 汇总估算", "muted")}</td>
    </tr>`).join("") : '<tr><td colspan="8">Binance Web3 与 GMGN 没有回传符合高盈利门槛的地址。</td></tr>';
  }

  renderClusters(report);
  renderNetwork(report);
  renderFocus(report);
  renderGmgnToken(report);
  if ($("export-report")) $("export-report").hidden = false;
  const fundingCoverage = report.fundingStatus === "complete"
    ? `${buyers.filter((buyer) => buyer.funding).length} 个找到首买前资金来源`
    : report.fundingStatus === "partial"
      ? `${buyers.filter((buyer) => buyer.funding?.provider?.includes("GMGN")).length} 个取得 GMGN 首笔主币来源；Explorer 对 ${buyers.filter((buyer) => buyer.fundingError).length} 个地址不可用`
      : report.fundingStatus === "gmgn" ? `${buyers.filter((buyer) => buyer.funding?.provider?.includes("GMGN")).length} 个取得 GMGN 首笔主币来源`
      : report.fundingStatus === "unsupported" ? "Solana 资金源目前未接入" : "资金源未查（缺 Explorer Key）";
  const coverage = `${buyers.length} 个早期地址；${positionCoverage} 个有持仓；${fundingCoverage}`;
  const earlyNotice = early.gmgnSample
    ? `${chain} 公开链上 RPC 未能完整回溯开盘，早期名单为 GMGN 可得样本，不宣称完整前 50。`
    : early.truncated ? "部分 Explorer/RPC 数据达查找上限，报表会保留此限制。" : "";
  setStatus("scan-status", `${chain} ${token?.symbol || "代币"} 查找完成：${coverage}。${earlyNotice}`, early.gmgnSample ? "warning" : "success");
}

function renderClusters(report) {
  const { clusters, chain } = report;
  const body = $("cluster-body");
  if (body) {
    body.innerHTML = clusters.length ? clusters.map((cluster) => `<tr>
      <td>${isHardCluster(cluster) ? "群组 " : ""}${cluster.id}</td><td>${cluster.members.length}</td><td>${escapeHtml(cluster.evidence)}</td>
      <td>${formatPercent(cluster.holding)}</td><td>${formatMoney(cluster.pnl, chain)}</td><td>${dataTag(clusterEvidenceLabel(cluster), cluster.kind === "funding" ? "linked" : "candidate")}</td>
    </tr>`).join("") : '<tr><td colspan="6">未发现同源资金、GMGN 捆绑标签或同步买入候选。</td></tr>';
  }
  const cards = $("cluster-cards");
  if (!cards) return;
  cards.innerHTML = clusters.length ? clusters.map((cluster) => `<article class="cluster-card">
    <header><h3>${isHardCluster(cluster) ? "群组 " : ""}${cluster.id}</h3>${dataTag(clusterEvidenceLabel(cluster), cluster.kind === "funding" ? "linked" : "candidate")}</header>
    <p>${escapeHtml(cluster.evidence)}</p>
    <dl><div><dt>地址数</dt><dd>${cluster.members.length}</dd></div><div><dt>估算持仓</dt><dd>${formatPercent(cluster.holding)}</dd></div><div><dt>估算 PnL</dt><dd>${formatMoney(cluster.pnl, chain)}</dd></div></dl>
    <button class="cluster-expand" type="button" data-cluster="${cluster.id}" aria-expanded="false">展开地址</button>
    <div class="cluster-detail" data-cluster-detail="${cluster.id}" hidden>
      <div class="cluster-detail-scroll compact-table"><table class="cluster-detail-table"><thead><tr><th>钱包</th><th>首买</th><th>累计买入</th><th>持仓</th><th>已卖</th><th>估算 PnL</th></tr></thead>
      <tbody>${cluster.members.map((member) => `<tr><td>${walletCell(member.wallet)}</td><td>${formatElapsed(member.elapsed)}</td><td>${formatMoney(member.position?.buyUsd, chain)}</td><td>${member.position ? `${formatNumber(member.position.remainQty, 4)} ${escapeHtml(member.position.symbol)} / ${formatPercent(member.position.holdingPct)}` : "--"}</td><td>${member.position ? `${formatNumber(member.position.sellQty, 4)} ${escapeHtml(member.position.symbol)}` : "--"}</td><td>${formatMoney(member.position?.totalPnl, chain)}</td></tr>`).join("")}</tbody></table></div>
    </div>
  </article>`).join("") : '<div class="empty-state">没有足够的同源资金、GMGN 标签或同步买入证据形成群组。</div>';
}

function renderNetwork(report) {
  const map = $("wallet-map");
  const paths = $("path-summary");
  if (!map || !paths) return;
  const hardGroups = report.clusters.filter(isHardCluster);
  const groups = hardGroups.length ? hardGroups : report.buyers.filter((buyer) => buyer.funding).slice(0, 4).map((buyer, index) => ({
    id: String(index + 1), kind: "funding", source: buyer.funding.counterparty, members: [buyer], holding: Number(buyer.position?.holdingPct || 0), pnl: Number(buyer.position?.totalPnl || 0), evidence: "单一可验证资金路径",
  }));
  if (!groups.length) {
    const message = report.fundingStatus === "missing-key" ? "尚未查资金源：填入 Explorer Key 后才能创建资金关联图。" : report.fundingStatus === "unsupported" ? "Solana 资金源追查目前未接入，因此不创建推测关联图。" : "已完成资金源查找，但没有足够证据创建共同来源连接。";
    map.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
    paths.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
    return;
  }
  map.innerHTML = `<div class="live-network">${groups.map((group) => `<div class="graph-group-row">
    <button class="live-node source-node" type="button" data-role="${escapeHtml(clusterEvidenceLabel(group))}" data-address="${escapeHtml(group.source)}" data-reason="${escapeHtml(group.evidence)}"><span>${escapeHtml(clusterEvidenceLabel(group))}</span><strong>${escapeHtml(fullText(group.source))}</strong><small>${group.members.length} 个早期地址</small></button>
    <span class="graph-arrow" aria-hidden="true">→</span>
    <div class="buyer-node-list">${group.members.map((buyer) => `<button class="live-node buyer-node ${highProfit(buyer.position) ? "profit-node" : ""}" type="button" data-role="早期买入地址" data-address="${escapeHtml(buyer.wallet)}" data-reason="首买 ${escapeHtml(formatElapsed(buyer.elapsed))}；${buyer.position ? `估算 PnL ${escapeHtml(formatMoney(buyer.position.totalPnl, report.chain))}` : "未取得活跃持仓"}"><strong>${escapeHtml(fullText(buyer.wallet))}</strong><small>${formatElapsed(buyer.elapsed)}${buyer.position?.holdingPct !== null && buyer.position ? ` / 持仓 ${formatPercent(buyer.position.holdingPct)}` : ""}</small></button>`).join("")}</div>
  </div>`).join("")}</div>`;
  paths.innerHTML = groups.map((group, index) => `<article><span>证据路径 ${index + 1}</span><strong>${escapeHtml(fullText(group.source))} → ${group.members.map((member) => fullText(member.wallet)).join("、")}</strong><small>${escapeHtml(group.evidence)} 完整地址与交易哈希可在表格及 XLSX 查看。</small></article>`).join("");
  map.querySelectorAll(".live-node").forEach((node) => node.addEventListener("click", () => updateGraphDetail(node.dataset)));
}

function updateGraphDetail(data) {
  const detail = $("graph-detail");
  if (!detail) return;
  detail.innerHTML = `<span>节点说明</span><h3>${escapeHtml(data.role || "地址")}</h3><p>${walletCell(data.address || "")}</p><dl><div><dt>证据</dt><dd>${escapeHtml(data.reason || "--")}</dd></div><div><dt>判读</dt><dd>只代表链上资金关联，不等于同一自然人。</dd></div><div><dt>下一步</dt><dd>查看完整交易哈希与上下游地址。</dd></div></dl>`;
}

function renderFocus(report) {
  const earliest = report.buyers[0];
  const best = report.buyers.filter((buyer) => buyer.position).sort((a, b) => b.position.totalPnl - a.position.totalPnl)[0];
  const source = report.clusters.find(isHardCluster)?.source || report.buyers.find((buyer) => buyer.funding)?.funding.counterparty;
  const summary = $("focus-summary");
  if (summary) {
    const items = [
      source ? ["主要同源资金", source] : null,
      earliest ? ["最早买入", earliest.wallet] : null,
      best ? ["最高估算盈利", best.wallet] : null,
    ].filter(Boolean);
    summary.innerHTML = items.length ? items.map(([label, address]) => `<div><span>${label}</span><strong>${walletCell(address)}</strong></div>`).join("") : '<div><span>状态</span><strong>没有可验证地址</strong></div>';
  }
  const list = $("focus-list");
  if (!list) return;
  const entries = [];
  const firstHard = report.clusters.find(isHardCluster);
  if (firstHard) entries.push(["同源资金群组", firstHard.source, firstHard.evidence, "查看该来源的所有转出与交易哈希"]);
  if (best) entries.push(["高盈利地址", best.wallet, `估算 PnL ${formatMoney(best.position.totalPnl, report.chain)}，ROI ${formatPercent(best.position.roi)}`, "估算来自 Binance Web3 汇总成本法，不当作税务损益"]);
  if (earliest) entries.push(["最早买入地址", earliest.wallet, `开盘后 ${formatElapsed(earliest.elapsed)} 首次收到池子转出的代币`, "确认交易是否为实际 swap，而非路由或内部转帐"]);
  list.innerHTML = entries.map(([label, address, reason, note]) => `<li><span>${escapeHtml(label)}</span><strong>${walletCell(address)}</strong><p>${escapeHtml(reason)}</p><small>${escapeHtml(note)}</small></li>`).join("");
}

async function runCaScan(event) {
  event?.preventDefault();
  const form = $("scan-form");
  if (!form || form.dataset.busy === "true") return;
  const contract = $("contract")?.value.trim() || "";
  const requestedChain = $("chain")?.value || "Auto";
  const windowMinutes = Number($("window")?.value || 60);
  if (contract.includes("...") || (!isEvmAddress(contract) && !isSolanaAddress(contract))) {
    setStatus("scan-status", "请粘贴完整 CA；缩写地址或格式不正确的地址不会送出查找。", "error");
    return;
  }
  if (requestedChain === "Solana" && !isSolanaAddress(contract)) return setStatus("scan-status", "此地址不是有效的 Solana CA。", "error");
  if (!["Auto", "Solana"].includes(requestedChain) && !isEvmAddress(contract)) return setStatus("scan-status", "此链需要完整 0x EVM CA。", "error");
  clearScanView();
  setText("gmgn-status", "查找中");
  emptyTable("gmgn-wallet-body", 6, "正在等待 GMGN 实际回传");
  form.dataset.busy = "true";
  form.querySelector('button[type="submit"]').disabled = true;
  document.body.classList.add("is-scanning");
  try {
    await refreshCredentialStatus().catch(() => undefined);
    setStatus("scan-status", "正在由 DexScreener 自动定位链与最大流动性池...");
    let market;
    let chain;
    let gmgn;
    let gmgnPromise;
    try {
      market = await fetchDexPairs(contract, requestedChain);
      chain = market.detectedChain;
      market.source = "DexScreener";
      gmgnPromise = fetchLocalGmgn("token", chain, contract)
        .then((response) => normalizeGmgnTokenResult(response, chain))
        .catch((error) => ({ response: { ok: false, status: "failed", errors: { proxy: error.message } }, info: {}, security: {}, wallets: [], error: error.message }));
    } catch (dexError) {
      chain = requestedChain === "Auto"
        ? isSolanaAddress(contract) ? "Solana" : await detectEvmContractChain(contract)
        : requestedChain;
      setStatus("scan-status", `DexScreener 没有交易池，正在用 GMGN 开盘平台数据确认 ${chain}...`);
      gmgn = await fetchLocalGmgn("token", chain, contract)
        .then((response) => normalizeGmgnTokenResult(response, chain))
        .catch((error) => ({ response: { ok: false, status: "failed", errors: { proxy: error.message } }, info: {}, security: {}, wallets: [], error: error.message }));
      if (!gmgn.response?.ok) throw new Error(`DexScreener：${dexError.message}；GMGN：${gmgn.error || "没有回传"}`);
      market = marketFromGmgn(gmgn, chain, contract);
      market.dexError = dexError.message;
    }
    $("chain").value = requestedChain === "Auto" ? "Auto" : chain;
    setText("launch-time", `${formatLocalTime(Number(market.pairCreatedAt))}`);
    setText("pool-name", `${market.baseToken?.symbol || "?"} / ${market.quoteToken?.symbol || "?"}`);
    setText("data-source-status", `${market.source} 已定位 ${chain} 开盘来源；正在读取历史交易与 GMGN`);
    let early;
    try {
      if (chain === "Solana") {
        early = await scanSolanaEarlyBuyers(market, contract, windowMinutes, (message) => setStatus("scan-status", message));
      } else {
        early = await scanEvmEarlyBuyers(market, contract, windowMinutes, (message) => setStatus("scan-status", message));
      }
    } catch (scanError) {
      gmgn = gmgn || await gmgnPromise;
      const gmgnFallback = gmgn?.response?.ok ? gmgnEarlyBuyerCandidates(gmgn, market, windowMinutes) : null;
      if (!gmgnFallback?.buyers.length) throw scanError;
      early = { ...gmgnFallback, fallbackReason: scanError.message };
      setStatus("scan-status", `公开链上回溯未完成，改列 GMGN 有交易时间证据的 ${early.buyers.length} 个早期候选...`);
    }
    setStatus("scan-status", "正在合并 GMGN 持有人、交易者、公开标签与共同入金来源...");
    gmgn = gmgn || await gmgnPromise;
    if (early.buyers.length === 0 && gmgn.response?.ok) {
      const gmgnFallback = gmgnEarlyBuyerCandidates(gmgn, market, windowMinutes);
      if (gmgnFallback.buyers.length) early = gmgnFallback;
    }
    let buyers = await enrichBuyerPositions(early.buyers, contract, chain, (message) => setStatus("scan-status", message));
    let fundingStatus = chain === "Solana" ? "unsupported" : "missing-key";
    if (chain !== "Solana" && explorerKey() && buyers.length) {
      let explorerFailure = "";
      try {
        await explorerRequest(chain, { module: "account", action: "txlist", address: buyers[0].wallet, page: 1, offset: 1, sort: "desc", startblock: 0, endblock: 99999999 });
      } catch (error) {
        explorerFailure = error.message;
      }
      if (explorerFailure) {
        buyers = buyers.map((buyer) => ({ ...buyer, funding: null, fundingError: explorerFailure }));
        fundingStatus = "partial";
      } else {
        buyers = await mapLimit(buyers, 3, async (buyer) => {
          try {
            return await findFundingSource(buyer, chain, market.pairAddress);
          } catch (error) {
            return { ...buyer, funding: null, fundingError: error.message };
          }
        }, (done, total) => setStatus("scan-status", `正在追查首买前主币与稳定币资金 ${done} / ${total}...`));
        fundingStatus = buyers.some((buyer) => buyer.fundingError) ? "partial" : "complete";
      }
    }
    buyers = buyers.map((buyer) => buyer.error ? { wallet: "", elapsed: 0, rank: 0, position: null, error: buyer.error } : buyer).filter((buyer) => buyer.wallet);
    buyers = mergeGmgnIntoBuyers(buyers, gmgn, chain);
    const clusters = buildClusters(buyers);
    if (gmgn.wallets.some((wallet) => wallet.funding) && ["missing-key", "unsupported"].includes(fundingStatus)) fundingStatus = "gmgn";
    runtime.scan = { market, contract, chain, windowMinutes, early, buyers, clusters, fundingStatus, gmgn, queriedAt: Date.now(), status: "complete" };
    renderScan(runtime.scan);
    notifyParent("partial", { section: "scan" });
    await syncWalletLibrary(runtime.scan);
  } catch (error) {
    setStatus("scan-status", `查找失败：${trimTerminalPunctuation(error.message)}。没有以范例数据代替。`, "error");
    setText("data-source-status", "查找失败；画面未产生推测数据");
  } finally {
    form.dataset.busy = "false";
    form.querySelector('button[type="submit"]').disabled = false;
    document.body.classList.remove("is-scanning");
  }
}

async function fetchNativePrices() {
  setText("price-status", "正在查 Binance 实时价...");
  try {
    const response = await fetchJson("/api/binance/prices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }, 20000);
    const prices = Object.fromEntries((response.prices || []).map((item) => [item.symbol.replace("USDT", ""), Number(item.price)]));
    if (!prices.ETH || !prices.BNB || !prices.SOL) throw new Error("回传价格不完整");
    runtime.nativePrices = { ...runtime.nativePrices, ...prices };
    runtime.priceSource = `Binance Spot ${formatLocalTime(Date.now())}`;
    setText("price-status", `Binance：ETH ${formatUsd(prices.ETH)} / BNB ${formatUsd(prices.BNB)} / SOL ${formatUsd(prices.SOL)}`);
    if (runtime.scan?.status === "complete") renderScan(runtime.scan);
    return prices;
  } catch (error) {
    setText("price-status", `实时价格失败：${error.message || "未知错误"}`);
    throw error;
  }
}

function xlsxXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xlsxColumnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function xlsxStyleIndex(type, value, row, column) {
  if (type === "center") return 3;
  if (type === "integer") return 4;
  if (type === "quantity") return 5;
  if (type === "usd") return 6;
  if (type === "priceUsd") return 7;
  if (type === "percent") return 8;
  if (type === "native") return 9;
  if (type === "datetime") return 10;
  if (type === "longText") return 11;
  if (type === "assetAmount") {
    const asset = String(row[column.assetIndex] || "").toUpperCase();
    if (["SOL", "ETH", "BNB"].includes(asset)) return 9;
    if (STABLE_SYMBOLS.has(asset)) return 4;
    return 5;
  }
  return 2;
}

function xlsxLocalSerial(timestampMs) {
  const timestamp = safeNumber(timestampMs);
  if (timestamp === null || timestamp <= 0) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestamp)).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return utc / 86400000 + 25569;
}

function xlsxCellXml(reference, value, type, styleIndex, row, column) {
  if (type === "datetime") {
    const serial = xlsxLocalSerial(value);
    return serial === null ? `<c r="${reference}" s="${styleIndex}"/>` : `<c r="${reference}" s="${styleIndex}"><v>${serial}</v></c>`;
  }
  if (type === "assetAmount" && !String(row[column.assetIndex] || "").trim()) {
    return `<c r="${reference}" s="${styleIndex}"/>`;
  }
  if (["integer", "quantity", "usd", "priceUsd", "percent", "native", "assetAmount"].includes(type)) {
    const number = safeNumber(value);
    return number === null ? `<c r="${reference}" s="${styleIndex}"/>` : `<c r="${reference}" s="${styleIndex}"><v>${number}</v></c>`;
  }
  const text = String(value ?? "");
  return `<c r="${reference}" s="${styleIndex}" t="inlineStr"><is><t xml:space="preserve">${xlsxXml(text)}</t></is></c>`;
}

function xlsxSheetXml(sheet) {
  const columns = sheet.columns;
  const lastColumn = xlsxColumnName(columns.length - 1);
  const lastRow = Math.max(1, sheet.rows.length + 1);
  const columnXml = columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width || 16}" customWidth="1"/>`).join("");
  const headerCells = columns.map((column, index) => {
    const reference = `${xlsxColumnName(index)}1`;
    return `<c r="${reference}" s="1" t="inlineStr"><is><t xml:space="preserve">${xlsxXml(column.header)}</t></is></c>`;
  }).join("");
  const dataRows = sheet.rows.map((row, rowIndex) => {
    const cells = columns.map((column, columnIndex) => {
      const reference = `${xlsxColumnName(columnIndex)}${rowIndex + 2}`;
      const styleIndex = xlsxStyleIndex(column.type, row[columnIndex], row, column);
      return xlsxCellXml(reference, row[columnIndex], column.type, styleIndex, row, column);
    }).join("");
    return `<row r="${rowIndex + 2}" ht="20" customHeight="1">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>${columnXml}</cols>
  <sheetData><row r="1" ht="30" customHeight="1">${headerCells}</row>${dataRows}</sheetData>
  <autoFilter ref="A1:${lastColumn}${lastRow}"/>
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
</worksheet>`;
}

function xlsxStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="5">
    <numFmt numFmtId="164" formatCode="#\,##0.000"/>
    <numFmt numFmtId="165" formatCode="&quot;$&quot;#\,##0;[Red]-&quot;$&quot;#\,##0"/>
    <numFmt numFmtId="166" formatCode="&quot;$&quot;0.00000000;[Red]-&quot;$&quot;0.00000000"/>
    <numFmt numFmtId="167" formatCode="0.00&quot;%&quot;"/>
    <numFmt numFmtId="168" formatCode="yyyy-mm-dd hh:mm:ss"/>
  </numFmts>
  <fonts count="2"><font><sz val="10"/><name val="Aptos"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Aptos"/><family val="2"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF176B5B"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border/><border><left/><right/><top/><bottom style="thin"><color rgb="FFD6E3DF"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="12">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="168" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

async function downloadXlsx(filename, sheets, title) {
  if (!globalThis.JSZip) throw new Error("XLSX 导出组件尚未加载，请刷新页面");
  const zip = new JSZip();
  const createdAt = new Date().toISOString();
  const sheetNames = sheets.map((sheet, index) => String(sheet.name || `工作表${index + 1}`).replace(/[\\/*?:\[\]]/g, "_").slice(0, 31));
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xlsxXml(title)}</dc:title><dc:creator>钱包侦查台</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified></cp:coreProperties>`);
  zip.file("docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>钱包侦查台</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>工作表</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheets.length}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${sheets.length}" baseType="lpstr">${sheetNames.map((name) => `<vt:lpstr>${xlsxXml(name)}</vt:lpstr>`).join("")}</vt:vector></TitlesOfParts><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.0</AppVersion></Properties>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="14000"/></bookViews><sheets>${sheetNames.map((name, index) => `<sheet name="${xlsxXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file("xl/styles.xml", xlsxStylesXml());
  sheets.forEach((sheet, index) => zip.file(`xl/worksheets/sheet${index + 1}.xml`, xlsxSheetXml(sheet)));
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  document.body.dataset.lastExport = filename;
  showToast(`已产生 ${filename}`);
}

function xlsxColumns(definitions) {
  return definitions.map(([header, type = "text", width = 16, assetIndex]) => ({ header, type, width, assetIndex }));
}

function queryStatusText(status) {
  if (status === "complete") return "完成";
  if (status === "partial") return "部分完成";
  if (status === "failed") return "失败";
  return status || "未取得";
}

function traceDirectionText(direction) {
  return { both: "源头 + 去向", upstream: "只看源头", downstream: "只看转出去向" }[direction] || direction;
}

function traceAssetModeText(assetMode) {
  return { all: "主币 + USD 稳定币", native: "只看主币", usd: "只看 USD 稳定币" }[assetMode] || assetMode;
}

function exportCaReport() {
  const report = runtime.scan;
  if (!report) return showToast("请先完成 CA 查找");
  const summary = [
    ["字段", "值"],
    ["CA", report.contract],
    ["链", report.chain],
    ["交易池", report.market?.pairAddress || ""],
    ["开盘时间", formatLocalTime(Number(report.market?.pairCreatedAt))],
    ["查找状态", queryStatusText(report.status)],
    ["数据源", report.status === "complete" ? `DexScreener / ${report.early.provider} / Binance Web3 / GMGN 本机唯读代理` : "DexScreener"],
    ["GMGN 状态", queryStatusText(report.gmgn?.response?.status)],
    ["GMGN 部分错误", Object.entries(report.gmgn?.response?.errors || {}).map(([key, value]) => `${key}: ${value}`).join(" | ")],
    ["查找限制", report.early?.truncated ? "达 API/RPC 安全上限，可能不完整" : "未达程序安全上限"],
    ["盈利公式", "已实现=卖出收入-按平均成本分摊的已卖成本；未实现=剩余数量×(现价-平均买价)"],
  ];
  const buyers = (report.buyers || []).map((buyer) => [
    buyer.rank, buyer.wallet, formatElapsed(buyer.elapsed), Number(buyer.timestamp || 0) * 1000, buyer.txHash, buyer.firstTokenAmount,
    buyer.position?.buyUsd, buyer.position?.sellUsd, buyer.position?.remainQty, buyer.position?.holdingPct,
    buyer.position?.realizedPnl, buyer.position?.unrealizedPnl, buyer.position?.totalPnl, buyer.position?.roi,
    buyer.funding?.counterparty || "无可验证关联", buyer.funding?.asset || "", buyer.funding?.amount || "", buyer.funding?.hash || "",
  ]);
  const clusters = (report.clusters || []).flatMap((cluster) => cluster.members.map((member) => [cluster.id, isHardCluster(cluster) ? cluster.source : `信号：${cluster.source}`, member.wallet, isHardCluster(cluster) ? cluster.holding : "", isHardCluster(cluster) ? cluster.pnl : "", cluster.evidence]));
  const gmgnWallets = (report.gmgn?.wallets || []).map((wallet) => [
    wallet.wallet, wallet.name, wallet.twitter, wallet.tags.join(" | "), wallet.holdingPct, wallet.balance,
    wallet.usdValue, wallet.buyUsd, wallet.sellUsd, wallet.realizedPnl, wallet.unrealizedPnl, wallet.totalPnl,
    wallet.roi, wallet.funding?.counterparty || "未回传", wallet.funding?.asset || "", wallet.funding?.amount || "", wallet.funding?.hash || "",
  ]);
  downloadXlsx(`CA侦查_${report.chain}_${report.contract.slice(0, 10)}.xlsx`, [
    { name: "摘要", columns: xlsxColumns([[summary.shift()[0], "text", 24], ["值", "longText", 82]]), rows: summary },
    { name: "早期地址", columns: xlsxColumns([["排名", "integer", 8], ["完整钱包", "text", 48], ["首买经过时间", "center", 16], ["首买时间", "datetime", 22], ["首买交易哈希", "text", 68], ["首笔代币量", "quantity", 18], ["累计买入USD", "usd", 16], ["累计卖出USD", "usd", 16], ["目前持仓量", "quantity", 18], ["持仓比例%", "percent", 14], ["估算已实现PnL", "usd", 18], ["估算未实现PnL", "usd", 18], ["估算总PnL", "usd", 16], ["估算ROI%", "percent", 14], ["首买前资金来源", "text", 48], ["资产", "center", 12], ["数量", "assetAmount", 16, 15], ["资金交易哈希", "text", 68]]), rows: buyers },
    { name: "同源群组", columns: xlsxColumns([["群组", "center", 12], ["完整资金来源", "text", 48], ["完整成员地址", "text", 48], ["群组持仓%", "percent", 14], ["群组估算PnL", "usd", 18], ["证据", "longText", 44]]), rows: clusters },
    { name: "GMGN重点地址", columns: xlsxColumns([["完整钱包", "text", 48], ["名称", "text", 22], ["Twitter", "text", 22], ["GMGN标签", "longText", 36], ["持仓%", "percent", 12], ["持仓量", "quantity", 18], ["持仓USD", "usd", 16], ["买入USD", "usd", 16], ["卖出USD", "usd", 16], ["已实现PnL", "usd", 16], ["未实现PnL", "usd", 16], ["总PnL", "usd", 16], ["ROI%", "percent", 12], ["首笔主币来源", "text", 48], ["来源资产", "center", 12], ["来源数量", "assetAmount", 16, 14], ["来源交易哈希", "text", 68]]), rows: gmgnWallets },
  ], "CA 钱包侦查报告").catch((error) => showToast(`导出失败：${error.message}`));
}

function solanaAccountKeys(transaction) {
  return (transaction?.transaction?.message?.accountKeys || []).map((item) => typeof item === "string" ? item : item.pubkey);
}

function parseSolanaTransfers(transaction, target, assetMode) {
  const rows = [];
  const keys = solanaAccountKeys(transaction);
  const instructions = [
    ...(transaction?.transaction?.message?.instructions || []),
    ...(transaction?.meta?.innerInstructions || []).flatMap((group) => group.instructions || []),
  ];
  instructions.forEach((instruction) => {
    const parsed = instruction?.parsed;
    if (!parsed?.info) return;
    if (parsed.type === "transfer" && instruction.program === "system") {
      const source = parsed.info.source;
      const destination = parsed.info.destination;
      if (source !== target && destination !== target) return;
      rows.push({ direction: source === target ? "转出" : "流入", counterparty: source === target ? destination : source, from: source, to: destination, asset: "SOL", amount: Number(parsed.info.lamports || 0) / 1e9 });
    }
  });
  if (assetMode !== "native") {
    const ownerByIndex = new Map();
    [...(transaction?.meta?.preTokenBalances || []), ...(transaction?.meta?.postTokenBalances || [])].forEach((balance) => {
      if (balance.owner) ownerByIndex.set(balance.accountIndex, { owner: balance.owner, mint: balance.mint });
    });
    instructions.forEach((instruction) => {
      const parsed = instruction?.parsed;
      if (!parsed?.info || !["transfer", "transferChecked"].includes(parsed.type) || instruction.program !== "spl-token") return;
      const sourceAccount = parsed.info.source;
      const destinationAccount = parsed.info.destination;
      const sourceIndex = keys.indexOf(sourceAccount);
      const destinationIndex = keys.indexOf(destinationAccount);
      const sourceInfo = ownerByIndex.get(sourceIndex);
      const destinationInfo = ownerByIndex.get(destinationIndex);
      const mint = parsed.info.mint || sourceInfo?.mint || destinationInfo?.mint;
      if (!CHAINS.Solana.stableMints.includes(mint)) return;
      const source = sourceInfo?.owner;
      const destination = destinationInfo?.owner;
      if (source !== target && destination !== target) return;
      const amount = Number(parsed.info.tokenAmount?.uiAmountString || parsed.info.amount || 0);
      rows.push({ direction: source === target ? "转出" : "流入", counterparty: source === target ? destination : source, from: source, to: destination, asset: mint === CHAINS.Solana.stableMints[0] ? "USDC" : "USDT", amount });
    });
  }
  return rows;
}

async function fetchSolanaWalletTransfers(address, assetMode = "all", signatureLimit = 60) {
  const signatures = await solanaRpcRequest("getSignaturesForAddress", [address, { limit: signatureLimit }]);
  const rows = [];
  for (let index = 0; index < signatures.length; index += 20) {
    const chunk = signatures.slice(index, index + 20);
    const transactions = await solanaRpcBatch(chunk.map((item) => ({ method: "getTransaction", params: [item.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }] })));
    transactions.forEach((transaction, offset) => {
      if (!transaction) return;
      parseSolanaTransfers(transaction, address, assetMode).forEach((row) => rows.push({
        ...row,
        hash: chunk[offset].signature,
        timestamp: Number(transaction.blockTime || 0),
        block: Number(transaction.slot || 0),
        provider: "Solana Mainnet RPC",
      }));
    });
  }
  return rows.sort((a, b) => b.timestamp - a.timestamp);
}

async function detectWalletChain(address, requested) {
  if (requested !== "Auto") return requested;
  if (isSolanaAddress(address)) return "Solana";
  if (!isEvmAddress(address)) throw new Error("钱包地址格式不正确");
  const candidates = ["BSC", "ETH", "Base"];
  const probes = await Promise.allSettled(candidates.map((chain) => fetchBinancePositions(address, chain)));
  const scores = probes.map((probe, index) => ({
    chain: candidates[index],
    score: probe.status === "fulfilled" ? probe.value.positions.reduce((sum, item) => sum + item.valueUsd, 0) + probe.value.total : -1,
  })).sort((a, b) => b.score - a.score);
  if (scores[0].score > 0) return scores[0].chain;
  if (explorerKey()) {
    const explorerProbes = await Promise.allSettled(candidates.map((chain) => explorerRequest(chain, { module: "account", action: "txlist", address, page: 1, offset: 1, sort: "desc", startblock: 0, endblock: 99999999 })));
    const found = explorerProbes.findIndex((probe) => probe.status === "fulfilled" && probe.value.rows.length);
    if (found >= 0) return candidates[found];
  }
  throw new Error("无法可靠自动判断此 EVM 地址在哪条链有活动，请手动选链后再查。");
}

function transferKey(row) {
  return `${row.hash}:${row.from}:${row.to}:${row.asset}:${row.amount}`;
}

async function traceEvmGraph(address, chain, direction, assetMode, onStatus) {
  const maxNodes = 30;
  const maxDepth = 8;
  const queue = [{ address, depth: 0 }];
  const visited = new Set();
  const transfers = new Map();
  const errors = [];
  let hitLimit = false;
  while (queue.length && visited.size < maxNodes) {
    const current = queue.shift();
    const normalized = normalizeAddress(current.address);
    if (visited.has(normalized)) continue;
    visited.add(normalized);
    onStatus(`正在自动追溯第 ${current.depth + 1} 层；已检查 ${visited.size}/${maxNodes} 个地址...`);
    let rows;
    try {
      rows = await fetchEvmWalletTransfers(current.address, chain, assetMode);
    } catch (error) {
      if (current.depth === 0) throw error;
      errors.push({ address: current.address, message: error.message });
      continue;
    }
    const filtered = rows.filter((row) => direction === "both" || (direction === "upstream" ? row.direction === "流入" : row.direction === "转出"));
    filtered.forEach((row) => transfers.set(transferKey(row), { ...row, depth: current.depth, queriedAddress: current.address }));
    if (current.depth >= maxDepth) continue;
    const neighbors = [];
    filtered.forEach((row) => {
      const counterparty = normalizeAddress(row.counterparty);
      if (!isEvmAddress(counterparty) || visited.has(counterparty)) return;
      if (!neighbors.includes(counterparty)) neighbors.push(counterparty);
    });
    neighbors.slice(0, 6).forEach((neighbor) => queue.push({ address: neighbor, depth: current.depth + 1 }));
  }
  if (queue.length) hitLimit = true;
  return { transfers: [...transfers.values()].sort((a, b) => b.timestamp - a.timestamp), visited: [...visited], hitLimit, maxNodes, maxDepth, errors, provider: "Explorer API" };
}

async function traceSolanaGraph(address, direction, assetMode, onStatus) {
  const maxNodes = 10;
  const queue = [{ address, depth: 0 }];
  const visited = new Set();
  const transfers = new Map();
  while (queue.length && visited.size < maxNodes) {
    const current = queue.shift();
    if (visited.has(current.address)) continue;
    visited.add(current.address);
    onStatus(`正在读取 Solana 最近交易；已检查 ${visited.size}/${maxNodes} 个地址...`);
    const rows = await fetchSolanaWalletTransfers(current.address, assetMode, current.depth === 0 ? 60 : 12);
    const filtered = rows.filter((row) => direction === "both" || (direction === "upstream" ? row.direction === "流入" : row.direction === "转出"));
    filtered.forEach((row) => transfers.set(transferKey(row), { ...row, depth: current.depth, queriedAddress: current.address }));
    filtered.slice(0, 4).forEach((row) => {
      if (isSolanaAddress(row.counterparty) && !visited.has(row.counterparty)) queue.push({ address: row.counterparty, depth: current.depth + 1 });
    });
  }
  return { transfers: [...transfers.values()].sort((a, b) => b.timestamp - a.timestamp), visited: [...visited], hitLimit: queue.length > 0, maxNodes, maxDepth: null, provider: "Solana Mainnet RPC" };
}

function explorerTxLink(chain, hash) {
  const config = CHAINS[chain];
  if (!config || !hash) return "#";
  return chain === "Solana" ? `${config.explorerUrl}/tx/${hash}` : `${config.explorerUrl}/tx/${hash}`;
}

function relayExplorerTxLink(endpoint) {
  if (!endpoint?.txHash) return "#";
  return explorerTxLink(endpoint.chain, endpoint.txHash);
}

function relayTimestamp(record) {
  const candidate = record?.updatedAt || record?.createdAt || record?.destination?.timestamp || record?.origin?.timestamp;
  const numeric = safeNumber(candidate);
  if (numeric !== null) return numeric > 1e12 ? numeric : numeric * 1000;
  const parsed = Date.parse(String(candidate || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

const HIDDEN_HOLDING_TAG = ' <span class="tag" title="GMGN 预设把这笔当成空投／转入藏起来；这里只补数量和现值，GMGN 没有真成本所以不算盈亏">转入</span>';

function normalizeGmgnWalletResult(response) {
  const data = response?.data || {};
  const statsEnvelope = data.stats?.data || data.stats || {};
  const stats = statsEnvelope.stats || statsEnvelope;
  const common = statsEnvelope.common || stats.common || {};
  const holdings = gmgnList(data.holdings).map((row) => ({
    address: row.token?.address || row.token?.token_address || row.address || "",
    symbol: row.token?.symbol || row.symbol || "?",
    name: row.token?.name || row.name || "",
    balance: safeNumber(row.balance),
    usdValue: safeNumber(row.usd_value),
    cost: safeNumber(row.cost) ?? safeNumber(row.total_cost) ?? safeNumber(row.accu_cost),
    realizedPnl: safeNumber(row.realized_profit),
    unrealizedPnl: safeNumber(row.unrealized_profit),
    totalPnl: safeNumber(row.total_profit) ?? safeNumber(row.profit),
    roi: gmgnPercent(row.profit_change ?? row.total_profit_pnl),
    boughtCost: safeNumber(row.history_bought_cost),
    soldIncome: safeNumber(row.history_sold_income),
    lastActiveAt: safeNumber(row.last_active_timestamp),
  }));
  for (const row of gmgnList(data.holdingsHidden)) {
    holdings.push({
      address: row.token?.address || row.token?.token_address || row.address || "",
      symbol: row.token?.symbol || row.symbol || "?",
      name: row.token?.name || row.name || "",
      balance: safeNumber(row.balance),
      usdValue: safeNumber(row.usd_value),
      cost: null, realizedPnl: null, unrealizedPnl: null, totalPnl: null, roi: null,
      boughtCost: null, soldIncome: null,
      lastActiveAt: safeNumber(row.last_active_timestamp),
      hidden: true,
    });
  }
  const activities = gmgnList(data.activity).map((row) => ({
    hash: row.transaction_hash || row.tx_hash || row.hash || "",
    type: row.event_type || row.type || "",
    address: row.token?.address || row.token?.token_address || row.token_address || "",
    symbol: row.token?.symbol || row.symbol || "?",
    amount: safeNumber(row.token_amount) ?? safeNumber(row.amount),
    costUsd: safeNumber(row.cost_usd),
    priceUsd: safeNumber(row.price_usd),
    timestamp: safeNumber(row.timestamp),
  }));
  const createdEnvelope = data.createdTokens?.data || data.createdTokens || {};
  return { response, stats, common, holdings, activities, created: createdEnvelope };
}

function gmgnIdentityRecord(address, gmgn, error = "") {
  const common = gmgn?.common || {};
  const tags = [...new Set([
    ...(Array.isArray(common.tags) ? common.tags : []),
    ...(Array.isArray(common.wallet_tag_v2) ? common.wallet_tag_v2 : []),
    common.tag,
  ].filter(Boolean).map(String))];
  return {
    address: normalizeAddress(address),
    ok: Boolean(gmgn?.response?.ok),
    status: gmgn?.response?.status || "failed",
    name: common.name || common.twitter_name || common.twitter_username || common.ens || "",
    twitter: common.twitter_username || "",
    tags,
    fundingLabel: common.fund_from || "",
    fundingAddress: common.fund_from_address || "",
    error: error || gmgn?.error || "",
  };
}

async function fetchTraceGmgnIdentities(graph, chain, rootAddress, rootGmgn, relay, onStatus) {
  const root = normalizeAddress(rootAddress);
  const candidateMap = new Map();
  (graph.visited || []).map(normalizeAddress).filter((address) => (
    chain === "Solana" ? isSolanaAddress(address) : isEvmAddress(address)
  )).forEach((address) => candidateMap.set(address, { address, chain }));
  (relay?.counterparts || []).forEach((counterpart) => {
    const candidateAddress = normalizeAddress(counterpart.address);
    if ((isEvmAddress(candidateAddress) || isSolanaAddress(candidateAddress)) && GMGN_CHAIN_IDS[counterpart.chain]) {
      candidateMap.set(candidateAddress, { address: candidateAddress, chain: counterpart.chain });
    }
  });
  candidateMap.set(root, { address: root, chain });
  const candidates = [...candidateMap.values()];
  let completed = 0;
  return mapWithConcurrency(candidates, 2, async (candidate) => {
    if (candidate.address === root) {
      completed += 1;
      onStatus(`正在用 GMGN 确认关联地址公开标签 ${completed}/${candidates.length}...`);
      return { ...gmgnIdentityRecord(candidate.address, rootGmgn), chain: candidate.chain };
    }
    try {
      const response = await fetchLocalGmgn("identity", candidate.chain, candidate.address);
      const gmgn = normalizeGmgnWalletResult(response);
      completed += 1;
      onStatus(`正在用 GMGN 确认关联地址公开标签 ${completed}/${candidates.length}...`);
      return { ...gmgnIdentityRecord(candidate.address, gmgn), chain: candidate.chain };
    } catch (error) {
      completed += 1;
      onStatus(`正在用 GMGN 确认关联地址公开标签 ${completed}/${candidates.length}...`);
      return { ...gmgnIdentityRecord(candidate.address, null, trimTerminalPunctuation(error.message)), chain: candidate.chain };
    }
  });
}

function traceCoverage(graph) {
  const provider = String(graph?.provider || "未查找");
  if (provider.includes("GMGN 首笔主币入金")) {
    return {
      level: "partial",
      label: "部分链上纪录",
      detail: "只取得 GMGN 回传的首笔主币入金；不能视为完整转入、转出历史。",
    };
  }
  if (provider.startsWith("未查找") || provider.startsWith("查找失败")) {
    return {
      level: "identity-only",
      label: "仅持仓与标签",
      detail: "没有取得地址流水；Binance Web3 与 GMGN 结果只用于持仓、绩效和公开身分确认。",
    };
  }
  if (provider.includes("Solana Mainnet RPC")) {
    return {
      level: "partial",
      label: "限定范围链上纪录",
      detail: "Solana 仅读取目标地址最近 60 笔、关联地址最近 12 笔签章，不宣称涵盖完整历史。",
    };
  }
  return {
    level: "partial",
    label: "限定范围链上纪录",
    detail: `每个地址最多读取 Explorer 最近 200 笔符合条件的纪录${graph?.hitLimit ? "，且已达地址安全上限" : ""}${graph?.errors?.length ? `；${graph.errors.length} 个地址查找失败` : ""}。`,
  };
}

function traceIdentityEvidence(result, address) {
  const target = normalizeAddress(result.address);
  const normalized = normalizeAddress(address);
  if (normalized === target) return { relation: "目标钱包", count: 0, depth: 0 };
  const matching = result.graph.transfers.filter((row) => (
    normalizeAddress(row.from) === normalized || normalizeAddress(row.to) === normalized
  ));
  const directIncoming = matching.some((row) => normalizeAddress(row.from) === normalized && normalizeAddress(row.to) === target);
  const directOutgoing = matching.some((row) => normalizeAddress(row.from) === target && normalizeAddress(row.to) === normalized);
  const depth = matching.length ? Math.min(...matching.map((row) => Number(row.depth || 0))) + 1 : null;
  const relayMatch = (result.relay?.counterparts || []).find((row) => normalizeAddress(row.address) === normalized);
  if (relayMatch) {
    const relayRelation = relayMatch.incomingCount && relayMatch.outgoingCount
      ? "Relay 跨链双向往来"
      : relayMatch.incomingCount
        ? "Relay 跨链资金来源"
        : "Relay 跨链转出去向";
    return { relation: relayRelation, count: relayMatch.count, depth: 1, relay: true };
  }
  const relation = directIncoming && directOutgoing
    ? "直接双向往来"
    : directIncoming
      ? "直接资金来源"
      : directOutgoing
        ? "直接转出去向"
        : depth
          ? `第 ${depth} 层关联`
          : "已追查地址";
  return { relation, count: matching.length, depth };
}

function relayTraceSection(result) {
  const relay = result.relay;
  if (!relay?.ok) {
    return `<section class="trace-section"><h3>Relay 跨链资金证据</h3><div class="trace-empty-card"><strong>Relay 未取得数据</strong><span>${escapeHtml(relay?.error || "查找未回传可用结果")}。其他链上结果仍保留。</span></div></section>`;
  }
  if (!relay.records?.length) {
    return '<section class="trace-section"><h3>Relay 跨链资金证据</h3><div class="trace-empty-card"><strong>没有 Relay 跨链纪录</strong><span>这只代表没有查到经 Relay 路由的交易，不代表地址没有使用其他跨链桥。</span></div></section>';
  }
  const totalUsd = (relay.counterparts || []).reduce((sum, row) => sum + (safeNumber(row.totalUsd) || 0), 0);
  const chains = [...new Set(relay.records.flatMap((row) => [row.origin?.chain, row.destination?.chain]).filter(Boolean))];
  const visible = relay.records.slice(0, 100);
  const rows = visible.map((row) => {
    const originLink = relayExplorerTxLink(row.origin);
    const destinationLink = relayExplorerTxLink(row.destination);
    return `<tr>
      <td data-label="时间">${formatLocalTime(relayTimestamp(row))}</td>
      <td data-label="方向"><strong>${escapeHtml(row.direction)}</strong><small>${escapeHtml(row.origin?.chain || "?")} → ${escapeHtml(row.destination?.chain || "?")}</small></td>
      <td data-label="跨链对手">${walletCell(row.counterpart)}</td>
      <td data-label="输入">${escapeHtml(row.origin?.symbol || "--")} ${formatNumber(row.origin?.amount, 6)}<small>${formatUsd(row.origin?.amountUsd)}</small></td>
      <td data-label="输出">${escapeHtml(row.destination?.symbol || "--")} ${formatNumber(row.destination?.amount, 6)}<small>${formatUsd(row.destination?.amountUsd)}</small></td>
      <td data-label="来源交易">${row.origin?.txHash ? `<a href="${escapeHtml(originLink)}" target="_blank" rel="noreferrer">${escapeHtml(shortAddress(row.origin.txHash))}</a>` : "--"}</td>
      <td data-label="目的交易">${row.destination?.txHash ? `<a href="${escapeHtml(destinationLink)}" target="_blank" rel="noreferrer">${escapeHtml(shortAddress(row.destination.txHash))}</a>` : "--"}</td>
      <td data-label="Relay ID"><a href="https://relay.link/transactions?address=${encodeURIComponent(result.address)}" target="_blank" rel="noreferrer">${escapeHtml(shortAddress(row.requestId))}</a></td>
    </tr>`;
  }).join("");
  return `<section class="trace-section"><h3>Relay 跨链资金证据</h3>
    <div class="relay-summary">
      <div><span>跨链纪录</span><strong>${relay.total}</strong></div>
      <div><span>直接对手地址</span><strong>${relay.counterparts.length}</strong></div>
      <div><span>目的端金额合计</span><strong>${formatUsd(totalUsd)}</strong></div>
      <div><span>涉及链</span><strong>${escapeHtml(chains.join(" / "))}</strong></div>
    </div>
    <div class="compact-table trace-mobile-cards"><table><thead><tr><th>时间</th><th>方向 / 路径</th><th>跨链对手</th><th>输入</th><th>输出</th><th>来源交易</th><th>目的交易</th><th>Relay ID</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${relay.records.length > visible.length ? `<p class="trace-data-note">画面显示最新 ${visible.length} 笔；完整 ${relay.records.length} 笔保留在 XLSX。</p>` : ""}
    <p class="trace-data-note">只把 Relay request 的 user 与 recipient 视为跨链端点；Relay 合约、solver 与存款地址不会被标成主人。重复双向往来是高可信营运关联，但仍不等于已证明同一自然人。</p>
  </section>`;
}

function gmgnTraceIdentitiesSection(result) {
  const identities = result.identities || [];
  if (!identities.length) return `<section class="trace-section"><h3>往来地址的公开标签</h3><div class="trace-empty-card"><strong>尚未取得关联地址标签</strong><span>链上纪录与公开标签是分开的数据层，不会自行猜测地址主人。</span></div></section>`;
  const rows = identities.map((identity) => {
    const evidence = traceIdentityEvidence(result, identity.address);
    const known = KNOWN_LABELS[normalizeAddress(identity.address)];
    const name = known?.name || identity.name || "无公开名称";
    const twitterHandle = identity.twitter || known?.twitter || "";
    const twitter = twitterHandle ? `@${String(twitterHandle).replace(/^@/, "")}` : "";
    const tags = [...new Set([known?.type, ...identity.tags].filter(Boolean))];
    const status = identity.ok ? (identity.status === "complete" ? "已确认" : "部分回传") : "未取得";
    return `<tr>
      <td data-label="地址">${walletCell(identity.address)}</td>
      <td data-label="链">${escapeHtml(identity.chain || result.chain)}</td>
      <td data-label="资金关系"><strong>${escapeHtml(evidence.relation)}</strong><small>${evidence.count ? `${evidence.count} 笔链上证据` : "目标地址"}</small></td>
      <td data-label="公开名称">${twitterHandle ? xProfileLink(twitterHandle, name) : `<strong>${escapeHtml(name)}</strong>`}${twitter ? `<small>${xProfileLink(twitterHandle, twitter)}</small>` : ""}</td>
      <td data-label="标签">${tags.length ? tags.slice(0, 6).map((tag) => dataTag(tag, "muted")).join(" ") : "GMGN 无公开标签"}</td>
      <td data-label="首笔来源">${identity.fundingAddress ? `${walletCell(identity.fundingAddress)}<small>${escapeHtml(identity.fundingLabel || "GMGN 首笔资金来源")}</small>` : "未回传"}</td>
      <td data-label="查找状态">${escapeHtml(status)}${identity.error ? `<small>${escapeHtml(identity.error)}</small>` : ""}</td>
    </tr>`;
  }).join("");
  return `<section class="trace-section"><h3>往来地址的公开标签</h3><div class="compact-table trace-mobile-cards"><table><thead><tr><th>地址</th><th>链</th><th>资金关系</th><th>公开名称</th><th>GMGN／公开标签</th><th>GMGN 首笔来源</th><th>查找状态</th></tr></thead><tbody>${rows}</tbody></table></div><p class="trace-data-note">GMGN 标签只用来确认公开身分；小号与同一主人仍须有主币、稳定币或 Relay 跨链端点证据，不能只靠标签合并。</p></section>`;
}

function gmgnIdentityHtml(result, label) {
  const gmgn = result.gmgn;
  const common = gmgn?.common || {};
  const gmgnName = common.name || common.twitter_name || common.twitter_username || common.ens || "";
  const gmgnTags = gmgnTagsShown([...new Set([
    ...(Array.isArray(common.tags) ? common.tags : []),
    common.tag,
  ].filter(Boolean).map(String))]);
  const cards = [];
  if (label) cards.push(`<article class="owner-card"><header><span>${escapeHtml(label.type)}</span><i class="trace-confidence high">${escapeHtml(label.confidence)}</i></header><strong>${escapeHtml(label.name)}</strong><div class="owner-name">${walletCell(result.address)}</div><div class="owner-tags"><i>已核对公开标签</i><i>不等于其他小号</i></div><p>来源：${escapeHtml(label.provenance)}。只确认此地址身份，不把没有资金证据的地址硬并成关联。</p></article>`);
  if (gmgnName || gmgnTags.length || common.fund_from || common.fund_from_address) {
    const twitter = common.twitter_username ? `@${String(common.twitter_username).replace(/^@/, "")}` : "";
    cards.push(`<article class="owner-card"><header><span>GMGN 公开钱包数据</span><i class="trace-confidence ${gmgn.response.status === "complete" ? "high" : "medium"}">${gmgn.response.status === "complete" ? "已回传" : "部分回传"}</i></header>${common.twitter_username ? xProfileLink(common.twitter_username, gmgnName || twitter) : `<strong>${escapeHtml(gmgnName || "未提供名称")}</strong>`}<div class="owner-name">${twitter ? xProfileLink(common.twitter_username, twitter) : walletCell(result.address)}</div>${gmgnTags.length ? `<div class="owner-tags">${gmgnTags.slice(0, 8).map((tag) => `<i>${escapeHtml(tag)}</i>`).join("")}</div>` : ""}<p>资金标签：${escapeHtml(common.fund_from || "未提供")}；来源地址：${common.fund_from_address ? walletCell(common.fund_from_address) : "未提供"}。GMGN 身份标签不单独作为小号关联证据。</p></article>`);
  }
  if (cards.length) return `<div class="owner-grid">${cards.join("")}</div>`;
  const detail = gmgn?.response?.ok ? "GMGN 已查找，但没有回传名称、KOL 或主钱包标签。" : `GMGN 未取得${gmgn?.error ? `：${escapeHtml(trimTerminalPunctuation(gmgn.error))}` : ""}。`;
  return `<div class="trace-empty-card"><strong>没有命中可验证公开标签</strong><span>${detail} 不会用随机名称或其他钱包数据代替。</span></div>`;
}

function gmgnWalletSections(result) {
  const gmgn = result.gmgn;
  if (!gmgn?.response?.ok) return `<section class="trace-section"><h3>GMGN 钱包数据</h3><div class="trace-empty-card"><strong>GMGN 未取得数据</strong><span>${escapeHtml(gmgn?.error || "本机 GMGN 代理未回传可用结果")}；没有以示例数据补位。</span></div></section>`;
  const stats = gmgn.stats || {};
  const activities = gmgn.activities.filter((row) => positionMatchesAssetMode(row, result.chain, result.assetMode));
  const visibleHoldings = gmgn.holdings.slice(0, 12);
  const createdCount = safeNumber(gmgn.common?.created_token_count) ?? safeNumber(gmgn.created?.inner_count) ?? 0;
  const statusText = gmgn.response.status === "complete" ? "全部完成" : `部分成功；${Object.keys(gmgn.response.errors || {}).length} 项未取得`;
  return `<section class="trace-section"><h3>GMGN 30 日钱包统计</h3><div class="gmgn-trace-metrics">
    <div><span>查找状态</span><strong>${escapeHtml(statusText)}</strong></div>
    <div><span>已实现盈利</span><strong>${formatUsd(stats.realized_profit)}</strong></div>
    <div><span>未实现盈利</span><strong>${formatUsd(stats.unrealized_profit)}</strong></div>
    <div><span>胜率</span><strong>${formatPercent(gmgnPercent(stats.winrate ?? stats.pnl_stat?.winrate))}</strong></div>
    <div><span>买 / 卖次数</span><strong>${formatNumber(stats.buy_count ?? stats.buy, 0)} / ${formatNumber(stats.sell_count ?? stats.sell, 0)}</strong></div>
    <div><span>创建代币</span><strong>${formatNumber(createdCount, 0)}</strong></div>
  </div></section>
  <section class="trace-section"><h3>GMGN 钱包绩效摘要</h3>${visibleHoldings.length ? `<div class="compact-table trace-mobile-cards"><table><thead><tr><th>代币</th><th>持有</th><th>现值</th><th>买入成本</th><th>卖出收入</th><th>总盈利</th><th>ROI</th></tr></thead><tbody>${visibleHoldings.map((row) => `<tr><td data-label="代币"><strong>${escapeHtml(row.symbol)}</strong>${row.hidden ? HIDDEN_HOLDING_TAG : ""}<small>${escapeHtml(row.name)}</small></td><td data-label="持有">${formatNumber(row.balance, 5)}</td><td data-label="现值">${formatUsd(row.usdValue)}</td><td data-label="买入成本">${row.hidden ? "--" : formatUsd(row.boughtCost ?? row.cost)}</td><td data-label="卖出收入">${row.hidden ? "--" : formatUsd(row.soldIncome)}</td><td data-label="总盈利" class="${row.hidden ? "" : (row.totalPnl || 0) >= 0 ? "positive" : "negative"}">${row.hidden ? "--" : formatUsd(row.totalPnl)}</td><td data-label="ROI">${row.hidden ? "--" : formatPercent(row.roi)}</td></tr>`).join("")}</tbody></table></div><p class="trace-data-note">画面显示 GMGN 排序前 ${visibleHoldings.length} 笔；完整 ${gmgn.holdings.length} 笔保留在 XLSX。代币持仓只用于绩效参考，不作小号或资金关联证据。</p>` : '<div class="trace-empty-card"><strong>GMGN 没有回传持仓</strong><span>这不代表链上余额为零。</span></div>'}</section>
  <section class="trace-section"><h3>GMGN 主币与稳定币活动</h3>${activities.length ? `<div class="compact-table trace-mobile-cards"><table><thead><tr><th>类型</th><th>资产</th><th>数量</th><th>金额</th><th>时间</th><th>交易哈希</th></tr></thead><tbody>${activities.map((row) => `<tr><td data-label="类型">${escapeHtml(row.type)}</td><td data-label="资产">${escapeHtml(row.symbol)}</td><td data-label="数量">${formatNumber(row.amount, 6)}</td><td data-label="金额">${formatUsd(row.costUsd)}</td><td data-label="时间">${formatLocalTime((row.timestamp || 0) * 1000)}</td><td data-label="交易哈希">${row.hash ? `<a href="${escapeHtml(explorerTxLink(result.chain, row.hash))}" target="_blank" rel="noreferrer">${escapeHtml(shortAddress(row.hash))}</a>` : "--"}</td></tr>`).join("")}</tbody></table></div>` : '<div class="trace-empty-card"><strong>没有 GMGN 主币或稳定币活动</strong><span>迷因币活动已排除，不拿空投或行销转币判断小号。</span></div>'}</section>`;
}

function skeletonBlock(rows = 4) {
  return `<div class="skel-table" aria-hidden="true">${Array.from({ length: rows }, () => '<div><span class="skel"></span><span class="skel"></span><span class="skel"></span><span class="skel"></span><span class="skel"></span></div>').join("")}</div>`;
}

function formatHoldSpan(seconds) {
  const value = Math.floor(Number(seconds) || 0);
  if (value < 86400) return formatElapsed(value);
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  return hours ? `${days} 天 ${hours} 小时` : `${days} 天`;
}

function earlyLongHoldings(holdings) {
  return holdings.filter((row) => row.elapsed !== null && row.elapsed >= 0 && row.elapsed <= 600 && (row.holdSeconds || 0) >= 86400)
    .sort((a, b) => (b.total || 0) - (a.total || 0));
}

function pnlClass(value) {
  const number = safeNumber(value);
  return number === null || number === 0 ? "" : number > 0 ? "positive" : "negative";
}

function walletOverviewHtml(result, deep) {
  const stats = result.gmgn?.stats || {};
  const insights = deep ? deep.holdings : walletHoldingsInsights(result.gmgn?.response?.data || {});
  const earlyLong = deep ? deep.earlyLong : earlyLongHoldings(insights);
  const realized = deep ? deep.realized30d : safeNumber(stats.realized_profit);
  const pnl = deep?.pnlStat || stats.pnl_stat || null;
  const winrate = gmgnPercent(stats.winrate ?? pnl?.winrate);
  const bigEarner = (realized || 0) >= 10000 || insights.some((row) => (row.total || 0) >= 10000);
  const holdings = (result.gmgn?.holdings || []).filter((row) => (row.balance || 0) > 0).sort((x, y) => (y.usdValue || 0) - (x.usdValue || 0));
  const holdingValue = holdings.reduce((sum, row) => sum + (safeNumber(row.usdValue) || 0), 0);
  const nativeBalance = safeNumber(stats.native_balance ?? stats.bnb_balance ?? stats.sol_balance);
  const visible = holdings.slice(0, 10);
  const relatedCell = deep
    ? `<strong>${deep.related.length}</strong><small>资金路径 ${deep.hops.length} 笔${deep.meme ? `、迷因币往来 ${deep.meme.kept.length} 笔` : ""}</small>`
    : '<strong><span class="skel h28 w40"></span></strong><small>多层追查中</small>';
  return `<div class="stats">
      <div class="stat"><span class="stat-label">30 天已实现盈利</span><strong class="${pnlClass(realized)}">${formatUsd(realized)}</strong><small>${bigEarner ? "大赚地址：30 天已实现或单币盈利 ≥ $10,000" : "GMGN 30 天统计"}</small></div>
      <div class="stat"><span class="stat-label">胜率</span><strong>${formatPercent(winrate, 1)}</strong><small>${pnl?.token_num ? `交易过 ${formatNumber(pnl.token_num, 0)} 个代币` : "GMGN 30 天统计"}${pnl?.avg_holding_period ? `，平均持有 ${escapeHtml(formatHoldSpan(pnl.avg_holding_period))}` : ""}</small></div>
      <div class="stat"><span class="stat-label">持仓现值</span><strong>${formatUsd(holdingValue, true)}</strong><small>${holdings.length} 个代币${nativeBalance !== null ? `，主币 ${formatNumber(nativeBalance, 4)} ${escapeHtml(CHAINS[result.chain]?.native || "")}` : ""}</small></div>
      <div class="stat"><span class="stat-label">相关地址</span>${relatedCell}</div>
    </div>
    <section class="trace-section"><h3>目前持仓</h3>
      ${visible.length ? `<div class="compact-table"><table><thead><tr><th>代币</th><th>数量</th><th>美元价值</th><th>总盈利</th></tr></thead><tbody>${visible.map((row) => `<tr><td><strong>${escapeHtml(row.symbol)}</strong>${row.hidden ? HIDDEN_HOLDING_TAG : ""}<small>${plainAddressCell(row.address)}</small></td><td class="num">${formatNumber(row.balance, 2)}</td><td class="num">${formatUsd(row.usdValue)}</td><td class="num ${row.hidden ? "" : pnlClass(row.totalPnl)}">${row.hidden ? "--" : formatUsd(row.totalPnl)}</td></tr>`).join("")}</tbody></table></div>${holdings.length > visible.length ? `<p class="trace-data-note">依美元价值列前 ${visible.length} 笔，共 ${holdings.length} 笔；完整清单在 XLSX。</p>` : ""}` : '<div class="trace-empty-card"><strong>GMGN 没有回传仍持有的代币</strong><span>这不代表链上余额一定为零。</span></div>'}
    </section>
    <section class="trace-section"><h3>早期进场且长抱的代币</h3>
      <p class="trace-data-note">开盘后 10 分钟内进场、持有超过 24 小时。</p>
      ${earlyLong.length ? `<div class="compact-table"><table><thead><tr><th>代币</th><th>相对开盘进场</th><th>持有</th><th>已实现</th><th>未实现</th><th>总盈利</th></tr></thead><tbody>${earlyLong.map((row) => `<tr><td><strong>${escapeHtml(row.symbol)}</strong><small>${plainAddressCell(row.ca)}</small></td><td>${escapeHtml(formatElapsed(row.elapsed))}</td><td>${escapeHtml(formatHoldSpan(row.holdSeconds))}${row.stillHolding ? "<small>仍持有</small>" : ""}</td><td class="num ${pnlClass(row.realized)}">${formatUsd(row.realized)}</td><td class="num ${pnlClass(row.unrealized)}">${formatUsd(row.unrealized)}</td><td class="num ${pnlClass(row.total)}">${formatUsd(row.total)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="trace-empty-card"><span>GMGN 前 ${insights.length} 笔持仓里没有符合的代币。</span></div>`}
    </section>`;
}

function traceTransfersHtml(result) {
  const coverage = result.coverage || traceCoverage(result.graph);
  const incoming = result.graph.transfers.filter((row) => row.direction === "流入");
  const outgoing = result.graph.transfers.filter((row) => row.direction === "转出");
  const visibleTransfers = result.graph.transfers.slice(0, 200);
  const providerNote = result.graph.provider.startsWith("未查找") || result.graph.provider.startsWith("查找失败") || result.graph.provider.includes("Explorer 不可用")
    ? result.graph.provider
    : result.graph.hitLimit ? `已达安全上限 ${result.graph.maxNodes} 个地址，未完全展开` : "已追到目前查找范围内没有新的符合条件地址";
  const table = result.graph.transfers.length
    ? `<div class="compact-table"><table><thead><tr><th>层级</th><th>方向</th><th>查找地址</th><th>对手地址</th><th>资产</th><th>数量</th><th>时间</th><th>交易</th></tr></thead><tbody>${visibleTransfers.map((row) => `<tr><td>${row.depth + 1}</td><td>${escapeHtml(row.direction)}</td><td>${walletCell(row.queriedAddress)}</td><td>${walletCell(row.counterparty)}</td><td>${escapeHtml(row.asset)}</td><td class="num">${formatNumber(row.amount, 6)}</td><td>${formatLocalTime(row.timestamp * 1000)}</td><td><a href="${escapeHtml(explorerTxLink(result.chain, row.hash))}" target="_blank" rel="noreferrer">${escapeHtml(shortAddress(row.hash))}</a></td></tr>`).join("")}</tbody></table></div>${result.graph.transfers.length > visibleTransfers.length ? `<p class="trace-data-note">画面显示最新 ${visibleTransfers.length} 笔；完整 ${result.graph.transfers.length} 笔在 XLSX。</p>` : ""}`
    : `<div class="trace-empty-card"><strong>没有取得可验证转帐</strong><span>${escapeHtml(result.graph.provider)}。缺少权限、没有符合筛选的交易，或 API 没有回传数据时，这里保持空白。</span></div>`;
  return `<details class="footnote"><summary>单链原始转帐 ${result.graph.transfers.length} 笔（流入 ${incoming.length}、转出 ${outgoing.length}）</summary>
    ${table}
    <p>${escapeHtml(coverage.label)}：${escapeHtml(coverage.detail)}。${escapeHtml(providerNote)}。${result.graph.errors?.length ? `${result.graph.errors.length} 个地址 API 查找失败；成功数据仍保留，没有补假数据。` : ""}</p>
  </details>`;
}

function renderTrace(result) {
  const target = $("trace-result");
  if (!target) return;
  const label = KNOWN_LABELS[normalizeAddress(result.address)];
  const positions = result.positions.filter((position) => positionMatchesAssetMode(position, result.chain, result.assetMode));
  const coverage = result.coverage || traceCoverage(result.graph);
  const relayCount = result.relay?.records?.length || 0;
  const relayCounterparts = result.relay?.counterparts?.length || 0;
  const identities = result.identities || [];
  const positionsHtml = positions.length
    ? `<div class="compact-table"><table><thead><tr><th>资产</th><th>持有数量</th><th>现价</th><th>持仓现值</th><th>24h</th><th>合约</th></tr></thead><tbody>${positions.map((position) => `<tr><td>${escapeHtml(position.symbol)}</td><td class="num">${formatNumber(position.remainQty, 6)}</td><td class="num">${formatUsd(position.price)}</td><td class="num">${formatUsd(position.valueUsd)}</td><td class="num ${pnlClass(position.change24h)}">${formatPercent(position.change24h || 0)}</td><td>${position.address ? plainAddressCell(position.address) : "主币"}</td></tr>`).join("")}</tbody></table></div>`
    : '<div class="trace-empty-card"><strong>没有符合筛选的活跃持仓</strong><span>这是 Binance Web3 的实际回传，不代表链上余额一定为零。</span></div>';
  target.innerHTML = `<div class="tabbar" role="tablist">
      <button type="button" role="tab" data-pane="wp-overview" aria-selected="true">概况</button>
      <button type="button" role="tab" data-pane="wp-funds" aria-selected="false">资金来源 <span class="count" id="wp-funds-count"></span></button>
      <button type="button" role="tab" data-pane="wp-meme" aria-selected="false">迷因币往来 <span class="count" id="wp-meme-count"></span></button>
      <button type="button" role="tab" data-pane="wp-labels" aria-selected="false">身分标签 <span class="count">${identities.length || ""}</span></button>
      <button type="button" role="tab" data-pane="wp-activity" aria-selected="false">交易与持仓</button>
    </div>
    <div class="pane" id="wp-overview" role="tabpanel">
      <div id="deep-overview">${walletOverviewHtml(result, null)}</div>
      <details class="footnote"><summary>数据涵盖与缺口</summary>
        <p>数据完成度：${escapeHtml(coverage.label)}，${escapeHtml(coverage.detail)}。</p>
        <p>查找涵盖 ${result.graph.visited.length} 个地址、${result.graph.transfers.length} 笔单链资金流；Relay ${relayCount} 笔、${relayCounterparts} 个跨链对手；GMGN 已确认 ${identities.filter((identity) => identity.ok).length} / ${identities.length} 个地址。</p>
        <div id="deep-notes"></div>
        <p>只追主币与 USD 稳定币，遇到交易所、跨链桥等公开实体就停下并标注。与 KOL、庄家、内部、捆绑钱包的关系一律写「相关」，不代表同一主人；KOL 只采用 GMGN 公开标签。</p>
      </details>
    </div>
    <div class="pane" id="wp-funds" role="tabpanel" hidden>
      <div id="deep-funds">${skeletonBlock(5)}</div>
      ${relayTraceSection(result)}
      ${traceTransfersHtml(result)}
    </div>
    <div class="pane" id="wp-meme" role="tabpanel" hidden><div id="deep-meme">${skeletonBlock(4)}</div></div>
    <div class="pane" id="wp-labels" role="tabpanel" hidden>
      <section class="trace-section"><h3>这个钱包的公开标签</h3>${gmgnIdentityHtml(result, label)}</section>
      ${gmgnTraceIdentitiesSection(result)}
      <div id="deep-flagged"></div>
    </div>
    <div class="pane" id="wp-activity" role="tabpanel" hidden>
      ${gmgnWalletSections(result)}
      <section class="trace-section"><h3>Binance Web3 主币与稳定币持仓</h3>${positionsHtml}</section>
    </div>`;
}

async function runSourceTrace(event) {
  event?.preventDefault();
  const form = $("source-trace-form");
  if (!form || form.dataset.busy === "true") return;
  const address = $("trace-wallet")?.value.trim() || "";
  const requested = $("chain")?.value || "Auto";
  const direction = $("trace-direction")?.value || "both";
  const assetMode = $("trace-assets")?.value || "all";
  if (!isEvmAddress(address) && !isSolanaAddress(address)) return setStatus("trace-status", "请输入完整有效的钱包地址。", "error");
  form.dataset.busy = "true";
  form.querySelector('button[type="submit"]').disabled = true;
  if ($("trace-export-report")) $("trace-export-report").hidden = true;
  if ($("trace-result")) $("trace-result").innerHTML = `<div class="stats is-loading"><div class="stat"><span class="stat-label">30 天已实现盈利</span><strong>--</strong><small>&nbsp;</small></div><div class="stat"><span class="stat-label">胜率</span><strong>--</strong><small>&nbsp;</small></div><div class="stat"><span class="stat-label">持仓现值</span><strong>--</strong><small>&nbsp;</small></div><div class="stat"><span class="stat-label">相关地址</span><strong>--</strong><small>&nbsp;</small></div></div><div class="trace-section">${skeletonBlock(6)}</div>`;
  try {
    await refreshCredentialStatus().catch(() => undefined);
    setStatus("trace-status", "正在判断钱包实际活动链...");
    const chain = await detectWalletChain(address, requested);
    setStatus("trace-status", `正在并行查找 ${chain} 的 GMGN、Binance Web3、Relay 与链上资金流...`);
    const emptyGraph = {
      transfers: [],
      visited: [normalizeAddress(address)],
      hitLimit: false,
      maxNodes: 30,
      errors: [],
      provider: chain === "Robinhood" ? "未查找（Robinhood Explorer 未接入）" : "未查找（缺 Explorer Key）",
    };
    const graphPromiseBase = chain === "Robinhood" || (chain !== "Solana" && !explorerKey())
      ? Promise.resolve(emptyGraph)
      : chain === "Solana"
        ? traceSolanaGraph(address, direction, assetMode, (message) => setStatus("trace-status", message))
        : traceEvmGraph(address, chain, direction, assetMode, (message) => setStatus("trace-status", message));
    const graphPromise = graphPromiseBase.catch((error) => ({ ...emptyGraph, provider: `查找失败：${trimTerminalPunctuation(error.message)}`, errors: [{ address, message: error.message }] }));
    const [holdings, nativePosition, graph, gmgnResponse, relay] = await Promise.all([
      fetchBinancePositions(address, chain).catch((error) => ({ positions: [], total: 0, status: `error:${error.message}` })),
      fetchEvmNativePosition(address, chain).catch(() => null),
      graphPromise,
      fetchLocalGmgn("wallet", chain, address).catch((error) => ({ ok: false, status: "failed", data: {}, errors: { proxy: error.message }, error: error.message })),
      fetchRelayRequests(address).catch((error) => ({ ok: false, records: [], counterparts: [], error: trimTerminalPunctuation(error.message) })),
    ]);
    const positions = [...(holdings.positions || [])];
    if (nativePosition && !positions.some((position) => coreAssetKind(position, chain) === "native")) positions.unshift(nativePosition);
    const gmgn = normalizeGmgnWalletResult(gmgnResponse);
    if (gmgnResponse.error) gmgn.error = gmgnResponse.error;
    const gmgnFundingAddress = gmgn.common?.fund_from_address;
    const canUseGmgnFunding = gmgnFundingAddress
      && direction !== "downstream"
      && (assetMode === "all" || assetMode === "native")
      && (graph.provider.startsWith("未查找") || graph.provider.startsWith("查找失败"));
    const resolvedGraph = canUseGmgnFunding ? {
      ...graph,
      transfers: [{
        direction: "流入",
        counterparty: gmgnFundingAddress,
        from: gmgnFundingAddress,
        to: address,
        asset: CHAINS[chain]?.native || "主币",
        amount: safeNumber(gmgn.common?.fund_amount) || 0,
        hash: gmgn.common?.fund_tx_hash || "",
        timestamp: safeNumber(gmgn.common?.fund_from_ts) || 0,
        block: 0,
        provider: "GMGN 首笔主币入金",
        depth: 0,
        queriedAddress: address,
      }],
      visited: [...new Set([...graph.visited, normalizeAddress(gmgnFundingAddress)])],
      provider: "GMGN 首笔主币入金（Explorer 不可用）",
    } : graph;
    const identities = await fetchTraceGmgnIdentities(
      resolvedGraph,
      chain,
      address,
      gmgn,
      relay,
      (message) => setStatus("trace-status", message),
    );
    const coverage = traceCoverage(resolvedGraph);
    runtime.trace = { address, chain, direction, assetMode, positions, graph: resolvedGraph, relay, gmgn, identities, coverage, queriedAt: Date.now() };
    renderTrace(runtime.trace);
    notifyParent("partial", { section: "trace" });
    try {
      runtime.trace.deep = await runDeepWalletTrace(runtime.trace, (message) => setStatus("trace-status", message));
      await attachVerdict(runtime.trace);
      renderDeepTrace(runtime.trace, runtime.trace.deep);
    } catch (deepError) {
      runtime.trace.deep = null;
      setStatus("trace-status", `多层追查失败：${deepError.message}`, "error");
    }
    const gmgnText = gmgn.response.ok ? `GMGN ${gmgn.response.status === "complete" ? "完成" : "部分成功"}` : "GMGN 未取得";
    const graphUnavailable = resolvedGraph.provider.startsWith("未查找") || resolvedGraph.provider.startsWith("查找失败");
    const graphText = graphUnavailable
      ? resolvedGraph.provider
      : `${resolvedGraph.visited.length} 个地址、${resolvedGraph.transfers.length} 笔主币/稳定币流${resolvedGraph.provider.includes("Explorer 不可用") ? "（仅 GMGN 首笔主币入金；Explorer 方案不可用）" : ""}`;
    const partialGraph = graphUnavailable || Boolean(resolvedGraph.errors?.length) || resolvedGraph.provider.includes("Explorer 不可用");
    const identityCount = identities.filter((identity) => identity.ok).length;
    const relayText = relay.ok ? `Relay ${relay.total} 笔、${relay.counterparts.length} 个跨链对手` : `Relay 未取得：${relay.error}`;
    setStatus("trace-status", `${chain} 查找完成：${coverage.label}；${gmgnText}；${relayText}；GMGN 已确认 ${identityCount}/${identities.length} 个追查地址；${graphText}。${resolvedGraph.hitLimit ? "已达安全上限，未宣称全部追完。" : ""}`, partialGraph || coverage.level !== "complete" || !relay.ok ? "warning" : "success");
    $("trace-export-report").hidden = false;
  } catch (error) {
    setStatus("trace-status", `追查失败：${trimTerminalPunctuation(error.message)}。没有使用范例数据补位。`, "error");
    if ($("trace-result")) $("trace-result").innerHTML = `<div class="trace-empty-card"><strong>查找未完成</strong><span>${escapeHtml(error.message)}</span></div>`;
  } finally {
    form.dataset.busy = "false";
    form.querySelector('button[type="submit"]').disabled = false;
  }
}

function exportTraceReport() {
  const result = runtime.trace;
  if (!result) return showToast("请先完成资金追查");
  const label = KNOWN_LABELS[normalizeAddress(result.address)];
  const summary = [
    ["字段", "值"],
    ["完整目标钱包", result.address],
    ["链", result.chain],
    ["方向", traceDirectionText(result.direction)],
    ["资产筛选", traceAssetModeText(result.assetMode)],
    ["查找地址数", result.graph.visited.length],
    ["交易证据数", result.graph.transfers.length],
    ["Relay 跨链纪录数", result.relay?.records?.length || 0],
    ["Relay 跨链对手数", result.relay?.counterparts?.length || 0],
    ["Relay 查找状态", result.relay?.ok ? (result.relay.truncated ? "部分完成，达分页上限" : "完成") : `未取得：${result.relay?.error || "未查找"}`],
    ["数据完成度", result.coverage?.label || traceCoverage(result.graph).label],
    ["完成度说明", result.coverage?.detail || traceCoverage(result.graph).detail],
    ["数据源", result.graph.provider],
    ["是否达安全上限", result.graph.hitLimit ? "是，不能宣称全部追完" : "否"],
    ["部分地址 API 失败", result.graph.errors?.length || 0],
    ["公开标签", label ? `${label.name} / ${label.type} / ${label.provenance}` : "未命中"],
    ["GMGN 状态", queryStatusText(result.gmgn?.response?.status)],
    ["GMGN 名称", result.gmgn?.common?.name || result.gmgn?.common?.twitter_name || "未回传"],
    ["GMGN Twitter", result.gmgn?.common?.twitter_username || "未回传"],
    ["GMGN 资金标签", result.gmgn?.common?.fund_from || "未回传"],
    ["GMGN 资金来源地址", result.gmgn?.common?.fund_from_address || "未回传"],
  ];
  const positions = result.positions
    .filter((position) => positionMatchesAssetMode(position, result.chain, result.assetMode))
    .map((position) => [position.symbol, position.address, position.remainQty, position.price, position.valueUsd, position.buyUsd, position.sellUsd, position.totalPnl]);
  const transfers = result.graph.transfers.map((row) => [row.depth + 1, row.direction, row.queriedAddress, row.counterparty, row.from, row.to, row.asset, row.amount, Number(row.timestamp || 0) * 1000, row.block, row.hash, explorerTxLink(result.chain, row.hash), row.provider]);
  const gmgnHoldings = (result.gmgn?.holdings || []).map((row) => [row.symbol, row.hidden ? `${row.name}（转入部位：GMGN 预设藏起来、没算盈亏）` : row.name, row.address, row.balance, row.usdValue, row.cost, row.boughtCost, row.soldIncome, row.realizedPnl, row.unrealizedPnl, row.totalPnl, row.roi, row.lastActiveAt ? row.lastActiveAt * 1000 : null]);
  const gmgnActivity = (result.gmgn?.activities || []).map((row) => [row.type, row.symbol, row.address, row.amount, row.costUsd, row.priceUsd, row.timestamp ? row.timestamp * 1000 : null, row.hash, explorerTxLink(result.chain, row.hash)]);
  const relayRows = (result.relay?.records || []).map((row) => [
    relayTimestamp(row), row.direction, row.user, row.recipient, row.counterpart,
    row.origin?.chain, row.origin?.symbol, row.origin?.amount, row.origin?.amountUsd, row.origin?.txHash, relayExplorerTxLink(row.origin),
    row.destination?.chain, row.destination?.symbol, row.destination?.amount, row.destination?.amountUsd, row.destination?.txHash, relayExplorerTxLink(row.destination),
    row.status, row.requestId, `https://relay.link/transactions?address=${encodeURIComponent(result.address)}`,
  ]);
  const identities = (result.identities || []).map((identity) => {
    const evidence = traceIdentityEvidence(result, identity.address);
    const known = KNOWN_LABELS[normalizeAddress(identity.address)];
    return [
      identity.address,
      identity.chain || result.chain,
      evidence.relation,
      evidence.count,
      known?.name || identity.name || "未回传",
      identity.twitter || "未回传",
      [known?.type, ...identity.tags].filter(Boolean).join(" | ") || "GMGN 无公开标签",
      identity.fundingLabel || "未回传",
      identity.fundingAddress || "未回传",
      queryStatusText(identity.status),
      identity.error || "",
    ];
  });
  downloadXlsx(`资金追查_${result.chain}_${result.address.slice(0, 10)}.xlsx`, [
    { name: "摘要", columns: xlsxColumns([[summary.shift()[0], "text", 24], ["值", "longText", 82]]), rows: summary },
    { name: "资产", columns: xlsxColumns([["资产", "text", 18], ["合约", "text", 48], ["持有数量", "quantity", 18], ["现价USD", "priceUsd", 18], ["现值USD", "usd", 16], ["累计买入USD", "usd", 16], ["累计卖出USD", "usd", 16], ["估算PnL", "usd", 16]]), rows: positions },
    { name: "完整资金流", columns: xlsxColumns([["层级", "integer", 8], ["方向", "center", 10], ["查找地址", "text", 48], ["对手地址", "text", 48], ["From", "text", 48], ["To", "text", 48], ["资产", "center", 12], ["数量", "assetAmount", 16, 6], ["时间", "datetime", 22], ["区块", "integer", 16], ["完整交易哈希", "text", 68], ["Explorer链接", "text", 72], ["来源", "text", 22]]), rows: transfers },
    { name: "Relay跨链证据", columns: xlsxColumns([["时间", "datetime", 22], ["方向", "center", 10], ["完整发送地址", "text", 48], ["完整接收地址", "text", 48], ["完整跨链对手", "text", 48], ["来源链", "text", 14], ["输入资产", "text", 14], ["输入数量", "assetAmount", 18, 6], ["输入USD", "usd", 16], ["来源交易哈希", "text", 68], ["来源Explorer", "text", 72], ["目的链", "text", 14], ["输出资产", "text", 14], ["输出数量", "assetAmount", 18, 6], ["输出USD", "usd", 16], ["目的交易哈希", "text", 68], ["目的Explorer", "text", 72], ["Relay状态", "text", 14], ["Relay Request ID", "text", 68], ["Relay查找页", "text", 72]]), rows: relayRows },
    { name: "关联地址标签", columns: xlsxColumns([["完整地址", "text", 48], ["链", "text", 14], ["资金关系", "text", 22], ["链上证据数", "integer", 14], ["公开名称", "text", 24], ["Twitter", "text", 22], ["GMGN及公开标签", "longText", 42], ["GMGN资金标签", "text", 24], ["GMGN首笔来源地址", "text", 48], ["查找状态", "center", 14], ["错误", "longText", 42]]), rows: identities },
    { name: "已查地址", columns: xlsxColumns([["完整地址", "text", 52]]), rows: result.graph.visited.map((address) => [address]) },
    { name: "GMGN持仓", columns: xlsxColumns([["代币", "text", 18], ["名称", "text", 22], ["合约", "text", 48], ["持仓量", "quantity", 18], ["现值USD", "usd", 16], ["成本USD", "usd", 16], ["历史买入USD", "usd", 16], ["历史卖出USD", "usd", 16], ["已实现PnL", "usd", 16], ["未实现PnL", "usd", 16], ["总PnL", "usd", 16], ["ROI%", "percent", 12], ["最后活动时间", "datetime", 22]]), rows: gmgnHoldings },
    { name: "GMGN活动", columns: xlsxColumns([["类型", "text", 14], ["代币", "text", 16], ["合约", "text", 48], ["数量", "quantity", 18], ["金额USD", "usd", 16], ["价格USD", "priceUsd", 18], ["时间", "datetime", 22], ["完整交易哈希", "text", 68], ["Explorer链接", "text", 72]]), rows: gmgnActivity },
  ], "主币与稳定币资金追查").catch((error) => showToast(`导出失败：${error.message}`));
}

function activateTab(name) {
  runtime.activeTab = name;
  document.querySelectorAll("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".table-wrap[role='tabpanel']").forEach((panel) => {
    const active = panel.id === `tab-${name}`;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
}

function wireNavigation() {
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.tab)));
  document.querySelectorAll("[data-jump-tab], [data-jump-target]").forEach((link) => link.addEventListener("click", (event) => {
    const tab = link.dataset.jumpTab;
    const target = link.dataset.jumpTarget;
    if (tab) activateTab(tab);
    if (target) {
      event.preventDefault();
      $(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }));
}

function wireCopy() {
  if (window.Shell) return;
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;
    const value = button.dataset.copy;
    try {
      await navigator.clipboard.writeText(value);
      showToast(`已拷贝完整地址 ${fullText(value)}`);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      showToast(`已拷贝完整地址 ${fullText(value)}`);
    }
  });
}

function wireClusterExpand() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".cluster-expand");
    if (!button) return;
    const detail = document.querySelector(`[data-cluster-detail="${button.dataset.cluster}"]`);
    const expanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!expanded));
    button.textContent = expanded ? "展开地址" : "收合地址";
    if (detail) detail.hidden = expanded;
  });
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem("wallet-investigator-theme", theme);
  const button = $("theme-toggle");
  if (button) {
    const light = theme === "light";
    button.textContent = light ? "暗色" : "浅色";
    button.setAttribute("aria-pressed", String(light));
  }
}

function wireTheme() {
  applyTheme(localStorage.getItem("wallet-investigator-theme") || "dark");
  $("theme-toggle")?.addEventListener("click", () => applyTheme(document.body.dataset.theme === "light" ? "dark" : "light"));
}

function wireBackToTop() {
  const button = $("back-to-top");
  if (!button) return;
  const update = () => { button.hidden = window.scrollY < 520; };
  window.addEventListener("scroll", update, { passive: true });
  button.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  update();
}

function showToast(message) {
  if (window.Shell) return window.Shell.toast(message);
  let toast = document.querySelector(".app-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "app-toast";
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("visible"), 2200);
}

function wireCurrency() {
  const button = $("currency-toggle");
  if (!button) return;
  button.addEventListener("click", () => {
    runtime.moneyMode = runtime.moneyMode === "usd" ? "native" : "usd";
    button.setAttribute("aria-pressed", String(runtime.moneyMode === "native"));
    const symbol = runtime.scan ? CHAINS[runtime.scan.chain]?.native : "主币";
    button.textContent = runtime.moneyMode === "usd" ? "金额：USD" : `金额：${symbol || "主币"}`;
    if (runtime.scan?.status === "complete") renderScan(runtime.scan);
  });
  $("price-refresh")?.addEventListener("click", async () => {
    const refresh = $("price-refresh");
    refresh.disabled = true;
    try { await fetchNativePrices(); } catch { showToast("Binance 实时价格目前无法连接"); }
    refresh.disabled = false;
  });
}

function updateChainHint() {
  const value = $("contract")?.value.trim() || "";
  if (!$("chain-hint")) return;
  if (!value) return setText("chain-hint", "粘贴完整 CA 后，Solana 与 EVM 会自动分流；EVM 再由 DexScreener 多链池确认。");
  if (value.includes("...")) return setText("chain-hint", "缩写地址不能查找，请粘贴完整 CA。");
  if (isSolanaAddress(value)) return setText("chain-hint", "格式像 Solana 地址；会以 DexScreener + Solana Mainnet RPC 验证。");
  if (isEvmAddress(value)) return setText("chain-hint", "格式像 EVM 地址；会同时检查 ETH、BSC、Base、Arbitrum 的真实池。");
  setText("chain-hint", "地址格式尚不完整。");
}


const LIBRARY_LABEL_NAMES = {
  early_profit: "早期高盈利", smart_money: "聪明钱", long_hold_big: "长抱大赚", kol: "KOL",
  profit_1k: "有赚 $1K+", long_pnl: "长期获利", fresh_gold: "新钱包早买金狗", paper_gold: "早买金狗但卖飞",
  gold_regular: "金狗常客", top_seller: "卖在高点", diamond: "钻石手", gmgn_smart: "GMGN 聪明钱",
  insider: "疑似庄家/内部", bundle_member: "捆绑成员（同源资金）", gmgn_bundler: "GMGN bundler 标签", sniper: "狙击手", bot: "机器人", hft: "高频交易",
  fomo_user: "FOMO 用户", pump_user: "pump.fun 用户", whale: "巨鲸", top_holder: "前排大户", bluechip: "蓝筹持有者", transfer_in: "转入",
};
const LIBRARY_GROUPS = [
  { id: "follow", label: "高手", tone: "profit" }, { id: "avoid", label: "要避开", tone: "candidate" }, { id: "ref", label: "参考", tone: "linked" },
];
const LIBRARY_LABEL_GROUP = {
  gold_regular: "follow", fresh_gold: "follow", top_seller: "follow", diamond: "follow", paper_gold: "follow", smart_money: "follow",
  gmgn_smart: "follow", long_pnl: "follow", early_profit: "follow", long_hold_big: "follow", profit_1k: "follow",
  insider: "avoid", bundle_member: "avoid", sniper: "avoid", bot: "avoid", hft: "ref",
  kol: "ref", fomo_user: "ref", pump_user: "ref", whale: "ref", top_holder: "ref", bluechip: "ref", transfer_in: "ref",
};
for (const tier of ["1M", "500K", "200K", "100K", "50K", "30K", "10K", "5K", "3K"]) {
  LIBRARY_LABEL_NAMES[`pnl_${tier.toLowerCase()}`] = `赚$${tier}+`;
  LIBRARY_LABEL_GROUP[`pnl_${tier.toLowerCase()}`] = "follow";
}
const LIBRARY_HIDDEN = new Set(["gmgn_bundler"]);
const libraryShown = (labels) => (labels || []).filter((label) => !LIBRARY_HIDDEN.has(label));
const gmgnTagsShown = (tags) => (Array.isArray(tags) ? tags : []).filter((tag) => /fomo|pump/i.test(String(tag)));
const libraryState = { offset: 0, limit: 50, total: 0, current: null };

function libraryUseRules(rules) {
  (rules || []).forEach((rule) => {
    if (LIBRARY_HIDDEN.has(rule.id)) return;
    if (rule.group) LIBRARY_LABEL_GROUP[rule.id] = rule.group;
    if (rule.label) LIBRARY_LABEL_NAMES[rule.id] = rule.label;
  });
}

function libraryLabelText(label) {
  return LIBRARY_LABEL_NAMES[label] || label;
}

function libraryLabelOrder(labels) {
  const rank = (label) => {
    const index = LIBRARY_GROUPS.findIndex((group) => group.id === LIBRARY_LABEL_GROUP[label]);
    return index < 0 ? LIBRARY_GROUPS.length : index;
  };
  return [...(labels || [])].sort((a, b) => rank(a) - rank(b));
}

function libraryLabelTags(labels, manual = []) {
  return libraryLabelOrder(libraryShown(labels)).map((label) => dataTag(libraryLabelText(label) + (manual.includes(label) ? "（手动）" : ""),
    LIBRARY_GROUPS.find((group) => group.id === LIBRARY_LABEL_GROUP[label])?.tone || "strong")).join(" ") || '<span class="muted">无标签</span>';
}

function libraryLabelGroupsHtml(labels, manual = []) {
  labels = libraryShown(labels);
  const rows = LIBRARY_GROUPS.map((group) => [group.label, (labels || []).filter((label) => LIBRARY_LABEL_GROUP[label] === group.id)]);
  rows.push(["手动", (labels || []).filter((label) => !LIBRARY_LABEL_GROUP[label])]);
  const html = rows.filter(([, list]) => list.length).map(([name, list]) => `<p>${escapeHtml(name)}：${libraryLabelTags(list, manual)}</p>`).join("");
  return html || '<p>目前标签：<span class="muted">无标签</span></p>';
}

function libraryPlatformText(p) {
  const extra = p.platform === "FOMO"
    ? (p.followers != null ? `粉丝 ${formatNumber(p.followers, 0)}` : "")
    : [p.x ? `X @${p.x}` : "", p.verified ? "已验证" : ""].filter(Boolean).join("，");
  return `${p.platform}：${p.handle}${extra ? `（${extra}）` : ""}`;
}

function libraryPlatformLine(platforms) {
  return (platforms || []).length ? `<small class="lib-plat">${platforms.map((p) => escapeHtml(libraryPlatformText(p))).join("<br>")}</small>` : "";
}

const LIBRARY_USE = { avoid: ["避开", "candidate"], exit: ["看出场", "linked"], confirm: ["看进场只当确认", "profit"], ref: ["参考", "muted"] };
const LIBRARY_CARD = { rule: "", minN: 5 };
const LIBRARY_CARD_NOTE = "实力＝他自己赚不赚，不代表跟了会赚";

function libraryUseCard(data) {
  if (data?.cardRule) LIBRARY_CARD.rule = data.cardRule;
  Object.entries(data?.useLabels || {}).forEach(([id, label]) => { if (LIBRARY_USE[id]) LIBRARY_USE[id][0] = label; });
}

const libraryPct = (value, digits = 0) => {
  const n = safeNumber(value);
  return n === null ? "--" : `${n > 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;
};
const librarySigned = (value) => {
  const n = safeNumber(value);
  return n === null ? "--" : `${n > 0 ? "+" : ""}${formatUsd(n, true)}`;
};

function libraryHoldText(seconds) {
  const s = safeNumber(seconds);
  if (s === null || s <= 0) return "";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} 分钟`;
  if (s < 86400) return `${(s / 3600).toFixed(s < 36000 ? 1 : 0)} 小时`;
  return `${(s / 86400).toFixed(s < 864000 ? 1 : 0)} 天`;
}

function libraryGradeBadge(card) {
  const grade = card?.grade || "";
  const title = grade ? `${grade} 级（GMGN 30 天统计打分，${LIBRARY_CARD_NOTE}）` : "还没有 GMGN 30 天统计，维护调度会慢慢补查";
  return `<span class="gb g-${grade || "none"}" title="${escapeHtml(title)}">${escapeHtml(grade || "?")}</span>`;
}

function libraryUseTags(card) {
  return (card?.use || []).map((id) => dataTag(LIBRARY_USE[id]?.[0] || id, LIBRARY_USE[id]?.[1] || "muted")).join(" ");
}

function libraryCardStrength(card) {
  if (!card?.grade) return [];
  const parts = [`30 天 ${librarySigned(card.realized)}`];
  if (card.winrate != null) parts.push(`胜率 ${Math.round(card.winrate * 100)}%`);
  if (card.big != null && card.tokens) parts.push(`${formatNumber(card.big, 0)}/${formatNumber(card.tokens, 0)} 颗抓到 2 倍以上`);
  if (card.deepLoss != null && card.tokens) parts.push(`亏一半以上 ${Math.round((card.deepLoss / card.tokens) * 100)}%`);
  return parts;
}

function libraryCardPace(card) {
  const parts = [];
  const hold = libraryHoldText(card?.avgHold);
  if (hold) parts.push(`平均拿 ${hold}`);
  if (card?.trades != null) parts.push(`30 天买卖 ${formatNumber(card.trades, 0)} 笔（一天约 ${formatNumber(card.trades / 30, 0)} 笔）`);
  return parts;
}

function libraryFollowText(follow, short = false) {
  if (!follow) return "";
  if (follow.n < LIBRARY_CARD.minN) return short ? `跟单 ${follow.n} 笔，太少` : `晚 1 分钟跟只有 ${follow.n} 笔，样本太少，先不看`;
  return short
    ? `晚 1 分钟跟 ${follow.n} 笔，平均 ${libraryPct(follow.follow, 1)}`
    : `晚 1 分钟跟 ${follow.n} 笔：平均 ${libraryPct(follow.follow, 1)}、中位数 ${libraryPct(follow.med, 1)}，赚钱的 ${Math.round(follow.win * 100)}%（他自己的成交价平均 ${libraryPct(follow.own, 1)}）`;
}

function libraryCardCompact(card) {
  if (!card) return '<span class="muted">--</span>';
  const hold = libraryHoldText(card.avgHold);
  const nums = [...libraryCardStrength(card), hold ? `拿 ${hold}` : ""].filter(Boolean);
  const follow = libraryFollowText(card.follow, true);
  const followTone = card.follow && card.follow.n >= LIBRARY_CARD.minN ? pnlClass(card.follow.follow) : "muted";
  return `<div class="wcard">${libraryGradeBadge(card)}<div class="wcard-body">
    <span class="wcard-nums">${nums.length ? escapeHtml(nums.join("｜")) : '<span class="muted">还没评等级</span>'}</span>
    <span class="wcard-use">${libraryUseTags(card)}</span>
    ${follow ? `<small class="${followTone}">${escapeHtml(follow)}</small>` : ""}</div></div>`;
}

function libraryCardHtml(card) {
  if (!card) return "";
  const strength = libraryCardStrength(card);
  const pace = libraryCardPace(card);
  const src = card.src && card.at ? `${escapeHtml(card.src)}，${formatLocalTime(card.at * 1000)}` : "";
  const follow = card.follow ? libraryFollowText(card.follow)
    : card.watch ? "还没有跟单纪录（在聪明钱名单里，交易纪录累积后每 6 小时重算）" : "不在聪明钱名单里，没有他的交易纪录可以算";
  const followTone = card.follow && card.follow.n >= LIBRARY_CARD.minN ? pnlClass(card.follow.follow) : "";
  const style = (card.style || []).map((x) => dataTag(x, "muted")).join(" ");
  return `<section class="wcard-full">
    <div class="wcard-head">${libraryGradeBadge(card)}<div><strong>实力卡</strong><small>${escapeHtml(LIBRARY_CARD_NOTE)}${src ? `；数字来源 ${src}` : ""}</small></div></div>
    <dl class="wcard-dl">
      <dt>实力</dt><dd>${strength.length ? escapeHtml(strength.join("、")) : '<span class="muted">还没有 GMGN 30 天统计，维护调度会慢慢补查</span>'}${card.score != null ? ` <small class="muted">综合分 ${escapeHtml(card.score)}</small>` : ""}</dd>
      <dt>风格</dt><dd>${pace.length || style ? `${escapeHtml(pace.join("、"))}${style ? ` ${style}` : ""}` : '<span class="muted">--</span>'}</dd>
      <dt>跟单纪录</dt><dd class="${followTone}">${escapeHtml(follow)}</dd>
      <dt>用途</dt><dd>${libraryUseTags(card)}</dd>
    </dl>
    ${LIBRARY_CARD.rule ? `<details class="wcard-rule"><summary>怎么算的</summary><p>${escapeHtml(LIBRARY_CARD.rule)}</p></details>` : ""}
  </section>`;
}

function isFundingAsset(asset, chain) {
  const symbol = String(asset || "").toUpperCase();
  return STABLE_SYMBOLS.has(symbol) || symbol === String(CHAINS[chain]?.native || "").toUpperCase() || symbol === "主币";
}

function buildLibraryPayload(report) {
  const openTs = Math.floor(Number(report.market?.pairCreatedAt) / 1000) || null;
  const now = Math.floor(Date.now() / 1000);
  const hardClusters = (report.clusters || []).filter(isHardCluster);
  const clusterOf = new Map();
  hardClusters.forEach((cluster) => cluster.members.forEach((member) => clusterOf.set(normalizeAddress(member.wallet), `${cluster.id}:${cluster.source}`)));
  const gmgnWallets = report.gmgn?.wallets || [];
  const gmgnBy = new Map(gmgnWallets.map((wallet) => [normalizeAddress(wallet.wallet), wallet]));
  const topProfit = [...gmgnWallets].filter((wallet) => Number(wallet.totalPnl) > 0).sort((a, b) => b.totalPnl - a.totalPnl).slice(0, 50);
  const topRank = new Map(topProfit.map((wallet, index) => [normalizeAddress(wallet.wallet), index + 1]));
  const picked = new Map();
  (report.buyers || []).forEach((buyer) => picked.set(normalizeAddress(buyer.wallet), { buyer }));
  topProfit.forEach((wallet) => picked.set(normalizeAddress(wallet.wallet), { ...(picked.get(normalizeAddress(wallet.wallet)) || {}) }));
  gmgnWallets.filter((wallet) => wallet.twitter || wallet.tags.some((tag) => ["kol", "renowned", "creator", "dev_team", "insider", "rat_trader"].includes(String(tag).toLowerCase())))
    .forEach((wallet) => picked.set(normalizeAddress(wallet.wallet), { ...(picked.get(normalizeAddress(wallet.wallet)) || {}) }));
  gmgnWallets.filter((wallet) => wallet.pool).forEach((wallet) => picked.delete(normalizeAddress(wallet.wallet)));
  const wallets = [];
  const relations = [];
  picked.forEach(({ buyer }, key) => {
    const gmgn = buyer?.gmgn || gmgnBy.get(key) || null;
    const raw = gmgn?.raw || {};
    const position = buyer?.position || (gmgn ? gmgnPosition(gmgn) : null);
    const start = safeNumber(raw.start_holding_at) || safeNumber(buyer?.timestamp) || null;
    const end = safeNumber(raw.end_holding_at) || null;
    const balance = safeNumber(position?.remainQty) || 0;
    const stillHolding = balance > 0;
    const entryTs = safeNumber(buyer?.timestamp) || start;
    wallets.push({
      address: buyer?.wallet || gmgn?.wallet,
      name: gmgn?.name || "",
      twitter: gmgn?.twitter || "",
      entryTs,
      elapsed: buyer && Number.isFinite(Number(buyer.elapsed)) ? Number(buyer.elapsed) : entryTs && openTs ? entryTs - openTs : null,
      buyMc: position?.buyMarketCap ?? gmgn?.buyMarketCap ?? null,
      sellMc: position?.sellMarketCap ?? gmgn?.sellMarketCap ?? null,
      holdSeconds: start ? (stillHolding || !end ? now : end) - start : null,
      stillHolding,
      buyUsd: position?.buyUsd ?? null,
      sellUsd: position?.sellUsd ?? null,
      realized: position?.realizedPnl ?? null,
      unrealized: position?.unrealizedPnl ?? null,
      total: position?.totalPnl ?? null,
      roi: position?.roi ?? null,
      holdingPct: position?.holdingPct ?? null,
      earlyRank: buyer?.rank || null,
      topProfitRank: topRank.get(key) || null,
      gmgnTags: gmgn?.tags || [],
      cluster: clusterOf.get(key) || "",
      source: [buyer ? `早期名单（${report.early?.provider || ""}）` : "", topRank.get(key) ? "GMGN 高盈利" : "", gmgn ? "GMGN" : ""].filter(Boolean).join(" / "),
    });
    const funding = buyer?.funding || gmgn?.funding;
    if (funding?.counterparty && isFundingAsset(funding.asset, report.chain) && (isEvmAddress(funding.counterparty) || isSolanaAddress(funding.counterparty))) {
      relations.push({
        type: "funding", src: funding.counterparty, dst: buyer?.wallet || gmgn?.wallet, asset: funding.asset, amount: funding.amount,
        txHash: funding.hash || "", ts: funding.timestamp || null, provider: funding.provider || "",
        srcLabel: funding.sourceLabel || "", publicEntity: Boolean(funding.publicEntity),
        evidence: `${funding.provider || "资金来源"}：${funding.amount ?? "?"} ${funding.asset}${funding.sourceLabel ? `（GMGN 标注 ${funding.sourceLabel}）` : ""}`,
      });
    }
  });
  return {
    chain: report.chain, ca: report.contract, symbol: report.market?.baseToken?.symbol || report.gmgn?.info?.symbol || "", openTs,
    dataNote: report.early?.gmgnSample ? "早期名单为 GMGN 可得样本，非完整前 50" : "",
    wallets: wallets.filter((wallet) => wallet.address), relations,
  };
}

function renderLibraryMatch(result, report) {
  const box = $("library-match");
  if (!box) return;
  box.hidden = false;
  if (!result?.ok) {
    box.innerHTML = `<p class="trace-data-note">写入或比对失败：${escapeHtml(result?.error || "未知原因")}。没有用推测数据代替。</p>`;
    return;
  }
  const { repeatEarlyProfit = [], fundingLinks = [] } = result.match || {};
  const repeatRows = repeatEarlyProfit.map((hit) => `<tr><td>${walletCell(hit.address)}${hit.twitter ? `<small>${xProfileLink(hit.twitter, `@${hit.twitter}`)}</small>` : ""}</td><td>${libraryLabelTags(hit.labels)}</td><td>${hit.previous.map((app) => `${escapeHtml(app.symbol || fullText(app.ca))}：开盘后 ${escapeHtml(formatElapsed(app.elapsed))}，总盈利 ${escapeHtml(formatUsd(app.total))}`).join("<br>")}</td></tr>`).join("");
  const linkRows = fundingLinks.map((link) => `<tr><td>${walletCell(link.address)}</td><td>${escapeHtml(link.relation)}${link.via ? `<small>共同上游 ${walletCell(link.via)}</small>` : ""}</td><td>${walletCell(link.linked)}${libraryLabelTags(link.linkedLabels)}${link.otherCas?.length ? `<small>出现于其他 CA：${link.otherCas.map((ca) => escapeHtml(fullText(ca))).join("、")}</small>` : ""}</td><td>${escapeHtml(link.evidence || "")}</td></tr>`).join("");
  box.innerHTML = `
    <p class="trace-data-note">本次写入 ${result.stored} 个地址、${result.relations} 条主币／USD 稳定币资金关联；钱包库目前共 ${result.libraryWallets} 个地址。比对只看「以前查过的其他 CA」。${escapeHtml(result.match?.note || "")} <a href="./library.html">打开钱包库</a></p>
    <h3>以前其他 CA 也早期进场且高盈利（${repeatEarlyProfit.length}）</h3>
    ${repeatRows ? `<div class="compact-table trace-mobile-cards"><table><thead><tr><th>钱包</th><th>库内标签</th><th>过往纪录</th></tr></thead><tbody>${repeatRows}</tbody></table></div>` : '<p class="muted">没有命中。钱包库需要累积更多 CA 才会出现重复。</p>'}
    <h3>资金来源连到库内标记地址（${fundingLinks.length}）</h3>
    ${linkRows ? `<div class="compact-table trace-mobile-cards"><table><thead><tr><th>本次地址</th><th>关联类型</th><th>库内地址</th><th>证据</th></tr></thead><tbody>${linkRows}</tbody></table></div>` : '<p class="muted">没有命中（交易所热钱包等公开实体出金不列入）。</p>'}`;
  report.libraryMatch = result.match;
}

async function syncWalletLibrary(report) {
  const box = $("library-match");
  if (box) { box.hidden = false; box.innerHTML = '<p class="trace-data-note">正在写入钱包库并比对过往 CA...</p>'; }
  try {
    const result = await fetchJson("/api/library/ingest", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildLibraryPayload(report)),
    }, 60000);
    renderLibraryMatch(result, report);
    return result;
  } catch (error) {
    renderLibraryMatch({ ok: false, error: error.message }, report);
    return null;
  }
}

async function libraryPost(path, body) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}), cache: "no-store" });
  const data = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
  if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function renderLibraryRules(rules, groups) {
  const box = $("library-rules");
  if (!box || !rules) return;
  libraryUseRules(rules);
  rules = rules.filter((rule) => !LIBRARY_HIDDEN.has(rule.id));
  const ruleItem = (rule) => `<li><strong>${escapeHtml(rule.label)}</strong>：${escapeHtml(rule.rule)}</li>`;
  const grouped = Boolean(groups?.length && rules.some((rule) => rule.group));
  box.innerHTML = (grouped
    ? groups.map((group) => `<li><strong>${escapeHtml(group.label)}</strong>：${escapeHtml(group.note || "")}<ul>${rules.filter((rule) => rule.group === group.id).map(ruleItem).join("")}</ul></li>`).join("")
    : rules.map(ruleItem).join("")) + "<li><strong>手动覆写</strong>：可添加自订标签或移除自动标签；移除的自动标签会保留在纪录里，不会被下次查找自动加回。</li>";
  const select = $("library-label");
  if (!select || select.options.length > 1) return;
  if (!grouped) { rules.forEach((rule) => select.add(new Option(rule.label, rule.id))); return; }
  groups.forEach((group) => {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;
    optgroup.append(new Option(`全部${group.label}`, `group:${group.id}`), ...rules.filter((rule) => rule.group === group.id).map((rule) => new Option(rule.label, rule.id)));
    select.append(optgroup);
  });
}

const libraryDay = (ts) => new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(ts * 1000);

function libraryBotNote(bots) {
  if (!bots) return "";
  const parts = [];
  if (bots.removed) parts.push(`机器人不进钱包库：已移出 ${bots.removed} 个${bots.last?.archive ? `（最近一批封存在 library-archive\\${escapeHtml(bots.last.archive)}，可以还原）` : ""}`);
  if (bots.kept) parts.push(`${bots.kept} 个是机器人但你标过，留着不导出`);
  if (bots.keptPlatform) parts.push(`${bots.keptPlatform} 个 FOMO／pump.fun 用户交易很频繁，照样留着、照样导出`);
  if (bots.pending) parts.push(`${bots.pending} 个还在查交易频率（每 30 分钟查 ${bots.perRound} 个）`);
  if (bots.error) parts.push(`上次移出机器人失败：${escapeHtml(bots.error.error || "")}，下一轮再试`);
  return parts.length ? `${parts.join("；")}。` : "";
}

function renderLibraryQuiet(quiet, bots) {
  const box = $("library-quiet-note");
  if (!box) return;
  const botNote = libraryBotNote(bots);
  if (!botNote && (!quiet || (!quiet.total && !quiet.last && !quiet.error))) { box.hidden = true; return; }
  quiet = quiet || {};
  const parts = [];
  if (quiet.shown) parts.push(`正在显示低盈利的钱包（标成「低盈利」），全库共 ${quiet.total} 个。`);
  else if (quiet.hidden) parts.push(`已隐藏 ${quiet.hidden} 个总体盈利未达门槛 的钱包，<a href="#" role="button" id="library-quiet-show">显示</a>。`);
  if (quiet.total) parts.push(`进库满 ${quiet.days} 天还是未达门槛 会先封存再删${quiet.nextDueAt ? `，最早一批约 ${libraryDay(quiet.nextDueAt)} 到期` : ""}；想留的加个标签或备注就不会清。`);
  if (quiet.waitingStats) parts.push(`${quiet.waitingStats} 个已到期，等补查完 GMGN 30 天统计才会清。`);
  if (quiet.error) parts.push(`上次自动清理失败：${escapeHtml(quiet.error.error || "")}，下一轮再试。`);
  else if (quiet.last) parts.push(`上次自动清理 ${formatLocalTime(quiet.last.at * 1000)}：${quiet.last.deleted ? `删了 ${quiet.last.deleted} 个（封存在 library-archive\\${escapeHtml(quiet.last.archive)}）` : "没有到期的钱包"}。`);
  if (botNote) parts.push(botNote);
  box.innerHTML = parts.join("");
  box.hidden = false;
  $("library-quiet-show")?.addEventListener("click", (event) => { event.preventDefault(); $("library-show-quiet").checked = true; libraryState.offset = 0; loadLibrary(); });
  const rules = $("library-rules");
  if (rules && quiet.rule) {
    const li = $("library-quiet-rule") || rules.appendChild(Object.assign(document.createElement("li"), { id: "library-quiet-rule" }));
    li.innerHTML = `<strong>低盈利（自动清理）</strong>：${escapeHtml(quiet.rule)}`;
  }
}

function libraryGmLine(item) {
  const g = item && item.gm;
  if (!g || !g.at) return "";
  if (g.total == null) return `<small>GMGN 历史总盈利：${escapeHtml(g.note || "没有纪录")}（${libraryDay(g.at)} 查）</small>`;
  return `<small>GMGN 历史总盈利 <span class="${pnlClass(g.total)}">${formatUsd(g.total)}</span>（${libraryDay(g.at)} 更新）</small>`;
}

function libraryPnlCell(item) {
  const lib = formatUsd(item.totalPnl);
  const gm = libraryGmLine(item);
  if (!(item.platforms || []).some((p) => p.platform === "pump.fun")) return lib + gm;
  const a = item.acct && item.acct["pump.fun"];
  if (a && a.at && a.total != null) {
    return `<strong class="${pnlClass(a.total)}">${formatUsd(a.total)}</strong><small>pump.fun 帐号总盈亏（${formatNumber(a.coins, 0)} 颗币，${libraryDay(a.at)} 更新）</small><small>库内 ${formatNumber(item.caCount, 0)} 颗加总 ${lib}</small>${gm}`;
  }
  return `${lib}<small>${a && a.tried ? "pump.fun 帐号没算成功" : "pump.fun 帐号还没算"}，这是库内几颗加总</small>${gm}`;
}

async function loadLibrary() {
  setStatus("library-status", "读取钱包库...");
  try {
    const data = await libraryPost("/api/library/search", {
      q: $("library-q")?.value.trim() || "", chain: $("library-chain")?.value || "", label: $("library-label")?.value || "",
      limit: libraryState.limit, offset: libraryState.offset, showQuiet: Boolean($("library-show-quiet")?.checked),
    });
    libraryState.total = data.total;
    libraryUseCard(data);
    renderLibraryRules(data.rules, data.groups);
    renderLibraryQuiet(data.quiet, data.bots);
    const body = $("library-body");
    body.innerHTML = data.items.length ? data.items.map((item) => `<tr>
      <td data-label="链">${escapeHtml(item.chain)}</td>
      <td data-label="钱包">${walletCell(item.address, item.chain)}${item.name || item.twitter ? `<small>${item.twitter ? xProfileLink(item.twitter, item.name || `@${item.twitter}`) : escapeHtml(item.name)}</small>` : ""}${libraryPlatformLine(item.platforms)}</td>
      <td data-label="标签">${item.quiet ? `${dataTag("低盈利", "muted")}${item.quiet.pruneAt ? `<small>约 ${libraryDay(item.quiet.pruneAt)} 清理</small>` : ""}` : ""}${libraryLabelTags(item.labels, item.manualLabels)}</td>
      <td data-label="实力">${libraryCardCompact(item.card)}</td>
      <td data-label="出现 CA 数">${item.caCount}</td>
      <td data-label="累计盈利">${libraryPnlCell(item)}</td>
      <td data-label="备注">${escapeHtml(item.note || "")}</td>
      <td><button type="button" class="btn btn-sm btn-ghost" data-library-open="${escapeHtml(item.chain)}|${escapeHtml(item.address)}">详情</button></td>
    </tr>`).join("") : '<tr><td colspan="8"><div class="table-empty">钱包库没有符合条件的地址。到「查地址」查一个 CA 或钱包，结果会自动写入。</div></td></tr>';
    const page = Math.floor(libraryState.offset / libraryState.limit) + 1;
    const pages = Math.max(1, Math.ceil(data.total / libraryState.limit));
    setText("library-page", `第 ${page} / ${pages} 页，共 ${data.total} 个地址（已收录 ${data.tokens} 个 CA）`);
    $("library-prev").disabled = page <= 1;
    $("library-next").disabled = page >= pages;
    setStatus("library-status", "已读取本机钱包库", "success");
  } catch (error) {
    setStatus("library-status", `读取失败：${error.message}`, "error");
  }
}

async function openLibraryWallet(chain, address) {
  const inDrawer = Boolean(window.Shell);
  const panel = inDrawer ? window.Shell.drawer.open("钱包详情") : $("library-detail");
  if (!panel) return;
  panel.hidden = false;
  panel.innerHTML = skeletonBlock(4);
  try {
    const data = await libraryPost("/api/library/wallet", { chain, address });
    libraryState.current = data.wallet;
    libraryUseRules(data.rules);
    libraryUseCard(data);
    const w = data.wallet;
    const pumpAcctHtml = () => {
      if (!(w.platforms || []).some((p) => p.platform === "pump.fun")) return "";
      const a = w.acct && w.acct["pump.fun"];
      const how = '到任何 pump.fun 页按「盈利」书签就会算（<a href="./pump-sync.html" target="_blank" rel="noopener">书签在这里</a>）';
      if (!a || !a.at || a.total == null) return `<p class="muted">pump.fun 帐号总盈亏：还没算${a && a.note ? `（上次失败：${escapeHtml(a.note)}）` : ""}。${how}。</p>`;
      const bits = [`已实现 ${formatUsd(a.realized)}`, `${formatNumber(a.coins, 0)} 颗币、赚钱 ${formatNumber(a.wins, 0)} 颗`,
        a.untrusted ? `${formatNumber(a.untrusted, 0)} 颗 pump.fun 数字不合理没算进去（亏损比买入还多或标成本不可信）` : "", a.partial ? `交易太多只算最近 ${formatNumber(a.trades, 0)} 笔` : ""].filter(Boolean);
      return `<p>pump.fun 帐号总盈亏：<strong class="${pnlClass(a.total)}">${formatUsd(a.total)}</strong>（${bits.join("、")}；${formatLocalTime(a.at * 1000)}更新）${a.note ? `<small>${a.tried && a.tried > a.at ? "上次更新失败：" : ""}${escapeHtml(a.note)}</small>` : ""}</p>`;
    };
    const relRow = (rel, side) => `<tr><td>${side}</td><td>${walletCell(side === "上游" ? rel.src : rel.dst, w.chain)}${rel.src_label ? `<small>GMGN 标注：${escapeHtml(rel.src_label)}${rel.public_entity ? "（公开实体）" : ""}</small>` : ""}${rel.noise && !rel.public_entity ? `<small>不拿来连钱包：${escapeHtml(rel.noise)}</small>` : ""}</td><td>资金关联（${escapeHtml(rel.rel_type)}）</td><td>${formatNumber(rel.amount, 3)} ${escapeHtml(rel.asset)}</td><td>${rel.ts ? formatLocalTime(rel.ts * 1000) : "--"}</td><td>${escapeHtml(rel.evidence)}</td><td>${escapeHtml(fullText(rel.ca))}</td></tr>`;
    panel.innerHTML = `<div class="d-addr"><span class="chain-tag">${escapeHtml(w.chain)}</span>${plainAddressCell(w.address)}${inDrawer ? "" : '<button type="button" class="btn btn-sm" id="library-detail-close">关闭</button>'}</div>
      <div class="d-links"><a href="./analyze.html?q=${encodeURIComponent(w.address)}">查这个地址</a></div>
      ${w.twitter ? `<p>${xProfileLink(w.twitter, w.name || `@${w.twitter}`)}（GMGN 公开数据）</p>` : ""}
      ${w.platforms?.length ? `<h3>平台帐号（${w.platforms.length}）</h3>
      <ul class="lib-plat-list">${w.platforms.map((p) => `<li><strong>${escapeHtml(libraryPlatformText(p))}</strong>${p.x ? ` ${xProfileLink(p.x, "X 个人页")}` : ""}<small>对上的 CA：${p.cas.map((ca) => escapeHtml(fullText(ca))).join("、")}；最后比对 ${formatLocalTime(p.lastSeen * 1000)}</small></li>`).join("")}</ul>
      <p class="muted">比对方式：GMGN 前 100 持仓与平台帐号的持有数量相差 ≤1 颗，而且只对上这一个地址。平台帐号是对方在平台上的公开名称，不代表真实身分。</p>
      <p>平台盈亏（以平台自己算的为准）：${data.appearances.some((app) => app.plat_pnl != null)
        ? data.appearances.filter((app) => app.plat_pnl != null).map((app) => `${escapeHtml(app.symbol || "?")} <strong class="${pnlClass(app.plat_pnl)}">${formatUsd(app.plat_pnl)}</strong>（${escapeHtml(app.plat_src || "平台")}，${formatLocalTime(app.plat_at * 1000)}）`).join("、")
        : "还没有。FOMO 用户要到那颗币的 FOMO 页按书签，回查地址页粘贴比对；pump.fun 用户在 pump.fun 页按「盈利」书签时一起更新，或在那颗币的 pump.fun 页按「持币」。"}</p>
      ${pumpAcctHtml()}
      ${w.gmgnOk === false ? `<p class="muted"><strong>GMGN 只看到这个人的转入转出（标了 transfer_in 或没有买进纪录），下面 GMGN 的数字不准，只供参考，导出备注也不写。</strong></p>` : ""}` : ""}
      ${w.pnl30 ? `<p class="muted">GMGN 30 天：${w.pnl30.note ? escapeHtml(w.pnl30.note) : `已实现 ${formatUsd(w.pnl30.realized)}${w.pnl30.winrate == null ? "" : `、胜率 ${formatNumber(w.pnl30.winrate * 100, 0)}%`}${w.pnl30.tokens == null ? "" : `、交易 ${formatNumber(w.pnl30.tokens, 0)} 颗币`}`}（查于 ${formatLocalTime(w.pnl30.at * 1000)}）</p>` : ""}
      ${w.gm ? `<p class="muted">GMGN 历史总盈利（钱包库「更新盈亏」查的）：${w.gm.total == null ? escapeHtml(w.gm.note || "没有纪录") : `${formatUsd(w.gm.total)}${w.gm.realized == null ? "" : `，已实现 ${formatUsd(w.gm.realized)}`}${w.gm.buys == null ? "" : `，买 ${formatNumber(w.gm.buys, 0)} 次、卖 ${formatNumber(w.gm.sells, 0)} 次`}`}（查于 ${formatLocalTime(w.gm.at * 1000)}）</p>` : ""}
      ${w.pf ? `<p class="muted">GMGN 历史战绩：${w.pf.note ? escapeHtml(w.pf.note) : [
        w.pf.total == null ? "" : `总盈利 ${formatUsd(w.pf.total)}`, w.pf.realized == null ? "" : `已实现 ${formatUsd(w.pf.realized)}`,
        w.pf.buys == null ? "" : `买 ${formatNumber(w.pf.buys, 0)} 次、卖 ${formatNumber(w.pf.sells, 0)} 次`,
        w.pf.bestSymbol ? `最赚 ${escapeHtml(w.pf.bestSymbol)} ${formatUsd(w.pf.bestProfit)}（${escapeHtml(fullText(w.pf.bestCa))}）` : "",
      ].filter(Boolean).join("、") || "GMGN 没有交易纪录"}（查于 ${formatLocalTime(w.pf.at * 1000)}）</p>` : ""}
      ${libraryCardHtml(w.card)}
      ${libraryLabelGroupsHtml(w.labels, w.manualLabels)}
      <p class="muted">自动标签：${libraryShown(w.autoLabels).map(libraryLabelText).join("、") || "无"}</p>
      ${linkReviewsHtml(data.linkReviews)}${sameWalletHtml(data.sameWallet)}
      <div class="library-edit">
        <label><span>手动添加标签（逗号分隔，例如 庄家, 阴谋, 聪明钱）</span><input id="library-manual" value="${escapeHtml(w.manualLabels.join(", "))}"></label>
        <fieldset><legend>移除自动标签（覆写规则）</legend>${libraryShown(w.autoLabels).map((label) => `<label><input type="checkbox" data-remove-label="${escapeHtml(label)}" ${w.removedLabels.includes(label) ? "checked" : ""}> ${escapeHtml(libraryLabelText(label))}</label>`).join("") || "<span class='muted'>无</span>"}</fieldset>
        <label><span>备注</span><textarea id="library-note" rows="3">${escapeHtml(w.note || "")}</textarea></label>
        <div><button class="btn btn-primary" type="button" id="library-save">保存标注</button></div>
      </div>
      <h3>出现过的 CA（${data.appearances.length}）</h3>
      <div class="compact-table trace-mobile-cards"><table><thead><tr><th>代币</th><th>进场（相对开盘）</th><th>买入市值</th><th>卖出市值</th><th>持有时间</th><th>已实现</th><th>未实现</th><th>总盈利</th><th>规则命中</th></tr></thead><tbody>
      ${data.appearances.map((app) => `<tr><td data-label="代币"><strong>${escapeHtml(app.symbol || "?")}</strong><small>${plainAddressCell(app.ca)}</small></td><td data-label="进场">${app.elapsed !== null ? escapeHtml(formatElapsed(app.elapsed)) : app.entry_ts && app.launchTs ? `创建后 ${escapeHtml(formatElapsed(Math.max(0, app.entry_ts - app.launchTs)))}` : "--"}${app.entry_ts ? `<small>${formatLocalTime(app.entry_ts * 1000)}</small>` : ""}</td><td data-label="买入市值">${formatUsd(app.buy_mc, true)}${app.athMc ? `<small>这颗币最高 ${formatUsd(app.athMc, true)}</small>` : ""}</td><td data-label="卖出市值">${formatUsd(app.sell_mc, true)}</td><td data-label="持有">${app.hold_seconds === null ? "--" : escapeHtml(formatElapsed(app.hold_seconds))}${app.still_holding ? "（仍持有）" : ""}</td><td data-label="已实现">${formatUsd(app.realized)}</td><td data-label="未实现">${formatUsd(app.unrealized)}</td><td data-label="总盈利">${formatUsd(app.total)}${app.plat_pnl != null ? `<small>平台：${formatUsd(app.plat_pnl)}（${escapeHtml(app.plat_src || "平台")}，以这个为准）</small>` : w.platforms?.length && !app.gmgnSeesTrades ? "<small>GMGN 标了转入，这笔不准</small>" : ""}</td><td data-label="规则">${app.flags.map(libraryLabelText).join("、") || "--"}${app.cluster ? `<small>同源群组 ${escapeHtml(app.cluster.split(":")[0])}</small>` : ""}</td></tr>`).join("")}
      </tbody></table></div>
      <h3>上下游资金关联（只追主币与 USD 稳定币）</h3>
      <p class="muted">${escapeHtml(data.note)}</p>
      ${data.relationRule ? `<p class="muted">${escapeHtml(data.relationRule)}</p>` : ""}
      ${data.spoofRule ? `<p class="muted">${escapeHtml(data.spoofRule)}</p>` : ""}
      <div class="compact-table trace-mobile-cards"><table><thead><tr><th>方向</th><th>地址</th><th>关系</th><th>数量</th><th>时间</th><th>证据</th><th>CA</th></tr></thead><tbody>
      ${[...data.upstream.map((rel) => relRow(rel, "上游")), ...data.downstream.map((rel) => relRow(rel, "下游"))].join("") || '<tr><td colspan="7">没有已记录的资金关联。</td></tr>'}
      </tbody></table></div>
      <h3>共同上游资助的其他地址（${data.sharedFunder.length}，已排除交易所、高频服务钱包、仿冒地址、灰尘转帐和给超过 ${data.funderMax || 20} 个钱包的上游）</h3>
      ${data.sharedFunder.length ? `<ul>${data.sharedFunder.slice(0, 50).map((row) => `<li>${walletCell(row.address, w.chain)} ← ${walletCell(row.via, w.chain)}（${escapeHtml(fullText(row.ca))}）</li>`).join("")}</ul>` : '<p class="muted">无。</p>'}`;
    $("library-detail-close")?.addEventListener("click", () => { panel.hidden = true; });
    $("library-save").addEventListener("click", async () => {
      try {
        await libraryPost("/api/library/update", {
          chain: w.chain, address: w.address,
          manualLabels: $("library-manual").value.split(/[,，]/).map((v) => v.trim()).filter(Boolean),
          removedLabels: [...panel.querySelectorAll("[data-remove-label]:checked")].map((box) => box.dataset.removeLabel),
          note: $("library-note").value,
        });
        showToast("已保存标注");
        document.dispatchEvent(new CustomEvent("wallet-annotated", { detail: { chain: w.chain, address: w.address } }));
        await openLibraryWallet(w.chain, w.address);
        if ($("library-root")) loadLibrary();
      } catch (error) {
        showToast(`保存失败：${error.message}`);
      }
    });
    if (!inDrawer) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    panel.innerHTML = `<p class="trace-data-note">读取失败：${escapeHtml(error.message)}</p>`;
  }
}

const WALLET_LIB_CHAINS = { evm: ["BSC", "Robinhood"], sol: ["Solana"] };
function libChainName(chain) {
  const c = String(chain || "").trim().toLowerCase();
  return c.startsWith("bsc") || c === "bnb" ? "BSC" : c.startsWith("sol") ? "Solana" : c.startsWith("robin") || c === "rh" ? "Robinhood" : "";
}
function linkReviewsHtml(reviews) {
  if (!reviews?.length) return "";
  return `<p>关联判定（你按的）：${reviews.map((r) => `${r.verdict === "yes" ? "✓ 有关联" : "✗ 不是"}「${escapeHtml(r.label)}」（${formatLocalTime(r.at * 1000)}）`).join("、")}</p>`;
}
function sameWalletHtml(same) {
  if (!same?.length) return "";
  return `<p class="muted">同一个地址也在 ${same.map((s) => `${escapeHtml(s.chain)}（出现在 ${s.appearances} 个 CA）`).join("、")}；BSC 和 Robinhood 是同一个钱包，你的标签和备注两边共用。</p>`;
}
let walletEditorSeq = 0;
async function openWalletEditor(address, chain) {
  const drawer = window.Shell?.drawer;
  if (!drawer || !address) return;
  const evm = /^0x/i.test(address);
  const key = evm ? address.toLowerCase() : address;
  const chains = WALLET_LIB_CHAINS[evm ? "evm" : "sol"];
  const preferred = chains.includes(chain) ? chain : chains[0];
  const body = drawer.open("标注钱包");
  const seq = ++walletEditorSeq;
  const stillMine = () => seq === walletEditorSeq && drawer.isOpen && $("drawer-title")?.textContent === "标注钱包";
  const render = async () => {
    body.innerHTML = skeletonBlock(3);
    const found = [];
    let failed = "";
    const get = async (c) => {
      try { found.push(await libraryPost("/api/library/wallet", { chain: c, address: key })); return true; }
      catch (error) { if (!String(error.message).includes("没有这个地址")) failed = failed || error.message; return false; }
    };
    const other = chains.find((c) => c !== preferred);
    if (await get(preferred)) { for (const s of found[0].sameWallet || []) await get(s.chain); }
    else if (other) await get(other);
    const detail = found[0] || null;
    const current = detail?.wallet?.chain || preferred;
    let reviews = detail?.linkReviews;
    if (!reviews) { try { reviews = (await libraryPost("/api/library/link-reviews", { chain: current, address: key })).reviews || []; } catch { reviews = [];  } }
    if (detail) libraryUseRules(detail.rules);
    let own = null;
    try { own = (await libraryPost("/api/library/user-labels/lookup", { addresses: [key] })).labels?.[key] || null; } catch {  }
    if (!stillMine()) return;
    const w = detail?.wallet;
    const auto = [...new Set(found.flatMap((d) => d.wallet.autoLabels || []))];
    const where = found.map((d) => `${d.wallet.chain} 出现在 ${d.appearances.length} 个 CA`).join("、");
    found.forEach((d) => libraryUseCard(d));
    const labelsHtml = found.length > 1
      ? found.map((d) => `<p class="muted">${escapeHtml(d.wallet.chain)} 的标签</p>${libraryCardHtml(d.wallet.card)}${libraryLabelGroupsHtml(d.wallet.labels, d.wallet.manualLabels)}`).join("")
      : w ? libraryCardHtml(w.card) + libraryLabelGroupsHtml(w.labels, w.manualLabels) : "";
    body.innerHTML = `<div class="d-addr"><span class="chain-tag">${escapeHtml(evm ? "BSC／Robinhood" : current)}</span>${plainAddressCell(key)}</div>
      <p class="muted">${failed ? `读取钱包库失败：${escapeHtml(failed)}` : w ? `钱包库：${where}。` : "钱包库还没有这个地址，保存后会添加一笔（只存你的标签和备注）。"}${evm ? " BSC 和 Robinhood 是同一个地址，标签和备注两边共用。" : ""}</p>
      ${own ? `<p>你的私人标签：<strong>${escapeHtml(own.label)}</strong>${own.group && own.group !== own.label ? `（群组 ${escapeHtml(own.group)}）` : ""}</p>` : ""}
      ${labelsHtml}
      ${linkReviewsHtml(reviews)}
      <div class="library-edit">
        <label><span>标签（逗号分隔，例如 庄家, 小号, 聪明钱）</span><input id="wallet-edit-manual" value="${escapeHtml((w?.manualLabels || []).join(", "))}"></label>
        ${auto.length ? `<fieldset><legend>移除自动标签（覆写规则）</legend>${auto.map((label) => `<label><input type="checkbox" data-edit-remove="${escapeHtml(label)}" ${(w?.removedLabels || []).includes(label) ? "checked" : ""}> ${escapeHtml(libraryLabelText(label))}</label>`).join("")}</fieldset>` : ""}
        <label><span>备注</span><textarea id="wallet-edit-note" rows="3">${escapeHtml(w?.note || "")}</textarea></label>
        <div class="wallet-edit-actions"><button class="btn btn-primary" type="button" id="wallet-edit-save"${failed ? " disabled" : ""}>保存到钱包库</button>${w ? '<button class="btn" type="button" id="wallet-edit-full">完整详情</button>' : ""}<a href="./analyze.html?q=${encodeURIComponent(key)}">查这个地址</a></div>
      </div>
      <p class="muted">只存在本机钱包库，不会上传。</p>`;
    $("wallet-edit-full")?.addEventListener("click", () => openLibraryWallet(current, key));
    $("wallet-edit-save")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const saved = await libraryPost("/api/library/update", {
          chain: current, address: key, create: true,
          manualLabels: $("wallet-edit-manual").value.split(/[,，、]/).map((v) => v.trim()).filter(Boolean),
          removedLabels: [...body.querySelectorAll("[data-edit-remove]:checked")].map((box) => box.dataset.editRemove),
          note: $("wallet-edit-note").value,
        });
        showToast(saved.created ? "已添加到钱包库，标注存好了" : "标注存好了");
        document.dispatchEvent(new CustomEvent("wallet-annotated", { detail: { chain: current, address: key } }));
        if ($("library-root")) loadLibrary();
        render();
      } catch (error) {
        button.disabled = false;
        showToast(String(error.message).includes("没有这个地址") ? "这个地址还不在钱包库；要等本机服务重启成新版才能添加" : `保存失败：${error.message}`);
      }
    });
  };
  render();
}
function walletEditChain(el, address) {
  const given = el.dataset.chain || el.closest("[data-chain]")?.dataset.chain || window.__walletContextChain || $("chain")?.value || "";
  const lib = libChainName(given);
  if (/^0x/i.test(address)) return lib === "Solana" ? "" : lib;
  return "Solana";
}
function openWalletEditorFrom(el) {
  openWalletEditor(el.dataset.walletEdit, walletEditChain(el, el.dataset.walletEdit));
}
document.addEventListener("click", (event) => {
  const el = event.target.closest?.("[data-wallet-edit]");
  if (!el || !window.Shell) return;
  if (window.getSelection && String(window.getSelection()).length > 0) return;
  event.preventDefault();
  openWalletEditorFrom(el);
});
document.addEventListener("keydown", (event) => {
  const el = event.target.closest?.("[data-wallet-edit]");
  if (!el || event.target !== el || el.matches("button, a") || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  openWalletEditorFrom(el);
});

const walletStars = { state: new Map(), pending: new Set(), timer: 0, supported: true };
const starKey = (address) => (/^0x/i.test(address) ? address.toLowerCase() : address);
function paintWalletStars() {
  for (const el of document.querySelectorAll("[data-wallet-star]")) {
    const s = walletStars.state.get(starKey(el.dataset.walletStar));
    const mark = s === 1 ? "★" : "☆";
    if (el.textContent !== mark) el.textContent = mark;
    el.classList.toggle("is-on", s === 1);
    el.setAttribute("aria-pressed", String(s === 1));
    const tip = s === 1 ? "追踪中：点一下移出聪明钱名单" : s === -1 ? "已静音：点一下改成追踪" : "加入聪明钱追踪（我的名单）";
    el.title = tip;
    el.setAttribute("aria-label", tip);
  }
}
async function loadWalletStars() {
  walletStars.timer = 0;
  const want = [...new Set([...document.querySelectorAll("[data-wallet-star]")].map((el) => starKey(el.dataset.walletStar)))]
    .filter((key) => !walletStars.state.has(key) && !walletStars.pending.has(key));
  if (want.length && walletStars.supported) {
    want.forEach((key) => walletStars.pending.add(key));
    try {
      for (let i = 0; i < want.length; i += 150) {
        const chunk = want.slice(i, i + 150);
        const response = await fetch("/api/smart/watching", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ addresses: chunk }), cache: "no-store" });
        if (!response.ok) { walletStars.supported = false; break; }
        const data = await response.json();
        const on = new Set(data.watching || []);
        const muted = new Set(data.muted || []);
        for (const key of chunk) walletStars.state.set(key, on.has(key) ? 1 : muted.has(key) ? -1 : 0);
      }
    } catch {  }
    want.forEach((key) => walletStars.pending.delete(key));
  }
  paintWalletStars();
}
new MutationObserver(() => { if (!walletStars.timer) walletStars.timer = setTimeout(loadWalletStars, 120); })
  .observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener("click", async (event) => {
  const el = event.target.closest?.("[data-wallet-star]");
  if (!el) return;
  event.preventDefault();
  const address = el.dataset.walletStar;
  const key = starKey(address);
  const next = walletStars.state.get(key) === 1 ? 0 : 1;
  const chain = !/^0x/i.test(address) ? "sol" : walletEditChain(el, address) === "Robinhood" ? "robinhood" : "bsc";
  el.disabled = true;
  try {
    await libraryPost("/api/smart/watch", { chain, address: key, watch: next });
    walletStars.state.set(key, next);
    paintWalletStars();
    showToast(next === 1 ? "已加入聪明钱追踪（我的名单），会优先评分" : "已移出聪明钱追踪");
  } catch (error) {
    showToast(`追踪失败：${error.message}`);
  } finally {
    el.disabled = false;
  }
});

function applyLinkReviews(v) {
  if (!v || v.baseText === undefined) return v;
  const targets = v.review?.targets || [];
  v.text = v.baseText; v.level = v.baseLevel; v.gmgnText = v.baseGmgnText;
  const yes = targets.filter((t) => t.verdict === "yes");
  const no = targets.filter((t) => t.verdict === "no");
  const names = (list) => list.map((t) => `「${t.label}」`).join("、");
  if (yes.length) {
    v.level = "你确认";
    v.text = `你确认跟${names(yes)}有关联（你判断可能是本人）`;
    v.gmgnText = `原本的判定：${v.baseText}`;
  } else if (no.length && no.length === targets.length) {
    v.level = "无";
    v.text = `你判定跟${names(no)}无关`;
    v.gmgnText = `原本的判定：${v.baseText}`;
  } else if (no.length) {
    v.gmgnText = [v.baseGmgnText, `你判定无关：${names(no)}`].filter(Boolean).join("；");
  }
  return v;
}

async function exportLibrary() {
  try {
    const data = await libraryPost("/api/library/export", {});
    const symbolOf = new Map(data.tokens.map((token) => [`${token.chain}|${token.ca}`, token.symbol]));
    await downloadXlsx(`钱包库_${new Date().toISOString().slice(0, 10)}.xlsx`, [
      { name: "钱包", columns: xlsxColumns([["链", "center", 10], ["完整钱包", "text", 48], ["名称", "text", 20], ["X", "text", 20], ["有效标签", "longText", 36], ["自动标签", "longText", 30], ["手动标签", "longText", 24], ["已移除自动标签", "longText", 24], ["备注", "longText", 36]]),
        rows: data.wallets.map((w) => [w.chain, w.address, w.name, w.twitter ? `https://x.com/${w.twitter}` : "", w.labels.map(libraryLabelText).join(" | "), w.autoLabels.map(libraryLabelText).join(" | "), w.manualLabels.join(" | "), w.removedLabels.map(libraryLabelText).join(" | "), w.note]) },
      { name: "CA出现纪录", columns: xlsxColumns([["链", "center", 10], ["完整钱包", "text", 48], ["CA", "text", 48], ["代币", "center", 12], ["相对开盘进场", "center", 18], ["进场时间", "datetime", 22], ["买入市值USD", "usd", 16], ["卖出市值USD", "usd", 16], ["持有时间", "center", 18], ["仍持有", "center", 8], ["已实现USD", "usd", 14], ["未实现USD", "usd", 14], ["总盈利USD", "usd", 14], ["ROI%", "percent", 10], ["持仓%", "percent", 10], ["早期排名", "integer", 8], ["高盈利排名", "integer", 8], ["GMGN标签", "longText", 30], ["同源群组", "text", 30]]),
        rows: data.appearances.map((a) => [a.chain, a.address, a.ca, a.symbol || symbolOf.get(`${a.chain}|${a.ca}`) || "", a.elapsed === null ? "" : formatElapsed(a.elapsed), a.entry_ts ? a.entry_ts * 1000 : "", a.buy_mc, a.sell_mc, a.hold_seconds === null ? "" : formatElapsed(a.hold_seconds), a.still_holding ? "是" : "否", a.realized, a.unrealized, a.total, a.roi, a.holding_pct, a.early_rank, a.top_profit_rank, JSON.parse(a.gmgn_tags || "[]").join(" | "), a.cluster]) },
      { name: "资金关联", columns: xlsxColumns([["链", "center", 10], ["上游（资助者）", "text", 48], ["下游", "text", 48], ["关系", "center", 14], ["CA", "text", 48], ["资产", "center", 10], ["数量", "assetAmount", 14, 3], ["时间", "datetime", 22], ["交易哈希", "text", 68], ["来源标注", "text", 24], ["公开实体", "center", 8], ["证据", "longText", 40]]),
        rows: data.relations.map((r) => [r.chain, r.src, r.dst, "资金关联（非同一主人）", r.ca, r.asset, r.amount, r.ts ? r.ts * 1000 : "", r.tx_hash, r.src_label, r.public_entity ? "是" : "否", r.evidence]) },
      { name: "平台帐号", columns: xlsxColumns([["链", "center", 10], ["完整钱包", "text", 48], ["平台", "center", 12], ["平台名称", "text", 24], ["X", "text", 24], ["FOMO 粉丝", "integer", 10], ["pump.fun 已验证", "center", 10], ["对上的 CA", "longText", 52], ["最后比对", "datetime", 22]]),
        rows: (data.platformNames || []).map((p) => [p.chain, p.address, p.platform, p.handle, p.x ? `https://x.com/${p.x}` : "", p.followers, p.verified == null ? "" : p.verified ? "是" : "否", (p.cas || []).join(" | "), p.last_seen ? p.last_seen * 1000 : ""]) },
      { name: "规则", columns: xlsxColumns([["标签", "text", 24], ["规则", "longText", 80]]), rows: data.rules.map((rule) => [rule.label, rule.rule]) },
    ], "钱包库");
    showToast("已导出钱包库 XLSX");
  } catch (error) {
    showToast(`导出失败：${error.message}`);
  }
}

function wireLibrary() {
  if (!$("library-root")) return;
  $("library-search")?.addEventListener("submit", (event) => { event.preventDefault(); libraryState.offset = 0; loadLibrary(); });
  $("library-show-quiet")?.addEventListener("change", () => { libraryState.offset = 0; loadLibrary(); });
  $("library-prev")?.addEventListener("click", () => { libraryState.offset = Math.max(0, libraryState.offset - libraryState.limit); loadLibrary(); });
  $("library-next")?.addEventListener("click", () => { libraryState.offset += libraryState.limit; loadLibrary(); });
  $("library-export")?.addEventListener("click", exportLibrary);
  $("user-labels-import")?.addEventListener("click", importUserLabels);
  $("user-labels-export")?.addEventListener("click", exportUserLabels);
  $("library-body")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-library-open]");
    const row = event.target.closest("tr");
    if (!button && (!row || event.target.closest("a, button, [data-copy], [data-wallet-edit], input, textarea"))) return;
    const key = button?.dataset.libraryOpen || row.querySelector("[data-library-open]")?.dataset.libraryOpen;
    if (!key) return;
    const [chain, ...rest] = key.split("|");
    openLibraryWallet(chain, rest.join("|"));
  });
  const presetQ = new URLSearchParams(location.search).get("q");
  if (presetQ && $("library-q")) $("library-q").value = presetQ;
  loadLibrary();
}


const ENTITY_TAG_PATTERN = /exchange|cex|bridge|binance|okx|bybit|coinbase|kucoin|gate|bitget|mexc|htx|huobi|relay|wormhole|stargate|router/i;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function entityLabelOf(address, label = "", tags = []) {
  const known = KNOWN_LABELS[normalizeAddress(address)];
  const knownText = typeof known === "string" ? known : [known?.type, known?.name].filter(Boolean).join(" ");
  if (label) return label;
  if (knownText && ENTITY_TAG_PATTERN.test(knownText)) return knownText;
  const tag = (tags || []).find((value) => ENTITY_TAG_PATTERN.test(String(value)));
  return tag ? `GMGN 标签 ${tag}` : "";
}

async function gmgnIdentityFor(chain, address) {
  const response = await fetchLocalGmgn("identity", chain, address).catch((error) => ({ ok: false, error: error.message, data: {} }));
  const gmgn = normalizeGmgnWalletResult(response);
  return { response, gmgn, record: gmgnIdentityRecord(address, gmgn, response.error || "") };
}

async function traceUpstreamByGmgn(chain, address, firstGmgn, onStatus, maxHops = 6) {
  const hops = [];
  const identities = new Map();
  const gaps = [];
  let currentAddress = address;
  let currentGmgn = firstGmgn;
  for (let depth = 1; depth <= maxHops; depth += 1) {
    const common = currentGmgn?.common || {};
    const funder = String(common.fund_from_address || "").trim();
    if (!funder || !(isEvmAddress(funder) || isSolanaAddress(funder))) {
      if (!currentGmgn?.response?.ok) gaps.push(`第 ${depth} 层：GMGN 未回传 ${fullText(currentAddress)} 的数据（${currentGmgn?.error || "未知原因"}）`);
      break;
    }
    const hop = {
      depth, direction: "上游", from: funder, to: currentAddress, asset: CHAINS[chain]?.native || "主币",
      amount: safeNumber(common.fund_amount), hash: common.fund_tx_hash || "", timestamp: safeNumber(common.fund_from_ts),
      provider: "GMGN 首笔主币入金", entity: entityLabelOf(funder, common.fund_from || ""),
    };
    hops.push(hop);
    if (hop.entity) break;
    if (normalizeAddress(funder) === normalizeAddress(address) || identities.has(normalizeAddress(funder))) break;
    onStatus?.(`正在用 GMGN 往上追第 ${depth + 1} 层资金来源...`);
    const next = await gmgnIdentityFor(chain, funder);
    identities.set(normalizeAddress(funder), next.record);
    const entityByTag = entityLabelOf(funder, "", next.record.tags);
    if (entityByTag) { hop.entity = entityByTag; break; }
    currentAddress = funder;
    currentGmgn = next.gmgn;
    if (depth === maxHops) gaps.push(`已达上游 ${maxHops} 层安全上限`);
  }
  return { hops, identities, gaps };
}

async function traceDownstreamStableLogs(chain, address, onStatus, blockWindow = 50000) {
  const config = CHAINS[chain];
  if (!config?.rpc || !config.stableContracts?.length || !isEvmAddress(address)) return { hops: [], gaps: ["此链未设置公开 RPC 稳定币下游查找"] };
  const latest = await rpcRequest(config.rpc, "eth_getBlockByNumber", ["latest", false]);
  const head = parseInt(latest?.number, 16);
  if (!Number.isFinite(head)) return { hops: [], gaps: ["公开 RPC 无法取得最新区块"] };
  const topicFrom = `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
  const hops = [];
  const gaps = [`下游只查公开 RPC 最近 ${blockWindow.toLocaleString()} 个区块的 USD 稳定币转出；${chain} 主币转出需要 Explorer 付费方案或其他索引来源`];
  const failedChunks = [];
  for (const token of config.stableContracts) {
    onStatus?.(`正在用公开 RPC 查 ${fullText(token)} 稳定币转出...`);
    try {
      const logs = [];
      for (let end = head; end > head - blockWindow; end -= 5000) {
        let lastError = null;
        for (const rpc of [config.rpc, config.rpc, ...(config.rpcs || [])]) {
          try { logs.push(...(await getLogsRange(rpc, { address: token, topics: [TRANSFER_TOPIC, topicFrom] }, Math.max(end - 4999, head - blockWindow + 1), end) || [])); lastError = null; break; } catch (error) { lastError = error; await sleep(800); }
        }
        if (lastError) failedChunks.push(`${end - 4999}-${end}：${lastError.message}`);
      }
      if (failedChunks.length) gaps.push(`稳定币 ${fullText(token)} 有 ${failedChunks.length} 段区块查找失败（${failedChunks[0]}），该段可能漏数据`);
      failedChunks.length = 0;
      (logs || []).forEach((log) => {
        const to = `0x${String(log.topics?.[2] || "").slice(26)}`;
        hops.push({ depth: 1, direction: "下游", from: address, to, asset: token === config.stableContracts[0] ? "USDT" : token === config.stableContracts[1] ? "USDC" : "USD1", amount: Number(BigInt(log.data || "0x0")) / 1e18, hash: log.transactionHash, timestamp: null, block: parseInt(log.blockNumber, 16), provider: "公开 RPC eth_getLogs", entity: entityLabelOf(to) });
      });
    } catch (error) {
      gaps.push(`稳定币 ${fullText(token)} 下游查找失败：${error.message}`);
    }
  }
  return { hops, gaps };
}

function walletHoldingsInsights(gmgnData, now = Math.floor(Date.now() / 1000)) {
  const list = gmgnList(gmgnData?.holdings);
  return list.map((row) => {
    const token = row.token || {};
    const start = safeNumber(row.start_holding_at);
    const end = safeNumber(row.end_holding_at);
    const open = safeNumber(token.open_timestamp) || safeNumber(token.creation_timestamp);
    const balance = safeNumber(row.balance) || 0;
    const stillHolding = balance > 0 && !end;
    const total = safeNumber(row.total_profit);
    return {
      ca: token.token_address || token.address || "", symbol: token.symbol || "?", openTs: open, entryTs: start,
      elapsed: start && open ? start - open : null, holdSeconds: start ? (stillHolding || !end ? now : end) - start : null, stillHolding,
      buyUsd: safeNumber(row.history_bought_cost), sellUsd: safeNumber(row.history_sold_income),
      realized: safeNumber(row.realized_profit), unrealized: safeNumber(row.unrealized_profit), total,
      roi: gmgnPercent(row.total_profit_pnl),
    };
  }).filter((row) => row.ca);
}

let deepNoderealUsage = null;
const PAGE_PARAMS = new URLSearchParams(location.search);
let deepSegmentsOverride = PAGE_PARAMS.get("deep") === "1" ? 30 : 0;
function deepSegments() { return deepSegmentsOverride || 10; }
function notifyParent(stage, extra = {}) {
  document.body.dataset.analysisStage = stage;
  window.dispatchEvent(new CustomEvent("wallet-analysis", { detail: { stage, at: Date.now(), ...extra } }));
  try { if (window.parent !== window) window.parent.postMessage({ type: "wallet-analysis", stage, at: Date.now(), ...extra }, location.origin); } catch {  }
}
async function scanDeeper() {
  if (!runtime.trace) return;
  deepSegmentsOverride = 30;
  const button = $("scan-deeper"); if (button) { button.disabled = true; button.textContent = "正在扫更深（30 段）..."; }
  try {
    runtime.trace.deep = await runDeepWalletTrace(runtime.trace, (message) => setStatus("trace-status", message));
    await attachVerdict(runtime.trace);
    renderDeepTrace(runtime.trace, runtime.trace.deep);
    setStatus("trace-status", "已用 30 段（约 300 万区块）重新扫描完成", "success");
  } catch (error) {
    setStatus("trace-status", `扫更深失败：${error.message}`, "error");
    if (button) { button.disabled = false; button.textContent = "重试扫更深"; }
  }
}

async function runDeepWalletTrace(result, onStatus) {
  const { address, chain } = result;
  const gaps = [];
  if (!GMGN_CHAIN_IDS[chain]) gaps.push(`GMGN 不支持 ${chain}，上游无法用 GMGN 追`);
  const upstream = GMGN_CHAIN_IDS[chain] ? await traceUpstreamByGmgn(chain, address, result.gmgn, onStatus) : { hops: [], identities: new Map(), gaps: [] };
  gaps.push(...upstream.gaps);
  const graphHops = (result.graph?.transfers || []).filter((row) => row.provider !== "GMGN 首笔主币入金" && isFundingAsset(row.asset, chain)).map((row) => ({
    depth: Number(row.depth || 0) + 1, direction: row.direction === "流入" ? "上游" : "下游", from: row.from, to: row.to, asset: row.asset,
    amount: row.amount, hash: row.hash, timestamp: row.timestamp, provider: row.provider || result.graph.provider, entity: entityLabelOf(row.counterparty),
  }));
  let downstream = { hops: [], gaps: [] };
  let nodereal = null;
  if (chain === "BSC") {
    onStatus?.("正在用 NodeReal 查 BSC 主币、稳定币与迷因币转帐（迷因币会做貔貅/垃圾过滤）（每段 10 万区块）...");
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 300000);
      const response = await fetch("/api/nodereal/transfers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, segments: deepSegments() }), signal: controller.signal, cache: "no-store" });
      clearTimeout(timer);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      nodereal = data;
    } catch (error) {
      gaps.push(`NodeReal 查找失败，改用公开 RPC：${error.message}`);
    }
  }
  if (nodereal) {
    const self = normalizeAddress(address);
    const groups = new Map();
    nodereal.transfers.forEach((row) => {
      const out = row.from === self;
      const other = out ? row.to : row.from;
      const key = `${out ? "下游" : "上游"}|${other}|${row.asset}`;
      const group = groups.get(key) || { hashes: [], depth: 1, direction: out ? "下游" : "上游", from: out ? self : other, to: out ? other : self, asset: row.asset, amount: 0, count: 0, hash: row.hash, timestamp: row.timestamp, firstTs: row.timestamp, provider: "NodeReal", isContract: nodereal.contracts?.[other], entity: entityLabelOf(other) };
      group.amount += row.amount; group.count += 1; if (row.hash && group.hashes.length < 20) group.hashes.push(row.hash);
      if (row.timestamp < group.firstTs) group.firstTs = row.timestamp;
      groups.set(key, group);
    });
    const nodeHops = [...groups.values()].sort((a, b) => b.amount - a.amount);
    nodeHops.forEach((hop) => { hop.provider = `NodeReal ${hop.count} 笔${hop.isContract ? "（对手是合约，可能是路由/池子）" : ""}`; });
    upstream.hops.push(...nodeHops.filter((hop) => hop.direction === "上游" && !upstream.hops.some((h) => normalizeAddress(h.from) === normalizeAddress(hop.from) && h.depth === 1)));
    downstream = { hops: nodeHops.filter((hop) => hop.direction === "下游"), gaps: [] };
    gaps.push(`NodeReal 扫描区块 ${nodereal.oldestBlock.toLocaleString()}～${nodereal.head.toLocaleString()}，${nodereal.transfers.length} 笔主币/稳定币转帐，用量约 ${nodereal.usage.cu.toLocaleString()} CU（${nodereal.usage.calls} 次调用）${nodereal.truncated.length ? `；有 ${nodereal.truncated.length} 段超过 3 页未取完` : ""}${nodereal.segmentErrors?.length ? `；${nodereal.segmentErrors.length} 段查找失败（${nodereal.segmentErrors[0]}）` : ""}`);
    deepNoderealUsage = nodereal.usage;
  }
  const hasGraphDownstream = graphHops.some((hop) => hop.direction === "下游");
  if (!nodereal && !hasGraphDownstream && chain !== "Solana" && chain !== "Robinhood") downstream = await traceDownstreamStableLogs(chain, address, onStatus);
  else if (chain === "Robinhood") gaps.push("Robinhood Chain 尚未接入可用的公开转帐索引 API，下游未查");
  else if (chain === "Solana") gaps.push("Solana 下游来自公开 RPC 最近签章，不是完整历史");
  gaps.push(...downstream.gaps);
  const hops = [...upstream.hops, ...graphHops, ...downstream.hops];
  const meme = nodereal?.meme || null;
  if (meme) gaps.push(`迷因币转帐 ${meme.total} 笔：与合约/池子往来 ${meme.swapOrContract} 笔不算；钱包间 ${meme.kept.length} 笔计入证据，${meme.filtered.length} 笔已过滤（${Object.entries(meme.filteredSummary || {}).map(([k, v]) => `${MEME_FILTER_LABELS[k] || k} ${v}`).join("、") || "无"}）`);
  const memePeers = (meme?.peers || []).map((peer) => normalizeAddress(peer.peer));
  const related = [...new Set([...hops.flatMap((hop) => [hop.from, hop.to]), ...memePeers].map((value) => normalizeAddress(value)).filter((value) => value && value !== normalizeAddress(address)))];
  const holdings = walletHoldingsInsights(result.gmgn?.response?.data || {});
  const stats = result.gmgn?.stats || {};
  const realized30d = safeNumber(stats.realized_profit);
  const bigEarner = (realized30d || 0) >= 10000 || holdings.some((row) => (row.total || 0) >= 10000);
  const earlyLong = earlyLongHoldings(holdings);
  const identityMap = new Map([...(result.identities || []).map((identity) => [normalizeAddress(identity.address), identity]), ...upstream.identities]);
  const self = gmgnIdentityRecord(address, result.gmgn);
  const payload = {
    chain, target: address,
    wallets: [{ address, name: self.name, twitter: self.twitter, gmgnTags: self.tags },
      ...related.map((value) => { const id = identityMap.get(value); return { address: value, name: id?.name || "", twitter: id?.twitter || "", gmgnTags: id?.tags || [] }; })],
    appearances: holdings.map((row) => ({ address, ...row, source: "GMGN 钱包持仓（依盈利前 50）" })),
    relations: [...(meme?.kept || []).map((row) => ({ type: "meme_transfer", src: row.from, dst: row.to, asset: row.symbol, amount: row.amount, txHash: row.hash, ts: row.timestamp, provider: "NodeReal 迷因币转帐（已过滤垃圾/貔貅/投毒）", evidence: `迷因币转帐 ${row.symbol} ${row.token}，约 $${row.usd}；发送方亲自发起、${row.securitySource || ""} 安全检查通过；相关，不代表同一主人` })), ...hops.map((hop) => ({ type: hop.direction === "上游" ? "funding" : "transfer_out", src: hop.from, dst: hop.to, asset: hop.asset, amount: hop.amount, txHash: hop.hash, ts: hop.timestamp, provider: hop.provider, srcLabel: hop.direction === "上游" ? hop.entity : "", dstLabel: hop.direction === "下游" ? hop.entity : "", publicEntity: Boolean(hop.entity), evidence: `${hop.provider}：第 ${hop.depth} 层${hop.direction}，${hop.amount ?? "?"} ${hop.asset}${hop.entity ? `（公开实体：${hop.entity}，停止往外追）` : ""}` }))],
  };
  let library = null;
  try {
    library = await libraryPost("/api/library/trace-ingest", payload);
  } catch (error) {
    gaps.push(`钱包库写入失败：${error.message}`);
  }
  return { hops, related, holdings, earlyLong, realized30d, pnlStat: stats.pnl_stat || null, bigEarner, gaps, library, identityMap, meme };
}


const KOL_TAGS = new Set(["kol", "renowned"]);
function isTaggedIdentity(id, lib) {
  const tags = (id?.tags || []).map((t) => String(t).toLowerCase());
  return Boolean(id?.twitter || lib?.twitter || tags.some((t) => KOL_TAGS.has(t)) || (lib?.labels || []).includes("kol"));
}
async function buildGmgnVerdict(result, deep) {
  const chain = result.chain;
  const me = normalizeAddress(result.address);
  const txLink = (hash) => ({ hash, href: explorerTxLink(chain, hash) });
  const self = gmgnIdentityRecord(result.address, result.gmgn);
  const selfTags = self.tags.map((t) => t.toLowerCase());
  if (self.twitter || selfTags.some((t) => KOL_TAGS.has(t))) {
    const label = `${self.name || self.twitter || "GMGN KOL 标签钱包"}${self.twitter ? `（@${self.twitter.replace(/^@/, "")}）` : ""}`;
    return { level: "确认", chain, address: result.address, text: `本人钱包：${label}`, twitter: self.twitter, bullets: [{ text: `GMGN 公开数据直接标示此地址：名称 ${self.name || "—"}、X ${self.twitter ? `@${self.twitter}` : "—"}、标签 ${self.tags.join("、") || "—"}` }], checked: "GMGN 公开钱包数据" };
  }
  const libBy = new Map((deep.library?.lookup || []).map((row) => [normalizeAddress(row.address), row]));
  const peers = new Map();
  const peer = (a) => { const k = normalizeAddress(a); if (!peers.has(k)) peers.set(k, { address: k, up: [], down: [], meme: null }); return peers.get(k); };
  deep.hops.forEach((hop) => {
    if (hop.entity || hop.isContract || hop.depth !== 1) return;
    const other = normalizeAddress(hop.direction === "上游" ? hop.from : hop.to);
    if (!other || other === me) return;
    peer(other)[hop.direction === "上游" ? "up" : "down"].push(hop);
  });
  (deep.meme?.peers || []).forEach((p) => {
    const rows = (deep.meme.kept || []).filter((r) => normalizeAddress(r.from) === normalizeAddress(p.peer) || normalizeAddress(r.to) === normalizeAddress(p.peer));
    peer(p.peer).meme = { ...p, rows };
  });
  const list = [...peers.values()];
  const need = list.filter((p) => !deep.identityMap.get(p.address)).sort((a, b) => (b.up.length + b.down.length + (b.meme?.count || 0)) - (a.up.length + a.down.length + (a.meme?.count || 0))).slice(0, 8);
  await mapWithConcurrency(need, 2, async (p) => { try { const n = await gmgnIdentityFor(chain, p.address); deep.identityMap.set(p.address, n.record); } catch {  } });
  const candidates = list.map((p) => {
    const id = deep.identityMap.get(p.address) || {};
    const lib = libBy.get(p.address);
    if (!isTaggedIdentity(id, lib)) return null;
    const upN = p.up.reduce((s, h) => s + (h.count || 1), 0);
    const downN = p.down.reduce((s, h) => s + (h.count || 1), 0);
    const memeIn = p.meme?.in || 0, memeOut = p.meme?.out || 0;
    const bidir = (upN > 0 && downN > 0) || (memeIn > 0 && memeOut > 0) || ((upN || memeIn) > 0 && (downN || memeOut) > 0);
    const same = (p.meme?.signals || []).some((s) => s.startsWith("同额退回"));
    const total = upN + downN + (p.meme?.count || 0);
    const repeat = total >= 3;
    const strong = [bidir, same, repeat].filter(Boolean).length;
    const level = strong >= 2 ? "高" : strong === 1 ? "中" : "低";
    const twitter = (id.twitter || lib?.twitter || "").replace(/^@/, "");
    const name = id.name || lib?.name || "";
    const tagText = [...new Set([...(id.tags || []), ...(lib?.labels || []).map(libraryLabelText)])].join("、");
    const bullets = [];
    const sum = (hs) => Object.entries(hs.reduce((m, h) => { m[h.asset] = (m[h.asset] || 0) + (h.amount || 0); return m; }, {})).map(([a, v]) => `${formatNumber(v, 4)} ${a}`).join("、");
    const hashesOf = (hs) => [...new Set(hs.flatMap((h) => h.hashes?.length ? h.hashes : h.hash ? [h.hash] : []))].slice(0, 6).map(txLink);
    if (upN) bullets.push({ text: `对方 → 此钱包：${upN} 笔，共 ${sum(p.up)}`, txs: hashesOf(p.up) });
    if (downN) bullets.push({ text: `此钱包 → 对方：${downN} 笔，共 ${sum(p.down)}`, txs: hashesOf(p.down) });
    if (p.meme) bullets.push({ text: `迷因币往来（已过滤垃圾/貔貅/投毒）：${p.meme.count} 笔（转出 ${p.meme.out}、转入 ${p.meme.in}），约 ${formatUsd(p.meme.usd)}，代币 ${p.meme.tokens.join("、")}${p.meme.signals.length ? `；${p.meme.signals.join("；")}` : ""}`, txs: [...new Set(p.meme.rows.map((r) => r.hash))].slice(0, 6).map(txLink) });
    bullets.push({ text: `信号：双向流动 ${bidir ? "有" : "无"}、同额退回 ${same ? "有" : "无"}、重复转帐 ${total} 笔${repeat ? "（≥3）" : ""}` });
    return { address: p.address, name, twitter, tagText, level, strong, total, bullets };
  }).filter(Boolean).sort((a, b) => b.strong - a.strong || b.total - a.total);
  const checked = `此钱包 GMGN 标签（${self.tags.join("、") || "无"}）、${list.length} 个直接往来钱包的 GMGN/钱包库标签（交易所、跨链桥、路由/合约、空投与投毒不计）`;
  if (!candidates.length) return { level: "无", chain, address: result.address, text: "查无公开身分线索", bullets: [], checked };
  const best = candidates[0];
  const label = `${best.twitter ? `${best.name || best.twitter}（@${best.twitter}）` : best.name || "GMGN 标签钱包"}`;
  const text = best.level === "低" ? `与 KOL ${label} 有单次资金往来，疑似关联（证据弱）` : `疑似 KOL ${label} 的关联钱包（小号/分仓）`;
  return { level: best.level, chain, address: result.address, text, peer: best.address, peerLabel: label, peerTags: best.tagText, twitter: best.twitter, bullets: best.bullets, others: candidates.slice(1, 4).map((c) => ({ address: c.address, label: c.twitter ? `${c.name || c.twitter}（@${c.twitter}）` : c.name || c.tagText, level: c.level })), checked };
}
async function attachVerdict(trace) {
  try { trace.deep.verdict = await buildIdentityVerdict(trace, trace.deep); }
  catch (error) { trace.deep.verdict = { level: "无", chain: trace.chain, address: trace.address, text: `身分判定失败：${error.message}`, bullets: [], checked: "—" }; }
  notifyParent("verdict", { verdict: trace.deep.verdict });
}

const USER_ROLE_NAMES = { alt: "小号", relay: "中转", bundle: "捻/绑", insider: "内幕", dealer: "庄/阴谋", fomo: "FOMO", high_profit: "高营利", own: "你自己" };
async function buildIdentityVerdict(result, deep) {
  const me = normalizeAddress(result.address);
  const sides = new Map();
  deep.hops.forEach((hop) => { const other = normalizeAddress(hop.direction === "上游" ? hop.from : hop.to); if (other && other !== me) { const s = sides.get(other) || { dirs: new Set(), depth: hop.depth, hashes: [] }; s.dirs.add(hop.direction); s.depth = Math.min(s.depth, hop.depth); (hop.hashes?.length ? hop.hashes : hop.hash ? [hop.hash] : []).forEach((h) => s.hashes.length < 4 && s.hashes.push(h)); sides.set(other, s); } });
  (deep.meme?.peers || []).forEach((p) => { const k = normalizeAddress(p.peer); const s = sides.get(k) || { dirs: new Set(), depth: 1, hashes: [] }; if (p.in) s.dirs.add("上游"); if (p.out) s.dirs.add("下游"); s.meme = p; sides.set(k, s); });
  let labels = {};
  try { const r = await fetch("/api/library/user-labels/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ addresses: [me, ...sides.keys()] }) }); labels = (await r.json()).labels || {}; } catch {  }
  const base = await buildGmgnVerdict(result, deep);
  const roleText = (l) => (l.roles || []).filter((r) => r !== "own").map((r) => USER_ROLE_NAMES[r] || r).join("、");
  const peerBullets = [...sides.entries()].filter(([a]) => labels[a]).map(([a, s]) => {
    const l = labels[a];
    const dir = [...s.dirs].map((d) => d === "上游" ? "上游" : "下游").join("＋");
    return { text: `${dir}（第 ${s.depth} 层）是你标的「${l.label}」${l.own ? "（你自己的钱包）" : `（群组 ${l.group}${l.suspected ? "，疑似" : ""}${roleText(l) ? `，${roleText(l)}` : ""}）`}${s.meme ? `；迷因币往来 ${s.meme.count} 笔` : ""}：${a}`, txs: s.hashes.map((h) => ({ hash: h, href: explorerTxLink(result.chain, h) })), group: l.group, own: l.own, address: a };
  });
  const own = labels[me]?.source === REVIEW_LABEL_SOURCE ? null : labels[me];
  const out = { ...base, userPeers: peerBullets };
  if (own) {
    out.userLabel = own;
    out.level = "你的标签";
    out.text = own.own ? `你的标签：${own.label}（你自己的钱包）` : `你的标签：${own.label}${own.group && own.group !== own.label ? `（群组 ${own.group}）` : ""}${own.suspected ? "（你标为疑似）" : ""}`;
    out.gmgnText = base.level !== "无" ? `GMGN/链上：${base.text}（信心 ${base.level}）` : "";
  } else if (peerBullets.length) {
    const groups = [...new Set(peerBullets.filter((b) => !b.own).map((b) => b.group))];
    if (groups.length) out.text = `${base.level === "无" ? "" : `${base.text}；`}与你标的群组「${groups.join("、")}」有资金/代币往来，疑似关联`;
    if (base.level === "无" || base.level === "低") out.level = groups.length ? "中" : base.level;
  }
  out.bullets = [...peerBullets.map(({ text, txs }) => ({ text, txs })), ...(base.bullets || [])];
  out.checked = `你的私人标签（${Object.keys(labels).length} 个命中）、${base.checked}`;
  out.baseText = out.text; out.baseLevel = out.level; out.baseGmgnText = out.gmgnText;
  out.review = await linkReviewTargets(result.chain, me, own, peerBullets, base);
  return applyLinkReviews(out);
}
const REVIEW_LABEL_SOURCE = "你确认的关联";
async function linkReviewTargets(chainName, me, own, peerBullets, base) {
  const chain = libChainName(chainName) || (/^0x/i.test(me) ? "BSC" : "");
  if (!chain) return null;
  let saved;
  try {
    const r = await fetch("/api/library/link-reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chain, address: me }) });
    if (!r.ok) return null;
    saved = (await r.json()).reviews || [];
  } catch { return null; }
  const targets = new Map();
  const add = (kind, target, label) => { const key = `${kind}:${target}`; if (!targets.has(key)) targets.set(key, { kind, target, label, verdict: null }); return targets.get(key); };
  if (!own) {
    peerBullets.filter((b) => !b.own && b.group).forEach((b) => add("group", b.group, b.group));
    if (base.peer && base.level !== "无" && base.level !== "确认") add("wallet", normalizeAddress(base.peer), base.peerLabel || base.peer);
  }
  saved.forEach((r) => Object.assign(add(r.kind, r.target, r.label), { label: r.label, verdict: r.verdict, at: r.at }));
  return targets.size ? { chain, address: me, targets: [...targets.values()] } : null;
}
async function setLinkReview(v, target, verdict) {
  const saved = await libraryPost("/api/library/link-review", { chain: v.review.chain, address: v.review.address, kind: target.kind, target: target.target, label: target.label, verdict });
  v.review.targets.forEach((t) => { const r = saved.reviews.find((x) => x.kind === t.kind && x.target === t.target); t.verdict = r ? r.verdict : null; t.at = r?.at; });
  document.dispatchEvent(new CustomEvent("wallet-annotated", { detail: { chain: saved.chain, address: saved.address } }));
  return { verdict: applyLinkReviews(v), created: saved.created };
}
async function importUserLabels() {
  const out = $("user-labels-result");
  const text = $("user-labels-text").value;
  if (!text.trim()) { out.textContent = "请先粘贴标签清单。"; return; }
  out.textContent = "导入中...";
  try {
    const d = await libraryPost("/api/library/user-labels/import", { text, replace: $("user-labels-replace").checked });
    out.innerHTML = `导入 ${d.imported} 笔（EVM ${d.evm}、SOL ${d.sol}；你自己的 ${d.own}、疑似 ${d.suspected}），库内共 ${d.totalInLibrary} 笔。重复 ${d.duplicates.length}、冲突 ${d.conflicts.length}、无效 ${d.invalid.length}。<br>群组：${Object.entries(d.groups).slice(0, 40).map(([g, n]) => `${escapeHtml(g)} ${n}`).join("、")}${d.conflicts.length ? `<br>冲突（已合并标签）：${d.conflicts.map((c) => `${escapeHtml(c.address)}：${c.labels.map(escapeHtml).join(" / ")}`).join("<br>")}` : ""}${d.invalid.length ? `<br>无效：${d.invalid.map((r) => `第 ${r.line} 行 ${escapeHtml(r.text)}（${escapeHtml(r.reason)}）`).join("<br>")}` : ""}`;
    $("user-labels-text").value = "";
  } catch (error) { out.textContent = `导入失败：${error.message}`; }
}
async function exportUserLabels() {
  try {
    const d = await libraryPost("/api/library/user-labels/export", {});
    const blob = new Blob(["\ufeffaddress\tlabel\tgroup\tsuspected\troles\town\n" + d.rows.map((r) => [r.address, r.label, r.group, r.suspected ? 1 : 0, r.roles.join("|"), r.own ? 1 : 0].join("\t")).join("\n")], { type: "text/tab-separated-values" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "my-private-labels.tsv"; a.click();
    $("user-labels-result").textContent = `已导出 ${d.rows.length} 笔（私人文件，请勿上传）。`;
  } catch (error) { $("user-labels-result").textContent = `导出失败：${error.message}`; }
}
function renderVerdictHtml(v) {
  if (!v) return "";
  const lv = { 你的标签: "high", 确认: "high", 高: "high", 中: "medium", 低: "low", 无: "low" }[v.level] || "low";
  const bullets = v.bullets.map((b) => `<li>${escapeHtml(b.text)}${b.txs?.length ? `<br>${b.txs.map((t) => `<a href="${escapeHtml(t.href)}" target="_blank" rel="noreferrer"><code class="full-address">${escapeHtml(t.hash)}</code></a>`).join("<br>")}` : ""}</li>`).join("");
  return `<div class="owner-card verdict-card"><header><span>身分判定</span><i class="trace-confidence ${lv}">信心：${escapeHtml(v.level)}</i></header><p class="verdict-text"><strong>${escapeHtml(v.text)}</strong></p>${v.gmgnText ? `<p>${escapeHtml(v.gmgnText)}</p>` : ""}${v.peer ? `<p>关联 KOL 钱包：${walletCell(v.peer)}${v.peerTags ? `（标签：${escapeHtml(v.peerTags)}）` : ""}</p>` : ""}${bullets ? `<ul>${bullets}</ul>` : ""}${v.others?.length ? `<p class="trace-data-note">其他有标签的往来钱包：${v.others.map((o) => `${walletCell(o.address)} ${escapeHtml(o.label)}（${o.level}）`).join("；")}</p>` : ""}<p class="trace-data-note">已检查：${escapeHtml(v.checked)}。资金/代币往来只代表「相关」，不代表同一主人；KOL 只采 GMGN 公开标签。</p></div>`;
}

const MEME_FILTER_LABELS = { system: "铸造/销毁地址", spam: "垃圾/空投", honeypot: "貔貅", poisoning: "地址投毒", dust: "低于金额门槛", unchecked: "无法验证" };
function renderMemeEvidence(deep) {
  const meme = deep.meme;
  if (!meme) return "";
  const row = (r, filtered) => `<tr${filtered ? ' class="muted"' : ""}><td data-label="时间">${formatLocalTime(r.timestamp * 1000)}</td><td data-label="方向">${walletCell(r.from)} → ${walletCell(r.to)}</td><td data-label="代币"><strong>${escapeHtml(r.symbol)}</strong><small>${plainAddressCell(r.token)}</small></td><td data-label="数量">${formatNumber(r.amount, 4)}</td><td data-label="约值">${formatUsd(r.usd)}</td><td data-label="判定">${filtered ? `已过滤：${escapeHtml(MEME_FILTER_LABELS[r.filterKind] || r.filterKind)}（不计入）<small>${r.reasons.map(escapeHtml).join("；")}</small>` : `计入（${escapeHtml(r.securitySource || "")} 通过）${r.note ? `<small>${escapeHtml(r.note)}</small>` : ""}`}</td><td data-label="交易">${plainAddressCell(r.hash)}</td></tr>`;
  const head = '<thead><tr><th>时间</th><th>方向</th><th>代币</th><th>数量</th><th>约值</th><th>判定</th><th>交易</th></tr></thead>';
  const peers = meme.peers.map((p) => `<li>${walletCell(p.peer)} 相关（迷因币往来）：${p.count} 笔（转出 ${p.out}、转入 ${p.in}），约 ${formatUsd(p.usd)}，代币 ${p.tokens.map(escapeHtml).join("、")}${p.signals.length ? `；强信号：${p.signals.map(escapeHtml).join("；")}` : ""}</li>`).join("");
  return `<h3>迷因币转帐（计入 ${meme.kept.length} 笔，过滤掉 ${meme.filtered.length} 笔）</h3>
    ${peers ? `<ul>${peers}</ul>` : '<p class="muted">没有通过过滤的迷因币往来。</p>'}
    ${meme.kept.length ? `<div class="compact-table trace-mobile-cards"><table>${head}<tbody>${meme.kept.map((r) => row(r, false)).join("")}</tbody></table></div>` : ""}
    ${meme.filtered.length ? `<details><summary>已过滤（垃圾/貔貅/投毒，不计入）${meme.filtered.length} 笔</summary><div class="compact-table trace-mobile-cards"><table>${head}<tbody>${meme.filtered.slice(0, 200).map((r) => row(r, true)).join("")}</tbody></table></div></details>` : ""}
    <details class="footnote"><summary>哪些转帐会计入</summary><p class="trace-data-note">钱包对钱包、由发送方自己发起、有流动性和价格（DexScreener）、通过貔貅检查（GoPlus，失败改用 Honeypot.is：无法卖出、卖税超过 10%、黑名单都算貔貅）、价值至少 $${meme.threshold}，并排除地址投毒。只代表「相关」，不代表同一个主人。</p></details>`;
}

function renderDeepTrace(result, deep) {
  const overview = $("deep-overview");
  if (!overview) return;
  const libBy = new Map((deep.library?.lookup || []).map((row) => [normalizeAddress(row.address), row]));
  const chain = result.chain;
  const hopRows = deep.hops.map((hop) => {
    const other = hop.direction === "上游" ? hop.from : hop.to;
    const lib = libBy.get(normalizeAddress(other));
    const id = deep.identityMap.get(normalizeAddress(other));
    return `<tr><td class="num">${hop.depth}</td><td>${hop.direction}</td><td>${walletCell(other)}${id?.twitter ? `<small>${xProfileLink(id.twitter, id.name || `@${id.twitter}`)}（GMGN）</small>` : ""}${hop.entity ? `<small>公开实体：${escapeHtml(hop.entity)}（停止）</small>` : ""}</td><td class="num">${formatNumber(hop.amount, 3)} ${escapeHtml(hop.asset)}</td><td>${hop.firstTs && hop.firstTs !== hop.timestamp ? `${formatLocalTime(hop.firstTs * 1000)}～` : ""}${hop.timestamp ? formatLocalTime(hop.timestamp * 1000) : hop.block ? `区块 ${hop.block}` : "--"}</td><td>${lib ? `相关：${libraryLabelTags(lib.labels)}${lib.caCount ? `<small>库内 ${lib.caCount} 个 CA</small>` : ""}` : '<span class="muted">库内无</span>'}</td><td>${escapeHtml(hop.provider)}${hop.hash ? `<small><a href="${escapeHtml(explorerTxLink(chain, hop.hash))}" target="_blank" rel="noreferrer"><code class="full-address">${escapeHtml(hop.hash)}</code></a>${copyButton(hop.hash)}</small>` : ""}</td></tr>`;
  }).join("");
  const flaggedRelated = (deep.library?.lookup || []).filter((row) => normalizeAddress(row.address) !== normalizeAddress(result.address) && row.labels.length);
  overview.innerHTML = walletOverviewHtml(result, deep);
  setText("wp-funds-count", deep.hops.length ? String(deep.hops.length) : "");
  setText("wp-meme-count", deep.meme?.kept?.length ? String(deep.meme.kept.length) : "");
  const funds = $("deep-funds");
  if (funds) funds.innerHTML = `<section class="trace-section"><h3>资金路径</h3>
    <p class="trace-data-note">${deep.hops.length} 笔，相关地址 ${deep.related.length} 个。点一列看完整证据。</p>
    ${hopRows ? `<div class="compact-table"><table><thead><tr><th>层</th><th>方向</th><th>地址</th><th>数量</th><th>时间</th><th>钱包库</th><th>证据</th></tr></thead><tbody>${hopRows}</tbody></table></div>` : '<div class="trace-empty-card"><strong>没有取得可验证的资金路径</strong><span>缺口原因在「概况」的数据涵盖与缺口。</span></div>'}
    ${chain === "BSC" ? `<p class="trace-data-note">目前扫描 ${deepSegments()} 段（每段 10 万区块，约 ${(deepSegments() * 100000 * 0.75 / 86400).toFixed(0)} 天）。${deepSegments() < 30 ? ' <button type="button" class="btn btn-sm" id="scan-deeper">扫更深（30 段，约 3 倍 NodeReal 用量）</button>' : ""}</p>` : ""}
  </section>`;
  const meme = $("deep-meme");
  if (meme) meme.innerHTML = renderMemeEvidence(deep) || `<div class="trace-empty-card"><strong>没有迷因币转帐数据</strong><span>${chain === "BSC" ? "NodeReal 没有回传迷因币转帐。" : `迷因币转帐目前只查 BSC；${escapeHtml(chain)} 没有这一层数据。`}</span></div>`;
  const flagged = $("deep-flagged");
  if (flagged) flagged.innerHTML = `<section class="trace-section"><h3>与钱包库标记地址相关（${flaggedRelated.length}）</h3>
    ${flaggedRelated.length ? `<ul>${flaggedRelated.map((row) => `<li>${walletCell(row.address)} 相关（资金关联）：${libraryLabelTags(row.labels)}</li>`).join("")}</ul>` : '<p class="trace-data-note">路径上的地址目前没有库内标签。</p>'}
  </section>`;
  const notes = $("deep-notes");
  if (notes) notes.innerHTML = `${deep.library ? `<p>已写入钱包库：${deep.library.stored} 个地址、${deep.library.appearances} 笔 CA 纪录、${deep.library.relations} 条资金关联。</p>` : ""}${deep.gaps.length ? `<p>数据缺口：${deep.gaps.map(escapeHtml).join("；")}</p>` : ""}`;
  if (!$("verdict-card")) overview.insertAdjacentHTML("afterbegin", renderVerdictHtml(deep.verdict));
}
document.addEventListener("click", (event) => { if (event.target?.id === "scan-deeper") scanDeeper(); });

async function autoRunFromParams() {
  const ca = PAGE_PARAMS.get("ca");
  const wallet = PAGE_PARAMS.get("wallet");
  const chain = PAGE_PARAMS.get("chain");
  if (PAGE_PARAMS.get("embed") === "1") document.body.classList.add("embedded");
  const chainSelect = $("chain");
  if (chain && chainSelect && [...chainSelect.options].some((o) => (o.value || o.textContent) === chain)) chainSelect.value = chain;
  if (ca && $("contract")) {
    $("contract").value = ca;
    notifyParent("running");
    await runCaScan();
    notifyParent("done", { ok: runtime.scan?.status === "complete" });
  } else if (wallet && $("trace-wallet")) {
    $("trace-wallet").value = wallet;
    notifyParent("running");
    await runSourceTrace();
    notifyParent("done", { ok: Boolean(runtime.trace?.deep) });
  }
}

function initialize() {
  wireTheme();
  wireExplorerKeyStorage();
  wireCopy();
  wireClusterExpand();
  wireNavigation();
  wireCurrency();
  wireBackToTop();
  $("scan-form")?.addEventListener("submit", runCaScan);
  $("source-trace-form")?.addEventListener("submit", runSourceTrace);
  $("contract")?.addEventListener("input", updateChainHint);
  $("chain")?.addEventListener("change", updateChainHint);
  $("export-report")?.addEventListener("click", exportCaReport);
  $("trace-export-report")?.addEventListener("click", exportTraceReport);
  if ($("scan-form")) clearScanView();
  wireLibrary();
  fetchNativePrices().catch(() => undefined);
  autoRunFromParams().catch((error) => notifyParent("done", { ok: false, error: error.message }));
}

initialize();
