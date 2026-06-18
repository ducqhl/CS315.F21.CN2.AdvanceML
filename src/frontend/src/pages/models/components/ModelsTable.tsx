import { useState } from 'react';
import { Cpu, Loader, ToggleLeft, ToggleRight, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { fmtMetricDollar } from '../../../lib/format';
import type { ModelRegistryEntry, ScoreReport, FoldMetric } from '../../../api/client';

interface ModelsTableProps {
  models: ModelRegistryEntry[];
  loading: boolean;
  isActivating: (m: ModelRegistryEntry) => boolean;
  isRetraining: (m: ModelRegistryEntry) => boolean;
  onActivate: (m: ModelRegistryEntry) => void;
  onRetrain: (m: ModelRegistryEntry) => void;
}

function DirAccPill({ v, size = 12 }: { v: number | null | undefined; size?: number }) {
  if (v == null) return <span style={{ color: 'var(--text-muted)', fontSize: size }}>—</span>;
  const color = v >= 60 ? 'var(--up)' : v >= 50 ? 'var(--warn)' : 'var(--down)';
  const bg    = v >= 60 ? 'var(--up-subtle)' : v >= 50 ? 'var(--warn-subtle)' : 'var(--down-subtle)';
  return (
    <span style={{
      fontFamily: 'IBM Plex Mono', fontSize: size, color,
      background: bg, borderRadius: 4, padding: '2px 6px',
    }}>
      {v.toFixed(1)}%
    </span>
  );
}

/** Mini horizontal bar for a fold's dir_acc */
function FoldBar({ fold, max = 100 }: { fold: FoldMetric; max?: number }) {
  const pct = Math.min((fold.dir_acc / max) * 100, 100);
  const color = fold.dir_acc >= 60 ? 'var(--up)' : fold.dir_acc >= 50 ? 'var(--warn)' : 'var(--down)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
      <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 10, color: 'var(--text-muted)', width: 16, textAlign: 'right' }}>
        #{fold.fold}
      </span>
      <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 10, color, width: 38, textAlign: 'right' }}>
        {fold.dir_acc.toFixed(1)}%
      </span>
      <span style={{ fontFamily: 'Plus Jakarta Sans', fontSize: 10, color: 'var(--text-muted)', width: 60 }}>
        ${fmtMetricDollar(fold.rmse) ?? '—'}
      </span>
    </div>
  );
}

function ScoreDetail({ sr }: { sr: ScoreReport }) {
  const folds = sr.per_fold_metrics ?? [];
  const wfDirAcc = sr.walk_forward_dir_acc_mean;
  const wfRmse   = sr.walk_forward_rmse_mean;

  return (
    <div style={{
      padding: '16px 20px 20px',
      background: 'rgba(255,255,255,0.02)',
      borderTop: '1px solid var(--border)',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: folds.length ? '1fr 1fr' : '1fr', gap: 20 }}>

        {/* Left: Walk-forward summary + training config */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 10 }}>
            Walk-Forward Cross-Validation
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
            {[
              { label: 'Mean Dir Acc', value: wfDirAcc != null ? `${wfDirAcc.toFixed(1)}%` : '—', highlight: wfDirAcc != null },
              { label: 'Mean RMSE',   value: wfRmse   != null ? `$${fmtMetricDollar(wfRmse)}` : '—', highlight: false },
            ].map(({ label, value, highlight }) => (
              <div key={label} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 7, padding: '9px 12px',
              }}>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                  {label}
                </div>
                <div style={{
                  fontFamily: 'IBM Plex Mono', fontSize: 14, fontWeight: 600,
                  color: highlight && wfDirAcc != null
                    ? wfDirAcc >= 60 ? 'var(--up)' : wfDirAcc >= 50 ? 'var(--warn)' : 'var(--down)'
                    : 'var(--text-primary)',
                }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>
            Training Config
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px' }}>
            {[
              { k: 'Epochs',        v: sr.epochs_trained ?? '—' },
              { k: 'Best Val Loss', v: sr.best_val_loss != null ? sr.best_val_loss.toFixed(4) : '—' },
              { k: 'Window',        v: sr.window_days != null ? `${sr.window_days}d` : '—' },
              { k: 'Folds',         v: folds.length || '—' },
            ].map(({ k, v }) => (
              <span key={k} style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
                {k}: <span style={{ color: 'var(--text-primary)', fontFamily: 'IBM Plex Mono', fontSize: 11 }}>{String(v)}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Right: Per-fold dir acc bars */}
        {folds.length > 0 && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 10 }}>
              Per-Fold Dir Acc · RMSE
            </div>
            {folds.map(f => <FoldBar key={f.fold} fold={f} />)}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ModelsTable({
  models, loading, isActivating, isRetraining, onActivate, onRetrain,
}: ModelsTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (key: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  return (
    <div className="card" style={{ overflow: 'hidden', marginBottom: 20 }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Cpu size={15} color="var(--accent-light)" />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans' }}>
            Registered Models
          </span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
          {models.length} models · click row to expand metrics
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 20 }}>
          {[...Array(6)].map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 48, borderRadius: 7, marginBottom: 8 }} />
          ))}
        </div>
      ) : models.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans', fontSize: 13 }}>
          No models registered yet. Run the inference pipeline to train models.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 24 }} />
              <th>Coin</th>
              <th>Horizon</th>
              <th>Model</th>
              <th style={{ textAlign: 'right' }}>RMSE</th>
              <th style={{ textAlign: 'right' }}>Dir Acc</th>
              <th style={{ textAlign: 'right' }}>WF Dir Acc</th>
              <th style={{ textAlign: 'right' }}>Epochs</th>
              <th style={{ textAlign: 'center' }}>Active</th>
              <th style={{ textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {models.map(m => {
              const activating = isActivating(m);
              const retraining = isRetraining(m);
              const rowKey     = `${m.coin_id}-${m.horizon}-${m.version}`;
              const isExpanded = expanded.has(rowKey);
              const sr         = m.score_report;
              const isBtc      = m.coin === 'BTC';

              return (
                <tr key={`row-${rowKey}`} style={{ cursor: sr ? 'pointer' : 'default' }} onClick={() => sr && toggle(rowKey)}>
                  {/* Expand chevron */}
                  <td style={{ textAlign: 'center', padding: '0 4px' }}>
                    {sr
                      ? isExpanded
                        ? <ChevronDown size={12} color="var(--accent-light)" />
                        : <ChevronRight size={12} color="var(--text-muted)" />
                      : null}
                  </td>

                  {/* Coin */}
                  <td onClick={e => e.stopPropagation()}>
                    <span style={{
                      fontFamily: 'IBM Plex Mono', fontSize: 12, fontWeight: 600,
                      color: isBtc ? '#F7931A' : '#C2A633',
                      background: isBtc ? 'rgba(247,147,26,0.1)' : 'rgba(194,166,51,0.1)',
                      borderRadius: 4, padding: '2px 7px',
                    }}>
                      {m.coin}
                    </span>
                  </td>

                  {/* Horizon */}
                  <td onClick={e => e.stopPropagation()}>
                    <span style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>
                      H{m.horizon}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4, fontFamily: 'Plus Jakarta Sans' }}>
                      {m.horizon}d
                    </span>
                  </td>

                  {/* Model file */}
                  <td onClick={e => e.stopPropagation()}>
                    <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 10, color: 'var(--text-secondary)' }}>
                      {m.model_id ?? '—'}
                    </span>
                    {!m.model_exists && (
                      <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--down)', fontFamily: 'Plus Jakarta Sans' }}>
                        missing
                      </span>
                    )}
                  </td>

                  {/* RMSE */}
                  <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                    <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, color: 'var(--text-primary)' }}>
                      {m.metrics?.rmse != null ? `$${fmtMetricDollar(m.metrics.rmse)}` : '—'}
                    </span>
                  </td>

                  {/* Dir Acc */}
                  <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                    <DirAccPill v={m.metrics?.directional_accuracy_pct} />
                  </td>

                  {/* WF Dir Acc */}
                  <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                    <DirAccPill v={sr?.walk_forward_dir_acc_mean} />
                  </td>

                  {/* Epochs */}
                  <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                    <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, color: 'var(--text-secondary)' }}>
                      {m.metrics?.epochs_trained ?? '—'}
                    </span>
                  </td>

                  {/* Active toggle */}
                  <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => !m.is_active && m.model_exists && onActivate(m)}
                      disabled={m.is_active || !m.model_exists || activating}
                      title={m.is_active ? 'Currently active' : m.model_exists ? 'Set as active' : 'No model file'}
                      style={{ background: 'none', border: 'none', cursor: m.is_active || !m.model_exists ? 'default' : 'pointer', padding: 4 }}
                    >
                      {activating
                        ? <Loader size={16} color="var(--accent-light)" className="spin" />
                        : m.is_active
                          ? <ToggleRight size={18} color="var(--accent-light)" />
                          : <ToggleLeft size={18} color="var(--text-muted)" />}
                    </button>
                  </td>

                  {/* Retrain */}
                  <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => !retraining && onRetrain(m)}
                      disabled={retraining}
                      className="btn-ghost"
                      style={{ fontSize: 11, padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      {retraining
                        ? <><Loader size={10} className="spin" /> Queued</>
                        : <><RefreshCw size={10} /> Retrain</>}
                    </button>
                  </td>
                </tr>
              );
            }).reduce<React.ReactNode[]>((acc, row, i) => {
              const m = models[i];
              const rowKey = `${m.coin_id}-${m.horizon}-${m.version}`;
              const sr = m.score_report;
              acc.push(row);
              if (expanded.has(rowKey) && sr) {
                acc.push(
                  <tr key={`detail-${rowKey}`}>
                    <td colSpan={10} style={{ padding: 0 }}>
                      <ScoreDetail sr={sr} />
                    </td>
                  </tr>
                );
              }
              return acc;
            }, [])}
          </tbody>
        </table>
      )}
    </div>
  );
}
