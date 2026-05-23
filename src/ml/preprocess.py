"""
preprocess.py — Data preprocessing pipeline for the BTC / DOGE LSTM model.

Loads data/sample/{coin}.csv, engineers 5 stationary features from the raw
close price, normalises with StandardScaler (fitted on training rows only),
creates overlapping 60-step input sequences targeting HORIZON=7 forward steps,
and splits the data chronologically (80 / 10 / 10) into train / val / test sets.

Public API
----------
load_and_preprocess(csv_path, seq_len, train_ratio, val_ratio)
    -> X_train, y_train, X_val, y_val, X_test, y_test, scaler, last_price_usd

Features (input_size=5)
-----------------------
0: log_return_1d  = log(close[t] / close[t-1])
1: log_return_7d  = log(close[t] / close[t-7])
2: log_return_30d = log(close[t] / close[t-30])
3: RSI_14
4: log_volume     = log(total_volume + 1)  (zeros if column missing)

Target (output_size=7)
-----------------------
y[:, k] = log_return_1d at t + k+1  (k = 0 ... 6)
Inverse-transform: price_t+k = last_price * exp(cumsum(log_returns[0:k+1]))
"""

from __future__ import annotations

import os
import pickle
import logging
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

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
HORIZON = 7          # Number of future steps predicted in one forward pass
TRAIN_RATIO = 0.80
VAL_RATIO = 0.10
# TEST_RATIO is implicit: 1 - TRAIN_RATIO - VAL_RATIO = 0.10


def _compute_rsi(prices: np.ndarray, period: int = 14) -> np.ndarray:
    """Wilder's smoothed RSI — pure numpy, no pandas_ta dependency.

    Returns array of same length as prices; first `period` values are NaN.
    """
    deltas = np.diff(prices)
    gains  = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)

    avg_gain = np.full(len(prices), np.nan)
    avg_loss = np.full(len(prices), np.nan)

    # Seed with simple mean of first `period` changes
    avg_gain[period] = gains[:period].mean()
    avg_loss[period] = losses[:period].mean()

    for i in range(period + 1, len(prices)):
        avg_gain[i] = (avg_gain[i - 1] * (period - 1) + gains[i - 1]) / period
        avg_loss[i] = (avg_loss[i - 1] * (period - 1) + losses[i - 1]) / period

    rs = np.where(avg_loss == 0, np.inf, avg_gain / avg_loss)
    return 100.0 - (100.0 / (1.0 + rs))


def _build_features(df: pd.DataFrame) -> np.ndarray:
    """Compute 5-column feature matrix from a DataFrame with a 'close' column.

    Parameters
    ----------
    df : DataFrame with at least a 'close' column (and optionally 'total_volume').

    Returns
    -------
    ndarray of shape (N, 5).  First ~30 rows contain NaN (warmup period):
      - rows 0-0:  NaN in log_return_1d
      - rows 0-6:  NaN in log_return_7d
      - rows 0-29: NaN in log_return_30d
      - rows 0-13: NaN in RSI_14
    Caller should drop all rows where any column is NaN.
    """
    close = df["close"].values.astype(np.float64)
    N = len(close)

    # Feature 0: log_return_1d
    log_ret_1d = np.full(N, np.nan)
    log_ret_1d[1:] = np.log(close[1:] / close[:-1])

    # Feature 1: log_return_7d
    log_ret_7d = np.full(N, np.nan)
    log_ret_7d[7:] = np.log(close[7:] / close[:-7])

    # Feature 2: log_return_30d
    log_ret_30d = np.full(N, np.nan)
    log_ret_30d[30:] = np.log(close[30:] / close[:-30])

    # Feature 3: RSI_14
    rsi = _compute_rsi(close, period=14)

    # Feature 4: log_volume (zeros if column missing)
    if "total_volume" in df.columns:
        vol = df["total_volume"].values.astype(np.float64)
        log_vol = np.log(vol + 1.0)
    else:
        log_vol = np.zeros(N, dtype=np.float64)

    features = np.stack([log_ret_1d, log_ret_7d, log_ret_30d, rsi, log_vol], axis=1)
    return features.astype(np.float32)


def _load_csv(csv_path: str | Path) -> pd.DataFrame:
    """Load the coin CSV and return a DataFrame with 'close' (+ 'total_volume' if present)."""
    df = pd.read_csv(csv_path)

    # Accept 'price' (sample CSV) or 'close' / 'Close' (generic).
    col_map: dict[str, str] = {}
    lower_cols = {c.lower(): c for c in df.columns}
    if "price" in lower_cols and "close" not in lower_cols:
        col_map[lower_cols["price"]] = "close"
    elif "close" in lower_cols:
        col_map[lower_cols["close"]] = "close"
    else:
        raise ValueError(f"No close/price column found in {csv_path}. Columns: {list(df.columns)}")

    # Rename total_volume if present
    if "total_volume" in lower_cols:
        col_map[lower_cols["total_volume"]] = "total_volume"

    df = df.rename(columns=col_map)

    # Parse date column if present, sort chronologically.
    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"])
        df = df.sort_values("date").reset_index(drop=True)

    # Keep close + total_volume (if present); drop rows where close is NaN.
    keep_cols = ["close"]
    if "total_volume" in df.columns:
        keep_cols.append("total_volume")
    df = df[keep_cols].dropna(subset=["close"]).reset_index(drop=True)
    logger.info("Loaded %d rows from %s", len(df), csv_path)
    return df


def _create_sequences(
    scaled: np.ndarray,
    seq_len: int,
    horizon: int = HORIZON,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Build overlapping MIMO input/target sequences.

    Parameters
    ----------
    scaled  : ndarray of shape (N, 5) — scaled feature matrix.
    seq_len : int — look-back window size.
    horizon : int — number of forward steps to predict.

    Returns
    -------
    X : ndarray, shape (M, seq_len, 5)  — input sequences
    y : ndarray, shape (M, horizon)     — targets: feature-0 (log_return_1d)
                                          for next 'horizon' steps
    M = N - seq_len - horizon + 1
    """
    X, y = [], []
    n = len(scaled)
    for i in range(seq_len, n - horizon + 1):
        X.append(scaled[i - seq_len : i])        # (seq_len, 5)
        y.append(scaled[i : i + horizon, 0])     # (horizon,) — feature 0
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
    StandardScaler,
    float,
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
    X_train, y_train, X_val, y_val, X_test, y_test, scaler, last_price_usd
    """
    df = _load_csv(csv_path)
    close_prices = df["close"].values.copy()

    # ── Build 5-feature matrix ────────────────────────────────────────────────
    features = _build_features(df)   # (N, 5); first ~30 rows have NaN

    # Drop warmup rows (where any feature is NaN)
    valid_mask = ~np.isnan(features).any(axis=1)
    features = features[valid_mask]
    close_prices = close_prices[valid_mask]
    logger.info("After warmup drop: %d rows remain", len(features))

    # ── Chronological split of RAW feature rows (before scaler fit) ───────────
    n = len(features)
    train_end_raw = int(n * train_ratio)
    val_end_raw   = train_end_raw + int(n * val_ratio)

    feat_train = features[:train_end_raw]
    feat_val   = features[train_end_raw:val_end_raw]
    feat_test  = features[val_end_raw:]

    # ── Fit StandardScaler on TRAINING rows only (fixes data leakage bug) ────
    scaler = StandardScaler()
    scaler.fit(feat_train)
    scaled_train = scaler.transform(feat_train)
    scaled_val   = scaler.transform(feat_val)
    scaled_test  = scaler.transform(feat_test)

    # Store last raw USD close price for inference inverse-transform
    last_price_usd = float(close_prices[-1])
    scaler.last_price_usd_ = last_price_usd

    # ── Create MIMO sequences ─────────────────────────────────────────────────
    X_train, y_train = _create_sequences(scaled_train, seq_len, horizon=HORIZON)
    X_val,   y_val   = _create_sequences(scaled_val,   seq_len, horizon=HORIZON)
    X_test,  y_test  = _create_sequences(scaled_test,  seq_len, horizon=HORIZON)

    logger.info(
        "Split sizes — train: %d, val: %d, test: %d sequences",
        len(X_train), len(X_val), len(X_test),
    )

    # ── Persist scaler ────────────────────────────────────────────────────────
    if save_scaler:
        save_path = Path(scaler_path) if scaler_path else _SCALER_PATH
        save_path.parent.mkdir(parents=True, exist_ok=True)
        with open(save_path, "wb") as f:
            pickle.dump(scaler, f)
        logger.info("Scaler saved to %s", save_path)

    return X_train, y_train, X_val, y_val, X_test, y_test, scaler, last_price_usd


def load_scaler() -> StandardScaler:
    """Load the persisted StandardScaler from disk."""
    with open(_SCALER_PATH, "rb") as f:
        return pickle.load(f)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    X_tr, y_tr, X_v, y_v, X_te, y_te, sc, last_price = load_and_preprocess()
    print(f"X_train shape: {X_tr.shape}")
    print(f"y_train shape: {y_tr.shape}")
    print(f"X_val   shape: {X_v.shape}")
    print(f"X_test  shape: {X_te.shape}")
    print(f"Last price USD: ${last_price:,.2f}")
    print(f"Scaler mean[0]: {sc.mean_[0]:.6f}, scale[0]: {sc.scale_[0]:.6f}")
