import { Layers, Sparkles, Archive } from 'lucide-react';
import PredictButton from './PredictButton';
import type { ModelRegistryEntry, PredictJob } from '../../../api/client';

interface ModelVersionSelectorProps {
  activeHorizon: number;
  activeVersions: ModelRegistryEntry[];
  selectedModel: ModelRegistryEntry | null;
  viewingArchived: boolean;
  hasForecast: boolean;
  selectedJob?: PredictJob;
  predicting: boolean;
  onSelectModel: (modelId: string) => void;
  onPredictNow: (model: ModelRegistryEntry) => void;
}

/** Per-horizon model-version chips + archived-build action bar. */
export default function ModelVersionSelector({
  activeHorizon, activeVersions, selectedModel, viewingArchived, hasForecast,
  selectedJob, predicting, onSelectModel, onPredictNow,
}: ModelVersionSelectorProps) {
  return (
    <div className="card" style={{ padding: '16px 18px', marginBottom: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
        <Layers size={12} color="var(--accent-light)" />
        <span style={{
          fontSize: '10px', fontFamily: 'Plus Jakarta Sans', fontWeight: 600,
          color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>
          H{activeHorizon} Model Version
        </span>
        <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans' }}>
          · newest runs live · pick an archived build to compare
        </span>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {activeVersions.map(m => {
          const isSel = m.model_id === selectedModel?.model_id;
          return (
            <button
              key={m.model_id}
              onClick={() => onSelectModel(m.model_id)}
              title={m.model_id}
              style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                padding: '8px 12px', borderRadius: '9px', cursor: 'pointer',
                fontFamily: 'IBM Plex Mono', fontSize: '12px',
                border: isSel ? '1px solid rgba(99,102,241,0.45)' : '1px solid var(--border)',
                background: isSel ? 'var(--accent-muted)' : 'var(--bg-elevated)',
                color: isSel ? 'var(--accent-light)' : 'var(--text-secondary)',
                transition: 'all 0.15s ease',
              }}
            >
              {m.is_newest ? <Sparkles size={11} /> : <Archive size={11} />}
              <span style={{ fontWeight: 500 }}>{m.version_label}</span>
              {m.is_newest && (
                <span style={{
                  padding: '1px 6px', borderRadius: '4px', fontSize: '8px',
                  letterSpacing: '0.05em', textTransform: 'uppercase',
                  background: 'var(--accent-subtle)', color: 'var(--accent-light)',
                  border: '1px solid rgba(99,102,241,0.25)',
                }}>
                  default
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Archived-version action bar */}
      {viewingArchived && selectedModel && (
        <div style={{
          marginTop: '12px', padding: '12px 14px', borderRadius: '9px',
          border: '1px solid var(--warn-border, rgba(234,179,8,0.25))',
          background: 'linear-gradient(135deg, var(--bg-elevated) 60%, rgba(234,179,8,0.06))',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
            <Archive size={14} color="var(--warn)" />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans' }}>
                Archived build · <span className="font-mono">{selectedModel.model_id}</span>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans', marginTop: '2px' }}>
                {hasForecast
                  ? 'Showing this version’s forecast. Re-run to refresh from the latest seed.'
                  : 'No forecast stored yet — run it on demand to generate one.'}
              </div>
            </div>
          </div>
          <PredictButton
            job={selectedJob}
            busy={predicting}
            onRun={() => onPredictNow(selectedModel)}
          />
        </div>
      )}
    </div>
  );
}
