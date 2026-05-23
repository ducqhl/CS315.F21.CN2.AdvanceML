# Phase 9 — Confidence Intervals via Monte Carlo Dropout

**Goal:** Replace the hardcoded `confidence: 0.8` placeholder with real prediction
uncertainty estimates using Monte Carlo (MC) Dropout. Each inference run produces a
`predicted_price_low` and `predicted_price_high` (95% interval) in addition to the mean
forecast. The dashboard prediction chart shows shaded confidence bands.

**Depends on:** Phase 8 (model registry in place so we know which model to run MC on)

**Does NOT require model retraining.** MC Dropout uses the existing trained model with
dropout kept active during inference (no weight changes).

---

## Do NOT Touch

- `src/ml/model.py` — architecture unchanged
- `src/ml/train_lstm.py` — training unchanged
- `src/ml/preprocess.py` — preprocessing unchanged
- `src/ml/retrain.py` — retraining pipeline unchanged
- `src/ml/data_collector.py` — data collection unchanged
- `src/spark/` — Spark jobs unchanged

---

## New Files to Create

```
tests/test_confidence.py     ← Unit tests for MC dropout inference
```

## Files to Modify

```
src/ml/inference.py          ← Add mc_predict(), update _write_predictions schema
src/dashboard/pages/03_prediction.py  ← Show confidence bands on forecast chart
```

---

## Background: Monte Carlo Dropout

Standard dropout randomly zeroes activations during **training** to prevent overfitting.
During inference, dropout is normally disabled (`model.eval()`).

MC Dropout re-enables dropout during inference and runs N forward passes. The spread
of outputs across N passes approximates the model's epistemic uncertainty:

```python
model.train()   # keeps dropout ACTIVE
predictions = [model(x).numpy() for _ in range(N_SAMPLES)]
mean  = np.mean(predictions, axis=0)    # point estimate
std   = np.std(predictions, axis=0)     # uncertainty
lower = mean - 1.96 * std              # 95% confidence lower bound
upper = mean + 1.96 * std              # 95% confidence upper bound
```

**Why this works for crypto:** Price uncertainty is asymmetric and state-dependent.
During high-volatility periods (large RSI values, extreme log_return_1d), dropout
neurons are dropped more variably → wider spread → larger confidence interval.
During calm markets → tighter spread → narrower interval.
This naturally produces *wider* bands when the market is uncertain, which is the
intuitively correct behavior.

**Practical note:** N_SAMPLES = 100 is the standard choice. At CPU inference with a
2-layer LSTM, 100 forward passes for a single (1, 60, 5) input takes < 1 second.

---

## Step 1 — Modify `src/ml/inference.py`

### 1a. Add `N_MC_SAMPLES` constant

```python
# ADD near other constants (after CONFIDENCE = 0.8):
N_MC_SAMPLES = 100    # number of MC dropout forward passes for uncertainty estimation
```

### 1b. Replace `_mimo_predict` with `_mimo_predict_with_uncertainty`

Keep the existing `_mimo_predict` for backward compatibility. Add a new function:

```python
def _mimo_predict_with_uncertainty(
    model: LSTMModel,
    seed_features: np.ndarray,
    scaler,
    last_price_usd: float,
    horizon: int = HORIZON,
    n_samples: int = N_MC_SAMPLES,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Generate *horizon* future USD prices using Monte Carlo Dropout.

    Runs *n_samples* stochastic forward passes with dropout active, then
    computes mean and 95% confidence interval across the sample distribution.

    Parameters
    ----------
    model          : trained LSTMModel
    seed_features  : ndarray (SEQ_LEN, 5) — already scaled feature window
    scaler         : fitted StandardScaler
    last_price_usd : raw USD close price at last seed timestep
    horizon        : forecast horizon (must match model output_size=7)
    n_samples      : number of MC forward passes (default 100)

    Returns
    -------
    mean_prices : ndarray (horizon,) — mean predicted USD prices
    lower_95    : ndarray (horizon,) — 95% CI lower bound (mean - 1.96*std)
    upper_95    : ndarray (horizon,) — 95% CI upper bound (mean + 1.96*std)
    """
    # Keep dropout ACTIVE during MC inference (do NOT call model.eval())
    model.train()

    x = torch.tensor(seed_features[np.newaxis, :, :], dtype=torch.float32)

    all_log_rets_norm = []
    with torch.no_grad():
        for _ in range(n_samples):
            log_rets_norm = model(x).squeeze(0).cpu().numpy()   # (horizon,)
            all_log_rets_norm.append(log_rets_norm)

    # Shape: (n_samples, horizon)
    samples = np.array(all_log_rets_norm)

    # Un-standardize each sample
    samples_log = samples * scaler.scale_[0] + scaler.mean_[0]   # (n_samples, horizon)

    # Reconstruct USD prices per sample: price[k] = last_price * exp(cumsum(log_rets)[k])
    prices_samples = last_price_usd * np.exp(np.cumsum(samples_log, axis=1))  # (n_samples, horizon)

    mean_prices = prices_samples.mean(axis=0).astype(np.float32)    # (horizon,)
    std_prices  = prices_samples.std(axis=0).astype(np.float32)     # (horizon,)
    lower_95    = (mean_prices - 1.96 * std_prices).astype(np.float32)
    upper_95    = (mean_prices + 1.96 * std_prices).astype(np.float32)

    # Ensure lower bound never goes below zero (prices can't be negative)
    lower_95 = np.maximum(lower_95, 0.0)

    return mean_prices, lower_95, upper_95
```

### 1c. Update `_write_predictions` signature and schema

```python
# MODIFY _write_predictions to accept lower and upper bounds:

def _write_predictions(
    predictions_usd: np.ndarray,
    coin_symbol: str,
    mongo_uri: str | None = None,
    seed_source: str = "unknown",
    lower_95: np.ndarray | None = None,    # ADD
    upper_95: np.ndarray | None = None,    # ADD
) -> list[dict]:
    """
    Write 7-day forecast to predictions collection.

    New fields added to each document:
        predicted_price_low  : float — 95% CI lower bound (None if MC not run)
        predicted_price_high : float — 95% CI upper bound (None if MC not run)
        confidence           : float — std/mean ratio as a quality signal (replaces hardcoded 0.8)
    """
    # ...existing setup code...

    for offset, price in enumerate(predictions_usd, start=1):
        # ...existing prediction_date calculation...

        # Compute confidence as 1 - (std / mean) clamped to [0, 1]
        # When lower/upper not provided, keep legacy 0.8 placeholder
        if lower_95 is not None and upper_95 is not None:
            std_est = (upper_95[offset-1] - lower_95[offset-1]) / (2 * 1.96)
            confidence = float(np.clip(1.0 - std_est / price, 0.0, 1.0)) if price > 0 else 0.8
        else:
            confidence = CONFIDENCE   # 0.8 legacy placeholder

        doc = {
            "coin":                  coin_symbol,
            "predicted_price":       float(price),
            "predicted_price_low":   float(lower_95[offset-1]) if lower_95 is not None else None,
            "predicted_price_high":  float(upper_95[offset-1]) if upper_95 is not None else None,
            "prediction_date":       prediction_date,
            "confidence":            confidence,
            "model_version":         MODEL_VERSION,
            "seed_source":           seed_source,
            "created_at":            now_utc,
        }
        # ...upsert logic unchanged...
```

### 1d. Update `run_inference` to use MC prediction

```python
# In run_inference(), REPLACE:

# OLD:
predictions_usd = _mimo_predict(model, seed, scaler, last_price_usd, horizon=HORIZON)

# NEW:
mean_prices, lower_95, upper_95 = _mimo_predict_with_uncertainty(
    model, seed, scaler, last_price_usd, horizon=HORIZON
)
predictions_usd = mean_prices   # keep downstream API compatible

logger.info(
    "7-day forecast for %s (mean±std): %s",
    coin_symbol,
    [f"${m:.2f}[${l:.2f}-${u:.2f}]" for m, l, u in zip(mean_prices, lower_95, upper_95)],
)

# PASS lower/upper to _write_predictions:
docs = _write_predictions(
    predictions_usd,
    coin_symbol=coin_symbol,
    mongo_uri=mongo_uri,
    seed_source=seed_source,
    lower_95=lower_95,
    upper_95=upper_95,
)
```

---

## Step 2 — Modify `src/dashboard/pages/03_prediction.py`

### 2a. Update `load_predictions` to include new fields

```python
# In load_predictions(), update projection to include new fields:
projection={
    "_id": 0,
    "coin": 1,
    "predicted_price": 1,
    "predicted_price_low": 1,      # ADD
    "predicted_price_high": 1,     # ADD
    "prediction_date": 1,
    "confidence": 1,
    "model_version": 1,
    "seed_source": 1,
    "created_at": 1,
},
```

### 2b. Add confidence band to the forecast chart

In the forecast chart section, after adding the LSTM forecast trace, add a shaded region:

```python
# ADD after the forecast line trace (inside the `if not future_df.empty:` block):

has_ci = (
    "predicted_price_low" in future_df.columns
    and "predicted_price_high" in future_df.columns
    and not future_df["predicted_price_low"].isna().all()
)

if has_ci:
    # Filled area between lower and upper bound
    fig.add_trace(go.Scatter(
        x=pd.concat([future_df["prediction_date"], future_df["prediction_date"].iloc[::-1]]),
        y=pd.concat([future_df["predicted_price_high"], future_df["predicted_price_low"].iloc[::-1]]),
        fill="toself",
        fillcolor="rgba(0, 229, 255, 0.12)",
        line=dict(color="rgba(255,255,255,0)"),
        showlegend=True,
        name="95% confidence interval",
        hoverinfo="skip",
    ))
```

### 2c. Update the 7-day bar chart to show error bars

```python
# In the forecast bar chart section, REPLACE the bar trace with:
forecast_fig.add_trace(go.Bar(
    x=future_df["prediction_date"].dt.strftime("%b %d"),
    y=future_df["predicted_price"],
    marker_color="#00e5ff",
    name="Predicted price",
    # ADD error bars if CI available:
    error_y=dict(
        type="data",
        symmetric=False,
        array=(future_df["predicted_price_high"] - future_df["predicted_price"]).tolist()
               if has_ci else None,
        arrayminus=(future_df["predicted_price"] - future_df["predicted_price_low"]).tolist()
                   if has_ci else None,
        visible=has_ci,
        color="#ffa726",
        thickness=1.5,
        width=4,
    ) if has_ci else dict(visible=False),
))
```

### 2d. Show confidence metric cards with real values

```python
# REPLACE the hardcoded confidence display in metric cards:
# OLD: col3.metric("Model version", model_ver)

# NEW: Show confidence range if available
col3.metric("Model version", model_ver)
if has_ci and not future_df.empty:
    avg_conf = future_df["confidence"].mean()
    st.caption(
        f"Avg confidence: {avg_conf:.0%}  ·  "
        f"Uncertainty method: Monte Carlo Dropout (n=100)  ·  "
        f"Seed: {seed_src}"
    )
```

---

## Step 3 — Create `tests/test_confidence.py`

```python
"""
tests/test_confidence.py — Unit tests for MC Dropout confidence intervals.
"""
import pytest
import numpy as np
import torch
import sys
sys.path.insert(0, "src/ml")

from model import LSTMModel
from inference import _mimo_predict_with_uncertainty, N_MC_SAMPLES


class TestMCDropoutPredict:
    @pytest.fixture
    def model_and_seed(self):
        model = LSTMModel(input_size=5, hidden_size=32, num_layers=2, dropout=0.5, output_size=7)
        # Random seed features (60 timesteps, 5 features)
        seed = np.random.randn(60, 5).astype(np.float32)
        return model, seed

    @pytest.fixture
    def mock_scaler(self):
        from sklearn.preprocessing import StandardScaler
        scaler = StandardScaler()
        scaler.fit(np.random.randn(100, 5))
        return scaler

    def test_returns_three_arrays(self, model_and_seed, mock_scaler):
        model, seed = model_and_seed
        mean, lower, upper = _mimo_predict_with_uncertainty(
            model, seed, mock_scaler, last_price_usd=65000.0, horizon=7, n_samples=10
        )
        assert mean.shape == (7,)
        assert lower.shape == (7,)
        assert upper.shape == (7,)

    def test_lower_le_mean_le_upper(self, model_and_seed, mock_scaler):
        model, seed = model_and_seed
        mean, lower, upper = _mimo_predict_with_uncertainty(
            model, seed, mock_scaler, last_price_usd=65000.0, horizon=7, n_samples=20
        )
        assert np.all(lower <= mean), "Lower bound must be <= mean"
        assert np.all(mean <= upper), "Upper bound must be >= mean"

    def test_lower_bound_non_negative(self, model_and_seed, mock_scaler):
        model, seed = model_and_seed
        mean, lower, upper = _mimo_predict_with_uncertainty(
            model, seed, mock_scaler, last_price_usd=0.001, horizon=7, n_samples=10
        )
        assert np.all(lower >= 0.0), "Prices cannot be negative"

    def test_mc_samples_produce_variance(self, model_and_seed, mock_scaler):
        """With dropout=0.5, repeated forward passes should differ."""
        model, seed = model_and_seed
        model.train()   # keep dropout active
        x = torch.tensor(seed[np.newaxis, :, :], dtype=torch.float32)
        outputs = []
        with torch.no_grad():
            for _ in range(50):
                outputs.append(model(x).numpy())
        std = np.std(np.array(outputs), axis=0)
        assert np.any(std > 1e-6), "MC samples must have non-zero variance (dropout active)"

    def test_higher_dropout_produces_wider_intervals(self, mock_scaler):
        """Higher dropout should produce more uncertainty."""
        seed = np.random.randn(60, 5).astype(np.float32)

        model_low = LSTMModel(input_size=5, hidden_size=32, num_layers=2, dropout=0.1, output_size=7)
        model_high = LSTMModel(input_size=5, hidden_size=32, num_layers=2, dropout=0.8, output_size=7)

        _, low_lo, low_hi = _mimo_predict_with_uncertainty(model_low, seed, mock_scaler, 65000.0, n_samples=50)
        _, high_lo, high_hi = _mimo_predict_with_uncertainty(model_high, seed, mock_scaler, 65000.0, n_samples=50)

        low_width  = (low_hi - low_lo).mean()
        high_width = (high_hi - high_lo).mean()
        # Higher dropout should produce wider intervals on average
        assert high_width >= low_width * 0.5, (
            f"High-dropout model should have wider CI: {high_width:.2f} vs {low_width:.2f}"
        )


class TestWritePredictionsWithCI:
    def test_prediction_doc_has_ci_fields(self):
        import pymongo
        from unittest.mock import patch, MagicMock

        mock_predictions = np.array([65000.0, 65500.0, 64800.0, 65200.0, 65400.0, 65600.0, 65800.0])
        mock_lower = mock_predictions * 0.95
        mock_upper = mock_predictions * 1.05

        written_docs = []

        with patch("inference.pymongo.MongoClient") as mock_client:
            mock_col = MagicMock()
            mock_col.update_one = MagicMock(side_effect=lambda f, u, **kw: written_docs.append(u["$set"]))
            mock_client.return_value.__getitem__.return_value.__getitem__.return_value = mock_col

            from inference import _write_predictions
            docs = _write_predictions(
                mock_predictions,
                coin_symbol="BTC",
                mongo_uri="mongodb://fake:27017",
                seed_source="ohlcv_hourly",
                lower_95=mock_lower,
                upper_95=mock_upper,
            )

        for doc in written_docs:
            assert "predicted_price_low" in doc
            assert "predicted_price_high" in doc
            assert doc["predicted_price_low"] < doc["predicted_price"]
            assert doc["predicted_price_high"] > doc["predicted_price"]
            assert 0.0 < doc["confidence"] <= 1.0
```

---

## Acceptance Criteria

### AC-9.1 Unit tests pass
```bash
pytest tests/test_confidence.py -v
# Expected: all 6 tests pass
```

### AC-9.2 MC inference runs and produces non-trivial intervals
```bash
python -c "
import sys; sys.path.insert(0, 'src/ml')
import numpy as np
import pickle, torch
from model import LSTMModel
from inference import _mimo_predict_with_uncertainty

model = LSTMModel(input_size=5, hidden_size=128, num_layers=2, dropout=0.2, output_size=7)
model.load_state_dict(torch.load('src/ml/model/lstm_bitcoin_v1.pt', map_location='cpu'))

with open('src/ml/model/scaler_bitcoin.pkl', 'rb') as f:
    scaler = pickle.load(f)

seed = np.random.randn(60, 5).astype(np.float32)
mean, lower, upper = _mimo_predict_with_uncertainty(model, seed, scaler, last_price_usd=75000.0)

print('Mean:', [f'\${p:,.0f}' for p in mean])
print('Lower:', [f'\${p:,.0f}' for p in lower])
print('Upper:', [f'\${p:,.0f}' for p in upper])
assert np.all(lower <= mean) and np.all(mean <= upper), 'CI ordering violated'
assert np.all(lower >= 0), 'Negative prices'
print('AC-9.2 PASS')
"
```

### AC-9.3 Full inference cycle writes CI fields to MongoDB
```bash
python -c "
import sys; sys.path.insert(0, 'src/ml')
from inference import run_inference
import pymongo

docs = run_inference(coin='bitcoin')
assert 'predicted_price_low' in docs[0], 'Missing CI lower bound in prediction doc'
assert 'predicted_price_high' in docs[0], 'Missing CI upper bound in prediction doc'
assert docs[0]['predicted_price_low'] <= docs[0]['predicted_price'], 'CI ordering violated'
print('Confidence:', docs[0]['confidence'])
print('CI:', docs[0]['predicted_price_low'], '-', docs[0]['predicted_price_high'])
print('AC-9.3 PASS')
"
```

### AC-9.4 Dashboard shows confidence bands
Manual test: open dashboard page 03, confirm shaded area appears between prediction line
and confidence band traces. Confirm error bars on bar chart.
