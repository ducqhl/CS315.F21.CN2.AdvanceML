"""
scripts/backfill_5min.py

Fetches 5-minute OHLCV data for BTC and DOGE from yfinance (up to 60 days)
and writes it to MongoDB live_prices collection.

Run once:
  python scripts/backfill_5min.py

Requires:
  pip install yfinance pymongo
  MongoDB accessible at localhost:27017 (or MONGO_URI env var)
"""

from __future__ import annotations
import os, sys
from datetime import timezone
import pymongo
import yfinance as yf

MONGO_URI = os.getenv(
    "MONGO_URI",
    "mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin",
)

COINS = {
    "BTC": "BTC-USD",
    "DOGE": "DOGE-USD",
}

def main():
    client = pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    db_name = MONGO_URI.split("/")[-1].split("?")[0]
    db = client[db_name]
    col = db["live_prices"]

    # Ensure unique index on (symbol, timestamp)
    col.create_index([("symbol", 1), ("timestamp", 1)], unique=True, background=True)
    print(f"Connected to MongoDB: {db_name}")

    for symbol, ticker in COINS.items():
        print(f"\n── {symbol} ({ticker}) ──────────────────")
        # yfinance: interval=5m supports up to 60 days back
        df = yf.download(ticker, period="60d", interval="5m",
                         auto_adjust=True, progress=False)

        if df.empty:
            print(f"  No data returned for {ticker}")
            continue

        # Flatten MultiIndex columns if present (yfinance ≥ 0.2)
        if hasattr(df.columns, "levels"):
            df.columns = df.columns.get_level_values(0)

        print(f"  Downloaded {len(df)} rows  [{df.index[0]} → {df.index[-1]}]")

        ops = []
        for ts, row in df.iterrows():
            # yfinance index may be tz-aware or naive — normalise to UTC
            if hasattr(ts, "tzinfo") and ts.tzinfo is not None:
                ts_utc = ts.to_pydatetime().astimezone(timezone.utc)
            else:
                import pandas as pd
                ts_utc = pd.Timestamp(ts, tz="UTC").to_pydatetime()

            doc = {
                "symbol":    symbol,
                "timestamp": ts_utc,
                "open":      float(row.get("Open",  row.get("open",  0))),
                "high":      float(row.get("High",  row.get("high",  0))),
                "low":       float(row.get("Low",   row.get("low",   0))),
                "close":     float(row.get("Close", row.get("close", 0))),
                "volume":    float(row.get("Volume",row.get("volume",0))),
                "interval":  "5m",
                "source":    "yfinance_backfill",
            }
            ops.append(pymongo.UpdateOne(
                {"symbol": symbol, "timestamp": ts_utc},
                {"$set": doc},
                upsert=True,
            ))

        if ops:
            result = col.bulk_write(ops, ordered=False)
            print(f"  Upserted {result.upserted_count}  updated {result.modified_count}")

    # Print collection stats
    for sym in COINS:
        count = col.count_documents({"symbol": sym})
        first = col.find_one({"symbol": sym}, sort=[("timestamp", 1)], projection={"timestamp": 1, "_id": 0})
        last  = col.find_one({"symbol": sym}, sort=[("timestamp",-1)], projection={"timestamp": 1, "_id": 0})
        print(f"\n{sym}: {count} records  [{first and first['timestamp']}  →  {last and last['timestamp']}]")

    client.close()
    print("\nDone.")

if __name__ == "__main__":
    main()
