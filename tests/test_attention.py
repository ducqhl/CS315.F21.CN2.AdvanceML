"""
tests/test_attention.py — Comprehensive unit and integration tests for
TemporalAttention and LSTMWithAttention.

Verifies:
1. TemporalAttention output shapes and probability normalization (softmax over time).
2. Non-negative weights and conservation of probability mass.
3. Gradient flow across attention weights and recurrent hidden states.
4. LSTMWithAttention forward passes (single-head, dual-head, volatility-head).
5. Attention weight extraction and interpretability logging (get_attention_weights).
6. Sequence information preservation: attention weights respond to multi-step temporal dynamics.
7. Model parameter footprint and efficiency verification.
8. End-to-end dry-run training integration with --attention flag.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest
import torch

_ML_DIR = Path(__file__).resolve().parent.parent / "src" / "ml"
if str(_ML_DIR) not in sys.path:
    sys.path.insert(0, str(_ML_DIR))

from model import TemporalAttention, LSTMModel, LSTMWithAttention, DirectionHead, VolatilityHead
from train_lstm import train


class TestTemporalAttention:
    """Unit tests for the TemporalAttention mechanism."""

    def test_output_shape_and_context(self):
        batch_size = 8
        seq_len = 60
        hidden_size = 128
        attn = TemporalAttention(hidden_size=hidden_size)

        lstm_out = torch.randn(batch_size, seq_len, hidden_size)
        context = attn(lstm_out)

        assert context.shape == (batch_size, hidden_size)

    def test_attention_weights_properties(self):
        batch_size = 4
        seq_len = 30
        hidden_size = 64
        attn = TemporalAttention(hidden_size=hidden_size)

        lstm_out = torch.randn(batch_size, seq_len, hidden_size)
        context, weights = attn(lstm_out, return_weights=True)

        assert context.shape == (batch_size, hidden_size)
        assert weights.shape == (batch_size, seq_len, 1)

        # Weights must be non-negative
        assert (weights >= 0.0).all()

        # Weights must sum to 1.0 along the sequence dimension
        sums = weights.sum(dim=1)  # (batch_size, 1)
        torch.testing.assert_close(sums, torch.ones_like(sums), rtol=1e-5, atol=1e-5)

    def test_gradient_flow(self):
        batch_size = 2
        seq_len = 10
        hidden_size = 32
        attn = TemporalAttention(hidden_size=hidden_size)

        lstm_out = torch.randn(batch_size, seq_len, hidden_size, requires_grad=True)
        context = attn(lstm_out)
        loss = context.sum()
        loss.backward()

        assert lstm_out.grad is not None
        assert not torch.isnan(lstm_out.grad).any()
        assert attn.attention.weight.grad is not None
        assert attn.attention.bias.grad is not None

    def test_multi_timestep_contribution(self):
        """Verify that early timesteps influence the context vector."""
        batch_size = 1
        seq_len = 10
        hidden_size = 16
        attn = TemporalAttention(hidden_size=hidden_size)

        lstm_out = torch.zeros(batch_size, seq_len, hidden_size)
        # Put a spike at timestep 0
        lstm_out[0, 0, :] = 5.0

        context, weights = attn(lstm_out, return_weights=True)
        # Context must not be zero because timestep 0 has non-zero values
        assert (context.abs() > 0.0).any()
        assert weights[0, 0, 0] > 0.0


class TestLSTMWithAttention:
    """Unit and architectural tests for LSTMWithAttention."""

    def test_forward_single_head(self):
        model = LSTMWithAttention(
            input_size=9,
            hidden_size=64,
            num_layers=2,
            dropout=0.1,
            output_size=7,
            use_direction_head=False,
            use_volatility_head=False,
        )
        x = torch.randn(4, 60, 9)
        out = model(x)
        assert isinstance(out, torch.Tensor)
        assert out.shape == (4, 7)

    def test_forward_dual_head(self):
        model = LSTMWithAttention(
            input_size=9,
            hidden_size=64,
            num_layers=2,
            dropout=0.1,
            output_size=7,
            use_direction_head=True,
            n_classes=3,
            use_volatility_head=False,
        )
        x = torch.randn(4, 60, 9)
        price_preds, dir_logits = model(x)
        assert price_preds.shape == (4, 7)
        assert dir_logits.shape == (4, 7, 3)

    def test_forward_with_volatility_head(self):
        model = LSTMWithAttention(
            input_size=9,
            hidden_size=64,
            num_layers=2,
            dropout=0.1,
            output_size=7,
            use_direction_head=False,
            use_volatility_head=True,
        )
        x = torch.randn(4, 60, 9)
        price_preds, vol_preds = model(x)
        assert price_preds.shape == (4, 7)
        assert vol_preds.shape == (4, 7)
        # Softplus ensures non-negative volatility
        assert (vol_preds >= 0.0).all()

    def test_forward_all_heads_with_attention_return(self):
        model = LSTMWithAttention(
            input_size=9,
            hidden_size=64,
            num_layers=2,
            dropout=0.1,
            output_size=7,
            use_direction_head=True,
            n_classes=2,
            use_volatility_head=True,
        )
        x = torch.randn(3, 60, 9)
        price_preds, dir_logits, vol_preds, attn_weights = model(x, return_attention=True)
        assert price_preds.shape == (3, 7)
        assert dir_logits.shape == (3, 7, 2)
        assert vol_preds.shape == (3, 7)
        assert attn_weights.shape == (3, 60, 1)

    def test_get_attention_weights_helper(self):
        model = LSTMWithAttention(input_size=9, hidden_size=32, num_layers=1, output_size=7)
        x = torch.randn(2, 60, 9)
        weights = model.get_attention_weights(x)
        assert weights.shape == (2, 60, 1)
        sums = weights.sum(dim=1)
        torch.testing.assert_close(sums, torch.ones_like(sums), rtol=1e-5, atol=1e-5)

    def test_parameter_overhead(self):
        """Attention layer adds only H + 1 parameters (negligible memory/speed overhead)."""
        hidden_size = 128
        standard_model = LSTMModel(input_size=9, hidden_size=hidden_size, num_layers=2)
        attn_model = LSTMWithAttention(input_size=9, hidden_size=hidden_size, num_layers=2)

        standard_params = sum(p.numel() for p in standard_model.parameters())
        attn_params = sum(p.numel() for p in attn_model.parameters())

        diff = attn_params - standard_params
        # Linear(128, 1) has 128 weights + 1 bias = 129 parameters
        assert diff == hidden_size + 1


class TestTrainIntegration:
    """Integration test verifying end-to-end training with attention."""

    def test_dry_run_training_with_attention(self, tmp_path):
        import pandas as pd
        csv_file = tmp_path / "test_coin.csv"
        dates = pd.date_range("2021-01-01", periods=300, freq="D")
        prices = np.cumsum(np.random.randn(300)) + 100.0
        df = pd.DataFrame({"snapped_at": dates, "price": prices, "total_volume": np.random.rand(300) * 1e6})
        df.to_csv(csv_file, index=False)

        metrics = train(
            coin="test_coin",
            csv_path=csv_file,
            epochs=2,
            dry_run=True,
            use_attention=True,
        )
        assert isinstance(metrics, dict)
        assert "rmse" in metrics
        assert "mae" in metrics
