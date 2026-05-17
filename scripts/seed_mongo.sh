#!/usr/bin/env bash
# scripts/seed_mongo.sh
# Create MongoDB collections, indexes, and TTL policies for crypto_db.
# Run once after "docker compose up -d" once mongodb is healthy.
#
# Usage: bash scripts/seed_mongo.sh

set -euo pipefail

MONGO_CONTAINER="${MONGO_CONTAINER:-mongodb}"
MONGO_USER="${MONGO_INITDB_ROOT_USERNAME:-admin}"
MONGO_PASS="${MONGO_INITDB_ROOT_PASSWORD:-password123}"
MONGO_DB="${MONGO_DB:-crypto_db}"
MONGO_URI="mongodb://${MONGO_USER}:${MONGO_PASS}@localhost:27017/${MONGO_DB}?authSource=admin"

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ── Wait for MongoDB ──────────────────────────────────────────────────────────
wait_for_mongo() {
    log_info "Waiting for MongoDB to be ready..."
    local max_retries=30
    local attempt=0
    until docker exec "${MONGO_CONTAINER}" \
            mongosh --quiet --eval "db.adminCommand('ping')" \
            > /dev/null 2>&1; do
        attempt=$((attempt + 1))
        if [ "${attempt}" -ge "${max_retries}" ]; then
            log_error "MongoDB not ready after ${max_retries} attempts. Aborting."
            exit 1
        fi
        log_warn "MongoDB not ready yet (attempt ${attempt}/${max_retries}). Retrying in 5s..."
        sleep 5
    done
    log_info "MongoDB is ready."
}

# ── Run mongosh script inside the container ───────────────────────────────────
run_mongo_script() {
    local description="$1"
    local script="$2"
    log_info "Running: ${description}"
    docker exec "${MONGO_CONTAINER}" mongosh \
        --quiet \
        "mongodb://${MONGO_USER}:${MONGO_PASS}@localhost:27017/${MONGO_DB}?authSource=admin" \
        --eval "${script}"
}

# ── Main ──────────────────────────────────────────────────────────────────────
wait_for_mongo

# ── realtime_prices ────────────────────────────────────────────────────────
# Compound index for time-series queries by coin
run_mongo_script "realtime_prices: compound index (coin, event_time)" \
    'db.realtime_prices.createIndex({ "coin": 1, "event_time": -1 }, { background: true })'

# TTL index — auto-expire documents older than 7 days (604800 seconds)
run_mongo_script "realtime_prices: TTL index on event_time (7 days)" \
    'db.realtime_prices.createIndex(
        { "event_time": 1 },
        { expireAfterSeconds: 604800, background: true }
    )'

# ── daily_stats ────────────────────────────────────────────────────────────
# Unique compound index prevents duplicate daily records per coin
run_mongo_script "daily_stats: unique compound index (symbol, date)" \
    'db.daily_stats.createIndex(
        { "symbol": 1, "date": -1 },
        { unique: true, background: true }
    )'

# ── historical_sma ─────────────────────────────────────────────────────────
run_mongo_script "historical_sma: compound index (symbol, date)" \
    'db.historical_sma.createIndex({ "symbol": 1, "date": -1 }, { background: true })'

# ── coin_correlation ───────────────────────────────────────────────────────
run_mongo_script "coin_correlation: compound index (coin_a, coin_b)" \
    'db.coin_correlation.createIndex({ "coin_a": 1, "coin_b": 1 }, { background: true })'

# ── predictions ────────────────────────────────────────────────────────────
run_mongo_script "predictions: compound index (coin, prediction_for)" \
    'db.predictions.createIndex({ "coin": 1, "prediction_for": -1 }, { background: true })'

# ── alerts ─────────────────────────────────────────────────────────────────
run_mongo_script "alerts: compound index (coin, timestamp)" \
    'db.alerts.createIndex({ "coin": 1, "timestamp": -1 }, { background: true })'

log_info "All indexes created. Listing collections in ${MONGO_DB}:"
docker exec "${MONGO_CONTAINER}" mongosh \
    --quiet \
    "mongodb://${MONGO_USER}:${MONGO_PASS}@localhost:27017/${MONGO_DB}?authSource=admin" \
    --eval 'db.getCollectionNames()'

log_info "Done."
