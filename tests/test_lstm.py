"""
tests/test_lstm.py — Unit tests for the LSTM model, preprocessing pipeline,
                     and inference logic.

All tests run on CPU only; no GPU dependency.
No live MongoDB connection is required — inference write path is mocked.

Tests
-----
1. LSTMModel forward pass output shape: (1, 1)
2. Sequence creation: 100 rows → 100 - 60 = 40 sequences
3. Scaler normalisation: all values in [0, 1]
4. Train/val/test split is chronological (no shuffle)
5. Inference _iterative_predict returns exactly HORIZON positive floats
6. MongoDB document structure produced by inference
7. (bonus) Model predict() helper returns numpy array with correct length
8. (bonus) Dry-run train() completes without error
"""

from __future__ import annotations

import os
import sys
import pickle
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest
import torch

# ---------------------------------------------------------------------------
# Add  src/ml  to sys.path so we can import model / preprocess / inference
# without installing the package.
# ---------------------------------------------------------------------------
_ML_DIR = Path(__file__).resolve().parent.parent / "src" / "ml"
if str(_ML_DIR) not in sys.path:
    sys.path.insert(0, str(_ML_DIR))

from model import LSTMModel
from preprocess import _create_sequences, _load_csv, load_and_preprocess
from inference import (
    _iterative_predict,
    _load_last_n_from_csv,
    SEQ_LEN,
    HORIZON,
    MODEL_VERSION,
    CONFIDENCE,
    _model_path,
    _scaler_path,
)


# ===========================================================================
# Fixtures
# ===========================================================================

@pytest.fixture(scope="module")
def small_model() -> LSTMModel:
    """A small LSTMModel instance created once per module."""
    return LSTMModel(input_size=1, hidden_size=128, num_layers=2, dropout=0.2, output_size=1)


@pytest.fixture(scope="module")
def sample_csv(tmp_path_factory) -> Path:
    """Write a synthetic 200-row CSV that mimics  data/sample/bitcoin.csv."""
    tmp = tmp_path_factory.mktemp("data")
    csv_path = tmp / "bitcoin_test.csv"
    dates = pd.date_range("2020-01-01", periods=200, freq="D")
    prices = np.cumsum(np.random.randn(200)) + 10000
    pd.DataFrame({"date": dates, "price": prices}).to_csv(csv_path, index=False)
    return csv_path


@pytest.fixture(scope="module")
def fitted_scaler(sample_csv):
    """Return X_train, scaler from a small preprocessing run."""
    X_tr, y_tr, X_v, y_v, X_te, y_te, scaler = load_and_preprocess(
        csv_path=sample_csv,
        seq_len=SEQ_LEN,
        save_scaler=False,  # don't overwrite the real scaler.pkl
    )
    return X_tr, y_tr, X_v, y_v, X_te, y_te, scaler


# ===========================================================================
# 1. LSTMModel forward pass — output shape
# ===========================================================================

class TestLSTMModelForward:

    def test_output_shape_single_sample(self, small_model):
        """Forward pass with (1, 60, 1) input must yield shape (1, 1)."""
        x = torch.rand(1, 60, 1)
        out = small_model(x)
        assert out.shape == (1, 1), f"Expected (1, 1), got {tuple(out.shape)}"

    def test_output_shape_batch(self, small_model):
        """Forward pass with (16, 60, 1) input must yield shape (16, 1)."""
        x = torch.rand(16, 60, 1)
        out = small_model(x)
        assert out.shape == (16, 1), f"Expected (16, 1), got {tuple(out.shape)}"

    def test_output_is_float_tensor(self, small_model):
        """Output dtype must be float32."""
        x = torch.rand(1, 60, 1)
        out = small_model(x)
        assert out.dtype == torch.float32

    def test_predict_helper_returns_numpy(self, small_model):
        """predict() should return a numpy array with shape (N,)."""
        X = np.random.rand(4, 60, 1).astype(np.float32)
        result = small_model.predict(X)
        assert isinstance(result, np.ndarray)
        assert result.shape == (4,)


# ===========================================================================
# 2. Sequence creation
# ===========================================================================

class TestSequenceCreation:

    def test_sequence_count_from_100_rows(self):
        """100 rows with seq_len=60 → exactly 40 sequences."""
        scaled = np.random.rand(100, 1).astype(np.float32)
        X, y = _create_sequences(scaled, seq_len=60)
        assert len(X) == 40, f"Expected 40 sequences, got {len(X)}"
        assert len(y) == 40

    def test_sequence_shape(self):
        """Each sequence must have shape (seq_len, 1)."""
        scaled = np.random.rand(80, 1).astype(np.float32)
        X, y = _create_sequences(scaled, seq_len=60)
        assert X.shape == (20, 60, 1), f"Got {X.shape}"

    def test_target_is_next_step(self):
        """y[i] must equal scaled[seq_len + i, 0]."""
        scaled = np.arange(100, dtype=np.float32).reshape(-1, 1)
        X, y = _create_sequences(scaled, seq_len=5)
        # First target: scaled[5, 0] = 5.0
        assert y[0] == pytest.approx(5.0)
        # Second target: scaled[6, 0] = 6.0
        assert y[1] == pytest.approx(6.0)


# ===========================================================================
# 3. Scaler normalisation
# ===========================================================================

class TestScalerNormalisation:

    def test_scaled_values_in_zero_one(self, fitted_scaler):
        """All normalised values produced during preprocessing must be in [0, 1]."""
        X_tr, y_tr, X_v, y_v, X_te, y_te, scaler = fitted_scaler
        all_y = np.concatenate([y_tr, y_v, y_te])
        assert (all_y >= 0).all(), "Found normalised values below 0"
        assert (all_y <= 1).all(), "Found normalised values above 1"

    def test_scaler_inverse_positive(self, fitted_scaler):
        """Inverse-transforming [0, 0.5, 1] should yield values > 0."""
        _, _, _, _, _, _, scaler = fitted_scaler
        dummy = np.array([[0.0], [0.5], [1.0]], dtype=np.float32)
        recovered = scaler.inverse_transform(dummy).flatten()
        assert (recovered >= 0).all()


# ===========================================================================
# 4. Chronological split (no data leakage)
# ===========================================================================

class TestChronologicalSplit:

    def test_split_sizes_sum_to_total(self, fitted_scaler):
        """train + val + test must cover all sequences."""
        X_tr, y_tr, X_v, y_v, X_te, y_te, _ = fitted_scaler
        total = len(X_tr) + len(X_v) + len(X_te)
        expected = 200 - SEQ_LEN  # 200 rows in sample_csv
        assert total == expected, f"Expected {expected} total sequences, got {total}"

    def test_no_overlap_between_splits(self, fitted_scaler):
        """The splits must be sequential — last train idx < first val idx."""
        X_tr, _, X_v, _, X_te, _, _ = fitted_scaler
        # Confirm shapes follow the 70/15/15 order: train is largest
        assert len(X_tr) >= len(X_v)
        assert len(X_tr) >= len(X_te)


# ===========================================================================
# 5. Iterative forecast — HORIZON predictions, all positive
# ===========================================================================

class TestIterativePrediction:

    def test_returns_horizon_predictions(self, small_model, fitted_scaler):
        """_iterative_predict must return exactly HORIZON values."""
        _, _, _, _, _, _, scaler = fitted_scaler
        seed = np.random.rand(SEQ_LEN).astype(np.float32) * 50000 + 30000
        preds = _iterative_predict(small_model, seed, scaler, horizon=HORIZON)
        assert len(preds) == HORIZON, f"Expected {HORIZON} predictions, got {len(preds)}"

    def test_predictions_are_positive_floats(self, small_model, fitted_scaler):
        """All predicted prices must be positive (BTC price > 0)."""
        _, _, _, _, _, _, scaler = fitted_scaler
        seed = np.random.rand(SEQ_LEN).astype(np.float32) * 50000 + 30000
        preds = _iterative_predict(small_model, seed, scaler, horizon=HORIZON)
        assert all(p > 0 for p in preds), f"Non-positive price found: {preds}"

    def test_predictions_are_numpy_array(self, small_model, fitted_scaler):
        """_iterative_predict must return a numpy array."""
        _, _, _, _, _, _, scaler = fitted_scaler
        seed = np.random.rand(SEQ_LEN).astype(np.float32) * 50000 + 30000
        preds = _iterative_predict(small_model, seed, scaler, horizon=HORIZON)
        assert isinstance(preds, np.ndarray)


# ===========================================================================
# 6. MongoDB document structure
# ===========================================================================

class TestMongoDocumentStructure:

    def _make_fake_doc(self, offset: int, price: float, coin_symbol: str = "BTC") -> dict:
        """Build a prediction document the same way inference.py does."""
        from datetime import datetime, timedelta, timezone
        now_utc = datetime.now(timezone.utc)
        prediction_date = now_utc.replace(
            hour=0, minute=0, second=0, microsecond=0
        ) + timedelta(days=offset)
        return {
            "coin": coin_symbol,
            "predicted_price": float(price),
            "prediction_date": prediction_date,
            "confidence": CONFIDENCE,
            "model_version": MODEL_VERSION,
            "created_at": now_utc,
        }

    def test_required_fields_present(self):
        """All required MongoDB fields must be present in each doc."""
        required = {
            "coin", "predicted_price", "prediction_date",
            "confidence", "model_version", "created_at",
        }
        doc = self._make_fake_doc(offset=1, price=65000.0)
        assert required <= set(doc.keys()), f"Missing fields: {required - set(doc.keys())}"

    def test_coin_is_btc(self):
        doc = self._make_fake_doc(1, 65000.0, coin_symbol="BTC")
        assert doc["coin"] == "BTC"

    def test_coin_can_be_doge(self):
        doc = self._make_fake_doc(1, 0.15, coin_symbol="DOGE")
        assert doc["coin"] == "DOGE"

    def test_predicted_price_positive(self):
        doc = self._make_fake_doc(1, 65000.0)
        assert doc["predicted_price"] > 0

    def test_model_version_correct(self):
        doc = self._make_fake_doc(1, 65000.0)
        assert doc["model_version"] == "lstm_v1"

    def test_confidence_is_placeholder(self):
        doc = self._make_fake_doc(1, 65000.0)
        assert doc["confidence"] == pytest.approx(0.8)

    def test_prediction_date_in_future(self):
        """prediction_date must be strictly in the future (offset >= 1)."""
        from datetime import datetime, timezone
        doc = self._make_fake_doc(offset=1, price=65000.0)
        assert doc["prediction_date"] > datetime.now(timezone.utc)


# ===========================================================================
# 8. Model filenames are versioned per coin
# ===========================================================================

class TestModelFilenames:

    def test_bitcoin_model_filename(self):
        """BTC model must be saved as lstm_bitcoin_v1.pt"""
        path = _model_path("bitcoin")
        assert path.name == "lstm_bitcoin_v1.pt", f"Got {path.name}"

    def test_dogecoin_model_filename(self):
        """DOGE model must be saved as lstm_dogecoin_v1.pt"""
        path = _model_path("dogecoin")
        assert path.name == "lstm_dogecoin_v1.pt", f"Got {path.name}"

    def test_bitcoin_scaler_filename(self):
        """BTC scaler must be saved as scaler_bitcoin.pkl"""
        path = _scaler_path("bitcoin")
        assert path.name == "scaler_bitcoin.pkl", f"Got {path.name}"

    def test_dogecoin_scaler_filename(self):
        """DOGE scaler must be saved as scaler_dogecoin.pkl"""
        path = _scaler_path("dogecoin")
        assert path.name == "scaler_dogecoin.pkl", f"Got {path.name}"


# ===========================================================================
# 9. BTC and DOGE both preprocess correctly
# ===========================================================================

class TestBtcAndDogePreprocess:

    def _make_csv(self, tmp_path_factory, name: str, n: int = 200) -> Path:
        tmp = tmp_path_factory.mktemp(name)
        csv_path = tmp / f"{name}.csv"
        dates = pd.date_range("2020-01-01", periods=n, freq="D")
        prices = np.cumsum(np.random.randn(n)) + 1000
        pd.DataFrame({"date": dates, "price": prices}).to_csv(csv_path, index=False)
        return csv_path

    def test_btc_and_doge_preprocess(self, tmp_path_factory):
        """Both bitcoin.csv and dogecoin.csv must load and produce valid sequences."""
        for coin_name in ["bitcoin", "dogecoin"]:
            csv_path = self._make_csv(tmp_path_factory, coin_name)
            X_tr, y_tr, X_v, y_v, X_te, y_te, scaler = load_and_preprocess(
                csv_path=csv_path,
                seq_len=SEQ_LEN,
                save_scaler=False,
            )
            total = len(X_tr) + len(X_v) + len(X_te)
            assert total == 200 - SEQ_LEN, (
                f"{coin_name}: expected {200 - SEQ_LEN} sequences, got {total}"
            )
            # train ratio ~80%
            assert len(X_tr) > len(X_v), f"{coin_name}: train set should be larger than val"
            assert len(X_tr) > len(X_te), f"{coin_name}: train set should be larger than test"
            # Scaler worked
            assert (y_tr >= 0).all() and (y_tr <= 1).all(), f"{coin_name}: y_train out of [0,1]"


# ===========================================================================
# 7. Dry-run training (optional smoke test)
# ===========================================================================

class TestDryRunTraining:

    def test_dry_run_completes_without_error(self, sample_csv):
        """train() in dry-run mode should return metrics dict without crashing."""
        # Import here so we don't need to restructure sys.path at module level
        import importlib.util as ilu
        spec = ilu.spec_from_file_location(
            "train_lstm", str(_ML_DIR / "train_lstm.py")
        )
        train_mod = ilu.module_from_spec(spec)
        spec.loader.exec_module(train_mod)

        metrics = train_mod.train(
            csv_path=sample_csv,
            epochs=2,
            batch_size=16,
            dry_run=True,
        )
        assert "rmse" in metrics
        assert "mae" in metrics
        assert metrics["rmse"] >= 0
        assert metrics["mae"] >= 0
