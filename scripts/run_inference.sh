#!/bin/bash
# run_inference.sh — Train LSTM models for BTC and DOGE, then run inference.
#
# Usage:
#   bash scripts/run_inference.sh
#
# Steps:
#   1. Train LSTM on data/sample/bitcoin.csv  (saves lstm_bitcoin_v1.pt)
#   2. Run BTC inference: generate 7-day forecast → MongoDB predictions
#   3. Train LSTM on data/sample/dogecoin.csv (saves lstm_dogecoin_v1.pt)
#   4. Run DOGE inference: generate 7-day forecast → MongoDB predictions
#
# Prerequisites:
#   - Python 3.11+ with torch, numpy, scikit-learn, pandas, pymongo installed
#   - MongoDB running and MONGO_URI set in .env (or defaults to localhost:27017)

set -e  # exit on first error

# Navigate to project root (handles calling from any directory)
cd "$(dirname "$0")/.."

echo "[run_inference] Working directory: $(pwd)"
echo ""

# ── Step 1: Train BTC LSTM ─────────────────────────────────────────────────────
echo "[run_inference] Training BTC model..."
python src/ml/train_lstm.py --coin bitcoin
echo "[run_inference] BTC training complete."
echo ""

# ── Step 2: BTC inference ──────────────────────────────────────────────────────
echo "[run_inference] Running BTC inference and writing predictions to MongoDB..."
python src/ml/inference.py --coin bitcoin
echo "[run_inference] BTC inference complete."
echo ""

# ── Step 3: Train DOGE LSTM ────────────────────────────────────────────────────
echo "[run_inference] Training DOGE model..."
python src/ml/train_lstm.py --coin dogecoin
echo "[run_inference] DOGE training complete."
echo ""

# ── Step 4: DOGE inference ─────────────────────────────────────────────────────
echo "[run_inference] Running DOGE inference and writing predictions to MongoDB..."
python src/ml/inference.py --coin dogecoin
echo "[run_inference] DOGE inference complete."
echo ""

echo "[run_inference] Done. Open the dashboard at http://localhost:8501 and navigate to LSTM Predictions."
