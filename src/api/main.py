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
from fastapi import Cookie, Depends, FastAPI, HTTPException, Query, Response, status
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
SECURE_COOKIES = os.environ.get("SECURE_COOKIES", "false").lower() == "true"

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
_bearer = HTTPBearer(auto_error=False)

COOKIE_NAME = "access_token"


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    access_token: str | None = Cookie(default=None),
) -> dict:
    token = (credentials.credentials if credentials else None) or access_token
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = verify_token(token)
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
def login(req: LoginRequest, response: Response) -> dict:
    user = db.users.find_one({"username": req.username})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    pwd_hash = hashlib.sha256(req.password.encode()).hexdigest()
    if not hmac.compare_digest(pwd_hash, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token({"sub": user["username"], "role": user.get("role", "admin")})
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="none" if SECURE_COOKIES else "lax",
        secure=SECURE_COOKIES,
        max_age=JWT_EXPIRE_HOURS * 3600,
        path="/",
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "username": user["username"],
        "expires_in": JWT_EXPIRE_HOURS * 3600,
    }


@app.post("/api/auth/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(key=COOKIE_NAME, path="/", samesite="none" if SECURE_COOKIES else "lax", secure=SECURE_COOKIES)
    return {"status": "logged out"}


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
        doc = db.live_prices.find_one({"symbol": symbol}, sort=[("timestamp", -1)])
        if doc:
            latest_prices[symbol] = {
                "price": doc.get("price_usd") or doc.get("close"),
                "date": doc["timestamp"].isoformat() if isinstance(doc.get("timestamp"), datetime) else str(doc.get("timestamp")),
            }
        else:
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
    doc = db.live_prices.find_one({"symbol": symbol}, sort=[("timestamp", -1)])
    if doc:
        result = _serialize(doc)
        result["source"] = "live_prices"
        result["price"] = doc.get("price_usd") or doc.get("close")
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
def get_predictions(
    coin: str,
    horizon: int | None = Query(default=None, description="Horizon override: 7, 15, or 60. Defaults to active model."),
    model_id: str | None = Query(default=None, description="View a specific model version's forecast (e.g. lstm_bitcoin_h7_v2). Overrides horizon."),
    _user: dict = Depends(get_current_user),
) -> dict:
    symbol = _resolve_symbol(coin)
    coin_id = coin.lower() if coin.lower() in {"bitcoin", "dogecoin"} else \
              ("bitcoin" if symbol == "BTC" else "dogecoin")
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    # ── Resolve selection: explicit model_id wins, else newest of active horizon ──
    if model_id:
        catalog = _discover_model_files(coin_id)
        entry = next((d for d in catalog if d["model_id"] == model_id), None)
        active_horizon = entry["horizon"] if entry else (horizon if horizon in (7, 15, 60) else 7)
        active_model_id = model_id
        model_filter: dict = {"model_id": model_id}
    else:
        active_horizon = horizon if horizon in (7, 15, 60) else 7
        if horizon is None:
            registry_doc = db.model_registry.find_one({"coin": symbol, "is_active": True}, {"_id": 0, "horizon": 1})
            if registry_doc:
                active_horizon = int(registry_doc["horizon"])
        # Newest model for this horizon → only show its forecast (old on-demand runs excluded)
        catalog = _discover_model_files(coin_id)
        newest = next((d for d in catalog if d["horizon"] == active_horizon and d["is_newest"]), None)
        active_model_id = newest["model_id"] if newest else None
        if active_model_id:
            # Match newest model_id OR legacy docs lacking model identity (back-compat)
            model_filter = {"$or": [
                {"model_id": active_model_id},
                {"model_id": {"$in": [None, ""]}, "horizon": active_horizon},
                {"model_id": {"$exists": False}, "horizon": active_horizon},
            ]}
        else:
            model_filter = {"$or": [{"horizon": active_horizon}, {"horizon": {"$exists": False}}]} if active_horizon == 7 else {"horizon": active_horizon}

    cursor = db.predictions.find(
        {"coin": symbol, "prediction_date": {"$gte": today}, **model_filter},
        sort=[("prediction_date", 1)],
        projection={"_id": 0},
    )
    docs = list(cursor)
    if not docs:
        return {
            "coin": symbol, "model_version": None, "active_horizon": active_horizon,
            "active_model_id": active_model_id,
            "predictions": [], "dominant_direction": None, "direction_counts": {},
            "avg_confidence": None, "dominant_strength": None,
            "next_day_price": None, "seven_day_high": None, "seven_day_low": None,
            "message": f"No predictions for {symbol} {active_model_id or f'H{active_horizon}'}. Run inference first.",
        }
    model_version = docs[-1].get("model_version", "lstm_v1") if docs else "lstm_v1"
    prices = [d["predicted_price"] for d in docs]
    serialized = []
    for d in docs:
        row = _serialize(d)
        for field in ("direction", "direction_prob", "trend_strength", "confidence", "model_id", "version"):
            if field in d:
                row[field] = d[field]
        serialized.append(row)

    # ── Trend summary (primary signal) ──────────────────────────────────────────
    directions = [d.get("direction") for d in docs if d.get("direction")]
    dir_counts = {k: directions.count(k) for k in ("UP", "DOWN", "FLAT")}
    dominant_direction = max(dir_counts, key=dir_counts.get) if directions else None
    avg_confidence = (
        float(np.mean([d["direction_prob"] for d in docs if d.get("direction_prob") is not None]))
        if any(d.get("direction_prob") is not None for d in docs) else None
    )
    strengths = [d.get("trend_strength") for d in docs if d.get("trend_strength")]
    dominant_strength = max(set(strengths), key=strengths.count) if strengths else None

    return {
        "coin": symbol,
        "model_version": model_version,
        "active_horizon": active_horizon,
        "active_model_id": active_model_id,
        "predictions": serialized,
        # Trend-first summary fields
        "dominant_direction": dominant_direction,
        "direction_counts": dir_counts,
        "avg_confidence": round(avg_confidence, 4) if avg_confidence is not None else None,
        "dominant_strength": dominant_strength,
        # Price fields (secondary)
        "next_day_price": prices[0] if prices else None,
        "seven_day_high": max(prices) if prices else None,
        "seven_day_low": min(prices) if prices else None,
    }


@app.get("/api/predictions/{coin}/history")
def get_prediction_history(
    coin: str,
    days: int = Query(default=60, ge=1, le=365),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=15, ge=1, le=100),
    horizon: int | None = Query(default=None, description="Scope history to a horizon (7/15/60). Omit for all."),
    _user: dict = Depends(get_current_user),
) -> dict:
    """
    Return a page of prediction_runs history joined with actual prices.

    Each record represents what the model predicted for a given date on the day
    the prediction was made (run_date), plus the actual closing price if that
    date has since passed (from historical_sma).

    Server-side paginated: pass ``page`` (1-based) and ``limit``. Response shape:
    ``{items, total, page, limit, total_pages}``.

    Falls back to the predictions collection if prediction_runs is empty
    (useful right after first deploy before runs accumulate).
    """
    import math

    symbol = _resolve_symbol(coin)
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    since = today - timedelta(days=days)
    skip = (page - 1) * limit

    def _empty(total: int) -> dict:
        return {
            "items": [],
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": max(1, math.ceil(total / limit)),
        }

    # ── Read a page from prediction_runs (append-only log) ───────────────────
    horizon_filter: dict = {"horizon": horizon} if horizon in (7, 15, 60) else {}
    runs_filter = {"coin": symbol, "run_date": {"$gte": since}, **horizon_filter}
    total = db.prediction_runs.count_documents(runs_filter)

    if total > 0:
        runs = list(db.prediction_runs.find(
            runs_filter,
            sort=[("prediction_date", 1), ("run_date", 1)],
            skip=skip,
            limit=limit,
            projection={"_id": 0},
        ))
    else:
        # ── Fallback: use predictions collection if runs log is still empty ──
        fallback = list(db.predictions.find(
            {"coin": symbol, **horizon_filter},
            sort=[("prediction_date", 1)],
            projection={"_id": 0},
        ))
        total = len(fallback)
        runs = fallback[skip:skip + limit]

    if not runs:
        return _empty(total)

    # ── Build actual-price lookup from historical_sma ────────────────────────
    # Fetch actual closes for all dates that appear in the run records
    pred_dates = list({r["prediction_date"] for r in runs})
    actuals_cursor = db.historical_sma.find(
        {"symbol": symbol, "date": {"$in": pred_dates}},
        projection={"_id": 0, "date": 1, "avg_close": 1},
    )
    actual_map: dict = {doc["date"]: doc["avg_close"] for doc in actuals_cursor}

    # ── Build actual direction lookup from historical_sma ───────────────────
    # Compute actual direction: sign of log_return between consecutive closes
    # Needed to check if predicted direction matched reality
    actual_sma_docs = list(db.historical_sma.find(
        {"symbol": symbol},
        sort=[("date", 1)],
        projection={"_id": 0, "date": 1, "avg_close": 1},
    ))
    actual_direction_map: dict = {}
    for i in range(1, len(actual_sma_docs)):
        prev_close = actual_sma_docs[i - 1]["avg_close"]
        curr_close = actual_sma_docs[i]["avg_close"]
        if prev_close and curr_close and prev_close > 0:
            lr = math.log(curr_close / prev_close)
            if lr > 0.01:
                actual_direction_map[actual_sma_docs[i]["date"]] = "UP"
            elif lr < -0.01:
                actual_direction_map[actual_sma_docs[i]["date"]] = "DOWN"
            else:
                actual_direction_map[actual_sma_docs[i]["date"]] = "FLAT"

    # ── Enrich each run record with actual price + error + direction accuracy ─
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
        # Direction accuracy for this step
        actual_dir = actual_direction_map.get(pred_date)
        if actual_dir is not None:
            d["actual_direction"] = actual_dir
            pred_dir = r.get("direction")
            if pred_dir:
                d["direction_correct"] = (pred_dir == actual_dir)
        enriched.append(d)

    return {
        "items": enriched,
        "total": total,
        "page": page,
        "limit": limit,
        "total_pages": max(1, math.ceil(total / limit)),
    }


@app.get("/api/predictions/{coin}/accuracy")
def get_prediction_accuracy(
    coin: str,
    days: int = Query(default=30, ge=1, le=365),
    _user: dict = Depends(get_current_user),
) -> dict:
    """
    Return daily prediction accuracy records (predicted vs actual closing price).

    Each record compares the LSTM's prediction for a past date to the actual
    price on that date, as recorded by the accuracy_tracker module.

    Fields per record:
      prediction_date   : the past date that was predicted
      predicted_price   : what the model forecasted
      actual_price      : the real closing price on that day
      mae               : |predicted − actual| in USD
      mape              : mae / actual_price × 100 (%)
      direction_predicted : "UP" | "FLAT" | "DOWN" from direction head
      direction_actual    : "UP" | "DOWN" derived from actual price change
      direction_correct   : bool
      seed_source         : data source used to seed the model
      model_version       : e.g. "lstm_v2"
      evaluated_at        : when accuracy was computed

    Returns empty list when prediction_accuracy collection is empty
    (requires at least 1 day of inference + accuracy evaluation to have run).
    """
    symbol = _resolve_symbol(coin)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    docs = list(db.prediction_accuracy.find(
        {"coin": symbol, "prediction_date": {"$gte": cutoff}},
        sort=[("prediction_date", -1)],
        projection={"_id": 0},
        limit=days,
    ))
    serialized = [_serialize(d) for d in docs]

    # Compute aggregate stats if data exists
    mae_vals  = [d.get("mae")  for d in docs if d.get("mae")  is not None]
    mape_vals = [d.get("mape") for d in docs if d.get("mape") is not None]
    dir_vals  = [d.get("direction_correct") for d in docs if d.get("direction_correct") is not None]

    summary = {
        "avg_mae":              round(float(np.mean(mae_vals)),  2) if mae_vals  else None,
        "avg_mape":             round(float(np.mean(mape_vals)), 2) if mape_vals else None,
        "direction_accuracy_pct": round(float(np.mean(dir_vals)) * 100, 1) if dir_vals else None,
        "record_count":         len(docs),
    }

    return {
        "coin":    symbol,
        "days":    days,
        "summary": summary,
        "records": serialized,
    }


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
    Return list of dates that have 5-min candle data.
    Response: { dates: [{date, candle_count, has_predictions}] }
    has_predictions is always False — intraday ML predictions removed (scale mismatch).
    """
    symbol = _resolve_symbol(coin)

    candle_dates = list(db.live_prices.aggregate([
        {"$match": {"symbol": symbol, "close": {"$gt": 0}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$timestamp"}},
            "count": {"$sum": 1},
        }},
        {"$sort": {"_id": 1}},
    ]))

    dates = [
        {"date": d["_id"], "candle_count": d["count"], "has_predictions": False}
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
    Return 5-min OHLCV candles from live_prices for the candlestick chart.

    date:  YYYY-MM-DD — return only that calendar day (takes priority over range)
    range: 24h | 3d | 7d | all  (used when date is not provided)
    Response: { actual: [...] }
      actual — {t, o, h, l, c, v}  (5-min candles, ISO timestamp strings)

    Note: intraday ML predictions removed — the LSTM is trained on daily data
    and cannot reliably predict at 5-min resolution (daily-scale vs 5-min-scale
    mismatch). The candlestick chart displays real market data only.
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
        effective_range = date
    else:
        range_map = {"24h": 1, "3d": 3, "7d": 7, "all": 999}
        days_back = range_map[range]
        since = now_utc - timedelta(days=days_back)
        candle_filter = {"symbol": symbol, "close": {"$gt": 0}}
        if range != "all":
            candle_filter["timestamp"] = {"$gte": since}
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

    return {
        "symbol":       symbol,
        "range":        effective_range,
        "actual":       actual,
        "actual_count": len(actual),
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


# ── ML Model Management Endpoints ─────────────────────────────────────────────

import threading as _threading
import subprocess as _subprocess
from pathlib import Path as _Path

import re as _re

_ML_DIR = _Path(__file__).resolve().parent.parent / "ml"
_MODEL_DIR = _Path(os.environ.get("MODEL_DIR", str(_ML_DIR / "model")))
_VALID_HORIZONS = {7, 15, 60}
_VALID_COINS = {"bitcoin", "dogecoin", "BTC", "DOGE", "btc", "doge"}


def _discover_model_files(coin_id: str) -> list[dict]:
    """
    Torch-free disk scan of trained model artifacts for *coin_id* (e.g. "bitcoin").

    Mirrors inference.discover_models without importing torch (the API container
    has no ML deps). Returns entries sorted by (horizon, -version):
        {model_id, horizon, version, version_label, is_legacy, is_newest, model_exists}
    Legacy (pre-horizon) files map to horizon 7.
    """
    found: list[dict] = []

    for p in _MODEL_DIR.glob(f"lstm_{coin_id}_h*_v*.pt"):
        m = _re.match(rf"lstm_{_re.escape(coin_id)}_h(\d+)_v(\d+)\.pt$", p.name)
        if not m:
            continue
        horizon, version = int(m.group(1)), int(m.group(2))
        if (_MODEL_DIR / f"scaler_{coin_id}_h{horizon}_v{version}.pkl").exists():
            found.append({"model_id": p.stem, "horizon": horizon, "version": version, "is_legacy": False})

    for p in _MODEL_DIR.glob(f"lstm_{coin_id}_v*.pt"):
        m = _re.match(rf"lstm_{_re.escape(coin_id)}_v(\d+)\.pt$", p.name)
        if not m:
            continue
        version = int(m.group(1))
        if version < 2:   # v1 predates the 9-feature pipeline and is unloadable
            continue
        has_scaler = (_MODEL_DIR / f"scaler_{coin_id}_v{version}.pkl").exists() or (_MODEL_DIR / f"scaler_{coin_id}.pkl").exists()
        if has_scaler:
            found.append({"model_id": p.stem, "horizon": 7, "version": version, "is_legacy": True})

    by_horizon: dict[int, dict] = {}
    for d in found:
        rank = (0 if d["is_legacy"] else 1, d["version"])
        cur = by_horizon.get(d["horizon"])
        if cur is None or rank > (0 if cur["is_legacy"] else 1, cur["version"]):
            by_horizon[d["horizon"]] = d
    newest_ids = {d["model_id"] for d in by_horizon.values()}
    for d in found:
        d["is_newest"]     = d["model_id"] in newest_ids
        d["version_label"] = f"v{d['version']}" + (" (legacy)" if d["is_legacy"] else "")
        d["model_exists"]  = True

    found.sort(key=lambda d: (d["horizon"], -d["version"], d["is_legacy"]))
    return found

# In-memory store for background retrain jobs (resets on restart; MongoDB is authoritative)
_retrain_lock = _threading.Lock()


class _ActiveModelRequest(BaseModel):
    coin: str
    horizon: int


class _RetrainRequest(BaseModel):
    coin: str
    horizon: int


@app.get("/api/ml/models")
def get_ml_models(
    coin: str | None = Query(default=None, description="Filter by coin: bitcoin|dogecoin|BTC|DOGE"),
    _user: dict = Depends(get_current_user),
) -> dict:
    """
    List all trained LSTM models (one entry per coin · horizon · version).

    The 3 main horizons (7/15/60) each carry a version history; the newest version
    is the default (is_newest). Older versions stay selectable for on-demand
    "predict now" runs. Metrics from the registry are attached to the newest entry
    of each horizon. is_active marks the newest model of the coin's active horizon.

    Each entry: {coin, coin_id, horizon, version, version_label, model_id,
                 is_legacy, is_newest, model_exists, is_active, metrics}.
    """
    coin_ids = [coin.lower()] if coin and coin.lower() in {"bitcoin", "dogecoin"} else \
               ([_id for _id in ("bitcoin", "dogecoin")
                 if not coin or COIN_SYMBOL_MAP.get(coin.lower()) == COIN_SYMBOL_MAP.get(_id)] or ["bitcoin", "dogecoin"])

    models: list[dict] = []
    for coin_id in coin_ids:
        symbol = COIN_SYMBOL_MAP[coin_id]
        catalog = _discover_model_files(coin_id)

        # Registry: metrics keyed by (coin, horizon) + which horizon is active
        reg_docs = {d["horizon"]: d for d in db.model_registry.find({"coin": symbol}, {"_id": 0})}
        active_doc = db.model_registry.find_one({"coin": symbol, "is_active": True}, {"_id": 0, "horizon": 1})
        active_horizon = int(active_doc["horizon"]) if active_doc else 7

        for entry in catalog:
            reg = reg_docs.get(entry["horizon"], {})
            is_newest = entry["is_newest"]
            models.append({
                "coin":          symbol,
                "coin_id":       coin_id,
                "horizon":       entry["horizon"],
                "version":       entry["version"],
                "version_label": entry["version_label"],
                "model_id":      entry["model_id"],
                "is_legacy":     entry["is_legacy"],
                "is_newest":     is_newest,
                "model_exists":  entry["model_exists"],
                "is_active":     entry["horizon"] == active_horizon and is_newest,
                # Metrics + score_report only for newest artifact
                "metrics":       reg.get("metrics") if is_newest else None,
                "score_report":  reg.get("score_report") if is_newest else None,
            })

    serialized = [_serialize(m) for m in models]
    return {
        "models": serialized,
        "count": len(serialized),
        "valid_horizons": sorted(_VALID_HORIZONS),
    }


@app.put("/api/ml/models/active")
def set_active_model(
    req: _ActiveModelRequest,
    _user: dict = Depends(get_current_user),
) -> dict:
    """
    Set the active prediction model for a coin.

    Body: { "coin": "bitcoin"|"dogecoin", "horizon": 7|15|60 }

    The active model is used by GET /api/predictions/{coin} when no
    ?horizon= query param is provided.
    """
    if req.horizon not in _VALID_HORIZONS:
        raise HTTPException(status_code=400, detail=f"Invalid horizon {req.horizon}. Must be one of {sorted(_VALID_HORIZONS)}")

    coin_id = req.coin.lower()
    coin_norm = COIN_SYMBOL_MAP.get(coin_id)
    if not coin_norm:
        raise HTTPException(status_code=400, detail=f"Unknown coin: {req.coin}")

    # Verify model is registered and exists (checked via MongoDB registry)
    reg = db.model_registry.find_one({"coin": coin_norm, "horizon": req.horizon}, {"_id": 0})
    if not reg or not reg.get("model_exists", False):
        raise HTTPException(
            status_code=404,
            detail=f"Model not trained for {coin_norm} H{req.horizon}. "
                   f"Trigger training first: POST /api/ml/retrain",
        )

    # Deactivate all models for this coin, then activate the selected one
    db.model_registry.update_many({"coin": coin_norm}, {"$set": {"is_active": False}})
    db.model_registry.update_one(
        {"coin": coin_norm, "horizon": req.horizon},
        {"$set": {"is_active": True}},
    )

    return {
        "status":  "ok",
        "coin":    coin_norm,
        "horizon": req.horizon,
        "message": f"Active model for {coin_norm} set to H{req.horizon}",
    }


@app.post("/api/ml/retrain")
def trigger_retrain(
    req: _RetrainRequest,
    _user: dict = Depends(get_current_user),
) -> dict:
    """
    Trigger retraining of the LSTM for a specific coin + horizon.

    Body: { "coin": "bitcoin"|"dogecoin", "horizon": 7|15|60 }

    Writes a retrain_request document to MongoDB; the inference-scheduler
    picks it up on its next cycle and runs training.
    Poll GET /api/ml/retrain/status for progress.
    """
    if req.horizon not in _VALID_HORIZONS:
        raise HTTPException(status_code=400, detail=f"horizon must be one of {sorted(_VALID_HORIZONS)}")

    coin_id = req.coin.lower()
    coin_norm = COIN_SYMBOL_MAP.get(coin_id)
    if not coin_norm:
        raise HTTPException(status_code=400, detail=f"Unknown coin: {req.coin}")

    # Reject if a job is already pending/running for this coin+horizon
    active = db.training_jobs.find_one(
        {"coin": coin_norm, "horizon": req.horizon, "status": {"$in": ["pending", "running"]}},
        {"_id": 0, "job_id": 1, "status": 1},
    )
    if active:
        return {
            "job_id":  active["job_id"],
            "coin":    coin_norm,
            "horizon": req.horizon,
            "status":  active["status"],
            "message": f"A {active['status']} job already exists for {coin_norm} H{req.horizon}.",
        }

    job_id = f"{coin_norm}_h{req.horizon}_{int(datetime.now(timezone.utc).timestamp())}"
    now = datetime.now(timezone.utc)

    # Write retrain request — the inference-scheduler polls this collection
    db.training_jobs.insert_one({
        "job_id":     job_id,
        "coin":       coin_norm,
        "coin_id":    coin_id,
        "horizon":    req.horizon,
        "status":     "pending",
        "created_at": now,
        "started_at": None,
        "finished_at": None,
        "metrics":    None,
        "error":      None,
    })

    return {
        "job_id":  job_id,
        "coin":    coin_norm,
        "horizon": req.horizon,
        "status":  "pending",
        "message": f"Retrain request queued for {coin_norm} H{req.horizon}. "
                   f"The scheduler will pick it up on the next cycle (~5 min). "
                   f"Poll /api/ml/retrain/status?coin={req.coin} for progress.",
    }


@app.get("/api/ml/retrain/status")
def get_retrain_status(
    coin: str | None = Query(default=None, description="Filter by coin"),
    limit: int = Query(default=20, ge=1, le=100),
    _user: dict = Depends(get_current_user),
) -> dict:
    """
    Return recent training job records.

    Each entry has: job_id, coin, horizon, status (pending|running|completed|failed),
    created_at, started_at, finished_at, metrics, error.
    """
    query: dict = {}
    if coin:
        coin_norm = COIN_SYMBOL_MAP.get(coin.lower(), coin.upper())
        query["coin"] = coin_norm

    jobs = list(db.training_jobs.find(
        query,
        {"_id": 0},
        sort=[("created_at", -1)],
        limit=limit,
    ))

    return {
        "jobs":  [_serialize(j) for j in jobs],
        "count": len(jobs),
    }


# ── On-demand prediction (select a specific model version to predict with) ─────

class _PredictRequest(BaseModel):
    coin: str
    model_id: str


@app.post("/api/ml/predict")
def trigger_predict(
    req: _PredictRequest,
    _user: dict = Depends(get_current_user),
) -> dict:
    """
    Queue an on-demand inference run for a specific model version.

    Body: { "coin": "bitcoin"|"dogecoin", "model_id": "lstm_bitcoin_h7_v2" }

    Newest models are already predicted every scheduler cycle — this is mainly for
    running an OLDER version on demand so its forecast can be viewed/compared. The
    scheduler picks the job up on its next cycle (~5 min) and writes predictions
    tagged with model_id. Poll GET /api/ml/predict/status.
    """
    coin_id = req.coin.lower()
    coin_norm = COIN_SYMBOL_MAP.get(coin_id)
    if not coin_norm:
        raise HTTPException(status_code=400, detail=f"Unknown coin: {req.coin}")

    # Validate the model exists on disk and belongs to this coin
    catalog = _discover_model_files(coin_id)
    entry = next((d for d in catalog if d["model_id"] == req.model_id), None)
    if entry is None:
        raise HTTPException(
            status_code=404,
            detail=f"Model '{req.model_id}' not found for {coin_norm}. "
                   f"Available: {[d['model_id'] for d in catalog]}",
        )

    # Reject duplicate pending/running jobs for the same model
    existing = db.inference_jobs.find_one(
        {"model_id": req.model_id, "status": {"$in": ["pending", "running"]}},
        {"_id": 0, "job_id": 1, "status": 1},
    )
    if existing:
        return {
            "job_id":   existing["job_id"],
            "coin":     coin_norm,
            "model_id": req.model_id,
            "status":   existing["status"],
            "message":  f"A {existing['status']} predict job already exists for {req.model_id}.",
        }

    job_id = f"predict_{req.model_id}_{int(datetime.now(timezone.utc).timestamp())}"
    db.inference_jobs.insert_one({
        "job_id":      job_id,
        "coin":        coin_norm,
        "coin_id":     coin_id,
        "horizon":     entry["horizon"],
        "version":     entry["version"],
        "model_id":    req.model_id,
        "status":      "pending",
        "created_at":  datetime.now(timezone.utc),
        "started_at":  None,
        "finished_at": None,
        "error":       None,
    })

    return {
        "job_id":   job_id,
        "coin":     coin_norm,
        "model_id": req.model_id,
        "horizon":  entry["horizon"],
        "status":   "pending",
        "message":  f"Predict queued for {req.model_id}. The scheduler runs it on the "
                    f"next cycle (~5 min); poll /api/ml/predict/status?coin={req.coin}.",
    }


@app.get("/api/ml/predict/status")
def get_predict_status(
    coin: str | None = Query(default=None, description="Filter by coin"),
    model_id: str | None = Query(default=None, description="Filter by model_id"),
    limit: int = Query(default=20, ge=1, le=100),
    _user: dict = Depends(get_current_user),
) -> dict:
    """Return recent on-demand predict job records (status pending|running|completed|failed)."""
    query: dict = {}
    if coin:
        query["coin"] = COIN_SYMBOL_MAP.get(coin.lower(), coin.upper())
    if model_id:
        query["model_id"] = model_id

    jobs = list(db.inference_jobs.find(
        query, {"_id": 0}, sort=[("created_at", -1)], limit=limit,
    ))
    return {"jobs": [_serialize(j) for j in jobs], "count": len(jobs)}


@app.post("/api/ml/models/backfill-score-reports")
def backfill_score_reports(_user: dict = Depends(get_current_user)) -> dict:
    """
    One-time backfill: read score_report JSON files from disk and upsert them
    into the model_registry collection for models that lack a score_report field.

    Safe to call multiple times — only updates docs where score_report is null/missing.
    """
    import json as _json

    updated = 0
    skipped = 0
    errors = []

    for coin_id in ("bitcoin", "dogecoin"):
        symbol = COIN_SYMBOL_MAP[coin_id]
        for horizon in sorted(_VALID_HORIZONS):
            score_path = _MODEL_DIR / f"score_report_{coin_id}_h{horizon}.json"
            if not score_path.exists():
                skipped += 1
                continue
            try:
                with open(score_path) as f:
                    sr = _json.load(f)
                result = db.model_registry.update_one(
                    {"coin": symbol, "horizon": horizon},
                    {"$set": {"score_report": sr}},
                )
                if result.matched_count:
                    updated += 1
                else:
                    skipped += 1
            except Exception as exc:
                errors.append(f"{coin_id} H{horizon}: {exc}")

    return {"updated": updated, "skipped": skipped, "errors": errors}


# ── System Overview ───────────────────────────────────────────────────────────

@app.get("/api/system/overview")
def get_system_overview(_user: dict = Depends(get_current_user)) -> dict:
    """
    Aggregate system metrics in one call: health, collection stats, model catalog,
    recent job summaries, and inference scheduler status. Powers the System Stats page.
    """
    # Health
    try:
        mongo_client.admin.command("ping")
        mongo_ok = True
    except Exception:
        mongo_ok = False

    # Collection document counts
    col_names = [
        "daily_stats", "historical_sma", "coin_correlation",
        "realtime_prices", "live_prices", "predictions",
        "prediction_accuracy", "training_jobs", "inference_jobs",
    ]
    col_counts: dict[str, int] = {}
    for c in col_names:
        try:
            col_counts[c] = db[c].count_documents({})
        except Exception:
            col_counts[c] = 0

    # Model catalog
    all_models: list[dict] = []
    for coin_id in ["bitcoin", "dogecoin"]:
        symbol = COIN_SYMBOL_MAP[coin_id]
        try:
            catalog = _discover_model_files(coin_id)
        except Exception:
            catalog = []
        active_doc = db.model_registry.find_one(
            {"coin": symbol, "is_active": True}, {"_id": 0, "horizon": 1}
        )
        active_horizon = int(active_doc["horizon"]) if active_doc else 7
        for entry in catalog:
            reg = db.model_registry.find_one(
                {"coin": symbol, "horizon": entry["horizon"]}, {"_id": 0}
            ) or {}
            all_models.append({
                "coin": symbol,
                "coin_id": coin_id,
                "horizon": entry["horizon"],
                "model_id": entry["model_id"],
                "version_label": entry["version_label"],
                "is_newest": entry["is_newest"],
                "is_active": entry["horizon"] == active_horizon and entry["is_newest"],
                "metrics": reg.get("metrics"),
            })
    all_models.sort(key=lambda m: (m["coin"], m["horizon"]))

    # Job counts by status
    def _job_counts(coll: str) -> dict[str, int]:
        pipeline = [{"$group": {"_id": "$status", "n": {"$sum": 1}}}]
        try:
            return {d["_id"]: d["n"] for d in db[coll].aggregate(pipeline)}
        except Exception:
            return {}

    def _recent_jobs(coll: str, n: int = 8) -> list[dict]:
        try:
            docs = list(db[coll].find({}, {"_id": 0}, sort=[("created_at", -1)], limit=n))
            return [_serialize(d) for d in docs]
        except Exception:
            return []

    # Inference scheduler status
    sched: dict[str, dict] = {}
    for symbol in ["BTC", "DOGE"]:
        doc = db.inference_status.find_one({"coin": symbol}, {"_id": 0})
        sched[symbol] = _serialize(doc) if doc else {"coin": symbol, "status": "unknown"}

    # Latest prices
    latest_prices: dict[str, dict] = {}
    for coin_id, symbol in [("bitcoin", "BTC"), ("dogecoin", "DOGE")]:
        doc = db.live_prices.find_one({"symbol": symbol}, sort=[("timestamp", -1)])
        if doc:
            ts = doc.get("timestamp")
            latest_prices[symbol] = {
                "price": doc.get("price_usd") or doc.get("close"),
                "date": ts.isoformat() if isinstance(ts, datetime) else str(ts or ""),
            }

    return {
        "health": {"api": "ok", "mongo": "connected" if mongo_ok else "error"},
        "collections": col_counts,
        "models": {
            "entries": [_serialize(m) for m in all_models],
            "total": len(all_models),
            "by_coin": {
                "BTC": sum(1 for m in all_models if m["coin"] == "BTC"),
                "DOGE": sum(1 for m in all_models if m["coin"] == "DOGE"),
            },
        },
        "jobs": {
            "training": {"counts": _job_counts("training_jobs"), "recent": _recent_jobs("training_jobs")},
            "inference": {"counts": _job_counts("inference_jobs"), "recent": _recent_jobs("inference_jobs")},
        },
        "scheduler": sched,
        "latest_prices": latest_prices,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
