"""
src/producer/crypto_producer.py
Kafka producer for the Crypto Big Data project — Speed Layer ingestion.

Polls CoinGecko /simple/price every POLL_INTERVAL_SECONDS seconds,
flattens each coin into a single record, and produces it to Kafka
topic `crypto_raw` with the coin symbol as the partition key.

Producer config guarantees:
  - acks="all"  — wait for all ISR replicas
  - retries=3   — automatic retry on transient failures
  - max_in_flight_requests_per_connection=1  — preserve ordering on retry
"""

import json
import logging
import os
import sys
import time
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv
from kafka import KafkaProducer
from kafka.errors import KafkaError

# ── Configuration ─────────────────────────────────────────────────────────────
load_dotenv()

KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
TOPIC_RAW               = os.getenv("KAFKA_TOPIC_RAW", "crypto_raw")
POLL_INTERVAL_SECONDS   = int(os.getenv("POLL_INTERVAL_SECONDS", "60"))
COINGECKO_API_KEY       = os.getenv("COINGECKO_API_KEY", "")  # empty = free tier

COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price"

# Section 6.1 — 7 coins tracked in the Speed Layer
COINS = [
    "bitcoin",
    "ethereum",
    "binancecoin",
    "solana",
    "ripple",
    "cardano",
    "dogecoin",
]

# Section 5.1 — CoinGecko id → trading symbol
COIN_SYMBOL_MAP: dict[str, str] = {
    "bitcoin":     "BTC",
    "ethereum":    "ETH",
    "binancecoin": "BNB",
    "solana":      "SOL",
    "ripple":      "XRP",
    "cardano":     "ADA",
    "dogecoin":    "DOGE",
}

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("crypto_producer")


# ── Producer factory ──────────────────────────────────────────────────────────
def build_producer() -> KafkaProducer:
    """Create an idempotent KafkaProducer with project-standard settings."""
    return KafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS.split(","),
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        key_serializer=lambda k: k.encode("utf-8"),
        # Reliability settings (Section 6.1)
        acks="all",
        retries=3,
        max_in_flight_requests_per_connection=1,
        # Reasonable network timeouts
        request_timeout_ms=30_000,
        retry_backoff_ms=500,
    )


# ── CoinGecko helpers ─────────────────────────────────────────────────────────
def fetch_prices() -> dict:
    """
    Fetch price, volume, market cap and 24h change for all tracked coins.

    Returns the raw CoinGecko JSON dict, e.g.:
        {"bitcoin": {"usd": 67420.52, "usd_24h_vol": ..., ...}, ...}

    Raises requests.HTTPError on non-2xx responses.
    """
    params: dict = {
        "ids":               ",".join(COINS),
        "vs_currencies":     "usd",
        "include_24hr_vol":  "true",
        "include_market_cap":"true",
        "include_24hr_change":"true",
        "precision":         "2",
    }
    headers: dict = {}
    if COINGECKO_API_KEY:
        headers["x-cg-demo-api-key"] = COINGECKO_API_KEY

    response = requests.get(
        COINGECKO_URL,
        params=params,
        headers=headers,
        timeout=10,
    )
    response.raise_for_status()
    return response.json()


def transform_to_record(coin_id: str, metrics: dict, timestamp: str) -> dict:
    """
    Flatten a single coin's CoinGecko metrics into a Kafka message record.

    Args:
        coin_id:   CoinGecko coin identifier, e.g. "bitcoin"
        metrics:   Dict with keys usd, usd_24h_vol, usd_market_cap, usd_24h_change
        timestamp: ISO-8601 UTC string injected at poll time

    Returns:
        Flat dict matching the Kafka message schema (Section 7.2).
    """
    return {
        "coin":       COIN_SYMBOL_MAP.get(coin_id, coin_id.upper()),
        "coin_id":    coin_id,
        "price_usd":  metrics.get("usd", 0.0),
        "volume_24h": metrics.get("usd_24h_vol", 0.0),
        "market_cap": metrics.get("usd_market_cap", 0.0),
        "change_24h": metrics.get("usd_24h_change", 0.0),
        "timestamp":  timestamp,
        "source":     "coingecko",
    }


# ── Produce loop ──────────────────────────────────────────────────────────────
def produce_loop(producer: KafkaProducer) -> None:
    """
    Infinite loop: poll CoinGecko → produce to Kafka → sleep.

    Uses synchronous flush after each batch so that errors surface
    immediately rather than being silently queued.
    """
    while True:
        try:
            data = fetch_prices()
            ts = datetime.now(timezone.utc).isoformat()

            sent = 0
            for coin_id, metrics in data.items():
                record = transform_to_record(coin_id, metrics, ts)
                symbol = record["coin"]

                # Key = coin symbol → hash-based partition assignment
                # Ensures all messages for the same coin go to the same partition
                producer.send(
                    topic=TOPIC_RAW,
                    key=symbol,
                    value=record,
                ).add_errback(_on_send_error)
                sent += 1

            producer.flush()
            logger.info(
                "Produced %d records to '%s' at %s", sent, TOPIC_RAW, ts
            )

        except requests.HTTPError as exc:
            logger.error("CoinGecko HTTP error: %s", exc)
        except requests.Timeout:
            logger.error("CoinGecko request timed out.")
        except KafkaError as exc:
            logger.error("Kafka error: %s", exc)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Unexpected error: %s", exc)

        time.sleep(POLL_INTERVAL_SECONDS)


def _on_send_error(exc: Exception) -> None:
    """Async error callback for KafkaProducer.send()."""
    logger.error("Failed to deliver message: %s", exc)


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    logger.info(
        "Starting Crypto Producer — bootstrap=%s topic=%s interval=%ds",
        KAFKA_BOOTSTRAP_SERVERS,
        TOPIC_RAW,
        POLL_INTERVAL_SECONDS,
    )
    kafka_producer = build_producer()
    try:
        produce_loop(kafka_producer)
    except KeyboardInterrupt:
        logger.info("Shutting down producer.")
    finally:
        kafka_producer.close()
