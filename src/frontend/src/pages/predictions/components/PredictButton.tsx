import { CheckCircle, XCircle, Loader, Play } from 'lucide-react';
import type { PredictJob } from '../../../api/client';

interface PredictButtonProps {
  job?: PredictJob;
  busy: boolean;
  onRun: () => void;
}

/** On-demand "Predict Now" button reflecting the live job status. */
export default function PredictButton({ job, busy, onRun }: PredictButtonProps) {
  const running = job?.status === 'pending' || job?.status === 'running' || busy;
  const done    = job?.status === 'completed';
  const failed  = job?.status === 'failed';

  const label = running ? (job?.status === 'running' ? 'Running…' : 'Queued…')
    : done   ? 'Re-run'
    : failed ? 'Retry'
    : 'Predict Now';

  return (
    <button
      onClick={() => !running && onRun()}
      disabled={running}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '7px', flexShrink: 0,
        padding: '8px 16px', borderRadius: '8px',
        fontSize: '12px', fontWeight: 600, fontFamily: 'Plus Jakarta Sans',
        border: `1px solid ${running ? 'var(--border)' : 'rgba(99,102,241,0.4)'}`,
        background: running ? 'transparent' : 'var(--accent-muted)',
        color: running ? 'var(--text-muted)' : 'var(--accent-light)',
        cursor: running ? 'not-allowed' : 'pointer',
        transition: 'all 0.15s ease',
      }}
    >
      {running ? <Loader size={12} className="spin" />
        : done ? <CheckCircle size={12} color="var(--up)" />
        : failed ? <XCircle size={12} color="var(--down)" />
        : <Play size={12} />}
      {label}
    </button>
  );
}
