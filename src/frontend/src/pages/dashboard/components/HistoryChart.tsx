import {
  ResponsiveContainer, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Line, ComposedChart,
} from 'recharts';
import ChartLegend from '../../../components/charts/ChartLegend';
import { fmt, fmtAxisPrice } from '../../../lib/format';
import type { Coin } from '../../../lib/coin';

export interface DashboardChartPoint {
  date: string;
  close: number;
  sma20: number | null;
  sma50: number | null;
}

interface HistoryChartProps {
  coin: Coin;
  decimals: number;
  symbol: string;
  data: DashboardChartPoint[];
}

const CustomTooltip = ({ active, payload, label, decimals }: {
  active?: boolean; payload?: { name: string; value: number; color: string }[];
  label?: string; decimals: number;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px', fontFamily: 'IBM Plex Mono' }}>
        {label}
      </div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: p.color }} />
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans', flex: 1 }}>{p.name}</span>
          <span className="font-mono" style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
            {fmt(p.value, decimals)}
          </span>
        </div>
      ))}
    </div>
  );
};

/** 90-day price history with SMA20/50 overlays. */
export default function HistoryChart({ coin, decimals, symbol, data }: HistoryChartProps) {
  return (
    <div className="card" style={{ padding: '20px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '16px',
      }}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans' }}>
            90-Day Price History
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px', fontFamily: 'Plus Jakarta Sans' }}>
            {symbol} close price with 20 / 50-day moving averages
          </div>
        </div>
        <ChartLegend
          swatchWidth={20}
          items={[
            { color: 'var(--accent-light)', label: 'Close' },
            { color: 'var(--warn)', label: 'SMA 20', dash: true },
            { color: 'var(--purple)', label: 'SMA 50', dash: true },
          ]}
        />
      </div>

      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="closeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.15} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => v.slice(5)}
              interval={Math.floor(data.length / 6)}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
              tickLine={false}
              axisLine={false}
              domain={['auto', 'auto']}
              tickFormatter={v => fmtAxisPrice(v, coin)}
              width={coin === 'bitcoin' ? 52 : 64}
            />
            <Tooltip content={<CustomTooltip decimals={decimals} />} />
            <Area
              type="monotone" dataKey="close" name="Close"
              stroke="var(--accent-light)" strokeWidth={2}
              fill="url(#closeGrad)" dot={false}
            />
            <Line
              type="monotone" dataKey="sma20" name="SMA 20"
              stroke="var(--warn)" strokeWidth={1.5}
              strokeDasharray="4 2" dot={false} connectNulls
            />
            <Line
              type="monotone" dataKey="sma50" name="SMA 50"
              stroke="var(--purple)" strokeWidth={1.5}
              strokeDasharray="4 2" dot={false} connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ height: '260px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="skeleton" style={{ width: '100%', height: '100%' }} />
        </div>
      )}
    </div>
  );
}
