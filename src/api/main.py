"""
main.py — FastAPI backend for Crypto Big Data dashboard.

Endpoints (public):
    POST /api/auth/login
    GET  /api/health
    GET  /api/stats

Endpoints (protected — require Bearer JWT):
    GET /api/auth/me
    GET /api/realtime/{coin}
    GET /api/historical/{coin}?days=90
    GET /api/predictions/{coin}
    GET /api/predictions/{coin}/history?days=30
    GET /api/technical/{coin}?days=180
    GET /api/correlation
    GET /api/inference/status
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
import pymongo
from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

# ── Config ──────────────────────────────────────────────────────────────────────
_DEFAULT_URI = "mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin"
MONGO_URI = os.environ.get("MONGO_URI", _DEFAULT_URI)
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "password123")
JWT_SECRET = os.environ.get("JWT_SECRET_KEY", "crypto_quantum_terminal_secret_2026")
JWT_EXPIRE_HOURS = int(os.environ.get("JWT_EXPIRE_HOURS", "8"))

# ── MongoDB ──────────────────────────────────────────────────────────────────────
mongo_client = pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
db = mongo_client["crypto_db"]

# ── Bootstrap admin user ─────────────────────────────────────────────────────────
def _bootstrap_admin() -> None:
    pwd_hash = hashlib.sha256(ADMIN_PASSWORD.encode()).hexdigest()
    db.users.update_one(
        {"username": ADMIN_USERNAME},
        {
            "$setOnInsert": {
                "username": ADMIN_USERNAME,
                "password_hash": pwd_hash,
                "role": "admin",
                "created_at": datetime.now(timezone.utc),
            }
        },
        upsert=True,
    )

try:
    _bootstrap_admin()
except Exception:
    pass  # non-fatal at startup

# ── App ──────────────────────────────────────────────────────────────────────────
app = FastAPI(title="Crypto Big Data API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── JWT ───────────────────────────────────────────────────────────────────────────
def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64d(s: str) -> bytes:
    s += "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s)


def create_token(payload: dict) -> str:
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = {
        **payload,
        "exp": (datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS)).timestamp(),
    }
    body = _b64(json.dumps(payload).encode())
    msg = f"{header}.{body}"
    sig = _b64(hmac.new(JWT_SECRET.encode(), msg.encode(), hashlib.sha256).digest())
    return f"{msg}.{sig}"


def verify_token(token: str) -> dict:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            raise ValueError("Malformed token")
        header, body, sig = parts
        msg = f"{header}.{body}"
        expected = _b64(hmac.new(JWT_SECRET.encode(), msg.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            raise ValueError("Invalid signature")
        payload = json.loads(_b64d(body))
        if payload.get("exp", 0) < datetime.now(timezone.utc).timestamp():
            raise ValueError("Token expired")
        return payload
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"Token error: {e}") from e


# ── Auth dependency ───────────────────────────────────────────────────────────────
_bearer = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    try:
        payload = verify_token(credentials.credentials)
        return {"username": payload.get("sub"), "role": payload.get("role", "admin")}
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


# ── Coin mapping ──────────────────────────────────────────────────────────────────
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
    out: dict = {}
    for k, v in doc.items():
        if k == "_id":
            continue
        if isinstance(v, datetime):
            out[k] = v.isoformat()
        elif isinstance(v, (np.floating, np.integer)):
            out[k] = float(v)
        elif isinstance(v, list):
            out[k] = [_serialize(i) if isinstance(i, dict) else i for i in v]
        else:
            out[k] = v
    return out


# ── RSI ───────────────────────────────────────────────────────────────────────────
def compute_bb(prices: list[float], window: int = 20, mult: float = 2.0):
    """Returns (upper, middle, lower) aligned with prices. None for first window-1 entries."""
    upper: list = [None] * len(prices)
    middle: list = [None] * len(prices)
    lower: list = [None] * len(prices)
    for i in range(window - 1, len(prices)):
        w = prices[i - window + 1 : i + 1]
        mean = sum(w) / window
        std = (sum((v - mean) ** 2 for v in w) / window) ** 0.5
        upper[i] = mean + mult * std
        middle[i] = mean
        lower[i] = mean - mult * std
    return upper, middle, lower


def compute_ema(prices: list[float], period: int) -> list[float | None]:
    if len(prices) < period:
        return [None] * len(prices)
    k = 2.0 / (period + 1)
    result: list[float | None] = [None] * (period - 1)
    seed = sum(prices[:period]) / period
    result.append(seed)
    for p in prices[period:]:
        result.append(p * k + result[-1] * (1 - k))  # type: ignore[operator]
    return result


def compute_macd(prices: list[float], fast: int = 12, slow: int = 26, signal: int = 9):
    """Returns (macd_line, signal_line, histogram), all aligned with prices."""
    ema_fast = compute_ema(prices, fast)
    ema_slow = compute_ema(prices, slow)
    macd_line: list[float | None] = [
        (f - s) if f is not None and s is not None else None
        for f, s in zip(ema_fast, ema_slow)
    ]
    # EMA of MACD values (skip None prefix)
    start = next((i for i, v in enumerate(macd_line) if v is not None), None)
    sig_line: list[float | None] = [None] * len(macd_line)
    if start is not None:
        valid = [v for v in macd_line[start:] if v is not None]
        sig_vals = compute_ema(valid, signal)
        sig_offset = len(macd_line) - len(valid)
        for j, v in enumerate(sig_vals):
            sig_line[sig_offset + j] = v
    histogram: list[float | None] = [
        (m - s) if m is not None and s is not None else None
        for m, s in zip(macd_line, sig_line)
    ]
    return macd_line, sig_line, histogram


def compute_rsi(prices: list[float], period: int = 14) -> list[float | None]:
    rsi_values: list[float | None] = [None] * min(period, len(prices))
    if len(prices) <= period:
        return rsi_values
    deltas = [prices[i] - prices[i - 1] for i in range(1, len(prices))]
    gains = [d if d > 0 else 0.0 for d in deltas]
    losses = [-d if d < 0 else 0.0 for d in deltas]
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    def _rsi_val(g: float, l: float) -> float:
        if l == 0:
            return 100.0
        return 100 - (100 / (1 + g / l))

    rsi_values.append(_rsi_val(avg_gain, avg_loss))
    for i in range(period, len(deltas)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        rsi_values.append(_rsi_val(avg_gain, avg_loss))
    return rsi_values


# ── Auth Endpoints ────────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    username: str
    password: str


@app.post("/api/auth/login")
def login(req: LoginRequest) -> dict:
    user = db.users.find_one({"username": req.username})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    pwd_hash = hashlib.sha256(req.password.encode()).hexdigest()
    if not hmac.compare_digest(pwd_hash, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token({"sub": user["username"], "role": user.get("role", "admin")})
    return {
        "access_token": token,
        "token_type": "bearer",
        "username": user["username"],
        "expires_in": JWT_EXPIRE_HOURS * 3600,
    }


@app.get("/api/auth/me")
def get_me(user: dict = Depends(get_current_user)) -> dict:
    return user


# ── Public Endpoints ──────────────────────────────────────────────────────────────
@app.get("/api/health")
def health() -> dict:
    try:
        mongo_client.admin.command("ping")
        return {"status": "ok", "mongo": "connected", "timestamp": datetime.now(timezone.utc).isoformat()}
    except Exception as e:
        return {"status": "degraded", "mongo": str(e), "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/api/stats")
def get_stats() -> dict:
    stats: dict[str, Any] = {}
    stats["doc_counts"] = {
        "daily_stats": db.daily_stats.count_documents({}),
        "historical_sma": db.historical_sma.count_documents({}),
        "coin_correlation": db.coin_correlation.count_documents({}),
        "predictions": db.predictions.count_documents({}),
        "realtime_prices": db.realtime_prices.count_documents({}),
    }
    latest_prices: dict = {}
    for _, symbol in [("bitcoin", "BTC"), ("dogecoin", "DOGE")]:
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


# ── Protected Endpoints ───────────────────────────────────────────────────────────
@app.get("/api/realtime/{coin}")
def get_realtime(coin: str, _user: dict = Depends(get_current_user)) -> dict:
    symbol = _resolve_symbol(coin)
    doc = db.realtime_prices.find_one({"symbol": symbol}, sort=[("event_time", -1)])
    if doc:
        result = _serialize(doc)
        result["source"] = "realtime"
        return result
    doc = db.daily_stats.find_one({"symbol": symbol}, sort=[("date", -1)])
    if doc:
        result = _serialize(doc)
        result["source"] = "batch_fallback"
        result["price"] = doc.get("avg_close")
        return result
    raise HTTPException(status_code=404, detail=f"No data found for {symbol}")


@app.get("/api/historical/{coin}")
def get_historical(
    coin: str,
    days: int = Query(default=90, ge=1, le=3650),
    _user: dict = Depends(get_current_user),
) -> list[dict]:
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
    docs.reverse()
    return [_serialize(d) for d in docs]


@app.get("/api/predictions/{coin}")
def get_predictions(coin: str, _user: dict = Depends(get_current_user)) -> dict:
    symbol = _resolve_symbol(coin)
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    cursor = db.predictions.find(
        {"coin": symbol, "prediction_date": {"$gte": today}},
        sort=[("prediction_date", 1)],
        projection={"_id": 0},
    )
    docs = list(cursor)
    if not docs:
        raise HTTPException(status_code=404, detail=f"No predictions for {symbol}. Run inference first.")
    model_version = docs[-1].get("model_version", "lstm_v1") if docs else "lstm_v1"
    prices = [d["predicted_price"] for d in docs]
    serialized = []
    for d in docs:
        row = _serialize(d)
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


@app.get("/api/predictions/{coin}/history")
def get_prediction_history(
    coin: str,
    days: int = Query(default=60, ge=1, le=365),
    _user: dict = Depends(get_current_user),
) -> list[dict]:
    """
    Return prediction_runs history joined with actual prices for accuracy review.

    Each record represents what the model predicted for a given date on the day
    the prediction was made (run_date), plus the actual closing price if that
    date has since passed (from historical_sma).

    Falls back to the predictions collection if prediction_runs is empty
    (useful right after first deploy before runs accumulate).
    """
    symbol = _resolve_symbol(coin)
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    since = today - timedelta(days=days)

    # ── Read from prediction_runs (append-only log) ──────────────────────────
    runs = list(db.prediction_runs.find(
        {"coin": symbol, "run_date": {"$gte": since}},
        sort=[("prediction_date", 1), ("run_date", 1)],
        limit=days * 14,
        projection={"_id": 0},
    ))

    # ── Fallback: use predictions collection if runs log is still empty ──────
    if not runs:
        runs = list(db.predictions.find(
            {"coin": symbol},
            sort=[("prediction_date", 1)],
            projection={"_id": 0},
        ))

    if not runs:
        return []

    # ── Build actual-price lookup from historical_sma ────────────────────────
    # Fetch actual closes for all dates that appear in the run records
    pred_dates = list({r["prediction_date"] for r in runs})
    actuals_cursor = db.historical_sma.find(
        {"symbol": symbol, "date": {"$in": pred_dates}},
        projection={"_id": 0, "date": 1, "avg_close": 1},
    )
    actual_map: dict = {doc["date"]: doc["avg_close"] for doc in actuals_cursor}

    # ── Enrich each run record with actual price + error ─────────────────────
    enriched = []
    for r in runs:
        d = _serialize(r)
        pred_date = r.get("prediction_date")
        actual = actual_map.get(pred_date)
        if actual is not None:
            d["actual_price"] = actual
            predicted = r.get("predicted_price")
            if predicted:
                d["error_pct"] = round((predicted - actual) / actual * 100, 4)
        enriched.append(d)

    return enriched


@app.get("/api/technical/{coin}")
def get_technical(
    coin: str,
    days: int = Query(default=180, ge=1, le=3650),
    _user: dict = Depends(get_current_user),
) -> list[dict]:
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
    docs.reverse()  # oldest first for indicator computation
    prices = [d.get("avg_close", 0.0) for d in docs]

    rsi_values = compute_rsi(prices)
    bb_upper, bb_middle, bb_lower = compute_bb(prices)
    macd_line, sig_line, histogram = compute_macd(prices)

    results = []
    prev_close = None
    for i, d in enumerate(docs):
        close = d.get("avg_close", 0.0)
        open_price = prev_close if prev_close is not None else close
        row = _serialize(d)
        row["open"] = open_price
        row["high"] = d.get("daily_high") or close
        row["low"] = d.get("daily_low") or close
        row["close"] = close
        row["rsi"] = rsi_values[i]
        row["bb_upper"] = bb_upper[i]
        row["bb_middle"] = bb_middle[i]
        row["bb_lower"] = bb_lower[i]
        row["macd"] = macd_line[i]
        row["macd_signal"] = sig_line[i]
        row["macd_histogram"] = histogram[i]
        results.append(row)
        prev_close = close
    return results


@app.get("/api/intraday/{coin}/dates")
def get_intraday_dates(
    coin: str,
    _user: dict = Depends(get_current_user),
) -> dict:
    """
    Return list of dates that have 5-min candle data, with prediction availability.
    Response: { dates: [{date, candle_count, has_predictions}] }
    """
    symbol = _resolve_symbol(coin)

    # Aggregate actual candle dates
    candle_dates = list(db.live_prices.aggregate([
        {"$match": {"symbol": symbol, "close": {"$gt": 0}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$timestamp"}},
            "count": {"$sum": 1},
        }},
        {"$sort": {"_id": 1}},
    ]))

    # Aggregate prediction dates
    pred_dates_raw = list(db.intraday_predictions.aggregate([
        {"$match": {"symbol": symbol}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$target_timestamp"}},
            "count": {"$sum": 1},
        }},
    ]))
    pred_date_set = {d["_id"] for d in pred_dates_raw}

    dates = [
        {
            "date": d["_id"],
            "candle_count": d["count"],
            "has_predictions": d["_id"] in pred_date_set,
        }
        for d in candle_dates
    ]

    return {"symbol": symbol, "dates": dates}


@app.get("/api/intraday/{coin}")
def get_intraday(
    coin: str,
    date: str | None = Query(default=None, description="YYYY-MM-DD — single day view"),
    range: str = Query(default="24h", regex="^(24h|3d|7d|all)$"),
    _user: dict = Depends(get_current_user),
) -> dict:
    """
    Return 5-min OHLCV candles from live_prices and matched intraday_predictions.

    date:  YYYY-MM-DD — return only that calendar day (takes priority over range)
    range: 24h | 3d | 7d | all  (used when date is not provided)
    Response: { actual: [...], predicted: [...] }
      actual    — {t, o, h, l, c, v}  (5-min candles, ISO timestamp strings)
      predicted — {t, close, direction, confidence}  (matched by target_timestamp)
    """
    symbol = _resolve_symbol(coin)
    now_utc = datetime.now(timezone.utc)

    # ── Date-based single-day filter ─────────────────────────────────────────
    if date:
        try:
            day_start = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
        day_end = day_start + timedelta(days=1)
        candle_filter: dict = {
            "symbol": symbol, "close": {"$gt": 0},
            "timestamp": {"$gte": day_start, "$lt": day_end},
        }
        pred_filter: dict = {
            "symbol": symbol,
            "target_timestamp": {"$gte": day_start, "$lt": day_end},
        }
        effective_range = date
    else:
        range_map = {"24h": 1, "3d": 3, "7d": 7, "all": 999}
        days_back = range_map[range]
        since = now_utc - timedelta(days=days_back)
        candle_filter = {"symbol": symbol, "close": {"$gt": 0}}
        if range != "all":
            candle_filter["timestamp"] = {"$gte": since}
        pred_filter = {"symbol": symbol}
        if range != "all":
            pred_filter["target_timestamp"] = {"$gte": since}
        effective_range = range

    # ── Actual 5-min candles ─────────────────────────────────────────────────
    candles = list(db.live_prices.find(
        candle_filter,
        sort=[("timestamp", 1)],
        projection={"_id": 0, "timestamp": 1, "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1},
    ))

    actual = [
        {
            "t": d["timestamp"].isoformat() if hasattr(d["timestamp"], "isoformat") else str(d["timestamp"]),
            "o": d.get("open", d.get("close")),
            "h": d.get("high", d.get("close")),
            "l": d.get("low",  d.get("close")),
            "c": d.get("close"),
            "v": d.get("volume", 0),
        }
        for d in candles
    ]

    # ── Intraday predictions by target_timestamp ──────────────────────────────
    preds = list(db.intraday_predictions.find(
        pred_filter,
        sort=[("target_timestamp", 1)],
        projection={"_id": 0, "target_timestamp": 1, "predicted_close": 1,
                    "direction": 1, "confidence": 1},
    ))

    predicted = [
        {
            "t":          d["target_timestamp"].isoformat() if hasattr(d["target_timestamp"], "isoformat") else str(d["target_timestamp"]),
            "close":      d.get("predicted_close"),
            "direction":  d.get("direction"),
            "confidence": d.get("confidence"),
        }
        for d in preds
    ]

    return {
        "symbol":          symbol,
        "range":           effective_range,
        "actual":          actual,
        "predicted":       predicted,
        "actual_count":    len(actual),
        "predicted_count": len(predicted),
    }


@app.get("/api/correlation")
def get_correlation(_user: dict = Depends(get_current_user)) -> dict:
    docs = list(db.coin_correlation.find({}, {"_id": 0}))
    if not docs:
        raise HTTPException(status_code=404, detail="No correlation data found")
    coins: set[str] = set()
    for d in docs:
        coins.add(d.get("coin_a", ""))
        coins.add(d.get("coin_b", ""))
    coins.discard("")
    coin_list = sorted(coins)
    matrix: dict[str, dict[str, float]] = {
        c: {c2: 1.0 if c == c2 else 0.0 for c2 in coin_list} for c in coin_list
    }
    for d in docs:
        a, b = d.get("coin_a", ""), d.get("coin_b", "")
        corr = d.get("pearson_corr", 0.0)
        if a and b:
            matrix[a][b] = corr
            matrix[b][a] = corr
    return {"coins": coin_list, "matrix": matrix, "docs": [_serialize(d) for d in docs]}


@app.get("/api/inference/status")
def get_inference_status(_user: dict = Depends(get_current_user)) -> dict:
    jobs: dict = {}
    for symbol in ["BTC", "DOGE"]:
        doc = db.inference_status.find_one({"coin": symbol}, {"_id": 0})
        if doc:
            jobs[symbol] = _serialize(doc)
        else:
            jobs[symbol] = {"coin": symbol, "status": "unknown"}
    interval = int(os.environ.get("INFERENCE_INTERVAL_SECONDS", "300"))
    return {
        "jobs": jobs,
        "interval_seconds": interval,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
