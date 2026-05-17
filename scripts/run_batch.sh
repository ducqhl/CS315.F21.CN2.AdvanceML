#!/usr/bin/env bash
# scripts/run_batch.sh
# Submit the Spark batch job to process historical crypto data.
#
# Modes
# ─────
#   Default  — uses the full G-Research dataset (data/g-research/train.csv)
#   SAMPLE   — uses the bundled sample CSVs   (data/sample/*.csv)
#              Set env var: SAMPLE_MODE=1  or  SAMPLE_MODE=true
#
# Pre-requisites:
#   • docker compose stack running (spark-master, mongodb)
#   • G-Research CSV present at data/g-research/train.csv  (default mode)
#     OR sample CSVs present at data/sample/*.csv           (sample mode)
#
# Usage:
#   bash scripts/run_batch.sh                   # G-Research mode
#   SAMPLE_MODE=1 bash scripts/run_batch.sh     # Sample CSV mode

set -euo pipefail

SPARK_CONTAINER="${SPARK_CONTAINER:-spark-master}"
SPARK_MASTER="spark://spark-master:7077"
APP_PATH="/app/src/spark/batch_job.py"

# Exact package versions pinned — do NOT change without updating streaming_job.py too
SPARK_PACKAGES=(
    "org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.1"
    "org.mongodb.spark:mongo-spark-connector_2.12:10.2.1"
)

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ── Detect mode ───────────────────────────────────────────────────────────────
SAMPLE_MODE="${SAMPLE_MODE:-0}"
if [[ "${SAMPLE_MODE}" == "1" || "${SAMPLE_MODE,,}" == "true" ]]; then
    DATA_PATH="/app/data/sample/*.csv"
    DATA_LABEL="sample CSVs"
    CONTAINER_CHECK_DIR="/app/data/sample"
else
    DATA_PATH="/app/data/g-research/train.csv"
    DATA_LABEL="G-Research dataset"
    CONTAINER_CHECK_DIR="/app/data/g-research"
fi

log_info "Mode       : ${DATA_LABEL}"
log_info "DATA_PATH  : ${DATA_PATH}"

# ── Guard: check data exists ──────────────────────────────────────────────────
if ! docker exec "${SPARK_CONTAINER}" test -d "${CONTAINER_CHECK_DIR}"; then
    log_error "Data directory not found inside container: ${CONTAINER_CHECK_DIR}"
    if [[ "${SAMPLE_MODE}" == "1" || "${SAMPLE_MODE,,}" == "true" ]]; then
        log_error "Expected sample CSVs at: data/sample/bitcoin.csv, ethereum.csv, dogecoin.csv"
    else
        log_error "Download the G-Research dataset from:"
        log_error "  https://www.kaggle.com/competitions/g-research-crypto-forecasting"
        log_error "and place it at: data/g-research/train.csv"
        log_error ""
        log_error "To run with sample data instead: SAMPLE_MODE=1 bash scripts/run_batch.sh"
    fi
    exit 1
fi

log_info "Data found. Submitting Spark batch job..."

# ── Build packages string ─────────────────────────────────────────────────────
PACKAGES_STR=$(IFS=','; echo "${SPARK_PACKAGES[*]}")

# ── spark-submit ──────────────────────────────────────────────────────────────
docker exec \
    -e "DATA_PATH=${DATA_PATH}" \
    -e "MONGO_URI=${MONGO_URI:-mongodb://admin:password123@mongodb:27017/crypto_db?authSource=admin}" \
    "${SPARK_CONTAINER}" \
    spark-submit \
        --master "${SPARK_MASTER}" \
        --packages "${PACKAGES_STR}" \
        --conf "spark.sql.session.timeZone=UTC" \
        --conf "spark.executor.memory=2g" \
        --conf "spark.driver.memory=2g" \
        --conf "spark.sql.shuffle.partitions=8" \
        --conf "spark.sql.adaptive.enabled=true" \
        "${APP_PATH}"

log_info "Batch job completed."
log_info "Verify results in MongoDB:"
log_info "  mongosh '${MONGO_URI:-mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin}' \\"
log_info "    --eval 'printjson({daily_stats: db.daily_stats.countDocuments(), historical_sma: db.historical_sma.countDocuments(), coin_correlation: db.coin_correlation.countDocuments()})'"
