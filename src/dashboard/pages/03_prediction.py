"""
03_prediction.py — LSTM prediction page with real-time comparison.

Features:
  - Auto-refreshes every 5 minutes to pick up new scheduler predictions.
  - Historical price chart from live_prices (realtime) with fallback to
    historical_sma (batch layer).
  - LSTM 7-day forecast overlay on the same chart.
  - Prediction accuracy section: when past predictions have actual price data
    available in live_prices, computes and displays MAE / MAPE.
  - Graceful degradation when predictions collection is empty.

MongoDB collections used:
  predictions     — LSTM forecast docs (coin, predicted_price, prediction_date, ...)
  live_prices     — realtime prices written directly by producer (price_usd, timestamp)
  historical_sma  — batch-layer daily avg_close (fallback context)
"""

import logging
from datetime import datetime, timezone, timedelta

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from streamlit_autorefresh import st_autorefresh

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import get_db

logger = logging.getLogger(__name__)

# Auto-refresh every 5 minutes — picks up new predictions from the scheduler
st_autorefresh(interval=300_000, key="pred_refresh")

st.title("LSTM Trend Predictions")
st.caption("Model: 2-layer LSTM · seq_len=60 · 7-day MIMO forecast · primary signal: trend direction · refreshes every 5 min")

coin = st.session_state.get("selected_coin", "BTC")
coin = st.selectbox(
    "Coin",
    ["BTC", "DOGE"],
    index=["BTC", "DOGE"].index(coin) if coin in ["BTC", "DOGE"] else 0,
    key="pred_coin",
)


# ── Data loaders ───────────────────────────────────────────────────────────────

@st.cache_data(ttl=300)
def load_predictions(coin: str) -> pd.DataFrame:
    """Load all predictions for *coin* sorted by prediction_date ascending."""
    db = get_db()
    cursor = db.predictions.find(
        {"coin": coin},
        sort=[("prediction_date", 1)],
        projection={
            "_id": 0,
            "coin": 1,
            "predicted_price": 1,
            "prediction_date": 1,
            "confidence": 1,
            "model_version": 1,
            "seed_source": 1,
            "created_at": 1,
            # v2 multi-task fields (may be absent in v1 docs)
            "direction": 1,
            "direction_prob": 1,
            "trend_strength": 1,
        },
    )
    docs = list(cursor)
    if not docs:
        return pd.DataFrame()
    df = pd.DataFrame(docs)
    df["prediction_date"] = pd.to_datetime(df["prediction_date"], utc=True)
    return df


@st.cache_data(ttl=300)
def load_live_prices(coin: str, days: int = 30) -> pd.DataFrame:
    """
    Load recent actual prices from live_prices collection (realtime, direct from producer).
    Returns DataFrame with columns [date, price] or empty if collection has no data.
    """
    db = get_db()
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    cursor = db.live_prices.find(
        {"coin": coin, "timestamp": {"$gte": cutoff}},
        sort=[("timestamp", 1)],
        projection={"_id": 0, "timestamp": 1, "price_usd": 1},
    )
    docs = list(cursor)
    if not docs:
        return pd.DataFrame()
    df = pd.DataFrame(docs)
    df = df.rename(columns={"timestamp": "date", "price_usd": "price"})
    df["date"] = pd.to_datetime(df["date"], utc=True)
    return df


@st.cache_data(ttl=300)
def load_historical_context(coin: str, days: int = 90) -> pd.DataFrame:
    """Load last *days* of historical_sma for background context (batch layer fallback)."""
    db = get_db()
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    cursor = db.historical_sma.find(
        {"symbol": coin, "date": {"$gte": cutoff}},
        sort=[("date", 1)],
        projection={"_id": 0, "date": 1, "avg_close": 1},
    )
    docs = list(cursor)
    if not docs:
        return pd.DataFrame()
    df = pd.DataFrame(docs)
    df["date"] = pd.to_datetime(df["date"], utc=True)
    return df


@st.cache_data(ttl=300)
def load_accuracy_data(coin: str) -> pd.DataFrame:
    """
    For past predictions (prediction_date < now), find the closest live_prices
    entry within ±12h and compute prediction accuracy.

    Returns DataFrame: [prediction_date, predicted_price, actual_price, abs_error, pct_error]
    or empty if no past predictions or no matching actuals.
    """
    db = get_db()
    now = datetime.now(timezone.utc)
    past_preds = list(db.predictions.find(
        {"coin": coin, "prediction_date": {"$lt": now}},
        sort=[("prediction_date", 1)],
        projection={"_id": 0, "prediction_date": 1, "predicted_price": 1},
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
                "prediction_date": pd.Timestamp(target).tz_localize("UTC")
                    if target.tzinfo is None else pd.Timestamp(target),
                "predicted_price": predicted,
                "actual_price": actual,
                "abs_error": abs_err,
                "pct_error": pct_err,
            })
    return pd.DataFrame(results)


# ── Fetch data ─────────────────────────────────────────────────────────────────
pred_df = load_predictions(coin)
live_df = load_live_prices(coin, days=30)
hist_df = load_historical_context(coin, days=90)
accuracy_df = load_accuracy_data(coin)

has_predictions = not pred_df.empty
# Prefer live_prices for the historical chart; fall back to batch historical_sma
use_live = not live_df.empty

# ── Historical + Forecast chart ────────────────────────────────────────────────
st.subheader(f"{coin} Price — Historical + LSTM Forecast")
source_label = "live prices (realtime)" if use_live else "batch layer (historical_sma)"
st.caption(f"Historical source: {source_label}")

fig = go.Figure()

# Background context from batch layer (dimmer line, longer lookback)
if not hist_df.empty:
    fig.add_trace(go.Scatter(
        x=hist_df["date"],
        y=hist_df["avg_close"],
        mode="lines",
        name=f"{coin} batch history",
        line=dict(color="rgba(255,167,38,0.35)", width=1.5),
        showlegend=True,
    ))

# Primary actual prices from live_prices (brighter, on top)
if use_live:
    fig.add_trace(go.Scatter(
        x=live_df["date"],
        y=live_df["price"],
        mode="lines",
        name=f"{coin} actual (live)",
        line=dict(color="#ffa726", width=2),
    ))

if has_predictions:
    # Only show future predictions (not past ones already evaluated)
    now_utc = datetime.now(timezone.utc)
    future_df = pred_df[pred_df["prediction_date"] >= now_utc]
    if not future_df.empty:
        fig.add_trace(go.Scatter(
            x=future_df["prediction_date"],
            y=future_df["predicted_price"],
            mode="lines+markers",
            name="LSTM 7-day forecast",
            line=dict(color="#00e5ff", width=2, dash="dot"),
            marker=dict(size=7, symbol="circle"),
        ))

    # Past predictions vs actuals (accuracy scatter)
    if not accuracy_df.empty:
        fig.add_trace(go.Scatter(
            x=accuracy_df["prediction_date"],
            y=accuracy_df["predicted_price"],
            mode="markers",
            name="past predictions",
            marker=dict(size=9, color="#ff6b6b", symbol="x"),
        ))
        fig.add_trace(go.Scatter(
            x=accuracy_df["prediction_date"],
            y=accuracy_df["actual_price"],
            mode="markers",
            name="actual at pred date",
            marker=dict(size=9, color="#69ff47", symbol="circle-open"),
        ))

    # Vertical divider at forecast start
    divider_x = hist_df["date"].max() if not hist_df.empty else (
        live_df["date"].max() if not live_df.empty else None
    )
    if divider_x is not None:
        fig.add_vline(
            x=divider_x.timestamp() * 1000,
            line_dash="dash",
            line_color="gray",
            annotation_text="Forecast start",
            annotation_position="top left",
        )

if fig.data:
    fig.update_layout(
        template="plotly_dark",
        height=420,
        xaxis_title="Date",
        yaxis_title="Price (USD)",
        margin=dict(l=0, r=0, t=30, b=0),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    )
    st.plotly_chart(fig, use_container_width=True)
else:
    st.info("No historical data found. Run the Spark batch job or start the producer first.")

st.markdown("---")

# ── Predictions section ────────────────────────────────────────────────────────
st.subheader("Model Predictions")

if not has_predictions:
    st.info(
        "LSTM model not trained yet.  \n"
        "Train and run inference with:  \n"
        "```bash\n"
        "bash scripts/run_inference.sh\n"
        "```"
    )
    col1, col2, col3 = st.columns(3)
    col1.metric("Next predicted price", "—")
    col2.metric("7-day high estimate", "—")
    col3.metric("Model version", "lstm_v1 (pending)")

else:
    # Only future predictions for metrics cards
    now_utc = datetime.now(timezone.utc)
    future_df = pred_df[pred_df["prediction_date"] >= now_utc]

    if future_df.empty:
        st.warning("All stored predictions are in the past. Waiting for next scheduler cycle...")
        col1, col2, col3 = st.columns(3)
        col1.metric("Next predicted price", "—")
        col2.metric("7-day range", "—")
        col3.metric("Model version", pred_df.iloc[-1].get("model_version", "lstm_v1"))
    else:
        next_day_row = future_df.iloc[0]
        next_day_price = next_day_row["predicted_price"]
        forecast_high = future_df["predicted_price"].max()
        forecast_low = future_df["predicted_price"].min()
        model_ver = next_day_row.get("model_version", "lstm_v1")
        seed_src = next_day_row.get("seed_source", "—")

        col1, col2, col3 = st.columns(3)
        col1.metric("Next-day predicted price", f"${next_day_price:,.2f}")
        col2.metric("7-day range", f"${forecast_low:,.0f} – ${forecast_high:,.0f}")
        col3.metric("Model version", model_ver)

        # ── 7-day forecast bar chart ───────────────────────────────────────────
        st.subheader("7-Day Forecast Detail")
        forecast_fig = go.Figure()
        forecast_fig.add_trace(go.Bar(
            x=future_df["prediction_date"].dt.strftime("%b %d"),
            y=future_df["predicted_price"],
            marker_color="#00e5ff",
            name="Predicted price",
        ))
        forecast_fig.update_layout(
            template="plotly_dark",
            height=280,
            xaxis_title="Date",
            yaxis_title="Predicted Price (USD)",
            margin=dict(l=0, r=0, t=10, b=0),
        )
        st.plotly_chart(forecast_fig, use_container_width=True)

        # ── Forecast table ─────────────────────────────────────────────────────
        display_df = future_df.copy()
        display_df["prediction_date"] = display_df["prediction_date"].dt.strftime("%Y-%m-%d")
        display_df["predicted_price"] = display_df["predicted_price"].map("${:,.2f}".format)
        display_df = display_df.rename(columns={
            "prediction_date": "Date",
            "predicted_price": "Predicted Price (USD)",
            "confidence": "Confidence",
            "model_version": "Model",
        })
        cols_to_show = [c for c in ["Date", "Predicted Price (USD)", "Confidence", "Model"]
                        if c in display_df.columns]
        st.dataframe(display_df[cols_to_show].reset_index(drop=True), use_container_width=True)

        # ── Metadata caption ───────────────────────────────────────────────────
        if "created_at" in pred_df.columns and not pred_df["created_at"].isna().all():
            created = pd.to_datetime(pred_df["created_at"].iloc[-1], utc=True)
            st.caption(
                f"Last prediction run: {created.strftime('%Y-%m-%d %H:%M UTC')} "
                f"· Seed source: {seed_src}"
            )

st.markdown("---")

# ── PRIMARY: Trend Direction & Strength ───────────────────────────────────────
st.subheader("Trend Direction — 7-Day Outlook")

_DIR_EMOJI = {"UP": "↑", "FLAT": "→", "DOWN": "↓"}
_DIR_COLOR = {"UP": "#69ff47", "DOWN": "#ff6b6b", "FLAT": "#ffa726"}
_STRENGTH_EMOJI = {"STRONG": "🟩", "MODERATE": "🟨", "WEAK": "🟥"}

_has_direction_fields = (
    has_predictions
    and "direction" in pred_df.columns
    and pred_df["direction"].notna().any()
)

if not _has_direction_fields:
    st.info(
        "Direction predictions require the v2 multi-task model (retrained with trend focus).  \n"
        "```bash\n"
        "python src/ml/train_lstm.py --coin bitcoin --alpha 0.3 --beta 1.0\n"
        "python src/ml/inference.py --coin bitcoin\n"
        "```"
    )
else:
    now_utc = datetime.now(timezone.utc)
    future_dir_df = pred_df[pred_df["prediction_date"] >= now_utc].copy()

    if future_dir_df.empty:
        st.warning("All direction predictions are in the past. Waiting for next inference run...")
    else:
        # ── Top-level trend summary cards ─────────────────────────────────────
        dir_counts = future_dir_df["direction"].value_counts()
        dominant = dir_counts.idxmax() if not dir_counts.empty else "—"
        avg_conf = (
            future_dir_df["direction_prob"].mean()
            if "direction_prob" in future_dir_df.columns
            else None
        )
        dominant_strength = (
            future_dir_df["trend_strength"].mode().iloc[0]
            if "trend_strength" in future_dir_df.columns and not future_dir_df["trend_strength"].isna().all()
            else "—"
        )

        col1, col2, col3, col4 = st.columns(4)
        col1.metric(
            "7-Day Dominant Trend",
            f"{_DIR_EMOJI.get(dominant, '—')} {dominant}",
        )
        col2.metric(
            "Avg Confidence",
            f"{avg_conf * 100:.1f}%" if avg_conf is not None else "—",
            help="Softmax probability of predicted direction class",
        )
        col3.metric(
            "Trend Strength",
            f"{_STRENGTH_EMOJI.get(dominant_strength, '')} {dominant_strength}",
            help="Based on probability margin (top1 − top2 class probability)",
        )
        col4.metric(
            "UP / DOWN / FLAT days",
            f"{dir_counts.get('UP', 0)} / {dir_counts.get('DOWN', 0)} / {dir_counts.get('FLAT', 0)}",
        )

        # ── Confidence bar chart (per horizon day) ─────────────────────────────
        st.subheader("Direction Confidence per Day")
        if "direction_prob" in future_dir_df.columns:
            conf_fig = go.Figure()
            for direction in ["UP", "DOWN", "FLAT"]:
                mask = future_dir_df["direction"] == direction
                subset = future_dir_df[mask]
                if not subset.empty:
                    conf_fig.add_trace(go.Bar(
                        x=subset["prediction_date"].dt.strftime("%b %d"),
                        y=subset["direction_prob"] * 100,
                        name=f"{_DIR_EMOJI.get(direction, direction)} {direction}",
                        marker_color=_DIR_COLOR.get(direction, "#aaa"),
                    ))
            conf_fig.update_layout(
                template="plotly_dark",
                height=260,
                yaxis_title="Softmax Confidence (%)",
                xaxis_title="Date",
                barmode="stack",
                margin=dict(l=0, r=0, t=10, b=0),
                legend=dict(orientation="h", yanchor="bottom", y=1.02),
            )
            st.plotly_chart(conf_fig, use_container_width=True)

        # ── Direction + Strength table ─────────────────────────────────────────
        rows = []
        for _, row in future_dir_df.iterrows():
            direction = row.get("direction")
            dir_prob  = row.get("direction_prob")
            strength  = row.get("trend_strength")
            rows.append({
                "Date":         row["prediction_date"].strftime("%Y-%m-%d"),
                "Direction":    f"{_DIR_EMOJI.get(direction, '—')} {direction}" if direction else "—",
                "Confidence":   f"{dir_prob * 100:.1f}%" if dir_prob is not None else "—",
                "Strength":     f"{_STRENGTH_EMOJI.get(strength, '')} {strength}" if strength else "—",
                "Price (ref)":  f"${row['predicted_price']:,.2f}",
            })
        with st.expander("Full 7-Day Detail Table", expanded=True):
            st.dataframe(pd.DataFrame(rows).reset_index(drop=True), use_container_width=True)

st.markdown("---")

# ── SECONDARY: Price Forecast Chart ───────────────────────────────────────────
st.subheader(f"{coin} Price — Historical + LSTM Forecast (reference only)")
st.caption("Price is the auxiliary output — use trend direction as the primary signal")

# ── Predictions section ────────────────────────────────────────────────────────
if not has_predictions:
    st.info(
        "LSTM model not trained yet.  \n"
        "```bash\n"
        "bash scripts/run_inference.sh\n"
        "```"
    )
else:
    now_utc = datetime.now(timezone.utc)
    future_df = pred_df[pred_df["prediction_date"] >= now_utc]

    if not future_df.empty:
        col1, col2 = st.columns(2)
        col1.metric("Next-day reference price", f"${future_df.iloc[0]['predicted_price']:,.2f}")
        col2.metric("7-day range",
                    f"${future_df['predicted_price'].min():,.0f} – "
                    f"${future_df['predicted_price'].max():,.0f}")

        forecast_fig = go.Figure()
        forecast_fig.add_trace(go.Bar(
            x=future_df["prediction_date"].dt.strftime("%b %d"),
            y=future_df["predicted_price"],
            marker_color=[_DIR_COLOR.get(d, "#00e5ff")
                          for d in future_df.get("direction", [""] * len(future_df))],
            name="Predicted price (colour = direction)",
        ))
        forecast_fig.update_layout(
            template="plotly_dark",
            height=260,
            xaxis_title="Date",
            yaxis_title="Predicted Price (USD)",
            margin=dict(l=0, r=0, t=10, b=0),
        )
        st.plotly_chart(forecast_fig, use_container_width=True)

st.markdown("---")

# ── Prediction Accuracy (historical) ──────────────────────────────────────────
st.subheader("Prediction Accuracy (Historical)")

if accuracy_df.empty:
    st.info(
        "Accuracy data appears once prediction dates have passed "
        "and actual prices are available in historical_sma."
    )
else:
    mae = accuracy_df["abs_error"].mean()
    mape = accuracy_df["pct_error"].dropna().mean()
    n_evaluated = len(accuracy_df)

    col1, col2, col3 = st.columns(3)
    col1.metric("Price MAE (reference)", f"${mae:,.2f}")
    col2.metric("Price MAPE (reference)", f"{mape:.1f}%" if mape is not None else "—")
    col3.metric("Predictions evaluated", str(n_evaluated))

    acc_display = accuracy_df.copy()
    acc_display["prediction_date"] = acc_display["prediction_date"].dt.strftime("%Y-%m-%d")
    acc_display["predicted_price"] = acc_display["predicted_price"].map("${:,.2f}".format)
    acc_display["actual_price"] = acc_display["actual_price"].map("${:,.2f}".format)
    acc_display["abs_error"] = acc_display["abs_error"].map("${:,.2f}".format)
    acc_display["pct_error"] = acc_display["pct_error"].map(
        lambda x: f"{x:.1f}%" if x is not None else "—"
    )
    acc_display = acc_display.rename(columns={
        "prediction_date": "Date",
        "predicted_price": "Predicted",
        "actual_price": "Actual",
        "abs_error": "Abs Error",
        "pct_error": "% Error",
    })
    st.dataframe(acc_display.reset_index(drop=True), use_container_width=True)
