"""
train_lstm.py — Training script for the BTC / DOGE LSTM price-prediction model.

Usage
-----
    python src/ml/train_lstm.py [--coin bitcoin|dogecoin] [--epochs N]
                                [--batch-size B] [--dry-run]

Steps
-----
1. Load & preprocess sequences from  data/sample/{coin}.csv  (via preprocess.py)
2. Build PyTorch TensorDataset / DataLoader  (shuffle=False — time series)
3. Train for EPOCHS epochs with Adam + MSELoss
4. Track validation loss each epoch; save best weights to
   src/ml/model/lstm_{coin}_v1.pt
5. Evaluate on test set; inverse-transform predictions back to USD prices
6. Print RMSE, MAE, and directional accuracy
7. Save metrics JSON to  src/ml/model/metrics_{coin}.json
"""

from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

from preprocess import load_and_preprocess
from model import LSTMModel

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ── Paths ──────────────────────────────────────────────────────────────────────
_HERE = Path(__file__).resolve().parent
_MODEL_DIR = _HERE / "model"
_DATA_DIR = _HERE.parent.parent / "data" / "sample"

# ── Hyper-parameters ───────────────────────────────────────────────────────────
EPOCHS = 50
BATCH_SIZE = 64
LEARNING_RATE = 1e-3
WEIGHT_DECAY = 1e-5
PATIENCE = 10        # early-stopping patience


def _model_path(coin: str) -> Path:
    return _MODEL_DIR / f"lstm_{coin}_v1.pt"


def _metrics_path(coin: str) -> Path:
    return _MODEL_DIR / f"metrics_{coin}.json"


def _scaler_path(coin: str) -> Path:
    return _MODEL_DIR / f"scaler_{coin}.pkl"


# ── Evaluation helpers ─────────────────────────────────────────────────────────

def _inverse(arr: np.ndarray, scaler) -> np.ndarray:
    """Inverse-transform a 1-D array of normalised prices back to USD."""
    return scaler.inverse_transform(arr.reshape(-1, 1)).flatten()


def compute_metrics(
    y_true_norm: np.ndarray,
    y_pred_norm: np.ndarray,
    scaler,
) -> dict[str, float]:
    """Return RMSE, MAE, and directional accuracy (all in original price scale)."""
    y_true = _inverse(y_true_norm, scaler)
    y_pred = _inverse(y_pred_norm, scaler)

    rmse = float(np.sqrt(np.mean((y_true - y_pred) ** 2)))
    mae = float(np.mean(np.abs(y_true - y_pred)))

    # Directional accuracy — fraction of correct up/down predictions
    if len(y_true) > 1:
        dir_true = np.sign(np.diff(y_true))
        dir_pred = np.sign(np.diff(y_pred))
        dir_acc = float(np.mean(dir_true == dir_pred) * 100)
    else:
        dir_acc = 0.0

    return {"rmse": rmse, "mae": mae, "directional_accuracy_pct": dir_acc}


# ── Training loop ──────────────────────────────────────────────────────────────

def train(
    coin: str = "bitcoin",
    csv_path: Path | None = None,
    epochs: int = EPOCHS,
    batch_size: int = BATCH_SIZE,
    dry_run: bool = False,
) -> dict[str, float]:
    """
    Main training entry-point.

    Parameters
    ----------
    coin      : coin id — "bitcoin" or "dogecoin"
    csv_path  : override CSV path (defaults to data/sample/{coin}.csv)
    epochs    : maximum training epochs.
    batch_size: DataLoader batch size.
    dry_run   : if True, run only 2 epochs and skip saving (for CI/testing).

    Returns
    -------
    metrics dict (rmse, mae, directional_accuracy_pct)
    """
    if dry_run:
        epochs = 2
        logger.info("Dry-run mode — 2 epochs only, model not saved.")

    if csv_path is None:
        csv_path = _DATA_DIR / f"{coin}.csv"

    model_path = _model_path(coin)
    metrics_path = _metrics_path(coin)
    scaler_path = _scaler_path(coin)

    device = torch.device("cpu")   # CPU is sufficient for 3k rows

    # ── 1. Data ───────────────────────────────────────────────────────────────
    logger.info("Loading and preprocessing data from %s ...", csv_path)
    X_train, y_train, X_val, y_val, X_test, y_test, scaler = load_and_preprocess(
        csv_path=csv_path,
        save_scaler=(not dry_run),
        scaler_path=scaler_path,
    )

    def _to_tensors(X, y):
        return (
            torch.tensor(X, dtype=torch.float32),
            torch.tensor(y, dtype=torch.float32),
        )

    # shuffle=False — critical for time-series data
    train_ds = TensorDataset(*_to_tensors(X_train, y_train))
    val_ds   = TensorDataset(*_to_tensors(X_val,   y_val))
    test_ds  = TensorDataset(*_to_tensors(X_test,  y_test))

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=False)
    val_loader   = DataLoader(val_ds,   batch_size=batch_size, shuffle=False)
    test_loader  = DataLoader(test_ds,  batch_size=batch_size, shuffle=False)

    # ── 2. Model ──────────────────────────────────────────────────────────────
    model = LSTMModel(
        input_size=1,
        hidden_size=128,
        num_layers=2,
        dropout=0.2,
        output_size=1,
    ).to(device)

    criterion = nn.MSELoss()
    optimizer = torch.optim.Adam(
        model.parameters(), lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY
    )
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, mode="min", patience=5, factor=0.5
    )

    # ── 3. Training loop ──────────────────────────────────────────────────────
    model_path.parent.mkdir(parents=True, exist_ok=True)

    best_val_loss = float("inf")
    epochs_no_improve = 0

    for epoch in range(1, epochs + 1):
        # — Train —
        model.train()
        train_loss_sum = 0.0
        for X_batch, y_batch in train_loader:
            X_batch, y_batch = X_batch.to(device), y_batch.to(device)
            optimizer.zero_grad()
            preds = model(X_batch).squeeze(-1)
            loss = criterion(preds, y_batch)
            loss.backward()
            # Gradient clipping prevents exploding gradients in LSTM
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
            train_loss_sum += loss.item() * len(X_batch)

        train_loss = train_loss_sum / len(train_ds)

        # — Validate —
        model.eval()
        val_loss_sum = 0.0
        with torch.no_grad():
            for X_batch, y_batch in val_loader:
                X_batch, y_batch = X_batch.to(device), y_batch.to(device)
                preds = model(X_batch).squeeze(-1)
                val_loss_sum += criterion(preds, y_batch).item() * len(X_batch)
        val_loss = val_loss_sum / max(len(val_ds), 1)

        scheduler.step(val_loss)

        # — Checkpoint —
        if val_loss < best_val_loss and not dry_run:
            best_val_loss = val_loss
            torch.save(model.state_dict(), model_path)
            epochs_no_improve = 0
        elif not dry_run:
            epochs_no_improve += 1

        # — Progress logging every 10 epochs —
        if epoch % 10 == 0 or epoch == 1:
            logger.info(
                "Epoch %3d/%d  train_loss=%.6f  val_loss=%.6f",
                epoch, epochs, train_loss, val_loss,
            )

        # — Early stopping —
        if not dry_run and epochs_no_improve >= PATIENCE:
            logger.info("Early stopping at epoch %d (no val improvement for %d epochs).",
                        epoch, PATIENCE)
            break

    # ── 4. Test evaluation ────────────────────────────────────────────────────
    # Load best checkpoint for evaluation (skip in dry-run)
    if not dry_run and model_path.exists():
        model.load_state_dict(torch.load(model_path, map_location=device))

    model.eval()
    all_preds, all_true = [], []
    with torch.no_grad():
        for X_batch, y_batch in test_loader:
            preds = model(X_batch.to(device)).squeeze(-1).cpu().numpy()
            all_preds.append(preds)
            all_true.append(y_batch.numpy())

    y_pred_norm = np.concatenate(all_preds)
    y_true_norm = np.concatenate(all_true)

    metrics = compute_metrics(y_true_norm, y_pred_norm, scaler)

    logger.info("── Test Metrics (%s) ─────────────────────────────────────", coin)
    logger.info("  RMSE:                 $%.2f", metrics["rmse"])
    logger.info("  MAE:                  $%.2f", metrics["mae"])
    logger.info("  Directional accuracy: %.1f%%", metrics["directional_accuracy_pct"])

    # ── 5. Save metrics ───────────────────────────────────────────────────────
    if not dry_run:
        metrics["epochs_trained"] = epoch
        metrics["best_val_loss"] = float(best_val_loss)
        metrics["coin"] = coin
        with open(metrics_path, "w") as f:
            json.dump(metrics, f, indent=2)
        logger.info("Metrics saved to %s", metrics_path)
        logger.info("Model weights saved to %s", model_path)

    return metrics


# ── CLI entry-point ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train BTC / DOGE LSTM model")
    parser.add_argument(
        "--coin", type=str, default="bitcoin",
        choices=["bitcoin", "dogecoin"],
        help="CoinGecko coin id to train on (default: bitcoin)",
    )
    parser.add_argument("--epochs", type=int, default=EPOCHS, help="Max training epochs")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Run 2 epochs and skip saving (for testing)"
    )
    args = parser.parse_args()

    train(
        coin=args.coin,
        epochs=args.epochs,
        batch_size=args.batch_size,
        dry_run=args.dry_run,
    )
