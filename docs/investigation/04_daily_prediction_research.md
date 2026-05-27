# Daily Prediction Migration — Research & Rationale

**Date:** 2026-05-27  
**Source:** `docs/ml_research_bitcoin_prediction.md`, `docs/ml_review.md`

---

## 1. Confirmed Root Causes Fixed in Current Version

Three bugs previously made the model 3.5× worse than a naive persistence baseline (RMSE $2,948 vs $840):

| Bug | Fix Applied |
|-----|-------------|
| **Data leakage** — MinMaxScaler fitted on full dataset | StandardScaler fitted only on training rows (`preprocess.py`) |
| **Non-stationary target** — predicting raw price levels | Log-returns as target → back-transform via cumsum(exp) |
| **Autoregressive error compounding** — 7 chained 1-step predictions | MIMO (Multi-Input Multi-Output): single forward pass → all 7 steps |

All three fixes are in the current codebase. The model now uses 9 stationary features, correct train-only scaler fitting, and a single-pass 7-day forecast.

---

## 2. Architecture Benchmark (2024–2026 Literature)

**Source:** arXiv:2603.16886 — 9 architectures × 918 experiments across cryptocurrency, forex, equity datasets.

| Rank | Architecture | Notes |
|------|-------------|-------|
| 1 | **ModernTCN** (temporal CNN) | Best overall; CPU-friendly |
| 2 | **PatchTST** (Transformer) | Patch-based; good for short sequences |
| 3 | **N-HiTS** | Best compute/accuracy tradeoff |
| 4 | **iTransformer** | Inverted attention across variates |
| 5 | **TimeXer** | Strong with exogenous features |
| 8 | **LSTM (vanilla)** | Consistently outperformed by modern models |

### For this project (~4k rows, CPU-only)

| Architecture | Suitability | Reason |
|-------------|-------------|--------|
| **N-HiTS** | ★★★ Best fit | CPU-efficient, MIMO native, `pip install neuralforecast` |
| **LightGBM + lag features** | ★★★ Excellent | Beats LSTM on <5k rows; no GPU; sanity-check baseline |
| **PatchTST** | ★★ Good | Viable on short sequences; moderate CPU cost |
| **2-layer LSTM (current)** | ★★ Acceptable | Correct now; needs feature improvements |
| **TFT / Autoformer** | ★ Avoid | TFT underfits <2k sequences; Autoformer worst in benchmarks |

> **Key finding:** "Directional accuracy remains near 50% across ALL configurations without feature engineering." Architecture choice matters less than input quality.

---

## 3. Feature Engineering Improvements

### 3.1 Currently Implemented (9 features)
```
log_return_1d, log_return_7d, log_return_30d, RSI_14, log_volume,
macd_norm, bb_pct_b, atr_norm, fear_greed
```

### 3.2 Recommended Next Additions (2 features → N_FEATURES=11)

| Feature | Formula | Why |
|---------|---------|-----|
| `rolling_vol_7d` | `std(log_return_1d, window=7)` | Short-term volatility regime detection |
| `rolling_vol_30d` | `std(log_return_1d, window=30)` | Long-term volatility baseline |

Both are bounded, stationary, and computed from existing data without new API calls.

**Impact:** Literature shows rolling volatility signals improve directional accuracy by 3–7% in low-data regimes (<5k rows).

**Implementation change:** `_build_features()` in `preprocess.py`:
```python
# Feature 9: rolling 7-day volatility
vol_7 = np.full(N, np.nan)
for i in range(7, N):
    vol_7[i] = np.std(log_ret_1d[i-7:i])
# Feature 10: rolling 30-day volatility
vol_30 = np.full(N, np.nan)
for i in range(30, N):
    vol_30[i] = np.std(log_ret_1d[i-30:i])
```

Update `N_FEATURES = 9 → 11` and retrain. Scaler changes automatically.

---

## 4. Why Daily Predictions (Not 5-Min Re-Runs)

### Current approach problems

| Issue | Impact |
|-------|--------|
| 5-min re-runs of deterministic LSTM | Near-zero new information; prediction barely changes |
| `predictions` upserted every 5 min | History overwritten; no accuracy tracking possible |
| No daily-close anchor | `last_price_usd` is a random intraday point |
| 288 inference runs/day × 2 coins | Wastes CPU; contributes nothing to forecast quality |

### Daily approach benefits

| Benefit | Mechanism |
|---------|-----------|
| **Proper close-price anchor** | Run at midnight UTC → uses yesterday's actual closing price |
| **Accuracy tracking** | Each day's prediction is a distinct record; compare to next day's actual |
| **Computational efficiency** | 2 inference runs/day (vs 576); same forecast quality |
| **Audit trail** | `prediction_runs` has exactly 1 record per (coin, date) |
| **Dashboard accuracy** | MAE/MAPE/direction accuracy over past 14 days |

---

## 5. Walk-Forward Validation (Future Work)

Standard train/val/test split (80/10/10 chronological) gives one evaluation on one test window. Walk-forward validation tests the model across multiple rolling windows:

```
Window 1: train[0:800]  → test[800:900]
Window 2: train[0:900]  → test[900:1000]
Window 3: train[0:1000] → test[1000:1100]
...
```

**Requirements:** ≥3 windows → minimum 1,200 rows after warmup. Current dataset (4,100+ rows) supports ~32 windows — sufficient for walk-forward validation.

**Blocked on:** Implementation time. Phase 8 retraining pipeline is a prerequisite (need the ability to specify training range per window).

---

## 6. Key Literature References

| Paper | Key Finding |
|-------|-------------|
| arXiv:2603.16886 (Feb 2026) | ModernTCN ranked #1; LSTM ranked #8; direction accuracy near 50% without features |
| arXiv:2502.01029 | TFT underfits on <2,000 training sequences |
| arXiv:2501.01010 | Mamba/SSM better than LSTM for regime shifts |
| IEEE ICBC 2025 | Mamba outperforms LSTM on BTC 30-day forecasting |
| arXiv:2510.15900 (Oct 2025) | VMD + LSTM beats standard LSTM on RMSE, MAE, R² |
| AAAI 2023 (N-HiTS) | 20% accuracy improvement over Transformers; 50× less compute |
