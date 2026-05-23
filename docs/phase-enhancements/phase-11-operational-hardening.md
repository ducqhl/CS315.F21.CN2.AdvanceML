# Phase 11 — Operational Hardening (24/7 Production Readiness)

**Goal:** Make the system production-grade for 24/7 uninterrupted operation. Adds
MongoDB health monitoring, model staleness detection, drift alerting, graceful shutdown
handling, and a `/health` endpoint on the inference scheduler so the system can signal
its own state to external monitors.

**Depends on:** Phase 8 (model registry), Phase 9 (CI fields in predictions)

---

## Do NOT Touch

- `src/ml/model.py`
- `src/ml/preprocess.py`
- `src/ml/train_lstm.py`
- `src/spark/`
- `src/dashboard/` — dashboard unchanged in this phase

---

## New Files to Create

```
src/ml/health_server.py     ← Lightweight HTTP health endpoint (stdlib only)
src/ml/drift_monitor.py     ← Model drift detection + alerting
```

## Files to Modify

```
src/ml/inference_scheduler.py    ← Add SIGTERM handler, health server, drift check
docker/docker-compose.yml        ← Add healthcheck for inference_scheduler
```

---

## Step 1 — Create `src/ml/health_server.py`

Runs a minimal HTTP server on a background thread. Returns JSON with last inference
status. Uses Python stdlib only — no new dependencies.

```python
"""
health_server.py — Minimal HTTP health endpoint for inference_scheduler.

Runs on port HEALTH_PORT (default 8090) in a daemon thread.
Returns JSON describing the last inference cycle state.

Endpoints:
  GET /health       → 200 if last cycle was < STALE_THRESHOLD_SECONDS ago, else 503
  GET /status       → 200 always, returns full status JSON

Example response:
  {
    "status":            "ok" | "stale" | "never_run",
    "last_cycle_at":     "2026-05-24T10:00:00Z" | null,
    "last_cycle_age_s":  3605,
    "consecutive_failures": 0,
    "coins_ok":          ["bitcoin", "dogecoin"],
    "coins_failed":      [],
    "scheduler_version": "1.0.0"
  }
"""

import json
import logging
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Optional

logger = logging.getLogger(__name__)

HEALTH_PORT = int(__import__("os").getenv("HEALTH_PORT", "8090"))
STALE_THRESHOLD_SECONDS = int(__import__("os").getenv("STALE_THRESHOLD_SECONDS", "7200"))  # 2x interval

# Shared state — written by inference_scheduler, read by health endpoint
_status: dict = {
    "last_cycle_at":        None,
    "consecutive_failures": 0,
    "coins_ok":             [],
    "coins_failed":         [],
}
_lock = threading.Lock()


def update_status(
    last_cycle_at: datetime,
    consecutive_failures: int,
    coins_ok: list,
    coins_failed: list,
) -> None:
    """Called by inference_scheduler after each cycle to update health state."""
    with _lock:
        _status["last_cycle_at"] = last_cycle_at.isoformat()
        _status["consecutive_failures"] = consecutive_failures
        _status["coins_ok"] = coins_ok
        _status["coins_failed"] = coins_failed


def _build_response() -> dict:
    with _lock:
        last_at = _status["last_cycle_at"]

    if last_at is None:
        age_s = None
        status = "never_run"
    else:
        last_dt = datetime.fromisoformat(last_at)
        if last_dt.tzinfo is None:
            last_dt = last_dt.replace(tzinfo=timezone.utc)
        age_s = int((datetime.now(timezone.utc) - last_dt).total_seconds())
        status = "ok" if age_s < STALE_THRESHOLD_SECONDS else "stale"

    return {
        "status":                status,
        "last_cycle_at":         last_at,
        "last_cycle_age_s":      age_s,
        "consecutive_failures":  _status["consecutive_failures"],
        "coins_ok":              _status["coins_ok"],
        "coins_failed":          _status["coins_failed"],
        "scheduler_version":     "1.0.0",
    }


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        resp = _build_response()
        http_code = 200 if resp["status"] in ("ok", "never_run") else 503
        if self.path == "/health":
            # Minimal response for load balancers / Docker healthcheck
            body = json.dumps({"status": resp["status"]}).encode()
        elif self.path == "/status":
            body = json.dumps(resp, indent=2).encode()
            http_code = 200   # always 200 for full status
        else:
            body = b'{"error": "not found"}'
            http_code = 404

        self.send_response(http_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass   # suppress access log noise


def start_health_server() -> threading.Thread:
    """
    Start the health HTTP server in a daemon thread.
    Returns the thread (already started).
    """
    server = HTTPServer(("0.0.0.0", HEALTH_PORT), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    logger.info("Health server started on port %d.", HEALTH_PORT)
    return thread
```

---

## Step 2 — Create `src/ml/drift_monitor.py`

```python
"""
drift_monitor.py — Model drift detection.

Computes rolling MAPE over recent predictions vs actuals.
Triggers a CRITICAL log (and optional webhook) if MAPE exceeds threshold.

Usage (called after each inference cycle in inference_scheduler):
    from drift_monitor import check_drift
    check_drift(coin_symbol="BTC", mongo_uri=MONGO_URI)
"""

import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

import numpy as np
import pymongo
import requests

logger = logging.getLogger(__name__)

DRIFT_MAPE_THRESHOLD = float(os.getenv("DRIFT_MAPE_THRESHOLD", "15.0"))  # %
DRIFT_WINDOW_DAYS    = int(os.getenv("DRIFT_WINDOW_DAYS", "14"))          # rolling window
DRIFT_MIN_SAMPLES    = int(os.getenv("DRIFT_MIN_SAMPLES", "5"))           # min evaluated preds
WEBHOOK_URL          = os.getenv("DRIFT_WEBHOOK_URL", "")                 # optional Slack/Discord

_DEFAULT_URI = "mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin"


def _get_recent_accuracy(coin_symbol: str, mongo_uri: str, window_days: int) -> list[float]:
    """
    For predictions made in the last *window_days* days whose prediction_date has passed,
    find closest live_prices actual and compute MAPE values.

    Returns list of pct_error floats (may be empty).
    """
    client = pymongo.MongoClient(mongo_uri, serverSelectionTimeoutMS=3000)
    db = client["crypto_db"]

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=window_days)

    past_preds = list(db.predictions.find(
        {"coin": coin_symbol, "prediction_date": {"$lt": now}, "created_at": {"$gte": cutoff}},
        projection={"_id": 0, "prediction_date": 1, "predicted_price": 1},
    ))

    pct_errors = []
    for row in past_preds:
        target = row["prediction_date"]
        if not isinstance(target, datetime):
            continue
        window_start = target - timedelta(hours=12)
        window_end   = target + timedelta(hours=12)
        actual_doc = db.live_prices.find_one(
            {"coin": coin_symbol, "timestamp": {"$gte": window_start, "$lte": window_end}},
            sort=[("timestamp", 1)],
        )
        if actual_doc and actual_doc.get("price_usd", 0) > 0:
            pct_err = abs(row["predicted_price"] - actual_doc["price_usd"]) / actual_doc["price_usd"] * 100
            pct_errors.append(pct_err)

    client.close()
    return pct_errors


def _send_webhook(message: str) -> None:
    """Send drift alert to webhook URL (Slack-compatible JSON payload)."""
    if not WEBHOOK_URL:
        return
    try:
        requests.post(WEBHOOK_URL, json={"text": message}, timeout=5)
    except Exception as exc:
        logger.warning("Webhook send failed: %s", exc)


def check_drift(coin_symbol: str, mongo_uri: str = _DEFAULT_URI) -> Optional[float]:
    """
    Compute rolling MAPE for *coin_symbol* over DRIFT_WINDOW_DAYS.

    If MAPE >= DRIFT_MAPE_THRESHOLD:
        - Logs CRITICAL
        - Sends webhook (if DRIFT_WEBHOOK_URL set)

    Returns the rolling MAPE value, or None if not enough samples.
    """
    pct_errors = _get_recent_accuracy(coin_symbol, mongo_uri, DRIFT_WINDOW_DAYS)

    if len(pct_errors) < DRIFT_MIN_SAMPLES:
        logger.debug(
            "Drift check for %s: only %d/%d samples — skipping.",
            coin_symbol, len(pct_errors), DRIFT_MIN_SAMPLES,
        )
        return None

    rolling_mape = float(np.mean(pct_errors))
    logger.info(
        "Drift check for %s: %d-day rolling MAPE = %.1f%% (threshold %.0f%%)",
        coin_symbol, DRIFT_WINDOW_DAYS, rolling_mape, DRIFT_MAPE_THRESHOLD,
    )

    if rolling_mape >= DRIFT_MAPE_THRESHOLD:
        msg = (
            f"[DRIFT ALERT] {coin_symbol}: {DRIFT_WINDOW_DAYS}-day rolling MAPE = "
            f"{rolling_mape:.1f}% >= threshold {DRIFT_MAPE_THRESHOLD:.0f}%. "
            f"Consider retraining (force=True) or checking data quality."
        )
        logger.critical(msg)
        _send_webhook(msg)

    return rolling_mape
```

---

## Step 3 — Modify `src/ml/inference_scheduler.py`

### 3a. Add SIGTERM / SIGINT graceful shutdown handler

```python
# ADD near imports:
import signal

# ADD module-level shutdown flag:
_shutdown_requested = False

# ADD signal handler function:
def _handle_shutdown(signum, frame):
    global _shutdown_requested
    logger.info("Signal %d received — scheduler will stop after current cycle.", signum)
    _shutdown_requested = True

# ADD in __main__ before the while loop:
signal.signal(signal.SIGTERM, _handle_shutdown)
signal.signal(signal.SIGINT, _handle_shutdown)

# MODIFY the while loop condition:
# OLD: while True:
# NEW:
while not _shutdown_requested:
    ...

logger.info("Scheduler shut down cleanly.")
```

### 3b. Start health server in __main__

```python
# ADD at start of __main__ (before the while loop):
from health_server import start_health_server, update_status
health_thread = start_health_server()
```

### 3c. Update `run_cycle` to track per-coin outcomes and call drift_monitor

```python
# MODIFY run_cycle() to track which coins succeeded/failed:

def run_cycle(consecutive_failures: int) -> tuple[int, list, list]:
    """
    Returns: (consecutive_failures, coins_ok, coins_failed)
    """
    if SCHEDULER_FETCH_COINGECKO:
        summary = collect_all(mongo_uri=MONGO_URI)
        logger.info("Data collection: %d OHLCV, sentiment=%s", ...)

    coins_ok = []
    coins_failed = []
    for coin in COINS:
        try:
            docs = run_inference(coin=coin, mongo_uri=MONGO_URI)
            logger.info("Inference OK for %s — %d predictions written.", coin, len(docs))
            coins_ok.append(coin)

            # Drift check after successful inference
            coin_symbol = {"bitcoin": "BTC", "dogecoin": "DOGE"}.get(coin, coin.upper())
            try:
                from drift_monitor import check_drift
                check_drift(coin_symbol=coin_symbol, mongo_uri=MONGO_URI)
            except Exception as exc:
                logger.warning("Drift check failed for %s (non-fatal): %s", coin, exc)

        except FileNotFoundError as exc:
            logger.error("Model not trained for %s: %s", coin, exc)
            coins_failed.append(coin)
        except Exception as exc:
            logger.exception("Inference failed for %s: %s", coin, exc)
            coins_failed.append(coin)

    any_success = len(coins_ok) > 0
    if not any_success:
        consecutive_failures += 1
        if consecutive_failures >= 3:
            logger.critical("Inference failed %d consecutive cycles.", consecutive_failures)
    else:
        consecutive_failures = 0

    return consecutive_failures, coins_ok, coins_failed
```

### 3d. Update the main loop to call `update_status` and handle new return signature

```python
# In __main__ while loop:
while not _shutdown_requested:
    cycle_start = time.monotonic()
    consecutive_failures, coins_ok, coins_failed = run_cycle(consecutive_failures)

    # Update health endpoint state
    update_status(
        last_cycle_at=datetime.now(timezone.utc),
        consecutive_failures=consecutive_failures,
        coins_ok=coins_ok,
        coins_failed=coins_failed,
    )

    elapsed = time.monotonic() - cycle_start
    sleep_for = max(0.0, INFERENCE_INTERVAL_SECONDS - elapsed)
    logger.info("Cycle complete in %.1fs — sleeping %.1fs.", elapsed, sleep_for)

    # Interruptible sleep: check _shutdown_requested every second
    for _ in range(int(sleep_for)):
        if _shutdown_requested:
            break
        time.sleep(1)
```

---

## Step 4 — Update `docker/docker-compose.yml`

### 4a. Add healthcheck to inference_scheduler service

```yaml
  inference_scheduler:
    build:
      context: ../src/ml
      dockerfile: Dockerfile
    container_name: inference-scheduler
    restart: unless-stopped
    depends_on:
      mongodb:
        condition: service_healthy
    ports:
      - "8090:8090"     # ADD — exposes health endpoint
    env_file:
      - path: ../.env
        required: false
    environment:
      MONGO_URI: ...
      INFERENCE_INTERVAL_SECONDS: "3600"
      COINGECKO_API_KEY: ${COINGECKO_API_KEY:-}
      SCHEDULER_FETCH_COINGECKO: "true"
      RETRAIN_INTERVAL_SECONDS: "604800"
      HEALTH_PORT: "8090"
      STALE_THRESHOLD_SECONDS: "7200"
      DRIFT_MAPE_THRESHOLD: "15.0"
      DRIFT_WINDOW_DAYS: "14"
      DRIFT_WEBHOOK_URL: ${DRIFT_WEBHOOK_URL:-}    # optional Slack webhook
    volumes:
      - ../src/ml:/app
      - ../data:/app/data
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request; r=urllib.request.urlopen('http://localhost:8090/health'); import json; s=json.loads(r.read())['status']; exit(0 if s in ('ok','never_run') else 1)\""]
      interval: 60s
      timeout: 5s
      retries: 3
      start_period: 30s
```

---

## Acceptance Criteria

### AC-11.1 Health server starts and responds correctly
```bash
# Start scheduler in background:
INFERENCE_INTERVAL_SECONDS=999999 python src/ml/inference_scheduler.py &
PID=$!
sleep 5

# Check health endpoint:
curl -s http://localhost:8090/health | python -m json.tool
# Expected: {"status": "never_run"} or {"status": "ok"}

# Check full status:
curl -s http://localhost:8090/status | python -m json.tool

kill $PID
echo "AC-11.1 PASS"
```

### AC-11.2 Health shows "ok" after inference cycle runs
```bash
INFERENCE_INTERVAL_SECONDS=999999 python src/ml/inference_scheduler.py &
PID=$!
# Wait for first cycle to complete (check logs)
sleep 30
STATUS=$(curl -s http://localhost:8090/health | python -c "import sys,json; print(json.load(sys.stdin)['status'])")
echo "Status: $STATUS"
# Expected: "ok"
kill $PID
echo "AC-11.2 PASS"
```

### AC-11.3 SIGTERM causes clean shutdown (no mid-write interruption)
```bash
INFERENCE_INTERVAL_SECONDS=999999 python src/ml/inference_scheduler.py &
PID=$!
sleep 5
kill -TERM $PID
wait $PID
echo "Exit code: $?"
# Expected: process exits cleanly (exit 0), log shows "Scheduler shut down cleanly."
echo "AC-11.3 PASS"
```

### AC-11.4 Drift monitor does not crash on empty data
```bash
python -c "
import sys; sys.path.insert(0, 'src/ml')
from drift_monitor import check_drift
result = check_drift('BTC')
print('Drift result:', result)
# Should return None (not enough samples) without crashing
print('AC-11.4 PASS')
"
```

### AC-11.5 Docker healthcheck passes
```bash
# After docker-compose up:
docker inspect inference-scheduler --format='{{.State.Health.Status}}'
# Expected: "healthy"
echo "AC-11.5 PASS"
```

---

## Operational Runbook Reference

### Check if scheduler is healthy (production)
```bash
curl http://localhost:8090/status
```

### Force retrain (bypass MIN_NEW_ROWS check)
```bash
docker exec inference-scheduler python -c "
import sys; sys.path.insert(0, '.')
from retrain import run_retrain
print(run_retrain(coin='bitcoin', force=True))
print(run_retrain(coin='dogecoin', force=True))
"
```

### Check model drift manually
```bash
docker exec inference-scheduler python -c "
import sys; sys.path.insert(0, '.')
from drift_monitor import check_drift
for coin in ['BTC', 'DOGE']:
    mape = check_drift(coin)
    print(f'{coin}: {mape}% MAPE' if mape else f'{coin}: insufficient data')
"
```

### View training history
```bash
python -c "
import pymongo
client = pymongo.MongoClient('mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin')
for doc in client.crypto_db.retrain_history.find({}, sort=[('trained_at', -1)], limit=5):
    print(doc.get('coin'), doc.get('version'), '\$'+str(round(doc.get('rmse', 0),2)), doc.get('champion'), doc.get('trained_at').strftime('%Y-%m-%d'))
"
```

### Rotate to champion model without retraining
```bash
# Use model_registry.promote(coin_symbol, run_id) to switch between registered models
python -c "
import sys; sys.path.insert(0, 'src/ml')
from model_registry import ModelRegistry
r = ModelRegistry()
history = r.list_history('BTC')
for h in history:
    print(h['run_id'][:8], h['version'], '\$'+str(round(h['rmse'],2)), 'champion' if h['champion'] else '')
# To promote a specific run_id:
# r.promote('BTC', 'run-id-here')
"
```
