"""
model.py — LSTM model architecture for BTC / DOGE price prediction.

Architecture
------------
- 2-layer LSTM  (input_size=9, hidden=128, dropout=0.2)
- Price head: Linear(128 → 64) → ReLU → Dropout(0.1) → Linear(64 → output_size)
  Output: output_size-step MIMO forecast of log_return_1d (normalised)
- Direction head (optional): Linear(128 → 64) → ReLU → Dropout(0.1) →
  Linear(64 → output_size * n_classes), reshaped to (batch, output_size, n_classes)
  Classes: 0=DOWN, 1=FLAT, 2=UP

Input features (N_FEATURES=9)
------------------------------
0: log_return_1d, 1: log_return_7d, 2: log_return_30d, 3: RSI_14, 4: log_volume,
5: macd_norm, 6: bb_pct_b, 7: atr_norm, 8: fear_greed

Public API
----------
DirectionHead(hidden_size, output_size, n_classes)
    .forward(last_hidden) → Tensor (batch, output_size, n_classes)  — raw logits

LSTMModel(input_size, hidden_size, num_layers, dropout, output_size,
          use_direction_head, n_classes)
    .forward(x)   → Tensor (batch, output_size)                      — price head only
                  OR tuple (price_tensor, dir_logits_tensor)          — dual-head
    .predict(X)   → numpy array (N, output_size)                     — price head only
                  OR tuple (np_prices, np_dir_logits)                 — dual-head
"""

from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn


class DirectionHead(nn.Module):
    """
    Auxiliary classification head for trend direction prediction.

    Input : last LSTM hidden state, shape (batch, hidden_size)
    Output: raw logits, shape (batch, output_size, n_classes)

    Parameters
    ----------
    hidden_size : int — LSTM hidden state dimension (128)
    output_size : int — forecast horizon (7)
    n_classes   : int — number of direction classes (3: DOWN/FLAT/UP)
    """

    def __init__(
        self,
        hidden_size: int = 128,
        output_size: int = 7,
        n_classes: int = 3,
    ) -> None:
        super().__init__()
        self.output_size = output_size
        self.n_classes = n_classes

        # Deeper head: direction is the primary task, so it gets more capacity
        # than the auxiliary price head (which is 128 → 64 → output_size).
        self.net = nn.Sequential(
            nn.Linear(hidden_size, 128),
            nn.LayerNorm(128),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(64, output_size * n_classes),
        )

    def forward(self, last_hidden: torch.Tensor) -> torch.Tensor:
        """
        Parameters
        ----------
        last_hidden : Tensor, shape (batch, hidden_size)

        Returns
        -------
        Tensor, shape (batch, output_size, n_classes) — raw logits
        """
        batch = last_hidden.size(0)
        out = self.net(last_hidden)                                # (batch, output_size * n_classes)
        return out.view(batch, self.output_size, self.n_classes)   # (batch, output_size, n_classes)


class LSTMModel(nn.Module):
    """
    Two-layer LSTM with a two-layer fully-connected price head
    and an optional direction classification head.

    Parameters
    ----------
    input_size         : int   — number of input features (9 for new pipeline).
    hidden_size        : int   — LSTM hidden state dimension.
    num_layers         : int   — stacked LSTM depth.
    dropout            : float — dropout probability applied between LSTM layers.
    output_size        : int   — prediction horizon (7 for MIMO 7-day forecast).
    use_direction_head : bool  — if True, attach DirectionHead and return dual output.
    n_classes          : int   — number of direction classes (3: DOWN/FLAT/UP).
    """

    def __init__(
        self,
        input_size: int = 9,
        hidden_size: int = 128,
        num_layers: int = 2,
        dropout: float = 0.2,
        output_size: int = 7,
        use_direction_head: bool = False,
        n_classes: int = 3,
    ) -> None:
        super().__init__()

        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.output_size = output_size
        self.use_direction_head = use_direction_head

        # ── LSTM encoder ──────────────────────────────────────────────────────
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,      # x shape: (batch, seq_len, input_size)
            dropout=dropout if num_layers > 1 else 0.0,
        )

        # ── Price head ────────────────────────────────────────────────────────
        self.fc = nn.Sequential(
            nn.Linear(hidden_size, 64),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(64, output_size),
        )

        # ── Direction head (optional) ─────────────────────────────────────────
        if use_direction_head:
            self.dir_head = DirectionHead(
                hidden_size=hidden_size,
                output_size=output_size,
                n_classes=n_classes,
            )

    # ── Forward pass ──────────────────────────────────────────────────────────
    def forward(
        self, x: torch.Tensor
    ) -> torch.Tensor | tuple[torch.Tensor, torch.Tensor]:
        """
        Parameters
        ----------
        x : Tensor, shape (batch, seq_len, input_size)

        Returns
        -------
        If use_direction_head=False:
            Tensor, shape (batch, output_size)              — price predictions
        If use_direction_head=True:
            tuple (price_preds, dir_logits)
                price_preds : shape (batch, output_size)
                dir_logits  : shape (batch, output_size, n_classes)
        """
        # lstm_out: (batch, seq_len, hidden_size)
        lstm_out, _ = self.lstm(x)
        # Take only the last time-step's hidden state.
        last_hidden = lstm_out[:, -1, :]   # (batch, hidden_size)

        price_preds = self.fc(last_hidden)   # (batch, output_size)

        if self.use_direction_head:
            dir_logits = self.dir_head(last_hidden)   # (batch, output_size, n_classes)
            return price_preds, dir_logits

        return price_preds

    # ── Inference helper ──────────────────────────────────────────────────────
    @torch.no_grad()
    def predict(
        self, X: np.ndarray | torch.Tensor
    ) -> np.ndarray | tuple[np.ndarray, np.ndarray]:
        """
        Run inference without gradients.

        Parameters
        ----------
        X : array-like, shape (N, seq_len, input_size)

        Returns
        -------
        If use_direction_head=False:
            numpy array, shape (N, output_size)
        If use_direction_head=True:
            tuple (prices_np, dir_logits_np)
                prices_np    : shape (N, output_size)
                dir_logits_np: shape (N, output_size, n_classes)
        """
        self.eval()
        if not isinstance(X, torch.Tensor):
            X = torch.tensor(X, dtype=torch.float32)

        result = self.forward(X)

        if self.use_direction_head:
            price_tensor, dir_tensor = result
            return price_tensor.cpu().numpy(), dir_tensor.cpu().numpy()

        return result.cpu().numpy()
