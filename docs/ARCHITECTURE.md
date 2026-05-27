# Architecture — Crypto Big Data Analytics Platform

## Overview

This platform implements the **Lambda Architecture** pattern for real-time and batch cryptocurrency analytics on Bitcoin (BTC) and Dogecoin (DOGE). The system ingests live price data, processes it through both a speed layer (streaming) and a batch layer, and exposes the results via a FastAPI backend consumed by a React frontend.

---

## Lambda Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           DATA SOURCES                                  │
│                    CoinGecko API  (pycoingecko)                         │
│                  Bitcoin + Dogecoin  ·  10-min polling                  │
└─────────────────────────┬───────────────────────────────────────────────┘
                           │
              ┌────────────▼────────────┐
              │     Kafka Producer      │   topic: crypto_raw
              │  acks=all, retries=3    │   OHLCV + market-cap payload
              └────────────┬────────────┘
                           │
          ┌────────────────┴─────────────────────┐
          │                                       │
 ┌────────▼────────┐                    ┌─────────▼────────┐
 │  SPEED LAYER    │                    │  BATCH LAYER     │
 │ Spark Streaming │                    │  Spark Batch Job │
 │ (5-min windows) │                    │  (daily agg)     │
 │ SMA/RSI/BB/VWAP │                    │  daily_stats     │
 │ realtime_prices │                    │  historical_sma  │
 └────────┬────────┘                    │  coin_correlation│
          │                             └─────────┬────────┘
          │                                       │
          └─────────────────┬─────────────────────┘
                            │
             ┌──────────────▼──────────────────┐
             │       SERVING LAYER             │
             │           MongoDB               │
             │  realtime_prices  daily_stats   │
             │  historical_sma   predictions   │
             │  model_registry   coin_corr     │
             └──────────────┬──────────────────┘
                            │
            ┌───────────────┴──────────────────────┐
            │                                       │
   ┌────────▼────────┐                    ┌─────────▼─────────┐
   │   ML Pipeline   │                    │   FastAPI Backend  │
   │   LSTM Model    │                    │   (port 8000)      │
   │   (dual-head)   │                    │   JWT auth · REST  │
   │  7-day forecast │                    │                    │
   │  model_registry │                    └─────────┬──────────┘
   └────────┬────────┘                              │
            │                              ┌────────┴────────────┐
            │                              │                      │
            │                     ┌────────▼────────┐  ┌─────────▼────────┐
            │                     │  React Frontend  │  │ Streamlit Dash   │
            │                     │  (port 3000)     │  │  (port 8501)     │
            │                     │  Candlestick,    │  │  Quick analytics │
            │                     │  Predictions,    │  │                  │
            │                     │  Model Mgmt      │  └──────────────────┘
            │                     └──────────────────┘
            │
   ┌────────▼────────────────────────┐
   │  Inference Scheduler            │
   │  • Every 5 min: predict all     │
   │    enabled models               │
   │  • Every 7 days: auto-retrain   │
   │    and register new model       │
   └─────────────────────────────────┘
```

---

## Component Details

### 1. Kafka Producer (`src/producer/crypto_producer.py`)

| Property | Value |
|----------|-------|
| Polling interval | 600s (configurable via `POLL_INTERVAL_SECONDS`) |
| Topic | `crypto_raw` |
| Producer config | `acks=all`, `retries=3`, `linger_ms=100` |
| Payload | price, volume, market_cap, 24h_change, OHLC |

### 2. Spark Streaming (`src/spark/streaming_job.py`)

| Property | Value |
|----------|-------|
| Trigger interval | 5-minute micro-batches |
| Watermark | 10 minutes (late data tolerance) |
| Indicators | SMA, RSI, Bollinger Bands, VWAP, ATR |
| Write strategy | `foreachBatch` → MongoDB `realtime_prices` |
| Checkpoint | `/tmp/spark-checkpoint` (persisted) |

### 3. Spark Batch (`src/spark/batch_job.py`)

Computes:
- `daily_stats` — OHLCV daily aggregation per coin
- `historical_sma` — SMA(20/50/200) across all historical data
- `coin_correlation` — Pearson correlation BTC ↔ DOGE (rolling 30-day window)

### 4. ML Pipeline (`src/ml/`)

**Model architecture** — 2-layer LSTM with dual heads:
- Regression head: 7-day log-return sequence → USD prices (HuberLoss)
- Classification head: 7-step trend direction DOWN/FLAT/UP (CrossEntropyLoss)
- Input: 60-timestep feature window (9 features: log_return, SMA ratios, RSI, volume ratio, fear/greed index)
- Loss: `0.3 × price_loss + 1.0 × direction_loss` (direction is the primary signal)

**Inference modes:**
- `inference.py` — 7-day daily MIMO forecast → `predictions` collection
- `intraday_inference.py` — 5-min next-step → `intraday_predictions` collection
- `inference_scheduler.py` — daemon: runs both on every cycle; auto-retrains every 7 days

### 5. FastAPI Backend (`src/api/main.py`)

All routes under `/api/`. Protected routes require `Authorization: Bearer <JWT>`.

| Route group | Description |
|-------------|-------------|
| `/api/auth/` | Login, JWT validation |
| `/api/realtime/{coin}` | Latest speed-layer price |
| `/api/historical/{coin}` | Historical close + SMA |
| `/api/technical/{coin}` | OHLCV + RSI + MACD + Bollinger Bands |
| `/api/predictions/{coin}` | 7-day LSTM forecast (filter by `model_id`) |
| `/api/intraday/{coin}` | 5-min candles + predictions |
| `/api/correlation` | BTC/DOGE correlation matrix |
| `/api/models` | Model registry CRUD |
| `/api/models/train` | Trigger async re-training |

### 6. MongoDB Collections

| Collection | Layer | Description |
|------------|-------|-------------|
| `realtime_prices` | Speed | Spark Streaming output, 5-min aggregated |
| `live_prices` | Speed | Raw CoinGecko price snapshots (from producer + scheduler) |
| `intraday_predictions` | ML | 5-min next-step LSTM predictions |
| `daily_stats` | Batch | Daily OHLCV aggregation |
| `historical_sma` | Batch | Daily close + SMA(20/50/200) |
| `coin_correlation` | Batch | BTC/DOGE Pearson correlation |
| `predictions` | ML | 7-day daily LSTM forecasts (per model) |
| `prediction_runs` | ML | Append-only log of prediction runs (for accuracy review) |
| `model_registry` | ML | Trained model metadata (path, metrics, enabled flag) |
| `training_jobs` | ML | Async training job status |
| `inference_status` | ML | Latest inference cycle result per coin |

### 7. React Frontend (`src/frontend/`)

- **Tech stack**: React 19, TypeScript, Vite, Tailwind CSS
- **Charts**: TradingView `lightweight-charts` v4 (candlestick + indicators), Recharts
- **Auth**: JWT stored in `localStorage`, intercepted by Axios

**Pages:**

| Page | Key Features |
|------|--------------|
| Dashboard | Price hero, sparklines, batch stats |
| Real-time | Candlestick chart with MA20/MA50/BB toggles |
| Technical | OHLCV chart, RSI, MACD, Bollinger Bands |
| Predictions | Day-ahead trend, model selector, 7-day forecast table |
| Correlation | BTC/DOGE Pearson correlation matrix |
| Model Mgmt | List/enable/disable/delete models, trigger re-train |

---

## Infrastructure (Docker Compose)

9 services total:

```
zookeeper → kafka → kafka-ui
mongodb
spark-master → spark-worker
producer          (depends: kafka + mongodb)
dashboard         (depends: mongodb)
inference_scheduler (depends: mongodb)
api               (depends: mongodb)
frontend          (depends: api)
```

Production overlay: `docker/docker-compose.prod.yml` adds resource limits and Nginx reverse proxy.
