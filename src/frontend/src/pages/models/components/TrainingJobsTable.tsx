import { RefreshCw, Loader } from 'lucide-react';
import StatusBadge from './StatusBadge';
import { timeAgo } from '../../../lib/format';
import type { RetrainJob } from '../../../api/client';

interface TrainingJobsTableProps {
  jobs: RetrainJob[];
  loading: boolean;
}

/** Auto-refreshing feed of retrain job rows. */
export default function TrainingJobsTable({ jobs, loading }: TrainingJobsTableProps) {
  return (
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
          {loading && <Loader size={12} color="var(--accent-light)" className="spin" />}
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
  );
}
