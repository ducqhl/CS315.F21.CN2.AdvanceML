import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, ComposedChart, LineChart, BarChart,
  Line, Bar, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, Cell,
} from 'recharts';
import { BarChart2 } from 'lucide-react';
import { fetchTechnical } from '../api/client';

interface Props { coin: 'bitcoin' | 'dogecoin' }

type Timeframe = '1M' | '3M' | '6M' | '1Y';
type OverlayKey = 'ma20' | 'ma50' | 'bb';

const TF_DAYS: Record<Timeframe, number> = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365 };

function fmtPrice(v: number, coin: string) {
  return coin === 'bitcoin'
    ? `$${(v / 1000).toFixed(1)}k`
    : `$${v.toFixed(5)}`;
}

const ChartTooltip = ({ active, payload, label, coin }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  coin: string;
}) => {
  if (!active || !payload?.length) return null;
  const dec = coin === 'bitcoin' ? 2 : 6;
  return (
    <div className="chart-tooltip">
      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '5px', fontFamily: 'IBM Plex Mono' }}>{label}</div>
      {payload.map((p, i) => p.value != null && (
        <div key={i} style={{ display: 'flex', gap: '7px', alignItems: 'center', marginBottom: '2px' }}>
          <div style={{ width: '7px', height: '7px', borderRadius: '2px', background: p.color }} />
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flex: 1, fontFamily: 'Plus Jakarta Sans' }}>{p.name}</span>
          <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-primary)' }}>
            {`$${p.value.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`}
          </span>
        </div>
      ))}
    </div>
  );
};

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

const MacdTooltip = ({ active, payload, label, coin }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; coin: string }) => {
  if (!active || !payload?.length) return null;
  const dec = coin === 'bitcoin' ? 2 : 6;
  return (
    <div className="chart-tooltip">
      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '5px', fontFamily: 'IBM Plex Mono' }}>{label}</div>
      {payload.map((p, i) => p.value != null && (
        <div key={i} style={{ display: 'flex', gap: '7px', alignItems: 'center', marginBottom: '2px' }}>
          <div style={{ width: '7px', height: '7px', borderRadius: '2px', background: p.color }} />
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flex: 1, fontFamily: 'Plus Jakarta Sans' }}>{p.name}</span>
          <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-primary)' }}>
            {p.value.toFixed(dec)}
          </span>
        </div>
      ))}
    </div>
  );
};

export default function TechnicalPage({ coin }: Props) {
  const [timeframe, setTimeframe] = useState<Timeframe>('3M');
  const [overlays, setOverlays]   = useState<Record<OverlayKey, boolean>>({ ma20: true, ma50: true, bb: false });

  const symbol   = coin === 'bitcoin' ? 'BTC' : 'DOGE';
  const decimals = coin === 'bitcoin' ? 2 : 6;

  const { data: rawData = [], isLoading, error } = useQuery({
    queryKey: ['technical', coin, TF_DAYS[timeframe]],
    queryFn:  () => fetchTechnical(coin, TF_DAYS[timeframe]),
    staleTime: 300_000,
  });

  const data = useMemo(() =>
    rawData.map(d => ({
      date:  d.date.split('T')[0],
      close: d.avg_close,
      sma20: d.sma_20 ?? null,
      sma50: d.sma_50 ?? null,
      bbUp:  d.bb_upper ?? null,
      bbLo:  d.bb_lower ?? null,
      bbMid: d.bb_middle ?? null,
      rsi:   d.rsi    ?? null,
      macd:  d.macd   ?? null,
      sig:   d.macd_signal    ?? null,
      hist:  d.macd_histogram ?? null,
      vol:   d.avg_volume ?? null,
    })),
    [rawData]
  );

  const latestRsi = useMemo(() => {
    const pts = data.filter(d => d.rsi != null);
    return pts.length ? pts[pts.length - 1].rsi : null;
  }, [data]);

  const xInterval = Math.max(1, Math.floor(data.length / 8));
  const yWidth    = coin === 'bitcoin' ? 52 : 68;

  const toggleOverlay = (k: OverlayKey) =>
    setOverlays(p => ({ ...p, [k]: !p[k] }));

  if (isLoading) {
    return (
      <div>
        <div className="skeleton" style={{ height: '32px', width: '220px', borderRadius: '8px', marginBottom: '28px' }} />
        <div className="skeleton" style={{ height: '380px', borderRadius: '12px', marginBottom: '12px' }} />
        <div className="skeleton" style={{ height: '140px', borderRadius: '12px', marginBottom: '12px' }} />
        <div className="skeleton" style={{ height: '140px', borderRadius: '12px' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--down)', fontFamily: 'Plus Jakarta Sans' }}>
        <BarChart2 size={32} style={{ marginBottom: '12px', opacity: 0.4 }} />
        <div>Error loading technical data</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 className="font-display" style={{ margin: 0, fontSize: '22px', color: 'var(--text-primary)' }}>
            Technical Analysis
          </h1>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px', fontFamily: 'Plus Jakarta Sans' }}>
            {symbol} · Price · MA overlays · Bollinger Bands · RSI(14) · MACD
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          {(['1M', '3M', '6M', '1Y'] as Timeframe[]).map(tf => (
            <button key={tf} onClick={() => setTimeframe(tf)}
              className={`btn-ghost ${timeframe === tf ? 'active' : ''}`}
              style={{ padding: '5px 12px', fontSize: '11px' }}>
              {tf}
            </button>
          ))}
          <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />
          {([
            ['ma20', 'MA20', 'var(--warn)'],
            ['ma50', 'MA50', 'var(--purple)'],
            ['bb',   'BB',   'var(--down)'],
          ] as [OverlayKey, string, string][]).map(([k, label, color]) => (
            <button key={k} onClick={() => toggleOverlay(k)}
              className="btn-ghost"
              style={{
                padding: '5px 10px', fontSize: '11px',
                borderColor: overlays[k] ? color : 'var(--border)',
                color: overlays[k] ? color : 'var(--text-secondary)',
                background: overlays[k] ? `${color}18` : 'transparent',
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* RSI status pill */}
      {latestRsi != null && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          padding: '5px 12px', borderRadius: '7px', marginBottom: '14px',
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
            Current RSI:
          </span>
          <span className="font-mono" style={{
            fontSize: '13px', fontWeight: 500,
            color: latestRsi >= 70 ? 'var(--down)' : latestRsi <= 30 ? 'var(--up)' : 'var(--accent-light)',
          }}>
            {Number(latestRsi).toFixed(1)}
            {latestRsi >= 70 && <span style={{ fontSize: '11px', marginLeft: '6px', opacity: 0.8 }}>Overbought</span>}
            {latestRsi <= 30 && <span style={{ fontSize: '11px', marginLeft: '6px', opacity: 0.8 }}>Oversold</span>}
          </span>
        </div>
      )}

      {/* Main price chart */}
      <div className="card" style={{ padding: '20px', marginBottom: '10px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans', marginBottom: '14px' }}>
          Price {overlays.ma20 ? '· MA20' : ''}{overlays.ma50 ? ' · MA50' : ''}{overlays.bb ? ' · Bollinger Bands' : ''}
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="techGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.12} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false}
              tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
              tickFormatter={v => v.slice(5)} interval={xInterval} />
            <YAxis tickLine={false} axisLine={false} width={yWidth}
              tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
              tickFormatter={v => fmtPrice(v, coin)} />
            <Tooltip content={<ChartTooltip coin={coin} />} />
            <Area type="monotone" dataKey="close" name="Close"
              stroke="var(--accent-light)" strokeWidth={2} fill="url(#techGrad)" dot={false} />
            {overlays.ma20 && (
              <Line type="monotone" dataKey="sma20" name="MA 20"
                stroke="var(--warn)" strokeWidth={1.5} strokeDasharray="4 2" dot={false} connectNulls />
            )}
            {overlays.ma50 && (
              <Line type="monotone" dataKey="sma50" name="MA 50"
                stroke="var(--purple)" strokeWidth={1.5} strokeDasharray="4 2" dot={false} connectNulls />
            )}
            {overlays.bb && (
              <>
                <Line type="monotone" dataKey="bbUp" name="BB Upper"
                  stroke="var(--down)" strokeWidth={1} strokeDasharray="3 3" dot={false} connectNulls />
                <Line type="monotone" dataKey="bbLo" name="BB Lower"
                  stroke="var(--up)" strokeWidth={1} strokeDasharray="3 3" dot={false} connectNulls />
                <Line type="monotone" dataKey="bbMid" name="BB Mid"
                  stroke="rgba(255,255,255,0.2)" strokeWidth={1} dot={false} connectNulls />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* RSI chart */}
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
        {data.some(d => d.rsi != null) ? (
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

      {/* MACD chart */}
      {data.some(d => d.macd != null) && (
        <div className="card" style={{ padding: '16px 20px', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans' }}>
              MACD (12, 26, 9)
            </div>
            <div style={{ display: 'flex', gap: '14px', fontSize: '11px', fontFamily: 'Plus Jakarta Sans' }}>
              {[
                { color: 'var(--accent-light)', label: 'MACD', dash: false },
                { color: 'var(--warn)', label: 'Signal', dash: true },
              ].map(({ color, label, dash }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke={color} strokeWidth="1.5" strokeDasharray={dash ? '4 2' : undefined} /></svg>
                  <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={130}>
            <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false}
                tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
                tickFormatter={v => v.slice(5)} interval={xInterval} />
              <YAxis tickLine={false} axisLine={false} width={yWidth}
                tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
                tickFormatter={v => v.toFixed(decimals > 2 ? 4 : 0)} />
              <Tooltip content={<MacdTooltip coin={coin} />} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
              <Bar dataKey="hist" name="Histogram" maxBarSize={6}>
                {data.map((d, i) => (
                  <Cell key={i} fill={(d.hist ?? 0) >= 0 ? 'var(--up)' : 'var(--down)'} fillOpacity={0.6} />
                ))}
              </Bar>
              <Line type="monotone" dataKey="macd" name="MACD"
                stroke="var(--accent-light)" strokeWidth={1.5} dot={false} connectNulls />
              <Line type="monotone" dataKey="sig" name="Signal"
                stroke="var(--warn)" strokeWidth={1.5} strokeDasharray="4 2" dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Volume chart */}
      {data.some(d => d.vol != null) && (
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
                tickFormatter={v => v > 1e9 ? `${(v/1e9).toFixed(0)}B` : v > 1e6 ? `${(v/1e6).toFixed(0)}M` : String(v)} />
              <Bar dataKey="vol" name="Volume" fill="rgba(99,102,241,0.3)" maxBarSize={8} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
