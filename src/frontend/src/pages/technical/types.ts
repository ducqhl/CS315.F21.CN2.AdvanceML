export type Timeframe = '1M' | '3M' | '6M' | '1Y';
export type OverlayKey = 'ma20' | 'ma50' | 'bb';

export const TF_DAYS: Record<Timeframe, number> = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365 };

export interface TechnicalPoint {
  date: string;
  close: number;
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
