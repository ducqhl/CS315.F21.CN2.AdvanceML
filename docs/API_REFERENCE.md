# API Reference — Crypto Big Data FastAPI Backend

Base URL: `http://localhost:8000/api`  
Auth: All protected endpoints require `Authorization: Bearer <JWT>` header.

---

## Authentication

### POST /auth/login

Login and obtain a JWT.

**Request body:**
```json
{ "username": "admin", "password": "password123" }
```

**Response:**
```json
{
  "access_token": "eyJ...",
  "token_type": "bearer",
  "username": "admin",
  "expires_in": 28800
}
```

---

### GET /auth/me *(protected)*

Returns the currently authenticated user.

**Response:** `{ "username": "admin", "role": "admin" }`

---

## Public

### GET /health

```json
{ "status": "ok", "mongo": "connected", "timestamp": "2026-05-27T..." }
```

### GET /stats

Returns document counts and latest prices.

```json
{
  "doc_counts": { "daily_stats": 1200, "predictions": 14 },
  "latest_prices": { "BTC": { "price": 95000, "date": "2026-05-26" } },
  "timestamp": "2026-05-27T..."
}
```

---

## Price Data *(protected)*

### GET /realtime/{coin}

Latest speed-layer price for `bitcoin` or `dogecoin`.

**Response fields:** `symbol`, `price`, `avg_close`, `daily_high`, `daily_low`, `avg_volume`, `source`, `event_time`

---

### GET /historical/{coin}?days=90

Daily historical OHLCV + SMA.

**Query params:** `days` (1–3650, default 90)

**Response:** Array of:
```json
{
  "date": "2026-05-20T00:00:00+00:00",
  "symbol": "BTC",
  "avg_close": 94500.0,
  "sma_20": 93800.0,
  "sma_50": 91200.0,
  "daily_high": 95100.0,
  "daily_low": 93900.0,
  "avg_volume": 28000000000.0
}
```

---

### GET /technical/{coin}?days=180

Daily OHLCV + computed technical indicators.

**Query params:** `days` (1–3650, default 180)

**Response:** Array of historical points **plus**:
```json
{
  "open": 94200.0,
  "high": 95100.0,
  "low": 93900.0,
  "close": 94500.0,
  "rsi": 58.3,
  "bb_upper": 97000.0,
  "bb_middle": 93800.0,
  "bb_lower": 90600.0,
  "macd": 320.4,
  "macd_signal": 290.1,
  "macd_histogram": 30.3
}
```

---

## Intraday *(protected)*

### GET /intraday/{coin}/dates

Dates with 5-min candle data and prediction availability.

**Response:**
```json
{
  "symbol": "BTC",
  "dates": [
    { "date": "2026-05-26", "candle_count": 288, "has_predictions": true }
  ]
}
```

---

### GET /intraday/{coin}?date=YYYY-MM-DD&range=24h

5-min OHLCV candles + intraday predictions.

**Query params:**
- `date`: YYYY-MM-DD (takes priority over range)
- `range`: `24h` | `3d` | `7d` | `all`

**Response:**
```json
{
  "symbol": "BTC",
  "range": "2026-05-26",
  "actual": [{ "t": "2026-05-26T09:00:00Z", "o": 94200, "h": 94350, "l": 94100, "c": 94280, "v": 1200000 }],
  "predicted": [{ "t": "2026-05-26T09:05:00Z", "close": 94310, "direction": "UP", "confidence": 0.72 }],
  "actual_count": 288,
  "predicted_count": 280
}
```

---

## Predictions *(protected)*

### GET /predictions/{coin}?model_id=

7-day daily LSTM forecast.

**Query params:** `model_id` (optional — filter by specific model registry id)

**Response:**
```json
{
  "coin": "BTC",
  "model_version": "lstm_v2",
  "predictions": [
    {
      "coin": "BTC",
      "predicted_price": 96200.0,
      "prediction_date": "2026-05-28T00:00:00Z",
      "confidence": 0.81,
      "direction": "UP",
      "direction_prob": 0.81,
      "trend_strength": "STRONG",
      "model_id": "bitcoin_20260527_120000"
    }
  ],
  "dominant_direction": "UP",
  "direction_counts": { "UP": 5, "DOWN": 1, "FLAT": 1 },
  "avg_confidence": 0.77,
  "dominant_strength": "MODERATE",
  "next_day_price": 96200.0,
  "seven_day_high": 98100.0,
  "seven_day_low": 93800.0
}
```

---

### GET /predictions/{coin}/history?days=60

Prediction run history joined with actual prices.

**Response:** Array of prediction run records enriched with:
- `actual_price` — actual closing price (when available)
- `error_pct` — `(predicted − actual) / actual × 100`
- `actual_direction` — UP / DOWN / FLAT from actual log-return
- `direction_correct` — whether predicted direction matched actual

---

## Correlation *(protected)*

### GET /correlation

BTC/DOGE Pearson correlation matrix.

```json
{
  "coins": ["BTC", "DOGE"],
  "matrix": { "BTC": { "BTC": 1.0, "DOGE": 0.82 }, "DOGE": { "BTC": 0.82, "DOGE": 1.0 } }
}
```

---

## Model Management *(protected)*

### GET /models?coin=bitcoin

List model registry entries.

**Query params:** `coin` — `bitcoin` or `dogecoin` (optional filter)

**Response:** Array of:
```json
{
  "model_id": "bitcoin_20260527_120000",
  "coin": "BTC",
  "coin_id": "bitcoin",
  "version_tag": "20260527_120000",
  "file_path": "/app/model/lstm_bitcoin_20260527_120000.pt",
  "trained_at": "2026-05-27T12:00:00Z",
  "metrics": { "f1_macro": 0.48, "direction_accuracy_pct": 62.1, "rmse": 1240.5 },
  "enabled": true,
  "deleted_at": null,
  "epochs_trained": 42
}
```

---

### POST /models/train

Trigger async LSTM training.

**Request body:**
```json
{ "coin": "bitcoin", "epochs": 30, "model_name": "my_experiment" }
```

**Response:** `{ "job_id": "a3b7c9d1", "status": "started" }`

---

### GET /models/train/{job_id}/status

Poll training job status.

**Response:**
```json
{
  "job_id": "a3b7c9d1",
  "coin": "bitcoin",
  "status": "completed",
  "started_at": "2026-05-27T12:00:00Z",
  "completed_at": "2026-05-27T12:04:30Z",
  "model_id": "bitcoin_my_experiment"
}
```

Status values: `started` | `running` | `completed` | `failed`

---

### PATCH /models/{model_id}/toggle

Toggle enable/disable for a model.

**Response:** Updated model registry document.

---

### DELETE /models/{model_id}

Soft-delete a model (sets `deleted_at`, `enabled=false`). File is kept on disk.

**Response:** `{ "ok": true, "model_id": "bitcoin_20260527_120000" }`

---

## Inference Status *(protected)*

### GET /inference/status

Latest inference cycle status for all coins.

```json
{
  "jobs": {
    "BTC": { "coin": "BTC", "status": "completed", "last_run": "2026-05-27T..." },
    "DOGE": { "coin": "DOGE", "status": "completed" }
  },
  "interval_seconds": 300,
  "timestamp": "2026-05-27T..."
}
```

---

## Error Responses

| Status | Meaning |
|--------|---------|
| 400 | Bad request (unknown coin, invalid params) |
| 401 | Missing or invalid JWT |
| 404 | No data found for the requested resource |
| 500 | Internal server error (training launch failure, etc.) |

All errors return: `{ "detail": "Human-readable message" }`
