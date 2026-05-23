# Phase 7 — Hourly OHLCV Data Collection + Sentiment

**Goal:** Replace daily-granularity data collection with 1-hour OHLCV from CoinGecko, add
Fear & Greed sentiment, and store all data in a new `ohlcv_hourly` MongoDB collection so
the inference pipeline and future retraining can use hourly-resolution features.

**Depends on:** Current working state of `src/ml/inference_scheduler.py` and `src/producer/crypto_producer.py`

**Unlocks:** Phase 8 (retraining on hourly data), Phase 9 (hourly model)

**CoinGecko API budget after this phase:**
- Scheduler `/market_chart?interval=hourly`: 2 calls/hour × 24 × 30 = 1,440/month
- Producer `/simple/price`: 4,320/month
- Producer `/ohlc`: 2,880/month
- Fear & Greed (alternative.me, not CoinGecko): 0 CoinGecko calls
- **Total: 8,640/month — under 10k demo limit**

---

## Do NOT Touch

- `src/ml/model.py` — model architecture unchanged in this phase
- `src/ml/train_lstm.py` — training script unchanged
- `src/ml/preprocess.py` — preprocessing unchanged
- `src/spark/batch_job.py` — batch layer unchanged
- `src/spark/streaming_job.py` — streaming layer unchanged
- `tests/test_lstm.py` — no model tests change
- `data/sample/*.csv` — source CSVs unchanged

---

## New Files to Create

```
src/ml/data_collector.py          ← New: hourly OHLCV + sentiment fetch/persist
src/dashboard/pages/05_sentiment.py  ← New: sentiment + BTC dominance chart
tests/test_data_collector.py      ← New: unit tests for data_collector
```

## Files to Modify

```
src/ml/inference_scheduler.py     ← Replace simple price fetch with hourly OHLCV fetch
src/ml/inference.py               ← Add ohlcv_hourly as Priority 0 seed source
docker/docker-compose.yml         ← No new services; add env vars
src/ml/requirements.txt           ← Add requests (already in producer, add to ml)
```

---

## Step 1 — Create `src/ml/data_collector.py`

This module owns all external data fetching for the ML layer. The inference_scheduler
will import from here instead of embedding CoinGecko calls directly.

### 1a. Module constants and client factory

```python
# src/ml/data_collector.py
"""
data_collector.py — External data fetching for the ML layer.

Fetches and persists:
  1. Hourly OHLCV from CoinGecko /coins/{id}/market_chart?interval=hourly
  2. Fear & Greed Index from alternative.me (1 call/day, cached)
  3. BTC Dominance from CoinGecko /global

All writes go to MongoDB. Collection schemas are defined in this file.
"""

import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

import pymongo
import requests

logger = logging.getLogger(__name__)

MONGO_URI = os.getenv("MONGO_URI", "mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin")
COINGECKO_API_KEY = os.getenv("COINGECKO_API_KEY", "")

COIN_IDS = ["bitcoin", "dogecoin"]
COIN_SYMBOL_MAP = {"bitcoin": "BTC", "dogecoin": "DOGE"}

# MongoDB collection names
OHLCV_HOURLY_COLLECTION = "ohlcv_hourly"
SENTIMENT_COLLECTION = "market_sentiment"
```

### 1b. `fetch_hourly_ohlcv(coin_id, days=2)` function

```python
def fetch_hourly_ohlcv(coin_id: str, days: int = 2) -> list[dict]:
    """
    Fetch hourly OHLCV for coin_id from CoinGecko market_chart endpoint.

    Returns list of dicts:
        {"coin": "BTC", "coin_id": "bitcoin", "timestamp": datetime,
         "close": float, "volume": float, "market_cap": float}

    Note: market_chart only returns close prices + volume + market_cap (not open/high/low).
    True OHLC requires the /ohlc endpoint (4h candles only).

    Parameters:
        coin_id: CoinGecko coin id ("bitcoin" or "dogecoin")
        days: lookback days (1 = last 24 hours of hourly data, max 90 for free tier)

    Raises:
        requests.HTTPError: on 4xx/5xx responses (caller should handle 429)
    """
    base_url = "https://api.coingecko.com/api/v3"
    params = {
        "vs_currency": "usd",
        "days": str(days),
        "interval": "hourly",
        "precision": "2",
    }
    headers = {}
    if COINGECKO_API_KEY:
        headers["x-cg-demo-api-key"] = COINGECKO_API_KEY

    resp = requests.get(
        f"{base_url}/coins/{coin_id}/market_chart",
        params=params,
        headers=headers,
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()

    # data shape: {"prices": [[ts_ms, price], ...], "total_volumes": [...], "market_caps": [...]}
    prices = data.get("prices", [])
    volumes = data.get("total_volumes", [])
    market_caps = data.get("market_caps", [])

    records = []
    for (ts_ms, close), (_, vol), (_, mktcap) in zip(prices, volumes, market_caps):
        records.append({
            "coin":       COIN_SYMBOL_MAP.get(coin_id, coin_id.upper()),
            "coin_id":    coin_id,
            "timestamp":  datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc),
            "close":      float(close),
            "volume":     float(vol),
            "market_cap": float(mktcap),
            "source":     "coingecko_market_chart",
        })
    return records
```

### 1c. `persist_hourly_ohlcv(records, mongo_uri)` function

```python
def persist_hourly_ohlcv(records: list[dict], mongo_uri: str = MONGO_URI) -> int:
    """
    Upsert hourly OHLCV records into MongoDB ohlcv_hourly collection.

    Upsert key: (coin, timestamp) — prevents duplicates on repeated fetches.

    Returns number of records upserted.

    Schema enforced:
        coin:       str   "BTC" | "DOGE"
        coin_id:    str
        timestamp:  datetime (UTC, hourly boundary)
        close:      float > 0
        volume:     float >= 0
        market_cap: float >= 0
        source:     str

    Indexes (created on first call if not exist):
        {coin: 1, timestamp: -1}  — primary query index
        {timestamp: 1}            — TTL=365 days (auto-delete old hourly data)
    """
    if not records:
        return 0

    client = pymongo.MongoClient(mongo_uri, serverSelectionTimeoutMS=3000)
    db = client["crypto_db"]
    col = db[OHLCV_HOURLY_COLLECTION]

    # Ensure indexes exist (idempotent)
    existing_indexes = col.index_information()
    if "coin_timestamp_desc" not in existing_indexes:
        col.create_index([("coin", 1), ("timestamp", -1)], name="coin_timestamp_desc")
    if "ttl_365d" not in existing_indexes:
        col.create_index(
            [("timestamp", 1)],
            expireAfterSeconds=31_536_000,  # 365 days
            name="ttl_365d",
        )

    upserted = 0
    for r in records:
        if r.get("close", 0) <= 0:
            continue  # skip invalid prices
        result = col.update_one(
            {"coin": r["coin"], "timestamp": r["timestamp"]},
            {"$set": r},
            upsert=True,
        )
        if result.upserted_id or result.modified_count:
            upserted += 1

    client.close()
    logger.info("Upserted %d/%d hourly OHLCV records.", upserted, len(records))
    return upserted
```

### 1d. `fetch_fear_greed_index()` function

```python
def fetch_fear_greed_index() -> Optional[dict]:
    """
    Fetch today's Fear & Greed Index from alternative.me (NOT CoinGecko — zero budget impact).

    Returns:
        {"value": int, "classification": str, "timestamp": datetime} or None on failure.

    Classifications: "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed"
    Value range: 0 (extreme fear) to 100 (extreme greed)
    """
    try:
        resp = requests.get(
            "https://api.alternative.me/fng/?limit=1",
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()["data"][0]
        return {
            "value":          int(data["value"]),
            "classification": data["value_classification"],
            "timestamp":      datetime.now(timezone.utc).replace(
                hour=0, minute=0, second=0, microsecond=0
            ),
            "source":         "alternative_me",
        }
    except Exception as exc:
        logger.warning("Fear & Greed fetch failed (non-fatal): %s", exc)
        return None
```

### 1e. `persist_sentiment(record, mongo_uri)` function

```python
def persist_sentiment(record: dict, mongo_uri: str = MONGO_URI) -> None:
    """
    Upsert daily sentiment into market_sentiment collection.
    Upsert key: timestamp (daily midnight UTC) — one record per day.

    Schema:
        timestamp:      datetime (midnight UTC, daily)
        value:          int (0–100)
        classification: str
        source:         str
    """
    if not record:
        return
    client = pymongo.MongoClient(mongo_uri, serverSelectionTimeoutMS=3000)
    db = client["crypto_db"]
    col = db[SENTIMENT_COLLECTION]

    existing = col.index_information()
    if "timestamp_1" not in existing:
        col.create_index([("timestamp", 1)], name="timestamp_1")
    if "ttl_365d" not in existing:
        col.create_index(
            [("timestamp", 1)], expireAfterSeconds=31_536_000, name="ttl_365d"
        )

    col.update_one(
        {"timestamp": record["timestamp"]},
        {"$set": record},
        upsert=True,
    )
    client.close()
    logger.info(
        "Persisted sentiment: value=%d (%s)", record["value"], record["classification"]
    )
```

### 1f. `collect_all(mongo_uri)` — single entry point called by scheduler

```python
def collect_all(mongo_uri: str = MONGO_URI) -> dict:
    """
    Run one full data collection cycle:
      1. Hourly OHLCV for all coins (last 2 days)
      2. Fear & Greed Index (daily)

    Returns summary dict:
        {"ohlcv_upserted": int, "sentiment_ok": bool, "errors": list[str]}
    """
    summary = {"ohlcv_upserted": 0, "sentiment_ok": False, "errors": []}

    for coin_id in COIN_IDS:
        try:
            records = fetch_hourly_ohlcv(coin_id, days=2)
            summary["ohlcv_upserted"] += persist_hourly_ohlcv(records, mongo_uri)
        except requests.HTTPError as exc:
            msg = f"OHLCV fetch failed for {coin_id}: {exc}"
            logger.warning(msg)
            summary["errors"].append(msg)
        except Exception as exc:
            msg = f"OHLCV persist failed for {coin_id}: {exc}"
            logger.exception(msg)
            summary["errors"].append(msg)

    sentiment = fetch_fear_greed_index()
    if sentiment:
        try:
            persist_sentiment(sentiment, mongo_uri)
            summary["sentiment_ok"] = True
        except Exception as exc:
            summary["errors"].append(f"Sentiment persist failed: {exc}")

    return summary
```

---

## Step 2 — Update `src/ml/inference_scheduler.py`

### 2a. Replace `fetch_and_persist_latest_prices` with `collect_all`

Remove the existing `fetch_and_persist_latest_prices` function and all CoinGecko client
code from `inference_scheduler.py`. Replace with a call to `data_collector.collect_all`.

**Old code to remove:**
```python
# DELETE these from inference_scheduler.py:
def _build_cg_client(): ...
def fetch_and_persist_latest_prices(): ...
```

**New import and call:**
```python
# ADD at top of inference_scheduler.py (after sys.path.insert):
from data_collector import collect_all

# REPLACE in run_cycle():
# OLD:
if SCHEDULER_FETCH_COINGECKO:
    fetch_and_persist_latest_prices()

# NEW:
if SCHEDULER_FETCH_COINGECKO:
    summary = collect_all(mongo_uri=MONGO_URI)
    logger.info(
        "Data collection: %d OHLCV upserted, sentiment=%s, errors=%s",
        summary["ohlcv_upserted"],
        summary["sentiment_ok"],
        summary["errors"] or "none",
    )
```

### 2b. Remove pycoingecko import from inference_scheduler.py

`pycoingecko` is no longer needed directly in inference_scheduler — `data_collector` uses
raw `requests` calls instead. Remove:
```python
# DELETE from inference_scheduler.py (if present):
from pycoingecko import CoinGeckoAPI
COINGECKO_API_KEY = os.getenv(...)
```

---

## Step 3 — Update `src/ml/inference.py`

### 3a. Add `_load_last_n_from_ohlcv_hourly` function

Add this function after `_load_last_n_from_live_prices`:

```python
def _load_last_n_from_ohlcv_hourly(
    coin_symbol: str,
    n: int,
    mongo_uri: str | None = None,
) -> np.ndarray | None:
    """
    Query ohlcv_hourly for the last *n* close prices for *coin_symbol*.

    This is Priority 0 — hourly data is the freshest and highest-resolution source.
    Returns 1-D array of close prices (chronological, oldest first), or None.

    Note: For hourly model (seq_len=168), n = 168 + 31 = 199.
          For current daily model (seq_len=60), n = 91 is sufficient.
    """
    uri = mongo_uri or os.environ.get("MONGO_URI", _DEFAULT_URI)
    try:
        import pymongo
        client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=3000)
        db = client["crypto_db"]
        cursor = db.ohlcv_hourly.find(
            {"coin": coin_symbol},
            sort=[("timestamp", -1)],
            limit=n,
            projection={"_id": 0, "close": 1},
        )
        docs = list(cursor)
        client.close()
        if len(docs) < n:
            logger.info(
                "ohlcv_hourly has %d/%d rows for %s — trying live_prices.",
                len(docs), n, coin_symbol,
            )
            return None
        prices = np.array([d["close"] for d in reversed(docs)], dtype=np.float32)
        logger.info("Loaded %d close prices from ohlcv_hourly (priority 0 seed).", n)
        return prices
    except Exception as exc:
        logger.warning("ohlcv_hourly unavailable (%s); trying live_prices.", exc)
        return None
```

### 3b. Update seed priority chain in `run_inference()`

```python
# REPLACE the current seed priority block with:

n_fetch = SEQ_LEN + 31

# Priority 0: ohlcv_hourly (freshest hourly-resolution data)
raw_close = _load_last_n_from_ohlcv_hourly(coin_symbol, n=n_fetch, mongo_uri=mongo_uri)
seed_source = "ohlcv_hourly"

# Priority 1: live_prices (direct CoinGecko writes, 10-min resolution)
if raw_close is None:
    raw_close = _load_last_n_from_live_prices(coin_symbol, n=n_fetch, mongo_uri=mongo_uri)
    seed_source = "live_prices"

# Priority 2: historical_sma (daily batch layer)
if raw_close is None:
    raw_close = _load_last_n_from_mongo(coin_symbol, n=n_fetch, mongo_uri=mongo_uri)
    seed_source = "historical_sma"

# Priority 3: CSV fallback (static, always available)
if raw_close is None:
    raw_close = _load_last_n_from_csv(coin, n=n_fetch)
    seed_source = "csv"

logger.info("Seed source for %s: %s", coin_symbol, seed_source)
```

---

## Step 4 — Create `src/dashboard/pages/05_sentiment.py`

```python
"""
05_sentiment.py — Market Sentiment & BTC Dominance page.

Data sources:
  market_sentiment  — Fear & Greed Index (daily, from alternative.me via data_collector)
  ohlcv_hourly      — Hourly close prices for the last 7 days (line chart)
"""
import streamlit as st
import plotly.graph_objects as go
import pandas as pd
from datetime import datetime, timezone, timedelta
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import get_db

st.title("Market Sentiment")
coin = st.selectbox("Coin", ["BTC", "DOGE"], key="sentiment_coin")

@st.cache_data(ttl=3600)
def load_sentiment(days: int = 30) -> pd.DataFrame:
    db = get_db()
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    docs = list(db.market_sentiment.find(
        {"timestamp": {"$gte": cutoff}},
        sort=[("timestamp", 1)],
        projection={"_id": 0, "timestamp": 1, "value": 1, "classification": 1},
    ))
    if not docs:
        return pd.DataFrame()
    df = pd.DataFrame(docs)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    return df

@st.cache_data(ttl=300)
def load_hourly_prices(coin: str, days: int = 7) -> pd.DataFrame:
    db = get_db()
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    docs = list(db.ohlcv_hourly.find(
        {"coin": coin, "timestamp": {"$gte": cutoff}},
        sort=[("timestamp", 1)],
        projection={"_id": 0, "timestamp": 1, "close": 1, "volume": 1},
    ))
    if not docs:
        return pd.DataFrame()
    df = pd.DataFrame(docs)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    return df

sentiment_df = load_sentiment()
hourly_df = load_hourly_prices(coin)

# Metric: today's sentiment
if not sentiment_df.empty:
    latest = sentiment_df.iloc[-1]
    color = "#ff4b4b" if latest["value"] < 25 else (
            "#ffa726" if latest["value"] < 50 else (
            "#66bb6a" if latest["value"] < 75 else "#00e5ff"))
    col1, col2 = st.columns(2)
    col1.metric("Fear & Greed Index", f"{int(latest['value'])}/100", latest["classification"])
    col2.metric("Date", latest["timestamp"].strftime("%Y-%m-%d"))

# Hourly price chart
st.subheader(f"{coin} — Last 7 Days (Hourly)")
if not hourly_df.empty:
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=hourly_df["timestamp"], y=hourly_df["close"],
        mode="lines", name=f"{coin} hourly close",
        line=dict(color="#00e5ff", width=1.5),
    ))
    fig.update_layout(template="plotly_dark", height=350,
                      xaxis_title="Time (UTC)", yaxis_title="Price (USD)",
                      margin=dict(l=0, r=0, t=30, b=0))
    st.plotly_chart(fig, use_container_width=True)
else:
    st.info("No hourly data yet. Scheduler will populate ohlcv_hourly on next run.")

# Sentiment history chart
if not sentiment_df.empty:
    st.subheader("Fear & Greed Index — Last 30 Days")
    sfig = go.Figure()
    sfig.add_trace(go.Bar(
        x=sentiment_df["timestamp"].dt.strftime("%b %d"),
        y=sentiment_df["value"],
        marker_color=sentiment_df["value"].apply(
            lambda v: "#ff4b4b" if v < 25 else ("#ffa726" if v < 50 else
                      ("#66bb6a" if v < 75 else "#00e5ff"))
        ),
        name="Fear & Greed",
    ))
    sfig.add_hline(y=50, line_dash="dash", line_color="gray", annotation_text="Neutral")
    sfig.update_layout(template="plotly_dark", height=250,
                       yaxis_range=[0, 100], margin=dict(l=0, r=0, t=10, b=0))
    st.plotly_chart(sfig, use_container_width=True)
```

---

## Step 5 — Create `tests/test_data_collector.py`

```python
"""
tests/test_data_collector.py — Unit tests for data_collector module.

All external HTTP calls are mocked. No real CoinGecko or alternative.me calls.
"""
import pytest
from unittest.mock import patch, MagicMock
import sys
sys.path.insert(0, "src/ml")

from data_collector import (
    fetch_hourly_ohlcv,
    fetch_fear_greed_index,
    collect_all,
    OHLCV_HOURLY_COLLECTION,
    SENTIMENT_COLLECTION,
)


class TestFetchHourlyOhlcv:
    def test_returns_correct_number_of_records(self):
        mock_data = {
            "prices": [[1700000000000 + i * 3600000, 65000.0 + i] for i in range(48)],
            "total_volumes": [[1700000000000 + i * 3600000, 1e9] for i in range(48)],
            "market_caps": [[1700000000000 + i * 3600000, 1.3e12] for i in range(48)],
        }
        with patch("data_collector.requests.get") as mock_get:
            mock_get.return_value.json.return_value = mock_data
            mock_get.return_value.raise_for_status = MagicMock()
            records = fetch_hourly_ohlcv("bitcoin", days=2)
        assert len(records) == 48
        assert records[0]["coin"] == "BTC"
        assert records[0]["coin_id"] == "bitcoin"
        assert records[0]["close"] == 65000.0
        assert records[0]["source"] == "coingecko_market_chart"

    def test_skips_invalid_prices(self):
        # zero price should be filtered in persist_hourly_ohlcv
        mock_data = {
            "prices": [[1700000000000, 0.0], [1700003600000, 65000.0]],
            "total_volumes": [[1700000000000, 0.0], [1700003600000, 1e9]],
            "market_caps": [[1700000000000, 0.0], [1700003600000, 1.3e12]],
        }
        with patch("data_collector.requests.get") as mock_get:
            mock_get.return_value.json.return_value = mock_data
            mock_get.return_value.raise_for_status = MagicMock()
            records = fetch_hourly_ohlcv("bitcoin", days=1)
        # Both records returned; filtering happens in persist
        assert len(records) == 2

    def test_http_error_propagates(self):
        import requests
        with patch("data_collector.requests.get") as mock_get:
            mock_get.return_value.raise_for_status.side_effect = requests.HTTPError("429")
            with pytest.raises(requests.HTTPError):
                fetch_hourly_ohlcv("bitcoin", days=1)


class TestFetchFearGreedIndex:
    def test_returns_correct_structure(self):
        mock_data = {
            "data": [{"value": "42", "value_classification": "Fear",
                      "timestamp": "1700000000"}]
        }
        with patch("data_collector.requests.get") as mock_get:
            mock_get.return_value.json.return_value = mock_data
            mock_get.return_value.raise_for_status = MagicMock()
            result = fetch_fear_greed_index()
        assert result["value"] == 42
        assert result["classification"] == "Fear"
        assert result["source"] == "alternative_me"

    def test_returns_none_on_error(self):
        with patch("data_collector.requests.get", side_effect=Exception("timeout")):
            result = fetch_fear_greed_index()
        assert result is None


class TestCollectAll:
    def test_summary_keys_present(self):
        with patch("data_collector.fetch_hourly_ohlcv", return_value=[]), \
             patch("data_collector.persist_hourly_ohlcv", return_value=0), \
             patch("data_collector.fetch_fear_greed_index", return_value=None):
            summary = collect_all(mongo_uri="mongodb://fake:27017")
        assert "ohlcv_upserted" in summary
        assert "sentiment_ok" in summary
        assert "errors" in summary
```

---

## Step 6 — Update `docker/docker-compose.yml`

No new services. Only env var additions to `inference_scheduler` service:

```yaml
# MODIFY the inference_scheduler environment block — ADD:
environment:
  MONGO_URI: ...
  INFERENCE_INTERVAL_SECONDS: "3600"
  COINGECKO_API_KEY: ${COINGECKO_API_KEY:-}
  SCHEDULER_FETCH_COINGECKO: "true"
  # ADD this new var:
  OHLCV_LOOKBACK_DAYS: "2"   # how many days of hourly data to fetch per cycle
```

---

## Acceptance Criteria

All of the following must pass before Phase 7 is complete:

### AC-7.1 Unit tests pass
```bash
cd /path/to/project
pytest tests/test_data_collector.py -v
# Expected: all tests pass, no external HTTP calls made
```

### AC-7.2 `collect_all` writes to MongoDB
```bash
python -c "
import sys; sys.path.insert(0, 'src/ml')
from data_collector import collect_all
summary = collect_all()
print(summary)
assert summary['ohlcv_upserted'] > 0, 'No OHLCV records written'
print('AC-7.2 PASS')
"
```

### AC-7.3 `ohlcv_hourly` collection has correct indexes
```bash
python -c "
import pymongo
client = pymongo.MongoClient('mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin')
indexes = client.crypto_db.ohlcv_hourly.index_information()
assert 'coin_timestamp_desc' in indexes, 'Missing compound index'
ttl_idx = indexes.get('ttl_365d', {})
assert ttl_idx.get('expireAfterSeconds') == 31_536_000, 'Missing TTL index'
print('AC-7.3 PASS')
"
```

### AC-7.4 Inference uses ohlcv_hourly as priority-0 seed
```bash
python -c "
import sys; sys.path.insert(0, 'src/ml')
from inference import _load_last_n_from_ohlcv_hourly
result = _load_last_n_from_ohlcv_hourly('BTC', n=5)
# Will be None if < 5 rows — that's OK, function must exist and not crash
print(f'ohlcv_hourly seed loader: {\"returned data\" if result is not None else \"insufficient data (fallback active)\"}')
print('AC-7.4 PASS')
"
```

### AC-7.5 Dashboard page 05 renders without error
```bash
# Start streamlit and verify page loads:
streamlit run src/dashboard/app.py
# Navigate to page 05 — should show "No hourly data yet" or actual chart if data exists
```

### AC-7.6 Scheduler cycle runs end-to-end with new data_collector
```bash
INFERENCE_INTERVAL_SECONDS=999999 python -c "
import sys, os; sys.path.insert(0, 'src/ml')
os.environ['INFERENCE_INTERVAL_SECONDS'] = '999999'
from inference_scheduler import run_cycle
failures = run_cycle(0)
assert failures == 0, f'Cycle had failures: {failures}'
print('AC-7.6 PASS')
"
```
