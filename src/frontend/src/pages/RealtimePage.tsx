import { useEffect, useState, useMemo } from 'react';
import { TrendingUp, TrendingDown, Activity, Wifi, WifiOff } from 'lucide-react';
import { fetchRealtime, fetchTechnical } from '../api/client';
import type { RealtimeResponse, HistoricalPoint } from '../api/client';
import { C } from '../components/apexTheme';
import {
  CandlestickChart,
  type CandlePoint,
  type SmaPoint,
  type BBBands,
} from '../components/LightweightChart';

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

type OverlayKey = 'ma20' | 'ma50' | 'bb';

const OVERLAY_LABELS: Record<OverlayKey, { label: string; color: string }> = {
  ma20: { label: 'MA 20', color: C.gold },
  ma50: { label: 'MA 50', color: '#8B5CF6' },
  bb:   { label: 'BB',    color: '#FF3864' },
};

export default function RealtimePage({ coin }: Props) {
  const [realtime, setRealtime]   = useState<RealtimeResponse | null>(null);
  const [technical, setTechnical] = useState<HistoricalPoint[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [overlays, setOverlays]   = useState<Record<OverlayKey, boolean>>({
    ma20: true,
    ma50: true,
    bb: false,
  });

  useEffect(() => {
    const load = () => {
      setLoading(true);
      Promise.all([
        fetchRealtime(coin).catch(() => null),
        fetchTechnical(coin, 90),
      ])
        .then(([rt, tech]) => {
          setRealtime(rt);
          setTechnical(tech);
          setError(null);
        })
        .catch(e => setError(String(e)))
        .finally(() => setLoading(false));
    };
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

  const fmt = (n: number | null | undefined, dec = 2) =>
    n != null ? `$${n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}` : '—';

  const priceChange = useMemo(() => {
    if (technical.length < 2) return null;
    const first = technical[0].avg_close;
    const last  = technical[technical.length - 1].avg_close;
    return ((last - first) / first) * 100;
  }, [technical]);

  // ── Derived chart data ──────────────────────────────────────────────────────
  const { candleData, sma20Data, sma50Data, bbData } = useMemo(() => {
    const candleData: CandlePoint[] = technical.map(d => ({
      time:  d.date.split('T')[0],
      open:  d.open  ?? d.avg_close,
      high:  d.high  ?? d.daily_high ?? d.avg_close,
      low:   d.low   ?? d.daily_low  ?? d.avg_close,
      close: d.close ?? d.avg_close,
    }));

    const sma20Data: SmaPoint[] = technical
      .filter(d => d.sma_20 != null)
      .map(d => ({ time: d.date.split('T')[0], value: d.sma_20! }));

    const sma50Data: SmaPoint[] = technical
      .filter(d => d.sma_50 != null)
      .map(d => ({ time: d.date.split('T')[0], value: d.sma_50! }));

    const bbData: BBBands = {
      upper:  technical.filter(d => d.bb_upper  != null).map(d => ({ time: d.date.split('T')[0], value: d.bb_upper!  })),
      middle: technical.filter(d => d.bb_middle != null).map(d => ({ time: d.date.split('T')[0], value: d.bb_middle! })),
      lower:  technical.filter(d => d.bb_lower  != null).map(d => ({ time: d.date.split('T')[0], value: d.bb_lower!  })),
    };

    return { candleData, sma20Data, sma50Data, bbData };
  }, [technical]);

  // Table rows — last 20 sorted newest first
  const tableRows = useMemo(() => [...technical].reverse().slice(0, 20), [technical]);

  const toggleOverlay = (key: OverlayKey) =>
    setOverlays(prev => ({ ...prev, [key]: !prev[key] }));

  if (loading) {
    return (
      <div style={{ padding: '0' }}>
        <div className="skeleton" style={{ height: '36px', width: '200px', borderRadius: '8px', marginBottom: '28px' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '20px' }}>
          {[1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ height: '100px', borderRadius: '12px' }} />)}
        </div>
        <div className="skeleton" style={{ height: '400px', borderRadius: '12px' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--red)', fontFamily: 'Manrope, sans-serif', fontSize: '14px' }}>
        <Activity size={32} style={{ marginBottom: '12px', opacity: 0.5 }} />
        <div>Failed to load data</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '6px' }}>{error}</div>
      </div>
    );
  }

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '28px' }}>
        <div>
          <div className="font-display" style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.06em', marginBottom: '6px' }}>
            REAL-TIME PRICES
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="font-display" style={{ fontSize: '13px', color: 'var(--cyan)', letterSpacing: '0.1em' }}>{symbol}</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '12px', fontFamily: 'Manrope' }}>Latest market data</span>
            <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '10px', fontWeight: 600, background: 'rgba(0,229,255,0.07)', border: '1px solid rgba(0,229,255,0.18)', color: 'var(--cyan)', fontFamily: 'Space Mono', letterSpacing: '0.04em' }}>
              90-DAY · AUTO-REFRESH 5MIN
            </span>
          </div>
        </div>

        {/* Live badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 14px', borderRadius: '24px', background: isLive ? 'var(--green-10)' : 'rgba(255,255,255,0.03)', border: `1px solid ${isLive ? 'rgba(0,240,160,0.25)' : 'var(--border)'}`, color: isLive ? 'var(--green)' : 'var(--text-secondary)', fontSize: '11px', fontWeight: 700, fontFamily: 'Manrope', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {isLive ? <Wifi size={12} /> : <WifiOff size={12} />}
          {isLive && <div className="pulse-dot green" style={{ width: '6px', height: '6px' }} />}
          {isLive ? 'LIVE STREAM' : 'BATCH DATA'}
        </div>
      </div>

      {/* ── Price hero ─────────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '28px 32px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'linear-gradient(135deg, var(--bg-card) 60%, rgba(0,229,255,0.03))', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, right: 0, width: '200px', height: '200px', background: 'radial-gradient(circle at top right, rgba(0,229,255,0.05) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Manrope', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' }}>Current Price</div>
          <div className="font-mono glow-cyan" style={{ fontSize: '40px', fontWeight: 700, color: 'var(--cyan)', lineHeight: 1, letterSpacing: '-0.02em' }}>{fmt(price, decimals)}</div>
          {priceChange !== null && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', marginTop: '8px', fontSize: '13px', fontFamily: 'Manrope', fontWeight: 600, color: priceChange >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {priceChange >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}% (90d)
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Manrope', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '4px' }}>Last Updated</div>
          <div className="font-mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
            {realtime?.date?.split('T')[0] ?? realtime?.timestamp?.split('T')[0] ?? '—'}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', fontFamily: 'Manrope' }}>
            {realtime?.source === 'realtime' ? 'Spark streaming' : 'Batch fallback'}
          </div>
        </div>
      </div>

      {/* ── Metric cards ────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }}>
        <StatCard label="24h High" value={fmt(realtime?.daily_high, decimals)} valueColor="var(--green)" sub="Intraday maximum" />
        <StatCard label="24h Low"  value={fmt(realtime?.daily_low, decimals)}  valueColor="var(--red)"   sub="Intraday minimum" />
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

      {/* ── Candlestick chart ───────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '20px', marginBottom: '16px' }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Manrope' }}>
            90-Day Candlestick Chart
          </div>

          {/* Overlay toggles */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {(Object.keys(OVERLAY_LABELS) as OverlayKey[]).map(key => {
              const { label, color } = OVERLAY_LABELS[key];
              const active = overlays[key];
              return (
                <button
                  key={key}
                  onClick={() => toggleOverlay(key)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    padding: '4px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '11px',
                    fontFamily: 'Space Mono, monospace', fontWeight: 700, letterSpacing: '0.04em',
                    border: `1px solid ${active ? color + '60' : 'var(--border)'}`,
                    background: active ? color + '15' : 'transparent',
                    color: active ? color : 'var(--text-secondary)',
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ width: '8px', height: '2px', background: active ? color : 'var(--border)', borderRadius: '1px', display: 'inline-block' }} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '16px', fontSize: '10px', fontFamily: 'Manrope', color: 'var(--text-secondary)', marginBottom: '10px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#00F0A0', borderRadius: '2px' }} /> Bullish
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#FF3864', borderRadius: '2px' }} /> Bearish
          </span>
          {overlays.ma20 && <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ display: 'inline-block', width: '14px', height: '2px', background: C.gold, borderRadius: '1px' }} /> MA 20</span>}
          {overlays.ma50 && <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ display: 'inline-block', width: '14px', height: '2px', background: '#8B5CF6', borderRadius: '1px' }} /> MA 50</span>}
          {overlays.bb   && <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ display: 'inline-block', width: '14px', height: '2px', background: '#FF386480', borderRadius: '1px', borderTop: '1px dashed #FF3864' }} /> Bollinger</span>}
        </div>

        {candleData.length > 0 ? (
          <CandlestickChart
            data={candleData}
            sma20={sma20Data}
            sma50={sma50Data}
            bb={bbData}
            showSma20={overlays.ma20}
            showSma50={overlays.ma50}
            showBB={overlays.bb}
            height={380}
          />
        ) : (
          <div style={{ height: '380px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontFamily: 'Manrope', fontSize: '13px' }}>
            No price data available
          </div>
        )}
      </div>

      {/* ── Data table ──────────────────────────────────────────────────────── */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'Manrope' }}>Recent Daily Records</div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Manrope' }}>Last 20 days · newest first</div>
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
                <td><span className="font-mono" style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{d.date.split('T')[0]}</span></td>
                <td style={{ textAlign: 'right' }}><span className="font-mono" style={{ color: 'var(--cyan)', fontWeight: 700, fontSize: '13px' }}>{fmt(d.avg_close, decimals)}</span></td>
                <td style={{ textAlign: 'right' }}><span className="font-mono" style={{ color: 'var(--green)', fontSize: '12px' }}>{d.daily_high != null ? fmt(d.daily_high, decimals) : '—'}</span></td>
                <td style={{ textAlign: 'right' }}><span className="font-mono" style={{ color: 'var(--red)', fontSize: '12px' }}>{d.daily_low != null ? fmt(d.daily_low, decimals) : '—'}</span></td>
                <td style={{ textAlign: 'right' }}>
                  <span className="font-mono" style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                    {d.avg_volume != null
                      ? d.avg_volume > 1e9 ? `${(d.avg_volume / 1e9).toFixed(2)}B` : `${(d.avg_volume / 1e6).toFixed(1)}M`
                      : '—'}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}><span className="font-mono" style={{ color: d.sma_20 != null ? 'var(--gold)' : 'var(--text-muted)', fontSize: '12px' }}>{d.sma_20 != null ? fmt(d.sma_20, decimals) : '—'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
