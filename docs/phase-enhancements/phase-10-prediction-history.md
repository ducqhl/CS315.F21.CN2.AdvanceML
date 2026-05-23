# Phase 10 — Prediction History, Accuracy Trend & User Export

**Goal:** Preserve all prediction versions (instead of overwriting), display how forecasts
evolved over time per target date, show a rolling accuracy trend chart, and let users
download predictions as CSV.

**Depends on:** Phase 9 (predictions now include CI fields)

---

## Do NOT Touch

- `src/ml/` — all ML code unchanged
- `src/spark/` — Spark jobs unchanged
- `src/producer/` — producer unchanged

---

## New Files to Create

```
src/dashboard/pages/06_history.py    ← Prediction evolution + accuracy trend page
```

## Files to Modify

```
src/ml/inference.py                  ← Change upsert key: preserve all prediction versions
src/dashboard/pages/03_prediction.py ← Add CSV download button
```

---

## MongoDB Schema Change: `predictions` Collection

### Current schema (upsert overwrites on coin + prediction_date)
```json
{ "coin": "BTC", "prediction_date": "2026-05-24", "predicted_price": 70451.72, ... }
```

**Problem:** Every hourly inference cycle overwrites the same 7 dates. All history of
how the prediction evolved is lost.

### New schema: preserve all versions

**Change the upsert key** from `(coin, prediction_date)` to `(coin, prediction_date, created_at_day)`:

```json
{
  "coin":                  "BTC",
  "predicted_price":       70451.72,
  "predicted_price_low":   68500.00,
  "predicted_price_high":  72400.00,
  "prediction_date":       ISODate("2026-05-24T00:00:00Z"),
  "created_at":            ISODate("2026-05-23T16:42:26Z"),
  "created_at_day":        ISODate("2026-05-23T00:00:00Z"),  // NEW — midnight UTC of run date
  "confidence":            0.87,
  "model_version":         "lstm_v1",
  "seed_source":           "historical_sma",
  "run_id":                "uuid-optional"                    // NEW — groups a 7-doc set
}

Upsert key: {coin, prediction_date, created_at_day}
  → One record per (coin, target_date, day_the_prediction_was_made)
  → Multiple runs on the same day still upsert (keeps latest of the day)
  → Runs on different days create new records

Indexes:
  {coin: 1, prediction_date: 1, created_at_day: -1}   ← history queries
  {coin: 1, created_at: -1}                            ← latest predictions query
  {coin: 1, prediction_date: 1, created_at: -1}        ← "latest prediction for each date" query
```

**Migration:** Existing documents lack `created_at_day` and `run_id`. The dashboard
queries must handle documents without these fields gracefully (use `.get()` with defaults).

---

## Step 1 — Modify `src/ml/inference.py`

### 1a. Add `run_id` generation

```python
# ADD near top of run_inference():
import uuid
run_id = str(uuid.uuid4())[:8]   # short 8-char ID to group this cycle's 7 predictions
```

### 1b. Update `_write_predictions` upsert key

```python
# In _write_predictions(), REPLACE the upsert filter and doc:

for offset, price in enumerate(predictions_usd, start=1):
    prediction_date = (
        now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
        + timedelta(days=offset)
    )
    created_at_day = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)

    doc = {
        "coin":                  coin_symbol,
        "predicted_price":       float(price),
        "predicted_price_low":   float(lower_95[offset-1]) if lower_95 is not None else None,
        "predicted_price_high":  float(upper_95[offset-1]) if upper_95 is not None else None,
        "prediction_date":       prediction_date,
        "created_at":            now_utc,
        "created_at_day":        created_at_day,          # NEW
        "run_id":                run_id,                   # NEW — passed as parameter
        "confidence":            confidence,
        "model_version":         MODEL_VERSION,
        "seed_source":           seed_source,
    }

    # NEW upsert key: one record per (coin, target_date, day_run_was_made)
    collection.update_one(
        {
            "coin":            doc["coin"],
            "prediction_date": doc["prediction_date"],
            "created_at_day":  doc["created_at_day"],    # CHANGED
        },
        {"$set": doc},
        upsert=True,
    )
```

### 1c. Add `run_id` parameter to `_write_predictions`

```python
def _write_predictions(
    predictions_usd: np.ndarray,
    coin_symbol: str,
    mongo_uri: str | None = None,
    seed_source: str = "unknown",
    lower_95: np.ndarray | None = None,
    upper_95: np.ndarray | None = None,
    run_id: str | None = None,                    # ADD
) -> list[dict]:
```

### 1d. Pass run_id from `run_inference`

```python
# In run_inference(), update the call:
docs = _write_predictions(
    predictions_usd,
    coin_symbol=coin_symbol,
    mongo_uri=mongo_uri,
    seed_source=seed_source,
    lower_95=lower_95,
    upper_95=upper_95,
    run_id=run_id,     # ADD
)
```

### 1e. Ensure indexes are created

In `_write_predictions`, after the collection reference, add:
```python
# Ensure indexes (idempotent)
existing = collection.index_information()
if "coin_preddate_createdday" not in existing:
    collection.create_index(
        [("coin", 1), ("prediction_date", 1), ("created_at_day", -1)],
        name="coin_preddate_createdday",
    )
if "coin_created_at_desc" not in existing:
    collection.create_index(
        [("coin", 1), ("created_at", -1)],
        name="coin_created_at_desc",
    )
```

---

## Step 2 — Update `src/dashboard/pages/03_prediction.py`

### 2a. Update `load_predictions` to fetch only the latest prediction per date

The page should show the most recent forecast, not all historical versions:

```python
@st.cache_data(ttl=300)
def load_predictions(coin: str) -> pd.DataFrame:
    """Load the latest prediction per prediction_date for coin."""
    db = get_db()
    # Aggregation pipeline: for each prediction_date, get the doc with latest created_at
    pipeline = [
        {"$match": {"coin": coin}},
        {"$sort": {"prediction_date": 1, "created_at": -1}},
        {"$group": {
            "_id": "$prediction_date",
            "doc": {"$first": "$$ROOT"},
        }},
        {"$replaceRoot": {"newRoot": "$doc"}},
        {"$sort": {"prediction_date": 1}},
        {"$project": {
            "_id": 0, "coin": 1, "predicted_price": 1,
            "predicted_price_low": 1, "predicted_price_high": 1,
            "prediction_date": 1, "confidence": 1, "model_version": 1,
            "seed_source": 1, "created_at": 1, "run_id": 1,
        }},
    ]
    docs = list(db.predictions.aggregate(pipeline))
    if not docs:
        return pd.DataFrame()
    df = pd.DataFrame(docs)
    df["prediction_date"] = pd.to_datetime(df["prediction_date"], utc=True)
    return df
```

### 2b. Add CSV download button

At the bottom of the page, after the forecast table:

```python
# ADD after st.dataframe(...):
if has_predictions and not future_df.empty:
    csv_data = future_df.copy()
    csv_data["prediction_date"] = csv_data["prediction_date"].dt.strftime("%Y-%m-%d")
    csv_cols = [c for c in [
        "prediction_date", "predicted_price", "predicted_price_low",
        "predicted_price_high", "confidence", "model_version", "seed_source"
    ] if c in csv_data.columns]
    st.download_button(
        label="Download forecast as CSV",
        data=csv_data[csv_cols].to_csv(index=False),
        file_name=f"{coin}_forecast_{datetime.now(timezone.utc).strftime('%Y%m%d')}.csv",
        mime="text/csv",
    )
```

---

## Step 3 — Create `src/dashboard/pages/06_history.py`

```python
"""
06_history.py — Prediction Evolution & Accuracy Trend.

Shows:
  1. Prediction evolution chart: for a selected target date, how did
     the predicted price change across successive inference runs?
  2. Rolling accuracy trend: 30-day rolling MAPE over time.
  3. All past predictions table with actual prices (where available).
"""
import logging
from datetime import datetime, timezone, timedelta

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from streamlit_autorefresh import st_autorefresh
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import get_db

logger = logging.getLogger(__name__)
st_autorefresh(interval=300_000, key="history_refresh")

st.title("Prediction History & Accuracy")
coin = st.selectbox("Coin", ["BTC", "DOGE"], key="history_coin")


@st.cache_data(ttl=300)
def load_prediction_history(coin: str, days_back: int = 30) -> pd.DataFrame:
    """
    Load ALL prediction versions for *coin* over the last *days_back* days.
    Groups by (prediction_date, created_at_day) to show evolution.
    """
    db = get_db()
    cutoff = datetime.now(timezone.utc) - timedelta(days=days_back)
    docs = list(db.predictions.find(
        {"coin": coin, "created_at": {"$gte": cutoff}},
        sort=[("prediction_date", 1), ("created_at", 1)],
        projection={
            "_id": 0, "prediction_date": 1, "predicted_price": 1,
            "predicted_price_low": 1, "predicted_price_high": 1,
            "created_at": 1, "confidence": 1, "model_version": 1,
        },
    ))
    if not docs:
        return pd.DataFrame()
    df = pd.DataFrame(docs)
    df["prediction_date"] = pd.to_datetime(df["prediction_date"], utc=True)
    df["created_at"] = pd.to_datetime(df["created_at"], utc=True)
    return df


@st.cache_data(ttl=300)
def load_accuracy_history(coin: str, days_back: int = 60) -> pd.DataFrame:
    """
    For each past prediction, find closest live_prices actual.
    Returns DataFrame with prediction_date, predicted_price, actual_price, abs_error, pct_error.
    One row per (prediction_date, created_at_day) pair that has a matching actual.
    """
    db = get_db()
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days_back)

    past_preds = list(db.predictions.find(
        {"coin": coin, "prediction_date": {"$lt": now}, "created_at": {"$gte": cutoff}},
        sort=[("prediction_date", 1), ("created_at", 1)],
        projection={
            "_id": 0, "prediction_date": 1, "predicted_price": 1,
            "created_at": 1, "model_version": 1,
        },
    ))
    if not past_preds:
        return pd.DataFrame()

    results = []
    for row in past_preds:
        target = row["prediction_date"]
        if not isinstance(target, datetime):
            continue
        window_start = target - timedelta(hours=12)
        window_end = target + timedelta(hours=12)
        actual_doc = db.live_prices.find_one(
            {"coin": coin, "timestamp": {"$gte": window_start, "$lte": window_end}},
            sort=[("timestamp", 1)],
        )
        if actual_doc:
            actual = actual_doc["price_usd"]
            predicted = row["predicted_price"]
            abs_err = abs(predicted - actual)
            pct_err = abs_err / actual * 100 if actual else None
            results.append({
                "prediction_date": pd.Timestamp(target),
                "created_at": pd.Timestamp(row["created_at"]),
                "predicted_price": predicted,
                "actual_price": actual,
                "abs_error": abs_err,
                "pct_error": pct_err,
                "model_version": row.get("model_version", "lstm_v1"),
            })
    return pd.DataFrame(results)


hist_df = load_prediction_history(coin)
acc_df = load_accuracy_history(coin)

# ── Section 1: Prediction Evolution ───────────────────────────────────────────
st.subheader("Prediction Evolution by Target Date")
st.caption("Each line shows how the forecast for a specific future date changed over time")

if hist_df.empty:
    st.info("No prediction history yet. History accumulates as the scheduler runs daily.")
else:
    # Let user pick which target date to inspect
    unique_dates = sorted(hist_df["prediction_date"].dt.date.unique())
    selected_date = st.selectbox(
        "Select target prediction date",
        options=unique_dates,
        format_func=lambda d: str(d),
        key="evo_date",
    )

    date_df = hist_df[hist_df["prediction_date"].dt.date == selected_date]

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=date_df["created_at"],
        y=date_df["predicted_price"],
        mode="lines+markers",
        name=f"Predicted price for {selected_date}",
        line=dict(color="#00e5ff", width=2),
        marker=dict(size=6),
    ))

    has_ci = "predicted_price_low" in date_df.columns and not date_df["predicted_price_low"].isna().all()
    if has_ci:
        combined_x = pd.concat([date_df["created_at"], date_df["created_at"].iloc[::-1]])
        combined_y = pd.concat([date_df["predicted_price_high"], date_df["predicted_price_low"].iloc[::-1]])
        fig.add_trace(go.Scatter(
            x=combined_x, y=combined_y,
            fill="toself", fillcolor="rgba(0,229,255,0.10)",
            line=dict(color="rgba(255,255,255,0)"),
            name="95% CI", showlegend=True, hoverinfo="skip",
        ))

    fig.update_layout(
        template="plotly_dark", height=300,
        xaxis_title="Prediction run time (UTC)",
        yaxis_title="Predicted Price (USD)",
        margin=dict(l=0, r=0, t=30, b=0),
    )
    st.plotly_chart(fig, use_container_width=True)

st.markdown("---")

# ── Section 2: Rolling Accuracy Trend ─────────────────────────────────────────
st.subheader("Rolling Accuracy Trend (30-day window)")

if acc_df.empty:
    st.info(
        "No accuracy data yet. Accuracy is computed when prediction_date passes "
        "and actual prices from live_prices are available."
    )
else:
    # Compute 30-day rolling MAPE (chronological, one row per prediction_date)
    # Use the LATEST prediction per date for accuracy calculation
    latest_per_date = (
        acc_df.sort_values("created_at")
        .groupby("prediction_date")
        .last()
        .reset_index()
    )
    latest_per_date = latest_per_date.sort_values("prediction_date")
    latest_per_date["rolling_mape"] = (
        latest_per_date["pct_error"]
        .rolling(window=30, min_periods=1)
        .mean()
    )

    col1, col2, col3 = st.columns(3)
    col1.metric("Overall MAPE", f"{acc_df['pct_error'].mean():.1f}%")
    col2.metric("Overall MAE", f"${acc_df['abs_error'].mean():,.2f}")
    col3.metric("Total evaluated", len(latest_per_date))

    trend_fig = go.Figure()
    trend_fig.add_trace(go.Scatter(
        x=latest_per_date["prediction_date"],
        y=latest_per_date["rolling_mape"],
        mode="lines",
        name="30-day rolling MAPE",
        line=dict(color="#ffa726", width=2),
        fill="tozeroy",
        fillcolor="rgba(255,167,38,0.1)",
    ))
    trend_fig.add_hline(y=10, line_dash="dash", line_color="red",
                        annotation_text="10% threshold")
    trend_fig.update_layout(
        template="plotly_dark", height=280,
        xaxis_title="Target prediction date",
        yaxis_title="MAPE (%)",
        margin=dict(l=0, r=0, t=10, b=0),
    )
    st.plotly_chart(trend_fig, use_container_width=True)

    st.markdown("---")

    # ── Section 3: Full Accuracy Table ────────────────────────────────────────
    st.subheader("All Evaluated Predictions")
    display = acc_df.copy()
    display["prediction_date"] = display["prediction_date"].dt.strftime("%Y-%m-%d")
    display["created_at"] = display["created_at"].dt.strftime("%Y-%m-%d %H:%M")
    display["predicted_price"] = display["predicted_price"].map("${:,.2f}".format)
    display["actual_price"] = display["actual_price"].map("${:,.2f}".format)
    display["abs_error"] = display["abs_error"].map("${:,.2f}".format)
    display["pct_error"] = display["pct_error"].map(lambda x: f"{x:.1f}%" if x else "—")
    display = display.rename(columns={
        "prediction_date": "Target Date",
        "created_at": "Prediction Made At",
        "predicted_price": "Predicted",
        "actual_price": "Actual",
        "abs_error": "Abs Error",
        "pct_error": "% Error",
        "model_version": "Model",
    })
    st.dataframe(display.reset_index(drop=True), use_container_width=True)

    # Download button
    raw = acc_df.copy()
    raw["prediction_date"] = raw["prediction_date"].dt.strftime("%Y-%m-%d")
    raw["created_at"] = raw["created_at"].dt.strftime("%Y-%m-%d %H:%M:%S")
    st.download_button(
        label="Download accuracy data as CSV",
        data=raw.to_csv(index=False),
        file_name=f"{coin}_accuracy_{datetime.now(timezone.utc).strftime('%Y%m%d')}.csv",
        mime="text/csv",
    )
```

---

## Acceptance Criteria

### AC-10.1 Prediction documents include `created_at_day` and `run_id`
```bash
python -c "
import sys; sys.path.insert(0, 'src/ml')
from inference import run_inference
docs = run_inference(coin='bitcoin')
assert 'created_at_day' in docs[0], 'Missing created_at_day'
assert 'run_id' in docs[0], 'Missing run_id'
# All docs in same run share the same run_id
run_ids = set(d['run_id'] for d in docs)
assert len(run_ids) == 1, f'Expected 1 run_id, got {run_ids}'
print('run_id:', docs[0]['run_id'])
print('AC-10.1 PASS')
"
```

### AC-10.2 Second inference run on same day does NOT create duplicate docs
```bash
python -c "
import sys; sys.path.insert(0, 'src/ml')
from inference import run_inference
import pymongo, time

docs1 = run_inference(coin='bitcoin')
time.sleep(2)
docs2 = run_inference(coin='bitcoin')

client = pymongo.MongoClient('mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin')
db = client.crypto_db
# Count docs for today's prediction dates
from datetime import datetime, timezone
today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
count = db.predictions.count_documents({
    'coin': 'BTC',
    'created_at_day': today,
})
print(f'Docs for BTC today: {count} (expected 7 — one per horizon day, upserted)')
assert count == 7, f'Expected 7, got {count}'
print('AC-10.2 PASS')
"
```

### AC-10.3 `load_predictions` aggregation returns latest per date (no duplicates in dashboard)
```bash
python -c "
import sys; sys.path.insert(0, 'src/ml')
sys.path.insert(0, 'src/dashboard')
# Verify no duplicate prediction_dates in the aggregation result
# (requires dashboard app to be importable)
print('AC-10.3 — verify visually: open dashboard page 03, confirm no duplicate dates in table')
"
```

### AC-10.4 Dashboard shows CSV download button
Manual test: open page 03 and page 06, confirm download buttons appear when predictions exist.

### AC-10.5 Page 06 renders without error
```bash
streamlit run src/dashboard/app.py
# Navigate to page 06 — should show "No prediction history yet" or actual charts
```
