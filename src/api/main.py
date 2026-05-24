"""
main.py — FastAPI backend for Crypto Big Data dashboard.

Endpoints:
    GET /api/health
    GET /api/realtime/{coin}
    GET /api/historical/{coin}?days=90
    GET /api/predictions/{coin}
    GET /api/technical/{coin}?days=180
    GET /api/correlation
    GET /api/stats
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pymongo
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

# ── MongoDB connection ──────────────────────────────────────────────────────────
_DEFAULT_URI = "mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin"
MONGO_URI = os.environ.get("MONGO_URI", _DEFAULT_URI)

client = pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
db = client["crypto_db"]

# ── App ─────────────────────────────────────────────────────────────────────────
app = FastAPI(title="Crypto Big Data API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Coin mapping ────────────────────────────────────────────────────────────────
COIN_SYMBOL_MAP = {
    "bitcoin": "BTC",
    "btc": "BTC",
    "dogecoin": "DOGE",
    "doge": "DOGE",
}


def _resolve_symbol(coin: str) -> str:
    symbol = COIN_SYMBOL_MAP.get(coin.lower())
    if not symbol:
        raise HTTPException(status_code=400, detail=f"Unknown coin: {coin}. Use bitcoin or dogecoin.")
    return symbol


def _serialize(doc: dict) -> dict:
    """Convert MongoDB doc to JSON-serializable dict."""
    out = {}
    for k, v in doc.items():
        if k == "_id":
            continue
        if isinstance(v, datetime):
            out[k] = v.isoformat()
        elif isinstance(v, (np.floating, np.integer)):
            out[k] = float(v)
        else:
            out[k] = v
    return out


# ── RSI computation ─────────────────────────────────────────────────────────────

def compute_rsi(prices: list[float], period: int = 14) -> list[float | None]:
    """Compute RSI(period) for a list of prices. Returns None for initial points."""
    rsi_values: list[float | None] = [None] * min(period, len(prices))
    if len(prices) <= period:
        return rsi_values

    deltas = [prices[i] - prices[i - 1] for i in range(1, len(prices))]
    gains = [d if d > 0 else 0.0 for d in deltas]
    losses = [-d if d < 0 else 0.0 for d in deltas]

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    def _rsi_val(avg_g: float, avg_l: float) -> float:
        if avg_l == 0:
            return 100.0
        rs = avg_g / avg_l
        return 100 - (100 / (1 + rs))

    rsi_values.append(_rsi_val(avg_gain, avg_loss))

    for i in range(period, len(deltas)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        rsi_values.append(_rsi_val(avg_gain, avg_loss))

    return rsi_values


# ── Endpoints ───────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health() -> dict:
    try:
        client.admin.command("ping")
        return {"status": "ok", "mongo": "connected", "timestamp": datetime.now(timezone.utc).isoformat()}
    except Exception as e:
        return {"status": "degraded", "mongo": str(e), "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/api/realtime/{coin}")
def get_realtime(coin: str) -> dict:
    symbol = _resolve_symbol(coin)

    # Try realtime_prices first
    doc = db.realtime_prices.find_one(
        {"symbol": symbol},
        sort=[("timestamp", -1)],
    )
    if doc:
        result = _serialize(doc)
        result["source"] = "realtime"
        return result

    # Fallback to daily_stats
    doc = db.daily_stats.find_one(
        {"symbol": symbol},
        sort=[("date", -1)],
    )
    if doc:
        result = _serialize(doc)
        result["source"] = "batch_fallback"
        result["price"] = doc.get("avg_close")
        return result

    raise HTTPException(status_code=404, detail=f"No data found for {symbol}")


@app.get("/api/historical/{coin}")
def get_historical(coin: str, days: int = Query(default=90, ge=1, le=3650)) -> list[dict]:
    symbol = _resolve_symbol(coin)

    cursor = db.historical_sma.find(
        {"symbol": symbol},
        sort=[("date", -1)],
        limit=days,
        projection={"_id": 0},
    )
    docs = list(cursor)
    if not docs:
        raise HTTPException(status_code=404, detail=f"No historical data for {symbol}")

    # Return in chronological order
    docs.reverse()
    return [_serialize(d) for d in docs]


@app.get("/api/predictions/{coin}")
def get_predictions(coin: str) -> dict:
    symbol = _resolve_symbol(coin)

    cursor = db.predictions.find(
        {"coin": symbol},
        sort=[("prediction_date", 1)],
        projection={"_id": 0},
    )
    docs = list(cursor)
    if not docs:
        raise HTTPException(status_code=404, detail=f"No predictions found for {symbol}. Run inference first.")

    # Find latest model_version
    model_version = docs[-1].get("model_version", "lstm_v1") if docs else "lstm_v1"
    prices = [d["predicted_price"] for d in docs]

    serialized = []
    for d in docs:
        row = _serialize(d)
        # Include v2 multi-task fields when present; omit when missing (v1 docs)
        for field in ("direction", "direction_prob", "trend_strength"):
            if field in d:
                row[field] = d[field]
        serialized.append(row)

    return {
        "coin": symbol,
        "model_version": model_version,
        "predictions": serialized,
        "next_day_price": prices[0] if prices else None,
        "seven_day_high": max(prices) if prices else None,
        "seven_day_low": min(prices) if prices else None,
    }


@app.get("/api/technical/{coin}")
def get_technical(coin: str, days: int = Query(default=180, ge=1, le=3650)) -> list[dict]:
    symbol = _resolve_symbol(coin)

    cursor = db.historical_sma.find(
        {"symbol": symbol},
        sort=[("date", -1)],
        limit=days,
        projection={"_id": 0},
    )
    docs = list(cursor)
    if not docs:
        raise HTTPException(status_code=404, detail=f"No technical data for {symbol}")

    docs.reverse()  # chronological order

    prices = [d.get("avg_close", 0.0) for d in docs]
    rsi_values = compute_rsi(prices)

    results = []
    prev_close = None
    for i, d in enumerate(docs):
        close = d.get("avg_close", 0.0)
        # Simulate OHLC
        open_price = prev_close if prev_close is not None else close
        high_price = close * 1.005
        low_price = close * 0.995

        row = _serialize(d)
        row["open"] = open_price
        row["high"] = high_price
        row["low"] = low_price
        row["close"] = close
        row["rsi"] = rsi_values[i]
        results.append(row)
        prev_close = close

    return results


@app.get("/api/correlation")
def get_correlation() -> dict:
    docs = list(db.coin_correlation.find({}, {"_id": 0}))
    if not docs:
        raise HTTPException(status_code=404, detail="No correlation data found")

    # Build matrix structure
    coins = set()
    for d in docs:
        coins.add(d.get("coin_a", ""))
        coins.add(d.get("coin_b", ""))
    coins.discard("")
    coin_list = sorted(coins)

    # Build 2D matrix
    matrix: dict[str, dict[str, float]] = {}
    for c in coin_list:
        matrix[c] = {c2: 1.0 if c == c2 else 0.0 for c2 in coin_list}

    for d in docs:
        a = d.get("coin_a", "")
        b = d.get("coin_b", "")
        corr = d.get("pearson_corr", 0.0)
        if a and b:
            matrix[a][b] = corr
            matrix[b][a] = corr

    return {
        "coins": coin_list,
        "matrix": matrix,
        "docs": [_serialize(d) for d in docs],
    }


@app.get("/api/stats")
def get_stats() -> dict:
    stats: dict[str, Any] = {}

    # Collection counts
    stats["doc_counts"] = {
        "daily_stats": db.daily_stats.count_documents({}),
        "historical_sma": db.historical_sma.count_documents({}),
        "coin_correlation": db.coin_correlation.count_documents({}),
        "predictions": db.predictions.count_documents({}),
        "realtime_prices": db.realtime_prices.count_documents({}),
    }

    # Latest prices
    latest_prices = {}
    for coin_id, symbol in [("bitcoin", "BTC"), ("dogecoin", "DOGE")]:
        doc = db.daily_stats.find_one(
            {"symbol": symbol},
            sort=[("date", -1)],
            projection={"_id": 0, "avg_close": 1, "date": 1},
        )
        if doc:
            latest_prices[symbol] = {
                "price": doc.get("avg_close"),
                "date": doc["date"].isoformat() if isinstance(doc.get("date"), datetime) else str(doc.get("date")),
            }

    stats["latest_prices"] = latest_prices
    stats["timestamp"] = datetime.now(timezone.utc).isoformat()
    return stats
