"""
tests/e2e/test_ml_mongo.py
E2E Layer 3 — ML Pipeline → MongoDB

What this tests:
  Train (5 epochs, real weights saved) → Inference → MongoDB predictions

  - train_lstm.train(coin="bitcoin", epochs=5) runs without error and saves
    lstm_bitcoin_v1.pt and scaler_bitcoin.pkl to a temp directory
  - train_lstm.train(coin="dogecoin", epochs=5) same for DOGE
  - inference.run_inference(coin, mongo_uri) writes 7 prediction documents
    per coin to the real MongoDB container
  - Each prediction document has the correct schema and coin symbol
  - prediction_date is in the future
  - predicted_price is a positive float

MongoDB is a real container (testcontainers).
No Spark or Kafka needed for this layer.
"""

from __future__ import annotations

import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

pytestmark = pytest.mark.e2e

_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_ROOT / "src" / "ml"))

_DATA_DIR = _ROOT / "data" / "sample"
HORIZON = 7


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def model_dir(tmp_path_factory):
    """Temporary directory for model artifacts (weights + scalers)."""
    return tmp_path_factory.mktemp("ml_models")


@pytest.fixture(scope="module")
def trained_bitcoin(model_dir):
    """Train the BTC LSTM for 5 epochs; return the metrics dict."""
    import train_lstm

    with patch.object(
        train_lstm, "_MODEL_DIR", model_dir
    ), patch.object(
        train_lstm, "_DATA_DIR", _DATA_DIR
    ):
        metrics = train_lstm.train(
            coin="bitcoin",
            epochs=5,
            batch_size=32,
            dry_run=False,
        )
    return metrics


@pytest.fixture(scope="module")
def trained_dogecoin(model_dir):
    """Train the DOGE LSTM for 5 epochs; return the metrics dict."""
    import train_lstm

    with patch.object(
        train_lstm, "_MODEL_DIR", model_dir
    ), patch.object(
        train_lstm, "_DATA_DIR", _DATA_DIR
    ):
        metrics = train_lstm.train(
            coin="dogecoin",
            epochs=5,
            batch_size=32,
            dry_run=False,
        )
    return metrics


# ── Training tests ────────────────────────────────────────────────────────────

class TestLstmTraining:

    def test_bitcoin_training_returns_metrics(self, trained_bitcoin):
        """train() must return a dict with rmse, mae, directional_accuracy_pct."""
        for key in ("rmse", "mae", "directional_accuracy_pct"):
            assert key in trained_bitcoin, f"Missing metric key: {key}"

    def test_dogecoin_training_returns_metrics(self, trained_dogecoin):
        for key in ("rmse", "mae", "directional_accuracy_pct"):
            assert key in trained_dogecoin, f"Missing metric key: {key}"

    def test_bitcoin_model_file_saved(self, trained_bitcoin, model_dir):
        """lstm_bitcoin_v2.pt must exist on disk after training."""
        model_file = model_dir / "lstm_bitcoin_v2.pt"
        assert model_file.exists(), f"Model file not found: {model_file}"

    def test_dogecoin_model_file_saved(self, trained_dogecoin, model_dir):
        """lstm_dogecoin_v2.pt must exist on disk after training."""
        model_file = model_dir / "lstm_dogecoin_v2.pt"
        assert model_file.exists(), f"Model file not found: {model_file}"

    def test_bitcoin_scaler_file_saved(self, trained_bitcoin, model_dir):
        """scaler_bitcoin.pkl must exist on disk after training."""
        scaler_file = model_dir / "scaler_bitcoin.pkl"
        assert scaler_file.exists(), f"Scaler file not found: {scaler_file}"

    def test_dogecoin_scaler_file_saved(self, trained_dogecoin, model_dir):
        """scaler_dogecoin.pkl must exist on disk after training."""
        scaler_file = model_dir / "scaler_dogecoin.pkl"
        assert scaler_file.exists(), f"Scaler file not found: {scaler_file}"

    def test_rmse_is_non_negative(self, trained_bitcoin):
        assert trained_bitcoin["rmse"] >= 0

    def test_mae_is_non_negative(self, trained_bitcoin):
        assert trained_bitcoin["mae"] >= 0

    def test_directional_accuracy_in_range(self, trained_bitcoin):
        acc = trained_bitcoin["directional_accuracy_pct"]
        assert 0.0 <= acc <= 100.0, f"directional_accuracy_pct out of range: {acc}"


# ── Inference tests ───────────────────────────────────────────────────────────

class TestInferenceToMongo:

    def _run_inference_for_coin(self, coin: str, model_dir: Path, mongo_uri: str):
        """Run inference for *coin* using models in *model_dir* → test MongoDB."""
        import inference

        with patch.object(inference, "_MODEL_DIR", model_dir), \
             patch.object(inference, "_DATA_DIR", _DATA_DIR):
            docs = inference.run_inference(coin=coin, mongo_uri=mongo_uri)
        return docs

    def test_bitcoin_inference_writes_7_predictions(
        self, trained_bitcoin, model_dir, mongo_uri, mongo_db
    ):
        """Inference for bitcoin must write exactly 7 prediction documents."""
        mongo_db["predictions"].delete_many({"coin": "BTC"})
        docs = self._run_inference_for_coin("bitcoin", model_dir, mongo_uri)
        assert len(docs) == HORIZON, f"Expected {HORIZON} docs, got {len(docs)}"

        stored = list(mongo_db["predictions"].find({"coin": "BTC"}, {"_id": 0}))
        assert len(stored) == HORIZON, (
            f"Expected {HORIZON} docs in MongoDB, got {len(stored)}"
        )

    def test_dogecoin_inference_writes_7_predictions(
        self, trained_dogecoin, model_dir, mongo_uri, mongo_db
    ):
        """Inference for dogecoin must write exactly 7 prediction documents."""
        mongo_db["predictions"].delete_many({"coin": "DOGE"})
        docs = self._run_inference_for_coin("dogecoin", model_dir, mongo_uri)
        assert len(docs) == HORIZON, f"Expected {HORIZON} docs, got {len(docs)}"

        stored = list(mongo_db["predictions"].find({"coin": "DOGE"}, {"_id": 0}))
        assert len(stored) == HORIZON

    def test_prediction_document_schema(
        self, trained_bitcoin, model_dir, mongo_uri, mongo_db
    ):
        """Every prediction document must have all required fields."""
        mongo_db["predictions"].delete_many({"coin": "BTC"})
        self._run_inference_for_coin("bitcoin", model_dir, mongo_uri)

        doc = mongo_db["predictions"].find_one({"coin": "BTC"})
        assert doc is not None

        required = {
            "coin", "predicted_price", "prediction_date",
            "confidence", "model_version", "created_at",
        }
        missing = required - set(doc.keys())
        assert not missing, f"Prediction document missing fields: {missing}"

    def test_predicted_prices_are_positive(
        self, trained_bitcoin, model_dir, mongo_uri, mongo_db
    ):
        """All predicted_price values must be > 0."""
        mongo_db["predictions"].delete_many({"coin": "BTC"})
        self._run_inference_for_coin("bitcoin", model_dir, mongo_uri)

        bad = list(mongo_db["predictions"].find(
            {"coin": "BTC", "predicted_price": {"$lte": 0}}, limit=5
        ))
        assert not bad, f"Non-positive predicted_price found: {bad}"

    def test_prediction_dates_are_in_future(
        self, trained_bitcoin, model_dir, mongo_uri, mongo_db
    ):
        """All prediction_date values must be strictly in the future."""
        mongo_db["predictions"].delete_many({"coin": "BTC"})
        self._run_inference_for_coin("bitcoin", model_dir, mongo_uri)

        now = datetime.now(timezone.utc)
        past = list(mongo_db["predictions"].find(
            {"coin": "BTC", "prediction_date": {"$lte": now}}, limit=5
        ))
        assert not past, f"Past prediction_date found: {past}"

    def test_prediction_dates_are_unique(
        self, trained_bitcoin, model_dir, mongo_uri, mongo_db
    ):
        """Each of the 7 prediction_date values must be distinct."""
        mongo_db["predictions"].delete_many({"coin": "BTC"})
        self._run_inference_for_coin("bitcoin", model_dir, mongo_uri)

        docs = list(mongo_db["predictions"].find({"coin": "BTC"}, {"prediction_date": 1}))
        dates = [d["prediction_date"] for d in docs]
        assert len(dates) == len(set(dates)), f"Duplicate prediction dates: {dates}"

    def test_model_version_is_lstm_v2(
        self, trained_bitcoin, model_dir, mongo_uri, mongo_db
    ):
        """model_version must be 'lstm_v2'."""
        mongo_db["predictions"].delete_many({"coin": "BTC"})
        self._run_inference_for_coin("bitcoin", model_dir, mongo_uri)

        docs = list(mongo_db["predictions"].find({"coin": "BTC"}, {"model_version": 1}))
        for doc in docs:
            assert doc["model_version"] == "lstm_v2", (
                f"Unexpected model_version: {doc['model_version']}"
            )

    def test_upsert_idempotency(
        self, trained_bitcoin, model_dir, mongo_uri, mongo_db
    ):
        """Running inference twice must not create duplicate documents."""
        mongo_db["predictions"].delete_many({"coin": "BTC"})
        self._run_inference_for_coin("bitcoin", model_dir, mongo_uri)
        self._run_inference_for_coin("bitcoin", model_dir, mongo_uri)  # second run

        count = mongo_db["predictions"].count_documents({"coin": "BTC"})
        assert count == HORIZON, (
            f"Expected {HORIZON} after upsert idempotency, got {count}"
        )
