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
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import torch

from model import LSTMModel
from preprocess import _build_features, HORIZON_SEQ_LEN_MAP

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)

# ── Paths ──────────────────────────────────────────────────────────────────────
_HERE = Path(__file__).resolve().parent
_MODEL_DIR = _HERE / "model"
_DATA_DIR = _HERE / "data" / "sample"
if not _DATA_DIR.exists():
    _DATA_DIR = _HERE.parent.parent / "data" / "sample"

# ── Constants ──────────────────────────────────────────────────────────────────
SEQ_LEN = 60
HORIZON = 7
MODEL_VERSION = "lstm_v2"
CONFIDENCE = 0.8

_DEFAULT_URI = "mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin"
_DEFAULT_DB = "crypto_db"

# Direction class mapping (binary: 0=DOWN, 1=UP)
_DIR_CLASSES = {0: "DOWN", 1: "UP"}

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
    """Return path for v1 model; kept for backward compat with old tests."""
    return _MODEL_DIR / f"lstm_{coin}_v1.pt"


def _scaler_path(coin: str) -> Path:
    return _MODEL_DIR / f"scaler_{coin}.pkl"


def _model_path_v3(coin: str) -> Path:
    return _MODEL_DIR / f"lstm_{coin}_v3.pt"


def _scaler_path_v3(coin: str) -> Path:
    return _MODEL_DIR / f"scaler_{coin}_v3.pkl"


def _model_path_v2(coin: str) -> Path:
    return _MODEL_DIR / f"lstm_{coin}_v2.pt"


def _model_path_v1(coin: str) -> Path:
    return _MODEL_DIR / f"lstm_{coin}_v1.pt"


# ── Model discovery & version resolution ────────────────────────────────────────
#
# A "model" is identified by its file stem (model_id), e.g.
#   horizon-typed:  lstm_bitcoin_h7_v3   (horizon=7,  version=3)
#   legacy:         lstm_bitcoin_v2      (horizon=7,  version=2, pre-horizon naming)
#
# Each of the 3 main horizons (7/15/60) may carry several versions on disk; the
# newest is the default used by the scheduler, older versions stay selectable for
# on-demand "predict now" runs. Predictions are tagged with model_id so forecasts
# from different versions can coexist and be filtered independently.

def discover_models(coin: str) -> list[dict]:
    """
    Scan the model dir for every trained artifact belonging to *coin*.

    Returns a list of dicts (one per model file with a matching scaler), each:
        {
          "model_id":   "lstm_bitcoin_h7_v3",
          "horizon":    7,
          "version":    3,
          "is_legacy":  False,
          "is_newest":  True,            # newest version for its horizon
          "model_file": "lstm_bitcoin_h7_v3.pt",
          "scaler_file":"scaler_bitcoin_h7_v3.pkl",
        }
    Sorted by (horizon, -version). Legacy (pre-horizon) files map to horizon 7.
    """
    found: list[dict] = []

    # Horizon-typed: lstm_{coin}_h{H}_v{V}.pt
    for p in _MODEL_DIR.glob(f"lstm_{coin}_h*_v*.pt"):
        m = re.match(rf"lstm_{re.escape(coin)}_h(\d+)_v(\d+)\.pt$", p.name)
        if not m:
            continue
        horizon, version = int(m.group(1)), int(m.group(2))
        scaler = _MODEL_DIR / f"scaler_{coin}_h{horizon}_v{version}.pkl"
        if scaler.exists():
            found.append({
                "model_id":    p.stem,
                "horizon":     horizon,
                "version":     version,
                "is_legacy":   False,
                "model_file":  p.name,
                "scaler_file": scaler.name,
            })

    # Legacy (pre-horizon): lstm_{coin}_v{V}.pt → horizon 7
    # v1 predates the current 9-feature pipeline (5-feature input, scaler gone) and
    # is unloadable — skip it so it never appears as a selectable/predictable model.
    for p in _MODEL_DIR.glob(f"lstm_{coin}_v*.pt"):
        m = re.match(rf"lstm_{re.escape(coin)}_v(\d+)\.pt$", p.name)
        if not m:
            continue
        version = int(m.group(1))
        if version < 2:
            continue
        scaler = _MODEL_DIR / f"scaler_{coin}_v{version}.pkl"
        if not scaler.exists():
            scaler = _MODEL_DIR / f"scaler_{coin}.pkl"
        if scaler.exists():
            found.append({
                "model_id":    p.stem,
                "horizon":     7,
                "version":     version,
                "is_legacy":   True,
                "model_file":  p.name,
                "scaler_file": scaler.name,
            })

    # Mark newest per horizon: horizon-typed beats legacy, then higher version wins
    by_horizon: dict[int, dict] = {}
    for d in found:
        rank = (0 if d["is_legacy"] else 1, d["version"])
        cur = by_horizon.get(d["horizon"])
        if cur is None or rank > (0 if cur["is_legacy"] else 1, cur["version"]):
            by_horizon[d["horizon"]] = d
    newest_ids = {d["model_id"] for d in by_horizon.values()}
    for d in found:
        d["is_newest"] = d["model_id"] in newest_ids

    found.sort(key=lambda d: (d["horizon"], -d["version"], d["is_legacy"]))
    return found


def _resolve_model(
    coin: str,
    horizon: int,
    model_id: str | None = None,
) -> dict:
    """
    Resolve which model to load.

    If *model_id* is given, load exactly that artifact. Otherwise pick the newest
    version for *horizon*. Returns the discovery dict augmented with absolute
    ``model_path`` / ``scaler_path`` and a ``version_label`` ("v3").

    Raises FileNotFoundError when nothing matches.
    """
    catalog = discover_models(coin)
    if not catalog:
        raise FileNotFoundError(
            f"No trained model found for {coin}. "
            f"Run  python src/ml/train_lstm.py --coin {coin}  first."
        )

    if model_id:
        match = next((d for d in catalog if d["model_id"] == model_id), None)
        if match is None:
            raise FileNotFoundError(
                f"Model '{model_id}' not found for {coin}. "
                f"Available: {[d['model_id'] for d in catalog]}"
            )
        chosen = match
    else:
        horizon_models = [d for d in catalog if d["horizon"] == horizon]
        if not horizon_models:
            raise FileNotFoundError(
                f"No trained model for {coin} horizon={horizon}. "
                f"Run  python src/ml/train_lstm.py --coin {coin} --horizon {horizon}  first."
            )
        chosen = next(d for d in horizon_models if d["is_newest"]) \
            if any(d["is_newest"] for d in horizon_models) \
            else max(horizon_models, key=lambda d: d["version"])

    chosen = {**chosen}
    chosen["model_path"]    = _MODEL_DIR / chosen["model_file"]
    chosen["scaler_path"]   = _MODEL_DIR / chosen["scaler_file"]
    chosen["version_label"] = f"v{chosen['version']}"
    return chosen


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

def _derive_strength_from_margin(margin: float) -> str:
    """Map the softmax probability margin (top1 − top2) to trend strength.

    A large margin means the model is confident in its direction call.

    Parameters
    ----------
    margin : float in [0, 1] — difference between the highest and second-highest
             class probability from the direction head softmax output.

    Returns
    -------
    "STRONG" | "MODERATE" | "WEAK"
    """
    if margin > 0.4:
        return "STRONG"
    elif margin > 0.2:
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

        # Trend strength from probability margin (top1 − top2 probability)
        sorted_probs = np.sort(dir_probs_arr, axis=1)   # (horizon, 3) ascending
        margins = sorted_probs[:, -1] - sorted_probs[:, -2]  # top1 - top2
        strengths = [_derive_strength_from_margin(float(m)) for m in margins]
    else:
        # v1 fallback: no direction head
        log_rets_norm = result.squeeze(0).cpu().numpy()
        directions = ["FLAT"] * horizon
        dir_probs  = [0.5] * horizon   # random-chance confidence for binary
        strengths  = ["WEAK"] * horizon

    # Un-standardise
    log_rets   = log_rets_norm * scaler.scale_[0] + scaler.mean_[0]
    prices_usd = last_price_usd * np.exp(np.cumsum(log_rets))

    return prices_usd.astype(np.float32), directions, dir_probs, strengths


@torch.no_grad()
def _mimo_predict_v3(
    model: LSTMModel,
    seed_features: np.ndarray,
    scaler,
    last_price_usd: float,
    horizon: int = HORIZON,
) -> tuple[np.ndarray, np.ndarray]:
    """
    MIMO forward pass for v3 model (price + volatility head).

    Returns
    -------
    prices_usd    : (horizon,) float32 array of USD prices
    vol_preds     : (horizon,) float32 array of predicted forward realized vol (scaled)
    """
    model.eval()
    x = torch.tensor(seed_features[np.newaxis, :, :], dtype=torch.float32)
    result = model(x)

    if isinstance(result, tuple) and len(result) == 2:
        price_tensor, vol_tensor = result
    else:
        # Unexpected shape — fallback to price only
        price_tensor = result[0] if isinstance(result, tuple) else result
        vol_tensor   = torch.zeros(1, horizon)

    log_rets_norm = price_tensor.squeeze(0).cpu().numpy()   # (horizon,)
    vol_raw       = vol_tensor.squeeze(0).cpu().numpy()     # (horizon,)

    log_rets   = log_rets_norm * scaler.scale_[0] + scaler.mean_[0]
    prices_usd = last_price_usd * np.exp(np.cumsum(log_rets))

    return prices_usd.astype(np.float32), vol_raw.astype(np.float32)


# ── MongoDB write ──────────────────────────────────────────────────────────────

def _write_predictions(
    predictions_usd: np.ndarray,
    coin_symbol: str,
    mongo_uri: str | None = None,
    seed_source: str = "unknown",
    directions: list[str] | None = None,
    dir_probs: list[float] | None = None,
    strengths: list[str] | None = None,
    vol_predictions: np.ndarray | None = None,
    model_version_str: str = MODEL_VERSION,
    horizon: int = HORIZON,
    model_id: str = "",
    version: int | None = None,
) -> list[dict]:
    """
    Write 7-day forecast to  predictions  collection (upsert on coin + prediction_date).

    Parameters
    ----------
    directions        : per-step direction labels ("UP"|"FLAT"|"DOWN"), length=HORIZON
    dir_probs         : per-step confidence for predicted direction, length=HORIZON
    strengths         : per-step trend strength ("STRONG"|"MODERATE"|"WEAK"), length=HORIZON
    vol_predictions   : (optional) per-step predicted forward realized vol from vol head
    model_version_str : model version tag for the document (default MODEL_VERSION)

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
        # confidence comes from the direction head's softmax probability;
        # fall back to CONFIDENCE constant only when no direction head (v1 model).
        idx = offset - 1
        confidence = (
            dir_probs[idx]
            if dir_probs is not None and idx < len(dir_probs)
            else CONFIDENCE
        )
        doc = {
            "coin":            coin_symbol,
            "predicted_price": float(price),
            "prediction_date": prediction_date,
            "confidence":      confidence,
            "model_version":   model_version_str,
            "model_id":        model_id,
            "version":         version,
            "seed_source":     seed_source,
            "created_at":      now_utc,
            "horizon":         horizon,
        }
        # Add optional direction fields
        if directions is not None and idx < len(directions):
            doc["direction"] = directions[idx]
        if dir_probs is not None and idx < len(dir_probs):
            doc["direction_prob"] = dir_probs[idx]
        if strengths is not None and idx < len(strengths):
            doc["trend_strength"] = strengths[idx]
        # Add v3 volatility field (optional — backward compat)
        if vol_predictions is not None and idx < len(vol_predictions):
            doc["predicted_volatility"] = float(vol_predictions[idx])

        collection.update_one(
            {
                "coin": doc["coin"],
                "prediction_date": doc["prediction_date"],
                "horizon": doc["horizon"],
                "model_id": doc["model_id"],
            },
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
                "coin":            run_doc["coin"],
                "horizon":         run_doc["horizon"],
                "model_id":        run_doc["model_id"],
                "run_date":        run_date_day,
                "prediction_date": run_doc["prediction_date"],
            },
            {"$set": run_doc},
            upsert=True,
        )

    client.close()
    return docs_written


# ── Main entry-point ───────────────────────────────────────────────────────────

def run_inference(
    coin: str = "bitcoin",
    mongo_uri: str | None = None,
    horizon: int = HORIZON,
    model_id: str | None = None,
) -> list[dict]:
    """
    Full inference pipeline: load model → build seed → forecast → write to MongoDB.

    Parameters
    ----------
    coin      : CoinGecko coin id — "bitcoin" or "dogecoin"
    mongo_uri : optional MongoDB URI override
    horizon   : forecast horizon (7/15/60). Used to pick the newest model for that
                horizon when *model_id* is not given.
    model_id  : optional explicit model file stem (e.g. "lstm_bitcoin_h7_v3").
                When given, that exact version is loaded and its predictions are
                tagged with it — used for on-demand "predict now" with old models.

    Returns list of prediction documents.
    """
    coin_symbol = _COIN_SYMBOL_MAP.get(coin, coin.upper())

    # ── 1. Resolve & load model (explicit model_id, else newest for horizon) ──
    resolved       = _resolve_model(coin, horizon, model_id=model_id)
    model_path     = resolved["model_path"]
    scaler_path    = resolved["scaler_path"]
    loaded_version = resolved["version_label"]   # "v1" | "v2" | "v3"
    resolved_id    = resolved["model_id"]
    version_num    = resolved["version"]
    # Honour the resolved model's own horizon (legacy artifacts pin to 7)
    horizon        = resolved["horizon"]

    if not scaler_path.exists():
        raise FileNotFoundError(
            f"Scaler not found at {scaler_path}. "
            f"Run  python src/ml/train_lstm.py --coin {coin}  first."
        )

    with open(scaler_path, "rb") as f:
        scaler = pickle.load(f)
    logger.info("Loaded scaler from %s", scaler_path)

    n_features = len(scaler.mean_) if hasattr(scaler, "mean_") else 9

    model = LSTMModel(
        input_size=n_features,
        hidden_size=128,
        num_layers=2,
        dropout=0.2,
        output_size=horizon,
        use_direction_head=False,
        use_volatility_head=(loaded_version == "v3"),
    )
    model.load_state_dict(
        torch.load(model_path, map_location="cpu", weights_only=True)
    )
    model.eval()
    logger.info("Loaded model from %s (%s)", model_path, loaded_version)

    # ── 2. Seed data — fetch horizon-appropriate SEQ_LEN + 31 rows for warmup ──
    _seq_len = HORIZON_SEQ_LEN_MAP.get(horizon, SEQ_LEN)
    n_fetch = _seq_len + 31

    raw_close = _load_last_n_from_live_prices(coin_symbol, n=n_fetch, mongo_uri=mongo_uri)
    seed_source = "live_prices"

    if raw_close is None:
        raw_close = _load_last_n_from_mongo(coin_symbol, n=n_fetch, mongo_uri=mongo_uri)
        seed_source = "historical_sma"

    if raw_close is None:
        logger.warning(
            "MongoDB unavailable for %s — falling back to CSV seed data which may be stale. "
            "Predictions may not reflect current market conditions.",
            coin_symbol,
        )
        raw_close = _load_last_n_from_csv(coin, n=n_fetch)
        seed_source = "csv"

    logger.info("Seed source for %s: %s", coin_symbol, seed_source)

    # ── 3. Build features from raw close prices ────────────────────────────────
    df_seed = pd.DataFrame({"close": raw_close.astype(np.float64)})
    features = _build_features(df_seed)   # (n_fetch, n_features)

    valid = ~np.isnan(features).any(axis=1)
    features = features[valid]
    close_for_seed = raw_close[valid]

    if len(features) < _seq_len:
        raise ValueError(
            f"Not enough clean rows after warmup drop: {len(features)} < SEQ_LEN={_seq_len} "
            f"(horizon={horizon}). "
            "Fetch more history."
        )

    # ── 4. Scale seed and take last SEQ_LEN rows ──────────────────────────────
    # Pad/trim feature columns to match what scaler was trained on
    n_scaler_feats = len(scaler.mean_)
    if features.shape[1] > n_scaler_feats:
        features = features[:, :n_scaler_feats]
    elif features.shape[1] < n_scaler_feats:
        raise ValueError(
            f"Feature count mismatch at inference: _build_features returned "
            f"{features.shape[1]} columns but scaler was trained on {n_scaler_feats}. "
            f"Retrain the model after any feature engineering changes "
            f"(python src/ml/train_lstm.py --coin {coin})."
        )

    seed_scaled = scaler.transform(features)
    seed = seed_scaled[-_seq_len:]         # (_seq_len, n_features)
    last_price_usd = float(close_for_seed[-1])

    # ── 5. MIMO forecast ───────────────────────────────────────────────────────
    vol_predictions: np.ndarray | None = None
    if loaded_version == "v3":
        predictions_usd, vol_predictions = _mimo_predict_v3(
            model, seed, scaler, last_price_usd, horizon=horizon
        )
    else:
        predictions_usd = _mimo_predict(model, seed, scaler, last_price_usd, horizon=horizon)

    # Derive direction and strength from the price forecast curve
    directions: list[str] = []
    dir_probs: list[float] = []
    strengths: list[str] = []
    sigma_daily = float(scaler.scale_[0])
    for price in predictions_usd:
        cum_log_ret = float(np.log(price / last_price_usd)) if last_price_usd > 0 else 0.0
        directions.append("UP" if cum_log_ret > 0 else "DOWN")
        confidence = float(1 / (1 + np.exp(-abs(cum_log_ret) / max(sigma_daily, 1e-8))))
        dir_probs.append(confidence)
        abs_ret = abs(cum_log_ret)
        if abs_ret > 2 * sigma_daily:
            strengths.append("STRONG")
        elif abs_ret > sigma_daily:
            strengths.append("MODERATE")
        else:
            strengths.append("WEAK")

    dir_summary = {d: directions.count(d) for d in ["UP", "DOWN"]}
    avg_conf = sum(dir_probs) / len(dir_probs)
    dominant = max(dir_summary, key=dir_summary.get)
    logger.info(
        "%d-day forecast for %s (USD): %s",
        horizon,
        coin_symbol,
        [f"${p:.4f}" for p in predictions_usd],
    )
    logger.info(
        "%d-day trend summary: %s  (UP=%d DOWN=%d)  avg_confidence=%.3f",
        horizon,
        dominant, dir_summary["UP"], dir_summary["DOWN"], avg_conf,
    )

    # ── 6. Write to MongoDB ────────────────────────────────────────────────────
    mv_str = f"lstm_{loaded_version}"
    docs = _write_predictions(
        predictions_usd,
        coin_symbol=coin_symbol,
        mongo_uri=mongo_uri,
        seed_source=seed_source,
        directions=directions,
        dir_probs=dir_probs,
        strengths=strengths,
        vol_predictions=vol_predictions,
        model_version_str=mv_str,
        horizon=horizon,
        model_id=resolved_id,
        version=version_num,
    )
    return docs


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run LSTM inference for BTC or DOGE")
    parser.add_argument(
        "--coin", type=str, default="bitcoin",
        choices=["bitcoin", "dogecoin"],
        help="CoinGecko coin id (default: bitcoin)",
    )
    parser.add_argument(
        "--horizon", type=int, default=HORIZON, choices=[7, 15, 60],
        help="Forecast horizon; picks newest model for that horizon (default: 7)",
    )
    parser.add_argument(
        "--model-id", type=str, default=None,
        help="Explicit model file stem to load (e.g. lstm_bitcoin_h7_v3). "
             "Overrides --horizon's newest-model selection.",
    )
    args = parser.parse_args()

    docs = run_inference(coin=args.coin, horizon=args.horizon, model_id=args.model_id)
    print(f"\nWrote {len(docs)} predictions for {args.coin} to MongoDB predictions collection.")
    for d in docs:
        direction = d.get("direction", "—")
        strength  = d.get("trend_strength", "—")
        print(f"  {d['prediction_date'].date()}  ${d['predicted_price']:,.4f}  "
              f"{direction}  {strength}")
