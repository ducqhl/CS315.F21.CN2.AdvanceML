import { useEffect, useState, useMemo } from 'react';
import { TrendingUp, TrendingDown, Activity, Wifi, WifiOff } from 'lucide-react';
import ReactApexChart from 'react-apexcharts';
import { fetchRealtime, fetchHistorical } from '../api/client';
import type { RealtimeResponse, HistoricalPoint } from '../api/client';
import { C, baseApexOptions } from '../components/apexTheme';

interface Props {
  coin: 'bitcoin' | 'dogecoin';
}

function StatCard({ label, value, sub, valueColor }: {
  label: string; value: string; sub?: string; valueColor?: string;
}) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={{ color: valueColor ?? 'var(--text-primary)' }}>
        {value}
      </div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

export default function RealtimePage({ coin }: Props) {
  const [realtime, setRealtime] = useState<RealtimeResponse | null>(null);
  const [historical, setHistorical] = useState<HistoricalPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    // Auto-refresh realtime every 5 minutes
    const interval = setInterval(() => {
      fetchRealtime(coin).then(rt => setRealtime(rt)).catch(() => {});
    }, 300000);
    return () => clearInterval(interval);
  }, [coin]);

  const symbol = coin === 'bitcoin' ? 'BTC' : 'DOGE';
  const isLive = realtime?.source === 'realtime';
  const price = realtime?.price ?? realtime?.avg_close ?? null;
  const decimals = coin === 'bitcoin' ? 2 : 6;

  const fmt = (n: number | null | undefined, dec = 2) =>
    n != null ? `$${n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}` : '—';

  const priceChange = useMemo(() => {
    if (historical.length < 2) return null;
    const first = historical[0].avg_close;
    const last = historical[historical.length - 1].avg_close;
    return ((last - first) / first) * 100;
  }, [historical]);

  // Build ApexCharts series data
  const chartSeries = useMemo((): ApexCharts.ApexOptions['series'] => {
    const closeSeries = historical.map(d => ({
      x: d.date.split('T')[0],
      y: d.avg_close,
    }));
    const sma20Series = historical
      .filter(d => d.sma_20 != null)
      .map(d => ({
        x: d.date.split('T')[0],
        y: d.sma_20!,
      }));

    return [
      { name: 'Close Price', type: 'area', data: closeSeries },
      { name: 'SMA-20', type: 'line', data: sma20Series },
    ];
  }, [historical]);

  const chartOptions = useMemo((): ApexCharts.ApexOptions => {
    const base = baseApexOptions(320);
    return {
      ...base,
      chart: {
        ...base.chart,
        id: 'realtime-price',
        type: 'line',
        height: 320,
        toolbar: { show: false },
        zoom: { enabled: false },
      },
      stroke: {
        curve: 'smooth',
        width: [1.5, 1],
        dashArray: [0, 0],
      },
      colors: [C.cyan, C.gold],
      fill: {
        type: ['gradient', 'solid'],
        gradient: {
          shade: 'dark',
          type: 'vertical',
          shadeIntensity: 0.5,
          gradientToColors: [C.cyan],
          opacityFrom: 0.15,
          opacityTo: 0.01,
          stops: [0, 100],
        },
      },
      xaxis: {
        ...base.xaxis,
        type: 'category',
        tickAmount: 8,
        labels: {
          ...base.xaxis?.labels,
          formatter: (v: string) => v ? v.slice(5) : '',
        },
      },
      yaxis: {
        ...base.yaxis,
        labels: {
          ...(Array.isArray(base.yaxis) ? {} : base.yaxis?.labels),
          style: { colors: C.textSec, fontSize: '10px', fontFamily: "'Space Mono', monospace" },
          formatter: (v: number) =>
            coin === 'bitcoin'
              ? `$${(v / 1000).toFixed(1)}k`
              : `$${v.toFixed(4)}`,
        },
      },
      tooltip: {
        ...base.tooltip,
        shared: true,
        intersect: false,
        y: {
          formatter: (v: number) => fmt(v, decimals),
        },
      },
      legend: {
        ...base.legend,
        show: true,
        position: 'top',
        horizontalAlign: 'right',
        markers: { size: 6 },
      },
      markers: { size: 0 },
    };
  }, [historical, coin, decimals]);

  // Table rows — last 20 sorted newest first
  const tableRows = useMemo(
    () => [...historical].reverse().slice(0, 20),
    [historical]
  );

  if (loading) {
    return (
      <div style={{ padding: '0' }}>
        <div className="skeleton" style={{ height: '36px', width: '200px', borderRadius: '8px', marginBottom: '28px' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '20px' }}>
          {[1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ height: '100px', borderRadius: '12px' }} />)}
        </div>
        <div className="skeleton" style={{ height: '360px', borderRadius: '12px' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        padding: '40px', textAlign: 'center', color: 'var(--red)',
        fontFamily: 'Manrope, sans-serif', fontSize: '14px',
      }}>
        <Activity size={32} style={{ marginBottom: '12px', opacity: 0.5 }} />
        <div>Failed to load data</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '6px' }}>{error}</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '28px' }}>
        <div>
          <div className="font-display" style={{
            fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)',
            letterSpacing: '0.06em', marginBottom: '6px',
          }}>
            REAL-TIME PRICES
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="font-display" style={{ fontSize: '13px', color: 'var(--cyan)', letterSpacing: '0.1em' }}>
              {symbol}
            </span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '12px', fontFamily: 'Manrope' }}>
              Latest market data
            </span>
            {/* Auto-refresh badge */}
            <span style={{
              padding: '2px 8px', borderRadius: '12px', fontSize: '10px', fontWeight: 600,
              background: 'rgba(0,229,255,0.07)', border: '1px solid rgba(0,229,255,0.18)',
              color: 'var(--cyan)', fontFamily: 'Space Mono', letterSpacing: '0.04em',
            }}>
              DAILY DATA · AUTO-REFRESH 5MIN
            </span>
          </div>
        </div>

        {/* Live badge */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '7px 14px', borderRadius: '24px',
          background: isLive ? 'var(--green-10)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${isLive ? 'rgba(0,240,160,0.25)' : 'var(--border)'}`,
          color: isLive ? 'var(--green)' : 'var(--text-secondary)',
          fontSize: '11px', fontWeight: 700, fontFamily: 'Manrope',
          letterSpacing: '0.06em', textTransform: 'uppercase',
        }}>
          {isLive ? <Wifi size={12} /> : <WifiOff size={12} />}
          {isLive && (
            <div className="pulse-dot green" style={{ width: '6px', height: '6px' }} />
          )}
          {isLive ? 'LIVE STREAM' : 'BATCH DATA'}
        </div>
      </div>

      {/* Price hero */}
      <div className="card" style={{
        padding: '28px 32px',
        marginBottom: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'linear-gradient(135deg, var(--bg-card) 60%, rgba(0,229,255,0.03))',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 0, right: 0,
          width: '200px', height: '200px',
          background: 'radial-gradient(circle at top right, rgba(0,229,255,0.05) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Manrope', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' }}>
            Current Price
          </div>
          <div className="font-mono glow-cyan" style={{
            fontSize: '40px', fontWeight: 700, color: 'var(--cyan)',
            lineHeight: 1, letterSpacing: '-0.02em',
          }}>
            {fmt(price, decimals)}
          </div>
          {priceChange !== null && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              marginTop: '8px', fontSize: '13px', fontFamily: 'Manrope', fontWeight: 600,
              color: priceChange >= 0 ? 'var(--green)' : 'var(--red)',
            }}>
              {priceChange >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}% (30d)
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Manrope', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '4px' }}>
            Last Updated
          </div>
          <div className="font-mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
            {realtime?.date?.split('T')[0] ?? realtime?.timestamp?.split('T')[0] ?? '—'}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', fontFamily: 'Manrope' }}>
            {realtime?.source === 'realtime' ? 'Spark streaming' : 'Batch fallback'}
          </div>
        </div>
      </div>

      {/* Metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }}>
        <StatCard
          label="24h High"
          value={fmt(realtime?.daily_high, decimals)}
          valueColor="var(--green)"
          sub="Intraday maximum"
        />
        <StatCard
          label="24h Low"
          value={fmt(realtime?.daily_low, decimals)}
          valueColor="var(--red)"
          sub="Intraday minimum"
        />
        <StatCard
          label="Volume"
          value={realtime?.avg_volume != null
            ? (realtime.avg_volume > 1e9
              ? `$${(realtime.avg_volume / 1e9).toFixed(2)}B`
              : `$${(realtime.avg_volume / 1e6).toFixed(1)}M`)
            : '—'}
          sub="24h trading volume"
        />
      </div>

      {/* Chart */}
      <div className="card" style={{ padding: '20px', marginBottom: '16px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: '4px',
        }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Manrope' }}>
            30-Day Price History
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '11px', fontFamily: 'Manrope' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '20px', height: '2px', background: C.cyan, borderRadius: '1px' }} />
              <span style={{ color: 'var(--text-secondary)' }}>Closing Price</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '20px', height: '2px', background: C.gold, borderRadius: '1px' }} />
              <span style={{ color: 'var(--text-secondary)' }}>SMA-20</span>
            </div>
          </div>
        </div>
        {historical.length > 0 ? (
          <ReactApexChart
            // @ts-ignore
            options={chartOptions}
            series={chartSeries}
            type="line"
            height={320}
          />
        ) : (
          <div style={{ height: '320px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontFamily: 'Manrope', fontSize: '13px' }}>
            No historical data available
          </div>
        )}
      </div>

      {/* Data table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'Manrope' }}>
            Recent Daily Records
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Manrope' }}>
            Last 20 days · newest first
          </div>
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
                  <span className="font-mono" style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                    {d.date.split('T')[0]}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className="font-mono" style={{ color: 'var(--cyan)', fontWeight: 700, fontSize: '13px' }}>
                    {fmt(d.avg_close, decimals)}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className="font-mono" style={{ color: 'var(--green)', fontSize: '12px' }}>
                    {d.daily_high != null ? fmt(d.daily_high, decimals) : '—'}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className="font-mono" style={{ color: 'var(--red)', fontSize: '12px' }}>
                    {d.daily_low != null ? fmt(d.daily_low, decimals) : '—'}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className="font-mono" style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                    {d.avg_volume != null
                      ? d.avg_volume > 1e9
                        ? `${(d.avg_volume / 1e9).toFixed(2)}B`
                        : `${(d.avg_volume / 1e6).toFixed(1)}M`
                      : '—'}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className="font-mono" style={{ color: d.sma_20 != null ? 'var(--gold)' : 'var(--text-muted)', fontSize: '12px' }}>
                    {d.sma_20 != null ? fmt(d.sma_20, decimals) : '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
