import { corrColor, corrBg } from '../correlationScale';

interface CorrelationMatrixProps {
  coins: string[];
  matrix: Record<string, Record<string, number>>;
}

/** Grid of pairwise Pearson coefficients with a color scale legend. */
export default function CorrelationMatrix({ coins, matrix }: CorrelationMatrixProps) {
  return (
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
  );
}
