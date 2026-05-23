# Plan: Fix ML Pipeline — 3 Critical Bugs

## Context

The LSTM model is 3.5× worse than a naive persistence baseline (RMSE $2,948 vs $840). Three confirmed root causes:
1. **Data leakage** — `MinMaxScaler` is fit on the entire dataset before splitting, so test-set statistics bleed into training.
2. **Non-stationary target** — predicting raw price levels (strongly trending) rather than log-returns (mean-reverting).
3. **Autoregressive error compounding** — `_iterative_predict` feeds each predicted price back 7 times, multiplying errors.

Target outcome: RMSE drops below ~$1,500 (meaningful improvement from $2,948); all 39 unit tests pass.

---

## Data Flow (Before → After)

```
BEFORE:
  CSV[close] → MinMaxScaler(fit on ALL) → _create_sequences(N, seq_len)
             → X(M, seq_len, 1)  y(M,)  ← scalar next-price (normalised)
             → _iterative_predict (7 autoregressive steps, error compounds)

AFTER:
  CSV[close, total_volume] → _build_features() → (N, 5) features, NaN first ~30 rows
             → drop warmup → split 80/10/10 on raw rows FIRST
             → StandardScaler.fit(train only) → scale all splits
             → _create_sequences(N, seq_len, horizon=7)
             → X(M, seq_len, 5)  y(M, 7) ← 7-step log_return vector
             → _mimo_predict (single forward pass → 7 predictions at once)
```

---

## Files to Modify (dependency order)

1. `src/ml/preprocess.py` — biggest change: feature engineering + scaler fix
2. `src/ml/model.py` — defaults only (`input_size`, `output_size`)
3. `src/ml/train_lstm.py` — unpack new 8-tuple, update metrics, remove squeeze
4. `src/ml/inference.py` — swap `_iterative_predict` → `_mimo_predict`
5. `tests/test_lstm.py` — update for new shapes, replace iterative tests

**Unchanged:** `src/api/`, `src/frontend/`, `tests/e2e/`, MongoDB schema, model filenames, `HORIZON=7`, `MODEL_VERSION="lstm_v1"`

---

## Step 1 — `preprocess.py`

**1a. Replace import:** `MinMaxScaler` → `StandardScaler`

**1b. Add constant:** `HORIZON = 7` near `SEQ_LEN`

**1c. Add `_compute_rsi()` helper** (pure numpy, Wilder's smoothing — no pandas_ta):
```python
def _compute_rsi(prices: np.ndarray, period: int = 14) -> np.ndarray:
    deltas = np.diff(prices)
    gains  = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    avg_gain = np.full(len(prices), np.nan)
    avg_loss = np.full(len(prices), np.nan)
    avg_gain[period] = gains[:period].mean()
    avg_loss[period] = losses[:period].mean()
    for i in range(period + 1, len(prices)):
        avg_gain[i] = (avg_gain[i-1] * (period-1) + gains[i-1]) / period
        avg_loss[i] = (avg_loss[i-1] * (period-1) + losses[i-1]) / period
    rs = np.where(avg_loss == 0, np.inf, avg_gain / avg_loss)
    return 100.0 - (100.0 / (1.0 + rs))
```
Note: `gains[i-1]` at prices index `i` = the gain from `prices[i-1]→prices[i]`, which is the correct Wilder's update.

**1d. Add `_build_features()` function:**
```python
def _build_features(df: pd.DataFrame) -> np.ndarray:
    # df must have 'close' column; optionally 'total_volume'
    # Returns shape (N, 5) with NaN in first ~30 rows (warmup)
    close = df["close"].values.astype(np.float64)
    feat = np.full((len(close), 5), np.nan)
    feat[1:, 0] = np.log(close[1:] / close[:-1])          # log_return_1d
    feat[7:, 1] = np.log(close[7:] / close[:-7])          # log_return_7d
    feat[30:, 2] = np.log(close[30:] / close[:-30])        # log_return_30d
    feat[:, 3] = _compute_rsi(close)                       # RSI_14
    if "total_volume" in df.columns:
        vol = df["total_volume"].values.astype(np.float64)
        feat[:, 4] = np.log(vol + 1)
    # else leave feat[:,4] as NaN → will be replaced with 0 after warmup drop
    return feat.astype(np.float32)
```
First valid row is index 30 (log_return_30d). Caller drops rows where `np.isnan(feat).any(axis=1)`.

**1e. Update `_load_csv()`** — keep `total_volume` alongside `close` (line 74: `df = df[["close"]]` → `df = df[["close"] + (["total_volume"] if "total_volume" in df.columns else [])]`). Handle NaN volume → fill with 0 before `_build_features`.

**1f. Replace `_create_sequences()`** — new signature:
```python
def _create_sequences(
    scaled: np.ndarray,   # (N, 5)
    seq_len: int,
    horizon: int = HORIZON,
) -> tuple[np.ndarray, np.ndarray]:
    # X shape: (M, seq_len, 5)   where M = N - seq_len - horizon + 1
    # y shape: (M, horizon)      — horizon steps of feature-0 (log_return_1d), already scaled
```

**1g. Replace `load_and_preprocess()` body** — new signature returns 8-tuple:
```python
def load_and_preprocess(...) -> tuple[
    np.ndarray, np.ndarray,   # X_train, y_train
    np.ndarray, np.ndarray,   # X_val,   y_val
    np.ndarray, np.ndarray,   # X_test,  y_test
    StandardScaler,
    float,                    # last_price_usd (last close price in dataset)
]:
```
Order of operations:
1. `_load_csv()` → df with close (+ total_volume if present)
2. `_build_features(df)` → (N, 5) raw features
3. Drop NaN warmup rows (typically first 30)
4. **Split raw feature rows 80/10/10 BEFORE scaling** (Bug 1 fix)
5. `StandardScaler().fit(train_rows_only)` (Bug 2 fix — scaler sees only training distribution)
6. Transform all three splits
7. `_create_sequences()` on each split
8. `last_price_usd = float(close_prices[-1])` from original df
9. Attach `scaler.last_price_usd_ = last_price_usd` for convenience
10. Save scaler to disk (if `save_scaler=True`)
11. Return 8-tuple

**1h. Update `load_scaler()` docstring** — return type is now `StandardScaler`.

---

## Step 2 — `model.py`

Only change defaults — no structural changes to `LSTMModel`:
- `input_size: int = 1` → `input_size: int = 5`
- `output_size: int = 1` → `output_size: int = 7`
- Update docstring to reflect new shapes.

Note: existing `predict().squeeze(-1)` is harmless for `output_size=7` (squeeze only collapses size-1 dims, so a (N, 7) tensor stays (N, 7)). No change needed.

---

## Step 3 — `train_lstm.py`

**3a. Unpack 8-tuple from `load_and_preprocess`:**
```python
X_train, y_train, X_val, y_val, X_test, y_test, scaler, last_price_usd = load_and_preprocess(...)
```

**3b. Update model instantiation:** `input_size=5`, `output_size=7`

**3c. Remove `.squeeze(-1)` from train/val/test loops** — model output is `(batch, 7)`, target is `(batch, 7)`, `MSELoss` works element-wise on matching shapes.

**3d. Replace `_inverse()` + `compute_metrics()`** — new signature:
```python
def compute_metrics(y_true_norm, y_pred_norm, scaler, last_price_usd) -> dict
```
Un-standardize: `log_return = norm * scaler.scale_[0] + scaler.mean_[0]`.  
Reconstruct approximate USD prices: `price[t] = last_price_usd * exp(cumsum(log_returns_for_that_sequence))`.  
Compute RMSE/MAE by comparing predicted vs actual prices flattened across all test sequences and all 7 horizon steps.  
Directional accuracy: `sign(diff(y_true_log_returns))` vs `sign(diff(y_pred_log_returns))`.

**3e. Pass `last_price_usd` to `compute_metrics()` and save to metrics JSON** for traceability.

---

## Step 4 — `inference.py`

**4a. Add import:** `from preprocess import _build_features, HORIZON, SEQ_LEN`

**4b. Update `LSTMModel` instantiation:** `input_size=5`, `output_size=7`

**4c. Update `_load_last_n_from_mongo()`** — request `SEQ_LEN + 31` rows to account for feature warmup. Returns raw `avg_close` prices as 1-D array (unchanged shape).

**4d. Update `_load_last_n_from_csv()`** — similarly request `SEQ_LEN + 31` rows. Returns last `n` close prices (unchanged type).

**4e. Remove `_iterative_predict()`** entirely. Replace with:
```python
@torch.no_grad()
def _mimo_predict(
    model: LSTMModel,
    raw_prices: np.ndarray,   # shape (SEQ_LEN + 31,) — raw close prices
    scaler,
) -> np.ndarray:              # shape (7,) — USD prices
    """Single-pass MIMO prediction (Bug 3 fix — no autoregressive compounding)."""
    feats = _build_features_from_prices(raw_prices)  # (N, 5)
    feats = feats[~np.isnan(feats).any(axis=1)]      # drop warmup rows
    seed = feats[-SEQ_LEN:]                           # (SEQ_LEN, 5)
    seed_scaled = scaler.transform(seed)
    x = torch.tensor(seed_scaled[np.newaxis], dtype=torch.float32)  # (1, SEQ_LEN, 5)
    pred_norm = model(x).squeeze(0).cpu().numpy()    # (7,)
    # Un-standardize log_returns
    log_returns = pred_norm * scaler.scale_[0] + scaler.mean_[0]
    # Reconstruct USD prices
    last_price = scaler.last_price_usd_
    return last_price * np.exp(np.cumsum(log_returns))
```

Note: `_build_features_from_prices()` is a thin wrapper around `_build_features()` that creates a DataFrame from a 1-D prices array.

**4f. Update `run_inference()`:**
- Load `SEQ_LEN + 31` rows from MongoDB (or CSV fallback)
- Call `_mimo_predict(model, raw_prices, scaler)` instead of `_iterative_predict`
- `_write_predictions()` is unchanged — still writes 7 USD price documents

---

## Step 5 — `tests/test_lstm.py`

### Fixture changes
- **`sample_csv`**: 200 rows → **1000 rows**; add `total_volume` column (e.g., `np.random.rand(n) * 1e9 + 1e8`)
- **`fitted_scaler`**: unpack 8-tuple (add `last_price` variable)  
- **`small_model`**: `input_size=5, output_size=7`

### Import changes
Replace `_iterative_predict` import → `_mimo_predict` (from inference.py after it's added).

### Test class changes

| Class | Change |
|-------|--------|
| `TestLSTMModelForward` | Input shapes `(1,60,1)→(1,60,5)`, `(16,60,1)→(16,60,5)`; output shapes `(1,1)→(1,7)`, `(16,1)→(16,7)`; `predict()` result shape `(4,)→(4,7)` |
| `TestSequenceCreation` | Count formula: `N - seq_len - horizon + 1`; y shape `(M,7)`; replace `test_target_is_next_step` with `test_target_is_horizon_vector` checking `y.shape[1] == HORIZON` |
| `TestScalerNormalisation` | Replace `[0,1]` range checks with StandardScaler checks: `abs(y_tr.mean()) < 1.0` and `0.5 < y_tr.std() < 2.0`; fix `test_scaler_inverse` to use plausible standardized inputs |
| `TestChronologicalSplit` | `test_split_sizes_sum_to_total`: replace exact `200 - SEQ_LEN` with flexible `total > 0 and total < len_of_fixture_csv`; keep ordering check unchanged |
| `TestIterativePrediction` | **Remove** entirely |
| `TestMimoPrediction` (new) | Mock the model; test `_mimo_predict` returns exactly 7 positive values as a numpy array |
| `TestMongoDocumentStructure` | No change |
| `TestModelFilenames` | No change |
| `TestBtcAndDogePreprocess` | CSVs now 1000 rows with `total_volume`; assert `X_tr.shape[2] == 5`; assert `y_tr.shape[1] == 7`; remove `y_tr in [0,1]` check |
| `TestDryRunTraining` | No change needed (dry_run unpacks 8-tuple via updated train()) |

---

---

## Sprint 6 — Real-time Inference Architecture

### Overview

Sprint 6 extends the Lambda Architecture with three additions:
1. **Direct producer → MongoDB write** via a new `live_prices` collection.
2. **Periodic LSTM inference scheduler** that regenerates the 7-day forecast every 5 minutes.
3. **Enhanced prediction dashboard** with historical vs forecast comparison and accuracy tracking.

### Updated Data Flow

```
CoinGecko API
    │
    ├──[Kafka: crypto_raw]──► Spark Streaming ──► realtime_prices (Speed Layer)
    │
    └──[direct write]──────────────────────────► live_prices  ◄── NEW
                                                  (raw CoinGecko price on every poll)

[inference_scheduler: every 5 min]
    │
    ▼
inference.py — seed data priority:
    1. live_prices      (≥91 rows required — freshest signal)
    2. historical_sma   (batch layer fallback)
    3. data/sample CSV  (static guaranteed fallback)
    │
    └──► predictions collection (upserted, 7 docs per run)

Dashboard (03_prediction.py)
    ├── live_prices     — actual recent prices for comparison / accuracy
    ├── predictions     — forecast overlay
    ├── historical_sma  — background context
    └── [auto-refresh every 5 min]
```

### `live_prices` Collection

**Purpose:** Bypass the Kafka → Spark → MongoDB latency chain so the inference
scheduler always has access to the freshest price data for seeding the LSTM model.

**Written by:** `src/producer/crypto_producer.py` on every `fetch_prices()` call
(every `POLL_INTERVAL_SECONDS`, default 10 min). No additional CoinGecko API calls
are made — the data is reused from the existing Kafka record. Monthly API budget
stays at ~7,200 calls, well under the 10k demo tier limit.

**Schema:**
```json
{
  "coin":       "BTC" | "DOGE",
  "coin_id":    "bitcoin" | "dogecoin",
  "price_usd":  float,
  "volume_24h": float,
  "market_cap": float,
  "change_24h": float,
  "timestamp":  datetime (UTC),
  "source":     "coingecko_direct"
}
```

**Index:** `{coin: 1, timestamp: -1}` — supports the `find().sort().limit()` pattern
used by the inference seed loader.

### Why 91-row Minimum for Inference

The LSTM requires `SEQ_LEN + 31 = 60 + 31 = 91` rows to build a clean feature window:
- **30 warmup rows** for `log_return_30d` (needs 30 prior prices to compute)
- **14 warmup rows** for `RSI_14` (overlaps with the above)
- **60 rows** for the actual LSTM input sequence

At a 10-minute poll interval, `live_prices` accumulates 91 rows after ~15 hours of
producer uptime. During this warm-up window, inference falls back to `historical_sma`
(batch layer) transparently — the scheduler logs the seed source as a INFO-level entry.

### Inference Scheduler Design

**File:** `src/ml/inference_scheduler.py`

**Container:** `inference-scheduler` in `docker/docker-compose.yml`
- `restart: unless-stopped` — self-heals on crashes
- Volume-mounts `src/ml` and `data` so model artifacts are always current without
  rebuilding the Docker image

**Cycle logic:**
1. Call `run_inference("bitcoin")` → upsert 7 predictions to MongoDB
2. Call `run_inference("dogecoin")` → upsert 7 predictions to MongoDB
3. Sleep for remaining interval (accounts for inference time)
4. If both coins fail 3 consecutive cycles → log CRITICAL and continue retrying

**Failure modes handled:**
- `FileNotFoundError` → models not trained yet; logged as ERROR, retried next cycle
- MongoDB unavailable → prediction write fails inside `_write_predictions`; seed
  falls back to CSV so the inference still runs
- `live_prices` < 91 rows → falls back to `historical_sma` without error

### Prediction Accuracy Tracking

When `prediction_date` has passed and `live_prices` contains actual price data
within ±12 hours of the predicted date, the dashboard computes:
- **MAE** (Mean Absolute Error in USD)
- **MAPE** (Mean Absolute Percentage Error)

These metrics appear in the "Prediction Accuracy (Historical)" section of the
prediction page and update every 5 minutes alongside the forecast.

### `seed_source` Field in Predictions

Each prediction document now includes `"seed_source": "live_prices" | "historical_sma" | "csv"`
to show which data source powered the latest inference run. Visible in the dashboard
caption. Allows operators to verify whether the scheduler is using real-time data.

## Verification

```bash
# 1. Unit tests (no Docker, ~30s)
cd /home/user/repo
pytest tests/test_lstm.py -v

# 2. Train fixed model (BTC) — takes ~5 min on CPU
python src/ml/train_lstm.py --coin bitcoin
# Expected: RMSE < $2,000 (vs old $2,948), directional accuracy > 48%

# 3. Run inference + verify predictions
python src/ml/inference.py --coin bitcoin
python src/ml/inference.py --coin dogecoin

# 4. E2E tests (requires Docker)
pytest tests/e2e/test_ml_mongo.py -v -m e2e
```

**Success criteria:**
- All unit tests pass (39 tests, ~30s)
- BTC RMSE < $2,000 after training — meaningful regression from $2,948
- Directional accuracy > 48% (above coin-flip threshold)
- E2E: 17/17 pass, 7 predictions per coin written to MongoDB with positive USD prices