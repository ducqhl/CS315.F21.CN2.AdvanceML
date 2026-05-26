#!/usr/bin/env bash
# scripts/create_topics.sh
# Create all required Kafka topics for the Crypto Big Data project.
# Run after "docker compose up -d" once the kafka service is healthy.
#
# Usage: bash scripts/create_topics.sh

set -euo pipefail

KAFKA_CONTAINER="${KAFKA_CONTAINER:-kafka}"
# Inside the Kafka container itself localhost:9092 works; override via
# KAFKA_BOOTSTRAP_SERVERS when running from a different Docker service.
BOOTSTRAP="${KAFKA_BOOTSTRAP_SERVERS:-localhost:9092}"

# ── Colours for output ────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ── Wait for Kafka to be ready ────────────────────────────────────────────────
wait_for_kafka() {
    log_info "Waiting for Kafka broker to be ready..."
    local max_retries=30
    local attempt=0
    until docker exec "${KAFKA_CONTAINER}" \
            kafka-topics --bootstrap-server "${BOOTSTRAP}" --list \
            > /dev/null 2>&1; do
        attempt=$((attempt + 1))
        if [ "${attempt}" -ge "${max_retries}" ]; then
            log_error "Kafka not ready after ${max_retries} attempts. Aborting."
            exit 1
        fi
        log_warn "Kafka not ready yet (attempt ${attempt}/${max_retries}). Retrying in 5s..."
        sleep 5
    done
    log_info "Kafka is ready."
}

# ── Create a topic (idempotent — skip if already exists) ─────────────────────
create_topic() {
    local topic="$1"
    local partitions="$2"
    local replication="$3"
    local retention_ms="$4"

    # Check if topic already exists
    if docker exec "${KAFKA_CONTAINER}" \
            kafka-topics --bootstrap-server "${BOOTSTRAP}" \
            --describe --topic "${topic}" > /dev/null 2>&1; then
        log_warn "Topic '${topic}' already exists — skipping."
        return 0
    fi

    docker exec "${KAFKA_CONTAINER}" \
        kafka-topics \
        --bootstrap-server "${BOOTSTRAP}" \
        --create \
        --topic "${topic}" \
        --partitions "${partitions}" \
        --replication-factor "${replication}" \
        --config "retention.ms=${retention_ms}"

    log_info "Created topic '${topic}' (partitions=${partitions}, retention=${retention_ms}ms)."
}

# ── Main ──────────────────────────────────────────────────────────────────────
wait_for_kafka

# crypto_raw — 3 partitions, 7 days retention (604800000 ms)
# 7 coins × 1 msg/60s → 3 partitions allows 3 Spark workers to read in parallel
# Key-based partitioning ensures same coin always lands on same partition
create_topic "crypto_raw"         3 1 604800000

# crypto_alerts — 1 partition, 1 day retention (86400000 ms)
# Low-volume alert stream; ordering within alert type is important → 1 partition
create_topic "crypto_alerts"      1 1 86400000

# crypto_predictions — 1 partition, 1 day retention (86400000 ms)
# LSTM inference output; low-volume, 1 prediction per coin per inference cycle
create_topic "crypto_predictions" 1 1 86400000

log_info "All topics created. Listing:"
docker exec "${KAFKA_CONTAINER}" \
    kafka-topics --bootstrap-server "${BOOTSTRAP}" --list

log_info "Done."
