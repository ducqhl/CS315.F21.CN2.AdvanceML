import { useEffect, useState } from 'react';
import { fetchCorrelation } from '../api/client';
import type { CorrelationResponse } from '../api/client';

function getColor(value: number): string {
  // From red (-1) through white (0) to green/cyan (1)
  if (value >= 0) {
    const t = value;
    const r = Math.round(0 * t + 22 * (1 - t));
    const g = Math.round(212 * t + 22 * (1 - t));
    const b = Math.round(255 * t + 22 * (1 - t));
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    const t = -value;
    const r = Math.round(239 * t + 22 * (1 - t));
    const g = Math.round(83 * t + 22 * (1 - t));
    const b = Math.round(80 * t + 22 * (1 - t));
    return `rgb(${r}, ${g}, ${b})`;
  }
}

function getTextColor(value: number): string {
  return Math.abs(value) > 0.3 ? '#0d1117' : 'var(--text-primary)';
}

function interpretCorrelation(r: number): string {
  const abs = Math.abs(r);
  const direction = r >= 0 ? 'positive' : 'negative';
  if (abs >= 0.9) return `Very strong ${direction} correlation`;
  if (abs >= 0.7) return `Strong ${direction} correlation`;
  if (abs >= 0.5) return `Moderate ${direction} correlation`;
  if (abs >= 0.3) return `Weak ${direction} correlation`;
  return 'Little to no correlation';
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

  if (loading) return <div style={{ color: 'var(--text-secondary)', padding: '40px' }}>Loading...</div>;
  if (error) return <div style={{ color: 'var(--red)', padding: '40px' }}>Error: {error}</div>;
  if (!data) return null;

  const { coins, matrix, docs } = data;
  const mainCorr = docs[0]?.pearson_corr ?? matrix?.['BTC']?.['DOGE'] ?? 0;
  const computedAt = docs[0]?.computed_at?.split('T')[0] ?? '—';

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)' }}>
          Coin Correlation
        </h1>
        <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
          Pearson correlation between BTC and DOGE daily closing prices
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'start' }}>
        {/* Heatmap */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '10px',
          padding: '24px',
        }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '24px' }}>
            Correlation Heatmap
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: '4px' }}>
              <thead>
                <tr>
                  <th style={{ width: '80px' }}></th>
                  {coins.map(c => (
                    <th key={c} style={{
                      width: '100px',
                      padding: '8px',
                      color: 'var(--text-secondary)',
                      fontWeight: 600,
                      fontSize: '13px',
                      textAlign: 'center',
                    }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coins.map(rowCoin => (
                  <tr key={rowCoin}>
                    <td style={{
                      padding: '8px',
                      color: 'var(--text-secondary)',
                      fontWeight: 600,
                      fontSize: '13px',
                      textAlign: 'right',
                      whiteSpace: 'nowrap',
                    }}>
                      {rowCoin}
                    </td>
                    {coins.map(colCoin => {
                      const val = matrix[rowCoin]?.[colCoin] ?? 0;
                      return (
                        <td key={colCoin} style={{
                          width: '100px',
                          height: '80px',
                          background: getColor(val),
                          borderRadius: '8px',
                          textAlign: 'center',
                          verticalAlign: 'middle',
                          cursor: 'default',
                        }}>
                          <div style={{
                            color: getTextColor(val),
                            fontWeight: 700,
                            fontSize: '18px',
                            lineHeight: 1,
                          }}>
                            {val.toFixed(3)}
                          </div>
                          <div style={{
                            color: getTextColor(val),
                            fontSize: '10px',
                            opacity: 0.8,
                            marginTop: '4px',
                          }}>
                            {rowCoin === colCoin ? 'self' : 'Pearson r'}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Color scale legend */}
          <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px' }}>
            <span style={{ color: 'var(--red)' }}>-1</span>
            <div style={{
              flex: 1,
              height: '8px',
              borderRadius: '4px',
              background: 'linear-gradient(to right, rgb(239,83,80), rgb(22,22,22), rgb(0,212,255))',
            }} />
            <span style={{ color: 'var(--accent)' }}>+1</span>
          </div>
        </div>

        {/* Stats panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Main correlation card */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            padding: '24px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              BTC — DOGE Pearson r
            </div>
            <div style={{
              fontSize: '64px',
              fontWeight: 800,
              color: 'var(--accent)',
              letterSpacing: '-2px',
              lineHeight: 1,
              marginBottom: '8px',
            }}>
              {mainCorr.toFixed(3)}
            </div>
            <div style={{
              display: 'inline-block',
              padding: '4px 14px',
              borderRadius: '20px',
              fontSize: '13px',
              fontWeight: 600,
              background: 'rgba(0, 212, 255, 0.1)',
              color: 'var(--accent)',
              border: '1px solid rgba(0, 212, 255, 0.3)',
            }}>
              {interpretCorrelation(mainCorr)}
            </div>
          </div>

          {/* Interpretation */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            padding: '20px',
          }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '12px' }}>
              Interpretation
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
              <p style={{ marginBottom: '10px' }}>
                A Pearson correlation of <strong style={{ color: 'var(--accent)' }}>{mainCorr.toFixed(3)}</strong> between
                BTC and DOGE indicates that the two cryptocurrencies tend to move{' '}
                <strong style={{ color: mainCorr > 0 ? 'var(--green)' : 'var(--red)' }}>
                  {mainCorr > 0 ? 'in the same direction' : 'in opposite directions'}
                </strong>.
              </p>
              <p style={{ marginBottom: '10px' }}>
                This is consistent with the broader crypto market behavior, where{' '}
                altcoins often exhibit high correlation with Bitcoin due to shared{' '}
                market sentiment and trading patterns.
              </p>
              <p>
                <strong style={{ color: 'var(--text-primary)' }}>Computed:</strong>{' '}
                {computedAt}
              </p>
            </div>
          </div>

          {/* Raw data */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            overflow: 'hidden',
          }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Raw Data
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <th style={{ padding: '8px 16px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 500 }}>Pair</th>
                  <th style={{ padding: '8px 16px', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: 500 }}>Pearson r</th>
                  <th style={{ padding: '8px 16px', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: 500 }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 16px', color: 'var(--text-primary)' }}>{d.coin_a} / {d.coin_b}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--accent)', fontWeight: 600 }}>
                      {d.pearson_corr.toFixed(6)}
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                      {d.computed_at?.split('T')[0]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
