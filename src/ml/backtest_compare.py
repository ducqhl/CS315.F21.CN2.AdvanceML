"""
backtest_compare.py — Sliding-window backtest for BTC H7, H15, H60 LSTM models.

For each model, rolls predictions across the last 6 months of CSV data and
compares forecast prices vs actual prices.  No MongoDB required.

Usage
-----
    python src/ml/backtest_compare.py [--months N]

Output
------
  - Console table: RMSE, MAE, dir accuracy, mean error % per model
  - src/ml/model/backtest_report.json  — machine-readable results
"""

from __future__ import annotations

import argparse
import json
import logging
import pickle
from pathlib import Path

import numpy as np
import pandas as pd
import torch

from model import LSTMModel
from preprocess import _build_features, _load_csv

logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

_HERE      = Path(__file__).resolve().parent
_MODEL_DIR = _HERE / "model"
_DATA_DIR  = _HERE.parent.parent / "data" / "sample"

SEQ_LEN  = 60   # look-back window (must match training)
WARMUP   = 30   # feature warmup rows (SMA30 dominant)

# ── Model registry ─────────────────────────────────────────────────────────────
_MODELS = {
    7:  {
        "label":       "H7  (7-day)",
        "model_path":  _MODEL_DIR / "lstm_bitcoin_v3.pt",
        "scaler_path": _MODEL_DIR / "scaler_bitcoin_v3.pkl",
    },
    15: {
        "label":       "H15 (15-day)",
        "model_path":  _MODEL_DIR / "lstm_bitcoin_h15_v3.pt",
        "scaler_path": _MODEL_DIR / "scaler_bitcoin_h15_v3.pkl",
    },
    60: {
        "label":       "H60 (60-day)",
        "model_path":  _MODEL_DIR / "lstm_bitcoin_h60_v3.pt",
        "scaler_path": _MODEL_DIR / "scaler_bitcoin_h60_v3.pkl",
    },
}


# ── Loader ─────────────────────────────────────────────────────────────────────

def _load_model(horizon: int):
    cfg = _MODELS[horizon]

    with open(cfg["scaler_path"], "rb") as f:
        scaler = pickle.load(f)

    n_features = len(scaler.mean_)
    model = LSTMModel(
        input_size=n_features,
        hidden_size=128,
        num_layers=2,
        dropout=0.2,
        output_size=horizon,
        use_direction_head=False,
        use_volatility_head=True,
    )
    state = torch.load(cfg["model_path"], map_location="cpu", weights_only=True)
    model.load_state_dict(state)
    model.eval()
    return model, scaler, n_features


# ── Predictor ──────────────────────────────────────────────────────────────────

@torch.no_grad()
def _predict(model, scaler, seed_window: np.ndarray, last_price: float, horizon: int) -> np.ndarray:
    """
    Given seed_window of shape (SEQ_LEN, n_features) already scaled,
    return predicted USD prices for next `horizon` days.
    """
    x = torch.tensor(seed_window[np.newaxis], dtype=torch.float32)
    result = model(x)
    log_rets_norm = (result[0] if isinstance(result, tuple) else result).squeeze(0).cpu().numpy()
    log_rets = log_rets_norm * scaler.scale_[0] + scaler.mean_[0]
    return (last_price * np.exp(np.cumsum(log_rets))).astype(np.float32)


# ── Backtest ───────────────────────────────────────────────────────────────────

def backtest(horizon: int, df_eval: pd.DataFrame, features_eval: np.ndarray,
             model, scaler, n_features: int) -> dict:
    """
    Slide non-overlapping windows of size `horizon` over df_eval.
    Each window: seed = features[i-SEQ_LEN : i], predict horizon steps,
    compare with actual close prices at i, i+1, ... i+horizon-1.

    Returns a dict with metrics and per-window detail.
    """
    close = df_eval["close"].values
    dates = df_eval["date"].values if "date" in df_eval.columns else np.arange(len(df_eval))

    windows = []
    # Start far enough in so we have SEQ_LEN seed rows available
    start = SEQ_LEN
    n = len(features_eval)

    while start + horizon <= n:
        seed = features_eval[start - SEQ_LEN : start]   # (SEQ_LEN, n_features)
        # Trim/pad feature columns to match scaler
        if seed.shape[1] > n_features:
            seed = seed[:, :n_features]

        # Scale seed using this model's scaler
        seed_scaled = scaler.transform(seed)
        last_price = float(close[start - 1])

        pred_prices = _predict(model, scaler, seed_scaled, last_price, horizon)
        actual_prices = close[start : start + horizon].astype(np.float32)

        rmse = float(np.sqrt(np.mean((pred_prices - actual_prices) ** 2)))
        mae  = float(np.mean(np.abs(pred_prices - actual_prices)))
        mean_err_pct = float(np.mean((pred_prices - actual_prices) / actual_prices) * 100)

        # Direction: did pred go up/down the same as actual on day 1?
        pred_dir   = 1 if pred_prices[0] > last_price else 0
        actual_dir = 1 if actual_prices[0] > last_price else 0
        dir_correct = int(pred_dir == actual_dir)

        window_start_date = str(dates[start])[:10]
        window_end_date   = str(dates[min(start + horizon - 1, n - 1)])[:10]

        windows.append({
            "window_start": window_start_date,
            "window_end":   window_end_date,
            "last_price":   round(last_price, 2),
            "pred_day1":    round(float(pred_prices[0]), 2),
            "actual_day1":  round(float(actual_prices[0]), 2),
            "pred_end":     round(float(pred_prices[-1]), 2),
            "actual_end":   round(float(actual_prices[-1]), 2),
            "rmse":         round(rmse, 2),
            "mae":          round(mae, 2),
            "mean_err_pct": round(mean_err_pct, 3),
            "dir_correct":  dir_correct,
        })
        start += horizon

    if not windows:
        return {"error": "no windows", "windows": []}

    rmse_mean    = float(np.mean([w["rmse"] for w in windows]))
    mae_mean     = float(np.mean([w["mae"]  for w in windows]))
    dir_acc      = float(np.mean([w["dir_correct"] for w in windows]) * 100)
    mean_err_pct = float(np.mean([w["mean_err_pct"] for w in windows]))
    n_windows    = len(windows)

    return {
        "horizon":       horizon,
        "n_windows":     n_windows,
        "rmse_mean":     round(rmse_mean, 2),
        "mae_mean":      round(mae_mean, 2),
        "dir_acc_pct":   round(dir_acc, 1),
        "mean_err_pct":  round(mean_err_pct, 3),
        "windows":       windows,
    }


# ── Main ───────────────────────────────────────────────────────────────────────

def main(months: int = 6):
    csv_path = _DATA_DIR / "bitcoin.csv"
    df_full  = _load_csv(csv_path)

    # Load dates separately (_load_csv drops them) and re-attach
    _raw = pd.read_csv(csv_path)
    if "date" in _raw.columns:
        _raw["date"] = pd.to_datetime(_raw["date"])
        _raw = _raw.sort_values("date").reset_index(drop=True)
        df_full["date"] = _raw["date"].values[: len(df_full)]

    # Determine how many rows = months of data
    eval_rows = months * 31   # rough upper bound; trim to available data
    # We need eval_rows + SEQ_LEN + WARMUP rows minimum
    buffer = SEQ_LEN + WARMUP
    total_needed = eval_rows + buffer

    if len(df_full) < total_needed:
        raise ValueError(f"Not enough data: need {total_needed} rows, have {len(df_full)}")

    # Slice: take the last (eval_rows + buffer) rows so we have context for seeds
    df_window = df_full.iloc[-(eval_rows + buffer):].reset_index(drop=True)

    # Build features on the whole window
    features_all = _build_features(df_window)   # (n, 9)

    # Drop warmup NaNs
    valid = ~np.isnan(features_all).any(axis=1)
    first_valid = int(np.argmax(valid))
    features_clean = features_all[valid]

    # Re-align the close prices to the valid rows
    close_vals = df_window["close"].values[valid]
    if "date" in df_window.columns:
        date_vals = df_window["date"].values[valid]
    else:
        date_vals = np.arange(len(close_vals))

    df_eval = pd.DataFrame({"close": close_vals, "date": date_vals})

    # Keep only the eval period (skip the SEQ_LEN buffer rows at the start)
    # so windows align to the "last 6 months"
    df_eval       = df_eval.iloc[buffer - first_valid:].reset_index(drop=True)
    features_eval = features_clean[buffer - first_valid:]

    print(f"\nBTC Backtest — last ~{months} months")
    print(f"Eval period: {str(df_eval['date'].iloc[0])[:10]}  →  {str(df_eval['date'].iloc[-1])[:10]}")
    print(f"Eval rows:   {len(df_eval)}\n")

    results = {}
    for horizon, cfg in _MODELS.items():
        model, scaler, n_features = _load_model(horizon)
        res = backtest(horizon, df_eval, features_eval, model, scaler, n_features)
        results[horizon] = res
        label = cfg["label"]
        print(f"  {label}  |  windows={res['n_windows']:2d}  "
              f"RMSE=${res['rmse_mean']:>8,.0f}  "
              f"MAE=${res['mae_mean']:>8,.0f}  "
              f"dir={res['dir_acc_pct']:>5.1f}%  "
              f"mean_err={res['mean_err_pct']:>+6.2f}%")

    # Per-window detail for each model
    print("\n── Per-window detail ──────────────────────────────────────────────────────")
    for horizon, res in results.items():
        label = _MODELS[horizon]["label"]
        print(f"\n  {label}")
        print(f"  {'Window':^21}  {'Seed $':>10}  {'Pred end $':>10}  "
              f"{'Actual end $':>12}  {'MAE $':>8}  {'Err%':>6}  Dir")
        print("  " + "─" * 80)
        for w in res["windows"]:
            ok = "✓" if w["dir_correct"] else "✗"
            print(f"  {w['window_start']} → {w['window_end']}  "
                  f"${w['last_price']:>9,.0f}  "
                  f"${w['pred_end']:>9,.0f}  "
                  f"${w['actual_end']:>11,.0f}  "
                  f"${w['mae']:>7,.0f}  "
                  f"{w['mean_err_pct']:>+5.1f}%  {ok}")

    # Save report
    report_path = _MODEL_DIR / "backtest_report.json"
    report = {
        "coin":        "bitcoin",
        "eval_months": months,
        "eval_start":  str(df_eval["date"].iloc[0])[:10],
        "eval_end":    str(df_eval["date"].iloc[-1])[:10],
        "models":      {str(h): {k: v for k, v in r.items() if k != "windows"}
                        for h, r in results.items()},
        "per_window":  {str(h): r["windows"] for h, r in results.items()},
    }
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nReport saved → {report_path}")

    # Winner summary
    print("\n── Summary ─────────────────────────────────────────────────────────────────")
    best_rmse   = min(results.values(), key=lambda r: r["rmse_mean"])
    best_dir    = max(results.values(), key=lambda r: r["dir_acc_pct"])
    best_err    = min(results.values(), key=lambda r: abs(r["mean_err_pct"]))
    for horizon, res in results.items():
        label = _MODELS[horizon]["label"]
        flags = []
        if res is best_rmse: flags.append("lowest RMSE")
        if res is best_dir:  flags.append("best direction")
        if res is best_err:  flags.append("least price bias")
        tag = f"  ← {', '.join(flags)}" if flags else ""
        print(f"  {label}  RMSE=${res['rmse_mean']:>8,.0f}  dir={res['dir_acc_pct']:>5.1f}%{tag}")
    print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BTC multi-horizon backtest")
    parser.add_argument("--months", type=int, default=6,
                        help="How many months of recent data to evaluate on (default: 6)")
    args = parser.parse_args()
    main(args.months)
