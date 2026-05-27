import { useEffect, useState, useMemo } from 'react';
import { TrendingUp, TrendingDown, Activity, Wifi, WifiOff } from 'lucide-react';
import { fetchRealtime, fetchHistorical } from '../api/client';
import type { RealtimeResponse, HistoricalPoint } from '../api/client';
import { AreaChart } from '../components/LightweightChart';
import type { AreaPoint, ForecastPoint } from '../components/LightweightChart';
import { Card, Badge, MetricCard, Skeleton } from '../components/ui';

interface Props { coin: 'bitcoin' | 'dogecoin' }

function fmt(n: number | null | undefined, dec = 2) {
  return n != null ? `$${n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}` : '—';
}

export default function RealtimePage({ coin }: Props) {
  const [realtime,   setRealtime]   = useState<RealtimeResponse | null>(null);
  const [historical, setHistorical] = useState<HistoricalPoint[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      Promise.all([
        fetchRealtime(coin).catch(() => null),
        fetchHistorical(coin, 30),
      ])
        .then(([rt, hist]) => {
          setRealtime(rt);
          setHistorical(hist);
          setError(null);
        })
        .catch(e => setError(String(e)))
        .finally(() => setLoading(false));
    };
    setLoading(true);
    load();
    const interval = setInterval(() => {
      fetchRealtime(coin).then(rt => setRealtime(rt)).catch(() => {});
    }, 300_000);
    return () => clearInterval(interval);
  }, [coin]);

  const symbol   = coin === 'bitcoin' ? 'BTC' : 'DOGE';
  const isLive   = realtime?.source === 'realtime';
  const price    = realtime?.price ?? realtime?.avg_close ?? null;
  const decimals = coin === 'bitcoin' ? 2 : 6;

  const priceChange = useMemo(() => {
    if (historical.length < 2) return null;
    const first = historical[0].avg_close;
    const last  = historical[historical.length - 1].avg_close;
    return ((last - first) / first) * 100;
  }, [historical]);

  // Build area chart data (close prices)
  const chartData = useMemo<AreaPoint[]>(
    () => historical.map(d => ({ time: d.date.split('T')[0], value: d.avg_close })),
    [historical],
  );

  // SMA-20 as forecast overlay (reusing ForecastPoint which shares the same structure)
  const smaData = useMemo<ForecastPoint[]>(
    () => historical.filter(d => d.sma_20 != null).map(d => ({ time: d.date.split('T')[0], value: d.sma_20! })),
    [historical],
  );

  const tableRows = useMemo(() => [...historical].reverse().slice(0, 20), [historical]);

  if (loading) {
    return (
      <div>
        <Skeleton style={{ height: '36px', width: '200px', borderRadius: '8px', marginBottom: '28px' }} />
        <div className="grid grid-cols-4 gap-4 mb-5">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} style={{ height: '100px', borderRadius: '12px' }} />)}
        </div>
        <Skeleton style={{ height: '360px', borderRadius: '12px' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-red font-body text-sm">
        <Activity size={32} style={{ opacity: 0.5 }} />
        <div>Failed to load data</div>
        <div className="text-text-secondary text-xs">{error}</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-7">
        <div>
          <h1 className="font-display text-lg font-bold text-text-primary tracking-wider m-0 mb-1.5">
            REAL-TIME PRICES
          </h1>
          <div className="flex items-center gap-2">
            <span className="font-display text-[13px] text-cyan tracking-widest">{symbol}</span>
            <span className="text-text-secondary text-xs font-body">Latest market data</span>
            <Badge variant="info" className="font-mono">DAILY DATA · AUTO-REFRESH 5MIN</Badge>
          </div>
        </div>

        <Badge variant={isLive ? 'live' : 'batch'} className="px-3 py-1.5 text-[11px]">
          {isLive ? <Wifi size={11} /> : <WifiOff size={11} />}
          {isLive ? 'LIVE STREAM' : 'BATCH DATA'}
        </Badge>
      </div>

      {/* Price hero */}
      <Card className="p-7 mb-4 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, var(--bg-card) 60%, rgba(0,229,255,0.02))' }}>
        <div
          className="absolute top-0 right-0 w-52 h-52 pointer-events-none"
          style={{ background: 'radial-gradient(circle at top right, rgba(0,229,255,0.05) 0%, transparent 70%)' }}
        />
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] text-text-secondary font-body uppercase tracking-widest mb-2">Current Price</div>
            <div className="font-mono glow-cyan text-[40px] font-bold text-cyan leading-none tracking-tight">
              {fmt(price, decimals)}
            </div>
            {priceChange !== null && (
              <div
                className="inline-flex items-center gap-1.5 mt-2 text-[13px] font-body font-semibold"
                style={{ color: priceChange >= 0 ? '#00F0A0' : '#FF3864' }}
              >
                {priceChange >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}% (30d)
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-[11px] text-text-secondary font-body uppercase tracking-widest mb-1">Last Updated</div>
            <div className="font-mono text-[13px] text-text-primary">
              {realtime?.date?.split('T')[0] ?? realtime?.timestamp?.split('T')[0] ?? '—'}
            </div>
            <div className="text-[11px] text-text-secondary mt-1 font-body">
              {realtime?.source === 'realtime' ? 'Spark streaming' : 'Batch fallback'}
            </div>
          </div>
        </div>
      </Card>

      {/* Metric cards */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <MetricCard
          label="24h High"
          value={fmt(realtime?.daily_high, decimals)}
          valueColor="#00F0A0"
          sub="Intraday maximum"
        />
        <MetricCard
          label="24h Low"
          value={fmt(realtime?.daily_low, decimals)}
          valueColor="#FF3864"
          sub="Intraday minimum"
        />
        <MetricCard
          label="Volume"
          value={realtime?.avg_volume != null
            ? (realtime.avg_volume > 1e9
              ? `$${(realtime.avg_volume / 1e9).toFixed(2)}B`
              : `$${(realtime.avg_volume / 1e6).toFixed(1)}M`)
            : '—'}
          sub="24h trading volume"
        />
      </div>

      {/* Area chart — lightweight-charts replacing ApexCharts */}
      <Card className="p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[13px] font-semibold text-text-primary font-body">30-Day Price History</div>
          <div className="flex items-center gap-4 text-[11px] font-body">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-0.5 rounded bg-cyan" />
              <span className="text-text-secondary">Closing Price</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-0.5 rounded bg-gold" />
              <span className="text-text-secondary">SMA-20</span>
            </div>
          </div>
        </div>
        {historical.length > 0 ? (
          <AreaChart
            data={chartData}
            forecastData={smaData}
            height={320}
            color="var(--cyan)"
            forecastColor="var(--gold)"
          />
        ) : (
          <div className="h-80 flex items-center justify-center text-text-secondary font-body text-sm">
            No historical data available
          </div>
        )}
      </Card>

      {/* Data table */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="text-[13px] font-bold text-text-primary font-body">Recent Daily Records</div>
          <div className="text-[11px] text-text-secondary font-body">Last 20 days · newest first</div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th style={{ textAlign: 'right' }}>Close</th>
              <th style={{ textAlign: 'right' }}>High</th>
              <th style={{ textAlign: 'right' }}>Low</th>
              <th style={{ textAlign: 'right' }}>Volume</th>
              <th style={{ textAlign: 'right' }}>SMA-20</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((d, i) => (
              <tr key={i}>
                <td>
                  <span className="font-mono text-xs text-text-primary">{d.date.split('T')[0]}</span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className="font-mono font-bold text-[13px] text-cyan">{fmt(d.avg_close, decimals)}</span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className="font-mono text-xs" style={{ color: '#00F0A0' }}>{d.daily_high != null ? fmt(d.daily_high, decimals) : '—'}</span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className="font-mono text-xs" style={{ color: '#FF3864' }}>{d.daily_low != null ? fmt(d.daily_low, decimals) : '—'}</span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className="font-mono text-xs text-text-secondary">
                    {d.avg_volume != null
                      ? d.avg_volume > 1e9 ? `${(d.avg_volume / 1e9).toFixed(2)}B` : `${(d.avg_volume / 1e6).toFixed(1)}M`
                      : '—'}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className="font-mono text-xs" style={{ color: d.sma_20 != null ? '#FFB020' : 'var(--text-muted)' }}>
                    {d.sma_20 != null ? fmt(d.sma_20, decimals) : '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
