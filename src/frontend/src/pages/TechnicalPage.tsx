import { useEffect, useState, useMemo } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { fetchTechnical } from '../api/client';
import type { HistoricalPoint } from '../api/client';

interface Props {
  coin: 'bitcoin' | 'dogecoin';
}

type Timeframe = '1M' | '3M' | '6M' | '1Y';
const TIMEFRAME_DAYS: Record<Timeframe, number> = {
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
};


const PriceTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0]?.payload;
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      padding: '10px 14px',
      fontSize: '12px',
      minWidth: '180px',
    }}>
      <div style={{ color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>{label}</div>
      {d?.open != null && <div>O: <span style={{ color: '#fff' }}>${d.open.toLocaleString()}</span></div>}
      {d?.high != null && <div>H: <span style={{ color: 'var(--green)' }}>${d.high.toLocaleString()}</span></div>}
      {d?.low != null && <div>L: <span style={{ color: 'var(--red)' }}>${d.low.toLocaleString()}</span></div>}
      {d?.close != null && <div>C: <span style={{ color: 'var(--accent)' }}>${d.close.toLocaleString()}</span></div>}
      {d?.sma_20 != null && <div>SMA20: <span style={{ color: '#f97316' }}>${Number(d.sma_20).toFixed(2)}</span></div>}
      {d?.sma_50 != null && <div>SMA50: <span style={{ color: '#a855f7' }}>${Number(d.sma_50).toFixed(2)}</span></div>}
    </div>
  );
};

const RsiTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      padding: '8px 12px',
      fontSize: '12px',
    }}>
      <div style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>{label}</div>
      <div>RSI: <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{Number(payload[0]?.value).toFixed(2)}</span></div>
    </div>
  );
};

export default function TechnicalPage({ coin }: Props) {
  const [timeframe, setTimeframe] = useState<Timeframe>('3M');
  const [data, setData] = useState<HistoricalPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchTechnical(coin, TIMEFRAME_DAYS[timeframe])
      .then(d => setData(d))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [coin, timeframe]);

  const chartData = useMemo(() =>
    data.map(d => ({
      date: d.date?.split('T')[0] ?? '',
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close ?? d.avg_close,
      sma_20: d.sma_20,
      sma_50: d.sma_50,
      volume: d.avg_volume,
      rsi: d.rsi,
    })),
    [data]
  );

  const rsiData = chartData.filter(d => d.rsi != null);

  const symbol = coin === 'bitcoin' ? 'BTC' : 'DOGE';

  if (loading) return <div style={{ color: 'var(--text-secondary)', padding: '40px' }}>Loading...</div>;
  if (error) return <div style={{ color: 'var(--red)', padding: '40px' }}>Error: {error}</div>;

  const allClose = chartData.map(d => d.close ?? 0).filter(Boolean);
  const yMin = Math.min(...allClose) * 0.98;
  const yMax = Math.max(...allClose) * 1.02;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)' }}>
            Technical Analysis — {symbol}
          </h1>
          <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
            SMA overlays, volume, and RSI(14)
          </div>
        </div>
        {/* Timeframe selector */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
          {(['1M', '3M', '6M', '1Y'] as Timeframe[]).map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: timeframe === tf ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: timeframe === tf ? 'rgba(0, 212, 255, 0.1)' : 'transparent',
                color: timeframe === tf ? 'var(--accent)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: timeframe === tf ? 600 : 400,
              }}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '12px', fontSize: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ width: '20px', height: '2px', background: '#f97316' }} />
          <span style={{ color: 'var(--text-secondary)' }}>SMA-20</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ width: '20px', height: '2px', background: '#a855f7' }} />
          <span style={{ color: 'var(--text-secondary)' }}>SMA-50</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ width: '10px', height: '10px', background: 'var(--green)', borderRadius: '2px' }} />
          <span style={{ color: 'var(--text-secondary)' }}>Bull</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ width: '10px', height: '10px', background: 'var(--red)', borderRadius: '2px' }} />
          <span style={{ color: 'var(--text-secondary)' }}>Bear</span>
        </div>
      </div>

      {/* Candlestick + SMA chart */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        padding: '20px',
        marginBottom: '16px',
      }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '12px' }}>
          Price — Candlestick with SMA Overlays
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
              tickFormatter={v => v.slice(5)}
              interval={Math.floor(chartData.length / 8)}
            />
            <YAxis
              tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
              tickFormatter={v => `$${Number(v).toLocaleString()}`}
              domain={[yMin, yMax]}
              width={80}
            />
            <Tooltip content={<PriceTooltip />} />
            {/* Candlestick bars — rendered as colored close-open bars */}
            <Bar dataKey="close" barSize={Math.max(1, Math.floor(900 / chartData.length))}>
              {chartData.map((entry, i) => (
                <Cell
                  key={i}
                  fill={(entry.close ?? 0) >= (entry.open ?? 0) ? '#26a69a' : '#ef5350'}
                />
              ))}
            </Bar>
            <Line type="monotone" dataKey="sma_20" stroke="#f97316" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="sma_50" stroke="#a855f7" strokeWidth={1.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Volume chart */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        padding: '20px',
        marginBottom: '16px',
      }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '12px' }}>
          Volume
        </div>
        <ResponsiveContainer width="100%" height={120}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
              tickFormatter={v => v.slice(5)}
              interval={Math.floor(chartData.length / 8)}
            />
            <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} width={60} />
            <Tooltip formatter={(v: any) => [Number(v).toLocaleString(), 'Volume']} />
            <Bar dataKey="volume" fill="rgba(0, 212, 255, 0.3)" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* RSI chart */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        padding: '20px',
      }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '12px' }}>
          RSI(14)
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <ComposedChart data={rsiData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
              tickFormatter={v => v.slice(5)}
              interval={Math.floor(rsiData.length / 8)}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
              width={40}
            />
            <Tooltip content={<RsiTooltip />} />
            <ReferenceLine y={70} stroke="var(--red)" strokeDasharray="4 4" label={{ value: '70', fill: 'var(--red)', fontSize: 10 }} />
            <ReferenceLine y={30} stroke="var(--green)" strokeDasharray="4 4" label={{ value: '30', fill: 'var(--green)', fontSize: 10 }} />
            <Line type="monotone" dataKey="rsi" stroke="var(--accent)" strokeWidth={1.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
