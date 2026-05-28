"""
tests/e2e/test_producer_kafka.py
E2E Layer 1 — Producer → Kafka

What this tests:
  - Producer sends exactly 2 messages (BTC + DOGE) per poll cycle to a real Kafka broker
  - Each message is valid JSON with the correct schema (incl. OHLC fields)
  - OHLC fields are populated when candles are available (mocked CoinGecko)
  - A real KafkaConsumer can read back all messages with correct coin symbols

CoinGecko is mocked — no real API calls are made.
Kafka is a real container (testcontainers).
"""

from __future__ import annotations

import json
import time
from unittest.mock import MagicMock, patch

import pytest

pytestmark = pytest.mark.e2e

REQUIRED_FIELDS = {
    "coin", "coin_id", "price_usd", "volume_24h",
    "market_cap", "change_24h", "timestamp", "source",
    "open", "high", "low", "close",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fake_price_response() -> dict:
    """Mimic pycoingecko get_price() response for BTC + DOGE."""
    return {
        "bitcoin": {
            "usd": 77_473.37,
            "usd_market_cap": 1_548_812_855_182.45,
            "usd_24h_vol": 32_816_206_284.10,
            "usd_24h_change": -1.24,
        },
        "dogecoin": {
            "usd": 0.1421,
            "usd_market_cap": 20_500_000_000.0,
            "usd_24h_vol": 1_200_000_000.0,
            "usd_24h_change": 3.11,
        },
    }


def _fake_ohlc_response(base_price: float) -> list:
    """Mimic pycoingecko get_coin_ohlc_by_id() — 4h candles for last 30 days."""
    return [
        [1_700_000_000_000, base_price * 0.99, base_price * 1.01,
         base_price * 0.98, base_price],
        [1_700_014_400_000, base_price * 1.00, base_price * 1.02,
         base_price * 0.99, base_price * 1.005],  # most recent
    ]


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestProducerToKafka:

    def _consume_messages(
        self, bootstrap: str, topic: str, expected: int, timeout_ms: int = 15_000
    ) -> list[dict]:
        """Consume up to *expected* messages from *topic*; return as dicts."""
        from kafka import KafkaConsumer

        consumer = KafkaConsumer(
            topic,
            bootstrap_servers=bootstrap,
            auto_offset_reset="earliest",
            consumer_timeout_ms=timeout_ms,
            value_deserializer=lambda b: json.loads(b.decode("utf-8")),
            group_id=f"e2e-test-{time.time()}",
        )
        messages = []
        for msg in consumer:
            messages.append(msg.value)
            if len(messages) >= expected:
                break
        consumer.close()
        return messages

    def test_produces_two_messages_per_cycle(self, kafka_bootstrap, kafka_topic):
        """One poll cycle must produce exactly 2 messages — BTC and DOGE."""
        import sys, os
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../src/producer"))
        import crypto_producer as cp

        mock_cg = MagicMock()
        mock_cg.get_price.return_value = _fake_price_response()
        mock_cg.get_coin_ohlc_by_id.side_effect = lambda id, **_: (
            _fake_ohlc_response(77_000) if id == "bitcoin"
            else _fake_ohlc_response(0.14)
        )

        producer = cp.build_producer.__wrapped__() if hasattr(cp.build_producer, "__wrapped__") else None

        # Build a real KafkaProducer pointing at the test broker
        from kafka import KafkaProducer
        real_producer = KafkaProducer(
            bootstrap_servers=kafka_bootstrap,
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
            key_serializer=lambda k: k.encode("utf-8"),
            acks="all",
            retries=3,
            max_in_flight_requests_per_connection=1,
            linger_ms=100,
            request_timeout_ms=15_000,
        )

        with patch("crypto_producer._get_cg", return_value=mock_cg), \
             patch("crypto_producer.TOPIC_RAW", kafka_topic), \
             patch("crypto_producer.KAFKA_BOOTSTRAP_SERVERS", kafka_bootstrap), \
             patch("crypto_producer.time.sleep", side_effect=KeyboardInterrupt):
            with pytest.raises(KeyboardInterrupt):
                cp.produce_loop(real_producer)

        real_producer.flush()
        real_producer.close()

        messages = self._consume_messages(kafka_bootstrap, kafka_topic, expected=2)

        assert len(messages) == 2, f"Expected 2 messages, got {len(messages)}"

    def test_message_schema_is_complete(self, kafka_bootstrap, kafka_topic):
        """Every message must contain all required fields including OHLC."""
        import sys, os
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../src/producer"))
        import crypto_producer as cp

        mock_cg = MagicMock()
        mock_cg.get_price.return_value = _fake_price_response()
        mock_cg.get_coin_ohlc_by_id.side_effect = lambda id, **_: (
            _fake_ohlc_response(77_000) if id == "bitcoin"
            else _fake_ohlc_response(0.14)
        )

        topic = kafka_topic + "_schema"
        from kafka.admin import KafkaAdminClient, NewTopic
        from kafka.errors import TopicAlreadyExistsError
        admin = KafkaAdminClient(bootstrap_servers=kafka_bootstrap, client_id="e2e-schema-admin")
        try:
            admin.create_topics([NewTopic(name=topic, num_partitions=1, replication_factor=1)])
        except TopicAlreadyExistsError:
            pass
        finally:
            admin.close()

        from kafka import KafkaProducer
        real_producer = KafkaProducer(
            bootstrap_servers=kafka_bootstrap,
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
            key_serializer=lambda k: k.encode("utf-8"),
            acks="all", retries=3, max_in_flight_requests_per_connection=1,
            linger_ms=100, request_timeout_ms=15_000,
        )

        with patch("crypto_producer._get_cg", return_value=mock_cg), \
             patch("crypto_producer.TOPIC_RAW", topic), \
             patch("crypto_producer.KAFKA_BOOTSTRAP_SERVERS", kafka_bootstrap), \
             patch("crypto_producer.time.sleep", side_effect=KeyboardInterrupt):
            with pytest.raises(KeyboardInterrupt):
                cp.produce_loop(real_producer)

        real_producer.flush()
        real_producer.close()

        messages = self._consume_messages(kafka_bootstrap, topic, expected=2)
        assert len(messages) == 2

        for msg in messages:
            missing = REQUIRED_FIELDS - set(msg.keys())
            assert not missing, f"Message missing fields: {missing}\nMessage: {msg}"

    def test_only_btc_and_doge_produced(self, kafka_bootstrap, kafka_topic):
        """Only BTC and DOGE coin symbols must appear in Kafka messages."""
        import sys, os
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../src/producer"))
        import crypto_producer as cp

        mock_cg = MagicMock()
        mock_cg.get_price.return_value = _fake_price_response()
        mock_cg.get_coin_ohlc_by_id.return_value = []

        topic = kafka_topic + "_coins"
        from kafka.admin import KafkaAdminClient, NewTopic
        from kafka.errors import TopicAlreadyExistsError
        admin = KafkaAdminClient(bootstrap_servers=kafka_bootstrap, client_id="e2e-coins-admin")
        try:
            admin.create_topics([NewTopic(name=topic, num_partitions=1, replication_factor=1)])
        except TopicAlreadyExistsError:
            pass
        finally:
            admin.close()

        from kafka import KafkaProducer
        real_producer = KafkaProducer(
            bootstrap_servers=kafka_bootstrap,
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
            key_serializer=lambda k: k.encode("utf-8"),
            acks="all", retries=3, max_in_flight_requests_per_connection=1,
            linger_ms=100, request_timeout_ms=15_000,
        )

        with patch("crypto_producer._get_cg", return_value=mock_cg), \
             patch("crypto_producer.TOPIC_RAW", topic), \
             patch("crypto_producer.KAFKA_BOOTSTRAP_SERVERS", kafka_bootstrap), \
             patch("crypto_producer.time.sleep", side_effect=KeyboardInterrupt):
            with pytest.raises(KeyboardInterrupt):
                cp.produce_loop(real_producer)

        real_producer.flush()
        real_producer.close()

        messages = self._consume_messages(kafka_bootstrap, topic, expected=2)
        symbols = {m["coin"] for m in messages}
        assert symbols == {"BTC", "DOGE"}, f"Unexpected symbols: {symbols}"

    def test_ohlc_fields_populated_from_candles(self, kafka_bootstrap, kafka_topic):
        """When CoinGecko returns OHLC candles, open/high/low/close must be non-null."""
        import sys, os
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../src/producer"))
        import crypto_producer as cp

        mock_cg = MagicMock()
        mock_cg.get_price.return_value = _fake_price_response()
        mock_cg.get_coin_ohlc_by_id.side_effect = lambda id, **_: (
            _fake_ohlc_response(77_000) if id == "bitcoin"
            else _fake_ohlc_response(0.14)
        )

        topic = kafka_topic + "_ohlc"
        from kafka.admin import KafkaAdminClient, NewTopic
        from kafka.errors import TopicAlreadyExistsError
        admin = KafkaAdminClient(bootstrap_servers=kafka_bootstrap, client_id="e2e-ohlc-admin")
        try:
            admin.create_topics([NewTopic(name=topic, num_partitions=1, replication_factor=1)])
        except TopicAlreadyExistsError:
            pass
        finally:
            admin.close()

        from kafka import KafkaProducer
        real_producer = KafkaProducer(
            bootstrap_servers=kafka_bootstrap,
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
            key_serializer=lambda k: k.encode("utf-8"),
            acks="all", retries=3, max_in_flight_requests_per_connection=1,
            linger_ms=100, request_timeout_ms=15_000,
        )

        # Force OHLC fetch on cycle 0 (OHLC_POLL_MULTIPLIER=1)
        with patch("crypto_producer._get_cg", return_value=mock_cg), \
             patch("crypto_producer.TOPIC_RAW", topic), \
             patch("crypto_producer.KAFKA_BOOTSTRAP_SERVERS", kafka_bootstrap), \
             patch("crypto_producer.OHLC_POLL_MULTIPLIER", 1), \
             patch("crypto_producer.time.sleep", side_effect=KeyboardInterrupt):
            with pytest.raises(KeyboardInterrupt):
                cp.produce_loop(real_producer)

        real_producer.flush()
        real_producer.close()

        messages = self._consume_messages(kafka_bootstrap, topic, expected=2)
        assert len(messages) == 2

        for msg in messages:
            assert msg["open"] is not None, f"open is None for {msg['coin']}"
            assert msg["high"] is not None, f"high is None for {msg['coin']}"
            assert msg["low"]  is not None, f"low is None for {msg['coin']}"
            assert msg["close"] is not None, f"close is None for {msg['coin']}"
            assert msg["high"] >= msg["low"], "high must be >= low"

    def test_message_values_are_correct(self, kafka_bootstrap, kafka_topic):
        """Numeric fields in the Kafka message must match the CoinGecko response."""
        import sys, os
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../src/producer"))
        import crypto_producer as cp

        mock_cg = MagicMock()
        mock_cg.get_price.return_value = _fake_price_response()
        mock_cg.get_coin_ohlc_by_id.return_value = []

        topic = kafka_topic + "_values"
        from kafka.admin import KafkaAdminClient, NewTopic
        from kafka.errors import TopicAlreadyExistsError
        admin = KafkaAdminClient(bootstrap_servers=kafka_bootstrap, client_id="e2e-vals-admin")
        try:
            admin.create_topics([NewTopic(name=topic, num_partitions=1, replication_factor=1)])
        except TopicAlreadyExistsError:
            pass
        finally:
            admin.close()

        from kafka import KafkaProducer
        real_producer = KafkaProducer(
            bootstrap_servers=kafka_bootstrap,
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
            key_serializer=lambda k: k.encode("utf-8"),
            acks="all", retries=3, max_in_flight_requests_per_connection=1,
            linger_ms=100, request_timeout_ms=15_000,
        )

        with patch("crypto_producer._get_cg", return_value=mock_cg), \
             patch("crypto_producer.TOPIC_RAW", topic), \
             patch("crypto_producer.KAFKA_BOOTSTRAP_SERVERS", kafka_bootstrap), \
             patch("crypto_producer.time.sleep", side_effect=KeyboardInterrupt):
            with pytest.raises(KeyboardInterrupt):
                cp.produce_loop(real_producer)

        real_producer.flush()
        real_producer.close()

        messages = self._consume_messages(kafka_bootstrap, topic, expected=2)
        by_coin = {m["coin"]: m for m in messages}

        assert "BTC" in by_coin
        btc = by_coin["BTC"]
        assert btc["price_usd"] == pytest.approx(77_473.37, rel=1e-3)
        assert btc["change_24h"] == pytest.approx(-1.24, rel=1e-2)
        assert btc["source"] == "coingecko"

        assert "DOGE" in by_coin
        doge = by_coin["DOGE"]
        assert doge["price_usd"] == pytest.approx(0.1421, rel=1e-3)
        assert doge["change_24h"] == pytest.approx(3.11, rel=1e-2)
