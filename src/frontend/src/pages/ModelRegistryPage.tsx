import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cpu, CheckCircle, XCircle, Loader, Clock, RefreshCw,
  ToggleLeft, ToggleRight, AlertCircle,
} from 'lucide-react';
import {
  fetchModels, setActiveModel, triggerRetrain, fetchRetrainStatus,
} from '../api/client';

function timeAgo(iso?: string): string {
  if (!iso) return '—';
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; bg: string; Icon: React.ElementType }> = {
    pending:   { color: 'var(--warn)',         bg: 'var(--warn-subtle)',  Icon: Clock },
    running:   { color: 'var(--accent-light)', bg: 'var(--accent-muted)', Icon: Loader },
    completed: { color: 'var(--up)',            bg: 'var(--up-subtle)',    Icon: CheckCircle },
    failed:    { color: 'var(--down)',          bg: 'var(--down-subtle)',  Icon: XCircle },
  };
  const cfg = map[status] ?? map.pending;
  const { color, bg, Icon } = cfg;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '3px 9px', borderRadius: '6px',
      background: bg, color,
      fontSize: '11px', fontFamily: 'IBM Plex Mono',
    }}>
      <Icon size={10} className={status === 'running' ? 'spin' : undefined} />
      {status}
    </span>
  );
}

export default function ModelRegistryPage() {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  const showToast = useCallback((msg: string, type: 'ok' | 'err') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const { data: modelsData, isLoading: modelsLoading } = useQuery({
    queryKey: ['ml-models'],
    queryFn:  () => fetchModels(),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const { data: jobsData, isLoading: jobsLoading } = useQuery({
    queryKey: ['retrain-jobs'],
    queryFn:  () => fetchRetrainStatus(),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  const activateMutation = useMutation({
    mutationFn: ({ coin, horizon }: { coin: string; horizon: number }) =>
      setActiveModel(coin, horizon),
    onSuccess: (_, vars) => {
      showToast(`H${vars.horizon} set as active for ${vars.coin.toUpperCase()}`, 'ok');
      queryClient.invalidateQueries({ queryKey: ['ml-models'] });
    },
    onError: () => showToast('Failed to update active model', 'err'),
  });

  const retrainMutation = useMutation({
    mutationFn: ({ coin, horizon }: { coin: string; horizon: number }) =>
      triggerRetrain(coin, horizon),
    onSuccess: (_, vars) => {
      showToast(`Retrain queued for ${vars.coin.toUpperCase()} H${vars.horizon}`, 'ok');
      queryClient.invalidateQueries({ queryKey: ['retrain-jobs'] });
    },
    onError: () => showToast('Failed to queue retrain', 'err'),
  });

  const models = modelsData?.models ?? [];
  const jobs   = jobsData?.jobs ?? [];

  const activeJobs = jobs.filter(j => j.status === 'running' || j.status === 'pending').length;

  return (
    <div>
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
            {toast.type === 'ok' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '28px' }}>
        <div>
          <h1 className="font-display" style={{ margin: 0, fontSize: '22px', color: 'var(--text-primary)' }}>
            Model Registry
          </h1>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px', fontFamily: 'Plus Jakarta Sans' }}>
            LSTM model management · activate horizons · trigger retraining
          </div>
        </div>
        {activeJobs > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            padding: '7px 13px', borderRadius: '8px',
            background: 'var(--accent-muted)', border: '1px solid rgba(99,102,241,0.2)',
            fontSize: '12px', fontFamily: 'Plus Jakarta Sans', color: 'var(--accent-light)',
          }}>
            <Loader size={12} className="spin" />
            {activeJobs} job{activeJobs > 1 ? 's' : ''} running
          </div>
        )}
      </div>

      {/* Models table */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: '20px' }}>
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <Cpu size={15} color="var(--accent-light)" />
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans' }}>
              Registered Models
            </span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
            {models.length} models · horizons: 7 / 15 / 60 days
          </div>
        </div>

        {modelsLoading ? (
          <div style={{ padding: '20px' }}>
            {[...Array(4)].map((_, i) => (
              <div key={i} className="skeleton" style={{ height: '52px', borderRadius: '7px', marginBottom: '8px' }} />
            ))}
          </div>
        ) : models.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans', fontSize: '13px' }}>
            No models registered yet. Run the inference pipeline to train models.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Coin</th>
                <th>Horizon</th>
                <th>Model File</th>
                <th style={{ textAlign: 'right' }}>RMSE</th>
                <th style={{ textAlign: 'right' }}>MAE</th>
                <th style={{ textAlign: 'right' }}>Direction Acc.</th>
                <th style={{ textAlign: 'right' }}>Registered</th>
                <th style={{ textAlign: 'center' }}>Active</th>
                <th style={{ textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m, i) => {
                const isActivating = activateMutation.isPending &&
                  activateMutation.variables?.coin === m.coin_id &&
                  activateMutation.variables?.horizon === m.horizon;
                const isRetraining = retrainMutation.isPending &&
                  retrainMutation.variables?.coin === m.coin_id &&
                  retrainMutation.variables?.horizon === m.horizon;

                return (
                  <tr key={i}>
                    <td>
                      <span className="font-mono" style={{ fontSize: '12px', color: 'var(--accent-light)', fontWeight: 500 }}>
                        {m.coin}
                      </span>
                    </td>
                    <td>
                      <span className="font-display" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                        H{m.horizon}
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '5px', fontFamily: 'Plus Jakarta Sans' }}>
                        {m.horizon}d
                      </span>
                    </td>
                    <td>
                      <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        {m.model_file ?? '—'}
                      </span>
                      {!m.model_exists && (
                        <span style={{ marginLeft: '6px', fontSize: '10px', color: 'var(--down)', fontFamily: 'Plus Jakarta Sans' }}>
                          missing
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="font-mono" style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                        {m.metrics?.rmse != null
                          ? m.metrics.rmse >= 1000
                            ? `$${(m.metrics.rmse / 1000).toFixed(1)}K`
                            : `$${m.metrics.rmse.toFixed(0)}`
                          : '—'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="font-mono" style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                        {m.metrics?.mae != null
                          ? m.metrics.mae >= 1000
                            ? `$${(m.metrics.mae / 1000).toFixed(1)}K`
                            : `$${m.metrics.mae.toFixed(0)}`
                          : '—'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {m.metrics?.directional_accuracy_pct != null ? (
                        <span className="font-mono" style={{
                          fontSize: '12px',
                          color: m.metrics.directional_accuracy_pct >= 60 ? 'var(--up)'
                            : m.metrics.directional_accuracy_pct >= 50 ? 'var(--warn)' : 'var(--down)',
                        }}>
                          {m.metrics.directional_accuracy_pct.toFixed(1)}%
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '12px', fontFamily: 'IBM Plex Mono' }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
                        {m.registered_at ? timeAgo(m.registered_at) : '—'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        onClick={() => !m.is_active && m.model_exists && activateMutation.mutate({ coin: m.coin_id, horizon: m.horizon })}
                        disabled={m.is_active || !m.model_exists || isActivating}
                        title={m.is_active ? 'Currently active' : m.model_exists ? 'Set as active' : 'No model file'}
                        style={{ background: 'none', border: 'none', cursor: m.is_active || !m.model_exists ? 'default' : 'pointer', padding: '4px' }}
                      >
                        {isActivating
                          ? <Loader size={16} color="var(--accent-light)" className="spin" />
                          : m.is_active
                            ? <ToggleRight size={18} color="var(--accent-light)" />
                            : <ToggleLeft size={18} color="var(--text-muted)" />}
                      </button>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        onClick={() => !isRetraining && retrainMutation.mutate({ coin: m.coin_id, horizon: m.horizon })}
                        disabled={isRetraining}
                        className="btn-ghost"
                        style={{ fontSize: '11px', padding: '5px 12px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                      >
                        {isRetraining
                          ? <><Loader size={10} className="spin" /> Queued</>
                          : <><RefreshCw size={10} /> Retrain</>}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Training jobs feed */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <RefreshCw size={15} color="var(--text-secondary)" />
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans' }}>
              Training Jobs
            </span>
            {jobsLoading && <Loader size={12} color="var(--accent-light)" className="spin" />}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
            Auto-refreshes every 10s
          </div>
        </div>

        {jobs.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans', fontSize: '13px' }}>
            No training jobs yet. Click "Retrain" on a model to queue a job.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Coin</th>
                <th>Horizon</th>
                <th style={{ textAlign: 'center' }}>Status</th>
                <th>Created</th>
                <th>Started</th>
                <th>Finished</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j, i) => (
                <tr key={i}>
                  <td>
                    <span className="font-mono" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                      {j.job_id.slice(0, 12)}…
                    </span>
                  </td>
                  <td>
                    <span className="font-mono" style={{ fontSize: '12px', color: 'var(--accent-light)', fontWeight: 500 }}>
                      {j.coin.toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <span className="font-display" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                      H{j.horizon}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <StatusBadge status={j.status} />
                  </td>
                  <td>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
                      {j.created_at ? timeAgo(j.created_at) : '—'}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
                      {j.started_at ? timeAgo(j.started_at) : '—'}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
                      {j.finished_at ? timeAgo(j.finished_at) : '—'}
                    </span>
                  </td>
                  <td>
                    {j.error ? (
                      <span style={{ fontSize: '11px', color: 'var(--down)', fontFamily: 'Plus Jakarta Sans' }} title={j.error}>
                        {j.error.slice(0, 32)}{j.error.length > 32 ? '…' : ''}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>—</span>
                    )}
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
