# Project Planning Document
# Hệ thống Truy xuất & Dự đoán Dữ liệu Tài chính Tiền mã hoá (Crypto)

> **Môn học:** Big Data / Data Engineering  
> **Kiến trúc:** Lambda Architecture (Batch + Speed + Serving Layer)  
> **Phiên bản tài liệu:** 1.0  
> **Ngày:** 2025-05-15

---

## Mục lục

1. [Tổng quan dự án](#1-tổng-quan-dự-án)
2. [Mục tiêu và phạm vi](#2-mục-tiêu-và-phạm-vi)
3. [Kiến trúc hệ thống](#3-kiến-trúc-hệ-thống)
4. [Công nghệ sử dụng](#4-công-nghệ-sử-dụng)
5. [Nguồn dữ liệu](#5-nguồn-dữ-liệu)
6. [Chi tiết từng layer](#6-chi-tiết-từng-layer)
7. [Cấu trúc dữ liệu & Schema](#7-cấu-trúc-dữ-liệu--schema)
8. [Cài đặt & Cấu hình môi trường](#8-cài-đặt--cấu-hình-môi-trường)
9. [Kế hoạch triển khai chi tiết](#9-kế-hoạch-triển-khai-chi-tiết)
10. [Mô hình ML — LSTM](#10-mô-hình-ml--lstm)
11. [Dashboard & Visualisation](#11-dashboard--visualisation)
12. [Testing & Validation](#12-testing--validation)
13. [Rủi ro và phương án dự phòng](#13-rủi-ro-và-phương-án-dự-phòng)
14. [Phân công công việc](#14-phân-công-công-việc)
15. [Timeline tổng thể](#15-timeline-tổng-thể)
16. [Tài liệu tham khảo](#16-tài-liệu-tham-khảo)

---

## 1. Tổng quan dự án

### 1.1 Mô tả bài toán

Dự án xây dựng một **hệ thống Big Data end-to-end** cho phép:

- **Thu thập** dữ liệu giá tiền mã hoá theo thời gian thực từ CoinGecko API (Bitcoin, Ethereum, BNB, và các altcoin chính)
- **Xử lý streaming** với Apache Kafka và Apache Spark Structured Streaming, tính toán các chỉ số kỹ thuật tài chính (SMA, RSI, VWAP, Bollinger Bands)
- **Xử lý batch** dữ liệu lịch sử từ Kaggle G-Research Crypto Forecasting dataset (~14 coin, phút-level, Nov 2021 – May 2022)
- **Lưu trữ** kết quả vào MongoDB theo mô hình Serving Layer
- **Dự đoán** giá trong vòng 1 giờ tới bằng LSTM (offline-trained, inference online)
- **Trực quan hoá** toàn bộ pipeline qua Streamlit dashboard

### 1.2 Lý do chọn đề tài này

Dữ liệu giá crypto là một trong những use-case lý tưởng nhất để minh hoạ Big Data vì:

- **Tốc độ cao:** giá cập nhật liên tục (tối thiểu 60 giây/lần với CoinGecko free tier, có thể xuống sub-second với WebSocket)
- **Khối lượng lớn:** có hàng chục nghìn coin trên thị trường, mỗi coin tạo ra nhiều loại event (giá, volume, order book)
- **Đa dạng nguồn:** REST API (giá), WebSocket (real-time tick), CSV (lịch sử Kaggle), news API (sentiment)
- **Cần xử lý phức tạp:** window functions, stateful aggregation, late-arriving data handling — đây chính xác là những gì Spark Structured Streaming được thiết kế để giải quyết

### 1.3 Giá trị học thuật

Dự án này cho phép trình bày được các khái niệm Big Data cốt lõi:

| Khái niệm | Biểu hiện trong dự án |
|---|---|
| Lambda Architecture | Batch Layer (G-Research CSV) + Speed Layer (CoinGecko real-time) + Serving Layer (MongoDB) |
| Stream Processing | Kafka + Spark Structured Streaming |
| Batch Processing | Spark batch job trên historical CSV |
| Fault tolerance | Kafka replication factor, Spark checkpointing |
| Watermarking | Xử lý late-arriving data trong Spark |
| Windowing | Sliding window 5min/1h/1d cho chỉ số kỹ thuật |
| Horizontal scalability | Kafka partitions, Spark parallelism |
| NoSQL storage | MongoDB với TTL index, compound index |

---

## 2. Mục tiêu và phạm vi

### 2.1 Mục tiêu chính (must-have)

- [x] Pipeline Kafka producer/consumer hoạt động end-to-end
- [x] Spark Structured Streaming xử lý và tính chỉ số kỹ thuật real-time
- [x] Spark batch job xử lý G-Research historical dataset
- [x] MongoDB storing và serving cả batch + streaming views
- [x] Streamlit dashboard hiển thị candlestick + indicators
- [x] Docker Compose để deploy toàn bộ stack với 1 lệnh

### 2.2 Mục tiêu phụ (nice-to-have)

- [ ] LSTM prediction model (offline train, online inference)
- [ ] Kafka alerting topic khi giá thay đổi >5%
- [ ] Correlation matrix giữa các coin
- [ ] Sentiment analysis từ CryptoPanic news API

### 2.3 Ngoài phạm vi

- Không triển khai lên cloud (AWS/GCP/Azure) — local Docker là đủ
- Không cần WebSocket real-time tick-by-tick (CoinGecko REST 60s đủ)
- Không cần độ chính xác prediction cao — LSTM là showcase, không phải sản phẩm trading
- Không cần xử lý order book data

---

## 3. Kiến trúc hệ thống

### 3.1 Lambda Architecture tổng quan

```
┌─────────────────────────────────────────────────────────────────────┐
│                         DATA SOURCES                                │
│   CoinGecko REST API (real-time)    G-Research CSV (historical)     │
└──────────────────┬──────────────────────────┬───────────────────────┘
                   │                          │
         ┌─────────▼──────────┐    ┌──────────▼──────────┐
         │   SPEED LAYER      │    │    BATCH LAYER       │
         │                    │    │                      │
         │  Kafka Producer    │    │   HDFS / Local FS    │
         │       ↓            │    │         ↓            │
         │  Kafka Broker      │    │   Spark Batch Job    │
         │  (crypto_raw       │    │   (daily stats,      │
         │   crypto_alerts)   │    │   historical SMA,    │
         │       ↓            │    │   coin correlation)  │
         │  Spark Streaming   │    │         ↓            │
         │  (SMA, RSI, VWAP,  │    │   Batch Views        │
         │   Bollinger Bands) │    │                      │
         └─────────┬──────────┘    └──────────┬───────────┘
                   │                          │
                   └──────────┬───────────────┘
                              │
                    ┌─────────▼──────────┐
                    │   SERVING LAYER    │
                    │     MongoDB        │
                    │  (6 collections)   │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  Flask REST API    │
                    │  /prices /predict  │
                    │  /stats /corr      │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  Streamlit         │
                    │  Dashboard         │
                    │  (port 8501)       │
                    └────────────────────┘
```

### 3.2 Speed Layer — chi tiết luồng dữ liệu

```
CoinGecko API
    │  (HTTP GET mỗi 60s)
    ▼
Python Producer (kafka-python)
    │  serialize → JSON
    │  inject timestamp
    ▼
Kafka Broker (port 9092)
    ├── topic: crypto_raw       (3 partitions, retention 7 days)
    └── topic: crypto_alerts    (1 partition, retention 1 day)
         │
         ▼
Spark Structured Streaming Consumer
    │  readStream from Kafka
    │  parse JSON
    │  withWatermark("timestamp", "10 minutes")
    │  window("5 minutes") → SMA_5, SMA_20
    │  window("1 hour")   → RSI_14, VWAP_1h
    │  window("1 day")    → Bollinger_Bands
    ▼
MongoDB (port 27017)
    └── collection: realtime_prices
```

### 3.3 Batch Layer — chi tiết luồng dữ liệu

```
G-Research Crypto CSV (Kaggle)
    │  (~8GB, 14 coins, Nov 2021 – May 2022)
    ▼
Local FS / HDFS
    │
    ▼
Spark Batch Job
    ├── daily_stats: open/high/low/close, avg_volume mỗi ngày
    ├── historical_sma: SMA_20, SMA_50, SMA_200 (daily)
    ├── coin_correlation: Pearson correlation matrix 14×14
    └── training_data: cleaned sequences cho LSTM
    │
    ▼
MongoDB
    ├── collection: daily_stats
    ├── collection: historical_sma
    ├── collection: coin_correlation
    └── collection: training_sequences (optional)
```

### 3.4 Component versions

| Component | Version | Image |
|---|---|---|
| Apache Kafka | 3.6.x | confluentinc/cp-kafka:7.5.0 |
| Apache Zookeeper | 3.8.x | confluentinc/cp-zookeeper:7.5.0 |
| Apache Spark | 3.5.x | bitnami/spark:3.5 |
| MongoDB | 7.x | mongo:7.0 |
| Python | 3.11 | python:3.11-slim |
| Streamlit | 1.32.x | — |

---

## 4. Công nghệ sử dụng

### 4.1 Stack chính

```
Data Ingestion:     Python 3.11 + requests + kafka-python
Message Broker:     Apache Kafka 3.6 + Apache Zookeeper 3.8
Stream Processing:  Apache Spark 3.5 (PySpark Structured Streaming)
Batch Processing:   Apache Spark 3.5 (PySpark batch)
Storage:            MongoDB 7.0
ML Model:           PyTorch 2.x (LSTM)
Dashboard:          Streamlit 1.32 + Plotly
Container:          Docker 24.x + Docker Compose 2.x
```

### 4.2 Python packages

```
# requirements.txt
kafka-python==2.0.2
pyspark==3.5.1
pymongo==4.6.3
requests==2.31.0
torch==2.2.1
numpy==1.26.4
pandas==2.2.1
scikit-learn==1.4.1
streamlit==1.32.2
plotly==5.20.0
python-dotenv==1.0.1
```

### 4.3 Lý do chọn MongoDB thay vì các lựa chọn khác

| Storage | Ưu điểm | Nhược điểm | Kết luận |
|---|---|---|---|
| **MongoDB** | Schema linh hoạt, time-series collections native, TTL index, free local | Eventual consistency | **Chọn** |
| Cassandra | Write-heavy tốt, linear scale | Setup phức tạp, CQL khó debug | Quá phức tạp cho project |
| PostgreSQL | ACID, SQL familiar | Khó scale horizontally | Không phù hợp với Big Data context |
| InfluxDB | Time-series native | Ít tài liệu kết hợp Spark | Phù hợp nhưng ít dùng trong class |

---

## 5. Nguồn dữ liệu

### 5.1 CoinGecko API (Real-time — Speed Layer)

**URL:** `https://api.coingecko.com/api/v3/simple/price`  
**Authentication:** Không cần (free tier)  
**Rate limit:** 10-30 requests/phút (free), cache 60 giây  
**Coins theo dõi:** BTC, ETH, BNB, SOL, XRP, ADA, DOGE (7 coins)

**Endpoint chính:**

```
GET https://api.coingecko.com/api/v3/simple/price
    ?ids=bitcoin,ethereum,binancecoin,solana,ripple,cardano,dogecoin
    &vs_currencies=usd
    &include_24hr_vol=true
    &include_market_cap=true
    &include_24hr_change=true
    &precision=2
```

**Response mẫu:**

```json
{
  "bitcoin": {
    "usd": 67420.52,
    "usd_24h_vol": 28400000000.0,
    "usd_market_cap": 1320000000000.0,
    "usd_24h_change": 2.34
  },
  "ethereum": {
    "usd": 3521.18,
    "usd_24h_vol": 12300000000.0,
    "usd_market_cap": 423000000000.0,
    "usd_24h_change": -0.87
  }
}
```

**Lưu ý về rate limit:**

- Free tier: 250,000 lifetime API calls, không reset hàng tháng
- Thực tế: polling 7 coins mỗi 60 giây = 1 request/60s = 1440 requests/ngày
- Ở tốc độ này, 250,000 calls = ~173 ngày sử dụng — hoàn toàn đủ cho project
- Nếu cần nhiều hơn: dùng batch endpoint `/simple/price?ids=coin1,coin2,...` (đếm là 1 call)

### 5.2 G-Research Crypto Forecasting Dataset (Batch Layer)

**Source:** https://www.kaggle.com/competitions/g-research-crypto-forecasting  
**Kích thước:** ~8GB (compressed), ~1.4GB sau khi giải nén phần train  
**Time range:** Tháng 1/2018 – Tháng 6/2021 (train) + Nov 2021 – May 2022 (test)  
**Granularity:** 1 phút / record  
**Coins:** 14 assets (Asset ID 0–13)

**Schema:**

```
timestamp       int64     Unix timestamp (seconds)
Asset_ID        int8      0=Binance Coin, 1=Bitcoin, 2=Bitcoin Cash, 3=EOS,
                          4=Ethereum, 5=Ethereum Classic, 6=Litecoin,
                          7=Monero, 8=TRON, 9=Stellar, 10=Cardano,
                          11=IOTA, 12=Maker, 13=Dogecoin
Count           float64   Số lượng trades trong phút này
Open            float64   Giá mở đầu phút (USD)
High            float64   Giá cao nhất trong phút (USD)
Low             float64   Giá thấp nhất trong phút (USD)
Close           float64   Giá đóng cuối phút (USD)
Volume          float64   Khối lượng coin được giao dịch
VWAP            float64   Volume-weighted average price
Target          float64   15-min forward return (chỉ có trong train)
```

**Asset ID mapping:**

```python
ASSET_MAP = {
    0: "Binance Coin",   1: "Bitcoin",        2: "Bitcoin Cash",
    3: "EOS",            4: "Ethereum",       5: "Ethereum Classic",
    6: "Litecoin",       7: "Monero",         8: "TRON",
    9: "Stellar",       10: "Cardano",        11: "IOTA",
   12: "Maker",         13: "Dogecoin"
}
```

### 5.3 CryptoPanic API (optional — Sentiment)

**URL:** https://cryptopanic.com/api/v1/posts/  
**Authentication:** Free API key (đăng ký tài khoản)  
**Dùng cho:** Sentiment analysis từ crypto news headlines  
**Giới hạn:** 500 requests/ngày (free tier)

---

## 6. Chi tiết từng layer

### 6.1 Ingestion Layer — Python Kafka Producer

**File:** `src/producer/crypto_producer.py`

Nhiệm vụ:
- Poll CoinGecko API mỗi 60 giây
- Flatten JSON response thành 1 record / coin / timestamp
- Serialize thành JSON bytes
- Gửi vào Kafka topic `crypto_raw` với key = coin symbol

**Logic chính:**

```python
import json
import time
import requests
from kafka import KafkaProducer
from datetime import datetime, timezone

COINS = [
    "bitcoin", "ethereum", "binancecoin",
    "solana", "ripple", "cardano", "dogecoin"
]

COIN_SYMBOL_MAP = {
    "bitcoin": "BTC", "ethereum": "ETH",
    "binancecoin": "BNB", "solana": "SOL",
    "ripple": "XRP", "cardano": "ADA", "dogecoin": "DOGE"
}

producer = KafkaProducer(
    bootstrap_servers=["localhost:9092"],
    value_serializer=lambda v: json.dumps(v).encode("utf-8"),
    key_serializer=lambda k: k.encode("utf-8"),
    acks="all",                   # wait for all replicas
    retries=3,
    max_in_flight_requests_per_connection=1
)

def fetch_prices():
    url = "https://api.coingecko.com/api/v3/simple/price"
    params = {
        "ids": ",".join(COINS),
        "vs_currencies": "usd",
        "include_24hr_vol": "true",
        "include_market_cap": "true",
        "include_24hr_change": "true",
        "precision": "2"
    }
    response = requests.get(url, params=params, timeout=10)
    response.raise_for_status()
    return response.json()

def produce_loop():
    while True:
        try:
            data = fetch_prices()
            ts = datetime.now(timezone.utc).isoformat()

            for coin_id, metrics in data.items():
                record = {
                    "coin":          COIN_SYMBOL_MAP.get(coin_id, coin_id.upper()),
                    "coin_id":       coin_id,
                    "price_usd":     metrics["usd"],
                    "volume_24h":    metrics.get("usd_24h_vol", 0),
                    "market_cap":    metrics.get("usd_market_cap", 0),
                    "change_24h":    metrics.get("usd_24h_change", 0),
                    "timestamp":     ts,
                    "source":        "coingecko"
                }
                producer.send(
                    topic="crypto_raw",
                    key=record["coin"],
                    value=record
                )
            producer.flush()
            print(f"[{ts}] Produced {len(data)} records")

        except Exception as e:
            print(f"Error: {e}")

        time.sleep(60)

if __name__ == "__main__":
    produce_loop()
```

**Kafka Producer configuration quan trọng:**

| Config | Giá trị | Lý do |
|---|---|---|
| `acks="all"` | all | Đảm bảo message không mất khi broker fail |
| `retries=3` | 3 | Retry 3 lần trước khi báo lỗi |
| `max_in_flight=1` | 1 | Đảm bảo ordering khi retry |
| `key=coin_symbol` | BTC/ETH/... | Đảm bảo cùng coin vào cùng partition |

### 6.2 Kafka Topics Configuration

**Tạo topics (chạy sau khi Kafka up):**

```bash
# Topic chính — giá raw mỗi 60s
docker exec kafka kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --create \
  --topic crypto_raw \
  --partitions 3 \
  --replication-factor 1 \
  --config retention.ms=604800000  # 7 ngày

# Topic alerts — khi giá thay đổi >5%
docker exec kafka kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --create \
  --topic crypto_alerts \
  --partitions 1 \
  --replication-factor 1 \
  --config retention.ms=86400000   # 1 ngày

# Topic predictions — output của LSTM
docker exec kafka kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --create \
  --topic crypto_predictions \
  --partitions 1 \
  --replication-factor 1 \
  --config retention.ms=86400000
```

**Tại sao 3 partitions cho `crypto_raw`?**  
- 7 coins × 1 message/60s = rất nhỏ, nhưng 3 partitions cho phép 3 Spark workers đọc song song
- Key-based partitioning: BTC, ETH, BNB → partition 0; SOL, XRP → partition 1; ADA, DOGE → partition 2 (hash-based)
- Mỗi coin luôn vào cùng partition → đảm bảo ordering trong window aggregation

### 6.3 Speed Layer — Spark Structured Streaming

**File:** `src/spark/streaming_job.py`

**Logic tổng thể:**

```python
from pyspark.sql import SparkSession
from pyspark.sql.functions import (
    col, from_json, window, avg, max, min, sum,
    lag, when, stddev, lit, to_timestamp
)
from pyspark.sql.types import (
    StructType, StructField, StringType,
    DoubleType, TimestampType
)
from pyspark.sql.window import Window

# ── 1. Session ────────────────────────────────────────────
spark = SparkSession.builder \
    .appName("CryptoStreamingJob") \
    .config("spark.sql.streaming.checkpointLocation", "/tmp/spark-checkpoints") \
    .config("spark.sql.session.timeZone", "UTC") \
    .getOrCreate()

spark.sparkContext.setLogLevel("WARN")

# ── 2. Schema ──────────────────────────────────────────────
schema = StructType([
    StructField("coin",        StringType(),    True),
    StructField("coin_id",     StringType(),    True),
    StructField("price_usd",   DoubleType(),    True),
    StructField("volume_24h",  DoubleType(),    True),
    StructField("market_cap",  DoubleType(),    True),
    StructField("change_24h",  DoubleType(),    True),
    StructField("timestamp",   StringType(),    True),
    StructField("source",      StringType(),    True),
])

# ── 3. Read from Kafka ─────────────────────────────────────
raw_df = spark.readStream \
    .format("kafka") \
    .option("kafka.bootstrap.servers", "localhost:9092") \
    .option("subscribe", "crypto_raw") \
    .option("startingOffsets", "latest") \
    .option("failOnDataLoss", "false") \
    .load()

# ── 4. Parse JSON ──────────────────────────────────────────
parsed_df = raw_df \
    .select(from_json(col("value").cast("string"), schema).alias("data")) \
    .select("data.*") \
    .withColumn("event_time", to_timestamp(col("timestamp")))

# ── 5. Watermark — xử lý late data ────────────────────────
# Chấp nhận data đến muộn tối đa 10 phút
watermarked_df = parsed_df \
    .withWatermark("event_time", "10 minutes")

# ── 6. Window aggregations ─────────────────────────────────
# SMA-5 và SMA-20 trên cửa sổ trượt 5 phút
sma_df = watermarked_df \
    .groupBy(
        col("coin"),
        window(col("event_time"), "20 minutes", "5 minutes")
    ) \
    .agg(
        avg("price_usd").alias("sma_5"),
        avg("price_usd").alias("sma_20"),
        avg("volume_24h").alias("avg_volume"),
        max("price_usd").alias("high"),
        min("price_usd").alias("low"),
        sum("volume_24h").alias("total_volume"),
    ) \
    .select(
        col("coin"),
        col("window.start").alias("window_start"),
        col("window.end").alias("window_end"),
        col("sma_5"),
        col("sma_20"),
        col("avg_volume"),
        col("high"),
        col("low"),
        col("total_volume"),
    )

# ── 7. RSI calculation (UDF approach) ─────────────────────
from pyspark.sql.window import Window as W

static_window = W.partitionBy("coin") \
    .orderBy("event_time") \
    .rowsBetween(-14, 0)

rsi_df = watermarked_df \
    .withColumn("prev_price", lag("price_usd", 1).over(
        W.partitionBy("coin").orderBy("event_time")
    )) \
    .withColumn("price_diff", col("price_usd") - col("prev_price")) \
    .withColumn("gain", when(col("price_diff") > 0, col("price_diff")).otherwise(0.0)) \
    .withColumn("loss", when(col("price_diff") < 0, -col("price_diff")).otherwise(0.0)) \
    .withColumn("avg_gain", avg("gain").over(static_window)) \
    .withColumn("avg_loss", avg("loss").over(static_window)) \
    .withColumn("rs", col("avg_gain") / (col("avg_loss") + lit(1e-6))) \
    .withColumn("rsi_14", lit(100) - (lit(100) / (lit(1) + col("rs"))))

# ── 8. Write to MongoDB ────────────────────────────────────
def write_to_mongo(batch_df, batch_id):
    batch_df.write \
        .format("mongo") \
        .mode("append") \
        .option("uri", "mongodb://localhost:27017") \
        .option("database", "crypto_db") \
        .option("collection", "realtime_prices") \
        .save()

query = rsi_df.writeStream \
    .outputMode("update") \
    .foreachBatch(write_to_mongo) \
    .trigger(processingTime="30 seconds") \
    .start()

query.awaitTermination()
```

**Lưu ý quan trọng về Watermark:**

Theo Spark documentation: watermark hoạt động như sau:
- Engine theo dõi `max_event_time` đã thấy trong stream
- Watermark = `max_event_time - late_threshold`
- Records có `event_time < watermark` sẽ bị drop
- Window sẽ được emit khi `watermark > window_end`

Trong bài này dùng `"10 minutes"` watermark vì:
- CoinGecko cập nhật 60 giây/lần → delay tối đa thực tế ~2-3 phút
- 10 phút buffer đủ để handle network delay, API timeout
- Không nên set quá cao (vd 1h) vì sẽ làm state store tốn nhiều RAM

### 6.4 Batch Layer — Spark Batch Job

**File:** `src/batch/batch_job.py`

```python
from pyspark.sql import SparkSession
from pyspark.sql.functions import (
    col, avg, max, min, stddev, count,
    corr, date_trunc, to_date, unix_timestamp
)
from pyspark.sql.window import Window
import pandas as pd

spark = SparkSession.builder \
    .appName("CryptoBatchJob") \
    .config("spark.sql.session.timeZone", "UTC") \
    .getOrCreate()

# ── 1. Load G-Research dataset ─────────────────────────────
df = spark.read \
    .option("header", "true") \
    .option("inferSchema", "true") \
    .csv("data/g-research/train.csv")

# Convert timestamp (Unix seconds → datetime)
df = df.withColumn(
    "datetime",
    (col("timestamp").cast("timestamp"))
).withColumn(
    "date",
    to_date(col("datetime"))
)

# ── 2. Asset ID → Symbol mapping ──────────────────────────
from pyspark.sql.functions import create_map, lit
from itertools import chain

asset_map = {
    0: "BNB",  1: "BTC",  2: "BCH",  3: "EOS",
    4: "ETH",  5: "ETC",  6: "LTC",  7: "XMR",
    8: "TRX",  9: "XLM", 10: "ADA", 11: "IOTA",
   12: "MKR", 13: "DOGE"
}

mapping_expr = create_map([lit(x) for x in chain(*asset_map.items())])
df = df.withColumn("symbol", mapping_expr[col("Asset_ID")])

# ── 3. Daily stats (OHLCV per day per coin) ─────────────
daily_stats = df.groupBy("symbol", "date").agg(
    (col("date").cast("string")).alias("date_str"),
    avg("Close").alias("avg_close"),
    max("High").alias("daily_high"),
    min("Low").alias("daily_low"),
    avg("Volume").alias("avg_volume"),
    sum_col := sum("Volume").alias("total_volume"),
    avg("VWAP").alias("avg_vwap"),
    count("*").alias("trade_count")
)

# ── 4. Historical SMA (20, 50, 200 day) ───────────────────
window_20  = Window.partitionBy("symbol").orderBy("date").rowsBetween(-19, 0)
window_50  = Window.partitionBy("symbol").orderBy("date").rowsBetween(-49, 0)
window_200 = Window.partitionBy("symbol").orderBy("date").rowsBetween(-199, 0)

sma_df = daily_stats \
    .withColumn("sma_20",  avg("avg_close").over(window_20)) \
    .withColumn("sma_50",  avg("avg_close").over(window_50)) \
    .withColumn("sma_200", avg("avg_close").over(window_200))

# ── 5. Coin correlation matrix ────────────────────────────
# Pivot về wide format rồi tính Pearson correlation
pivot_df = daily_stats.groupBy("date").pivot("symbol").agg(avg("avg_close"))

# Tính correlation từng cặp (BTC×ETH, BTC×BNB, ...)
symbols = list(asset_map.values())
corr_records = []
for s1 in symbols:
    for s2 in symbols:
        if s1 <= s2:
            corr_val = pivot_df.select(corr(col(s1), col(s2))).first()[0]
            corr_records.append({"coin_a": s1, "coin_b": s2, "pearson_corr": corr_val})

# ── 6. Save to MongoDB ─────────────────────────────────────
def save_to_mongo(df, collection):
    df.write \
        .format("mongo") \
        .mode("overwrite") \
        .option("uri", "mongodb://localhost:27017") \
        .option("database", "crypto_db") \
        .option("collection", collection) \
        .save()

save_to_mongo(daily_stats, "daily_stats")
save_to_mongo(sma_df,      "historical_sma")
```

**Ước tính thời gian chạy batch job:**

| Job | Dataset size | Thời gian ước tính (local, 4 cores) |
|---|---|---|
| Load + parse CSV | ~1.4GB | 2-3 phút |
| Daily stats groupBy | 14 coins × ~1000 ngày | 3-4 phút |
| SMA 200-day rolling | Window function | 5-6 phút |
| Correlation matrix | 14×14 = 196 pairs | 4-5 phút |
| **Tổng** | — | **~20 phút** |

---

## 7. Cấu trúc dữ liệu & Schema

### 7.1 MongoDB Collections

**Database name:** `crypto_db`

---

**Collection: `realtime_prices`** (Speed Layer output)

```json
{
  "_id":          ObjectId,
  "coin":         "BTC",
  "price_usd":    67420.52,
  "volume_24h":   28400000000.0,
  "market_cap":   1320000000000.0,
  "change_24h":   2.34,
  "sma_5":        67380.10,
  "sma_20":       67100.45,
  "rsi_14":       58.23,
  "high_window":  67550.00,
  "low_window":   67200.00,
  "event_time":   ISODate("2025-05-15T08:30:00Z"),
  "created_at":   ISODate("2025-05-15T08:30:05Z")
}
```

Indexes:
```javascript
db.realtime_prices.createIndex({ "coin": 1, "event_time": -1 })
db.realtime_prices.createIndex({ "event_time": 1 }, { expireAfterSeconds: 604800 }) // TTL 7 ngày
```

---

**Collection: `daily_stats`** (Batch Layer output)

```json
{
  "_id":          ObjectId,
  "symbol":       "BTC",
  "date":         ISODate("2021-11-15T00:00:00Z"),
  "avg_close":    65432.10,
  "daily_high":   66100.00,
  "daily_low":    64800.00,
  "avg_volume":   12345.67,
  "total_volume": 17778004.80,
  "avg_vwap":     65400.22,
  "trade_count":  1440
}
```

Indexes:
```javascript
db.daily_stats.createIndex({ "symbol": 1, "date": -1 }, { unique: true })
```

---

**Collection: `historical_sma`** (Batch Layer output)

```json
{
  "_id":       ObjectId,
  "symbol":    "BTC",
  "date":      ISODate("2021-12-31T00:00:00Z"),
  "avg_close": 46306.45,
  "sma_20":    51200.34,
  "sma_50":    53400.22,
  "sma_200":   45100.88
}
```

---

**Collection: `coin_correlation`** (Batch Layer output)

```json
{
  "_id":          ObjectId,
  "coin_a":       "BTC",
  "coin_b":       "ETH",
  "pearson_corr": 0.9234,
  "computed_at":  ISODate("2025-05-15T02:00:00Z")
}
```

---

**Collection: `predictions`** (ML output)

```json
{
  "_id":            ObjectId,
  "coin":           "BTC",
  "prediction_for": ISODate("2025-05-15T09:00:00Z"),
  "predicted_price": 67650.00,
  "confidence_pct": 72.3,
  "model_version":  "lstm_v1",
  "created_at":     ISODate("2025-05-15T08:30:10Z")
}
```

---

**Collection: `alerts`** (Speed Layer — giá thay đổi lớn)

```json
{
  "_id":        ObjectId,
  "coin":       "BTC",
  "alert_type": "PRICE_SPIKE",
  "change_pct": 5.82,
  "price_from": 63750.00,
  "price_to":   67460.00,
  "timestamp":  ISODate("2025-05-15T08:15:00Z")
}
```

### 7.2 Kafka Message Schema

**Topic `crypto_raw` — value schema:**

```json
{
  "coin":       "BTC",
  "coin_id":    "bitcoin",
  "price_usd":  67420.52,
  "volume_24h": 28400000000.0,
  "market_cap": 1320000000000.0,
  "change_24h": 2.34,
  "timestamp":  "2025-05-15T08:30:00.000000+00:00",
  "source":     "coingecko"
}
```

**Key schema:** `"BTC"` (string, coin symbol)  
**Partitioning:** hash(key) % 3 — đảm bảo cùng coin vào cùng partition

---

## 8. Cài đặt & Cấu hình môi trường

### 8.1 Yêu cầu hệ thống

| Resource | Tối thiểu | Khuyến nghị |
|---|---|---|
| RAM | 8 GB | 16 GB |
| CPU | 4 cores | 8 cores |
| Disk | 20 GB | 50 GB |
| OS | Ubuntu 20.04+ / macOS 12+ / Windows 11 + WSL2 | Ubuntu 22.04 |
| Docker | 24.x+ | latest |
| Docker Compose | 2.x+ | latest |

### 8.2 Cấu trúc thư mục dự án

```
crypto-bigdata/
├── docker/
│   ├── docker-compose.yml          # Main compose file
│   ├── docker-compose.dev.yml      # Override for development
│   └── spark/
│       └── Dockerfile              # Custom Spark image với PySpark deps
│
├── src/
│   ├── producer/
│   │   ├── crypto_producer.py      # Kafka producer
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   │
│   ├── spark/
│   │   ├── streaming_job.py        # Spark Structured Streaming
│   │   ├── batch_job.py            # Spark batch processing
│   │   └── utils/
│   │       ├── indicators.py       # Technical indicator calculations
│   │       └── mongo_writer.py     # MongoDB write helpers
│   │
│   ├── ml/
│   │   ├── train_lstm.py           # LSTM training script
│   │   ├── inference.py            # Online inference server
│   │   ├── model/
│   │   │   └── lstm_btc_v1.pt      # Trained weights
│   │   └── requirements.txt
│   │
│   └── dashboard/
│       ├── app.py                  # Streamlit main app
│       ├── pages/
│       │   ├── 01_realtime.py      # Live price page
│       │   ├── 02_technical.py     # Technical analysis
│       │   ├── 03_prediction.py    # ML predictions
│       │   └── 04_correlation.py   # Coin correlation matrix
│       └── requirements.txt
│
├── data/
│   ├── g-research/                 # Kaggle dataset (gitignored)
│   │   └── train.csv
│   └── sample/
│       └── sample_100rows.csv      # Small sample for testing
│
├── notebooks/
│   ├── 01_eda_gresearch.ipynb      # EDA on historical data
│   ├── 02_indicator_analysis.ipynb # Technical indicator analysis
│   └── 03_lstm_prototype.ipynb     # LSTM model development
│
├── tests/
│   ├── test_producer.py
│   ├── test_spark_streaming.py
│   └── test_mongo_write.py
│
├── scripts/
│   ├── setup.sh                    # Install dependencies
│   ├── create_topics.sh            # Create Kafka topics
│   ├── run_batch.sh                # Submit batch job
│   └── seed_mongo.sh               # Seed MongoDB indexes
│
├── .env.example                    # Environment variables template
├── .env                            # Local env (gitignored)
└── README.md
```

### 8.3 Docker Compose — Full Stack

**File:** `docker/docker-compose.yml`

```yaml
version: "3.8"

services:
  # ── Zookeeper ──────────────────────────────────────────
  zookeeper:
    image: confluentinc/cp-zookeeper:7.5.0
    container_name: zookeeper
    restart: unless-stopped
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181
      ZOOKEEPER_TICK_TIME: 2000
      ZOOKEEPER_LOG4J_ROOT_LOGLEVEL: WARN
    ports:
      - "2181:2181"
    healthcheck:
      test: ["CMD", "bash", "-c", "echo ruok | nc localhost 2181"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ── Kafka Broker ──────────────────────────────────────
  kafka:
    image: confluentinc/cp-kafka:7.5.0
    container_name: kafka
    restart: unless-stopped
    depends_on:
      zookeeper:
        condition: service_healthy
    ports:
      - "9092:9092"
      - "9101:9101"       # JMX for monitoring
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: "zookeeper:2181"
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:29092,PLAINTEXT_HOST://localhost:9092
      KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "false"
      KAFKA_LOG_RETENTION_HOURS: 168    # 7 days
      KAFKA_LOG4J_ROOT_LOGLEVEL: WARN
    healthcheck:
      test: ["CMD", "kafka-broker-api-versions", "--bootstrap-server", "localhost:9092"]
      interval: 15s
      timeout: 10s
      retries: 5

  # ── Kafka UI (management) ─────────────────────────────
  kafka-ui:
    image: provectuslabs/kafka-ui:latest
    container_name: kafka-ui
    depends_on:
      - kafka
    ports:
      - "8080:8080"
    environment:
      KAFKA_CLUSTERS_0_NAME: local
      KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS: kafka:29092

  # ── Spark Master ──────────────────────────────────────
  spark-master:
    image: bitnami/spark:3.5
    container_name: spark-master
    environment:
      SPARK_MODE: master
      SPARK_MASTER_HOST: spark-master
      SPARK_LOG_LEVEL: WARN
    ports:
      - "8081:8080"     # Spark Web UI
      - "7077:7077"     # Spark master port
    volumes:
      - ../src:/app/src
      - ../data:/app/data

  # ── Spark Worker ──────────────────────────────────────
  spark-worker:
    image: bitnami/spark:3.5
    container_name: spark-worker
    depends_on:
      - spark-master
    environment:
      SPARK_MODE: worker
      SPARK_MASTER_URL: spark://spark-master:7077
      SPARK_WORKER_MEMORY: 2G
      SPARK_WORKER_CORES: 2
      SPARK_LOG_LEVEL: WARN
    volumes:
      - ../src:/app/src
      - ../data:/app/data

  # ── MongoDB ───────────────────────────────────────────
  mongodb:
    image: mongo:7.0
    container_name: mongodb
    restart: unless-stopped
    ports:
      - "27017:27017"
    environment:
      MONGO_INITDB_ROOT_USERNAME: admin
      MONGO_INITDB_ROOT_PASSWORD: password123
      MONGO_INITDB_DATABASE: crypto_db
    volumes:
      - mongodb_data:/data/db
      - ../scripts/mongo-init.js:/docker-entrypoint-initdb.d/mongo-init.js
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ── Kafka Producer ────────────────────────────────────
  producer:
    build:
      context: ../src/producer
      dockerfile: Dockerfile
    container_name: crypto-producer
    restart: unless-stopped
    depends_on:
      kafka:
        condition: service_healthy
    environment:
      KAFKA_BOOTSTRAP_SERVERS: kafka:29092
      POLL_INTERVAL_SECONDS: 60

  # ── Streamlit Dashboard ───────────────────────────────
  dashboard:
    build:
      context: ../src/dashboard
      dockerfile: Dockerfile
    container_name: crypto-dashboard
    restart: unless-stopped
    depends_on:
      - mongodb
    ports:
      - "8501:8501"
    environment:
      MONGO_URI: mongodb://admin:password123@mongodb:27017/crypto_db?authSource=admin

volumes:
  mongodb_data:
    driver: local
```

### 8.4 Environment Variables

**File:** `.env.example` (copy thành `.env` và điền giá trị thực)

```bash
# CoinGecko
COINGECKO_API_KEY=       # Để trống nếu dùng free tier (không cần key)
POLL_INTERVAL_SECONDS=60

# Kafka
KAFKA_BOOTSTRAP_SERVERS=localhost:9092
KAFKA_TOPIC_RAW=crypto_raw
KAFKA_TOPIC_ALERTS=crypto_alerts

# MongoDB
MONGO_URI=mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin
MONGO_DB=crypto_db

# Spark
SPARK_MASTER=spark://localhost:7077
SPARK_CHECKPOINT_DIR=/tmp/spark-checkpoints

# Dashboard
DASHBOARD_REFRESH_SECONDS=30
```

### 8.5 Setup từ đầu — Step by step

```bash
# 1. Clone / tạo project
mkdir crypto-bigdata && cd crypto-bigdata

# 2. Download G-Research dataset từ Kaggle
# https://www.kaggle.com/competitions/g-research-crypto-forecasting/data
# Đặt file vào data/g-research/train.csv

# 3. Copy env file
cp .env.example .env

# 4. Build và khởi động toàn bộ stack
docker compose -f docker/docker-compose.yml up -d --build

# Đợi ~2 phút cho services khởi động xong

# 5. Tạo Kafka topics
bash scripts/create_topics.sh

# 6. Tạo MongoDB indexes
bash scripts/seed_mongo.sh

# 7. Kiểm tra services
docker compose ps
# Output mong đợi: tất cả services ở trạng thái "Up (healthy)"

# 8. Submit Spark batch job (xử lý historical data)
bash scripts/run_batch.sh

# 9. Submit Spark streaming job
docker exec spark-master spark-submit \
  --master spark://spark-master:7077 \
  --packages org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.1,\
             org.mongodb.spark:mongo-spark-connector_2.12:10.2.1 \
  /app/src/spark/streaming_job.py

# 10. Mở dashboard
# http://localhost:8501  — Streamlit dashboard
# http://localhost:8080  — Spark Web UI
# http://localhost:8081  — Kafka UI
```

---

## 9. Kế hoạch triển khai chi tiết

### 9.1 Sprint 1 — Foundation (Ngày 1-2)

**Mục tiêu:** Kafka hoạt động, producer gửi được data

**Ngày 1:**
- [ ] Setup Docker Compose (Zookeeper + Kafka)
- [ ] Verify Kafka hoạt động: `docker exec kafka kafka-topics.sh --list --bootstrap-server localhost:9092`
- [ ] Tạo Kafka topics (script `create_topics.sh`)
- [ ] Cài đặt Python environment
- [ ] Viết `crypto_producer.py` — bước 1: chỉ cần fetch API và print ra console
- [ ] Test API CoinGecko: `curl "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"`

**Ngày 2:**
- [ ] Hoàn thiện producer — thêm Kafka send logic
- [ ] Test producer: chạy 5 phút, verify message xuất hiện trong Kafka UI (http://localhost:8081)
- [ ] Setup MongoDB container
- [ ] Tạo collections và indexes (script `seed_mongo.sh`)
- [ ] Verify kết nối MongoDB: `mongosh mongodb://admin:password123@localhost:27017/crypto_db`

**Deliverable Sprint 1:** Producer chạy 24/7, data vào Kafka topic ổn định

---

### 9.2 Sprint 2 — Speed Layer (Ngày 3-5)

**Mục tiêu:** Spark Streaming đọc từ Kafka và tính indicators

**Ngày 3:**
- [ ] Cài đặt Spark (bitnami/spark Docker image)
- [ ] Test Spark kết nối Kafka: read batch từ topic (không dùng streaming trước)
- [ ] Parse JSON schema
- [ ] Verify data đúng format

**Ngày 4:**
- [ ] Implement `streaming_job.py` — phần đọc stream và parse
- [ ] Add watermark (`withWatermark`)
- [ ] Implement window aggregation cơ bản: `avg("price_usd")` theo 5-min window
- [ ] Write to MongoDB (foreachBatch)
- [ ] Test end-to-end: Producer → Kafka → Spark → MongoDB

**Ngày 5:**
- [ ] Implement RSI_14 calculation
- [ ] Implement Bollinger Bands (mean ± 2×stddev trên 20-period window)
- [ ] Implement VWAP (sum(price×volume) / sum(volume))
- [ ] Thêm alert logic: nếu `change_24h > 5%` → produce vào `crypto_alerts` topic
- [ ] Verify tất cả indicators xuất hiện đúng trong MongoDB

**Deliverable Sprint 2:** Real-time pipeline hoàn chỉnh, 7 coins với đầy đủ indicators

---

### 9.3 Sprint 3 — Batch Layer (Ngày 6-7)

**Mục tiêu:** Xử lý G-Research dataset, tính batch views

**Ngày 6:**
- [ ] Download và verify G-Research CSV (train.csv ~8GB)
- [ ] Exploratory Data Analysis: kiểm tra null values, distributions
- [ ] Implement `batch_job.py` — load và parse CSV
- [ ] Tính `daily_stats` (OHLCV daily per coin)
- [ ] Verify output: 14 coins × ~1000 ngày = ~14000 records

**Ngày 7:**
- [ ] Tính `historical_sma` (SMA-20, SMA-50, SMA-200)
- [ ] Tính `coin_correlation` matrix (14×14 Pearson)
- [ ] Save tất cả vào MongoDB
- [ ] Verify Lambda Architecture hoàn chỉnh: batch views + real-time views đều có trong MongoDB
- [ ] Viết script `run_batch.sh` để chạy lại batch job dễ dàng

**Deliverable Sprint 3:** Batch Layer hoàn chỉnh, MongoDB có đủ 5 collections

---

### 9.4 Sprint 4 — Dashboard (Ngày 8-9)

**Mục tiêu:** Streamlit dashboard với đầy đủ visualizations

**Ngày 8:**
- [ ] Setup Streamlit project structure (multi-page)
- [ ] Page 1 — Real-time: hiển thị giá live, cập nhật mỗi 30s
- [ ] Page 2 — Technical Analysis: candlestick chart + SMA overlay + RSI
- [ ] Connect đến MongoDB, query `realtime_prices`

**Ngày 9:**
- [ ] Page 3 — Prediction: hiển thị LSTM predictions (nếu model đã train)
- [ ] Page 4 — Correlation Matrix: heatmap của `coin_correlation`
- [ ] Thêm coin selector dropdown
- [ ] Thêm time range selector (1h, 6h, 24h, 7d)
- [ ] Polish UI: màu sắc, layout, tooltips

**Deliverable Sprint 4:** Dashboard live và demo-ready

---

### 9.5 Sprint 5 — ML & Polish (Ngày 10-14)

**Mục tiêu:** LSTM model + documentation + demo preparation

**Ngày 10-11:** (LSTM training — xem Section 10)
- [ ] Data preprocessing pipeline
- [ ] Train LSTM trên BTC historical data
- [ ] Evaluate: RMSE, MAE, directional accuracy
- [ ] Save model weights

**Ngày 12:**
- [ ] Integrate LSTM inference vào dashboard
- [ ] End-to-end testing toàn bộ pipeline
- [ ] Fix bugs

**Ngày 13:**
- [ ] Viết README.md đầy đủ
- [ ] Viết báo cáo kỹ thuật
- [ ] Chuẩn bị demo script (10 phút demo flow)
- [ ] Record video demo (backup)

**Ngày 14:** Buffer / presentation preparation

---

## 10. Mô hình ML — LSTM

### 10.1 Lý do chọn LSTM

- LSTM (Long Short-Term Memory) là kiến trúc RNN phù hợp nhất cho time-series prediction vì:
  - Giải quyết được vanishing gradient problem của vanilla RNN
  - Có memory cell cho phép học long-range dependencies (ví dụ: pattern hàng tuần ảnh hưởng đến ngày hôm nay)
  - Được chứng minh hiệu quả trong financial time-series (nhiều paper và Kaggle solutions)
- Không dùng Transformer/TimesNet vì quá phức tạp cho scope project này

### 10.2 Input Features

```python
FEATURES = [
    "close",          # Giá đóng cửa (normalized)
    "volume",         # Khối lượng giao dịch (normalized)
    "vwap",           # Volume-weighted average price
    "sma_20",         # 20-period simple moving average
    "sma_50",         # 50-period SMA
    "rsi_14",         # RSI(14)
    "high_low_range", # (high - low) / low — biến động trong phiên
    "log_return",     # log(close_t / close_{t-1}) — log return
]

SEQUENCE_LENGTH = 60  # 60 phút lookback
PREDICTION_HORIZON = 60  # Dự đoán 60 phút tới (= 1 giờ)
```

### 10.3 Model Architecture

```python
import torch
import torch.nn as nn

class CryptoLSTM(nn.Module):
    def __init__(
        self,
        input_size:  int = 8,   # số features
        hidden_size: int = 128,
        num_layers:  int = 2,
        dropout:     float = 0.2,
        output_size: int = 1,   # predict 1 giá
    ):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout
        )
        self.fc = nn.Sequential(
            nn.Linear(hidden_size, 64),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(64, output_size)
        )

    def forward(self, x):
        # x shape: (batch_size, seq_len, input_size)
        lstm_out, _ = self.lstm(x)
        # Lấy output của timestep cuối cùng
        last_hidden = lstm_out[:, -1, :]
        return self.fc(last_hidden)
```

### 10.4 Training Configuration

```python
# Hyperparameters
BATCH_SIZE     = 64
EPOCHS         = 50
LEARNING_RATE  = 1e-3
WEIGHT_DECAY   = 1e-5
TRAIN_RATIO    = 0.8
VAL_RATIO      = 0.1
TEST_RATIO     = 0.1

# Loss & Optimizer
criterion = nn.MSELoss()
optimizer = torch.optim.Adam(
    model.parameters(),
    lr=LEARNING_RATE,
    weight_decay=WEIGHT_DECAY
)
scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
    optimizer, mode="min", patience=5, factor=0.5
)

# Early stopping
PATIENCE = 10  # stop nếu val_loss không cải thiện sau 10 epochs
```

### 10.5 Data Preprocessing

```python
from sklearn.preprocessing import MinMaxScaler
import numpy as np

def prepare_sequences(df, features, seq_len=60, horizon=60):
    scaler = MinMaxScaler()
    scaled = scaler.fit_transform(df[features])

    X, y = [], []
    for i in range(seq_len, len(scaled) - horizon):
        X.append(scaled[i - seq_len : i])
        # Predict giá close (index 0) tại t+horizon
        y.append(scaled[i + horizon, 0])

    return np.array(X), np.array(y), scaler

# Train/Val/Test split — PHẢI split theo thời gian, không random
n = len(X)
train_end = int(n * 0.8)
val_end   = int(n * 0.9)

X_train, y_train = X[:train_end],        y[:train_end]
X_val,   y_val   = X[train_end:val_end], y[train_end:val_end]
X_test,  y_test  = X[val_end:],          y[val_end:]
```

**Lưu ý quan trọng:** Phải split theo thứ tự thời gian, KHÔNG dùng `train_test_split(shuffle=True)` vì sẽ gây data leakage.

### 10.6 Evaluation Metrics

```python
from sklearn.metrics import mean_squared_error, mean_absolute_error
import numpy as np

def evaluate_model(y_true, y_pred, scaler):
    # Inverse transform về giá gốc
    y_true_orig = scaler.inverse_transform(...)
    y_pred_orig = scaler.inverse_transform(...)

    rmse = np.sqrt(mean_squared_error(y_true_orig, y_pred_orig))
    mae  = mean_absolute_error(y_true_orig, y_pred_orig)
    mape = np.mean(np.abs((y_true_orig - y_pred_orig) / y_true_orig)) * 100

    # Directional accuracy — quan trọng hơn RMSE với traders
    direction_true = np.sign(np.diff(y_true_orig.flatten()))
    direction_pred = np.sign(np.diff(y_pred_orig.flatten()))
    dir_acc = np.mean(direction_true == direction_pred) * 100

    print(f"RMSE: ${rmse:,.2f}")
    print(f"MAE:  ${mae:,.2f}")
    print(f"MAPE: {mape:.2f}%")
    print(f"Directional Accuracy: {dir_acc:.1f}%")
```

**Kỳ vọng kết quả thực tế:**
- RMSE: ~$500-1500 (với BTC, giá ~$60,000 → ~1-2.5%)
- Directional Accuracy: ~52-55% (tốt hơn random flip coin 50%)
- Lưu ý: đây là dự đoán 1 giờ tới, không phải scalping signal

---

## 11. Dashboard & Visualisation

### 11.1 Streamlit Architecture

```
app.py (main)
│
├── pages/01_realtime.py
│   ├── st.selectbox (coin selector)
│   ├── st.metric (giá hiện tại, change %)
│   ├── st.plotly_chart (line chart prices)
│   └── st.auto_refresh (30s)
│
├── pages/02_technical.py
│   ├── st.selectbox (coin + timeframe)
│   ├── candlestick chart (Plotly go.Candlestick)
│   ├── SMA overlay (SMA-20, SMA-50)
│   └── RSI subplot
│
├── pages/03_prediction.py
│   ├── coin selector
│   ├── actual vs predicted price chart
│   └── next prediction display
│
└── pages/04_correlation.py
    └── heatmap (px.imshow của correlation matrix)
```

### 11.2 Candlestick Chart Code

```python
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import streamlit as st
import pymongo

@st.cache_resource
def get_mongo():
    return pymongo.MongoClient(st.secrets["MONGO_URI"])

def render_candlestick(coin: str, hours: int = 24):
    db = get_mongo()["crypto_db"]
    from datetime import datetime, timedelta

    since = datetime.utcnow() - timedelta(hours=hours)
    cursor = db.realtime_prices.find(
        {"coin": coin, "event_time": {"$gte": since}},
        sort=[("event_time", 1)]
    )
    records = list(cursor)
    if not records:
        st.warning("Chưa có data. Pipeline chưa chạy?")
        return

    import pandas as pd
    df = pd.DataFrame(records)
    df["event_time"] = pd.to_datetime(df["event_time"])

    # Resample thành OHLCV 5-phút
    df = df.set_index("event_time")
    ohlcv = df["price_usd"].resample("5min").ohlc()
    vol   = df["volume_24h"].resample("5min").last()

    fig = make_subplots(
        rows=3, cols=1,
        row_heights=[0.6, 0.2, 0.2],
        shared_xaxes=True,
        vertical_spacing=0.03,
        subplot_titles=(f"{coin}/USD", "Volume", "RSI(14)")
    )

    # Candlestick
    fig.add_trace(go.Candlestick(
        x=ohlcv.index,
        open=ohlcv["open"], high=ohlcv["high"],
        low=ohlcv["low"],   close=ohlcv["close"],
        name=coin
    ), row=1, col=1)

    # SMA overlays
    fig.add_trace(go.Scatter(
        x=df.index, y=df["sma_20"],
        line=dict(color="orange", width=1),
        name="SMA-20"
    ), row=1, col=1)

    # Volume bars
    fig.add_trace(go.Bar(
        x=vol.index, y=vol.values, name="Volume",
        marker_color="rgba(100,100,200,0.5)"
    ), row=2, col=1)

    # RSI
    fig.add_trace(go.Scatter(
        x=df.index, y=df["rsi_14"],
        line=dict(color="purple", width=1.5),
        name="RSI(14)"
    ), row=3, col=1)

    # RSI bands
    fig.add_hline(y=70, line_dash="dash", line_color="red",   row=3)
    fig.add_hline(y=30, line_dash="dash", line_color="green", row=3)

    fig.update_layout(
        height=600, xaxis_rangeslider_visible=False,
        title=f"{coin}/USD — Last {hours}h",
        template="plotly_dark"
    )
    st.plotly_chart(fig, use_container_width=True)
```

---

## 12. Testing & Validation

### 12.1 Unit Tests

**File:** `tests/test_producer.py`

```python
def test_fetch_prices_returns_7_coins():
    data = fetch_prices()
    assert len(data) == 7
    assert "bitcoin" in data
    assert data["bitcoin"]["usd"] > 0

def test_record_schema():
    data = fetch_prices()
    record = transform_to_record("bitcoin", data["bitcoin"])
    required_fields = ["coin", "price_usd", "volume_24h", "timestamp"]
    for field in required_fields:
        assert field in record
```

**File:** `tests/test_spark_streaming.py`

```python
def test_watermark_drops_old_events():
    # Tạo DataFrame với 1 record cũ hơn watermark
    # Verify rằng record đó bị drop
    ...

def test_sma_calculation():
    prices = [100, 102, 98, 105, 101, 103, 99]
    expected_sma5 = sum(prices[-5:]) / 5
    actual_sma5 = compute_sma(prices, window=5)
    assert abs(actual_sma5 - expected_sma5) < 0.01
```

### 12.2 Integration Tests

**Checklist trước khi demo:**

```
[ ] Producer chạy > 10 phút không crash
[ ] Kafka UI (http://localhost:8081) thấy messages trong crypto_raw
[ ] Spark Streaming job không có ERROR logs
[ ] MongoDB có data mới nhất < 2 phút trước
[ ] Dashboard load trong < 5 giây
[ ] Candlestick chart hiển thị data đúng
[ ] RSI nằm trong [0, 100]
[ ] SMA-20 < SMA-50 khi trend giảm (sanity check)
[ ] Correlation BTC-ETH > 0.8 (historically đúng)
[ ] LSTM prediction trong ±20% của giá thực
```

### 12.3 Load Testing

Để verify pipeline chịu được load cao hơn (nếu cần):

```bash
# Simulate 10x traffic bằng cách giảm poll interval
POLL_INTERVAL_SECONDS=6 python src/producer/crypto_producer.py

# Monitor Kafka consumer lag
docker exec kafka kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe --group spark-streaming-group
```

---

## 13. Rủi ro và phương án dự phòng

### 13.1 Rủi ro kỹ thuật

| Rủi ro | Xác suất | Tác động | Phương án dự phòng |
|---|---|---|---|
| CoinGecko API rate limit bị hit | Thấp | Trung bình | Cache response 60s, exponential backoff, dùng CoinCap API miễn phí làm backup |
| Spark OutOfMemoryError khi xử lý CSV 8GB | Trung bình | Cao | Tăng `SPARK_DRIVER_MEMORY=4g`, dùng sampling 10% CSV cho demo |
| Kafka Zookeeper timeout khi startup | Trung bình | Thấp | Health check trong docker-compose, retry logic trong producer |
| MongoDB disk đầy sau nhiều ngày chạy | Thấp | Trung bình | TTL index 7 ngày trên realtime_prices, monitoring disk usage |
| LSTM training quá chậm (không có GPU) | Cao | Thấp | Chỉ train trên BTC, reduce epochs xuống 20, dùng CPU PyTorch đủ |
| Spark-Kafka connector version mismatch | Trung bình | Cao | Pin exact versions: `spark-sql-kafka-0-10_2.12:3.5.1` |

### 13.2 Phương án fallback cho demo

**Nếu real-time pipeline gặp sự cố trong lúc demo:**

1. Dùng pre-recorded MongoDB snapshot (export trước khi demo)
2. Chạy dashboard kết nối vào MongoDB đã có dữ liệu sẵn
3. Batch processing (G-Research CSV) luôn hoạt động độc lập — không phụ thuộc API

**Script backup:**

```bash
# Export MongoDB snapshot trước ngày demo
mongodump --uri="mongodb://admin:password123@localhost:27017/crypto_db" \
  --out=data/mongo_backup/$(date +%Y%m%d)

# Restore nếu cần
mongorestore --uri="mongodb://admin:password123@localhost:27017" \
  data/mongo_backup/20250515/
```

---

## 14. Phân công công việc

_Điều chỉnh theo số thành viên nhóm thực tế_

| Module | Người phụ trách | Hỗ trợ | Thời gian |
|---|---|---|---|
| Kafka setup + Producer | Thành viên A | Thành viên B | Sprint 1 |
| Spark Streaming job | Thành viên B | Thành viên A | Sprint 2 |
| Spark Batch job | Thành viên C | Thành viên B | Sprint 3 |
| MongoDB schema + indexes | Thành viên A | — | Sprint 1-2 |
| Streamlit dashboard | Thành viên D | Thành viên C | Sprint 4 |
| LSTM model | Thành viên C | Thành viên D | Sprint 5 |
| Docker Compose + DevOps | Thành viên A | Thành viên D | Sprint 1 |
| Báo cáo & slide | Tất cả | — | Sprint 5 |
| Demo preparation | Tất cả | — | Sprint 5 |

---

## 15. Timeline tổng thể

```
Tuần 1 (Ngày 1-7)
├── Ngày 1-2  ── Sprint 1: Foundation (Kafka + MongoDB setup)
├── Ngày 3-5  ── Sprint 2: Speed Layer (Spark Streaming)
└── Ngày 6-7  ── Sprint 3: Batch Layer (G-Research processing)

Tuần 2 (Ngày 8-14)
├── Ngày 8-9  ── Sprint 4: Dashboard (Streamlit)
├── Ngày 10-11 ─ Sprint 5a: LSTM Model training
├── Ngày 12   ── Sprint 5b: Integration + bug fixes
├── Ngày 13   ── Documentation + báo cáo
└── Ngày 14   ── Demo rehearsal + final polish
```

**Milestone checklist:**

| Milestone | Ngày | Tiêu chí đạt |
|---|---|---|
| M1: Pipeline hoạt động | Ngày 5 | Producer → Kafka → Spark → MongoDB end-to-end |
| M2: Lambda Architecture | Ngày 7 | Batch views + Speed views đều có trong MongoDB |
| M3: Dashboard live | Ngày 9 | Dashboard kết nối MongoDB, candlestick hiển thị đúng |
| M4: ML integrated | Ngày 11 | LSTM predictions xuất hiện trong dashboard |
| M5: Demo ready | Ngày 14 | Full demo flow < 10 phút, không crash |

---

## 16. Tài liệu tham khảo

### Papers & Articles

1. Marz, N. & Warren, J. (2015). *Big Data: Principles and best practices of scalable real-time data systems.* Manning Publications. — Nguồn gốc Lambda Architecture.

2. Sharma, T. (2025). *Building a Real-Time Crypto Insights Dashboard with Kafka, Spark, LSTM, and Streamlit.* Medium. https://medium.com/@tanishqsharma3700/building-a-real-time-crypto-insights-dashboard-with-kafka-spark-lstm-and-streamlit-19440d64b1e3

3. Sedlins, A. et al. (2022). *Big Data Architecture for Cryptocurrency Real-time Data Processing.* IEEE. https://www.eventiotic.com/eventiotic/files/Papers/URL/9f42d8e9-864c-4397-8044-51a34689eea1.pdf

4. Salles, R. & Belloze, K. (2022). *Real-Time Big Data Architecture for Processing Cryptocurrency and Social Media Data: A Clustering Approach Based on k-Means.* MDPI Algorithms, 15(5), 140. https://www.mdpi.com/1999-4893/15/5/140

5. Databricks. (2022). *Feature Deep Dive: Watermarking in Apache Spark Structured Streaming.* https://www.databricks.com/blog/feature-deep-dive-watermarking-apache-spark-structured-streaming

### Datasets

6. G-Research. (2022). *G-Research Crypto Forecasting Competition.* Kaggle. https://www.kaggle.com/competitions/g-research-crypto-forecasting

### Documentation

7. Apache Spark. (2024). *Structured Streaming Programming Guide (v3.5).* https://spark.apache.org/docs/3.5.6/structured-streaming-programming-guide.html

8. Apache Kafka. (2024). *Kafka Documentation.* https://kafka.apache.org/documentation/

9. CoinGecko. (2024). *CoinGecko API v3 Documentation.* https://www.coingecko.com/api/documentation

10. MongoDB. (2024). *MongoDB Spark Connector Documentation.* https://www.mongodb.com/docs/spark-connector/

### GitHub Repositories (tham khảo code)

11. theavicaster. *crypto-streaming* — Kafka + PySpark + Cassandra + React. https://github.com/theavicaster/crypto-streaming

12. SamerBenMim. *BigData-Pipeline-Hadoop-Kafka-Spark* — Hadoop + Kafka + Spark + MongoDB. https://github.com/SamerBenMim/BigData-Pipeline-Hadoop-Kafka-Spark

13. radoslawkrolikowski. *financial-market-data-analysis* — Kafka + PySpark + BiGRU. https://github.com/radoslawkrolikowski/financial-market-data-analysis

14. conduktor. *kafka-stack-docker-compose* — Production-ready Kafka Docker Compose. https://github.com/conduktor/kafka-stack-docker-compose

---

*Tài liệu này được cập nhật lần cuối: 2025-05-15. Mọi thay đổi về scope hoặc công nghệ cần được cập nhật vào tài liệu này trước khi triển khai.*
