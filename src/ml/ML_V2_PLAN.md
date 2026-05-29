# ML v2 Implementation Plan
> Status: PLANNED — implement in a fresh session

## Goal
Improve crypto LSTM forecasting by fixing 3 root causes of poor direction accuracy:
1. Training on 11 years of mixed regimes → rolling 2-year window
2. Static test set always regime-shifted → walk-forward validation
3. Lagging features (log_ret_7d/30d) → momentum + realized volatility

## Current state (v2, as of 2026-05-29)
- `src/ml/model.py` — price-only LSTM (`use_direction_head=False`)
- `src/ml/train_lstm.py` — trains on full CSV (~4165 rows), PATIENCE=7, direction-weighted Huber loss
- `src/ml/inference.py` — price-only `_mimo_predict`, direction derived from price sign
- `src/ml/inference_scheduler.py` — runs every 5 min, no auto-retrain
- Model artifacts: `lstm_{coin}_v2.pt`, `scaler_{coin}.pkl`
- BTC metrics: RMSE=$3072, MAE=$2242, price dir acc=48.9% (near-random)

## Target state (v3 model files)
- Model artifacts: `lstm_{coin}_v3.pt`, `scaler_{coin}_v3.pkl`
- BTC direction accuracy target: 54-58% (walk-forward avg)
- Weekly auto-retrain baked into scheduler

---

## Files to change

### 1. `src/ml/preprocess.py`
**Replace features 1 and 2** in `_build_features()`:
- Feature 1: `log_ret_7d` → `momentum_30d = close[t]/SMA30[t] - 1`
- Feature 2: `log_ret_30d` → `realized_vol_14d = rolling 14-day std of log_return_1d`
- All other features (0, 3-8) unchanged — keeps scaler column 0 = log_return_1d (critical)
- Warmup drops from 30 → 29 rows (fine)

**Add `window_days` param to `load_and_preprocess()`**:
```python
def load_and_preprocess(..., window_days: int = 730, ...):
    # slice: df = df.iloc[-window_days:] before feature engineering
```
Default=730 (2 years). `None` = use all data (backward compat).

**Add `load_for_fold()` function** (used by walk_forward.py):
```python
def load_for_fold(df_raw, fg_full, train_end_idx, val_end_idx,
                  seq_len, horizon, window_days=730):
    # Returns X_tr, y_tr, X_vl, y_vl, scaler_fold, last_price
    # Does NOT save scaler to disk
```

**Add volatility target** (when `with_vol_target=True`):
```python
fwd_vol[i] = std(log_return_1d[i+1 : i+8], ddof=1)  # 7-day forward realized vol
# Scale separately, return as y_vol_train/val/test
# load_and_preprocess return tuple grows 11→14 only when with_vol_target=True
```

### 2. `src/ml/model.py`
**Add `VolatilityHead` class** (after DirectionHead, before LSTMModel):
```python
class VolatilityHead(nn.Module):
    def __init__(self, hidden_size=128, output_size=7):
        self.net = nn.Sequential(
            nn.Linear(hidden_size, 64), nn.ReLU(), nn.Dropout(0.1),
            nn.Linear(64, output_size), nn.Softplus()  # guarantees > 0
        )
    def forward(self, last_hidden): return self.net(last_hidden)  # (batch, 7)
```

**Add `use_volatility_head: bool = False` to `LSTMModel`**:
- Forward returns `(price_preds, vol_preds)` when True, else just `price_preds` (backward compat)

### 3. NEW `src/ml/walk_forward.py`
Standalone module — walk-forward validation only, no side effects (no disk writes).

```
Algorithm (6 folds × 60 days):
  last_val_end = N - HORIZON
  first_train_end = last_val_end - n_folds * fold_size   (fold_size=60)

  for k in range(n_folds):
      train_end = first_train_end + k * fold_size
      val_end   = train_end + fold_size
      effective_train_start = max(0, train_end - window_days)

      # Build features, fit scaler on train only, create sequences
      # Train a throwaway model (PATIENCE=5, epochs=30, not saved)
      # Compute RMSE, MAE, price dir accuracy on val set
      # Append to fold_metrics

  return avg across folds
```

Key: load full fear_greed array ONCE, slice by index (not by count) per fold.

### 4. `src/ml/train_lstm.py`
**New CLI args:**
- `--window-days` (default 730) — passed to `load_and_preprocess`
- `--gamma` (default 0.3) — volatility loss weight
- `--model-version` (default 3) — output filename `lstm_{coin}_v3.pt`
- `--walk-forward` (flag) — run walk_forward_validation() and print results before training

**Model change:**
```python
model = LSTMModel(..., use_volatility_head=True)
# Combined loss:
loss = alpha * direction_weighted_huber(price_preds, y_price)  # alpha=1.0
     + gamma * MSELoss(vol_preds, y_vol)                        # gamma=0.3
```

**Training loop**: add `y_vol_batch` from DataLoader (4-element TensorDataset).

**Metrics**: add vol head RMSE to test output.

**Scaler path**: save as `scaler_{coin}_v3.pkl` when model-version=3.

### 5. `src/ml/inference.py`
**Version priority ladder**: try v3 first → v2 → v1
```python
def _model_path_v3(coin): return _MODEL_DIR / f"lstm_{coin}_v3.pt"
def _scaler_path_v3(coin): return _MODEL_DIR / f"scaler_{coin}_v3.pkl"
```

**When loading v3**: instantiate with `use_volatility_head=True`, call new `_mimo_predict_v3()` that unpacks `(price_preds, vol_preds)`.

**Add `predicted_volatility` to MongoDB doc** (optional field — backward compat):
```python
doc["predicted_volatility"] = float(vol_preds[idx])  # annualised? or raw?
```

**Fix**: `torch.load(..., weights_only=True)` to silence PyTorch 2.x warning.

### 6. `src/ml/inference_scheduler.py`
**New env var**: `RETRAIN_INTERVAL_DAYS=7`

**New function `run_weekly_retrain(coin)`**:
- Imports `train` from `train_lstm` locally
- Calls `train(coin, window_days=730, model_version=3, gamma=0.3, ...)`
- Writes result to new `retrain_log` MongoDB collection
- Returns True/False (non-fatal)

**Main loop addition** (fires at DAILY_INFERENCE_HOUR, gated by interval):
```python
_last_retrain_date: str = ""

# Inside while True, after daily trigger:
if days_since_retrain >= RETRAIN_INTERVAL_DAYS:
    for coin in COINS:
        run_weekly_retrain(coin)   # blocking ~2-5 min, acceptable
    _last_retrain_date = today_str
```

**Order**: retrain BEFORE daily inference so new model is used immediately.

---

## Implementation order
1. `preprocess.py` — feature swap + window_days param (foundation for everything)
2. `model.py` — add VolatilityHead
3. `walk_forward.py` — new file, standalone
4. `train_lstm.py` — wire everything together, test locally
5. `inference.py` — v3 path + vol field
6. `inference_scheduler.py` — weekly retrain trigger
7. Retrain both coins: `python src/ml/train_lstm.py --coin bitcoin --model-version 3 --walk-forward`
8. Rebuild Docker + redeploy

## Critical invariants (do not break)
- `features[:, 0]` MUST remain `log_return_1d` — scaler.scale_[0]/mean_[0] used in un-standardisation
- Fear & greed: load full array once, slice by index (not by count) in walk-forward
- MongoDB `predictions` collection schema unchanged (new fields are optional/additive)
- v2 model files (`lstm_{coin}_v2.pt`) preserved as fallback
- `train()` new params must be keyword-only with defaults (inference_scheduler calls it)

## Risks
1. **Column 0 drift** — add assertion `assert abs(features[:, 0].mean()) < 0.05` after build
2. **FastAPI strict schema** — check if Pydantic uses `extra="forbid"` before adding predicted_volatility
3. **Blocking retrain** — weekly retrain blocks scheduler 2-10 min; document this
4. **walk-forward fold size** — with window_days=730 and 6 folds×60 days, fold-0 has ~275 training sequences; if too tight, reduce to n_folds=4 or fold_months=1
