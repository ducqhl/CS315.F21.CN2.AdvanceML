# ML Architecture Investigation — LSTM Model

**Date:** 2026-05-27  
**Scope:** `src/ml/model.py`, `src/ml/train_lstm.py`, `src/ml/preprocess.py`

---

## 1. Model Architecture

### 1.1 Core Structure

**Class:** `LSTMModel` (`src/ml/model.py`)

```
Input (batch, seq_len=60, input_size=9)
    │
    ▼
2-layer LSTM
  hidden_size=128, dropout=0.2
    │
    └── last hidden state (batch, 128)
         │
         ├──► Price Head (Linear 128→64 → ReLU → Dropout(0.1) → Linear 64→7)
         │    Output: (batch, 7) — 7-day MIMO log_return_1d forecast
         │
         └──► Direction Head (optional, enabled by default)
              Linear 128→128 → LayerNorm → ReLU → Dropout(0.2)
              → Linear 128→64 → ReLU → Dropout(0.1)
              → Linear 64→21  → reshape (batch, 7, 3)
              Output: (batch, 7, 3) — raw logits per step per class
```

### 1.2 Output Heads

| Head | Loss | Weight | Classes/Dims | Primary Signal |
|------|------|--------|--------------|----------------|
| Price | Direction-weighted HuberLoss | α=0.3 | 7 scalars | Auxiliary |
| Direction | CrossEntropyLoss (class-weighted) | β=1.0 | 7 × {0=DOWN, 1=FLAT, 2=UP} | **Primary** |

Direction is the primary task. Price regression is auxiliary — it exists to anchor the forecast in physical USD space.

---

## 2. Input Features (N_FEATURES=9)

All computed in `src/ml/preprocess.py:_build_features()` from daily OHLCV CSV.

| Index | Feature | Formula | Notes |
|-------|---------|---------|-------|
| 0 | `log_return_1d` | `log(close[t] / close[t-1])` | Primary target variable (also a feature) |
| 1 | `log_return_7d` | `log(close[t] / close[t-7])` | Weekly momentum |
| 2 | `log_return_30d` | `log(close[t] / close[t-30])` | Monthly trend |
| 3 | `RSI_14` | Wilder's smoothed RSI, period=14 | Momentum oscillator [0,100] |
| 4 | `log_volume` | `log(total_volume + 1)` | Zero if `total_volume` column absent |
| 5 | `macd_norm` | `(EMA_12 − EMA_26) / close` | Scale-neutral MACD |
| 6 | `bb_pct_b` | `(close − lower) / (upper − lower)` | 20-period Bollinger %B, bounded [0,1] |
| 7 | `atr_norm` | `|log_return_1d|` | Proxy ATR (no high/low in daily CSV) |
| 8 | `fear_greed` | Alternative.me index / 100 | Cached in `data/sample/fear_greed.csv` |

**Warmup:** First ~30 rows are NaN (log_return_30d needs 30 prior prices). Dropped before sequence creation.

---

## 3. Target Variable

```
y[:, k] = StandardScaler(log_return_1d)[t + k + 1],  k = 0 … 6
```

Inverse transform: `price[k] = last_price_usd × exp(cumsum(y[:, 0:k+1] × scale + mean))`

### Direction Labels

Computed via adaptive quantile thresholds (`make_direction_labels`, `target_pct=0.33`):
- **UP (2):** log_return > 67th percentile
- **DOWN (0):** log_return < 33rd percentile
- **FLAT (1):** remainder (~34%)

Quantile-based labelling ensures balanced classes (avoids FLAT domination from fixed threshold).

---

## 4. Training Pipeline

**File:** `src/ml/train_lstm.py`

### 4.1 Data Split

```
Raw feature rows (after warmup drop)
    │
    ├── 80% → train (scaler fitted HERE ONLY — prevents data leakage)
    ├── 10% → val
    └── 10% → test
```

> **Critical:** `StandardScaler.fit()` is called only on training rows. Val/test use `transform()`. This was a confirmed data-leakage bug (prior MinMaxScaler fitted on full dataset) that was fixed in the current version.

### 4.2 Sequence Creation

```
_create_sequences(scaled, seq_len=60, horizon=7)
→ X shape: (M, 60, 9)    M = N − 60 − 7 + 1
→ y shape: (M, 7)         feature-0 (log_return_1d) for next 7 steps

_create_direction_sequences(dir_labels, seq_len=60, horizon=7)
→ y_dir shape: (M, 7)     int64 direction labels
```

### 4.3 Loss Function

```python
loss = alpha * price_loss + beta * dir_loss

# price_loss: direction-weighted Huber
# wrong-sign predictions get weight (1 + DIRECTION_PENALTY=2.0)
# = 3× heavier penalty for predicting wrong direction

# dir_loss: CrossEntropyLoss with inverse-frequency class weights
# ensures DOWN/FLAT/UP each contribute proportionally to gradient
```

### 4.4 Training Hyperparameters

| Parameter | Value |
|-----------|-------|
| `EPOCHS` | 50 (max) |
| `BATCH_SIZE` | 64 |
| `LEARNING_RATE` | 1e-3 |
| `WEIGHT_DECAY` | 1e-5 |
| `PATIENCE` | 10 (early stopping) |
| `alpha` (price weight) | 0.3 |
| `beta` (direction weight) | 1.0 |
| Optimizer | Adam |
| LR Scheduler | ReduceLROnPlateau(patience=5, factor=0.5) |
| Gradient clip | max_norm=1.0 |

### 4.5 Saved Artifacts

| File | Contents |
|------|---------|
| `src/ml/model/lstm_{coin}_v2.pt` | Model weights (best val loss) |
| `src/ml/model/scaler_{coin}.pkl` | `StandardScaler` fitted on train set |
| `src/ml/model/metrics_{coin}.json` | RMSE, MAE, F1-macro, directional accuracy, confusion matrix |

---

## 5. Evaluation Metrics

Computed on test set (last 10% of data):

| Metric | Target |
|--------|--------|
| **F1-macro** (direction head, primary) | > 0.40 (chance = 0.333) |
| **Direction accuracy %** (direction head) | > 50% (chance = 33.3%) |
| Per-class accuracy DOWN/FLAT/UP | Balanced across classes |
| RMSE in USD (secondary) | Meaningful vs persistence baseline |
| MAE in USD (secondary) | Meaningful vs persistence baseline |
| Price directional accuracy | > 50% (sign of step-1 log_return) |

---

## 6. Known Limitations

1. **seq_len=60 daily rows = 2 months lookback** — LSTM sees 2 months to predict 1 week. Crypto markets have regimes shorter than 60 days; a shorter seq_len (30) might improve generalization.
2. **ATR proxy is weak** — `|log_return_1d|` is a poor proxy for true ATR (requires high/low). Daily OHLCV from CoinGecko provides high/low; these could be incorporated.
3. **No rolling volatility features** — literature recommends `std(log_return_1d, window=7/30)` as regime-detection signals (see `04_daily_prediction_research.md`).
4. **Single model per coin** — no ensemble; ensemble of 3–5 models would reduce variance.
5. **CPU training only** — sufficient for 4k rows; would be limiting at >50k rows.
