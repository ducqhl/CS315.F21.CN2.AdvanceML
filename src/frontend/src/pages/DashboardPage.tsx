import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  TrendingUp, TrendingDown, Minus, Clock, Wifi, WifiOff, Cpu,
} from 'lucide-react';
import {
  ResponsiveContainer, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Line, ComposedChart,
} from 'recharts';
import {
  fetchStats, fetchPredictions, fetchRealtime, fetchHistorical, fetchInferenceStatus,
} from '../api/client';

interface Props { coin: 'bitcoin' | 'dogecoin' }

const stagger = {
  animate: { transition: { staggerChildren: 0.04 } },
};
const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.22 } },
};

function fmt(p: number | null | undefined, dec = 2) {
  if (p == null) return '—';
  return `$${p.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

function timeAgo(iso?: string) {
  if (!iso) return 'never';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function inferenceColor(status?: string, lastRun?: string): string {
  if (status === 'error') return 'var(--down)';
  if (!lastRun) return 'var(--down)';
  const age = (Date.now() - new Date(lastRun).getTime()) / 60000;
  if (age < 6) return 'var(--up)';
  if (age < 15) return 'var(--warn)';
  return 'var(--down)';
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

export default function DashboardPage({ coin }: Props) {
  const symbol   = coin === 'bitcoin' ? 'BTC' : 'DOGE';
  const decimals = coin === 'bitcoin' ? 2 : 6;

  const { data: stats }       = useQuery({ queryKey: ['stats'], queryFn: fetchStats, staleTime: 30_000, refetchInterval: 30_000 });
  const { data: prediction }  = useQuery({ queryKey: ['predictions', coin, 7], queryFn: () => fetchPredictions(coin, 7), staleTime: 120_000 });
  const { data: realtime }    = useQuery({ queryKey: ['realtime', coin], queryFn: () => fetchRealtime(coin), staleTime: 30_000, refetchInterval: 30_000 });
  const { data: history = [] } = useQuery({ queryKey: ['historical', coin, 90], queryFn: () => fetchHistorical(coin, 90), staleTime: 300_000 });
  const { data: inference }   = useQuery({ queryKey: ['inference-status'], queryFn: fetchInferenceStatus, staleTime: 30_000, refetchInterval: 30_000 });

  const price    = realtime?.price ?? realtime?.avg_close ?? null;
  const btcJob   = inference?.jobs?.['BTC'];
  const dogeJob  = inference?.jobs?.['DOGE'];
  const nextDayP = prediction?.next_day_price;

  const chartData = useMemo(() =>
    history.map(d => ({
      date:  d.date.split('T')[0],
      close: d.avg_close,
      sma20: d.sma_20 ?? null,
      sma50: d.sma_50 ?? null,
    })),
    [history]
  );

  const outlook = useMemo(() => {
    const preds = prediction?.predictions ?? [];
    const up   = preds.filter(p => p.direction === 'UP').length;
    const down = preds.filter(p => p.direction === 'DOWN').length;
    if (up > down)   return { label: 'Bullish',  color: 'var(--up)',   Icon: TrendingUp,   count: `${up}/${preds.length}` };
    if (down > up)   return { label: 'Bearish',  color: 'var(--down)', Icon: TrendingDown, count: `${down}/${preds.length}` };
    return              { label: 'Neutral',  color: 'var(--warn)', Icon: Minus,        count: '—' };
  }, [prediction]);

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: '28px' }}>
        <h1 className="font-display" style={{ margin: 0, fontSize: '22px', color: 'var(--text-primary)' }}>
          Overview
        </h1>
        <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px', fontFamily: 'Plus Jakarta Sans' }}>
          {symbol} · Live prices, LSTM forecasts &amp; inference status
        </div>
      </div>

      {/* Stat cards */}
      <motion.div
        variants={stagger}
        initial="initial"
        animate="animate"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '16px' }}
      >
        {/* Current price */}
        <motion.div variants={fadeUp} className="metric-card">
          <div className="metric-label">Current Price</div>
          <div className="metric-value" style={{ fontSize: '20px', color: 'var(--text-primary)' }}>
            {fmt(price, decimals)}
          </div>
          <div className="metric-sub" style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '8px' }}>
            {realtime?.source === 'realtime'
              ? <><Wifi size={10} color="var(--up)" /> <span style={{ color: 'var(--up)' }}>Live stream</span></>
              : <><WifiOff size={10} /> Batch data</>}
          </div>
        </motion.div>

        {/* 24h range */}
        <motion.div variants={fadeUp} className="metric-card">
          <div className="metric-label">24h Range</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
            <div className="font-mono" style={{ fontSize: '14px', color: 'var(--up)', fontWeight: 500 }}>
              ↑ {fmt(realtime?.daily_high, decimals)}
            </div>
            <div className="font-mono" style={{ fontSize: '14px', color: 'var(--down)', fontWeight: 500 }}>
              ↓ {fmt(realtime?.daily_low, decimals)}
            </div>
          </div>
        </motion.div>

        {/* Next-day forecast */}
        <motion.div variants={fadeUp} className="metric-card" style={{
          background: nextDayP ? `linear-gradient(135deg, var(--bg-card) 70%, var(--accent-muted))` : 'var(--bg-card)',
        }}>
          <div className="metric-label">Next-Day Forecast</div>
          <div className="metric-value" style={{ color: nextDayP ? 'var(--accent-light)' : 'var(--text-muted)' }}>
            {fmt(nextDayP, decimals)}
          </div>
          {prediction?.model_version && (
            <div className="metric-sub">{prediction.model_version}</div>
          )}
        </motion.div>

        {/* Volume */}
        <motion.div variants={fadeUp} className="metric-card">
          <div className="metric-label">Avg Volume</div>
          <div className="metric-value" style={{ fontSize: '18px' }}>
            {realtime?.avg_volume != null
              ? realtime.avg_volume > 1e9
                ? `$${(realtime.avg_volume / 1e9).toFixed(2)}B`
                : `$${(realtime.avg_volume / 1e6).toFixed(1)}M`
              : '—'}
          </div>
          <div className="metric-sub">24h trading volume</div>
        </motion.div>
      </motion.div>

      {/* Second row: outlook + inference + collection stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '16px' }}>
        {/* 7d outlook */}
        <div className="metric-card" style={{
          borderColor: outlook ? 'rgba(0,0,0,0)' : 'var(--border)',
          backgroundImage: outlook ? `linear-gradient(135deg, var(--bg-card) 55%, ${outlook.color}0A)` : undefined,
        }}>
          <div className="metric-label">7-Day Outlook · {symbol}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '2px' }}>
            <outlook.Icon size={18} color={outlook.color} />
            <span className="font-display" style={{ fontSize: '16px', color: outlook.color }}>
              {outlook.label}
            </span>
          </div>
          <div className="metric-sub">{outlook.count} days confirmed</div>
        </div>

        {/* Inference status */}
        <div className="metric-card">
          <div className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Cpu size={10} /> Inference Engine
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
            {[['BTC', btcJob], ['DOGE', dogeJob]] .map(([sym, job]) => {
              const j = job as typeof btcJob;
              return (
                <div key={sym as string} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0, background: inferenceColor(j?.status, j?.last_run_at) }} />
                  <span className="font-mono" style={{ fontSize: '11px', color: 'var(--accent-light)', minWidth: '36px' }}>{sym as string}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
                    {j?.last_run_at ? timeAgo(j.last_run_at) : 'no data'}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="metric-sub" style={{ marginTop: '8px' }}>
            <Clock size={9} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
            Every {inference?.interval_seconds ?? 300}s
          </div>
        </div>

        {/* Collection sizes */}
        <div className="metric-card">
          <div className="metric-label">Data Collections</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '2px' }}>
            {Object.entries(stats?.doc_counts ?? {}).slice(0, 4).map(([name, count]) => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
                  {name.replace(/_/g, ' ')}
                </span>
                <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-primary)' }}>
                  {(count as number).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Historical chart */}
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
          <div style={{ display: 'flex', gap: '16px', fontSize: '11px', fontFamily: 'Plus Jakarta Sans' }}>
            {[
              { color: 'var(--accent-light)', label: 'Close' },
              { color: 'var(--warn)', label: 'SMA 20', dash: true },
              { color: 'var(--purple)', label: 'SMA 50', dash: true },
            ].map(({ color, label, dash }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <svg width="20" height="8">
                  <line x1="0" y1="4" x2="20" y2="4" stroke={color} strokeWidth="1.5"
                    strokeDasharray={dash ? '4 2' : undefined} />
                </svg>
                <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
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
                interval={Math.floor(chartData.length / 6)}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
                tickLine={false}
                axisLine={false}
                domain={['auto', 'auto']}
                tickFormatter={v => coin === 'bitcoin' ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(4)}`}
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
    </div>
  );
}
