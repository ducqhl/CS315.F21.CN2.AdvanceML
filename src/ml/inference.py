"""
inference.py — Load trained LSTM, generate 7-day BTC / DOGE price forecast,
               and write predictions to MongoDB  predictions  collection.

Usage
-----
    python src/ml/inference.py [--coin bitcoin|dogecoin]

Data source priority
--------------------
1. MongoDB  live_prices  collection — directly written by producer on every
   CoinGecko API call. Requires ≥ SEQ_LEN+31 = 91 rows to be useful.
   Accumulates at 10-min poll interval → ~15 hours to reach threshold.
2. MongoDB  historical_sma  collection — batch-layer daily avg_close.
3. CSV fallback — data/sample/{coin}.csv  last SEQ_LEN+31 rows.

Prediction strategy
-------------------
MIMO (Multi-Input Multi-Output): a single forward pass predicts all 7 future
log_return_1d values at once, eliminating error compounding from autoregressive
chaining. USD prices are reconstructed as:
    price[k] = last_price_usd * exp( cumsum(log_returns)[k] )

MongoDB document written per prediction
----------------------------------------
{
    "coin":             "BTC" | "DOGE",
    "predicted_price":  float,
    "prediction_date":  datetime (future date, UTC),
    "confidence":       0.8,           # placeholder
    "model_version":    "lstm_v1",
    "seed_source":      "live_prices" | "historical_sma" | "csv",
    "created_at":       datetime.utcnow()
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
MODEL_VERSION = "lstm_v1"
CONFIDENCE = 0.8

_DEFAULT_URI = "mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin"
_DEFAULT_DB = "crypto_db"

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
    return _MODEL_DIR / f"lstm_{coin}_v1.pt"


def _scaler_path(coin: str) -> Path:
    return _MODEL_DIR / f"scaler_{coin}.pkl"


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
        # Reverse so chronological order (oldest first)
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

    live_prices is written directly by the producer on every CoinGecko poll —
    it accumulates faster than historical_sma (which requires a Spark batch run).
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
        # Reverse to chronological order (oldest first)
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

    Parameters
    ----------
    model          : trained LSTMModel in eval mode.
    seed_features  : ndarray (SEQ_LEN, 5) — already scaled feature window.
    scaler         : fitted StandardScaler.
    last_price_usd : raw USD close price at the last seed timestep.
    horizon        : number of steps to forecast (should match output_size=7).

    Returns
    -------
    1-D numpy array of *horizon* predicted prices in original USD scale.
    """
    model.eval()

    # Shape: (1, SEQ_LEN, 5)
    x = torch.tensor(seed_features[np.newaxis, :, :], dtype=torch.float32)

    # Single forward pass → (1, horizon) normalised log_return_1d values
    log_rets_norm = model(x).squeeze(0).cpu().numpy()   # (horizon,)

    # Un-standardise feature-0 (log_return_1d): norm * scale + mean
    log_rets = log_rets_norm * scaler.scale_[0] + scaler.mean_[0]

    # Reconstruct USD prices: price[k] = last_price * exp( cumsum(log_rets)[k] )
    prices_usd = last_price_usd * np.exp(np.cumsum(log_rets))
    return prices_usd.astype(np.float32)


# ── MongoDB write ──────────────────────────────────────────────────────────────

def _write_predictions(
    predictions_usd: np.ndarray,
    coin_symbol: str,
    mongo_uri: str | None = None,
    seed_source: str = "unknown",
) -> list[dict]:
    """
    Write 7-day forecast to  predictions  collection (upsert on coin + prediction_date).

    Parameters
    ----------
    seed_source : which data source seeded this inference run
                  ("live_prices" | "historical_sma" | "csv")

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
            "coin": coin_symbol,
            "predicted_price": float(price),
            "prediction_date": prediction_date,
            "confidence": CONFIDENCE,
            "model_version": MODEL_VERSION,
            "seed_source": seed_source,
            "created_at": now_utc,
        }
        collection.update_one(
            {"coin": doc["coin"], "prediction_date": doc["prediction_date"]},
            {"$set": doc},
            upsert=True,
        )
        docs_written.append(doc)
        logger.info(
            "Upserted prediction: %s  date=%s  price=$%.4f  seed=%s",
            coin_symbol, prediction_date.date(), price, seed_source,
        )

    client.close()
    return docs_written


# ── Main entry-point ───────────────────────────────────────────────────────────

def run_inference(coin: str = "bitcoin", mongo_uri: str | None = None) -> list[dict]:
    """
    Full inference pipeline: load model → build seed → forecast → write to MongoDB.

    Parameters
    ----------
    coin      : CoinGecko coin id — "bitcoin" or "dogecoin"
    mongo_uri : optional MongoDB URI override

    Returns list of prediction documents.
    """
    coin_symbol = _COIN_SYMBOL_MAP.get(coin, coin.upper())
    model_path = _model_path(coin)
    scaler_path = _scaler_path(coin)

    # ── 1. Load model ──────────────────────────────────────────────────────────
    if not model_path.exists():
        raise FileNotFoundError(
            f"Trained model not found at {model_path}. "
            f"Run  python src/ml/train_lstm.py --coin {coin}  first."
        )
    if not scaler_path.exists():
        raise FileNotFoundError(
            f"Scaler not found at {scaler_path}. "
            f"Run  python src/ml/train_lstm.py --coin {coin}  first."
        )

    model = LSTMModel(input_size=5, hidden_size=128, num_layers=2, dropout=0.2, output_size=7)
    model.load_state_dict(torch.load(model_path, map_location="cpu"))
    model.eval()
    logger.info("Loaded model from %s", model_path)

    with open(scaler_path, "rb") as f:
        scaler = pickle.load(f)
    logger.info("Loaded scaler from %s", scaler_path)

    # ── 2. Seed data — fetch SEQ_LEN + 31 rows for feature warmup ─────────────
    n_fetch = SEQ_LEN + 31   # extra 31 rows to cover warmup (log_return_30d + RSI_14)

    # Priority 1: live_prices (freshest — directly written by producer every poll cycle)
    raw_close = _load_last_n_from_live_prices(coin_symbol, n=n_fetch, mongo_uri=mongo_uri)
    seed_source = "live_prices"

    # Priority 2: historical_sma (batch layer — reliable but updated less frequently)
    if raw_close is None:
        raw_close = _load_last_n_from_mongo(coin_symbol, n=n_fetch, mongo_uri=mongo_uri)
        seed_source = "historical_sma"

    # Priority 3: CSV fallback (static file — always available)
    if raw_close is None:
        raw_close = _load_last_n_from_csv(coin, n=n_fetch)
        seed_source = "csv"

    logger.info("Seed source for %s: %s", coin_symbol, seed_source)

    # ── 3. Build features from raw close prices ────────────────────────────────
    df_seed = pd.DataFrame({"close": raw_close.astype(np.float64)})
    features = _build_features(df_seed)   # (n_fetch, 5); warmup rows have NaN

    # Drop warmup rows
    valid = ~np.isnan(features).any(axis=1)
    features = features[valid]
    close_for_seed = raw_close[valid]

    if len(features) < SEQ_LEN:
        raise ValueError(
            f"Not enough clean rows after warmup drop: {len(features)} < SEQ_LEN={SEQ_LEN}. "
            "Fetch more history."
        )

    # ── 4. Scale seed and take last SEQ_LEN rows ──────────────────────────────
    seed_scaled = scaler.transform(features)
    seed = seed_scaled[-SEQ_LEN:]          # (SEQ_LEN, 5)
    last_price_usd = float(close_for_seed[-1])

    # ── 5. MIMO forecast ───────────────────────────────────────────────────────
    predictions_usd = _mimo_predict(model, seed, scaler, last_price_usd, horizon=HORIZON)
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
        print(f"  {d['prediction_date'].date()}  ${d['predicted_price']:,.4f}")
