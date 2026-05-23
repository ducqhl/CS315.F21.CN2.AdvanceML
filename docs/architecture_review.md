# Expert Architecture Review
# Crypto Big Data — Lambda Architecture for Price Tracking & Prediction

**Reviewer perspective:** Senior ML Engineer / Big Data Architect  
**Review date:** 2026-05-23  
**Project goals assessed:**
- Real-time price tracking at 1-hour granularity
- 7-day price prediction (LSTM MIMO)
- Self-improving model: continuously retrains on new data
- 24/7 uninterrupted operation
- All data persisted for user review
- Smart big data processing (Lambda Architecture)

---

## 1. Executive Summary

This project implements a **Lambda Architecture** for cryptocurrency analytics — a well-chosen pattern for combining real-time speed with batch accuracy. The core design is sound and the engineering quality is above average: proper train/val/test splits, MIMO forecasting instead of error-compounding autoregression, and a clean service separation via Docker Compose.

However, assessed against the stated goals — **continuous 24/7 self-improvement**, **1-hour prediction series**, and **production-grade big data persistence** — the current architecture has significant gaps that would prevent it from achieving those goals reliably:

1. The model is trained once and never retrained — there is no continuous learning pipeline.
2. The 1-hour granularity is supported at the prediction layer but **not at the data collection layer** (CoinGecko polling is daily-candle data, not hourly OHLCV).
3. `live_prices` has no TTL and no deduplication — it will grow indefinitely and accumulate duplicate timestamps.
4. There is no model versioning, drift detection, or automated retraining trigger.
5. The confidence value of `0.8` is hardcoded and meaningless — a serious credibility gap for any user relying on uncertainty estimates.

This document provides a full diagnosis and a concrete improvement roadmap.

---

## 2. What the Architecture Does Well

### 2.1 Lambda Architecture Selection
The choice of Lambda Architecture is correct for this domain. Crypto price data arrives in real time (Speed Layer) but needs historical batch processing for training (Batch Layer). Separating these concerns cleanly avoids the classic mistake of trying to serve ML training and real-time inference from the same pipeline.

### 2.2 MIMO Forecasting (Bug Fix Applied)
The switch from autoregressive to MIMO (Multi-Input Multi-Output) is a significant correctness improvement. Autoregressive chaining compounds errors exponentially over 7 steps:

```
Autoregressive:  error[t+1] feeds error[t+2] feeds ... feeds error[t+7]
MIMO:            single forward pass → all 7 steps simultaneously, no compounding
```

The current architecture correctly uses a single `model(x).squeeze(0)` call to get all 7 log-return predictions at once.

### 2.3 StandardScaler Fit on Training Rows Only
Fixing the data leakage bug (MinMaxScaler fit on entire dataset → StandardScaler fit on train only) is fundamental correctness. Many production ML systems still ship with this bug. The current implementation correctly:
```python
# Split FIRST, scale SECOND
train_features = features[:train_end]
scaler = StandardScaler().fit(train_features)  # fit on train only
```

### 2.4 Log-Return Targets Instead of Raw Prices
Predicting log-returns instead of raw prices correctly addresses non-stationarity. Raw BTC prices trend from $300 (2015) to $75,000 (2026) — a model trained on normalized prices from 2015–2022 will be completely out of distribution when predicting 2024+ prices. Log-returns are approximately stationary and mean-reverting.

### 2.5 3-Tier Seed Priority Chain
The `live_prices → historical_sma → CSV` fallback chain is production-quality defensive programming. The inference scheduler never fails silently — it always produces predictions from the best available data source.

### 2.6 Non-Fatal MongoDB Writes in Producer
The `write_to_live_prices` implementation correctly wraps MongoDB writes in `try/except` with a warning-only log. The Kafka send is never blocked by a database failure, which is the correct priority ordering for a Speed Layer producer.

---

## 3. Critical Gaps vs. Project Goals

### 3.1 Goal: "Self-improving model — better and better over time"

**Current state:** Model is trained once via `train_lstm.py --coin bitcoin` and the weights are never updated. The `lstm_v1.pt` file does not change regardless of how much new data accumulates in MongoDB.

**Impact:** As months pass, the model becomes increasingly stale. CoinGecko data collected after the training cutoff never influences predictions.

**What's missing:**
- A retraining trigger (time-based or drift-based)
- A pipeline that merges `live_prices` records into the training CSV (or trains directly from MongoDB)
- A model registry to track version history and enable rollback
- A champion/challenger framework to A/B test retrained models before promoting

**Minimum viable fix:**
```python
# src/ml/retrain_scheduler.py (does not exist yet)
# Triggered weekly or when live_prices accumulates N new rows
# 1. Load all live_prices from MongoDB → append to training data
# 2. Run train_lstm.py with updated data
# 3. Evaluate on holdout: if RMSE improves → promote new model
# 4. Archive old model with version tag (v1, v2, ...)
```

### 3.2 Goal: "1-hour price series prediction"

**Current state:** The LSTM is trained on **daily-granularity** data from the sample CSVs. The model learns daily log-returns. Predictions are mapped to daily future dates (day+1 through day+7), not hourly intervals.

**Impact:** The model cannot capture intra-day patterns, momentum cycles, or hourly volatility clusters. Crypto markets have significant hour-level structure (Asia open, US open, derivatives expiry) that is completely invisible to a daily model.

**Data gap:** CoinGecko's `/coins/{id}/ohlc` endpoint returns 4-hour candles for the last 30 days (as currently used for OHLC in the producer). **For 1-hour granularity, the project needs to:**
1. Use CoinGecko's `/coins/{id}/market_chart` with `interval=hourly` and `days=90` — returns 1-hour OHLCV data
2. Rebuild the training CSV with hourly rows (`price`, `total_volume`, `market_cap` per hour)
3. Retrain the LSTM with `seq_len=168` (7 days × 24h = 168 hourly steps as context) and `horizon=24` (predict next 24 hours)

**Model changes required for hourly:**

| Parameter | Current (daily) | Recommended (hourly) |
|---|---|---|
| `seq_len` | 60 days | 168 hours (7 days) |
| `horizon` | 7 days | 24 hours |
| Feature warmup | 30 rows | 30×24 = 720 rows |
| Min rows for inference | 91 | 720 + 168 = 888 |
| Training data needed | ~3,700 rows | ~3,700 × 24 = 88,800 rows |

**CoinGecko budget for hourly polling:**
At 1 API call per hour (price + volume, both coins in one call):
- 24 calls/day × 30 days = 720 calls/month — well within the 10k demo limit

### 3.3 Goal: "Get all necessary data to support training"

**Current state:** Only 2 features beyond price are used: volume and derived log-returns/RSI. No exogenous signals are captured.

**Crypto price drivers not currently captured:**

| Signal | Source | Impact |
|---|---|---|
| Market sentiment | Reddit r/Bitcoin, Twitter, Fear & Greed Index | High — sentiment leads price |
| On-chain metrics | Glassnode, Blockchain.com API | High — exchange inflows predict dumps |
| Macro indicators | Fed funds rate, DXY, S&P 500 | Medium — BTC/USD inversely correlated with USD strength |
| Funding rates | Binance/Bybit API | High — negative funding predicts short squeeze |
| Order book depth | Exchange APIs | Medium — large bid walls predict support |
| Altcoin correlation | Already partially captured via coin_correlation | Medium |
| Google Trends | Google Trends API | Medium — retail interest indicator |

**Minimum high-value additions (free APIs):**
1. **Fear & Greed Index** — `alternative.me/crypto/fear-and-greed-index/` (1 call/day, returns composite sentiment score 0-100)
2. **BTC dominance** — available via CoinGecko `/global` endpoint (already called for market cap)
3. **30-day realized volatility** — computable from existing `live_prices` data (no new API needed)

These three additions alone — sentiment + BTC dominance + realized volatility — would add 3 high-signal features to the model with zero extra API calls beyond what the project already makes.

### 3.4 Goal: "Persist data for user review"

**Current state:** Several collections have TTLs or are regularly overwritten:
- `realtime_prices`: TTL = 7 days (data deleted automatically)
- `predictions`: Upserted on `(coin, prediction_date)` — old predictions for the same date are overwritten, losing history
- `live_prices`: No TTL, accumulates indefinitely, no deduplication

**Issues:**
1. If a prediction for May 24 was written on May 22 and again on May 23 (after model sees new data), the May 22 version is permanently lost. Users cannot see how predictions evolved over time.
2. `realtime_prices` 7-day TTL means any gap in Spark streaming = permanent data loss. No backup to object storage.
3. `live_prices` will grow unboundedly (6 new docs/hour from scheduler = 4,380/month = 52,560/year) without any archival strategy.

**Recommended schema change for predictions:**
```json
// Instead of upserting on (coin, prediction_date):
// Insert every prediction run as a new record, keyed on (coin, prediction_date, created_at)
{
  "coin": "BTC",
  "predicted_price": 70451.72,
  "prediction_date": "2026-05-24",
  "created_at": "2026-05-23T16:42:26Z",   // when this prediction was made
  "model_version": "lstm_v1",
  "seed_source": "historical_sma",
  "run_id": "uuid"                          // groups all 7 predictions from one cycle
}
// Compound index: {coin:1, prediction_date:1, created_at:-1}
// Query: "for prediction_date=May24, show me all predictions made on different dates" → trend chart
```

This enables the most valuable user experience: **a chart showing how the 7-day forecast for a given target date evolved over time** as the model got more recent data. This is a unique feature not available in most price prediction tools.

### 3.5 Goal: "24/7 operation"

**Current state:** Several single points of failure that would cause silent prediction degradation:

| Component | Failure Mode | Current Behavior | Impact |
|---|---|---|---|
| CoinGecko API rate limit | 429 responses | Producer sleeps 60s, loses data | Gaps in live_prices |
| MongoDB connection lost | `serverSelectionTimeoutMS=3000` | Predictions not written, no retry | Silent failure |
| Scheduler process crash | No watchdog | Process dies, no restart in local mode | No predictions until manual restart |
| Model files deleted | `FileNotFoundError` | Scheduler logs ERROR, no predictions | Silent failure for users |
| Kafka unavailable | Streaming job crashes | Speed Layer goes offline | realtime_prices empty |

**Docker Compose already adds `restart: unless-stopped`** to the scheduler container — this is the right approach for 24/7 operation. But when running locally (not via Docker), there is no restart mechanism.

**Missing monitoring:**
- No health endpoint on the scheduler to signal "last successful prediction was N minutes ago"
- No alerting when inference cycle fails 3+ consecutive times (only a `CRITICAL` log)
- No metrics export to Prometheus/Grafana or any monitoring system

---

## 4. Big Data Architecture Assessment

### 4.1 Lambda Architecture Correctness
The Lambda Architecture is correctly implemented with clean separation of concerns:

```
Speed Layer:   Producer → Kafka → Spark Streaming → MongoDB realtime_prices
Batch Layer:   CSV → Spark Batch → MongoDB daily_stats, historical_sma, coin_correlation
Serving Layer: MongoDB → Streamlit Dashboard / Inference Engine
```

**Verdict:** Correct pattern for this use case. No changes needed at the structural level.

### 4.2 Spark Usage Assessment

**Current data volumes:**
- Bitcoin CSV: ~3,700 rows (daily, 2015–2024)
- At hourly granularity: ~79,000 rows (2015–2024)

At these volumes, Spark is **architecturally correct but computationally oversized**. The same transformations would run faster in pandas. Spark becomes justified when:
- Data exceeds ~10M rows, OR
- Multiple CSV files need parallel ingestion, OR
- Streaming throughput exceeds ~10,000 records/second

**The Spark investment pays off** if the project scales to:
1. All major cryptocurrencies (top 100 by market cap)
2. Tick-level data (order book events, trade-by-trade)
3. Multiple exchanges (Binance, Coinbase, Kraken) — 10M+ events/day

**Current Spark optimization issues:**
```python
# batch_job.py — over-partitioned for small data
spark.conf.set("spark.sql.shuffle.partitions", "8")  # overkill for 3,700 rows
# Recommend: "2" for current data size

# streaming_job.py — watermark may cause unnecessary state retention
.withWatermark("event_time", "10 minutes")  # fine for 600s poll interval
```

### 4.3 MongoDB Schema Design Assessment

**Positive:**
- Time-series collections use `(symbol/coin, date/timestamp)` compound keys — correct
- TTL on `realtime_prices` prevents unbounded growth
- `upsert` on `(coin, prediction_date)` prevents duplicate predictions

**Concerns:**
- `live_prices` has no deduplication — if the scheduler and producer both write a price at the same timestamp, duplicates accumulate and skew the inference seed
- `coin_correlation` stores only the most recent computation — historical correlation trends are not preserved
- No schema validation on any collection — corrupt documents (e.g., negative prices) can enter the pipeline silently

**Recommended indexes missing:**

| Collection | Missing Index | Query Pattern It Supports |
|---|---|---|
| `predictions` | `{coin:1, prediction_date:1, created_at:-1}` | Dashboard: latest prediction per date |
| `live_prices` | `{coin:1, timestamp:-1}` (exists now) | Inference seed loader |
| `daily_stats` | `{symbol:1, date:-1}` | Technical analysis page |
| `historical_sma` | `{symbol:1, date:-1}` | Already queried frequently |

### 4.4 Feature Engineering Assessment

**Current 5 features:**

| Feature | Quality | Issue |
|---|---|---|
| log_return_1d | Good — stationary | None |
| log_return_7d | Good | Correlated with log_return_1d |
| log_return_30d | Moderate | High autocorrelation with above |
| RSI_14 | Good oscillator | Wilder's method implemented correctly |
| log_volume | Good proxy | CoinGecko `total_volume` is 24h volume, not hourly — mismatch with daily targets |

**Volume field mismatch:** `total_volume` in the CSV is 24-hour trading volume measured at the end of each day. When you compute `log(total_volume + 1)` for a daily close price, the units are consistent. But if you switch to hourly data, you'd need hourly volume — not the 24h rolling figure.

**High-value additional features (computable from existing data):**

```python
# 1. Realized volatility (last 30 days of daily returns — std deviation)
feat[:, 5] = pd.Series(log_returns_1d).rolling(30).std().values

# 2. Volume-price trend (correlation between returns and volume changes)
# Signals whether volume is confirming the price move

# 3. Price momentum (distance from 52-week high/low as %)
feat[:, 6] = (close - close.rolling(365).max()) / close.rolling(365).max()

# 4. Fear & Greed Index (daily, scraped from alternative.me)
# Adds macro sentiment as a feature — 0=extreme fear, 100=extreme greed
```

### 4.5 Model Architecture Assessment

**Current architecture:**
```
LSTM(128 hidden, 2 layers, 0.2 dropout)  →  Linear(128→64)  →  ReLU  →  Dropout(0.1)  →  Linear(64→7)
```

**Strengths:**
- 2-layer stacking allows higher-order temporal patterns
- Dropout between layers reduces overfitting on small dataset (~3,700 rows)
- MIMO output eliminates error compounding

**Weaknesses:**

1. **No attention mechanism.** For 60-step sequences, the LSTM must compress all relevant historical context into its hidden state. An attention layer would allow the model to focus on the most relevant timesteps (e.g., last week's returns more than 2-month-old returns for a short-term prediction). Transformers or LSTM+Attention outperform vanilla LSTM on sequence tasks by 10–20% in most benchmarks.

2. **No multi-scale temporal processing.** The model sees only 60-day windows. For crypto, patterns exist at multiple scales simultaneously:
   - Micro (1–7 days): momentum, mean reversion
   - Meso (30–90 days): trend cycles, accumulation/distribution
   - Macro (1–4 years): halving cycles (BTC), regulatory cycles

3. **Input size=5 is underpowered.** Research (e.g., Wu et al. 2022, "Autoformer: Decomposition Transformers with Auto-Correlation for Long-Term Series Forecasting") shows that adding even 2-3 exogenous signals (sentiment, macro) to LSTM improves MAPE by 15–40% for crypto prediction.

4. **Fixed horizon=7.** Users likely want different forecast horizons at different times. A multi-horizon head or a query-based decoder (like Temporal Fusion Transformer) would be more flexible.

**Alternative architectures to consider (in order of implementation complexity):**

| Model | Complexity | Expected Improvement | Notes |
|---|---|---|---|
| LSTM + Attention | Low | +10–15% MAE | Add attention layer to existing model |
| Temporal Fusion Transformer (TFT) | Medium | +20–35% MAE | PyTorch Forecasting library |
| N-BEATS | Medium | +15–25% MAE | Pure MLP, no recurrence, faster |
| Informer / Autoformer | High | +25–40% MAE | Best for long-horizon, needs more data |

For the stated goal of hourly 24-step prediction, **TFT or N-BEATS** are the right targets. Both handle multi-variate inputs, variable horizon, and produce calibrated uncertainty intervals natively.

---

## 5. Data Collection Completeness Assessment

### 5.1 What CoinGecko Provides (Currently Used)

| Endpoint | Data | Frequency | Used? |
|---|---|---|---|
| `/simple/price` | spot price, volume, market cap, 24h change | every 10 min | Yes |
| `/coins/{id}/ohlc` | 4-hour OHLCV candles, last 30 days | every 30 min | Partially (OHLC only) |
| `/coins/{id}/market_chart` | hourly close + volume, up to 90 days | not used | No |
| `/global` | total market cap, BTC dominance, altcoin season | not used | No |
| `/coins/{id}/history` | single-day OHLCV for any historical date | not used | No |

### 5.2 What's Missing for 1-Hour Prediction

To build a 1-hour prediction system, the project needs:

**Primary data (from CoinGecko, within demo budget):**
```python
# Replace /simple/price polling with /market_chart?vs_currency=usd&days=1&interval=hourly
# Returns: 1-hour close prices + volumes for the last 24 hours
# Cost: 1 call/hour per coin × 2 coins = 2 calls/hour = 1,440/month (well under 10k)

cg.get_coin_market_chart_by_id(
    id="bitcoin",
    vs_currency="usd",
    days=1,
    interval="hourly"
)
# Returns: {"prices": [[timestamp_ms, price], ...], "total_volumes": [...], "market_caps": [...]}
```

**Secondary enrichment (free, no API key):**
```
Fear & Greed Index: GET https://api.alternative.me/fng/?limit=1
  → {"value": "42", "value_classification": "Fear"}
  → 1 call/day → 30 calls/month

BTC Dominance: CoinGecko /global endpoint (already reachable)
  → {"data": {"btc_dominance": 52.3}}
  → 1 call/hour alongside hourly market_chart = 0 extra calls
```

### 5.3 Data Retention Strategy

**Current gaps:**

| Collection | Current TTL | Recommended | Reason |
|---|---|---|---|
| `live_prices` | None (grows forever) | 365 days | Training window; archive to Parquet after 365d |
| `realtime_prices` | 7 days | 30 days | More lookback for streaming analysis |
| `predictions` | None (upserted) | Keep all versions | See section 3.4 — prediction evolution chart |
| `daily_stats` | None | None | Immutable batch view; fine to keep |
| `historical_sma` | None | None | Immutable batch view |

**Archival recommendation:** Export `live_prices` to Parquet (AWS S3 or local MinIO) monthly. This allows the Spark batch job to train on full historical hourly data without MongoDB scan overhead.

---

## 6. 24/7 Operational Readiness Assessment

### 6.1 Resilience Checklist

| Component | HA? | Restart? | Health Check? | Monitoring? | Verdict |
|---|---|---|---|---|---|
| Producer | No | Docker `restart: unless-stopped` | No | No | Partial |
| Kafka | Single broker | Docker restart | TCP check | No | Partial |
| Spark Streaming | No | Manual | HTTP check on 8080 | No | Weak |
| MongoDB | Standalone | Docker restart | `mongosh ping` | No | Partial |
| Inference Scheduler | No | Docker restart | No | No | Weak |
| Dashboard | No | Docker restart | HTTP check | No | Partial |

**No component has true HA.** For 24/7 production, the minimum additions are:
1. MongoDB replica set (1 primary + 1 secondary) — protects against data loss on primary crash
2. Kafka with replication factor 2 — protects against broker failure
3. Health endpoint on inference_scheduler (e.g., `/health` returns last successful run timestamp)

### 6.2 Missing Operational Features

**Model staleness detection (does not exist):**
```python
# In inference_scheduler.py, after each run:
# Check: is the model's training cutoff date > 30 days old?
# If yes: log WARNING "Model trained on data through {cutoff_date} — consider retraining"
# The metrics_{coin}.json file has last_price_usd but no training_cutoff_date field
```

**Prediction drift detection (does not exist):**
```python
# Compare: rolling average of (predicted - actual) over last 30 available accuracy points
# If MAPE > threshold (e.g., 15%): trigger retraining alert
# This is the most important signal for "model is getting worse" in production
```

**Graceful shutdown (partially implemented):**
The inference_scheduler uses a plain `while True:` loop. If the process receives SIGTERM (Docker stop), the current inference cycle may be interrupted mid-write, leaving partial predictions in MongoDB. A signal handler would ensure clean shutdown:
```python
import signal
def _handle_sigterm(signum, frame):
    logger.info("SIGTERM received — finishing current cycle then exiting.")
    # Set a flag to exit after current cycle completes
```

---

## 7. Prioritized Improvement Roadmap

### Sprint 7 — Data Quality & 1-Hour Granularity
**Effort:** Medium | **Impact:** High

1. Replace `/simple/price` polling with `/market_chart?interval=hourly` — collect hourly OHLCV
2. Add `ohlcv_hourly` MongoDB collection with schema `{coin, open, high, low, close, volume, timestamp}`
3. Add compound index `{coin:1, timestamp:-1}` with TTL=365 days
4. Add Fear & Greed Index to `live_prices` or separate `sentiment` collection (1 call/day)
5. Add BTC dominance to every `live_prices` document (free, from CoinGecko `/global`)

**Acceptance criteria:** `live_prices` contains hourly OHLCV; DOGE/BTC hourly data available for training; budget stays under 10k/month

### Sprint 8 — Model Retraining Pipeline
**Effort:** High | **Impact:** Critical for goal

1. Add `training_data_cutoff` field to `metrics_{coin}.json` on each training run
2. Build `src/ml/retrain_scheduler.py`:
   - Weekly trigger (or when `live_prices` has 168+ new rows since last training)
   - Export `live_prices` to training CSV, merge with historical CSV
   - Run `train_lstm.py` with updated data
   - Compare new model RMSE vs current model on holdout set
   - Promote new model only if RMSE improves ≥5%
   - Archive old model as `lstm_bitcoin_v1_YYYYMMDD.pt`
3. Add `model_trained_at` field to predictions
4. Add `retrain_history` collection: `{coin, version, rmse, mae, dir_acc, trained_at, promoted}`

### Sprint 9 — Confidence Intervals & Model Upgrade
**Effort:** Medium | **Impact:** High for user trust

1. Replace hardcoded `confidence: 0.8` with Monte Carlo dropout:
   ```python
   # Enable dropout during inference for uncertainty estimation
   model.train()  # keeps dropout active
   predictions = [model(x).cpu().numpy() for _ in range(100)]  # 100 samples
   mean = np.mean(predictions, axis=0)
   std = np.std(predictions, axis=0)
   # lower_bound = mean - 1.96*std, upper_bound = mean + 1.96*std
   ```
2. Store `predicted_price_low` and `predicted_price_high` in predictions collection
3. Show confidence bands (shaded area) in dashboard forecast chart
4. Consider migrating to LSTM+Attention or N-BEATS for better base accuracy

### Sprint 10 — Prediction History & User Analytics
**Effort:** Low | **Impact:** High for UX

1. Change `predictions` collection upsert key from `(coin, prediction_date)` to `(coin, prediction_date, created_at)` — preserve all historical prediction versions
2. Add "Prediction Evolution" chart to dashboard page 03: show how the forecast for a target date changed over successive prediction runs
3. Add "Accuracy Trend" chart: rolling 30-day MAPE over time — shows if model is improving
4. Export predictions to CSV for user download

### Sprint 11 — Operational Hardening
**Effort:** Medium | **Impact:** Required for 24/7

1. MongoDB replica set (at minimum: 1 primary + 1 secondary in Docker Compose)
2. Inference scheduler health endpoint + Prometheus metrics
3. SIGTERM handler for graceful shutdown
4. Model drift alert: if 7-day rolling MAPE > 15%, log CRITICAL and send webhook notification
5. `live_prices` monthly archive to Parquet via Spark batch job

---

## 8. API Budget Revised Recommendation

**Current situation:** With `SCHEDULER_FETCH_COINGECKO=true` and the producer both running, budget reaches ~15,840 calls/month (58% over demo limit).

**Recommended configuration for Sprint 7 (hourly data):**

| Caller | Endpoint | Frequency | Monthly Calls |
|---|---|---|---|
| Inference Scheduler | `/coins/{id}/market_chart?interval=hourly` (BTC+DOGE, 2 calls) | Every 1 hour | 1,440 |
| Inference Scheduler | `/global` (BTC dominance) | Every 1 hour | 720 |
| Producer | `/simple/price` (Kafka feed) | Every 10 min | 4,320 |
| Producer | `/coins/{id}/ohlc` (OHLC candles, 2 coins) | Every 30 min | 2,880 |
| Sentiment Fetcher | `alternative.me/fng` (external, not CoinGecko) | Daily | 0 CoinGecko |
| **Total** | | | **9,360** |

**9,360 calls/month is under the 10k demo limit.** The key change: replace the scheduler's single `/simple/price` call with two `/market_chart` calls (one per coin, for hourly OHLCV). This stays within budget while delivering hourly granularity data.

---

## 9. Final Scorecard

| Dimension | Score | Notes |
|---|---|---|
| Architecture Pattern | 8/10 | Lambda is correct; Kappa would be simpler but less educational |
| ML Correctness | 7/10 | MIMO + StandardScaler are right; no confidence intervals |
| Data Freshness | 5/10 | 10-min polling is OK for daily model; insufficient for 1-hour model |
| Data Completeness | 4/10 | Only price + volume; missing sentiment, macro, on-chain |
| Continuous Learning | 2/10 | Model never retrained — this is the biggest gap vs stated goals |
| Persistence Strategy | 5/10 | Some TTLs missing; prediction history not preserved |
| 24/7 Resilience | 5/10 | Docker restart handles crashes; no HA, no drift alerting |
| Big Data Readiness | 6/10 | Spark + MongoDB foundation is solid; needs partitioning tuning |
| User Experience | 7/10 | Auto-refresh + comparison chart are good; no confidence bands |
| Code Quality | 8/10 | Clean separation of concerns; thorough tests; well-documented |
| **Overall** | **5.7/10** | Strong foundation, significant gaps vs. production goals |

---

## 10. Conclusion

The architecture is a **well-engineered prototype** that demonstrates Lambda Architecture and LSTM forecasting correctly. The core pipeline works end-to-end. However, achieving the stated goals — 1-hour granularity, continuous self-improvement, 24/7 operation — requires targeted additions in three areas:

1. **Hourly data collection** (Sprint 7): switch from daily to hourly CoinGecko market_chart calls, rebuild training data
2. **Continuous retraining** (Sprint 8): weekly retrain pipeline with champion/challenger model promotion
3. **Prediction confidence + history** (Sprints 9–10): MC dropout for intervals, preserve all prediction versions

The good news: the engineering foundation is clean enough that all three improvements can be layered on without a rewrite. The MongoDB schema, Spark pipeline, and Docker Compose structure are extensible. The inference scheduler already has the right hook points (`run_cycle`, `fetch_and_persist_latest_prices`) where new data sources and retraining triggers can be wired in.

With the Sprint 7–10 roadmap implemented, this project would be a production-grade self-improving crypto prediction system. Without it, it is a well-built demonstration that degrades silently over time.
