"""
accuracy_tracker.py — Compare past daily predictions to actual closing prices.

For each past prediction_date that has elapsed:
  1. Look up the most recent prediction in prediction_runs for that date.
  2. Look up the actual closing price in live_prices (±12h window) or historical_sma.
  3. Compute MAE, MAPE, and directional accuracy.
  4. Upsert result into prediction_accuracy collection.

MongoDB collections used
-------------------------
prediction_runs       — source: daily snapshots of past predictions
live_prices           — source: actual prices (price_usd + timestamp)
historical_sma        — source: actual daily prices fallback (avg_close + date)
prediction_accuracy   — destination: one accuracy doc per (coin, prediction_date)

MongoDB schema — prediction_accuracy
-------------------------------------
{
  "coin":                "BTC" | "DOGE",
  "prediction_date":     datetime (midnight UTC of the evaluated day),
  "predicted_price":     float,
  "actual_price":        float | None,
  "mae":                 float | None,
  "mape":                float | None,           # as percentage, e.g. 3.2 means 3.2%
  "direction_predicted": "UP" | "FLAT" | "DOWN" | None,
  "direction_actual":    "UP" | "DOWN" | None,   # computed from actual price change
  "direction_correct":   bool | None,
  "seed_source":         str,
  "model_version":       str,
  "evaluated_at":        datetime (UTC, when this doc was written),
}
Upsert key: (coin, prediction_date) — one accuracy record per day per coin.

Usage
-----
    from accuracy_tracker import evaluate_yesterday, get_accuracy_history

    # Called once per day (from inference_scheduler.py daily trigger)
    results = evaluate_yesterday(["bitcoin", "dogecoin"], mongo_uri=MONGO_URI)

    # Called by FastAPI / dashboard
    history = get_accuracy_history("BTC", days=14, mongo_uri=MONGO_URI)
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

try:
    import pymongo  # noqa: F401 — imported here for monkeypatching in tests
except ImportError:
    pymongo = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────
_DEFAULT_URI = "mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin"
_COLLECTION = "prediction_accuracy"
_LIVE_PRICES_WINDOW_HOURS = 12   # ±12h window around midnight to find actual price

_COIN_SYMBOL_MAP = {
    "bitcoin":  "BTC",
    "dogecoin": "DOGE",
}


def _db_name(uri: str) -> str:
    """Extract DB name from URI."""
    try:
        from pymongo.uri_parser import parse_uri
        db = parse_uri(uri).get("database")
        return db if db else "crypto_db"
    except Exception:
        return "crypto_db"


def _ensure_index(col) -> None:
    """Create compound index on (coin, prediction_date) if not present — idempotent."""
    existing = col.index_information()
    if "coin_prediction_date_1" not in existing:
        col.create_index(
            [("coin", 1), ("prediction_date", 1)],
            unique=True,
            name="coin_prediction_date_1",
        )


# ── Actual price lookup ────────────────────────────────────────────────────────

def get_actual_price(
    coin_symbol: str,
    date: datetime,
    mongo_uri: str | None = None,
) -> float | None:
    """
    Return the actual closing price for *coin_symbol* on *date* (midnight UTC).

    Priority
    --------
    1. ``live_prices`` — average of all price_usd entries within ±12h of midnight.
    2. ``historical_sma`` — avg_close for the matching date (daily batch layer).
    3. Returns None if no data is available for that date.

    Parameters
    ----------
    coin_symbol : "BTC" or "DOGE"
    date        : the date to look up (any time component is ignored; uses midnight UTC)
    mongo_uri   : optional override for MONGO_URI env var

    Returns
    -------
    float price in USD, or None.
    """
    uri = mongo_uri or os.environ.get("MONGO_URI", _DEFAULT_URI)
    # Normalise to midnight UTC
    midnight = date.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
    window_start = midnight - timedelta(hours=_LIVE_PRICES_WINDOW_HOURS)
    window_end   = midnight + timedelta(hours=_LIVE_PRICES_WINDOW_HOURS)

    try:
        client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=3000)
        db_obj = client[_db_name(uri)]

        # ── Priority 1: live_prices ───────────────────────────────────────────
        docs = list(db_obj.live_prices.find(
            {
                "coin":      coin_symbol,
                "timestamp": {"$gte": window_start, "$lte": window_end},
                "price_usd": {"$gt": 0},
            },
            projection={"_id": 0, "price_usd": 1},
        ))
        if docs:
            prices = [d["price_usd"] for d in docs if "price_usd" in d]
            if prices:
                actual = float(np.mean(prices))
                client.close()
                logger.debug(
                    "Actual price for %s on %s: $%.4f (avg of %d live_prices docs)",
                    coin_symbol, midnight.date(), actual, len(prices),
                )
                return actual

        # ── Priority 2: historical_sma ────────────────────────────────────────
        doc = db_obj.historical_sma.find_one(
            {
                "symbol": coin_symbol,
                "date": {"$gte": window_start, "$lte": window_end},
            },
            projection={"_id": 0, "avg_close": 1},
        )
        client.close()

        if doc and doc.get("avg_close", 0) > 0:
            actual = float(doc["avg_close"])
            logger.debug(
                "Actual price for %s on %s: $%.4f (historical_sma fallback)",
                coin_symbol, midnight.date(), actual,
            )
            return actual

        logger.info(
            "No actual price found for %s on %s in live_prices or historical_sma.",
            coin_symbol, midnight.date(),
        )
        return None

    except Exception as exc:
        logger.warning("get_actual_price failed for %s on %s: %s", coin_symbol, date, exc)
        return None


# ── Previous-day prediction lookup ────────────────────────────────────────────

def get_prediction_for_date(
    coin_symbol: str,
    prediction_date: datetime,
    mongo_uri: str | None = None,
) -> dict | None:
    """
    Return the most recent ``prediction_runs`` doc for *coin_symbol* on *prediction_date*.

    The most recent doc is the one with the largest ``run_date`` — i.e., the prediction
    generated closest to (but before) *prediction_date*.

    Returns None if no prediction exists.
    """
    uri = mongo_uri or os.environ.get("MONGO_URI", _DEFAULT_URI)
    midnight = prediction_date.replace(
        hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc
    )
    try:
        client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=3000)
        db_obj = client[_db_name(uri)]
        doc = db_obj.prediction_runs.find_one(
            {
                "coin":            coin_symbol,
                "prediction_date": midnight,
            },
            sort=[("run_date", -1)],    # most recent prediction first
            projection={"_id": 0},
        )
        client.close()
        return doc
    except Exception as exc:
        logger.warning(
            "get_prediction_for_date failed for %s on %s: %s",
            coin_symbol, midnight.date(), exc,
        )
        return None


# ── Accuracy computation ───────────────────────────────────────────────────────

def compute_accuracy_metrics(
    predicted_price: float,
    actual_price: float,
    predicted_direction: str | None,
    prev_actual_price: float | None,
) -> dict:
    """
    Compute MAE, MAPE, and directional accuracy for one prediction.

    Parameters
    ----------
    predicted_price      : model's forecasted USD price
    actual_price         : real closing price on that day
    predicted_direction  : "UP" | "FLAT" | "DOWN" from direction head (may be None)
    prev_actual_price    : actual price on the day *before* prediction_date, used to
                           determine actual direction. None → direction_actual = None.

    Returns
    -------
    dict with keys: mae, mape, direction_predicted, direction_actual, direction_correct
    """
    mae  = abs(predicted_price - actual_price)
    mape = (mae / actual_price) * 100.0 if actual_price > 0 else None

    # Actual direction: sign of (actual_price - prev_actual_price)
    direction_actual: str | None = None
    direction_correct: bool | None = None

    if prev_actual_price is not None and prev_actual_price > 0:
        delta = actual_price - prev_actual_price
        direction_actual = "UP" if delta > 0 else "DOWN"

        if predicted_direction is not None:
            # FLAT counts as wrong for directional accuracy
            direction_correct = (predicted_direction == direction_actual)

    return {
        "mae":                mae,
        "mape":               mape,
        "direction_predicted": predicted_direction,
        "direction_actual":   direction_actual,
        "direction_correct":  direction_correct,
    }


def _write_accuracy_doc(doc: dict, mongo_uri: str) -> None:
    """Upsert a prediction_accuracy document keyed by (coin, prediction_date)."""
    client = pymongo.MongoClient(mongo_uri, serverSelectionTimeoutMS=3000)
    db_obj = client[_db_name(mongo_uri)]
    col = db_obj[_COLLECTION]
    _ensure_index(col)
    col.update_one(
        {"coin": doc["coin"], "prediction_date": doc["prediction_date"]},
        {"$set": doc},
        upsert=True,
    )
    client.close()
    logger.info(
        "Accuracy upserted — %s %s: MAE=$%.2f MAPE=%.2f%% dir=%s→%s correct=%s",
        doc["coin"], doc["prediction_date"].date(),
        doc.get("mae") or 0,
        doc.get("mape") or 0,
        doc.get("direction_predicted", "?"),
        doc.get("direction_actual", "?"),
        doc.get("direction_correct"),
    )


# ── Main evaluation entry point ───────────────────────────────────────────────

def evaluate_yesterday(
    coins: list[str],
    mongo_uri: str | None = None,
) -> dict[str, dict]:
    """
    Evaluate yesterday's daily predictions against actual closing prices.

    For each coin in *coins*:
      1. Determine yesterday's date (UTC midnight).
      2. Look up the most recent prediction for that date from ``prediction_runs``.
      3. Get the actual closing price from ``live_prices`` / ``historical_sma``.
      4. Compute MAE, MAPE, directional accuracy.
      5. Upsert to ``prediction_accuracy`` collection.

    Parameters
    ----------
    coins     : list of CoinGecko coin ids, e.g. ["bitcoin", "dogecoin"]
    mongo_uri : optional MongoDB URI override (defaults to MONGO_URI env var)

    Returns
    -------
    dict mapping coin_id → accuracy metrics dict (or {"skipped": reason}).
    Keys in metrics: mae, mape, direction_predicted, direction_actual, direction_correct.
    """
    uri = mongo_uri or os.environ.get("MONGO_URI", _DEFAULT_URI)
    results: dict[str, dict] = {}

    now_utc    = datetime.now(timezone.utc)
    yesterday  = (now_utc - timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    day_before = (now_utc - timedelta(days=2)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    for coin in coins:
        symbol = _COIN_SYMBOL_MAP.get(coin, coin.upper())

        # 1. Get prediction for yesterday
        pred_doc = get_prediction_for_date(symbol, yesterday, mongo_uri=uri)
        if pred_doc is None:
            logger.info(
                "No prediction_runs doc for %s on %s — skipping accuracy.",
                symbol, yesterday.date(),
            )
            results[coin] = {"skipped": "no_prediction"}
            continue

        predicted_price     = float(pred_doc.get("predicted_price", 0))
        predicted_direction = pred_doc.get("direction")   # may be None (v1 model)

        # 2. Get actual price for yesterday
        actual_price = get_actual_price(symbol, yesterday, mongo_uri=uri)
        if actual_price is None:
            logger.info(
                "No actual price for %s on %s — accuracy cannot be computed yet.",
                symbol, yesterday.date(),
            )
            results[coin] = {"skipped": "no_actual_price"}
            continue

        # 3. Get actual price for day-before (to derive direction_actual)
        prev_actual = get_actual_price(symbol, day_before, mongo_uri=uri)

        # 4. Compute metrics
        metrics = compute_accuracy_metrics(
            predicted_price=predicted_price,
            actual_price=actual_price,
            predicted_direction=predicted_direction,
            prev_actual_price=prev_actual,
        )

        # 5. Build and upsert document
        doc = {
            "coin":                symbol,
            "prediction_date":     yesterday,
            "predicted_price":     predicted_price,
            "actual_price":        actual_price,
            "mae":                 metrics["mae"],
            "mape":                metrics["mape"],
            "direction_predicted": metrics["direction_predicted"],
            "direction_actual":    metrics["direction_actual"],
            "direction_correct":   metrics["direction_correct"],
            "seed_source":         pred_doc.get("seed_source", "unknown"),
            "model_version":       pred_doc.get("model_version", "unknown"),
            "evaluated_at":        now_utc,
        }
        _write_accuracy_doc(doc, uri)
        results[coin] = metrics

    return results


# ── History query ──────────────────────────────────────────────────────────────

def get_accuracy_history(
    coin_symbol: str,
    days: int = 30,
    mongo_uri: str | None = None,
) -> list[dict]:
    """
    Return the last *days* accuracy records for *coin_symbol*, newest first.

    Parameters
    ----------
    coin_symbol : "BTC" or "DOGE"
    days        : number of past days to query (default: 30)
    mongo_uri   : optional MongoDB URI override

    Returns
    -------
    list of dicts from ``prediction_accuracy`` collection, sorted by prediction_date desc.
    Returns empty list if MongoDB is unavailable or no records exist.
    """
    uri = mongo_uri or os.environ.get("MONGO_URI", _DEFAULT_URI)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    try:
        client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=3000)
        db_obj = client[_db_name(uri)]
        docs = list(db_obj[_COLLECTION].find(
            {
                "coin":            coin_symbol,
                "prediction_date": {"$gte": cutoff},
            },
            sort=[("prediction_date", -1)],
            projection={"_id": 0},
        ))
        client.close()
        return docs
    except Exception as exc:
        logger.warning("get_accuracy_history failed for %s: %s", coin_symbol, exc)
        return []


if __name__ == "__main__":
    import logging as _logging
    _logging.basicConfig(level=_logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    print("Running accuracy evaluation for yesterday...")
    results = evaluate_yesterday(["bitcoin", "dogecoin"])
    for coin, r in results.items():
        print(f"  {coin}: {r}")
