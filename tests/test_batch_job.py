"""
tests/test_batch_job.py

Unit tests for src/spark/batch_job.py — Sprint 3 Batch Layer.

Coverage
────────
  • load_sample_csvs  — schema parsing, coin_name mapping, null filtering
  • compute_daily_stats  — aggregation correctness (avg, max, min, sum, count)
  • compute_historical_sma  — SMA_20 at row 20 equals mean of first 20 closes;
                              rowsBetween window is exact N rows
  • compute_coin_correlation  — pair count, values in [-1, 1], column names

No running MongoDB or Kafka instance is required.
All MongoDB writes are mocked.

Run with:
    pytest tests/test_batch_job.py -v
"""

from __future__ import annotations

import math
import os
import sys
from datetime import date, datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

# ── Path bootstrap ────────────────────────────────────────────────────────────
# tests/ is at the same level as src/; add src/spark so that batch_job can
# import utils.* without spark-submit.
_REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
_SPARK_SRC = os.path.join(_REPO_ROOT, "src", "spark")
for _p in (_REPO_ROOT, _SPARK_SRC):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import batch_job  # noqa: E402

from pyspark.sql import SparkSession  # noqa: E402
from pyspark.sql.types import (  # noqa: E402
    DateType,
    DoubleType,
    LongType,
    StringType,
    StructField,
    StructType,
)


# ── Shared SparkSession fixture ───────────────────────────────────────────────


@pytest.fixture(scope="module")
def spark() -> SparkSession:
    """
    Local SparkSession for the entire test module.
    scope="module" creates it once — startup cost ~5s.
    """
    session = (
        SparkSession.builder.master("local[1]")
        .appName("test_batch_job")
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.sql.shuffle.partitions", "1")
        .config("spark.ui.enabled", "false")
        .getOrCreate()
    )
    session.sparkContext.setLogLevel("ERROR")
    yield session
    session.stop()


# ── Schema used by helper DataFrames (matches compute_daily_stats output) ─────

_DAILY_SCHEMA = StructType(
    [
        StructField("symbol", StringType(), False),
        StructField("date", DateType(), False),
        StructField("avg_close", DoubleType(), True),
        StructField("daily_high", DoubleType(), True),
        StructField("daily_low", DoubleType(), True),
        StructField("avg_volume", DoubleType(), True),
        StructField("total_volume", DoubleType(), True),
        StructField("avg_vwap", DoubleType(), True),
        StructField("trade_count", LongType(), True),
    ]
)


def _make_daily_df(spark: SparkSession, rows: list[tuple]) -> object:
    """
    Build a daily_stats-shaped DataFrame from raw tuples.

    Tuple format: (symbol, date, avg_close, daily_high, daily_low,
                   avg_volume, total_volume, avg_vwap, trade_count)
    """
    return spark.createDataFrame(rows, schema=_DAILY_SCHEMA)


# ── Tests for load_sample_csvs (CSV schema / mapping) ────────────────────────


class TestLoadSampleCsvs:
    """
    Tests for load_sample_csvs() using tiny in-memory CSV strings written to
    a temp file, rather than the real data/sample/ files.

    This keeps tests self-contained and fast.
    """

    def test_coin_mapping_produces_correct_symbols(self, spark, tmp_path):
        csv_content = (
            "date,price,total_volume,market_cap,coin_name\n"
            "2020-01-01 00:00:00.000,10.0,1000.0,5000.0,bitcoin\n"
            "2020-01-01 00:00:00.000,0.5,2000.0,3000.0,dogecoin\n"
        )
        csv_file = tmp_path / "test.csv"
        csv_file.write_text(csv_content)

        df = batch_job.load_sample_csvs(spark, str(csv_file))
        symbols = {row["symbol"] for row in df.collect()}
        assert symbols == {"BTC", "DOGE"}

    def test_unknown_coin_name_is_filtered_out(self, spark, tmp_path):
        csv_content = (
            "date,price,total_volume,market_cap,coin_name\n"
            "2020-01-01 00:00:00.000,10.0,1000.0,5000.0,bitcoin\n"
            "2020-01-01 00:00:00.000,999.0,1000.0,5000.0,unknowncoin\n"
        )
        csv_file = tmp_path / "test.csv"
        csv_file.write_text(csv_content)

        df = batch_job.load_sample_csvs(spark, str(csv_file))
        rows = df.collect()
        assert len(rows) == 1
        assert rows[0]["symbol"] == "BTC"

    def test_date_parsed_to_date_type(self, spark, tmp_path):
        csv_content = (
            "date,price,total_volume,market_cap,coin_name\n"
            "2021-06-15 00:00:00.000,35000.0,8000000.0,600000000000.0,bitcoin\n"
        )
        csv_file = tmp_path / "test.csv"
        csv_file.write_text(csv_content)

        df = batch_job.load_sample_csvs(spark, str(csv_file))
        row = df.collect()[0]
        assert row["date"] == date(2021, 6, 15)

    def test_price_column_renamed_to_close(self, spark, tmp_path):
        csv_content = (
            "date,price,total_volume,market_cap,coin_name\n"
            "2020-01-01 00:00:00.000,42000.0,1000000.0,800000000000.0,bitcoin\n"
        )
        csv_file = tmp_path / "test.csv"
        csv_file.write_text(csv_content)

        df = batch_job.load_sample_csvs(spark, str(csv_file))
        assert "close" in df.columns, "price column must be renamed to close"
        assert "price" not in df.columns, "original price column must not remain"

    def test_market_cap_column_dropped(self, spark, tmp_path):
        csv_content = (
            "date,price,total_volume,market_cap,coin_name\n"
            "2020-01-01 00:00:00.000,42000.0,1000000.0,800000000000.0,bitcoin\n"
        )
        csv_file = tmp_path / "test.csv"
        csv_file.write_text(csv_content)

        df = batch_job.load_sample_csvs(spark, str(csv_file))
        assert "market_cap" not in df.columns

    def test_null_price_rows_filtered(self, spark, tmp_path):
        csv_content = (
            "date,price,total_volume,market_cap,coin_name\n"
            "2020-01-01 00:00:00.000,,1000.0,5000.0,bitcoin\n"
            "2020-01-02 00:00:00.000,100.0,1000.0,5000.0,bitcoin\n"
        )
        csv_file = tmp_path / "test.csv"
        csv_file.write_text(csv_content)

        df = batch_job.load_sample_csvs(spark, str(csv_file))
        rows = df.collect()
        # Null price rows should be filtered
        assert all(r["close"] is not None for r in rows)


# ── Tests for compute_daily_stats ─────────────────────────────────────────────


class TestComputeDailyStats:
    """
    Tests for compute_daily_stats() using tiny raw DataFrames.
    """

    def _make_raw(self, spark: SparkSession, rows: list[tuple]) -> object:
        """Build a raw DataFrame matching the cleaned load_sample_csvs output."""
        schema = StructType(
            [
                StructField("symbol", StringType(), False),
                StructField("date", DateType(), False),
                StructField("close", DoubleType(), True),
                StructField("total_volume", DoubleType(), True),
            ]
        )
        return spark.createDataFrame(rows, schema=schema)

    def test_single_row_per_date_gives_correct_aggregates(self, spark):
        rows = [
            ("BTC", date(2021, 1, 1), 30000.0, 1_000_000.0),
        ]
        raw = self._make_raw(spark, rows)
        result = batch_job.compute_daily_stats(raw)
        result_rows = result.collect()

        assert len(result_rows) == 1
        r = result_rows[0]
        assert r["symbol"] == "BTC"
        assert abs(r["avg_close"] - 30000.0) < 1e-6
        assert abs(r["daily_high"] - 30000.0) < 1e-6
        assert abs(r["daily_low"] - 30000.0) < 1e-6
        assert abs(r["total_volume"] - 1_000_000.0) < 1e-6
        assert r["trade_count"] == 1

    def test_high_greater_or_equal_low(self, spark):
        """daily_high must always be >= daily_low regardless of data."""
        rows = [
            ("BTC", date(2021, 1, 1), 30000.0, 500_000.0),
            ("BTC", date(2021, 1, 2), 31000.0, 600_000.0),
            ("ETH", date(2021, 1, 1), 2000.0, 100_000.0),
        ]
        raw = self._make_raw(spark, rows)
        result = batch_job.compute_daily_stats(raw)
        for r in result.collect():
            assert r["daily_high"] >= r["daily_low"], (
                f"high < low for {r['symbol']} on {r['date']}"
            )

    def test_trade_count_is_positive(self, spark):
        rows = [("BTC", date(2021, 1, 1), 30000.0, 1_000_000.0)]
        raw = self._make_raw(spark, rows)
        result = batch_job.compute_daily_stats(raw)
        assert result.collect()[0]["trade_count"] >= 1

    def test_groups_by_symbol_and_date(self, spark):
        """Two symbols on the same date → two separate rows."""
        rows = [
            ("BTC", date(2021, 1, 1), 30000.0, 1_000_000.0),
            ("ETH", date(2021, 1, 1), 2000.0, 500_000.0),
        ]
        raw = self._make_raw(spark, rows)
        result = batch_job.compute_daily_stats(raw)
        assert result.count() == 2

    def test_avg_volume_is_positive(self, spark):
        rows = [
            ("DOGE", date(2021, 1, 1), 0.05, 9_000_000.0),
            ("DOGE", date(2021, 1, 2), 0.06, 8_000_000.0),
        ]
        raw = self._make_raw(spark, rows)
        result = batch_job.compute_daily_stats(raw)
        for r in result.collect():
            assert r["avg_volume"] > 0


# ── Tests for compute_historical_sma ──────────────────────────────────────────


class TestComputeHistoricalSma:
    """
    Tests for compute_historical_sma() — the critical SMA window logic.
    """

    def _make_sequential_daily(
        self, spark: SparkSession, n: int, symbol: str = "BTC", base_price: float = 100.0
    ) -> object:
        """
        Build a daily_stats DataFrame with n consecutive daily rows.
        avg_close = base_price + row_index (arithmetic sequence for easy checking).
        """
        from datetime import timedelta

        base_date = date(2015, 1, 1)
        rows = [
            (
                symbol,
                base_date + timedelta(days=i),
                float(base_price + i),  # avg_close
                float(base_price + i),  # daily_high
                float(base_price + i),  # daily_low
                float(1_000_000),        # avg_volume
                float(1_000_000),        # total_volume
                float(base_price + i),  # avg_vwap
                1,                       # trade_count
            )
            for i in range(n)
        ]
        return spark.createDataFrame(rows, schema=_DAILY_SCHEMA)

    def test_sma20_at_row_20_equals_mean_of_first_20_closes(self, spark):
        """
        Core SMA correctness check:
        At the 20th row (index 19), SMA_20 must equal the arithmetic mean
        of the first 20 avg_close values.

        This verifies that rowsBetween(-(20-1), 0) = rowsBetween(-19, 0) gives
        a window of exactly 20 rows at position 19.
        """
        n_rows = 30  # enough for SMA_20 and SMA_50 to be well-defined
        daily = self._make_sequential_daily(spark, n=n_rows)
        result = batch_job.compute_historical_sma(daily)

        rows = (
            result.filter("symbol = 'BTC'")
            .orderBy("date")
            .collect()
        )

        # The 20th row (index 19): avg_close values are 100, 101, ..., 119
        first_20_closes = [100.0 + i for i in range(20)]
        expected_sma20 = sum(first_20_closes) / 20  # = 109.5

        actual_sma20 = rows[19]["sma_20"]
        diff = abs(actual_sma20 - expected_sma20)
        assert diff < 1e-6, (
            f"SMA_20 at row 20: expected {expected_sma20}, got {actual_sma20} "
            f"(diff={diff})"
        )

    def test_sma20_at_row_1_equals_single_close(self, spark):
        """At row 0, there is only 1 row in the window → SMA_20 = avg_close."""
        daily = self._make_sequential_daily(spark, n=25)
        result = batch_job.compute_historical_sma(daily)
        rows = result.filter("symbol = 'BTC'").orderBy("date").collect()
        # Row 0: only 1 value → avg = that value itself
        assert abs(rows[0]["sma_20"] - rows[0]["avg_close"]) < 1e-6

    def test_sma_columns_all_present(self, spark):
        """All three SMA columns must be in the output schema."""
        daily = self._make_sequential_daily(spark, n=25)
        result = batch_job.compute_historical_sma(daily)
        for col_name in ("sma_20", "sma_50", "sma_200"):
            assert col_name in result.columns, f"Missing column: {col_name}"

    def test_row_count_unchanged(self, spark):
        """historical_sma must have the exact same number of rows as daily_stats."""
        daily = self._make_sequential_daily(spark, n=50)
        result = batch_job.compute_historical_sma(daily)
        assert result.count() == daily.count()

    def test_sma_windows_are_independent_per_symbol(self, spark):
        """
        BTC SMA values must not bleed into ETH's window and vice-versa.

        BTC prices: 100, 101, ..., 119 (20 rows)
        ETH prices: 1000, 1001, ..., 1019 (20 rows, same dates)

        At index 19, BTC SMA_20 = mean(100..119) = 109.5
                      ETH SMA_20 = mean(1000..1019) = 1009.5
        """
        from datetime import timedelta

        base_date = date(2015, 1, 1)
        n = 20

        btc_rows = [
            ("BTC", base_date + timedelta(days=i), float(100 + i),
             float(100 + i), float(100 + i), 1_000_000.0, 1_000_000.0,
             float(100 + i), 1)
            for i in range(n)
        ]
        eth_rows = [
            ("ETH", base_date + timedelta(days=i), float(1000 + i),
             float(1000 + i), float(1000 + i), 500_000.0, 500_000.0,
             float(1000 + i), 1)
            for i in range(n)
        ]
        daily = spark.createDataFrame(btc_rows + eth_rows, schema=_DAILY_SCHEMA)
        result = batch_job.compute_historical_sma(daily)

        btc = result.filter("symbol = 'BTC'").orderBy("date").collect()
        eth = result.filter("symbol = 'ETH'").orderBy("date").collect()

        expected_btc_sma20 = sum(100.0 + i for i in range(20)) / 20  # 109.5
        expected_eth_sma20 = sum(1000.0 + i for i in range(20)) / 20  # 1009.5

        assert abs(btc[19]["sma_20"] - expected_btc_sma20) < 1e-6, (
            f"BTC SMA_20 mismatch: {btc[19]['sma_20']} != {expected_btc_sma20}"
        )
        assert abs(eth[19]["sma_20"] - expected_eth_sma20) < 1e-6, (
            f"ETH SMA_20 mismatch: {eth[19]['sma_20']} != {expected_eth_sma20}"
        )

    def test_sma50_at_row_50_equals_mean_of_first_50_closes(self, spark):
        """Verify SMA_50 window is also exactly 50 rows wide."""
        daily = self._make_sequential_daily(spark, n=60)
        result = batch_job.compute_historical_sma(daily)
        rows = result.filter("symbol = 'BTC'").orderBy("date").collect()

        first_50_closes = [100.0 + i for i in range(50)]
        expected_sma50 = sum(first_50_closes) / 50  # = 124.5

        actual_sma50 = rows[49]["sma_50"]
        assert abs(actual_sma50 - expected_sma50) < 1e-6, (
            f"SMA_50 at row 50: expected {expected_sma50}, got {actual_sma50}"
        )

    def test_no_internal_columns_leaked(self, spark):
        """No column with leading underscore should appear in the output."""
        daily = self._make_sequential_daily(spark, n=25)
        result = batch_job.compute_historical_sma(daily)
        for col_name in result.columns:
            assert not col_name.startswith("_"), (
                f"Internal column '{col_name}' leaked into output schema"
            )


# ── Tests for compute_coin_correlation ────────────────────────────────────────


class TestComputeCoinCorrelation:
    """Tests for compute_coin_correlation()."""

    def _make_two_coin_daily(self, spark: SparkSession, n: int = 30) -> object:
        """
        Build a minimal daily_stats DataFrame for BTC and ETH with
        positively correlated prices (ETH ≈ BTC * 0.05).
        """
        from datetime import timedelta

        base_date = date(2021, 1, 1)
        rows: list[tuple] = []
        for i in range(n):
            d = base_date + timedelta(days=i)
            btc_price = float(40000 + i * 100)
            eth_price = float(2000 + i * 5)
            rows.append(("BTC", d, btc_price, btc_price, btc_price,
                          1_000_000.0, 1_000_000.0, btc_price, 1))
            rows.append(("ETH", d, eth_price, eth_price, eth_price,
                          500_000.0, 500_000.0, eth_price, 1))
        return spark.createDataFrame(rows, schema=_DAILY_SCHEMA)

    def test_two_symbols_produce_one_pair(self, spark):
        """C(2,2) = 1 unique pair."""
        daily = self._make_two_coin_daily(spark)
        result = batch_job.compute_coin_correlation(daily)
        assert result.count() == 1

    def test_three_symbols_produce_three_pairs(self, spark):
        """C(3,2) = 3 unique pairs."""
        from datetime import timedelta

        base_date = date(2021, 1, 1)
        rows: list[tuple] = []
        for i in range(30):
            d = base_date + timedelta(days=i)
            for sym, base_p in [("BTC", 40000.0), ("ETH", 2000.0), ("DOGE", 0.05)]:
                p = base_p + i
                rows.append((sym, d, p, p, p, 1_000_000.0, 1_000_000.0, p, 1))
        daily = spark.createDataFrame(rows, schema=_DAILY_SCHEMA)

        result = batch_job.compute_coin_correlation(daily)
        assert result.count() == 3

    def test_correlation_values_in_range(self, spark):
        """All Pearson correlation values must be in [-1, 1] or None."""
        daily = self._make_two_coin_daily(spark)
        result = batch_job.compute_coin_correlation(daily)
        for r in result.collect():
            val = r["pearson_corr"]
            if val is not None:
                assert -1.0 <= val <= 1.0, (
                    f"Correlation out of range: {val} for "
                    f"{r['coin_a']}-{r['coin_b']}"
                )

    def test_positively_correlated_prices_give_positive_corr(self, spark):
        """BTC and ETH prices rise together → positive correlation."""
        daily = self._make_two_coin_daily(spark)
        result = batch_job.compute_coin_correlation(daily)
        row = result.collect()[0]
        assert row["pearson_corr"] is not None
        assert row["pearson_corr"] > 0.9, (
            f"Expected strong positive correlation, got {row['pearson_corr']}"
        )

    def test_output_columns_present(self, spark):
        """Output must have exactly the required columns."""
        daily = self._make_two_coin_daily(spark)
        result = batch_job.compute_coin_correlation(daily)
        required = {"coin_a", "coin_b", "pearson_corr", "computed_at"}
        assert required.issubset(set(result.columns)), (
            f"Missing columns: {required - set(result.columns)}"
        )

    def test_computed_at_is_a_datetime(self, spark):
        """computed_at must be a timezone-aware datetime."""
        daily = self._make_two_coin_daily(spark)
        result = batch_job.compute_coin_correlation(daily)
        for r in result.collect():
            assert isinstance(r["computed_at"], datetime), (
                f"computed_at is not a datetime: {type(r['computed_at'])}"
            )

    def test_no_duplicate_pairs(self, spark):
        """Each (coin_a, coin_b) pair must appear exactly once."""
        from datetime import timedelta

        base_date = date(2021, 1, 1)
        rows: list[tuple] = []
        for i in range(20):
            d = base_date + timedelta(days=i)
            for sym, base_p in [("BTC", 40000.0), ("ETH", 2000.0), ("DOGE", 0.05)]:
                p = base_p + i
                rows.append((sym, d, p, p, p, 1_000_000.0, 1_000_000.0, p, 1))
        daily = spark.createDataFrame(rows, schema=_DAILY_SCHEMA)

        result = batch_job.compute_coin_correlation(daily)
        pairs = [(r["coin_a"], r["coin_b"]) for r in result.collect()]
        assert len(pairs) == len(set(pairs)), "Duplicate pairs found"


# ── Tests for persist_batch_views (mock MongoDB) ───────────────────────────────


class TestPersistBatchViews:
    """Tests that persist_batch_views calls write_batch for all three collections."""

    def test_write_batch_called_for_all_three_collections(self, spark):
        """persist_batch_views must call write_batch exactly 3 times."""
        from datetime import timedelta

        base_date = date(2021, 1, 1)
        rows = [
            ("BTC", base_date, 40000.0, 40000.0, 40000.0,
             1_000_000.0, 1_000_000.0, 40000.0, 1),
        ]
        daily = spark.createDataFrame(rows, schema=_DAILY_SCHEMA)
        sma = batch_job.compute_historical_sma(daily)
        corr = batch_job.compute_coin_correlation(daily)

        called_collections: list[str] = []

        def fake_write_batch(df, collection_name: str) -> None:
            called_collections.append(collection_name)

        with patch.object(batch_job, "write_batch", side_effect=fake_write_batch):
            batch_job.persist_batch_views(daily, sma, corr)

        assert set(called_collections) == {
            "daily_stats", "historical_sma", "coin_correlation"
        }, f"Unexpected collections written: {called_collections}"
        assert len(called_collections) == 3

    def test_persist_does_not_raise_when_write_batch_succeeds(self, spark):
        rows = [
            ("BTC", date(2021, 1, 1), 40000.0, 40000.0, 40000.0,
             1_000_000.0, 1_000_000.0, 40000.0, 1),
        ]
        daily = spark.createDataFrame(rows, schema=_DAILY_SCHEMA)
        sma = batch_job.compute_historical_sma(daily)
        corr = batch_job.compute_coin_correlation(daily)

        with patch.object(batch_job, "write_batch"):
            # Should not raise
            batch_job.persist_batch_views(daily, sma, corr)
