import { useEffect, useState, useMemo } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { fetchHistorical, fetchPredictions } from '../api/client';
import type { PredictionsResponse, HistoricalPoint } from '../api/client';

interface Props {
  coin: 'bitcoin' | 'dogecoin';
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: '10px',
      padding: '18px 20px',
    }}>
      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--accent)', letterSpacing: '-0.5px' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>{sub}</div>}
    </div>
  );
}

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      padding: '10px 14px',
      fontSize: '12px',
    }}>
      <div style={{ color: 'var(--text-secondary)', marginBottom: '6px' }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ color: p.stroke || p.color, marginBottom: '2px' }}>
          {p.name}: ${Number(p.value).toLocaleString('en-US', { minimumFractionDigits: 2 })}
        </div>
      ))}
    </div>
  );
};

export default function PredictionsPage({ coin }: Props) {
  const [historical, setHistorical] = useState<HistoricalPoint[]>([]);
  const [predictions, setPredictions] = useState<PredictionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchHistorical(coin, 90),
      fetchPredictions(coin),
    ])
      .then(([hist, pred]) => {
        setHistorical(hist);
        setPredictions(pred);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [coin]);

  const symbol = coin === 'bitcoin' ? 'BTC' : 'DOGE';
  const decimals = coin === 'bitcoin' ? 2 : 4;
  const fmt = (n: number | null) =>
    n != null
      ? `$${n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
      : '—';

  const chartData = useMemo(() => {
    const histPoints = historical.map(d => ({
      date: d.date?.split('T')[0] ?? '',
      historical: d.avg_close,
      forecast: null as number | null,
    }));
    const forecastPoints = (predictions?.predictions ?? []).map(p => ({
      date: p.prediction_date?.split('T')[0] ?? '',
      historical: null as number | null,
      forecast: p.predicted_price,
    }));

    // Get last historical point to connect lines
    if (histPoints.length > 0 && forecastPoints.length > 0) {
      const lastHist = histPoints[histPoints.length - 1];
      forecastPoints[0] = { ...forecastPoints[0], historical: lastHist.historical };
    }

    return [...histPoints, ...forecastPoints];
  }, [historical, predictions]);

  // Find the date where forecast starts
  const forecastStartDate = predictions?.predictions?.[0]?.prediction_date?.split('T')[0];

  if (loading) return <div style={{ color: 'var(--text-secondary)', padding: '40px' }}>Loading...</div>;
  if (error) return <div style={{ color: 'var(--red)', padding: '40px' }}>Error: {error}</div>;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)' }}>
          LSTM Predictions — {symbol}
        </h1>
        <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
          7-day autoregressive forecast from trained LSTM model
        </div>
      </div>

      {/* Metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <MetricCard label="Next-Day Price" value={fmt(predictions?.next_day_price ?? null)} />
        <MetricCard label="7-Day High" value={fmt(predictions?.seven_day_high ?? null)} />
        <MetricCard label="7-Day Low" value={fmt(predictions?.seven_day_low ?? null)} />
        <MetricCard
          label="Model Version"
          value={predictions?.model_version ?? '—'}
          sub="Trained on historical_sma"
        />
      </div>

      {/* Combined chart */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        padding: '20px',
        marginBottom: '24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '16px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
            90-Day History + 7-Day Forecast
          </div>
          <div style={{ display: 'flex', gap: '16px', fontSize: '12px', marginLeft: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '20px', height: '2px', background: 'var(--text-secondary)' }} />
              <span style={{ color: 'var(--text-secondary)' }}>Historical</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '20px', height: '2px', background: 'var(--accent)', borderTop: '2px dashed var(--accent)' }} />
              <span style={{ color: 'var(--text-secondary)' }}>Forecast</span>
            </div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
              tickFormatter={v => v.slice(5)}
              interval={Math.floor(chartData.length / 10)}
            />
            <YAxis
              tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
              tickFormatter={v => `$${Number(v).toLocaleString()}`}
              width={80}
            />
            <Tooltip content={<ChartTooltip />} />
            {forecastStartDate && (
              <ReferenceLine
                x={forecastStartDate}
                stroke="var(--accent)"
                strokeDasharray="4 4"
                label={{ value: 'Forecast', fill: 'var(--accent)', fontSize: 11, position: 'insideTop' }}
              />
            )}
            <Line
              type="monotone"
              dataKey="historical"
              name="Historical"
              stroke="#8b949e"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="forecast"
              name="Forecast"
              stroke="var(--accent)"
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={{ r: 4, fill: 'var(--accent)', strokeWidth: 0 }}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Prediction table */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
          Prediction Details
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
              <th style={{ padding: '10px 20px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 500 }}>Date</th>
              <th style={{ padding: '10px 20px', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: 500 }}>Predicted Price</th>
              <th style={{ padding: '10px 20px', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: 500 }}>Confidence</th>
              <th style={{ padding: '10px 20px', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: 500 }}>Model</th>
            </tr>
          </thead>
          <tbody>
            {predictions?.predictions.map((p, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '12px 20px', color: 'var(--text-primary)' }}>{p.prediction_date.split('T')[0]}</td>
                <td style={{ padding: '12px 20px', textAlign: 'right', color: 'var(--accent)', fontWeight: 600 }}>
                  {fmt(p.predicted_price)}
                </td>
                <td style={{ padding: '12px 20px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                  {(p.confidence * 100).toFixed(0)}%
                </td>
                <td style={{ padding: '12px 20px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                  {p.model_version}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
