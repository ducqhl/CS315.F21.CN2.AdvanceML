# Architecture Overview — Crypto Big Data Platform

**Version**: 2.0  
**Last Updated**: 2026-05-24  
**Status**: Planning → Implementation

---

## System Summary

A Lambda Architecture crypto analytics platform with real-time data ingestion (Kafka + Spark Streaming), batch processing (Spark Batch), dual-head LSTM prediction (price + direction + trend strength), and a modern React frontend with professional-grade charting.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        DATA SOURCES                              │
│  CoinGecko API (BTC, DOGE — price, OHLC, volume, Fear/Greed)    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │  Kafka Producer  │
                    │  crypto_producer │
                    │  (every 300s)    │
                    └────────┬────────┘
                             │ topic: crypto_raw
               ┌─────────────┴─────────────┐
               │                           │
    ┌──────────▼──────────┐   ┌────────────▼────────────┐
    │   SPEED LAYER        │   │   BATCH LAYER            │
    │   Spark Streaming    │   │   Spark Batch Job        │
    │   (30s micro-batch)  │   │   (daily, off-peak)      │
    │                      │   │                          │
    │  realtime_prices     │   │  daily_stats             │
    │  (TTL: 7 days)       │   │  historical_sma          │
    │                      │   │  coin_correlation        │
    └──────────────────────┘   └──────────────────────────┘
                    │                       │
                    └──────────┬────────────┘
                               │ MongoDB: crypto_db
                    ┌──────────▼────────────┐
                    │   ML INFERENCE LAYER   │
                    │   LSTM Dual-Head v2    │
                    │   (every 300s)         │
                    │                        │
                    │  predictions           │
                    │  prediction_runs (NEW) │
                    └──────────┬────────────┘
                               │
                    ┌──────────▼────────────┐
                    │   SERVING LAYER        │
                    │   FastAPI + JWT Auth   │
                    │   /api/* endpoints     │
                    └──────────┬────────────┘
                               │
                    ┌──────────▼────────────┐
                    │   PRESENTATION LAYER   │
                    │   React 19 + TypeScript│
                    │   TradingView Charts   │
                    │   Quantum Terminal UI  │
                    └───────────────────────┘
```

---

## MongoDB Collections

| Collection | Key | TTL | Purpose |
|-----------|-----|-----|---------|
| `realtime_prices` | (coin, event_time) | 7d | Speed layer enriched records |
| `daily_stats` | (symbol, date) | — | Batch daily aggregates |
| `historical_sma` | (symbol, date) | — | Daily + SMA20/50/200 |
| `coin_correlation` | (coin_a, coin_b) | — | Pearson correlation |
| `predictions` | (coin, prediction_date) | — | Latest 7-day LSTM forecast |
| `prediction_runs` | (coin, run_id) | 90d | Historical prediction runs (NEW) |
| `live_prices` | (created_at) | — | Direct CoinGecko writes |
| `users` | (username) | — | Auth users (single admin) |
| `alerts` | (ObjectId) | — | Price spike events |

---

## Architecture Documents

| Document | Description |
|----------|-------------|
| [frontend-redesign.md](./frontend-redesign.md) | React redesign: Quantum Terminal UI, TradingView charts |
| [prediction-history.md](./prediction-history.md) | Prediction history tracking: runs collection + overlay chart |
| [realtime-prediction-job.md](./realtime-prediction-job.md) | Real-time inference job: scheduler, monitoring, API |
| [authentication.md](./authentication.md) | JWT auth: single admin account, MongoDB users collection |

---

## Technology Stack

### Backend
- Python 3.11+, FastAPI 0.111+, Uvicorn
- PyMongo 4.7+
- python-jose (JWT), passlib (password hashing)
- Apache Spark 3.5.5, Kafka 7.5.0

### Frontend
- React 19, TypeScript 6, Vite 5
- **lightweight-charts** 4.x (TradingView — main crypto charts)
- **Recharts** 3.x (RSI, correlation auxiliary charts)
- Tailwind CSS 3.x
- **jwt-decode** 4.x (JWT handling)
- Lucide React (icons)

### Infrastructure
- Docker Compose (Zookeeper, Kafka, MongoDB, Spark, API, Frontend)
- MongoDB 7.0 with named volume persistence
