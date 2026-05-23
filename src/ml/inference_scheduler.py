"""
inference_scheduler.py — Periodic LSTM inference daemon with live CoinGecko fetch.

Each cycle (default every 5 minutes):
  1. Fetch latest BTC + DOGE prices directly from CoinGecko (1 API call for both).
  2. Persist each coin's price to MongoDB  live_prices  collection.
  3. Run LSTM inference for BTC  (seed: live_prices → historical_sma → CSV).
  4. Run LSTM inference for DOGE.
  5. Sleep until next cycle.

Why the scheduler fetches CoinGecko directly
---------------------------------------------
The Kafka producer polls CoinGecko every 5 minutes and writes to live_prices via
the Lambda pipeline.  Both the producer and scheduler share the same 5-minute
cadence, so each scheduler cycle gets fresh seed data.  By fetching one price snapshot
per cycle, the scheduler guarantees fresh data for every inference run — independent
of whether the full Kafka/Spark stack is operational.

CoinGecko API budget (demo tier = 10 k calls / month)
------------------------------------------------------
  Scheduler price fetches :  12/hr × 24h × 30d      =  8,640  (both coins, 1 call)
  Producer price fetches  :  6/hr  × 24h × 30d      =  4,320
  Producer OHLC fetches   :  (6/3) × 24h × 30d × 2  =  2,880
  ─────────────────────────────────────────────────────────────
  Total                                              ≈ 15,840  ← exceeds 10k demo

  To stay within budget, set COINGECKO_API_KEY via a paid plan, or set
  SCHEDULER_FETCH_COINGECKO=false to disable the scheduler's direct fetch
  and rely on the producer's live_prices writes instead (acceptable when the
  full Docker stack is running).

Environment variables:
  MONGO_URI                      MongoDB connection string
  COINGECKO_API_KEY              CoinGecko API key (empty = no-key / demo mode)
  INFERENCE_INTERVAL_SECONDS     seconds between cycles (default: 300)
  SCHEDULER_FETCH_COINGECKO      "true" (default) | "false" — disable to save API calls
"""

from __future__ import annotations

import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Ensure src/ml is on the path when run directly
sys.path.insert(0, str(Path(__file__).resolve().parent))

from inference import run_inference  # noqa: E402

# ── Configuration ──────────────────────────────────────────────────────────────
INFERENCE_INTERVAL_SECONDS = int(os.getenv("INFERENCE_INTERVAL_SECONDS", "300"))
MONGO_URI = os.getenv(
    "MONGO_URI",
    "mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin",
)
COINGECKO_API_KEY = os.getenv("COINGECKO_API_KEY", "")
SCHEDULER_FETCH_COINGECKO = os.getenv("SCHEDULER_FETCH_COINGECKO", "true").lower() == "true"

COINS = ["bitcoin", "dogecoin"]
_COIN_SYMBOL_MAP = {"bitcoin": "BTC", "dogecoin": "DOGE"}

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("inference_scheduler")


# ── CoinGecko fetch ────────────────────────────────────────────────────────────

def _build_cg_client():
    from pycoingecko import CoinGeckoAPI
    if COINGECKO_API_KEY:
        return CoinGeckoAPI(demo_api_key=COINGECKO_API_KEY)
    return CoinGeckoAPI()


def fetch_and_persist_latest_prices() -> bool:
    """
    Fetch the latest BTC + DOGE spot prices from CoinGecko (1 API call)
    and write them to MongoDB  live_prices  collection.

    Returns True on success, False if any step fails (non-fatal — inference
    will still run using whatever seed data is already in live_prices).
    """
    try:
        cg = _build_cg_client()
        data = cg.get_price(
            ids=",".join(COINS),
            vs_currencies="usd",
            include_market_cap="true",
            include_24hr_vol="true",
            include_24hr_change="true",
            precision="2",
        )
        ts = datetime.now(timezone.utc)

        import pymongo
        client = pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
        db = client["crypto_db"]

        docs = []
        for coin_id, metrics in data.items():
            docs.append({
                "coin":       _COIN_SYMBOL_MAP.get(coin_id, coin_id.upper()),
                "coin_id":    coin_id,
                "price_usd":  metrics.get("usd", 0.0),
                "volume_24h": metrics.get("usd_24h_vol", 0.0),
                "market_cap": metrics.get("usd_market_cap", 0.0),
                "change_24h": metrics.get("usd_24h_change", 0.0),
                "timestamp":  ts,
                "source":     "coingecko_direct",
            })

        if docs:
            db["live_prices"].insert_many(docs, ordered=False)
            logger.info(
                "Fetched live prices from CoinGecko: %s",
                {d["coin"]: f"${d['price_usd']:,.2f}" for d in docs},
            )

        client.close()
        return True

    except Exception as exc:  # noqa: BLE001
        logger.warning("CoinGecko fetch failed (non-fatal, inference continues): %s", exc)
        return False


# ── Inference cycle ────────────────────────────────────────────────────────────

def run_cycle(consecutive_failures: int) -> int:
    """
    Run one full cycle: fetch prices → run inference for all coins.

    Returns updated consecutive_failures count (resets to 0 on any success).
    """
    # Step 1: pull fresh price data into live_prices before seeding the model
    if SCHEDULER_FETCH_COINGECKO:
        fetch_and_persist_latest_prices()
    else:
        logger.debug("CoinGecko fetch disabled (SCHEDULER_FETCH_COINGECKO=false).")

    # Step 2: run inference for each coin
    any_success = False
    for coin in COINS:
        try:
            docs = run_inference(coin=coin, mongo_uri=MONGO_URI)
            logger.info(
                "Inference OK for %s — %d predictions written.", coin, len(docs)
            )
            any_success = True
        except FileNotFoundError as exc:
            logger.error(
                "Model not trained for %s (run train_lstm.py first): %s", coin, exc
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("Inference failed for %s: %s", coin, exc)

    if not any_success:
        consecutive_failures += 1
        if consecutive_failures >= 3:
            logger.critical(
                "Inference failed %d consecutive cycles. "
                "Verify models are trained and MongoDB is reachable.",
                consecutive_failures,
            )
    else:
        consecutive_failures = 0

    return consecutive_failures


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logger.info(
        "Starting inference scheduler — interval=%ds, coins=%s, fetch_coingecko=%s, mongo=%s",
        INFERENCE_INTERVAL_SECONDS,
        COINS,
        SCHEDULER_FETCH_COINGECKO,
        MONGO_URI.split("@")[-1] if "@" in MONGO_URI else MONGO_URI,  # hide credentials
    )
    consecutive_failures = 0
    while True:
        cycle_start = time.monotonic()
        consecutive_failures = run_cycle(consecutive_failures)
        elapsed = time.monotonic() - cycle_start
        sleep_for = max(0.0, INFERENCE_INTERVAL_SECONDS - elapsed)
        logger.info(
            "Cycle complete in %.1fs — sleeping %.1fs until next run.",
            elapsed, sleep_for,
        )
        time.sleep(sleep_for)
