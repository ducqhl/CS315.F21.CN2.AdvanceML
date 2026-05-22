#!/bin/bash
# scripts/verify_acceptance.sh
# Verifies all acceptance criteria for the CoinGecko BTC+DOGE integration.
#
# Usage:
#   bash scripts/verify_acceptance.sh
#
# Exit code: 0 = all passed, 1 = one or more failures.

set -euo pipefail
cd "$(dirname "$0")/.."

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'  # No colour

PASS=0
FAIL=0

_pass() { echo -e "${GREEN}  PASS${NC}  $1"; PASS=$((PASS + 1)); }
_fail() { echo -e "${RED}  FAIL${NC}  $1"; FAIL=$((FAIL + 1)); }
_section() { echo -e "\n${YELLOW}── $1 ──────────────────────────────────────────${NC}"; }

# ── 1. Source-code static checks ──────────────────────────────────────────────
_section "Static source checks"

# Only BTC + DOGE tracked
count=$(python3 -c "
import sys
sys.path.insert(0, 'src/producer')
import crypto_producer as cp
print(len(cp.COINS))
" 2>/dev/null)
if [ "$count" = "2" ]; then
    _pass "COINS list has exactly 2 entries (BTC + DOGE)"
else
    _fail "COINS list should have 2 entries, got: $count"
fi

# pycoingecko SDK used
if grep -q "from pycoingecko import" src/producer/crypto_producer.py; then
    _pass "pycoingecko SDK imported in crypto_producer.py"
else
    _fail "pycoingecko SDK not found in crypto_producer.py"
fi

# linger_ms=100 present
if grep -q "linger_ms=100" src/producer/crypto_producer.py; then
    _pass "linger_ms=100 present in build_producer()"
else
    _fail "linger_ms=100 missing from build_producer()"
fi

# Poll interval default 600s
if grep -q '"600"' src/producer/crypto_producer.py || grep -q "'600'" src/producer/crypto_producer.py; then
    _pass "Default POLL_INTERVAL_SECONDS is '600'"
else
    _fail "Default POLL_INTERVAL_SECONDS is not '600'"
fi

# OHLC fields in message schema
if grep -q '"open"' src/producer/crypto_producer.py; then
    _pass "OHLC field 'open' present in transform_to_record()"
else
    _fail "OHLC field 'open' missing from transform_to_record()"
fi

# Spark schema updated
if grep -q 'StructField.*"open"' src/spark/streaming_job.py; then
    _pass "CRYPTO_SCHEMA contains 'open' StructField"
else
    _fail "CRYPTO_SCHEMA missing 'open' StructField"
fi

# Split ratio 80/10/10
if grep -q "TRAIN_RATIO = 0.80" src/ml/preprocess.py; then
    _pass "TRAIN_RATIO = 0.80 in preprocess.py"
else
    _fail "TRAIN_RATIO != 0.80 in preprocess.py"
fi

# Batch size 64
if grep -q "BATCH_SIZE = 64" src/ml/train_lstm.py; then
    _pass "BATCH_SIZE = 64 in train_lstm.py"
else
    _fail "BATCH_SIZE != 64 in train_lstm.py"
fi

# Model filenames versioned (template contains v1)
if grep -q "lstm_{coin}_v1.pt" src/ml/train_lstm.py; then
    _pass "Model filename template 'lstm_{coin}_v1.pt' in train_lstm.py"
else
    _fail "Versioned model filename template missing from train_lstm.py"
fi

# requirements.txt has pycoingecko
if grep -q "pycoingecko" src/producer/requirements.txt; then
    _pass "pycoingecko in src/producer/requirements.txt"
else
    _fail "pycoingecko missing from src/producer/requirements.txt"
fi

# ── 2. File existence checks ──────────────────────────────────────────────────
_section "File existence"

if [ -f README.md ]; then
    lines=$(wc -l < README.md)
    if [ "$lines" -gt 50 ]; then
        _pass "README.md exists ($lines lines > 50)"
    else
        _fail "README.md exists but is too short ($lines lines)"
    fi
else
    _fail "README.md not found"
fi

if [ -f .env.example ]; then
    if grep -q "POLL_INTERVAL_SECONDS=600" .env.example && grep -q "COINGECKO_COIN_IDS" .env.example; then
        _pass ".env.example has POLL_INTERVAL_SECONDS=600 and COINGECKO_COIN_IDS"
    else
        _fail ".env.example missing POLL_INTERVAL_SECONDS=600 or COINGECKO_COIN_IDS"
    fi
else
    _fail ".env.example not found"
fi

# ── 3. Docker Compose validity ────────────────────────────────────────────────
_section "Docker Compose"

if docker compose -f docker/docker-compose.yml config --quiet 2>/dev/null; then
    _pass "docker-compose.yml is valid"
else
    _fail "docker-compose.yml is invalid (docker compose config failed)"
fi

# ── 4. Python compile checks ──────────────────────────────────────────────────
_section "Python syntax"

for f in src/producer/crypto_producer.py src/spark/streaming_job.py src/spark/batch_job.py \
          src/ml/preprocess.py src/ml/train_lstm.py src/ml/inference.py \
          src/dashboard/app.py; do
    if python3 -m py_compile "$f" 2>/dev/null; then
        _pass "py_compile OK: $f"
    else
        _fail "py_compile FAILED: $f"
    fi
done

# ── 5. LSTM dry-run ───────────────────────────────────────────────────────────
_section "LSTM dry-run (bitcoin + dogecoin)"

for coin in bitcoin dogecoin; do
    output=$(python3 src/ml/train_lstm.py --dry-run --coin "$coin" 2>&1)
    if echo "$output" | grep -qi "dry-run\|metrics\|rmse" ; then
        _pass "train_lstm.py --dry-run --coin $coin completed"
    else
        _fail "train_lstm.py --dry-run --coin $coin failed or produced no output"
        echo "$output" | tail -5
    fi
done

# ── 6. Full test suite ────────────────────────────────────────────────────────
_section "pytest (full suite)"

test_output=$(python3 -m pytest tests/ --tb=short -q 2>&1)
if echo "$test_output" | grep -q "failed\|error"; then
    _fail "pytest: one or more test failures"
    echo "$test_output" | tail -20
else
    total=$(echo "$test_output" | grep -oE "[0-9]+ passed" | grep -oE "[0-9]+" || echo "?")
    _pass "pytest: $total tests passed, 0 failures"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo -e "  ${GREEN}PASSED${NC}: $PASS"
if [ "$FAIL" -gt 0 ]; then
    echo -e "  ${RED}FAILED${NC}: $FAIL"
    echo "═══════════════════════════════════════════════════"
    exit 1
else
    echo -e "  ${RED}FAILED${NC}: $FAIL"
    echo -e "  ${GREEN}All checks passed!${NC}"
    echo "═══════════════════════════════════════════════════"
    exit 0
fi
