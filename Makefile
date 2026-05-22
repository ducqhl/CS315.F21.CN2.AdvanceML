# Makefile — Crypto Big Data Lambda Architecture
# Convenience targets for development, testing, and verification.

.PHONY: help verify test test-producer test-lstm test-batch test-dashboard \
        lint train-btc train-doge infer-btc infer-doge infer-all \
        docker-up docker-down docker-logs batch

# ── Default target ─────────────────────────────────────────────────────────────
help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "Verification:"
	@echo "  verify          Run full acceptance criteria verification"
	@echo "  test            Run full pytest suite (unit + integration)"
	@echo "  test-producer   Run producer tests only"
	@echo "  test-lstm       Run LSTM tests only"
	@echo "  test-batch      Run batch job tests only"
	@echo "  test-dashboard  Run dashboard tests only"
	@echo "  e2e             Run all E2E layers (requires Docker)"
	@echo "  e2e-layer-1     E2E Layer 1: Producer → Kafka"
	@echo "  e2e-layer-2     E2E Layer 2: Spark Batch → MongoDB"
	@echo "  e2e-layer-3     E2E Layer 3: ML Pipeline → MongoDB"
	@echo ""
	@echo "ML training:"
	@echo "  train-btc       Train LSTM on bitcoin data"
	@echo "  train-doge      Train LSTM on dogecoin data"
	@echo "  infer-btc       Run BTC inference → MongoDB"
	@echo "  infer-doge      Run DOGE inference → MongoDB"
	@echo "  infer-all       Train + infer for BTC and DOGE"
	@echo ""
	@echo "Docker:"
	@echo "  docker-up       Start all services"
	@echo "  docker-down     Stop all services"
	@echo "  docker-logs     Follow all service logs"
	@echo "  batch           Submit Spark batch job"

# ── Verification ───────────────────────────────────────────────────────────────
verify:
	@bash scripts/verify_acceptance.sh

# ── Tests ──────────────────────────────────────────────────────────────────────
test:
	python -m pytest tests/ -v --tb=short

test-producer:
	python -m pytest tests/test_producer.py -v --tb=short

test-lstm:
	python -m pytest tests/test_lstm.py -v --tb=short

test-batch:
	python -m pytest tests/test_batch_job.py -v --tb=short

test-dashboard:
	python -m pytest tests/test_dashboard.py tests/test_indicators.py tests/test_mongo_writer.py -v --tb=short

# ── E2E ────────────────────────────────────────────────────────────────────────
e2e:
	bash scripts/run_e2e.sh

e2e-layer-1:
	bash scripts/run_e2e.sh --layer 1

e2e-layer-2:
	bash scripts/run_e2e.sh --layer 2

e2e-layer-3:
	bash scripts/run_e2e.sh --layer 3

# ── ML ─────────────────────────────────────────────────────────────────────────
train-btc:
	python src/ml/train_lstm.py --coin bitcoin

train-doge:
	python src/ml/train_lstm.py --coin dogecoin

infer-btc:
	python src/ml/inference.py --coin bitcoin

infer-doge:
	python src/ml/inference.py --coin dogecoin

infer-all:
	bash scripts/run_inference.sh

# ── Docker ─────────────────────────────────────────────────────────────────────
docker-up:
	docker compose -f docker/docker-compose.yml up -d

docker-down:
	docker compose -f docker/docker-compose.yml down

docker-logs:
	docker compose -f docker/docker-compose.yml logs -f

batch:
	bash scripts/run_batch.sh
