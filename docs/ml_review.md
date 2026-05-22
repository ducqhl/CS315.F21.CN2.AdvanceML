# ML Solution Review — LSTM Price Prediction (BTC / DOGE)

**Date:** 2026-05-22  
**Scope:** `src/ml/` — `preprocess.py`, `model.py`, `train_lstm.py`, `inference.py`  
**Data:** `data/sample/bitcoin.csv`, `data/sample/dogecoin.csv` (3,373 rows each, 2015-01-01 → 2024-03-27)

---

## 1. Current Performance

| Metric | BTC | DOGE |
|--------|-----|------|
| RMSE | $2,948 | $0.032 |
| MAE | $1,786 | $0.019 |
| Directional accuracy | **46.5%** | **45.0%** |
| Epochs trained | 29 / 50 | 12 / 50 |
| Best val loss | 0.000338 | 0.000902 |

**Interpretation:**  
RMSE looks acceptable in absolute terms (4.2% of BTC price), but the directional accuracy of ~46% is **worse than a random coin flip** (50%). This is the most important signal: the model cannot reliably predict whether the price will go up or down the next day. In practice that means predictions cannot be used for any trading decision.

---

## 2. Critical Bugs / Wrong Approaches

### 2.1 Data Leakage in Scaler Fitting (Critical)

**File:** `preprocess.py:137–138`

```python
# WRONG — scaler sees future data before the train/val/test split
scaler = MinMaxScaler(feature_range=(0, 1))
scaled = scaler.fit_transform(df[["close"]].values)   # ← fit on ALL rows
```

The scaler is fitted on the entire time series (train + val + test) before the chronological split. This means the `data_min_` and `data_max_` of the scaler are set using prices from the test period, leaking future information into the training normalization.

**Fix:**
```python
train_end_raw = int(len(df) * train_ratio)
scaler = MinMaxScaler(feature_range=(0, 1))
scaler.fit(df["close"].values[:train_end_raw].reshape(-1, 1))  # fit on train only
scaled = scaler.transform(df[["close"]].values)
```

---

### 2.2 Autoregressive Inference Compounds Errors (Critical)

**File:** `inference.py:148–186`

Each of the 7 forecast steps feeds the previous **predicted** value back as input. After step 1 the model no longer sees real prices — it sees its own predictions, which drift toward the dataset mean. By day 7 the forecast is essentially flat or smoothly decaying.

```python
for _ in range(horizon):
    x = torch.tensor(window[-SEQ_LEN:], ...)
    pred_norm = model(x).squeeze().item()
    window.append(pred_norm)   # ← error compounding
```

**Fix options:**
- Use direct multi-step output: change `output_size` to 7 and train to predict all 7 steps in one forward pass (avoids error accumulation entirely).
- If keeping autoregressive, add MC-Dropout uncertainty bands so the UI shows how unreliable the later steps are.

---

### 2.3 Univariate Input — Ignores All Available Features (Major)

**File:** `preprocess.py:73–74`

```python
df = df[["close"]].dropna()   # discards total_volume, market_cap
```

The CSV has `total_volume` and `market_cap` alongside `price`. Volume is one of the strongest short-term price signal inputs (volume spikes precede breakouts). The model is trained on close price alone, which makes it equivalent to a smoothed lag-1 predictor.

**Fix:** Add a multivariate preprocessing path:
```python
FEATURES = ["close", "log_volume", "log_market_cap", "return_1d", "return_7d"]
```
Update `input_size=5` in the model and training script.

---

### 2.4 Non-Stationary Input Series (Major)

Raw closing prices are non-stationary (strong upward trend from $172 to $73,097 for BTC). Training an LSTM on raw prices biases it toward "predict a value close to the last seen value" (the naive persistence baseline), which explains the low directional accuracy.

**Fix:** Train on **log-returns** instead of absolute prices:
```python
df["log_return"] = np.log(df["close"] / df["close"].shift(1))
df = df.dropna()
```
Then scale log-returns with `StandardScaler` (not MinMax). Inverse-transform with the last known price at inference time.

---

### 2.5 Hardcoded Confidence of 0.8 (Minor — Misleading)

**File:** `inference.py:64`

```python
CONFIDENCE = 0.8   # placeholder
```

Every prediction is written with `confidence: 0.8` regardless of model uncertainty. The dashboard shows this value, misleading users into believing the model is 80% confident. The model has no mechanism to produce a meaningful confidence score.

**Fix:** Implement MC-Dropout uncertainty:
```python
model.train()   # keep dropout active
preds = [model(x).item() for _ in range(50)]
mean, std = np.mean(preds), np.std(preds)
confidence = float(1.0 / (1.0 + std))   # normalized inverse std
```

---

### 2.6 Early Stopping Counter Bug (Minor)

**File:** `train_lstm.py:212–217`

```python
if val_loss < best_val_loss and not dry_run:
    best_val_loss = val_loss
    torch.save(model.state_dict(), model_path)
    epochs_no_improve = 0
elif not dry_run:
    epochs_no_improve += 1   # ← increments even in dry_run=False branch
```

In `dry_run=True` mode the counter is never incremented (correct), but the logic is confusing because the outer condition `not dry_run` makes the `elif` branch only reachable when `not dry_run` is already true. This is not a bug in practice but is hard to read and would become a bug if the conditions change.

**Fix:**
```python
if val_loss < best_val_loss:
    best_val_loss = val_loss
    epochs_no_improve = 0
    if not dry_run:
        torch.save(model.state_dict(), model_path)
else:
    epochs_no_improve += 1
if not dry_run and epochs_no_improve >= PATIENCE:
    break
```

---

### 2.7 Logging Epoch Progress Every 10 Epochs Hides Early Issues

**File:** `train_lstm.py:219–224`

```python
if epoch % 10 == 0 or epoch == 1:
    logger.info(...)
```

With `PATIENCE=10` and early stopping, the model for DOGE stopped at epoch 12. The only logs were epochs 1 and 10 — epoch 12 (where it stopped) was never printed. This makes debugging convergence issues difficult.

**Fix:** Log every epoch or reduce the interval to every 5 epochs.

---

## 3. Architecture Weaknesses

### 3.1 Model: 2-Layer LSTM, Hidden=128, Input=1

The current architecture is reasonable for a toy/educational project but:

| Limitation | Impact |
|-----------|--------|
| Univariate input (price only) | Cannot capture volume/momentum signals |
| Fixed 60-step lookback | May miss monthly/quarterly cycles in BTC |
| No attention mechanism | Cannot focus on relevant past events |
| MSE loss on raw prices | Penalizes large-price-scale errors more than small ones; all gradient signal comes from high-price regimes |

### 3.2 No Baseline Comparison — Model is Worse Than "No Model"

Verified empirically:

```
Persistence baseline RMSE:  $840.63   (predict tomorrow = today)
LSTM model RMSE:           $2,948.67
```

**The LSTM is 3.5× worse than the trivial persistence baseline.** This is a direct consequence of the data leakage (§2.1) and non-stationary input (§2.4). The model has learned to follow the long-run trend of the training data but cannot make accurate short-horizon predictions, resulting in higher absolute errors than simply repeating the last known price.

---

## 4. What Works Well

| Item | Why it's good |
|------|--------------|
| Chronological train/val/test split (no shuffle) | Correct for time series — no temporal leakage between splits |
| Gradient clipping (`max_norm=1.0`) | Prevents exploding gradients, common LSTM failure mode |
| `ReduceLROnPlateau` scheduler | Adaptive LR reduction on plateau is appropriate for this architecture |
| Best-checkpoint saving by val loss | Saves the best generalization point, not the last epoch |
| Early stopping (`PATIENCE=10`) | Prevents overfitting on small dataset |
| Separate scaler save for inference | Correct pattern — ensures inverse transform uses same scale as training |
| Dry-run mode for CI | Good testing hygiene |
| `@torch.no_grad()` on inference | Correct memory/speed optimization |

---

## 5. Enhancement Roadmap

### Priority 1 — Fix Correctness (do these before using predictions)

1. **Fix scaler data leakage** — fit only on training portion
2. **Switch to log-returns** — stationarity is prerequisite for meaningful learning
3. **Direct multi-output forecasting** — remove autoregressive error compounding; set `output_size=7` and train with all 7 targets at once

### Priority 2 — Improve Signal Quality

4. **Add multivariate features** — include volume, market cap, 1-day and 7-day returns as input features
5. **Add technical indicators as features** — RSI(14), SMA-20/50 crossover, ATR(14)
6. **Compute real confidence intervals** — MC-Dropout or quantile regression

### Priority 3 — Architecture Upgrade

7. **Attention-augmented LSTM** or **Temporal Fusion Transformer (TFT)** — TFT was designed for multi-horizon time series and handles multiple input features natively
8. **Walk-forward cross-validation** — instead of a single train/val/test split, use rolling window evaluation to get a realistic out-of-sample performance estimate
9. **Baseline comparison** — add persistence and SMA-7 baselines in the metrics JSON so the dashboard can show relative improvement

### Priority 4 — Operational

10. **Model versioning** — the current filename `lstm_bitcoin_v1.pt` never changes; add a timestamp or hash so retraining doesn't silently overwrite production weights
11. **Prediction freshness check** — the inference script should refuse to write predictions if the model file is older than N days
12. **Scheduled retraining** — add a cron job (or the existing `/schedule` skill) to retrain weekly as new prices arrive from the Kafka producer

---

## 6. Estimated Impact of Fixes

| Fix | Estimated directional accuracy improvement |
|-----|--------------------------------------------|
| Log-returns (stationarity) | +5–10 pp (currently 46% → 51–56%) |
| Multivariate features (+ volume, market cap) | +3–7 pp |
| Direct multi-output (remove AR compounding) | +2–4 pp for 7-day horizon |
| Attention / TFT architecture | +5–10 pp (needs more data) |
| Walk-forward validation | No accuracy change; gives reliable estimate |

A realistic target for daily BTC direction with historical daily OHLCV is ~55–60%. Anything above 55% directional accuracy with correct stationarity handling would be considered a working model for this dataset size.

---

## 7. Immediate Action Items

```bash
# 1. Verify the scaler leakage yourself:
python3 -c "
from src.ml.preprocess import load_and_preprocess
from pathlib import Path
_, _, _, _, _, _, sc = load_and_preprocess(Path('data/sample/bitcoin.csv'))
print('Scaler max (should equal TRAIN-set max, not full-data max):', sc.data_max_)
# If this equals 73097.77 (the dataset max), leakage is confirmed
"

# 2. Check persistence baseline RMSE for comparison:
python3 -c "
import pandas as pd, numpy as np
df = pd.read_csv('data/sample/bitcoin.csv')
prices = df['price'].values
# Persistence: predict t+1 = t
rmse = np.sqrt(np.mean((prices[1:] - prices[:-1])**2))
print(f'Persistence baseline RMSE: \${rmse:,.2f}')
# Compare to model RMSE of \$2,948
"
```
