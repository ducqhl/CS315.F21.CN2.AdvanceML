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
from intraday_inference import run_intraday_inference  # noqa: E402

# ── Configuration ──────────────────────────────────────────────────────────────
INFERENCE_INTERVAL_SECONDS = int(os.getenv("INFERENCE_INTERVAL_SECONDS", "300"))
MONGO_URI = os.getenv(
    "MONGO_URI",
    "mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin",
)
COINGECKO_API_KEY = os.getenv("COINGECKO_API_KEY", "")
SCHEDULER_FETCH_COINGECKO = os.getenv("SCHEDULER_FETCH_COINGECKO", "true").lower() == "true"
RETRAIN_INTERVAL_DAYS = int(os.getenv("RETRAIN_INTERVAL_DAYS", "7"))

COINS = ["bitcoin", "dogecoin"]
_COIN_SYMBOL_MAP = {"bitcoin": "BTC", "dogecoin": "DOGE"}

# Track which cycle last triggered retrain check (avoid hammering every 5-min cycle)
_last_retrain_check: dict[str, datetime] = {}

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
            price = metrics.get("usd", 0.0)
            docs.append({
                "symbol":     _COIN_SYMBOL_MAP.get(coin_id, coin_id.upper()),
                "coin_id":    coin_id,
                "close":      price,
                "open":       price,
                "high":       price,
                "low":        price,
                "price_usd":  price,   # keep for backwards compat
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
                {d["symbol"]: f"${d['price_usd']:,.2f}" for d in docs},
            )

        client.close()
        return True

    except Exception as exc:  # noqa: BLE001
        logger.warning("CoinGecko fetch failed (non-fatal, inference continues): %s", exc)
        return False


# ── Auto-retrain ───────────────────────────────────────────────────────────────

def check_and_retrain(coin: str) -> None:
    """
    Check whether the latest enabled model for *coin* is older than
    RETRAIN_INTERVAL_DAYS days.  If so, trigger a new training run.

    The retrain check is rate-limited to at most once per 6 hours per coin
    to avoid flooding the scheduler with repeated checks during frequent cycles.
    """
    global _last_retrain_check

    # Rate-limit: skip if last check was < 6h ago
    now = datetime.now(timezone.utc)
    last_check = _last_retrain_check.get(coin)
    if last_check and (now - last_check).total_seconds() < 21_600:
        return
    _last_retrain_check[coin] = now

    symbol = _COIN_SYMBOL_MAP.get(coin, coin.upper())
    try:
        import pymongo as _pymongo
        client = _pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
        db = client["crypto_db"]

        # Find newest enabled model for this coin
        doc = db.model_registry.find_one(
            {"coin": symbol, "enabled": True, "deleted_at": None},
            sort=[("trained_at", -1)],
        )
        client.close()

        needs_retrain = False
        if doc is None:
            logger.info("No registered model found for %s — triggering initial training.", coin)
            needs_retrain = True
        else:
            trained_at = doc.get("trained_at")
            if trained_at and (now - trained_at).days >= RETRAIN_INTERVAL_DAYS:
                logger.info(
                    "Model for %s is %d days old (threshold=%d) — triggering retrain.",
                    coin, (now - trained_at).days, RETRAIN_INTERVAL_DAYS,
                )
                needs_retrain = True
            else:
                days_old = (now - trained_at).days if trained_at else "?"
                logger.debug("Model for %s is %s days old — no retrain needed.", coin, days_old)

        if needs_retrain:
            _trigger_background_train(coin)

    except Exception as exc:  # noqa: BLE001
        logger.warning("Retrain check failed for %s (non-fatal): %s", coin, exc)


def _trigger_background_train(coin: str) -> None:
    """Spawn a background training subprocess."""
    import subprocess as _sp
    from pathlib import Path as _Path

    train_script = _Path(__file__).resolve().parent / "train_lstm.py"
    cmd = [
        sys.executable, str(train_script),
        "--coin", coin,
        "--epochs", "50",
        "--mongo-uri", MONGO_URI,
    ]
    logger.info("Spawning background training for %s: %s", coin, " ".join(cmd))
    try:
        _sp.Popen(cmd, stdout=_sp.DEVNULL, stderr=_sp.DEVNULL)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to spawn training process for %s: %s", coin, exc)


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

    # Step 2: run 7-day daily inference for each coin
    # Fan out across all enabled models in the registry (+ default if registry empty)
    any_success = False
    import pymongo as _pymongo
    _status_client = _pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
    _status_db = _status_client["crypto_db"]

    for coin in COINS:
        symbol = _COIN_SYMBOL_MAP.get(coin, coin.upper())
        # Fetch all enabled models for this coin
        try:
            enabled_models = list(_status_db.model_registry.find(
                {"coin": symbol, "enabled": True, "deleted_at": None},
                {"model_id": 1, "file_path": 1, "_id": 0},
                sort=[("trained_at", -1)],
            ))
        except Exception:
            enabled_models = []

        if not enabled_models:
            # No registry entries — run default inference (loads v2/v1 from disk)
            enabled_models = [{"model_id": None, "file_path": None}]

        for model_entry in enabled_models:
            mid = model_entry.get("model_id")
            fp  = model_entry.get("file_path")
            try:
                from pathlib import Path as _Path
                docs = run_inference(
                    coin=coin,
                    mongo_uri=MONGO_URI,
                    model_path=_Path(fp) if fp else None,
                    model_id=mid,
                )
                logger.info(
                    "Inference OK for %s (model=%s) — %d predictions written.",
                    coin, mid or "default", len(docs),
                )
                any_success = True
                _status_db.inference_status.update_one(
                    {"coin": symbol},
                    {"$set": {"coin": symbol, "status": "completed", "last_run": datetime.now(timezone.utc), "error": None}},
                    upsert=True,
                )
            except FileNotFoundError as exc:
                logger.error(
                    "Model not trained for %s (run train_lstm.py first): %s", coin, exc
                )
                _status_db.inference_status.update_one(
                    {"coin": symbol},
                    {"$set": {"coin": symbol, "status": "model_missing", "last_run": datetime.now(timezone.utc), "error": str(exc)}},
                    upsert=True,
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception("Inference failed for %s (model=%s): %s", coin, mid, exc)
                _status_db.inference_status.update_one(
                    {"coin": symbol},
                    {"$set": {"coin": symbol, "status": "error", "last_run": datetime.now(timezone.utc), "error": str(exc)}},
                    upsert=True,
                )

    _status_client.close()

    # Step 3: run 5-min next-step inference for each coin
    for coin in COINS:
        try:
            doc = run_intraday_inference(coin=coin, mongo_uri=MONGO_URI)
            if doc:
                logger.info(
                    "5-min inference OK for %s — target %s  $%.4f  %s",
                    _COIN_SYMBOL_MAP.get(coin, coin.upper()),
                    doc["target_timestamp"].strftime("%H:%M"),
                    doc["predicted_close"],
                    doc["direction"],
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("5-min inference failed for %s (non-fatal): %s", coin, exc)

    # Step 4: check whether any model needs re-training (rate-limited to ~once/6h)
    for coin in COINS:
        check_and_retrain(coin)

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
        "Starting inference scheduler — interval=%ds, retrain_days=%d, coins=%s, fetch_coingecko=%s, mongo=%s",
        INFERENCE_INTERVAL_SECONDS,
        RETRAIN_INTERVAL_DAYS,
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
