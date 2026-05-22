# Agent Execution Plan — CoinGecko SDK Integration (BTC + DOGE)

**Date:** 2026-05-17  
**Scope:** Refactor the full pipeline to use the official CoinGecko Python SDK with a demo API key, targeting Bitcoin (BTC) and Dogecoin (DOGE) only.  
**Trigger:** `/agent-data-ml-model` — execute this plan

---

## Context

| Item | Current state | Target state |
|------|--------------|--------------|
| Library | `requests` (raw HTTP) | `pycoingecko` SDK with demo key |
| Coins | 7 coins (BTC/ETH/BNB/SOL/XRP/ADA/DOGE) | **2 coins: BTC + DOGE** |
| Endpoint | `/simple/price` | `/simple/price` + `/coins/{id}/ohlc` + `/coins/{id}/market_chart` |
| Poll interval | 60 s (~43,200 calls/month) | **600 s / 10 min** (~2,880 calls/month — within demo 10k/month) |
| API key | Not used (no-key free tier) | Demo key via `COINGECKO_API_KEY` env var |
| OHLCV | Not collected | Collected via `/ohlc` (4h candles, 30d window) |

---

## Prerequisites

The agent must NOT ask questions. Execute all steps sequentially and fix any failures before moving on.

---

## Step 1 — Update `.env.example`

**File:** `.env.example`

Add/update these lines:
```
# CoinGecko demo API key (required)
COINGECKO_API_KEY=your_demo_api_key_here

# Poll interval in seconds — demo tier: use 600 (10 min) to stay < 10k calls/month
POLL_INTERVAL_SECONDS=600

# Coins to track (comma-separated CoinGecko IDs)
COINGECKO_COIN_IDS=bitcoin,dogecoin
```

Remove or comment out any reference to 7-coin list in the env example.

---

## Step 2 — Rewrite `src/producer/crypto_producer.py`

**Full rewrite.** Replace raw `requests` with `pycoingecko` SDK.

### Requirements:
- Install: `pycoingecko` (add to `src/producer/requirements.txt`)
- Import: `from pycoingecko import CoinGeckoAPI`
- Auth: `CoinGeckoAPI(demo_api_key=COINGECKO_API_KEY)` — key injected only when env var is set; if empty, use `CoinGeckoAPI()` (no-key mode)
- Coins: `COINS = ["bitcoin", "dogecoin"]`
- Symbol map: `{"bitcoin": "BTC", "dogecoin": "DOGE"}`
- Poll interval: `POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "600"))`

### Two fetch functions to implement:

#### `fetch_prices() -> dict`
```python
# Uses: cg.get_price(ids=",".join(COINS), vs_currencies="usd",
#                    include_market_cap="true", include_24hr_vol="true",
#                    include_24hr_change="true", precision="2")
# Returns: {"bitcoin": {"usd": ..., "usd_market_cap": ..., ...}, ...}
```

#### `fetch_ohlc(coin_id: str, days: int = 30) -> list`
```python
# Uses: cg.get_coin_ohlc_by_id(id=coin_id, vs_currency="usd", days=days)
# Returns: [[timestamp_ms, open, high, low, close], ...]
# Called once per poll cycle per coin (2 calls per cycle total)
```

### Message schema (Kafka) — extend existing schema:
```python
{
    "coin":        "BTC",           # symbol
    "coin_id":     "bitcoin",       # CoinGecko id
    "price_usd":   77473.37,
    "volume_24h":  32816206284.10,
    "market_cap":  1548812855182.45,
    "change_24h":  -1.24,
    "timestamp":   "2026-05-17T10:00:00+00:00",
    "source":      "coingecko",
    # NEW fields from OHLC:
    "open":        77200.0,         # most recent 4h candle open
    "high":        78419.0,         # most recent 4h candle high
    "low":         76696.0,         # most recent 4h candle low
    "close":       77473.37,        # most recent 4h candle close (= price_usd)
}
```

### Rate limiting logic:
- Call `fetch_prices()` every poll cycle
- Call `fetch_ohlc()` every poll cycle per coin (2 extra calls)
- Total calls per cycle: 1 (prices) + 2 (ohlc × 2 coins) = **3 calls per 600s**
- Monthly: 3 × 6 × 24 × 30 = **12,960** — just over limit; set `OHLC_POLL_MULTIPLIER=3` (fetch OHLC every 3rd cycle = every 30 min)
- Final: 1 + (2/3) = ~1.67 calls/cycle → ~7,200/month — **within 10k demo limit**

### Error handling:
- Catch `requests.exceptions.HTTPError` for 429 → sleep 60s extra
- Catch `Exception` broadly, log, continue loop
- Keep existing `_on_send_error` callback for Kafka delivery failures

### KafkaProducer settings — add missing `linger_ms=100`:
```python
KafkaProducer(
    ...,
    acks="all",
    retries=3,
    max_in_flight_requests_per_connection=1,
    linger_ms=100,   # was missing — add this
    request_timeout_ms=30_000,
    retry_backoff_ms=500,
)
```

---

## Step 3 — Update `src/spark/streaming_job.py` schema

**File:** `src/spark/streaming_job.py`

The Kafka message now has 4 extra OHLC fields. Update `CRYPTO_SCHEMA` to include:
```python
StructField("open",  DoubleType(), True),
StructField("high",  DoubleType(), True),
StructField("low",   DoubleType(), True),
StructField("close", DoubleType(), True),
```

Also update `_enrich_and_write()`:
- If `open`/`high`/`low`/`close` fields are present in the batch, use real OHLC instead of simulated
- Keep `simulate_ohlc` as fallback when fields are null

Update `ASSET_MAP` / coin filter to only process BTC and DOGE (remove BNB, SOL, XRP, ADA, ETH if they are no longer produced — but keep the filter soft so old messages still pass through).

---

## Step 4 — Update `src/spark/batch_job.py`

**File:** `src/spark/batch_job.py`

Update `SAMPLE_COIN_MAP` to only BTC and DOGE:
```python
SAMPLE_COIN_MAP = {
    "bitcoin":  "BTC",
    "dogecoin": "DOGE",
}
```

The batch job already handles BTC and DOGE via sample CSVs (`data/sample/bitcoin.csv`, `data/sample/dogecoin.csv`). This change just removes ETH (and any others) from scope.

Correlation matrix will now be 1×1 (only 1 pair: BTC–DOGE). Update `compute_coin_correlation()` accordingly — it already uses `combinations()` so it will work with 2 coins automatically (produces 1 pair).

---

## Step 5 — Update `src/dashboard/app.py`

**File:** `src/dashboard/app.py`

```python
AVAILABLE_COINS = ["BTC", "DOGE"]  # was ["BTC", "ETH", "DOGE"]
```

Update sidebar default coin to `"BTC"`.

Update MongoDB URI to prefer `st.secrets`:
```python
import streamlit as st
_uri = st.secrets.get("MONGO_URI", os.environ.get("MONGO_URI", _DEFAULT_URI))
```

---

## Step 6 — Update `src/dashboard/pages/` (all 4 pages)

For all pages, replace any reference to `["BTC", "ETH", "DOGE"]` with `["BTC", "DOGE"]`.

**`01_realtime.py`:** No logic change needed — coin selector already driven by session_state.

**`02_technical.py`:** No logic change needed.

**`03_prediction.py`:** Update coin dropdown to `["BTC", "DOGE"]`.

**`04_correlation.py`:** Correlation matrix is now 2×2 (BTC–DOGE pair). Update the caption text.

---

## Step 7 — Update `src/ml/` for BTC + DOGE

**Files:** `src/ml/preprocess.py`, `src/ml/train_lstm.py`, `src/ml/inference.py`

### `preprocess.py`:
- Add `COIN = os.getenv("LSTM_COIN", "bitcoin")` config
- Support loading either `data/sample/bitcoin.csv` or `data/sample/dogecoin.csv`
- Fix split ratio: `TRAIN_RATIO = 0.80`, `VAL_RATIO = 0.10` (was 0.70/0.15)

### `train_lstm.py`:
- Add `--coin` CLI argument (default: `bitcoin`)
- Save weights to `src/ml/model/lstm_{COIN}_v1.pt` (e.g. `lstm_bitcoin_v1.pt`, `lstm_dogecoin_v1.pt`)
- Fix `BATCH_SIZE = 64` (was 32)

### `inference.py`:
- Accept `--coin` argument (default: `bitcoin`)
- Load the correct model file based on coin
- Write predictions with correct coin symbol (`"BTC"` or `"DOGE"`)

### `scripts/run_inference.sh`:
```bash
#!/bin/bash
cd "$(dirname "$0")/.."
echo "Training BTC model..."
python src/ml/train_lstm.py --coin bitcoin
echo "Running BTC inference..."
python src/ml/inference.py --coin bitcoin

echo "Training DOGE model..."
python src/ml/train_lstm.py --coin dogecoin
echo "Running DOGE inference..."
python src/ml/inference.py --coin dogecoin
```

---

## Step 8 — Update `src/producer/requirements.txt`

Add `pycoingecko>=3.1.0` to producer requirements.

Also update `docker/docker-compose.yml` producer service if it installs from requirements.txt (verify the Dockerfile installs it).

---

## Step 9 — Update tests

### `tests/test_producer.py`:
- Update coin list assertions: expect only `["BTC", "DOGE"]` (remove BNB, SOL, XRP, ADA, ETH)
- Update `COIN_SYMBOL_MAP` size assertion: expect 2 entries (was 7)
- Add test: `test_ohlc_fields_in_record` — verify message schema has `open`, `high`, `low`, `close` keys
- Add test: `test_poll_interval_default_600s` — verify default is 600 not 60
- Mock `CoinGeckoAPI` instead of `requests.get`

### `tests/test_lstm.py`:
- Add test: `test_btc_and_doge_preprocess` — verify both CSVs load and produce valid sequences
- Update model filename assertions: `lstm_bitcoin_v1.pt` / `lstm_dogecoin_v1.pt`

### Do NOT break any existing passing tests. Run full suite after each file change.

---

## Step 10 — Write README.md

**File:** `README.md` (project root)

Must include:
1. Project title and description (Lambda Architecture for Crypto)
2. Architecture diagram (copy from `docs/final_report.md`)
3. Prerequisites: Docker, Python 3.11, CoinGecko demo API key
4. Quick start (5 commands to get running)
5. Environment variables table (especially `COINGECKO_API_KEY`, `POLL_INTERVAL_SECONDS`)
6. Service ports (Kafka UI: 8080, MongoDB: 27017, Dashboard: 8501)
7. How to run LSTM training for BTC and DOGE
8. Test command

---

## Execution Order

Run tasks in this exact order. After each step, run the affected tests before moving to the next.

```
Step 1  → .env.example
Step 2  → crypto_producer.py  → run: python -m pytest tests/test_producer.py -v
Step 3  → streaming_job.py    → run: python -m py_compile src/spark/streaming_job.py
Step 4  → batch_job.py        → run: python -m pytest tests/test_batch_job.py -v
Step 5  → dashboard/app.py    → run: python -m pytest tests/test_dashboard.py -v
Step 6  → dashboard pages     → run: python -m pytest tests/test_dashboard.py -v
Step 7  → src/ml/ files       → run: python -m pytest tests/test_lstm.py -v
Step 8  → requirements.txt    → verify: grep pycoingecko src/producer/requirements.txt
Step 9  → test files          → run: python -m pytest tests/ -v (all must pass)
Step 10 → README.md           → verify: ls README.md && wc -l README.md
```

**Final verification:**
```bash
python -m pytest tests/ -v --tb=short 2>&1 | tail -5
docker compose -f docker/docker-compose.yml config --quiet && echo "Compose: OK"
python src/ml/train_lstm.py --dry-run --coin bitcoin 2>&1 | tail -5
python src/ml/train_lstm.py --dry-run --coin dogecoin 2>&1 | tail -5
```

---

## Acceptance Criteria

| Criteria | How to verify |
|----------|--------------|
| All tests pass (≥130) | `pytest tests/ -v` → 0 failures |
| Only BTC + DOGE tracked | `grep COINS src/producer/crypto_producer.py` → 2 entries |
| SDK used (not raw requests) | `grep pycoingecko src/producer/crypto_producer.py` → found |
| `linger_ms=100` present | `grep linger_ms src/producer/crypto_producer.py` → found |
| Poll interval default 600s | `grep POLL_INTERVAL src/producer/crypto_producer.py` → "600" |
| OHLC fields in message schema | `grep '"open"' src/producer/crypto_producer.py` → found |
| Spark schema updated | `grep StructField.*open src/spark/streaming_job.py` → found |
| Split ratio 80/10/10 | `grep TRAIN_RATIO src/ml/preprocess.py` → 0.80 |
| Batch size 64 | `grep BATCH_SIZE src/ml/train_lstm.py` → 64 |
| Model filenames versioned | `grep lstm_bitcoin_v1 src/ml/train_lstm.py` → found |
| README exists | `ls README.md` → found, > 50 lines |
| Docker compose valid | `docker compose config --quiet` → exit 0 |
