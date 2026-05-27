import { useEffect, useState, useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, Clock, Cpu, Wifi, WifiOff } from 'lucide-react';
import {
  fetchStats, fetchPredictions, fetchRealtime, fetchHistorical, fetchInferenceStatus,
} from '../api/client';
import type {
  StatsResponse, PredictionsResponse, RealtimeResponse, HistoricalPoint, InferenceStatusResponse,
} from '../api/client';
import { Sparkline } from '../components/LightweightChart';
import type { AreaPoint } from '../components/LightweightChart';
import { Card, Badge, MetricCard, Skeleton } from '../components/ui';

interface Props { coin: 'bitcoin' | 'dogecoin' }

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

const dotColorMap: Record<string, string> = {
  green: '#00F0A0',
  amber: '#FFB020',
  red:   '#FF3864',
};

export default function DashboardPage({ coin }: Props) {
  const [stats, setStats]                     = useState<StatsResponse | null>(null);
  const [btcPrediction, setBtcPrediction]     = useState<PredictionsResponse | null>(null);
  const [dogePrediction, setDogePrediction]   = useState<PredictionsResponse | null>(null);
  const [btcRealtime, setBtcRealtime]         = useState<RealtimeResponse | null>(null);
  const [dogeRealtime, setDogeRealtime]       = useState<RealtimeResponse | null>(null);
  const [btcHistory, setBtcHistory]           = useState<HistoricalPoint[]>([]);
  const [dogeHistory, setDogeHistory]         = useState<HistoricalPoint[]>([]);
  const [inferenceStatus, setInferenceStatus] = useState<InferenceStatusResponse | null>(null);
  const [loading, setLoading]                 = useState(true);

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

  const btcSparkline  = useMemo<AreaPoint[]>(() => btcHistory.map(d => ({ time: d.date.split('T')[0], value: d.avg_close })), [btcHistory]);
  const dogeSparkline = useMemo<AreaPoint[]>(() => dogeHistory.map(d => ({ time: d.date.split('T')[0], value: d.avg_close })), [dogeHistory]);

  const activePred = coin === 'bitcoin' ? btcPrediction : dogePrediction;
  const outlook = useMemo(() => {
    if (!activePred?.predictions) return null;
    const up   = activePred.predictions.filter(p => p.direction === 'UP').length;
    const down = activePred.predictions.filter(p => p.direction === 'DOWN').length;
    if (up > down)   return { label: 'BULLISH', color: '#00F0A0', Icon: TrendingUp,   count: `${up}/7` };
    if (down > up)   return { label: 'BEARISH', color: '#FF3864', Icon: TrendingDown, count: `${down}/7` };
    return               { label: 'NEUTRAL', color: '#FFB020', Icon: Minus,         count: '—' };
  }, [activePred]);

  const symbol   = coin === 'bitcoin' ? 'BTC' : 'DOGE';
  const decimals = coin === 'bitcoin' ? 2 : 6;
  const btcPrice  = btcRealtime?.price  ?? btcRealtime?.avg_close;
  const dogePrice = dogeRealtime?.price ?? dogeRealtime?.avg_close;
  const btcJob  = inferenceStatus?.jobs?.['BTC'];
  const dogeJob = inferenceStatus?.jobs?.['DOGE'];

  if (loading) {
    return (
      <div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          {[1, 2].map(i => <Skeleton key={i} style={{ height: '160px', borderRadius: '12px' }} />)}
        </div>
        <div className="grid grid-cols-3 gap-4 mb-4">
          {[1, 2, 3].map(i => <Skeleton key={i} style={{ height: '100px', borderRadius: '12px' }} />)}
        </div>
        <Skeleton style={{ height: '120px', borderRadius: '12px' }} />
      </div>
    );
  }

  return (
    <div>
      {/* Page header */}
      <div className="mb-7">
        <h1 className="font-display text-lg font-bold text-text-primary tracking-wider m-0">MARKET OVERVIEW</h1>
        <p className="text-text-secondary text-xs mt-1 font-body">
          Real-time prices · LSTM predictions · Inference engine status
        </p>
      </div>

      {/* Price cards row */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        {[
          { symbol: 'BTC', name: 'Bitcoin',  price: btcPrice,  sparkline: btcSparkline,  decimals: 2,  realtime: btcRealtime  },
          { symbol: 'DOGE', name: 'Dogecoin', price: dogePrice, sparkline: dogeSparkline, decimals: 6,  realtime: dogeRealtime },
        ].map(({ symbol: sym, name, price, sparkline, decimals: dec, realtime }) => {
          const isLive = realtime?.source === 'realtime';
          return (
            <Card key={sym} className="p-5 overflow-hidden relative">
              {/* Glow corner */}
              <div
                className="absolute top-0 right-0 w-32 h-32 pointer-events-none"
                style={{ background: 'radial-gradient(circle at top right, rgba(0,229,255,0.06) 0%, transparent 70%)' }}
              />

              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-display text-[13px] font-bold text-cyan tracking-widest">{sym}</span>
                    <span className="text-[11px] text-text-secondary font-body">{name}</span>
                  </div>
                  <div className="font-mono text-[26px] font-bold text-text-primary leading-none tracking-tight">
                    {formatPrice(price, dec)}
                  </div>
                </div>
                <Badge variant={isLive ? 'live' : 'batch'}>
                  {isLive ? <Wifi size={9} /> : <WifiOff size={9} />}
                  {isLive ? 'LIVE' : 'BATCH'}
                </Badge>
              </div>

              <div style={{ height: '60px', marginLeft: '-4px', marginRight: '-4px' }}>
                <Sparkline data={sparkline} height={60} positive />
              </div>
            </Card>
          );
        })}
      </div>

      {/* Prediction + inference row */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {/* Next-day prediction */}
        <MetricCard
          label={`Next-Day Forecast · ${symbol}`}
          value={formatPrice(activePred?.next_day_price, decimals)}
          valueColor="var(--cyan)"
          sub={activePred?.model_version ?? undefined}
        />

        {/* 7-day outlook */}
        <Card
          variant="highlight"
          accent={outlook?.label === 'BULLISH' ? 'green' : outlook?.label === 'BEARISH' ? 'red' : 'gold'}
          className="p-5"
        >
          <div className="metric-label text-[10px] font-semibold text-text-secondary uppercase tracking-widest font-body mb-2.5">
            7-Day Outlook · {symbol}
          </div>
          {outlook ? (
            <>
              <div className="flex items-center gap-2.5 mb-1">
                <outlook.Icon size={20} color={outlook.color} />
                <span className="font-mono text-[20px] font-bold leading-none" style={{ color: outlook.color }}>
                  {outlook.label}
                </span>
              </div>
              <div className="text-[11px] text-text-secondary font-body mt-1.5">{outlook.count} days confirmed</div>
            </>
          ) : (
            <div className="font-mono text-[20px] font-bold text-text-secondary">—</div>
          )}
        </Card>

        {/* Inference engine */}
        <Card className="p-5">
          <div className="flex items-center gap-1.5 mb-3">
            <Cpu size={10} className="text-text-secondary" />
            <span className="metric-label text-[10px] font-semibold text-text-secondary uppercase tracking-widest font-body">
              Inference Engine
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {(['BTC', 'DOGE'] as const).map(sym => {
              const job      = sym === 'BTC' ? btcJob : dogeJob;
              const dotColor = inferenceStatusColor(job?.status, job?.last_run_at);
              return (
                <div key={sym} className="flex items-center gap-2 text-xs">
                  <div
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse-slow"
                    style={{ background: dotColorMap[dotColor] }}
                  />
                  <span className="font-mono text-[11px] font-bold text-cyan min-w-[36px]">{sym}</span>
                  <span className="text-text-secondary font-body text-[11px]">
                    {job?.last_run_at ? timeAgo(job.last_run_at) : 'no data'}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5 mt-3 text-[10px] text-text-secondary font-body">
            <Clock size={9} />
            Every {inferenceStatus?.interval_seconds ?? 300}s
          </div>
        </Card>
      </div>

      {/* Collection stats */}
      <Card className="p-5">
        <div className="text-[11px] font-semibold text-text-secondary uppercase tracking-widest font-body mb-4">
          Collection Stats
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Object.keys(stats?.doc_counts ?? {}).length || 5}, 1fr)` }}>
          {Object.entries(stats?.doc_counts ?? {}).map(([name, count]) => (
            <div key={name} className="text-center">
              <div className="font-mono text-[20px] font-bold text-text-primary">{count.toLocaleString()}</div>
              <div className="text-[10px] text-text-secondary mt-1 font-body tracking-wide">
                {name.replace('_', ' ')}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
