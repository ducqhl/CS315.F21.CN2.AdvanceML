"""
src/producer/crypto_producer.py
Kafka producer for the Crypto Big Data project — Speed Layer ingestion.

Polls CoinGecko /simple/price every POLL_INTERVAL_SECONDS seconds using the
official pycoingecko SDK.  Tracks Bitcoin (BTC) and Dogecoin (DOGE) only.

Also fetches 4h OHLC candles via /coins/{id}/ohlc every OHLC_POLL_MULTIPLIER
cycles (default every 3rd cycle = every 30 min) to stay within demo tier limits.

Monthly call budget (demo tier = 10k/month):
  Price cycles/month: 6 × 24 × 30 = 4,320  → 4,320 price calls
  OHLC calls/month:   4,320 / 3 × 2 coins   = 2,880 OHLC calls
  Total                                      ≈ 7,200  (under 10k limit)

Producer config guarantees:
  - acks="all"  — wait for all ISR replicas
  - retries=3   — automatic retry on transient failures
  - max_in_flight_requests_per_connection=1  — preserve ordering on retry
  - linger_ms=100  — batch messages for efficiency
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
from pycoingecko import CoinGeckoAPI

# ── Configuration ─────────────────────────────────────────────────────────────
load_dotenv()

KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
TOPIC_RAW               = os.getenv("KAFKA_TOPIC_RAW", "crypto_raw")
POLL_INTERVAL_SECONDS   = int(os.getenv("POLL_INTERVAL_SECONDS", "600"))
COINGECKO_API_KEY       = os.getenv("COINGECKO_API_KEY", "")  # empty = no-key mode

# BTC + DOGE only (2 coins within demo tier budget)
COINS = ["bitcoin", "dogecoin"]

# CoinGecko id → trading symbol
COIN_SYMBOL_MAP: dict[str, str] = {
    "bitcoin":  "BTC",
    "dogecoin": "DOGE",
}

# Fetch OHLC every Nth price cycle to stay within 10k/month demo limit
OHLC_POLL_MULTIPLIER = int(os.getenv("OHLC_POLL_MULTIPLIER", "3"))

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("crypto_producer")


# ── CoinGecko SDK client ──────────────────────────────────────────────────────
def build_cg_client() -> CoinGeckoAPI:
    """Return a CoinGeckoAPI instance authenticated with the demo key when set."""
    if COINGECKO_API_KEY:
        return CoinGeckoAPI(demo_api_key=COINGECKO_API_KEY)
    return CoinGeckoAPI()


cg = build_cg_client()


# ── Producer factory ──────────────────────────────────────────────────────────
def build_producer() -> KafkaProducer:
    """Create an idempotent KafkaProducer with project-standard settings."""
    return KafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS.split(","),
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        key_serializer=lambda k: k.encode("utf-8"),
        # Reliability settings
        acks="all",
        retries=3,
        max_in_flight_requests_per_connection=1,
        linger_ms=100,
        # Network timeouts
        request_timeout_ms=30_000,
        retry_backoff_ms=500,
    )


# ── CoinGecko helpers ─────────────────────────────────────────────────────────
def fetch_prices() -> dict:
    """
    Fetch price, volume, market cap and 24h change for all tracked coins via SDK.

    Returns the CoinGecko SDK dict, e.g.:
        {"bitcoin": {"usd": 67420.52, "usd_market_cap": ..., "usd_24h_vol": ...,
                     "usd_24h_change": ...}, ...}
    """
    return cg.get_price(
        ids=",".join(COINS),
        vs_currencies="usd",
        include_market_cap="true",
        include_24hr_vol="true",
        include_24hr_change="true",
        precision="2",
    )


def fetch_ohlc(coin_id: str, days: int = 30) -> list:
    """
    Fetch 4h OHLC candles for *coin_id* over the last *days* days.

    Returns a list of [timestamp_ms, open, high, low, close] arrays.
    Called once per poll cycle per coin only every OHLC_POLL_MULTIPLIER cycles.
    """
    return cg.get_coin_ohlc_by_id(id=coin_id, vs_currency="usd", days=days)


def transform_to_record(
    coin_id: str,
    metrics: dict,
    timestamp: str,
    ohlc_candles: list | None = None,
) -> dict:
    """
    Flatten a single coin's CoinGecko metrics into a Kafka message record.

    Args:
        coin_id:      CoinGecko coin identifier, e.g. "bitcoin"
        metrics:      Dict with keys usd, usd_24h_vol, usd_market_cap, usd_24h_change
        timestamp:    ISO-8601 UTC string injected at poll time
        ohlc_candles: List of [ts_ms, open, high, low, close] from fetch_ohlc(), or None

    Returns:
        Flat dict matching the Kafka message schema.
    """
    open_, high, low, close = None, None, None, None
    if ohlc_candles:
        # Most recent candle is the last element
        latest = ohlc_candles[-1]
        open_, high, low, close = latest[1], latest[2], latest[3], latest[4]

    return {
        "coin":       COIN_SYMBOL_MAP.get(coin_id, coin_id.upper()),
        "coin_id":    coin_id,
        "price_usd":  metrics.get("usd", 0.0),
        "volume_24h": metrics.get("usd_24h_vol", 0.0),
        "market_cap": metrics.get("usd_market_cap", 0.0),
        "change_24h": metrics.get("usd_24h_change", 0.0),
        "timestamp":  timestamp,
        "source":     "coingecko",
        "open":       open_,
        "high":       high,
        "low":        low,
        "close":      close,
    }


# ── Produce loop ──────────────────────────────────────────────────────────────
def produce_loop(producer: KafkaProducer) -> None:
    """
    Infinite loop: poll CoinGecko → produce to Kafka → sleep.

    OHLC is fetched every OHLC_POLL_MULTIPLIER cycles to stay within the
    10k calls/month demo tier limit.
    """
    cycle = 0
    while True:
        try:
            data = fetch_prices()
            ts = datetime.now(timezone.utc).isoformat()

            # Fetch OHLC on every Nth cycle (cycle 0 counts as the first fetch)
            fetch_ohlc_this_cycle = (cycle % OHLC_POLL_MULTIPLIER == 0)
            ohlc_map: dict[str, list] = {}
            if fetch_ohlc_this_cycle:
                for coin_id in COINS:
                    try:
                        ohlc_map[coin_id] = fetch_ohlc(coin_id)
                    except Exception as exc:
                        logger.warning("OHLC fetch failed for %s: %s", coin_id, exc)

            sent = 0
            for coin_id, metrics in data.items():
                record = transform_to_record(
                    coin_id, metrics, ts, ohlc_candles=ohlc_map.get(coin_id)
                )
                symbol = record["coin"]

                producer.send(
                    topic=TOPIC_RAW,
                    key=symbol,
                    value=record,
                ).add_errback(_on_send_error)
                sent += 1

            producer.flush()
            logger.info(
                "Cycle %d — produced %d records to '%s' at %s (ohlc=%s)",
                cycle, sent, TOPIC_RAW, ts, fetch_ohlc_this_cycle,
            )

        except requests.exceptions.HTTPError as exc:
            if exc.response is not None and exc.response.status_code == 429:
                logger.warning("Rate-limited (429) — sleeping extra 60s")
                time.sleep(60)
            else:
                logger.error("CoinGecko HTTP error: %s", exc)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Unexpected error: %s", exc)

        cycle += 1
        time.sleep(POLL_INTERVAL_SECONDS)


def _on_send_error(exc: Exception) -> None:
    """Async error callback for KafkaProducer.send()."""
    logger.error("Failed to deliver message: %s", exc)


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    logger.info(
        "Starting Crypto Producer — bootstrap=%s topic=%s interval=%ds coins=%s",
        KAFKA_BOOTSTRAP_SERVERS,
        TOPIC_RAW,
        POLL_INTERVAL_SECONDS,
        COINS,
    )
    kafka_producer = build_producer()
    try:
        produce_loop(kafka_producer)
    except KeyboardInterrupt:
        logger.info("Shutting down producer.")
    finally:
        kafka_producer.close()
