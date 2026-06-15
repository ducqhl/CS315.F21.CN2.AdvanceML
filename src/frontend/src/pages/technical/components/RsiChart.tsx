import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import type { TechnicalPoint } from '../types';

const RsiTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value;
  return (
    <div className="chart-tooltip">
      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px', fontFamily: 'IBM Plex Mono' }}>{label}</div>
      <div className="font-mono" style={{ fontSize: '12px', color: v >= 70 ? 'var(--down)' : v <= 30 ? 'var(--up)' : 'var(--accent-light)' }}>
        RSI {v?.toFixed(2) ?? '—'}
      </div>
    </div>
  );
};

interface RsiChartProps {
  data: TechnicalPoint[];
  xInterval: number;
}

/** RSI(14) line chart with overbought/oversold reference lines. */
export default function RsiChart({ data, xInterval }: RsiChartProps) {
  const hasData = data.some(d => d.rsi != null);
  return (
    <div className="card" style={{ padding: '16px 20px', marginBottom: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans' }}>
          RSI (14)
        </div>
        <div style={{ display: 'flex', gap: '16px', fontSize: '11px', fontFamily: 'Plus Jakarta Sans' }}>
          <span style={{ color: 'var(--down)' }}>— 70 Overbought</span>
          <span style={{ color: 'var(--up)' }}>— 30 Oversold</span>
        </div>
      </div>
      {hasData ? (
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false}
              tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
              tickFormatter={v => v.slice(5)} interval={xInterval} />
            <YAxis domain={[0, 100]} tickCount={5} tickLine={false} axisLine={false} width={28}
              tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }} />
            <Tooltip content={<RsiTooltip />} />
            <ReferenceLine y={70} stroke="var(--down)" strokeDasharray="4 2" strokeOpacity={0.6} />
            <ReferenceLine y={30} stroke="var(--up)"   strokeDasharray="4 2" strokeOpacity={0.6} />
            <ReferenceLine y={50} stroke="rgba(255,255,255,0.06)" />
            <Line type="monotone" dataKey="rsi" name="RSI"
              stroke="var(--accent-light)" strokeWidth={1.5} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '12px', fontFamily: 'Plus Jakarta Sans' }}>
          RSI data not available for this timeframe
        </div>
      )}
    </div>
  );
}
