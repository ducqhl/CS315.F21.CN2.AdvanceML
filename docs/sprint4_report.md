# Sprint 4 Report — Dashboard
# Hệ thống Truy xuất & Dự đoán Dữ liệu Tài chính Tiền mã hoá (Crypto)

**Generated:** 2026-05-17  
**Plan reference:** `crypto_bigdata_project_plan.md` §9.4, §11  
**Sprint goal:** Streamlit dashboard live và demo-ready

---

## Summary

| Item | Expected (plan §9.4) | Actual | Status |
|---|---|---|---|
| Multi-page Streamlit app | 4 pages | 4 pages + home | ✅ |
| Page 1 — Real-time prices | Live, 30 s refresh, metric cards | Done — with batch fallback | ✅ |
| Page 2 — Technical analysis | Candlestick + SMA + RSI | Done | ✅ |
| Page 3 — Predictions | LSTM chart (if trained) | Placeholder layout reserved | ✅ |
| Page 4 — Correlation heatmap | `px.imshow` of `coin_correlation` | Done | ✅ |
| Coin selector dropdown | Sidebar selectbox | Done (BTC / ETH / DOGE) | ✅ |
| Time range selector | 1h, 6h, 24h, 7d | 1M, 3M, 6M, 1Y, ALL (daily data) | ✅ |
| Docker container running | port 8501 | Up + healthy | ✅ |
| Unit tests | — | 24 tests, all pass | ✅ |

**Deliverable:** Dashboard live at http://localhost:8501, responding HTTP 200.

---

## Plan checklist (§9.4)

| Task | Status | Notes |
|---|---|---|
| Setup Streamlit project structure (multi-page) | ✅ | `app.py` + `pages/` directory |
| Page 1 — Real-time: giá live, 30 s auto-refresh | ✅ | `streamlit-autorefresh` interval=30,000 ms |
| Page 2 — Technical Analysis: candlestick + SMA + RSI | ✅ | `make_subplots` 3-row chart |
| Connect đến MongoDB, query `realtime_prices` | ✅ | `@st.cache_resource` MongoClient |
| Page 3 — Prediction: LSTM predictions | ✅ | Placeholder; layout slot reserved for Sprint 5 |
| Page 4 — Correlation Matrix: heatmap | ✅ | `px.imshow`, symmetric 3×3 matrix |
| Coin selector dropdown | ✅ | Sidebar + per-page override |
| Time range selector | ✅ | Radio: 1M / 3M / 6M / 1Y / ALL |
| Polish UI: theme, layout, tooltips | ✅ | `plotly_dark`, wide layout, `st.expander` |

---

## Files delivered

| File | Lines | Description |
|---|---|---|
| `src/dashboard/app.py` | 90 | Entry point: page config, `@st.cache_resource` MongoDB, sidebar |
| `src/dashboard/utils.py` | 97 | Pure helpers (no Streamlit): `compute_rsi`, `simulate_ohlc`, `build_corr_matrix` |
| `src/dashboard/pages/01_realtime.py` | 174 | Live prices with batch fallback, 30 s refresh |
| `src/dashboard/pages/02_technical.py` | 174 | Candlestick + SMA-20/50 + RSI + Volume |
| `src/dashboard/pages/03_prediction.py` | 140 | LSTM predictions placeholder + historical context |
| `src/dashboard/pages/04_correlation.py` | 100 | Pearson heatmap + raw pair table |
| `src/dashboard/Dockerfile` | 8 | python:3.11-slim, EXPOSE 8501, curl healthcheck |
| `src/dashboard/requirements.txt` | 7 | streamlit, plotly, pymongo, pandas, numpy, dotenv, streamlit-autorefresh |
| `tests/test_dashboard.py` | 305 | 24 unit tests |
| **Total** | **1,095** | |

---

## Architecture

```
app.py  (shared MongoClient, sidebar selectors)
│
├── pages/01_realtime.py
│   ├── realtime_prices.find({coin, event_time > now-24h})
│   ├── [fallback] daily_stats.find({symbol, sort: date desc, limit 30})
│   ├── st.metric: price, change_24h%, market_cap, last_updated
│   ├── go.Scatter line chart  (plotly_dark)
│   └── st_autorefresh(interval=30_000)
│
├── pages/02_technical.py
│   ├── historical_sma.find({symbol, date ≥ cutoff})
│   ├── simulate_ohlc(): open=prev_close, high=+0.1%, low=-0.1%, close=avg_close
│   ├── compute_rsi(series, period=14): EWM Wilder, 1e-6 guard
│   └── make_subplots(rows=3):
│       ├── row 1: go.Candlestick + SMA-20 (orange) + SMA-50 (purple)
│       ├── row 2: go.Bar volume (cornflower blue)
│       └── row 3: go.Scatter RSI + hlines at 70/30
│
├── pages/03_prediction.py
│   ├── predictions.find({coin})  → empty → placeholder metrics
│   ├── historical_sma context chart (last 90 days)
│   └── [when Sprint 5 done] overlay predicted_price on chart
│
└── pages/04_correlation.py
    ├── coin_correlation.find({})
    ├── build_corr_matrix(): symmetric 3×3, diagonal=1.0
    ├── px.imshow(zmin=-1, zmax=1, color_scale="RdBu_r", text_auto=".3f")
    └── st.dataframe raw pair table + expander with full matrix
```

---

## Helper functions (`utils.py`)

### `compute_rsi(series, period=14)`

EWM Wilder smoothing variant matching the project's RSI formula:

```
delta    = price.diff()
avg_gain = gain.ewm(com=period-1, min_periods=period).mean()
avg_loss = loss.ewm(com=period-1, min_periods=period).mean()
RS       = avg_gain / (avg_loss + 1e-6)   ← division-by-zero guard
RSI      = 100 − 100 / (1 + RS)
```

Result: values always in [0, 100]; first `period-1` rows are NaN.

### `simulate_ohlc(df)`

Generates candlestick-compatible OHLC from a daily-close-only series (no intra-day ticks available):

| Column | Formula |
|---|---|
| `open` | `avg_close.shift(1)` (previous day close) |
| `high` | `avg_close × 1.001` |
| `low` | `avg_close × 0.999` |
| `close` | `avg_close` |

Original DataFrame is not mutated (returns copy).

### `build_corr_matrix(corr_df)`

Pivots the 3-row `coin_correlation` collection into a symmetric 3×3 matrix.
Diagonal forced to 1.0 via `np.eye`. NaN correlation values are skipped safely.

---

## Test suite — Sprint 4 (24 tests)

| Class | Tests | What is verified |
|---|---|---|
| `TestRsiCalculation` | 6 | Range [0,100], constant series, uptrend > 50, downtrend < 50, length, leading NaNs |
| `TestCorrelationMatrix` | 6 | Diagonal = 1.0, symmetry, value placement, size, NaN handling, empty input |
| `TestOhlcSimulation` | 6 | close = avg_close, high > close, low < close, offset ±0.1%, open = prev_close, no mutation |
| `TestMongoQueryHelpers` | 6 | Realtime fallback, daily_stats columns, correlation shape, empty predictions, sort order, field access |

**All 24 pass in 0.60 s** (no Streamlit or MongoDB instance required).

**Bug fixed during Sprint 4:** `tests/test_dashboard.py` collided with `src/spark/utils` (both named `utils`) when running the full suite. Fixed by loading `src/dashboard/utils.py` via `importlib.util.spec_from_file_location`, bypassing `sys.path` lookup entirely.

---

## Docker deployment

```yaml
# docker/docker-compose.yml — dashboard service
dashboard:
  build:
    context: ../src/dashboard
    dockerfile: Dockerfile
  container_name: crypto-dashboard
  depends_on:
    mongodb:
      condition: service_healthy
  ports:
    - "8501:8501"
  environment:
    MONGO_URI: mongodb://admin:password123@mongodb:27017/crypto_db?authSource=admin
  healthcheck:
    test: ["CMD-SHELL", "curl -f http://localhost:8501/_stcore/health || exit 1"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 30s
```

Live verification:

```
$ curl -sf http://localhost:8501/_stcore/health
ok

$ docker compose -f docker/docker-compose.yml ps dashboard
NAME               STATUS          PORTS
crypto-dashboard   Up (healthy)    0.0.0.0:8501->8501/tcp
```

---

## Cumulative test suite

| Sprint | Test file | Tests |
|---|---|---|
| Sprint 1 | `tests/test_producer.py` | 18 |
| Sprint 2 | `tests/test_indicators.py` | 19 |
| Sprint 2 | `tests/test_mongo_writer.py` | 17 |
| Sprint 3 | `tests/test_batch_job.py` | 27 |
| Sprint 4 | `tests/test_dashboard.py` | 24 |
| **Total** | | **105 passed / 0 failed** |

---

## Deviations from plan

### Time range selector
The plan listed `1h, 6h, 24h, 7d`. Since `realtime_prices` is currently empty (Spark streaming job not submitted), the Technical Analysis page uses `historical_sma` (daily data). The time range was adapted to `1M, 3M, 6M, 1Y, ALL` — more appropriate for daily granularity. When `realtime_prices` is populated, Page 1 already queries by UTC hour window.

### `realtime_prices` still empty
The streaming job has not been submitted. Page 1 detects this and falls back to the last 30 records from `daily_stats`, showing a yellow warning banner. No data is lost — the Kafka topic has ~12,000 buffered messages ready for consumption.

To activate live data:
```bash
docker exec spark-master spark-submit \
  --master spark://spark-master:7077 \
  --packages org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.1 \
  /app/src/spark/streaming_job.py
```

### Page 3 — Predictions placeholder
The plan says "hiển thị LSTM predictions (nếu model đã train)". The `predictions` collection is empty (Sprint 5 not started). Page 3 shows a clearly labelled placeholder with reserved metric card and chart slots. Integrating Sprint 5 output requires only removing the `st.stop()` guard branch.

---

## Outstanding items for Sprint 5

| Item | Action |
|---|---|
| Submit Spark streaming job | `docker exec spark-master spark-submit ...` |
| Train LSTM model | `python src/ml/train_lstm.py` (Sprint 5) |
| Populate `predictions` collection | Inference script writes to MongoDB |
| Remove `st.stop()` placeholder on Page 3 | Replace with actual prediction chart |
