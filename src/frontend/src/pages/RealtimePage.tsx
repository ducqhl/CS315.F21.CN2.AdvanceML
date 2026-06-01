import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Area,
  Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { fetchRealtime, fetchHistorical } from '../api/client';

interface Props { coin: 'bitcoin' | 'dogecoin' }

type Overlay = 'sma20' | 'sma50';

function fmt(n: number | null | undefined, dec = 2) {
  if (n == null) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

const TIMEFRAMES = [
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
];

const ChartTooltip = ({ active, payload, label, decimals }: {
  active?: boolean; payload?: { name: string; value: number; color: string }[];
  label?: string; decimals: number;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '5px', fontFamily: 'IBM Plex Mono' }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '2px' }}>
          <div style={{ width: '7px', height: '7px', borderRadius: '2px', background: p.color }} />
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flex: 1, fontFamily: 'Plus Jakarta Sans' }}>{p.name}</span>
          <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-primary)' }}>{fmt(p.value, decimals)}</span>
        </div>
      ))}
    </div>
  );
};

export default function RealtimePage({ coin }: Props) {
  const [days, setDays]         = useState(90);
  const [overlays, setOverlays] = useState<Set<Overlay>>(new Set(['sma20']));

  const symbol   = coin === 'bitcoin' ? 'BTC' : 'DOGE';
  const decimals = coin === 'bitcoin' ? 2 : 6;

  const { data: realtime, isLoading: rtLoading, dataUpdatedAt } = useQuery({
    queryKey: ['realtime', coin],
    queryFn:  () => fetchRealtime(coin),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { data: history = [], isLoading: histLoading } = useQuery({
    queryKey: ['historical', coin, days],
    queryFn:  () => fetchHistorical(coin, days),
    staleTime: 300_000,
  });

  const price        = realtime?.price ?? realtime?.avg_close ?? null;
  const isLive       = realtime?.source === 'realtime';
  const lastUpdated  = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—';

  const priceChange = useMemo(() => {
    if (history.length < 2) return null;
    const first = history[0].avg_close;
    const last  = history[history.length - 1].avg_close;
    return ((last - first) / first) * 100;
  }, [history]);

  const chartData = useMemo(() =>
    history.map(d => ({
      date:  d.date.split('T')[0],
      close: d.avg_close,
      sma20: d.sma_20 ?? null,
      sma50: d.sma_50 ?? null,
      high:  d.daily_high ?? null,
      low:   d.daily_low  ?? null,
    })),
    [history]
  );

  const tableRows = useMemo(() => [...history].reverse().slice(0, 25), [history]);

  const toggleOverlay = (key: Overlay) =>
    setOverlays(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  const loading = rtLoading || histLoading;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '28px' }}>
        <div>
          <h1 className="font-display" style={{ margin: 0, fontSize: '22px', color: 'var(--text-primary)' }}>
            Real-time
          </h1>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px', fontFamily: 'Plus Jakarta Sans' }}>
            {symbol} · Latest prices and historical data
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            padding: '6px 13px', borderRadius: '20px',
            background: isLive ? 'var(--up-subtle)' : 'var(--bg-elevated)',
            border: `1px solid ${isLive ? 'var(--up-border)' : 'var(--border)'}`,
            fontSize: '11px', fontWeight: 600, fontFamily: 'Plus Jakarta Sans',
            color: isLive ? 'var(--up)' : 'var(--text-secondary)',
          }}>
            {isLive ? <Wifi size={11} /> : <WifiOff size={11} />}
            {isLive ? 'Live' : 'Batch'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans' }}>
            <RefreshCw size={10} />
            {lastUpdated}
          </div>
        </div>
      </div>

      {/* Price hero */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="card"
        style={{ padding: '28px 32px', marginBottom: '14px' }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '24px', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px' }}>
              Current Price · {symbol}
            </div>
            {loading ? (
              <div className="skeleton" style={{ height: '48px', width: '240px', borderRadius: '8px' }} />
            ) : (
              <>
                <div className="font-mono" style={{ fontSize: '44px', fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1 }}>
                  {fmt(price, decimals)}
                </div>
                {priceChange != null && (
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    marginTop: '10px', fontSize: '13px', fontWeight: 600, fontFamily: 'Plus Jakarta Sans',
                    color: priceChange >= 0 ? 'var(--up)' : 'var(--down)',
                  }}>
                    {priceChange >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}% ({TIMEFRAMES.find(t => t.days === days)?.label ?? `${days}d`})
                  </div>
                )}
              </>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '3px' }}>24h High</div>
              <div className="font-mono" style={{ fontSize: '15px', color: 'var(--up)' }}>{fmt(realtime?.daily_high, decimals)}</div>
            </div>
            <div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '3px' }}>24h Low</div>
              <div className="font-mono" style={{ fontSize: '15px', color: 'var(--down)' }}>{fmt(realtime?.daily_low, decimals)}</div>
            </div>
            <div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '3px' }}>Volume</div>
              <div className="font-mono" style={{ fontSize: '15px', color: 'var(--text-primary)' }}>
                {realtime?.avg_volume != null
                  ? realtime.avg_volume > 1e9
                    ? `$${(realtime.avg_volume / 1e9).toFixed(2)}B`
                    : `$${(realtime.avg_volume / 1e6).toFixed(1)}M`
                  : '—'}
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Historical chart */}
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
                onClick={() => toggleOverlay(key)}
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
            {TIMEFRAMES.map(tf => (
              <button
                key={tf.label}
                onClick={() => setDays(tf.days)}
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
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
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
                interval={Math.floor(chartData.length / 7)}
              />
              <YAxis
                tickLine={false} axisLine={false}
                tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
                tickFormatter={v => coin === 'bitcoin' ? `$${(v / 1000).toFixed(0)}k` : `$${v.toFixed(4)}`}
                width={coin === 'bitcoin' ? 48 : 64}
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

      {/* Daily records table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans' }}>
            Daily Records
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
            Last 25 days · newest first
          </div>
        </div>
        {loading ? (
          <div style={{ padding: '20px' }}>
            {[...Array(5)].map((_, i) => (
              <div key={i} className="skeleton" style={{ height: '40px', borderRadius: '6px', marginBottom: '8px' }} />
            ))}
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>Close</th>
                <th style={{ textAlign: 'right' }}>High</th>
                <th style={{ textAlign: 'right' }}>Low</th>
                <th style={{ textAlign: 'right' }}>Volume</th>
                <th style={{ textAlign: 'right' }}>SMA 20</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((d, i) => (
                <tr key={i}>
                  <td>
                    <span className="font-mono" style={{ fontSize: '12px' }}>{d.date.split('T')[0]}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="font-mono" style={{ color: 'var(--accent-light)', fontWeight: 500 }}>
                      {fmt(d.avg_close, decimals)}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="font-mono" style={{ color: 'var(--up)', fontSize: '12px' }}>
                      {d.daily_high != null ? fmt(d.daily_high, decimals) : '—'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="font-mono" style={{ color: 'var(--down)', fontSize: '12px' }}>
                      {d.daily_low != null ? fmt(d.daily_low, decimals) : '—'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="font-mono" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {d.avg_volume != null
                        ? d.avg_volume > 1e9 ? `${(d.avg_volume / 1e9).toFixed(2)}B` : `${(d.avg_volume / 1e6).toFixed(1)}M`
                        : '—'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="font-mono" style={{ color: d.sma_20 ? 'var(--warn)' : 'var(--text-muted)', fontSize: '12px' }}>
                      {d.sma_20 ? fmt(d.sma_20, decimals) : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
