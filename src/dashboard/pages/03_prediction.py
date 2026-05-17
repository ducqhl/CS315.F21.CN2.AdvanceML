"""
03_prediction.py — LSTM prediction page (Sprint 5 integration).

When  predictions  collection is populated (Sprint 5 complete):
  - Shows metric cards: next-day predicted price, 7-day range, model version.
  - Renders a combined line chart: historical BTC prices (batch layer) overlaid
    with the 7-day LSTM forecast.
  - Shows a compact table of the 7 upcoming predictions.

When  predictions  collection is empty (graceful degradation):
  - Keeps the placeholder UI with reserved layout and an informational message.
  - Historical context chart is still shown from  historical_sma.

MongoDB fields used from  predictions  collection
-------------------------------------------------
  coin, predicted_price, prediction_date, confidence, model_version, created_at
"""

import logging
from datetime import datetime, timezone, timedelta

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import get_db

logger = logging.getLogger(__name__)

st.set_page_config(page_title="LSTM Predictions", layout="wide")

st.title("LSTM Price Predictions")
st.caption("Model: 2-layer LSTM, input_size=1, hidden=128, seq_len=60, 7-day forecast")

coin = st.session_state.get("selected_coin", "BTC")
coin = st.selectbox(
    "Coin",
    ["BTC", "ETH", "DOGE"],
    index=["BTC", "ETH", "DOGE"].index(coin),
    key="pred_coin",
)


# ── Data loaders ──────────────────────────────────────────────────────────────

@st.cache_data(ttl=30)
def load_predictions(coin: str) -> pd.DataFrame:
    """Load predictions collection for *coin*, sorted by prediction_date ascending."""
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
            "created_at": 1,
        },
    )
    docs = list(cursor)
    if not docs:
        return pd.DataFrame()
    df = pd.DataFrame(docs)
    df["prediction_date"] = pd.to_datetime(df["prediction_date"], utc=True)
    return df


@st.cache_data(ttl=60)
def load_historical_context(coin: str, days: int = 90) -> pd.DataFrame:
    """Load last *days* of historical_sma for background context chart."""
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


# ── Fetch data ────────────────────────────────────────────────────────────────
pred_df = load_predictions(coin)
hist_df = load_historical_context(coin)

has_predictions = not pred_df.empty

# ── Historical + Forecast chart ───────────────────────────────────────────────
st.subheader(f"{coin} Price — Historical (Batch Layer) + LSTM Forecast")

if not hist_df.empty:
    fig = go.Figure()

    # Historical trace
    fig.add_trace(go.Scatter(
        x=hist_df["date"],
        y=hist_df["avg_close"],
        mode="lines",
        name=f"{coin} historical",
        line=dict(color="#ffa726", width=2),
    ))

    if has_predictions:
        # LSTM forecast trace
        fig.add_trace(go.Scatter(
            x=pred_df["prediction_date"],
            y=pred_df["predicted_price"],
            mode="lines+markers",
            name="LSTM 7-day forecast",
            line=dict(color="#00e5ff", width=2, dash="dot"),
            marker=dict(size=7, symbol="circle"),
        ))

        # Vertical divider between historical and forecast
        if not hist_df.empty:
            last_hist_date = hist_df["date"].max()
            fig.add_vline(
                x=last_hist_date.timestamp() * 1000,
                line_dash="dash",
                line_color="gray",
                annotation_text="Forecast start",
                annotation_position="top left",
            )

    fig.update_layout(
        template="plotly_dark",
        height=400,
        xaxis_title="Date",
        yaxis_title="Price (USD)",
        margin=dict(l=0, r=0, t=30, b=0),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    )
    st.plotly_chart(fig, use_container_width=True)
else:
    st.info("No historical data found. Run the Spark batch job first.")

st.markdown("---")

# ── Predictions section ───────────────────────────────────────────────────────
st.subheader("Model Predictions")

if not has_predictions:
    # ── Graceful placeholder when Sprint 5 not run yet ────────────────────────
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
    # ── Live prediction metrics ───────────────────────────────────────────────
    next_day_row = pred_df.iloc[0]    # earliest future prediction
    next_day_price = next_day_row["predicted_price"]
    forecast_high = pred_df["predicted_price"].max()
    forecast_low = pred_df["predicted_price"].min()
    model_ver = next_day_row.get("model_version", "lstm_v1")

    col1, col2, col3 = st.columns(3)
    col1.metric(
        "Next-day predicted price",
        f"${next_day_price:,.2f}",
    )
    col2.metric(
        "7-day range",
        f"${forecast_low:,.0f} – ${forecast_high:,.0f}",
    )
    col3.metric("Model version", model_ver)

    # ── 7-day forecast bar chart ──────────────────────────────────────────────
    st.subheader("7-Day Forecast Detail")

    forecast_fig = go.Figure()
    forecast_fig.add_trace(go.Bar(
        x=pred_df["prediction_date"].dt.strftime("%b %d"),
        y=pred_df["predicted_price"],
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

    # ── Prediction table ──────────────────────────────────────────────────────
    display_df = pred_df.copy()
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

    # ── Created-at timestamp ──────────────────────────────────────────────────
    if "created_at" in pred_df.columns and not pred_df["created_at"].isna().all():
        created = pd.to_datetime(pred_df["created_at"].iloc[0], utc=True)
        st.caption(f"Predictions generated at {created.strftime('%Y-%m-%d %H:%M UTC')}")
