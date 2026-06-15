import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import ChartTooltip from '../../../components/charts/ChartTooltip';
import { fmtPrice, type TechnicalPoint, type OverlayKey } from '../types';
import type { Coin } from '../../../lib/coin';

interface PriceChartProps {
  coin: Coin;
  data: TechnicalPoint[];
  overlays: Record<OverlayKey, boolean>;
  xInterval: number;
  yWidth: number;
}

/** Main price area chart with MA20/MA50/Bollinger overlays. */
export default function PriceChart({ coin, data, overlays, xInterval, yWidth }: PriceChartProps) {
  const dec = coin === 'bitcoin' ? 2 : 6;
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
          <Area type="monotone" dataKey="close" name="Close"
            stroke="var(--accent-light)" strokeWidth={2} fill="url(#techGrad)" dot={false} />
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
