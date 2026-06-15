import {
  ResponsiveContainer, ComposedChart, Line, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import ChartLegend from '../../../components/charts/ChartLegend';
import type { TechnicalPoint } from '../types';
import type { Coin } from '../../../lib/coin';

const MacdTooltip = ({ active, payload, label, coin }: {
  active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; coin: string;
}) => {
  if (!active || !payload?.length) return null;
  const dec = coin === 'bitcoin' ? 2 : 6;
  return (
    <div className="chart-tooltip">
      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '5px', fontFamily: 'IBM Plex Mono' }}>{label}</div>
      {payload.map((p, i) => p.value != null && (
        <div key={i} style={{ display: 'flex', gap: '7px', alignItems: 'center', marginBottom: '2px' }}>
          <div style={{ width: '7px', height: '7px', borderRadius: '2px', background: p.color }} />
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flex: 1, fontFamily: 'Plus Jakarta Sans' }}>{p.name}</span>
          <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-primary)' }}>
            {p.value.toFixed(dec)}
          </span>
        </div>
      ))}
    </div>
  );
};

interface MacdChartProps {
  coin: Coin;
  decimals: number;
  data: TechnicalPoint[];
  xInterval: number;
  yWidth: number;
}

/** MACD(12,26,9) histogram + MACD/signal lines. */
export default function MacdChart({ coin, decimals, data, xInterval, yWidth }: MacdChartProps) {
  return (
    <div className="card" style={{ padding: '16px 20px', marginBottom: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans' }}>
          MACD (12, 26, 9)
        </div>
        <ChartLegend
          gap={14}
          items={[
            { color: 'var(--accent-light)', label: 'MACD', dash: false },
            { color: 'var(--warn)', label: 'Signal', dash: true },
          ]}
        />
      </div>
      <ResponsiveContainer width="100%" height={130}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="date" tickLine={false} axisLine={false}
            tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
            tickFormatter={v => v.slice(5)} interval={xInterval} />
          <YAxis tickLine={false} axisLine={false} width={yWidth}
            tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
            tickFormatter={v => v.toFixed(decimals > 2 ? 4 : 0)} />
          <Tooltip content={<MacdTooltip coin={coin} />} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
          <Bar dataKey="hist" name="Histogram" maxBarSize={6}>
            {data.map((d, i) => (
              <Cell key={i} fill={(d.hist ?? 0) >= 0 ? 'var(--up)' : 'var(--down)'} fillOpacity={0.6} />
            ))}
          </Bar>
          <Line type="monotone" dataKey="macd" name="MACD"
            stroke="var(--accent-light)" strokeWidth={1.5} dot={false} connectNulls />
          <Line type="monotone" dataKey="sig" name="Signal"
            stroke="var(--warn)" strokeWidth={1.5} strokeDasharray="4 2" dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
