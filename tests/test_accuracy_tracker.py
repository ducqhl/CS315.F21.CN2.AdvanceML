"""
tests/test_accuracy_tracker.py — Unit tests for the accuracy_tracker module.

All MongoDB calls are mocked. No live MongoDB connection is required.
No CoinGecko or external HTTP calls are made.
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch, call

import pytest

sys.path.insert(0, "src/ml")

from accuracy_tracker import (
    compute_accuracy_metrics,
    evaluate_yesterday,
    get_accuracy_history,
    get_actual_price,
    get_prediction_for_date,
    _COLLECTION,
)


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest.fixture
def mock_mongo():
    """Return a MagicMock that behaves like a pymongo.MongoClient context."""
    import accuracy_tracker as _at
    mock_pymongo_module = MagicMock()
    mock_client = MagicMock()
    mock_db = MagicMock()
    mock_pymongo_module.MongoClient.return_value = mock_client
    mock_client.__getitem__.return_value = mock_db
    # Patch the module-level pymongo name inside accuracy_tracker
    original = _at.pymongo
    _at.pymongo = mock_pymongo_module
    try:
        yield mock_pymongo_module, mock_client, mock_db
    finally:
        _at.pymongo = original


@pytest.fixture
def yesterday_midnight():
    now = datetime.now(timezone.utc)
    return (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)


# ── compute_accuracy_metrics ───────────────────────────────────────────────────

class TestComputeAccuracyMetrics:
    def test_mae_and_mape_computed_correctly(self):
        metrics = compute_accuracy_metrics(
            predicted_price=105.0,
            actual_price=100.0,
            predicted_direction="UP",
            prev_actual_price=99.0,
        )
        assert metrics["mae"] == pytest.approx(5.0, rel=1e-6)
        assert metrics["mape"] == pytest.approx(5.0, rel=1e-6)  # 5/100 * 100

    def test_direction_correct_when_both_up(self):
        metrics = compute_accuracy_metrics(
            predicted_price=110.0,
            actual_price=105.0,
            predicted_direction="UP",
            prev_actual_price=100.0,  # actual went UP (105 > 100)
        )
        assert metrics["direction_actual"] == "UP"
        assert metrics["direction_correct"] is True

    def test_direction_wrong_when_predicted_up_actual_down(self):
        metrics = compute_accuracy_metrics(
            predicted_price=110.0,
            actual_price=95.0,
            predicted_direction="UP",
            prev_actual_price=100.0,  # actual went DOWN (95 < 100)
        )
        assert metrics["direction_actual"] == "DOWN"
        assert metrics["direction_correct"] is False

    def test_flat_predicted_direction_is_wrong_for_directional_accuracy(self):
        """FLAT direction counts as wrong vs UP/DOWN actual."""
        metrics = compute_accuracy_metrics(
            predicted_price=100.0,
            actual_price=101.0,
            predicted_direction="FLAT",
            prev_actual_price=100.0,  # actual UP
        )
        assert metrics["direction_actual"] == "UP"
        assert metrics["direction_correct"] is False

    def test_none_prev_price_gives_none_direction_actual(self):
        metrics = compute_accuracy_metrics(
            predicted_price=100.0,
            actual_price=105.0,
            predicted_direction="UP",
            prev_actual_price=None,
        )
        assert metrics["direction_actual"] is None
        assert metrics["direction_correct"] is None

    def test_none_predicted_direction_gives_none_direction_correct(self):
        metrics = compute_accuracy_metrics(
            predicted_price=100.0,
            actual_price=105.0,
            predicted_direction=None,
            prev_actual_price=100.0,
        )
        assert metrics["direction_actual"] == "UP"
        assert metrics["direction_correct"] is None

    def test_mape_none_when_actual_price_zero(self):
        metrics = compute_accuracy_metrics(
            predicted_price=100.0,
            actual_price=0.0,
            predicted_direction=None,
            prev_actual_price=None,
        )
        assert metrics["mape"] is None

    def test_mae_is_absolute_value(self):
        """MAE should be positive even when predicted < actual."""
        metrics = compute_accuracy_metrics(
            predicted_price=90.0,
            actual_price=100.0,
            predicted_direction=None,
            prev_actual_price=None,
        )
        assert metrics["mae"] == pytest.approx(10.0)


# ── get_actual_price ───────────────────────────────────────────────────────────

class TestGetActualPrice:
    def test_returns_average_from_live_prices(self, mock_mongo):
        _, mock_client, mock_db = mock_mongo
        mock_db.live_prices.find.return_value = [
            {"price_usd": 100.0},
            {"price_usd": 102.0},
        ]
        date = datetime(2026, 5, 26, 12, 0, tzinfo=timezone.utc)
        result = get_actual_price("BTC", date, mongo_uri="mongodb://fake:27017")
        # Average of 100 + 102 = 101
        assert result == pytest.approx(101.0)

    def test_falls_back_to_historical_sma_when_live_prices_empty(self, mock_mongo):
        _, mock_client, mock_db = mock_mongo
        mock_db.live_prices.find.return_value = []  # empty live_prices
        mock_db.historical_sma.find_one.return_value = {"avg_close": 55000.0}

        date = datetime(2026, 5, 26, 0, 0, tzinfo=timezone.utc)
        result = get_actual_price("BTC", date, mongo_uri="mongodb://fake:27017")
        assert result == pytest.approx(55000.0)

    def test_returns_none_when_both_sources_empty(self, mock_mongo):
        _, mock_client, mock_db = mock_mongo
        mock_db.live_prices.find.return_value = []
        mock_db.historical_sma.find_one.return_value = None

        date = datetime(2026, 5, 26, 0, 0, tzinfo=timezone.utc)
        result = get_actual_price("BTC", date, mongo_uri="mongodb://fake:27017")
        assert result is None

    def test_returns_none_on_connection_error(self):
        import accuracy_tracker as _at
        orig = _at.pymongo
        mock_pym = MagicMock()
        mock_pym.MongoClient.side_effect = Exception("connection refused")
        _at.pymongo = mock_pym
        try:
            result = get_actual_price("BTC", datetime.now(timezone.utc), mongo_uri="mongodb://fake:27017")
        finally:
            _at.pymongo = orig
        assert result is None

    def test_skips_zero_price_from_live_prices(self, mock_mongo):
        """live_prices docs with price_usd=0 should not pollute the average."""
        _, mock_client, mock_db = mock_mongo
        # The find query already filters price_usd > 0 at the MongoDB level;
        # simulate that only valid docs are returned.
        mock_db.live_prices.find.return_value = [{"price_usd": 65000.0}]
        date = datetime(2026, 5, 26, 0, 0, tzinfo=timezone.utc)
        result = get_actual_price("BTC", date, mongo_uri="mongodb://fake:27017")
        assert result == pytest.approx(65000.0)


# ── get_prediction_for_date ────────────────────────────────────────────────────

class TestGetPredictionForDate:
    def test_returns_most_recent_run_doc(self, mock_mongo):
        _, mock_client, mock_db = mock_mongo
        expected_doc = {
            "coin": "BTC",
            "predicted_price": 70000.0,
            "direction": "UP",
            "model_version": "lstm_v2",
            "seed_source": "live_prices",
        }
        mock_db.prediction_runs.find_one.return_value = expected_doc
        date = datetime(2026, 5, 26, 0, 0, tzinfo=timezone.utc)
        result = get_prediction_for_date("BTC", date, mongo_uri="mongodb://fake:27017")
        assert result == expected_doc

    def test_returns_none_when_no_doc(self, mock_mongo):
        _, mock_client, mock_db = mock_mongo
        mock_db.prediction_runs.find_one.return_value = None
        date = datetime(2026, 5, 26, 0, 0, tzinfo=timezone.utc)
        result = get_prediction_for_date("BTC", date, mongo_uri="mongodb://fake:27017")
        assert result is None

    def test_returns_none_on_mongo_error(self):
        import accuracy_tracker as _at
        orig = _at.pymongo
        mock_pym = MagicMock()
        mock_pym.MongoClient.side_effect = Exception("timeout")
        _at.pymongo = mock_pym
        try:
            date = datetime(2026, 5, 26, 0, 0, tzinfo=timezone.utc)
            result = get_prediction_for_date("BTC", date, mongo_uri="mongodb://fake:27017")
        finally:
            _at.pymongo = orig
        assert result is None


# ── evaluate_yesterday ─────────────────────────────────────────────────────────

class TestEvaluateYesterday:
    def _setup_full_happy_path(self, mock_db, predicted_price=70000.0, actual_price=71000.0):
        """Wire mock_db for a full successful evaluation."""
        mock_db.prediction_runs.find_one.return_value = {
            "coin": "BTC",
            "predicted_price": predicted_price,
            "direction": "UP",
            "model_version": "lstm_v2",
            "seed_source": "live_prices",
            "prediction_date": datetime(2026, 5, 26, 0, 0, tzinfo=timezone.utc),
        }
        # Yesterday's actual price (live_prices)
        mock_db.live_prices.find.side_effect = [
            [{"price_usd": actual_price}],   # yesterday's price
            [{"price_usd": 69000.0}],         # day-before price (for direction_actual)
        ]
        mock_db.historical_sma.find_one.return_value = None  # not needed (live_prices has data)
        # Index information (for _ensure_index) — called on prediction_accuracy collection
        mock_db.prediction_accuracy.index_information.return_value = {
            "coin_prediction_date_1": {}
        }
        mock_db.prediction_accuracy.update_one.return_value = MagicMock()

    def test_happy_path_returns_metrics(self, mock_mongo):
        _, mock_client, mock_db = mock_mongo
        self._setup_full_happy_path(mock_db, predicted_price=70000.0, actual_price=71000.0)

        results = evaluate_yesterday(["bitcoin"], mongo_uri="mongodb://fake:27017")
        assert "bitcoin" in results
        r = results["bitcoin"]
        assert r.get("skipped") is None
        assert r["mae"] == pytest.approx(1000.0, rel=1e-4)
        assert r["direction_actual"] == "UP"    # 71000 > 69000

    def test_skips_when_no_prediction_doc(self, mock_mongo):
        _, mock_client, mock_db = mock_mongo
        mock_db.prediction_runs.find_one.return_value = None

        results = evaluate_yesterday(["bitcoin"], mongo_uri="mongodb://fake:27017")
        assert results["bitcoin"] == {"skipped": "no_prediction"}

    def test_skips_when_no_actual_price(self, mock_mongo):
        _, mock_client, mock_db = mock_mongo
        mock_db.prediction_runs.find_one.return_value = {
            "coin": "BTC",
            "predicted_price": 70000.0,
            "direction": "UP",
            "model_version": "lstm_v2",
            "seed_source": "csv",
            "prediction_date": datetime(2026, 5, 26, 0, 0, tzinfo=timezone.utc),
        }
        # No actual price in either collection
        mock_db.live_prices.find.return_value = []
        mock_db.historical_sma.find_one.return_value = None

        results = evaluate_yesterday(["bitcoin"], mongo_uri="mongodb://fake:27017")
        assert results["bitcoin"] == {"skipped": "no_actual_price"}

    def test_processes_multiple_coins(self, mock_mongo):
        _, mock_client, mock_db = mock_mongo
        pred_doc_btc = {
            "coin": "BTC",
            "predicted_price": 70000.0,
            "direction": "UP",
            "model_version": "lstm_v2",
            "seed_source": "live_prices",
            "prediction_date": datetime(2026, 5, 26, 0, 0, tzinfo=timezone.utc),
        }
        pred_doc_doge = {
            "coin": "DOGE",
            "predicted_price": 0.20,
            "direction": "DOWN",
            "model_version": "lstm_v2",
            "seed_source": "live_prices",
            "prediction_date": datetime(2026, 5, 26, 0, 0, tzinfo=timezone.utc),
        }
        mock_db.prediction_runs.find_one.side_effect = [pred_doc_btc, pred_doc_doge]
        # live_prices: 2 coins × 2 calls (yesterday + day-before) = 4 calls total
        mock_db.live_prices.find.side_effect = [
            [{"price_usd": 71000.0}],  # BTC yesterday
            [{"price_usd": 69000.0}],  # BTC day-before
            [{"price_usd": 0.18}],     # DOGE yesterday
            [{"price_usd": 0.22}],     # DOGE day-before
        ]
        mock_db.historical_sma.find_one.return_value = None
        mock_db.prediction_accuracy.index_information.return_value = {
            "coin_prediction_date_1": {}
        }
        mock_db.prediction_accuracy.update_one.return_value = MagicMock()

        results = evaluate_yesterday(["bitcoin", "dogecoin"], mongo_uri="mongodb://fake:27017")
        assert "bitcoin" in results
        assert "dogecoin" in results
        assert results["bitcoin"].get("skipped") is None
        assert results["dogecoin"].get("skipped") is None

    def test_direction_correct_false_when_predicted_up_actual_down(self, mock_mongo):
        _, mock_client, mock_db = mock_mongo
        mock_db.prediction_runs.find_one.return_value = {
            "coin": "BTC",
            "predicted_price": 72000.0,
            "direction": "UP",        # model predicted UP
            "model_version": "lstm_v2",
            "seed_source": "csv",
            "prediction_date": datetime(2026, 5, 26, 0, 0, tzinfo=timezone.utc),
        }
        mock_db.live_prices.find.side_effect = [
            [{"price_usd": 68000.0}],   # yesterday  ← DOWN vs day-before
            [{"price_usd": 70000.0}],   # day-before
        ]
        mock_db.historical_sma.find_one.return_value = None
        mock_db.prediction_accuracy.index_information.return_value = {
            "coin_prediction_date_1": {}
        }
        mock_db.prediction_accuracy.update_one.return_value = MagicMock()
        results = evaluate_yesterday(["bitcoin"], mongo_uri="mongodb://fake:27017")
        r = results["bitcoin"]
        assert r["direction_actual"] == "DOWN"
        assert r["direction_correct"] is False


# ── get_accuracy_history ───────────────────────────────────────────────────────

class TestGetAccuracyHistory:
    def test_returns_list_of_docs(self, mock_mongo):
        _, mock_client, mock_db = mock_mongo
        expected = [
            {"coin": "BTC", "prediction_date": datetime(2026, 5, 26, tzinfo=timezone.utc),
             "mae": 500.0, "mape": 0.72},
            {"coin": "BTC", "prediction_date": datetime(2026, 5, 25, tzinfo=timezone.utc),
             "mae": 300.0, "mape": 0.43},
        ]
        mock_db.__getitem__.return_value.find.return_value = expected

        result = get_accuracy_history("BTC", days=14, mongo_uri="mongodb://fake:27017")
        assert result == expected

    def test_returns_empty_list_on_error(self):
        import accuracy_tracker as _at
        orig = _at.pymongo
        mock_pym = MagicMock()
        mock_pym.MongoClient.side_effect = Exception("timeout")
        _at.pymongo = mock_pym
        try:
            result = get_accuracy_history("BTC", days=7, mongo_uri="mongodb://fake:27017")
        finally:
            _at.pymongo = orig
        assert result == []

    def test_returns_empty_list_when_no_docs(self, mock_mongo):
        _, mock_client, mock_db = mock_mongo
        mock_db.__getitem__.return_value.find.return_value = []
        result = get_accuracy_history("DOGE", days=30, mongo_uri="mongodb://fake:27017")
        assert result == []
