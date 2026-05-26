"""
scripts/refresh_historical_data.py

Fetches missing historical daily price data via yfinance and appends it
to the sample CSVs so the batch job and LSTM inference have current data.

Covers the gap from the last CSV date (2024-03-27) up to today.
"""

from __future__ import annotations

import csv
from datetime import datetime, timezone, timedelta
from pathlib import Path

import yfinance as yf

COINS = {
    "bitcoin":  ("BTC-USD", Path(__file__).parents[1] / "data" / "sample" / "bitcoin.csv"),
    "dogecoin": ("DOGE-USD", Path(__file__).parents[1] / "data" / "sample" / "dogecoin.csv"),
}


def _last_csv_date(csv_path: Path) -> datetime:
    """Return the last date recorded in the CSV (UTC midnight)."""
    with open(csv_path, newline="") as f:
        rows = list(csv.reader(f))
    last_date_str = rows[-1][0].split(" ")[0]
    return datetime.strptime(last_date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)


def refresh_coin(coin_id: str, ticker: str, csv_path: Path) -> int:
    """Append missing days to csv_path. Returns count of rows appended."""
    last_date = _last_csv_date(csv_path)
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    if last_date >= today - timedelta(days=1):
        print(f"  {coin_id}: already up to date ({last_date.date()})")
        return 0

    start = (last_date + timedelta(days=1)).strftime("%Y-%m-%d")
    end = (today + timedelta(days=1)).strftime("%Y-%m-%d")  # yfinance end is exclusive

    print(f"  {coin_id}: downloading {start} → {today.date()} via yfinance ...", end=" ", flush=True)
    df = yf.download(ticker, start=start, end=end, auto_adjust=True, progress=False)

    if df.empty:
        print("no data returned")
        return 0

    # yfinance columns: Open, High, Low, Close, Volume
    # Flatten MultiIndex columns if present
    if hasattr(df.columns, "levels"):
        df.columns = df.columns.get_level_values(0)

    new_rows = []
    for dt_index, row in df.iterrows():
        date_str = dt_index.strftime("%Y-%m-%d 00:00:00.000")
        close = float(row["Close"])
        volume = float(row["Volume"]) if "Volume" in row else 0.0
        # market_cap not available from yfinance — use 0.0 placeholder
        new_rows.append((date_str, close, volume, 0.0))

    new_rows.sort(key=lambda r: r[0])
    print(f"{len(new_rows)} rows")

    with open(csv_path, "a", newline="") as f:
        writer = csv.writer(f)
        for date_str, close, volume, mcap in new_rows:
            writer.writerow([date_str, close, volume, mcap, coin_id])

    print(f"  {coin_id}: appended through {new_rows[-1][0].split()[0]}")
    return len(new_rows)


def main() -> None:
    print("=== Refreshing historical price data ===")
    total = 0
    for coin_id, (ticker, csv_path) in COINS.items():
        print(f"\n[{coin_id}]")
        total += refresh_coin(coin_id, ticker, csv_path)

    print(f"\nDone. Total rows appended: {total}")


if __name__ == "__main__":
    main()
