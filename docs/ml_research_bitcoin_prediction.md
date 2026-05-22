# Research: Best Approaches for Bitcoin/Crypto Price Prediction

**Date:** 2026-05-22  
**Scope:** Multi-timeframe daily price forecasting (7-day horizon) on ~3,000-row OHLCV datasets  
**Context:** Improving the BTC/DOGE LSTM pipeline in `src/ml/` — current model is 3.5× worse than naive persistence baseline

---

## Table of Contents

1. [Root Cause Diagnosis](#1-root-cause-diagnosis)
2. [Architecture Rankings](#2-architecture-rankings)
3. [Feature Engineering](#3-feature-engineering)
4. [Walk-Forward Validation](#4-walk-forward-validation)
5. [Realistic Accuracy Benchmarks](#5-realistic-accuracy-benchmarks)
6. [Concrete Action Plan](#6-concrete-action-plan)
7. [Key Literature References](#7-key-literature-references)

---

## 1. Root Cause Diagnosis

The current model achieves RMSE $2,948 vs persistence baseline $840 — 3.5× worse than simply predicting "tomorrow = today." This is not an architecture limitation. It is three compounding encoding mistakes:

### 1.1 Raw Price as Training Target (Most Critical)

MinMaxScaler on raw BTC prices ($172–$73,097) creates extreme non-stationarity. The model learns to predict a number on a wildly shifting scale. When BTC is at $60k, a 5% error is $3,000. The scaler memorizes the price range, not the market dynamics. Persistence wins because "tomorrow ≈ today" is trivially true for raw prices.

**Fix:** Use log-returns as the learning target:
```python
df['log_return'] = np.log(df['close'] / df['close'].shift(1))
```
Back-transform at inference: `predicted_price = last_known_price * exp(sum(predicted_log_returns))`

### 1.2 Scaler Fitted on Full Dataset (Data Leakage)

Confirmed experimentally:
```
Full-data max:  $73,097.77
Train-only max: $67,617.02
Scaler max:     $73,097.77   ← leakage confirmed
```

The scaler "knows" the future maximum price during training, artificially compressing the test-set values into a learned range they never actually occupied during training.

**Fix:** Fit scaler only on the training portion:
```python
train_end_raw = int(len(df) * train_ratio)
scaler.fit(df['close'].values[:train_end_raw].reshape(-1, 1))
scaled = scaler.transform(df['close'].values)
```

### 1.3 Recursive 1-Step Chaining for 7-Day Horizon

The current inference feeds each predicted value back as input for the next step. Error amplification of 2–2.5× per multi-step horizon is documented (arXiv:2603.16886). By day 7 the forecast has drifted toward the dataset mean.

**Fix:** Direct multi-step output — predict all 7 days in one forward pass:
```python
# model.py: output_size=7
# preprocess.py: y = log_returns[i+1:i+8]  (7-element vector target)
```

### 1.4 Univariate Input — Ignores Available Features

The CSV contains `total_volume` and `market_cap` alongside `price`, but `preprocess.py` discards them (`df = df[["close"]].dropna()`). Volume is one of the strongest short-term price signal inputs.

---

## 2. Architecture Rankings

### 2.1 Controlled Benchmark Results (2024–2026 Literature)

**Source:** arXiv:2603.16886 (Feb 2026) — 9 architectures, 918 experiments across cryptocurrency, forex, and equity datasets.

| Rank | Architecture | Mean Rank | 1st-Place Rate | Notes |
|------|-------------|-----------|----------------|-------|
| 1 | **ModernTCN** (temporal CNN) | 1.33 | 75% | Best overall, CPU-friendly |
| 2 | **PatchTST** (Transformer) | 2.00 | — | Patch-based, handles short sequences well |
| 3 | **N-HiTS** | 3.x | — | Best compute/accuracy tradeoff |
| 4 | **iTransformer** | 4.x | — | Inverted attention across variates |
| 5 | **TimeXer** | 5.x | — | Strong with exogenous features |
| 6 | **DLinear** | 6.x | — | Surprisingly competitive simple baseline |
| 7 | **TimesNet** | 7.x | — | 2D transformation approach |
| 8 | **LSTM (vanilla)** | 8.x | — | Consistently outperformed by modern models |
| 9 | **Autoformer** | 9.x | — | Worst performer |

> **Critical finding:** "Directional accuracy remains near 50% across ALL configurations" without feature engineering. Architecture choice matters less than input features.

### 2.2 Architecture Suitability for This Project (~3k rows, CPU-only)

| Architecture | Suitability | Reasoning |
|-------------|-------------|-----------|
| **N-HiTS** | Best fit | CPU-efficient, handles multi-step natively, `pip install neuralforecast` |
| **LightGBM w/ lag features** | Excellent | Frequently beats LSTM on <5k rows; no GPU needed |
| **PatchTST** | Good | Works well for short sequence patches; moderate CPU cost |
| **ModernTCN** | Good | Best accuracy but higher compute than N-HiTS |
| **2-layer LSTM (current)** | Acceptable | Not wrong — just needs proper feature engineering first |
| **TFT** | Poor fit | Needs >2,000 sequences; underfits here (confirmed arXiv:2502.01029) |
| **Autoformer / Informer** | Avoid | Consistently worst in controlled benchmarks |
| **Mamba/SSM** | Future | Better regime-shift handling than LSTM (arXiv:2501.01010, IEEE ICBC 2025) |

### 2.3 Key Architecture Descriptions

#### N-HiTS (Neural Hierarchical Interpolation for Time Series)
- Published: AAAI 2023
- "Average accuracy improvement of almost 20% over Transformer architectures while reducing computation time by 50×"
- Handles multi-step output natively — no recursive chaining
- Installation: `pip install neuralforecast`
- Direct drop-in: `from neuralforecast.models import NHITS`

#### PatchTST
- Treats subsequences (patches) as tokens instead of individual time steps
- Reduces sequence length fed to attention, making it viable on short datasets
- Best Transformer option for ~3k rows

#### LightGBM with Lag Features
- Consistently competitive or better than LSTM on small financial datasets
- Build with lag features: 1, 2, 3, 5, 7, 14, 30-day lags of log-returns + RSI
- Serves as a sanity-check baseline: if LightGBM beats LSTM, the issue is model capacity, not features

#### VMD + LSTM (Variational Mode Decomposition)
- Source: arXiv:2510.15900 (Oct 2025)
- Decomposes price series into intrinsic mode functions before feeding to LSTM
- Beats standard LSTM on RMSE, MAE, R² for 30-day BTC forecasting
- Accessible CPU preprocessing step

---

## 3. Feature Engineering

### 3.1 Target Variable: Log-Returns (Not Raw Price)

| Approach | Stationarity | Leakage Risk | Recommendation |
|----------|-------------|--------------|----------------|
| Raw close price | Non-stationary | High (MinMaxScaler needs full range) | Avoid |
| Normalized price | Non-stationary | High | Avoid |
| **Log-returns** | Near-stationary | Low | **Use this** |
| Log-returns (z-scored) | Stationary | None (rolling window) | Best practice |

**Formula:**
```python
df['log_return_1d']  = np.log(df['close'] / df['close'].shift(1))
df['log_return_7d']  = np.log(df['close'] / df['close'].shift(7))
df['log_return_30d'] = np.log(df['close'] / df['close'].shift(30))
```

**Inverse transform at inference:**
```python
cumulative_return = predicted_log_returns.sum()
predicted_price_day7 = last_known_close * np.exp(cumulative_return)
```

### 3.2 Recommended Feature Set

**Core (always include — all available in current CSV):**

| Feature | Formula | Why |
|---------|---------|-----|
| `log_return_1d` | `log(close[t] / close[t-1])` | Primary signal, stationary |
| `log_return_7d` | `log(close[t] / close[t-7])` | Weekly momentum |
| `log_return_30d` | `log(close[t] / close[t-30])` | Monthly trend |
| `log_volume` | `log(total_volume)` | Volume-price divergence is a leading indicator |
| `log_market_cap` | `log(market_cap)` | Structural market size signal |

**Technical indicators (compute from close price):**

| Indicator | Formula / Library | Why |
|-----------|------------------|-----|
| **RSI(14)** | Bounded [0,100], no stationarity issue | Momentum oscillator — most cited in papers |
| **MACD** | EMA(12) − EMA(26) | Trend direction and momentum |
| **MACD Signal** | EMA(9) of MACD | Cross-over signals |
| **Bollinger %B** | `(close − lower_band) / (upper_band − lower_band)` | Bounded mean-reversion signal |
| **ATR(14)** | Average True Range, normalized by close | Volatility measure |
| **Rolling volatility** | `std(log_returns, window=7)` and `window=30` | Regime detection |

**What to avoid:**
- Raw price, raw volume, raw market cap (all non-stationary)
- Redundant oscillators (RSI + Stochastic + Williams%R are all the same signal)
- Global MinMaxScaler on any of the above

**Implementation with pandas-ta:**
```python
import pandas_ta as ta

df.ta.rsi(length=14, append=True)          # RSI_14
df.ta.macd(append=True)                    # MACD_12_26_9, MACDh, MACDs
df.ta.bbands(length=20, append=True)       # BBB_%B column
df.ta.atr(length=14, append=True)          # ATRr_14
```

### 3.3 Exogenous Features (High Value, Requires Additional Data)

The TimeXer paper (arXiv:2512.22326) showed 89% RMSE improvement by adding Global M2 liquidity as an exogenous variable — greater than any architecture change. Sources:

| Feature | Source | Impact |
|---------|--------|--------|
| **Crypto Fear & Greed Index** | alternative.me/crypto/fear-and-greed-index/api/ (free) | +5–20% directional accuracy |
| **Global M2 money supply** | FRED / World Bank (quarterly) | +89% RMSE in TimeXer paper |
| **BTC hash rate** | Blockchain.com API | +2.72% MAPE improvement (hashrate paper) |
| **On-chain metrics** (active addresses, transaction volume) | Glassnode / CryptoCompare | +20% with CryptoBERT (arXiv:2405.00522) |

### 3.4 Scaler Best Practices for Financial Time Series

```python
# WRONG — current approach
scaler = MinMaxScaler()
scaler.fit_transform(df['close'].values)   # sees future data

# CORRECT — Option 1: StandardScaler on train portion only
from sklearn.preprocessing import StandardScaler
train_end = int(len(df) * 0.8)
scaler = StandardScaler()
scaler.fit(df['log_return'].values[:train_end].reshape(-1, 1))
scaled = scaler.transform(df['log_return'].values.reshape(-1, 1))

# CORRECT — Option 2: Rolling z-score (no future leakage by construction)
df['log_return_scaled'] = (
    (df['log_return'] - df['log_return'].rolling(252).mean())
    / df['log_return'].rolling(252).std()
)
```

---

## 4. Walk-Forward Validation

### 4.1 Why the Current 80/10/10 Static Split Is Insufficient

1. Single test fold — one bad test period (e.g., a bull run) skews metrics entirely
2. Scaler is fit on all data before the split (confirmed leakage)
3. Provides no confidence intervals on reported metrics

### 4.2 Expanding Window Cross-Validation (Recommended)

For 3,373 rows with a 7-day forecast horizon:

```
Fold 1: Train [0:2000]   Val [2000:2168]  Test [2168:2335]
Fold 2: Train [0:2335]   Val [2335:2503]  Test [2503:2671]
Fold 3: Train [0:2671]   Val [2671:2839]  Test [2839:3007]
Fold 4: Train [0:3007]   Val [3007:3175]  Test [3175:3343]
Fold 5: Train [0:3175]   Test [3175:3373] (final holdout)
```

**Rule:** Refit scaler on each training window. Never allow future rows to influence the scaler.

### 4.3 Evaluation Protocol for 7-Day Horizon

```python
# For each test point t, produce predictions for t+1 through t+7
# Report metrics averaged across all 7 steps and all folds
metrics_per_step = {k: [] for k in range(1, 8)}

for fold in folds:
    for t in fold.test_indices[::7]:   # non-overlapping windows
        preds = model.predict(seed=data[t-60:t])   # shape (7,)
        for k in range(7):
            metrics_per_step[k+1].append({
                'rmse': rmse(actual[t+k], preds[k]),
                'dir_acc': direction_correct(actual[t+k-1], actual[t+k], preds[k])
            })
```

### 4.4 Baseline Comparisons to Always Report

| Baseline | Description |
|----------|-------------|
| **Persistence (1-day)** | `ŷ[t+1] = y[t]` |
| **Persistence (7-day)** | `ŷ[t+k] = y[t]` for k=1..7 (hold today's price constant) |
| **SMA-7** | Predict using 7-day moving average |
| **Drift model** | Linear extrapolation of 30-day trend |

Current model RMSE $2,948 vs persistence $840. A working model should be within 20% of persistence (~$1,000) or better.

---

## 5. Realistic Accuracy Benchmarks

### 5.1 What Is Achievable with OHLCV Data Only

| Metric | Current Model | After Feature Fixes | After Architecture Upgrade |
|--------|--------------|--------------------|-----------------------------|
| RMSE (7-day) | $2,948 | $800–1,200 | $600–900 |
| vs Persistence | 3.5× worse | ~1× (parity) | 0.7–0.9× (better) |
| Directional accuracy | 46% | 51–55% | 54–60% |
| MAPE | ~4.2% (misleading) | 3–5% | 3–5% |

### 5.2 What the Literature Shows Across Dataset Sizes

| Paper | Dataset | Architecture | Directional Accuracy | Notes |
|-------|---------|-------------|----------------------|-------|
| arXiv:2603.16886 (2026) | Crypto (multiple) | All architectures | ~50% across all | Architecture doesn't change direction |
| arXiv:2102.08189 (2021) | BTC daily | LSTM | 51–55% | OHLCV features only |
| arXiv:2102.08189 (2021) | BTC daily | LSTM + social | 67–84% | Social media data required |
| arXiv:2512.22326 (2025) | BTC daily | TimeXer + M2 | N/A (RMSE focus) | 89% RMSE improvement vs univariate |
| Hashrate paper | BTC daily | Deep stacking | MAPE 2.72% at 7-day | Requires hashrate + on-chain |

### 5.3 Honest Assessment of Published Claims

| Claim | Realistic? | Likely Explanation |
|-------|-----------|-------------------|
| >80% directional accuracy with OHLCV | No | Cherry-picked period or data leakage |
| <1% MAPE at 7-day with OHLCV only | No | Data leakage (global MinMaxScaler) |
| LSTM beats persistence by 50%+ | No | Look-ahead bias in scaler |
| 55–65% directional with sentiment | Yes | Well-documented with Fear & Greed |
| 54–60% directional with OHLCV+indicators | Yes | Achievable after fixing fundamentals |

**Target for this project after implementing all fixes: RMSE $600–900, directional accuracy 54–60%, MAPE 3–5% at the 7-day horizon.**

---

## 6. Concrete Action Plan

### Phase 1 — Fix Correctness (Estimated: 1–2 days)

These changes will close the 3.5× gap to persistence baseline. Same LSTM architecture.

**1. Fix `preprocess.py`:**
```python
# Step 1: compute log-returns and features
df['log_return_1d']  = np.log(df['close'] / df['close'].shift(1))
df['log_return_7d']  = np.log(df['close'] / df['close'].shift(7))
df['log_return_30d'] = np.log(df['close'] / df['close'].shift(30))
df['log_volume']     = np.log(df['total_volume'].clip(lower=1))
df['rsi_14']         = ta.rsi(df['close'], length=14)
df = df.dropna()

# Step 2: scaler fitted only on training rows
train_end = int(len(df) * train_ratio)
scaler = StandardScaler()
features = ['log_return_1d','log_return_7d','log_return_30d','log_volume','rsi_14']
scaler.fit(df[features].values[:train_end])
scaled = scaler.transform(df[features].values)

# Step 3: 7-step target (MIMO — no recursive chaining)
for i in range(seq_len, len(df) - 7):
    X.append(scaled[i - seq_len : i])              # (seq_len, n_features)
    y.append(log_returns[i+1 : i+8])               # (7,) vector
```

**2. Fix `model.py`:**
```python
# Change output head
self.fc = nn.Sequential(
    nn.Linear(hidden_size, 64),
    nn.ReLU(),
    nn.Dropout(0.1),
    nn.Linear(64, 7),    # 7 steps at once
)
# input_size: 1 → 5 (number of features)
```

**3. Fix `train_lstm.py`:**
```python
model = LSTMModel(input_size=5, hidden_size=128, num_layers=2,
                  dropout=0.2, output_size=7)
criterion = nn.HuberLoss(delta=1.0)   # more robust than MSE for financial data
```

**4. Fix `inference.py`:**
```python
# Single forward pass — no loop
preds_norm = model(x).squeeze(0).numpy()    # shape (7,)
preds_returns = scaler.inverse_transform_returns(preds_norm)
prices = last_price * np.exp(np.cumsum(preds_returns))
```

### Phase 2 — Improve Signal (Estimated: 1 day)

Add RSI, MACD, Bollinger %B, ATR, rolling volatility:
```bash
pip install pandas-ta
```

Add Fear & Greed Index as daily exogenous feature (free API):
```python
import requests
fg = requests.get("https://api.alternative.me/fng/?limit=3373&format=json").json()
```

### Phase 3 — Architecture Upgrade (Estimated: 1–2 days)

Drop in N-HiTS from NeuralForecast:
```bash
pip install neuralforecast
```

```python
from neuralforecast import NeuralForecast
from neuralforecast.models import NHITS

model = NHITS(
    h=7,                    # forecast horizon
    input_size=60,          # look-back window
    n_freq_downsample=[2,1,1],
    max_steps=500,
)
nf = NeuralForecast(models=[model], freq='D')
nf.fit(df_long_format)
forecasts = nf.predict()
```

### Phase 4 — Validation Infrastructure (Estimated: 1 day)

Implement 5-fold expanding window cross-validation. Report:
- RMSE at each of the 7 forecast steps
- Directional accuracy at each step
- Comparison against persistence and SMA-7 baselines

---

## 7. Key Literature References

| Paper | arXiv ID | Published | Key Finding |
|-------|----------|-----------|-------------|
| Controlled comparison of 9 architectures, 918 experiments | 2603.16886 | Feb 2026 | ModernTCN > PatchTST > N-HiTS > LSTM; directional accuracy ~50% for all without features |
| TimeXer + M2 liquidity for BTC 70-day forecast | 2512.22326 | Dec 2025 | Exogenous macro features > architecture choice; 89% RMSE improvement |
| Transformer vs LSTM for crypto/equity directional | 2507.16548 | Jul 2025 | Transformers significantly better than LSTM for direction |
| VMD decomposition + LSTM for BTC 30-day | 2510.15900 | Oct 2025 | VMD preprocessing beats standard LSTM on RMSE, MAE, R² |
| CryptoMamba (Mamba/SSM for crypto) | 2501.01010 | Jan 2025 | Mamba beats LSTM on regime shifts; IEEE ICBC 2025 |
| TFT with only 91 days underperforms SARIMAX | 2502.01029 | Feb 2025 | TFT needs sufficient data; not suitable for small datasets |
| Multi-crypto pooled TFT (BTC+ETH+LTC joint training) | 2412.14529 | Dec 2024 | Pooling multiple crypto series solves small-dataset TFT problem |
| Convolutional LSTM multivariate vs univariate | 2405.11431 | Jun 2024 | Multivariate significantly beats univariate for crypto |
| LSTM + social indicators for BTC direction | 2102.08189 | Feb 2021 | 51–55% OHLCV-only → 67–84% with social media |
| N-HiTS (AAAI 2023) | 2201.12886 | Jan 2022 | 20% improvement over Transformers, 50× less compute |

---

## 8. Summary Decision Matrix

| Question | Answer |
|----------|--------|
| Why is RMSE 3.5× worse than persistence? | Data leakage (scaler on full dataset) + raw price target + recursive 7-step chaining |
| Should we switch architecture immediately? | No — fix features first; architecture is secondary |
| What is the best architecture for this project? | N-HiTS (compute), PatchTST (accuracy), LightGBM (baseline sanity check) |
| What features matter most? | Log-returns, log-volume, RSI-14, MACD, Bollinger %B |
| What exogenous feature has highest ROI? | Fear & Greed Index (free) or Global M2 (higher impact but quarterly data) |
| What is a realistic directional accuracy target? | 54–60% with OHLCV+indicators; 60–68% with sentiment data |
| Should we use TFT? | No — underfits on this dataset size; only viable if training BTC+DOGE jointly |
| What validation method to use? | 5-fold expanding window, scaler fit per fold |
| Can we beat persistence RMSE? | Yes — after fixing data leakage and switching to log-returns |
