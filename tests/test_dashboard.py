"""
tests/test_dashboard.py — Unit tests for Crypto dashboard helper functions.

Covers:
1. RSI calculation (pandas) — values stay in [0, 100], handles constant series.
2. Correlation matrix build — symmetric, diagonal=1.0, handles missing pairs.
3. OHLC simulation — open=prev_close, high/low offsets, close=avg_close.
4. MongoDB query helpers — mocked via unittest.mock.

All tests run without a live MongoDB or Streamlit instance.
"""

import sys
import os

import numpy as np
import pandas as pd
import pytest
from unittest.mock import MagicMock

# ---------------------------------------------------------------------------
# Load dashboard utils directly by file path to avoid sys.path collision
# with src/spark/utils (which is a package also named "utils").
# ---------------------------------------------------------------------------
import importlib.util as _ilu

_UTILS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "src", "dashboard", "utils.py",
)
_spec = _ilu.spec_from_file_location("dashboard_utils", _UTILS_PATH)
_dashboard_utils = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_dashboard_utils)

compute_rsi     = _dashboard_utils.compute_rsi
simulate_ohlc   = _dashboard_utils.simulate_ohlc
build_corr_matrix = _dashboard_utils.build_corr_matrix


# ===========================================================================
# 1. RSI calculation
# ===========================================================================

class TestRsiCalculation:
    """Tests for compute_rsi() in utils.py."""

    def test_rsi_range_valid(self):
        """RSI values must stay within [0, 100] for a real price series."""
        np.random.seed(42)
        prices = pd.Series(np.cumsum(np.random.randn(200)) + 100)
        rsi = compute_rsi(prices, period=14)
        valid = rsi.dropna()
        assert (valid >= 0).all(), "RSI below 0 found"
        assert (valid <= 100).all(), "RSI above 100 found"

    def test_rsi_constant_series_no_zero_division(self):
        """Constant price series should not raise and RSI should be defined."""
        prices = pd.Series([100.0] * 50)
        rsi = compute_rsi(prices, period=14)
        valid = rsi.dropna()
        # With all gains=0 and losses=0, RS=0, RSI=0 (not NaN, not inf).
        assert not valid.isnull().any(), "RSI contains NaN for constant series"
        assert (valid >= 0).all() and (valid <= 100).all()

    def test_rsi_uptrend_above_50(self):
        """In a strict uptrend, RSI should generally be above 50."""
        prices = pd.Series(range(1, 101), dtype=float)
        rsi = compute_rsi(prices, period=14)
        valid = rsi.dropna()
        assert (valid > 50).all(), f"Expected RSI > 50 in uptrend, got min={valid.min():.2f}"

    def test_rsi_downtrend_below_50(self):
        """In a strict downtrend, RSI should generally be below 50."""
        prices = pd.Series(range(100, 0, -1), dtype=float)
        rsi = compute_rsi(prices, period=14)
        valid = rsi.dropna()
        assert (valid < 50).all(), f"Expected RSI < 50 in downtrend, got max={valid.max():.2f}"

    def test_rsi_length_matches_input(self):
        """Output Series must have the same length as the input."""
        prices = pd.Series(np.random.randn(100) + 50)
        rsi = compute_rsi(prices, period=14)
        assert len(rsi) == len(prices)

    def test_rsi_first_values_are_nan(self):
        """First (period) values should be NaN because there is not enough history."""
        prices = pd.Series(range(1, 51), dtype=float)
        rsi = compute_rsi(prices, period=14)
        # The first 14 values (index 0–13) will be NaN due to min_periods=period.
        assert rsi.iloc[:14].isna().all()


# ===========================================================================
# 2. Correlation matrix pivot
# ===========================================================================

class TestCorrelationMatrix:
    """Tests for build_corr_matrix() in utils.py."""

    @pytest.fixture
    def sample_pairs(self):
        return pd.DataFrame([
            {"coin_a": "BTC", "coin_b": "ETH",  "pearson_corr": 0.92},
            {"coin_a": "BTC", "coin_b": "DOGE", "pearson_corr": 0.75},
            {"coin_a": "ETH", "coin_b": "DOGE", "pearson_corr": 0.81},
        ])

    def test_diagonal_is_one(self, sample_pairs):
        matrix = build_corr_matrix(sample_pairs)
        for coin in matrix.index:
            assert matrix.loc[coin, coin] == pytest.approx(1.0)

    def test_matrix_is_symmetric(self, sample_pairs):
        matrix = build_corr_matrix(sample_pairs)
        coins = matrix.index.tolist()
        for i, a in enumerate(coins):
            for b in coins[i + 1:]:
                assert matrix.loc[a, b] == pytest.approx(matrix.loc[b, a])

    def test_values_correctly_placed(self, sample_pairs):
        matrix = build_corr_matrix(sample_pairs)
        assert matrix.loc["BTC", "ETH"] == pytest.approx(0.92)
        assert matrix.loc["ETH", "BTC"] == pytest.approx(0.92)
        assert matrix.loc["BTC", "DOGE"] == pytest.approx(0.75)
        assert matrix.loc["ETH", "DOGE"] == pytest.approx(0.81)

    def test_size_matches_unique_coins(self, sample_pairs):
        matrix = build_corr_matrix(sample_pairs)
        assert matrix.shape == (3, 3)

    def test_nan_pearson_handled(self):
        """NaN pearson values should not crash — cell stays 0.0 (np.eye off-diagonal default)."""
        pairs = pd.DataFrame([
            {"coin_a": "BTC", "coin_b": "ETH",  "pearson_corr": float("nan")},
            {"coin_a": "BTC", "coin_b": "DOGE", "pearson_corr": 0.75},
            {"coin_a": "ETH", "coin_b": "DOGE", "pearson_corr": 0.81},
        ])
        matrix = build_corr_matrix(pairs)
        # NaN pair should fall back to 0.0 (initial np.eye fill is 0 for off-diagonal)
        assert not np.isnan(matrix.loc["BTC", "ETH"])

    def test_empty_df_returns_empty(self):
        """Empty input should return empty DataFrame without raising."""
        result = build_corr_matrix(pd.DataFrame())
        assert result.empty


# ===========================================================================
# 3. OHLC simulation
# ===========================================================================

class TestOhlcSimulation:
    """Tests for simulate_ohlc() in utils.py."""

    @pytest.fixture
    def price_df(self):
        return pd.DataFrame({
            "avg_close": [100.0, 102.0, 98.0, 105.0, 103.0],
            "avg_volume": [1000, 1200, 900, 1100, 1050],
        })

    def test_close_equals_avg_close(self, price_df):
        result = simulate_ohlc(price_df)
        pd.testing.assert_series_equal(
            result["close"].reset_index(drop=True),
            price_df["avg_close"].reset_index(drop=True),
            check_names=False,
        )

    def test_high_is_above_close(self, price_df):
        result = simulate_ohlc(price_df)
        assert (result["high"] > result["close"]).all()

    def test_low_is_below_close(self, price_df):
        result = simulate_ohlc(price_df)
        assert (result["low"] < result["close"]).all()

    def test_high_low_offset_magnitude(self, price_df):
        """high = close*1.001, low = close*0.999."""
        result = simulate_ohlc(price_df)
        expected_high = price_df["avg_close"] * 1.001
        expected_low = price_df["avg_close"] * 0.999
        pd.testing.assert_series_equal(
            result["high"].reset_index(drop=True),
            expected_high.reset_index(drop=True),
            check_names=False,
        )
        pd.testing.assert_series_equal(
            result["low"].reset_index(drop=True),
            expected_low.reset_index(drop=True),
            check_names=False,
        )

    def test_open_is_prev_close(self, price_df):
        """open[i] == close[i-1] (except first row where open == close)."""
        result = simulate_ohlc(price_df)
        for i in range(1, len(result)):
            assert result["open"].iloc[i] == pytest.approx(
                result["close"].iloc[i - 1]
            ), f"open[{i}] should equal close[{i-1}]"

    def test_original_df_not_mutated(self, price_df):
        """simulate_ohlc must not mutate the input DataFrame."""
        original_cols = set(price_df.columns)
        _ = simulate_ohlc(price_df)
        assert set(price_df.columns) == original_cols


# ===========================================================================
# 4. MongoDB query helpers (mocked)
# ===========================================================================

class TestMongoQueryHelpers:
    """Integration-style tests with mocked pymongo client."""

    def _make_mock_db(self, realtime_docs=None, daily_docs=None,
                      sma_docs=None, pred_docs=None, corr_docs=None):
        """Build a mock db handle with configurable find() return values."""
        mock_db = MagicMock()

        def _cursor(docs):
            cur = MagicMock()
            cur.__iter__ = lambda s: iter(docs or [])
            cur.sort = lambda *a, **kw: cur
            cur.limit = lambda *a, **kw: cur
            return cur

        mock_db.realtime_prices.find_one.return_value = (
            realtime_docs[0] if realtime_docs else None
        )
        mock_db.realtime_prices.find.return_value = _cursor(realtime_docs)
        mock_db.daily_stats.find.return_value = _cursor(daily_docs)
        mock_db.historical_sma.find.return_value = _cursor(sma_docs)
        mock_db.predictions.find.return_value = _cursor(pred_docs)
        mock_db.coin_correlation.find.return_value = _cursor(corr_docs)
        return mock_db

    def test_realtime_empty_falls_back_gracefully(self):
        """When realtime_prices is empty, find_one must return None."""
        mock_db = self._make_mock_db(realtime_docs=[], daily_docs=[])
        doc = mock_db.realtime_prices.find_one({"coin": "BTC"}, sort=[("event_time", -1)])
        assert doc is None

    def test_daily_stats_dataframe_columns(self):
        """Daily stats docs should produce a DataFrame with expected columns."""
        from datetime import datetime, timezone
        docs = [
            {"avg_close": 50000.0, "date": datetime(2024, 1, 1, tzinfo=timezone.utc), "avg_volume": 1234.5},
            {"avg_close": 51000.0, "date": datetime(2024, 1, 2, tzinfo=timezone.utc), "avg_volume": 1300.0},
        ]
        df = pd.DataFrame(docs)
        assert "avg_close" in df.columns
        assert "date" in df.columns
        assert len(df) == 2

    def test_correlation_df_expected_shape(self):
        """coin_correlation documents should build a 3×3 matrix."""
        docs = [
            {"coin_a": "BTC", "coin_b": "ETH",  "pearson_corr": 0.93},
            {"coin_a": "BTC", "coin_b": "DOGE", "pearson_corr": 0.78},
            {"coin_a": "ETH", "coin_b": "DOGE", "pearson_corr": 0.82},
        ]
        corr_df = pd.DataFrame(docs)
        matrix = build_corr_matrix(corr_df)
        assert matrix.shape == (3, 3)
        assert set(matrix.columns) == {"BTC", "ETH", "DOGE"}

    def test_prediction_empty_returns_empty_df(self):
        """Empty predictions collection should return an empty list."""
        mock_db = self._make_mock_db(pred_docs=[])
        docs = list(mock_db.predictions.find({"coin": "BTC"}))
        assert docs == []
        df = pd.DataFrame(docs)
        assert df.empty

    def test_historical_sma_sorted_ascending(self):
        """historical_sma documents should be sortable by date ascending."""
        from datetime import datetime, timezone
        docs = [
            {"symbol": "BTC", "date": datetime(2024, 3, 1, tzinfo=timezone.utc), "avg_close": 70000.0, "sma_20": 68000.0, "sma_50": 65000.0},
            {"symbol": "BTC", "date": datetime(2024, 1, 1, tzinfo=timezone.utc), "avg_close": 42000.0, "sma_20": 41000.0, "sma_50": 40000.0},
            {"symbol": "BTC", "date": datetime(2024, 2, 1, tzinfo=timezone.utc), "avg_close": 55000.0, "sma_20": 53000.0, "sma_50": 50000.0},
        ]
        df = pd.DataFrame(docs)
        df["date"] = pd.to_datetime(df["date"], utc=True)
        df_sorted = df.sort_values("date")
        assert df_sorted.iloc[0]["avg_close"] == 42000.0
        assert df_sorted.iloc[-1]["avg_close"] == 70000.0

    def test_realtime_doc_fields_accessible(self):
        """A realtime_prices document should expose all expected fields."""
        from datetime import datetime, timezone
        doc = {
            "coin": "BTC",
            "price_usd": 67420.52,
            "volume_24h": 28400000000.0,
            "market_cap": 1320000000000.0,
            "change_24h": 2.34,
            "event_time": datetime(2025, 5, 15, 8, 30, tzinfo=timezone.utc),
        }
        mock_db = self._make_mock_db(realtime_docs=[doc])
        result = mock_db.realtime_prices.find_one({"coin": "BTC"})
        assert result["price_usd"] == 67420.52
        assert result["change_24h"] == 2.34
        assert "event_time" in result


# ===========================================================================
# 5. Page 3 — Prediction page helpers (Sprint 5/6 integration)
# ===========================================================================

class TestPredictionPageHelpers:
    """Tests for the updated 03_prediction.py data handling (no Streamlit render)."""

    def _make_pred_docs(self) -> list[dict]:
        """Build 7 synthetic prediction documents as inference.py would write them."""
        from datetime import datetime, timezone, timedelta
        now = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        return [
            {
                "coin": "BTC",
                "predicted_price": 65000.0 + i * 500,
                "prediction_date": now + timedelta(days=i + 1),
                "confidence": 0.8,
                "model_version": "lstm_v1",
                "created_at": now,
            }
            for i in range(7)
        ]

    def test_predictions_dataframe_has_required_columns(self):
        """DataFrame built from inference docs must contain all required columns."""
        docs = self._make_pred_docs()
        df = pd.DataFrame(docs)
        required = {"coin", "predicted_price", "prediction_date", "model_version", "confidence"}
        assert required <= set(df.columns), (
            f"Missing columns: {required - set(df.columns)}"
        )

    def test_empty_predictions_graceful_handling(self):
        """Empty predictions list must produce an empty DataFrame without raising."""
        df = pd.DataFrame([])   # mirrors the empty branch in load_predictions()
        assert df.empty
        # Confirm the has_predictions flag logic works correctly
        has_predictions = not df.empty
        assert has_predictions is False

    def test_prediction_date_formatting(self):
        """prediction_date should format to 'YYYY-MM-DD' without timezone suffix."""
        docs = self._make_pred_docs()
        df = pd.DataFrame(docs)
        df["prediction_date"] = pd.to_datetime(df["prediction_date"], utc=True)
        formatted = df["prediction_date"].dt.strftime("%Y-%m-%d")
        # All formatted dates must match YYYY-MM-DD pattern
        import re
        pattern = re.compile(r"^\d{4}-\d{2}-\d{2}$")
        for val in formatted:
            assert pattern.match(val), f"Date format mismatch: {val!r}"

    def test_next_day_metric_is_first_prediction(self):
        """The 'next-day' metric card must use pred_df.iloc[0] (earliest date)."""
        docs = self._make_pred_docs()
        df = pd.DataFrame(docs)
        df["prediction_date"] = pd.to_datetime(df["prediction_date"], utc=True)
        df = df.sort_values("prediction_date").reset_index(drop=True)

        next_day_price = df.iloc[0]["predicted_price"]
        # First prediction is 65000.0 (i=0)
        assert next_day_price == pytest.approx(65000.0)
        # Must be less than the last (7th) prediction
        assert next_day_price < df.iloc[-1]["predicted_price"]
