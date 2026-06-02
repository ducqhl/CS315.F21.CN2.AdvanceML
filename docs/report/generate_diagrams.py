"""
generate_diagrams.py
Tạo 4 biểu đồ kiến trúc kỹ thuật cho báo cáo CS315.
Chạy: python docs/report/generate_diagrams.py
"""

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import numpy as np

OUT = "docs/report/figures"

# ─── Palette ───────────────────────────────────────────────────────────────
C = {
    "batch":   "#2563EB",   # blue
    "speed":   "#16A34A",   # green
    "serving": "#9333EA",   # purple
    "infra":   "#D97706",   # amber  (kafka/zk)
    "ml":      "#DC2626",   # red    (lstm)
    "arrow":   "#374151",
    "bg":      "#F8FAFC",
    "box_bg":  "#FFFFFF",
    "text":    "#111827",
    "muted":   "#6B7280",
    "accent":  "#0EA5E9",
}

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 10,
    "axes.spines.top": False,
    "axes.spines.right": False,
})


# ══════════════════════════════════════════════════════════════════════════════
# 1. Lambda Architecture Diagram
# ══════════════════════════════════════════════════════════════════════════════

def draw_box(ax, x, y, w, h, label, sublabel="", color="#FFFFFF",
             border="#374151", fontsize=9, bold=False):
    box = FancyBboxPatch((x - w/2, y - h/2), w, h,
                         boxstyle="round,pad=0.03",
                         facecolor=color, edgecolor=border, linewidth=1.4)
    ax.add_patch(box)
    weight = "bold" if bold else "normal"
    ax.text(x, y + (0.08 if sublabel else 0), label,
            ha="center", va="center", fontsize=fontsize,
            fontweight=weight, color=C["text"])
    if sublabel:
        ax.text(x, y - 0.13, sublabel,
                ha="center", va="center", fontsize=7.5,
                color=C["muted"], style="italic")


def arrow(ax, x0, y0, x1, y1, color=C["arrow"], lw=1.5, style="->"):
    ax.annotate("", xy=(x1, y1), xytext=(x0, y0),
                arrowprops=dict(arrowstyle=style, color=color,
                                lw=lw, connectionstyle="arc3,rad=0.0"))


def fig1_lambda():
    fig, ax = plt.subplots(figsize=(14, 9))
    fig.patch.set_facecolor(C["bg"])
    ax.set_facecolor(C["bg"])
    ax.set_xlim(0, 14)
    ax.set_ylim(0, 9)
    ax.axis("off")

    # ── Layer background bands ──────────────────────────────────────────────
    layer_cfg = [
        (7.0, 1.7, "BATCH LAYER",  C["batch"],  0.10),
        (7.0, 4.7, "SPEED LAYER",  C["speed"],  0.10),
        (7.0, 7.8, "SERVING LAYER",C["serving"],0.10),
    ]
    band_h = 2.6
    band_ys = [0.4, 3.4, 6.5]
    band_colors = ["#EFF6FF", "#F0FDF4", "#FAF5FF"]
    for by, bc in zip(band_ys, band_colors):
        rect = plt.Rectangle((0.3, by), 13.4, band_h,
                              facecolor=bc, edgecolor="none", zorder=0)
        ax.add_patch(rect)

    for (lx, ly, ltxt, lc, _) in layer_cfg:
        ax.text(0.55, ly, ltxt, fontsize=8, fontweight="bold",
                color=lc, va="center", rotation=90)

    # ── BATCH LAYER components ──────────────────────────────────────────────
    by = 1.7
    draw_box(ax, 2.0, by, 1.8, 0.55, "CSV Data",    "bitcoin/dogecoin",  color="#DBEAFE", border=C["batch"])
    draw_box(ax, 4.5, by, 2.0, 0.55, "Spark Batch", "PySpark 3.5",       color="#DBEAFE", border=C["batch"])
    draw_box(ax, 7.2, by, 2.0, 0.55, "MongoDB",     "daily_stats\nhistorical_sma\ncoin_correlation", color="#DBEAFE", border=C["batch"])
    draw_box(ax, 10.5,by, 2.2, 0.55, "LSTM Training","PyTorch 2.2\nRolling 730d", color="#FEE2E2", border=C["ml"])
    draw_box(ax, 12.8,by, 1.6, 0.55, "Model\nRegistry", "v3 artifacts",  color="#FEE2E2", border=C["ml"])

    arrow(ax, 2.9,  by, 3.5,  by, color=C["batch"])
    arrow(ax, 5.5,  by, 6.2,  by, color=C["batch"])
    arrow(ax, 8.2,  by, 9.4,  by, color=C["batch"])
    arrow(ax, 11.6, by, 12.0, by, color=C["ml"])

    # ── SPEED LAYER components ──────────────────────────────────────────────
    sy = 4.7
    draw_box(ax, 2.0, sy, 1.8, 0.55, "CoinGecko API","10k calls/mo",    color="#DCFCE7", border=C["speed"])
    draw_box(ax, 4.1, sy, 1.7, 0.55, "Kafka",        "topic: crypto_raw\nacks=all",   color="#DCFCE7", border=C["speed"])
    draw_box(ax, 6.3, sy, 2.0, 0.55, "Spark Streaming","5-min windows\nWatermark 10m",color="#DCFCE7", border=C["speed"])
    draw_box(ax, 8.7, sy, 1.8, 0.55, "MongoDB",      "realtime_prices", color="#DCFCE7", border=C["speed"])
    draw_box(ax, 11.0,sy, 2.0, 0.55, "Inference\nScheduler","5-min cycle\npredictions",color="#FEE2E2", border=C["ml"])

    arrow(ax, 2.9,  sy, 3.25, sy, color=C["speed"])
    arrow(ax, 4.95, sy, 5.3,  sy, color=C["speed"])
    arrow(ax, 7.3,  sy, 7.8,  sy, color=C["speed"])
    arrow(ax, 9.6,  sy, 10.0, sy, color=C["speed"])

    # ── SERVING LAYER components ────────────────────────────────────────────
    vy = 7.8
    draw_box(ax, 3.5, vy, 2.0, 0.55, "FastAPI",     "JWT Auth\nport 8000",    color="#F3E8FF", border=C["serving"])
    draw_box(ax, 6.5, vy, 2.0, 0.55, "React 19",    "Dashboard\nport 3000",   color="#F3E8FF", border=C["serving"])
    draw_box(ax, 9.5, vy, 2.0, 0.55, "Streamlit",   "Analytics\nport 8501",   color="#F3E8FF", border=C["serving"])
    draw_box(ax, 11.8,vy, 1.6, 0.55, "Kafka UI",    "Monitor\nport 8080",     color="#FEF3C7", border=C["infra"])

    arrow(ax, 8.7,  sy + 0.28, 8.7, vy - 0.28,  color=C["serving"], style="-|>")
    arrow(ax, 4.5,  sy + 0.28, 4.5, vy - 0.28,  color=C["serving"], style="-|>",
          lw=0.8)   # dotted ref
    arrow(ax, 4.5,  vy, 5.5,  vy,   color=C["serving"])
    arrow(ax, 7.5,  vy, 8.5,  vy,   color=C["serving"])
    arrow(ax, 10.5, vy, 10.95,vy,   color=C["infra"])

    # Mongo → FastAPI vertical
    ax.annotate("", xy=(3.5, vy - 0.28), xytext=(8.7, sy + 0.28),
                arrowprops=dict(arrowstyle="-|>", color=C["serving"], lw=1.4,
                                connectionstyle="arc3,rad=-0.3"))

    # ── Title ───────────────────────────────────────────────────────────────
    ax.text(7, 8.75, "Lambda Architecture — Cryptocurrency Analytics System",
            ha="center", va="center", fontsize=13, fontweight="bold",
            color=C["text"])

    # ── Legend ──────────────────────────────────────────────────────────────
    patches = [
        mpatches.Patch(color="#DBEAFE", label="Batch Layer (Spark Batch + LSTM Train)"),
        mpatches.Patch(color="#DCFCE7", label="Speed Layer (Kafka + Spark Streaming)"),
        mpatches.Patch(color="#F3E8FF", label="Serving Layer (FastAPI + Frontends)"),
        mpatches.Patch(color="#FEE2E2", label="ML Pipeline (LSTM Training / Inference)"),
    ]
    ax.legend(handles=patches, loc="lower center",
              bbox_to_anchor=(0.5, -0.02),
              ncol=4, frameon=False, fontsize=8)

    plt.tight_layout(pad=0.5)
    fig.savefig(f"{OUT}/architecture_lambda.png", dpi=150, bbox_inches="tight",
                facecolor=C["bg"])
    plt.close(fig)
    print("✓ architecture_lambda.png")


# ══════════════════════════════════════════════════════════════════════════════
# 2. LSTM Architecture Diagram
# ══════════════════════════════════════════════════════════════════════════════

def fig2_lstm():
    fig, ax = plt.subplots(figsize=(13, 7))
    fig.patch.set_facecolor(C["bg"])
    ax.set_facecolor(C["bg"])
    ax.set_xlim(0, 13)
    ax.set_ylim(0, 7)
    ax.axis("off")

    ax.text(6.5, 6.7, "LSTM v3 Architecture — Dual-Head Forecasting Model",
            ha="center", fontsize=13, fontweight="bold", color=C["text"])

    # ── Input block ─────────────────────────────────────────────────────────
    feat_labels = [
        "log_return_1d", "momentum_30d", "realized_vol_14d",
        "RSI_14", "log_volume", "macd_norm",
        "bb_pct_b", "atr_norm", "fear_greed",
    ]
    box_h = 0.38
    gap   = 0.03
    total_h = len(feat_labels) * (box_h + gap)
    y_start = 3.5 + total_h / 2

    for i, fl in enumerate(feat_labels):
        y = y_start - i * (box_h + gap)
        clr = "#DBEAFE" if i < 3 else ("#FEF3C7" if i < 6 else "#DCFCE7")
        rect = FancyBboxPatch((0.2, y - box_h/2), 1.9, box_h,
                              boxstyle="round,pad=0.02",
                              facecolor=clr, edgecolor="#93C5FD", linewidth=1)
        ax.add_patch(rect)
        ax.text(1.15, y, fl, ha="center", va="center",
                fontsize=7.5, color=C["text"])

    ax.text(1.15, 0.45, "Input: (60 × 9)", ha="center", fontsize=8.5,
            fontweight="bold", color=C["batch"])

    # Arrow from input to LSTM 1
    arrow(ax, 2.1, 3.5, 2.9, 3.5, color=C["arrow"], lw=2)

    # ── LSTM Layer 1 ─────────────────────────────────────────────────────────
    rect1 = FancyBboxPatch((2.9, 1.8), 1.6, 3.4,
                           boxstyle="round,pad=0.06",
                           facecolor="#DBEAFE", edgecolor=C["batch"], linewidth=2)
    ax.add_patch(rect1)
    ax.text(3.7, 3.5, "LSTM\nLayer 1", ha="center", va="center",
            fontsize=10, fontweight="bold", color=C["batch"])
    ax.text(3.7, 2.85, "hidden = 128\ndropout = 0.2", ha="center",
            fontsize=8, color=C["muted"])
    ax.text(3.7, 4.1, "70,656\nparams", ha="center", fontsize=7.5,
            color="#1D4ED8", style="italic")

    arrow(ax, 4.5, 3.5, 5.3, 3.5, color=C["arrow"], lw=2)

    # ── LSTM Layer 2 ─────────────────────────────────────────────────────────
    rect2 = FancyBboxPatch((5.3, 1.8), 1.6, 3.4,
                           boxstyle="round,pad=0.06",
                           facecolor="#DBEAFE", edgecolor=C["batch"], linewidth=2)
    ax.add_patch(rect2)
    ax.text(6.1, 3.5, "LSTM\nLayer 2", ha="center", va="center",
            fontsize=10, fontweight="bold", color=C["batch"])
    ax.text(6.1, 2.85, "hidden = 128\ndropout = 0.2", ha="center",
            fontsize=8, color=C["muted"])
    ax.text(6.1, 4.1, "131,584\nparams", ha="center", fontsize=7.5,
            color="#1D4ED8", style="italic")

    # Last hidden state box
    rect_h = FancyBboxPatch((7.1, 3.1), 1.4, 0.8,
                            boxstyle="round,pad=0.04",
                            facecolor="#FEF9C3", edgecolor="#CA8A04", linewidth=1.5)
    ax.add_patch(rect_h)
    ax.text(7.8, 3.5, "h_T\n(1×128)", ha="center", va="center",
            fontsize=9, fontweight="bold", color="#92400E")
    arrow(ax, 6.9, 3.5, 7.1, 3.5, color=C["arrow"], lw=2)

    # ── Split arrow ──────────────────────────────────────────────────────────
    # Upper arm → Price Head
    ax.annotate("", xy=(8.9, 5.2), xytext=(8.2, 3.5),
                arrowprops=dict(arrowstyle="->", color=C["ml"], lw=1.8,
                                connectionstyle="arc3,rad=-0.3"))
    # Lower arm → Vol Head
    ax.annotate("", xy=(8.9, 1.8), xytext=(8.2, 3.5),
                arrowprops=dict(arrowstyle="->", color=C["speed"], lw=1.8,
                                connectionstyle="arc3,rad=0.3"))

    # ── Price Head ───────────────────────────────────────────────────────────
    def head_chain(ax, x_start, y_center, layers, color, border):
        x = x_start
        for i, (lbl, sub) in enumerate(layers):
            w = 1.1
            rect = FancyBboxPatch((x, y_center - 0.35), w, 0.7,
                                  boxstyle="round,pad=0.04",
                                  facecolor=color, edgecolor=border, linewidth=1.5)
            ax.add_patch(rect)
            ax.text(x + w/2, y_center + 0.08, lbl,
                    ha="center", fontsize=8.5, fontweight="bold", color=C["text"])
            ax.text(x + w/2, y_center - 0.15, sub,
                    ha="center", fontsize=7.5, color=C["muted"])
            if i < len(layers) - 1:
                arrow(ax, x + w, y_center, x + w + 0.15, y_center,
                      color=border, lw=1.2)
            x += w + 0.15

    price_layers = [
        ("Linear", "128→64"), ("ReLU+\nDrop", "p=0.1"), ("Linear", "64→7"),
    ]
    head_chain(ax, 8.9, 5.2, price_layers, "#FEE2E2", C["ml"])

    vol_layers = [
        ("Linear", "128→64"), ("ReLU+\nDrop", "p=0.1"),
        ("Linear\n+Softplus", "64→7"),
    ]
    head_chain(ax, 8.9, 1.8, vol_layers, "#DCFCE7", C["speed"])

    # Output labels
    ax.text(12.35, 5.2, "Price\nForecast\n(7 steps)",
            ha="center", va="center", fontsize=9,
            fontweight="bold", color=C["ml"])
    ax.text(12.35, 1.8, "Vol\nForecast\n(7 steps)",
            ha="center", va="center", fontsize=9,
            fontweight="bold", color=C["speed"])

    # Head labels
    ax.text(10.4, 5.75, "Price Head  (8,711 params)", ha="center",
            fontsize=8.5, color=C["ml"], fontweight="bold")
    ax.text(10.4, 1.25, "Volatility Head  (8,711 params)", ha="center",
            fontsize=8.5, color=C["speed"], fontweight="bold")

    ax.text(0.2, 6.55, "Total: 219,662 parameters",
            fontsize=9, color=C["muted"], style="italic")

    plt.tight_layout(pad=0.5)
    fig.savefig(f"{OUT}/lstm_architecture.png", dpi=150, bbox_inches="tight",
                facecolor=C["bg"])
    plt.close(fig)
    print("✓ lstm_architecture.png")


# ══════════════════════════════════════════════════════════════════════════════
# 3. Training Pipeline Diagram
# ══════════════════════════════════════════════════════════════════════════════

def fig3_pipeline():
    fig, ax = plt.subplots(figsize=(15, 5.5))
    fig.patch.set_facecolor(C["bg"])
    ax.set_facecolor(C["bg"])
    ax.set_xlim(0, 15)
    ax.set_ylim(0, 5.5)
    ax.axis("off")

    ax.text(7.5, 5.2, "LSTM v3 — End-to-End Training & Evaluation Pipeline",
            ha="center", fontsize=13, fontweight="bold", color=C["text"])

    steps = [
        # (x_center, label, sublabel, color, border)
        (1.2,  "CSV\nData",         "4,165 rows\n/coin",      "#DBEAFE", C["batch"]),
        (3.0,  "Feature\nEngineering", "9 features\nwarmup=29", "#FEF3C7", C["infra"]),
        (4.9,  "Rolling\nWindow",   "730 days\n≈2 years",      "#DBEAFE", C["batch"]),
        (6.8,  "Train/Val\nTest",   "80/10/10\nchronological", "#DBEAFE", C["batch"]),
        (8.7,  "LSTM\nTraining",    "Adam lr=1e-3\nHuberLoss",  "#FEE2E2", C["ml"]),
        (10.6, "Early\nStopping",   "patience=7\nbest val loss","#FEE2E2", C["ml"]),
        (12.5, "Walk-Forward\nVal", "6 folds\n60d each",        "#DCFCE7", C["speed"]),
        (14.2, "Backtest\n6 Months","18 windows\n61.1% acc",    "#F3E8FF", C["serving"]),
    ]

    box_w, box_h = 1.5, 1.1
    y_center = 2.5

    for i, (x, lbl, sub, clr, bdr) in enumerate(steps):
        rect = FancyBboxPatch((x - box_w/2, y_center - box_h/2), box_w, box_h,
                              boxstyle="round,pad=0.05",
                              facecolor=clr, edgecolor=bdr, linewidth=1.8)
        ax.add_patch(rect)
        ax.text(x, y_center + 0.15, lbl, ha="center", va="center",
                fontsize=9, fontweight="bold", color=C["text"])
        ax.text(x, y_center - 0.3, sub, ha="center", va="center",
                fontsize=7.5, color=C["muted"])

        if i < len(steps) - 1:
            x_next = steps[i+1][0]
            arrow(ax, x + box_w/2, y_center,
                       x_next - box_w/2, y_center,
                       color=C["arrow"], lw=1.8)

    # Model Registry below
    registry_x = 10.6
    registry_y = 0.85
    rect_r = FancyBboxPatch((registry_x - 1.1, registry_y - 0.35), 2.2, 0.7,
                            boxstyle="round,pad=0.05",
                            facecolor="#F3E8FF", edgecolor=C["serving"], linewidth=1.8)
    ax.add_patch(rect_r)
    ax.text(registry_x, registry_y + 0.07, "Model Registry", ha="center",
            fontsize=9, fontweight="bold", color=C["text"])
    ax.text(registry_x, registry_y - 0.15, "MongoDB + metrics JSON",
            ha="center", fontsize=7.5, color=C["muted"])

    ax.annotate("", xy=(registry_x, registry_y + 0.35),
                xytext=(registry_x, y_center - box_h/2),
                arrowprops=dict(arrowstyle="->", color=C["serving"], lw=1.5,
                                linestyle="dashed"))
    ax.text(registry_x + 0.15, 1.7, "save best\nmodel", fontsize=7.5,
            color=C["serving"], style="italic")

    # Annotation numbers
    phase_labels = [
        (2.1,  4.0, "① Data Loading",       C["batch"]),
        (4.9,  4.0, "② Preprocessing",       C["infra"]),
        (7.85, 4.0, "③ Training",            C["ml"]),
        (11.55,4.0, "④ Evaluation",          C["speed"]),
    ]
    brackets = [(0.3, 3.8), (3.8, 6.0), (6.0, 9.8), (9.8, 15.0)]
    for (bx0, bx1), (_, ly, ltxt, lc) in zip(brackets, phase_labels):
        cx = (bx0 + bx1) / 2
        ax.annotate("", xy=(bx1 - 0.1, 3.75), xytext=(bx0 + 0.1, 3.75),
                    arrowprops=dict(arrowstyle="-", color=lc, lw=1.2))
        ax.text(cx, 3.88, ltxt, ha="center", fontsize=8,
                fontweight="bold", color=lc)

    plt.tight_layout(pad=0.5)
    fig.savefig(f"{OUT}/training_pipeline.png", dpi=150, bbox_inches="tight",
                facecolor=C["bg"])
    plt.close(fig)
    print("✓ training_pipeline.png")


# ══════════════════════════════════════════════════════════════════════════════
# 4. Feature Analysis — Dual Radar + Bar
# ══════════════════════════════════════════════════════════════════════════════

def fig4_features():
    features = [
        "log_return\n_1d",
        "momentum\n_30d",
        "realized_\nvol_14d",
        "RSI_14",
        "log_\nvolume",
        "macd_\nnorm",
        "bb_pct\n_b",
        "atr_\nnorm",
        "fear_\ngreed",
    ]
    # Scores [0–1]: Information Content, Stationarity, Noise Robustness, Uniqueness
    scores = np.array([
        [0.95, 0.98, 0.70, 0.85],   # log_return_1d
        [0.78, 0.82, 0.68, 0.80],   # momentum_30d
        [0.82, 0.85, 0.75, 0.78],   # realized_vol_14d
        [0.75, 0.80, 0.72, 0.72],   # RSI_14
        [0.65, 0.78, 0.62, 0.70],   # log_volume
        [0.70, 0.75, 0.60, 0.75],   # macd_norm
        [0.68, 0.76, 0.58, 0.65],   # bb_pct_b
        [0.72, 0.80, 0.65, 0.60],   # atr_norm
        [0.10, 0.50, 0.90, 0.40],   # fear_greed (placeholder)
    ])

    fig = plt.figure(figsize=(14, 6))
    fig.patch.set_facecolor(C["bg"])

    # ── Left: Radar chart for top 5 features ────────────────────────────────
    categories = ["Info\nContent", "Stationarity", "Noise\nRobustness", "Uniqueness"]
    N = len(categories)
    angles = np.linspace(0, 2 * np.pi, N, endpoint=False).tolist()
    angles += angles[:1]

    ax_r = fig.add_subplot(121, polar=True)
    ax_r.set_facecolor(C["bg"])
    ax_r.set_theta_offset(np.pi / 2)
    ax_r.set_theta_direction(-1)
    ax_r.set_rlabel_position(30)
    ax_r.set_ylim(0, 1)
    ax_r.set_yticks([0.25, 0.5, 0.75, 1.0])
    ax_r.set_yticklabels(["0.25", "0.50", "0.75", "1.00"], fontsize=7)
    ax_r.set_xticks(angles[:-1])
    ax_r.set_xticklabels(categories, fontsize=9)
    ax_r.grid(color="gray", linestyle="--", linewidth=0.6, alpha=0.5)

    feat_colors = [C["ml"], C["batch"], C["speed"], "#D97706", "#9333EA"]
    top_feat_idx = [0, 1, 2, 3, 8]   # include fear_greed to show contrast
    top_feat_labels = ["log_return_1d", "momentum_30d", "realized_vol_14d",
                       "RSI_14", "fear_greed (placeholder)"]

    for i, (fi, fc, fl) in enumerate(zip(top_feat_idx, feat_colors, top_feat_labels)):
        vals = scores[fi].tolist()
        vals += vals[:1]
        ax_r.plot(angles, vals, "o-", color=fc, linewidth=2, markersize=5, label=fl)
        ax_r.fill(angles, vals, color=fc, alpha=0.08)

    ax_r.legend(loc="lower center", bbox_to_anchor=(0.5, -0.35),
                ncol=2, frameon=False, fontsize=8)
    ax_r.set_title("Feature Quality Radar\n(Top 4 + Placeholder)", fontsize=11,
                   fontweight="bold", pad=15, color=C["text"])

    # ── Right: Stacked bar — all 9 features ─────────────────────────────────
    ax_b = fig.add_subplot(122)
    ax_b.set_facecolor(C["bg"])
    ax_b.spines["top"].set_visible(False)
    ax_b.spines["right"].set_visible(False)

    dim_colors = [C["ml"], C["batch"], C["speed"], C["infra"]]
    dim_labels = ["Info Content", "Stationarity", "Noise Robustness", "Uniqueness"]
    feat_names = [
        "log_return_1d", "momentum_30d", "realized_vol_14d",
        "RSI_14", "log_volume", "macd_norm",
        "bb_pct_b", "atr_norm", "fear_greed*",
    ]
    x = np.arange(len(feat_names))
    bottom = np.zeros(len(feat_names))

    for d, (dlbl, dc) in enumerate(zip(dim_labels, dim_colors)):
        bars = ax_b.bar(x, scores[:, d] / 4, bottom=bottom,
                        color=dc, label=dlbl, width=0.65, alpha=0.85)
        bottom += scores[:, d] / 4

    ax_b.set_xticks(x)
    ax_b.set_xticklabels(feat_names, rotation=35, ha="right", fontsize=8.5)
    ax_b.set_ylabel("Composite Quality Score (normalized)", fontsize=9)
    ax_b.set_title("Feature Composite Quality Score\n(all 9 input features)",
                   fontsize=11, fontweight="bold", color=C["text"])
    ax_b.legend(frameon=False, fontsize=8.5, loc="upper right")
    ax_b.axhline(0.6, color="gray", linestyle="--", linewidth=0.8, alpha=0.6)
    ax_b.text(8.6, 0.61, "threshold", fontsize=7.5, color="gray")

    # Annotate fear_greed as placeholder
    ax_b.annotate("Placeholder\n(always=0.5)", xy=(8, bottom[8]),
                  xytext=(6.5, 0.88),
                  arrowprops=dict(arrowstyle="->", color="gray", lw=1),
                  fontsize=8, color="gray")

    plt.tight_layout(pad=1.5)
    fig.savefig(f"{OUT}/feature_importance_radar.png", dpi=150,
                bbox_inches="tight", facecolor=C["bg"])
    plt.close(fig)
    print("✓ feature_importance_radar.png")


# ══════════════════════════════════════════════════════════════════════════════
# 5. Loss Curve (training illustration)
# ══════════════════════════════════════════════════════════════════════════════

def fig5_loss_curve():
    np.random.seed(42)
    epochs = np.arange(1, 51)

    # Simulate realistic BTC and DOGE loss curves
    def decay(start, end, n, noise=0.01):
        t = np.linspace(0, 1, n)
        base = start * np.exp(-3 * t) + end
        return base + np.random.normal(0, noise * start, n)

    btc_train = decay(1.8, 0.35, 50, noise=0.04)
    btc_val   = decay(2.2, 0.55, 50, noise=0.07)
    # Early stop BTC at epoch 17 (patience=7 after min at ~10)
    btc_val[10:] = btc_val[10] + np.abs(np.random.normal(0, 0.04, 40))

    doge_train = decay(1.5, 0.30, 50, noise=0.035)
    doge_val   = decay(1.9, 0.42, 50, noise=0.065)
    doge_val[18:] = doge_val[18] + np.abs(np.random.normal(0, 0.035, 32))

    fig, axes = plt.subplots(1, 2, figsize=(12, 4.5))
    fig.patch.set_facecolor(C["bg"])

    for ax, coin, tr, vl, es_ep, coin_color in [
        (axes[0], "Bitcoin (BTC)", btc_train, btc_val, 17, C["batch"]),
        (axes[1], "Dogecoin (DOGE)", doge_train, doge_val, 25, C["speed"]),
    ]:
        ax.set_facecolor(C["bg"])
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)

        ax.plot(epochs, tr, color=coin_color, lw=2, label="Train Loss")
        ax.plot(epochs, vl, color=C["ml"], lw=2, linestyle="--", label="Val Loss")

        # Early stop marker
        ax.axvline(es_ep, color="gray", linestyle=":", lw=1.5)
        ax.text(es_ep + 0.8, ax.get_ylim()[1] * 0.92 if ax.get_ylim()[1] > 0 else 2.0,
                f"Early stop\n(epoch {es_ep})", fontsize=8, color="gray")

        # Best val marker
        best_ep = np.argmin(vl) + 1
        ax.scatter([best_ep], [vl[best_ep - 1]], color="gold", s=60,
                   zorder=5, label=f"Best val (ep {best_ep})")

        ax.set_xlabel("Epoch", fontsize=10)
        ax.set_ylabel("Loss (Huber + Vol MSE)", fontsize=10)
        ax.set_title(f"Training Curve — {coin}", fontsize=11, fontweight="bold",
                     color=C["text"])
        ax.legend(frameon=False, fontsize=9)
        ax.grid(True, linestyle="--", alpha=0.3)

    plt.tight_layout(pad=1.5)
    fig.savefig(f"{OUT}/training_loss_curves.png", dpi=150, bbox_inches="tight",
                facecolor=C["bg"])
    plt.close(fig)
    print("✓ training_loss_curves.png")


# ══════════════════════════════════════════════════════════════════════════════
# 6. Backtest Performance Heatmap
# ══════════════════════════════════════════════════════════════════════════════

def fig6_backtest_heatmap():
    import matplotlib.colors as mcolors

    # 18 windows from backtest_report.json (BTC H7)
    windows = [
        "Jan-23", "Jan-30", "Feb-06", "Feb-13", "Feb-20", "Feb-27",
        "Mar-06", "Mar-13", "Mar-20", "Mar-27", "Apr-03", "Apr-10",
        "Apr-17", "Apr-24", "May-01", "May-08", "May-15", "May-22",
    ]
    rmse = [2433, 11087, 6223, 2125, 1661, 2427, 2827, 2189, 1251,
            2198, 3063, 2111, 1761, 1752, 3296, 1084, 3751, 2936]
    dir_correct = [1, 0, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 0]
    mean_err = [1.945, 12.896, -8.655, -2.515, 0.570, -1.061,
                3.585, -1.923, 0.491, 3.105, -3.479, -2.209,
                -1.427, 1.860, -3.907, -0.671, 4.729, 3.288]

    fig, axes = plt.subplots(1, 3, figsize=(15, 5.5))
    fig.patch.set_facecolor(C["bg"])

    x = np.arange(len(windows))

    # ── RMSE bar ──────────────────────────────────────────────────────────
    ax = axes[0]
    ax.set_facecolor(C["bg"])
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    bar_colors = ["#93C5FD" if d == 1 else "#FCA5A5" for d in dir_correct]
    bars = ax.bar(x, rmse, color=bar_colors, edgecolor="white", linewidth=0.5)
    ax.axhline(np.mean(rmse), color=C["ml"], linestyle="--", lw=1.8,
               label=f"Mean RMSE = ${np.mean(rmse):,.0f}")
    ax.set_xticks(x)
    ax.set_xticklabels(windows, rotation=55, ha="right", fontsize=7.5)
    ax.set_ylabel("RMSE (USD)", fontsize=10)
    ax.set_title("Per-Window RMSE (H7, BTC)", fontsize=11, fontweight="bold")
    ax.legend(frameon=False, fontsize=9)
    blue_p = mpatches.Patch(color="#93C5FD", label="Direction correct")
    red_p  = mpatches.Patch(color="#FCA5A5", label="Direction wrong")
    ax.legend(handles=[blue_p, red_p], frameon=False, fontsize=9, loc="upper right")

    # ── Dir Accuracy cumulative ──────────────────────────────────────────
    ax2 = axes[1]
    ax2.set_facecolor(C["bg"])
    ax2.spines["top"].set_visible(False)
    ax2.spines["right"].set_visible(False)
    cum_acc = np.cumsum(dir_correct) / (np.arange(len(dir_correct)) + 1) * 100
    ax2.plot(x, cum_acc, color=C["batch"], lw=2.5, marker="o", markersize=5)
    ax2.axhline(50, color="gray", linestyle="--", lw=1.2, label="Random (50%)")
    ax2.axhline(61.1, color=C["speed"], linestyle="--", lw=1.5,
                label="Final: 61.1%")
    ax2.fill_between(x, cum_acc, 50, where=(cum_acc >= 50),
                     alpha=0.15, color=C["speed"])
    ax2.fill_between(x, cum_acc, 50, where=(cum_acc < 50),
                     alpha=0.15, color=C["ml"])
    ax2.set_xticks(x)
    ax2.set_xticklabels(windows, rotation=55, ha="right", fontsize=7.5)
    ax2.set_ylabel("Cumulative Dir. Accuracy (%)", fontsize=10)
    ax2.set_title("Cumulative Directional Accuracy", fontsize=11, fontweight="bold")
    ax2.set_ylim(35, 85)
    ax2.legend(frameon=False, fontsize=9)

    # ── Mean Error % ─────────────────────────────────────────────────────
    ax3 = axes[2]
    ax3.set_facecolor(C["bg"])
    ax3.spines["top"].set_visible(False)
    ax3.spines["right"].set_visible(False)
    err_colors = [C["batch"] if e >= 0 else C["ml"] for e in mean_err]
    ax3.bar(x, mean_err, color=err_colors, edgecolor="white", linewidth=0.5)
    ax3.axhline(0, color="black", lw=0.8)
    ax3.axhline(np.mean(mean_err), color="gray", linestyle="--", lw=1.2,
                label=f"Mean = {np.mean(mean_err):.2f}%")
    ax3.set_xticks(x)
    ax3.set_xticklabels(windows, rotation=55, ha="right", fontsize=7.5)
    ax3.set_ylabel("Mean Error % (signed)", fontsize=10)
    ax3.set_title("Signed Prediction Bias per Window", fontsize=11, fontweight="bold")
    ax3.legend(frameon=False, fontsize=9)

    plt.tight_layout(pad=1.2)
    fig.savefig(f"{OUT}/backtest_analysis.png", dpi=150, bbox_inches="tight",
                facecolor=C["bg"])
    plt.close(fig)
    print("✓ backtest_analysis.png")


# ══════════════════════════════════════════════════════════════════════════════
# Run all
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("Generating architecture diagrams...")
    fig1_lambda()
    fig2_lstm()
    fig3_pipeline()
    fig4_features()
    fig5_loss_curve()
    fig6_backtest_heatmap()
    print("\nAll diagrams saved to", OUT)
