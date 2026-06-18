"""
model_registry.py — MongoDB-backed registry for multi-horizon LSTM models.

Tracks trained model files (H7 / H15 / H60) per coin and exposes
get/set for the active model selection used at inference time.

MongoDB collection: model_registry
  Document shape:
    {
      "coin":          "BTC" | "DOGE",
      "coin_id":       "bitcoin" | "dogecoin",
      "horizon":       7 | 15 | 60,
      "model_file":    "lstm_bitcoin_h7_v3.pt",
      "scaler_file":   "scaler_bitcoin_h7_v3.pkl",
      "model_exists":  bool,
      "is_active":     bool,   # exactly one True per coin
      "metrics":       {...},
      "registered_at": datetime,
    }
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────
SUPPORTED_HORIZONS: list[int] = [7, 15, 60]
COINS: list[str] = ["bitcoin", "dogecoin"]
COIN_SYMBOL_MAP: dict[str, str] = {"bitcoin": "BTC", "dogecoin": "DOGE"}

_HERE = Path(__file__).resolve().parent
_MODEL_DIR = _HERE / "model"
_DEFAULT_URI = "mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin"


# ── File name helpers ──────────────────────────────────────────────────────────

def model_filename(coin: str, horizon: int, version: int = 3) -> str:
    return f"lstm_{coin}_h{horizon}_v{version}.pt"


def scaler_filename(coin: str, horizon: int, version: int = 3) -> str:
    return f"scaler_{coin}_h{horizon}_v{version}.pkl"


def model_exists(coin: str, horizon: int) -> bool:
    return (
        (_MODEL_DIR / model_filename(coin, horizon)).exists()
        and (_MODEL_DIR / scaler_filename(coin, horizon)).exists()
    )


# ── Registry helpers ───────────────────────────────────────────────────────────

def register_model(
    coin: str,
    horizon: int,
    metrics: dict,
    score_report: dict | None = None,
    mongo_uri: str | None = None,
) -> None:
    """
    Upsert a trained model entry into model_registry collection.

    H7 is set as active by default when first registered (if no active model
    exists for that coin yet). Subsequent registrations preserve the current
    is_active flag.
    """
    uri = mongo_uri or os.environ.get("MONGO_URI", _DEFAULT_URI)
    symbol = COIN_SYMBOL_MAP.get(coin, coin.upper())

    doc = {
        "coin":          symbol,
        "coin_id":       coin,
        "horizon":       horizon,
        "model_file":    model_filename(coin, horizon),
        "scaler_file":   scaler_filename(coin, horizon),
        "model_exists":  model_exists(coin, horizon),
        "metrics":       metrics,
        "score_report":  score_report,
        "registered_at": datetime.now(timezone.utc),
    }

    try:
        import pymongo  # noqa: PLC0415
        client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=3000)
        db = client["crypto_db"]
        col = db["model_registry"]

        # Preserve is_active; default H7 to active on first registration
        existing = col.find_one({"coin": symbol, "horizon": horizon}, {"_id": 0, "is_active": 1})
        has_any_active = col.find_one({"coin": symbol, "is_active": True}) is not None

        if existing is not None:
            doc["is_active"] = existing.get("is_active", False)
        else:
            # First time: H7 becomes active automatically; others start inactive
            doc["is_active"] = (horizon == 7) if not has_any_active else False

        col.update_one(
            {"coin": symbol, "horizon": horizon},
            {"$set": doc},
            upsert=True,
        )
        client.close()
        logger.info("Registered model: coin=%s horizon=%d active=%s", symbol, horizon, doc["is_active"])
    except Exception as exc:  # noqa: BLE001
        logger.warning("model_registry update skipped (non-fatal): %s", exc)


def set_active_model(
    coin: str,
    horizon: int,
    mongo_uri: str | None = None,
) -> None:
    """Set the active model for *coin* to *horizon*; deactivate all others."""
    uri = mongo_uri or os.environ.get("MONGO_URI", _DEFAULT_URI)
    symbol = COIN_SYMBOL_MAP.get(coin, coin.upper())
    try:
        import pymongo  # noqa: PLC0415
        client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=3000)
        db = client["crypto_db"]
        col = db["model_registry"]
        col.update_many({"coin": symbol}, {"$set": {"is_active": False}})
        col.update_one(
            {"coin": symbol, "horizon": horizon},
            {"$set": {"is_active": True}},
            upsert=False,
        )
        client.close()
        logger.info("Active model set: coin=%s horizon=%d", symbol, horizon)
    except Exception as exc:  # noqa: BLE001
        logger.warning("set_active_model failed (non-fatal): %s", exc)


def get_active_horizon(
    coin: str,
    mongo_uri: str | None = None,
) -> int:
    """Return the active horizon for *coin*. Falls back to 7 if registry is empty."""
    uri = mongo_uri or os.environ.get("MONGO_URI", _DEFAULT_URI)
    symbol = COIN_SYMBOL_MAP.get(coin, coin.upper())
    try:
        import pymongo  # noqa: PLC0415
        client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=3000)
        doc = client["crypto_db"]["model_registry"].find_one(
            {"coin": symbol, "is_active": True},
            {"_id": 0, "horizon": 1},
        )
        client.close()
        if doc:
            return int(doc["horizon"])
    except Exception:
        pass
    return 7


def list_models(
    coin: str | None = None,
    mongo_uri: str | None = None,
) -> list[dict]:
    """
    Return all registry entries, optionally filtered by coin symbol or coin_id.

    Each entry reflects current disk state (model_exists refreshed on read).
    """
    uri = mongo_uri or os.environ.get("MONGO_URI", _DEFAULT_URI)
    query: dict = {}
    if coin:
        symbol = COIN_SYMBOL_MAP.get(coin.lower(), coin.upper())
        query = {"$or": [{"coin": symbol}, {"coin_id": coin.lower()}]}
    try:
        import pymongo  # noqa: PLC0415
        client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=3000)
        docs = list(client["crypto_db"]["model_registry"].find(query, {"_id": 0}))
        client.close()
        # Refresh disk-state flag
        for d in docs:
            coin_id = d.get("coin_id", "")
            h = d.get("horizon", 7)
            d["model_exists"] = model_exists(coin_id, h)
        return docs
    except Exception:
        return []
