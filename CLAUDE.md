# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lambda Architecture implementation for real-time and batch cryptocurrency analytics (Bitcoin + Dogecoin). Covers: Kafka ingestion → Spark streaming/batch → MongoDB serving → dual-head LSTM forecasting → Streamlit dashboard + React frontend + FastAPI backend.

## Environment Setup

```bash
cp .env.example .env   # then set COINGECKO_API_KEY
```

Key env vars: `COINGECKO_API_KEY`, `KAFKA_BOOTSTRAP_SERVERS`, `MONGO_URI`, `SPARK_MASTER`, `POLL_INTERVAL_SECONDS`, `COINGECKO_COIN_IDS`.

## Common Commands

### Infrastructure

```bash
make docker-up          # Start all 9 services
make docker-down        # Stop all
make docker-logs        # Follow logs

# Manual compose
docker compose -f docker/docker-compose.yml up -d
```

### Batch & Inference

```bash
make batch              # Submit Spark batch job
bash scripts/run_batch.sh           # Populate historical MongoDB collections
bash scripts/run_inference.sh       # Train LSTM + run inference for both coins

make train-btc          # Train BTC LSTM only
make train-doge         # Train DOGE LSTM only
make infer-all          # Train + infer both coins

python src/ml/train_lstm.py --coin bitcoin --epochs 50
python src/ml/inference.py --coin bitcoin
```

### Testing

```bash
make test               # Full pytest suite
make test-producer      # Producer tests only
make test-lstm          # ML tests only
make test-batch         # Batch job tests
make test-dashboard     # Dashboard + indicators + mongo_writer

# E2E (requires running infrastructure)
make e2e
make e2e-layer-1        # Producer → Kafka
make e2e-layer-2        # Spark Batch → MongoDB
make e2e-layer-3        # ML Pipeline → MongoDB

# Single test
pytest tests/test_lstm.py::TestLSTMModel::test_forward -v
```

### Kafka

```bash
bash scripts/create_topics.sh       # Create crypto_raw topic
bash scripts/verify_acceptance.sh   # Run acceptance criteria checks
```

## Service URLs

| Service | URL |
|---------|-----|
| Streamlit Dashboard | http://localhost:8501 |
| React Frontend | http://localhost:3000 |
| FastAPI Backend | http://localhost:8000 |
| Kafka UI | http://localhost:8080 |
| Spark Web UI | http://localhost:8081 |
| MongoDB | localhost:27017 (admin/password123) |

## Architecture

### Data Flow

```
CoinGecko API (pycoingecko, 10-min polling)
    → Kafka (topic: crypto_raw)
    → Spark Structured Streaming (5-min windows, SMA/RSI/Bollinger/VWAP/ATR)
    → MongoDB

CSV data / historical prices
    → Spark Batch (daily_stats, historical_sma, coin_correlation)
    → MongoDB

MongoDB
    → FastAPI (JWT auth, REST endpoints, port 8000)
    → Streamlit Dashboard (port 8501)
    → React Frontend (port 3000)

LSTM Inference Scheduler (5-min)
    → Reads MongoDB/CSV history
    → Writes 7-day predictions → MongoDB (predictions collection)
```

### MongoDB Collections

- `realtime_prices` — speed layer output from Spark Streaming
- `daily_stats` — batch layer aggregation
- `historical_sma` — batch SMA across time windows
- `coin_correlation` — BTC/DOGE rolling correlation
- `predictions` — LSTM 7-day forecasts

### ML Model (`src/ml/`)

- **Architecture**: 2-layer LSTM, 128 hidden units, dual-head output
  - Regression head: next-day price (HuberLoss)
  - Classification head: trend direction (CrossEntropyLoss)
- **Sequence length**: 60 timesteps
- **Training**: `train_lstm.py --coin bitcoin|dogecoin --epochs N`
- **Artifacts**: `src/ml/model/lstm_{coin}_v2.pt`, `scaler_{coin}.pkl`
- **Inference**: `inference.py` generates 7-day forecast → MongoDB; `intraday_inference.py` reads from Kafka for real-time

### Spark Jobs

- **Streaming** (`src/spark/streaming_job.py`): foreachBatch writes, 10-min watermark for late data, UTC timezone, WARN log level, checkpoint persistence
- **Batch** (`src/spark/batch_job.py`): daily aggregation, submitted via `scripts/run_batch.sh`
- **Indicators** (`src/spark/utils/indicators.py`): SMA, RSI, VWAP, Bollinger Bands, ATR

### Frontend (`src/frontend/`)

React 19 + TypeScript + Vite + Tailwind. Pages: Dashboard, Realtime, Technical, Predictions, Correlation. API client in `src/api/client.ts` uses Axios pointed at FastAPI backend.

### Docker Compose Services (9 total)

Zookeeper, Kafka, Kafka UI, MongoDB, Spark Master, Spark Worker, Producer, Dashboard (Streamlit), API (FastAPI), Frontend (React/Nginx), Inference Scheduler.

## Key Architectural Constraints

- **Rate limiting**: CoinGecko demo tier = 10k calls/month; producer polls every 600s (configurable via `POLL_INTERVAL_SECONDS`)
- **Kafka producer**: `acks=all`, `retries=3`, `linger_ms=100`
- **All MongoDB writes from Spark**: via `foreachBatch`, not direct streaming sinks
- **Model versioning**: trained artifacts use `_v2` suffix; update scripts if retraining
- **E2E tests**: require live infrastructure; marked with `@pytest.mark.e2e` and excluded from default `pytest` run (see `pytest.ini`)
