# src/producer/Dockerfile
# Multi-stage build for the Kafka producer service.
# Base: python:3.11-slim (Section 3.4)

# ── Stage 1: dependency installation ─────────────────────────────────────────
FROM python:3.11-slim AS deps

WORKDIR /app

# Install system packages needed by requests (CA certificates)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

# Non-root user for security
RUN groupadd -g 1001 producer \
    && useradd -u 1001 -g producer -s /bin/sh -m producer

WORKDIR /app

# CA certs for HTTPS calls to CoinGecko
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy installed packages from deps stage
COPY --from=deps /usr/local/lib/python3.11/site-packages \
                 /usr/local/lib/python3.11/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin

# Copy application source
COPY --chown=producer:producer crypto_producer.py .

USER producer

# Environment variable defaults (override via docker-compose env_file or environment:)
ENV KAFKA_BOOTSTRAP_SERVERS=kafka:29092 \
    KAFKA_TOPIC_RAW=crypto_raw \
    POLL_INTERVAL_SECONDS=60 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import kafka; kafka.KafkaProducer" 2>/dev/null || exit 1

CMD ["python", "crypto_producer.py"]
