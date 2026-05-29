"""
inference_scheduler.py — Periodic LSTM inference daemon with live CoinGecko fetch.

Each cycle (default every 5 minutes):
  1. Fetch latest BTC + DOGE prices directly from CoinGecko (1 API call for both).
  2. Persist each coin's price to MongoDB  live_prices  collection.
  3. Run daily LSTM inference for BTC  (seed: live_prices → historical_sma → CSV).
  4. Run daily LSTM inference for DOGE.
  5. Sleep until next cycle.

Note: 5-min intraday ML inference has been removed. The LSTM is trained on daily
data and cannot reliably predict at 5-min resolution (scale mismatch). Live 5-min
OHLCV candles from live_prices are still displayed on the dashboard.

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

# Daily inference: run once per UTC day at DAILY_INFERENCE_HOUR (default midnight).
DAILY_INFERENCE_HOUR = int(os.getenv("DAILY_INFERENCE_HOUR", "0"))

# Weekly retrain: retrain both coin models every RETRAIN_INTERVAL_DAYS days.
# Retrain is blocking (~2–10 min) but runs before daily inference so the new
# model is used immediately.  Set to 0 to disable.
RETRAIN_INTERVAL_DAYS = int(os.getenv("RETRAIN_INTERVAL_DAYS", "7"))

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


# ── Weekly retrain ────────────────────────────────────────────────────────────

def run_weekly_retrain(coin: str) -> bool:
    """
    Retrain the LSTM for *coin* using the rolling-window v3 pipeline and
    write a retrain log entry to MongoDB.

    Note: this is blocking — expect 2–10 minutes per coin on CPU.
    Returns True on success, False on any error (non-fatal).
    """
    try:
        from train_lstm import train as _train_lstm   # noqa: PLC0415

        logger.info("Weekly retrain starting for %s ...", coin)
        metrics = _train_lstm(
            coin=coin,
            window_days=730,
            gamma=0.3,
            model_version=3,
            loss_type="direction_weighted",
        )
        logger.info(
            "Weekly retrain complete for %s — dir_acc=%.1f%%  RMSE=$%.2f",
            coin,
            metrics.get("directional_accuracy_pct", 0),
            metrics.get("rmse", 0),
        )

        # Log result to MongoDB (non-fatal if unavailable)
        try:
            import pymongo as _pymongo  # noqa: PLC0415
            client = _pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
            db = client["crypto_db"]
            db.retrain_log.insert_one({
                "coin":        coin,
                "timestamp":   datetime.now(timezone.utc),
                "model_version": 3,
                "window_days": 730,
                "metrics":     metrics,
                "status":      "success",
            })
            client.close()
        except Exception as exc:
            logger.warning("Could not write retrain log to MongoDB: %s", exc)

        return True

    except Exception as exc:  # noqa: BLE001
        logger.exception("Weekly retrain failed for %s: %s", coin, exc)
        try:
            import pymongo as _pymongo  # noqa: PLC0415
            client = _pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
            db = client["crypto_db"]
            db.retrain_log.insert_one({
                "coin":      coin,
                "timestamp": datetime.now(timezone.utc),
                "status":    "error",
                "error":     str(exc),
            })
            client.close()
        except Exception:
            pass
        return False


# ── Inference cycle ────────────────────────────────────────────────────────────

def run_cycle(consecutive_failures: int) -> int:
    """
    Run one full cycle: fetch prices → run inference for all coins.

    Returns updated consecutive_failures count (resets to 0 on any success).
    """
    # Step 1: pull fresh price data into live_prices before seeding the model
    if SCHEDULER_FETCH_COINGECKO:
        fetch_ok = fetch_and_persist_latest_prices()
        if not fetch_ok:
            logger.warning(
                "CoinGecko fetch failed — inference will seed from existing live_prices "
                "or historical_sma (may be stale)."
            )
    else:
        logger.debug("CoinGecko fetch disabled (SCHEDULER_FETCH_COINGECKO=false).")

    # Step 2: run 7-day daily inference for each coin
    any_success = False
    import pymongo as _pymongo
    _status_client = _pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
    _status_db = _status_client["crypto_db"]
    for coin in COINS:
        symbol = _COIN_SYMBOL_MAP.get(coin, coin.upper())
        try:
            docs = run_inference(coin=coin, mongo_uri=MONGO_URI)
            logger.info(
                "Inference OK for %s — %d predictions written.", coin, len(docs)
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
            logger.exception("Inference failed for %s: %s", coin, exc)
            _status_db.inference_status.update_one(
                {"coin": symbol},
                {"$set": {"coin": symbol, "status": "error", "last_run": datetime.now(timezone.utc), "error": str(exc)}},
                upsert=True,
            )
    _status_client.close()

    if not any_success:
        consecutive_failures += 1
        if consecutive_failures >= 3:
            logger.critical(
                "Inference failed %d consecutive cycles. "
                "Verify models are trained and MongoDB is reachable. "
                "Exiting — container will restart automatically.",
                consecutive_failures,
            )
            sys.exit(1)
    else:
        consecutive_failures = 0

    return consecutive_failures


# ── Entry point ────────────────────────────────────────────────────────────────

def run_daily_cycle() -> None:
    """
    Run the daily inference + accuracy evaluation cycle.

    Called once per UTC day when the scheduler clock reaches DAILY_INFERENCE_HOUR.

    Steps:
      1. Re-run full 7-day inference for each coin — anchored to the latest
         available closing price (post-midnight, so yesterday's close is current).
      2. Evaluate yesterday's prediction against actual prices and write the
         result to the prediction_accuracy collection.
    """
    logger.info(
        "Daily inference cycle starting (DAILY_INFERENCE_HOUR=%d UTC).",
        DAILY_INFERENCE_HOUR,
    )

    # Step 1: Daily 7-day forecast for each coin
    for coin in COINS:
        symbol = _COIN_SYMBOL_MAP.get(coin, coin.upper())
        try:
            docs = run_inference(coin=coin, mongo_uri=MONGO_URI)
            logger.info(
                "Daily inference OK for %s — %d predictions written.", coin, len(docs)
            )
        except FileNotFoundError as exc:
            logger.error(
                "Model not trained for %s (run train_lstm.py first): %s", coin, exc
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("Daily inference failed for %s: %s", coin, exc)

    # Step 2: Accuracy evaluation — compare yesterday's predictions to actual prices
    try:
        from accuracy_tracker import evaluate_yesterday  # noqa: PLC0415
        acc_results = evaluate_yesterday(COINS, mongo_uri=MONGO_URI)
        for coin_id, metrics in acc_results.items():
            if metrics.get("skipped"):
                logger.info(
                    "Accuracy skipped for %s: %s",
                    coin_id, metrics["skipped"],
                )
            else:
                logger.info(
                    "Accuracy for %s yesterday — MAE=$%.2f  MAPE=%.2f%%  dir=%s→%s  correct=%s",
                    coin_id,
                    metrics.get("mae") or 0,
                    metrics.get("mape") or 0,
                    metrics.get("direction_predicted", "?"),
                    metrics.get("direction_actual", "?"),
                    metrics.get("direction_correct"),
                )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Accuracy evaluation failed (non-fatal): %s", exc)

    logger.info("Daily inference cycle complete.")


if __name__ == "__main__":
    logger.info(
        "Starting inference scheduler — interval=%ds, daily_hour=%d UTC, "
        "coins=%s, fetch_coingecko=%s, mongo=%s",
        INFERENCE_INTERVAL_SECONDS,
        DAILY_INFERENCE_HOUR,
        COINS,
        SCHEDULER_FETCH_COINGECKO,
        MONGO_URI.split("@")[-1] if "@" in MONGO_URI else MONGO_URI,  # hide credentials
    )
    consecutive_failures   = 0
    _last_daily_run_date: str  = ""   # "YYYY-MM-DD" of last completed daily cycle
    _last_retrain_date:   str  = ""   # "YYYY-MM-DD" of last completed weekly retrain

    while True:
        cycle_start = time.monotonic()
        consecutive_failures = run_cycle(consecutive_failures)

        # ── Daily trigger: fires once per UTC day at DAILY_INFERENCE_HOUR ──────
        now_utc       = datetime.now(timezone.utc)
        today_str     = now_utc.strftime("%Y-%m-%d")
        at_daily_hour = now_utc.hour == DAILY_INFERENCE_HOUR

        if at_daily_hour and today_str != _last_daily_run_date:
            # ── Weekly retrain (runs before daily inference so new model is used) ─
            if RETRAIN_INTERVAL_DAYS > 0:
                try:
                    from datetime import date as _date  # noqa: PLC0415
                    last_rt = (
                        _date.fromisoformat(_last_retrain_date)
                        if _last_retrain_date else _date.min
                    )
                    days_since = (now_utc.date() - last_rt).days
                    if days_since >= RETRAIN_INTERVAL_DAYS:
                        logger.info(
                            "Weekly retrain triggered (days_since_last=%d, interval=%d).",
                            days_since, RETRAIN_INTERVAL_DAYS,
                        )
                        for coin in COINS:
                            run_weekly_retrain(coin)   # blocking ~2–10 min
                        _last_retrain_date = today_str
                except Exception as exc:  # noqa: BLE001
                    logger.exception("Weekly retrain trigger error: %s", exc)

            try:
                run_daily_cycle()
            except Exception as exc:  # noqa: BLE001
                logger.exception("run_daily_cycle raised unexpectedly: %s", exc)
            _last_daily_run_date = today_str
        # ── End daily trigger ─────────────────────────────────────────────────

        elapsed = time.monotonic() - cycle_start
        sleep_for = max(0.0, INFERENCE_INTERVAL_SECONDS - elapsed)
        logger.info(
            "Cycle complete in %.1fs — sleeping %.1fs until next run.",
            elapsed, sleep_for,
        )
        time.sleep(sleep_for)
