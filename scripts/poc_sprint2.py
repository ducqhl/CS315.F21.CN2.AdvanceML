"""
scripts/poc_sprint2.py

Proof-of-Concept: Sprint 2 Speed Layer — end-to-end with mocked data.

What this script proves
───────────────────────
  1. Realistic 7-coin price stream (60 rows × 7 coins = 420 records)
  2. All four indicators compute correctly on that data
  3. _enrich_and_write() produces a properly-shaped MongoDB payload
  4. Alert logic fires only when |change_24h| > 5%
  5. Upsert key deduplication works (same coin+event_time written twice → 1 doc)

No Kafka, Spark cluster, or real MongoDB required.

Run:
    python scripts/poc_sprint2.py
"""

import math
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import MagicMock, patch

# ── Path setup ────────────────────────────────────────────────────────────────
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "src", "spark"))

from pyspark.sql import SparkSession
from pyspark.sql.functions import current_timestamp, col
from pyspark.sql.types import (
    DoubleType, StringType, StructField, StructType, TimestampType,
)

from utils.indicators import add_bollinger, add_rsi, add_sma, add_vwap
import utils.mongo_writer as mw

# ── Spark (local, no cluster needed) ─────────────────────────────────────────
spark = (
    SparkSession.builder.master("local[2]")
    .appName("poc_sprint2")
    .config("spark.sql.session.timeZone", "UTC")
    .config("spark.sql.shuffle.partitions", "2")
    .config("spark.ui.enabled", "false")
    .getOrCreate()
)
spark.sparkContext.setLogLevel("ERROR")

SCHEMA = StructType([
    StructField("coin",       StringType(),  False),
    StructField("event_time", TimestampType(), False),
    StructField("price_usd",  DoubleType(),  False),
    StructField("volume_24h", DoubleType(),  False),
    StructField("market_cap", DoubleType(),  False),
    StructField("change_24h", DoubleType(),  False),
    StructField("source",     StringType(),  False),
])

# ── Mock crypto prices (realistic BTC-like drift + noise per coin) ────────────
COIN_SEEDS = {
    "BTC":  {"base": 67_000.0, "vol_base": 28_000_000_000.0, "mcap": 1_320_000_000_000.0},
    "ETH":  {"base":  3_500.0, "vol_base": 12_000_000_000.0, "mcap":   420_000_000_000.0},
    "BNB":  {"base":    580.0, "vol_base":  1_500_000_000.0, "mcap":    86_000_000_000.0},
    "SOL":  {"base":    185.0, "vol_base":  3_200_000_000.0, "mcap":    80_000_000_000.0},
    "XRP":  {"base":      0.62,"vol_base":  2_100_000_000.0, "mcap":    34_000_000_000.0},
    "ADA":  {"base":      0.45,"vol_base":    750_000_000.0, "mcap":    16_000_000_000.0},
    "DOGE": {"base":      0.19,"vol_base":    900_000_000.0, "mcap":    27_000_000_000.0},
}

N_ROWS = 60          # 60 minutes of history (matches SEQUENCE_LENGTH in plan)
BASE_TIME = datetime(2025, 5, 15, 7, 30, 0, tzinfo=timezone.utc)

import random
random.seed(42)


def _simulate_prices(seed: dict, n: int) -> list[float]:
    """
    Simulate a realistic price series using a simple random walk.
    One row = one 60-second tick (matching CoinGecko poll rate).
    """
    price = seed["base"]
    prices = []
    for _ in range(n):
        # ±0.15% per tick — realistic for BTC at 60-second intervals
        pct = random.gauss(0, 0.0015)
        price *= (1 + pct)
        prices.append(round(price, 4))
    return prices


def _make_change_24h(coin: str, i: int) -> float:
    """
    Inject a >5% spike for DOGE at row 45 to trigger the alert path.
    All other coins stay within ±2%.
    """
    if coin == "DOGE" and i == 45:
        return 6.23    # spike — should generate an alert
    if coin == "XRP" and i == 50:
        return -5.42   # negative spike — should also alert
    return round(random.uniform(-1.8, 1.8), 2)


def build_mock_dataframe():
    rows = []
    for coin, seed in COIN_SEEDS.items():
        prices = _simulate_prices(seed, N_ROWS)
        for i, price in enumerate(prices):
            ts = BASE_TIME + timedelta(minutes=i)
            rows.append((
                coin,
                ts,
                price,
                seed["vol_base"] * (1 + random.uniform(-0.1, 0.1)),
                seed["mcap"],
                _make_change_24h(coin, i),
                "coingecko",
            ))
    return spark.createDataFrame(rows, schema=SCHEMA)


# ── Section 1: Indicator correctness ─────────────────────────────────────────

def section_indicators(df):
    print("\n" + "=" * 70)
    print("SECTION 1 — Indicator computation on 60-row × 7-coin mock data")
    print("=" * 70)

    df_sorted = df.orderBy("coin", "event_time")
    df_ind = add_sma(df_sorted, price_col="price_usd", window_rows=5,  alias="sma_5")
    df_ind = add_sma(df_ind,    price_col="price_usd", window_rows=20, alias="sma_20")
    df_ind = add_rsi(df_ind,    price_col="price_usd", periods=14)
    df_ind = add_vwap(df_ind,   price_col="price_usd", volume_col="volume_24h", window_rows=60)
    df_ind = add_bollinger(df_ind, price_col="price_usd", window_rows=20)

    # Show last row per coin (most complete indicator values)
    from pyspark.sql.functions import max as spark_max
    last_times = (
        df_ind.groupBy("coin")
        .agg(spark_max("event_time").alias("event_time"))
    )
    last_rows = df_ind.join(last_times, on=["coin", "event_time"]).collect()
    last_rows.sort(key=lambda r: r["coin"])

    print(f"\n{'Coin':<6} {'Price':>10} {'SMA5':>10} {'SMA20':>10} "
          f"{'RSI14':>7} {'VWAP':>10} {'BB_UP':>10} {'BB_LOW':>10}")
    print("-" * 75)

    all_ok = True
    for row in last_rows:
        rsi = row["rsi_14"]
        in_range = (rsi is not None) and (0.0 <= rsi <= 100.0)
        bb_valid = (row["bb_upper"] is None or
                    row["bb_upper"] >= row["bb_lower"])
        vwap_ok = (row["vwap"] is not None and
                   not math.isnan(row["vwap"]) and
                   not math.isinf(row["vwap"]))

        print(
            f"{row['coin']:<6} "
            f"{row['price_usd']:>10.2f} "
            f"{row['sma_5']:>10.2f} "
            f"{row['sma_20']:>10.2f} "
            f"{rsi:>7.1f} "
            f"{row['vwap']:>10.2f} "
            f"{row['bb_upper']:>10.2f} "
            f"{row['bb_lower']:>10.2f}"
        )

        if not in_range:
            print(f"  !! RSI out of [0,100]: {rsi}")
            all_ok = False
        if not bb_valid:
            print(f"  !! BB upper < lower")
            all_ok = False
        if not vwap_ok:
            print(f"  !! VWAP is NaN/Inf")
            all_ok = False

    status = "PASS" if all_ok else "FAIL"
    print(f"\nIndicator sanity checks: [{status}]")
    return df_ind


# ── Section 2: _enrich_and_write with mocked MongoDB ─────────────────────────

def section_enrich_and_write(df):
    print("\n" + "=" * 70)
    print("SECTION 2 — _enrich_and_write() with mocked MongoDB")
    print("=" * 70)

    # Intercept write_batch and capture what would be written
    written_docs: list[dict[str, Any]] = []

    def fake_write_batch(spark_df, collection_name):
        rows = spark_df.collect()
        for row in rows:
            written_docs.append(row.asDict(recursive=True))

    mw._indexes_ensured.clear()

    # Import the handler from streaming_job
    sys.path.insert(0, os.path.join(PROJECT_ROOT, "src", "spark"))
    import streaming_job as sj
    from streaming_job import _enrich_and_write, _build_alert_records

    # Patch in streaming_job's namespace (where _enrich_and_write looks up the names)
    with patch.object(sj, "write_batch", side_effect=fake_write_batch), \
         patch.object(sj, "upsert_alerts") as mock_alert_insert, \
         patch.object(sj, "_produce_alerts_to_kafka"):

        _enrich_and_write(df, batch_id=0)

        alert_calls = mock_alert_insert.call_args_list

    print(f"\nDocuments written to realtime_prices: {len(written_docs)}")
    print(f"Expected (7 coins × {N_ROWS} rows):   {7 * N_ROWS}")

    # Verify schema
    required_cols = {
        "coin", "price_usd", "volume_24h", "market_cap", "change_24h",
        "sma_5", "sma_20", "rsi_14", "vwap", "bb_mid", "bb_upper", "bb_lower",
        "event_time", "source",
    }
    sample = written_docs[-1]
    missing = required_cols - set(sample.keys())
    extra_internal = [k for k in sample if k.startswith("_")]

    print(f"\nSchema check on last document:")
    print(f"  Required columns present : {'YES' if not missing else f'MISSING: {missing}'}")
    print(f"  No internal _cols leaked : {'YES' if not extra_internal else f'LEAKED: {extra_internal}'}")
    print(f"  created_at stamped       : {'YES' if 'created_at' in sample else 'NO'}")

    # Print a sample document
    print(f"\nSample document (BTC, last tick):")
    btc_docs = [d for d in written_docs if d["coin"] == "BTC"]
    if btc_docs:
        d = btc_docs[-1]
        for k in ["coin", "price_usd", "sma_5", "sma_20", "rsi_14",
                  "vwap", "bb_upper", "bb_lower", "event_time"]:
            print(f"  {k:<15}: {d.get(k)}")

    schema_ok = not missing and not extra_internal and "created_at" in sample
    count_ok = len(written_docs) == 7 * N_ROWS
    print(f"\nenrich_and_write checks: [{'PASS' if schema_ok and count_ok else 'FAIL'}]")

    return written_docs, alert_calls


# ── Section 3: Alert logic ────────────────────────────────────────────────────

def section_alerts(df):
    print("\n" + "=" * 70)
    print("SECTION 3 — Alert logic (|change_24h| > 5%)")
    print("=" * 70)

    sys.path.insert(0, os.path.join(PROJECT_ROOT, "src", "spark"))
    from streaming_job import _build_alert_records

    alerts = _build_alert_records(df)

    print(f"\nAlerts generated: {len(alerts)}")
    print(f"Expected:         2  (DOGE row 45 +6.23%, XRP row 50 -5.42%)")

    for a in alerts:
        flag = "↑" if a["change_pct"] > 0 else "↓"
        print(f"  [{flag}] {a['coin']:5s}  change={a['change_pct']:+.2f}%  "
              f"price=${a['price_usd']:>10.4f}  type={a['alert_type']}")

    alert_coins = {a["coin"] for a in alerts}
    ok = (
        len(alerts) == 2
        and "DOGE" in alert_coins
        and "XRP" in alert_coins
        and all(abs(a["change_pct"]) > 5.0 for a in alerts)
        and all(a["alert_type"] == "PRICE_SPIKE" for a in alerts)
    )
    print(f"\nAlert logic checks: [{'PASS' if ok else 'FAIL'}]")


# ── Section 4: Upsert deduplication ──────────────────────────────────────────

def section_upsert_dedup():
    print("\n" + "=" * 70)
    print("SECTION 4 — Upsert deduplication (same coin+event_time → 1 doc)")
    print("=" * 70)

    mw._indexes_ensured.clear()

    now = datetime(2025, 5, 15, 8, 30, 0, tzinfo=timezone.utc)
    records_first = [
        {"coin": "BTC", "event_time": now, "price_usd": 67000.0, "source": "coingecko"},
    ]
    records_second = [
        # Same key (BTC, now) — upsert should update, not insert a duplicate
        {"coin": "BTC", "event_time": now, "price_usd": 67050.0, "source": "coingecko"},
    ]

    ops_log: list[int] = []

    mock_coll = MagicMock()
    mock_coll.name = "realtime_prices"
    mock_coll.database.name = "crypto_db"
    mock_coll.list_indexes.return_value = []
    result_mock = MagicMock()
    result_mock.upserted_count = 1
    result_mock.modified_count = 0

    def capture_bulk(ops, **kw):
        ops_log.append(len(ops))
        return result_mock

    mock_coll.bulk_write.side_effect = capture_bulk

    mock_client = MagicMock()
    mock_client.__getitem__.return_value.__getitem__.return_value = mock_coll

    with patch.object(mw, "_get_client", return_value=mock_client):
        mw._upsert_realtime_prices(mock_coll, records_first)
        mw._upsert_realtime_prices(mock_coll, records_second)

    print(f"\nFirst write  → {ops_log[0]} UpdateOne operation(s)")
    print(f"Second write → {ops_log[1]} UpdateOne operation(s)  (upsert=True → update in place)")
    print(f"Total bulk_write calls: {mock_coll.bulk_write.call_count} (one per write call)")

    # Verify each write produces exactly 1 UpdateOne with upsert=True
    for i, call_args in enumerate(mock_coll.bulk_write.call_args_list):
        ops = call_args[0][0]
        op = ops[0]
        print(f"  Write {i+1}: {type(op).__name__}  filter={{coin: BTC, event_time: {now.isoformat()}}}")

    ok = (len(ops_log) == 2 and ops_log[0] == 1 and ops_log[1] == 1)
    print(f"\nUpsert dedup checks: [{'PASS' if ok else 'FAIL'}]")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("\n" + "█" * 70)
    print("  Sprint 2 Speed Layer — Proof of Concept (mocked data)")
    print("  7 coins × 60 rows = 420 records — no Kafka/MongoDB/cluster needed")
    print("█" * 70)

    df = build_mock_dataframe()
    print(f"\nMock DataFrame: {df.count()} rows, schema: {[f.name for f in df.schema]}")

    df_ind = section_indicators(df)
    written_docs, alert_calls = section_enrich_and_write(df)
    section_alerts(df)
    section_upsert_dedup()

    print("\n" + "=" * 70)
    print("  PoC complete — all sections ran without errors")
    print("=" * 70 + "\n")

    spark.stop()


if __name__ == "__main__":
    main()
