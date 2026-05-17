"""
scripts/poc_sprint3.py

Sprint 3 — Proof-of-Concept Verification Script
================================================
Runs the batch job end-to-end using the sample CSVs, mocks all MongoDB writes,
and prints/asserts correctness of the three batch views.

What this script proves
───────────────────────
  1. daily_stats    — correct row count, expected symbol set, numeric sanity
  2. historical_sma — SMA_20 at row index 19 (the 20th row for a symbol) equals
                      the arithmetic mean of the first 20 avg_close values for
                      that symbol (verifies rowsBetween window logic)
  3. coin_correlation — all unique pairs present, correlation values in [-1, 1]

Usage
─────
  python scripts/poc_sprint3.py

No running MongoDB or Kafka instance is required — write_batch is mocked.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import patch, MagicMock

# ── Path bootstrap ────────────────────────────────────────────────────────────
# Ensure src/spark is importable so that batch_job can import utils.*
_REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
_SPARK_SRC = os.path.join(_REPO_ROOT, "src", "spark")
for _p in (_REPO_ROOT, _SPARK_SRC):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# ── Import after path setup ───────────────────────────────────────────────────
# batch_job lives in src/spark/ which is already on sys.path above.
import batch_job  # noqa: E402  (import after sys.path mutation)

# ── Helpers ───────────────────────────────────────────────────────────────────

SEPARATOR = "=" * 72
SAMPLE_DIR = os.path.join(_REPO_ROOT, "data", "sample", "*.csv")


def _hr(title: str) -> None:
    print(f"\n{SEPARATOR}")
    print(f"  {title}")
    print(SEPARATOR)


def _assert(condition: bool, message: str) -> None:
    if not condition:
        print(f"  [FAIL] {message}")
        sys.exit(1)
    print(f"  [PASS] {message}")


# ── Main verification ─────────────────────────────────────────────────────────


def main() -> None:
    print("\nSprint 3 — Batch Layer PoC Verification")
    print("Mocking MongoDB writes; reading from:", SAMPLE_DIR)

    # ------------------------------------------------------------------
    # We intercept write_batch at the module level inside batch_job so
    # that no real MongoDB connection is attempted.
    # ------------------------------------------------------------------
    written: dict[str, list] = {}

    def fake_write_batch(df, collection_name: str) -> None:  # noqa: ANN001
        """Capture the DataFrame instead of writing to MongoDB."""
        rows = df.collect()
        written[collection_name] = rows
        print(f"  [MOCK] write_batch({collection_name!r}) — {len(rows)} rows captured")

    with patch.object(batch_job, "write_batch", side_effect=fake_write_batch):
        spark = batch_job.build_spark("poc_sprint3")

        # Load CSVs
        raw_df = batch_job.load_sample_csvs(spark, SAMPLE_DIR)
        raw_df.cache()

        # Compute views
        daily_stats = batch_job.compute_daily_stats(raw_df)
        daily_stats.cache()

        historical_sma = batch_job.compute_historical_sma(daily_stats)
        coin_correlation = batch_job.compute_coin_correlation(daily_stats)

        # Persist (mocked)
        batch_job.persist_batch_views(daily_stats, historical_sma, coin_correlation)

        # ── Section 1: daily_stats ─────────────────────────────────────
        _hr("1. daily_stats")

        ds_rows = written.get("daily_stats", [])
        print(f"  Row count : {len(ds_rows)}")

        symbols_found = {r["symbol"] for r in ds_rows}
        print(f"  Symbols   : {sorted(symbols_found)}")

        # Sample records
        print("\n  Sample records (first 3):")
        for r in ds_rows[:3]:
            print(f"    {r['symbol']} | {r['date']} | close={r['avg_close']:.2f}"
                  f" | vol={r['total_volume']:.0f}")

        # Assertions
        _assert(len(ds_rows) > 0, "daily_stats is non-empty")
        _assert({"BTC", "ETH", "DOGE"} == symbols_found,
                "daily_stats contains exactly BTC, ETH, DOGE")
        _assert(
            all(r["daily_high"] >= r["daily_low"] for r in ds_rows),
            "daily_high >= daily_low for every row",
        )
        _assert(
            all(r["avg_close"] is not None and r["avg_close"] > 0 for r in ds_rows),
            "avg_close is positive for every row",
        )

        # ── Section 2: historical_sma ──────────────────────────────────
        _hr("2. historical_sma — SMA correctness check")

        sma_rows = written.get("historical_sma", [])
        print(f"  Row count : {len(sma_rows)}")

        # Filter BTC rows, sort by date ascending
        btc_rows = sorted(
            [r for r in sma_rows if r["symbol"] == "BTC"],
            key=lambda r: r["date"],
        )
        print(f"  BTC row count: {len(btc_rows)}")

        # SMA_20 check: at index 19 (the 20th BTC row), SMA_20 must equal
        # the mean of the first 20 avg_close values.
        if len(btc_rows) >= 20:
            first_20_closes = [r["avg_close"] for r in btc_rows[:20]]
            expected_sma20 = sum(first_20_closes) / 20
            actual_sma20 = btc_rows[19]["sma_20"]
            diff = abs(actual_sma20 - expected_sma20)

            print(f"\n  BTC SMA_20 at row 20 (index 19):")
            print(f"    Expected (mean of first 20 closes) : {expected_sma20:.6f}")
            print(f"    Actual (from Spark window)         : {actual_sma20:.6f}")
            print(f"    Absolute difference                : {diff:.8f}")

            _assert(diff < 1e-4, f"SMA_20 at row 20 matches expected (diff={diff:.2e})")
        else:
            print(f"  [SKIP] BTC has only {len(btc_rows)} rows — need >= 20 for SMA_20 check")

        # Sample SMA records
        print("\n  Sample SMA records (BTC, first 3 with sma_20 defined):")
        shown = 0
        for r in btc_rows:
            sma20_val = r["sma_20"]
            if sma20_val is not None and shown < 3:
                sma50_str = f"{r['sma_50']:.2f}" if r["sma_50"] is not None else "N/A"
                sma200_str = f"{r['sma_200']:.2f}" if r["sma_200"] is not None else "N/A"
                print(f"    {r['date']} | close={r['avg_close']:.2f}"
                      f" | sma_20={sma20_val:.2f}"
                      f" | sma_50={sma50_str}"
                      f" | sma_200={sma200_str}")
                shown += 1

        _assert(len(sma_rows) == len(ds_rows),
                "historical_sma has same row count as daily_stats")
        _assert(
            all("sma_20" in r.asDict() for r in sma_rows),
            "sma_20 column present on every historical_sma row",
        )

        # ── Section 3: coin_correlation ────────────────────────────────
        _hr("3. coin_correlation")

        corr_rows = written.get("coin_correlation", [])
        print(f"  Row count : {len(corr_rows)}")

        print("\n  Correlation matrix (all pairs):")
        for r in sorted(corr_rows, key=lambda x: (x["coin_a"], x["coin_b"])):
            val = r["pearson_corr"]
            val_str = f"{val:.4f}" if val is not None else "None"
            print(f"    {r['coin_a']} x {r['coin_b']} = {val_str}"
                  f"  (computed_at={r['computed_at']})")

        # With 3 symbols there are C(3,2) = 3 unique pairs
        expected_pairs = 3
        _assert(
            len(corr_rows) == expected_pairs,
            f"coin_correlation has {expected_pairs} rows (one per unique pair)",
        )
        _assert(
            all(
                r["pearson_corr"] is None or -1.0 <= r["pearson_corr"] <= 1.0
                for r in corr_rows
            ),
            "all Pearson correlation values in [-1, 1]",
        )

        btc_eth = next(
            (r for r in corr_rows if {r["coin_a"], r["coin_b"]} == {"BTC", "ETH"}),
            None,
        )
        if btc_eth and btc_eth["pearson_corr"] is not None:
            _assert(
                btc_eth["pearson_corr"] > 0,
                f"BTC-ETH correlation is positive ({btc_eth['pearson_corr']:.4f})"
                " — historically expected",
            )

        # ── Final summary ──────────────────────────────────────────────
        _hr("Summary")
        print(f"  daily_stats    : {len(written.get('daily_stats', []))} rows")
        print(f"  historical_sma : {len(written.get('historical_sma', []))} rows")
        print(f"  coin_correlation: {len(written.get('coin_correlation', []))} rows")
        print("\n  All assertions passed. Sprint 3 Batch Layer is verified.")

        raw_df.unpersist()
        daily_stats.unpersist()
        spark.stop()


if __name__ == "__main__":
    main()
