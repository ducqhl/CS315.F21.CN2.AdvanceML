# Crypto Big Data — Lambda Architecture

Real-time and batch price analytics for **Bitcoin (BTC)** and **Dogecoin (DOGE)** using a full Lambda Architecture: Kafka + Spark Streaming (Speed Layer), Spark Batch (Batch Layer), MongoDB (Serving Layer), LSTM price prediction (ML Layer), and a Streamlit dashboard.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             DATA SOURCES                                 │
│                                                                          │
│    CoinGecko SDK (BTC + DOGE, 600 s polling)   data/sample/*.csv        │
│    pycoingecko — /simple/price + /ohlc          (BTC/DOGE daily)        │
└────────────────┬────────────────────────────────────────┬────────────────┘
                 │                                        │
    ┌────────────▼────────────┐             ┌────────────▼────────────┐
    │      SPEED LAYER        │             │      BATCH LAYER         │
    │                         │             │                          │
    │  Python Kafka Producer  │             │  data/sample/bitcoin.csv │
    │  (crypto_producer.py)   │             │  data/sample/dogecoin.csv│
    │          │              │             │          │               │
    │          ▼              │             │          ▼               │
    │  Kafka Broker :9092     │             │  Spark Batch Job         │
    │  topic: crypto_raw      │             │  (batch_job.py)          │
    │          │              │             │   - daily_stats          │
    │          ▼              │             │   - historical_sma       │
    │  Spark Structured       │             │   - coin_correlation     │
    │  Streaming Job          │             │          │               │
    │  (streaming_job.py)     │             └──────────┼───────────────┘
    │   - SMA, RSI, VWAP      │                        │
    │   - Bollinger Bands     │                        │
    └────────────┬────────────┘                        │
                 └────────────────┬────────────────────┘
                                  │
                       ┌──────────▼──────────┐
                       │    SERVING LAYER     │
                       │       MongoDB        │
                       │   db: crypto_db      │
                       │  realtime_prices     │
                       │  daily_stats         │
                       │  historical_sma      │
                       │  coin_correlation    │
                       │  predictions         │
                       └──────────┬───────────┘
                                  │
                       ┌──────────▼──────────┐
                       │    ML LAYER          │
                       │  LSTM 2-layer        │
                       │  hidden=128          │
                       │  seq_len=60          │
                       │  7-day forecast      │
                       └──────────┬───────────┘
                                  │
                       ┌──────────▼──────────┐
                       │   STREAMLIT DASH     │
                       │   port :8501         │
                       │  Page 1: Real-time   │
                       │  Page 2: Technical   │
                       │  Page 3: Predictions │
                       │  Page 4: Correlation │
                       └─────────────────────┘
```

---

## Prerequisites

- **Docker** and **Docker Compose** (v2+)
- **Python 3.11+** (for local ML training)
- **CoinGecko demo API key** — [get one here](https://www.coingecko.com/en/api)

---

## Quick Start

```bash
# 1. Clone and enter the project
git clone <repo-url> && cd CS315.F21.CN2.AdvanceML

# 2. Set up environment variables
cp .env.example .env
# Edit .env and set COINGECKO_API_KEY=<your demo key>

# 3. Start all services (Kafka, MongoDB, Spark, Producer, Dashboard)
docker compose -f docker/docker-compose.yml up -d

# 4. Run the Spark batch job to populate historical collections
bash scripts/run_batch.sh

# 5. Open the dashboard
open http://localhost:8501
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `COINGECKO_API_KEY` | *(required)* | CoinGecko demo API key |
| `POLL_INTERVAL_SECONDS` | `600` | Producer poll interval — 10 min stays under 10k calls/month |
| `COINGECKO_COIN_IDS` | `bitcoin,dogecoin` | Coins to track |
| `OHLC_POLL_MULTIPLIER` | `3` | Fetch OHLC every Nth price cycle (every 30 min) |
| `KAFKA_BOOTSTRAP_SERVERS` | `localhost:9092` | Kafka bootstrap (use `kafka:29092` inside Docker) |
| `KAFKA_TOPIC_RAW` | `crypto_raw` | Raw prices topic |
| `MONGO_URI` | `mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin` | MongoDB connection URI |
| `SPARK_MASTER` | `spark://spark-master:7077` | Spark master URL |
| `DASHBOARD_REFRESH_SECONDS` | `30` | Real-time page auto-refresh interval |

---

## Service Ports

| Service | Port | Description |
|---|---|---|
| Kafka UI | `8080` | Kafka topic browser |
| Spark Master UI | `8081` | Spark cluster management |
| MongoDB | `27017` | Database (auth: admin/password123) |
| Streamlit Dashboard | `8501` | Main UI |

---

## LSTM Training (BTC and DOGE)

Train models and run inference locally (requires Python dependencies):

```bash
# Install ML dependencies
pip install torch numpy scikit-learn pandas pymongo

# Train + infer for both coins
bash scripts/run_inference.sh

# Or train individually:
python src/ml/train_lstm.py --coin bitcoin   # saves lstm_bitcoin_v1.pt
python src/ml/train_lstm.py --coin dogecoin  # saves lstm_dogecoin_v1.pt

# Run inference only:
python src/ml/inference.py --coin bitcoin
python src/ml/inference.py --coin dogecoin
```

Model artifacts saved to `src/ml/model/`:
- `lstm_bitcoin_v1.pt` / `lstm_dogecoin_v1.pt` — trained weights
- `scaler_bitcoin.pkl` / `scaler_dogecoin.pkl` — MinMaxScaler for inverse transform
- `metrics_bitcoin.json` / `metrics_dogecoin.json` — RMSE, MAE, directional accuracy

---

## Running Tests

```bash
# Install test dependencies
pip install pytest kafka-python requests python-dotenv pycoingecko \
            torch numpy scikit-learn pandas pyspark pymongo streamlit plotly

# Run all tests
python -m pytest tests/ -v --tb=short

# Run specific suites
python -m pytest tests/test_producer.py -v
python -m pytest tests/test_lstm.py -v
python -m pytest tests/test_batch_job.py -v
python -m pytest tests/test_dashboard.py -v
```

---

## Project Structure

```
.
├── data/sample/          # Historical CSVs (bitcoin.csv, dogecoin.csv)
├── docker/
│   └── docker-compose.yml
├── scripts/
│   ├── run_batch.sh      # Submit Spark batch job
│   ├── run_inference.sh  # Train LSTM + run inference for BTC and DOGE
│   └── create_topics.sh  # Create Kafka topics
├── src/
│   ├── producer/
│   │   ├── crypto_producer.py   # CoinGecko → Kafka (pycoingecko SDK)
│   │   └── requirements.txt
│   ├── spark/
│   │   ├── streaming_job.py     # Spark Structured Streaming
│   │   └── batch_job.py         # Spark Batch Layer
│   ├── ml/
│   │   ├── model.py             # LSTMModel definition
│   │   ├── preprocess.py        # Data loading + sequence creation
│   │   ├── train_lstm.py        # Training script (--coin arg)
│   │   └── inference.py         # 7-day forecast → MongoDB
│   └── dashboard/
│       ├── app.py               # Streamlit entry point
│       └── pages/               # 4 dashboard pages
└── tests/                       # pytest test suite
```
