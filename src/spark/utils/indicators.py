from __future__ import annotations

"""
src/spark/utils/indicators.py

Technical indicator calculation helpers for the Crypto Speed Layer.

All functions accept a **static** PySpark DataFrame (i.e. a micro-batch
handed to a foreachBatch callback, or a plain batch DataFrame) and return
an enriched DataFrame.  They must NOT be called directly on a streaming
DataFrame — Spark Structured Streaming does not permit orderBy-based
Window functions on live streams.

Indicators implemented
──────────────────────
  add_sma(df, price_col, window_rows, alias)   — Simple Moving Average
  add_bollinger(df, price_col, window_rows)     — 20-period upper/lower bands
  add_vwap(df)                                  — Volume-weighted average price
  add_rsi(df, price_col, periods)               — RSI(14) with 1e-6 guard

Non-negotiables enforced
────────────────────────
  • SMA windows use rowsBetween(-N+1, 0)  — never rangeBetween
  • RSI avg_loss denominator guarded by lit(1e-6) → RSI always in [0, 100]
  • No print() — use Python logging
  • No shuffle=True anywhere
"""

import logging

from pyspark.sql import DataFrame
from pyspark.sql.functions import (
    avg,
    col,
    lag,
    lit,
    stddev,
    sum as spark_sum,
    when,
)
from pyspark.sql.window import Window

logger = logging.getLogger(__name__)

# ── SMA ───────────────────────────────────────────────────────────────────────


def add_sma(
    df: DataFrame,
    price_col: str = "price_usd",
    window_rows: int = 20,
    alias: str | None = None,
    order_col: str = "event_time",
    partition_col: str = "coin",
) -> DataFrame:
    """
    Append a Simple Moving Average column to *df*.

    Args:
        df:            Static (micro-batch or batch) Spark DataFrame.
        price_col:     Column name containing the price to average.
        window_rows:   Look-back period N.  Window is rowsBetween(-N+1, 0).
        alias:         Output column name.  Defaults to ``sma_{window_rows}``.
        order_col:     Column to order the window by (must be sortable).
        partition_col: Column to partition the window by (e.g. "coin").

    Returns:
        DataFrame with one additional column ``alias``.

    Non-negotiable:
        Uses rowsBetween, not rangeBetween, so the window is always exactly
        N rows regardless of timestamp gaps (Section 6.3 / project rules).
    """
    out_col = alias or f"sma_{window_rows}"
    win = (
        Window.partitionBy(partition_col)
        .orderBy(order_col)
        .rowsBetween(-(window_rows - 1), 0)
    )
    return df.withColumn(out_col, avg(col(price_col)).over(win))


# ── Bollinger Bands ───────────────────────────────────────────────────────────


def add_bollinger(
    df: DataFrame,
    price_col: str = "price_usd",
    window_rows: int = 20,
    num_std: float = 2.0,
    order_col: str = "event_time",
    partition_col: str = "coin",
) -> DataFrame:
    """
    Append Bollinger Band columns: ``bb_mid``, ``bb_upper``, ``bb_lower``.

    Formula:
        bb_mid   = SMA(price, N)
        bb_upper = bb_mid + num_std × stddev(price, N)
        bb_lower = bb_mid − num_std × stddev(price, N)

    Args:
        df:            Static Spark DataFrame.
        price_col:     Price column.
        window_rows:   Rolling window size N (default 20).
        num_std:       Number of standard deviations for band width (default 2.0).
        order_col:     Ordering column for the window.
        partition_col: Partition column.

    Returns:
        DataFrame with columns ``bb_mid``, ``bb_upper``, ``bb_lower`` appended.
    """
    win = (
        Window.partitionBy(partition_col)
        .orderBy(order_col)
        .rowsBetween(-(window_rows - 1), 0)
    )
    df = df.withColumn("bb_mid", avg(col(price_col)).over(win))
    df = df.withColumn("_bb_std", stddev(col(price_col)).over(win))
    df = df.withColumn(
        "bb_upper", col("bb_mid") + lit(num_std) * col("_bb_std")
    )
    df = df.withColumn(
        "bb_lower", col("bb_mid") - lit(num_std) * col("_bb_std")
    )
    return df.drop("_bb_std")


# ── VWAP ──────────────────────────────────────────────────────────────────────


def add_vwap(
    df: DataFrame,
    price_col: str = "price_usd",
    volume_col: str = "volume_24h",
    window_rows: int = 60,
    order_col: str = "event_time",
    partition_col: str = "coin",
) -> DataFrame:
    """
    Append a Volume-Weighted Average Price column ``vwap``.

    Formula:
        vwap = sum(price × volume, N) / sum(volume, N)

    The denominator is guarded by ``lit(1e-6)`` to prevent division by zero
    when volume is zero.

    Args:
        df:            Static Spark DataFrame.
        price_col:     Price column.
        volume_col:    Volume column.
        window_rows:   Look-back period N (default 60 rows ≈ 1 hour at 60s).
        order_col:     Ordering column.
        partition_col: Partition column.

    Returns:
        DataFrame with column ``vwap`` appended.
    """
    win = (
        Window.partitionBy(partition_col)
        .orderBy(order_col)
        .rowsBetween(-(window_rows - 1), 0)
    )
    df = df.withColumn(
        "_pv", col(price_col) * col(volume_col)
    )
    df = df.withColumn(
        "vwap",
        spark_sum(col("_pv")).over(win)
        / (spark_sum(col(volume_col)).over(win) + lit(1e-6)),
    )
    return df.drop("_pv")


# ── RSI ───────────────────────────────────────────────────────────────────────


def add_rsi(
    df: DataFrame,
    price_col: str = "price_usd",
    periods: int = 14,
    order_col: str = "event_time",
    partition_col: str = "coin",
) -> DataFrame:
    """
    Append RSI(periods) as column ``rsi_{periods}``.

    Algorithm (Wilder/Cutler simple-average variant):
        1.  diff   = price_t − price_{t−1}
        2.  gain   = max(diff, 0)
        3.  loss   = max(−diff, 0)
        4.  avg_gain = rolling_mean(gain, N)
        5.  avg_loss = rolling_mean(loss, N)
        6.  RS      = avg_gain / (avg_loss + 1e-6)   ← 1e-6 guard (Section 6.3)
        7.  RSI     = 100 − 100 / (1 + RS)

    The 1e-6 guard on avg_loss ensures RSI is always in [0, 100] even when
    there are no down-moves in the window.

    Args:
        df:            Static Spark DataFrame.
        price_col:     Price column name.
        periods:       RSI look-back (default 14).
        order_col:     Ordering column.
        partition_col: Partition column.

    Returns:
        DataFrame with column ``rsi_{periods}`` appended.
    """
    out_col = f"rsi_{periods}"
    order_win = Window.partitionBy(partition_col).orderBy(order_col)
    roll_win = order_win.rowsBetween(-(periods - 1), 0)

    df = df.withColumn(
        "_prev_price", lag(col(price_col), 1).over(order_win)
    )
    df = df.withColumn(
        "_diff", col(price_col) - col("_prev_price")
    )
    df = df.withColumn(
        "_gain", when(col("_diff") > 0, col("_diff")).otherwise(lit(0.0))
    )
    df = df.withColumn(
        "_loss", when(col("_diff") < 0, -col("_diff")).otherwise(lit(0.0))
    )
    df = df.withColumn("_avg_gain", avg(col("_gain")).over(roll_win))
    df = df.withColumn("_avg_loss", avg(col("_loss")).over(roll_win))
    df = df.withColumn(
        "_rs",
        col("_avg_gain") / (col("_avg_loss") + lit(1e-6)),
    )
    df = df.withColumn(
        out_col,
        lit(100.0) - (lit(100.0) / (lit(1.0) + col("_rs"))),
    )
    return df.drop("_prev_price", "_diff", "_gain", "_loss", "_avg_gain", "_avg_loss", "_rs")
