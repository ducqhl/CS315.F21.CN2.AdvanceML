import { RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import JobIcon from './JobIcon';
import { HORIZONS } from '../constants';
import { timeAgo } from '../../../lib/format';
import type { RetrainJob } from '../../../api/client';

interface RetrainPanelProps {
  open: boolean;
  onToggle: () => void;
  retrainJobs: RetrainJob[];
  retrainLoading: boolean;
  onRetrain: (horizon: number) => void;
}

/** Collapsible per-horizon model retraining panel. */
export default function RetrainPanel({ open, onToggle, retrainJobs, retrainLoading, onRetrain }: RetrainPanelProps) {
  return (
    <div className="card" style={{ overflow: 'hidden', marginBottom: '12px' }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', padding: '14px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'none', border: 'none', cursor: 'pointer',
          borderBottom: open ? '1px solid var(--border)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
          <RefreshCw size={14} color="var(--accent-light)" />
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans' }}>
            Model Retraining
          </span>
        </div>
        {open ? <ChevronUp size={14} color="var(--text-secondary)" /> : <ChevronDown size={14} color="var(--text-secondary)" />}
      </button>

      {open && (
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
                    onClick={() => !disabled && onRetrain(h.value)}
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
  );
}
