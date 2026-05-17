"""
model.py — LSTM model architecture for BTC price prediction.

Architecture
------------
- 2-layer LSTM  (input_size=1, hidden=128, dropout=0.2)
- Fully-connected head: Linear(128 → 64) → ReLU → Dropout(0.1) → Linear(64 → 1)
- Output: single float — predicted (normalised) next-day close price

Public API
----------
LSTMModel(input_size, hidden_size, num_layers, dropout, output_size)
    .forward(x)   → tensor (batch, output_size)
    .predict(X)   → numpy array  (N,)
"""

from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn


class LSTMModel(nn.Module):
    """
    Two-layer LSTM with a two-layer fully-connected head.

    Parameters
    ----------
    input_size  : int   — number of input features (1 for univariate).
    hidden_size : int   — LSTM hidden state dimension.
    num_layers  : int   — stacked LSTM depth.
    dropout     : float — dropout probability applied between LSTM layers.
    output_size : int   — prediction horizon (1 for next-step prediction).
    """

    def __init__(
        self,
        input_size: int = 1,
        hidden_size: int = 128,
        num_layers: int = 2,
        dropout: float = 0.2,
        output_size: int = 1,
    ) -> None:
        super().__init__()

        self.hidden_size = hidden_size
        self.num_layers = num_layers

        # ── LSTM encoder ──────────────────────────────────────────────────────
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,      # x shape: (batch, seq_len, input_size)
            dropout=dropout if num_layers > 1 else 0.0,
        )

        # ── Fully-connected decoder ───────────────────────────────────────────
        self.fc = nn.Sequential(
            nn.Linear(hidden_size, 64),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(64, output_size),
        )

    # ── Forward pass ──────────────────────────────────────────────────────────
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Parameters
        ----------
        x : Tensor, shape (batch, seq_len, input_size)

        Returns
        -------
        Tensor, shape (batch, output_size)
        """
        # lstm_out: (batch, seq_len, hidden_size)
        lstm_out, _ = self.lstm(x)
        # Take only the last time-step's hidden state.
        last_hidden = lstm_out[:, -1, :]   # (batch, hidden_size)
        return self.fc(last_hidden)         # (batch, output_size)

    # ── Inference helper ──────────────────────────────────────────────────────
    @torch.no_grad()
    def predict(self, X: np.ndarray | torch.Tensor) -> np.ndarray:
        """
        Run inference without gradients.

        Parameters
        ----------
        X : array-like, shape (N, seq_len, input_size)

        Returns
        -------
        numpy array, shape (N,)
        """
        self.eval()
        if not isinstance(X, torch.Tensor):
            X = torch.tensor(X, dtype=torch.float32)
        out = self.forward(X)          # (N, output_size)
        return out.squeeze(-1).cpu().numpy()
