#!/bin/bash
# run_all.sh — Full pipeline: Docker stack → Batch job → LSTM → Dashboard.
#
# Usage:
#   bash scripts/run_all.sh
#
# This script orchestrates the complete Lambda Architecture pipeline:
#   1. Start Docker stack (Kafka, Zookeeper, MongoDB, Spark)
#   2. Wait for services to be healthy
#   3. Create Kafka topics and seed MongoDB indexes
#   4. Run Spark batch job (historical stats, SMA, correlation)
#   5. Train LSTM model + run inference (7-day BTC forecast)
#   6. Open Streamlit dashboard in browser
#
# Prerequisites:
#   - Docker Desktop running
#   - Python 3.11+ with all requirements installed
#   - .env file copied from .env.example and configured

set -e

cd "$(dirname "$0")/.."
echo "[run_all] Project root: $(pwd)"
echo ""

# ── 1. Start Docker stack ─────────────────────────────────────────────────────
echo "[run_all] Step 1: Starting Docker services..."
docker compose -f docker/docker-compose.yml up -d --build
echo "[run_all] Docker services started."
echo ""

# ── 2. Wait for services to be healthy ───────────────────────────────────────
echo "[run_all] Step 2: Waiting for MongoDB and Kafka to be healthy (up to 60s)..."
MAX_WAIT=60
ELAPSED=0
until docker inspect mongodb --format='{{.State.Health.Status}}' 2>/dev/null | grep -q "healthy"; do
    if [ $ELAPSED -ge $MAX_WAIT ]; then
        echo "[run_all] ERROR: MongoDB did not become healthy within ${MAX_WAIT}s. Exiting."
        exit 1
    fi
    sleep 3
    ELAPSED=$((ELAPSED + 3))
done
echo "[run_all] MongoDB is healthy."

until docker inspect kafka --format='{{.State.Health.Status}}' 2>/dev/null | grep -q "healthy"; do
    if [ $ELAPSED -ge $MAX_WAIT ]; then
        echo "[run_all] WARNING: Kafka healthcheck timeout. Continuing anyway..."
        break
    fi
    sleep 3
    ELAPSED=$((ELAPSED + 3))
done
echo "[run_all] Kafka is ready."
echo ""

# ── 3. Create Kafka topics + seed MongoDB indexes ─────────────────────────────
echo "[run_all] Step 3: Creating Kafka topics..."
bash scripts/create_topics.sh
echo ""

echo "[run_all] Step 3b: Seeding MongoDB indexes..."
bash scripts/seed_mongo.sh
echo ""

# ── 4. Run Spark batch job ────────────────────────────────────────────────────
echo "[run_all] Step 4: Submitting Spark batch job..."
bash scripts/run_batch.sh
echo "[run_all] Batch job complete."
echo ""

# ── 5. Train LSTM + run inference ─────────────────────────────────────────────
echo "[run_all] Step 5: Training LSTM and running inference..."
bash scripts/run_inference.sh
echo "[run_all] LSTM inference complete."
echo ""

# ── 6. Open dashboard ─────────────────────────────────────────────────────────
echo "[run_all] Step 6: Starting Streamlit dashboard..."
echo "[run_all] Dashboard will be available at http://localhost:8501"
echo ""

# Detect OS and open browser accordingly
if command -v open &>/dev/null; then
    # macOS
    (sleep 3 && open http://localhost:8501) &
elif command -v xdg-open &>/dev/null; then
    # Linux
    (sleep 3 && xdg-open http://localhost:8501) &
fi

# Run dashboard in foreground (press Ctrl+C to stop)
streamlit run src/dashboard/app.py \
    --server.port 8501 \
    --server.headless true
