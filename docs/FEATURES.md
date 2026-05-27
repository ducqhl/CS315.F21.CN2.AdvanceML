# Features — Crypto Big Data Analytics Platform

## 1. Real-Time Price with Candlestick Chart

**Page:** Real-Time (`/realtime`)

**What it does:**
- Fetches 90 days of OHLCV data from the `/api/technical/{coin}` endpoint
- Renders an interactive TradingView `lightweight-charts` candlestick chart
- Toggle overlays: **MA 20** (gold), **MA 50** (violet), **Bollinger Bands** (red dashed)
- Auto-refreshes realtime price card every 5 minutes

**Technical indicators available:**
| Indicator | Description |
|-----------|-------------|
| MA 20 | 20-day Simple Moving Average |
| MA 50 | 50-day Simple Moving Average |
| Bollinger Bands | Upper/Middle/Lower bands (20-period, 2σ) |

**Chart controls:** Click any overlay chip above the chart to show/hide. Scroll to zoom, drag to pan.

---

## 2. Trend Forecast (Predictions)

**Page:** Predictions (`/predictions`)

**What it does:**
- Shows the **day-ahead trend** as the primary signal (UP / DOWN / FLAT) with confidence %
- 7-day daily outlook table with direction badges and trend strength bars
- Intraday 5-min candlestick chart for the selected date
- Predicted vs. actual comparison line chart with MAE badge

**Model selector:**
- Pill buttons above the forecast cards list all enabled models for the selected coin
- Select "LATEST" (default) for the most recent prediction, or pick a specific model version
- Switching model re-fetches predictions filtered by `model_id`

**Prediction data fields per day:**
| Field | Description |
|-------|-------------|
| direction | UP / DOWN / FLAT (primary signal from LSTM direction head) |
| direction_prob | Softmax probability of predicted direction (confidence) |
| trend_strength | STRONG / MODERATE / WEAK (derived from probability margin) |
| predicted_price | USD price estimate (secondary signal) |
| confidence | Overall prediction confidence (0–1) |

---

## 3. Technical Analysis

**Page:** Technical (`/technical`)

**What it does:**
- Multi-timeframe OHLCV chart (1M / 3M / 6M / 1Y)
- Toggle overlays: MA20, MA50, Bollinger Bands
- Sub-charts: RSI (14), MACD (12/26/9) with histogram
- All data computed server-side by `GET /api/technical/{coin}`

---

## 4. Correlation Analysis

**Page:** Correlation (`/correlation`)

**What it does:**
- Displays the Pearson correlation matrix between BTC and DOGE
- Computed by the Spark batch job from daily closing prices (rolling 30-day window)
- Correlation of +1 means perfect positive correlation, −1 means inverse

---

## 5. Model Management

**Page:** Model Mgmt (`/models`)

**What it does:**
- Lists all LSTM model versions for the selected coin
- Shows training metrics: F1-macro, directional accuracy %, RMSE
- **Enable / Disable** toggle: disabled models are excluded from the prediction fan-out
- **Delete** (soft): marks the model as deleted in the registry; file is kept on disk
- **Trigger Retrain**: launches an async training job; polls status every 4 seconds
- Shows training job progress (started → running → completed/failed)

**Model version naming:**
- Manual trigger: `{coin}_{YYYYMMDD_HHMMSS}` (auto) or custom name
- Auto-retrain: same auto-timestamp format
- All versions stored in `src/ml/model/lstm_{coin}_{version}.pt`

---

## 6. Auto-Retrain Background Jobs

**Component:** `inference_scheduler.py`

**Behaviour:**
| Job | Trigger | Action |
|-----|---------|--------|
| Inference fan-out | Every 5 min (configurable) | Run 7-day predictions for all enabled models; write to `predictions` |
| 5-min intraday | Every 5 min | Run next-step prediction; write to `intraday_predictions` |
| Auto-retrain check | Every ~6 hours (rate-limited) | If newest model > `RETRAIN_INTERVAL_DAYS` old, spawn training subprocess |

**Environment variables:**
| Variable | Default | Description |
|----------|---------|-------------|
| `INFERENCE_INTERVAL_SECONDS` | 300 | Seconds between inference cycles |
| `RETRAIN_INTERVAL_DAYS` | 7 | Days before auto-retrain triggers |
| `SCHEDULER_FETCH_COINGECKO` | true | Whether to pull live prices each cycle |

---

## 7. Dashboard Overview

**Page:** Dashboard (`/dashboard`)

**What it does:**
- Current price hero card with 30-day sparkline
- Collection size badges (realtime, batch, predictions, correlation docs)
- Inference job status (last run, model version, seed source)
- Quick navigation to other pages

---

## User Workflows

### Analyst Workflow
1. Log in (admin / password123 by default — change in production)
2. Go to **Real-Time** → inspect the candlestick chart, toggle MA/BB for context
3. Go to **Predictions** → select a model → read day-ahead direction + 7-day outlook
4. Go to **Technical** → deep dive on RSI/MACD for entry/exit signal confirmation
5. Go to **Correlation** → check BTC/DOGE relationship before diversifying

### ML Engineer Workflow
1. Go to **Model Mgmt** → review model metrics (F1, direction accuracy)
2. Click **Trigger Retrain** to train a new version on fresh data
3. Wait for training to complete (watch the status bar)
4. Enable new model, disable old one if metrics improved
5. Switch to **Predictions** → select the new model version to compare forecasts
