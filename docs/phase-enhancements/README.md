# Phase Enhancement Plans — Agent Execution Guide

This directory contains phase-by-phase enhancement plans for the Crypto Big Data project.
Each document is written as a precise agent execution brief: exact file paths, function
signatures, schema changes, and acceptance criteria so an AI coding agent can implement
the phase without ambiguity.

## Index

| Phase | File | Goal | Status |
|---|---|---|---|
| 7 | [phase-07-hourly-data.md](phase-07-hourly-data.md) | Hourly OHLCV collection + sentiment | Pending |
| 8 | [phase-08-retraining-pipeline.md](phase-08-retraining-pipeline.md) | Continuous model retraining | Pending |
| 9 | [phase-09-confidence-intervals.md](phase-09-confidence-intervals.md) | MC dropout + model upgrade | Pending |
| 10 | [phase-10-prediction-history.md](phase-10-prediction-history.md) | Prediction history + accuracy trend | Pending |
| 11 | [phase-11-operational-hardening.md](phase-11-operational-hardening.md) | HA, monitoring, graceful shutdown | Pending |

## How to Use These Plans

Each plan follows this structure:
1. **Context** — what exists today that this phase builds on
2. **Goal** — the outcome in one sentence
3. **Dependency map** — which existing files are touched vs. new files created
4. **Step-by-step tasks** — each task has: file path, function name, exact logic, test requirements
5. **Acceptance criteria** — how to verify the phase is complete
6. **Do NOT touch** — explicit list of files the agent must leave unchanged

When executing a phase, read the plan top-to-bottom before writing any code.
Complete each numbered step in order — later steps depend on earlier ones.
Run the acceptance criteria tests after every phase before moving to the next.

## Architecture Context (Current State as of 2026-05-24)

```
src/
├── producer/
│   └── crypto_producer.py      ← CoinGecko poller, Kafka + MongoDB writer
├── spark/
│   ├── streaming_job.py        ← Spark Streaming: enriches realtime_prices
│   ├── batch_job.py            ← Spark Batch: daily_stats, historical_sma, coin_correlation
│   └── utils/
│       ├── mongo_writer.py     ← MongoDB write helpers
│       └── indicators.py       ← SMA, Bollinger, VWAP, RSI for Spark DataFrames
├── ml/
│   ├── model.py                ← LSTMModel (2-layer, hidden=128, output=7)
│   ├── preprocess.py           ← Feature engineering + StandardScaler pipeline
│   ├── train_lstm.py           ← Training script (CLI: --coin --epochs --batch-size)
│   ├── inference.py            ← run_inference(): seed → forecast → MongoDB write
│   ├── inference_scheduler.py  ← Hourly daemon: CoinGecko fetch + run_inference
│   ├── requirements.txt        ← torch, numpy, pandas, scikit-learn, pymongo, pycoingecko
│   └── Dockerfile              ← Container image for inference_scheduler
├── dashboard/
│   ├── app.py                  ← Streamlit entry point, shared MongoDB connection
│   └── pages/
│       ├── 01_realtime.py      ← Live prices (realtime_prices or daily_stats fallback)
│       ├── 02_technical.py     ← Candlestick + SMA + RSI (historical_sma)
│       ├── 03_prediction.py    ← LSTM forecast + accuracy vs actuals
│       └── 04_correlation.py   ← Coin correlation heatmap
└── api/                        ← FastAPI backend (not modified in these phases)

docker/
└── docker-compose.yml          ← All services: Kafka, MongoDB, Spark, Dashboard, Scheduler

data/
└── sample/
    ├── bitcoin.csv             ← Daily OHLCV 2015–2024 (price, total_volume, market_cap)
    ├── dogecoin.csv
    └── ethereum.csv

MongoDB collections:
  live_prices        ← Hourly CoinGecko direct writes (coin, price_usd, timestamp, ...)
  realtime_prices    ← Spark Streaming enriched (TTL=7d)
  daily_stats        ← Spark Batch daily aggregates
  historical_sma     ← Spark Batch daily + SMA_20/50/200
  coin_correlation   ← Spark Batch Pearson correlation
  predictions        ← LSTM 7-day forecast (upserted per coin+date)
  alerts             ← Price spike events
```
