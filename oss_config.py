import json
import os
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("WALLET_SCOUT_DATA") or APP_DIR / "data")
DATA_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_FILE = Path(os.environ.get("WALLET_SCOUT_CONFIG") or APP_DIR / "config.json")

try:
    _VALUES = json.loads(CONFIG_FILE.read_text(encoding="utf-8")) if CONFIG_FILE.exists() else {}
except (OSError, ValueError):
    _VALUES = {}


def cfg(name, default):
    value = _VALUES.get(name, default)
    if isinstance(default, tuple) and isinstance(value, list):
        return tuple(value)
    if isinstance(default, float) and isinstance(value, int):
        return float(value)
    if isinstance(default, dict) and isinstance(value, dict):
        return {**default, **value}
    return value
