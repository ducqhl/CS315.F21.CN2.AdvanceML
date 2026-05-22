"""
tests/e2e/conftest.py
Session-scoped fixtures that start real Docker containers for E2E tests.

Containers started:
  - MongoDB 7.0        (one per session, shared by all e2e tests)
  - Kafka + Zookeeper  (one per session, shared by all e2e tests)

Requires:
  pip install "testcontainers[kafka,mongodb]"

Skip guard:
  If Docker is not available the session fixture raises pytest.skip so
  the E2E suite is skipped cleanly rather than erroring.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import pytest

# ── Path setup ────────────────────────────────────────────────────────────────
_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_ROOT / "src" / "producer"))
sys.path.insert(0, str(_ROOT / "src" / "spark"))
sys.path.insert(0, str(_ROOT / "src" / "ml"))

E2E_DB = "e2e_test_db"   # separate DB so tests never touch crypto_db


# ── Docker availability guard ─────────────────────────────────────────────────

_DOCKER_SOCKETS = [
    "/var/run/docker.sock",
    os.path.expanduser("~/.docker/run/docker.sock"),   # Docker Desktop (Mac)
    os.path.expanduser("~/.docker/desktop/docker.sock"),
]


def _ensure_docker_host() -> bool:
    """
    Try each known Docker socket path and set DOCKER_HOST so the Python SDK
    (and testcontainers) can reach Docker Desktop on macOS.
    Returns True if a working socket is found.
    """
    import docker

    # If DOCKER_HOST is already set and works, use it as-is.
    if os.environ.get("DOCKER_HOST"):
        try:
            docker.from_env(timeout=5).ping()
            return True
        except Exception:
            pass

    for sock in _DOCKER_SOCKETS:
        if os.path.exists(sock):
            os.environ["DOCKER_HOST"] = f"unix://{sock}"
            try:
                docker.from_env(timeout=5).ping()
                return True
            except Exception:
                continue

    return False


def _docker_available() -> bool:
    try:
        return _ensure_docker_host()
    except Exception:
        return False


# ── MongoDB container ─────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def mongo_container():
    """Start a MongoDB 7.0 container; skip if Docker is unavailable."""
    if not _docker_available():
        pytest.skip("Docker not available — skipping E2E tests")

    from testcontainers.mongodb import MongoDbContainer
    with MongoDbContainer("mongo:7.0") as container:
        # Allow the server a moment to be fully ready
        time.sleep(1)
        yield container


@pytest.fixture(scope="session")
def mongo_uri(mongo_container) -> str:
    """Return the MongoDB URI pointing at the test container."""
    base = mongo_container.get_connection_url()
    # Append the E2E database name and authSource
    # testcontainers returns  mongodb://root:example@host:port
    return f"{base.rstrip('/')}/{E2E_DB}?authSource=admin"


@pytest.fixture(scope="session")
def mongo_db(mongo_uri):
    """Return the pymongo Database handle for E2E assertions."""
    import pymongo
    client = pymongo.MongoClient(mongo_uri)
    db = client[E2E_DB]
    yield db
    # Cleanup: drop the test database after the session
    client.drop_database(E2E_DB)
    client.close()


# ── Kafka container ───────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def kafka_container():
    """Start a Kafka container; skip if Docker is unavailable."""
    if not _docker_available():
        pytest.skip("Docker not available — skipping E2E tests")

    from testcontainers.kafka import KafkaContainer
    with KafkaContainer("confluentinc/cp-kafka:7.5.0") as container:
        time.sleep(2)   # give broker time to be leader-elected
        yield container


@pytest.fixture(scope="session")
def kafka_bootstrap(kafka_container) -> str:
    """Return the Kafka bootstrap server string for this session."""
    return kafka_container.get_bootstrap_server()


@pytest.fixture(scope="session")
def kafka_topic(kafka_bootstrap) -> str:
    """
    Create the crypto_raw topic and return its name.
    Uses kafka-python's KafkaAdminClient to create the topic programmatically.
    """
    from kafka.admin import KafkaAdminClient, NewTopic
    from kafka.errors import TopicAlreadyExistsError

    topic = "crypto_raw_e2e"
    admin = KafkaAdminClient(
        bootstrap_servers=kafka_bootstrap,
        client_id="e2e-admin",
    )
    try:
        admin.create_topics([
            NewTopic(name=topic, num_partitions=2, replication_factor=1)
        ])
    except TopicAlreadyExistsError:
        pass
    finally:
        admin.close()

    return topic
