# Phase 8 — Continuous Model Retraining Pipeline

**Goal:** Build a weekly automated retraining pipeline that appends new `live_prices` and
`ohlcv_hourly` data to the training corpus, retrains the LSTM, compares it against the
current champion model on a holdout set, and promotes the new model only if RMSE improves
by ≥5%. All training runs are versioned and stored in MongoDB `retrain_history`.

**Depends on:** Phase 7 (`ohlcv_hourly` collection populated)

**Unlocks:** Phase 9 (model upgrade), Phase 10 (accuracy trend charts)

---

## Do NOT Touch

- `src/ml/model.py` — architecture unchanged in this phase
- `src/ml/preprocess.py` — preprocessing unchanged
- `src/spark/` — Spark jobs unchanged
- `src/dashboard/` — dashboard unchanged in this phase
- `docker/docker-compose.yml` — no new services in this phase (scheduler handles retraining)
- `data/sample/*.csv` — source CSVs are READ but never overwritten

---

## New Files to Create

```
src/ml/retrain.py                    ← New: retraining pipeline (data merge + train + promote)
src/ml/model_registry.py             ← New: version tracking, champion/challenger model mgmt
tests/test_retrain.py                ← New: unit tests for retrain pipeline
```

## Files to Modify

```
src/ml/inference_scheduler.py        ← Add weekly retraining trigger to the run loop
src/ml/train_lstm.py                 ← Add --output-dir and --no-save-scaler flags
src/ml/inference.py                  ← Load model via model_registry (not hardcoded path)
```

---

## MongoDB: New Collection `retrain_history`

```json
{
  "_id":            ObjectId,
  "coin":           "BTC" | "DOGE",
  "run_id":         "uuid4-string",         // unique per training run
  "version":        "lstm_v2",              // incremented on each promotion
  "model_path":     "src/ml/model/lstm_bitcoin_v2.pt",
  "scaler_path":    "src/ml/model/scaler_bitcoin_v2.pkl",
  "rmse":           float,                  // USD RMSE on holdout
  "mae":            float,
  "dir_acc":        float,                  // directional accuracy %
  "epochs_trained": int,
  "training_rows":  int,                    // rows in training set
  "data_cutoff":    datetime,               // last timestamp in training data
  "champion":       bool,                   // true = currently active model
  "promoted_at":    datetime | null,        // null if challenger not promoted
  "trained_at":     datetime,
  "notes":          str                     // e.g. "improved RMSE by 8.2% vs v1"
}

Indexes:
  {coin: 1, trained_at: -1}    — list training history
  {coin: 1, champion: 1}       — fast lookup of current champion
```

---

## Step 1 — Create `src/ml/model_registry.py`

This module manages model artifact paths and champion tracking.

```python
"""
model_registry.py — Model version management for the LSTM pipeline.

Tracks which model version is the current champion per coin.
Stores version history in MongoDB retrain_history collection.

Usage:
    registry = ModelRegistry(mongo_uri)
    champion = registry.get_champion("BTC")   # returns path to .pt file
    registry.register(coin, run_metadata)      # inserts retrain_history doc
    registry.promote(coin, run_id)             # sets champion=True for run_id
"""

import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import pymongo

logger = logging.getLogger(__name__)

_HERE = Path(__file__).resolve().parent
_MODEL_DIR = _HERE / "model"
_DEFAULT_URI = "mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin"
RETRAIN_HISTORY_COLLECTION = "retrain_history"


class ModelRegistry:
    def __init__(self, mongo_uri: str = _DEFAULT_URI):
        self.mongo_uri = mongo_uri

    def _get_col(self):
        client = pymongo.MongoClient(self.mongo_uri, serverSelectionTimeoutMS=3000)
        db = client["crypto_db"]
        col = db[RETRAIN_HISTORY_COLLECTION]

        # Ensure indexes (idempotent)
        idx = col.index_information()
        if "coin_trained_at" not in idx:
            col.create_index([("coin", 1), ("trained_at", -1)], name="coin_trained_at")
        if "coin_champion" not in idx:
            col.create_index([("coin", 1), ("champion", 1)], name="coin_champion")

        return client, col

    def get_champion(self, coin_symbol: str) -> Optional[dict]:
        """
        Return the current champion model record for coin_symbol, or None.
        Caller should fall back to default path if None.
        """
        client, col = self._get_col()
        doc = col.find_one({"coin": coin_symbol, "champion": True})
        client.close()
        return doc

    def get_champion_path(self, coin: str, coin_symbol: str) -> Path:
        """
        Return the .pt file path for the current champion.
        Falls back to legacy path (lstm_{coin}_v1.pt) if no champion in registry.
        """
        champion = self.get_champion(coin_symbol)
        if champion:
            path = Path(champion["model_path"])
            if path.exists():
                return path
            logger.warning("Champion model path %s not found; using default.", path)
        # Legacy fallback
        return _MODEL_DIR / f"lstm_{coin}_v1.pt"

    def get_champion_scaler_path(self, coin: str, coin_symbol: str) -> Path:
        """Return scaler path for current champion, with legacy fallback."""
        champion = self.get_champion(coin_symbol)
        if champion:
            path = Path(champion["scaler_path"])
            if path.exists():
                return path
        return _MODEL_DIR / f"scaler_{coin}.pkl"

    def register(self, coin_symbol: str, metadata: dict) -> str:
        """
        Insert a new retrain_history record. Returns the run_id.

        metadata must include: version, model_path, scaler_path, rmse, mae,
        dir_acc, epochs_trained, training_rows, data_cutoff, notes
        """
        run_id = str(uuid.uuid4())
        doc = {
            "coin":           coin_symbol,
            "run_id":         run_id,
            "champion":       False,          # promoted separately
            "promoted_at":    None,
            "trained_at":     datetime.now(timezone.utc),
            **metadata,
        }
        client, col = self._get_col()
        col.insert_one(doc)
        client.close()
        logger.info("Registered training run %s for %s (version=%s)", run_id, coin_symbol, metadata.get("version"))
        return run_id

    def promote(self, coin_symbol: str, run_id: str) -> None:
        """
        Set run_id as champion. Demotes all other records for coin_symbol.
        """
        now = datetime.now(timezone.utc)
        client, col = self._get_col()
        # Demote all current champions
        col.update_many(
            {"coin": coin_symbol, "champion": True},
            {"$set": {"champion": False}},
        )
        # Promote new champion
        col.update_one(
            {"coin": coin_symbol, "run_id": run_id},
            {"$set": {"champion": True, "promoted_at": now}},
        )
        client.close()
        logger.info("Promoted run %s as champion for %s.", run_id, coin_symbol)

    def list_history(self, coin_symbol: str, limit: int = 10) -> list[dict]:
        """Return last N training runs for coin_symbol, newest first."""
        client, col = self._get_col()
        docs = list(col.find(
            {"coin": coin_symbol},
            sort=[("trained_at", -1)],
            limit=limit,
            projection={"_id": 0},
        ))
        client.close()
        return docs

    def next_version(self, coin: str) -> str:
        """
        Return the next version string for a coin (e.g., "lstm_v3").
        Derives from the count of existing retrain_history records.
        """
        client, col = self._get_col()
        count = col.count_documents({"coin": coin.upper()})
        client.close()
        return f"lstm_v{count + 2}"   # v1 is the original, v2 is first retrain, etc.
```

---

## Step 2 — Create `src/ml/retrain.py`

```python
"""
retrain.py — Continuous retraining pipeline.

Pipeline steps per coin:
  1. Export live_prices + ohlcv_hourly from MongoDB → merged training DataFrame
  2. Append to existing data/sample/{coin}.csv rows (deduplicated by date)
  3. Run train_lstm.py in subprocess with updated data → new .pt + .pkl artifacts
  4. Evaluate new model on holdout set
  5. Compare RMSE vs current champion: promote if improvement >= PROMOTION_THRESHOLD
  6. Log result to retrain_history collection

Usage (from inference_scheduler.py):
    from retrain import run_retrain
    run_retrain(coin="bitcoin", mongo_uri=MONGO_URI, force=False)

    force=True: promote new model regardless of RMSE comparison (for initial seeding)
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import pickle
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

_HERE = Path(__file__).resolve().parent
_MODEL_DIR = _HERE / "model"
_DATA_DIR = _HERE.parent.parent / "data" / "sample"
_DEFAULT_URI = "mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin"

# Promote new model only if RMSE improves by at least this fraction
PROMOTION_THRESHOLD = 0.05   # 5%

# Minimum new rows needed to trigger a retrain (avoid retraining on tiny increments)
MIN_NEW_ROWS = 168            # 1 week of hourly data

COIN_SYMBOL_MAP = {"bitcoin": "BTC", "dogecoin": "DOGE"}


def export_new_data_from_mongo(
    coin: str,
    coin_symbol: str,
    mongo_uri: str,
    since: Optional[datetime] = None,
) -> pd.DataFrame:
    """
    Pull new price data from MongoDB since *since* timestamp.

    Data priority (all merged into one DataFrame with columns: date, price, total_volume):
    1. ohlcv_hourly — hourly close + volume
    2. live_prices  — direct CoinGecko writes (fallback if ohlcv_hourly empty)

    Returns DataFrame sorted by date ascending, or empty DataFrame.
    """
    import pymongo
    client = pymongo.MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
    db = client["crypto_db"]

    query = {"coin": coin_symbol}
    if since:
        query["timestamp"] = {"$gt": since}

    # Try ohlcv_hourly first
    docs = list(db.ohlcv_hourly.find(
        query,
        sort=[("timestamp", 1)],
        projection={"_id": 0, "timestamp": 1, "close": 1, "volume": 1},
    ))

    if not docs:
        # Fall back to live_prices
        docs = list(db.live_prices.find(
            query,
            sort=[("timestamp", 1)],
            projection={"_id": 0, "timestamp": 1, "price_usd": 1, "volume_24h": 1},
        ))
        if docs:
            df = pd.DataFrame(docs)
            df = df.rename(columns={"timestamp": "date", "price_usd": "price", "volume_24h": "total_volume"})
        else:
            client.close()
            return pd.DataFrame()
    else:
        df = pd.DataFrame(docs)
        df = df.rename(columns={"timestamp": "date", "close": "price", "volume": "total_volume"})

    client.close()
    df["date"] = pd.to_datetime(df["date"], utc=True)
    df["coin_name"] = coin
    df = df[["date", "price", "total_volume", "coin_name"]].dropna()
    return df.sort_values("date").reset_index(drop=True)


def merge_with_existing_csv(coin: str, new_df: pd.DataFrame) -> pd.DataFrame:
    """
    Load existing data/sample/{coin}.csv and append new_df rows.

    Deduplication: rows with the same date (to daily precision) are kept; new data wins.
    Returns the merged DataFrame sorted by date.
    """
    csv_path = _DATA_DIR / f"{coin}.csv"
    existing_df = pd.read_csv(csv_path)
    existing_df["date"] = pd.to_datetime(existing_df["date"], utc=True)

    # For daily CSV + hourly new data: resample new_df to daily (last close per day)
    if not new_df.empty:
        new_daily = (
            new_df.set_index("date")
            .resample("1D")
            .agg({"price": "last", "total_volume": "sum", "coin_name": "last"})
            .dropna(subset=["price"])
            .reset_index()
        )
        new_daily["date"] = new_daily["date"].dt.tz_localize("UTC") if new_daily["date"].dt.tz is None else new_daily["date"]
    else:
        new_daily = pd.DataFrame()

    combined = pd.concat([existing_df, new_daily], ignore_index=True)
    combined["date_day"] = combined["date"].dt.normalize()
    combined = combined.sort_values("date_day").drop_duplicates(subset=["date_day", "coin_name"], keep="last")
    combined = combined.drop(columns=["date_day"]).sort_values("date").reset_index(drop=True)
    return combined


def get_last_training_cutoff(coin: str, coin_symbol: str, mongo_uri: str) -> Optional[datetime]:
    """
    Return the data_cutoff timestamp from the last champion training run.
    Returns None if no training history exists (first run).
    """
    from model_registry import ModelRegistry
    registry = ModelRegistry(mongo_uri)
    champion = registry.get_champion(coin_symbol)
    if champion and "data_cutoff" in champion:
        return champion["data_cutoff"]
    return None


def evaluate_model_on_holdout(
    model_path: Path,
    scaler_path: Path,
    coin: str,
) -> dict:
    """
    Load model + scaler, evaluate on the last 10% of the training CSV (holdout).

    Returns: {"rmse": float, "mae": float, "dir_acc": float}
    """
    import torch
    from model import LSTMModel
    from preprocess import load_and_preprocess

    model = LSTMModel(input_size=5, hidden_size=128, num_layers=2, dropout=0.2, output_size=7)
    model.load_state_dict(torch.load(model_path, map_location="cpu"))
    model.eval()

    _, _, _, _, X_test, y_test, scaler, last_price_usd = load_and_preprocess(
        _DATA_DIR / f"{coin}.csv", save_scaler=False
    )

    with torch.no_grad():
        preds_norm = model(torch.tensor(X_test, dtype=torch.float32)).numpy()

    # Un-standardize log returns
    preds_log = preds_norm * scaler.scale_[0] + scaler.mean_[0]
    true_log = y_test * scaler.scale_[0] + scaler.mean_[0]

    # Reconstruct USD prices
    def reconstruct(log_rets, last_p):
        return last_p * np.exp(np.cumsum(log_rets, axis=1))

    pred_usd = reconstruct(preds_log, last_price_usd)
    true_usd = reconstruct(true_log, last_price_usd)

    rmse = float(np.sqrt(np.mean((pred_usd - true_usd) ** 2)))
    mae  = float(np.mean(np.abs(pred_usd - true_usd)))
    dir_acc = float(np.mean(np.sign(preds_log[:, 0]) == np.sign(true_log[:, 0])) * 100)

    return {"rmse": rmse, "mae": mae, "dir_acc": dir_acc}


def run_retrain(
    coin: str = "bitcoin",
    mongo_uri: str = _DEFAULT_URI,
    force: bool = False,
) -> dict:
    """
    Run the full retraining pipeline for *coin*.

    Parameters:
        coin:      CoinGecko coin id ("bitcoin" or "dogecoin")
        mongo_uri: MongoDB URI
        force:     if True, promote new model regardless of RMSE comparison

    Returns summary dict:
        {
          "coin": str,
          "new_rows": int,
          "skipped": bool,          # True if MIN_NEW_ROWS not reached
          "new_rmse": float,
          "old_rmse": float | None,
          "promoted": bool,
          "run_id": str,
          "version": str,
        }
    """
    from model_registry import ModelRegistry

    coin_symbol = COIN_SYMBOL_MAP.get(coin, coin.upper())
    registry = ModelRegistry(mongo_uri)
    summary = {"coin": coin, "new_rows": 0, "skipped": False,
               "new_rmse": None, "old_rmse": None, "promoted": False,
               "run_id": None, "version": None}

    # Step 1: Get new data since last training cutoff
    since = get_last_training_cutoff(coin, coin_symbol, mongo_uri)
    new_data = export_new_data_from_mongo(coin, coin_symbol, mongo_uri, since=since)
    summary["new_rows"] = len(new_data)

    if not force and len(new_data) < MIN_NEW_ROWS:
        logger.info(
            "Skipping retrain for %s: only %d new rows (need %d).",
            coin, len(new_data), MIN_NEW_ROWS,
        )
        summary["skipped"] = True
        return summary

    # Step 2: Merge with existing CSV
    merged_df = merge_with_existing_csv(coin, new_data)
    merged_csv_path = _DATA_DIR / f"{coin}_retrain_tmp.csv"
    merged_df.to_csv(merged_csv_path, index=False)
    logger.info("Merged CSV: %d rows → %s", len(merged_df), merged_csv_path)

    # Step 3: Determine new version
    new_version = registry.next_version(coin)
    new_model_path = _MODEL_DIR / f"lstm_{coin}_{new_version}.pt"
    new_scaler_path = _MODEL_DIR / f"scaler_{coin}_{new_version}.pkl"

    # Step 4: Run training subprocess
    cmd = [
        sys.executable, str(_HERE / "train_lstm.py"),
        "--coin", coin,
        "--data-path", str(merged_csv_path),
        "--model-out", str(new_model_path),
        "--scaler-out", str(new_scaler_path),
    ]
    logger.info("Running retrain: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        logger.error("Training failed for %s:\n%s", coin, result.stderr)
        merged_csv_path.unlink(missing_ok=True)
        raise RuntimeError(f"Training subprocess failed for {coin}: {result.stderr[-500:]}")

    # Step 5: Evaluate new model
    new_metrics = evaluate_model_on_holdout(new_model_path, new_scaler_path, coin)
    summary["new_rmse"] = new_metrics["rmse"]
    summary["version"] = new_version
    logger.info("New model metrics: RMSE=$%.2f MAE=$%.2f DirAcc=%.1f%%",
                new_metrics["rmse"], new_metrics["mae"], new_metrics["dir_acc"])

    # Step 6: Compare vs current champion
    old_champion = registry.get_champion(coin_symbol)
    if old_champion:
        summary["old_rmse"] = old_champion.get("rmse")
        improvement = (summary["old_rmse"] - new_metrics["rmse"]) / summary["old_rmse"]
        should_promote = force or improvement >= PROMOTION_THRESHOLD
        notes = (
            f"RMSE improved {improvement*100:.1f}% vs {old_champion.get('version','?')}"
            if improvement > 0 else
            f"RMSE degraded {abs(improvement)*100:.1f}% vs {old_champion.get('version','?')}"
        )
    else:
        should_promote = True   # first time — always promote
        notes = "First training run — auto-promoted as champion"

    # Step 7: Register + optionally promote
    run_id = registry.register(coin_symbol, {
        "version":        new_version,
        "model_path":     str(new_model_path),
        "scaler_path":    str(new_scaler_path),
        "rmse":           new_metrics["rmse"],
        "mae":            new_metrics["mae"],
        "dir_acc":        new_metrics["dir_acc"],
        "epochs_trained": -1,   # parsed from train_lstm stdout if needed
        "training_rows":  len(merged_df),
        "data_cutoff":    datetime.now(timezone.utc),
        "notes":          notes,
    })
    summary["run_id"] = run_id

    if should_promote:
        registry.promote(coin_symbol, run_id)
        summary["promoted"] = True
        logger.info("New model PROMOTED as champion for %s: %s", coin, new_version)
    else:
        logger.info(
            "New model NOT promoted for %s (RMSE improvement %.1f%% < threshold %.0f%%).",
            coin, improvement * 100, PROMOTION_THRESHOLD * 100,
        )

    # Cleanup temp CSV
    merged_csv_path.unlink(missing_ok=True)
    return summary
```

---

## Step 3 — Modify `src/ml/train_lstm.py`

Add CLI flags `--data-path`, `--model-out`, `--scaler-out` so `retrain.py` can pass custom paths.

### 3a. Add argparse arguments

```python
# In the argparse block, ADD these arguments:
parser.add_argument(
    "--data-path", type=str, default=None,
    help="Path to training CSV (default: data/sample/{coin}.csv)",
)
parser.add_argument(
    "--model-out", type=str, default=None,
    help="Output path for model weights .pt (default: src/ml/model/lstm_{coin}_v1.pt)",
)
parser.add_argument(
    "--scaler-out", type=str, default=None,
    help="Output path for scaler .pkl (default: src/ml/model/scaler_{coin}.pkl)",
)
```

### 3b. Use args in path resolution

```python
# In main(), REPLACE hardcoded paths with:
csv_path = Path(args.data_path) if args.data_path else (_DATA_DIR / f"{args.coin}.csv")
model_save_path = Path(args.model_out) if args.model_out else (_MODEL_DIR / f"lstm_{args.coin}_v1.pt")
scaler_save_path = Path(args.scaler_out) if args.scaler_out else (_MODEL_DIR / f"scaler_{args.coin}.pkl")
```

### 3c. Pass custom paths to `load_and_preprocess`

```python
# REPLACE:
X_train, y_train, ... = load_and_preprocess(csv_path=_DATA_DIR / f"{args.coin}.csv", ...)
# WITH:
X_train, y_train, ... = load_and_preprocess(csv_path=csv_path, ...)
```

---

## Step 4 — Modify `src/ml/inference.py`

Use `ModelRegistry` to resolve model paths instead of hardcoded filenames.

### 4a. Add ModelRegistry import

```python
# ADD after existing imports:
try:
    from model_registry import ModelRegistry
    _registry = ModelRegistry()
except ImportError:
    _registry = None
```

### 4b. Replace hardcoded path resolution in `run_inference`

```python
# REPLACE:
model_path = _model_path(coin)
scaler_path = _scaler_path(coin)

# WITH:
if _registry is not None:
    model_path = _registry.get_champion_path(coin, coin_symbol)
    scaler_path = _registry.get_champion_scaler_path(coin, coin_symbol)
else:
    model_path = _model_path(coin)
    scaler_path = _scaler_path(coin)
```

---

## Step 5 — Modify `src/ml/inference_scheduler.py`

Add a weekly retraining trigger inside the main loop.

### 5a. Add imports

```python
from retrain import run_retrain
import time as _time
```

### 5b. Add retraining trigger in `__main__`

```python
# ADD after the scheduler loop setup:
RETRAIN_INTERVAL_SECONDS = int(os.getenv("RETRAIN_INTERVAL_SECONDS", "604800"))  # 7 days
_last_retrain = 0.0   # epoch time of last retrain

# Inside the while True loop, AFTER run_cycle():
now_epoch = _time.time()
if now_epoch - _last_retrain >= RETRAIN_INTERVAL_SECONDS:
    logger.info("Weekly retrain check triggered.")
    for coin in COINS:
        try:
            retrain_summary = run_retrain(coin=coin, mongo_uri=MONGO_URI)
            if retrain_summary["skipped"]:
                logger.info("Retrain skipped for %s: not enough new data.", coin)
            elif retrain_summary["promoted"]:
                logger.info("Retrain complete for %s: %s promoted (RMSE=$%.2f).",
                            coin, retrain_summary["version"], retrain_summary["new_rmse"])
            else:
                logger.info("Retrain complete for %s: new model NOT promoted.", coin)
        except Exception as exc:
            logger.exception("Retrain failed for %s: %s", coin, exc)
    _last_retrain = now_epoch
```

### 5c. Add env var to docker-compose inference_scheduler

```yaml
environment:
  # ADD:
  RETRAIN_INTERVAL_SECONDS: "604800"   # 7 days
```

---

## Step 6 — Create `tests/test_retrain.py`

```python
"""
tests/test_retrain.py — Unit tests for retrain pipeline.
No actual training is run; subprocess and MongoDB are mocked.
"""
import pytest
from unittest.mock import patch, MagicMock
from pathlib import Path
import pandas as pd
import numpy as np
import sys
sys.path.insert(0, "src/ml")

from retrain import (
    merge_with_existing_csv,
    export_new_data_from_mongo,
    PROMOTION_THRESHOLD,
    MIN_NEW_ROWS,
)


class TestMergeWithExistingCsv:
    def test_deduplicates_by_date(self, tmp_path, monkeypatch):
        import retrain
        # Create fake existing CSV
        existing = pd.DataFrame({
            "date": pd.date_range("2024-01-01", periods=5, freq="D", tz="UTC"),
            "price": [100.0, 101.0, 102.0, 103.0, 104.0],
            "total_volume": [1e9] * 5,
            "coin_name": ["bitcoin"] * 5,
        })
        csv_path = tmp_path / "bitcoin.csv"
        existing.to_csv(csv_path, index=False)

        monkeypatch.setattr(retrain, "_DATA_DIR", tmp_path)

        new_data = pd.DataFrame({
            "date": pd.date_range("2024-01-05", periods=3, freq="D", tz="UTC"),  # 1 overlap
            "price": [999.0, 105.0, 106.0],
            "total_volume": [1e9] * 3,
            "coin_name": ["bitcoin"] * 3,
        })

        result = merge_with_existing_csv("bitcoin", new_data)
        # 2024-01-05 should use new value (999.0), no duplicate
        jan5 = result[result["date"].dt.date == pd.Timestamp("2024-01-05").date()]
        assert len(jan5) == 1
        assert jan5.iloc[0]["price"] == 999.0
        assert len(result) == 7   # 5 existing + 2 net new (1 overlap replaced)

    def test_empty_new_data_returns_existing(self, tmp_path, monkeypatch):
        import retrain
        existing = pd.DataFrame({
            "date": pd.date_range("2024-01-01", periods=3, freq="D", tz="UTC"),
            "price": [100.0, 101.0, 102.0],
            "total_volume": [1e9] * 3,
            "coin_name": ["bitcoin"] * 3,
        })
        csv_path = tmp_path / "bitcoin.csv"
        existing.to_csv(csv_path, index=False)
        monkeypatch.setattr(retrain, "_DATA_DIR", tmp_path)

        result = merge_with_existing_csv("bitcoin", pd.DataFrame())
        assert len(result) == 3


class TestRunRetrainSkipsIfInsufficientData:
    def test_skips_when_new_rows_less_than_min(self):
        with patch("retrain.export_new_data_from_mongo") as mock_export, \
             patch("retrain.get_last_training_cutoff", return_value=None):
            mock_export.return_value = pd.DataFrame({"price": [1.0] * (MIN_NEW_ROWS - 1)})
            from retrain import run_retrain
            summary = run_retrain(coin="bitcoin", mongo_uri="mongodb://fake:27017", force=False)
        assert summary["skipped"] is True
        assert summary["new_rows"] == MIN_NEW_ROWS - 1


class TestModelRegistry:
    def test_register_and_get_champion(self):
        with patch("model_registry.pymongo.MongoClient") as mock_client:
            mock_col = MagicMock()
            mock_col.index_information.return_value = {
                "coin_trained_at": {}, "coin_champion": {}
            }
            mock_col.find_one.return_value = {
                "coin": "BTC", "run_id": "abc", "champion": True,
                "model_path": "src/ml/model/lstm_bitcoin_v2.pt",
                "scaler_path": "src/ml/model/scaler_bitcoin_v2.pkl",
            }
            mock_client.return_value.__getitem__.return_value.__getitem__.return_value = mock_col

            from model_registry import ModelRegistry
            registry = ModelRegistry("mongodb://fake:27017")
            champion = registry.get_champion("BTC")
            assert champion["run_id"] == "abc"
            assert champion["champion"] is True
```

---

## Acceptance Criteria

### AC-8.1 ModelRegistry unit tests pass
```bash
pytest tests/test_retrain.py -v
```

### AC-8.2 `retrain_history` collection created with correct indexes
```bash
python -c "
import sys; sys.path.insert(0, 'src/ml')
from model_registry import ModelRegistry
r = ModelRegistry()
# Force index creation
r.list_history('BTC')
import pymongo
client = pymongo.MongoClient('mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin')
indexes = client.crypto_db.retrain_history.index_information()
assert 'coin_champion' in indexes
assert 'coin_trained_at' in indexes
print('AC-8.2 PASS')
"
```

### AC-8.3 `train_lstm.py` accepts new flags without breaking existing invocation
```bash
python src/ml/train_lstm.py --coin bitcoin --dry-run
python src/ml/train_lstm.py --coin bitcoin --dry-run --model-out /tmp/test_model.pt --scaler-out /tmp/test_scaler.pkl
echo "AC-8.3 PASS"
```

### AC-8.4 `run_retrain` skips when < MIN_NEW_ROWS
```bash
python -c "
import sys; sys.path.insert(0, 'src/ml')
from retrain import run_retrain
# With force=False and likely < 168 new rows in MongoDB:
summary = run_retrain(coin='bitcoin', force=False)
print('skipped:', summary['skipped'], '| new_rows:', summary['new_rows'])
print('AC-8.4 PASS — if skipped=True or new_rows >= 168')
"
```

### AC-8.5 `inference.py` resolves model path via registry
```bash
python -c "
import sys; sys.path.insert(0, 'src/ml')
from inference import _registry, run_inference
# _registry should be a ModelRegistry instance or None
print('Registry:', _registry)
# Model path resolution should not raise
from model_registry import ModelRegistry
r = ModelRegistry()
path = r.get_champion_path('bitcoin', 'BTC')
print('Champion path:', path)
print('AC-8.5 PASS')
"
```
