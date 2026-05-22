#!/bin/bash
# scripts/run_e2e.sh
# Full end-to-end test runner using testcontainers (Docker managed by pytest).
#
# What this does:
#   1. Validates prerequisites (Docker, Python deps)
#   2. Installs testcontainers if missing
#   3. Runs the three E2E test layers:
#      Layer 1 — Producer → Kafka          (test_producer_kafka.py)
#      Layer 2 — Spark Batch → MongoDB     (test_batch_mongo.py)
#      Layer 3 — ML Pipeline → MongoDB     (test_ml_mongo.py)
#   4. Reports pass/fail summary and exits with code 0 or 1
#
# Usage:
#   bash scripts/run_e2e.sh [--layer <1|2|3>] [--no-color]
#
# Options:
#   --layer N      Run only layer N (1, 2, or 3)
#   --no-color     Disable coloured output
#
# Requirements:
#   - Docker daemon running
#   - Python 3.11+
#   - pip packages: testcontainers[kafka,mongodb], pytest, kafka-python,
#                   pymongo, pyspark, torch, numpy, scikit-learn, pandas

set -euo pipefail
cd "$(dirname "$0")/.."

# ── Colours ───────────────────────────────────────────────────────────────────
NO_COLOR=false
for arg in "$@"; do [[ "$arg" == "--no-color" ]] && NO_COLOR=true; done

if $NO_COLOR; then
    GREEN=""; RED=""; YELLOW=""; BLUE=""; NC=""
else
    GREEN='\033[0;32m'; RED='\033[0;31m'
    YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
fi

_info()    { echo -e "${BLUE}[e2e]${NC} $*"; }
_ok()      { echo -e "${GREEN}[e2e] OK${NC}  $*"; }
_fail()    { echo -e "${RED}[e2e] FAIL${NC} $*"; }
_section() { echo -e "\n${YELLOW}══ $* ══${NC}"; }

# ── Argument parsing ──────────────────────────────────────────────────────────
LAYER=""
for arg in "$@"; do
    if [[ "$arg" == "--layer" ]]; then LAYER_NEXT=true
    elif [[ "${LAYER_NEXT:-}" == "true" ]]; then LAYER="$arg"; LAYER_NEXT=false; fi
done

# ── Prerequisites ─────────────────────────────────────────────────────────────
_section "Prerequisites"

# Docker
if ! docker info >/dev/null 2>&1; then
    _fail "Docker daemon is not running. Start Docker and retry."
    exit 1
fi
_ok "Docker is running"

# Python
PYTHON=$(command -v python3 || command -v python)
if [[ -z "$PYTHON" ]]; then
    _fail "Python 3 not found in PATH"
    exit 1
fi
PY_VER=$($PYTHON --version 2>&1)
_ok "Python: $PY_VER"

# testcontainers
if ! $PYTHON -c "import testcontainers" 2>/dev/null; then
    _info "Installing testcontainers..."
    pip install "testcontainers[kafka,mongodb]" -q
fi
_ok "testcontainers available"

# Other deps
MISSING_DEPS=()
for pkg in pytest kafka pymongo pyspark torch numpy sklearn pandas; do
    if ! $PYTHON -c "import $pkg" 2>/dev/null; then
        MISSING_DEPS+=("$pkg")
    fi
done
if [[ ${#MISSING_DEPS[@]} -gt 0 ]]; then
    _fail "Missing Python packages: ${MISSING_DEPS[*]}"
    echo "Install with:"
    echo "  pip install pytest kafka-python pymongo pyspark torch numpy scikit-learn pandas"
    exit 1
fi
_ok "All Python dependencies present"

# ── Layer selection ───────────────────────────────────────────────────────────
_section "Running E2E tests"

PYTEST_BASE="$PYTHON -m pytest -v --tb=short -m e2e"
FAILED=0
RESULTS=()

run_layer() {
    local num="$1"
    local file="$2"
    local label="$3"

    if [[ -n "$LAYER" && "$LAYER" != "$num" ]]; then
        return
    fi

    _info "Layer $num: $label"
    if $PYTEST_BASE "tests/e2e/$file" 2>&1; then
        _ok "Layer $num passed"
        RESULTS+=("${GREEN}PASS${NC} Layer $num — $label")
    else
        _fail "Layer $num failed"
        RESULTS+=("${RED}FAIL${NC} Layer $num — $label")
        FAILED=$((FAILED + 1))
    fi
}

run_layer 1 "test_producer_kafka.py" "Producer → Kafka"
run_layer 2 "test_batch_mongo.py"    "Spark Batch → MongoDB"
run_layer 3 "test_ml_mongo.py"       "ML Pipeline → MongoDB"

# ── Summary ───────────────────────────────────────────────────────────────────
_section "E2E Summary"
for r in "${RESULTS[@]}"; do
    echo -e "  $r"
done
echo ""

if [[ $FAILED -eq 0 ]]; then
    echo -e "${GREEN}All E2E layers passed.${NC}"
    exit 0
else
    echo -e "${RED}$FAILED layer(s) failed.${NC}"
    exit 1
fi
