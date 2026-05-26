# Frontend Redesign Plan — Quantum Terminal UI

**Version**: 2.0  
**Last Updated**: 2026-05-24

---

## Design Concept: "Quantum Terminal"

A high-frequency trading terminal aesthetic with neon accents on deep space black.
Inspired by Bloomberg Terminal × modern crypto exchange (Binance/Bybit dark mode).

### Color Palette

```css
--bg-void:      #02040C   /* True near-black — deepest background */
--bg-primary:   #060913   /* Main app background */
--bg-card:      #0A0F1E   /* Card surfaces */
--bg-elevated:  #111927   /* Elevated / dropdown surfaces */

--border-dim:   #131B2A   /* Subtle structural borders */
--border:       #1C2840   /* Standard borders */
--border-bright:#243359   /* Highlighted borders */

--cyan:         #00E5FF   /* Primary accent — electric cyan */
--green:        #00F0A0   /* Positive / up — neon green */
--red:          #FF3864   /* Negative / down — hot red */
--gold:         #FFB020   /* Forecast / warning — amber */
--violet:       #8B5CF6   /* Secondary accent */

--text-primary: #D0DDF5   /* Cool blue-white */
--text-secondary:#556070  /* Muted blue-grey */
--text-muted:   #2A3545   /* Very muted */
```

### Typography (Google Fonts)

| Role | Font | Weight | Usage |
|------|------|--------|-------|
| Logo / Display | Orbitron | 700, 800 | App name, large headings |
| Data / Numbers | Space Mono | 400, 700 | Prices, percentages, timestamps |
| Body / Labels | Manrope | 400–700 | Nav, descriptions, table text |

### Visual Language

- **Background**: Subtle `#00E5FF` grid pattern (3% opacity) — circuit board feel
- **Cards**: Semi-transparent with `1px` border, subtle inner shadow
- **Active states**: Neon cyan left-border + `rgba(0,229,255,0.08)` fill
- **Glows**: `box-shadow: 0 0 20px rgba(0,229,255,0.2)` on key metrics
- **Animations**: CSS transitions (150ms ease), number counter animations
- **Charts**: Gradient area fill (cyan→transparent), neon candlesticks

---

## Page Structure

```
src/frontend/src/
├── auth/
│   └── AuthContext.tsx          NEW  — JWT auth provider
├── components/
│   ├── LightweightChart.tsx     NEW  — TradingView chart wrapper
│   └── TrendStrengthBadge.tsx   NEW  — Direction + strength visual
├── pages/
│   ├── LoginPage.tsx            NEW  — Full-screen cinematic login
│   ├── DashboardPage.tsx        NEW  — Overview: prices + mini-charts + prediction summary
│   ├── RealtimePage.tsx         UPD  — TradingView area chart, enhanced metrics
│   ├── TechnicalPage.tsx        UPD  — TradingView candlestick + SMA overlay
│   ├── PredictionsPage.tsx      UPD  — History overlay, prediction runs table
│   └── CorrelationPage.tsx      UPD  — Restyled to match new theme
├── api/
│   └── client.ts                UPD  — Auth methods, prediction history, interceptors
├── App.tsx                      UPD  — Auth guard, new nav with Dashboard
└── index.css                    UPD  — Quantum Terminal design tokens + Orbitron/SpaceMono
```

---

## New Charting Strategy

### TradingView Lightweight Charts (primary)

Package: `lightweight-charts` ^4.2.0

Used for:
- **RealtimePage**: Area chart with gradient fill and crosshair
- **TechnicalPage**: Candlestick chart with SMA overlay lines
- **DashboardPage**: Mini sparkline area charts per coin
- **PredictionsPage**: Combined area (history) + line (forecast) with confidence band

Key features:
- Professional OHLC candlestick rendering
- Smooth scrolling / zooming with touch support
- Hardware-accelerated canvas rendering
- Crosshair with synced tooltip

React wrapper pattern:
```tsx
// useRef for container + chart instance
// ResizeObserver for responsive width
// useEffect for data updates (setData / update)
// Cleanup: chart.remove() on unmount
```

### Recharts (auxiliary)

Kept for:
- **TechnicalPage**: RSI(14) line chart (simple, already working)
- **CorrelationPage**: Heatmap-style visualization
- **PredictionsPage**: Prediction history scatter overlay

---

## Authentication Flow

```
User visits app
  │
  ▼
AuthContext checks localStorage for JWT
  │
  ├── Valid JWT → App shell + pages
  │
  └── No JWT / expired → <LoginPage>
        │
        ▼
      POST /api/auth/login
        │
        ├── 200 → Store JWT in localStorage → Redirect to Dashboard
        └── 401 → Show error message
```

Token stored in `localStorage` under key `crypto_jwt`.
Axios interceptor adds `Authorization: Bearer <token>` to all requests.
On 401 response from API → clear token → redirect to login.

---

## Page Details

### LoginPage (NEW)

- Full-screen background with animated grid + glow orbs
- Center-aligned panel with "QUANTUM" logo
- Username + Password inputs with neon focus ring
- Submit button with loading state + error display
- Subtle "connecting..." animation on submit

### DashboardPage (NEW)

Top row (2 cards):
- BTC current price + 24h change + mini sparkline (lightweight-charts)
- DOGE current price + 24h change + mini sparkline

Middle row (3 cards):
- Next-day prediction price + direction badge
- 7-day outlook (BULLISH/BEARISH/NEUTRAL) + confidence
- Latest inference run timestamp + seed source

Bottom:
- Combined price history + 7-day forecast (full lightweight-charts area)

### RealtimePage (UPDATED)

- Price hero section: large glowing price display
- 4 metric cards: Price, 24h High, 24h Low, Volume
- Full TradingView area chart (30-day history, gradient fill)
- Live/Batch status badge with pulse animation

### TechnicalPage (UPDATED)

- Timeframe selector (1M / 3M / 6M / 1Y)
- TradingView candlestick + SMA20/SMA50 overlay lines
- Volume histogram at chart bottom
- RSI(14) chart (Recharts, below main chart)

### PredictionsPage (UPDATED)

- 5 metric cards: Next-Day, 7-Day High/Low, Outlook, Model Version
- **Combined chart**: TradingView area (90-day history) + dashed gold line (7-day forecast)
- **Prediction History section** (NEW): Past predictions vs actual prices scatter/line overlay
- Prediction details table with direction/strength badges

### CorrelationPage (UPDATED)

- Restyled heatmap grid using CSS grid + color-coded cells
- Pearson coefficient display with color scale (red→green)
- Summary text interpretation

---

## Component: LightweightChart

```tsx
interface LightweightChartProps {
  type: 'area' | 'candlestick' | 'line';
  data: AreaData[] | CandlestickData[];
  overlays?: LineData[][];          // SMA lines, forecast line
  height?: number;
  colors?: { main?: string; up?: string; down?: string; };
  onCrosshairMove?: (price: number | null, time: string | null) => void;
}
```

---

## Implementation Notes

1. **No SSR concerns**: Pure client-side SPA via Vite
2. **Responsive**: ResizeObserver on all charts for dynamic width
3. **Data format**: lightweight-charts uses `{time: 'YYYY-MM-DD', value: number}[]` for area/line, `{time, open, high, low, close}[]` for candlestick
4. **Date handling**: All dates from API are ISO-8601; slice to `YYYY-MM-DD` for chart time keys
5. **JWT expiry**: Default 8 hours; stored in localStorage; cleared on expiry or 401
