import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Database, Cpu, Activity, Server, Clock, AlertCircle, Zap } from 'lucide-react';
import { api } from '../api/client';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ModelEntry {
  coin: string;
  horizon: number;
  model_id: string;
  version_label: string;
  is_newest: boolean;
  is_active: boolean;
  metrics?: {
    rmse?: number;
    mae?: number;
    directional_accuracy_pct?: number;
    epochs_trained?: number;
  } | null;
}

interface JobRecord {
  job_id: string;
  coin: string;
  horizon?: number;
  model_id?: string;
  status: string;
  created_at?: string;
  finished_at?: string;
  error?: string | null;
}

interface SchedulerStatus {
  coin: string;
  status: string;
  last_run_at?: string;
  last_run_duration_ms?: number;
  model_version?: string;
  run_count?: number;
}

interface SystemOverview {
  health: { api: string; mongo: string };
  collections: Record<string, number>;
  models: {
    entries: ModelEntry[];
    total: number;
    by_coin: Record<string, number>;
  };
  jobs: {
    training: { counts: Record<string, number>; recent: JobRecord[] };
    inference: { counts: Record<string, number>; recent: JobRecord[] };
  };
  scheduler: Record<string, SchedulerStatus>;
  latest_prices: Record<string, { price: number; date: string }>;
  timestamp: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const REFRESH_SEC = 15;

const STATUS_COLOR: Record<string, string> = {
  ok: '#22C55E', connected: '#22C55E', completed: '#22C55E',
  running: '#3B82F6',
  pending: '#F59E0B', degraded: '#F59E0B',
  failed: '#EF4444', error: '#EF4444',
  unknown: '#52525B',
};

const COL_LAYER: Record<string, string> = {
  daily_stats: 'BATCH', historical_sma: 'BATCH', coin_correlation: 'BATCH',
  realtime_prices: 'SPEED', live_prices: 'SPEED',
  predictions: 'ML', prediction_accuracy: 'ML',
  training_jobs: 'SYS', inference_jobs: 'SYS',
};

const LAYER_COLOR: Record<string, string> = {
  BATCH: '#22C55E', SPEED: '#F59E0B', ML: '#818CF8', SYS: '#52525B',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function sColor(s: string): string {
  return STATUS_COLOR[s?.toLowerCase?.() ?? ''] ?? '#52525B';
}

function relTime(iso?: string): string {
  if (!iso) return '—';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtN(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtMs(ms?: number): string {
  if (!ms) return '—';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PulseDot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: 8, height: 8, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}>
      {pulse && (
        <span style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          background: color, opacity: 0.35,
          animation: 'sysPulse 1.6s ease-out infinite',
        }} />
      )}
      <span style={{ position: 'absolute', inset: 1, borderRadius: '50%', background: color }} />
    </span>
  );
}

function LayerTag({ layer }: { layer: string }) {
  const c = LAYER_COLOR[layer] ?? '#52525B';
  return (
    <span style={{
      padding: '1px 5px', borderRadius: 3, fontSize: 9,
      fontFamily: 'IBM Plex Mono', fontWeight: 500, letterSpacing: '0.06em',
      background: `${c}18`, color: c, border: `1px solid ${c}30`,
    }}>
      {layer}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const c = sColor(status);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 7px', borderRadius: 4, fontSize: 10,
      fontFamily: 'IBM Plex Mono', fontWeight: 500,
      background: `${c}18`, color: c, border: `1px solid ${c}30`,
    }}>
      <PulseDot color={c} pulse={status === 'running'} />
      {status.toUpperCase()}
    </span>
  );
}

function SectionDivider({ label, accent = '#818CF8' }: { label: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '28px 0 14px' }}>
      <div style={{ width: 3, height: 14, borderRadius: 2, background: accent, flexShrink: 0 }} />
      <span style={{
        fontFamily: 'IBM Plex Mono', fontSize: 10, fontWeight: 600,
        letterSpacing: '0.12em', color: 'var(--text-muted)', textTransform: 'uppercase',
      }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

function StatCard({ icon, label, value, valueColor, sub, accent, dot }: {
  icon: React.ReactNode; label: string; value: string;
  valueColor?: string; sub: string; accent: string; dot?: boolean;
}) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '14px 16px', borderTop: `2px solid ${accent}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, color: 'var(--text-muted)' }}>
        {icon}
        <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, letterSpacing: '0.1em' }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        {dot && <PulseDot color={valueColor ?? accent} pulse={value === 'OK' || value === 'CONNECTED'} />}
        <span style={{
          fontFamily: 'IBM Plex Mono', fontSize: 22, fontWeight: 700,
          color: valueColor ?? 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1,
        }}>
          {value}
        </span>
      </div>
      <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>
    </div>
  );
}

function JobsTable({ title, counts, jobs, showHorizon, showModelId }: {
  title: string; counts: Record<string, number>;
  jobs: JobRecord[]; showHorizon?: boolean; showModelId?: boolean;
}) {
  const statuses = ['running', 'pending', 'completed', 'failed'];
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
          {title}
        </span>
        <div style={{ display: 'flex', gap: 5 }}>
          {statuses.map(s => {
            const n = counts[s];
            if (!n) return null;
            const c = sColor(s);
            return (
              <span key={s} style={{
                padding: '1px 6px', borderRadius: 3, fontSize: 9,
                fontFamily: 'IBM Plex Mono',
                background: `${c}18`, color: c, border: `1px solid ${c}30`,
              }}>
                {n} {s}
              </span>
            );
          })}
          {Object.keys(counts).length === 0 && (
            <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 10, color: 'var(--text-muted)' }}>no jobs</span>
          )}
        </div>
      </div>
      {jobs.length === 0 ? (
        <div style={{ padding: '20px 14px', textAlign: 'center', fontFamily: 'IBM Plex Mono', fontSize: 11, color: 'var(--text-muted)' }}>
          — empty —
        </div>
      ) : (
        jobs.map((j, i) => (
          <div key={j.job_id} style={{
            padding: '8px 14px',
            borderBottom: i < jobs.length - 1 ? '1px solid var(--border)' : 'none',
            display: 'grid',
            gridTemplateColumns: showHorizon ? '1fr 44px 52px 88px' : '1fr 52px 88px',
            gap: 8, alignItems: 'center',
          }}>
            <span style={{
              fontFamily: 'IBM Plex Mono', fontSize: 10, color: 'var(--text-muted)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {showModelId && j.model_id ? j.model_id : j.job_id.slice(0, 22) + (j.job_id.length > 22 ? '…' : '')}
            </span>
            {showHorizon && (
              <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 10, color: 'var(--text-muted)' }}>
                H{j.horizon ?? '?'}
              </span>
            )}
            <span style={{
              fontFamily: 'IBM Plex Mono', fontSize: 11, fontWeight: 600,
              color: j.coin === 'BTC' ? '#F59E0B' : '#818CF8',
            }}>
              {j.coin}
            </span>
            <StatusBadge status={j.status} />
          </div>
        ))
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SystemStatsPage() {
  const [data, setData] = useState<SystemOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_SEC);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await api.get<SystemOverview>('/system/overview');
      setData(res.data);
      setLastRefresh(new Date());
      setError(null);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } }; message?: string })
        ?.response?.data?.detail ?? (e as { message?: string })?.message ?? 'Failed to load';
      setError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setCountdown(REFRESH_SEC);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_SEC * 1000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const tick = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(tick);
  }, []);

  const totalDocs = data ? Object.values(data.collections).reduce((a, b) => a + b, 0) : 0;
  const maxCount = data ? Math.max(...Object.values(data.collections), 1) : 1;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', flexDirection: 'column', gap: 16 }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', border: '2px solid var(--border)', borderTop: '2px solid var(--accent)', animation: 'sysSpin 0.8s linear infinite' }} />
        <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, color: 'var(--text-muted)' }}>Loading system stats…</span>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      style={{ maxWidth: 1060 }}
    >
      <style>{`
        @keyframes sysPulse { 0% { transform: scale(1); opacity: 0.5; } 100% { transform: scale(2.6); opacity: 0; } }
        @keyframes sysSpin  { to { transform: rotate(360deg); } }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontFamily: 'IBM Plex Mono', fontWeight: 700, fontSize: 21, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              SYSTEM OVERVIEW
            </span>
            <PulseDot color="#22C55E" pulse />
            <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 10, color: '#22C55E', letterSpacing: '0.1em' }}>LIVE</span>
          </div>
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 13, color: 'var(--text-muted)' }}>
            Infrastructure · Models · Jobs · Scheduler
            {lastRefresh && (
              <span style={{ marginLeft: 10 }}>· updated {relTime(lastRefresh.toISOString())}</span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
            borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          }}>
            <Clock size={11} color="var(--text-muted)" />
            <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, color: 'var(--text-muted)' }}>
              {countdown}s
            </span>
          </div>
          <button
            onClick={load}
            disabled={refreshing}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
              borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--bg-elevated)', cursor: refreshing ? 'not-allowed' : 'pointer',
              color: 'var(--text-secondary)', fontSize: 12,
              fontFamily: 'Plus Jakarta Sans', opacity: refreshing ? 0.5 : 1,
              transition: 'opacity 0.1s',
            }}
          >
            <RefreshCw size={12} style={{ animation: refreshing ? 'sysSpin 0.8s linear infinite' : 'none' }} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
          background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: 8, marginBottom: 20,
          fontFamily: 'IBM Plex Mono', fontSize: 12, color: '#EF4444',
        }}>
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {/* ── Top 4 stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <StatCard
          icon={<Server size={13} />} label="API"
          value={data?.health.api?.toUpperCase() ?? '—'}
          valueColor={sColor(data?.health.api ?? '')}
          sub="FastAPI · port 8000" accent={sColor(data?.health.api ?? '')} dot
        />
        <StatCard
          icon={<Database size={13} />} label="MONGODB"
          value={data?.health.mongo?.toUpperCase() ?? '—'}
          valueColor={sColor(data?.health.mongo ?? '')}
          sub="mongo:6.0 · port 27017" accent={sColor(data?.health.mongo ?? '')} dot
        />
        <StatCard
          icon={<Cpu size={13} />} label="MODELS"
          value={String(data?.models.total ?? 0)}
          sub={`BTC ${data?.models.by_coin.BTC ?? 0} · DOGE ${data?.models.by_coin.DOGE ?? 0}`}
          accent="#818CF8"
        />
        <StatCard
          icon={<Activity size={13} />} label="DOCUMENTS"
          value={fmtN(totalDocs)}
          sub="total across all collections" accent="#F59E0B"
        />
      </div>

      {/* ── Data Volumes ── */}
      <SectionDivider label="Data Volumes" accent="#22C55E" />
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        {data && Object.entries(data.collections).map(([col, count], i, arr) => {
          const layer = COL_LAYER[col] ?? 'SYS';
          const lc = LAYER_COLOR[layer];
          const pct = Math.max(3, (count / maxCount) * 100);
          return (
            <div key={col} style={{
              display: 'grid', gridTemplateColumns: '168px 52px 1fr 80px',
              alignItems: 'center', gap: 14, padding: '10px 18px',
              borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 11.5, color: 'var(--text-secondary)' }}>
                {col}
              </span>
              <LayerTag layer={layer} />
              <div style={{ height: 4, background: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden' }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.55, delay: i * 0.04, ease: 'easeOut' }}
                  style={{ height: '100%', background: lc, borderRadius: 2 }}
                />
              </div>
              <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, color: 'var(--text-primary)', textAlign: 'right', fontWeight: 500 }}>
                {fmtN(count)}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Model Registry ── */}
      <SectionDivider label="Model Registry" accent="#818CF8" />
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '56px 52px 210px 76px 68px 68px 68px 84px',
          gap: 8, padding: '8px 18px',
          borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)',
        }}>
          {['COIN', 'HRZ', 'MODEL ID', 'VERSION', 'STATUS', 'RMSE', 'MAE', 'DIR ACC'].map(h => (
            <span key={h} style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>{h}</span>
          ))}
        </div>

        {(!data || data.models.entries.length === 0) && (
          <div style={{ padding: '24px 18px', textAlign: 'center', fontFamily: 'IBM Plex Mono', fontSize: 12, color: 'var(--text-muted)' }}>
            No models found — run <code>make infer-all</code> first
          </div>
        )}

        {data?.models.entries.map((m, i) => {
          const statusLabel = m.is_active ? 'ACTIVE' : m.is_newest ? 'NEWEST' : 'OLD';
          const statusC = m.is_active ? '#22C55E' : m.is_newest ? '#818CF8' : '#52525B';
          return (
            <div key={m.model_id} style={{
              display: 'grid', gridTemplateColumns: '56px 52px 210px 76px 68px 68px 68px 84px',
              gap: 8, padding: '10px 18px', alignItems: 'center',
              borderBottom: i < data.models.entries.length - 1 ? '1px solid var(--border)' : 'none',
              background: m.is_active ? 'rgba(99,102,241,0.04)' : 'transparent',
            }}>
              <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, fontWeight: 700, color: m.coin === 'BTC' ? '#F59E0B' : '#818CF8' }}>
                {m.coin}
              </span>
              <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, color: 'var(--text-secondary)' }}>
                H{m.horizon}
              </span>
              <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.model_id}
              </span>
              <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, color: 'var(--text-secondary)' }}>
                {m.version_label}
              </span>
              <span style={{
                fontFamily: 'IBM Plex Mono', fontSize: 9, fontWeight: 600, letterSpacing: '0.06em',
                color: statusC, padding: '2px 5px', borderRadius: 3,
                background: `${statusC}18`, border: `1px solid ${statusC}30`,
                display: 'inline-block',
              }}>
                {statusLabel}
              </span>
              <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, color: 'var(--text-secondary)' }}>
                {m.metrics?.rmse != null ? m.metrics.rmse.toFixed(2) : '—'}
              </span>
              <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, color: 'var(--text-secondary)' }}>
                {m.metrics?.mae != null ? m.metrics.mae.toFixed(2) : '—'}
              </span>
              <span style={{
                fontFamily: 'IBM Plex Mono', fontSize: 11,
                color: (m.metrics?.directional_accuracy_pct ?? 0) > 55 ? '#22C55E' : 'var(--text-secondary)',
              }}>
                {m.metrics?.directional_accuracy_pct != null
                  ? `${m.metrics.directional_accuracy_pct.toFixed(1)}%`
                  : '—'}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Inference Scheduler ── */}
      <SectionDivider label="Inference Scheduler" accent="#F59E0B" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {(['BTC', 'DOGE'] as const).map(coin => {
          const s = data?.scheduler[coin];
          const c = sColor(s?.status ?? 'unknown');
          return (
            <div key={coin} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '16px 18px', borderLeft: `3px solid ${c}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 14, fontWeight: 700, color: coin === 'BTC' ? '#F59E0B' : '#818CF8' }}>
                  {coin}
                </span>
                <StatusBadge status={s?.status ?? 'unknown'} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {([
                  ['Last run', relTime(s?.last_run_at)],
                  ['Duration', fmtMs(s?.last_run_duration_ms)],
                  ['Model', s?.model_version ?? '—'],
                  ['Run count', s?.run_count != null ? fmtN(s.run_count) : '—'],
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 12, color: 'var(--text-muted)' }}>{k}</span>
                    <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, color: 'var(--text-secondary)' }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Recent Jobs ── */}
      <SectionDivider label="Recent Jobs" accent="#3B82F6" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <JobsTable
          title="Training Jobs"
          counts={data?.jobs.training.counts ?? {}}
          jobs={data?.jobs.training.recent ?? []}
          showHorizon
        />
        <JobsTable
          title="On-demand Predict"
          counts={data?.jobs.inference.counts ?? {}}
          jobs={data?.jobs.inference.recent ?? []}
          showModelId
        />
      </div>

      {/* ── Latest Prices ── */}
      {data?.latest_prices && Object.keys(data.latest_prices).length > 0 && (
        <>
          <SectionDivider label="Live Prices" accent="#22C55E" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {Object.entries(data.latest_prices).map(([coin, info]) => (
              <div key={coin} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '14px 18px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Zap size={13} color={coin === 'BTC' ? '#F59E0B' : '#818CF8'} />
                  <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 13, fontWeight: 700, color: coin === 'BTC' ? '#F59E0B' : '#818CF8' }}>
                    {coin}
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                    ${info.price?.toLocaleString('en-US', { minimumFractionDigits: coin === 'BTC' ? 2 : 6, maximumFractionDigits: coin === 'BTC' ? 2 : 6 })}
                  </div>
                  <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {relTime(info.date)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Footer ── */}
      <div style={{
        marginTop: 32, paddingTop: 14, borderTop: '1px solid var(--border)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 10, color: 'var(--text-muted)' }}>
          GET /api/system/overview · auto-refresh {REFRESH_SEC}s
        </span>
        <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 10, color: 'var(--text-muted)' }}>
          {data?.timestamp
            ? new Date(data.timestamp).toLocaleString('en-US', { hour12: false })
            : '—'}
        </span>
      </div>
    </motion.div>
  );
}
