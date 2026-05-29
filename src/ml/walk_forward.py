"""
walk_forward.py — Walk-forward cross-validation for the LSTM forecasting model.

Standalone module — no disk writes, no side effects.
Used by train_lstm.py --walk-forward to estimate out-of-sample direction
accuracy before committing to a full training run.

Algorithm (N_FOLDS folds × FOLD_SIZE days each):
  last_val_end   = N - HORIZON
  first_train_end = last_val_end - n_folds * fold_size

  for k in range(n_folds):
      train_end  = first_train_end + k * fold_size
      val_end    = train_end + fold_size
      effective_train_start = max(0, train_end - window_days)

      Build features on [effective_start, val_end), fit scaler on train rows only.
      Train a throwaway model (PATIENCE=5, epochs=30, not saved).
      Compute RMSE, MAE, price dir accuracy on val set.

  Return average metrics across folds.

Usage
-----
    from walk_forward import walk_forward_validation
    results = walk_forward_validation("data/sample/bitcoin.csv")
    print(results["dir_acc_mean"])
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

logger = logging.getLogger(__name__)

# ── Walk-forward hyper-parameters ─────────────────────────────────────────────
N_FOLDS    = 6
FOLD_SIZE  = 60    # calendar days per fold
WF_EPOCHS  = 30
WF_PATIENCE = 5
WF_BATCH_SIZE = 32


def walk_forward_validation(
    csv_path: str | Path,
    n_folds: int = N_FOLDS,
    fold_size: int = FOLD_SIZE,
    window_days: int = 730,
    epochs: int = WF_EPOCHS,
) -> dict:
    """
    Run walk-forward cross-validation and return average metrics.

    Parameters
    ----------
    csv_path    : path to coin CSV (e.g. data/sample/bitcoin.csv)
    n_folds     : number of walk-forward folds (default 6)
    fold_size   : days per fold (default 60)
    window_days : rolling training window (default 730)
    epochs      : maximum training epochs per fold (default 30)

    Returns
    -------
    dict with keys:
        rmse_mean     : float — average RMSE across folds (USD)
        mae_mean      : float — average MAE across folds (USD)
        dir_acc_mean  : float — average price direction accuracy across folds (%)
        fold_metrics  : list[dict] — per-fold breakdown
        n_folds_used  : int — number of folds that completed successfully
    """
    # Import here to avoid circular deps if walk_forward is imported before preprocess
    from preprocess import (  # noqa: PLC0415
        _load_csv, _load_fear_greed, load_for_fold,
        HORIZON, SEQ_LEN,
    )
    from model import LSTMModel  # noqa: PLC0415

    csv_path = Path(csv_path)
    df_raw = _load_csv(csv_path)
    N = len(df_raw)

    # Load the full fear_greed array once, aligned with df_raw
    fg_full = _load_fear_greed(N)
    if len(fg_full) < N:
        padded = np.full(N, 0.5, dtype=np.float32)
        padded[-len(fg_full):] = fg_full
        fg_full = padded

    # Determine fold boundaries (in df_raw row-index terms)
    last_val_end    = N - HORIZON
    first_train_end = last_val_end - n_folds * fold_size

    if first_train_end <= SEQ_LEN:
        logger.warning(
            "walk_forward: first_train_end=%d ≤ SEQ_LEN=%d — dataset may be "
            "too short for %d folds of %d days each.",
            first_train_end, SEQ_LEN, n_folds, fold_size,
        )

    fold_metrics: list[dict] = []

    for k in range(n_folds):
        train_end = first_train_end + k * fold_size
        val_end   = train_end + fold_size

        logger.info(
            "Walk-forward fold %d/%d: train_end=%d val_end=%d",
            k + 1, n_folds, train_end, val_end,
        )

        # ── Build fold data ───────────────────────────────────────────────────
        try:
            (
                X_tr, y_tr, y_dir_tr,
                X_vl, y_vl, y_dir_vl,
                scaler_fold, last_price,
            ) = load_for_fold(
                df_raw, fg_full,
                train_end_idx=train_end,
                val_end_idx=val_end,
                seq_len=SEQ_LEN,
                horizon=HORIZON,
                window_days=window_days,
            )
        except Exception as exc:
            logger.warning("Fold %d: data error (%s) — skipping.", k + 1, exc)
            continue

        if len(X_tr) < 10:
            logger.warning(
                "Fold %d: only %d training sequences — skipping.", k + 1, len(X_tr)
            )
            continue
        if len(X_vl) < 3:
            logger.warning(
                "Fold %d: only %d validation sequences — skipping.", k + 1, len(X_vl)
            )
            continue

        # ── Build throwaway model ─────────────────────────────────────────────
        model = LSTMModel(
            input_size=X_tr.shape[2],
            hidden_size=128,
            num_layers=2,
            dropout=0.2,
            output_size=HORIZON,
            use_direction_head=False,
            use_volatility_head=False,
        )

        train_ds = TensorDataset(
            torch.tensor(X_tr, dtype=torch.float32),
            torch.tensor(y_tr, dtype=torch.float32),
        )
        train_loader = DataLoader(train_ds, batch_size=WF_BATCH_SIZE, shuffle=False)

        optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
        loss_fn   = nn.HuberLoss(delta=1.0)

        val_X = torch.tensor(X_vl, dtype=torch.float32)
        val_y = torch.tensor(y_vl, dtype=torch.float32)

        best_val_loss = float("inf")
        no_improve    = 0

        for ep in range(1, epochs + 1):
            model.train()
            for X_b, y_b in train_loader:
                optimizer.zero_grad()
                preds = model(X_b)
                loss  = loss_fn(preds, y_b)
                loss.backward()
                nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
                optimizer.step()

            model.eval()
            with torch.no_grad():
                val_loss = loss_fn(model(val_X), val_y).item()

            if val_loss < best_val_loss:
                best_val_loss = val_loss
                no_improve    = 0
            else:
                no_improve += 1
                if no_improve >= WF_PATIENCE:
                    logger.debug("Fold %d: early stop at epoch %d.", k + 1, ep)
                    break

        # ── Evaluate on val set ───────────────────────────────────────────────
        model.eval()
        with torch.no_grad():
            y_pred_norm = model(val_X).numpy()   # (M_vl, HORIZON)

        y_true_norm = y_vl
        scale0 = scaler_fold.scale_[0]
        mean0  = scaler_fold.mean_[0]

        y_true_lr = y_true_norm * scale0 + mean0
        y_pred_lr = y_pred_norm * scale0 + mean0

        y_true_usd = last_price * np.exp(np.cumsum(y_true_lr, axis=1))
        y_pred_usd = last_price * np.exp(np.cumsum(y_pred_lr, axis=1))

        rmse    = float(np.sqrt(np.mean((y_true_usd - y_pred_usd) ** 2)))
        mae     = float(np.mean(np.abs(y_true_usd - y_pred_usd)))
        dir_acc = float(
            np.mean(np.sign(y_true_lr[:, 0]) == np.sign(y_pred_lr[:, 0])) * 100
        )

        fold_metrics.append({
            "fold":    k + 1,
            "rmse":    rmse,
            "mae":     mae,
            "dir_acc": dir_acc,
            "n_train": len(X_tr),
            "n_val":   len(X_vl),
        })
        logger.info(
            "  Fold %d — RMSE=$%.2f  MAE=$%.2f  dir_acc=%.1f%%  "
            "(train_seqs=%d  val_seqs=%d)",
            k + 1, rmse, mae, dir_acc, len(X_tr), len(X_vl),
        )

    if not fold_metrics:
        logger.error("No folds completed — check data size and fold parameters.")
        return {
            "rmse_mean": None, "mae_mean": None, "dir_acc_mean": None,
            "fold_metrics": [], "n_folds_used": 0,
        }

    rmse_mean    = float(np.mean([m["rmse"]    for m in fold_metrics]))
    mae_mean     = float(np.mean([m["mae"]     for m in fold_metrics]))
    dir_acc_mean = float(np.mean([m["dir_acc"] for m in fold_metrics]))

    logger.info(
        "Walk-forward summary (%d/%d folds): RMSE=$%.2f  MAE=$%.2f  dir_acc=%.1f%%",
        len(fold_metrics), n_folds, rmse_mean, mae_mean, dir_acc_mean,
    )

    return {
        "rmse_mean":    rmse_mean,
        "mae_mean":     mae_mean,
        "dir_acc_mean": dir_acc_mean,
        "fold_metrics": fold_metrics,
        "n_folds_used": len(fold_metrics),
    }
