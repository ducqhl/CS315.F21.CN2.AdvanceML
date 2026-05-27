# Phase Enhancements Summary (Phases 7–11)

**Date:** 2026-05-27  
**Source:** `docs/phase-enhancements/phase-07-*.md` through `phase-11-*.md`

---

## Overview

Five planned phases extend the current Lambda Architecture with better data collection,
automated retraining, uncertainty quantification, historical accuracy tracking, and
production hardening.

```
Phase 7 ──► Phase 8 ──► Phase 9 ──► Phase 10
                │
                └──────────────────► Phase 11
```

---

## Phase 7 — Hourly OHLCV Data Collection + Sentiment

**Goal:** Replace 5-min spot-price writes with richer hourly OHLCV via CoinGecko
`/market_chart?interval=hourly`. Add Fear & Greed sentiment from alternative.me.

**New file:** `src/ml/data_collector.py`
- `fetch_hourly_ohlcv(coin_id, days=2)` → list of hourly close/volume/market_cap dicts
- `persist_hourly_ohlcv(records, mongo_uri)` → upsert to `ohlcv_hourly` collection (TTL 365 days)
- `fetch_fear_greed_index()` → daily value/classification from alternative.me (free, no CoinGecko budget)
- `persist_sentiment(record, mongo_uri)` → upsert to `market_sentiment`
- `collect_all(mongo_uri)` → single entry point for scheduler

**New MongoDB collection:** `ohlcv_hourly`
```json
{"coin":"BTC","coin_id":"bitcoin","timestamp":ISODate,"close":float,"volume":float,"market_cap":float}
```
Indexes: `{coin,timestamp:-1}` (query), `{timestamp:1, expireAfterSeconds:31536000}` (TTL)

**Modified:** `inference_scheduler.py` (replace price fetch with `collect_all`), `inference.py` (add `ohlcv_hourly` as Priority 0 seed), docker-compose (add `OHLCV_LOOKBACK_DAYS`)

**New page:** `src/dashboard/pages/05_sentiment.py` — Fear & Greed gauge + hourly price chart

**API budget after Phase 7:** 8,640/month (under 10k demo limit)

---

## Phase 8 — Continuous Model Retraining Pipeline

**Goal:** Weekly automated retraining. Compare new model against current champion on holdout.
Promote only if RMSE improves ≥5%.

**New files:**
- `src/ml/model_registry.py` — `ModelRegistry` class, tracks champion/challenger in `retrain_history`
- `src/ml/retrain.py` — full pipeline: data merge → train subprocess → evaluate → register/promote

**New MongoDB collection:** `retrain_history`
```json
{"coin":"BTC","run_id":"uuid","version":"lstm_v3","model_path":"...","rmse":float,
 "champion":bool,"promoted_at":ISODate,"trained_at":ISODate}
```

**Modified:** `inference_scheduler.py` (weekly retrain trigger via `RETRAIN_INTERVAL_SECONDS=604800`), `train_lstm.py` (add `--data-path`, `--model-out`, `--scaler-out` flags), `inference.py` (resolve model via `ModelRegistry` instead of hardcoded path)

**Key decisions:**
- `MIN_NEW_ROWS=168` (1 week hourly data) before retraining fires
- `PROMOTION_THRESHOLD=0.05` (5% RMSE improvement required)
- Training runs as a subprocess to isolate memory and allow clean process exit

---

## Phase 9 — Confidence Intervals via Monte Carlo Dropout

**Goal:** Replace hardcoded `confidence:0.8` with real uncertainty bounds from MC Dropout.

**Approach:**
```python
model.train()   # keep dropout ACTIVE during inference
samples = [model(x) for _ in range(N_SAMPLES=50)]
mean  = np.mean(samples, axis=0)
std   = np.std(samples, axis=0)
lower = mean - 1.96 * std    # 95% confidence lower bound
upper = mean + 1.96 * std    # 95% confidence upper bound
```

**New prediction fields:** `predicted_price_low`, `predicted_price_high`, `confidence` (from std)

**Modified:** `inference.py` (add `mc_predict()`, update `_write_predictions` schema), `03_prediction.py` (shaded confidence bands on forecast chart)

**No model retraining required** — MC Dropout works with existing trained weights.

---

## Phase 10 — Prediction History, Accuracy Trend & Export

**Goal:** Preserve all prediction versions (not just latest), show rolling accuracy trend,
add CSV export.

**Problem with current schema:** `predictions` collection upserts on `(coin, prediction_date)`,
so each run silently overwrites the prior prediction. No history of forecast evolution.

**Fix:** Change upsert key to `(coin, prediction_date, created_at_day)` — one record per
calendar day per future date. The prediction from May 23 for May 28 is preserved even after
May 24's inference runs.

**New page:** `src/dashboard/pages/06_history.py` — prediction evolution chart, accuracy trend

**New endpoint:** `/api/predictions/{coin}/history?days=30`

---

## Phase 11 — Operational Hardening

**Goal:** Production-grade 24/7 operation.

**New files:**
- `src/ml/health_server.py` — minimal HTTP server (stdlib, port 8090) returning last inference status
- `src/ml/drift_monitor.py` — detect when prediction distribution shifts significantly (MAE trending up)

**Modified:** `inference_scheduler.py` (SIGTERM handler for graceful shutdown, health server thread, drift check on each cycle), docker-compose (add `healthcheck` for inference_scheduler service)

---

## Implementation Priority for Daily Predictions Migration

The daily predictions migration (this sprint) is a prerequisite for Phase 10 accuracy trends.
The dependency order:

```
Daily Predictions Migration (this PR)
    └─► Phase 7  (hourly data collector for better seeds)
         └─► Phase 8  (retraining pipeline)
              └─► Phase 9  (confidence intervals)
                   └─► Phase 10  (full accuracy history)
                        └─► Phase 11  (hardening)
```
