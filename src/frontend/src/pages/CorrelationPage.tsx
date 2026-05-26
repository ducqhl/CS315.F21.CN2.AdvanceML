import { useEffect, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { fetchCorrelation } from '../api/client';
import type { CorrelationResponse } from '../api/client';

function corrColor(v: number): string {
  if (v >= 0.7) return 'var(--green)';
  if (v >= 0.4) return 'var(--cyan)';
  if (v >= 0.0) return 'var(--gold)';
  if (v >= -0.4) return 'var(--text-secondary)';
  return 'var(--red)';
}

function corrBg(v: number): string {
  if (v >= 0.7) return 'rgba(0,240,160,0.12)';
  if (v >= 0.4) return 'rgba(0,229,255,0.10)';
  if (v >= 0.0) return 'rgba(255,176,32,0.08)';
  if (v >= -0.4) return 'rgba(255,255,255,0.03)';
  return 'rgba(255,56,100,0.10)';
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
  const [data, setData] = useState<CorrelationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchCorrelation()
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <div className="skeleton" style={{ height: '36px', width: '220px', borderRadius: '8px', marginBottom: '28px' }} />
        <div className="skeleton" style={{ height: '260px', borderRadius: '12px', marginBottom: '16px' }} />
        <div className="skeleton" style={{ height: '140px', borderRadius: '12px' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--red)', fontFamily: 'Manrope', fontSize: '14px' }}>
        <GitBranch size={32} style={{ marginBottom: '12px', opacity: 0.5 }} />
        <div>Failed to load correlation data: {error}</div>
      </div>
    );
  }

  if (!data) return null;

  const { coins, matrix, docs } = data;
  const mainCorr = docs[0]?.pearson_corr ?? matrix?.['BTC']?.['DOGE'] ?? 0;
  const computedAt = docs[0]?.computed_at?.split('T')[0] ?? '—';

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <div className="font-display" style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.06em' }}>
          CORRELATION ANALYSIS
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '4px', fontFamily: 'Manrope' }}>
          Pearson correlation coefficient between cryptocurrencies
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start' }}>
        {/* Matrix */}
        <div className="card" style={{ padding: '24px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Manrope', marginBottom: '20px' }}>
            Correlation Matrix
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: '6px' }}>
              <thead>
                <tr>
                  <th style={{ width: '60px' }} />
                  {coins.map(c => (
                    <th key={c} style={{ padding: '8px 12px', color: 'var(--text-secondary)', fontFamily: 'Space Mono', fontSize: '12px', fontWeight: 700, textAlign: 'center', letterSpacing: '0.06em' }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coins.map(row => (
                  <tr key={row}>
                    <td style={{ padding: '8px 12px', color: 'var(--text-secondary)', fontFamily: 'Space Mono', fontSize: '12px', fontWeight: 700, textAlign: 'right', letterSpacing: '0.06em' }}>
                      {row}
                    </td>
                    {coins.map(col => {
                      const val = matrix[row]?.[col] ?? 0;
                      const isDiag = row === col;
                      return (
                        <td key={col} style={{ padding: '4px' }}>
                          <div style={{
                            padding: '14px 20px', borderRadius: '10px', textAlign: 'center', minWidth: '90px',
                            background: isDiag ? 'var(--cyan-10)' : corrBg(val),
                            border: `1px solid ${isDiag ? 'rgba(0,229,255,0.2)' : 'transparent'}`,
                          }}>
                            <div className="font-mono" style={{ fontSize: '18px', fontWeight: 700, color: isDiag ? 'var(--cyan)' : corrColor(val), lineHeight: 1 }}>
                              {val.toFixed(3)}
                            </div>
                            <div style={{ fontSize: '9px', color: isDiag ? 'var(--cyan)' : corrColor(val), opacity: 0.8, marginTop: '4px', fontFamily: 'Manrope', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
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
          {/* Color gradient */}
          <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '10px', fontFamily: 'Manrope' }}>
            <span style={{ color: 'var(--red)' }}>-1</span>
            <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: 'linear-gradient(to right, rgba(255,56,100,0.5), var(--border), rgba(0,240,160,0.5))' }} />
            <span style={{ color: 'var(--green)' }}>+1</span>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="card" style={{ padding: '28px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'Manrope', marginBottom: '16px' }}>
              BTC — DOGE Pearson r
            </div>
            <div className="font-mono glow-cyan" style={{ fontSize: '56px', fontWeight: 700, color: 'var(--cyan)', lineHeight: 1, marginBottom: '12px' }}>
              {mainCorr.toFixed(3)}
            </div>
            <div style={{
              display: 'inline-block', padding: '5px 16px', borderRadius: '20px',
              background: corrBg(mainCorr), border: `1px solid ${corrColor(mainCorr)}40`,
              fontSize: '12px', fontWeight: 600, color: corrColor(mainCorr), fontFamily: 'Manrope',
            }}>
              {corrLabel(mainCorr)}
            </div>
          </div>

          <div className="card" style={{ padding: '20px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Manrope', marginBottom: '12px' }}>
              Interpretation
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.7', fontFamily: 'Manrope' }}>
              A Pearson coefficient of{' '}
              <span className="font-mono" style={{ color: 'var(--cyan)' }}>{mainCorr.toFixed(3)}</span>{' '}
              indicates BTC and DOGE tend to move{' '}
              <strong style={{ color: mainCorr > 0 ? 'var(--green)' : 'var(--red)' }}>
                {mainCorr > 0 ? 'together' : 'inversely'}
              </strong>.
              This reflects shared crypto market sentiment, where altcoins often follow Bitcoin's price action.
              <div style={{ marginTop: '10px', color: 'var(--text-muted)', fontSize: '11px' }}>
                Computed: {computedAt} · Spark batch job
              </div>
            </div>
          </div>

          {docs.length > 0 && (
            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Manrope' }}>
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
                        <span className="font-mono" style={{ color: 'var(--cyan)', fontSize: '12px' }}>{d.coin_a} ↔ {d.coin_b}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="font-mono" style={{ color: corrColor(d.pearson_corr), fontWeight: 700 }}>{d.pearson_corr.toFixed(6)}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="font-mono" style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>{d.computed_at?.split('T')[0]}</span>
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
