"""
inference_scheduler.py — Daily LSTM inference daemon with a 5-minute live-data loop.

Two distinct cadences run in this one daemon:

5-minute loop (run_cycle) — realtime data + API requests only, NO ML inference:
  1. Service pending on-demand predict / retrain requests from the API.
  2. Fetch latest BTC + DOGE prices from CoinGecko → MongoDB  live_prices .
  3. Sleep until next cycle.
  This cadence exists solely to keep  live_prices  fresh for the realtime
  frontend / Streamlit dashboard.

Daily cycle (run_daily_cycle) — fires once per UTC day at DAILY_INFERENCE_HOUR
(and once at startup so predictions exist immediately on deploy):
  1. Run LSTM inference for every coin × every horizon (H7 / H15 / H60).
  2. Evaluate yesterday's predictions against actual prices (accuracy_tracker).

Why inference is daily, not every 5 minutes
-------------------------------------------
The LSTM is trained on daily-resolution data and the forecast horizon is in days
(H7 / H15 / H60).  Re-running it every 5 minutes produced near-identical output
(daily_stats only changes once per day) and bloated the predictions collection.
5-min OHLCV candles from live_prices are still shown on the dashboard as realtime
data — that path does not involve the LSTM.

Why the scheduler fetches CoinGecko directly
---------------------------------------------
The Kafka producer polls CoinGecko every 10 minutes (POLL_INTERVAL_SECONDS=600)
and writes to live_prices via the Lambda pipeline.  The scheduler runs its own
5-minute loop (INFERENCE_INTERVAL_SECONDS=300) and fetches one price snapshot per
cycle, so it guarantees fresh data for every inference run — independent of whether
the full Kafka/Spark stack is operational.

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

from inference import run_inference   # noqa: E402

HORIZONS: list[int] = [7, 15, 60]

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
    Retrain the LSTM for *coin* across all supported horizons (H7, H15, H60).
    Each horizon is trained sequentially (blocking ~2–10 min each).
    Returns True if at least one horizon trained successfully.
    """
    from train_lstm import train as _train_lstm   # noqa: PLC0415

    any_ok = False
    for h in HORIZONS:
        try:
            logger.info("Weekly retrain starting for %s H%d ...", coin, h)
            metrics = _train_lstm(
                coin=coin,
                window_days=730,
                gamma=0.3,
                model_version=3,
                loss_type="direction_weighted",
                horizon=h,
            )
            logger.info(
                "Weekly retrain complete for %s H%d — dir_acc=%.1f%%  RMSE=$%.2f",
                coin, h,
                metrics.get("directional_accuracy_pct", 0),
                metrics.get("rmse", 0),
            )
            any_ok = True

            try:
                import pymongo as _pymongo  # noqa: PLC0415
                client = _pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
                client["crypto_db"].retrain_log.insert_one({
                    "coin":          coin,
                    "horizon":       h,
                    "timestamp":     datetime.now(timezone.utc),
                    "model_version": 3,
                    "window_days":   730,
                    "metrics":       metrics,
                    "status":        "success",
                })
                client.close()
            except Exception as _log_exc:
                logger.warning("Could not write retrain log for H%d: %s", h, _log_exc)

        except Exception as exc:  # noqa: BLE001
            logger.exception("Weekly retrain failed for %s H%d: %s", coin, h, exc)
            try:
                import pymongo as _pymongo  # noqa: PLC0415
                client = _pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
                client["crypto_db"].retrain_log.insert_one({
                    "coin":      coin,
                    "horizon":   h,
                    "timestamp": datetime.now(timezone.utc),
                    "status":    "error",
                    "error":     str(exc),
                })
                client.close()
            except Exception:
                pass

    return any_ok


# ── On-demand retrain request processor ───────────────────────────────────────

def process_retrain_requests() -> None:
    """
    Poll MongoDB training_jobs for pending retrain requests (written by the API)
    and execute them synchronously.  Marks jobs running → completed / failed.
    """
    try:
        import pymongo as _pymongo  # noqa: PLC0415
        client = _pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
        db = client["crypto_db"]
        pending = list(db.training_jobs.find({"status": "pending"}, {"_id": 0}))
        client.close()
    except Exception as exc:
        logger.warning("Could not poll training_jobs (non-fatal): %s", exc)
        return

    for job in pending:
        jid     = job["job_id"]
        coin    = job["coin_id"]
        horizon = job["horizon"]
        logger.info("Processing retrain request: %s  H%d", jid, horizon)

        try:
            import pymongo as _pymongo  # noqa: PLC0415
            _client = _pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
            _client["crypto_db"].training_jobs.update_one(
                {"job_id": jid},
                {"$set": {"status": "running", "started_at": datetime.now(timezone.utc)}},
            )
            _client.close()
        except Exception:
            pass

        try:
            from train_lstm import train as _train_lstm  # noqa: PLC0415
            metrics = _train_lstm(
                coin=coin,
                horizon=horizon,
                window_days=730,
                gamma=0.3,
                model_version=3,
                loss_type="direction_weighted",
            )
            logger.info("On-demand retrain complete: %s H%d  RMSE=$%.2f", coin, horizon, metrics.get("rmse", 0))
            status, err_msg = "completed", None
        except Exception as exc:
            logger.exception("On-demand retrain failed for %s H%d: %s", coin, horizon, exc)
            metrics, status, err_msg = {}, "failed", str(exc)

        try:
            import pymongo as _pymongo  # noqa: PLC0415
            _client = _pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
            _client["crypto_db"].training_jobs.update_one(
                {"job_id": jid},
                {"$set": {
                    "status":      status,
                    "finished_at": datetime.now(timezone.utc),
                    "metrics":     metrics,
                    "error":       err_msg,
                }},
            )
            _client.close()
        except Exception:
            pass


# ── On-demand predict request processor ───────────────────────────────────────

def process_inference_requests() -> None:
    """
    Poll MongoDB inference_jobs for pending on-demand predict requests (written by
    the API when a user clicks "Predict Now" on a specific model version) and run
    them synchronously. Marks jobs running → completed / failed.

    Each job names an explicit model_id (e.g. lstm_bitcoin_h7_v2); inference loads
    that exact version and tags the predictions with it so they can be filtered
    independently of the active (newest) model.
    """
    try:
        import pymongo as _pymongo  # noqa: PLC0415
        client = _pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
        pending = list(client["crypto_db"].inference_jobs.find({"status": "pending"}, {"_id": 0}))
        client.close()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not poll inference_jobs (non-fatal): %s", exc)
        return

    for job in pending:
        jid      = job["job_id"]
        coin     = job["coin_id"]
        horizon  = job.get("horizon", 7)
        model_id = job.get("model_id")
        logger.info("Processing predict request: %s  model=%s", jid, model_id)

        try:
            import pymongo as _pymongo  # noqa: PLC0415
            _c = _pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
            _c["crypto_db"].inference_jobs.update_one(
                {"job_id": jid},
                {"$set": {"status": "running", "started_at": datetime.now(timezone.utc)}},
            )
            _c.close()
        except Exception:
            pass

        try:
            docs = run_inference(
                coin=coin, mongo_uri=MONGO_URI, horizon=horizon, model_id=model_id
            )
            logger.info(
                "On-demand predict complete: %s  %s — %d predictions written.",
                jid, model_id, len(docs),
            )
            status, err_msg = "completed", None
        except Exception as exc:  # noqa: BLE001
            logger.exception("On-demand predict failed for %s (%s): %s", jid, model_id, exc)
            status, err_msg = "failed", str(exc)

        try:
            import pymongo as _pymongo  # noqa: PLC0415
            _c = _pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
            _c["crypto_db"].inference_jobs.update_one(
                {"job_id": jid},
                {"$set": {
                    "status":      status,
                    "finished_at": datetime.now(timezone.utc),
                    "error":       err_msg,
                }},
            )
            _c.close()
        except Exception:
            pass


# ── Inference cycle ────────────────────────────────────────────────────────────

def run_cycle(consecutive_failures: int) -> int:
    """
    Run one 5-minute cycle: service API requests → refresh live_prices.

    This cycle does NOT run scheduled LSTM inference — that happens once per day
    in run_daily_cycle().  The 5-minute cadence exists only to keep  live_prices
    fresh for the realtime frontend/dashboard and to service on-demand
    predict/retrain requests submitted through the API.

    Returns updated consecutive_failures count (resets to 0 on a successful fetch).
    """
    # Step 0: process any pending retrain + on-demand predict requests from the API.
    # On-demand predicts still run inference immediately — only the *scheduled*
    # inference moved to a daily cadence.
    process_retrain_requests()
    process_inference_requests()

    # Step 1: pull fresh price data into live_prices for the realtime frontend.
    fetch_ok = True
    if SCHEDULER_FETCH_COINGECKO:
        fetch_ok = fetch_and_persist_latest_prices()
        if not fetch_ok:
            logger.warning(
                "CoinGecko fetch failed — live_prices may be stale until next cycle."
            )
    else:
        logger.debug("CoinGecko fetch disabled (SCHEDULER_FETCH_COINGECKO=false).")

    # Failure tracking only applies when this daemon owns price fetching.
    if SCHEDULER_FETCH_COINGECKO and not fetch_ok:
        consecutive_failures += 1
        if consecutive_failures >= 3:
            logger.critical(
                "CoinGecko fetch failed %d consecutive cycles. "
                "Verify network/API key and MongoDB reachability. "
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

    # Step 1: Daily forecast for ALL horizons (H7/H15/H60) for each coin
    import pymongo as _pymongo
    _status_client = _pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
    _status_db = _status_client["crypto_db"]
    import time as _time
    for coin in COINS:
        symbol = _COIN_SYMBOL_MAP.get(coin, coin.upper())
        for h in HORIZONS:
            status_key = f"{symbol}_h{h}"
            _t0 = _time.monotonic()
            try:
                docs = run_inference(coin=coin, mongo_uri=MONGO_URI, horizon=h)
                logger.info(
                    "Daily inference OK for %s H%d — %d predictions written.", coin, h, len(docs)
                )
                _status = "completed"
                _err = None
            except FileNotFoundError as exc:
                logger.warning(
                    "Model not trained for %s H%d (skipping daily inference): %s", coin, h, exc
                )
                _status = "model_missing"
                _err = str(exc)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Daily inference failed for %s H%d: %s", coin, h, exc)
                _status = "error"
                _err = str(exc)
            _duration_ms = int((_time.monotonic() - _t0) * 1000)
            _status_db.inference_status.update_one(
                {"coin": status_key},
                {
                    "$set": {
                        "coin": status_key, "symbol": symbol, "horizon": h,
                        "status": _status,
                        "last_run": datetime.now(timezone.utc),
                        "last_run_duration_ms": _duration_ms,
                        "error": _err,
                    },
                    "$inc": {"run_count": 1},
                },
                upsert=True,
            )
    _status_client.close()

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
        # Also fires once on startup (first_run) so predictions exist immediately
        # on deploy instead of waiting until the next DAILY_INFERENCE_HOUR.
        now_utc       = datetime.now(timezone.utc)
        today_str     = now_utc.strftime("%Y-%m-%d")
        at_daily_hour = now_utc.hour == DAILY_INFERENCE_HOUR
        first_run     = _last_daily_run_date == ""

        if (first_run or at_daily_hour) and today_str != _last_daily_run_date:
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
