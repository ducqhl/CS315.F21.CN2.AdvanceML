import {
  ResponsiveContainer, ComposedChart, Area,
  Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import ChartTooltip from '../../../components/charts/ChartTooltip';
import { fmtAxisPrice } from '../../../lib/format';
import type { Coin } from '../../../lib/coin';

export type Overlay = 'sma20' | 'sma50';

export interface RealtimeChartPoint {
  date: string;
  close: number;
  sma20: number | null;
  sma50: number | null;
  high: number | null;
  low: number | null;
}

interface PriceHistoryChartProps {
  coin: Coin;
  decimals: number;
  data: RealtimeChartPoint[];
  days: number;
  overlays: Set<Overlay>;
  timeframes: { label: string; days: number }[];
  loading: boolean;
  onToggleOverlay: (key: Overlay) => void;
  onDaysChange: (days: number) => void;
}

/** Historical price area chart with SMA overlays + timeframe controls. */
export default function PriceHistoryChart({
  coin, decimals, data, days, overlays, timeframes, loading, onToggleOverlay, onDaysChange,
}: PriceHistoryChartProps) {
  return (
    <div className="card" style={{ padding: '20px', marginBottom: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans' }}>
          Price History
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {/* Overlay toggles */}
          {([['sma20', 'SMA 20', 'var(--warn)'], ['sma50', 'SMA 50', 'var(--purple)']] as [Overlay, string, string][]).map(([key, label, color]) => (
            <button
              key={key}
              onClick={() => onToggleOverlay(key)}
              className={`btn-ghost ${overlays.has(key) ? 'active' : ''}`}
              style={{
                fontSize: '11px',
                borderColor: overlays.has(key) ? color : 'var(--border)',
                color: overlays.has(key) ? color : 'var(--text-secondary)',
                background: overlays.has(key) ? `${color}18` : 'transparent',
                padding: '5px 10px',
              }}
            >
              {label}
            </button>
          ))}
          <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />
          {/* Timeframe */}
          {timeframes.map(tf => (
            <button
              key={tf.label}
              onClick={() => onDaysChange(tf.days)}
              className={`btn-ghost ${days === tf.days ? 'active' : ''}`}
              style={{ padding: '5px 10px', fontSize: '11px' }}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: '280px', borderRadius: '8px' }} />
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="rtGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.15} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis
              dataKey="date" tickLine={false} axisLine={false}
              tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
              tickFormatter={v => v.slice(5)}
              interval={Math.floor(data.length / 7)}
            />
            <YAxis
              tickLine={false} axisLine={false}
              tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
              domain={['auto', 'auto']}
              tickFormatter={v => fmtAxisPrice(v, coin)}
              width={coin === 'bitcoin' ? 52 : 64}
            />
            <Tooltip content={<ChartTooltip decimals={decimals} />} />
            <Area type="monotone" dataKey="close" name="Close"
              stroke="var(--accent-light)" strokeWidth={2} fill="url(#rtGrad)" dot={false} />
            {overlays.has('sma20') && (
              <Line type="monotone" dataKey="sma20" name="SMA 20"
                stroke="var(--warn)" strokeWidth={1.5} strokeDasharray="4 2" dot={false} connectNulls />
            )}
            {overlays.has('sma50') && (
              <Line type="monotone" dataKey="sma50" name="SMA 50"
                stroke="var(--purple)" strokeWidth={1.5} strokeDasharray="4 2" dot={false} connectNulls />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
