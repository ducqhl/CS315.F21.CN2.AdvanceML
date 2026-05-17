"""
tests/test_mongo_writer.py

Unit tests for src/spark/utils/mongo_writer.py.

All MongoDB and Spark interactions are mocked — no running MongoDB or Spark
cluster is required.

Run with:
    pytest tests/test_mongo_writer.py -v
"""

import os
import sys
from datetime import datetime, timezone
from unittest.mock import MagicMock, call, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src/spark"))

import utils.mongo_writer as mw


# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_mock_collection(name: str = "realtime_prices") -> MagicMock:
    """Return a mock Collection with list_indexes returning no existing indexes."""
    coll = MagicMock()
    coll.name = name
    coll.database.name = "crypto_db"
    coll.list_indexes.return_value = []  # no existing indexes → will create
    bulk_result = MagicMock()
    bulk_result.upserted_count = 1
    bulk_result.modified_count = 0
    coll.bulk_write.return_value = bulk_result
    return coll


def _make_spark_row(coin: str = "BTC", price: float = 67000.0) -> MagicMock:
    """Return a mock Spark Row with asDict() behavior."""
    row = MagicMock()
    row.asDict.return_value = {
        "coin": coin,
        "price_usd": price,
        "volume_24h": 1_000_000.0,
        "market_cap": 1_300_000_000_000.0,
        "change_24h": 2.5,
        "sma_5": price * 0.999,
        "sma_20": price * 0.995,
        "rsi_14": 55.0,
        "vwap": price * 0.998,
        "bb_mid": price,
        "bb_upper": price * 1.02,
        "bb_lower": price * 0.98,
        "event_time": datetime(2025, 5, 15, 8, 30, 0, tzinfo=timezone.utc),
        "source": "coingecko",
    }
    return row


def _make_mock_df(rows: list) -> MagicMock:
    """Return a mock Spark DataFrame whose collect() returns *rows*."""
    df = MagicMock()
    df.collect.return_value = rows
    rdd = MagicMock()
    rdd.isEmpty.return_value = len(rows) == 0
    df.rdd = rdd
    return df


# ── _ensure_realtime_indexes tests ────────────────────────────────────────────


class TestEnsureRealtimeIndexes:
    def setup_method(self):
        # Clear the module-level cache before each test
        mw._indexes_ensured.clear()

    def test_creates_compound_index_when_missing(self):
        coll = _make_mock_collection()
        mw._ensure_realtime_indexes(coll)
        # Should create 2 indexes: compound + TTL
        assert coll.create_index.call_count == 2

    def test_skips_existing_compound_index(self):
        coll = _make_mock_collection()
        # Simulate compound index already present
        coll.list_indexes.return_value = [
            {"name": "coin_event_time"},
        ]
        mw._ensure_realtime_indexes(coll)
        # Only TTL index should be created
        created_names = [
            c.kwargs.get("name") or c.args[1]
            for c in coll.create_index.call_args_list
        ]
        assert "coin_event_time" not in created_names

    def test_skips_existing_ttl_index(self):
        coll = _make_mock_collection()
        coll.list_indexes.return_value = [
            {"name": "event_time_ttl"},
        ]
        mw._ensure_realtime_indexes(coll)
        created_names = [
            c.kwargs.get("name") for c in coll.create_index.call_args_list
        ]
        assert "event_time_ttl" not in created_names

    def test_idempotent_second_call_skips_all(self):
        coll = _make_mock_collection()
        mw._ensure_realtime_indexes(coll)
        mw._ensure_realtime_indexes(coll)  # second call must be a no-op
        # list_indexes only called once (first call); second is short-circuited
        assert coll.list_indexes.call_count == 1

    def test_ttl_expire_seconds_is_seven_days(self):
        coll = _make_mock_collection()
        mw._ensure_realtime_indexes(coll)
        ttl_calls = [
            c
            for c in coll.create_index.call_args_list
            if c.kwargs.get("name") == "event_time_ttl"
        ]
        assert len(ttl_calls) == 1
        assert ttl_calls[0].kwargs["expireAfterSeconds"] == 604800


# ── write_batch tests ─────────────────────────────────────────────────────────


class TestWriteBatch:
    def setup_method(self):
        mw._indexes_ensured.clear()

    def test_empty_df_does_not_call_mongo(self):
        df = _make_mock_df([])
        mock_client = MagicMock()
        with patch.object(mw, "_get_client", return_value=mock_client):
            mw.write_batch(df, "realtime_prices")
        mock_client.__getitem__.assert_not_called()

    def test_realtime_prices_uses_bulk_write_upsert(self):
        rows = [_make_spark_row("BTC"), _make_spark_row("ETH", price=3500.0)]
        df = _make_mock_df(rows)

        mock_client = MagicMock()
        mock_coll = _make_mock_collection("realtime_prices")
        mock_client.__getitem__.return_value.__getitem__.return_value = mock_coll

        with patch.object(mw, "_get_client", return_value=mock_client):
            mw.write_batch(df, "realtime_prices")

        mock_coll.bulk_write.assert_called_once()
        ops = mock_coll.bulk_write.call_args[0][0]
        assert len(ops) == 2

    def test_non_realtime_collection_uses_insert_many(self):
        rows = [_make_spark_row("BTC")]
        df = _make_mock_df(rows)

        mock_client = MagicMock()
        mock_coll = MagicMock()
        mock_coll.name = "daily_stats"
        mock_coll.database.name = "crypto_db"
        mock_client.__getitem__.return_value.__getitem__.return_value = mock_coll

        with patch.object(mw, "_get_client", return_value=mock_client):
            mw.write_batch(df, "daily_stats")

        mock_coll.insert_many.assert_called_once()
        mock_coll.bulk_write.assert_not_called()

    def test_client_closed_after_write(self):
        rows = [_make_spark_row("BTC")]
        df = _make_mock_df(rows)

        mock_client = MagicMock()
        mock_coll = _make_mock_collection("realtime_prices")
        mock_client.__getitem__.return_value.__getitem__.return_value = mock_coll

        with patch.object(mw, "_get_client", return_value=mock_client):
            mw.write_batch(df, "realtime_prices")

        mock_client.close.assert_called_once()

    def test_client_closed_even_on_exception(self):
        rows = [_make_spark_row("BTC")]
        df = _make_mock_df(rows)

        mock_client = MagicMock()
        mock_coll = _make_mock_collection("realtime_prices")
        mock_coll.bulk_write.side_effect = RuntimeError("simulated mongo error")
        mock_client.__getitem__.return_value.__getitem__.return_value = mock_coll

        with patch.object(mw, "_get_client", return_value=mock_client):
            with pytest.raises(RuntimeError):
                mw.write_batch(df, "realtime_prices")

        mock_client.close.assert_called_once()

    def test_created_at_stamped_on_records(self):
        rows = [_make_spark_row("BTC")]
        df = _make_mock_df(rows)

        captured_records: list = []

        mock_client = MagicMock()
        mock_coll = _make_mock_collection("realtime_prices")

        def capture_bulk_write(ops, **kwargs):
            for op in ops:
                captured_records.append(op._doc["$set"])
            result = MagicMock()
            result.upserted_count = 1
            result.modified_count = 0
            return result

        mock_coll.bulk_write.side_effect = capture_bulk_write
        mock_client.__getitem__.return_value.__getitem__.return_value = mock_coll

        with patch.object(mw, "_get_client", return_value=mock_client):
            mw.write_batch(df, "realtime_prices")

        assert len(captured_records) == 1
        assert "created_at" in captured_records[0]


# ── upsert_alerts tests ────────────────────────────────────────────────────────


class TestUpsertAlerts:
    def test_empty_list_does_nothing(self):
        mock_client = MagicMock()
        with patch.object(mw, "_get_client", return_value=mock_client):
            mw.upsert_alerts([])
        mock_client.__getitem__.assert_not_called()

    def test_inserts_all_alert_records(self):
        alerts = [
            {"coin": "BTC", "alert_type": "PRICE_SPIKE", "change_pct": 6.5, "price_usd": 70000.0, "timestamp": datetime.now(timezone.utc)},
            {"coin": "ETH", "alert_type": "PRICE_SPIKE", "change_pct": -5.8, "price_usd": 3200.0, "timestamp": datetime.now(timezone.utc)},
        ]
        mock_client = MagicMock()
        mock_coll = MagicMock()
        mock_client.__getitem__.return_value.__getitem__.return_value = mock_coll

        with patch.object(mw, "_get_client", return_value=mock_client):
            mw.upsert_alerts(alerts)

        mock_coll.insert_many.assert_called_once()
        inserted = mock_coll.insert_many.call_args[0][0]
        assert len(inserted) == 2

    def test_client_closed_after_alert_write(self):
        alerts = [
            {"coin": "BTC", "alert_type": "PRICE_SPIKE", "change_pct": 7.0, "price_usd": 75000.0, "timestamp": datetime.now(timezone.utc)},
        ]
        mock_client = MagicMock()
        mock_coll = MagicMock()
        mock_client.__getitem__.return_value.__getitem__.return_value = mock_coll

        with patch.object(mw, "_get_client", return_value=mock_client):
            mw.upsert_alerts(alerts)

        mock_client.close.assert_called_once()

    def test_created_at_stamped_on_alerts(self):
        alerts = [
            {"coin": "SOL", "alert_type": "PRICE_SPIKE", "change_pct": 8.0, "price_usd": 200.0, "timestamp": datetime.now(timezone.utc)},
        ]
        mock_client = MagicMock()
        mock_coll = MagicMock()
        mock_client.__getitem__.return_value.__getitem__.return_value = mock_coll

        captured: list = []

        def capture_insert(docs, **kwargs):
            captured.extend(docs)

        mock_coll.insert_many.side_effect = capture_insert

        with patch.object(mw, "_get_client", return_value=mock_client):
            mw.upsert_alerts(alerts)

        assert len(captured) == 1
        assert "created_at" in captured[0]


# ── _upsert_realtime_prices tests ──────────────────────────────────────────────


class TestUpsertRealtimePrices:
    def test_skips_records_without_coin(self):
        coll = _make_mock_collection()
        records = [
            {"coin": None, "event_time": datetime.now(timezone.utc), "price_usd": 1.0},
            {"coin": "BTC", "event_time": datetime.now(timezone.utc), "price_usd": 60000.0},
        ]
        mw._upsert_realtime_prices(coll, records)
        ops = coll.bulk_write.call_args[0][0]
        # Only 1 valid record (BTC), None coin is skipped
        assert len(ops) == 1

    def test_skips_records_without_event_time(self):
        coll = _make_mock_collection()
        records = [
            {"coin": "BTC", "event_time": None, "price_usd": 60000.0},
            {"coin": "ETH", "event_time": datetime.now(timezone.utc), "price_usd": 3000.0},
        ]
        mw._upsert_realtime_prices(coll, records)
        ops = coll.bulk_write.call_args[0][0]
        assert len(ops) == 1
