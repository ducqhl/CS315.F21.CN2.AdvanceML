# Final Project Report
# Crypto Big Data Lambda Architecture System

**Course:** Big Data / Data Engineering
**Architecture:** Lambda Architecture (Batch + Speed + Serving Layer)
**Date:** 2026-05-17

---

## 1. System Architecture

### 1.1 Lambda Architecture Overview (ASCII)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             DATA SOURCES                                 │
│                                                                          │
│    CoinGecko REST API (7 coins, 60 s polling)   data/sample/*.csv        │
│    bitcoin, ethereum, dogecoin, ...              (BTC/ETH/DOGE daily)    │
└────────────────┬────────────────────────────────────────┬────────────────┘
                 │                                        │
    ┌────────────▼────────────┐             ┌────────────▼────────────┐
    │      SPEED LAYER        │             │      BATCH LAYER         │
    │                         │             │                          │
    │  Python Kafka Producer  │             │  data/sample/bitcoin.csv │
    │  (crypto_producer.py)   │             │  data/sample/ethereum.csv│
    │          │              │             │  data/sample/dogecoin.csv│
    │          ▼              │             │          │               │
    │  Kafka Broker :9092     │             │          ▼               │
    │  topic: crypto_raw      │             │  Spark Batch Job         │
    │  (3 partitions, 7d TTL) │             │  (batch_job.py)          │
    │          │              │             │   - daily_stats          │
    │          ▼              │             │   - historical_sma       │
    │  Spark Structured       │             │   - coin_correlation     │
    │  Streaming Job          │             │          │               │
    │  (streaming_job.py)     │             └──────────┼───────────────┘
    │   - SMA-20/50           │                        │
    │   - RSI-14              │                        │
    │   - VWAP                │                        │
    │   - Bollinger Bands     │                        │
    └────────────┬────────────┘                        │
                 │                                     │
                 └────────────────┬────────────────────┘
                                  │
                       ┌──────────▼──────────┐
                       │    SERVING LAYER     │
                       │       MongoDB        │
                       │   db: crypto_db      │
                       │                      │
                       │  realtime_prices     │ ← Speed Layer output
                       │  daily_stats         │ ← Batch Layer output
                       │  historical_sma      │ ← Batch Layer output
                       │  coin_correlation    │ ← Batch Layer output
                       │  predictions         │ ← ML Layer output
                       │  alerts              │ ← Speed Layer output
                       └──────────┬───────────┘
                                  │
                       ┌──────────▼──────────┐
                       │    ML LAYER          │
                       │                      │
                       │  LSTM Training       │
                       │  (train_lstm.py)     │
                       │   - 2-layer LSTM     │
                       │   - hidden=128       │
                       │   - seq_len=60       │
                       │          │           │
                       │          ▼           │
                       │  Inference           │
                       │  (inference.py)      │
                       │   - 7-day forecast   │
                       │   - upsert → MongoDB │
                       └──────────┬───────────┘
                                  │
                       ┌──────────▼──────────┐
                       │   STREAMLIT          │
                       │   DASHBOARD          │
                       │   port :8501         │
                       │                      │
                       │  Page 1: Real-time   │
                       │  Page 2: Technical   │
                       │  Page 3: Predictions │
                       │  Page 4: Correlation │
                       └─────────────────────┘
```

### 1.2 Data Lineage

```
CoinGecko API
    → kafka-python producer (crypto_raw topic)
        → Spark Structured Streaming (watermark 10 min, window 5 min)
            → MongoDB: realtime_prices (TTL 7 days)
                → Streamlit Page 1 (live prices, SMA, RSI)
                → Streamlit Page 2 (candlestick, technical analysis)

data/sample/bitcoin.csv (3,373 daily rows, 2015–2024)
    → Spark Batch Job
        → MongoDB: daily_stats, historical_sma, coin_correlation
            → Streamlit Page 4 (correlation heatmap)
            → LSTM preprocess.py (MinMaxScaler, 60-step sequences)
                → train_lstm.py (50 epochs, Adam, MSE loss)
                    → lstm_btc.pt  (model weights)
                    → scaler.pkl   (fitted MinMaxScaler)
                    → metrics.json (RMSE, MAE, directional accuracy)
                    → inference.py (7-day iterative forecast)
                        → MongoDB: predictions
                            → Streamlit Page 3 (forecast chart)
```

---

## 2. Sprint Summary Table

| Sprint | Deliverable | Files | Status |
|--------|-------------|-------|--------|
| **Sprint 1** | Kafka Producer — polls CoinGecko every 60 s, publishes to `crypto_raw` | `src/producer/crypto_producer.py` | Complete |
| **Sprint 2** | Spark Structured Streaming — SMA, RSI, VWAP, Bollinger Bands → `realtime_prices` | `src/spark/streaming_job.py`, `src/spark/utils/indicators.py`, `src/spark/utils/mongo_writer.py` | Complete |
| **Sprint 3** | Spark Batch Job — daily stats, historical SMA, 14×14 correlation matrix | `src/spark/batch_job.py` | Complete |
| **Sprint 4** | Streamlit Dashboard — 4-page app, candlestick + RSI, correlation heatmap | `src/dashboard/app.py`, `src/dashboard/pages/` | Complete |
| **Sprint 5** | LSTM Model — preprocess, train (50 epochs), evaluate, 7-day inference → MongoDB | `src/ml/preprocess.py`, `src/ml/model.py`, `src/ml/train_lstm.py`, `src/ml/inference.py` | Complete |
| **Sprint 6** | Dashboard integration — Page 3 shows real forecast; run scripts; 109 tests | `src/dashboard/pages/03_prediction.py`, `scripts/run_inference.sh`, `scripts/run_all.sh`, `tests/test_lstm.py` | Complete |

---

## 3. LSTM Model Performance Metrics

Metrics are computed on the held-out test set (chronological last 15% of 3,313 sequences) after training on `data/sample/bitcoin.csv` (3,374 daily rows, 2015–2024).

| Metric | Value | Notes |
|--------|-------|-------|
| RMSE | _see `src/ml/model/metrics.json`_ | Target: < $2,000 |
| MAE | _see `src/ml/model/metrics.json`_ | Lower is better |
| Directional Accuracy | _see `src/ml/model/metrics.json`_ | Target: > 50% (beats random) |
| Epochs trained | Up to 50 (early stopping with patience=10) | |
| Training dataset | BTC daily close price, 2015–2024 | Univariate, MinMaxScaler |
| Sequence length | 60 days | |
| Forecast horizon | 7 days (iterative / autoregressive) | |

> Run `python src/ml/train_lstm.py` to reproduce. Metrics are saved automatically to `src/ml/model/metrics.json`.

### Model Architecture

```
Input:  (batch, 60, 1)            — 60-day close price sequence
         │
         ▼
LSTM Layer 1 (hidden=128, dropout=0.2)
         │
LSTM Layer 2 (hidden=128)
         │
         ▼  last hidden state → (batch, 128)
FC:   Linear(128 → 64) → ReLU → Dropout(0.1) → Linear(64 → 1)
         │
         ▼
Output: (batch, 1)                — normalised next-day close price
```

**Training configuration:**
- Optimiser: Adam, lr=0.001, weight_decay=1e-5
- Loss: MSELoss
- Batch size: 32, shuffle=False (time-ordered)
- Gradient clipping: max_norm=1.0
- LR scheduler: ReduceLROnPlateau (patience=5, factor=0.5)
- Early stopping: patience=10 epochs on val_loss

---

## 4. Big Data Concepts Demonstrated

| Concept | Implementation |
|---------|----------------|
| **Lambda Architecture** | Speed Layer (Kafka + Spark Streaming) + Batch Layer (CSV + Spark Batch) + Serving Layer (MongoDB) |
| **Stream Processing** | Spark Structured Streaming with 10-min watermark and 5-min sliding windows |
| **Batch Processing** | Spark batch job on 3,373-row historical CSV; SMA-20/50/200, daily OHLCV, Pearson correlation |
| **Fault Tolerance** | Kafka `acks="all"`, `retries=3`; Spark checkpointing at `/tmp/spark-checkpoints` |
| **Watermarking** | `withWatermark("event_time", "10 minutes")` handles late-arriving data |
| **Window Functions** | `rowsBetween(-N+1, 0)` for SMA; sliding `window()` for VWAP |
| **NoSQL Storage** | MongoDB with TTL index (7 days on realtime_prices), compound index on (coin, event_time) |
| **ML Integration** | Offline LSTM training on batch data; online inference writes to Serving Layer |
| **Testing** | 109 pytest tests across 6 test files; no GPU dependency; all mocked external deps |

---

## 5. How to Run the Full System

### Prerequisites

```bash
# Python 3.11+
pip install torch numpy pandas scikit-learn pymongo streamlit plotly python-dotenv kafka-python pyspark

# Docker Desktop running
cp .env.example .env
```

### Option A — Full automated pipeline

```bash
bash scripts/run_all.sh
```

This single script:
1. Starts Docker stack (Kafka, Zookeeper, MongoDB, Spark)
2. Waits for health checks
3. Creates Kafka topics and MongoDB indexes
4. Runs Spark batch job
5. Trains LSTM + runs inference
6. Opens dashboard at http://localhost:8501

### Option B — Step by step

```bash
# 1. Start infrastructure
docker compose -f docker/docker-compose.yml up -d

# 2. Create topics and indexes
bash scripts/create_topics.sh
bash scripts/seed_mongo.sh

# 3. Run batch job (populates daily_stats, historical_sma, coin_correlation)
bash scripts/run_batch.sh

# 4. Start Kafka producer (publishes real-time prices every 60 s)
python src/producer/crypto_producer.py &

# 5. Train LSTM and generate 7-day forecast
bash scripts/run_inference.sh

# 6. Open dashboard
streamlit run src/dashboard/app.py
```

### Running tests

```bash
# All 109 tests
python -m pytest tests/ -v

# LSTM tests only
python -m pytest tests/test_lstm.py -v

# Dashboard tests only
python -m pytest tests/test_dashboard.py -v
```

### Useful monitoring URLs

| Service | URL |
|---------|-----|
| Streamlit Dashboard | http://localhost:8501 |
| Kafka UI | http://localhost:8080 |
| Spark Web UI | http://localhost:8081 |
| MongoDB (mongosh) | `mongosh "mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin"` |

---

## 6. File Structure

```
crypto-bigdata/
├── src/
│   ├── producer/crypto_producer.py      # Sprint 1: Kafka producer
│   ├── spark/
│   │   ├── streaming_job.py             # Sprint 2: Spark Streaming
│   │   ├── batch_job.py                 # Sprint 3: Spark Batch
│   │   └── utils/
│   │       ├── indicators.py            # RSI, SMA, VWAP, Bollinger
│   │       └── mongo_writer.py          # MongoDB write helpers
│   ├── ml/
│   │   ├── preprocess.py                # Sprint 5: Data pipeline
│   │   ├── model.py                     # Sprint 5: LSTMModel class
│   │   ├── train_lstm.py                # Sprint 5: Training script
│   │   ├── inference.py                 # Sprint 5: 7-day forecast
│   │   └── model/
│   │       ├── lstm_btc.pt              # Trained weights (after training)
│   │       ├── scaler.pkl               # Fitted MinMaxScaler
│   │       └── metrics.json             # RMSE, MAE, directional accuracy
│   └── dashboard/
│       ├── app.py                       # Sprint 4: Main entry point
│       └── pages/
│           ├── 01_realtime.py           # Live prices
│           ├── 02_technical.py          # Candlestick + indicators
│           ├── 03_prediction.py         # Sprint 6: LSTM forecast
│           └── 04_correlation.py        # Correlation heatmap
│
├── tests/
│   ├── test_producer.py                 # 20 tests
│   ├── test_indicators.py               # 25 tests
│   ├── test_mongo_writer.py             # 15 tests
│   ├── test_batch_job.py                # 20 tests
│   ├── test_dashboard.py                # 25 tests (inc. 4 for Sprint 6)
│   └── test_lstm.py                     # 21 tests (Sprint 5)
│
├── scripts/
│   ├── create_topics.sh                 # Kafka topic setup
│   ├── seed_mongo.sh                    # MongoDB indexes
│   ├── run_batch.sh                     # Spark batch submit
│   ├── run_inference.sh                 # Sprint 6: LSTM train + infer
│   └── run_all.sh                       # Sprint 6: Full pipeline
│
├── data/sample/
│   ├── bitcoin.csv                      # 3,373 daily rows, 2015–2024
│   ├── ethereum.csv                     # 3,155 daily rows
│   └── dogecoin.csv                     # 3,373 daily rows
│
├── docker/docker-compose.yml            # Kafka + Zookeeper + MongoDB + Spark
├── .env.example                         # Environment variable template
└── docs/final_report.md                 # This document
```

---

## 7. Known Limitations and Future Work

| Limitation | Impact | Mitigation / Future Work |
|-----------|--------|--------------------------|
| Univariate LSTM (close price only) | Lower accuracy than multivariate | Add volume, SMA, RSI as additional features (input_size=8) |
| 7-day autoregressive forecast drift | Error compounds with each step | Limit to 3-day forecast; use direct multi-step output |
| Sample data only 3 coins (BTC/ETH/DOGE) | Limited correlation matrix | Add full G-Research 14-coin dataset |
| No GPU training | Training ~3 minutes on CPU | Add MPS (Apple Silicon) or CUDA device detection |
| Streaming `realtime_prices` empty without running Kafka | Dashboard Page 1/2 shows placeholders | Pre-seed MongoDB with batch data for demo |
| LSTM predictions are point estimates | No uncertainty quantification | Add Monte Carlo Dropout for confidence intervals |

---

*Report generated: 2026-05-17*
