import { Cpu, Loader, ToggleLeft, ToggleRight, RefreshCw } from 'lucide-react';
import { timeAgo, fmtMetricDollar } from '../../../lib/format';
import type { ModelRegistryEntry } from '../../../api/client';

interface ModelsTableProps {
  models: ModelRegistryEntry[];
  loading: boolean;
  isActivating: (m: ModelRegistryEntry) => boolean;
  isRetraining: (m: ModelRegistryEntry) => boolean;
  onActivate: (m: ModelRegistryEntry) => void;
  onRetrain: (m: ModelRegistryEntry) => void;
}

/** Registered LSTM models table with activate + retrain actions. */
export default function ModelsTable({
  models, loading, isActivating, isRetraining, onActivate, onRetrain,
}: ModelsTableProps) {
  return (
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

      {loading ? (
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
              const activating = isActivating(m);
              const retraining = isRetraining(m);

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
                      {m.model_id ?? '—'}
                    </span>
                    {!m.model_exists && (
                      <span style={{ marginLeft: '6px', fontSize: '10px', color: 'var(--down)', fontFamily: 'Plus Jakarta Sans' }}>
                        missing
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="font-mono" style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                      {fmtMetricDollar(m.metrics?.rmse)}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="font-mono" style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                      {fmtMetricDollar(m.metrics?.mae)}
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
                      onClick={() => !m.is_active && m.model_exists && onActivate(m)}
                      disabled={m.is_active || !m.model_exists || activating}
                      title={m.is_active ? 'Currently active' : m.model_exists ? 'Set as active' : 'No model file'}
                      style={{ background: 'none', border: 'none', cursor: m.is_active || !m.model_exists ? 'default' : 'pointer', padding: '4px' }}
                    >
                      {activating
                        ? <Loader size={16} color="var(--accent-light)" className="spin" />
                        : m.is_active
                          ? <ToggleRight size={18} color="var(--accent-light)" />
                          : <ToggleLeft size={18} color="var(--text-muted)" />}
                    </button>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      onClick={() => !retraining && onRetrain(m)}
                      disabled={retraining}
                      className="btn-ghost"
                      style={{ fontSize: '11px', padding: '5px 12px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                    >
                      {retraining
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
  );
}
