# Business Logic — Crypto Big Data Analytics Platform

## 1. Data Ingestion Rules

### CoinGecko API Rate Limiting

The CoinGecko demo tier allows 10,000 calls/month.

| Consumer | Calls/month | Notes |
|----------|-------------|-------|
| Producer (price + OHLC) | ~4,320 + 2,880 = 7,200 | 6/hr × 24h × 30d × 1.5 |
| Inference scheduler (direct fetch) | ~8,640 | 12/hr × 24h × 30d |
| **Total** | **~15,840** | Exceeds demo tier |

**Mitigation:** Set `SCHEDULER_FETCH_COINGECKO=false` to disable direct scheduler fetches and rely solely on the producer's `live_prices` writes. With `POLL_INTERVAL_SECONDS=600`, the producer alone uses ~4,320 calls.

### Producer Guarantees

- **At-least-once delivery**: Kafka producer uses `acks=all`, `retries=3`
- **No duplicate protection** at producer level; downstream Spark uses windowed aggregation which is idempotent on time windows
- Messages include `event_time` (UTC) for Spark watermarking

---

## 2. Streaming Processing Rules

### Spark Streaming Watermark

- Watermark: 10 minutes — messages arriving more than 10 minutes late are dropped
- Window size: 5 minutes (`groupBy(window("event_time", "5 minutes"))`)
- Aggregations within each window: avg_price, sum_volume, min, max

### Indicator Calculations (Speed Layer)

These are computed per 5-min window in Spark:

| Indicator | Formula |
|-----------|---------|
| SMA(n) | Rolling mean of avg_close over n windows |
| RSI(14) | Wilder's RSI on close prices (Spark UDF) |
| Bollinger Upper | SMA(20) + 2 × std(20) |
| Bollinger Lower | SMA(20) − 2 × std(20) |
| VWAP | Σ(price × volume) / Σvolume |
| ATR(14) | Average True Range |

For the REST API, RSI/MACD/BB are recomputed in-memory at query time from `historical_sma` (`src/api/main.py` helpers `compute_rsi`, `compute_bb`, `compute_macd`).

---

## 3. ML Prediction Logic

### Feature Engineering

Input to the LSTM is a 60-timestep sequence of 9 features per timestep:

| Feature | Description |
|---------|-------------|
| `log_return_1d` | `log(close[t] / close[t-1])` — primary target |
| `sma_ratio_7` | `close / SMA(7)` |
| `sma_ratio_30` | `close / SMA(30)` |
| `rsi_14` | Relative Strength Index (14-period) |
| `vol_ratio` | `volume / rolling_mean_volume(30)` |
| `bb_pct` | `(close - BB_lower) / (BB_upper - BB_lower)` |
| `macd_hist` | MACD histogram |
| `fear_greed` | Fear & Greed index (from CSV; 0–100, normalized) |
| `price_momentum` | `close / close[t-7] - 1` |

All features are **standardized** using `sklearn.StandardScaler` fitted on the training set. The scaler is saved alongside the model as `scaler_{coin}.pkl`.

### MIMO Forecast Strategy

Single forward pass predicts all 7 future log-returns simultaneously (Multi-Input Multi-Output). This eliminates error compounding from autoregressive chaining.

USD price reconstruction:
```
price[k] = last_price_usd × exp(cumsum(log_returns)[k])
```

### Dual-Head Loss Function

```
total_loss = α × price_loss + β × direction_loss

where:
  α = 0.3   (secondary task — price magnitude)
  β = 1.0   (primary task — trend direction)
  price_loss = HuberLoss with direction penalty
               (wrong-direction samples weighted 1 + DIRECTION_PENALTY = 3×)
  direction_loss = CrossEntropyLoss (class-weighted for DOWN/FLAT/UP imbalance)
```

### Direction Classification Rules

| Class | Label | Condition |
|-------|-------|-----------|
| 0 | DOWN | `log_return_1d < −0.01` |
| 1 | FLAT | `−0.01 ≤ log_return_1d ≤ +0.01` |
| 2 | UP | `log_return_1d > +0.01` |

These thresholds are set in `preprocess.py` using an adaptive percentile method.

### Trend Strength Derivation

Trend strength is derived from the **softmax probability margin** (top-1 minus top-2 class probability):

| Margin | Strength |
|--------|----------|
| > 0.4 | STRONG |
| 0.2 – 0.4 | MODERATE |
| < 0.2 | WEAK |

### Model Selection & Fan-out

When multiple models are enabled in the registry:
- The inference scheduler runs all enabled models each cycle
- Each model's predictions are tagged with `model_id` and upserted independently
- The API endpoint `GET /api/predictions/{coin}?model_id=<id>` returns a specific model's forecast
- Without `model_id`, the endpoint returns the most recently written predictions (regardless of model)

---

## 4. Model Lifecycle

```
train_lstm.py run
    │
    ├── Saves versioned artifact:  lstm_{coin}_{YYYYMMDD_HHMMSS}.pt
    ├── Updates canonical alias:   lstm_{coin}_v2.pt
    ├── Saves scaler:              scaler_{coin}.pkl
    ├── Saves metrics JSON:        metrics_{coin}.json
    └── Writes to model_registry (MongoDB):
            model_id, coin, version_tag, file_path,
            trained_at, metrics, enabled=True, deleted_at=None
            │
            │ (on next scheduler cycle)
            ▼
    inference_scheduler reads model_registry
    For each enabled model → run_inference(model_path=..., model_id=...)
    Predictions written to predictions collection tagged with model_id
            │
            │ (optional manual action via Model Mgmt page)
            ▼
    PATCH /api/models/{id}/toggle  → flip enabled
    DELETE /api/models/{id}        → soft delete (file kept)
            │
            │ (auto-retrain after RETRAIN_INTERVAL_DAYS)
            ▼
    inference_scheduler.check_and_retrain(coin)
    If newest model > N days old → spawn train_lstm.py subprocess
```

---

## 5. Data Freshness SLAs

| Data | Source | Update Frequency |
|------|--------|-----------------|
| Realtime price | Kafka → Spark → MongoDB | ~5 minutes |
| Intraday candles | live_prices collection | ~10 minutes (producer) |
| Daily batch stats | historical_sma | Daily (manual batch job) |
| 7-day predictions | LSTM inference | Every 5 minutes |
| 5-min predictions | LSTM intraday | Every 5 minutes |
| Model re-training | inference_scheduler | Every 7 days (default) |

---

## 6. Authentication & Security

- **JWT**: HS256, 8-hour expiry, custom implementation (no external library dependency)
- **Password hashing**: SHA-256 (single round — suitable for demo; upgrade to bcrypt for production)
- **Admin bootstrap**: On startup, the API creates a default admin user if none exists
- **CORS**: Configured to allow all origins (`*`) in development; restrict in production

---

## 7. Prediction Accuracy Tracking

`prediction_runs` collection is an append-only log: for every scheduler cycle, it records what the model predicted for each future date, along with `run_date`. Once those dates pass, the API joins actual closing prices from `historical_sma` to compute:

- `error_pct = (predicted − actual) / actual × 100`
- `direction_correct = (predicted_direction == actual_direction)`

These are surfaced in the "Daily Prediction Run History" accordion on the Predictions page.
