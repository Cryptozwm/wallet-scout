
from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import wallet_library
import user_labels
import platform_match
import smart_money
import ext_api
import fomo_board
import library_bulk
from oss_config import DATA_DIR


ROOT = Path(__file__).resolve().parent
DEFAULT_NODE = "node"
DEFAULT_PNPM = "pnpm"
NODE_EXECUTABLE = Path(os.environ.get("NODE_EXECUTABLE") or shutil.which("node") or DEFAULT_NODE)
NODE_DIR = NODE_EXECUTABLE.parent
PNPM = Path(os.environ.get("PNPM_EXECUTABLE") or shutil.which("pnpm.cmd") or shutil.which("pnpm") or DEFAULT_PNPM)
NPX = shutil.which("npx.cmd") or shutil.which("npx")
GMGN_CHAINS = {"sol", "bsc", "base", "eth", "robinhood", "arc", "stable"}
EVM_ADDRESS = re.compile(r"^0x[a-fA-F0-9]{40}$")
SOLANA_ADDRESS = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
CLI_LOCK = threading.Lock()
CLI_WEIGHT = {("token", "holders"): 5, ("token", "traders"): 5, ("portfolio", "stats"): 3, ("portfolio", "activity"): 3,
              ("portfolio", "profits"): 3, ("portfolio", "info"): 2, ("portfolio", "holdings"): 2,
              ("portfolio", "token-balance"): 2, ("portfolio", "created-tokens"): 2}
CLI_RESET = re.compile(r"~(\d+)s remaining")
MANUAL_MAX_WAIT = 15
CACHE_LOCK = threading.Lock()
CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
CREDENTIAL_LOCK = threading.RLock()
CREDENTIAL_DIR = DATA_DIR / "private"
CREDENTIAL_FILE = CREDENTIAL_DIR / "credentials.dpapi"
EXPLORER_CHAINS = {
    "ETH": "1",
    "BSC": "56",
    "Base": "8453",
    "Arbitrum": "42161",
}
EXPLORER_ACTIONS = {"txlist", "tokentx", "getblocknobytime"}
SOLANA_RPC_URLS = (
    "https://solana-rpc.publicnode.com",
    "https://api.mainnet-beta.solana.com",
)
SOLANA_RPC_METHODS = {"getSignaturesForAddress", "getTransaction"}
EVM_RPC_URLS = {
    "https://ethereum-rpc.publicnode.com",
    "https://eth.llamarpc.com",
    "https://1rpc.io/eth",
    "https://eth.drpc.org",
    "https://bsc-rpc.publicnode.com",
    "https://bnb.rpc.subquery.network/public",
    "https://bsc.drpc.org",
    "https://base-rpc.publicnode.com",
    "https://mainnet.base.org",
    "https://1rpc.io/base",
    "https://arbitrum-one-rpc.publicnode.com",
    "https://arb1.arbitrum.io/rpc",
}
EVM_RPC_METHODS = {"eth_getBlockByNumber", "eth_getLogs", "eth_call", "eth_getCode", "eth_getBalance"}
DEX_CHAIN_IDS = {"ETH": "ethereum", "BSC": "bsc", "Base": "base", "Arbitrum": "arbitrum", "Solana": "solana"}
BINANCE_CHAIN_IDS = {"ETH": "1", "BSC": "56", "Base": "8453", "Solana": "CT_501"}
RELAY_CHAIN_NAMES = {
    1: "ETH",
    10: "Optimism",
    56: "BSC",
    137: "Polygon",
    8453: "Base",
    42161: "Arbitrum",
    43114: "Avalanche",
    792703809: "Solana",
}


class DataBlob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_ulong), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


def dpapi_crypt(data: bytes, decrypt: bool = False) -> bytes:
    if os.name != "nt":
        return data
    buffer = ctypes.create_string_buffer(data)
    source = DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    destination = DataBlob()
    function = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    if decrypt:
        ok = function(ctypes.byref(source), None, None, None, None, 0, ctypes.byref(destination))
    else:
        ok = function(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(destination))
    if not ok:
        raise OSError("Windows DPAPI 无法处理本机凭证")
    try:
        return ctypes.string_at(destination.pbData, destination.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(destination.pbData)


def load_credentials() -> dict[str, str]:
    with CREDENTIAL_LOCK:
        if not CREDENTIAL_FILE.exists():
            return {}
        try:
            decrypted = dpapi_crypt(CREDENTIAL_FILE.read_bytes(), decrypt=True)
            value = json.loads(decrypted.decode("utf-8"))
            return {key: str(item) for key, item in value.items() if item}
        except (OSError, ValueError, json.JSONDecodeError):
            return {}


def save_credentials(changes: dict[str, str | None]) -> dict[str, str]:
    with CREDENTIAL_LOCK:
        current = load_credentials()
        for key, value in changes.items():
            if value:
                current[key] = value.strip()
            elif value is None:
                current.pop(key, None)
        CREDENTIAL_DIR.mkdir(parents=True, exist_ok=True)
        encrypted = dpapi_crypt(json.dumps(current, ensure_ascii=False).encode("utf-8"))
        temporary = CREDENTIAL_FILE.with_suffix(".tmp")
        temporary.write_bytes(encrypted)
        temporary.replace(CREDENTIAL_FILE)
        return current


def gmgn_global_configured() -> bool:
    return (Path.home() / ".config" / "gmgn" / ".env").exists()


def gmgn_api_key() -> str:
    key = load_credentials().get("gmgnApiKey", "")
    if key:
        return key
    try:
        for line in (Path.home() / ".config" / "gmgn" / ".env").read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("GMGN_API_KEY="):
                return line.split("=", 1)[1].strip().strip("\"'")
    except OSError:
        pass
    return ""


def is_valid_address(chain: str, address: str) -> bool:
    if chain == "sol":
        return bool(SOLANA_ADDRESS.fullmatch(address))
    return bool(EVM_ADDRESS.fullmatch(address))


def cached(key: str) -> dict[str, Any] | None:
    with CACHE_LOCK:
        item = CACHE.get(key)
        if not item or item[0] <= time.time():
            CACHE.pop(key, None)
            return None
        return item[1]


def put_cache(key: str, value: dict[str, Any], ttl: int) -> None:
    with CACHE_LOCK:
        CACHE[key] = (time.time() + ttl, value)


def parse_cli_json(stdout: str) -> Any:
    for line in reversed([line.strip() for line in stdout.splitlines() if line.strip()]):
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            continue
    raise RuntimeError("GMGN CLI 未回传可解析的 JSON")


def gmgn(command: list[str], api_key: str = "", timeout: int = 75, max_wait: float | None = MANUAL_MAX_WAIT) -> Any:
    if not PNPM.exists() and not NPX:
        raise RuntimeError("找不到 pnpm 或 npx；请安装 Node.js（自带 npx）或 pnpm，或设置 PNPM_EXECUTABLE")
    smart_money.limiter().reserve(CLI_WEIGHT.get(tuple(command[:2]), 1), max_wait)
    env = os.environ.copy()
    env["PATH"] = f"{NODE_DIR}{os.pathsep}{env.get('PATH', '')}"
    if api_key:
        env["GMGN_API_KEY"] = api_key
    runner = [str(PNPM), "dlx"] if PNPM.exists() else [NPX, "--yes"]
    full_command = [*runner, "gmgn-cli", *command, "--raw"]
    with CLI_LOCK:
        completed = subprocess.run(
            full_command,
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            check=False,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        time.sleep(0.45)
    if completed.returncode:
        detail = (completed.stderr or completed.stdout or "GMGN CLI 查找失败").strip()
        if "429" in detail or "rate limit" in detail.lower():
            reset = CLI_RESET.search(detail)
            limiter = smart_money.limiter()
            limiter.block(time.time() + (int(reset.group(1)) if reset else 20) + 1)
            raise RuntimeError(f"GMGN 暂时限流，{smart_money.local_time(limiter.blocked_until, '%H:%M:%S')} 后恢复")
        raise RuntimeError(detail.splitlines()[-1][:280])
    return parse_cli_json(completed.stdout)


EXT_MAX_WAIT = 10


def ext_holders(chain: str, ca: str) -> Any:
    prefix = f"token:{chain}:{ca.lower()}:"
    with CACHE_LOCK:
        for key, (expires, value) in CACHE.items():
            holders = ((value.get("data") or {}).get("holders")) if isinstance(value, dict) else None
            if key.startswith(prefix) and expires > time.time() and holders:
                return holders
    return gmgn(["token", "holders", "--chain", chain, "--address", ca, "--limit", "100", "--order-by", "amount_percentage"],
                api_key=gmgn_api_key(), timeout=45, max_wait=EXT_MAX_WAIT)


def gmgn_paced(command: list[str], timeout: int = 60, retries: int = 2) -> Any:
    for attempt in range(retries + 1):
        try:
            return gmgn(command, api_key=gmgn_api_key(), timeout=timeout, max_wait=None)
        except RuntimeError as exc:
            if "限流" not in str(exc) or attempt >= retries:
                raise
    raise RuntimeError("GMGN 重试次数用完")


def suite_ttl(data: dict[str, Any], errors: dict[str, str], ok_ttl: int, fail_ttl: int) -> int:
    return ok_ttl if data and not any("限流" in error for error in errors.values()) else fail_ttl


def run_suite(commands: dict[str, list[str]], api_key: str = "") -> tuple[dict[str, Any], dict[str, str]]:
    data: dict[str, Any] = {}
    errors: dict[str, str] = {}
    for name, command in commands.items():
        try:
            data[name] = gmgn(command, api_key=api_key)
        except (RuntimeError, subprocess.TimeoutExpired) as exc:
            errors[name] = "GMGN 查找逾时" if isinstance(exc, subprocess.TimeoutExpired) else str(exc)
    return data, errors


def token_suite(chain: str, address: str, api_key: str = "") -> dict[str, Any]:
    credential_id = hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:10] if api_key else "local"
    key = f"token:{chain}:{address.lower()}:{credential_id}"
    if result := cached(key):
        return {**result, "cached": True}
    base = ["--chain", chain, "--address", address]
    data, errors = run_suite(
        {
            "info": ["token", "info", *base],
            "security": ["token", "security", *base],
            "holders": ["token", "holders", *base, "--limit", "100", "--order-by", "amount_percentage"],
            "traders": ["token", "traders", *base, "--limit", "100", "--order-by", "profit"],
        },
        api_key=api_key,
    )
    result = {
        "ok": bool(data),
        "status": "complete" if not errors else "partial" if data else "failed",
        "chain": chain,
        "address": address,
        "queriedAt": int(time.time() * 1000),
        "data": data,
        "errors": errors,
        "cached": False,
    }
    put_cache(key, result, suite_ttl(data, errors, 180, 20))
    return result


HIDDEN_HOLDING_MIN_USD = 10
HIDDEN_HOLDING_MIN_LIQ = 1000


def _holding_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        payload = payload.get("data", payload)
        if isinstance(payload, dict):
            payload = next((payload[key] for key in ("list", "holdings", "items") if isinstance(payload.get(key), list)), [])
    return [row for row in payload if isinstance(row, dict)] if isinstance(payload, list) else []


def _holding_ca(row: dict[str, Any]) -> str:
    token = row.get("token") if isinstance(row.get("token"), dict) else {}
    return str(token.get("token_address") or token.get("address") or row.get("address") or "").lower()


def _as_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def hidden_holdings(shown: Any, everything: Any) -> dict[str, Any]:
    seen = {_holding_ca(row) for row in _holding_rows(shown)}
    out = []
    for row in _holding_rows(everything):
        ca = _holding_ca(row)
        token = row.get("token") if isinstance(row.get("token"), dict) else {}
        liquidity = _as_float(token.get("liquidity"))
        if (not ca or ca in seen or (_as_float(row.get("balance")) or 0) <= 0
                or (_as_float(row.get("usd_value")) or 0) < HIDDEN_HOLDING_MIN_USD
                or token.get("is_honeypot") is True
                or (liquidity is not None and liquidity < HIDDEN_HOLDING_MIN_LIQ)):
            continue
        seen.add(ca)
        out.append({**row, "hiddenByGmgn": True})
    return {"list": out}


def wallet_suite(chain: str, address: str, api_key: str = "") -> dict[str, Any]:
    credential_id = hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:10] if api_key else "local"
    key = f"wallet:{chain}:{address.lower()}:{credential_id}"
    if result := cached(key):
        return {**result, "cached": True}
    base = ["--chain", chain, "--wallet", address]
    data, errors = run_suite(
        {
            "stats": ["portfolio", "stats", *base, "--period", "30d"],
            "holdings": ["portfolio", "holdings", *base, "--limit", "50", "--order-by", "total_profit"],
            "holdingsHidden": ["portfolio", "holdings", *base, "--limit", "50", "--order-by", "usd_value", "--hide-airdrop", "false"],
            "activity": ["portfolio", "activity", *base, "--limit", "50"],
            "createdTokens": ["portfolio", "created-tokens", *base],
        },
        api_key=api_key,
    )
    if "holdingsHidden" in data:
        data["holdingsHidden"] = hidden_holdings(data.get("holdings"), data["holdingsHidden"])
    result = {
        "ok": bool(data),
        "status": "complete" if not errors else "partial" if data else "failed",
        "chain": chain,
        "address": address,
        "queriedAt": int(time.time() * 1000),
        "data": data,
        "errors": errors,
        "cached": False,
    }
    put_cache(key, result, suite_ttl(data, errors, 180, 20))
    return result


def wallet_identity(chain: str, address: str, api_key: str = "") -> dict[str, Any]:
    credential_id = hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:10] if api_key else "local"
    key = f"identity:{chain}:{address.lower()}:{credential_id}"
    if result := cached(key):
        return {**result, "cached": True}
    base = ["--chain", chain, "--wallet", address]
    data, errors = run_suite(
        {"stats": ["portfolio", "stats", *base, "--period", "30d"]},
        api_key=api_key,
    )
    result = {
        "ok": bool(data),
        "status": "complete" if not errors else "failed",
        "chain": chain,
        "address": address,
        "queriedAt": int(time.time() * 1000),
        "data": data,
        "errors": errors,
        "cached": False,
    }
    put_cache(key, result, suite_ttl(data, errors, 300, 30))
    return result


def validate_explorer_params(params: Any) -> dict[str, str]:
    if not isinstance(params, dict):
        raise ValueError("Explorer 参数格式不正确")
    allowed = {
        "module", "action", "address", "contractaddress", "startblock", "endblock",
        "page", "offset", "sort", "timestamp", "closest",
    }
    cleaned: dict[str, str] = {}
    for key, value in params.items():
        if key not in allowed:
            raise ValueError("Explorer 参数不在允许清单")
        text = str(value).strip()
        if key in {"address", "contractaddress"} and text and not EVM_ADDRESS.fullmatch(text):
            raise ValueError("Explorer 地址格式不正确")
        if key in {"startblock", "endblock", "page", "offset", "timestamp"} and text and not text.isdigit():
            raise ValueError("Explorer 数字参数不正确")
        if key == "sort" and text not in {"asc", "desc"}:
            raise ValueError("Explorer 排序参数不正确")
        if key == "closest" and text not in {"before", "after"}:
            raise ValueError("Explorer 时间方向不正确")
        cleaned[key] = text
    if cleaned.get("module") not in {"account", "block"} or cleaned.get("action") not in EXPLORER_ACTIONS:
        raise ValueError("Explorer 操作不在允许清单")
    return cleaned


def explorer_request(chain: str, params: Any, api_key: str) -> dict[str, Any]:
    if chain not in EXPLORER_CHAINS:
        raise ValueError("此链未接入 Etherscan V2")
    if not api_key:
        raise ValueError("尚未设置 Etherscan V2 Key")
    cleaned = validate_explorer_params(params)
    query = urllib.parse.urlencode({"chainid": EXPLORER_CHAINS[chain], **cleaned, "apikey": api_key})
    request = urllib.request.Request(
        f"https://api.etherscan.io/v2/api?{query}",
        headers={"Accept": "application/json", "User-Agent": "WalletScout/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Etherscan V2 HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError("Etherscan V2 连接或回传格式错误") from exc
    return {"payload": payload, "provider": "Etherscan V2"}


def relay_chain_name(chain_id: Any) -> str:
    try:
        numeric_id = int(chain_id)
    except (TypeError, ValueError):
        return "未知链"
    return RELAY_CHAIN_NAMES.get(numeric_id, f"Chain {numeric_id}")


def relay_endpoint(metadata: dict[str, Any], key: str, transactions: Any) -> dict[str, Any]:
    envelope = metadata.get(key) if isinstance(metadata.get(key), dict) else {}
    currency = envelope.get("currency") if isinstance(envelope.get("currency"), dict) else {}
    tx = transactions[0] if isinstance(transactions, list) and transactions and isinstance(transactions[0], dict) else {}
    chain_id = currency.get("chainId", tx.get("chainId"))
    return {
        "chainId": chain_id,
        "chain": relay_chain_name(chain_id),
        "symbol": str(currency.get("symbol") or ""),
        "address": str(currency.get("address") or ""),
        "amount": envelope.get("amountFormatted"),
        "amountRaw": envelope.get("amount"),
        "amountUsd": envelope.get("amountUsd", envelope.get("amountUsdCurrent")),
        "txHash": str(tx.get("hash") or ""),
        "timestamp": tx.get("timestamp"),
        "block": tx.get("blockNumber", tx.get("block")),
    }


def relay_counterpart_chain(record: dict[str, Any], target: str, counterpart: str) -> str:
    origin = record["origin"]
    destination = record["destination"]
    target_normalized = target.lower() if target.startswith("0x") else target
    user_normalized = record["user"].lower() if record["user"].startswith("0x") else record["user"]
    counterpart_normalized = counterpart.lower() if counterpart.startswith("0x") else counterpart
    if user_normalized == target_normalized:
        return destination["chain"]
    if counterpart_normalized == user_normalized:
        return origin["chain"]
    return destination["chain"]


def relay_requests(address: str, max_pages: int = 5) -> dict[str, Any]:
    if not EVM_ADDRESS.fullmatch(address) and not SOLANA_ADDRESS.fullmatch(address):
        raise ValueError("Relay 地址格式不正确")
    max_pages = max(1, min(int(max_pages or 5), 5))
    cache_key = f"relay:{address.lower()}:{max_pages}"
    if result := cached(cache_key):
        return {**result, "cached": True}

    rows: list[dict[str, Any]] = []
    continuation = ""
    pages = 0
    while pages < max_pages:
        query: dict[str, Any] = {
            "user": address,
            "limit": 50,
            "sortBy": "createdAt",
            "sortDirection": "desc",
        }
        if continuation:
            query["continuation"] = continuation
        request = urllib.request.Request(
            f"https://api.relay.link/requests/v2?{urllib.parse.urlencode(query)}",
            headers={"Accept": "application/json", "User-Agent": "WalletScout/1.1"},
        )
        try:
            with urllib.request.urlopen(request, timeout=35) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"Relay API HTTP {exc.code}") from exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise RuntimeError("Relay API 连接或回传格式错误") from exc

        page_rows = payload.get("requests") or payload.get("data") or []
        if not isinstance(page_rows, list):
            raise RuntimeError("Relay API 回传缺少交易清单")
        rows.extend(item for item in page_rows if isinstance(item, dict))
        continuation = str(payload.get("continuation") or "")
        pages += 1
        if not continuation or not page_rows:
            break

    target = address.lower() if address.startswith("0x") else address
    normalized: list[dict[str, Any]] = []
    counterpart_map: dict[str, dict[str, Any]] = {}
    for item in rows:
        data = item.get("data") if isinstance(item.get("data"), dict) else {}
        metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
        user = str(item.get("user") or metadata.get("sender") or "")
        recipient = str(item.get("recipient") or metadata.get("recipient") or "")
        user_key = user.lower() if user.startswith("0x") else user
        recipient_key = recipient.lower() if recipient.startswith("0x") else recipient
        if user_key == target:
            counterpart = recipient
            direction = "转出"
        elif recipient_key == target:
            counterpart = user
            direction = "流入"
        else:
            continue
        if not counterpart or counterpart == address:
            continue
        origin = relay_endpoint(metadata, "currencyIn", data.get("inTxs"))
        destination = relay_endpoint(metadata, "currencyOut", data.get("outTxs"))
        record = {
            "requestId": str(item.get("id") or ""),
            "status": str(item.get("status") or ""),
            "user": user,
            "recipient": recipient,
            "sender": str(metadata.get("sender") or user),
            "counterpart": counterpart,
            "direction": direction,
            "createdAt": item.get("createdAt"),
            "updatedAt": item.get("updatedAt"),
            "origin": origin,
            "destination": destination,
            "provider": "Relay",
        }
        normalized.append(record)
        counterpart_key = counterpart.lower() if counterpart.startswith("0x") else counterpart
        aggregate = counterpart_map.setdefault(counterpart_key, {
            "address": counterpart,
            "chain": relay_counterpart_chain(record, address, counterpart),
            "count": 0,
            "incomingCount": 0,
            "outgoingCount": 0,
            "totalUsd": 0.0,
        })
        aggregate["count"] += 1
        aggregate["incomingCount" if direction == "流入" else "outgoingCount"] += 1
        try:
            aggregate["totalUsd"] += float(destination.get("amountUsd") or origin.get("amountUsd") or 0)
        except (TypeError, ValueError):
            pass

    result = {
        "ok": True,
        "provider": "Relay Requests V2",
        "address": address,
        "records": normalized,
        "counterparts": sorted(counterpart_map.values(), key=lambda item: (-item["count"], -item["totalUsd"])),
        "total": len(normalized),
        "pages": pages,
        "truncated": bool(continuation),
        "continuation": continuation,
        "queriedAt": int(time.time() * 1000),
        "cached": False,
    }
    put_cache(cache_key, result, 60)
    return result


def solana_rpc(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Solana RPC 请求格式不正确")
    requests = payload.get("requests")
    if not isinstance(requests, list) or not requests or len(requests) > 25:
        raise ValueError("Solana RPC 批量需为 1 至 25 笔")
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(requests):
        if not isinstance(item, dict) or item.get("method") not in SOLANA_RPC_METHODS:
            raise ValueError("Solana RPC 方法不在允许清单")
        params = item.get("params")
        if not isinstance(params, list) or not params:
            raise ValueError("Solana RPC 参数格式不正确")
        normalized.append({"jsonrpc": "2.0", "id": index + 1, "method": item["method"], "params": params})

    request_body: Any = normalized[0] if len(normalized) == 1 else normalized
    encoded = json.dumps(request_body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    cache_key = f"solana-rpc:{hashlib.sha256(encoded).hexdigest()}"
    if result := cached(cache_key):
        return {**result, "cached": True}

    errors: list[str] = []
    partial_result: dict[str, Any] | None = None
    for endpoint in SOLANA_RPC_URLS:
        request = urllib.request.Request(
            endpoint,
            data=encoded,
            method="POST",
            headers={"Accept": "application/json", "Content-Type": "application/json", "User-Agent": "WalletScout/1.1"},
        )
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                response_payload = json.loads(response.read().decode("utf-8"))
            items = response_payload if isinstance(response_payload, list) else [response_payload]
            items.sort(key=lambda item: int(item.get("id", 0)) if isinstance(item, dict) else 0)
            rpc_errors = [str(item.get("error", {}).get("message") or "RPC 查找失败") for item in items if isinstance(item, dict) and item.get("error")]
            result = {
                "ok": True,
                "provider": urllib.parse.urlparse(endpoint).netloc,
                "results": [item.get("result") if isinstance(item, dict) else None for item in items],
                "errors": rpc_errors,
                "partial": bool(rpc_errors),
                "cached": False,
            }
            if rpc_errors and len(rpc_errors) == len(items):
                errors.extend(rpc_errors)
                if partial_result is None or len(rpc_errors) < len(partial_result.get("errors", [])):
                    partial_result = result
                continue
            ttl = 300 if all(item["method"] == "getTransaction" for item in normalized) else 20
            put_cache(cache_key, result, ttl)
            return result
        except urllib.error.HTTPError as exc:
            errors.append(f"{urllib.parse.urlparse(endpoint).netloc} HTTP {exc.code}")
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            errors.append(f"{urllib.parse.urlparse(endpoint).netloc} 连接失败")
    if partial_result:
        put_cache(cache_key, partial_result, 60)
        return partial_result
    if all(item["method"] == "getTransaction" for item in normalized):
        degraded_result = {
            "ok": True,
            "provider": "Solana 公开 RPC（历史交易不可用）",
            "results": [None for _ in normalized],
            "errors": errors,
            "partial": True,
            "cached": False,
        }
        put_cache(cache_key, degraded_result, 30)
        return degraded_result
    raise RuntimeError(f"Solana RPC 全部失败：{'；'.join(errors)}")


def request_json(url: str, *, data: bytes | None = None, headers: dict[str, str] | None = None, timeout: int = 35) -> Any:
    default_headers = {
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    }
    request = urllib.request.Request(
        url,
        data=data,
        method="POST" if data is not None else "GET",
        headers={**default_headers, **(headers or {})},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"上游 API HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"上游 API 连接或回传格式错误：{type(exc).__name__}") from exc


def evm_rpc(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("EVM RPC 请求格式不正确")
    endpoint = str(payload.get("endpoint") or "").rstrip("/")
    if endpoint not in EVM_RPC_URLS:
        raise ValueError("EVM RPC 端点不在允许清单")
    requests = payload.get("requests")
    if not isinstance(requests, list) or not requests or len(requests) > 100:
        raise ValueError("EVM RPC 批量需为 1 至 100 笔")
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(requests):
        if not isinstance(item, dict) or item.get("method") not in EVM_RPC_METHODS:
            raise ValueError("EVM RPC 方法不在允许清单")
        params = item.get("params")
        if not isinstance(params, list):
            raise ValueError("EVM RPC 参数格式不正确")
        normalized.append({"jsonrpc": "2.0", "id": index + 1, "method": item["method"], "params": params})
    request_body: Any = normalized[0] if len(normalized) == 1 else normalized
    encoded = json.dumps(request_body, separators=(",", ":")).encode("utf-8")
    response_payload = request_json(endpoint, data=encoded, headers={"Content-Type": "application/json"}, timeout=45)
    items = response_payload if isinstance(response_payload, list) else [response_payload]
    items.sort(key=lambda item: int(item.get("id", 0)) if isinstance(item, dict) else 0)
    errors = [str(item.get("error", {}).get("message") or "RPC 查找失败") for item in items if isinstance(item, dict) and item.get("error")]
    return {
        "ok": True,
        "provider": urllib.parse.urlparse(endpoint).netloc,
        "results": [item.get("result") if isinstance(item, dict) else None for item in items],
        "errors": errors,
        "partial": bool(errors),
    }


NODEREAL_STABLES = {
    "0x55d398326f99059ff775485246999027b3197955": "USDT",
    "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": "USDC",
    "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d": "USD1",
}
NODEREAL_CU = {"nr_getAssetTransfers": 250, "eth_blockNumber": 5, "eth_getCode": 15, "eth_getTransactionByHash": 15}
MEME_USD_THRESHOLD = 5.0
MEME_MAX_SELL_TAX = 0.10


def is_contract_code(code: Any) -> bool:
    text = str(code or "").lower()
    return bool(text and text not in ("0x", "0x0") and not text.startswith("0xef0100"))


_token_check_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def meme_token_check(token: str, need_security: bool = True) -> dict[str, Any]:
    cached_item = _token_check_cache.get(token)
    if cached_item and time.time() - cached_item[0] < 1800:
        return cached_item[1]
    disk = disk_cache_get(f"tokencheck:{token}")
    if disk:
        _token_check_cache[token] = (time.time(), disk)
        return disk
    info: dict[str, Any] = {"token": token, "priceUsd": None, "liquidityUsd": 0.0, "security": None, "problems": [], "sources": []}
    try:
        pairs = request_json(f"https://api.dexscreener.com/token-pairs/v1/bsc/{token}", timeout=20)
        pairs = [p for p in (pairs if isinstance(pairs, list) else []) if str((p.get("baseToken") or {}).get("address", "")).lower() == token]
        if pairs:
            best = max(pairs, key=lambda p: float((p.get("liquidity") or {}).get("usd") or 0))
            info["liquidityUsd"] = float((best.get("liquidity") or {}).get("usd") or 0)
            info["priceUsd"] = float(best.get("priceUsd") or 0) or None
        info["sources"].append("DexScreener")
    except Exception as exc:
        info["problems"].append(f"DexScreener 失败：{str(exc)[:80]}")
    security = None
    if not need_security and not info["priceUsd"]:
        info["problems"].append("无市场且未曾交易，略过安全检查")
        _token_check_cache[token] = (time.time() - 1500, info)
        return info
    try:
        row = None
        for attempt in range(3):
            try:
                data = request_json(f"https://api.gopluslabs.io/api/v1/token_security/56?contract_addresses={token}", timeout=20)
                row = ((data or {}).get("result") or {}).get(token)
                if row:
                    break
            except RuntimeError:
                if attempt == 2:
                    raise
            time.sleep(1.5 * (attempt + 1))
        if row:
            def flag(name: str) -> bool:
                return str(row.get(name) or "0") == "1"
            def tax(name: str) -> float:
                try:
                    return float(row.get(name) or 0)
                except ValueError:
                    return 0.0
            security = {"source": "GoPlus", "honeypot": flag("is_honeypot"), "cannotSell": flag("cannot_sell_all"),
                        "blacklist": flag("is_blacklisted"), "sellTax": tax("sell_tax"), "buyTax": tax("buy_tax"),
                        "airdropScam": flag("is_airdrop_scam"), "fakeToken": flag("fake_token") if isinstance(row.get("fake_token"), str) else False}
            info["sources"].append("GoPlus")
    except Exception as exc:
        info["problems"].append(f"GoPlus 失败：{str(exc)[:80]}")
    if security is None:
        try:
            data = request_json(f"https://api.honeypot.is/v2/IsHoneypot?address={token}&chainID=56", timeout=20)
            hp = (data or {}).get("honeypotResult") or {}
            sim = (data or {}).get("simulationResult") or {}
            if hp:
                security = {"source": "Honeypot.is", "honeypot": bool(hp.get("isHoneypot")), "cannotSell": bool(hp.get("isHoneypot")),
                            "blacklist": False, "sellTax": float(sim.get("sellTax") or 0) / 100, "buyTax": float(sim.get("buyTax") or 0) / 100,
                            "airdropScam": False, "fakeToken": False}
                info["sources"].append("Honeypot.is")
        except Exception as exc:
            info["problems"].append(f"Honeypot.is 失败：{str(exc)[:80]}")
    info["security"] = security
    if security is not None:
        _token_check_cache[token] = (time.time(), info)
        disk_cache_put(f"tokencheck:{token}", info, 6 * 3600)
    return info


SYSTEM_ADDRESSES = {"0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"}


def _lookalike(a: str, b: str) -> bool:
    return a != b and a[2:6] == b[2:6] and a[-4:] == b[-4:]


def classify_meme_transfers(address: str, rows: list[dict[str, Any]], call: Any, contracts: dict[str, bool], payload: Any) -> dict[str, Any]:
    threshold = float(payload.get("memeUsdThreshold") or MEME_USD_THRESHOLD)
    max_tokens = int(payload.get("memeTokenChecks") or 200)
    max_tx = int(payload.get("memeTxChecks") or 120)
    counterparts = {r["to"] if r["from"] == address else r["from"] for r in rows}
    for cp in sorted(counterparts - set(contracts))[: int(payload.get("memeCodeChecks") or 150)]:
        try:
            contracts[cp] = is_contract_code(call("eth_getCode", [cp, "latest"]))
        except RuntimeError:
            pass
    known_peers = {cp for cp in counterparts if contracts.get(cp) is False}
    wallet_rows = [r for r in rows if contracts.get(r["to"] if r["from"] == address else r["from"]) is False]
    swap_rows = len(rows) - len(wallet_rows)
    traded_tokens = {r["token"] for r in rows if contracts.get(r["to"] if r["from"] == address else r["from"]) is True}
    traded_symbols = {r["symbol"].strip().upper(): r["token"] for r in rows if r["token"] in traded_tokens}
    freq: dict[str, int] = {}
    for r in wallet_rows:
        freq[r["token"]] = freq.get(r["token"], 0) + 1
    checks: dict[str, dict[str, Any]] = {}
    for token in sorted(freq, key=lambda t: -freq[t])[:max_tokens]:
        checks[token] = meme_token_check(token, need_security=token in traded_tokens)
    tx_from_cache: dict[str, str] = {}
    kept: list[dict[str, Any]] = []
    filtered: list[dict[str, Any]] = []
    tx_checks = 0
    for r in sorted(wallet_rows, key=lambda x: x["block"]):
        peer = r["to"] if r["from"] == address else r["from"]
        check = checks.get(r["token"])
        reasons: list[str] = []
        kind = ""
        if peer in SYSTEM_ADDRESSES:
            reasons.append("铸造/销毁系统地址，不是钱包往来"); kind = "system"
        elif check is None:
            reasons.append("未检查（超过代币检查上限）"); kind = "unchecked"
        else:
            sec = check.get("security")
            if sec:
                if sec["honeypot"] or sec["cannotSell"]:
                    reasons.append(f"貔貅/无法卖出（{sec['source']}）"); kind = "honeypot"
                if sec["sellTax"] > MEME_MAX_SELL_TAX:
                    reasons.append(f"卖税 {sec['sellTax'] * 100:.0f}%（{sec['source']}）"); kind = kind or "honeypot"
                if sec["blacklist"]:
                    reasons.append(f"有黑名单功能（{sec['source']}）"); kind = kind or "honeypot"
                if sec["airdropScam"] or sec["fakeToken"]:
                    reasons.append(f"空投诈骗/假冒代币（{sec['source']}）"); kind = kind or "spam"
            illiquid = not check.get("priceUsd") or check.get("liquidityUsd", 0) < 1000
            if illiquid and r["token"] not in traded_tokens:
                reasons.append(f"无流动性/无价格且本钱包从未在池子交易（DexScreener 流动性 ${check.get('liquidityUsd', 0):,.0f}）"); kind = kind or "spam"
            spoof = traded_symbols.get(r["symbol"].strip().upper())
            if spoof and spoof != r["token"] and r["token"] not in traded_tokens:
                reasons.append(f"假冒同名代币（真币合约 {spoof}）"); kind = "spam"
            if not sec and kind != "spam":
                reasons.append("安全检查无数据（GoPlus/Honeypot.is）"); kind = kind or "unchecked"
        dead = bool(check) and (not check.get("priceUsd") or check.get("liquidityUsd", 0) < 1000) and r["token"] in traded_tokens
        usd = (r["amount"] * check["priceUsd"]) if check and check.get("priceUsd") else 0.0
        if check and check.get("priceUsd") and usd < threshold and not dead:
            reasons.append(f"价值 ${usd:,.2f} 低于门槛 ${threshold:g}"); kind = kind or "dust"
        if kind == "system":
            lookalike = None
        else:
            lookalike = next((p for p in known_peers if _lookalike(peer, p)), None)
        if lookalike and (usd < threshold or r["amount"] == 0):
            reasons.append(f"地址投毒：对手地址与 {lookalike} 首尾相似"); kind = "poisoning"
        if not reasons:
            if r["hash"] not in tx_from_cache and tx_checks < max_tx:
                tx_checks += 1
                try:
                    tx_from_cache[r["hash"]] = str((call("eth_getTransactionByHash", [r["hash"]]) or {}).get("from") or "").lower()
                except RuntimeError:
                    tx_from_cache[r["hash"]] = ""
            initiator = tx_from_cache.get(r["hash"])
            if initiator is None or initiator == "":
                reasons.append("无法确认交易发起者"); kind = "unchecked"
            elif initiator != r["from"]:
                reasons.append(f"非发送方亲自发起（tx.from={initiator}，疑似合约批量空投）"); kind = "spam"
        item = dict(r, peer=peer, usd=round(usd, 2), liquidityUsd=round(check.get("liquidityUsd", 0), 0) if check else None,
                    securitySource=(check.get("security") or {}).get("source") if check else None,
                    note="目前流动性低（本钱包曾在池子交易，视为已冷却的真实代币；美元价值以现价计，偏低）" if dead else "")
        if reasons:
            item.update(filterKind=kind, reasons=reasons)
            filtered.append(item)
        else:
            kept.append(item)
    peers: dict[str, dict[str, Any]] = {}
    for r in kept:
        g = peers.setdefault(r["peer"], {"peer": r["peer"], "out": 0, "in": 0, "usd": 0.0, "tokens": set(), "count": 0, "signals": []})
        g["count"] += 1; g["usd"] += r["usd"]; g["tokens"].add(r["symbol"])
        g["out" if r["from"] == address else "in"] += 1
    for peer, g in peers.items():
        mine = [r for r in kept if r["peer"] == peer]
        if g["out"] and g["in"]:
            g["signals"].append("双向流动")
        for a in mine:
            back = next((b for b in mine if b["token"] == a["token"] and b["from"] != a["from"] and b["block"] > a["block"] and abs(b["amount"] - a["amount"]) <= max(a["amount"] * 1e-6, 1e-9)), None)
            if back:
                g["signals"].append(f"同额退回 {a['symbol']} {a['amount']:,.4f}（{back['hash']}）")
                break
        if g["count"] >= 3:
            g["signals"].append(f"重复转帐 {g['count']} 笔")
        g["tokens"] = sorted(g["tokens"]); g["usd"] = round(g["usd"], 2)
    summary: dict[str, int] = {}
    for r in filtered:
        summary[r["filterKind"]] = summary.get(r["filterKind"], 0) + 1
    return {"threshold": threshold, "total": len(rows), "swapOrContract": swap_rows, "kept": kept, "filtered": filtered,
            "filteredSummary": summary, "peers": sorted(peers.values(), key=lambda g: -g["usd"]),
            "tokenChecks": {t: {k: v for k, v in c.items() if k != "token"} for t, c in checks.items()}, "txChecks": tx_checks,
            "notes": ["收款方之后是否卖出/持有同数量尚未自动判断", "关联只代表资金/代币往来，不代表同一主人"]}


def nodereal_transfers(payload: Any, api_key: str) -> dict[str, Any]:
    if not api_key:
        raise ValueError("尚未设置 NodeReal API key")
    address = str(payload.get("address") or "").strip().lower()
    if not is_valid_address("bsc", address):
        raise ValueError("地址格式不正确")
    segments = max(1, min(int(payload.get("segments") or 10), 30))
    directions = [d for d in (payload.get("directions") or ["from", "to"]) if d in ("from", "to")]
    endpoint = f"https://bsc-mainnet.nodereal.io/v1/{api_key}"
    usage = {"calls": 0, "cu": 0}

    def call(method: str, params: list[Any]) -> Any:
        usage["calls"] += 1
        usage["cu"] += NODEREAL_CU.get(method, 50)
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode("utf-8")
        try:
            response = request_json(endpoint, data=body, headers={"Content-Type": "application/json"}, timeout=60)
        except RuntimeError as exc:
            raise RuntimeError(f"NodeReal {method}：{exc}") from None
        if response.get("error"):
            raise RuntimeError(f"NodeReal {method}：{response['error'].get('message')}")
        return response.get("result")

    head = int(call("eth_blockNumber", []), 16) - 200
    segment_errors: list[str] = []
    rows: dict[tuple[str, str], dict[str, Any]] = {}
    meme_rows: dict[tuple[str, str], dict[str, Any]] = {}
    include_meme = payload.get("includeMeme", True) is not False
    truncated: list[str] = []
    empty_streak = 0
    seen_any = False
    oldest_scanned = head
    for index in range(segments):
        end = head - index * 100000
        start = end - 99999
        oldest_scanned = start
        found = 0
        for direction in directions:
            page_key = None
            for _page in range(3):
                query: dict[str, Any] = {"category": ["external", "internal", "20"], f"{direction}Address": address,
                                         "fromBlock": hex(start), "toBlock": hex(end), "order": "desc", "maxCount": "0x3e8", "excludeZeroValue": True}
                if page_key:
                    query["pageKey"] = page_key
                try:
                    result = call("nr_getAssetTransfers", [query]) or {}
                except RuntimeError as exc:
                    segment_errors.append(f"{direction} {start}-{end}：{exc}")
                    page_key = None
                    break
                for item in result.get("transfers") or []:
                    contract = str(item.get("contractAddress") or "").lower()
                    category = item.get("category")
                    if str(item.get("receiptsStatus", 1)) in ("0", "0x0"):
                        continue
                    if category == "20" and contract not in NODEREAL_STABLES:
                        if include_meme:
                            raw = str(item.get("value") or "0x0")
                            try:
                                decimals = int(item.get("decimal") or 18)
                                amount = (int(raw, 16) if raw.startswith("0x") else int(float(raw))) / (10 ** decimals)
                            except (ValueError, OverflowError):
                                amount = 0.0
                            ts = item.get("blockTimeStamp")
                            meme_rows[(str(item.get("hash")), str(item.get("logIndex")))] = {
                                "hash": item.get("hash"), "block": int(item.get("blockNum") or "0x0", 16),
                                "timestamp": int(ts, 16) if isinstance(ts, str) and ts.startswith("0x") else int(ts or 0),
                                "from": str(item.get("from") or "").lower(), "to": str(item.get("to") or "").lower(),
                                "token": contract, "symbol": str(item.get("asset") or "?")[:24], "amount": amount, "category": "meme",
                            }
                        continue
                    raw = item.get("value") or "0x0"
                    value = (int(raw, 16) if str(raw).startswith("0x") else int(float(raw))) / 1e18
                    if value <= 0:
                        continue
                    ts = item.get("blockTimeStamp")
                    key = (str(item.get("hash")), f"{item.get('logIndex')}-{item.get('traceIndex')}-{category}")
                    rows[key] = {
                        "hash": item.get("hash"), "block": int(item.get("blockNum") or "0x0", 16),
                        "timestamp": int(ts, 16) if isinstance(ts, str) and ts.startswith("0x") else int(ts or 0),
                        "from": str(item.get("from") or "").lower(), "to": str(item.get("to") or "").lower(),
                        "asset": NODEREAL_STABLES.get(contract, "BNB"), "amount": value, "category": category,
                    }
                    found += 1
                page_key = result.get("pageKey")
                if not page_key:
                    break
            if page_key:
                truncated.append(f"{direction} {start}-{end}")
        if found:
            seen_any = True
        empty_streak = 0 if found else empty_streak + 1
        if seen_any and empty_streak >= int(payload.get("stopAfterEmpty") or 3):
            break
    counterparts = sorted({row["to"] if row["from"] == address else row["from"] for row in rows.values()})
    contracts: dict[str, bool] = {}
    for counterpart in counterparts[: int(payload.get("codeChecks") or 40)]:
        try:
            code = call("eth_getCode", [counterpart, "latest"])
            contracts[counterpart] = is_contract_code(code)
        except RuntimeError:
            pass
    meme = classify_meme_transfers(address, list(meme_rows.values()), call, contracts, payload) if include_meme else None
    return {"ok": True, "provider": "NodeReal nr_getAssetTransfers", "head": head, "oldestBlock": oldest_scanned,
            "transfers": sorted(rows.values(), key=lambda row: row["block"], reverse=True), "contracts": contracts, "meme": meme,
            "truncated": truncated, "segmentErrors": segment_errors, "usage": usage}


DETECT_RPC = {
    "BSC": ["https://bsc-rpc.publicnode.com", "https://bsc.drpc.org"],
    "ETH": ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"],
    "Base": ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
    "Robinhood": ["https://robinhood-rpc.publicnode.com", "https://rpc.mainnet.chain.robinhood.com"],
}
DETECT_GMGN = {"BSC": "bsc", "ETH": "eth", "Base": "base", "Robinhood": "robinhood", "Solana": "sol"}
DISK_CACHE_FILE = CREDENTIAL_DIR / "public-cache.json"
DISK_CACHE_LOCK = threading.Lock()
_disk_cache: dict[str, tuple[float, Any]] | None = None


def disk_cache_get(key: str) -> Any:
    global _disk_cache
    with DISK_CACHE_LOCK:
        if _disk_cache is None:
            try:
                _disk_cache = {k: (v[0], v[1]) for k, v in json.loads(DISK_CACHE_FILE.read_text(encoding="utf-8")).items()}
            except (OSError, ValueError):
                _disk_cache = {}
        item = _disk_cache.get(key)
        if not item or item[0] <= time.time():
            return None
        return item[1]


def disk_cache_put(key: str, value: Any, ttl: int) -> None:
    with DISK_CACHE_LOCK:
        if _disk_cache is None:
            return
        now = time.time()
        _disk_cache[key] = (now + ttl, value)
        for k in [k for k, v in _disk_cache.items() if v[0] <= now]:
            _disk_cache.pop(k, None)
        try:
            CREDENTIAL_DIR.mkdir(parents=True, exist_ok=True)
            tmp = DISK_CACHE_FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps({k: list(v) for k, v in _disk_cache.items()}, ensure_ascii=False), encoding="utf-8")
            tmp.replace(DISK_CACHE_FILE)
        except OSError:
            pass


def _rpc_batch(chain: str, calls: list[tuple[str, list[Any]]]) -> list[Any]:
    body = json.dumps([{"jsonrpc": "2.0", "id": i + 1, "method": m, "params": p} for i, (m, p) in enumerate(calls)]).encode()
    last = ""
    for endpoint in DETECT_RPC[chain]:
        try:
            out = request_json(endpoint, data=body, headers={"Content-Type": "application/json"}, timeout=12)
            items = sorted(out if isinstance(out, list) else [out], key=lambda x: int(x.get("id", 0)))
            if len(items) == len(calls):
                return [x.get("result") if not x.get("error") else None for x in items]
            last = "批量回传笔数不符"
        except Exception as exc:
            last = str(exc)[:120]
    raise RuntimeError(f"{chain} RPC 失败：{last}")


def _abi_string(hexdata: Any) -> str:
    try:
        raw = bytes.fromhex(str(hexdata)[2:])
        if len(raw) >= 96:
            n = int.from_bytes(raw[32:64], "big")
            return raw[64:64 + n].decode("utf-8", "replace").strip("\x00")[:40]
        return raw.rstrip(b"\x00").decode("utf-8", "replace")[:40]
    except (ValueError, TypeError):
        return ""


def detect_evm(address: str) -> dict[str, Any]:
    addr = address.lower()
    calls = [("eth_getCode", [addr, "latest"]), ("eth_getBalance", [addr, "latest"]), ("eth_getTransactionCount", [addr, "latest"]),
             ("eth_call", [{"to": addr, "data": "0x313ce567"}, "latest"]), ("eth_call", [{"to": addr, "data": "0x95d89b41"}, "latest"]),
             ("eth_call", [{"to": addr, "data": "0x18160ddd"}, "latest"])]
    chains: dict[str, Any] = {}
    errors: dict[str, str] = {}
    def probe(chain: str) -> None:
        try:
            code, bal, nonce, dec, sym, supply = _rpc_batch(chain, calls)
            code = str(code or "0x").lower()
            kind = "wallet"
            if code.startswith("0xef0100"):
                kind = "eip7702"
            elif code not in ("0x", "0x0"):
                kind = "token" if (dec and dec != "0x" and supply and supply != "0x" and int(dec, 16) <= 36) else "contract"
            elif not int(nonce or "0x0", 16) and not int(bal or "0x0", 16):
                kind = "empty"
            chains[chain] = {"kind": kind, "balance": int(bal or "0x0", 16) / 1e18, "nonce": int(nonce or "0x0", 16), "codeBytes": max(0, (len(code) - 2) // 2),
                             "delegate": ("0x" + code[8:48]) if kind == "eip7702" else None,
                             "symbol": _abi_string(sym) if kind == "token" else None, "decimals": int(dec, 16) if kind == "token" else None}
        except Exception as exc:
            errors[chain] = str(exc)[:160]
    threads = [threading.Thread(target=probe, args=(c,)) for c in DETECT_RPC]
    for t in threads:
        t.start()
    for t in threads:
        t.join(20)
    order = ["BSC", "ETH", "Base", "Robinhood"]
    contract_chains = [c for c in order if chains.get(c, {}).get("kind") in ("token", "contract")]
    if contract_chains:
        tok = [c for c in contract_chains if chains[c]["kind"] == "token"]
        best = tok[0] if tok else contract_chains[0]
    else:
        active = [c for c in order if chains.get(c, {}).get("kind") in ("wallet", "eip7702")]
        best = max(active, key=lambda c: (chains[c]["nonce"], chains[c]["balance"])) if active else None
    kind = chains[best]["kind"] if best else "empty"
    return {"family": "EVM", "chain": best, "kind": kind, "chains": chains, "errors": errors}


def _deep_find(obj: Any, key: str, depth: int = 0) -> Any:
    if not isinstance(obj, (dict, list)) or depth > 6:
        return None
    if isinstance(obj, dict) and obj.get(key) not in (None, ""):
        return obj[key]
    for value in (obj.values() if isinstance(obj, dict) else obj):
        found = _deep_find(value, key, depth + 1)
        if found is not None:
            return found
    return None


def detect_rh_fallback(address: str, detection: dict[str, Any], forced: str, api_key: str) -> dict[str, Any]:
    if detection.get("family") != "EVM" or "Robinhood" not in (detection.get("errors") or {}):
        return detection
    chains = detection.get("chains") or {}
    if forced != "Robinhood" and any(v.get("kind") in ("token", "contract") or v.get("nonce") for v in chains.values()):
        return detection
    key = f"gmgn-token-info:robinhood:{address.lower()}"
    info = cached(key)
    if not info:
        try:
            info = {"data": gmgn(["token", "info", "--chain", "robinhood", "--address", address], api_key=api_key, timeout=40)}
        except Exception:
            return detection
    symbol = _deep_find(info.get("data"), "symbol")
    if not symbol:
        return detection
    put_cache(key, info, 120)
    try:
        decimals = int(_deep_find(info.get("data"), "decimals"))
    except (TypeError, ValueError):
        decimals = None
    rh = {"kind": "token", "balance": None, "nonce": None, "codeBytes": None, "delegate": None,
          "symbol": str(symbol)[:40], "decimals": decimals, "source": "GMGN（RH RPC 查不到，改用 GMGN 代币数据判断）"}
    return {**detection, "chain": "Robinhood", "kind": "token", "chains": {**chains, "Robinhood": rh}}


def detect_solana(address: str) -> dict[str, Any]:
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "getAccountInfo", "params": [address, {"encoding": "jsonParsed"}]}).encode()
    last = ""
    for endpoint in SOLANA_RPC_URLS:
        try:
            out = request_json(endpoint, data=body, headers={"Content-Type": "application/json"}, timeout=12)
            value = ((out or {}).get("result") or {}).get("value")
            if value is None:
                sig_body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "getSignaturesForAddress", "params": [address, {"limit": 1}]}).encode()
                sigs = (request_json(endpoint, data=sig_body, headers={"Content-Type": "application/json"}, timeout=12) or {}).get("result")
                if not isinstance(sigs, list):
                    raise RuntimeError("交易签名查找没有结果")
                if sigs:
                    return {"family": "Solana", "chain": "Solana", "kind": "wallet", "errors": {},
                            "chains": {"Solana": {"kind": "wallet", "balance": 0, "zeroSol": True, "lastTx": sigs[0].get("blockTime")}}}
                return {"family": "Solana", "chain": "Solana", "kind": "empty", "chains": {"Solana": {"kind": "empty", "balance": 0}}, "errors": {}}
            data = value.get("data") if isinstance(value.get("data"), dict) else {}
            parsed = data.get("parsed") if isinstance(data, dict) else None
            ptype = (parsed or {}).get("type") if isinstance(parsed, dict) else None
            owner = value.get("owner")
            lamports = int(value.get("lamports") or 0)
            if ptype == "mint":
                info = parsed.get("info") or {}
                kind, extra = "token", {"decimals": info.get("decimals"), "supply": info.get("supply")}
            elif value.get("executable"):
                kind, extra = "program", {}
            elif owner == "11111111111111111111111111111111":
                kind, extra = "wallet", {}
            else:
                kind, extra = "contract", {"owner": owner}
            return {"family": "Solana", "chain": "Solana", "kind": kind, "errors": {},
                    "chains": {"Solana": {"kind": kind, "balance": lamports / 1e9, **extra}}}
        except Exception as exc:
            last = str(exc)[:120]
    raise RuntimeError(f"Solana RPC 失败：{last}")


def analyze_quick(payload: Any, credentials: dict[str, str]) -> dict[str, Any]:
    started = time.time()
    raw = str(payload.get("input") or "").strip()
    if "..." in raw or "…" in raw:
        raise ValueError("请贴完整地址，不能用缩写")
    if EVM_ADDRESS.fullmatch(raw):
        address = raw.lower()
    elif SOLANA_ADDRESS.fullmatch(raw):
        address = raw
    else:
        raise ValueError("看不出是 EVM（0x…40 位）或 Solana 地址")
    forced = str(payload.get("chain") or "")
    cache_key = f"detect:{address}"
    detection = disk_cache_get(cache_key) if not payload.get("refresh") else None
    cached_detect = bool(detection)
    if detection and forced == "Robinhood" and "Robinhood" not in detection.get("chains", {}):
        detection = None
    if not detection:
        detection = detect_solana(address) if not address.startswith("0x") else detect_evm(address)
        detection = detect_rh_fallback(address, detection, forced, credentials.get("gmgnApiKey", ""))
        if detection.get("chain"):
            disk_cache_put(cache_key, detection, 86400 if detection["kind"] in ("token", "contract", "program") else 600)
    if forced and forced in detection.get("chains", {}):
        detection = {**detection, "chain": forced, "kind": detection["chains"][forced]["kind"]}
    result: dict[str, Any] = {"ok": True, "input": raw, "address": address, **detection, "detectCached": cached_detect, "gmgn": None, "library": None, "timings": {}}
    try:
        result["userLabel"] = user_labels.lookup_many([address]).get(wallet_library.norm("", address))
    except Exception as error:
        result["userLabelError"] = str(error)
    result["timings"]["detectMs"] = int((time.time() - started) * 1000)
    chain = detection.get("chain")
    gchain = DETECT_GMGN.get(chain or "")
    if gchain:
        t = time.time()
        try:
            if detection["kind"] == "token":
                key = f"gmgn-token-info:{gchain}:{address.lower()}"
                info = cached(key)
                if not info:
                    info = {"data": gmgn(["token", "info", "--chain", gchain, "--address", address], api_key=credentials.get("gmgnApiKey", ""), timeout=40)}
                    put_cache(key, info, 120)
                result["gmgn"] = {"type": "token", **info}
            elif detection["kind"] in ("wallet", "eip7702", "empty"):
                result["gmgn"] = {"type": "wallet", **wallet_identity(gchain, address, credentials.get("gmgnApiKey", ""))}
        except Exception as exc:
            result["gmgn"] = {"error": str(exc)[:200]}
        result["timings"]["gmgnMs"] = int((time.time() - t) * 1000)
    if chain:
        try:
            if detection["kind"] == "token":
                result["library"] = wallet_library.token_summary({"chain": chain, "ca": address})
            else:
                result["library"] = wallet_library.wallet_detail({"chain": chain, "address": address})
        except ValueError:
            result["library"] = {"ok": False, "missing": True}
        except Exception as exc:
            result["library"] = {"ok": False, "error": str(exc)[:160]}
    result["timings"]["totalMs"] = int((time.time() - started) * 1000)
    return result


def dexscreener_pairs(chain: str, address: str) -> dict[str, Any]:
    dex_chain = DEX_CHAIN_IDS.get(chain)
    if not dex_chain:
        raise ValueError("DexScreener 不支持此链")
    if not is_valid_address("sol" if chain == "Solana" else "bsc", address):
        raise ValueError("代币地址格式不正确")
    url = f"https://api.dexscreener.com/token-pairs/v1/{dex_chain}/{urllib.parse.quote(address, safe='')}"
    try:
        payload = request_json(url)
        if not isinstance(payload, list):
            raise RuntimeError("DexScreener 回传格式错误")
        pairs = payload
    except RuntimeError:
        pairs = []
    if not pairs:
        fallback_url = f"https://api.dexscreener.com/latest/dex/tokens/{urllib.parse.quote(address, safe='')}"
        fallback_payload = request_json(fallback_url)
        fallback_pairs = fallback_payload.get("pairs") if isinstance(fallback_payload, dict) else None
        if isinstance(fallback_pairs, list):
            pairs = [pair for pair in fallback_pairs if str(pair.get("chainId") or "").lower() == dex_chain.lower()]
    return {"ok": True, "provider": "DexScreener", "pairs": pairs}


def binance_positions(chain: str, address: str) -> dict[str, Any]:
    chain_id = BINANCE_CHAIN_IDS.get(chain)
    if not chain_id:
        raise ValueError("Binance Web3 不支持此链")
    if not is_valid_address("sol" if chain == "Solana" else "bsc", address):
        raise ValueError("钱包地址格式不正确")
    query = urllib.parse.urlencode({"address": address, "chainId": chain_id, "offset": 0})
    url = f"https://web3.binance.com/bapi/defi/v3/public/wallet-direct/buw/wallet/address/pnl/active-position-list/ai?{query}"
    payload = request_json(url, headers={"clienttype": "web", "clientversion": "1.2.0"})
    return {"ok": True, "provider": "Binance Web3", "payload": payload}


def binance_prices() -> dict[str, Any]:
    symbols = json.dumps(["ETHUSDT", "BNBUSDT", "SOLUSDT"], separators=(",", ":"))
    query = urllib.parse.urlencode({"symbols": symbols})
    payload = request_json(f"https://api.binance.com/api/v3/ticker/price?{query}")
    if not isinstance(payload, list):
        raise RuntimeError("Binance 价格回传格式错误")
    return {"ok": True, "provider": "Binance Spot", "prices": payload}


def defillama_block(chain: str, timestamp: Any) -> dict[str, Any]:
    allowed_chains = {"ethereum", "bsc", "base", "arbitrum"}
    normalized_chain = str(chain or "").lower().strip()
    if normalized_chain not in allowed_chains:
        raise ValueError("DefiLlama 链不在允许清单")
    try:
        normalized_timestamp = int(timestamp)
    except (TypeError, ValueError) as error:
        raise ValueError("时间戳格式不正确") from error
    if normalized_timestamp < 1231006505 or normalized_timestamp > int(time.time()) + 300:
        raise ValueError("时间戳超出允许范围")
    url = f"https://coins.llama.fi/block/{normalized_chain}/{normalized_timestamp}"
    payload = request_json(url)
    if not isinstance(payload, dict) or not isinstance(payload.get("height"), int):
        raise RuntimeError("DefiLlama 区块回传格式错误")
    return {"ok": True, "provider": "DefiLlama", "height": payload["height"]}


class WalletHandler(SimpleHTTPRequestHandler):
    server_version = "WalletScout/1.0"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; connect-src 'self'; img-src 'self' data: https://gmgn.ai; "
            "style-src 'self'; script-src 'self'; object-src 'none'; "
            "base-uri 'none'; frame-ancestors 'self'; form-action 'self'",
        )
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK, headers: dict[str, str] | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def same_origin(self) -> bool:
        origin = self.headers.get("Origin")
        port = self.server.server_address[1]
        return origin is None or origin in {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}

    def ext_origin(self) -> bool:
        return self.same_origin() or str(self.headers.get("Origin") or "").startswith("chrome-extension://")

    def do_GET(self) -> None:
        bare, _, query = self.path.partition("?")
        if bare in ("/", "/analyze"):
            if bare == "/analyze":
                target = "/analyze.html"
            elif any(key in urllib.parse.parse_qs(query) for key in ("q", "ca", "wallet")):
                target = "/index.html"
            else:
                target = "/smart-money.html"
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", target + (f"?{query}" if query else ""))
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if bare == "/api/ext/ping":
            if not self.ext_origin():
                self.send_json({"ok": False, "error": "只给本机插件"}, HTTPStatus.FORBIDDEN)
                return
            self.send_json(ext_api.ping())
            return
        if self.path == "/api/health":
            self.send_json({"ok": True, "service": "gmgn-local-proxy", "bind": "127.0.0.1"})
            return
        if self.path == "/api/credentials/status":
            credentials = load_credentials()
            self.send_json({
                "ok": True,
                "gmgnConfigured": bool(credentials.get("gmgnApiKey")) or gmgn_global_configured(),
                "gmgnSource": "device-encrypted" if credentials.get("gmgnApiKey") else "local-cli" if gmgn_global_configured() else "none",
                "explorerConfigured": bool(credentials.get("explorerApiKey")),
                "noderealConfigured": bool(credentials.get("noderealApiKey")),
                "binanceMode": "public-no-key",
                "storage": "Windows DPAPI / current user only",
            })
            return
        if bare == "/api/pump/sync-list":
            if not self.same_origin():
                self.send_json({"ok": False, "error": "只给这台本机服务自己的页面"}, HTTPStatus.FORBIDDEN)
                return
            self.send_json(wallet_library.pump_sync_list({"all": urllib.parse.parse_qs(query).get("all", [""])[0] == "1"}))
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self.path not in {"/api/gmgn/token", "/api/gmgn/wallet", "/api/gmgn/identity", "/api/explorer", "/api/relay/requests", "/api/solana-rpc", "/api/evm-rpc", "/api/dexscreener/pairs", "/api/binance/positions", "/api/binance/prices", "/api/defillama/block", "/api/credentials", "/api/library/ingest", "/api/library/trace-ingest", "/api/nodereal/transfers", "/api/library/search", "/api/library/wallet", "/api/library/token-summary", "/api/library/update", "/api/library/link-review", "/api/library/link-reviews", "/api/library/export", "/api/analyze/quick", "/api/library/user-labels/import", "/api/library/user-labels/export", "/api/library/user-labels/lookup", "/api/match/platform-users", "/api/pump/sync-import", "/api/pump/board-import"} and self.path not in smart_money.PATHS and self.path not in ext_api.PATHS and self.path not in fomo_board.PATHS and self.path not in library_bulk.PATHS:
            self.send_json({"ok": False, "error": "找不到此 API"}, HTTPStatus.NOT_FOUND)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > (4_000_000 if self.path in {"/api/match/platform-users", "/api/library/ingest", "/api/library/trace-ingest", "/api/library/user-labels/import", "/api/library/user-labels/lookup", "/api/smart/add", "/api/smart/mine"} else 200_000 if self.path in {"/api/pump/sync-import", "/api/pump/board-import"} else 1_500_000 if self.path == "/api/fomo/board-import" else 64_000 if self.path in ext_api.PATHS else 16384):
                raise ValueError("请求内容长度不正确")
            payload = json.loads(self.rfile.read(length))
            if self.path in ext_api.PATHS:
                if not self.ext_origin():
                    self.send_json({"ok": False, "error": "只给本机插件"}, HTTPStatus.FORBIDDEN)
                    return
                self.send_json(ext_api.handle(self.path, payload if isinstance(payload, dict) else {}, fetch_holders=ext_holders))
                return
            if self.path in smart_money.PATHS:
                self.send_json(smart_money.handle(self.path, payload if isinstance(payload, dict) else {}))
                return
            if self.path in fomo_board.PATHS:
                if not self.same_origin():
                    self.send_json({"ok": False, "error": "只收这台本机服务自己页面送来的数据"}, HTTPStatus.FORBIDDEN)
                    return
                self.send_json(fomo_board.handle(self.path, payload if isinstance(payload, dict) else {}))
                return
            if self.path in library_bulk.PATHS:
                if not self.same_origin():
                    self.send_json({"ok": False, "error": "只收这台本机服务自己页面送来的数据"}, HTTPStatus.FORBIDDEN)
                    return
                self.send_json(library_bulk.handle(self.path, payload if isinstance(payload, dict) else {}))
                return
            if self.path == "/api/credentials":
                changes: dict[str, str | None] = {}
                for field in ("gmgnApiKey", "explorerApiKey", "noderealApiKey"):
                    if payload.get(f"clear{field[0].upper()}{field[1:]}") is True:
                        changes[field] = None
                    elif field in payload:
                        value = str(payload.get(field) or "").strip()
                        if not value or len(value) > 500 or any(ord(character) < 32 for character in value):
                            raise ValueError(f"{field} 格式不正确")
                        changes[field] = value
                if not changes:
                    raise ValueError("没有可保存的凭证")
                saved = save_credentials(changes)
                self.send_json({
                    "ok": True,
                    "gmgnConfigured": bool(saved.get("gmgnApiKey")) or gmgn_global_configured(),
                    "explorerConfigured": bool(saved.get("explorerApiKey")),
                })
                return
            if self.path == "/api/pump/sync-import":
                if not self.same_origin():
                    self.send_json({"ok": False, "error": "只收这台本机服务自己页面送来的数据"}, HTTPStatus.FORBIDDEN)
                    return
                self.send_json(wallet_library.pump_sync_import(payload if isinstance(payload, dict) else {}))
                return
            if self.path == "/api/pump/board-import":
                if not self.same_origin():
                    self.send_json({"ok": False, "error": "只收这台本机服务自己页面送来的数据"}, HTTPStatus.FORBIDDEN)
                    return
                self.send_json(wallet_library.pump_board_import(payload if isinstance(payload, dict) else {}))
                return
            if self.path.startswith("/api/library/"):
                handler = {
                    "/api/library/ingest": wallet_library.ingest,
                    "/api/library/trace-ingest": wallet_library.trace_ingest,
                    "/api/library/search": wallet_library.search,
                    "/api/library/wallet": wallet_library.wallet_detail,
                    "/api/library/token-summary": wallet_library.token_summary,
                    "/api/library/update": wallet_library.update_wallet,
                    "/api/library/link-review": wallet_library.review_link,
                    "/api/library/link-reviews": wallet_library.link_reviews,
                    "/api/library/export": lambda _payload: wallet_library.export_all(),
                    "/api/library/user-labels/import": user_labels.import_text,
                    "/api/library/user-labels/export": user_labels.export,
                    "/api/library/user-labels/lookup": user_labels.lookup,
                }[self.path]
                self.send_json(handler(payload if isinstance(payload, dict) else {}))
                return
            credentials = load_credentials()
            if self.path == "/api/solana-rpc":
                self.send_json(solana_rpc(payload))
                return
            if self.path == "/api/evm-rpc":
                self.send_json(evm_rpc(payload))
                return
            if self.path == "/api/dexscreener/pairs":
                self.send_json(dexscreener_pairs(str(payload.get("chain") or ""), str(payload.get("address") or "").strip()))
                return
            if self.path == "/api/binance/positions":
                self.send_json(binance_positions(str(payload.get("chain") or ""), str(payload.get("address") or "").strip()))
                return
            if self.path == "/api/binance/prices":
                self.send_json(binance_prices())
                return
            if self.path == "/api/defillama/block":
                self.send_json(defillama_block(payload.get("chain"), payload.get("timestamp")))
                return
            if self.path == "/api/relay/requests":
                address = str(payload.get("address") or "").strip()
                result = relay_requests(address, payload.get("maxPages", 5))
                self.send_json(result)
                return
            if self.path == "/api/match/platform-users":
                result = platform_match.match(payload, gmgn_cli=lambda cmd: gmgn(cmd, api_key=credentials.get("gmgnApiKey", ""), timeout=60))
                try:
                    result["library"] = wallet_library.platform_ingest(result | {"symbol": str(payload.get("symbol") or "")[:40]})
                except Exception as exc:
                    result["library"] = {"ok": False, "error": str(exc)[:200]}
                self.send_json(result)
                return
            if self.path == "/api/analyze/quick":
                self.send_json(analyze_quick(payload, credentials))
                return
            if self.path == "/api/nodereal/transfers":
                self.send_json(nodereal_transfers(payload, credentials.get("noderealApiKey", "")))
                return
            if self.path == "/api/explorer":
                chain = str(payload.get("chain", "")).strip()
                result = explorer_request(chain, payload.get("params"), credentials.get("explorerApiKey", ""))
                self.send_json({"ok": True, **result})
                return
            chain = str(payload.get("chain", "")).lower().strip()
            address = str(payload.get("address") or payload.get("wallet") or "").strip()
            if chain not in GMGN_CHAINS:
                raise ValueError("GMGN 不支持这条链")
            if not is_valid_address(chain, address):
                raise ValueError("地址格式不正确")
            gmgn_api_key = credentials.get("gmgnApiKey", "")
            if self.path.endswith("/token"):
                result = token_suite(chain, address, gmgn_api_key)
            elif self.path.endswith("/identity"):
                result = wallet_identity(chain, address, gmgn_api_key)
            else:
                result = wallet_suite(chain, address, gmgn_api_key)
            self.send_json(result)
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)[:300]}, HTTPStatus.BAD_GATEWAY)

    def log_message(self, format_string: str, *args: Any) -> None:
        try:
            print(f"[{self.log_date_time_string()}] {format_string % args}")
        except (OSError, ValueError):
            pass


def library_maintenance(first_delay: float = 300, every: float = 1800) -> None:
    time.sleep(first_delay)
    fetch = gmgn_paced
    while True:
        for step in (lambda: wallet_library.relabel_if_stale(), lambda: wallet_library.refresh_tokens(fetch),
                     lambda: wallet_library.check_quiet_stats(fetch), lambda: wallet_library.refresh_platform_strength(fetch),
                     lambda: wallet_library.refresh_pump_pnl(platform_match.pump_user_pnl), wallet_library.purge_bots,
                     lambda: wallet_library.check_bot_stats(fetch), wallet_library.purge_bots, wallet_library.refresh_follow_records,
                     wallet_library.prune_if_due):
            try:
                step()
            except Exception:
                pass
        time.sleep(every)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--no-smart-money", action="store_true", help="不启动聪明钱背景追踪")
    parser.add_argument("--no-prune", action="store_true", help="不跑钱包库每天自动清理（测试服务器用）")
    args = parser.parse_args()
    if not args.no_smart_money:
        smart_money.start(gmgn_api_key)
    if not args.no_prune:
        threading.Thread(target=library_maintenance, name="library-prune", daemon=True).start()
    try:
        stale = [key for key in load_credentials() if key in ("fomoToken", "fomoAccess", "fomoRefresh", "fomoAppId", "fomoCaid", "fomoConnectedAt")]
        if stale:
            save_credentials({key: None for key in stale})
    except Exception:
        pass
    server = ThreadingHTTPServer(("127.0.0.1", args.port), WalletHandler)
    print(f"Wallet investigator running at http://127.0.0.1:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
