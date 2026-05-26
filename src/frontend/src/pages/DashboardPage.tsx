import { useEffect, useState, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, Minus, Clock, Cpu, Wifi, WifiOff,
} from 'lucide-react';
import {
  fetchStats, fetchPredictions, fetchRealtime, fetchHistorical,
  fetchInferenceStatus,
} from '../api/client';
import type {
  StatsResponse, PredictionsResponse, RealtimeResponse, HistoricalPoint,
  InferenceStatusResponse,
} from '../api/client';
import { Sparkline } from '../components/LightweightChart';
import type { AreaPoint } from '../components/LightweightChart';

interface Props {
  coin: 'bitcoin' | 'dogecoin';
}

function formatPrice(p: number | null | undefined, decimals = 2) {
  if (p == null) return '—';
  return `$${p.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

function timeAgo(iso: string | undefined): string {
  if (!iso) return 'never';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function inferenceStatusColor(status: string | undefined, lastRun: string | undefined): 'green' | 'amber' | 'red' {
  if (status === 'error') return 'red';
  if (!lastRun) return 'red';
  const ageMin = (Date.now() - new Date(lastRun).getTime()) / 60000;
  if (ageMin < 6) return 'green';
  if (ageMin < 15) return 'amber';
  return 'red';
}

export default function DashboardPage({ coin }: Props) {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [btcPrediction, setBtcPrediction] = useState<PredictionsResponse | null>(null);
  const [dogePrediction, setDogePrediction] = useState<PredictionsResponse | null>(null);
  const [btcRealtime, setBtcRealtime] = useState<RealtimeResponse | null>(null);
  const [dogeRealtime, setDogeRealtime] = useState<RealtimeResponse | null>(null);
  const [btcHistory, setBtcHistory] = useState<HistoricalPoint[]>([]);
  const [dogeHistory, setDogeHistory] = useState<HistoricalPoint[]>([]);
  const [inferenceStatus, setInferenceStatus] = useState<InferenceStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () => {
      Promise.allSettled([
        fetchStats(),
        fetchPredictions('bitcoin'),
        fetchPredictions('dogecoin'),
        fetchRealtime('bitcoin'),
        fetchRealtime('dogecoin'),
        fetchHistorical('bitcoin', 30),
        fetchHistorical('dogecoin', 30),
        fetchInferenceStatus(),
      ]).then(results => {
        if (results[0].status === 'fulfilled') setStats(results[0].value);
        if (results[1].status === 'fulfilled') setBtcPrediction(results[1].value);
        if (results[2].status === 'fulfilled') setDogePrediction(results[2].value);
        if (results[3].status === 'fulfilled') setBtcRealtime(results[3].value);
        if (results[4].status === 'fulfilled') setDogeRealtime(results[4].value);
        if (results[5].status === 'fulfilled') setBtcHistory(results[5].value);
        if (results[6].status === 'fulfilled') setDogeHistory(results[6].value);
        if (results[7].status === 'fulfilled') setInferenceStatus(results[7].value);
        setLoading(false);
      });
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  const btcSparkline = useMemo<AreaPoint[]>(
    () => btcHistory.map(d => ({ time: d.date.split('T')[0], value: d.avg_close })),
    [btcHistory]
  );
  const dogeSparkline = useMemo<AreaPoint[]>(
    () => dogeHistory.map(d => ({ time: d.date.split('T')[0], value: d.avg_close })),
    [dogeHistory]
  );

  const activePred = coin === 'bitcoin' ? btcPrediction : dogePrediction;
  const outlook = useMemo(() => {
    if (!activePred?.predictions) return null;
    const up = activePred.predictions.filter(p => p.direction === 'UP').length;
    const down = activePred.predictions.filter(p => p.direction === 'DOWN').length;
    if (up > down) return { label: 'BULLISH', color: 'var(--green)', Icon: TrendingUp, count: `${up}/7` };
    if (down > up) return { label: 'BEARISH', color: 'var(--red)', Icon: TrendingDown, count: `${down}/7` };
    return { label: 'NEUTRAL', color: 'var(--gold)', Icon: Minus, count: '—' };
  }, [activePred]);

  const symbol = coin === 'bitcoin' ? 'BTC' : 'DOGE';
  const decimals = coin === 'bitcoin' ? 2 : 6;
  const btcPrice = btcRealtime?.price ?? btcRealtime?.avg_close;
  const dogePrice = dogeRealtime?.price ?? dogeRealtime?.avg_close;
  const btcJob = inferenceStatus?.jobs?.['BTC'];
  const dogeJob = inferenceStatus?.jobs?.['DOGE'];

  if (loading) {
    return (
      <div style={{ padding: '32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
          {[1, 2].map(i => (
            <div key={i} className="skeleton" style={{ height: '160px', borderRadius: '12px' }} />
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="skeleton" style={{ height: '100px', borderRadius: '12px' }} />
          ))}
        </div>
        <div className="skeleton" style={{ height: '320px', borderRadius: '12px' }} />
      </div>
    );
  }

  return (
    <div style={{ padding: '0' }}>
      {/* Page header */}
      <div style={{ marginBottom: '28px' }}>
        <h1 className="font-display" style={{
          margin: 0, fontSize: '18px', fontWeight: 700,
          color: 'var(--text-primary)', letterSpacing: '0.06em',
        }}>
          MARKET OVERVIEW
        </h1>
        <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '4px', fontFamily: 'Manrope, sans-serif' }}>
          Real-time prices · LSTM predictions · Inference engine status
        </div>
      </div>

      {/* Price cards row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        {[
          {
            symbol: 'BTC', name: 'Bitcoin', price: btcPrice,
            sparkline: btcSparkline, decimals: 2,
            pred: btcPrediction, realtime: btcRealtime,
            job: btcJob,
          },
          {
            symbol: 'DOGE', name: 'Dogecoin', price: dogePrice,
            sparkline: dogeSparkline, decimals: 6,
            pred: dogePrediction, realtime: dogeRealtime,
            job: dogeJob,
          },
        ].map(({ symbol: sym, name, price, sparkline, decimals: dec, realtime }) => {
          const isLive = realtime?.source === 'realtime';
          return (
            <div key={sym} className="card" style={{ padding: '20px', overflow: 'hidden', position: 'relative' }}>
              {/* Glow accent top-right */}
              <div style={{
                position: 'absolute', top: 0, right: 0,
                width: '120px', height: '120px',
                background: 'radial-gradient(circle at top right, rgba(0,229,255,0.06) 0%, transparent 70%)',
                pointerEvents: 'none',
              }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span className="font-display" style={{
                      fontSize: '13px', fontWeight: 700, color: 'var(--cyan)', letterSpacing: '0.08em',
                    }}>
                      {sym}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Manrope' }}>
                      {name}
                    </span>
                  </div>
                  <div className="font-mono" style={{
                    fontSize: '26px', fontWeight: 700, color: 'var(--text-primary)',
                    lineHeight: 1, letterSpacing: '-0.02em',
                  }}>
                    {formatPrice(price, dec)}
                  </div>
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  padding: '4px 10px', borderRadius: '20px', fontSize: '10px',
                  background: isLive ? 'var(--green-10)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isLive ? 'rgba(0,240,160,0.25)' : 'var(--border)'}`,
                  color: isLive ? 'var(--green)' : 'var(--text-secondary)',
                  fontFamily: 'Manrope',
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}>
                  {isLive ? <Wifi size={10} /> : <WifiOff size={10} />}
                  {isLive ? 'LIVE' : 'BATCH'}
                </div>
              </div>

              <div style={{ height: '60px', marginLeft: '-4px', marginRight: '-4px' }}>
                <Sparkline data={sparkline} height={60} positive />
              </div>
            </div>
          );
        })}
      </div>

      {/* Prediction summary row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '16px' }}>
        {/* Next-day prediction */}
        <div className="metric-card">
          <div className="metric-label">Next-Day Forecast · {symbol}</div>
          <div className="metric-value" style={{ color: 'var(--cyan)', fontSize: '20px' }}>
            {formatPrice(activePred?.next_day_price, decimals)}
          </div>
          {activePred?.model_version && (
            <div className="metric-sub">{activePred.model_version}</div>
          )}
        </div>

        {/* 7-day outlook */}
        <div className="metric-card" style={{
          borderColor: outlook ? `rgba(0,0,0,0)` : 'var(--border)',
          background: outlook ? `linear-gradient(135deg, var(--bg-card) 60%, ${outlook.color}08)` : 'var(--bg-card)',
        }}>
          <div className="metric-label">7-Day Outlook · {symbol}</div>
          {outlook ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <outlook.Icon size={20} color={outlook.color} />
              <span className="metric-value" style={{ color: outlook.color }}>
                {outlook.label}
              </span>
            </div>
          ) : (
            <div className="metric-value" style={{ color: 'var(--text-secondary)' }}>—</div>
          )}
          {outlook && (
            <div className="metric-sub">{outlook.count} days confirmed</div>
          )}
        </div>

        {/* Inference status */}
        <div className="metric-card">
          <div className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Cpu size={10} />
            Inference Engine
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
            {['BTC', 'DOGE'].map(sym => {
              const job = sym === 'BTC' ? btcJob : dogeJob;
              const dotColor = inferenceStatusColor(job?.status, job?.last_run_at);
              return (
                <div key={sym} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                  <div className={`pulse-dot ${dotColor}`} style={{ width: '7px', height: '7px', flexShrink: 0 }} />
                  <span className="font-mono" style={{ color: 'var(--cyan)', fontSize: '11px', fontWeight: 700, minWidth: '36px' }}>{sym}</span>
                  <span style={{ color: 'var(--text-secondary)', fontFamily: 'Manrope' }}>
                    {job?.last_run_at ? timeAgo(job.last_run_at) : 'no data'}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="metric-sub" style={{ marginTop: '6px' }}>
            <Clock size={9} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
            Every {inferenceStatus?.interval_seconds ?? 300}s
          </div>
        </div>
      </div>

      {/* System stats */}
      <div className="card" style={{ padding: '20px' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '14px', fontFamily: 'Manrope' }}>
          Collection Stats
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px' }}>
          {Object.entries(stats?.doc_counts ?? {}).map(([name, count]) => (
            <div key={name} style={{ textAlign: 'center' }}>
              <div className="font-mono" style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' }}>
                {count.toLocaleString()}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '4px', fontFamily: 'Manrope', letterSpacing: '0.04em' }}>
                {name.replace('_', ' ')}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
