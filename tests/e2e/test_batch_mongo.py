"""
tests/e2e/test_batch_mongo.py
E2E Layer 2 — Spark Batch → MongoDB

What this tests:
  - batch_job.run() reads data/sample/{bitcoin,dogecoin}.csv with local Spark
  - Writes daily_stats, historical_sma, coin_correlation to a real MongoDB container
  - daily_stats  : correct columns, only BTC + DOGE symbols, positive row counts
  - historical_sma: SMA columns (sma_20, sma_50, sma_200) present
  - coin_correlation: exactly 1 pair (BTC–DOGE), Pearson value in [-1, 1]

Spark runs in local mode (no cluster needed).
MongoDB is a real container (testcontainers).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.e2e

_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_ROOT / "src" / "spark"))


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def patched_mongo_writer(mongo_uri):
    """Patch mongo_writer module-level MONGO_URI to point at the test container."""
    from utils import mongo_writer
    original_uri = mongo_writer.MONGO_URI
    original_db = mongo_writer.MONGO_DB
    # Reset the indexes-ensured set so each module run starts clean
    mongo_writer._indexes_ensured.clear()

    mongo_writer.MONGO_URI = mongo_uri
    mongo_writer.MONGO_DB = "e2e_test_db"
    yield mongo_writer

    mongo_writer.MONGO_URI = original_uri
    mongo_writer.MONGO_DB = original_db
    mongo_writer._indexes_ensured.clear()


@pytest.fixture(scope="module")
def batch_results(patched_mongo_writer, mongo_db):
    """
    Run the full Spark batch pipeline once per module and return the row counts.
    Expensive (Spark start-up), so scoped to module.
    """
    import batch_job

    data_path = str(_ROOT / "data" / "sample" / "*.csv")
    counts = batch_job.run(data_path=data_path)
    return counts


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestDailyStats:

    def test_daily_stats_row_count_positive(self, batch_results):
        """daily_stats must have at least 1 row."""
        assert batch_results["daily_stats"] > 0, (
            f"daily_stats is empty: {batch_results}"
        )

    def test_daily_stats_only_btc_and_doge(self, mongo_db):
        """Only BTC and DOGE symbols must appear in daily_stats."""
        symbols = mongo_db["daily_stats"].distinct("symbol")
        assert set(symbols) == {"BTC", "DOGE"}, (
            f"Unexpected symbols in daily_stats: {set(symbols)}"
        )

    def test_daily_stats_required_columns(self, mongo_db):
        """Each daily_stats document must have all required columns."""
        doc = mongo_db["daily_stats"].find_one()
        assert doc is not None, "daily_stats collection is empty"
        required = {
            "symbol", "date", "avg_close", "daily_high", "daily_low",
            "avg_volume", "total_volume", "trade_count",
        }
        missing = required - set(doc.keys())
        assert not missing, f"daily_stats missing columns: {missing}"

    def test_daily_stats_prices_are_positive(self, mongo_db):
        """avg_close must be > 0 for all documents."""
        bad = list(mongo_db["daily_stats"].find({"avg_close": {"$lte": 0}}, limit=5))
        assert not bad, f"Found non-positive avg_close in daily_stats: {bad}"


class TestHistoricalSma:

    def test_historical_sma_row_count_matches_daily_stats(self, batch_results):
        """historical_sma must have same row count as daily_stats."""
        assert batch_results["historical_sma"] == batch_results["daily_stats"], (
            f"historical_sma rows ({batch_results['historical_sma']}) != "
            f"daily_stats rows ({batch_results['daily_stats']})"
        )

    def test_historical_sma_has_sma_columns(self, mongo_db):
        """Documents must have sma_20, sma_50, sma_200 fields."""
        # Find a document deep enough that SMA_200 is meaningful
        doc = mongo_db["historical_sma"].find_one({"sma_200": {"$ne": None}})
        if doc is None:
            # Might not have 200 rows — just check the fields exist at all
            doc = mongo_db["historical_sma"].find_one()
        assert doc is not None

        for col in ["sma_20", "sma_50", "sma_200"]:
            assert col in doc, f"historical_sma missing column: {col}"

    def test_historical_sma_only_btc_and_doge(self, mongo_db):
        """Only BTC and DOGE must appear in historical_sma."""
        symbols = mongo_db["historical_sma"].distinct("symbol")
        assert set(symbols) == {"BTC", "DOGE"}, (
            f"Unexpected symbols in historical_sma: {set(symbols)}"
        )


class TestCoinCorrelation:

    def test_exactly_one_pair_btc_doge(self, mongo_db):
        """With 2 coins, C(2,2)=1 → coin_correlation must have exactly 1 document."""
        count = mongo_db["coin_correlation"].count_documents({})
        assert count == 1, (
            f"Expected 1 correlation pair (BTC-DOGE), got {count}"
        )

    def test_pair_is_btc_doge(self, mongo_db):
        """The single correlation pair must be BTC ↔ DOGE."""
        doc = mongo_db["coin_correlation"].find_one()
        assert doc is not None
        pair = frozenset([doc["coin_a"], doc["coin_b"]])
        assert pair == frozenset(["BTC", "DOGE"]), (
            f"Expected BTC-DOGE pair, got {pair}"
        )

    def test_pearson_value_in_range(self, mongo_db):
        """Pearson correlation must be in [-1, 1]."""
        doc = mongo_db["coin_correlation"].find_one()
        assert doc is not None
        if doc["pearson_corr"] is not None:
            assert -1.0 <= doc["pearson_corr"] <= 1.0, (
                f"Pearson value out of range: {doc['pearson_corr']}"
            )

    def test_no_ethereum_in_correlation(self, mongo_db):
        """ETH must not appear in correlation results (removed from scope)."""
        eth_docs = list(mongo_db["coin_correlation"].find(
            {"$or": [{"coin_a": "ETH"}, {"coin_b": "ETH"}]}
        ))
        assert not eth_docs, f"ETH found in coin_correlation: {eth_docs}"
