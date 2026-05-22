"""
inference.py — Load trained LSTM, generate 7-day BTC / DOGE price forecast,
               and write predictions to MongoDB  predictions  collection.

Usage
-----
    python src/ml/inference.py [--coin bitcoin|dogecoin]

Data source priority
--------------------
1. MongoDB  historical_sma  collection — last 60 days of  avg_close  for coin.
2. CSV fallback — data/sample/{coin}.csv  last 60 rows (when MongoDB is empty
   or unreachable).

Prediction strategy
-------------------
Iterative / autoregressive: each predicted price is fed back as the input
for the next step so we produce HORIZON = 7 forward-looking daily prices.

MongoDB document written per prediction
----------------------------------------
{
    "coin":             "BTC" | "DOGE",
    "predicted_price":  float,
    "prediction_date":  datetime (future date, UTC),
    "confidence":       0.8,           # placeholder — LSTM output is a point estimate
    "model_version":    "lstm_v1",
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
import torch

from model import LSTMModel

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
    n: int = SEQ_LEN,
    mongo_uri: str | None = None,
) -> np.ndarray | None:
    """
    Query  historical_sma  for the last *n* avg_close values for *coin_symbol*.
    Returns a 1-D numpy array sorted chronologically, or None on failure.
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


def _load_last_n_from_csv(coin: str, n: int = SEQ_LEN) -> np.ndarray:
    """Return the last *n* close prices from the coin sample CSV."""
    import pandas as pd
    csv_path = _DATA_DIR / f"{coin}.csv"
    df = pd.read_csv(csv_path)
    col = "price" if "price" in df.columns else "close"
    prices = df[col].dropna().values[-n:]
    logger.info("Loaded %d close prices from CSV fallback (%s).", len(prices), csv_path)
    return prices.astype(np.float32)


# ── Iterative forecast ─────────────────────────────────────────────────────────

@torch.no_grad()
def _iterative_predict(
    model: LSTMModel,
    seed_sequence: np.ndarray,
    scaler,
    horizon: int = HORIZON,
) -> np.ndarray:
    """
    Generate *horizon* future price predictions autoregressively.

    Parameters
    ----------
    model         : trained LSTMModel in eval mode.
    seed_sequence : 1-D array of shape (SEQ_LEN,) — last SEQ_LEN raw prices.
    scaler        : fitted MinMaxScaler.
    horizon       : number of steps to forecast.

    Returns
    -------
    1-D numpy array of predicted prices in original USD scale.
    """
    model.eval()

    # Normalise the seed
    norm_seq = scaler.transform(seed_sequence.reshape(-1, 1)).flatten()

    predictions_norm: list[float] = []
    window = list(norm_seq)   # mutable sliding window

    for _ in range(horizon):
        # Shape: (1, SEQ_LEN, 1)
        x = torch.tensor(window[-SEQ_LEN:], dtype=torch.float32).unsqueeze(0).unsqueeze(-1)
        pred_norm = model(x).squeeze().item()
        predictions_norm.append(pred_norm)
        window.append(pred_norm)   # feed prediction back as next input

    # Inverse-transform to USD prices
    preds_usd = scaler.inverse_transform(
        np.array(predictions_norm, dtype=np.float32).reshape(-1, 1)
    ).flatten()
    return preds_usd


# ── MongoDB write ──────────────────────────────────────────────────────────────

def _write_predictions(
    predictions_usd: np.ndarray,
    coin_symbol: str,
    mongo_uri: str | None = None,
) -> list[dict]:
    """
    Write 7-day forecast to  predictions  collection (upsert on coin + prediction_date).

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
            "created_at": now_utc,
        }
        collection.update_one(
            {"coin": doc["coin"], "prediction_date": doc["prediction_date"]},
            {"$set": doc},
            upsert=True,
        )
        docs_written.append(doc)
        logger.info(
            "Upserted prediction: %s  date=%s  price=$%.2f",
            coin_symbol, prediction_date.date(), price,
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

    model = LSTMModel(input_size=1, hidden_size=128, num_layers=2, dropout=0.2, output_size=1)
    model.load_state_dict(torch.load(model_path, map_location="cpu"))
    model.eval()
    logger.info("Loaded model from %s", model_path)

    with open(scaler_path, "rb") as f:
        scaler = pickle.load(f)
    logger.info("Loaded scaler from %s", scaler_path)

    # ── 2. Seed data ───────────────────────────────────────────────────────────
    seed = _load_last_n_from_mongo(coin_symbol, n=SEQ_LEN, mongo_uri=mongo_uri)
    if seed is None:
        seed = _load_last_n_from_csv(coin, n=SEQ_LEN)

    # ── 3. Forecast ────────────────────────────────────────────────────────────
    predictions_usd = _iterative_predict(model, seed, scaler, horizon=HORIZON)
    logger.info("7-day forecast for %s (USD): %s", coin_symbol, [f"${p:.2f}" for p in predictions_usd])

    # ── 4. Write to MongoDB ────────────────────────────────────────────────────
    docs = _write_predictions(predictions_usd, coin_symbol=coin_symbol, mongo_uri=mongo_uri)
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
        print(f"  {d['prediction_date'].date()}  ${d['predicted_price']:,.2f}")
