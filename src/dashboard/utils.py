"""
utils.py — Pure helper functions for the Crypto dashboard.

These functions have NO Streamlit imports and can be imported directly in
tests without running any page-level code.
"""

import numpy as np
import pandas as pd


def compute_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """Compute RSI(period) on a price Series.

    Uses EWM (exponential weighted mean) Wilder smoothing.
    The 1e-6 guard on avg_loss prevents division by zero so RSI stays in [0, 100].

    Parameters
    ----------
    series : pd.Series
        Close (or any) price series.
    period : int
        RSI look-back period (default 14).

    Returns
    -------
    pd.Series
        RSI values aligned to *series* index; first (period-1) values are NaN.
    """
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    rs = avg_gain / (avg_loss + 1e-6)
    rsi = 100 - (100 / (1 + rs))
    return rsi


def simulate_ohlc(df: pd.DataFrame) -> pd.DataFrame:
    """Simulate OHLCV columns from a daily avg_close column.

    Simulation rules (daily-close-only data):
      open  = previous day avg_close  (shift 1; first row: open == close)
      high  = avg_close * 1.001
      low   = avg_close * 0.999
      close = avg_close

    The input DataFrame is not mutated — a copy is returned.

    Parameters
    ----------
    df : pd.DataFrame
        Must contain an ``avg_close`` column.

    Returns
    -------
    pd.DataFrame
        Copy of *df* with added columns: ``open``, ``high``, ``low``, ``close``.
    """
    df = df.copy()
    df["open"] = df["avg_close"].shift(1).fillna(df["avg_close"])
    df["high"] = df["avg_close"] * 1.001
    df["low"] = df["avg_close"] * 0.999
    df["close"] = df["avg_close"]
    return df


def build_corr_matrix(corr_df: pd.DataFrame) -> pd.DataFrame:
    """Build a symmetric NxN Pearson correlation matrix from pair records.

    Parameters
    ----------
    corr_df : pd.DataFrame
        Columns: ``coin_a``, ``coin_b``, ``pearson_corr``.

    Returns
    -------
    pd.DataFrame
        Square DataFrame with coins as both index and columns.
        Diagonal = 1.0; off-diagonal filled symmetrically from corr_df.
        NaN pearson_corr values are skipped (cell remains 0.0 from np.eye).
    """
    if corr_df.empty:
        return pd.DataFrame()

    coins = sorted(set(corr_df["coin_a"].tolist() + corr_df["coin_b"].tolist()))
    n = len(coins)
    matrix = pd.DataFrame(np.eye(n), index=coins, columns=coins)

    for _, row in corr_df.iterrows():
        a, b, val = row["coin_a"], row["coin_b"], row["pearson_corr"]
        if pd.notna(val):
            matrix.loc[a, b] = val
            matrix.loc[b, a] = val  # Symmetric

    return matrix
