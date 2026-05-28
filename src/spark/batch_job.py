"""
src/spark/batch_job.py

Sprint 3 — Batch Layer
======================
Reads daily-granularity historical CSV files from data/sample/ (or the full
G-Research dataset when available), computes three batch views, and writes
them to MongoDB.

Batch views produced
────────────────────
  daily_stats      — one row per (symbol, date): avg_close, daily_high,
                     daily_low, avg_volume, total_volume, avg_vwap, trade_count
  historical_sma   — daily_stats enriched with SMA_20, SMA_50, SMA_200
  coin_correlation — all unique (coin_a, coin_b) Pearson correlation pairs

Non-negotiables enforced (project rules)
─────────────────────────────────────────
  • spark.sql.session.timeZone = UTC
  • spark.sparkContext.setLogLevel("WARN")  — never print() in Spark jobs
  • SMA windows use rowsBetween(-(N-1), 0)  — not rangeBetween
  • Batch writes: overwrite mode via write_batch
  • MongoDB URI read from MONGO_URI env var inside write_batch
  • No shuffle=True anywhere

Usage
─────
  # Local (development — sample CSVs)
  python src/spark/batch_job.py

  # Docker Spark cluster (submitted via run_batch.sh)
  spark-submit --master spark://spark-master:7077 \\
      --packages org.mongodb.spark:mongo-spark-connector_2.12:10.2.1 \\
      /app/src/spark/batch_job.py
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import datetime, timezone
from itertools import combinations

# Allow running directly with `python batch_job.py` as well as via spark-submit
# by ensuring the utils package is on the path.
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
if _THIS_DIR not in sys.path:
    sys.path.insert(0, _THIS_DIR)

from pyspark.sql import SparkSession, DataFrame
from pyspark.sql.functions import (
    avg,
    col,
    corr,
    count,
    lit,
    max as spark_max,
    min as spark_min,
    sum as spark_sum,
    to_date,
)
from pyspark.sql.types import (
    DoubleType,
    StringType,
    StructField,
    StructType,
    TimestampType,
)
from pyspark.sql.window import Window

from utils.mongo_writer import write_batch

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

# Sample CSV mapping — coin_name column value → symbol (BTC + DOGE only)
SAMPLE_COIN_MAP: dict[str, str] = {
    "bitcoin":  "BTC",
    "dogecoin": "DOGE",
}

# SMA look-back periods
SMA_PERIODS: list[int] = [20, 50, 200]

# Explicit CSV schema — avoids inferSchema drift and guarantees types regardless
# of how Spark parses the "2015-01-01 00:00:00.000" date strings.
CSV_SCHEMA = StructType(
    [
        StructField("date",         TimestampType(), True),
        StructField("price",        DoubleType(),    True),
        StructField("total_volume", DoubleType(),    True),
        StructField("market_cap",   DoubleType(),    True),
        StructField("coin_name",    StringType(),    True),
    ]
)

# Default data path (overridable via DATA_PATH env var)
_DEFAULT_DATA_PATH = os.path.join(
    os.path.dirname(_THIS_DIR),   # src/
    "..",                          # project root
    "data",
    "sample",
    "*.csv",
)


def _resolve_data_path() -> str:
    """Return the CSV glob path, honouring DATA_PATH env var."""
    env_path = os.getenv("DATA_PATH")
    if env_path:
        return env_path
    return os.path.normpath(_DEFAULT_DATA_PATH)


# ── Spark session factory ─────────────────────────────────────────────────────


def build_spark(app_name: str = "CryptoBatchJob") -> SparkSession:
    """
    Create (or retrieve) a SparkSession with the required project settings.

    Non-negotiables:
      • spark.sql.session.timeZone = UTC
      • setLogLevel("WARN") — keeps executor logs clean
    """
    spark = (
        SparkSession.builder.appName(app_name)
        .config("spark.sql.session.timeZone", "UTC")
        # Reduce shuffle partition noise on small datasets
        .config("spark.sql.shuffle.partitions", "8")
        .getOrCreate()
    )
    spark.sparkContext.setLogLevel("WARN")
    return spark


# ── Data loading ──────────────────────────────────────────────────────────────


def load_sample_csvs(spark: SparkSession, data_path: str) -> DataFrame:
    """
    Load all sample CSV files matching *data_path* glob into one DataFrame.

    Schema of source files:
        date          string  "2015-01-01 00:00:00.000"
        price         double  closing price in USD
        total_volume  double  24-hour trading volume
        market_cap    double
        coin_name     string  "bitcoin" / "ethereum" / "dogecoin"

    Transformations applied:
        • date      → DateType (strips " 00:00:00.000" suffix via to_date)
        • price     → renamed to close (the daily closing price)
        • coin_name → symbol via SAMPLE_COIN_MAP (unmapped coins become null and
                       are filtered out)
        • market_cap column dropped (not needed for batch views)

    Args:
        spark:     Active SparkSession.
        data_path: Glob pattern, e.g. "/app/data/sample/*.csv".

    Returns:
        Cleaned DataFrame with columns:
            symbol STRING, date DATE, close DOUBLE,
            total_volume DOUBLE, price DOUBLE (kept for daily_stats compat)
    """
    logger.info("Loading CSVs from: %s", data_path)

    raw = (
        spark.read.option("header", "true")
        .schema(CSV_SCHEMA)
        .csv(data_path)
    )

    logger.info("Raw CSV row count: %d", raw.count())

    # Build a Spark map expression for coin_name → symbol
    from pyspark.sql.functions import create_map
    from itertools import chain as ichain

    mapping_expr = create_map(
        [lit(x) for x in ichain.from_iterable(SAMPLE_COIN_MAP.items())]
    )

    df = (
        raw
        # Parse date: Spark inferSchema reads "2015-01-01 00:00:00.000" as
        # TimestampType automatically.  to_date() extracts the date part from
        # either a TimestampType or a StringType column without needing an
        # explicit format string, making this robust to both schema outcomes.
        .withColumn("date", to_date(col("date")))
        # Map coin_name → symbol
        .withColumn("symbol", mapping_expr[col("coin_name")])
        # Rename price → close (daily close price)
        .withColumnRenamed("price", "close")
        # Drop rows where symbol mapping failed (unknown coins)
        .filter(col("symbol").isNotNull())
        .filter(col("date").isNotNull())
        .filter(col("close").isNotNull())
        # Drop columns not used in batch views
        .drop("market_cap", "coin_name")
    )

    row_count = df.count()
    logger.info("Cleaned DataFrame row count: %d", row_count)
    return df


# ── Batch view 1: daily_stats ─────────────────────────────────────────────────


def compute_daily_stats(df: DataFrame) -> DataFrame:
    """
    Compute daily OHLCV-equivalent statistics per (symbol, date).

    Since the sample CSVs have daily granularity with a single price per day
    (not tick-level OHLC), daily_high = daily_low = avg_close = close.

    Output columns (matching Section 7.1 schema):
        symbol, date, avg_close, daily_high, daily_low,
        avg_volume, total_volume, avg_vwap, trade_count

    Args:
        df: Cleaned DataFrame from load_sample_csvs.

    Returns:
        Aggregated daily_stats DataFrame.
    """
    logger.info("Computing daily_stats...")

    daily = (
        df.groupBy("symbol", "date")
        .agg(
            avg("close").alias("avg_close"),
            spark_max("close").alias("daily_high"),
            spark_min("close").alias("daily_low"),
            avg("total_volume").alias("avg_volume"),
            spark_sum("total_volume").alias("total_volume"),
            # For daily data: vwap approximated as close (no intra-day ticks)
            avg("close").alias("avg_vwap"),
            count(lit(1)).alias("trade_count"),
        )
        .orderBy("symbol", "date")
    )

    return daily


# ── Batch view 2: historical_sma ──────────────────────────────────────────────


def compute_historical_sma(daily_stats: DataFrame) -> DataFrame:
    """
    Enrich daily_stats with rolling SMA_20, SMA_50, SMA_200 on avg_close.

    Window spec (non-negotiable):
        Window.partitionBy("symbol").orderBy("date").rowsBetween(-(N-1), 0)

    rowsBetween is used (not rangeBetween) so the window is always exactly
    N rows regardless of date gaps in the data.

    For rows with fewer than N predecessors, Spark's avg() naturally averages
    however many rows are available — this is the standard "expanding window"
    behaviour at the start of each symbol's series.

    Args:
        daily_stats: Output of compute_daily_stats().

    Returns:
        DataFrame with original daily_stats columns plus sma_20, sma_50, sma_200.
    """
    logger.info("Computing historical_sma (SMA periods: %s)...", SMA_PERIODS)

    result = daily_stats
    for n in SMA_PERIODS:
        win = (
            Window.partitionBy("symbol")
            .orderBy("date")
            .rowsBetween(-(n - 1), 0)
        )
        result = result.withColumn(f"sma_{n}", avg(col("avg_close")).over(win))

    logger.info("historical_sma schema: %s", result.schema.simpleString())
    return result


# ── Batch view 3: coin_correlation ────────────────────────────────────────────


def compute_coin_correlation(daily_stats: DataFrame) -> DataFrame:
    """
    Compute Pearson correlation between every unique pair of coin symbols.

    Method:
        1. Pivot daily_stats → wide format: one row per date, one col per symbol.
        2. For every unique (coin_a, coin_b) pair (coin_a < coin_b alphabetically),
           call Spark's built-in corr(col_a, col_b) on the pivoted DataFrame.
        3. Return a small DataFrame: [coin_a, coin_b, pearson_corr, computed_at].

    The result is symmetric (BTC-ETH == ETH-BTC), so we store only the lower
    triangle to avoid duplication.  The dashboard can reconstruct the full matrix.

    Args:
        daily_stats: Output of compute_daily_stats().

    Returns:
        Small DataFrame with one row per unique coin pair.
    """
    logger.info("Computing coin_correlation...")

    # Pivot: date → rows, symbol → columns, avg_close → values
    pivot_df = (
        daily_stats.groupBy("date")
        .pivot("symbol")
        .agg(avg("avg_close"))
    )

    symbols = sorted(
        [row["symbol"] for row in daily_stats.select("symbol").distinct().collect()]
    )
    logger.info("Symbols for correlation: %s", symbols)

    computed_at = datetime.now(timezone.utc)
    corr_records: list[dict] = []

    for coin_a, coin_b in combinations(symbols, 2):
        # corr() returns None when there are fewer than 2 non-null overlapping rows.
        # Backtick-quote column names so symbols with special characters are safe.
        corr_val = pivot_df.select(corr(col(f"`{coin_a}`"), col(f"`{coin_b}`"))).first()[0]
        corr_records.append(
            {
                "coin_a": coin_a,
                "coin_b": coin_b,
                "pearson_corr": float(corr_val) if corr_val is not None else None,
                "computed_at": computed_at,
            }
        )
        logger.info("  corr(%s, %s) = %s", coin_a, coin_b, corr_val)

    spark = daily_stats.sparkSession

    # Use an explicit schema so createDataFrame works even when corr_records is
    # empty (e.g. only one symbol was present in the data — C(1,2)=0 pairs).
    from pyspark.sql.types import (
        StructType, StructField, StringType, DoubleType, TimestampType
    )
    corr_schema = StructType([
        StructField("coin_a",       StringType(),  True),
        StructField("coin_b",       StringType(),  True),
        StructField("pearson_corr", DoubleType(),  True),
        StructField("computed_at",  TimestampType(), True),
    ])
    corr_df = spark.createDataFrame(corr_records, schema=corr_schema)
    logger.info("coin_correlation row count: %d", corr_df.count())
    return corr_df


# ── MongoDB persistence ───────────────────────────────────────────────────────


def persist_batch_views(
    daily_stats: DataFrame,
    historical_sma: DataFrame,
    coin_correlation: DataFrame,
) -> None:
    """
    Write all three batch views to MongoDB using write_batch.

    The existing write_batch function uses insert_many for non-realtime
    collections, which gives overwrite-equivalent behaviour when combined
    with the run_batch.sh workflow that drops+recreates collections before
    each run (or when the collections are empty on first run).

    Args:
        daily_stats:      Aggregated daily stats DataFrame.
        historical_sma:   SMA-enriched DataFrame.
        coin_correlation: Correlation pairs DataFrame.
    """
    logger.info("Persisting daily_stats to MongoDB...")
    write_batch(daily_stats, "daily_stats")

    logger.info("Persisting historical_sma to MongoDB...")
    write_batch(historical_sma, "historical_sma")

    logger.info("Persisting coin_correlation to MongoDB...")
    write_batch(coin_correlation, "coin_correlation")

    logger.info("All batch views written successfully.")


# ── Entry point ───────────────────────────────────────────────────────────────


def run(data_path: str | None = None) -> dict[str, int]:
    """
    Execute the full batch pipeline end-to-end.

    Args:
        data_path: Optional override for the CSV glob path.
                   If None, uses DATA_PATH env var or the default sample path.

    Returns:
        Dict mapping collection name → row count written, for verification.
    """
    spark = build_spark()

    path = data_path or _resolve_data_path()
    logger.info("Batch job starting — data path: %s", path)

    # ── Load ──────────────────────────────────────────────────────────────────
    raw_df = load_sample_csvs(spark, path)

    # Cache: daily_stats is the base for both historical_sma and correlation
    raw_df.cache()

    # ── Transform ──────────────────────────────────────────────────────────────
    daily_stats = compute_daily_stats(raw_df)
    daily_stats.cache()

    historical_sma = compute_historical_sma(daily_stats)
    historical_sma.cache()
    coin_correlation = compute_coin_correlation(daily_stats)

    # ── Persist ────────────────────────────────────────────────────────────────
    persist_batch_views(daily_stats, historical_sma, coin_correlation)

    counts = {
        "daily_stats": daily_stats.count(),
        "historical_sma": historical_sma.count(),
        "coin_correlation": coin_correlation.count(),
    }
    logger.info("Batch job complete. Counts: %s", counts)

    raw_df.unpersist()
    daily_stats.unpersist()
    historical_sma.unpersist()

    return counts


if __name__ == "__main__":
    run()
