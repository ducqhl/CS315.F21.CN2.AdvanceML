"""
app.py — Streamlit main entry point for the Crypto Big Data dashboard.

Provides:
- Page configuration (wide layout, dark theme)
- Shared @st.cache_resource MongoDB connection
- Sidebar navigation controls (coin selector, time-range selector)
"""

import os
import streamlit as st
from dotenv import load_dotenv

# Load .env for local development; Docker injects MONGO_URI directly.
load_dotenv()

# ── Page configuration (must be first Streamlit command) ──────────────────────
st.set_page_config(
    page_title="Crypto Big Data Dashboard",
    page_icon="C",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Shared MongoDB connection ─────────────────────────────────────────────────
_DEFAULT_URI = "mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin"


@st.cache_resource
def get_mongo_client():
    """Return a cached MongoClient.  Uses MONGO_URI from st.secrets, then env var,
    then local default so the dashboard works outside Docker during development."""
    import pymongo

    try:
        _uri = st.secrets["MONGO_URI"]
    except (FileNotFoundError, KeyError):
        _uri = os.environ.get("MONGO_URI", _DEFAULT_URI)
    client = pymongo.MongoClient(_uri, serverSelectionTimeoutMS=5000)
    return client


def get_db():
    """Return the crypto_db database handle."""
    return get_mongo_client()["crypto_db"]


# ── Sidebar ───────────────────────────────────────────────────────────────────
st.sidebar.title("Crypto Big Data")
st.sidebar.markdown("Lambda Architecture: Kafka + Spark + MongoDB")

AVAILABLE_COINS = ["BTC", "DOGE"]
selected_coin = st.sidebar.selectbox(
    "Select coin",
    AVAILABLE_COINS,
    index=0,
    key="global_coin",
)

TIME_RANGE_OPTIONS = {"1 Month": 30, "3 Months": 90, "6 Months": 180, "1 Year": 365, "ALL": 0}
selected_range_label = st.sidebar.selectbox(
    "Time range",
    list(TIME_RANGE_OPTIONS.keys()),
    index=2,
    key="global_range",
)
selected_range_days = TIME_RANGE_OPTIONS[selected_range_label]

# Expose selections via session state so pages can read them.
st.session_state["selected_coin"] = selected_coin
st.session_state["selected_range_days"] = selected_range_days
st.session_state["selected_range_label"] = selected_range_label

# ── Home page content ─────────────────────────────────────────────────────────
st.title("Crypto Big Data Dashboard")
st.markdown(
    """
**Architecture:** Lambda Architecture — Speed Layer (Kafka + Spark Streaming) +
Batch Layer (G-Research CSV + Spark Batch) + Serving Layer (MongoDB 7)

Use the **sidebar** to navigate between pages:

| Page | Description |
|---|---|
| Real-time Prices | Live prices from CoinGecko via Kafka, auto-refreshed every 30 s |
| Technical Analysis | Candlestick chart with SMA-20, SMA-50, RSI, and Volume |
| LSTM Predictions | Price forecast from trained LSTM model (Sprint 5) |
| Coin Correlation | Pearson correlation heatmap across BTC, DOGE |
"""
)

st.sidebar.markdown("---")
st.sidebar.caption("Sprint 4 — Dashboard")
