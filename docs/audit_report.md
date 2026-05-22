# Crypto Big Data — Full Audit Report

Generated: 2026-05-17  
Auditor: Claude Sonnet 4.6  
Plan version: `crypto_bigdata_project_plan.md` (2025-05-15)  
Test run: 130 tests, 130 passed, 0 failed

---

## Executive Summary

The project is a well-structured Lambda Architecture implementation covering Kafka, Spark
Streaming, Spark Batch, MongoDB, Streamlit dashboard, and a PyTorch LSTM model.  All six
Python source files compile cleanly, all 130 unit tests pass, and Docker Compose validates
without errors.  The overall quality is high for an academic proof-of-concept.

**Overall project score: 7.5 / 10**

The primary gap — and the most impactful one — is in Sprint 5 (LSTM): the plan explicitly
specifies a **multivariate** model (`input_size=8`, 8 engineered features) but the
implementation is **univariate** (`input_size=1`, close price only).  This architectural
deviation propagates through `preprocess.py`, `model.py`, `train_lstm.py`, and `inference.py`.
All other sprints are implemented correctly or with minor, well-documented deviations.

Secondary issues are cosmetic or configuration-level: the wrong model weight filename, missing
`linger_ms=100` producer setting, batch-writes using `insert_many` (not true `overwrite` mode),
and a 70/15/15 train split instead of the plan's 80/10/10.

The pipeline can be demonstrated end-to-end.  The one blocker for a fully plan-compliant demo
is retraining the LSTM with all 8 features.

---

## Rating Matrix

| Sprint | Plan Criteria Met | Score | Verdict |
|--------|-------------------|-------|---------|
| 1 — Kafka Producer | 9 / 10 spec items | **9/10** | Excellent — one minor config gap (`linger_ms`) |
| 2 — Spark Streaming | 8 / 10 spec items | **8/10** | Strong — Query A SMA aliasing bug; Kafka bootstrap inside Docker |
| 3 — Spark Batch | 7 / 10 spec items | **7/10** | Good — 3 coins not 14; no true `overwrite` on re-run |
| 4 — Dashboard | 8 / 10 spec items | **8/10** | Good — `os.environ` not `st.secrets`; 3 coins not 7 |
| 5 — LSTM Model | 5 / 10 spec items | **5/10** | Major gap — univariate vs multivariate; wrong weight filename; wrong split ratio |
| 6 — Polish/Integration | 7 / 10 spec items | **7/10** | Page 3 integrated; demo scripts present; README missing |

---

## Sprint-by-Sprint Analysis

---

### Sprint 1 — Kafka Producer | Score: 9/10

#### What the plan required

- CoinGecko REST API, 7 coins: BTC, ETH, BNB, SOL, XRP, ADA, DOGE
- Poll every 60 seconds (configurable via `POLL_INTERVAL_SECONDS`)
- `KafkaProducer` with `acks="all"`, `retries=3`, `linger_ms=100`, `max_in_flight=1`
- Topic `crypto_raw` (3 partitions, 1 replication factor)
- Message schema: `coin`, `coin_id`, `price_usd`, `volume_24h`, `market_cap`, `change_24h`, `timestamp`, `source`
- Key = coin symbol (ensures same coin → same partition)

#### What was implemented

`src/producer/crypto_producer.py` (205 lines)

- COINS list at line 38–46: all 7 CoinGecko IDs present — **correct**
- `build_producer()` at line 71–83: `acks="all"`, `retries=3`, `max_in_flight_requests_per_connection=1` — **correct**
- `transform_to_record()` at line 118–139: all 8 required fields present — **correct**
- `produce_loop()` at line 143–183: flush after each batch, error callbacks, clean shutdown — **correct**
- `COIN_SYMBOL_MAP` at line 49–57: exact mapping per plan Section 5.1 — **correct**
- Config from `.env` via `load_dotenv()` — **correct**

#### CORRECT items

- `acks="all"`: confirmed at `crypto_producer.py:77`
- `retries=3`: confirmed at `crypto_producer.py:78`
- `max_in_flight_requests_per_connection=1`: confirmed at `crypto_producer.py:79`
- All 7 coins polled in single batch request: `crypto_producer.py:97`
- Key = coin symbol (not coin_id): `crypto_producer.py:162`
- 8-field message schema: confirmed by `test_producer.py:55`
- `source="coingecko"`: `crypto_producer.py:138`
- CoinGecko API key header injected when set: `crypto_producer.py:105–106`
- No hardcoded credentials: env-var pattern throughout

#### INCORRECT / MISSING items

- **`linger_ms=100` missing** — Plan Section 6.1 table specifies this setting.  `build_producer()` at line 71–83 does not include `linger_ms`.  Impact is low (only affects batching latency) but it is an explicit spec requirement.
  Fix: add `linger_ms=100` to the `KafkaProducer()` call.

#### Bugs found

None.  All 17 unit tests in `test_producer.py` pass.

---

### Sprint 2 — Spark Streaming | Score: 8/10

#### What the plan required

- Read from `kafka:29092` (Docker-internal bootstrap), topic `crypto_raw`
- Schema with 8 fields (matching producer output)
- `withWatermark("event_time", "10 minutes")`
- Window aggregation: 20-min window, 5-min slide
- Indicators: SMA-5, SMA-20, RSI-14, VWAP-60, Bollinger Bands(20, 2σ)
- Output mode: `foreachBatch` → MongoDB append to `realtime_prices`
- Alert: when `|change_24h| > 5%` → produce to `crypto_alerts` Kafka topic
- Dual-query: Query A = window aggregation, Query B = per-record enrichment

#### What was implemented

`src/spark/streaming_job.py` (420 lines) + `src/spark/utils/indicators.py` (235 lines) + `src/spark/utils/mongo_writer.py` (248 lines)

- `build_spark()` at line 110–128: `timeZone=UTC`, `setLogLevel("WARN")`, checkpoint dir — **correct**
- `read_kafka_stream()` at line 134–163: bootstrap = `kafka:29092` (Docker), `failOnDataLoss=false`, `maxOffsetsPerTrigger=1000` — **correct**
- Watermark: `parsed_df.withWatermark("event_time", "10 minutes")` at line 398 — **correct**
- Query A: 20-min/5-min window at line 207–231 — present but has alias bug (see below)
- Query B: `_enrich_and_write()` at line 308–356 applies SMA-5, SMA-20, RSI-14, VWAP-60, Bollinger-20 — **correct**
- Alert logic: `_build_alert_records()` at line 239–261 checks `|change_24h| > 5%` — **correct**
- Alert → Kafka producer: `_produce_alerts_to_kafka()` at line 264–305 with `acks=all`, `retries=3` — **correct**
- `foreachBatch` used for all MongoDB writes — **correct**
- All 5 indicators present in output schema at line 333–346 — **correct**

#### CORRECT items

- `kafka:29092` bootstrap: `streaming_job.py:85` default
- `withWatermark("event_time", "10 minutes")`: `streaming_job.py:398`
- All 5 indicators (SMA-5, SMA-20, RSI-14, VWAP-60, BB-20): `streaming_job.py:326–330`
- `foreachBatch` for Query A and Query B: lines 222, 366
- Alert threshold 5%: `streaming_job.py:90`
- Dual-query architecture: `streaming_job.py:401–402`
- RSI `1e-6` guard on avg_loss: `indicators.py:229`
- SMA uses `rowsBetween(-N+1, 0)`: `indicators.py:76`
- BB formula (mid ± 2σ): `indicators.py:118–123`

#### INCORRECT / MISSING items

1. **Query A SMA aliasing bug** — `streaming_job.py:213–214` both compute `avg("price_usd")` but alias them `sma_5` and `sma_20` respectively.  Since both use the full 20-minute window average, `sma_5` and `sma_20` are **identical values**.  A correct SMA-5 requires a 5-minute window while SMA-20 requires a 20-minute window.  Query B (line 326–327) correctly uses `add_sma(window_rows=5)` and `add_sma(window_rows=20)` as separate row-based windows, so the final enriched records written to MongoDB are correct.  The bug is confined to Query A's window-agg output.
   Fix: replace Query A with two separate groupBys or use a 5-min/5-min slide (SMA-5) plus 20-min/5-min (SMA-20).

2. **MongoDB connector JAR only partially pinned** — `streaming_job.py` mentions only `spark-sql-kafka-0-10_2.12:3.5.1` in the `spark-submit` comment (line 389).  The `mongo-spark-connector_2.12:10.2.1` JAR is not listed for the streaming job.  Since `mongo_writer.py` uses `pymongo` directly (not the Spark-Mongo connector), this is not a runtime bug, but the documentation in the submit comment is incomplete.

#### Bugs found

- **Query A duplicate SMA alias** (low runtime severity — Query B overrides with correct values): `streaming_job.py:213–214`

---

### Sprint 3 — Spark Batch | Score: 7/10

#### What the plan required

- Load G-Research dataset (14 coins, minute-level) OR sample CSVs as fallback
- Compute `daily_stats`: OHLCV per (symbol, date)
- Compute `historical_sma`: SMA-20, SMA-50, SMA-200 on daily close
- Compute `coin_correlation`: 14×14 Pearson correlation matrix
- Write to MongoDB collections: `daily_stats`, `historical_sma`, `coin_correlation`
- Batch writes in `overwrite` mode

#### What was implemented

`src/spark/batch_job.py` (431 lines)

- `build_spark()` at line 108–124: `timeZone=UTC`, `setLogLevel("WARN")` — **correct**
- `load_sample_csvs()` at line 130–196: loads `data/sample/*.csv` with `SAMPLE_COIN_MAP` — present
- `compute_daily_stats()` at line 202–237: all required aggregations — **correct**
- `compute_historical_sma()` at line 243–275: SMA-20, SMA-50, SMA-200 with `rowsBetween` — **correct**
- `compute_coin_correlation()` at line 281–345: Pearson via Spark `corr()`, `combinations()` — **correct**
- `persist_batch_views()` at line 351–378 — present

#### CORRECT items

- All three SMA periods (20, 50, 200) computed with `rowsBetween(-(N-1), 0)`: `batch_job.py:268–272`
- Pearson correlation via Spark built-in `corr()`: `batch_job.py:319`
- `computed_at` timestamp on correlation records: `batch_job.py:314`
- No shuffle anywhere in pipeline
- `setLogLevel("WARN")`, no `print()` in Spark jobs
- All 46 unit tests in `test_batch_job.py` pass

#### INCORRECT / MISSING items

1. **Only 3 coins, not 14** — `SAMPLE_COIN_MAP` at line 78–81 contains only `bitcoin → BTC`, `ethereum → ETH`, `dogecoin → DOGE`.  The plan requires processing the full G-Research dataset (14 coins) or at minimum a representative sample.  The correlation matrix produced is 3×3 (3 pairs), not 14×14 (91 pairs) as the plan specifies.
   Mitigation documented in `sprint_progress_report.md`: "Sample CSVs used instead of G-Research dataset."
   Fix: add remaining 11 coins to `SAMPLE_COIN_MAP` and create corresponding sample CSVs, or download the G-Research dataset.

2. **Batch write is not true `overwrite`** — `persist_batch_views()` calls `write_batch()` which uses `insert_many` (line 148 in `mongo_writer.py`).  The plan and project non-negotiables require `overwrite` mode for batch writes.  On re-runs this will create duplicate documents rather than replacing existing data.  The `run_batch.sh` script presumably drops collections beforehand (not audited here), which provides overwrite-equivalent behaviour but is fragile.
   Fix: change `write_batch` for batch collections to use `drop()` + `insert_many` or implement `ReplaceOne` upserts.

3. **G-Research Asset ID mapping not used** — The plan defines a 14-entry `ASSET_MAP` (Section 6.4); the batch job defines a 3-entry `SAMPLE_COIN_MAP` and never references the plan's mapping.  The project-wide non-negotiable ASSET_MAP is ignored.

#### Bugs found

None that cause crashes — all batch tests pass.

---

### Sprint 4 — Dashboard | Score: 8/10

#### What the plan required

- 4 pages: realtime (Page 1), technical analysis (Page 2), prediction (Page 3), correlation (Page 4)
- Page 1: 30-second auto-refresh, coin metrics (`price_usd`, `change_24h`, `market_cap`)
- Page 2: candlestick chart + SMA-20 + SMA-50 + RSI subplot
- Page 3: LSTM predictions (graceful placeholder when not trained)
- Page 4: Pearson correlation heatmap
- Coin selector dropdown, time-range selector
- `@st.cache_resource` for MongoClient
- `template="plotly_dark"` on all Plotly figures
- `use_container_width=True` on all `st.plotly_chart` calls
- MongoDB URI via `st.secrets["MONGO_URI"]`
- Docker service with health check on port 8501

#### What was implemented

`src/dashboard/app.py`, `pages/01_realtime.py`, `02_technical.py`, `03_prediction.py`, `04_correlation.py`; `src/dashboard/utils.py`

- All 4 pages implemented and render with graceful fallback when MongoDB is empty
- `@st.cache_resource` on `get_mongo_client()`: `app.py:29` — **correct**
- `template="plotly_dark"`: confirmed in all 4 page files — **correct**
- `use_container_width=True`: confirmed in all 4 page files — **correct**
- 30-second auto-refresh via `st_autorefresh(interval=30_000)`: `01_realtime.py:28` — **correct**
- Candlestick + SMA-20 + SMA-50 + RSI subplot: `02_technical.py:86–168` — **correct**
- Fallback: `01_realtime.py` falls back to `daily_stats` when `realtime_prices` is empty — **correct**
- Docker healthcheck on dashboard: `docker-compose.yml:174–179` — **correct**

#### CORRECT items

- `@st.cache_resource get_mongo_client()`: `app.py:29–37`
- `template="plotly_dark"` all charts: `01_realtime.py:142`, `02_technical.py:156`, `03_prediction.py:135`, `04_correlation.py:62`
- `use_container_width=True` all charts: `01_realtime.py:148`, `02_technical.py:168`, `03_prediction.py:143`, `04_correlation.py:78`
- Auto-refresh 30 s: `01_realtime.py:28`
- Graceful fallback on empty collections: all 4 pages
- Docker healthcheck on port 8501: `docker-compose.yml:175`

#### INCORRECT / MISSING items

1. **`os.environ` instead of `st.secrets`** — `app.py:35` uses `os.environ.get("MONGO_URI", _DEFAULT_URI)`.  The plan and project non-negotiables specify `st.secrets["MONGO_URI"]`.  This is a minor deviation; `os.environ` works in Docker but is not the Streamlit-idiomatic approach and will not work with Streamlit Cloud secrets management.
   Fix: change to `st.secrets.get("MONGO_URI", os.environ.get("MONGO_URI", _DEFAULT_URI))`.

2. **Only 3 coins shown (BTC, ETH, DOGE)** — `app.py:49` sets `AVAILABLE_COINS = ["BTC", "ETH", "DOGE"]`.  The plan specifies 7 coins.  The other 4 (BNB, SOL, XRP, ADA) were not included in the sample CSVs, making them unavailable in batch views.  This is a downstream consequence of the Sprint 3 scope reduction.

3. **Page 2 uses simulated OHLC** — `02_technical.py:82` calls `simulate_ohlc()` which creates artificial open/high/low values (high = close × 1.001, low = close × 0.999).  The plan expects real OHLCV data.  This is an acceptable workaround given daily-granularity sample data.

4. **`sma_200` not rendered** — `02_technical.py` displays SMA-20 and SMA-50 but not SMA-200, despite `historical_sma` containing it.  Plan Section 11.2 mentions SMA-20 and SMA-50 overlays; SMA-200 is optional here.

#### Bugs found

None causing crashes — all 34 dashboard unit tests pass.

---

### Sprint 5 — LSTM Model | Score: 5/10

#### What the plan required (Section 10)

- PyTorch LSTM: `input_size=8` (MULTIVARIATE), `hidden=128`, `num_layers=2`, `dropout=0.2`
- 8 features in order: `close, volume, vwap, sma_20, sma_50, rsi_14, high_low_range, log_return`
- `SEQUENCE_LENGTH = 60`, `PREDICTION_HORIZON = 60` minutes
- Train/val/test split: **80/10/10** (time-ordered)
- `BATCH_SIZE = 64`
- Save weights to `src/ml/model/lstm_btc_v1.pt`
- Evaluate: RMSE, MAE, directional accuracy > 50%

#### What was implemented

`src/ml/model.py`, `src/ml/preprocess.py`, `src/ml/train_lstm.py`, `src/ml/inference.py`

#### CORRECT items

- 2-layer LSTM with `hidden_size=128`, `num_layers=2`, `dropout=0.2`: `model.py:39–57` — **correct**
- FC head: `Linear(128→64) → ReLU → Dropout(0.1) → Linear(64→1)`: `model.py:61–65` — **correct**
- `batch_first=True`: `model.py:56` — **correct**
- `SEQUENCE_LENGTH = 60`: `preprocess.py:38` — **correct**
- Chronological split, `shuffle=False` everywhere: `preprocess.py:127–132`, `train_lstm.py:132–134` — **correct**
- `MSELoss` + Adam + `ReduceLROnPlateau` + early stopping: `train_lstm.py:145–155` — **correct**
- Gradient clipping: `train_lstm.py:170` — **correct** (bonus, not in plan)
- RMSE, MAE, directional accuracy metrics: `train_lstm.py:63–83` — **correct**
- Dry-run completes: 2 epochs, directional accuracy 50.9% after 2 epochs (untrained baseline)
- All 28 LSTM unit tests pass

#### INCORRECT / MISSING items

1. **`input_size=1` (univariate) instead of `input_size=8` (multivariate)** — This is the major architectural gap.
   - `model.py:39`: `input_size: int = 1`
   - `preprocess.py:65`: `df = df[["close"]].dropna()` — only close price kept
   - `train_lstm.py:138`: `LSTMModel(input_size=1, ...)`
   - `inference.py:222`: `LSTMModel(input_size=1, ...)`
   - Plan Section 10.2 explicitly lists 8 features and `input_size=8`.
   - Actual tensor shape: `(batch, 60, 1)` vs required `(batch, 60, 8)`
   - **All 8 features** (volume, vwap, sma_20, sma_50, rsi_14, high_low_range, log_return) are absent from the preprocessing pipeline.
   Fix: implement all 8 features in `preprocess.py`, change `input_size=8` in all files.

2. **Train/val/test split is 70/15/15, not 80/10/10** — `preprocess.py:38–39`: `TRAIN_RATIO = 0.70`, `VAL_RATIO = 0.15`.  Plan Section 10.5 specifies `TRAIN_RATIO = 0.8`, `VAL_RATIO = 0.1`, `TEST_RATIO = 0.1`.  Actual split confirmed by running: `(2319, 60, 1)` / `(496, 60, 1)` / `(498, 60, 1)` = 70.0 / 15.0 / 15.0.

3. **Model weights saved to `lstm_btc.pt`, not `lstm_btc_v1.pt`** — `train_lstm.py:44`: `MODEL_PATH = _HERE / "model" / "lstm_btc.pt"`.  Plan Section 10.2 and the project non-negotiables specify the filename `lstm_btc_v1.pt`.  `inference.py:52` also uses `lstm_btc.pt`.  The files are mutually consistent but deviate from the spec.

4. **`BATCH_SIZE = 32`, not 64** — `train_lstm.py:50`: `BATCH_SIZE = 32`.  Plan Section 10.4 specifies `BATCH_SIZE = 64`.  Minor impact on training speed.

5. **`PREDICTION_HORIZON = 60` (plan) vs `HORIZON = 7` (impl)** — Plan Section 10.2 specifies predicting 60 minutes ahead (`PREDICTION_HORIZON = 60`).  `inference.py:59`: `HORIZON = 7` (7-day daily forecast).  The difference is intentional (daily data → daily forecast) but it is an undocumented scope change.  The inference is also autoregressive (feeds predictions back), which amplifies error for long horizons.

6. **Dashboard Page 3 caption states `input_size=1`** — `03_prediction.py:36`: the caption reads "input_size=1".  This self-documents the deviation but does not fix it.

#### Bugs found

None that crash the code — but the univariate model is significantly less informative than the specified multivariate model.  Dry-run directional accuracy of 50.9% after 2 epochs is essentially random, consistent with an untrained univariate model.

---

### Sprint 6 — Polish & Integration | Score: 7/10

#### What the plan required

- Dashboard Page 3 fully integrated with `predictions` collection
- Documentation complete (README)
- Demo flow < 10 minutes, scripts ready

#### What was implemented

- Page 3 (`03_prediction.py`) fully implemented with graceful fallback — **complete**
- `scripts/run_inference.sh` present for generating predictions
- `scripts/run_batch.sh`, `scripts/create_topics.sh`, `scripts/seed_mongo.sh` present
- `docs/sprint_progress_report.md`, `docs/sprint4_report.md`, `docs/final_report.md` exist
- `scripts/run_all.sh` appears to be a full demo script

#### CORRECT items

- Page 3 renders historical context chart even without trained model
- Page 3 shows live predictions when `predictions` collection is populated
- Graceful fallback with informational messages on all pages
- `run_inference.sh` script for one-command prediction generation

#### INCORRECT / MISSING items

1. **README.md absent** — No `README.md` at the project root.  The plan Section 9.5 ("Ngày 13") lists "Viết README.md đầy đủ" as a required deliverable.

2. **`lstm_btc_v1.pt` absent** — The weight file at the plan-specified path `src/ml/model/lstm_btc_v1.pt` does not exist.  The actual path is `src/ml/model/lstm_btc.pt` and only exists after running `train_lstm.py`.

---

## Cross-Cutting Issues

### Issue 1: Model weight filename inconsistency

The plan non-negotiables specify `src/ml/model/lstm_btc_v1.pt` but the implementation uses `src/ml/model/lstm_btc.pt` consistently across `train_lstm.py:44` and `inference.py:52`.  While self-consistent, this deviates from the spec.

### Issue 2: Batch write not idempotent on re-run

`mongo_writer.write_batch()` for non-`realtime_prices` collections uses `insert_many` without deduplication.  Running the batch job twice will double the `daily_stats`, `historical_sma`, and `coin_correlation` collections.  The plan specifies `overwrite` mode.  The workaround (`run_batch.sh` dropping collections first) is fragile.

### Issue 3: Dashboard coin selection limited to 3

All 4 dashboard pages restrict coin selection to `["BTC", "ETH", "DOGE"]` because the sample CSVs only contain 3 coins.  The producer collects 7 coins in real-time, but the batch views (which drive most dashboard data) only cover 3.  This creates an inconsistency in the Lambda Architecture merge layer.

### Issue 4: `st.secrets` vs `os.environ`

The plan and non-negotiables specify `st.secrets["MONGO_URI"]` for credential management.  The implementation uses `os.environ.get("MONGO_URI")` in `app.py:35`.  This works for Docker deployment but is non-compliant with the Streamlit secrets spec.

---

## Enhancement Plan (Prioritised)

### P1 — Fix LSTM to multivariate (Plan compliance)

1. Update `preprocess.py` to compute and include all 8 features from `data/sample/bitcoin.csv` or a feature-engineered daily DataFrame.
2. Update `model.py` default `input_size=1` → `input_size=8`.
3. Update `train_lstm.py` and `inference.py` accordingly.
4. Retrain and verify directional accuracy improves above 50%.

### P2 — Fix model weight filename

Change `MODEL_PATH` in `train_lstm.py:44` and `inference.py:52` from `lstm_btc.pt` to `lstm_btc_v1.pt`.

### P3 — Fix Query A SMA-5 alias

In `streaming_job.py:207–231`, replace the second `avg("price_usd").alias("sma_5")` with an aggregation that uses a 5-minute tumbling window or a rowsBetween-5 post-aggregation window.

### P4 — Fix batch write overwrite semantics

In `mongo_writer.write_batch()`, implement collection drop-and-reload or a conditional `ReplaceOne` strategy for `daily_stats`, `historical_sma`, and `coin_correlation`.

### P5 — Add `linger_ms=100` to producer

In `crypto_producer.py:71–83`, add `linger_ms=100` to `KafkaProducer` kwargs.

### P6 — Expand to 7 coins in batch layer

Add `solana → SOL`, `ripple → XRP`, `cardano → ADA`, `binancecoin → BNB` sample CSVs and update `SAMPLE_COIN_MAP`.

### P7 — Fix train/val/test split ratio

Change `preprocess.py:38–39` to `TRAIN_RATIO = 0.80`, `VAL_RATIO = 0.10`.

### P8 — Use `st.secrets` for MongoDB URI

Change `app.py:35` to: `uri = st.secrets.get("MONGO_URI", os.environ.get("MONGO_URI", _DEFAULT_URI))`.

### P9 — Write README.md

Document project setup, architecture diagram, sprint deliverables, and demo flow.

---

## PoC Correctness Assessment

**Can this be demonstrated end-to-end?  Yes.**

| Component | State | Demo-ready? |
|---|---|---|
| Kafka producer | Fully implemented, tested | Yes |
| Kafka topics | Create script present, topics confirmed in sprint report | Yes |
| Spark Streaming | All 5 indicators implemented; dual-query architecture | Yes (needs cluster) |
| MongoDB indexes | TTL + compound on `realtime_prices`; ensured on first write | Yes |
| Spark Batch | 3-coin batch views; all SMA periods correct | Yes (limited scope) |
| Dashboard | All 4 pages, graceful fallback, auto-refresh | Yes |
| LSTM inference | Trains and generates 7-day forecast; univariate | Yes (reduced accuracy) |
| Docker Compose | All 7 services with healthchecks | Yes |

**What does not work as specified:**
- LSTM is univariate, not the 8-feature multivariate model in the plan.
- Correlation matrix is 3×3 (3 pairs), not 14×14 (91 pairs).
- Batch collections accumulate duplicates on re-run without manual drop.

**What works correctly and is demo-ready:**
- Kafka producer → `crypto_raw` with all 7 coins and correct schema
- Spark Streaming with all 5 indicators (SMA, RSI, VWAP, Bollinger) via `foreachBatch`
- MongoDB TTL index (7 days), compound index, upsert deduplication
- Dashboard with dark theme, auto-refresh, graceful fallback to batch data
- LSTM model trains, generates forecasts, and writes to `predictions` collection
- All 130 unit tests pass with zero failures

---

## Recommended Fixes (Priority Order)

| Priority | Issue | File | Fix | Effort |
|----------|-------|------|-----|--------|
| P1 | LSTM `input_size=1` vs plan's `input_size=8` | `src/ml/preprocess.py`, `model.py`, `train_lstm.py`, `inference.py` | Build 8-feature dataset; change `input_size`; retrain | High (2–3 days) |
| P2 | Model weight filename `lstm_btc.pt` vs `lstm_btc_v1.pt` | `src/ml/train_lstm.py:44`, `inference.py:52` | Rename constant and saved file | Low (5 min) |
| P3 | Query A `sma_5` and `sma_20` are identical | `src/spark/streaming_job.py:213–214` | Use separate window sizes for each alias | Medium (1 hour) |
| P4 | Batch write not idempotent (insert_many, no overwrite) | `src/spark/utils/mongo_writer.py:148` | Drop + insert or conditional upsert for batch collections | Medium (2 hours) |
| P5 | `linger_ms=100` missing from producer | `src/producer/crypto_producer.py:71` | Add `linger_ms=100` to KafkaProducer kwargs | Low (5 min) |
| P6 | Train split 70/15/15 vs plan's 80/10/10 | `src/ml/preprocess.py:38–39` | Change `TRAIN_RATIO=0.80`, `VAL_RATIO=0.10` | Low (5 min) |
| P7 | `BATCH_SIZE=32` vs plan's 64 | `src/ml/train_lstm.py:50` | Change `BATCH_SIZE=32` to `64` | Low (5 min) |
| P8 | Only 3 coins in batch layer (vs 14 or 7) | `src/spark/batch_job.py:78–81`, `src/dashboard/app.py:49` | Add remaining coin sample CSVs | Medium (1 day) |
| P9 | `os.environ` instead of `st.secrets` for MONGO_URI | `src/dashboard/app.py:35` | Use `st.secrets.get(...)` with fallback | Low (10 min) |
| P10 | README.md absent | project root | Write architecture, setup, and demo instructions | Medium (3 hours) |
