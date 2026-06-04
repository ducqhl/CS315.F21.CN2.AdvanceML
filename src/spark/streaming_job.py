from __future__ import annotations

"""
src/spark/streaming_job.py

Spark Structured Streaming job — Crypto Speed Layer.

Pipeline overview
─────────────────
  Kafka topic ``crypto_raw``  (bootstrap: kafka:29092)
      │
      ▼  parse JSON  →  withWatermark("event_time", "10 minutes")
      │
      ├── Query A: 5-min sliding window aggregation
      │     groupBy(coin, window 20min/5min)
      │     → avg(price) as sma_20, max/min, total_volume
      │     → foreachBatch → mongo_writer.write_batch("window_stats")
      │
      └── Query B: per-record enrichment (RSI, VWAP, Bollinger)
            foreachBatch:
              for each micro-batch (static DF):
                add_sma(5), add_sma(20)
                add_rsi(14)
                add_vwap(60 rows)
                add_bollinger(20 rows)
                alert logic: change_24h > 5% → produce to crypto_alerts
                mongo_writer.write_batch("realtime_prices")

Non-negotiables enforced
────────────────────────
  • spark.sql.session.timeZone = UTC
  • setLogLevel("WARN")  — no print()
  • withWatermark("event_time", "10 minutes")
  • foreachBatch for all MongoDB writes
  • Checkpoint dir: /tmp/spark-checkpoints
  • JAR packages: spark-sql-kafka-0-10_2.12:3.5.1
  • Kafka bootstrap inside Docker: kafka:29092
  • MongoDB URI from MONGO_URI env var via mongo_writer module
"""

import json
import logging
import os
import sys

from dotenv import load_dotenv

load_dotenv()

# ── PySpark imports ───────────────────────────────────────────────────────────
from pyspark.sql import DataFrame, SparkSession
from pyspark.sql.functions import (
    avg,
    col,
    from_json,
    last,
    lit,
    max as spark_max,
    min as spark_min,
    sum as spark_sum,
    to_timestamp,
    window,
    current_timestamp,
)
from pyspark.sql.types import (
    DoubleType,
    StringType,
    StructField,
    StructType,
    TimestampType,
)

# Project utilities — imported after PySpark so the module path is available
sys.path.insert(0, os.path.dirname(__file__))
from utils.indicators import add_bollinger, add_rsi, add_sma, add_vwap
from utils.mongo_writer import upsert_alerts, write_batch

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("streaming_job")

# ── Configuration ─────────────────────────────────────────────────────────────
KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:29092")
KAFKA_TOPIC_RAW = os.getenv("KAFKA_TOPIC_RAW", "crypto_raw")
KAFKA_TOPIC_ALERTS = os.getenv("KAFKA_TOPIC_ALERTS", "crypto_alerts")
CHECKPOINT_DIR = os.getenv("SPARK_CHECKPOINT_DIR", "/tmp/spark-checkpoints")

ALERT_THRESHOLD_PCT: float = 5.0  # change_24h > 5% triggers alert

# ── Kafka JSON schema (Section 7.2) ──────────────────────────────────────────
CRYPTO_SCHEMA = StructType(
    [
        StructField("coin", StringType(), True),
        StructField("coin_id", StringType(), True),
        StructField("price_usd", DoubleType(), True),
        StructField("volume_24h", DoubleType(), True),
        StructField("market_cap", DoubleType(), True),
        StructField("change_24h", DoubleType(), True),
        StructField("timestamp", StringType(), True),  # ISO-8601 string
        StructField("source", StringType(), True),
        # OHLC fields from CoinGecko /coins/{id}/ohlc (most recent 4h candle)
        StructField("open",  DoubleType(), True),
        StructField("high",  DoubleType(), True),
        StructField("low",   DoubleType(), True),
        StructField("close", DoubleType(), True),
    ]
)


# ── SparkSession ──────────────────────────────────────────────────────────────


def build_spark() -> SparkSession:
    """
    Create the SparkSession with project-standard settings.

    JAR packages are resolved at spark-submit time via --packages flag.
    The session here just declares the app name and mandatory configs.
    """
    spark = (
        SparkSession.builder.appName("CryptoStreamingJob")
        .config(
            "spark.sql.streaming.checkpointLocation", CHECKPOINT_DIR
        )
        .config("spark.sql.session.timeZone", "UTC")
        # Reduce shuffle partitions for the small 7-coin dataset
        .config("spark.sql.shuffle.partitions", "3")
        .getOrCreate()
    )
    spark.sparkContext.setLogLevel("WARN")
    return spark


# ── Stream source ─────────────────────────────────────────────────────────────


def read_kafka_stream(spark: SparkSession) -> DataFrame:
    """
    Read raw bytes from Kafka topic ``crypto_raw`` and parse to typed columns.

    Returns a streaming DataFrame with schema:
        coin, coin_id, price_usd, volume_24h, market_cap,
        change_24h, event_time (TimestampType), source
    """
    raw = (
        spark.readStream.format("kafka")
        .option("kafka.bootstrap.servers", KAFKA_BOOTSTRAP)
        .option("subscribe", KAFKA_TOPIC_RAW)
        .option("startingOffsets", "latest")
        .option("failOnDataLoss", "false")
        # Limit records per trigger to avoid OOM on backlog replay
        .option("maxOffsetsPerTrigger", 1000)
        .load()
    )

    parsed = (
        raw.select(
            from_json(col("value").cast("string"), CRYPTO_SCHEMA).alias("d")
        )
        .select("d.*")
        # Convert ISO-8601 string timestamp → TimestampType event_time
        .withColumn("event_time", to_timestamp(col("timestamp")))
        # Drop raw string timestamp column to avoid confusion
        .drop("timestamp")
    )
    return parsed


# ── Query A: 5-min sliding window aggregation ─────────────────────────────────


def _write_window_agg(batch_df: DataFrame, batch_id: int) -> None:
    """
    foreachBatch handler for the windowed aggregation query.

    Receives a micro-batch of already-aggregated rows and writes them
    to MongoDB realtime_prices.  The schema matches the Serving Layer
    collection schema from Section 7.1.
    """
    if batch_df.rdd.isEmpty():
        return

    # Rename aggregated window columns to final schema names.
    # sma_5 (per-record) is written by Query B; this query stores the 20-min SMA
    # and OHLCV window stats in a separate collection to avoid schema collisions.
    out = batch_df.select(
        col("coin"),
        col("window.start").alias("event_time"),
        col("window.end").alias("window_end"),
        col("price_usd"),
        col("volume_24h"),
        col("market_cap"),
        col("change_24h"),
        col("sma_20"),
        col("high_window"),
        col("low_window"),
        col("total_volume"),
        col("avg_volume"),
    ).withColumn("created_at", current_timestamp())

    write_batch(out, "window_stats")


def start_window_agg_query(watermarked_df: DataFrame) -> object:
    """
    Start Query A: aggregate prices over a 20-min / 5-min sliding window.

    Window size   20 minutes  → SMA_20 = avg closing price over the window
    Slide         5  minutes  → emitted every 5 min; written to ``window_stats``

    Note: SMA_5 (per-record, row-based) is handled by Query B via add_sma.
    Keeping these in separate collections avoids schema collisions on upsert.

    Output mode: ``append`` — results are only emitted once the watermark
    has passed the window end (safe for downstream consumers).
    """
    agg = (
        watermarked_df.groupBy(
            col("coin"),
            window(col("event_time"), "20 minutes", "5 minutes"),
        )
        .agg(
            avg("price_usd").alias("sma_20"),
            spark_max("price_usd").alias("high_window"),
            spark_min("price_usd").alias("low_window"),
            spark_sum("volume_24h").alias("total_volume"),
            avg("volume_24h").alias("avg_volume"),
            last("price_usd").alias("price_usd"),
            last("volume_24h").alias("volume_24h"),
            last("market_cap").alias("market_cap"),
            last("change_24h").alias("change_24h"),
        )
    )

    query = (
        agg.writeStream.outputMode("append")
        .foreachBatch(_write_window_agg)
        .option(
            "checkpointLocation",
            f"{CHECKPOINT_DIR}/window_stats",
        )
        .trigger(processingTime="30 seconds")
        .start()
    )
    logger.info("Query A (window aggregation) started — id=%s", query.id)
    return query


# ── Alert Kafka producer singleton ───────────────────────────────────────────
# Created once per JVM process; reused across micro-batches to avoid the
# overhead of opening/closing a producer connection every 30 seconds.

_alert_producer = None


def _get_alert_producer():
    """Return (creating if needed) the module-level alert KafkaProducer."""
    global _alert_producer
    if _alert_producer is None:
        from kafka import KafkaProducer as _KafkaProducer  # type: ignore[import]

        _alert_producer = _KafkaProducer(
            bootstrap_servers=KAFKA_BOOTSTRAP.split(","),
            value_serializer=lambda v: json.dumps(v, default=str).encode("utf-8"),
            key_serializer=lambda k: k.encode("utf-8"),
            acks="all",
            retries=3,
            max_in_flight_requests_per_connection=1,
        )
        logger.info("Alert KafkaProducer initialised (bootstrap=%s)", KAFKA_BOOTSTRAP)
    return _alert_producer


# ── Query B: per-record enrichment + alerts ────────────────────────────────────


def _build_alert_records(batch_df: DataFrame) -> list[dict]:
    """
    Scan the micro-batch for rows where |change_24h| > ALERT_THRESHOLD_PCT.

    Returns a list of alert dicts ready for MongoDB insertion.
    """
    alert_rows = batch_df.filter(
        (col("change_24h") > lit(ALERT_THRESHOLD_PCT))
        | (col("change_24h") < lit(-ALERT_THRESHOLD_PCT))
    ).collect()

    alerts = []
    for row in alert_rows:
        alerts.append(
            {
                "coin": row["coin"],
                "alert_type": "PRICE_SPIKE",
                "change_pct": row["change_24h"],
                "price_usd": row["price_usd"],
                "timestamp": row["event_time"],
            }
        )
    return alerts


def _produce_alerts_to_kafka(alerts: list[dict], topic: str) -> None:
    """
    Produce alert records to the ``crypto_alerts`` Kafka topic.

    Uses the module-level singleton KafkaProducer so the connection is not
    reopened on every micro-batch.

    Args:
        alerts: List of alert dicts.
        topic:  Target Kafka topic name.
    """
    if not alerts:
        return
    try:
        producer = _get_alert_producer()
        for alert in alerts:
            producer.send(
                topic=topic,
                key=alert["coin"],
                value=alert,
            )
        producer.flush()
        logger.info(
            "_produce_alerts_to_kafka: sent %d alert(s) to '%s'",
            len(alerts),
            topic,
        )
    except Exception:
        logger.exception(
            "_produce_alerts_to_kafka: failed to send alerts to Kafka"
        )


def _enrich_and_write(batch_df: DataFrame, batch_id: int) -> None:
    """
    foreachBatch handler for Query B.

    Steps:
      1. Skip empty batches.
      2. Cache the micro-batch so the alert scan doesn't trigger a second pass.
      3. Sort by (coin, event_time) so window functions are deterministic.
      4. Apply SMA-5, SMA-20, RSI-14, VWAP-60, Bollinger-20.
      5. Select final schema columns and write to MongoDB.
      6. Build and send Kafka alerts for large price moves.
    """
    if batch_df.rdd.isEmpty():
        return

    # Cache so that the indicator pipeline and the alert scan below both
    # read from memory rather than re-executing the Kafka source twice.
    batch_df.cache()
    try:
        # Sort the static micro-batch so window functions are meaningful
        df = batch_df.orderBy("coin", "event_time")

        # ── Technical indicators ──────────────────────────────────────────
        df = add_sma(df, price_col="price_usd", window_rows=5,  alias="sma_5")
        df = add_sma(df, price_col="price_usd", window_rows=20, alias="sma_20")
        df = add_rsi(df, price_col="price_usd", periods=14)
        df = add_vwap(df, price_col="price_usd", volume_col="volume_24h", window_rows=60)
        df = add_bollinger(df, price_col="price_usd", window_rows=20)

        # ── Final schema selection (Section 7.1 realtime_prices) ─────────
        out = df.select(
            col("coin"),
            col("price_usd"),
            col("volume_24h"),
            col("market_cap"),
            col("change_24h"),
            col("sma_5"),
            col("sma_20"),
            col("rsi_14"),
            col("vwap"),
            col("bb_mid"),
            col("bb_upper"),
            col("bb_lower"),
            col("event_time"),
            col("source"),
            # OHLC from producer — null when OHLC not fetched this cycle
            col("open"),
            col("high"),
            col("low"),
            col("close"),
        ).withColumn("created_at", current_timestamp())

        write_batch(out, "realtime_prices")

        # ── Alert logic ───────────────────────────────────────────────────
        alerts = _build_alert_records(batch_df)
        if alerts:
            upsert_alerts(alerts)
            _produce_alerts_to_kafka(alerts, KAFKA_TOPIC_ALERTS)
    finally:
        batch_df.unpersist()


def start_enrichment_query(watermarked_df: DataFrame) -> object:
    """
    Start Query B: per-record enrichment written to MongoDB with alert side-effect.

    Output mode: ``append`` — only new rows emitted each trigger.
    """
    query = (
        watermarked_df.writeStream.outputMode("append")
        .foreachBatch(_enrich_and_write)
        .option(
            "checkpointLocation",
            f"{CHECKPOINT_DIR}/enrichment",
        )
        .trigger(processingTime="30 seconds")
        .start()
    )
    logger.info("Query B (per-record enrichment) started — id=%s", query.id)
    return query


# ── Entry point ───────────────────────────────────────────────────────────────


def main() -> None:
    """
    Build the Spark session, start both streaming queries, and wait forever.

    Submit with:
        spark-submit \\
          --master spark://spark-master:7077 \\
          --packages org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.1 \\
          /app/src/spark/streaming_job.py
    """
    spark = build_spark()

    # ── Source stream ─────────────────────────────────────────────────────
    parsed_df = read_kafka_stream(spark)

    # ── Watermark — tolerate up to 10 min late arrivals (Section 6.3) ────
    watermarked_df = parsed_df.withWatermark("event_time", "10 minutes")

    # ── Start queries ─────────────────────────────────────────────────────
    query_a = start_window_agg_query(watermarked_df)
    query_b = start_enrichment_query(watermarked_df)

    logger.info(
        "Both streaming queries running.  Waiting for termination..."
    )
    try:
        spark.streams.awaitAnyTermination()
    except KeyboardInterrupt:
        logger.info("Shutdown requested — stopping queries.")
    finally:
        query_a.stop()
        query_b.stop()
        spark.stop()
        logger.info("SparkSession stopped.")


if __name__ == "__main__":
    main()
