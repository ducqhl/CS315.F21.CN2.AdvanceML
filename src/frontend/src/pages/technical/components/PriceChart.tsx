import {
  ResponsiveContainer, ComposedChart, Line, Area, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import ChartTooltip from '../../../components/charts/ChartTooltip';
import { fmtPrice, type TechnicalPoint, type OverlayKey, type ChartType } from '../types';
import type { Coin } from '../../../lib/coin';

interface PriceChartProps {
  coin: Coin;
  data: TechnicalPoint[];
  overlays: Record<OverlayKey, boolean>;
  chartType: ChartType;
  xInterval: number;
  yWidth: number;
}

const UP = '#00F0A0';
const DOWN = '#FF3864';

// Custom recharts shape for one candle. Geometry (x/y/width/height) describes the
// floating bar spanning [low, high]; open/close come from the datum payload.
function Candle(props: any) {
  const { x, y, width, height, payload } = props;
  const { open, close, high, low } = payload as TechnicalPoint;
  if (high == null || low == null) return null;

  const up = close >= open;
  const color = up ? UP : DOWN;
  const cx = x + width / 2;
  const bodyW = Math.max(1, Math.min(width * 0.7, 10));

  // Map a price within [low, high] to a y pixel using the bar's geometry.
  const span = high - low;
  const priceToY = (p: number) =>
    span === 0 ? y : y + ((high - p) / span) * height;

  const bodyTop = priceToY(Math.max(open, close));
  const bodyBot = priceToY(Math.min(open, close));
  const bodyH = Math.max(1, bodyBot - bodyTop); // ≥1px so flat days stay visible

  return (
    <g>
      <line x1={cx} x2={cx} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={cx - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={color} />
    </g>
  );
}

/** Main price chart (line or candle) with MA20/MA50/Bollinger overlays. */
export default function PriceChart({ coin, data, overlays, chartType, xInterval, yWidth }: PriceChartProps) {
  const dec = coin === 'bitcoin' ? 2 : 6;
  const isCandle = chartType === 'candle';
  return (
    <div className="card" style={{ padding: '20px', marginBottom: '10px' }}>
      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans', marginBottom: '14px' }}>
        Price {overlays.ma20 ? '· MA20' : ''}{overlays.ma50 ? ' · MA50' : ''}{overlays.bb ? ' · Bollinger Bands' : ''}
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="techGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.12} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="date" tickLine={false} axisLine={false}
            tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
            tickFormatter={v => v.slice(5)} interval={xInterval} />
          <YAxis tickLine={false} axisLine={false} width={yWidth}
            tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
            domain={['auto', 'auto']}
            tickFormatter={v => fmtPrice(v, coin)} />
          <Tooltip content={<ChartTooltip skipNull format={v => `$${v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`} />} />
          {isCandle ? (
            <Bar dataKey="range" name="Close" shape={<Candle />} isAnimationActive={false} legendType="none" />
          ) : (
            <Area type="monotone" dataKey="close" name="Close"
              stroke="var(--accent-light)" strokeWidth={2} fill="url(#techGrad)" dot={false} />
          )}
          {overlays.ma20 && (
            <Line type="monotone" dataKey="sma20" name="MA 20"
              stroke="var(--warn)" strokeWidth={1.5} strokeDasharray="4 2" dot={false} connectNulls />
          )}
          {overlays.ma50 && (
            <Line type="monotone" dataKey="sma50" name="MA 50"
              stroke="var(--purple)" strokeWidth={1.5} strokeDasharray="4 2" dot={false} connectNulls />
          )}
          {overlays.bb && (
            <>
              <Line type="monotone" dataKey="bbUp" name="BB Upper"
                stroke="var(--down)" strokeWidth={1} strokeDasharray="3 3" dot={false} connectNulls />
              <Line type="monotone" dataKey="bbLo" name="BB Lower"
                stroke="var(--up)" strokeWidth={1} strokeDasharray="3 3" dot={false} connectNulls />
              <Line type="monotone" dataKey="bbMid" name="BB Mid"
                stroke="rgba(255,255,255,0.2)" strokeWidth={1} dot={false} connectNulls />
            </>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
