# Inference Pipeline Investigation

**Date:** 2026-05-27  
**Scope:** `src/ml/inference.py`, `src/ml/inference_scheduler.py`, `src/ml/intraday_inference.py`

---

## 1. End-to-End Inference Flow

```
inference_scheduler.py (every 5 min)
  │
  ├─── Step 1: fetch_and_persist_latest_prices()  (if SCHEDULER_FETCH_COINGECKO=true)
  │     └── CoinGecko /simple/price → live_prices collection
  │
  ├─── Step 2: run_inference(coin) × 2 coins — 7-day daily forecast
  │     │
  │     ├─ Seed data priority
  │     │   0. ohlcv_hourly     (hourly close, highest resolution — Phase 7)
  │     │   1. live_prices      (direct CoinGecko writes, 10-min cadence)
  │     │   2. historical_sma   (daily batch layer — Spark output)
  │     │   3. CSV fallback     (data/sample/{coin}.csv — always available)
  │     │
  │     ├─ Feature engineering: _build_features() → (N, 9) feature matrix
  │     ├─ Drop NaN warmup rows (~30) → scale with StandardScaler
  │     ├─ Take last 60 rows → MIMO forward pass
  │     ├─ Un-standardize log_returns → reconstruct USD prices
  │     │
  │     └─ MongoDB writes
  │         ├── predictions    (upsert on coin + prediction_date)
  │         └── prediction_runs (upsert on coin + run_date_day + prediction_date)
  │
  └─── Step 3: run_intraday_inference(coin) × 2 coins — next-5-min direction
        │
        ├─ Fetch last 95 5-min closes from live_prices
        ├─ Build 9-feature matrix (same as daily)
        ├─ Scale with daily StandardScaler (cross-timeframe adaptation)
        ├─ Forward pass → step-0 prediction only (next 5-min direction)
        └─ MongoDB write: intraday_predictions (upsert on symbol + target_timestamp)
```

---

## 2. Seed Data Sources

### Minimum rows needed: 91 = SEQ_LEN(60) + warmup(31)

| Source | Collection | Field | Resolution | When Available |
|--------|-----------|-------|------------|----------------|
| `ohlcv_hourly` | `ohlcv_hourly` | `close` | 1-hour | Phase 7 (not yet implemented) |
| `live_prices` | `live_prices` | `price_usd` | 10-min | After ~15h producer uptime |
| `historical_sma` | `historical_sma` | `avg_close` | daily | After Spark batch job runs |
| CSV | `data/sample/{coin}.csv` | `price` | daily | Always (static file) |

---

## 3. MIMO Forecast Mechanics

```python
# Single forward pass — no autoregressive chaining (Bug 3 fix from ml_review.md)
result = model(seed_tensor)           # shape: (1, 7) price, (1, 7, 3) dir_logits

# Un-standardize
log_rets = log_rets_norm * scaler.scale_[0] + scaler.mean_[0]   # (7,)

# Reconstruct USD prices
prices_usd = last_price_usd * exp(cumsum(log_rets))             # (7,)
```

**Why MIMO beats autoregressive:** Each step in an autoregressive chain compounds the prediction error. MIMO predicts all 7 days simultaneously from the same seed state, eliminating drift.

---

## 4. Direction + Confidence Derivation (v2 model)

```python
# Softmax over direction logits
dir_probs = softmax(dir_logits, axis=-1)    # (7, 3) probabilities

# Direction label
direction = {0:"DOWN", 1:"FLAT", 2:"UP"}[argmax(dir_probs)]

# Confidence = probability of predicted class
confidence = dir_probs[step, predicted_class]

# Trend strength from probability margin (top1 − top2)
margin = sorted_probs[-1] - sorted_probs[-2]
strength = "STRONG" if margin > 0.4 else "MODERATE" if margin > 0.2 else "WEAK"
```

---

## 5. MongoDB Prediction Documents

### `predictions` collection (current 7-day view)

```json
{
  "coin":             "BTC",
  "predicted_price":  70451.72,
  "prediction_date":  ISODate("2026-05-28T00:00:00Z"),
  "confidence":       0.76,
  "model_version":    "lstm_v2",
  "seed_source":      "live_prices",
  "created_at":       ISODate("2026-05-27T..."),
  "direction":        "UP",
  "direction_prob":   0.76,
  "trend_strength":   "MODERATE"
}
```

**Upsert key:** `(coin, prediction_date)` — overwritten on every inference run.

### `prediction_runs` collection (daily snapshot archive)

```json
{
  "coin":            "BTC",
  "predicted_price": 70451.72,
  "prediction_date": ISODate("2026-05-28T00:00:00Z"),
  "run_date":        ISODate("2026-05-27T00:00:00Z"),
  "created_at":      ISODate("2026-05-27T14:23:00Z"),
  ...same fields as predictions...
}
```

**Upsert key:** `(coin, run_date, prediction_date)` — ensures at most 1 record per calendar day per future date. This is the source of truth for accuracy evaluation.

---

## 6. Identified Problems (Pre-Migration)

### P1: 5-min re-runs waste compute with no benefit
The `predictions` collection is upserted every 5 minutes. Since the LSTM is a deterministic function of the same seed data, predictions barely change between runs. The scheduler burns CPU and (potentially) API calls for negligible gain.

**Target:** Daily predictions written once at midnight UTC. 5-min cycle kept only for `intraday_predictions`.

### P2: No accuracy evaluation
There is no code that compares `predictions` (or `prediction_runs`) from past days to actual closing prices. Users cannot see how accurate the model was.

**Target:** `accuracy_tracker.py` evaluates yesterday's prediction vs actual close, writes to `prediction_accuracy` collection.

### P3: No daily-close anchor
The 5-min scheduler uses the freshest available price as `last_price_usd`. For a daily forecast anchored to "today's close," the inference should run after the daily close (midnight UTC) using the most recent daily closing price.

**Target:** Daily trigger at `DAILY_INFERENCE_HOUR=0` (midnight UTC) ensures predictions are anchored to yesterday's close.

---

## 7. Inference Scheduler Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `INFERENCE_INTERVAL_SECONDS` | 300 | Main cycle interval (5 min) |
| `SCHEDULER_FETCH_COINGECKO` | true | Fetch prices from CoinGecko on each cycle |
| `MONGO_URI` | `mongodb://admin:...` | MongoDB connection string |
| `COINGECKO_API_KEY` | (empty) | API key for paid plan |
| `DAILY_INFERENCE_HOUR` | 0 | UTC hour for daily inference trigger (NEW) |

---

## 8. CoinGecko API Budget

| Source | Calls/month | Notes |
|--------|------------|-------|
| Scheduler `/simple/price` | 8,640 | 12/hr × 24h × 30d |
| Producer `/simple/price` | 4,320 | 6/hr × 24h × 30d |
| Producer `/ohlc` | 2,880 | (6/3)/hr × 24h × 30d × 2 coins |
| **Total (current)** | **15,840** | **Exceeds 10k demo tier** |

Setting `SCHEDULER_FETCH_COINGECKO=false` reduces to 7,200/month (under demo limit).
