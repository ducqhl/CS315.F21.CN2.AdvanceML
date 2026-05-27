/**
 * ModelManagementPage — CRUD for LSTM model registry
 *
 * Features:
 *  - List all models per coin with metrics
 *  - Enable / disable toggle
 *  - Soft delete
 *  - Trigger manual re-train with progress polling
 */
import { useEffect, useState, useCallback } from 'react';
import {
  Brain, RefreshCw, Trash2, ToggleLeft, ToggleRight,
  CheckCircle, XCircle, Loader, AlertCircle, Plus,
} from 'lucide-react';
import {
  fetchModels, triggerTrain, toggleModel, deleteModel, fetchTrainJobStatus,
} from '../api/client';
import type { ModelRegistryEntry, TrainJobStatus } from '../api/client';
import { C } from '../components/apexTheme';

interface Props { coin: 'bitcoin' | 'dogecoin' }

function MetricBadge({ label, value, color }: { label: string; value?: number | null; color?: string }) {
  if (value == null) return null;
  return (
    <span style={{ fontSize: '10px', fontFamily: 'Space Mono, monospace', color: color ?? C.textSec }}>
      {label}: <strong style={{ color: color ?? 'var(--text-primary)' }}>{value.toFixed(3)}</strong>
    </span>
  );
}

function StatusBadge({ enabled, deleted }: { enabled: boolean; deleted?: boolean }) {
  if (deleted) return (
    <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '10px', fontWeight: 700, fontFamily: 'Space Mono, monospace', background: 'rgba(255,56,100,0.1)', border: '1px solid rgba(255,56,100,0.3)', color: C.red }}>
      DELETED
    </span>
  );
  if (enabled) return (
    <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '10px', fontWeight: 700, fontFamily: 'Space Mono, monospace', background: 'rgba(0,240,160,0.1)', border: '1px solid rgba(0,240,160,0.3)', color: 'var(--green)' }}>
      ACTIVE
    </span>
  );
  return (
    <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '10px', fontWeight: 700, fontFamily: 'Space Mono, monospace', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: C.textSec }}>
      DISABLED
    </span>
  );
}

function JobStatusBar({ job }: { job: TrainJobStatus | null }) {
  if (!job) return null;
  const isRunning = job.status === 'started' || job.status === 'running';
  const isFailed  = job.status === 'failed';
  const isDone    = job.status === 'completed';
  const color = isDone ? 'var(--green)' : isFailed ? C.red : C.cyan;
  const Icon  = isDone ? CheckCircle : isFailed ? XCircle : Loader;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: '8px', background: `${color}10`, border: `1px solid ${color}30`, marginBottom: '16px' }}>
      <Icon size={14} color={color} className={isRunning ? 'spin' : ''} />
      <span style={{ fontSize: '11px', fontFamily: 'Space Mono, monospace', color, fontWeight: 700 }}>
        {isDone ? `Training complete — model ${job.model_id ?? 'saved'}` : isFailed ? `Training failed: ${job.error ?? 'unknown error'}` : `Training in progress (job ${job.job_id})…`}
      </span>
    </div>
  );
}

export default function ModelManagementPage({ coin }: Props) {
  const [models, setModels]         = useState<ModelRegistryEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [trainJob, setTrainJob]     = useState<TrainJobStatus | null>(null);
  const [polling, setPolling]       = useState(false);
  const [actionLoading, setAction]  = useState<string | null>(null); // model_id being acted on
  const [error, setError]           = useState<string | null>(null);

  const symbol = coin === 'bitcoin' ? 'BTC' : 'DOGE';

  const reload = useCallback(() => {
    setLoading(true);
    fetchModels(coin)
      .then(setModels)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [coin]);

  useEffect(() => { reload(); }, [reload]);

  // Poll training job status
  useEffect(() => {
    if (!polling || !trainJob) return;
    const iv = setInterval(async () => {
      try {
        const s = await fetchTrainJobStatus(trainJob.job_id);
        setTrainJob(s);
        if (s.status === 'completed' || s.status === 'failed') {
          setPolling(false);
          if (s.status === 'completed') reload(); // refresh model list
        }
      } catch {
        // non-fatal
      }
    }, 4000);
    return () => clearInterval(iv);
  }, [polling, trainJob, reload]);

  const handleTrain = async () => {
    setError(null);
    try {
      const resp = await triggerTrain({ coin, epochs: 30 });
      setTrainJob({ job_id: resp.job_id, coin, status: 'started', started_at: new Date().toISOString() });
      setPolling(true);
    } catch (e) {
      setError(`Failed to start training: ${e}`);
    }
  };

  const handleToggle = async (modelId: string) => {
    setAction(modelId);
    try {
      const updated = await toggleModel(modelId);
      setModels(prev => prev.map(m => m.model_id === modelId ? { ...m, ...updated } : m));
    } catch (e) {
      setError(String(e));
    } finally {
      setAction(null);
    }
  };

  const handleDelete = async (modelId: string) => {
    if (!confirm(`Delete model "${modelId}"? The file will be kept on disk.`)) return;
    setAction(modelId);
    try {
      await deleteModel(modelId);
      setModels(prev => prev.map(m => m.model_id === modelId ? { ...m, deleted_at: new Date().toISOString() } : m));
    } catch (e) {
      setError(String(e));
    } finally {
      setAction(null);
    }
  };

  const activeModels   = models.filter(m => !m.deleted_at);
  const deletedModels  = models.filter(m => !!m.deleted_at);

  return (
    <div>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
            <div className="font-display" style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.06em' }}>
              MODEL MANAGEMENT
            </div>
            <span style={{ padding: '3px 10px', borderRadius: '12px', fontSize: '10px', fontWeight: 700, background: 'var(--violet-10)', border: '1px solid rgba(139,92,246,0.25)', color: 'var(--violet)', fontFamily: 'Space Mono' }}>
              {symbol}
            </span>
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '12px', fontFamily: 'Manrope' }}>
            LSTM model registry — enable, disable, retrain, and monitor model versions
          </div>
        </div>

        {/* Train button */}
        <button
          onClick={handleTrain}
          disabled={polling}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '9px 18px', borderRadius: '10px', cursor: polling ? 'default' : 'pointer',
            background: polling ? 'var(--bg-elevated)' : `${C.cyan}15`,
            border: `1px solid ${polling ? 'var(--border)' : `${C.cyan}40`}`,
            color: polling ? C.textSec : C.cyan,
            fontSize: '12px', fontWeight: 700, fontFamily: 'Space Mono, monospace',
          }}
        >
          {polling
            ? <Loader size={14} className="spin" />
            : <Plus size={14} />}
          {polling ? 'TRAINING…' : 'TRIGGER RETRAIN'}
        </button>
      </div>

      {/* ── Error banner ────────────────────────────────────────────────────── */}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: '8px', background: `${C.red}10`, border: `1px solid ${C.red}30`, marginBottom: '16px' }}>
          <AlertCircle size={14} color={C.red} />
          <span style={{ fontSize: '12px', color: C.red, fontFamily: 'Manrope' }}>{error}</span>
          <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: C.red }}>✕</button>
        </div>
      )}

      {/* ── Job status ──────────────────────────────────────────────────────── */}
      <JobStatusBar job={trainJob} />

      {/* ── Active models table ─────────────────────────────────────────────── */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: '16px' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Brain size={14} color="var(--violet)" />
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'Manrope' }}>Active Models</span>
            <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '10px', fontWeight: 600, background: 'var(--violet-10)', border: '1px solid rgba(139,92,246,0.25)', color: 'var(--violet)', fontFamily: 'Manrope' }}>
              {activeModels.length}
            </span>
          </div>
          <button onClick={reload} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textSec, display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontFamily: 'Manrope' }}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: C.textSec, fontFamily: 'Manrope', fontSize: '13px' }}>
            Loading models…
          </div>
        ) : activeModels.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: C.textSec, fontFamily: 'Manrope', fontSize: '13px' }}>
            <Brain size={28} style={{ marginBottom: '12px', opacity: 0.3 }} />
            <div>No models found. Trigger a retrain to create the first version.</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Trained At</th>
                <th style={{ textAlign: 'center' }}>Epochs</th>
                <th>Metrics</th>
                <th style={{ textAlign: 'center' }}>Status</th>
                <th style={{ textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {activeModels.map(m => (
                <tr key={m.model_id}>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span className="font-mono" style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>{m.version_tag}</span>
                      <span style={{ fontSize: '10px', color: C.textSec, fontFamily: 'Manrope' }}>{m.model_id}</span>
                    </div>
                  </td>
                  <td>
                    <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {new Date(m.trained_at).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span className="font-mono" style={{ fontSize: '12px', color: C.cyan }}>{m.epochs_trained ?? '—'}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <MetricBadge label="F1" value={m.metrics?.f1_macro} color={m.metrics?.f1_macro != null ? (m.metrics.f1_macro > 0.45 ? 'var(--green)' : m.metrics.f1_macro > 0.38 ? C.gold : C.red) : undefined} />
                      <MetricBadge label="Dir%" value={m.metrics?.direction_accuracy_pct} color={C.cyan} />
                      <MetricBadge label="RMSE" value={m.metrics?.rmse} color={C.textSec} />
                    </div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <StatusBadge enabled={m.enabled} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                      {/* Toggle */}
                      <button
                        onClick={() => handleToggle(m.model_id)}
                        disabled={actionLoading === m.model_id}
                        title={m.enabled ? 'Disable' : 'Enable'}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: m.enabled ? 'var(--green)' : C.textSec, display: 'flex', alignItems: 'center' }}
                      >
                        {actionLoading === m.model_id
                          ? <Loader size={16} className="spin" />
                          : m.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => handleDelete(m.model_id)}
                        disabled={actionLoading === m.model_id}
                        title="Delete (soft)"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.red, display: 'flex', alignItems: 'center', opacity: 0.7 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Deleted models (collapsed) ──────────────────────────────────────── */}
      {deletedModels.length > 0 && (
        <div className="card" style={{ overflow: 'hidden', opacity: 0.6 }}>
          <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '12px', color: C.textSec, fontFamily: 'Manrope' }}>
              {deletedModels.length} deleted model{deletedModels.length > 1 ? 's' : ''} (files retained on disk)
            </span>
          </div>
        </div>
      )}

      {/* ── Info box ────────────────────────────────────────────────────────── */}
      <div style={{ marginTop: '20px', padding: '14px 18px', borderRadius: '10px', background: `${C.cyan}08`, border: `1px solid ${C.cyan}20` }}>
        <div style={{ fontSize: '11px', color: C.textSec, fontFamily: 'Manrope', lineHeight: 1.6 }}>
          <strong style={{ color: C.cyan }}>Auto-retrain:</strong> The inference scheduler automatically retrains models every 7 days (configurable via <code style={{ color: C.gold }}>RETRAIN_INTERVAL_DAYS</code> env var). Each trained model is registered here and can be selected on the Predictions page.
        </div>
      </div>
    </div>
  );
}
