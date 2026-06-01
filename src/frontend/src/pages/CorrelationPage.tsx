import { useQuery } from '@tanstack/react-query';
import { fetchCorrelation } from '../api/client';

function corrColor(v: number): string {
  if (v >= 0.7) return 'var(--up)';
  if (v >= 0.4) return 'var(--accent-light)';
  if (v >= 0.0) return 'var(--warn)';
  if (v >= -0.4) return 'var(--text-secondary)';
  return 'var(--down)';
}

function corrBg(v: number): string {
  if (v >= 0.7) return 'var(--up-subtle)';
  if (v >= 0.4) return 'var(--accent-muted)';
  if (v >= 0.0) return 'var(--warn-subtle)';
  if (v >= -0.4) return 'var(--bg-elevated)';
  return 'var(--down-subtle)';
}

function corrLabel(v: number): string {
  const abs = Math.abs(v);
  const dir = v >= 0 ? 'positive' : 'negative';
  if (abs >= 0.9) return `Very strong ${dir}`;
  if (abs >= 0.7) return `Strong ${dir}`;
  if (abs >= 0.4) return `Moderate ${dir}`;
  if (abs >= 0.2) return `Weak ${dir}`;
  return 'No correlation';
}

export default function CorrelationPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['correlation'],
    queryFn:  fetchCorrelation,
    staleTime: 600_000,
  });

  if (isLoading) {
    return (
      <div>
        <div className="skeleton" style={{ height: '32px', width: '260px', borderRadius: '8px', marginBottom: '28px' }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div className="skeleton" style={{ height: '280px', borderRadius: '12px' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="skeleton" style={{ height: '130px', borderRadius: '12px' }} />
            <div className="skeleton" style={{ height: '130px', borderRadius: '12px' }} />
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--down)', fontFamily: 'Plus Jakarta Sans', fontSize: '14px' }}>
        Failed to load correlation data
      </div>
    );
  }

  const { coins, matrix, docs } = data;
  const mainCorr   = docs[0]?.pearson_corr ?? matrix?.['BTC']?.['DOGE'] ?? 0;
  const computedAt = docs[0]?.computed_at?.split('T')[0] ?? '—';

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <h1 className="font-display" style={{ margin: 0, fontSize: '22px', color: 'var(--text-primary)' }}>
          Correlation Analysis
        </h1>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px', fontFamily: 'Plus Jakarta Sans' }}>
          Pearson correlation coefficient between BTC and DOGE
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start' }}>
        {/* Correlation Matrix */}
        <div className="card" style={{ padding: '24px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans', marginBottom: '20px' }}>
            Correlation Matrix
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: '6px' }}>
              <thead>
                <tr>
                  <th style={{ width: '56px' }} />
                  {coins.map(c => (
                    <th key={c} style={{
                      padding: '8px 12px', color: 'var(--text-secondary)',
                      fontFamily: 'IBM Plex Mono', fontSize: '12px', fontWeight: 500,
                      textAlign: 'center', letterSpacing: '0.04em',
                    }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coins.map(row => (
                  <tr key={row}>
                    <td style={{
                      padding: '8px 12px', color: 'var(--text-secondary)',
                      fontFamily: 'IBM Plex Mono', fontSize: '12px', fontWeight: 500,
                      textAlign: 'right',
                    }}>
                      {row}
                    </td>
                    {coins.map(col => {
                      const val    = matrix[row]?.[col] ?? 0;
                      const isDiag = row === col;
                      return (
                        <td key={col} style={{ padding: '3px' }}>
                          <div style={{
                            padding: '14px 18px', borderRadius: '9px', textAlign: 'center', minWidth: '86px',
                            background: isDiag ? 'var(--accent-muted)' : corrBg(val),
                            border: `1px solid ${isDiag ? 'rgba(99,102,241,0.2)' : 'transparent'}`,
                          }}>
                            <div className="font-mono" style={{
                              fontSize: '18px', fontWeight: 500,
                              color: isDiag ? 'var(--accent-light)' : corrColor(val),
                              lineHeight: 1,
                            }}>
                              {val.toFixed(3)}
                            </div>
                            <div style={{
                              fontSize: '9px', marginTop: '4px',
                              color: isDiag ? 'var(--accent-light)' : corrColor(val),
                              opacity: 0.7, fontFamily: 'Plus Jakarta Sans',
                              textTransform: 'uppercase', letterSpacing: '0.04em',
                            }}>
                              {isDiag ? 'self' : 'Pearson r'}
                            </div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Color scale */}
          <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '10px', fontFamily: 'Plus Jakarta Sans' }}>
            <span style={{ color: 'var(--down)' }}>−1</span>
            <div style={{
              flex: 1, height: '5px', borderRadius: '3px',
              background: 'linear-gradient(to right, rgba(239,68,68,0.5), var(--border), rgba(34,197,94,0.5))',
            }} />
            <span style={{ color: 'var(--up)' }}>+1</span>
          </div>
        </div>

        {/* Stats column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Main coefficient hero */}
          <div className="card" style={{ padding: '28px', textAlign: 'center' }}>
            <div style={{
              fontSize: '10px', color: 'var(--text-secondary)', letterSpacing: '0.08em',
              textTransform: 'uppercase', fontFamily: 'Plus Jakarta Sans', marginBottom: '14px',
            }}>
              BTC — DOGE Pearson r
            </div>
            <div className="font-mono" style={{
              fontSize: '52px', fontWeight: 500, color: corrColor(mainCorr),
              lineHeight: 1, marginBottom: '12px',
            }}>
              {mainCorr.toFixed(3)}
            </div>
            <div style={{
              display: 'inline-block', padding: '4px 14px', borderRadius: '6px',
              background: corrBg(mainCorr),
              fontSize: '12px', fontWeight: 600, color: corrColor(mainCorr),
              fontFamily: 'Plus Jakarta Sans',
            }}>
              {corrLabel(mainCorr)}
            </div>
          </div>

          {/* Interpretation card */}
          <div className="card" style={{ padding: '20px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans', marginBottom: '10px' }}>
              Interpretation
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.7', fontFamily: 'Plus Jakarta Sans' }}>
              A coefficient of{' '}
              <span className="font-mono" style={{ color: corrColor(mainCorr) }}>
                {mainCorr.toFixed(3)}
              </span>{' '}
              indicates BTC and DOGE tend to move{' '}
              <strong style={{ color: mainCorr > 0 ? 'var(--up)' : 'var(--down)' }}>
                {mainCorr > 0 ? 'together' : 'inversely'}
              </strong>.
              This reflects shared crypto market sentiment where altcoins often follow Bitcoin's price action.
            </div>
            <div style={{
              marginTop: '12px', fontSize: '11px', color: 'var(--text-muted)',
              fontFamily: 'Plus Jakarta Sans',
            }}>
              Computed: {computedAt} · Spark batch job
            </div>
          </div>

          {/* Raw data table */}
          {docs.length > 0 && (
            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{
                padding: '13px 18px', borderBottom: '1px solid var(--border)',
                fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)',
                fontFamily: 'Plus Jakarta Sans',
              }}>
                Raw Data
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Pair</th>
                    <th style={{ textAlign: 'right' }}>Pearson r</th>
                    <th style={{ textAlign: 'right' }}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d, i) => (
                    <tr key={i}>
                      <td>
                        <span className="font-mono" style={{ color: 'var(--accent-light)', fontSize: '12px' }}>
                          {d.coin_a} ↔ {d.coin_b}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="font-mono" style={{ color: corrColor(d.pearson_corr), fontWeight: 500 }}>
                          {d.pearson_corr.toFixed(6)}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="font-mono" style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
                          {d.computed_at?.split('T')[0]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
