"""
preprocess.py — Data preprocessing pipeline for the BTC / DOGE LSTM model.

Loads data/sample/{coin}.csv, engineers 9 stationary features from the raw
close price, normalises with StandardScaler (fitted on training rows only),
creates overlapping 60-step input sequences targeting HORIZON=7 forward steps,
and splits the data chronologically (80 / 10 / 10) into train / val / test sets.
Also produces integer direction labels {0=DOWN, 1=UP} per target step.

Public API
----------
load_and_preprocess(csv_path, seq_len, train_ratio, val_ratio, with_fear_greed,
                    window_days, with_vol_target)
    -> 11-tuple (default)  or  14-tuple (when with_vol_target=True)
       X_train, y_train, y_dir_train,
       X_val,   y_val,   y_dir_val,
       X_test,  y_test,  y_dir_test,
       scaler, last_price_usd
       [, y_vol_train, y_vol_val, y_vol_test]   # only when with_vol_target=True

load_for_fold(df_raw, fg_full, train_end_idx, val_end_idx, seq_len, horizon, window_days)
    -> X_tr, y_tr, y_dir_tr, X_vl, y_vl, y_dir_vl, scaler_fold, last_price  (8-tuple)
       Builds one walk-forward fold — no disk writes.

make_direction_labels(log_returns_1d)
    -> int ndarray of shape (N,), values in {0, 1}

Features (N_FEATURES=9)
-----------------------
0: log_return_1d      = log(close[t] / close[t-1])
1: momentum_30d       = close[t] / SMA30[t] - 1          (replaces log_return_7d)
2: realized_vol_14d   = rolling 14-day std of log_return_1d  (replaces log_return_30d)
3: RSI_14
4: log_volume         = log(total_volume + 1)  (zeros if column missing)
5: macd_norm          = (EMA_12 - EMA_26) / close  — normalised MACD
6: bb_pct_b           = (close - lower_band) / (upper_band - lower_band)  20-period BB
7: atr_norm           = |log_return_1d|  (proxy ATR, no high/low)
8: fear_greed         = Fear & Greed index / 100, in [0,1]

Warmup: ~29 rows (SMA30 needs 29 rows, dominant constraint).
Column-0 invariant: features[:, 0] MUST remain log_return_1d — scaler.scale_[0] /
mean_[0] are used for inverse-transform in inference.

Target (output_size=7)
-----------------------
y[:, k] = log_return_1d at t + k+1  (k = 0 ... 6)
Inverse-transform: price_t+k = last_price * exp(cumsum(log_returns[0:k+1]))

Direction labels
----------------
y_dir[:, k] = 0 (DOWN) or 1 (UP)  split at the training-set median
"""

from __future__ import annotations

import logging
import os
import pickle
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
_FEAR_GREED_CACHE = _PROJECT_ROOT / "data" / "sample" / "fear_greed.csv"

# ── Constants ──────────────────────────────────────────────────────────────────
SEQ_LEN = 60          # Number of past days used as input
HORIZON = 7           # Number of future steps predicted in one forward pass
N_FEATURES = 9        # Number of input features
TRAIN_RATIO = 0.80
VAL_RATIO = 0.10
# TEST_RATIO is implicit: 1 - TRAIN_RATIO - VAL_RATIO = 0.10


# ── RSI helper ─────────────────────────────────────────────────────────────────

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

    rs = np.where(avg_loss == 0, np.inf, avg_gain / (avg_loss + 1e-6))
    return 100.0 - (100.0 / (1.0 + rs))


# ── EMA helper ─────────────────────────────────────────────────────────────────

def _compute_ema(prices: np.ndarray, span: int) -> np.ndarray:
    """Exponential moving average — same length as prices; first (span-1) are NaN."""
    alpha = 2.0 / (span + 1)
    ema = np.full(len(prices), np.nan)
    # Seed with first valid value
    ema[span - 1] = prices[:span].mean()
    for i in range(span, len(prices)):
        ema[i] = alpha * prices[i] + (1 - alpha) * ema[i - 1]
    return ema


# ── Fear & Greed loader ────────────────────────────────────────────────────────

def _load_fear_greed(n_days: int) -> np.ndarray:
    """Fetch Fear & Greed index from alternative.me API, cache to CSV.

    Returns 1-D array of shape (n_days,) with values in [0, 1].
    Falls back to 0.5 for all days if API is unavailable.

    Parameters
    ----------
    n_days : number of daily values to fetch (most-recent last in returned array)
    """
    cache_path = _FEAR_GREED_CACHE

    # ── Try cache first ───────────────────────────────────────────────────────
    if cache_path.exists():
        try:
            fg_df = pd.read_csv(cache_path, parse_dates=["date"])
            if len(fg_df) >= n_days:
                vals = fg_df["fear_greed_norm"].values[-n_days:]
                vals = np.clip(vals, 0.0, 1.0).astype(np.float32)
                logger.info("Loaded %d fear_greed values from cache.", n_days)
                return vals
        except Exception as exc:
            logger.warning("Cache read failed (%s); re-fetching.", exc)

    # ── Fetch from API ────────────────────────────────────────────────────────
    try:
        import requests
        url = f"https://api.alternative.me/fng/?limit={n_days}&format=json"
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        data = resp.json().get("data", [])
        if not data:
            raise ValueError("Empty response from fear_greed API")

        records = []
        for entry in reversed(data):  # API returns newest-first
            ts = int(entry["timestamp"])
            date = pd.Timestamp(ts, unit="s").normalize()
            val = float(entry["value"]) / 100.0
            records.append({"date": date, "fear_greed_norm": val})

        fg_df = pd.DataFrame(records)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        fg_df.to_csv(cache_path, index=False)
        logger.info("Fetched and cached %d fear_greed values.", len(fg_df))

        vals = fg_df["fear_greed_norm"].values[-n_days:]
        vals = np.clip(vals, 0.0, 1.0).astype(np.float32)
        # Pad with 0.5 if fewer days returned
        if len(vals) < n_days:
            vals = np.concatenate([
                np.full(n_days - len(vals), 0.5, dtype=np.float32), vals
            ])
        return vals

    except Exception as exc:
        logger.warning("Fear & Greed API unavailable (%s); using fallback 0.5.", exc)
        return np.full(n_days, 0.5, dtype=np.float32)


# ── Direction label generator ─────────────────────────────────────────────────

def make_direction_labels(
    log_returns_1d: np.ndarray,
) -> np.ndarray:
    """Map log-returns to binary direction labels {0=DOWN, 1=UP}.

    Splits at the median so each class receives ~50% of labels.
    Removing the FLAT class eliminates the hardest-to-learn category and
    converts the problem to binary classification (chance = 50%).

    Parameters
    ----------
    log_returns_1d : 1-D array of raw (un-scaled) log return values.

    Returns
    -------
    int ndarray of shape (N,), dtype int64, values in {0, 1}.
    """
    threshold = float(np.median(log_returns_1d))
    labels = (log_returns_1d > threshold).astype(np.int64)  # 1=UP, 0=DOWN
    return labels


# ── Feature builder ────────────────────────────────────────────────────────────

def _build_features(
    df: pd.DataFrame,
    fear_greed: np.ndarray | None = None,
) -> np.ndarray:
    """Compute 9-column feature matrix from a DataFrame with a 'close' column.

    Parameters
    ----------
    df          : DataFrame with at least a 'close' column (and optionally
                  'total_volume').
    fear_greed  : optional 1-D array of pre-fetched Fear & Greed values, length
                  must equal len(df).  When None, all values are set to 0.5.

    Returns
    -------
    ndarray of shape (N, 9).  Rows containing NaN (warmup period ≈ first 30
    rows for log_return_30d) must be dropped by the caller.
    """
    close = df["close"].values.astype(np.float64)
    N = len(close)

    # ── Feature 0: log_return_1d ──────────────────────────────────────────────
    log_ret_1d = np.full(N, np.nan)
    log_ret_1d[1:] = np.log(close[1:] / close[:-1])

    # ── Feature 1: momentum_30d = close/SMA30 - 1 ────────────────────────────
    sma30 = np.full(N, np.nan)
    for i in range(29, N):
        sma30[i] = close[i - 29 : i + 1].mean()
    momentum_30d = close / (sma30 + 1e-10) - 1.0   # NaN where sma30 is NaN (i < 29)

    # ── Feature 2: realized_vol_14d = rolling 14-day std of log_return_1d ─────
    realized_vol_14d = np.full(N, np.nan)
    for i in range(14, N):
        realized_vol_14d[i] = np.std(log_ret_1d[i - 13 : i + 1], ddof=1)

    # ── Feature 3: RSI_14 ─────────────────────────────────────────────────────
    rsi = _compute_rsi(close, period=14)

    # ── Feature 4: log_volume ─────────────────────────────────────────────────
    if "total_volume" in df.columns:
        vol = df["total_volume"].values.astype(np.float64)
        log_vol = np.log(vol + 1.0)
    else:
        log_vol = np.zeros(N, dtype=np.float64)

    # ── Feature 5: MACD normalised = (EMA12 - EMA26) / close ─────────────────
    ema12 = _compute_ema(close, span=12)   # NaN for first 11 rows
    ema26 = _compute_ema(close, span=26)   # NaN for first 25 rows
    # macd_norm is NaN wherever ema26 is NaN; divide by close to normalise scale
    macd_norm = (ema12 - ema26) / (close + 1e-10)

    # ── Feature 6: Bollinger Band %B (20-period) ──────────────────────────────
    # %B = (close - lower_band) / (upper_band - lower_band)
    # Using a rolling 20-period mean and std (simple, not EMA)
    bb_pct_b = np.full(N, np.nan)
    window_bb = 20
    for i in range(window_bb - 1, N):
        slice_c = close[i - window_bb + 1 : i + 1]
        mid = slice_c.mean()
        std_bb = slice_c.std(ddof=0)
        if std_bb > 1e-10:
            upper = mid + 2 * std_bb
            lower = mid - 2 * std_bb
            bb_pct_b[i] = (close[i] - lower) / (upper - lower)
        else:
            bb_pct_b[i] = 0.5   # neutral when price is flat

    # ── Feature 7: ATR proxy normalised ──────────────────────────────────────
    # True ATR needs high/low; proxy = |log_return_1d| (already a % measure,
    # implicitly normalised by close). Same warmup as log_ret_1d.
    atr_norm = np.abs(log_ret_1d)   # NaN at index 0 (same mask as log_ret_1d)

    # ── Feature 8: Fear & Greed (normalised [0, 1]) ───────────────────────────
    if fear_greed is not None:
        if len(fear_greed) != N:
            logger.warning(
                "fear_greed length %d != df length %d; padding/truncating.",
                len(fear_greed), N,
            )
            fg = np.full(N, 0.5, dtype=np.float64)
            take = min(len(fear_greed), N)
            fg[-take:] = fear_greed[-take:]
        else:
            fg = fear_greed.astype(np.float64)
    else:
        fg = np.full(N, 0.5, dtype=np.float64)

    features = np.stack(
        [log_ret_1d, momentum_30d, realized_vol_14d, rsi, log_vol,
         macd_norm, bb_pct_b, atr_norm, fg],
        axis=1,
    )
    return features.astype(np.float32)


# ── CSV loader ─────────────────────────────────────────────────────────────────

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


# ── Sequence builder ───────────────────────────────────────────────────────────

def _create_sequences(
    scaled: np.ndarray,
    seq_len: int,
    horizon: int = HORIZON,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Build overlapping MIMO input/target sequences.

    Parameters
    ----------
    scaled  : ndarray of shape (N, N_FEATURES) — scaled feature matrix.
    seq_len : int — look-back window size.
    horizon : int — number of forward steps to predict.

    Returns
    -------
    X : ndarray, shape (M, seq_len, N_FEATURES)  — input sequences
    y : ndarray, shape (M, horizon)              — targets: feature-0 (log_return_1d)
                                                   for next 'horizon' steps
    M = N - seq_len - horizon + 1
    """
    n_feats = scaled.shape[1]
    X, y = [], []
    n = len(scaled)
    for i in range(seq_len, n - horizon + 1):
        X.append(scaled[i - seq_len : i])        # (seq_len, n_feats)
        y.append(scaled[i : i + horizon, 0])     # (horizon,) — feature 0
    return np.array(X, dtype=np.float32), np.array(y, dtype=np.float32)


# ── Direction sequence builder ────────────────────────────────────────────────

def _create_direction_sequences(
    dir_labels: np.ndarray,
    seq_len: int,
    horizon: int = HORIZON,
) -> np.ndarray:
    """
    Extract direction label windows aligned with _create_sequences output.

    Parameters
    ----------
    dir_labels : 1-D int array of length N — direction labels for each row.
    seq_len    : look-back window (same as passed to _create_sequences).
    horizon    : number of forward steps.

    Returns
    -------
    y_dir : ndarray, shape (M, horizon), dtype int64
    M = N - seq_len - horizon + 1
    """
    y_dir = []
    n = len(dir_labels)
    for i in range(seq_len, n - horizon + 1):
        y_dir.append(dir_labels[i : i + horizon])
    return np.array(y_dir, dtype=np.int64)


# ── Volatility sequence builder ───────────────────────────────────────────────

def _create_vol_sequences(
    fwd_vol_scaled: np.ndarray,
    seq_len: int,
    horizon: int = HORIZON,
) -> np.ndarray:
    """
    Build forward-volatility target sequences aligned with _create_sequences output.

    Parameters
    ----------
    fwd_vol_scaled : 1-D float array of per-row forward volatility estimates (scaled).
    seq_len        : look-back window (same as passed to _create_sequences).
    horizon        : forecast horizon.

    Returns
    -------
    y_vol : ndarray, shape (M, horizon), dtype float32
    """
    y_vol = []
    n = len(fwd_vol_scaled)
    for i in range(seq_len, n - horizon + 1):
        y_vol.append(fwd_vol_scaled[i : i + horizon])
    return np.array(y_vol, dtype=np.float32)


# ── Main preprocessing function ───────────────────────────────────────────────

def load_and_preprocess(
    csv_path: str | Path = _DEFAULT_CSV,
    seq_len: int = SEQ_LEN,
    train_ratio: float = TRAIN_RATIO,
    val_ratio: float = VAL_RATIO,
    save_scaler: bool = True,
    scaler_path: Path | None = None,
    with_fear_greed: bool = True,
    window_days: int | None = 730,
    with_vol_target: bool = False,
) -> tuple:
    """
    Full preprocessing pipeline.

    Parameters
    ----------
    csv_path       : path to coin CSV (bitcoin.csv or dogecoin.csv)
    seq_len        : look-back window (default 60)
    train_ratio    : fraction for training (default 0.80)
    val_ratio      : fraction for validation (default 0.10)
    save_scaler    : whether to persist scaler to disk
    scaler_path    : override scaler save path (defaults to _SCALER_PATH)
    with_fear_greed: whether to fetch Fear & Greed index (default True;
                     falls back to 0.5 if API unavailable)
    window_days    : rolling training window — use only the most-recent N rows.
                     None = use all data (backward compat).  Default 730 (2 years).
    with_vol_target: if True, return 14-tuple (adds y_vol_train/val/test).

    Returns (11-tuple, or 14-tuple when with_vol_target=True)
    -----------------------------------------------------------
    X_train, y_train, y_dir_train,
    X_val,   y_val,   y_dir_val,
    X_test,  y_test,  y_dir_test,
    scaler, last_price_usd
    [, y_vol_train, y_vol_val, y_vol_test]   # only when with_vol_target=True
    """
    df = _load_csv(csv_path)
    if window_days is not None:
        df = df.iloc[-window_days:].reset_index(drop=True)
    close_prices = df["close"].values.copy()
    N_raw = len(df)

    # ── Fear & Greed feature ─────────────────────────────────────────────────
    if with_fear_greed:
        fear_greed_arr = _load_fear_greed(N_raw)
    else:
        fear_greed_arr = np.full(N_raw, 0.5, dtype=np.float32)

    # Pad/truncate to match df length (API might return fewer days)
    if len(fear_greed_arr) != N_raw:
        padded = np.full(N_raw, 0.5, dtype=np.float32)
        take = min(len(fear_greed_arr), N_raw)
        padded[-take:] = fear_greed_arr[-take:]
        fear_greed_arr = padded

    # ── Build 9-feature matrix ────────────────────────────────────────────────
    features = _build_features(df, fear_greed=fear_greed_arr)   # (N, 9)

    # Drop warmup rows (where any feature is NaN)
    valid_mask = ~np.isnan(features).any(axis=1)
    features = features[valid_mask]
    close_prices = close_prices[valid_mask]
    fear_greed_arr = fear_greed_arr[valid_mask]
    logger.info("After warmup drop: %d rows remain", len(features))

    # Column-0 invariant check: log_return_1d mean should be near 0
    col0_mean = float(features[:, 0].mean())
    assert abs(col0_mean) < 0.05, (
        f"Feature-0 mean ({col0_mean:.4f}) out of expected range — "
        "column-0 (log_return_1d) invariant may be broken."
    )

    # ── Build raw direction labels from feature-0 (log_return_1d) ────────────
    # feature-0 is NOT yet scaled — it's the raw log_return_1d values
    raw_log_rets = features[:, 0].astype(np.float64)
    dir_labels = make_direction_labels(raw_log_rets)   # shape (N,)

    # ── Chronological split of RAW feature rows (before scaler fit) ──────────
    n = len(features)
    train_end_raw = int(n * train_ratio)
    val_end_raw   = train_end_raw + int(n * val_ratio)

    feat_train = features[:train_end_raw]
    feat_val   = features[train_end_raw:val_end_raw]
    feat_test  = features[val_end_raw:]

    dir_train = dir_labels[:train_end_raw]
    dir_val   = dir_labels[train_end_raw:val_end_raw]
    dir_test  = dir_labels[val_end_raw:]

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

    # ── Create direction label sequences ──────────────────────────────────────
    y_dir_train = _create_direction_sequences(dir_train, seq_len, horizon=HORIZON)
    y_dir_val   = _create_direction_sequences(dir_val,   seq_len, horizon=HORIZON)
    y_dir_test  = _create_direction_sequences(dir_test,  seq_len, horizon=HORIZON)

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

    if not with_vol_target:
        return (
            X_train, y_train, y_dir_train,
            X_val,   y_val,   y_dir_val,
            X_test,  y_test,  y_dir_test,
            scaler, last_price_usd,
        )

    # ── Forward realized volatility target (only when with_vol_target=True) ───
    # fwd_vol[i] = std of log_return_1d over next 7 days
    N_clean = len(features)
    fwd_vol = np.full(N_clean, np.nan)
    for i in range(N_clean - 7):
        fwd_vol[i] = np.std(raw_log_rets[i + 1 : i + 8], ddof=1)

    fvol_train = fwd_vol[:train_end_raw]
    fvol_val   = fwd_vol[train_end_raw:val_end_raw]
    fvol_test  = fwd_vol[val_end_raw:]

    # Fit a separate StandardScaler for volatility on training rows only
    vol_scaler = StandardScaler()
    valid_train_mask = ~np.isnan(fvol_train)
    if valid_train_mask.sum() > 1:
        vol_scaler.fit(fvol_train[valid_train_mask].reshape(-1, 1))
    else:
        vol_scaler.mean_  = np.array([0.0])
        vol_scaler.scale_ = np.array([1.0])
        vol_scaler.var_   = np.array([1.0])

    def _scale_vol(arr: np.ndarray) -> np.ndarray:
        result = np.zeros(len(arr), dtype=np.float32)
        valid = ~np.isnan(arr)
        if valid.any():
            result[valid] = vol_scaler.transform(
                arr[valid].reshape(-1, 1)
            ).ravel().astype(np.float32)
        return result

    y_vol_train = _create_vol_sequences(_scale_vol(fvol_train), seq_len, HORIZON)
    y_vol_val   = _create_vol_sequences(_scale_vol(fvol_val),   seq_len, HORIZON)
    y_vol_test  = _create_vol_sequences(_scale_vol(fvol_test),  seq_len, HORIZON)

    logger.info(
        "Vol target shapes — train: %s, val: %s, test: %s",
        y_vol_train.shape, y_vol_val.shape, y_vol_test.shape,
    )

    return (
        X_train, y_train, y_dir_train,
        X_val,   y_val,   y_dir_val,
        X_test,  y_test,  y_dir_test,
        scaler, last_price_usd,
        y_vol_train, y_vol_val, y_vol_test,
    )


def load_scaler() -> StandardScaler:
    """Load the persisted StandardScaler from disk."""
    with open(_SCALER_PATH, "rb") as f:
        return pickle.load(f)


def load_for_fold(
    df_raw: pd.DataFrame,
    fg_full: np.ndarray,
    train_end_idx: int,
    val_end_idx: int,
    seq_len: int = SEQ_LEN,
    horizon: int = HORIZON,
    window_days: int = 730,
) -> tuple:
    """
    Build one walk-forward fold: slice window, build features, fit scaler on
    train, create sequences.  Does NOT write anything to disk.

    Parameters
    ----------
    df_raw        : full raw DataFrame from _load_csv (has 'close' column).
    fg_full       : full fear_greed array aligned row-for-row with df_raw.
    train_end_idx : end index (exclusive) of training rows in df_raw coordinates.
    val_end_idx   : end index (exclusive) of validation rows in df_raw coordinates.
    seq_len       : look-back window.
    horizon       : forecast horizon.
    window_days   : rolling training window — use at most this many rows before
                    train_end_idx as the effective training start.

    Returns (8-tuple)
    -----------------
    X_tr, y_tr, y_dir_tr, X_vl, y_vl, y_dir_vl, scaler_fold, last_price
    """
    effective_start = max(0, train_end_idx - window_days)

    df_fold     = df_raw.iloc[effective_start:val_end_idx].reset_index(drop=True)
    fg_fold     = fg_full[effective_start:val_end_idx].copy()
    close_fold  = df_fold["close"].values.copy()

    # Align fg_fold length with df_fold
    if len(fg_fold) != len(df_fold):
        padded = np.full(len(df_fold), 0.5, dtype=np.float32)
        take = min(len(fg_fold), len(df_fold))
        padded[-take:] = fg_fold[-take:]
        fg_fold = padded

    features = _build_features(df_fold, fear_greed=fg_fold)

    valid_mask = ~np.isnan(features).any(axis=1)
    if not valid_mask.any():
        raise ValueError(
            f"No valid rows after warmup drop for fold (train_end={train_end_idx}, "
            f"effective_start={effective_start})"
        )
    warmup_count = int(np.argmax(valid_mask))   # index of first valid row
    features_clean = features[valid_mask]
    close_clean    = close_fold[valid_mask]

    # Map the train/val boundary from fold coords to clean-feature coords
    local_train_end  = train_end_idx - effective_start
    clean_train_end  = max(0, local_train_end - warmup_count)

    if clean_train_end <= 0 or clean_train_end >= len(features_clean):
        raise ValueError(
            f"Invalid clean_train_end={clean_train_end} "
            f"(features_clean={len(features_clean)}, warmup={warmup_count}) "
            f"for fold train_end={train_end_idx}"
        )

    feat_train = features_clean[:clean_train_end]
    feat_val   = features_clean[clean_train_end:]

    raw_log_rets = features_clean[:, 0]
    dir_labels   = make_direction_labels(raw_log_rets)
    dir_train    = dir_labels[:clean_train_end]
    dir_val      = dir_labels[clean_train_end:]

    scaler_fold = StandardScaler()
    scaler_fold.fit(feat_train)
    scaled_train = scaler_fold.transform(feat_train)
    scaled_val   = scaler_fold.transform(feat_val)

    last_price = float(close_clean[-1])
    scaler_fold.last_price_usd_ = last_price

    # When the val split is shorter than seq_len (common with small fold_size),
    # prepend the last seq_len rows of training as look-back context so that
    # val sequences share the same sliding-window mechanism.
    context = min(seq_len, len(scaled_train))
    if len(scaled_val) < seq_len + horizon:
        scaled_val_ctx = np.concatenate([scaled_train[-context:], scaled_val], axis=0)
        dir_val_ctx    = np.concatenate([dir_train[-context:],    dir_val],    axis=0)
    else:
        scaled_val_ctx = scaled_val
        dir_val_ctx    = dir_val

    X_tr, y_tr   = _create_sequences(scaled_train,  seq_len, horizon)
    X_vl, y_vl   = _create_sequences(scaled_val_ctx, seq_len, horizon)
    y_dir_tr     = _create_direction_sequences(dir_train,   seq_len, horizon)
    y_dir_vl     = _create_direction_sequences(dir_val_ctx, seq_len, horizon)

    return X_tr, y_tr, y_dir_tr, X_vl, y_vl, y_dir_vl, scaler_fold, last_price


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    result = load_and_preprocess()
    X_tr, y_tr, y_dir_tr, X_v, y_v, y_dir_v, X_te, y_te, y_dir_te, sc, last_price = result
    print(f"X_train shape: {X_tr.shape}")
    print(f"y_train shape: {y_tr.shape}")
    print(f"y_dir_train shape: {y_dir_tr.shape}")
    print(f"X_val   shape: {X_v.shape}")
    print(f"X_test  shape: {X_te.shape}")
    print(f"Last price USD: ${last_price:,.2f}")
    print(f"Scaler mean[0]: {sc.mean_[0]:.6f}, scale[0]: {sc.scale_[0]:.6f}")
    print(f"N_FEATURES = {X_tr.shape[2]}")
