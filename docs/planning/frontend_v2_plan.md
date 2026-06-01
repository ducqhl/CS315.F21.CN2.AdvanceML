# Frontend v2 — Implementation Plan

**Status:** Planning  
**Date:** 2026-05-30  
**Author:** Duc Le  

---

## 1. Vision

Replace the current "quantum terminal" aesthetic (Orbitron, glowing cyan, grid overlays) with a **refined financial analytics dashboard** — clean, data-dense, and modern. Reference aesthetic: Linear + Vercel dashboard applied to crypto.

Name: **Nocturne Analytics**

---

## 2. Design System

### Color Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-base` | `#0C0C10` | Page background |
| `--bg-card` | `#13131A` | Default card surface |
| `--bg-elevated` | `#1A1A24` | Elevated / modal surface |
| `--bg-border` | `rgba(255,255,255,0.06)` | Subtle card borders |
| `--accent-primary` | `#6366F1` (Indigo) | Primary actions, active states |
| `--accent-up` | `#10B981` (Emerald) | Positive price / bullish |
| `--accent-down` | `#F43F5E` (Rose) | Negative price / bearish |
| `--accent-warn` | `#F59E0B` (Amber) | Neutral / pending / warning |
| `--text-primary` | `#F1F1F5` | Main body text |
| `--text-secondary` | `#8B8BA0` | Labels, captions |
| `--text-muted` | `#3D3D55` | Disabled / placeholder |

### Typography

| Role | Font | Weights | Usage |
|------|------|---------|-------|
| Display | **Syne** | 700, 800 | Page titles, logo, hero numbers |
| UI | **Plus Jakarta Sans** | 400, 500, 600 | Navigation, labels, body copy |
| Data | **IBM Plex Mono** | 400, 500 | Prices, percentages, table values |

All three fonts loaded from Google Fonts via `@import` in `index.css`.

### Spacing Scale
Standard Tailwind 4px base — no deviation.

### Motion Principles
- **Library:** Framer Motion
- Page transitions: `opacity 0 → 1` + `y +8px → 0`, duration 220ms
- Card stagger: 40ms delay per item
- Chart entrance: scale + fade, 300ms
- No decorative glows, no infinite animations
- Micro-interactions: hover `translateY(-1px)`, active `scale(0.98)`

---

## 3. Tech Stack

### Keep
- React 19 + TypeScript
- Vite 5
- Tailwind CSS 3.x
- Lucide React (icons)
- React DatePicker

### Add
| Package | Purpose |
|---------|---------|
| `@tanstack/react-query` v5 | Data fetching, caching, background refetch, stale-while-revalidate |
| `framer-motion` | Page + component animations |
| `recharts` (already installed) | **Sole** chart library going forward |

### Remove / Replace
| Package | Reason |
|---------|--------|
| `apexcharts` + `react-apexcharts` | Replaced by Recharts for consistency |
| `lightweight-charts` | Replaced by Recharts `ComposedChart` for candlestick |

---

## 4. Layout Architecture

### Shell
```
┌──────────────────────────────────────────────────────┐
│  Sidebar (240px, fixed)  │  Main content area         │
│                          │                            │
│  Logo                    │  <TopBar />                │
│  ─────────               │  ─────────────────────     │
│  Nav links               │  <Page content />          │
│    Dashboard             │                            │
│    Realtime              │                            │
│    Technical             │                            │
│    Predictions           │                            │
│    Correlation           │                            │
│    Model Registry        │                            │
│  ─────────               │                            │
│  Coin selector           │                            │
│  (BTC / DOGE tabs)       │                            │
│  ─────────               │                            │
│  User pill + logout      │                            │
└──────────────────────────────────────────────────────┘
```

### Mobile (< 768px)
- Sidebar collapses to **bottom tab bar** (5 icon tabs)
- TopBar becomes minimal header with hamburger for settings

### TopBar
- Breadcrumb (page name)
- Live price ticker (selected coin, auto-refresh every 30s)
- Inference status dot (green = running, amber = pending, red = failed)
- Last updated timestamp

---

## 5. Pages

### 5.1 Login Page
**Layout:** Full-screen centered card, no sidebar.  
**Elements:**
- Logo + app name (Syne, large)
- Tagline: "Crypto Analytics · Lambda Architecture"
- Username / Password fields
- Sign In button (indigo, full-width)
- Error state (inline, rose text)
- Subtle animated background: slow-moving gradient mesh

**API:** `POST /api/auth/login`

---

### 5.2 Dashboard Page
**Purpose:** At-a-glance overview for the selected coin.  
**Layout:** 4-column stat row → 2-column prediction/inference split → chart row.

**Sections:**

#### Stat Cards (top row — 4 cards)
- Current Price (with 24h change %)
- 24h High / Low
- Average Volume
- Data points in DB

**API:** `GET /api/realtime/{coin}`, `GET /api/stats`

#### Prediction Summary Card
- Active horizon badge (7d / 15d / 60d)
- Next-day predicted price
- Dominant direction chip (UP / DOWN / FLAT with color)
- Avg confidence bar
- 7-day high/low range

**API:** `GET /api/predictions/{coin}`

#### Inference Status Card
- Per-coin status (BTC + DOGE)
- Last run time + duration
- Run count
- Status badge with color

**API:** `GET /api/inference/status`

#### Historical Price Chart (bottom)
- 90-day line chart (avg_close + SMA 20/50)
- Timeframe selector: 1M / 3M / 6M / 1Y
- Recharts `ComposedChart` with two y-axes

**API:** `GET /api/historical/{coin}?days=90`

---

### 5.3 Realtime Page
**Purpose:** Live + intraday price view.

**Sections:**

#### Price Hero
- Large current price (IBM Plex Mono, 48px)
- Change arrow + % badge
- Daily high / low bar

#### Intraday Candle Chart
- 5-min OHLCV candles for selected date
- Date picker to switch days
- Volume bars below (secondary y-axis)
- Range selector: 24h / 3d / 7d / all

**API:** `GET /api/intraday/{coin}`, `GET /api/intraday/{coin}/dates`

#### 30-Day Historical Line
- Smoothed close price
- Toggle SMA 20 / 50 overlays

**API:** `GET /api/historical/{coin}?days=30`

---

### 5.4 Technical Page
**Purpose:** Technical indicators for analysis.

**Layout:** Main chart (top 60%) + indicator panels (bottom 40%, tabbed).

**Main Chart:**
- Candlestick OHLC using Recharts `ComposedChart`
- Overlay toggles: SMA 20, SMA 50, Bollinger Bands
- Recharts `ReferenceArea` for BB shading

**Indicator Tabs:**
1. **RSI** — line chart with 30/70 overbought/oversold zones
2. **MACD** — MACD line + signal line + histogram bars
3. **Bollinger Bands** — upper/middle/lower with price channel

**Controls:**
- Timeframe: 1M / 3M / 6M / 1Y
- Indicator toggle checkboxes above main chart

**API:** `GET /api/technical/{coin}?days=180`

---

### 5.5 Predictions Page
**Purpose:** LSTM forecast view with accuracy tracking.

**Layout:** Horizon selector → forecast chart + summary → accuracy section → history table.

**Horizon Selector:**
- Pill toggle: `7 Day` / `15 Day` / `60 Day`
- Shows active model badge (from registry)

**Forecast Chart:**
- Historical close (last 30 days, gray)
- Predicted prices (colored line, dashed after today)
- Confidence band as shaded area (if direction_prob available)
- Today marker (vertical reference line)

**API:** `GET /api/predictions/{coin}?horizon=7`

**Accuracy Section:**
- Metric cards: MAE, MAPE, Direction Accuracy %
- Sparkline of daily error trend (last 30 days)

**API:** `GET /api/predictions/{coin}/accuracy?days=30`

**History Table:**
- Columns: Date | Predicted | Actual | Error % | Direction | Correct
- Color-coded error cells (green < 2%, amber < 5%, red > 5%)
- Paginated, 20 rows per page

**API:** `GET /api/predictions/{coin}/history?days=60`

---

### 5.6 Correlation Page
**Purpose:** BTC / DOGE correlation analysis.

**Sections:**

#### Correlation Matrix (top)
- 2×2 heatmap grid (BTC-BTC, BTC-DOGE, DOGE-BTC, DOGE-DOGE)
- Color: indigo scale (0 → 1), cells show coefficient value
- Built with CSS grid + Recharts `Cell` color encoding

#### Rolling Correlation Chart
- Line chart of Pearson correlation over time
- Reference bands: strong (>0.7), moderate (0.3–0.7), weak (<0.3)
- Tooltip with date + coefficient

**API:** `GET /api/correlation`

---

### 5.7 Model Registry Page *(new)*
**Purpose:** Manage LSTM models — view registered models, set active model, trigger retraining.

**Sections:**

#### Models Table
- Columns: Coin | Horizon | Model File | Active | RMSE | MAE | Direction Accuracy | Registered At | Actions
- "Set Active" toggle per row
- "Retrain" button per row (triggers job)

**API:** `GET /api/ml/models`, `PUT /api/ml/models/active`, `POST /api/ml/retrain`

#### Training Jobs Feed
- Live-polling list of recent jobs (refresh every 10s)
- Status badges: `pending` (amber), `running` (indigo pulse), `completed` (emerald), `failed` (rose)
- Shows coin, horizon, duration, error message on failure

**API:** `GET /api/ml/retrain/status`

---

## 6. Data Fetching Strategy (TanStack Query)

| Query Key | Endpoint | Stale Time | Refetch Interval |
|-----------|----------|-----------|-----------------|
| `['realtime', coin]` | `/api/realtime/{coin}` | 30s | 30s |
| `['historical', coin, days]` | `/api/historical/{coin}` | 5min | — |
| `['technical', coin, days]` | `/api/technical/{coin}` | 5min | — |
| `['predictions', coin, horizon]` | `/api/predictions/{coin}` | 2min | — |
| `['predictions-accuracy', coin]` | `/api/predictions/{coin}/accuracy` | 5min | — |
| `['predictions-history', coin]` | `/api/predictions/{coin}/history` | 5min | — |
| `['intraday', coin, range]` | `/api/intraday/{coin}` | 1min | 5min |
| `['correlation']` | `/api/correlation` | 10min | — |
| `['inference-status']` | `/api/inference/status` | 30s | 30s |
| `['ml-models', coin]` | `/api/ml/models` | 1min | — |
| `['retrain-jobs']` | `/api/ml/retrain/status` | 10s | 10s (on registry page) |

Global `QueryClient` config:
- `retry: 1`
- `refetchOnWindowFocus: false`
- Stale time defaults prevent redundant requests on page switch

---

## 7. Component Structure

```
src/
├── main.tsx
├── App.tsx                    # QueryClientProvider + Router + AuthProvider
├── index.css                  # Design tokens, font imports, base reset
│
├── api/
│   └── client.ts              # Axios instance + all typed API functions
│
├── auth/
│   └── AuthContext.tsx         # JWT state (unchanged)
│
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── TopBar.tsx
│   │   └── MobileNav.tsx
│   ├── charts/
│   │   ├── PriceLineChart.tsx  # Recharts line with SMA overlays
│   │   ├── CandlestickChart.tsx
│   │   ├── RSIChart.tsx
│   │   ├── MACDChart.tsx
│   │   └── CorrelationHeatmap.tsx
│   ├── ui/
│   │   ├── StatCard.tsx
│   │   ├── Badge.tsx           # UP/DOWN/FLAT/status badges
│   │   ├── HorizonPicker.tsx   # 7d/15d/60d pill selector
│   │   ├── CoinTabs.tsx        # BTC / DOGE switcher
│   │   ├── Skeleton.tsx
│   │   └── ErrorState.tsx
│   └── predictions/
│       ├── ForecastChart.tsx
│       ├── AccuracyMetrics.tsx
│       └── HistoryTable.tsx
│
└── pages/
    ├── LoginPage.tsx
    ├── DashboardPage.tsx
    ├── RealtimePage.tsx
    ├── TechnicalPage.tsx
    ├── PredictionsPage.tsx
    ├── CorrelationPage.tsx
    └── ModelRegistryPage.tsx
```

---

## 8. Implementation Phases

### Phase 1 — Foundation (Design System + Shell)
- [ ] Update `index.css` with new design tokens and font imports
- [ ] Rewrite `App.tsx` (add QueryClientProvider, Framer Motion AnimatePresence)
- [ ] Build `Sidebar.tsx`, `TopBar.tsx`, `MobileNav.tsx`
- [ ] Build UI primitives: `StatCard`, `Badge`, `Skeleton`, `ErrorState`
- [ ] Build `CoinTabs` and `HorizonPicker`

### Phase 2 — Chart Components
- [ ] Remove ApexCharts and LightweightCharts dependencies
- [ ] Build `PriceLineChart.tsx` (Recharts ComposedChart)
- [ ] Build `CandlestickChart.tsx` (custom bar rendering in Recharts)
- [ ] Build `RSIChart.tsx`, `MACDChart.tsx`
- [ ] Build `CorrelationHeatmap.tsx`

### Phase 3 — Pages (Core)
- [ ] `LoginPage.tsx`
- [ ] `DashboardPage.tsx`
- [ ] `RealtimePage.tsx`
- [ ] `TechnicalPage.tsx`

### Phase 4 — Pages (ML/Predictions)
- [ ] `PredictionsPage.tsx` (with accuracy + history)
- [ ] `CorrelationPage.tsx`
- [ ] `ModelRegistryPage.tsx`

### Phase 5 — Polish
- [ ] Framer Motion page transitions + card stagger
- [ ] Mobile responsive (bottom nav, chart resize)
- [ ] Error boundaries per page
- [ ] Loading skeleton states everywhere

---

## 9. Open Questions

1. **Light mode toggle?** Plan assumes dark-only. Add toggle later if needed.
2. **Intraday candles:** Include 5-min chart on Realtime page even without ML predictions?
3. **Model Registry page:** Include in v2 or defer to v3?
4. **Candlestick in Recharts:** Requires custom shape rendering — use `Bar` with custom `shape` prop. Acceptable or prefer a different approach?
