"""
inference.py — Load trained LSTM, generate 7-day BTC price forecast,
               and write predictions to MongoDB  predictions  collection.

Data source priority
--------------------
1. MongoDB  historical_sma  collection — last 60 days of  avg_close  for BTC.
2. CSV fallback — data/sample/bitcoin.csv  last 60 rows (when MongoDB is empty
   or unreachable).

Prediction strategy
-------------------
Iterative / autoregressive: each predicted price is fed back as the input
for the next step so we produce HORIZON = 7 forward-looking daily prices.

MongoDB document written per prediction
----------------------------------------
{
    "coin":             "BTC",
    "predicted_price":  float,
    "prediction_date":  datetime (future date, UTC),
    "confidence":       0.8,           # placeholder — LSTM output is a point estimate
    "model_version":    "lstm_v1",
    "created_at":       datetime.utcnow()
}

Upsert key: (coin, prediction_date)
"""

from __future__ import annotations

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
MODEL_PATH = _HERE / "model" / "lstm_btc.pt"
SCALER_PATH = _HERE / "model" / "scaler.pkl"
_CSV_FALLBACK = _HERE.parent.parent / "data" / "sample" / "bitcoin.csv"

# ── Constants ──────────────────────────────────────────────────────────────────
SEQ_LEN = 60
HORIZON = 7
COIN = "BTC"
MODEL_VERSION = "lstm_v1"
CONFIDENCE = 0.8

_DEFAULT_URI = "mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin"


# ── Data loading ───────────────────────────────────────────────────────────────

def _load_last_n_from_mongo(n: int = SEQ_LEN, mongo_uri: str | None = None) -> np.ndarray | None:
    """
    Query  historical_sma  for the last *n* avg_close values for BTC.
    Returns a 1-D numpy array sorted chronologically, or None on failure.
    """
    uri = mongo_uri or os.environ.get("MONGO_URI", _DEFAULT_URI)
    try:
        import pymongo
        client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=3000)
        db = client["crypto_db"]
        cursor = db.historical_sma.find(
            {"symbol": COIN},
            sort=[("date", -1)],
            limit=n,
            projection={"_id": 0, "avg_close": 1},
        )
        docs = list(cursor)
        client.close()
        if len(docs) < n:
            logger.warning(
                "Only %d docs found in historical_sma (need %d); using CSV fallback.",
                len(docs), n,
            )
            return None
        # Reverse so chronological order (oldest first)
        prices = np.array([d["avg_close"] for d in reversed(docs)], dtype=np.float32)
        logger.info("Loaded %d close prices from MongoDB historical_sma.", n)
        return prices
    except Exception as exc:
        logger.warning("MongoDB unavailable (%s); using CSV fallback.", exc)
        return None


def _load_last_n_from_csv(n: int = SEQ_LEN) -> np.ndarray:
    """Return the last *n* close prices from the BTC sample CSV."""
    import pandas as pd
    df = pd.read_csv(_CSV_FALLBACK)
    col = "price" if "price" in df.columns else "close"
    prices = df[col].dropna().values[-n:]
    logger.info("Loaded %d close prices from CSV fallback.", len(prices))
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
    mongo_uri: str | None = None,
) -> list[dict]:
    """
    Write 7-day forecast to  predictions  collection (upsert on coin + prediction_date).

    Returns the list of documents written.
    """
    uri = mongo_uri or os.environ.get("MONGO_URI", _DEFAULT_URI)
    import pymongo

    client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=5000)
    db = client["crypto_db"]
    collection = db["predictions"]

    now_utc = datetime.now(timezone.utc)
    docs_written: list[dict] = []

    for offset, price in enumerate(predictions_usd, start=1):
        prediction_date = now_utc.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=offset)
        doc = {
            "coin": COIN,
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
            COIN, prediction_date.date(), price,
        )

    client.close()
    return docs_written


# ── Main entry-point ───────────────────────────────────────────────────────────

def run_inference(mongo_uri: str | None = None) -> list[dict]:
    """
    Full inference pipeline: load model → build seed → forecast → write to MongoDB.

    Returns list of prediction documents.
    """
    # ── 1. Load model ──────────────────────────────────────────────────────────
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Trained model not found at {MODEL_PATH}. "
            "Run  python src/ml/train_lstm.py  first."
        )
    if not SCALER_PATH.exists():
        raise FileNotFoundError(
            f"Scaler not found at {SCALER_PATH}. "
            "Run  python src/ml/train_lstm.py  first."
        )

    model = LSTMModel(input_size=1, hidden_size=128, num_layers=2, dropout=0.2, output_size=1)
    model.load_state_dict(torch.load(MODEL_PATH, map_location="cpu"))
    model.eval()
    logger.info("Loaded model from %s", MODEL_PATH)

    with open(SCALER_PATH, "rb") as f:
        import pickle
        scaler = pickle.load(f)
    logger.info("Loaded scaler from %s", SCALER_PATH)

    # ── 2. Seed data ───────────────────────────────────────────────────────────
    seed = _load_last_n_from_mongo(n=SEQ_LEN, mongo_uri=mongo_uri)
    if seed is None:
        seed = _load_last_n_from_csv(n=SEQ_LEN)

    # ── 3. Forecast ────────────────────────────────────────────────────────────
    predictions_usd = _iterative_predict(model, seed, scaler, horizon=HORIZON)
    logger.info("7-day forecast (USD): %s", [f"${p:.2f}" for p in predictions_usd])

    # ── 4. Write to MongoDB ────────────────────────────────────────────────────
    docs = _write_predictions(predictions_usd, mongo_uri=mongo_uri)
    return docs


if __name__ == "__main__":
    docs = run_inference()
    print(f"\nWrote {len(docs)} predictions to MongoDB predictions collection.")
    for d in docs:
        print(f"  {d['prediction_date'].date()}  ${d['predicted_price']:,.2f}")
