"""
intraday_inference.py — 5-minute next-step prediction using the existing LSTM.

Architecture note
-----------------
The daily LSTM was trained on 9 features (log_return_1d/7d/30d, RSI, volume,
MACD, Bollinger %B, ATR, Fear&Greed) normalised with a daily StandardScaler.
To adapt without retraining we feed the same 9 features derived from 5-min closes,
scaled with the same daily scaler so the model sees input in its training distribution.

Inference flow:
  1. Fetch last SEQ_5M + 35 five-min closes from live_prices (extra rows for warmup).
  2. Compute all 9 features via _build_features() — same logic as training.
  3. Drop NaN warmup rows (~30), scale remaining rows with the daily scaler.
  4. Feed last SEQ_5M rows to the LSTM; take price head output step 0.
  5. Un-scale with daily scaler.scale_[0] to recover predicted log-return.
  6. Convert to predicted USD price: last_price * exp(pred_lr).

Note: predictions reflect what the daily model infers from intraday data.
Magnitudes are in daily-return scale; direction signals are the primary output.

Output is written to MongoDB  intraday_predictions  collection, keyed by
(symbol, target_timestamp) — one document per 5-min candle window per coin.
"""

from __future__ import annotations

import logging
import os
import pickle
from datetime import datetime, timezone, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import torch

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────
SEQ_5M   = 60          # number of 5-min closes in the input window
STEP_MIN = 5           # candle interval in minutes
MODEL_DIR = Path(__file__).resolve().parent / "model"
_DEFAULT_URI = "mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin"
_COIN_SYMBOL = {"bitcoin": "BTC", "dogecoin": "DOGE"}


def _model_path(coin: str) -> Path:
    # Use full coin name (bitcoin/dogecoin) to match trained model filenames
    v2 = MODEL_DIR / f"lstm_{coin}_v2.pt"
    v1 = MODEL_DIR / f"lstm_{coin}_v1.pt"
    fallback = MODEL_DIR / f"lstm_{coin}.pt"
    if v2.exists():
        return v2
    if v1.exists():
        return v1
    return fallback


def _scaler_path(coin: str) -> Path:
    return MODEL_DIR / f"scaler_{coin}.pkl"


def _db_name(uri: str) -> str:
    return uri.split("/")[-1].split("?")[0] or "crypto_db"


# ── Load last N 5-min closes from live_prices ─────────────────────────────────

def _load_5min_closes(symbol: str, n: int, uri: str) -> np.ndarray | None:
    import pymongo
    client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=4000)
    db = client[_db_name(uri)]
    docs = list(db.live_prices.find(
        {"symbol": symbol, "price_usd": {"$gt": 0}},
        sort=[("timestamp", -1)],
        limit=n,
        projection={"_id": 0, "price_usd": 1},
    ))
    client.close()
    if not docs:
        return None
    return np.array([d["price_usd"] for d in reversed(docs)], dtype=np.float64)


# ── Main inference function ────────────────────────────────────────────────────

def run_intraday_inference(coin: str = "bitcoin", mongo_uri: str | None = None) -> dict | None:
    """
    Predict the next 5-minute close price for *coin*.

    Returns the prediction document written to MongoDB, or None on failure.
    """
    uri = mongo_uri or os.environ.get("MONGO_URI", _DEFAULT_URI)
    symbol = _COIN_SYMBOL.get(coin, coin.upper())

    # 1. Load closes — need enough for indicator warmup (log_return_30d needs 30 extra rows)
    N_FETCH = SEQ_5M + 35
    closes = _load_5min_closes(symbol, N_FETCH, uri)
    if closes is None or len(closes) < SEQ_5M + 2:
        logger.warning("Not enough 5-min data for %s (%s rows). Skipping.", symbol,
                       len(closes) if closes is not None else 0)
        return None

    # 2. Load LSTM model (v2 preferred) and daily scaler
    model_path = _model_path(coin)
    scaler_path = _scaler_path(coin)
    if not model_path.exists():
        logger.warning("No trained model found at %s", model_path)
        return None

    with open(scaler_path, "rb") as f:
        daily_scaler = pickle.load(f)

    n_features = len(daily_scaler.mean_) if hasattr(daily_scaler, "mean_") else 1

    from inference import LSTMModel
    model = LSTMModel(
        input_size=n_features,
        hidden_size=128,
        num_layers=2,
        dropout=0.2,
        output_size=7,
        use_direction_head=model_path.name.endswith("_v2.pt"),
        n_classes=3,
    )
    model.load_state_dict(torch.load(model_path, map_location="cpu"))
    model.eval()

    # 3. Build all 9 features using the same feature engineering as training.
    #    This prevents the model from receiving mostly-zero inputs, which caused
    #    it to output near-constant predictions (flat line bug).
    from preprocess import _build_features
    df_5m = pd.DataFrame({"close": closes})
    features = _build_features(df_5m)   # (N, 9)

    # Drop warmup rows where any feature is NaN (first ~30 rows)
    valid = ~np.isnan(features).any(axis=1)
    features = features[valid]
    closes_valid = closes[valid]

    if len(features) < SEQ_5M:
        logger.warning("Not enough clean rows after warmup for %s (%d rows). Skipping.",
                       symbol, len(features))
        return None

    last_price = float(closes_valid[-1])

    # 4. Scale with the daily scaler (same scaler used during training) and take
    #    the last SEQ_5M rows as the input window.
    n_scaler_feats = len(daily_scaler.mean_)
    if features.shape[1] > n_scaler_feats:
        features = features[:, :n_scaler_feats]
    elif features.shape[1] < n_scaler_feats:
        pad = np.zeros((len(features), n_scaler_feats - features.shape[1]), dtype=np.float32)
        features = np.concatenate([features, pad], axis=1)

    seed_scaled = daily_scaler.transform(features)
    feat = seed_scaled[-SEQ_5M:].astype(np.float32)   # (SEQ_5M, n_features)

    x = torch.tensor(feat[np.newaxis], dtype=torch.float32)   # (1, SEQ_5M, n_features)

    with torch.no_grad():
        out = model(x)
        price_out = out[0] if isinstance(out, tuple) else out  # (1, 7)
        pred_lr_norm = float(price_out[0, 0].item())           # first step only

    # 5. Un-scale using the daily scaler (feature 0 = log_return_1d).
    #    Using the daily scaler here (not local 5-min stats) is correct because
    #    the model outputs predictions calibrated to the training normalization.
    pred_lr = pred_lr_norm * float(daily_scaler.scale_[0]) + float(daily_scaler.mean_[0])
    predicted_close = last_price * np.exp(pred_lr)

    # Direction and confidence from log-return magnitude relative to training scale
    scale0 = float(daily_scaler.scale_[0])
    if pred_lr > 0.5 * scale0:
        direction = "UP"
        confidence = min(0.95, 0.6 + abs(pred_lr) / scale0 * 0.1)
    elif pred_lr < -0.5 * scale0:
        direction = "DOWN"
        confidence = min(0.95, 0.6 + abs(pred_lr) / scale0 * 0.1)
    else:
        direction = "FLAT"
        confidence = 0.6

    # 7. Compute target timestamp (next 5-min candle)
    now_utc = datetime.now(timezone.utc)
    # Align to next 5-min boundary
    minutes = now_utc.minute
    next_boundary = (minutes // STEP_MIN + 1) * STEP_MIN
    if next_boundary >= 60:
        target_ts = now_utc.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    else:
        target_ts = now_utc.replace(minute=next_boundary, second=0, microsecond=0)

    doc = {
        "symbol":           symbol,
        "run_timestamp":    now_utc,
        "target_timestamp": target_ts,
        "last_close":       last_price,
        "predicted_close":  float(predicted_close),
        "predicted_lr":     float(pred_lr),
        "direction":        direction,
        "confidence":       round(confidence, 4),
        "model_version":    "lstm_v2_5min",
        "seq_len":          SEQ_5M,
    }

    # 8. Write to MongoDB intraday_predictions (upsert by symbol + target_timestamp)
    import pymongo
    client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=4000)
    db = client[_db_name(uri)]
    db.intraday_predictions.update_one(
        {"symbol": symbol, "target_timestamp": target_ts},
        {"$set": doc},
        upsert=True,
    )
    client.close()

    logger.info(
        "5-min prediction %s: target=%s  predicted=$%.4f  dir=%s  conf=%.2f",
        symbol, target_ts.strftime("%H:%M"), predicted_close, direction, confidence,
    )
    return doc
