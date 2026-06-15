import { Clock, Cpu } from 'lucide-react';
import { timeAgo } from '../../../lib/format';
import type { InferenceStatusResponse, StatsResponse } from '../../../api/client';

interface Outlook {
  label: string;
  color: string;
  Icon: React.ElementType;
  count: string;
}

interface StatusRowProps {
  symbol: string;
  outlook: Outlook;
  inference?: InferenceStatusResponse;
  stats?: StatsResponse;
}

/** Inference-engine health dot color based on status + last run age. */
function inferenceColor(status?: string, lastRun?: string): string {
  if (status === 'error') return 'var(--down)';
  if (!lastRun) return 'var(--down)';
  const age = (Date.now() - new Date(lastRun).getTime()) / 60000;
  if (age < 6) return 'var(--up)';
  if (age < 15) return 'var(--warn)';
  return 'var(--down)';
}

/** Second dashboard row: outlook, inference engine status and data collections. */
export default function StatusRow({ symbol, outlook, inference, stats }: StatusRowProps) {
  const btcJob  = inference?.jobs?.['BTC'];
  const dogeJob = inference?.jobs?.['DOGE'];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '16px' }}>
      {/* 7d outlook */}
      <div className="metric-card" style={{
        borderColor: outlook ? 'rgba(0,0,0,0)' : 'var(--border)',
        backgroundImage: outlook ? `linear-gradient(135deg, var(--bg-card) 55%, ${outlook.color}0A)` : undefined,
      }}>
        <div className="metric-label">7-Day Outlook · {symbol}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '2px' }}>
          <outlook.Icon size={18} color={outlook.color} />
          <span className="font-display" style={{ fontSize: '16px', color: outlook.color }}>
            {outlook.label}
          </span>
        </div>
        <div className="metric-sub">{outlook.count} days confirmed</div>
      </div>

      {/* Inference status */}
      <div className="metric-card">
        <div className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Cpu size={10} /> Inference Engine
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
          {[['BTC', btcJob], ['DOGE', dogeJob]].map(([sym, job]) => {
            const j = job as typeof btcJob;
            return (
              <div key={sym as string} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0, background: inferenceColor(j?.status, j?.last_run_at) }} />
                <span className="font-mono" style={{ fontSize: '11px', color: 'var(--accent-light)', minWidth: '36px' }}>{sym as string}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
                  {j?.last_run_at ? timeAgo(j.last_run_at) : 'no data'}
                </span>
              </div>
            );
          })}
        </div>
        <div className="metric-sub" style={{ marginTop: '8px' }}>
          <Clock size={9} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
          Every {inference?.interval_seconds ?? 300}s
        </div>
      </div>

      {/* Collection sizes */}
      <div className="metric-card">
        <div className="metric-label">Data Collections</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '2px' }}>
          {Object.entries(stats?.doc_counts ?? {}).slice(0, 4).map(([name, count]) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
                {name.replace(/_/g, ' ')}
              </span>
              <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-primary)' }}>
                {(count as number).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
