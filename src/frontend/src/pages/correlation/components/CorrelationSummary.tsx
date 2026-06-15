import { corrColor, corrBg, corrLabel } from '../correlationScale';
import type { CorrelationResponse } from '../../../api/client';

interface CorrelationSummaryProps {
  mainCorr: number;
  computedAt: string;
  docs: CorrelationResponse['docs'];
}

/** Stats column: hero coefficient, interpretation copy and raw-data table. */
export default function CorrelationSummary({ mainCorr, computedAt, docs }: CorrelationSummaryProps) {
  return (
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
  );
}
