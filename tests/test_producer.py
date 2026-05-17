"""
tests/test_producer.py
Unit tests for src/producer/crypto_producer.py.

Covers:
- transform_to_record: field mapping, fallback symbol, zero-defaults
- fetch_prices: response shape, HTTP error propagation
- produce_loop: Kafka send called per coin, flush called, error handling
"""

import sys
import os
import json
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

    def test_all_seven_coins_map_correctly(self):
        expected = {
            "bitcoin": "BTC", "ethereum": "ETH", "binancecoin": "BNB",
            "solana": "SOL", "ripple": "XRP", "cardano": "ADA", "dogecoin": "DOGE",
        }
        for coin_id, symbol in expected.items():
            rec = cp.transform_to_record(coin_id, self._metrics(), "ts")
            assert rec["coin"] == symbol, f"{coin_id} should map to {symbol}"

    def test_unknown_coin_falls_back_to_uppercase(self):
        record = cp.transform_to_record("shiba-inu", self._metrics(), "ts")
        assert record["coin"] == "SHIBA-INU"

    def test_required_fields_present(self):
        record = cp.transform_to_record("bitcoin", self._metrics(), "ts")
        for field in ["coin", "coin_id", "price_usd", "volume_24h", "market_cap", "change_24h", "timestamp", "source"]:
            assert field in record, f"Missing field: {field}"

    def test_field_values_match_metrics(self):
        metrics = self._metrics()
        record = cp.transform_to_record("ethereum", metrics, "2025-05-15T09:00:00+00:00")
        assert record["price_usd"]  == metrics["usd"]
        assert record["volume_24h"] == metrics["usd_24h_vol"]
        assert record["market_cap"] == metrics["usd_market_cap"]
        assert record["change_24h"] == metrics["usd_24h_change"]
        assert record["timestamp"]  == "2025-05-15T09:00:00+00:00"
        assert record["source"]     == "coingecko"
        assert record["coin_id"]    == "ethereum"

    def test_missing_optional_fields_default_to_zero(self):
        # Only usd is required; others default to 0.0
        record = cp.transform_to_record("bitcoin", {"usd": 50000.0}, "ts")
        assert record["volume_24h"] == 0.0
        assert record["market_cap"] == 0.0
        assert record["change_24h"] == 0.0

    def test_price_usd_zero_when_usd_missing(self):
        record = cp.transform_to_record("bitcoin", {}, "ts")
        assert record["price_usd"] == 0.0


# ── fetch_prices ───────────────────────────────────────────────────────────────

class TestFetchPrices:
    def _mock_response(self, data: dict, status_code: int = 200):
        resp = MagicMock()
        resp.status_code = status_code
        resp.json.return_value = data
        resp.raise_for_status = MagicMock()
        if status_code >= 400:
            resp.raise_for_status.side_effect = requests.HTTPError(response=resp)
        return resp

    def test_returns_dict_with_all_seven_coins(self):
        payload = {coin: {"usd": 1.0, "usd_24h_vol": 0, "usd_market_cap": 0, "usd_24h_change": 0}
                   for coin in cp.COINS}
        with patch("crypto_producer.requests.get", return_value=self._mock_response(payload)):
            result = cp.fetch_prices()
        assert set(result.keys()) == set(cp.COINS)

    def test_raises_http_error_on_429(self):
        with patch("crypto_producer.requests.get",
                   return_value=self._mock_response({}, status_code=429)):
            with pytest.raises(requests.HTTPError):
                cp.fetch_prices()

    def test_raises_on_timeout(self):
        with patch("crypto_producer.requests.get", side_effect=requests.Timeout):
            with pytest.raises(requests.Timeout):
                cp.fetch_prices()

    def test_request_uses_all_coins_in_ids_param(self):
        payload = {}
        mock_resp = self._mock_response(payload)
        with patch("crypto_producer.requests.get", return_value=mock_resp) as mock_get:
            cp.fetch_prices()
        _, kwargs = mock_get.call_args
        ids_param = kwargs["params"]["ids"]
        for coin in cp.COINS:
            assert coin in ids_param

    def test_api_key_header_included_when_set(self):
        payload = {}
        mock_resp = self._mock_response(payload)
        with patch("crypto_producer.COINGECKO_API_KEY", "test-key-123"):
            with patch("crypto_producer.requests.get", return_value=mock_resp) as mock_get:
                cp.fetch_prices()
        _, kwargs = mock_get.call_args
        assert kwargs["headers"].get("x-cg-demo-api-key") == "test-key-123"

    def test_no_api_key_header_when_key_empty(self):
        payload = {}
        mock_resp = self._mock_response(payload)
        with patch("crypto_producer.COINGECKO_API_KEY", ""):
            with patch("crypto_producer.requests.get", return_value=mock_resp) as mock_get:
                cp.fetch_prices()
        _, kwargs = mock_get.call_args
        assert "x-cg-demo-api-key" not in kwargs["headers"]


# ── produce_loop (single iteration) ───────────────────────────────────────────

class TestProduceLoop:
    def _make_producer(self):
        producer = MagicMock()
        future = MagicMock()
        producer.send.return_value = future
        return producer

    def _fake_prices(self):
        return {coin: {"usd": 100.0, "usd_24h_vol": 0, "usd_market_cap": 0, "usd_24h_change": 0}
                for coin in cp.COINS}

    def test_send_called_once_per_coin(self):
        producer = self._make_producer()
        # Run only one iteration then raise to break the loop
        with patch("crypto_producer.fetch_prices", return_value=self._fake_prices()):
            with patch("crypto_producer.time.sleep", side_effect=KeyboardInterrupt):
                with pytest.raises(KeyboardInterrupt):
                    cp.produce_loop(producer)
        assert producer.send.call_count == len(cp.COINS)

    def test_send_uses_symbol_as_key(self):
        producer = self._make_producer()
        with patch("crypto_producer.fetch_prices", return_value=self._fake_prices()):
            with patch("crypto_producer.time.sleep", side_effect=KeyboardInterrupt):
                with pytest.raises(KeyboardInterrupt):
                    cp.produce_loop(producer)
        sent_keys = {c.kwargs["key"] for c in producer.send.call_args_list}
        assert sent_keys == set(cp.COIN_SYMBOL_MAP.values())

    def test_flush_called_after_each_batch(self):
        producer = self._make_producer()
        with patch("crypto_producer.fetch_prices", return_value=self._fake_prices()):
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
            raise KeyboardInterrupt  # stop after second iteration attempt

        with patch("crypto_producer.fetch_prices", side_effect=fetch_side_effect):
            with patch("crypto_producer.time.sleep"):
                with pytest.raises(KeyboardInterrupt):
                    cp.produce_loop(producer)
        # Loop survived the HTTPError on iteration 1
        assert call_count == 2

    def test_send_topic_is_crypto_raw(self):
        producer = self._make_producer()
        with patch("crypto_producer.fetch_prices", return_value=self._fake_prices()):
            with patch("crypto_producer.time.sleep", side_effect=KeyboardInterrupt):
                with pytest.raises(KeyboardInterrupt):
                    cp.produce_loop(producer)
        for c in producer.send.call_args_list:
            assert c.kwargs["topic"] == cp.TOPIC_RAW
