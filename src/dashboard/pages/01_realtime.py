"""
01_realtime.py — Live price page.

Queries realtime_prices (Speed Layer).
Falls back to daily_stats (Batch Layer) when realtime_prices is empty.
Auto-refreshes every 30 seconds.
"""

import logging
from datetime import datetime, timezone, timedelta

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from streamlit_autorefresh import st_autorefresh

# Import shared connection from app.py via sys.path trick used in multi-page apps.
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import get_db

logger = logging.getLogger(__name__)

# Auto-refresh every 30 seconds (30 000 ms).
st_autorefresh(interval=30_000, key="realtime_refresh")

st.title("Real-time Prices")
st.caption("Data source: CoinGecko via Kafka → Spark → MongoDB  |  Auto-refreshes every 30 s")

# ── Sidebar coin selector (read from session_state set by app.py) ─────────────
coin = st.session_state.get("selected_coin", "BTC")


# ── Data loading helpers ──────────────────────────────────────────────────────

@st.cache_data(ttl=30)
def load_realtime_latest(coin: str) -> dict | None:
    """Return the most recent realtime_prices record for *coin*, or None."""
    db = get_db()
    doc = db.realtime_prices.find_one(
        {"coin": coin},
        sort=[("event_time", -1)],
    )
    return doc


@st.cache_data(ttl=30)
def load_realtime_24h(coin: str) -> pd.DataFrame:
    """Return last 24 h of realtime_prices for *coin* as a DataFrame."""
    db = get_db()
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    cursor = db.realtime_prices.find(
        {"coin": coin, "event_time": {"$gte": since}},
        sort=[("event_time", 1)],
        projection={"_id": 0, "price_usd": 1, "event_time": 1,
                    "volume_24h": 1, "market_cap": 1},
    )
    docs = list(cursor)
    if not docs:
        return pd.DataFrame()
    df = pd.DataFrame(docs)
    df["event_time"] = pd.to_datetime(df["event_time"], utc=True)
    return df


@st.cache_data(ttl=30)
def load_daily_fallback(coin: str, n: int = 30) -> pd.DataFrame:
    """Return last *n* daily_stats records for *coin* when realtime is empty."""
    db = get_db()
    cursor = db.daily_stats.find(
        {"symbol": coin},
        sort=[("date", -1)],
        limit=n,
        projection={"_id": 0, "avg_close": 1, "date": 1,
                    "avg_volume": 1},
    )
    docs = list(cursor)
    if not docs:
        return pd.DataFrame()
    df = pd.DataFrame(docs)
    df["date"] = pd.to_datetime(df["date"], utc=True)
    df = df.sort_values("date")
    return df


# ── Fetch data ────────────────────────────────────────────────────────────────
latest_doc = load_realtime_latest(coin)
rt_df = load_realtime_24h(coin)

using_realtime = not rt_df.empty

if not using_realtime:
    daily_df = load_daily_fallback(coin)
    using_daily = not daily_df.empty
else:
    using_daily = False

# ── Metric cards ──────────────────────────────────────────────────────────────
st.subheader(f"{coin} / USD")

if latest_doc:
    price = latest_doc.get("price_usd", 0.0)
    change = latest_doc.get("change_24h", 0.0)
    mktcap = latest_doc.get("market_cap", 0.0)
    updated = latest_doc.get("event_time")

    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Price (USD)", f"${price:,.2f}", f"{change:+.2f}%")
    col2.metric("24 h Change", f"{change:+.2f}%")
    col3.metric("Market Cap", f"${mktcap/1e9:,.1f} B" if mktcap else "N/A")
    if updated:
        col4.metric("Last Updated", str(updated)[:19])

elif using_daily and not daily_df.empty:
    last = daily_df.iloc[-1]
    price = last.get("avg_close", 0.0)
    col1, col2, col3 = st.columns(3)
    col1.metric("Price (USD — daily close)", f"${price:,.2f}")
    col2.metric("Source", "Batch / daily_stats")
    col3.metric("Date", str(last["date"])[:10])

else:
    st.info("No price data available. Start the Kafka producer and Spark streaming job.")

# ── Line chart ────────────────────────────────────────────────────────────────
st.markdown("---")

if using_realtime:
    st.subheader("Last 24 h — live prices")
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=rt_df["event_time"],
        y=rt_df["price_usd"],
        mode="lines",
        name=f"{coin} price",
        line=dict(color="#00d4ff", width=2),
    ))
    fig.update_layout(
        template="plotly_dark",
        height=350,
        xaxis_title="Time (UTC)",
        yaxis_title="Price (USD)",
        margin=dict(l=0, r=0, t=30, b=0),
    )
    st.plotly_chart(fig, use_container_width=True)

elif using_daily:
    st.subheader(f"Last 30 days — daily close (batch fallback — realtime not running)")
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=daily_df["date"],
        y=daily_df["avg_close"],
        mode="lines+markers",
        name=f"{coin} daily close",
        line=dict(color="#ffa500", width=2),
    ))
    fig.update_layout(
        template="plotly_dark",
        height=350,
        xaxis_title="Date",
        yaxis_title="Avg Close (USD)",
        margin=dict(l=0, r=0, t=30, b=0),
    )
    st.plotly_chart(fig, use_container_width=True)
    st.warning(
        "Streaming pipeline is not running — showing batch data from daily_stats. "
        "Submit the Spark streaming job to see live prices."
    )

else:
    st.warning("No data found in either realtime_prices or daily_stats for this coin.")
