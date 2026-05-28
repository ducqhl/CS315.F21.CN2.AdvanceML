"""
tests/test_producer.py
Unit tests for src/producer/crypto_producer.py.

Covers:
- transform_to_record: field mapping, fallback symbol, zero-defaults, OHLC fields
- fetch_prices: response shape via mocked CoinGeckoAPI
- produce_loop: Kafka send called per coin, flush called, error handling
- OHLC fields present in record schema
- Default poll interval is 600s
"""

import sys
import os
from unittest.mock import MagicMock, patch, call

import pytest
import requests

# Make producer importable without a running Kafka broker
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src/producer"))
import crypto_producer as cp


# ── transform_to_record ────────────────────────────────────────────────────────

class TestTransformToRecord:
    def _metrics(self, **overrides):
        base = {
            "usd":            67420.52,
            "usd_24h_vol":    28_400_000_000.0,
            "usd_market_cap": 1_320_000_000_000.0,
            "usd_24h_change": 2.34,
        }
        return {**base, **overrides}

    def test_known_coin_maps_to_symbol(self):
        record = cp.transform_to_record("bitcoin", self._metrics(), "2025-05-15T08:00:00+00:00")
        assert record["coin"] == "BTC"

    def test_two_coins_map_correctly(self):
        expected = {
            "bitcoin":  "BTC",
            "dogecoin": "DOGE",
        }
        for coin_id, symbol in expected.items():
            rec = cp.transform_to_record(coin_id, self._metrics(), "ts")
            assert rec["coin"] == symbol, f"{coin_id} should map to {symbol}"

    def test_coin_symbol_map_has_exactly_two_entries(self):
        assert len(cp.COIN_SYMBOL_MAP) == 2
        assert set(cp.COIN_SYMBOL_MAP.values()) == {"BTC", "DOGE"}

    def test_unknown_coin_falls_back_to_uppercase(self):
        record = cp.transform_to_record("shiba-inu", self._metrics(), "ts")
        assert record["coin"] == "SHIBA-INU"

    def test_required_fields_present(self):
        record = cp.transform_to_record("bitcoin", self._metrics(), "ts")
        for field in [
            "coin", "coin_id", "price_usd", "volume_24h",
            "market_cap", "change_24h", "timestamp", "source",
        ]:
            assert field in record, f"Missing field: {field}"

    def test_ohlc_fields_in_record(self):
        """open, high, low, close must be present in every record."""
        record = cp.transform_to_record("bitcoin", self._metrics(), "ts")
        for field in ["open", "high", "low", "close"]:
            assert field in record, f"Missing OHLC field: {field}"

    def test_ohlc_fields_none_without_candles(self):
        """OHLC fields are None when no ohlc_candles passed."""
        record = cp.transform_to_record("bitcoin", self._metrics(), "ts")
        assert record["open"] is None
        assert record["high"] is None
        assert record["low"] is None
        assert record["close"] is None

    def test_ohlc_fields_populated_from_candles(self):
        """OHLC fields use the most recent (last) candle."""
        candles = [
            [1000000, 100.0, 110.0, 90.0, 105.0],   # older
            [1001000, 105.0, 120.0, 95.0, 115.0],   # most recent
        ]
        record = cp.transform_to_record("dogecoin", self._metrics(), "ts", ohlc_candles=candles)
        assert record["open"]  == pytest.approx(105.0)
        assert record["high"]  == pytest.approx(120.0)
        assert record["low"]   == pytest.approx(95.0)
        assert record["close"] == pytest.approx(115.0)

    def test_field_values_match_metrics(self):
        metrics = self._metrics()
        record = cp.transform_to_record("dogecoin", metrics, "2025-05-15T09:00:00+00:00")
        assert record["price_usd"]  == metrics["usd"]
        assert record["volume_24h"] == metrics["usd_24h_vol"]
        assert record["market_cap"] == metrics["usd_market_cap"]
        assert record["change_24h"] == metrics["usd_24h_change"]
        assert record["timestamp"]  == "2025-05-15T09:00:00+00:00"
        assert record["source"]     == "coingecko"
        assert record["coin_id"]    == "dogecoin"

    def test_missing_optional_fields_default_to_zero(self):
        record = cp.transform_to_record("bitcoin", {"usd": 50000.0}, "ts")
        assert record["volume_24h"] == 0.0
        assert record["market_cap"] == 0.0
        assert record["change_24h"] == 0.0

    def test_price_usd_zero_when_usd_missing(self):
        record = cp.transform_to_record("bitcoin", {}, "ts")
        assert record["price_usd"] == 0.0


# ── fetch_prices ───────────────────────────────────────────────────────────────

class TestFetchPrices:
    def _mock_cg_response(self, data: dict):
        """Return a mock CoinGeckoAPI whose get_price returns *data*."""
        mock_cg = MagicMock()
        mock_cg.get_price.return_value = data
        return mock_cg

    def test_returns_dict_with_both_coins(self):
        payload = {
            coin: {"usd": 1.0, "usd_24h_vol": 0, "usd_market_cap": 0, "usd_24h_change": 0}
            for coin in cp.COINS
        }
        with patch("crypto_producer._get_cg", return_value=self._mock_cg_response(payload)):
            result = cp.fetch_prices()
        assert set(result.keys()) == set(cp.COINS)

    def test_coins_list_has_exactly_two_entries(self):
        assert len(cp.COINS) == 2
        assert "bitcoin" in cp.COINS
        assert "dogecoin" in cp.COINS

    def test_request_uses_all_coins_in_ids_param(self):
        payload = {}
        mock_cg = MagicMock()
        mock_cg.get_price.return_value = payload
        with patch("crypto_producer._get_cg", return_value=mock_cg):
            cp.fetch_prices()
        # Check via the actual call — ids is passed as kwarg
        call_kwargs = mock_cg.get_price.call_args[1]
        for coin in cp.COINS:
            assert coin in call_kwargs.get("ids", ""), f"{coin} not in ids param"

    def test_sdk_called_with_correct_currencies(self):
        mock_cg = MagicMock()
        mock_cg.get_price.return_value = {}
        with patch("crypto_producer._get_cg", return_value=mock_cg):
            cp.fetch_prices()
        call_kwargs = mock_cg.get_price.call_args[1]
        assert call_kwargs.get("vs_currencies") == "usd"


# ── Poll interval ──────────────────────────────────────────────────────────────

class TestPollInterval:
    def test_poll_interval_default_600s(self):
        """The hardcoded default in os.getenv must be '600', not '60'."""
        # Load source and verify the fallback string literal is "600"
        import inspect
        src = inspect.getsource(cp)
        # The getenv line must contain "600" as the default, not "60"
        assert ('"600"' in src or "'600'" in src), (
            "Default POLL_INTERVAL_SECONDS must be '600' in the source code"
        )
        # And "60" as standalone default must not appear (only "600")
        assert '"60"' not in src and "'60'" not in src, (
            "Found '60' as a string literal — default should be '600'"
        )

    def test_poll_interval_module_default_is_600(self):
        """The module-level default fallback must be 600, not 60."""
        import inspect
        src = inspect.getsource(cp)
        assert '"600"' in src or "'600'" in src, (
            "Default POLL_INTERVAL_SECONDS must be '600' in the source code"
        )


# ── produce_loop (single iteration) ───────────────────────────────────────────

class TestProduceLoop:
    def _make_producer(self):
        producer = MagicMock()
        future = MagicMock()
        producer.send.return_value = future
        return producer

    def _fake_prices(self):
        return {
            coin: {"usd": 100.0, "usd_24h_vol": 0, "usd_market_cap": 0, "usd_24h_change": 0}
            for coin in cp.COINS
        }

    def test_send_called_once_per_coin(self):
        producer = self._make_producer()
        with patch("crypto_producer.fetch_prices", return_value=self._fake_prices()):
            with patch("crypto_producer.fetch_ohlc", return_value=[]):
                with patch("crypto_producer.time.sleep", side_effect=KeyboardInterrupt):
                    with pytest.raises(KeyboardInterrupt):
                        cp.produce_loop(producer)
        assert producer.send.call_count == len(cp.COINS)

    def test_send_uses_symbol_as_key(self):
        producer = self._make_producer()
        with patch("crypto_producer.fetch_prices", return_value=self._fake_prices()):
            with patch("crypto_producer.fetch_ohlc", return_value=[]):
                with patch("crypto_producer.time.sleep", side_effect=KeyboardInterrupt):
                    with pytest.raises(KeyboardInterrupt):
                        cp.produce_loop(producer)
        sent_keys = {c.kwargs["key"] for c in producer.send.call_args_list}
        assert sent_keys == set(cp.COIN_SYMBOL_MAP.values())

    def test_flush_called_after_each_batch(self):
        producer = self._make_producer()
        with patch("crypto_producer.fetch_prices", return_value=self._fake_prices()):
            with patch("crypto_producer.fetch_ohlc", return_value=[]):
                with patch("crypto_producer.time.sleep", side_effect=KeyboardInterrupt):
                    with pytest.raises(KeyboardInterrupt):
                        cp.produce_loop(producer)
        producer.flush.assert_called_once()

    def test_http_error_does_not_crash_loop(self):
        producer = self._make_producer()
        call_count = 0

        def fetch_side_effect():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise requests.HTTPError("rate limited")
            raise KeyboardInterrupt

        with patch("crypto_producer.fetch_prices", side_effect=fetch_side_effect):
            with patch("crypto_producer.time.sleep"):
                with pytest.raises(KeyboardInterrupt):
                    cp.produce_loop(producer)
        assert call_count == 2

    def test_send_topic_is_crypto_raw(self):
        producer = self._make_producer()
        with patch("crypto_producer.fetch_prices", return_value=self._fake_prices()):
            with patch("crypto_producer.fetch_ohlc", return_value=[]):
                with patch("crypto_producer.time.sleep", side_effect=KeyboardInterrupt):
                    with pytest.raises(KeyboardInterrupt):
                        cp.produce_loop(producer)
        for c in producer.send.call_args_list:
            assert c.kwargs["topic"] == cp.TOPIC_RAW

    def test_linger_ms_present_in_producer_config(self):
        """build_producer must include linger_ms=100."""
        import inspect
        src = inspect.getsource(cp.build_producer)
        assert "linger_ms" in src, "linger_ms=100 must be in build_producer()"
        assert "100" in src, "linger_ms value must be 100"
