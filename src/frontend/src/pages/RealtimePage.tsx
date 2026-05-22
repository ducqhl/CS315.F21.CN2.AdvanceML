import { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { fetchRealtime, fetchHistorical } from '../api/client';
import type { RealtimeResponse, HistoricalPoint } from '../api/client';

interface Props {
  coin: 'bitcoin' | 'dogecoin';
}

function MetricCard({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: '10px',
      padding: '18px 20px',
    }}>
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{ fontSize: '24px', fontWeight: 700, color: color || 'var(--text-primary)', letterSpacing: '-0.5px' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{sub}</div>}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '10px 14px',
        fontSize: '13px',
      }}>
        <div style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>{label}</div>
        <div style={{ color: 'var(--accent)', fontWeight: 600 }}>
          ${Number(payload[0].value).toLocaleString('en-US', { minimumFractionDigits: 2 })}
        </div>
      </div>
    );
  }
  return null;
};

export default function RealtimePage({ coin }: Props) {
  const [realtime, setRealtime] = useState<RealtimeResponse | null>(null);
  const [historical, setHistorical] = useState<HistoricalPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchRealtime(coin).catch(() => null),
      fetchHistorical(coin, 30),
    ])
      .then(([rt, hist]) => {
        setRealtime(rt);
        setHistorical(hist);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [coin]);

  const symbol = coin === 'bitcoin' ? 'BTC' : 'DOGE';
  const price = realtime?.price ?? realtime?.avg_close ?? null;
  const priceStr = price != null
    ? `$${price.toLocaleString('en-US', { minimumFractionDigits: coin === 'bitcoin' ? 2 : 4, maximumFractionDigits: coin === 'bitcoin' ? 2 : 4 })}`
    : '—';

  const chartData = historical.map(d => ({
    date: d.date?.split('T')[0] ?? '',
    price: d.avg_close,
  }));

  const isLive = realtime?.source === 'realtime';
  const source = isLive ? 'Live' : 'Batch fallback';

  if (loading) return <div style={{ color: 'var(--text-secondary)', padding: '40px' }}>Loading...</div>;
  if (error) return <div style={{ color: 'var(--red)', padding: '40px' }}>Error: {error}</div>;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)' }}>
            Real-time Prices — {symbol}
          </h1>
          <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
            Latest market data
          </div>
        </div>
        <div style={{
          marginLeft: 'auto',
          padding: '4px 12px',
          borderRadius: '20px',
          fontSize: '12px',
          fontWeight: 600,
          background: isLive ? 'rgba(38, 166, 154, 0.15)' : 'rgba(139, 148, 158, 0.15)',
          color: isLive ? 'var(--green)' : 'var(--text-secondary)',
          border: `1px solid ${isLive ? 'var(--green)' : 'var(--border)'}`,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          <span style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: isLive ? 'var(--green)' : 'var(--text-secondary)',
            display: 'inline-block',
          }} />
          {source}
        </div>
      </div>

      {/* Metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <MetricCard label="Price" value={priceStr} />
        <MetricCard
          label="24h High"
          value={realtime?.daily_high != null
            ? `$${realtime.daily_high.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
            : '—'}
          color="var(--green)"
        />
        <MetricCard
          label="24h Low"
          value={realtime?.daily_low != null
            ? `$${realtime.daily_low.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
            : '—'}
          color="var(--red)"
        />
        <MetricCard
          label="Last Updated"
          value={realtime?.date?.split('T')[0] ?? realtime?.timestamp?.split('T')[0] ?? '—'}
          sub={`Source: ${source}`}
        />
      </div>

      {/* Line chart */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        padding: '20px',
      }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px' }}>
          Last 30 Days — Closing Price
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
              tickFormatter={v => v.slice(5)}
              interval={4}
            />
            <YAxis
              tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
              tickFormatter={v => `$${v.toLocaleString()}`}
              width={80}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="price"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: 'var(--accent)' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
