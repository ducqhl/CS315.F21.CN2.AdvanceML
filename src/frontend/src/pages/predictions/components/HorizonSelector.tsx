import { Zap } from 'lucide-react';
import { HORIZONS, type HorizonValue } from '../constants';
import type { ModelRegistryEntry } from '../../../api/client';

interface HorizonSelectorProps {
  activeHorizon: HorizonValue;
  models: ModelRegistryEntry[];
  onSelect: (h: HorizonValue) => void;
}

/** Three-card forecast-horizon picker (H7 / H15 / H60), one per independent model. */
export default function HorizonSelector({ activeHorizon, models, onSelect }: HorizonSelectorProps) {
  return (
    <div style={{ marginBottom: '18px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        fontSize: '10px', fontFamily: 'Plus Jakarta Sans', fontWeight: 600,
        color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase',
        marginBottom: '10px',
      }}>
        <Zap size={10} color="var(--accent-light)" />
        Forecast Horizon — independent models, click to view
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
        {HORIZONS.map(h => {
          const isActive = h.value === activeHorizon;
          const entry    = models.find(m => m.horizon === h.value);
          const hasModel = entry?.model_exists ?? false;

          return (
            <div
              key={h.value}
              onClick={() => !isActive && onSelect(h.value as HorizonValue)}
              style={{
                padding: '16px', borderRadius: '11px', position: 'relative',
                border: isActive ? '1px solid rgba(99,102,241,0.35)' : '1px solid var(--border)',
                background: isActive ? 'var(--accent-muted)' : 'var(--bg-card)',
                cursor: isActive ? 'default' : hasModel ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s ease',
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
                  viewing
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
                  {hasModel ? 'View →' : 'No model'}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
