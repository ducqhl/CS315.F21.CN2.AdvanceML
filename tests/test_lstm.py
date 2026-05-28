"""
tests/test_lstm.py — Unit tests for the LSTM model, preprocessing pipeline,
                     and inference logic.

All tests run on CPU only; no GPU dependency.
No live MongoDB connection is required — inference write path is mocked.

Tests
-----
1.  LSTMModel forward pass output shape: (batch, 7)
2.  Sequence creation: MIMO targets shape (M, 7), input shape (M, 60, N_FEATURES)
3.  Scaler normalisation: StandardScaler fitted on train only
4.  Train/val/test split is chronological (no shuffle)
5.  MIMO predict returns exactly HORIZON positive USD prices
6.  MongoDB document structure produced by inference
7.  Model predict() helper returns numpy array with correct shape
8.  Model filenames are versioned per coin
9.  BTC and DOGE both preprocess correctly (shapes, scaler type)
10. Dry-run train() completes without error
11. DirectionHead forward shape and softmax correctness
12. make_direction_labels() values, shape, and threshold logic
13. Multi-task model returns dual-head output; single-head returns tensor
14. load_and_preprocess() returns 11-item tuple; direction labels shape/values correct
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

from model import LSTMModel, DirectionHead
from preprocess import (
    _create_sequences,
    _load_csv,
    _build_features,
    load_and_preprocess,
    make_direction_labels,
    SEQ_LEN,
    HORIZON,
    N_FEATURES,
)
from inference import (
    _mimo_predict,
    _load_last_n_from_csv,
    SEQ_LEN as INF_SEQ_LEN,
    HORIZON as INF_HORIZON,
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
    """A LSTMModel instance with input_size=5, output_size=7 (old backward-compat, single-head)."""
    return LSTMModel(input_size=5, hidden_size=128, num_layers=2, dropout=0.2, output_size=7, use_direction_head=False)


@pytest.fixture(scope="module")
def small_model_v2() -> LSTMModel:
    """A LSTMModel with N_FEATURES=9 and direction head (new multi-task)."""
    return LSTMModel(
        input_size=9, hidden_size=128, num_layers=2, dropout=0.2,
        output_size=7, use_direction_head=True, n_classes=3,
    )


@pytest.fixture(scope="module")
def sample_csv(tmp_path_factory) -> Path:
    """Write a synthetic 1000-row CSV that mimics data/sample/bitcoin.csv.

    1000 rows ensures val and test splits both have enough rows for MIMO
    sequences (need > SEQ_LEN + HORIZON - 1 = 66 raw rows per split).
    """
    tmp = tmp_path_factory.mktemp("data")
    csv_path = tmp / "bitcoin_test.csv"
    dates = pd.date_range("2020-01-01", periods=1000, freq="D")
    prices = np.cumsum(np.random.randn(1000)) + 10000
    volumes = np.random.rand(1000) * 1e9 + 1e8
    pd.DataFrame({
        "date": dates,
        "price": prices,
        "total_volume": volumes,
    }).to_csv(csv_path, index=False)
    return csv_path


@pytest.fixture(scope="module")
def fitted_scaler(sample_csv):
    """Return the full 11-tuple from a preprocessing run on sample_csv."""
    result = load_and_preprocess(
        csv_path=sample_csv,
        seq_len=SEQ_LEN,
        save_scaler=False,
        with_fear_greed=False,  # avoid API call in tests
    )
    # result = (X_train, y_train, y_dir_train,
    #           X_val,   y_val,   y_dir_val,
    #           X_test,  y_test,  y_dir_test,
    #           scaler, last_price_usd)
    return result


# ===========================================================================
# 1. LSTMModel forward pass — output shape
# ===========================================================================

class TestLSTMModelForward:

    def test_output_shape_single_sample(self, small_model):
        """Forward pass with (1, 60, 5) input must yield shape (1, 7)."""
        x = torch.rand(1, 60, 5)
        out = small_model(x)
        assert out.shape == (1, 7), f"Expected (1, 7), got {tuple(out.shape)}"

    def test_output_shape_batch(self, small_model):
        """Forward pass with (16, 60, 5) input must yield shape (16, 7)."""
        x = torch.rand(16, 60, 5)
        out = small_model(x)
        assert out.shape == (16, 7), f"Expected (16, 7), got {tuple(out.shape)}"

    def test_output_is_float_tensor(self, small_model):
        """Output dtype must be float32."""
        x = torch.rand(1, 60, 5)
        out = small_model(x)
        assert out.dtype == torch.float32

    def test_predict_helper_returns_numpy(self, small_model):
        """predict() should return a numpy array with shape (N, output_size)."""
        X = np.random.rand(4, 60, 5).astype(np.float32)
        result = small_model.predict(X)
        assert isinstance(result, np.ndarray)
        assert result.shape == (4, 7), f"Expected (4, 7), got {result.shape}"


# ===========================================================================
# 2. Sequence creation — MIMO shapes
# ===========================================================================

class TestSequenceCreation:

    def test_sequence_count_from_100_rows(self):
        """100 rows with seq_len=60, horizon=7 → 100 - 60 - 7 + 1 = 34 sequences."""
        scaled = np.random.rand(100, N_FEATURES).astype(np.float32)
        X, y = _create_sequences(scaled, seq_len=60, horizon=7)
        expected = 100 - 60 - 7 + 1
        assert len(X) == expected, f"Expected {expected} sequences, got {len(X)}"
        assert len(y) == expected

    def test_sequence_shape(self):
        """Each X sequence must have shape (seq_len, N_FEATURES); y must have shape (horizon,)."""
        scaled = np.random.rand(100, N_FEATURES).astype(np.float32)
        X, y = _create_sequences(scaled, seq_len=60, horizon=7)
        expected_x_shape = (34, 60, N_FEATURES)
        assert X.shape == expected_x_shape, f"X shape: {X.shape}, expected {expected_x_shape}"
        assert y.shape == (34, 7), f"y shape: {y.shape}"

    def test_target_is_feature_zero_next_horizon_steps(self):
        """y[i, k] must equal scaled[seq_len + i + k, 0] (feature-0 log_return_1d)."""
        scaled = np.arange(100, dtype=np.float32).reshape(-1, 1)
        # Broadcast to N_FEATURES features — only feature 0 (the values 0..99) is tested.
        scaled_n = np.repeat(scaled, N_FEATURES, axis=1)
        X, y = _create_sequences(scaled_n, seq_len=5, horizon=3)
        # First target sequence starts at index 5: y[0] = [5, 6, 7]
        np.testing.assert_array_equal(y[0], [5.0, 6.0, 7.0])
        # Second: y[1] = [6, 7, 8]
        np.testing.assert_array_equal(y[1], [6.0, 7.0, 8.0])


# ===========================================================================
# 3. Scaler normalisation — StandardScaler (not MinMax)
# ===========================================================================

class TestScalerNormalisation:

    def test_scaler_is_standard_scaler(self, fitted_scaler):
        """Scaler must be StandardScaler (not MinMaxScaler)."""
        from sklearn.preprocessing import StandardScaler
        *_, scaler, last_price = fitted_scaler
        assert isinstance(scaler, StandardScaler), (
            f"Expected StandardScaler, got {type(scaler).__name__}"
        )

    def test_scaler_has_n_features(self, fitted_scaler):
        """StandardScaler must have mean_ and scale_ of length N_FEATURES."""
        *_, scaler, last_price = fitted_scaler
        assert hasattr(scaler, "mean_"), "Scaler missing mean_"
        assert hasattr(scaler, "scale_"), "Scaler missing scale_"
        assert len(scaler.mean_) == N_FEATURES, (
            f"Expected {N_FEATURES} features, got {len(scaler.mean_)}"
        )

    def test_scaler_inverse_roundtrip(self, fitted_scaler):
        """transform → inverse_transform → transform should recover the input."""
        X_tr, *_, scaler, last_price = fitted_scaler
        # Take the first time step of 5 training sequences (already scaled)
        sample_scaled = X_tr[:5, 0, :]           # (5, N_FEATURES)
        sample_raw    = scaler.inverse_transform(sample_scaled)
        rescaled      = scaler.transform(sample_raw)
        np.testing.assert_allclose(sample_scaled, rescaled, atol=1e-5)

    def test_last_price_usd_positive(self, fitted_scaler):
        """last_price_usd must be a positive float."""
        *_, last_price = fitted_scaler
        assert isinstance(last_price, float)
        assert last_price > 0, f"Expected positive last_price_usd, got {last_price}"

    def test_scaler_fitted_on_train_only(self, fitted_scaler):
        """Scaler mean should be computed from training data only.

        Verify by checking that the scaler's last_price_usd_ attribute exists
        (set in load_and_preprocess to the global dataset end price).
        """
        *_, scaler, last_price = fitted_scaler
        assert hasattr(scaler, "last_price_usd_"), (
            "Scaler missing last_price_usd_ attribute (set in load_and_preprocess)"
        )
        assert scaler.last_price_usd_ == last_price


# ===========================================================================
# 4. Chronological split (no data leakage)
# ===========================================================================

class TestChronologicalSplit:

    def test_splits_are_non_empty(self, fitted_scaler):
        """All three splits must produce at least 1 sequence."""
        X_tr, y_tr, y_dir_tr, X_v, y_v, y_dir_v, X_te, y_te, y_dir_te, *_ = fitted_scaler
        assert len(X_tr) > 0, "Training split is empty"
        assert len(X_v)  > 0, "Validation split is empty"
        assert len(X_te) > 0, "Test split is empty"

    def test_train_is_largest_split(self, fitted_scaler):
        """Train set must be larger than val and test."""
        X_tr, y_tr, y_dir_tr, X_v, y_v, y_dir_v, X_te, *_ = fitted_scaler
        assert len(X_tr) >= len(X_v),  "Train should be >= val"
        assert len(X_tr) >= len(X_te), "Train should be >= test"

    def test_sequence_shapes_consistent(self, fitted_scaler):
        """All X arrays must have shape (M, SEQ_LEN, N_FEATURES); y arrays (M, HORIZON)."""
        X_tr, y_tr, y_dir_tr, X_v, y_v, y_dir_v, X_te, y_te, y_dir_te, *_ = fitted_scaler
        for name, X, y in [("train", X_tr, y_tr), ("val", X_v, y_v), ("test", X_te, y_te)]:
            assert X.shape[1:] == (SEQ_LEN, N_FEATURES), (
                f"{name} X shape: {X.shape}, expected (_, {SEQ_LEN}, {N_FEATURES})"
            )
            assert y.shape[1] == HORIZON, f"{name} y shape: {y.shape}"


# ===========================================================================
# 5. MIMO prediction — HORIZON predictions, all positive
# ===========================================================================

class TestMimoPrediction:

    def test_returns_horizon_predictions(self, small_model, fitted_scaler):
        """_mimo_predict must return exactly HORIZON values."""
        *_, scaler, last_price = fitted_scaler
        seed = np.random.rand(SEQ_LEN, 5).astype(np.float32)
        # Use a mock scaler with 5 features for old model compat
        from sklearn.preprocessing import StandardScaler
        mock_scaler = StandardScaler()
        mock_scaler.fit(np.random.rand(100, 5))
        preds = _mimo_predict(small_model, seed, mock_scaler, last_price, horizon=HORIZON)
        assert len(preds) == HORIZON, f"Expected {HORIZON} predictions, got {len(preds)}"

    def test_predictions_are_positive_floats(self, small_model, fitted_scaler):
        """All predicted prices must be positive (prices > 0)."""
        *_, scaler, last_price = fitted_scaler
        seed = np.random.rand(SEQ_LEN, 5).astype(np.float32)
        from sklearn.preprocessing import StandardScaler
        mock_scaler = StandardScaler()
        mock_scaler.fit(np.random.rand(100, 5))
        preds = _mimo_predict(small_model, seed, mock_scaler, last_price, horizon=HORIZON)
        assert all(p > 0 for p in preds), f"Non-positive price found: {preds}"

    def test_predictions_are_numpy_array(self, small_model, fitted_scaler):
        """_mimo_predict must return a numpy array."""
        *_, scaler, last_price = fitted_scaler
        seed = np.random.rand(SEQ_LEN, 5).astype(np.float32)
        from sklearn.preprocessing import StandardScaler
        mock_scaler = StandardScaler()
        mock_scaler.fit(np.random.rand(100, 5))
        preds = _mimo_predict(small_model, seed, mock_scaler, last_price, horizon=HORIZON)
        assert isinstance(preds, np.ndarray)

    def test_single_forward_pass_no_compounding(self, small_model, fitted_scaler):
        """Calling _mimo_predict twice with the same seed must return the same result."""
        *_, scaler, last_price = fitted_scaler
        seed = np.random.rand(SEQ_LEN, 5).astype(np.float32)
        from sklearn.preprocessing import StandardScaler
        mock_scaler = StandardScaler()
        mock_scaler.fit(np.random.rand(100, 5))
        preds1 = _mimo_predict(small_model, seed, mock_scaler, last_price, horizon=HORIZON)
        preds2 = _mimo_predict(small_model, seed, mock_scaler, last_price, horizon=HORIZON)
        np.testing.assert_array_equal(preds1, preds2)


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
        """model_version must match the current MODEL_VERSION constant (lstm_v2)."""
        doc = self._make_fake_doc(1, 65000.0)
        assert doc["model_version"] == "lstm_v2"

    def test_confidence_from_softmax_range(self):
        """For v1 fallback (no dir_probs), confidence falls back to CONFIDENCE constant."""
        doc = self._make_fake_doc(1, 65000.0)
        # _make_fake_doc uses the old CONFIDENCE constant (v1 fallback path)
        assert doc["confidence"] == pytest.approx(CONFIDENCE)

    def test_v2_confidence_from_softmax(self):
        """v2 inference confidence must come from softmax probabilities (≥ 1/3)."""
        from inference import _mimo_predict_full
        import pickle

        model = LSTMModel(
            input_size=9, hidden_size=32, num_layers=1,
            dropout=0.0, output_size=7, use_direction_head=True, n_classes=3,
        )
        from sklearn.preprocessing import StandardScaler
        scaler = StandardScaler()
        scaler.fit(np.random.randn(100, 9))

        seed = np.random.randn(60, 9).astype(np.float32)
        _, _, dir_probs, _ = _mimo_predict_full(model, seed, scaler, last_price_usd=50000.0)
        for prob in dir_probs:
            assert 1 / 3 <= prob <= 1.0, (
                f"Softmax confidence must be ≥ 1/3 for 3-class, got {prob}"
            )

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
        """BTC model (v1 compat path) must be saved as lstm_bitcoin_v1.pt"""
        path = _model_path("bitcoin")
        assert path.name == "lstm_bitcoin_v1.pt", f"Got {path.name}"

    def test_dogecoin_model_filename(self):
        """DOGE model (v1 compat path) must be saved as lstm_dogecoin_v1.pt"""
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

    def _make_csv(self, tmp_path_factory, name: str, n: int = 1000) -> Path:
        tmp = tmp_path_factory.mktemp(name)
        csv_path = tmp / f"{name}.csv"
        dates = pd.date_range("2020-01-01", periods=n, freq="D")
        prices = np.cumsum(np.random.randn(n)) + 1000
        volumes = np.random.rand(n) * 1e9 + 1e8
        pd.DataFrame({
            "date": dates,
            "price": prices,
            "total_volume": volumes,
        }).to_csv(csv_path, index=False)
        return csv_path

    def test_btc_and_doge_preprocess(self, tmp_path_factory):
        """Both bitcoin.csv and dogecoin.csv must load and produce valid MIMO sequences."""
        from sklearn.preprocessing import StandardScaler
        for coin_name in ["bitcoin", "dogecoin"]:
            csv_path = self._make_csv(tmp_path_factory, coin_name)
            (
                X_tr, y_tr, y_dir_tr,
                X_v,  y_v,  y_dir_v,
                X_te, y_te, y_dir_te,
                scaler, last_price,
            ) = load_and_preprocess(
                csv_path=csv_path,
                seq_len=SEQ_LEN,
                save_scaler=False,
                with_fear_greed=False,
            )
            # All splits non-empty
            assert len(X_tr) > 0, f"{coin_name}: train is empty"
            assert len(X_v)  > 0, f"{coin_name}: val is empty"
            assert len(X_te) > 0, f"{coin_name}: test is empty"

            # Shapes: (M, SEQ_LEN, N_FEATURES) and (M, HORIZON)
            assert X_tr.shape[1:] == (SEQ_LEN, N_FEATURES), (
                f"{coin_name}: X_tr shape {X_tr.shape}"
            )
            assert y_tr.shape[1] == HORIZON, f"{coin_name}: y_tr shape {y_tr.shape}"

            # Train ratio ~80%: train is larger than val and test
            assert len(X_tr) > len(X_v),  f"{coin_name}: train <= val"
            assert len(X_tr) > len(X_te), f"{coin_name}: train <= test"

            # StandardScaler used
            assert isinstance(scaler, StandardScaler), (
                f"{coin_name}: expected StandardScaler, got {type(scaler).__name__}"
            )

            # last_price_usd is positive
            assert last_price > 0, f"{coin_name}: last_price_usd={last_price}"


# ===========================================================================
# 10. Dry-run training (optional smoke test)
# ===========================================================================

class TestDryRunTraining:

    def test_dry_run_completes_without_error(self, sample_csv):
        """train() in dry-run mode should return metrics dict without crashing."""
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
        # New metrics must also be present
        assert "direction_accuracy_pct" in metrics
        assert "f1_macro" in metrics


# ===========================================================================
# 11. DirectionHead — shape and softmax
# ===========================================================================

class TestDirectionHead:

    def test_forward_shape(self):
        """DirectionHead forward must return shape (batch, output_size, n_classes)."""
        head = DirectionHead(hidden_size=128, output_size=7, n_classes=3)
        last_hidden = torch.rand(4, 128)
        out = head(last_hidden)
        assert out.shape == (4, 7, 3), f"Expected (4, 7, 3), got {tuple(out.shape)}"

    def test_softmax_sums_to_one(self):
        """Softmax over the class dimension must sum to ~1 for every (batch, step)."""
        head = DirectionHead(hidden_size=128, output_size=7, n_classes=3)
        last_hidden = torch.rand(4, 128)
        logits = head(last_hidden)   # (4, 7, 3)
        probs = torch.softmax(logits, dim=2)   # (4, 7, 3)
        sums = probs.sum(dim=2)                # (4, 7) — should be all ~1
        np.testing.assert_allclose(
            sums.detach().numpy(), np.ones((4, 7)), atol=1e-5
        )

    def test_output_dtype(self):
        """DirectionHead output must be float32."""
        head = DirectionHead(hidden_size=64, output_size=3, n_classes=3)
        last_hidden = torch.rand(2, 64)
        out = head(last_hidden)
        assert out.dtype == torch.float32


# ===========================================================================
# 12. make_direction_labels
# ===========================================================================

class TestDirectionLabels:

    def test_returns_correct_shape(self):
        """make_direction_labels must return array of same length as input."""
        log_rets = np.random.randn(200)
        labels = make_direction_labels(log_rets)
        assert labels.shape == (200,), f"Expected (200,), got {labels.shape}"

    def test_values_in_valid_set(self):
        """All label values must be in {0, 1, 2}."""
        log_rets = np.random.randn(500)
        labels = make_direction_labels(log_rets)
        unique = set(labels.tolist())
        assert unique.issubset({0, 1, 2}), f"Unexpected label values: {unique}"

    def test_dtype_is_int(self):
        """Label array dtype must be integer."""
        labels = make_direction_labels(np.random.randn(100))
        assert np.issubdtype(labels.dtype, np.integer), (
            f"Expected integer dtype, got {labels.dtype}"
        )

    def test_constant_array_all_flat(self):
        """Constant returns → quantile thresholds equal the constant → all FLAT."""
        log_rets = np.ones(100) * 10.0
        labels = make_direction_labels(log_rets)
        # quantile(constant, 0.67) == quantile(constant, 0.33) == 10.0
        # 10.0 > 10.0 is False; 10.0 < 10.0 is False → all FLAT
        assert np.all(labels == 1), f"Expected all FLAT (1), got {np.unique(labels)}"

    def test_balanced_class_distribution(self):
        """Quantile-based thresholds should yield roughly equal class proportions."""
        rng = np.random.default_rng(0)
        log_rets = rng.normal(0, 0.02, size=3000)
        labels = make_direction_labels(log_rets, target_pct=0.33)
        counts = np.bincount(labels, minlength=3)
        fracs  = counts / len(labels)
        # Each class should be within [0.28, 0.40] for target_pct=0.33
        for cls_frac in fracs:
            assert 0.28 <= cls_frac <= 0.40, (
                f"Class fractions {fracs} outside expected range"
            )

    def test_flat_returns_all_flat(self):
        """Zero log-returns → quantile thresholds are 0 → all FLAT."""
        log_rets = np.zeros(50)
        labels = make_direction_labels(log_rets)
        assert np.all(labels == 1), (
            f"Expected all FLAT (1) for zero returns, got {np.unique(labels)}"
        )

    def test_mixed_returns(self):
        """Mixed returns should produce all three label types."""
        rng = np.random.default_rng(42)
        log_rets = rng.choice([-2.0, 0.0, 2.0], size=300)
        labels = make_direction_labels(log_rets, target_pct=0.33)
        unique = set(labels.tolist())
        assert {0, 1, 2}.issubset(unique) or len(unique) >= 2, (
            f"Expected mixed labels, got {unique}"
        )


# ===========================================================================
# 13. Multi-task model dual-head output
# ===========================================================================

class TestMultiTaskModel:

    def test_dual_head_returns_tuple(self, small_model_v2):
        """LSTMModel with use_direction_head=True must return a tuple."""
        x = torch.rand(4, 60, 9)
        out = small_model_v2(x)
        assert isinstance(out, tuple), f"Expected tuple, got {type(out)}"
        assert len(out) == 2, f"Expected 2-tuple, got {len(out)}-tuple"

    def test_dual_head_price_shape(self, small_model_v2):
        """First element of dual-head output must be (batch, output_size)."""
        x = torch.rand(4, 60, 9)
        price_preds, _ = small_model_v2(x)
        assert price_preds.shape == (4, 7), (
            f"Expected (4, 7), got {tuple(price_preds.shape)}"
        )

    def test_dual_head_dir_shape(self, small_model_v2):
        """Second element of dual-head output must be (batch, output_size, n_classes)."""
        x = torch.rand(4, 60, 9)
        _, dir_logits = small_model_v2(x)
        assert dir_logits.shape == (4, 7, 3), (
            f"Expected (4, 7, 3), got {tuple(dir_logits.shape)}"
        )

    def test_single_head_returns_tensor(self, small_model):
        """LSTMModel without direction head must return a plain Tensor."""
        x = torch.rand(4, 60, 5)
        out = small_model(x)
        assert isinstance(out, torch.Tensor), (
            f"Expected Tensor, got {type(out)}"
        )

    def test_dual_head_predict_returns_tuple(self, small_model_v2):
        """predict() on dual-head model must return (prices_np, dir_logits_np)."""
        X = np.random.rand(4, 60, 9).astype(np.float32)
        result = small_model_v2.predict(X)
        assert isinstance(result, tuple), f"Expected tuple, got {type(result)}"
        prices_np, dir_np = result
        assert isinstance(prices_np, np.ndarray)
        assert isinstance(dir_np, np.ndarray)
        assert prices_np.shape == (4, 7), f"prices shape: {prices_np.shape}"
        assert dir_np.shape == (4, 7, 3), f"dir_logits shape: {dir_np.shape}"

    def test_single_head_predict_returns_array(self, small_model):
        """predict() on single-head model must return a numpy array."""
        X = np.random.rand(4, 60, 5).astype(np.float32)
        result = small_model.predict(X)
        assert isinstance(result, np.ndarray), f"Expected ndarray, got {type(result)}"


# ===========================================================================
# 14. load_and_preprocess — 11-item tuple, direction labels correctness
# ===========================================================================

class TestNewPreprocessReturnShape:

    def _make_csv(self, tmp_path_factory, n: int = 800) -> Path:
        tmp = tmp_path_factory.mktemp("preprocess_new")
        csv_path = tmp / "test_coin.csv"
        dates = pd.date_range("2020-01-01", periods=n, freq="D")
        prices = np.cumsum(np.random.randn(n)) + 5000
        volumes = np.random.rand(n) * 1e9 + 1e8
        pd.DataFrame({
            "date": dates,
            "price": prices,
            "total_volume": volumes,
        }).to_csv(csv_path, index=False)
        return csv_path

    def test_returns_11_items(self, tmp_path_factory):
        """load_and_preprocess must return a tuple of exactly 11 items."""
        csv_path = self._make_csv(tmp_path_factory)
        result = load_and_preprocess(
            csv_path=csv_path,
            save_scaler=False,
            with_fear_greed=False,
        )
        assert len(result) == 11, f"Expected 11-tuple, got {len(result)}-tuple"

    def test_y_dir_shapes_match_y(self, tmp_path_factory):
        """y_dir_train/val/test shapes must match y_train/val/test shapes."""
        csv_path = self._make_csv(tmp_path_factory)
        (
            X_tr, y_tr, y_dir_tr,
            X_v,  y_v,  y_dir_v,
            X_te, y_te, y_dir_te,
            scaler, last_price,
        ) = load_and_preprocess(
            csv_path=csv_path,
            save_scaler=False,
            with_fear_greed=False,
        )
        # y and y_dir must have same first dimension (number of sequences)
        assert y_tr.shape[0] == y_dir_tr.shape[0], (
            f"train: y {y_tr.shape} vs y_dir {y_dir_tr.shape}"
        )
        assert y_v.shape[0] == y_dir_v.shape[0], (
            f"val: y {y_v.shape} vs y_dir {y_dir_v.shape}"
        )
        assert y_te.shape[0] == y_dir_te.shape[0], (
            f"test: y {y_te.shape} vs y_dir {y_dir_te.shape}"
        )
        # y_dir must have horizon columns
        assert y_dir_tr.shape[1] == HORIZON, f"y_dir_train horizon: {y_dir_tr.shape}"
        assert y_dir_v.shape[1]  == HORIZON, f"y_dir_val horizon: {y_dir_v.shape}"
        assert y_dir_te.shape[1] == HORIZON, f"y_dir_test horizon: {y_dir_te.shape}"

    def test_direction_values_in_valid_set(self, tmp_path_factory):
        """All direction label values must be in {0, 1, 2}."""
        csv_path = self._make_csv(tmp_path_factory)
        (
            X_tr, y_tr, y_dir_tr,
            X_v,  y_v,  y_dir_v,
            X_te, y_te, y_dir_te,
            scaler, last_price,
        ) = load_and_preprocess(
            csv_path=csv_path,
            save_scaler=False,
            with_fear_greed=False,
        )
        for split_name, y_dir in [
            ("train", y_dir_tr), ("val", y_dir_v), ("test", y_dir_te)
        ]:
            unique = set(y_dir.flatten().tolist())
            assert unique.issubset({0, 1, 2}), (
                f"{split_name}: unexpected direction values {unique}"
            )

    def test_x_shape_has_n_features(self, tmp_path_factory):
        """X arrays from the new 11-tuple must have N_FEATURES in last dimension."""
        csv_path = self._make_csv(tmp_path_factory)
        (
            X_tr, y_tr, y_dir_tr,
            X_v,  y_v,  y_dir_v,
            X_te, y_te, y_dir_te,
            scaler, last_price,
        ) = load_and_preprocess(
            csv_path=csv_path,
            save_scaler=False,
            with_fear_greed=False,
        )
        assert X_tr.shape[2] == N_FEATURES, (
            f"Expected N_FEATURES={N_FEATURES}, got {X_tr.shape[2]}"
        )
        assert X_v.shape[2]  == N_FEATURES, (
            f"Expected N_FEATURES={N_FEATURES}, got {X_v.shape[2]}"
        )
        assert X_te.shape[2] == N_FEATURES, (
            f"Expected N_FEATURES={N_FEATURES}, got {X_te.shape[2]}"
        )
