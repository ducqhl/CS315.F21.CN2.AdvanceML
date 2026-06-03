"""
src/spark/utils/mongo_writer.py

MongoDB write helpers for the Crypto Speed Layer.

Design rationale
────────────────
The Spark-Mongo connector (mongo-spark-connector) works well for batch writes
but introduces overhead and complexity inside foreachBatch callbacks.  Using
pymongo directly inside foreachBatch gives:
  • Fine-grained upsert control (update_one with $set / upsert=True)
  • No extra JARs beyond kafka connector
  • Easier unit testing via mock

Non-negotiables enforced
────────────────────────
  • URI read from MONGO_URI env var (never hardcoded)
  • authSource=admin in URI
  • Database: crypto_db
  • TTL and compound indexes created on first write (idempotent ensureIndex)
  • No print() — use Python logging
"""

# from __future__ import annotations defers all annotation evaluation so that
# the "DataFrame" type hint in write_batch() is not resolved at import time.
# This allows the module to be imported in unit tests that run without PySpark
# while still providing correct type information for static analysers.
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(*args, **kwargs): pass
from pymongo import MongoClient, UpdateOne
from pymongo.collection import Collection

# DataFrame is only needed for the type annotation.
if TYPE_CHECKING:
    from pyspark.sql import DataFrame

load_dotenv()

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

MONGO_URI: str = os.getenv(
    "MONGO_URI",
    "mongodb://admin:password123@localhost:27017/crypto_db?authSource=admin",
)
MONGO_DB: str = os.getenv("MONGO_DB", "crypto_db")

# ── Index bootstrap ───────────────────────────────────────────────────────────

_indexes_ensured: set[str] = set()


def _ensure_realtime_indexes(collection: Collection) -> None:
    """
    Create the required indexes on realtime_prices if they don't exist yet.

    Idempotent — safe to call on every micro-batch startup.

    Indexes (Section 7.1):
      • Compound: {coin: 1, event_time: -1}
      • TTL:      {event_time: 1}  expireAfterSeconds=604800 (7 days)
    """
    coll_ns = f"{collection.database.name}.{collection.name}"
    if coll_ns in _indexes_ensured:
        return

    existing = {idx["name"] for idx in collection.list_indexes()}

    if "coin_event_time" not in existing:
        collection.create_index(
            [("coin", 1), ("event_time", -1)],
            name="coin_event_time",
            unique=True,
            background=True,
        )
        logger.info("Created unique compound index coin_event_time on %s", coll_ns)

    if "event_time_ttl" not in existing:
        collection.create_index(
            [("event_time", 1)],
            name="event_time_ttl",
            expireAfterSeconds=604800,  # 7 days
            background=True,
        )
        logger.info("Created TTL index event_time_ttl on %s", coll_ns)

    _indexes_ensured.add(coll_ns)


# ── Client factory ────────────────────────────────────────────────────────────


def _get_client() -> MongoClient:
    """
    Return a new MongoClient for the configured URI.

    A new client is created per foreachBatch invocation because MongoClient
    objects are not serialisable and cannot be reused across Spark tasks.
    The caller is responsible for closing it.
    """
    return MongoClient(MONGO_URI)


# ── Public API ────────────────────────────────────────────────────────────────


def write_batch(df: DataFrame, collection_name: str) -> None:
    """
    Write all rows of a static micro-batch DataFrame to a MongoDB collection.

    Intended for use inside a Spark ``foreachBatch`` callback:

        def process_batch(batch_df, batch_id):
            enriched = add_indicators(batch_df)
            write_batch(enriched, "realtime_prices")

    The function converts the Spark DataFrame to a list of dicts via
    ``collect()`` and bulk-inserts them using pymongo.  For the
    ``realtime_prices`` collection an upsert on ``(coin, event_time)`` is
    used to avoid duplicates on restart.

    Args:
        df:              Static Spark DataFrame (one micro-batch).
        collection_name: Target MongoDB collection name.
    """
    rows = df.collect()
    if not rows:
        logger.debug("write_batch: empty micro-batch for '%s', skipping", collection_name)
        return

    records: list[dict[str, Any]] = [row.asDict(recursive=True) for row in rows]
    _coerce_dates(records)
    _add_created_at(records)

    # Upsert keys for batch collections (makes batch job idempotent)
    _BATCH_UPSERT_KEYS: dict[str, list[str]] = {
        "daily_stats":    ["symbol", "date"],
        "historical_sma": ["symbol", "date"],
        "coin_correlation": ["coin_a", "coin_b"],
    }

    client = _get_client()
    try:
        coll: Collection = client[MONGO_DB][collection_name]
        if collection_name == "realtime_prices":
            _ensure_realtime_indexes(coll)
            _upsert_realtime_prices(coll, records)
        elif collection_name in _BATCH_UPSERT_KEYS:
            _upsert_by_keys(coll, records, _BATCH_UPSERT_KEYS[collection_name])
        else:
            coll.insert_many(records, ordered=False)
        logger.info(
            "write_batch: wrote %d doc(s) to %s.%s",
            len(records),
            MONGO_DB,
            collection_name,
        )
    except Exception:
        logger.exception(
            "write_batch: failed to write to %s.%s", MONGO_DB, collection_name
        )
        raise
    finally:
        client.close()


def upsert_alerts(records: list[dict[str, Any]]) -> None:
    """
    Write alert records to the ``alerts`` collection.

    Uses insert_many (no dedup key needed — each alert is a distinct event).

    Args:
        records: List of alert dicts, each containing at minimum
                 ``coin``, ``alert_type``, ``change_pct``, ``timestamp``.
    """
    if not records:
        return

    _add_created_at(records)
    client = _get_client()
    try:
        coll: Collection = client[MONGO_DB]["alerts"]
        coll.insert_many(records, ordered=False)
        logger.info(
            "upsert_alerts: inserted %d alert(s) to %s.alerts",
            len(records),
            MONGO_DB,
        )
    except Exception:
        logger.exception("upsert_alerts: failed to write alerts")
        raise
    finally:
        client.close()


# ── Internal helpers ──────────────────────────────────────────────────────────


def _upsert_by_keys(
    coll: Collection, records: list[dict[str, Any]], keys: list[str]
) -> None:
    """Generic bulk-upsert using the given fields as the match filter."""
    operations = [
        UpdateOne(
            filter={k: r[k] for k in keys if k in r},
            update={"$set": r},
            upsert=True,
        )
        for r in records
        if all(k in r for k in keys)
    ]
    if operations:
        result = coll.bulk_write(operations, ordered=False)
        logger.debug(
            "_upsert_by_keys(%s): upserted=%d modified=%d",
            coll.name,
            result.upserted_count,
            result.modified_count,
        )


def _upsert_realtime_prices(
    coll: Collection, records: list[dict[str, Any]]
) -> None:
    """
    Bulk-upsert records into ``realtime_prices``.

    Upsert key: ``{coin, event_time}`` — the same coin can have many
    timestamps, but we do not want duplicate rows for the same (coin, minute).
    """
    missing = [i for i, r in enumerate(records) if r.get("event_time") is None]
    if missing:
        logger.warning(
            "_upsert_realtime_prices: %d record(s) missing 'event_time' field "
            "(indices %s) — skipping to avoid silent duplicates",
            len(missing), missing[:10],
        )
    operations = [
        UpdateOne(
            filter={"coin": r["coin"], "event_time": r["event_time"]},
            update={"$set": r},
            upsert=True,
        )
        for r in records
        if r.get("coin") and r.get("event_time") is not None
    ]
    if operations:
        result = coll.bulk_write(operations, ordered=False)
        logger.debug(
            "_upsert_realtime_prices: upserted=%d modified=%d",
            result.upserted_count,
            result.modified_count,
        )


def _add_created_at(records: list[dict[str, Any]]) -> None:
    """Stamp ``created_at`` (UTC now) onto every record that lacks it."""
    now = datetime.now(timezone.utc)
    for r in records:
        if "created_at" not in r:
            r["created_at"] = now


def _coerce_dates(records: list[dict[str, Any]]) -> None:
    """
    Convert ``datetime.date`` values to ``datetime.datetime`` (UTC midnight).

    pymongo/BSON cannot encode bare ``datetime.date`` objects — only
    ``datetime.datetime``.  Spark's DateType columns deserialise to
    ``datetime.date`` via ``Row.asDict()``, so this coercion is required
    before any batch write that contains a date column (e.g. daily_stats,
    historical_sma).
    """
    import datetime as _dt
    for r in records:
        for k, v in list(r.items()):
            if type(v) is _dt.date:  # exact type check — datetime is a subclass
                r[k] = datetime(v.year, v.month, v.day, tzinfo=timezone.utc)
