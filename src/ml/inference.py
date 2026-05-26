"""
inference.py — Load trained LSTM, generate 7-day BTC / DOGE price forecast,
               and write predictions to MongoDB  predictions  collection.

Usage
-----
    python src/ml/inference.py [--coin bitcoin|dogecoin]

Model version priority
-----------------------
1. lstm_{coin}_v2.pt  (multi-task: price + direction head)
2. lstm_{coin}_v1.pt  (price-only, backward compat)

Data source priority
--------------------
1. MongoDB  live_prices  collection — directly written by producer on every
   CoinGecko API call.
2. MongoDB  historical_sma  collection — batch-layer daily avg_close.
3. CSV fallback — data/sample/{coin}.csv  last SEQ_LEN+31 rows.

Prediction strategy
-------------------
MIMO (Multi-Input Multi-Output): a single forward pass predicts all 7 future
log_return_1d values at once, eliminating error compounding from autoregressive
chaining. USD prices are reconstructed as:
    price[k] = last_price_usd * exp( cumsum(log_returns)[k] )

For v2 model: direction is derived from the direction head (softmax argmax).
Trend strength is derived from predicted log_return magnitude vs scaler scale.

MongoDB document written per prediction
----------------------------------------
{
    "coin":             "BTC" | "DOGE",
    "predicted_price":  float,
    "prediction_date":  datetime (future date, UTC),
    "confidence":       0.8,
    "model_version":    "lstm_v2",
    "seed_source":      "live_prices" | "historical_sma" | "csv",
    "created_at":       datetime.utcnow(),
    "direction":        "UP" | "FLAT" | "DOWN",       # v2 only
    "direction_prob":   float in [0, 1],              # v2 only
    "trend_strength":   "STRONG" | "MODERATE" | "WEAK"  # v2 only
}

Upsert key: (coin, prediction_date)
"""

from __future__ import annotations

import argparse
import logging
import os
import pickle
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import torch

from model import LSTMModel
from preprocess import _build_features

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)

# ── Paths ──────────────────────────────────────────────────────────────────────
_HERE = Path(__file__).resolve().parent
_MODEL_DIR = _HERE / "model"
_DATA_DIR = _HERE.parent.parent / "data" / "sample"

# ── Constants ──────────────────────────────────────────────────────────────────
SEQ_LEN = 60
HORIZON = 7
MODEL_VERSION = "lstm_v2"
CONFIDENCE = 0.8

_DEFAULT_URI = "mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin"
_DEFAULT_DB = "crypto_db"

# Direction class mapping
_DIR_CLASSES = {0: "DOWN", 1: "FLAT", 2: "UP"}

# Coin id → symbol map
_COIN_SYMBOL_MAP = {
    "bitcoin":  "BTC",
    "dogecoin": "DOGE",
}


def _db_name_from_uri(uri: str) -> str:
    """Extract the database name from the MongoDB URI; fall back to _DEFAULT_DB."""
    try:
        from pymongo.uri_parser import parse_uri
        db = parse_uri(uri).get("database")
        return db if db else _DEFAULT_DB
    except Exception:
        return _DEFAULT_DB


def _model_path(coin: str) -> Path:
    """Return path for v2 model; kept for backward compat with old tests."""
    return _MODEL_DIR / f"lstm_{coin}_v1.pt"


def _scaler_path(coin: str) -> Path:
    return _MODEL_DIR / f"scaler_{coin}.pkl"


def _model_path_v2(coin: str) -> Path:
    return _MODEL_DIR / f"lstm_{coin}_v2.pt"


def _model_path_v1(coin: str) -> Path:
    return _MODEL_DIR / f"lstm_{coin}_v1.pt"


# ── Data loading ───────────────────────────────────────────────────────────────

def _load_last_n_from_mongo(
    coin_symbol: str,
    n: int,
    mongo_uri: str | None = None,
) -> np.ndarray | None:
    """
    Query  historical_sma  for the last *n* avg_close values for *coin_symbol*.
    Returns a 1-D numpy array of close prices sorted chronologically, or None on failure.
    """
    uri = mongo_uri or os.environ.get("MONGO_URI", _DEFAULT_URI)
    try:
        import pymongo
        client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=3000)
        db = client["crypto_db"]
        cursor = db.historical_sma.find(
            {"symbol": coin_symbol},
            sort=[("date", -1)],
            limit=n,
            projection={"_id": 0, "avg_close": 1},
        )
        docs = list(cursor)
        client.close()
        if len(docs) < n:
            logger.warning(
                "Only %d docs found in historical_sma for %s (need %d); using CSV fallback.",
                len(docs), coin_symbol, n,
            )
            return None
        prices = np.array([d["avg_close"] for d in reversed(docs)], dtype=np.float32)
        logger.info("Loaded %d close prices from MongoDB historical_sma.", n)
        return prices
    except Exception as exc:
        logger.warning("MongoDB unavailable (%s); using CSV fallback.", exc)
        return None


def _load_last_n_from_live_prices(
    coin_symbol: str,
    n: int,
    mongo_uri: str | None = None,
) -> np.ndarray | None:
    """
    Query  live_prices  for the last *n* price_usd values for *coin_symbol*.
    Returns a 1-D numpy array sorted chronologically, or None when insufficient data.
    """
    uri = mongo_uri or os.environ.get("MONGO_URI", _DEFAULT_URI)
    try:
        import pymongo
        client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=3000)
        db = client["crypto_db"]
        cursor = db.live_prices.find(
            {"coin": coin_symbol},
            sort=[("timestamp", -1)],
            limit=n,
            projection={"_id": 0, "price_usd": 1},
        )
        docs = list(cursor)
        client.close()
        if len(docs) < n:
            logger.info(
                "live_prices has %d/%d rows for %s — insufficient; trying historical_sma.",
                len(docs), n, coin_symbol,
            )
            return None
        # Validate canonical field is present before building the array
        missing_field = [i for i, d in enumerate(docs) if "price_usd" not in d]
        if missing_field:
            logger.error(
                "live_prices schema mismatch: %d/%d docs missing 'price_usd' for %s "
                "— check producer field names. Falling back to historical_sma.",
                len(missing_field), len(docs), coin_symbol,
            )
            return None
        prices = np.array([d["price_usd"] for d in reversed(docs)], dtype=np.float32)
        logger.info("Loaded %d prices from live_prices (freshest seed).", n)
        return prices
    except Exception as exc:
        logger.warning("live_prices unavailable (%s); trying historical_sma.", exc)
        return None


def _load_last_n_from_csv(coin: str, n: int) -> np.ndarray:
    """Return the last *n* close prices from the coin sample CSV (1-D array)."""
    csv_path = _DATA_DIR / f"{coin}.csv"
    df = pd.read_csv(csv_path)
    col = "price" if "price" in df.columns else "close"
    prices = df[col].dropna().values[-n:]
    logger.info("Loaded %d close prices from CSV fallback (%s).", len(prices), csv_path)
    return prices.astype(np.float32)


# ── Strength derivation ────────────────────────────────────────────────────────

def _derive_strength(log_ret: float, scale0: float) -> str:
    """Map a log-return value to trend strength label.

    Parameters
    ----------
    log_ret : the predicted log return for one step (un-scaled).
    scale0  : scaler.scale_[0] — standard deviation of log_return_1d from training.

    Returns
    -------
    "STRONG" | "MODERATE" | "WEAK"
    """
    abs_ret = abs(log_ret)
    if abs_ret > 2 * scale0:
        return "STRONG"
    elif abs_ret > scale0:
        return "MODERATE"
    else:
        return "WEAK"


# ── MIMO forecast ──────────────────────────────────────────────────────────────

@torch.no_grad()
def _mimo_predict(
    model: LSTMModel,
    seed_features: np.ndarray,
    scaler,
    last_price_usd: float,
    horizon: int = HORIZON,
) -> np.ndarray:
    """
    Generate *horizon* future USD prices via a single MIMO forward pass.

    Works with both v1 (price only) and v2 (dual-head) models.
    Returns 1-D numpy array of *horizon* predicted prices in original USD scale.

    Parameters
    ----------
    model          : trained LSTMModel in eval mode.
    seed_features  : ndarray (SEQ_LEN, n_features) — already scaled feature window.
    scaler         : fitted StandardScaler.
    last_price_usd : raw USD close price at the last seed timestep.
    horizon        : number of steps to forecast.
    """
    model.eval()

    n_features = seed_features.shape[1]
    x = torch.tensor(seed_features[np.newaxis, :, :], dtype=torch.float32)

    result = model(x)

    # Handle both single-head (tensor) and dual-head (tuple) outputs
    if isinstance(result, tuple):
        log_rets_norm = result[0].squeeze(0).cpu().numpy()   # (horizon,)
    else:
        log_rets_norm = result.squeeze(0).cpu().numpy()

    # Un-standardise feature-0 (log_return_1d): norm * scale + mean
    log_rets = log_rets_norm * scaler.scale_[0] + scaler.mean_[0]

    # Reconstruct USD prices: price[k] = last_price * exp( cumsum(log_rets)[k] )
    prices_usd = last_price_usd * np.exp(np.cumsum(log_rets))
    return prices_usd.astype(np.float32)


@torch.no_grad()
def _mimo_predict_full(
    model: LSTMModel,
    seed_features: np.ndarray,
    scaler,
    last_price_usd: float,
    horizon: int = HORIZON,
) -> tuple[np.ndarray, list[str], list[float], list[str]]:
    """
    Full v2 MIMO forward pass returning prices + direction + strength.

    Returns
    -------
    prices_usd    : (horizon,) float32 array of USD prices
    directions    : list of 'UP' | 'FLAT' | 'DOWN' per step
    dir_probs     : list of float confidence in [0, 1] per step
    strengths     : list of 'STRONG' | 'MODERATE' | 'WEAK' per step
    """
    model.eval()

    x = torch.tensor(seed_features[np.newaxis, :, :], dtype=torch.float32)
    result = model(x)

    if isinstance(result, tuple):
        price_tensor, dir_logit_tensor = result
        log_rets_norm = price_tensor.squeeze(0).cpu().numpy()     # (horizon,)
        dir_logits    = dir_logit_tensor.squeeze(0).cpu().numpy() # (horizon, 3)

        # Softmax for probabilities
        exp_logits = np.exp(dir_logits - dir_logits.max(axis=1, keepdims=True))
        dir_probs_arr = exp_logits / exp_logits.sum(axis=1, keepdims=True)   # (horizon, 3)
        dir_classes   = np.argmax(dir_probs_arr, axis=1)                      # (horizon,)

        directions = [_DIR_CLASSES[int(c)] for c in dir_classes]
        dir_probs  = [float(dir_probs_arr[i, dir_classes[i]]) for i in range(horizon)]
    else:
        # v1 fallback: no direction head
        log_rets_norm = result.squeeze(0).cpu().numpy()
        directions = ["FLAT"] * horizon
        dir_probs  = [0.5] * horizon

    # Un-standardise
    log_rets   = log_rets_norm * scaler.scale_[0] + scaler.mean_[0]
    prices_usd = last_price_usd * np.exp(np.cumsum(log_rets))

    # Trend strength from magnitude of log_return per step
    scale0 = float(scaler.scale_[0])
    strengths = [_derive_strength(float(lr), scale0) for lr in log_rets]

    return prices_usd.astype(np.float32), directions, dir_probs, strengths


# ── MongoDB write ──────────────────────────────────────────────────────────────

def _write_predictions(
    predictions_usd: np.ndarray,
    coin_symbol: str,
    mongo_uri: str | None = None,
    seed_source: str = "unknown",
    directions: list[str] | None = None,
    dir_probs: list[float] | None = None,
    strengths: list[str] | None = None,
) -> list[dict]:
    """
    Write 7-day forecast to  predictions  collection (upsert on coin + prediction_date).

    Parameters
    ----------
    directions  : per-step direction labels ("UP"|"FLAT"|"DOWN"), length=HORIZON
    dir_probs   : per-step confidence for predicted direction, length=HORIZON
    strengths   : per-step trend strength ("STRONG"|"MODERATE"|"WEAK"), length=HORIZON

    Returns the list of documents written.
    """
    uri = mongo_uri or os.environ.get("MONGO_URI", _DEFAULT_URI)
    import pymongo

    client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=5000)
    db = client[_db_name_from_uri(uri)]
    collection = db["predictions"]

    now_utc = datetime.now(timezone.utc)
    docs_written: list[dict] = []

    for offset, price in enumerate(predictions_usd, start=1):
        prediction_date = (
            now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
            + timedelta(days=offset)
        )
        doc = {
            "coin":            coin_symbol,
            "predicted_price": float(price),
            "prediction_date": prediction_date,
            "confidence":      CONFIDENCE,
            "model_version":   MODEL_VERSION,
            "seed_source":     seed_source,
            "created_at":      now_utc,
        }
        # Add v2 fields when available
        idx = offset - 1
        if directions is not None and idx < len(directions):
            doc["direction"] = directions[idx]
        if dir_probs is not None and idx < len(dir_probs):
            doc["direction_prob"] = dir_probs[idx]
        if strengths is not None and idx < len(strengths):
            doc["trend_strength"] = strengths[idx]

        collection.update_one(
            {"coin": doc["coin"], "prediction_date": doc["prediction_date"]},
            {"$set": doc},
            upsert=True,
        )
        docs_written.append(doc)
        logger.info(
            "Upserted prediction: %s  date=%s  price=$%.4f  dir=%s  strength=%s  seed=%s",
            coin_symbol, prediction_date.date(), price,
            doc.get("direction", "—"),
            doc.get("trend_strength", "—"),
            seed_source,
        )

    # ── Append to prediction_runs (historical log) ─────────────────────────
    # Keyed by (coin, run_date_day, prediction_date) so each calendar day
    # produces at most one record per future date, regardless of how many
    # times the scheduler fires. This lets users review model accuracy once
    # enough days have passed for predicted dates to become actual dates.
    run_date_day = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
    runs_col = db["prediction_runs"]
    for doc in docs_written:
        run_doc = {**doc, "run_date": run_date_day}
        runs_col.update_one(
            {
                "coin": run_doc["coin"],
                "run_date": run_date_day,
                "prediction_date": run_doc["prediction_date"],
            },
            {"$set": run_doc},
            upsert=True,
        )

    client.close()
    return docs_written


# ── Main entry-point ───────────────────────────────────────────────────────────

def run_inference(coin: str = "bitcoin", mongo_uri: str | None = None) -> list[dict]:
    """
    Full inference pipeline: load model → build seed → forecast → write to MongoDB.

    Tries to load v2 model first; falls back to v1 (no direction head) if v2 not found.

    Parameters
    ----------
    coin      : CoinGecko coin id — "bitcoin" or "dogecoin"
    mongo_uri : optional MongoDB URI override

    Returns list of prediction documents.
    """
    coin_symbol = _COIN_SYMBOL_MAP.get(coin, coin.upper())
    scaler_path = _scaler_path(coin)

    if not scaler_path.exists():
        raise FileNotFoundError(
            f"Scaler not found at {scaler_path}. "
            f"Run  python src/ml/train_lstm.py --coin {coin}  first."
        )

    # ── 1. Load model (v2 preferred, v1 fallback) ──────────────────────────────
    path_v2 = _model_path_v2(coin)
    path_v1 = _model_path_v1(coin)

    use_v2 = path_v2.exists()
    use_direction_head = use_v2

    if use_v2:
        model_path = path_v2
        logger.info("Loading v2 model from %s", model_path)
    elif path_v1.exists():
        model_path = path_v1
        logger.info("v2 model not found; falling back to v1 at %s", model_path)
    else:
        raise FileNotFoundError(
            f"No trained model found. "
            f"Run  python src/ml/train_lstm.py --coin {coin}  first."
        )

    with open(scaler_path, "rb") as f:
        scaler = pickle.load(f)
    logger.info("Loaded scaler from %s", scaler_path)

    # Determine input_size from scaler (number of features)
    n_features = len(scaler.mean_) if hasattr(scaler, "mean_") else 9

    model = LSTMModel(
        input_size=n_features,
        hidden_size=128,
        num_layers=2,
        dropout=0.2,
        output_size=7,
        use_direction_head=use_direction_head,
        n_classes=3,
    )
    model.load_state_dict(torch.load(model_path, map_location="cpu"))
    model.eval()
    logger.info("Loaded model from %s (direction_head=%s)", model_path, use_direction_head)

    # ── 2. Seed data — fetch SEQ_LEN + 31 rows for feature warmup ─────────────
    n_fetch = SEQ_LEN + 31

    raw_close = _load_last_n_from_live_prices(coin_symbol, n=n_fetch, mongo_uri=mongo_uri)
    seed_source = "live_prices"

    if raw_close is None:
        raw_close = _load_last_n_from_mongo(coin_symbol, n=n_fetch, mongo_uri=mongo_uri)
        seed_source = "historical_sma"

    if raw_close is None:
        raw_close = _load_last_n_from_csv(coin, n=n_fetch)
        seed_source = "csv"

    logger.info("Seed source for %s: %s", coin_symbol, seed_source)

    # ── 3. Build features from raw close prices ────────────────────────────────
    df_seed = pd.DataFrame({"close": raw_close.astype(np.float64)})
    features = _build_features(df_seed)   # (n_fetch, n_features)

    valid = ~np.isnan(features).any(axis=1)
    features = features[valid]
    close_for_seed = raw_close[valid]

    if len(features) < SEQ_LEN:
        raise ValueError(
            f"Not enough clean rows after warmup drop: {len(features)} < SEQ_LEN={SEQ_LEN}. "
            "Fetch more history."
        )

    # ── 4. Scale seed and take last SEQ_LEN rows ──────────────────────────────
    # Pad/trim feature columns to match what scaler was trained on
    n_scaler_feats = len(scaler.mean_)
    if features.shape[1] > n_scaler_feats:
        features = features[:, :n_scaler_feats]
    elif features.shape[1] < n_scaler_feats:
        pad = np.zeros((len(features), n_scaler_feats - features.shape[1]), dtype=np.float32)
        features = np.concatenate([features, pad], axis=1)

    seed_scaled = scaler.transform(features)
    seed = seed_scaled[-SEQ_LEN:]          # (SEQ_LEN, n_features)
    last_price_usd = float(close_for_seed[-1])

    # ── 5. MIMO forecast ───────────────────────────────────────────────────────
    if use_direction_head:
        predictions_usd, directions, dir_probs, strengths = _mimo_predict_full(
            model, seed, scaler, last_price_usd, horizon=HORIZON
        )
    else:
        predictions_usd = _mimo_predict(model, seed, scaler, last_price_usd, horizon=HORIZON)
        directions = dir_probs = strengths = None

    logger.info(
        "7-day forecast for %s (USD): %s",
        coin_symbol,
        [f"${p:.4f}" for p in predictions_usd],
    )

    # ── 6. Write to MongoDB ────────────────────────────────────────────────────
    docs = _write_predictions(
        predictions_usd,
        coin_symbol=coin_symbol,
        mongo_uri=mongo_uri,
        seed_source=seed_source,
        directions=directions,
        dir_probs=dir_probs,
        strengths=strengths,
    )
    return docs


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run LSTM inference for BTC or DOGE")
    parser.add_argument(
        "--coin", type=str, default="bitcoin",
        choices=["bitcoin", "dogecoin"],
        help="CoinGecko coin id (default: bitcoin)",
    )
    args = parser.parse_args()

    docs = run_inference(coin=args.coin)
    print(f"\nWrote {len(docs)} predictions for {args.coin} to MongoDB predictions collection.")
    for d in docs:
        direction = d.get("direction", "—")
        strength  = d.get("trend_strength", "—")
        print(f"  {d['prediction_date'].date()}  ${d['predicted_price']:,.4f}  "
              f"{direction}  {strength}")
