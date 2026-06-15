import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis } from 'recharts';
import type { TechnicalPoint } from '../types';

interface VolumeChartProps {
  data: TechnicalPoint[];
  xInterval: number;
}

/** Daily trading-volume bar chart. */
export default function VolumeChart({ data, xInterval }: VolumeChartProps) {
  return (
    <div className="card" style={{ padding: '16px 20px' }}>
      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans', marginBottom: '10px' }}>
        Volume
      </div>
      <ResponsiveContainer width="100%" height={80}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <XAxis dataKey="date" tickLine={false} axisLine={false}
            tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
            tickFormatter={v => v.slice(5)} interval={xInterval} />
          <YAxis tickLine={false} axisLine={false} width={40}
            tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
            tickFormatter={v => v > 1e9 ? `${(v / 1e9).toFixed(0)}B` : v > 1e6 ? `${(v / 1e6).toFixed(0)}M` : String(v)} />
          <Bar dataKey="vol" name="Volume" fill="rgba(99,102,241,0.3)" maxBarSize={8} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
