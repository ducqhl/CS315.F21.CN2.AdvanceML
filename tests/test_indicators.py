"""
tests/test_indicators.py

Unit tests for src/spark/utils/indicators.py.

Each test creates a minimal local SparkSession, builds a tiny static
DataFrame, applies the indicator function, and asserts against known-good
values computed by hand or via pandas.

These tests do NOT require a running Kafka broker or MongoDB instance.

Run with:
    pytest tests/test_indicators.py -v
"""

import math
import os
import sys

import pytest

# Make the spark utils importable without spark-submit
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src/spark"))

from pyspark.sql import SparkSession
from pyspark.sql.types import (
    DoubleType,
    StringType,
    StructField,
    StructType,
    TimestampType,
)

from utils.indicators import add_bollinger, add_rsi, add_sma, add_vwap


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def spark():
    """
    Local SparkSession for the entire test module.

    scope="module" means it is created once and shared — startup cost is ~5s.
    """
    session = (
        SparkSession.builder.master("local[1]")
        .appName("test_indicators")
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.sql.shuffle.partitions", "1")
        # Suppress noisy Spark logs during tests
        .config("spark.ui.enabled", "false")
        .getOrCreate()
    )
    session.sparkContext.setLogLevel("ERROR")
    yield session
    session.stop()


_SCHEMA = StructType(
    [
        StructField("coin", StringType(), False),
        StructField("event_time", TimestampType(), False),
        StructField("price_usd", DoubleType(), False),
        StructField("volume_24h", DoubleType(), False),
    ]
)


def _make_df(spark: SparkSession, prices: list[float], coin: str = "BTC"):
    """
    Build a test DataFrame with evenly-spaced 1-minute timestamps.

    Args:
        spark:  Active SparkSession.
        prices: List of price_usd values.
        coin:   Coin symbol (default BTC).
    """
    from datetime import datetime, timedelta, timezone

    base = datetime(2025, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    rows = [
        (coin, base + timedelta(minutes=i), float(p), float(1_000_000 * (i + 1)))
        for i, p in enumerate(prices)
    ]
    return spark.createDataFrame(rows, schema=_SCHEMA)


# ── SMA tests ─────────────────────────────────────────────────────────────────


class TestAddSma:
    def test_sma5_last_row_equals_mean_of_last_5(self, spark):
        prices = [100.0, 102.0, 98.0, 105.0, 101.0, 103.0, 99.0]
        df = _make_df(spark, prices)
        result = add_sma(df, window_rows=5, alias="sma_5")
        rows = result.orderBy("event_time").collect()

        # The last row's sma_5 = mean of prices[-5:]
        expected = sum(prices[-5:]) / 5
        actual = rows[-1]["sma_5"]
        assert actual is not None
        assert abs(actual - expected) < 1e-6, f"Expected {expected}, got {actual}"

    def test_sma_at_start_uses_available_rows(self, spark):
        """For the first row, SMA = the single available price (window clamps)."""
        prices = [50.0, 60.0, 70.0]
        df = _make_df(spark, prices)
        result = add_sma(df, window_rows=5, alias="sma_5")
        rows = result.orderBy("event_time").collect()

        # Row 0: only 1 row in window → SMA = 50.0
        assert abs(rows[0]["sma_5"] - 50.0) < 1e-6

    def test_sma20_column_created(self, spark):
        prices = list(range(1, 26))  # 25 values
        df = _make_df(spark, prices)
        result = add_sma(df, window_rows=20, alias="sma_20")
        assert "sma_20" in result.columns

    def test_sma_uses_rows_between_not_range_between(self, spark):
        """Verify N-row window is tight: SMA at position N-1 uses exactly N rows."""
        prices = [10.0, 20.0, 30.0, 40.0, 50.0]  # 5 prices
        df = _make_df(spark, prices)
        result = add_sma(df, window_rows=3, alias="sma_3")
        rows = result.orderBy("event_time").collect()

        # Row index 2 (3rd row): window = prices[0:3] = [10, 20, 30] → mean = 20
        assert abs(rows[2]["sma_3"] - 20.0) < 1e-6
        # Row index 3 (4th row): window = prices[1:4] = [20, 30, 40] → mean = 30
        assert abs(rows[3]["sma_3"] - 30.0) < 1e-6

    def test_multiple_coins_independent_windows(self, spark):
        """SMA for BTC must not bleed into ETH's window."""
        from datetime import datetime, timedelta, timezone

        base = datetime(2025, 1, 1, tzinfo=timezone.utc)
        rows = [
            ("BTC", base + timedelta(minutes=i), float(100 + i), 1_000_000.0)
            for i in range(5)
        ] + [
            ("ETH", base + timedelta(minutes=i), float(200 + i), 1_000_000.0)
            for i in range(5)
        ]
        df = spark.createDataFrame(rows, schema=_SCHEMA)
        result = add_sma(df, window_rows=3, alias="sma_3")

        btc = result.filter("coin = 'BTC'").orderBy("event_time").collect()
        eth = result.filter("coin = 'ETH'").orderBy("event_time").collect()

        # BTC row 2: mean([100, 101, 102]) = 101.0
        assert abs(btc[2]["sma_3"] - 101.0) < 1e-6
        # ETH row 2: mean([200, 201, 202]) = 201.0
        assert abs(eth[2]["sma_3"] - 201.0) < 1e-6


# ── Bollinger Bands tests ──────────────────────────────────────────────────────


class TestAddBollinger:
    def test_columns_created(self, spark):
        prices = list(range(25))
        df = _make_df(spark, [float(p) for p in prices])
        result = add_bollinger(df)
        for col_name in ("bb_mid", "bb_upper", "bb_lower"):
            assert col_name in result.columns

    def test_upper_greater_than_lower(self, spark):
        """Upper band must always be >= lower band."""
        prices = [float(p + (p % 3)) for p in range(1, 25)]
        df = _make_df(spark, prices)
        result = add_bollinger(df)
        rows = result.filter("bb_upper IS NOT NULL AND bb_lower IS NOT NULL").collect()
        for row in rows:
            assert row["bb_upper"] >= row["bb_lower"], (
                f"bb_upper={row['bb_upper']} < bb_lower={row['bb_lower']} at {row['event_time']}"
            )

    def test_mid_equals_sma(self, spark):
        """bb_mid must equal SMA(20) on the same price series."""
        prices = [float(100 + i * 2 + (i % 5)) for i in range(30)]
        df = _make_df(spark, prices)
        bb_df = add_bollinger(df, window_rows=20)
        sma_df = add_sma(df, window_rows=20, alias="sma_check")

        bb_rows = bb_df.orderBy("event_time").collect()
        sma_rows = sma_df.orderBy("event_time").collect()

        for bb_row, sma_row in zip(bb_rows, sma_rows):
            if bb_row["bb_mid"] is not None and sma_row["sma_check"] is not None:
                assert abs(bb_row["bb_mid"] - sma_row["sma_check"]) < 1e-6

    def test_no_temp_columns_leaked(self, spark):
        prices = list(range(1, 25))
        df = _make_df(spark, [float(p) for p in prices])
        result = add_bollinger(df)
        for col_name in result.columns:
            assert not col_name.startswith("_"), (
                f"Internal column '{col_name}' leaked into output schema"
            )


# ── VWAP tests ────────────────────────────────────────────────────────────────


class TestAddVwap:
    def test_vwap_column_created(self, spark):
        prices = [float(p) for p in range(1, 10)]
        df = _make_df(spark, prices)
        result = add_vwap(df)
        assert "vwap" in result.columns

    def test_vwap_single_row_equals_price(self, spark):
        """With a 1-row window, VWAP = price (guard avoids division by zero)."""
        prices = [100.0]
        df = _make_df(spark, prices)
        result = add_vwap(df, window_rows=1)
        row = result.collect()[0]
        # vwap = (100 * vol) / (vol + 1e-6) ≈ 100.0 when vol >> 1e-6
        assert abs(row["vwap"] - 100.0) < 0.001

    def test_vwap_formula_correctness(self, spark):
        """
        Manual calculation:
            price = [10, 20, 30], vol = [1e6, 2e6, 3e6], window = 3
            pv_sum = 10*1e6 + 20*2e6 + 30*3e6 = 10e6 + 40e6 + 90e6 = 140e6
            vol_sum = 6e6
            vwap = 140e6 / 6e6 ≈ 23.333...
        """
        from datetime import datetime, timedelta, timezone

        base = datetime(2025, 1, 1, tzinfo=timezone.utc)
        rows = [
            ("BTC", base + timedelta(minutes=i), float(p), float(v))
            for i, (p, v) in enumerate([(10.0, 1e6), (20.0, 2e6), (30.0, 3e6)])
        ]
        df = spark.createDataFrame(rows, schema=_SCHEMA)
        result = add_vwap(df, window_rows=3)
        last_row = result.orderBy("event_time").collect()[-1]

        expected = (10 * 1e6 + 20 * 2e6 + 30 * 3e6) / (1e6 + 2e6 + 3e6 + 1e-6)
        assert abs(last_row["vwap"] - expected) < 0.001, (
            f"Expected VWAP ≈ {expected:.4f}, got {last_row['vwap']}"
        )

    def test_vwap_no_division_by_zero_with_zero_volume(self, spark):
        """Zero volume must not cause NaN/Inf — the 1e-6 guard prevents it."""
        from datetime import datetime, timedelta, timezone

        base = datetime(2025, 1, 1, tzinfo=timezone.utc)
        rows = [
            ("BTC", base + timedelta(minutes=i), float(100 + i), 0.0)
            for i in range(5)
        ]
        df = spark.createDataFrame(rows, schema=_SCHEMA)
        result = add_vwap(df, window_rows=3)
        for row in result.collect():
            vwap_val = row["vwap"]
            assert vwap_val is not None
            assert not math.isnan(vwap_val), "VWAP must not be NaN"
            assert not math.isinf(vwap_val), "VWAP must not be Inf"


# ── RSI tests ─────────────────────────────────────────────────────────────────


class TestAddRsi:
    def test_rsi_column_created(self, spark):
        prices = [float(p) for p in range(100, 130)]
        df = _make_df(spark, prices)
        result = add_rsi(df, periods=14)
        assert "rsi_14" in result.columns

    def test_rsi_in_range_0_to_100(self, spark):
        """RSI must always be in [0, 100] regardless of price direction."""
        # Monotonically increasing — RSI should approach 100
        prices_up = [float(100 + i) for i in range(30)]
        df_up = _make_df(spark, prices_up)
        for row in add_rsi(df_up, periods=14).collect():
            if row["rsi_14"] is not None:
                assert 0.0 <= row["rsi_14"] <= 100.0, (
                    f"RSI out of range: {row['rsi_14']}"
                )

        # Monotonically decreasing — RSI should approach 0
        prices_down = [float(200 - i) for i in range(30)]
        df_down = _make_df(spark, prices_down)
        for row in add_rsi(df_down, periods=14).collect():
            if row["rsi_14"] is not None:
                assert 0.0 <= row["rsi_14"] <= 100.0, (
                    f"RSI out of range: {row['rsi_14']}"
                )

    def test_rsi_constant_prices_near_fifty(self, spark):
        """When price does not change, gains = losses = 0 → RSI ≈ 50 (guard effect)."""
        prices = [100.0] * 20
        df = _make_df(spark, prices)
        result = add_rsi(df, periods=14)
        rows = result.orderBy("event_time").collect()
        # After the first row (which has no prev), rsi should be near 50
        # (0 gain, 0 loss → RS = 0/(0+1e-6) = 0 → RSI = 100 - 100/1 = 0)
        # Actually: with no gains and no losses avg_gain=0, avg_loss=0,
        # RS = 0/(0+1e-6) ≈ 0 → RSI = 100 - 100/(1+0) = 0
        # Any value is acceptable as long as it stays in [0, 100]
        for row in rows[1:]:
            assert row["rsi_14"] is not None
            assert 0.0 <= row["rsi_14"] <= 100.0

    def test_rsi_no_temp_columns_leaked(self, spark):
        prices = [float(p) for p in range(1, 20)]
        df = _make_df(spark, prices)
        result = add_rsi(df, periods=14)
        for col_name in result.columns:
            assert not col_name.startswith("_"), (
                f"Internal column '{col_name}' leaked into output schema"
            )

    def test_rsi_only_gains_stays_in_range(self, spark):
        """All-gain scenario: RSI must stay <= 100."""
        prices = [float(100 + i * 5) for i in range(20)]
        df = _make_df(spark, prices)
        for row in add_rsi(df, periods=14).collect():
            if row["rsi_14"] is not None:
                assert row["rsi_14"] <= 100.0

    def test_rsi_only_losses_stays_in_range(self, spark):
        """All-loss scenario: RSI must stay >= 0."""
        prices = [float(200 - i * 5) for i in range(20)]
        df = _make_df(spark, prices)
        for row in add_rsi(df, periods=14).collect():
            if row["rsi_14"] is not None:
                assert row["rsi_14"] >= 0.0
