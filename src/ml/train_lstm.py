"""
train_lstm.py — Training script for the BTC / DOGE LSTM price-prediction model.

Usage
-----
    python src/ml/train_lstm.py [--coin bitcoin|dogecoin] [--epochs N]
                                [--batch-size B] [--dry-run]
                                [--alpha A] [--beta B]

Steps
-----
1. Load & preprocess sequences from  data/sample/{coin}.csv  (via preprocess.py)
   Returns 11-tuple: X_train, y_train, y_dir_train, X_val, y_val, y_dir_val,
                     X_test, y_test, y_dir_test, scaler, last_price_usd
2. Build PyTorch TensorDataset / DataLoader  (shuffle=False — time series)
3. Train for EPOCHS epochs with Adam + HuberLoss (price) + CrossEntropyLoss (direction)
   Combined loss = alpha * price_loss + beta * dir_loss
4. Track validation loss each epoch; save best weights to
   src/ml/model/lstm_{coin}_v2.pt
5. Evaluate on test set; reconstruct USD prices via last_price * exp(cumsum(log_returns))
6. Print RMSE, MAE, directional accuracy, and classification F1-macro
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

# Loss combination weights
DEFAULT_ALPHA = 0.3   # weight for price (Huber) loss — auxiliary task
DEFAULT_BETA  = 1.0   # weight for direction (CrossEntropy) loss — primary task

# Direction-weighted loss penalty: wrong-direction predictions get 1 + PENALTY_FACTOR weight
DIRECTION_PENALTY = 2.0


def _compute_class_weights(y_dir: np.ndarray, n_classes: int = 3) -> torch.Tensor:
    """Compute inverse-frequency class weights for CrossEntropyLoss.

    Handles remaining class imbalance after adaptive-threshold labelling.
    """
    counts = np.bincount(y_dir.flatten(), minlength=n_classes).astype(np.float64)
    counts = np.maximum(counts, 1)
    weights = 1.0 / counts
    weights /= weights.sum()
    return torch.tensor(weights, dtype=torch.float32)


def _direction_weighted_huber(
    pred: torch.Tensor,
    target: torch.Tensor,
    penalty_factor: float = DIRECTION_PENALTY,
    delta: float = 1.0,
) -> torch.Tensor:
    """Huber loss penalised for wrong-direction predictions.

    Samples where sign(pred) != sign(target) receive weight
    ``1 + penalty_factor``, pushing the regression head to care about
    trend direction in addition to magnitude accuracy.
    """
    base = nn.functional.huber_loss(pred, target, reduction="none", delta=delta)
    direction_correct = (pred.sign() == target.sign()).float()
    weight = 1.0 + (1.0 - direction_correct) * penalty_factor
    return (base * weight).mean()


def _model_path(coin: str, version: int = 2) -> Path:
    return _MODEL_DIR / f"lstm_{coin}_v{version}.pt"


def _metrics_path(coin: str) -> Path:
    return _MODEL_DIR / f"metrics_{coin}.json"


def _scaler_path(coin: str) -> Path:
    return _MODEL_DIR / f"scaler_{coin}.pkl"


# ── Evaluation helpers ─────────────────────────────────────────────────────────

def compute_metrics(
    y_true_norm: np.ndarray,      # (M, 7) normalised log_return_1d targets
    y_pred_norm: np.ndarray,      # (M, 7) normalised log_return_1d predictions
    y_dir_true: np.ndarray,       # (M, 7) direction labels (int, {0,1,2})
    y_dir_pred_logits: np.ndarray | None,  # (M, 7, 3) logits or None
    scaler,
    last_price_usd: float,
) -> dict:
    """Return RMSE, MAE, directional accuracy, direction_accuracy_pct, f1_macro,
    per_class_accuracy (dict) and confusion_matrix (list[list[int]]).

    Un-standardises feature-0 (log_return_1d) using the scaler's mean/scale,
    then reconstructs cumulative USD price paths from last_price_usd.
    RMSE/MAE are computed across all M sequences and all 7 horizon steps.
    Price directional accuracy uses only step-1 (first next-day log_return sign).
    direction_accuracy_pct and f1_macro use the direction-head predictions.
    """
    mean0  = scaler.mean_[0]
    scale0 = scaler.scale_[0]

    # Un-standardise: log_return = norm_value * scale + mean
    y_true_lr = y_true_norm * scale0 + mean0   # (M, 7)
    y_pred_lr = y_pred_norm * scale0 + mean0   # (M, 7)

    # Reconstruct cumulative USD price paths
    y_true_usd = last_price_usd * np.exp(np.cumsum(y_true_lr, axis=1))
    y_pred_usd = last_price_usd * np.exp(np.cumsum(y_pred_lr, axis=1))

    rmse = float(np.sqrt(np.mean((y_true_usd - y_pred_usd) ** 2)))
    mae  = float(np.mean(np.abs(y_true_usd - y_pred_usd)))

    # Price directional accuracy — step-1 direction (sign of first log_return)
    if len(y_true_lr) > 0:
        dir_true_price = np.sign(y_true_lr[:, 0])
        dir_pred_price = np.sign(y_pred_lr[:, 0])
        dir_acc_price  = float(np.mean(dir_true_price == dir_pred_price) * 100)
    else:
        dir_acc_price = 0.0

    # Direction head accuracy + F1 (multi-class {0=DOWN, 1=FLAT, 2=UP})
    direction_accuracy_pct = 0.0
    f1_macro = 0.0
    per_class_accuracy: dict[str, float] = {}
    confusion: list[list[int]] = []

    if y_dir_pred_logits is not None and len(y_dir_true) > 0:
        # y_dir_pred_logits: (M, 7, 3) — argmax over class dim
        y_dir_pred_cls = np.argmax(y_dir_pred_logits, axis=2)   # (M, 7)

        # Flatten all M*7 step predictions for accuracy/F1
        true_flat = y_dir_true.flatten()
        pred_flat = y_dir_pred_cls.flatten()

        direction_accuracy_pct = float(np.mean(true_flat == pred_flat) * 100)

        try:
            from sklearn.metrics import f1_score, confusion_matrix
            f1_macro = float(f1_score(true_flat, pred_flat, average="macro", zero_division=0))

            # Per-class accuracy for DOWN / FLAT / UP
            _labels = {0: "DOWN", 1: "FLAT", 2: "UP"}
            for cls_idx, cls_name in _labels.items():
                mask = true_flat == cls_idx
                if mask.sum() > 0:
                    per_class_accuracy[cls_name] = float(
                        (pred_flat[mask] == cls_idx).mean() * 100
                    )

            # Confusion matrix (3×3)
            cm = confusion_matrix(true_flat, pred_flat, labels=[0, 1, 2])
            confusion = cm.tolist()
        except ImportError:
            logger.warning("sklearn not available; skipping f1_macro and confusion matrix.")

    return {
        "rmse": rmse,
        "mae": mae,
        "directional_accuracy_pct": dir_acc_price,
        "direction_accuracy_pct": direction_accuracy_pct,
        "f1_macro": f1_macro,
        "per_class_accuracy": per_class_accuracy,
        "confusion_matrix": confusion,
    }


# ── Training loop ──────────────────────────────────────────────────────────────

def train(
    coin: str = "bitcoin",
    csv_path: Path | None = None,
    epochs: int = EPOCHS,
    batch_size: int = BATCH_SIZE,
    dry_run: bool = False,
    alpha: float = DEFAULT_ALPHA,
    beta: float = DEFAULT_BETA,
    loss_type: str = "direction_weighted",
) -> dict[str, float]:
    """
    Main training entry-point.

    Parameters
    ----------
    coin       : coin id — "bitcoin" or "dogecoin"
    csv_path   : override CSV path (defaults to data/sample/{coin}.csv)
    epochs     : maximum training epochs.
    batch_size : DataLoader batch size.
    dry_run    : if True, run only 2 epochs and skip saving (for CI/testing).
    alpha      : weight for price loss.
    beta       : weight for direction (CrossEntropy) loss.
    loss_type  : "direction_weighted" (default) — Huber penalised for wrong
                 direction; or "standard" — plain HuberLoss.
                 Both modes use class-weighted CrossEntropyLoss for the
                 direction head.

    Returns
    -------
    metrics dict (rmse, mae, directional_accuracy_pct, direction_accuracy_pct, f1_macro)
    """
    if dry_run:
        epochs = 2
        logger.info("Dry-run mode — 2 epochs only, model not saved.")

    if csv_path is None:
        csv_path = _DATA_DIR / f"{coin}.csv"

    model_path_v2 = _model_path(coin, version=2)
    metrics_path  = _metrics_path(coin)
    scaler_path   = _scaler_path(coin)

    device = torch.device("cpu")   # CPU is sufficient for 3k rows

    # ── 1. Data ───────────────────────────────────────────────────────────────
    logger.info("Loading and preprocessing data from %s ...", csv_path)
    (
        X_train, y_train, y_dir_train,
        X_val,   y_val,   y_dir_val,
        X_test,  y_test,  y_dir_test,
        scaler,  last_price_usd,
    ) = load_and_preprocess(
        csv_path=csv_path,
        save_scaler=(not dry_run),
        scaler_path=scaler_path,
        with_fear_greed=True,
    )

    def _to_tensors(X, y, y_dir):
        return (
            torch.tensor(X, dtype=torch.float32),
            torch.tensor(y, dtype=torch.float32),
            torch.tensor(y_dir, dtype=torch.long),
        )

    # shuffle=False — critical for time-series data
    train_ds = TensorDataset(*_to_tensors(X_train, y_train, y_dir_train))
    val_ds   = TensorDataset(*_to_tensors(X_val,   y_val,   y_dir_val))
    test_ds  = TensorDataset(*_to_tensors(X_test,  y_test,  y_dir_test))

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=False)
    val_loader   = DataLoader(val_ds,   batch_size=batch_size, shuffle=False)
    test_loader  = DataLoader(test_ds,  batch_size=batch_size, shuffle=False)

    # ── 2. Model ──────────────────────────────────────────────────────────────
    n_features = X_train.shape[2]   # 9 for new pipeline
    model = LSTMModel(
        input_size=n_features,
        hidden_size=128,
        num_layers=2,
        dropout=0.2,
        output_size=7,
        use_direction_head=True,
        n_classes=3,
    ).to(device)

    # Class weights from training labels to handle residual imbalance
    class_weights = _compute_class_weights(y_dir_train, n_classes=3).to(device)
    logger.info(
        "Direction class weights — DOWN: %.4f  FLAT: %.4f  UP: %.4f",
        class_weights[0].item(), class_weights[1].item(), class_weights[2].item(),
    )

    price_criterion = nn.HuberLoss(delta=1.0)   # used only for 'standard' mode
    dir_criterion   = nn.CrossEntropyLoss(weight=class_weights)
    optimizer = torch.optim.Adam(
        model.parameters(), lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY
    )
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, mode="min", patience=5, factor=0.5
    )

    # ── 3. Training loop ──────────────────────────────────────────────────────
    model_path_v2.parent.mkdir(parents=True, exist_ok=True)

    best_val_loss = float("inf")
    epochs_no_improve = 0
    epoch = 1

    for epoch in range(1, epochs + 1):
        # — Train —
        model.train()
        train_loss_sum = 0.0
        for X_batch, y_batch, y_dir_batch in train_loader:
            X_batch    = X_batch.to(device)
            y_batch    = y_batch.to(device)
            y_dir_batch = y_dir_batch.to(device)

            optimizer.zero_grad()
            price_preds, dir_logits = model(X_batch)   # (B,7), (B,7,3)

            # Price loss — direction_weighted penalises wrong-sign predictions
            if loss_type == "direction_weighted":
                p_loss = _direction_weighted_huber(price_preds, y_batch)
            else:
                p_loss = price_criterion(price_preds, y_batch)

            # Direction loss: CrossEntropy expects (B*7, 3) logits and (B*7,) targets
            B = dir_logits.size(0)
            d_loss = dir_criterion(
                dir_logits.view(B * 7, 3),
                y_dir_batch.view(B * 7),
            )

            loss = alpha * p_loss + beta * d_loss
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
            for X_batch, y_batch, y_dir_batch in val_loader:
                X_batch    = X_batch.to(device)
                y_batch    = y_batch.to(device)
                y_dir_batch = y_dir_batch.to(device)
                price_preds, dir_logits = model(X_batch)
                B = dir_logits.size(0)
                if loss_type == "direction_weighted":
                    p_loss = _direction_weighted_huber(price_preds, y_batch)
                else:
                    p_loss = price_criterion(price_preds, y_batch)
                d_loss = dir_criterion(
                    dir_logits.view(B * 7, 3),
                    y_dir_batch.view(B * 7),
                )
                combined = alpha * p_loss + beta * d_loss
                val_loss_sum += combined.item() * len(X_batch)

        val_loss = val_loss_sum / max(len(val_ds), 1)

        scheduler.step(val_loss)

        # — Checkpoint —
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            epochs_no_improve = 0
            if not dry_run:
                torch.save(model.state_dict(), model_path_v2)
        else:
            epochs_no_improve += 1

        # — Progress logging every 5 epochs —
        if epoch % 5 == 0 or epoch == 1:
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
    if not dry_run and model_path_v2.exists():
        model.load_state_dict(torch.load(model_path_v2, map_location=device))

    model.eval()
    all_price_preds, all_dir_logits, all_true, all_dir_true = [], [], [], []
    with torch.no_grad():
        for X_batch, y_batch, y_dir_batch in test_loader:
            price_preds, dir_logits = model(X_batch.to(device))
            all_price_preds.append(price_preds.cpu().numpy())
            all_dir_logits.append(dir_logits.cpu().numpy())
            all_true.append(y_batch.numpy())
            all_dir_true.append(y_dir_batch.numpy())

    y_pred_norm    = np.concatenate(all_price_preds)   # (M, 7)
    y_dir_logits   = np.concatenate(all_dir_logits)    # (M, 7, 3)
    y_true_norm    = np.concatenate(all_true)          # (M, 7)
    y_dir_true_all = np.concatenate(all_dir_true)      # (M, 7)

    metrics = compute_metrics(
        y_true_norm, y_pred_norm,
        y_dir_true_all, y_dir_logits,
        scaler, last_price_usd,
    )

    logger.info("── Test Metrics (%s) ─────────────────────────────────────", coin)
    logger.info("  [PRIMARY]  F1 macro:              %.4f  (chance=0.333)",
                metrics["f1_macro"])
    logger.info("  [PRIMARY]  Direction accuracy:    %.1f%%  (chance=33.3%%)",
                metrics["direction_accuracy_pct"])
    pca = metrics.get("per_class_accuracy", {})
    logger.info("  [PRIMARY]  Per-class accuracy:    DOWN=%.1f%%  FLAT=%.1f%%  UP=%.1f%%",
                pca.get("DOWN", 0), pca.get("FLAT", 0), pca.get("UP", 0))
    cm = metrics.get("confusion_matrix", [])
    if cm:
        logger.info("  Confusion matrix (rows=true, cols=pred) [DOWN, FLAT, UP]:")
        for i, row in enumerate(cm):
            logger.info("    %s: %s", ["DOWN", "FLAT", "UP"][i], row)
    logger.info("  [SECONDARY] RMSE:                 $%.2f", metrics["rmse"])
    logger.info("  [SECONDARY] MAE:                  $%.2f", metrics["mae"])
    logger.info("  [SECONDARY] Price dir accuracy:   %.1f%%", metrics["directional_accuracy_pct"])

    # ── 5. Save metrics ───────────────────────────────────────────────────────
    if not dry_run:
        metrics["epochs_trained"] = epoch
        metrics["best_val_loss"] = float(best_val_loss)
        metrics["coin"] = coin
        metrics["last_price_usd"] = last_price_usd
        metrics["alpha"] = alpha
        metrics["beta"] = beta
        metrics["loss_type"] = loss_type
        with open(metrics_path, "w") as f:
            json.dump(metrics, f, indent=2)
        logger.info("Metrics saved to %s", metrics_path)
        logger.info("Model weights saved to %s", model_path_v2)

    return metrics


# ── CLI entry-point ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train BTC / DOGE LSTM model (v2 multi-task)")
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
    parser.add_argument(
        "--alpha", type=float, default=DEFAULT_ALPHA,
        help="Weight for price loss (default: 1.0)"
    )
    parser.add_argument(
        "--beta", type=float, default=DEFAULT_BETA,
        help="Weight for direction (CrossEntropy) loss (default: 0.5)"
    )
    parser.add_argument(
        "--loss-type", type=str, default="direction_weighted",
        choices=["direction_weighted", "standard"],
        help=(
            "Price loss variant: 'direction_weighted' (default) penalises wrong-sign "
            "predictions; 'standard' uses plain HuberLoss."
        ),
    )
    args = parser.parse_args()

    train(
        coin=args.coin,
        epochs=args.epochs,
        batch_size=args.batch_size,
        dry_run=args.dry_run,
        alpha=args.alpha,
        beta=args.beta,
        loss_type=args.loss_type,
    )
