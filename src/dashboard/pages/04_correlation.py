"""
04_correlation.py — Coin correlation heatmap page.

Queries coin_correlation collection (3 pairs: BTC-ETH, BTC-DOGE, ETH-DOGE).
Builds a 3×3 symmetric Pearson correlation matrix (diagonal = 1.0).
Renders as px.imshow heatmap with plotly_dark template.
"""

import logging

import numpy as np
import pandas as pd
import plotly.express as px
import streamlit as st

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import get_db
from utils import build_corr_matrix  # pure helper, no Streamlit dep

logger = logging.getLogger(__name__)

st.set_page_config(page_title="Coin Correlation", layout="wide")

st.title("Coin Correlation Matrix")
st.caption("Data source: coin_correlation (Batch Layer — G-Research dataset)")


# ── Data loader ───────────────────────────────────────────────────────────────

@st.cache_data(ttl=300)
def load_correlation_data() -> pd.DataFrame:
    """Return all coin_correlation documents as a DataFrame."""
    db = get_db()
    cursor = db.coin_correlation.find(
        {},
        projection={"_id": 0, "coin_a": 1, "coin_b": 1, "pearson_corr": 1},
    )
    docs = list(cursor)
    if not docs:
        return pd.DataFrame()
    return pd.DataFrame(docs)


# ── Fetch ─────────────────────────────────────────────────────────────────────
corr_df = load_correlation_data()

if corr_df.empty:
    st.warning(
        "No correlation data found. "
        "Run the Spark batch job (`scripts/run_batch.sh`) to populate coin_correlation."
    )
    st.stop()

matrix_df = build_corr_matrix(corr_df)

# ── Heatmap ───────────────────────────────────────────────────────────────────
st.subheader("Pearson Correlation Heatmap")

fig = px.imshow(
    matrix_df.values,
    x=matrix_df.columns.tolist(),
    y=matrix_df.index.tolist(),
    zmin=-1,
    zmax=1,
    color_continuous_scale="RdBu_r",
    text_auto=".3f",
    title="Pearson Correlation — BTC / ETH / DOGE",
    template="plotly_dark",
    aspect="auto",
)
fig.update_layout(
    height=450,
    coloraxis_colorbar=dict(title="Pearson r"),
    margin=dict(l=0, r=0, t=50, b=0),
)
st.plotly_chart(fig, use_container_width=True)

# ── Interpretation note ───────────────────────────────────────────────────────
st.info(
    "**Interpretation guide:** "
    "Values > 0.9 = very strong positive correlation | "
    "0.7–0.9 = strong | "
    "0.4–0.7 = moderate | "
    "< 0.4 = weak | "
    "Negative values = inverse relationship"
)

# ── Data table ────────────────────────────────────────────────────────────────
st.subheader("Raw Pair Data")
display_df = corr_df.copy()
display_df["pearson_corr"] = display_df["pearson_corr"].round(4)
display_df.columns = ["Coin A", "Coin B", "Pearson r"]
st.dataframe(display_df.reset_index(drop=True), use_container_width=True)

# ── Full correlation matrix table ─────────────────────────────────────────────
with st.expander("Symmetric correlation matrix"):
    styled = matrix_df.round(4)
    st.dataframe(styled, use_container_width=True)
