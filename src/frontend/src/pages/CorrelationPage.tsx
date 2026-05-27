import { useEffect, useState, useMemo } from 'react';
import { GitBranch } from 'lucide-react';
import { fetchCorrelation, fetchHistorical } from '../api/client';
import type { CorrelationResponse, HistoricalPoint } from '../api/client';
import { Card, MetricCard, Skeleton } from '../components/ui';
import { TwoLineChart } from '../components/charts/TwoLineChart';
import type { LineDataPoint } from '../components/charts/TwoLineChart';

function corrColor(v: number): string {
  if (v >= 0.7)  return '#00F0A0';
  if (v >= 0.4)  return '#00E5FF';
  if (v >= 0.0)  return '#FFB020';
  if (v >= -0.4) return '#556070';
  return '#FF3864';
}

function corrBg(v: number): string {
  if (v >= 0.7)  return 'rgba(0,240,160,0.12)';
  if (v >= 0.4)  return 'rgba(0,229,255,0.10)';
  if (v >= 0.0)  return 'rgba(255,176,32,0.08)';
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

/** Normalize a price series so the first value = 100. */
function normalize(points: HistoricalPoint[]): LineDataPoint[] {
  if (!points.length) return [];
  const base = points[0].avg_close;
  return points.map(d => ({
    time:  d.date.split('T')[0],
    value: (d.avg_close / base) * 100,
  }));
}

export default function CorrelationPage() {
  const [data,       setData]       = useState<CorrelationResponse | null>(null);
  const [btcHistory, setBtcHistory] = useState<HistoricalPoint[]>([]);
  const [dogeHistory,setDogeHistory]= useState<HistoricalPoint[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      fetchCorrelation(),
      fetchHistorical('bitcoin',  90),
      fetchHistorical('dogecoin', 90),
    ]).then(results => {
      if (results[0].status === 'fulfilled') setData(results[0].value);
      if (results[1].status === 'fulfilled') setBtcHistory(results[1].value);
      if (results[2].status === 'fulfilled') setDogeHistory(results[2].value);
      if (results[0].status === 'rejected') setError(String(results[0].reason));
    }).finally(() => setLoading(false));
  }, []);

  const btcNorm  = useMemo(() => normalize(btcHistory),  [btcHistory]);
  const dogeNorm = useMemo(() => normalize(dogeHistory), [dogeHistory]);

  if (loading) {
    return (
      <div>
        <Skeleton style={{ height: '36px', width: '220px', borderRadius: '8px', marginBottom: '28px' }} />
        <Skeleton style={{ height: '220px', borderRadius: '12px', marginBottom: '16px' }} />
        <Skeleton style={{ height: '260px', borderRadius: '12px', marginBottom: '16px' }} />
        <Skeleton style={{ height: '140px', borderRadius: '12px' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-red font-body text-sm">
        <GitBranch size={32} style={{ opacity: 0.5 }} />
        <div>Failed to load correlation data: {error}</div>
      </div>
    );
  }

  if (!data) return null;

  const { coins, matrix, docs } = data;
  const mainCorr   = docs[0]?.pearson_corr ?? matrix?.['BTC']?.['DOGE'] ?? 0;
  const computedAt = docs[0]?.computed_at?.split('T')[0] ?? '—';

  return (
    <div>
      {/* Header */}
      <div className="mb-7">
        <h1 className="font-display text-lg font-bold text-text-primary tracking-wider m-0">CORRELATION ANALYSIS</h1>
        <p className="text-text-secondary text-xs mt-1 font-body">
          Pearson correlation coefficient between cryptocurrencies
        </p>
      </div>

      {/* Normalized price comparison chart */}
      {(btcNorm.length > 0 || dogeNorm.length > 0) && (
        <Card className="mb-5 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <div className="text-[13px] font-semibold text-text-primary font-body">
              Normalized Price Comparison (90 days · base = 100)
            </div>
            <div className="flex items-center gap-4 text-[11px] font-body">
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-0.5 rounded bg-cyan" />
                <span className="text-text-secondary">BTC</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-0.5 rounded bg-gold" />
                <span className="text-text-secondary">DOGE</span>
              </div>
            </div>
          </div>
          <TwoLineChart
            lineA={btcNorm}
            lineB={dogeNorm}
            colorA="#00E5FF"
            colorB="#FFB020"
            height={200}
            labelA="BTC (normalized)"
            labelB="DOGE (normalized)"
          />
        </Card>
      )}

      <div className="grid grid-cols-2 gap-5 items-start">
        {/* Correlation matrix */}
        <Card className="p-6">
          <div className="text-[13px] font-semibold text-text-primary font-body mb-5">Correlation Matrix</div>
          <div className="overflow-x-auto">
            <table style={{ borderCollapse: 'separate', borderSpacing: '6px' }}>
              <thead>
                <tr>
                  <th style={{ width: '60px' }} />
                  {coins.map(c => (
                    <th key={c} className="px-3 py-2 text-text-secondary font-mono text-xs font-bold text-center tracking-widest">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coins.map(row => (
                  <tr key={row}>
                    <td className="px-3 py-2 text-text-secondary font-mono text-xs font-bold text-right tracking-widest">{row}</td>
                    {coins.map(col => {
                      const val    = matrix[row]?.[col] ?? 0;
                      const isDiag = row === col;
                      return (
                        <td key={col} className="p-1">
                          <div
                            className="px-5 py-3.5 rounded-xl text-center min-w-[90px]"
                            style={{
                              background: isDiag ? 'rgba(0,229,255,0.10)' : corrBg(val),
                              border: `1px solid ${isDiag ? 'rgba(0,229,255,0.2)' : 'transparent'}`,
                            }}
                          >
                            <div
                              className="font-mono text-lg font-bold leading-none"
                              style={{ color: isDiag ? '#00E5FF' : corrColor(val) }}
                            >
                              {val.toFixed(3)}
                            </div>
                            <div
                              className="text-[9px] mt-1 font-body uppercase tracking-widest"
                              style={{ color: isDiag ? 'rgba(0,229,255,0.8)' : corrColor(val), opacity: 0.9 }}
                            >
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
          {/* Color legend */}
          <div className="flex items-center gap-2.5 mt-5 text-[10px] font-body">
            <span style={{ color: '#FF3864' }}>-1</span>
            <div className="flex-1 h-1.5 rounded-full" style={{ background: 'linear-gradient(to right, rgba(255,56,100,0.5), var(--border), rgba(0,240,160,0.5))' }} />
            <span style={{ color: '#00F0A0' }}>+1</span>
          </div>
        </Card>

        {/* Right column: big pearson value + interpretation */}
        <div className="flex flex-col gap-4">
          <Card className="p-7 text-center">
            <div className="text-[10px] text-text-secondary uppercase tracking-widest font-body mb-4">
              BTC — DOGE Pearson r
            </div>
            <div
              className="font-mono glow-cyan text-[56px] font-bold leading-none mb-3"
              style={{ color: '#00E5FF' }}
            >
              {mainCorr.toFixed(3)}
            </div>
            <div
              className="inline-block px-4 py-1.5 rounded-full text-sm font-semibold font-body"
              style={{ background: corrBg(mainCorr), border: `1px solid ${corrColor(mainCorr)}40`, color: corrColor(mainCorr) }}
            >
              {corrLabel(mainCorr)}
            </div>
          </Card>

          <MetricCard
            label="Computed at"
            value={computedAt}
            valueColor="var(--text-primary)"
            sub="Spark batch aggregation"
            className="font-mono"
          />

          <Card className="p-5">
            <div className="text-xs font-semibold text-text-primary font-body mb-3">Interpretation</div>
            <div className="text-xs text-text-secondary leading-relaxed font-body">
              A Pearson coefficient of{' '}
              <span className="font-mono text-cyan">{mainCorr.toFixed(3)}</span>{' '}
              indicates BTC and DOGE tend to move{' '}
              <strong style={{ color: mainCorr > 0 ? '#00F0A0' : '#FF3864' }}>
                {mainCorr > 0 ? 'together' : 'inversely'}
              </strong>.
              {' '}This reflects shared crypto market sentiment, where altcoins often follow Bitcoin's price action.
            </div>
          </Card>

          {docs.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border text-xs font-semibold text-text-primary font-body">
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
                      <td><span className="font-mono text-xs text-cyan">{d.coin_a} ↔ {d.coin_b}</span></td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="font-mono font-bold" style={{ color: corrColor(d.pearson_corr) }}>{d.pearson_corr.toFixed(6)}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="font-mono text-[11px] text-text-secondary">{d.computed_at?.split('T')[0]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
