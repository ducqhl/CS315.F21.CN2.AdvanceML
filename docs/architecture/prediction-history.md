# Prediction History Architecture

**Version**: 1.0  
**Last Updated**: 2026-05-24

---

## Problem

The current `predictions` collection uses **upsert on `(coin, prediction_date)`**. This means:
- Each inference run overwrites the same 7 documents (next 7 days)
- Once time passes, old prediction documents remain but there's no audit trail of *when* each prediction was made
- It's impossible to evaluate model accuracy over time (predicted vs actual comparison)

---

## Solution: `prediction_runs` Collection

A new collection that stores each inference run as a snapshot, enabling:
1. **Model accuracy tracking**: Compare predicted prices to actual closing prices
2. **Prediction history visualization**: Show past predictions as overlays on price history charts
3. **Confidence calibration**: Track how often direction predictions were correct
4. **Audit trail**: Full record of all inference runs with metadata

---

## Schema: `prediction_runs`

Each inference run creates **one document** per coin with all 7 day-predictions embedded:

```json
{
  "_id": ObjectId,
  "run_id": "20260524T223045_BTC",      // unique run identifier
  "coin": "BTC",
  "run_timestamp": "2026-05-24T22:30:45Z",  // when inference ran
  "model_version": "lstm_v2",
  "seed_source": "live_prices",           // live_prices | historical_sma | csv
  "seed_price": 67420.52,                // last known price at inference time
  "predictions": [
    {
      "prediction_date": "2026-05-25T00:00:00Z",
      "predicted_price": 67890.00,
      "direction": "UP",
      "direction_prob": 0.76,
      "trend_strength": "MODERATE",
      "confidence": 0.80
    },
    // ... 6 more days
  ],
  "summary": {
    "next_day_price": 67890.00,
    "seven_day_high": 69200.00,
    "seven_day_low": 66100.00,
    "bullish_days": 5,
    "bearish_days": 2,
    "outlook": "BULLISH"
  }
}
```

**Index**: `{coin: 1, run_timestamp: -1}` — sorted by most recent  
**TTL**: 90 days on `run_timestamp` (auto-cleanup old runs)

---

## Backend Changes

### New API Endpoint

```
GET /api/predictions/{coin}/history?days=30
```

Returns the last N days of prediction runs for model accuracy review:

```json
[
  {
    "run_id": "20260524T223045_BTC",
    "run_timestamp": "2026-05-24T22:30:45Z",
    "seed_price": 67420.52,
    "model_version": "lstm_v2",
    "predictions": [...],
    "summary": {...}
  }
]
```

### Inference Changes (src/ml/inference.py)

Add a write to `prediction_runs` after each inference run:

```python
def save_prediction_run(db, coin: str, predictions: list[dict], seed_price: float, ...):
    run_id = f"{datetime.utcnow().strftime('%Y%m%dT%H%M%S')}_{coin}"
    doc = {
        "run_id": run_id,
        "coin": coin,
        "run_timestamp": datetime.now(timezone.utc),
        "model_version": model_version,
        "seed_source": seed_source,
        "seed_price": seed_price,
        "predictions": predictions,
        "summary": compute_summary(predictions),
    }
    db.prediction_runs.insert_one(doc)
```

---

## Frontend Visualization

### Prediction History Overlay (PredictionsPage)

The chart shows two series overlaid:
1. **Actual price history** (area, cyan) — from `historical_sma`
2. **Past prediction runs** (scatter dots) — from `prediction_runs`

Each historical prediction run is rendered as:
- A colored circle on the actual price chart at `prediction_date`
- Color: green if direction was UP, red if DOWN, amber if FLAT
- Tooltip: shows predicted price, actual price, direction accuracy

```
Price
 │                              ●  ●  ●  ●  ← forecast (gold dashed)
 │         ●  ●              ●
 │      ●     ●  ●        ●     ← past run predictions (colored dots)
 │   ────────────────────────── ← actual price (cyan area)
 └────────────────────────────── Time
      Past 90 days        │ Future 7 days
                          today
```

### Prediction History Table

Below the chart, a collapsible table showing:
| Run Date | Model | Seed Price | Next-Day Predicted | Actual Price | Accuracy |
|----------|-------|-----------|-------------------|-------------|---------|
| 2026-05-23 | lstm_v2 | $67,100 | $67,890 | $67,450 | ±0.65% |
| 2026-05-22 | lstm_v2 | $66,800 | $67,200 | $67,180 | ±0.03% |

**Accuracy** = `|predicted - actual| / actual × 100`  
Colored: green < 2%, amber 2-5%, red > 5%

---

## Migration Plan

1. **Phase 1** (immediate): Add `prediction_runs` writes to `inference.py`
2. **Phase 2**: Add `/api/predictions/{coin}/history` endpoint
3. **Phase 3**: Update frontend PredictionsPage with history overlay
4. **Phase 4**: Add accuracy metrics to stats endpoint

---

## Data Retention

| Collection | Retention | Reason |
|-----------|-----------|--------|
| `predictions` | Indefinite | Current upsert behavior unchanged |
| `prediction_runs` | 90 days (TTL) | Balance storage vs. useful history window |
| `realtime_prices` | 7 days (TTL) | High-frequency data, TTL already configured |
