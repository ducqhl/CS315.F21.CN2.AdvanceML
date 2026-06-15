import { Loader, Archive } from 'lucide-react';
import DirectionBadge from './DirectionBadge';
import Pagination from '../../../components/ui/Pagination';
import { fmt } from '../../../lib/format';
import type { PredictionPoint } from '../../../api/client';

interface ForecastTableProps {
  periodLabel: string;
  decimals: number;
  loading: boolean;
  viewingArchived: boolean;
  modelLabel: string;
  rows: PredictionPoint[];
  historicalMap: Record<string, number>;
  pageOffset: number;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

/** Daily forecast table with predicted vs. actual, error % and direction columns. */
export default function ForecastTable({
  periodLabel, decimals, loading, viewingArchived, modelLabel,
  rows, historicalMap, pageOffset, page, totalPages, onPageChange,
}: ForecastTableProps) {
  return (
    <div className="card" style={{ overflow: 'hidden', marginBottom: '12px', position: 'relative' }}>
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 2, borderRadius: '12px',
          background: 'rgba(10,10,15,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Loader size={20} color="var(--accent-light)" className="spin" />
        </div>
      )}
      <div style={{
        padding: '13px 20px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans' }}>
          {periodLabel} Daily Forecast
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans', display: 'flex', alignItems: 'center', gap: '6px' }}>
          Model:{' '}
          <span className="font-mono" style={{ color: viewingArchived ? 'var(--warn)' : 'var(--purple)' }}>
            {modelLabel}
          </span>
          {viewingArchived && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '3px',
              padding: '1px 6px', borderRadius: '4px', fontSize: '9px',
              background: 'rgba(234,179,8,0.12)', color: 'var(--warn)',
              border: '1px solid var(--warn-border, rgba(234,179,8,0.25))',
            }}>
              <Archive size={8} /> archived
            </span>
          )}
        </div>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Date</th>
            <th style={{ textAlign: 'right' }}>Predicted</th>
            <th style={{ textAlign: 'right' }}>Actual</th>
            <th style={{ textAlign: 'right' }}>Error</th>
            <th style={{ textAlign: 'center' }}>Direction</th>
            <th style={{ textAlign: 'right' }}>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={i}>
              <td>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: '22px', height: '22px', borderRadius: '5px',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono',
                }}>{pageOffset + i + 1}</span>
              </td>
              <td>
                <span className="font-mono" style={{ fontSize: '12px' }}>
                  {p.prediction_date.split('T')[0]}
                </span>
              </td>
              <td style={{ textAlign: 'right' }}>
                <span className="font-mono" style={{ fontSize: '13px', fontWeight: 500, color: 'var(--accent-light)' }}>
                  {fmt(p.predicted_price, decimals)}
                </span>
              </td>
              <td style={{ textAlign: 'right' }}>
                {(() => {
                  const dateKey = p.prediction_date.slice(0, 10);
                  const actual = historicalMap[dateKey];
                  return actual != null
                    ? <span className="font-mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{fmt(actual, decimals)}</span>
                    : <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>;
                })()}
              </td>
              <td style={{ textAlign: 'right' }}>
                {(() => {
                  const dateKey = p.prediction_date.slice(0, 10);
                  const actual = historicalMap[dateKey];
                  if (actual == null) return <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>—</span>;
                  const errPct = (p.predicted_price - actual) / actual * 100;
                  const color = Math.abs(errPct) < 2 ? 'var(--up)' : Math.abs(errPct) < 5 ? 'var(--warn)' : 'var(--down)';
                  return (
                    <span className="font-mono" style={{ fontSize: '11px', fontWeight: 500, color }}>
                      {errPct >= 0 ? '+' : ''}{errPct.toFixed(2)}%
                    </span>
                  );
                })()}
              </td>
              <td style={{ textAlign: 'center' }}>
                <DirectionBadge direction={p.direction} prob={p.direction_prob} />
              </td>
              <td style={{ textAlign: 'right' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '7px' }}>
                  <div style={{ width: '40px', height: '3px', borderRadius: '2px', background: 'var(--border)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${p.confidence * 100}%`, background: 'var(--purple)' }} />
                  </div>
                  <span className="font-mono" style={{ fontSize: '10px', color: 'var(--text-secondary)', minWidth: '28px' }}>
                    {(p.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onChange={onPageChange} />
      )}
    </div>
  );
}
