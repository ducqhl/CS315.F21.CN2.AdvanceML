"""
model.py — LSTM model architecture for BTC / DOGE price prediction.

Architecture
------------
- 2-layer LSTM  (input_size=9, hidden=128, dropout=0.2)
- Price head: Linear(128 → 64) → ReLU → Dropout(0.1) → Linear(64 → output_size)
  Output: output_size-step MIMO forecast of log_return_1d (normalised)
- Direction head (optional):
  Linear(128 → 128) → LayerNorm(128) → ReLU → Dropout(0.2)
  → Linear(128 → 64) → ReLU → Dropout(0.1)
  → Linear(64 → output_size * n_classes), reshaped to (batch, output_size, n_classes)
  Classes: 0=DOWN, 1=UP
- Volatility head (optional, v3):
  Linear(128 → 64) → ReLU → Dropout(0.1) → Linear(64 → output_size) → Softplus
  Output: (batch, output_size) — forward realized vol per step (always positive)

Input features (N_FEATURES=9)
------------------------------
0: log_return_1d, 1: momentum_30d, 2: realized_vol_14d, 3: RSI_14, 4: log_volume,
5: macd_norm, 6: bb_pct_b, 7: atr_norm, 8: fear_greed

Public API
----------
DirectionHead(hidden_size, output_size, n_classes)
    .forward(last_hidden) → Tensor (batch, output_size, n_classes)  — raw logits

VolatilityHead(hidden_size, output_size)
    .forward(last_hidden) → Tensor (batch, output_size)             — vol predictions > 0

LSTMModel(input_size, hidden_size, num_layers, dropout, output_size,
          use_direction_head, n_classes, use_volatility_head)
    .forward(x)
        use_direction_head=False, use_volatility_head=False
            → Tensor (batch, output_size)
        use_direction_head=True,  use_volatility_head=False
            → tuple (price_tensor, dir_logits_tensor)
        use_direction_head=False, use_volatility_head=True   ← v3 default
            → tuple (price_tensor, vol_tensor)
        use_direction_head=True,  use_volatility_head=True
            → tuple (price_tensor, dir_logits_tensor, vol_tensor)
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
    n_classes   : int — number of direction classes (2: DOWN/UP)
    """

    def __init__(
        self,
        hidden_size: int = 128,
        output_size: int = 7,
        n_classes: int = 2,
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


class VolatilityHead(nn.Module):
    """
    Auxiliary regression head for forward realized volatility prediction.

    Input : last LSTM hidden state, shape (batch, hidden_size)
    Output: (batch, output_size) — per-step vol predictions, guaranteed > 0 via Softplus

    Parameters
    ----------
    hidden_size : int — LSTM hidden state dimension (128)
    output_size : int — forecast horizon (7)
    """

    def __init__(self, hidden_size: int = 128, output_size: int = 7) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(hidden_size, 64),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(64, output_size),
            nn.Softplus(),   # ensures vol > 0
        )

    def forward(self, last_hidden: torch.Tensor) -> torch.Tensor:
        """
        Parameters
        ----------
        last_hidden : Tensor, shape (batch, hidden_size)

        Returns
        -------
        Tensor, shape (batch, output_size) — positive volatility predictions
        """
        return self.net(last_hidden)


class TemporalAttention(nn.Module):
    """
    Temporal self-attention pooling over recurrent sequence representations.

    Instead of relying solely on the final hidden state h_T, temporal attention
    computes an alignment score e_t for every timestep t in 1..T, producing
    attention weights alpha = softmax(e) and a context vector c = sum(alpha_t * h_t).
    This preserves long-range momentum signals and avoids recency bias.

    Academic Citations:
    -------------------
    - Bahdanau, D., Cho, K., & Bengio, Y. (2014). "Neural Machine Translation by
      Jointly Learning to Align and Translate." ICLR 2015. arXiv:1409.0473.
    - Luong, M. T., Pham, H., & Manning, C. D. (2015). "Effective Approaches to
      Attention-based Neural Machine Translation." EMNLP 2015. arXiv:1508.04025.
    - Qin, Y., Song, D., Chen, H., et al. (2017). "A Dual-Stage Attention-Based
      Recurrent Neural Network for Time Series Prediction." IJCAI 2017.
    """

    def __init__(self, hidden_size: int = 128) -> None:
        super().__init__()
        self.attention = nn.Linear(hidden_size, 1)

    def forward(
        self,
        lstm_out: torch.Tensor,
        return_weights: bool = False,
    ) -> torch.Tensor | tuple[torch.Tensor, torch.Tensor]:
        """
        Parameters
        ----------
        lstm_out : Tensor, shape (batch, seq_len, hidden_size)
        return_weights : bool, optional
            If True, returns (context, attn_weights).

        Returns
        -------
        context : Tensor, shape (batch, hidden_size)
            Attention-weighted sum of hidden states across all timesteps.
        attn_weights : Tensor, shape (batch, seq_len, 1), optional
            Softmax-normalized attention distribution across timesteps.
        """
        attn_scores = self.attention(lstm_out)  # (batch, seq_len, 1)
        attn_weights = torch.softmax(attn_scores, dim=1)  # (batch, seq_len, 1)
        context = (lstm_out * attn_weights).sum(dim=1)  # (batch, hidden_size)

        if return_weights:
            return context, attn_weights
        return context


class LSTMModel(nn.Module):
    """
    Two-layer LSTM with a two-layer fully-connected price head,
    optional direction classification head, optional volatility head,
    and optional temporal attention pooling.

    Parameters
    ----------
    input_size          : int   — number of input features (9 for new pipeline).
    hidden_size         : int   — LSTM hidden state dimension.
    num_layers          : int   — stacked LSTM depth.
    dropout             : float — dropout probability applied between LSTM layers.
    output_size         : int   — prediction horizon (7 for MIMO 7-day forecast).
    use_direction_head  : bool  — if True, attach DirectionHead and return dual output.
    n_classes           : int   — number of direction classes (2: DOWN/UP or 3: DOWN/FLAT/UP).
    use_volatility_head : bool  — if True, attach VolatilityHead (v3 model).
    use_attention       : bool  — if True, apply TemporalAttention over sequence outputs.
    """

    def __init__(
        self,
        input_size: int = 9,
        hidden_size: int = 128,
        num_layers: int = 2,
        dropout: float = 0.2,
        output_size: int = 7,
        use_direction_head: bool = True,
        n_classes: int = 2,
        use_volatility_head: bool = False,
        use_attention: bool = False,
    ) -> None:
        super().__init__()

        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.output_size = output_size
        self.use_direction_head = use_direction_head
        self.use_volatility_head = use_volatility_head
        self.use_attention = use_attention

        # ── LSTM encoder ──────────────────────────────────────────────────────
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,      # x shape: (batch, seq_len, input_size)
            dropout=dropout if num_layers > 1 else 0.0,
        )

        # ── Attention pooling (optional) ──────────────────────────────────────
        if use_attention:
            self.attention = TemporalAttention(hidden_size=hidden_size)

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

        # ── Volatility head (optional, v3) ────────────────────────────────────
        if use_volatility_head:
            self.vol_head = VolatilityHead(
                hidden_size=hidden_size,
                output_size=output_size,
            )

    # ── Forward pass ──────────────────────────────────────────────────────────
    def forward(
        self,
        x: torch.Tensor,
        return_attention: bool = False,
    ) -> torch.Tensor | tuple[torch.Tensor, ...]:
        """
        Parameters
        ----------
        x : Tensor, shape (batch, seq_len, input_size)
        return_attention : bool, optional
            If True and use_attention=True, appends attn_weights to returned tuple.

        Returns
        -------
        If use_direction_head=False and use_volatility_head=False:
            Tensor, shape (batch, output_size)              — price predictions
        Otherwise:
            tuple of predictions according to configured heads.
        """
        # lstm_out: (batch, seq_len, hidden_size)
        lstm_out, _ = self.lstm(x)

        if self.use_attention:
            last_hidden, attn_weights = self.attention(lstm_out, return_weights=True)
        else:
            last_hidden = lstm_out[:, -1, :]
            attn_weights = None

        price_preds = self.fc(last_hidden)   # (batch, output_size)

        outputs: list[torch.Tensor] = [price_preds]
        if self.use_direction_head:
            outputs.append(self.dir_head(last_hidden))
        if self.use_volatility_head:
            outputs.append(self.vol_head(last_hidden))
        if return_attention and attn_weights is not None:
            outputs.append(attn_weights)

        if len(outputs) == 1:
            return outputs[0]
        return tuple(outputs)

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

        if isinstance(result, tuple):
            if len(result) == 3:   # price + dir + vol
                return (
                    result[0].cpu().numpy(),
                    result[1].cpu().numpy(),
                    result[2].cpu().numpy(),
                )
            # price + dir  OR  price + vol
            return result[0].cpu().numpy(), result[1].cpu().numpy()

        return result.cpu().numpy()


class LSTMWithAttention(LSTMModel):
    """
    LSTM architecture with temporal self-attention pooling over recurrent outputs.
    Preserves multi-scale sequence dynamics and eliminates recency bias by attending
    over all look-back timesteps.

    Academic Citations:
    -------------------
    - Bahdanau, D., Cho, K., & Bengio, Y. (2014). "Neural Machine Translation by
      Jointly Learning to Align and Translate." ICLR 2015. arXiv:1409.0473.
    - Luong, M. T., Pham, H., & Manning, C. D. (2015). "Effective Approaches to
      Attention-based Neural Machine Translation." EMNLP 2015. arXiv:1508.04025.
    - Qin, Y., Song, D., Chen, H., et al. (2017). "A Dual-Stage Attention-Based
      Recurrent Neural Network for Time Series Prediction." IJCAI 2017.
    """

    def __init__(
        self,
        input_size: int = 9,
        hidden_size: int = 128,
        num_layers: int = 2,
        dropout: float = 0.2,
        output_size: int = 7,
        use_direction_head: bool = True,
        n_classes: int = 2,
        use_volatility_head: bool = False,
    ) -> None:
        super().__init__(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            dropout=dropout,
            output_size=output_size,
            use_direction_head=use_direction_head,
            n_classes=n_classes,
            use_volatility_head=use_volatility_head,
            use_attention=True,
        )

    def get_attention_weights(self, x: torch.Tensor) -> torch.Tensor:
        """
        Extract temporal attention weights for sequence input x.

        Parameters
        ----------
        x : Tensor, shape (batch, seq_len, input_size)

        Returns
        -------
        weights : Tensor, shape (batch, seq_len, 1)
            Attention probability distribution across timesteps.
        """
        self.eval()
        with torch.no_grad():
            lstm_out, _ = self.lstm(x)
            _, weights = self.attention(lstm_out, return_weights=True)
            return weights
