#!/bin/bash
# run_inference.sh — Train the BTC LSTM model and run inference.
#
# Usage:
#   bash scripts/run_inference.sh
#
# Steps:
#   1. Train LSTM on data/sample/bitcoin.csv (50 epochs, saves lstm_btc.pt)
#   2. Run inference: generate 7-day forecast and write to MongoDB predictions collection
#
# Prerequisites:
#   - Python 3.11+ with torch, numpy, scikit-learn, pandas, pymongo installed
#   - MongoDB running and MONGO_URI set in .env (or defaults to localhost:27017)

set -e  # exit on first error

# Navigate to project root (handles calling from any directory)
cd "$(dirname "$0")/.."

echo "[run_inference] Working directory: $(pwd)"
echo ""

# ── Step 1: Train LSTM ────────────────────────────────────────────────────────
echo "[run_inference] Step 1: Training LSTM model..."
python src/ml/train_lstm.py
echo "[run_inference] Training complete."
echo ""

# ── Step 2: Run inference ─────────────────────────────────────────────────────
echo "[run_inference] Step 2: Running inference and writing predictions to MongoDB..."
python src/ml/inference.py
echo "[run_inference] Inference complete."
echo ""
echo "[run_inference] Done. Open the dashboard at http://localhost:8501 and navigate to LSTM Predictions."
