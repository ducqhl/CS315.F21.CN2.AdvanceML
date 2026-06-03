import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, TrendingDown, Minus, Brain, ChevronDown, ChevronUp,
  RefreshCw, Clock, CheckCircle, XCircle, Loader, Zap,
} from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import {
  fetchHistorical, fetchPredictions, fetchPredictionHistory,
  fetchModels, setActiveModel, triggerRetrain, fetchRetrainStatus,
} from '../api/client';
import type { PredictionPoint, RetrainJob } from '../api/client';

interface Props { coin: 'bitcoin' | 'dogecoin' }

const HORIZONS = [
  { value: 7,  label: 'H7',  days: '7-Day',  detail: 'Short-term momentum', historyDays: 30  },
  { value: 15, label: 'H15', days: '15-Day', detail: 'Medium-term trend',   historyDays: 90  },
  { value: 60, label: 'H60', days: '60-Day', detail: '6-Month context',     historyDays: 180 },
] as const;

function fmt(n: number | null | undefined, dec = 2) {
  if (n == null) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function DirectionBadge({ direction, prob }: { direction?: string; prob?: number }) {
  const pct = prob != null ? ` ${(prob * 100).toFixed(0)}%` : '';
  if (direction === 'UP')   return <span className="badge-up"><TrendingUp size={9} /> UP{pct}</span>;
  if (direction === 'DOWN') return <span className="badge-down"><TrendingDown size={9} /> DOWN{pct}</span>;
  return <span className="badge-flat"><Minus size={9} /> FLAT{pct}</span>;
}

function JobIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle size={13} color="var(--up)" />;
  if (status === 'failed')    return <XCircle size={13} color="var(--down)" />;
  if (status === 'running')   return <Loader size={13} color="var(--accent)" className="spin" />;
  return <Clock size={13} color="var(--warn)" />;
}

const ForecastTooltip = ({ active, payload, label, decimals }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  decimals: number;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '5px', fontFamily: 'IBM Plex Mono' }}>{label}</div>
      {payload.map((p, i) => p.value != null && (
        <div key={i} style={{ display: 'flex', gap: '7px', alignItems: 'center', marginBottom: '2px' }}>
          <div style={{ width: '7px', height: '7px', borderRadius: '2px', background: p.color }} />
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flex: 1, fontFamily: 'Plus Jakarta Sans' }}>{p.name}</span>
          <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-primary)' }}>{fmt(p.value, decimals)}</span>
        </div>
      ))}
    </div>
  );
};

export default function PredictionsPage({ coin }: Props) {
  const symbol   = coin === 'bitcoin' ? 'BTC' : 'DOGE';
  const decimals = coin === 'bitcoin' ? 2 : 6;
  const queryClient = useQueryClient();

  const [activeHorizon,   setActiveHorizon]   = useState<7 | 15 | 60>(7);
  const [switching,       setSwitching]        = useState(false);
  const [retrainLoading,  setRetrainLoading]   = useState(false);
  const [showHistory,     setShowHistory]      = useState(false);
  const [showRetrain,     setShowRetrain]      = useState(false);
  const [forecastPage,    setForecastPage]     = useState(1);
  const FORECAST_PAGE_SIZE = 7;
  const [toast,           setToast]            = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [retrainJobs,     setRetrainJobs]      = useState<RetrainJob[]>([]);

  const { data: history = [] } = useQuery({
    queryKey: ['historical', coin, 180],
    queryFn:  () => fetchHistorical(coin, 180),
    staleTime: 300_000,
  });

  const { data: models = [] } = useQuery({
    queryKey: ['ml-models', symbol],
    queryFn:  async () => {
      const r = await fetchModels(symbol);
      const active = r.models.find(m => m.is_active);
      if (active) setActiveHorizon(active.horizon as 7 | 15 | 60);
      return r.models;
    },
    staleTime: 60_000,
  });

  const { data: predictions, isLoading: loadingPred } = useQuery({
    queryKey: ['predictions', coin, activeHorizon],
    queryFn:  () => fetchPredictions(coin, activeHorizon),
    staleTime: 120_000,
  });

  const { data: predHistory = [] } = useQuery({
    queryKey: ['predictions-history', coin],
    queryFn:  () => fetchPredictionHistory(coin, 60),
    staleTime: 300_000,
  });

  // Polling for retrain jobs when panel is open
  useQuery({
    queryKey: ['retrain-jobs', symbol],
    queryFn:  async () => {
      const r = await fetchRetrainStatus(symbol);
      setRetrainJobs(r.jobs);
      return r.jobs;
    },
    enabled: showRetrain,
    refetchInterval: showRetrain ? 8_000 : false,
    staleTime: 0,
  });

  const showToast = useCallback((msg: string, type: 'ok' | 'err') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleHorizonSwitch = useCallback(async (h: 7 | 15 | 60) => {
    if (h === activeHorizon || switching) return;
    const entry = models.find(m => m.horizon === h);
    if (!entry?.model_exists) return;
    setSwitching(true);
    try {
      await setActiveModel(coin, h);
      setActiveHorizon(h);
      setForecastPage(1);
      await queryClient.invalidateQueries({ queryKey: ['predictions', coin] });
      showToast(`Active model set to H${h}`, 'ok');
    } catch {
      showToast('Failed to switch model', 'err');
    } finally {
      setSwitching(false);
    }
  }, [activeHorizon, coin, models, queryClient, showToast, switching]);

  const handleRetrain = useCallback(async (h: number) => {
    setRetrainLoading(true);
    try {
      const job = await triggerRetrain(coin, h);
      setRetrainJobs(prev => [job, ...prev.filter(j => j.job_id !== job.job_id)]);
      showToast(`Retrain queued for H${h}`, 'ok');
    } catch {
      showToast('Failed to queue retrain', 'err');
    } finally {
      setRetrainLoading(false);
    }
  }, [coin, showToast]);

  const activeHistoryDays = HORIZONS.find(h => h.value === activeHorizon)?.historyDays ?? 30;

  // Chart data: N-day history + forecast
  const chartData = useMemo(() => {
    const histPts = history.slice(-activeHistoryDays).map(d => ({
      date:     d.date.slice(0, 10),
      actual:   d.avg_close,
      forecast: null as number | null,
      isForecast: false,
    }));
    const fcstPts = (predictions?.predictions ?? []).map(p => ({
      date:       p.prediction_date.slice(0, 10),
      actual:     null as number | null,
      forecast:   p.predicted_price,
      isForecast: true,
    }));
    // Bridge: connect last history point to first forecast
    if (histPts.length && fcstPts.length) {
      fcstPts[0] = { ...fcstPts[0], actual: histPts[histPts.length - 1].actual };
    }
    return [...histPts, ...fcstPts];
  }, [history, predictions, activeHistoryDays]);

  const historicalMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const h of history) {
      map[h.date.slice(0, 10)] = h.avg_close;
    }
    return map;
  }, [history]);

  const todayIndex  = history.slice(-activeHistoryDays).length - 1;
  const todayDate   = chartData[todayIndex]?.date ?? null;

  const outlook = useMemo(() => {
    const preds = predictions?.predictions ?? [];
    const n = preds.length || 1;
    const up   = preds.filter(p => p.direction === 'UP').length;
    const down = preds.filter(p => p.direction === 'DOWN').length;
    const flat = preds.filter(p => p.direction === 'FLAT').length;
    if (up   > down && up   > flat) return { label: 'Bullish',  color: 'var(--up)',   Icon: TrendingUp,   count: `${up}/${n}` };
    if (down > up   && down > flat) return { label: 'Bearish',  color: 'var(--down)', Icon: TrendingDown, count: `${down}/${n}` };
    return                                 { label: 'Neutral',  color: 'var(--warn)', Icon: Minus,        count: `${flat}/${n}` };
  }, [predictions]);

  const allForecasts = predictions?.predictions ?? [];
  const totalPages = Math.max(1, Math.ceil(allForecasts.length / FORECAST_PAGE_SIZE));
  const visibleForecasts = allForecasts.slice(
    (forecastPage - 1) * FORECAST_PAGE_SIZE,
    forecastPage * FORECAST_PAGE_SIZE,
  );

  const periodLabel = `${activeHorizon}-Day`;

  return (
    <div style={{ position: 'relative' }}>
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            style={{
              position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
              padding: '11px 16px', borderRadius: '9px',
              background: toast.type === 'ok' ? 'var(--up-subtle)' : 'var(--down-subtle)',
              border: `1px solid ${toast.type === 'ok' ? 'var(--up-border)' : 'var(--down-border)'}`,
              color: toast.type === 'ok' ? 'var(--up)' : 'var(--down)',
              fontSize: '13px', fontWeight: 600, fontFamily: 'Plus Jakarta Sans',
              display: 'flex', alignItems: 'center', gap: '8px',
            }}
          >
            {toast.type === 'ok' ? <CheckCircle size={14} /> : <XCircle size={14} />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 className="font-display" style={{ margin: 0, fontSize: '22px', color: 'var(--text-primary)' }}>
            Predictions
          </h1>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px', fontFamily: 'Plus Jakarta Sans' }}>
            {symbol} · LSTM dual-head · {periodLabel} daily forecast
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans' }}>
          <Clock size={11} />
          {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      {/* ── Horizon selector ──────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '18px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          fontSize: '10px', fontFamily: 'Plus Jakarta Sans', fontWeight: 600,
          color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase',
          marginBottom: '10px',
        }}>
          <Zap size={10} color="var(--accent-light)" />
          Forecast Horizon — click to activate
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          {HORIZONS.map(h => {
            const isActive = h.value === activeHorizon;
            const entry    = models.find(m => m.horizon === h.value);
            const hasModel = entry?.model_exists ?? false;

            return (
              <div
                key={h.value}
                onClick={() => !isActive && !switching && handleHorizonSwitch(h.value as 7 | 15 | 60)}
                style={{
                  padding: '16px', borderRadius: '11px', position: 'relative',
                  border: isActive ? '1px solid rgba(99,102,241,0.35)' : '1px solid var(--border)',
                  background: isActive ? 'var(--accent-muted)' : 'var(--bg-card)',
                  cursor: isActive ? 'default' : hasModel ? 'pointer' : 'not-allowed',
                  transition: 'all 0.15s ease',
                  opacity: switching && !isActive ? 0.5 : 1,
                }}
                onMouseEnter={e => {
                  if (!isActive && hasModel) {
                    (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(99,102,241,0.25)';
                    (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-elevated)';
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
                    (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-card)';
                  }
                }}
              >
                {isActive && (
                  <div style={{
                    position: 'absolute', top: '10px', right: '10px',
                    padding: '2px 8px', borderRadius: '5px', fontSize: '9px',
                    fontFamily: 'IBM Plex Mono', fontWeight: 500,
                    background: 'var(--accent-subtle)', color: 'var(--accent-light)',
                    border: '1px solid rgba(99,102,241,0.25)',
                  }}>
                    active
                  </div>
                )}

                <div className="font-display" style={{
                  fontSize: '20px',
                  color: isActive ? 'var(--accent-light)' : 'var(--text-primary)',
                  marginBottom: '3px',
                  marginRight: isActive ? '56px' : '0',
                }}>
                  {h.label}
                </div>
                <div style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                  <span style={{ fontWeight: 600, color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{h.days}</span>
                  <span> · {h.detail}</span>
                </div>

                <div style={{ fontSize: '10px', fontFamily: 'IBM Plex Mono' }}>
                  {hasModel ? (
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      {entry?.metrics?.rmse != null && (
                        <span style={{ color: isActive ? 'var(--warn)' : 'var(--text-secondary)' }}>
                          RMSE {entry.metrics.rmse >= 1000
                            ? `$${(entry.metrics.rmse / 1000).toFixed(1)}K`
                            : `$${entry.metrics.rmse.toFixed(0)}`}
                        </span>
                      )}
                      {entry?.metrics?.directional_accuracy_pct != null && (
                        <span style={{ color: isActive ? 'var(--up)' : 'var(--text-secondary)' }}>
                          DIR {entry.metrics.directional_accuracy_pct.toFixed(0)}%
                        </span>
                      )}
                    </div>
                  ) : (
                    <span style={{ color: 'var(--down)' }}>No model trained</span>
                  )}
                </div>

                {!isActive && (
                  <div style={{
                    marginTop: '10px', padding: '6px 0', textAlign: 'center',
                    borderRadius: '6px', border: '1px solid var(--border)',
                    background: hasModel ? 'var(--bg-elevated)' : 'transparent',
                    fontSize: '10px', fontFamily: 'IBM Plex Mono',
                    color: hasModel ? 'var(--text-secondary)' : 'var(--text-muted)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                  }}>
                    {switching
                      ? <><Loader size={9} className="spin" /> Switching…</>
                      : hasModel ? 'Activate →' : 'No model'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Main: chart + sidebar metrics ─────────────────────────────────────── */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 280px', gap: '14px',
        marginBottom: '14px',
        opacity: loadingPred ? 0.5 : 1,
        transition: 'opacity 0.2s',
        pointerEvents: loadingPred ? 'none' : undefined,
      }}>
        {/* Forecast chart */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans' }}>
              {activeHistoryDays}-Day History + {periodLabel} Forecast
            </div>
            {loadingPred && <Loader size={13} color="var(--accent-light)" className="spin" />}
          </div>

          <ResponsiveContainer width="100%" height={210}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--text-secondary)" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="var(--text-secondary)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="fcstGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false}
                tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
                tickFormatter={v => v.slice(5)} />
              <YAxis tickLine={false} axisLine={false}
                tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
                tickFormatter={v => coin === 'bitcoin' ? `$${(v / 1000).toFixed(0)}k` : `$${v.toFixed(4)}`}
                width={coin === 'bitcoin' ? 48 : 64} />
              <Tooltip content={<ForecastTooltip decimals={decimals} />} />
              {todayDate && (
                <ReferenceLine x={todayDate} stroke="rgba(255,255,255,0.12)" strokeDasharray="4 3"
                  label={{ value: 'Today', position: 'top', fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'IBM Plex Mono' }} />
              )}
              <Area type="monotone" dataKey="actual" name="Actual"
                stroke="var(--text-secondary)" strokeWidth={2} fill="url(#actualGrad)" dot={false} connectNulls />
              <Area type="monotone" dataKey="forecast" name="Forecast"
                stroke="var(--accent-light)" strokeWidth={2} strokeDasharray="5 3"
                fill="url(#fcstGrad)" dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>

          {/* Legend */}
          <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '11px', fontFamily: 'Plus Jakarta Sans' }}>
            {[
              { color: 'var(--text-secondary)', label: 'History', dash: false },
              { color: 'var(--accent-light)', label: 'Forecast', dash: true },
            ].map(({ color, label, dash }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke={color} strokeWidth="1.5" strokeDasharray={dash ? '4 2' : undefined} /></svg>
                <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right metrics panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Next-day */}
          <div className="card" style={{
            padding: '16px',
            borderColor: 'rgba(99,102,241,0.2)',
            background: 'linear-gradient(135deg, var(--bg-card) 60%, var(--accent-muted))',
          }}>
            <div style={{ fontSize: '10px', fontFamily: 'Plus Jakarta Sans', fontWeight: 600, color: 'var(--accent-light)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px' }}>
              Next-Day Forecast
            </div>
            <div className="font-mono" style={{ fontSize: '20px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '10px', lineHeight: 1 }}>
              {fmt(predictions?.next_day_price, decimals)}
            </div>
            {predictions?.predictions?.[0] && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <DirectionBadge
                  direction={predictions.predictions[0].direction}
                  prob={predictions.predictions[0].direction_prob}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div style={{ width: '44px', height: '3px', borderRadius: '2px', background: 'var(--border)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${(predictions.predictions[0].confidence ?? 0) * 100}%`,
                      background: 'var(--purple)',
                    }} />
                  </div>
                  <span className="font-mono" style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                    {((predictions.predictions[0].confidence ?? 0) * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Period high */}
          <div className="card" style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: '10px', fontFamily: 'Plus Jakarta Sans', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '4px' }}>
              {periodLabel} High
            </div>
            <div className="font-mono" style={{ fontSize: '15px', color: 'var(--up)' }}>
              {fmt(predictions?.seven_day_high, decimals)}
            </div>
          </div>

          {/* Period low */}
          <div className="card" style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: '10px', fontFamily: 'Plus Jakarta Sans', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '4px' }}>
              {periodLabel} Low
            </div>
            <div className="font-mono" style={{ fontSize: '15px', color: 'var(--down)' }}>
              {fmt(predictions?.seven_day_low, decimals)}
            </div>
          </div>

          {/* Outlook */}
          <div className="card" style={{
            padding: '14px 16px',
            background: `linear-gradient(135deg, var(--bg-card) 60%, ${outlook.color}0A)`,
          }}>
            <div style={{ fontSize: '10px', fontFamily: 'Plus Jakarta Sans', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '6px' }}>
              {periodLabel} Outlook
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <outlook.Icon size={16} color={outlook.color} />
              <span className="font-display" style={{ fontSize: '14px', color: outlook.color }}>
                {outlook.label}
              </span>
            </div>
            <div style={{ fontSize: '10px', fontFamily: 'Plus Jakarta Sans', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {outlook.count} days
            </div>
          </div>
        </div>
      </div>

      {/* ── Forecast table ────────────────────────────────────────────────────── */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: '12px', position: 'relative' }}>
        {loadingPred && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 2, borderRadius: '12px',
            background: 'rgba(10,10,15,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Loader size={20} color="var(--accent-light)" className="spin" />
          </div>
        )}
        <div style={{
          padding: '13px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans' }}>
            {periodLabel} Daily Forecast
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
            Model:{' '}
            <span className="font-mono" style={{ color: 'var(--purple)' }}>
              {predictions?.model_version ?? '—'}
            </span>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Date</th>
              <th style={{ textAlign: 'right' }}>Predicted</th>
              <th style={{ textAlign: 'right' }}>Actual</th>
              <th style={{ textAlign: 'right' }}>Error</th>
              <th style={{ textAlign: 'center' }}>Direction</th>
              <th style={{ textAlign: 'right' }}>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {visibleForecasts.map((p: PredictionPoint, i) => (
              <tr key={i}>
                <td>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: '22px', height: '22px', borderRadius: '5px',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono',
                  }}>{(forecastPage - 1) * FORECAST_PAGE_SIZE + i + 1}</span>
                </td>
                <td>
                  <span className="font-mono" style={{ fontSize: '12px' }}>
                    {p.prediction_date.split('T')[0]}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className="font-mono" style={{ fontSize: '13px', fontWeight: 500, color: 'var(--accent-light)' }}>
                    {fmt(p.predicted_price, decimals)}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  {(() => {
                    const dateKey = p.prediction_date.slice(0, 10);
                    const actual = historicalMap[dateKey];
                    return actual != null
                      ? <span className="font-mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{fmt(actual, decimals)}</span>
                      : <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>;
                  })()}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {(() => {
                    const dateKey = p.prediction_date.slice(0, 10);
                    const actual = historicalMap[dateKey];
                    if (actual == null) return <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>—</span>;
                    const errPct = (p.predicted_price - actual) / actual * 100;
                    const color = Math.abs(errPct) < 2 ? 'var(--up)' : Math.abs(errPct) < 5 ? 'var(--warn)' : 'var(--down)';
                    return (
                      <span className="font-mono" style={{ fontSize: '11px', fontWeight: 500, color }}>
                        {errPct >= 0 ? '+' : ''}{errPct.toFixed(2)}%
                      </span>
                    );
                  })()}
                </td>
                <td style={{ textAlign: 'center' }}>
                  <DirectionBadge direction={p.direction} prob={p.direction_prob} />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '7px' }}>
                    <div style={{ width: '40px', height: '3px', borderRadius: '2px', background: 'var(--border)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${p.confidence * 100}%`, background: 'var(--purple)' }} />
                    </div>
                    <span className="font-mono" style={{ fontSize: '10px', color: 'var(--text-secondary)', minWidth: '28px' }}>
                      {(p.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div style={{
            padding: '12px 20px', borderTop: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <button
              onClick={() => setForecastPage(p => Math.max(1, p - 1))}
              disabled={forecastPage === 1}
              className="btn-ghost"
              style={{ fontSize: '11px', padding: '5px 14px', opacity: forecastPage === 1 ? 0.4 : 1 }}
            >
              ← Prev
            </button>
            <div style={{ display: 'flex', gap: '4px' }}>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                <button
                  key={page}
                  onClick={() => setForecastPage(page)}
                  className={page === forecastPage ? undefined : 'btn-ghost'}
                  style={{
                    fontSize: '10px', padding: '4px 8px', borderRadius: '5px',
                    fontFamily: 'IBM Plex Mono',
                    background: page === forecastPage ? 'var(--accent-subtle)' : 'transparent',
                    border: page === forecastPage ? '1px solid rgba(99,102,241,0.3)' : '1px solid transparent',
                    color: page === forecastPage ? 'var(--accent-light)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {page}
                </button>
              ))}
            </div>
            <button
              onClick={() => setForecastPage(p => Math.min(totalPages, p + 1))}
              disabled={forecastPage === totalPages}
              className="btn-ghost"
              style={{ fontSize: '11px', padding: '5px 14px', opacity: forecastPage === totalPages ? 0.4 : 1 }}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* ── Model retraining (collapsible) ────────────────────────────────────── */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: '12px' }}>
        <button
          onClick={() => setShowRetrain(v => !v)}
          style={{
            width: '100%', padding: '14px 20px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'none', border: 'none', cursor: 'pointer',
            borderBottom: showRetrain ? '1px solid var(--border)' : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <RefreshCw size={14} color="var(--accent-light)" />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans' }}>
              Model Retraining
            </span>
          </div>
          {showRetrain ? <ChevronUp size={14} color="var(--text-secondary)" /> : <ChevronDown size={14} color="var(--text-secondary)" />}
        </button>

        {showRetrain && (
          <div style={{ padding: '16px 20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              {HORIZONS.map(h => {
                const latestJob          = retrainJobs.find(j => j.horizon === h.value);
                const isRunningOrPending = latestJob?.status === 'running' || latestJob?.status === 'pending';
                const disabled           = retrainLoading || isRunningOrPending;
                return (
                  <div key={h.value} style={{
                    padding: '13px', borderRadius: '9px',
                    border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span className="font-display" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{h.label}</span>
                      {latestJob && <JobIcon status={latestJob.status} />}
                    </div>
                    {latestJob ? (
                      <div style={{ marginBottom: '10px' }}>
                        <div style={{ fontSize: '10px', fontFamily: 'Plus Jakarta Sans', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                          Status:{' '}
                          <span className="font-mono" style={{
                            color: latestJob.status === 'completed' ? 'var(--up)'
                              : latestJob.status === 'failed' ? 'var(--down)' : 'var(--warn)',
                          }}>
                            {latestJob.status}
                          </span>
                        </div>
                        {latestJob.finished_at && (
                          <div style={{ fontSize: '10px', fontFamily: 'Plus Jakarta Sans', color: 'var(--text-muted)' }}>
                            {timeAgo(latestJob.finished_at)}
                          </div>
                        )}
                        {latestJob.error && (
                          <div style={{ fontSize: '10px', fontFamily: 'Plus Jakarta Sans', color: 'var(--down)', marginTop: '2px' }}>
                            {latestJob.error.slice(0, 40)}{latestJob.error.length > 40 ? '…' : ''}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: '10px', fontFamily: 'Plus Jakarta Sans', color: 'var(--text-muted)', marginBottom: '10px' }}>
                        No recent jobs
                      </div>
                    )}
                    <button
                      onClick={() => !disabled && handleRetrain(h.value)}
                      disabled={disabled}
                      style={{
                        width: '100%', padding: '7px 0', borderRadius: '6px',
                        fontSize: '11px', fontFamily: 'Plus Jakarta Sans', fontWeight: 600,
                        border: `1px solid ${disabled ? 'var(--border)' : 'rgba(99,102,241,0.3)'}`,
                        background: disabled ? 'transparent' : 'var(--accent-muted)',
                        color: disabled ? 'var(--text-muted)' : 'var(--accent-light)',
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      {isRunningOrPending ? 'Queued…' : 'Retrain'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Prediction history (collapsible) ─────────────────────────────────── */}
      {predHistory.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <button
            onClick={() => setShowHistory(v => !v)}
            style={{
              width: '100%', padding: '14px 20px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: showHistory ? '1px solid var(--border)' : 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <Brain size={14} color="var(--purple)" />
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans' }}>
                Prediction Run History
              </span>
              <span style={{
                padding: '1px 7px', borderRadius: '5px', fontSize: '10px', fontFamily: 'IBM Plex Mono',
                background: 'var(--purple-subtle)', color: 'var(--purple)',
              }}>
                {predHistory.length}
              </span>
            </div>
            {showHistory ? <ChevronUp size={14} color="var(--text-secondary)" /> : <ChevronDown size={14} color="var(--text-secondary)" />}
          </button>
          {showHistory && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Prediction Date</th>
                  <th style={{ textAlign: 'right' }}>Predicted</th>
                  <th style={{ textAlign: 'right' }}>Actual</th>
                  <th style={{ textAlign: 'right' }}>Error</th>
                  <th style={{ textAlign: 'center' }}>Direction</th>
                </tr>
              </thead>
              <tbody>
                {predHistory.map((p, i) => (
                  <tr key={i}>
                    <td><span className="font-mono" style={{ fontSize: '12px' }}>{p.prediction_date.split('T')[0]}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="font-mono" style={{ color: 'var(--warn)', fontWeight: 500 }}>{fmt(p.predicted_price, decimals)}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="font-mono" style={{ color: p.actual_price ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {p.actual_price ? fmt(p.actual_price, decimals) : '—'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {p.error_pct != null ? (
                        <span className="font-mono" style={{
                          fontSize: '11px', fontWeight: 500,
                          color: Math.abs(p.error_pct) < 2 ? 'var(--up)' : Math.abs(p.error_pct) < 5 ? 'var(--warn)' : 'var(--down)',
                        }}>
                          {p.error_pct >= 0 ? '+' : ''}{p.error_pct.toFixed(2)}%
                        </span>
                      ) : <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>—</span>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <DirectionBadge direction={p.direction} prob={p.direction_prob} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
