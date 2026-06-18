export type Timeframe = '1M' | '3M' | '6M' | '1Y';
export type OverlayKey = 'ma20' | 'ma50' | 'bb';
export type ChartType = 'line' | 'candle';

export const TF_DAYS: Record<Timeframe, number> = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365 };

export interface TechnicalPoint {
  date: string;
  close: number;
  // Synthetic daily OHLC derived from closes (open = previous close).
  // Real daily_high/low collapse to close in the batch data, so candle
  // bodies show up/down days; wicks only appear where high/low diverge.
  open: number;
  high: number;
  low: number;
  range: [number, number]; // [low, high] for recharts floating bar
  sma20: number | null;
  sma50: number | null;
  bbUp: number | null;
  bbLo: number | null;
  bbMid: number | null;
  rsi: number | null;
  macd: number | null;
  sig: number | null;
  hist: number | null;
  vol: number | null;
}

export function fmtPrice(v: number, coin: string): string {
  return coin === 'bitcoin'
    ? `$${(v / 1000).toFixed(1)}k`
    : `$${v.toFixed(5)}`;
}
