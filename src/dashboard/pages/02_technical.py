"""
02_technical.py — Candlestick + technical indicators page.

Data source: historical_sma (Batch Layer).
OHLC simulation: open=prev_close, high=avg_close*1.001, low=avg_close*0.999, close=avg_close
RSI computed from avg_close using pandas (not stored in historical_sma).
"""

import logging
from datetime import datetime, timezone, timedelta

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import streamlit as st

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import get_db
from utils import compute_rsi, simulate_ohlc  # pure helpers, no Streamlit dep

logger = logging.getLogger(__name__)

st.title("Technical Analysis")
st.caption("Data source: historical_sma (Batch Layer — G-Research dataset)")

# ── Controls ──────────────────────────────────────────────────────────────────
coin = st.session_state.get("selected_coin", "BTC")

TIMEFRAME_MAP = {"1M": 30, "3M": 90, "6M": 180, "1Y": 365, "ALL": 0}
col_c, col_t = st.columns([1, 3])
with col_c:
    coin = st.selectbox("Coin", ["BTC", "ETH", "DOGE"], key="tech_coin",
                        index=["BTC", "ETH", "DOGE"].index(coin))
with col_t:
    timeframe = st.radio("Timeframe", list(TIMEFRAME_MAP.keys()),
                         index=2, horizontal=True, key="tech_tf")

days = TIMEFRAME_MAP[timeframe]


# ── Data loading ──────────────────────────────────────────────────────────────

@st.cache_data(ttl=30)
def load_historical_sma(coin: str, days: int) -> pd.DataFrame:
    """Load historical_sma records for *coin*.  If days==0 load all."""
    db = get_db()
    query: dict = {"symbol": coin}
    if days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        query["date"] = {"$gte": cutoff}

    cursor = db.historical_sma.find(
        query,
        sort=[("date", 1)],
        projection={"_id": 0, "symbol": 1, "date": 1, "avg_close": 1,
                    "sma_20": 1, "sma_50": 1, "avg_volume": 1},
    )
    docs = list(cursor)
    if not docs:
        return pd.DataFrame()
    df = pd.DataFrame(docs)
    df["date"] = pd.to_datetime(df["date"], utc=True)
    return df


# ── Main render ───────────────────────────────────────────────────────────────
df = load_historical_sma(coin, days)

if df.empty:
    st.warning(
        f"No historical_sma data found for {coin}. "
        "Run the Spark batch job first."
    )
    st.stop()

# Simulate OHLC and compute RSI
df = simulate_ohlc(df)
df["rsi_14"] = compute_rsi(df["close"], period=14)

# Build 3-row subplot: candlestick + SMA | volume | RSI
fig = make_subplots(
    rows=3, cols=1,
    shared_xaxes=True,
    row_heights=[0.6, 0.2, 0.2],
    vertical_spacing=0.03,
    subplot_titles=(f"{coin}/USD — Price & SMA", "Volume", "RSI(14)"),
)

# Row 1 — Candlestick
fig.add_trace(
    go.Candlestick(
        x=df["date"],
        open=df["open"],
        high=df["high"],
        low=df["low"],
        close=df["close"],
        name=coin,
        increasing_line_color="#26a69a",
        decreasing_line_color="#ef5350",
    ),
    row=1, col=1,
)

# Row 1 — SMA overlays
fig.add_trace(
    go.Scatter(
        x=df["date"], y=df["sma_20"],
        mode="lines",
        name="SMA-20",
        line=dict(color="#ffa726", width=1.5),
    ),
    row=1, col=1,
)
fig.add_trace(
    go.Scatter(
        x=df["date"], y=df["sma_50"],
        mode="lines",
        name="SMA-50",
        line=dict(color="#ab47bc", width=1.5),
    ),
    row=1, col=1,
)

# Row 2 — Volume bars
volume_col = "avg_volume" if "avg_volume" in df.columns else None
if volume_col:
    fig.add_trace(
        go.Bar(
            x=df["date"],
            y=df[volume_col],
            name="Volume",
            marker_color="rgba(100, 149, 237, 0.5)",
        ),
        row=2, col=1,
    )

# Row 3 — RSI
fig.add_trace(
    go.Scatter(
        x=df["date"], y=df["rsi_14"],
        mode="lines",
        name="RSI(14)",
        line=dict(color="#ce93d8", width=1.5),
    ),
    row=3, col=1,
)
# Overbought / oversold bands
fig.add_hline(y=70, line_dash="dash", line_color="#ef5350", row=3, col=1)
fig.add_hline(y=30, line_dash="dash", line_color="#26a69a", row=3, col=1)

fig.update_layout(
    template="plotly_dark",
    height=700,
    xaxis_rangeslider_visible=False,
    showlegend=True,
    margin=dict(l=0, r=0, t=40, b=0),
    legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
)
fig.update_yaxes(title_text="Price (USD)", row=1, col=1)
fig.update_yaxes(title_text="Volume", row=2, col=1)
fig.update_yaxes(title_text="RSI", row=3, col=1, range=[0, 100])

st.plotly_chart(fig, use_container_width=True)

# ── Summary statistics ────────────────────────────────────────────────────────
with st.expander("Summary statistics"):
    stat_df = df[["date", "close", "sma_20", "sma_50", "rsi_14"]].tail(10).copy()
    stat_df["date"] = stat_df["date"].dt.strftime("%Y-%m-%d")
    st.dataframe(stat_df.reset_index(drop=True), use_container_width=True)
