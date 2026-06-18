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

from preprocess import load_and_preprocess, HORIZON as _DEFAULT_HORIZON, SEQ_LEN as _SEQ_LEN, HORIZON_SEQ_LEN_MAP, HORIZON_WINDOW_DAYS_MAP
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
# Docker mounts data/ at /app/data; local dev has data/ at project root two levels up
_DATA_DIR = _HERE / "data" / "sample"
if not _DATA_DIR.exists():
    _DATA_DIR = _HERE.parent.parent / "data" / "sample"

# ── Hyper-parameters ───────────────────────────────────────────────────────────
EPOCHS = 50
BATCH_SIZE = 64
LEARNING_RATE = 1e-3
WEIGHT_DECAY = 1e-5
PATIENCE = 7         # early-stopping patience (7 suits ~3k-row crypto datasets)

# Loss combination weights
DEFAULT_ALPHA = 1.0   # weight for price (Huber) loss — only loss used (direction head disabled)
DEFAULT_BETA  = 0.0   # unused — direction head removed; direction derived from price forecast sign

# Direction-weighted loss penalty: wrong-direction predictions get 1 + PENALTY_FACTOR weight
DIRECTION_PENALTY = 2.0


def _compute_class_weights(y_dir: np.ndarray, n_classes: int = 2) -> torch.Tensor:
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


def _model_path_h(coin: str, horizon: int, version: int = 3) -> Path:
    return _MODEL_DIR / f"lstm_{coin}_h{horizon}_v{version}.pt"


def _metrics_path(coin: str) -> Path:
    return _MODEL_DIR / f"metrics_{coin}.json"


def _score_report_path(coin: str, horizon: int) -> Path:
    return _MODEL_DIR / f"score_report_{coin}_h{horizon}.json"


def _scaler_path(coin: str, version: int = 2) -> Path:
    if version <= 2:
        return _MODEL_DIR / f"scaler_{coin}.pkl"
    return _MODEL_DIR / f"scaler_{coin}_v{version}.pkl"


def _scaler_path_h(coin: str, horizon: int, version: int = 3) -> Path:
    return _MODEL_DIR / f"scaler_{coin}_h{horizon}_v{version}.pkl"


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
        # y_dir_pred_logits: (M, 7, 2) — argmax over class dim
        y_dir_pred_cls = np.argmax(y_dir_pred_logits, axis=2)   # (M, 7)

        # Flatten all M*7 step predictions for accuracy/F1
        true_flat = y_dir_true.flatten()
        pred_flat = y_dir_pred_cls.flatten()

        direction_accuracy_pct = float(np.mean(true_flat == pred_flat) * 100)

        try:
            from sklearn.metrics import f1_score, confusion_matrix
            f1_macro = float(f1_score(true_flat, pred_flat, average="macro", zero_division=0))

            # Per-class accuracy for DOWN / UP (binary)
            _labels = {0: "DOWN", 1: "UP"}
            for cls_idx, cls_name in _labels.items():
                mask = true_flat == cls_idx
                if mask.sum() > 0:
                    per_class_accuracy[cls_name] = float(
                        (pred_flat[mask] == cls_idx).mean() * 100
                    )

            # Confusion matrix (2×2)
            cm = confusion_matrix(true_flat, pred_flat, labels=[0, 1])
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
    *,
    window_days: int | None = 730,
    gamma: float = 0.3,
    model_version: int = 3,
    horizon: int = _DEFAULT_HORIZON,
) -> dict[str, float]:
    """
    Main training entry-point.

    Parameters
    ----------
    coin          : coin id — "bitcoin" or "dogecoin"
    csv_path      : override CSV path (defaults to data/sample/{coin}.csv)
    epochs        : maximum training epochs.
    batch_size    : DataLoader batch size.
    dry_run       : if True, run only 2 epochs and skip saving (for CI/testing).
    alpha         : weight for price loss (default 1.0).
    beta          : unused (kept for backward compat).
    loss_type     : "direction_weighted" | "standard".
    window_days   : rolling training window (default 730, None = all data).
    gamma         : weight for volatility (MSE) loss (default 0.3).
    model_version : output file version number (default 3 → lstm_{coin}_v3.pt).

    Returns
    -------
    metrics dict (rmse, mae, directional_accuracy_pct, direction_accuracy_pct, f1_macro)
    """
    if dry_run:
        epochs = 2
        logger.info("Dry-run mode — 2 epochs only, model not saved.")

    # Auto-select window_days from horizon map when using the default (730)
    if window_days == 730:
        mapped = HORIZON_WINDOW_DAYS_MAP.get(horizon, 730)
        window_days = None if mapped == 0 else mapped

    if csv_path is None:
        csv_path = _DATA_DIR / f"{coin}.csv"

    out_model_path = _model_path_h(coin, horizon, version=model_version)
    scaler_out     = _scaler_path_h(coin, horizon, version=model_version)
    metrics_path   = _metrics_path(coin)
    score_path     = _score_report_path(coin, horizon)

    device = torch.device("cpu")   # CPU is sufficient for 3k rows

    # ── 1. Data ───────────────────────────────────────────────────────────────
    logger.info("Loading and preprocessing data from %s (window_days=%s) ...",
                csv_path, window_days)
    result = load_and_preprocess(
        csv_path=csv_path,
        save_scaler=(not dry_run),
        scaler_path=scaler_out,
        with_fear_greed=True,
        window_days=window_days,
        with_vol_target=True,
        horizon=horizon,
    )
    (
        X_train, y_train, y_dir_train,
        X_val,   y_val,   y_dir_val,
        X_test,  y_test,  y_dir_test,
        scaler,  last_price_usd,
        y_vol_train, y_vol_val, y_vol_test,
    ) = result

    def _to_tensors(X, y, y_dir, y_vol):
        return (
            torch.tensor(X,     dtype=torch.float32),
            torch.tensor(y,     dtype=torch.float32),
            torch.tensor(y_dir, dtype=torch.long),
            torch.tensor(y_vol, dtype=torch.float32),
        )

    # shuffle=False — critical for time-series data
    train_ds = TensorDataset(*_to_tensors(X_train, y_train, y_dir_train, y_vol_train))
    val_ds   = TensorDataset(*_to_tensors(X_val,   y_val,   y_dir_val,   y_vol_val))
    test_ds  = TensorDataset(*_to_tensors(X_test,  y_test,  y_dir_test,  y_vol_test))

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=False)
    val_loader   = DataLoader(val_ds,   batch_size=batch_size, shuffle=False)
    test_loader  = DataLoader(test_ds,  batch_size=batch_size, shuffle=False)

    # ── 2. Model ──────────────────────────────────────────────────────────────
    n_features = X_train.shape[2]   # 9 for v3 pipeline
    model = LSTMModel(
        input_size=n_features,
        hidden_size=128,
        num_layers=2,
        dropout=0.2,
        output_size=horizon,
        use_direction_head=False,
        use_volatility_head=True,
    ).to(device)

    price_criterion = nn.HuberLoss(delta=1.0)
    vol_criterion   = nn.MSELoss()
    optimizer = torch.optim.Adam(
        model.parameters(), lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY
    )
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, mode="min", patience=5, factor=0.5
    )

    # ── 3. Training loop ──────────────────────────────────────────────────────
    out_model_path.parent.mkdir(parents=True, exist_ok=True)

    best_val_loss = float("inf")
    epochs_no_improve = 0
    epoch = 1

    for epoch in range(1, epochs + 1):
        # — Train —
        model.train()
        train_loss_sum = 0.0
        for X_batch, y_batch, y_dir_batch, y_vol_batch in train_loader:
            X_batch     = X_batch.to(device)
            y_batch     = y_batch.to(device)
            y_vol_batch = y_vol_batch.to(device)

            optimizer.zero_grad()
            price_preds, vol_preds = model(X_batch)   # (B, 7), (B, 7)

            if loss_type == "direction_weighted":
                price_loss = _direction_weighted_huber(price_preds, y_batch)
            else:
                price_loss = price_criterion(price_preds, y_batch)

            vol_loss = vol_criterion(vol_preds, y_vol_batch)
            loss = alpha * price_loss + gamma * vol_loss

            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
            train_loss_sum += loss.item() * len(X_batch)

        train_loss = train_loss_sum / len(train_ds)

        # — Validate —
        model.eval()
        val_loss_sum = 0.0
        with torch.no_grad():
            for X_batch, y_batch, y_dir_batch, y_vol_batch in val_loader:
                X_batch     = X_batch.to(device)
                y_batch     = y_batch.to(device)
                y_vol_batch = y_vol_batch.to(device)
                price_preds, vol_preds = model(X_batch)
                if loss_type == "direction_weighted":
                    p_loss = _direction_weighted_huber(price_preds, y_batch)
                else:
                    p_loss = price_criterion(price_preds, y_batch)
                v_loss = vol_criterion(vol_preds, y_vol_batch)
                val_loss_val = alpha * p_loss + gamma * v_loss
                val_loss_sum += val_loss_val.item() * len(X_batch)

        val_loss = val_loss_sum / max(len(val_ds), 1)

        scheduler.step(val_loss)

        # — Checkpoint —
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            epochs_no_improve = 0
            if not dry_run:
                torch.save(model.state_dict(), out_model_path)
        else:
            epochs_no_improve += 1

        # — Overfitting detection —
        if train_loss > 0 and val_loss > 2.5 * train_loss and epoch > 5:
            logger.warning(
                "Epoch %3d: val_loss (%.6f) >> train_loss (%.6f) — possible overfitting.",
                epoch, val_loss, train_loss,
            )

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
    if not dry_run and out_model_path.exists():
        model.load_state_dict(
            torch.load(out_model_path, map_location=device, weights_only=True)
        )

    model.eval()
    all_price_preds, all_true, all_dir_true, all_vol_preds = [], [], [], []
    with torch.no_grad():
        for X_batch, y_batch, y_dir_batch, y_vol_batch in test_loader:
            price_preds, vol_preds = model(X_batch.to(device))
            all_price_preds.append(price_preds.cpu().numpy())
            all_true.append(y_batch.numpy())
            all_dir_true.append(y_dir_batch.numpy())
            all_vol_preds.append(vol_preds.cpu().numpy())

    if not all_price_preds:
        logger.warning("Test set is empty — skipping test metrics (try a larger dataset or window_days).")
        return {"rmse": 0.0, "mae": 0.0, "directional_accuracy_pct": 0.0,
                "direction_accuracy_pct": 0.0, "f1_macro": 0.0,
                "per_class_accuracy": {}, "confusion_matrix": []}

    y_pred_norm    = np.concatenate(all_price_preds)   # (M, 7)
    y_true_norm    = np.concatenate(all_true)          # (M, 7)
    y_dir_true_all = np.concatenate(all_dir_true)      # (M, 7)
    y_vol_pred_all = np.concatenate(all_vol_preds)     # (M, 7)

    metrics = compute_metrics(
        y_true_norm, y_pred_norm,
        y_dir_true_all, None,
        scaler, last_price_usd,
    )

    # Vol head RMSE (in scaled units; informational only)
    vol_rmse = float(np.sqrt(np.mean((y_vol_pred_all - y_vol_test) ** 2))) if len(y_vol_test) > 0 else 0.0

    logger.info("── Test Metrics (%s, v%d) ──────────────────────────────────",
                coin, model_version)
    logger.info("  Price dir accuracy:  %.1f%%", metrics["directional_accuracy_pct"])
    logger.info("  RMSE:                $%.2f",  metrics["rmse"])
    logger.info("  MAE:                 $%.2f",  metrics["mae"])
    logger.info("  Vol head RMSE:       %.6f (scaled units)", vol_rmse)

    # ── 5. Save metrics ───────────────────────────────────────────────────────
    if not dry_run:
        metrics["epochs_trained"]  = epoch
        metrics["best_val_loss"]   = float(best_val_loss)
        metrics["coin"]            = coin
        metrics["last_price_usd"]  = last_price_usd
        metrics["alpha"]           = alpha
        metrics["gamma"]           = gamma
        metrics["loss_type"]       = loss_type
        metrics["model_version"]   = model_version
        metrics["window_days"]     = window_days
        metrics["vol_rmse_scaled"] = vol_rmse
        with open(metrics_path, "w") as f:
            json.dump(metrics, f, indent=2)
        logger.info("Metrics saved to %s", metrics_path)
        logger.info("Model saved to %s", out_model_path)
        logger.info("Scaler saved to %s", scaler_out)

    # ── Walk-forward validation + score report ────────────────────────────────
    if not dry_run:
        from walk_forward import walk_forward_validation, FOLD_SIZE  # noqa: PLC0415
        # With context prepend, val_seqs = fold_size - horizon + 1.
        # Ensure at least 10 val sequences per fold regardless of horizon.
        wf_fold_size = max(FOLD_SIZE, horizon + 9)
        logger.info(
            "Running walk-forward validation (horizon=%d, fold_size=%d) ...",
            horizon, wf_fold_size,
        )
        wf = walk_forward_validation(
            csv_path=csv_path,
            window_days=window_days or 730,
            horizon=horizon,
            fold_size=wf_fold_size,
        )
        score_report = {
            "coin":                      coin,
            "horizon":                   horizon,
            "rmse":                      metrics["rmse"],
            "mae":                       metrics["mae"],
            "directional_accuracy_pct":  metrics["directional_accuracy_pct"],
            "walk_forward_dir_acc_mean": wf.get("dir_acc_mean"),
            "walk_forward_rmse_mean":    wf.get("rmse_mean"),
            "per_fold_metrics":          wf.get("fold_metrics", []),
            "epochs_trained":            metrics.get("epochs_trained"),
            "best_val_loss":             metrics.get("best_val_loss"),
            "window_days":               window_days,
        }
        score_path.parent.mkdir(parents=True, exist_ok=True)
        with open(score_path, "w") as f:
            json.dump(score_report, f, indent=2)
        logger.info("Score report saved to %s", score_path)
        logger.info(
            "── Score Report (horizon=%d) ─────────────────────────────────────",
            horizon,
        )
        logger.info("  RMSE:               $%.2f",  score_report["rmse"])
        logger.info("  MAE:                $%.2f",  score_report["mae"])
        logger.info("  Test dir acc:       %.1f%%", score_report["directional_accuracy_pct"])
        logger.info("  WF dir acc (mean):  %.1f%%", wf.get("dir_acc_mean") or 0)
        logger.info("  WF RMSE (mean):     $%.2f",  wf.get("rmse_mean") or 0)

        # Register model in MongoDB registry with full score_report
        try:
            from model_registry import register_model   # noqa: PLC0415
            register_model(coin=coin, horizon=horizon, metrics=metrics, score_report=score_report)
            logger.info("Model registered in registry (coin=%s, horizon=%d).", coin, horizon)
        except Exception as _reg_exc:
            logger.warning("Model registry update skipped (non-fatal): %s", _reg_exc)

    return metrics


# ── CLI entry-point ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train BTC / DOGE LSTM model (v3 rolling window + vol head)")
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
        help="Unused — kept for backward compat."
    )
    parser.add_argument(
        "--loss-type", type=str, default="direction_weighted",
        choices=["direction_weighted", "standard"],
        help=(
            "Price loss variant: 'direction_weighted' (default) penalises wrong-sign "
            "predictions; 'standard' uses plain HuberLoss."
        ),
    )
    parser.add_argument(
        "--window-days", type=int, default=730,
        help="Rolling training window in days (default: 730 = 2 years; 0 = all data)",
    )
    parser.add_argument(
        "--gamma", type=float, default=0.3,
        help="Weight for volatility (MSE) loss (default: 0.3)",
    )
    parser.add_argument(
        "--model-version", type=int, default=3,
        help="Output model version number (default: 3 → lstm_{coin}_v3.pt)",
    )
    parser.add_argument(
        "--walk-forward", action="store_true",
        help="Run walk-forward validation and print results before training.",
    )
    parser.add_argument(
        "--horizon", type=int, default=_DEFAULT_HORIZON,
        help=(
            f"Forecast horizon in days (default: {_DEFAULT_HORIZON}). "
            "Non-default values save to lstm_{coin}_h{horizon}_v{version}.pt "
            "so the existing H7 artifact is not overwritten."
        ),
    )
    args = parser.parse_args()

    window = None if args.window_days == 0 else args.window_days

    # Optional walk-forward validation before full training
    if args.walk_forward:
        from walk_forward import walk_forward_validation   # noqa: PLC0415
        csv_path_wf = _DATA_DIR / f"{args.coin}.csv"
        logger.info("Running walk-forward validation for %s ...", args.coin)
        wf_results = walk_forward_validation(csv_path_wf, window_days=window or 730, horizon=args.horizon)
        print("\n── Walk-Forward Results ──────────────────────────────")
        print(f"  Folds completed : {wf_results['n_folds_used']}")
        print(f"  RMSE (mean)     : ${wf_results['rmse_mean']:,.2f}")
        print(f"  MAE  (mean)     : ${wf_results['mae_mean']:,.2f}")
        print(f"  Dir Acc (mean)  : {wf_results['dir_acc_mean']:.1f}%")
        for m in wf_results["fold_metrics"]:
            print(f"    Fold {m['fold']}: RMSE=${m['rmse']:,.2f}  "
                  f"MAE=${m['mae']:,.2f}  dir={m['dir_acc']:.1f}%  "
                  f"(n_tr={m['n_train']} n_vl={m['n_val']})")
        print()

    train(
        coin=args.coin,
        epochs=args.epochs,
        batch_size=args.batch_size,
        dry_run=args.dry_run,
        alpha=args.alpha,
        beta=args.beta,
        loss_type=args.loss_type,
        window_days=window,
        gamma=args.gamma,
        model_version=args.model_version,
        horizon=args.horizon,
    )
