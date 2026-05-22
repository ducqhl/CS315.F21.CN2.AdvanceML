"""
preprocess.py — Data preprocessing pipeline for the BTC / DOGE LSTM model.

Loads data/sample/{coin}.csv, normalises the close-price column with
MinMaxScaler, creates overlapping 60-step input sequences, and splits
the data chronologically (80 / 10 / 10) into train / val / test sets.

Public API
----------
load_and_preprocess(csv_path, seq_len, train_ratio, val_ratio)
    -> X_train, y_train, X_val, y_val, X_test, y_test (numpy arrays)
    -> scaler (MinMaxScaler, already fitted)

The fitted scaler is also saved to  src/ml/model/scaler_{coin}.pkl  so that
inference.py can inverse-transform predictions without re-fitting.

Set LSTM_COIN env var to "bitcoin" (default) or "dogecoin" to control which
dataset is loaded when running standalone.
"""

from __future__ import annotations

import os
import pickle
import logging
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler

logger = logging.getLogger(__name__)

# ── Paths ──────────────────────────────────────────────────────────────────────
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_MODEL_DIR = Path(__file__).resolve().parent / "model"

# Coin to preprocess — default bitcoin, override with LSTM_COIN env var
COIN = os.getenv("LSTM_COIN", "bitcoin")

_DEFAULT_CSV = _PROJECT_ROOT / "data" / "sample" / f"{COIN}.csv"
_SCALER_PATH = _MODEL_DIR / f"scaler_{COIN}.pkl"

# ── Constants ──────────────────────────────────────────────────────────────────
SEQ_LEN = 60         # Number of past days used as input
TRAIN_RATIO = 0.80
VAL_RATIO = 0.10
# TEST_RATIO is implicit: 1 - TRAIN_RATIO - VAL_RATIO = 0.10


def _load_csv(csv_path: str | Path) -> pd.DataFrame:
    """Load the bitcoin CSV and return a clean DataFrame with a 'close' column."""
    df = pd.read_csv(csv_path)

    # The sample CSV uses the column name 'price' for close price.
    # Accept either 'price' (sample CSV) or 'close' / 'Close' (generic).
    col_map: dict[str, str] = {}
    lower_cols = {c.lower(): c for c in df.columns}
    if "price" in lower_cols and "close" not in lower_cols:
        col_map[lower_cols["price"]] = "close"
    elif "close" in lower_cols:
        col_map[lower_cols["close"]] = "close"
    else:
        raise ValueError(f"No close/price column found in {csv_path}. Columns: {list(df.columns)}")

    df = df.rename(columns=col_map)

    # Parse date column if present, sort chronologically.
    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"])
        df = df.sort_values("date").reset_index(drop=True)

    # Keep only the close column for the univariate model.
    df = df[["close"]].dropna().reset_index(drop=True)
    logger.info("Loaded %d rows from %s", len(df), csv_path)
    return df


def _create_sequences(
    scaled: np.ndarray,
    seq_len: int,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Build overlapping input/target sequences.

    Parameters
    ----------
    scaled : ndarray of shape (N, 1)
        Normalised close prices.
    seq_len : int
        Number of past steps used as input (window size).

    Returns
    -------
    X : ndarray, shape (M, seq_len, 1)   — input sequences
    y : ndarray, shape (M,)              — next-step target
    """
    X, y = [], []
    for i in range(seq_len, len(scaled)):
        X.append(scaled[i - seq_len : i])   # (seq_len, 1)
        y.append(scaled[i, 0])              # scalar
    return np.array(X, dtype=np.float32), np.array(y, dtype=np.float32)


def load_and_preprocess(
    csv_path: str | Path = _DEFAULT_CSV,
    seq_len: int = SEQ_LEN,
    train_ratio: float = TRAIN_RATIO,
    val_ratio: float = VAL_RATIO,
    save_scaler: bool = True,
    scaler_path: Path | None = None,
) -> tuple[
    np.ndarray, np.ndarray,
    np.ndarray, np.ndarray,
    np.ndarray, np.ndarray,
    MinMaxScaler,
]:
    """
    Full preprocessing pipeline.

    Parameters
    ----------
    csv_path    : path to coin CSV (bitcoin.csv or dogecoin.csv)
    seq_len     : look-back window (default 60)
    train_ratio : fraction for training (default 0.80)
    val_ratio   : fraction for validation (default 0.10)
    save_scaler : whether to persist scaler to disk
    scaler_path : override scaler save path (defaults to _SCALER_PATH)

    Returns
    -------
    X_train, y_train, X_val, y_val, X_test, y_test, scaler
    """
    df = _load_csv(csv_path)

    # ── Fit scaler on ENTIRE series so inverse_transform is consistent ──────
    scaler = MinMaxScaler(feature_range=(0, 1))
    scaled = scaler.fit_transform(df[["close"]].values)  # (N, 1)

    # ── Create sequences ─────────────────────────────────────────────────────
    X, y = _create_sequences(scaled, seq_len)
    n = len(X)

    # ── Chronological split — NO shuffle ─────────────────────────────────────
    train_end = int(n * train_ratio)
    val_end = train_end + int(n * val_ratio)

    X_train, y_train = X[:train_end],          y[:train_end]
    X_val,   y_val   = X[train_end:val_end],   y[train_end:val_end]
    X_test,  y_test  = X[val_end:],            y[val_end:]

    logger.info(
        "Split sizes — train: %d, val: %d, test: %d",
        len(X_train), len(X_val), len(X_test),
    )

    # ── Persist scaler ───────────────────────────────────────────────────────
    if save_scaler:
        save_path = Path(scaler_path) if scaler_path else _SCALER_PATH
        save_path.parent.mkdir(parents=True, exist_ok=True)
        with open(save_path, "wb") as f:
            pickle.dump(scaler, f)
        logger.info("Scaler saved to %s", save_path)

    return X_train, y_train, X_val, y_val, X_test, y_test, scaler


def load_scaler() -> MinMaxScaler:
    """Load the persisted MinMaxScaler from disk."""
    with open(_SCALER_PATH, "rb") as f:
        return pickle.load(f)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    X_tr, y_tr, X_v, y_v, X_te, y_te, sc = load_and_preprocess()
    print(f"X_train shape: {X_tr.shape}")
    print(f"X_val   shape: {X_v.shape}")
    print(f"X_test  shape: {X_te.shape}")
    print(f"Scaler min: {sc.data_min_[0]:.4f}, max: {sc.data_max_[0]:.4f}")
