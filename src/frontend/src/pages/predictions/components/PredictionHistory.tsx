import { Brain, ChevronDown, ChevronUp } from 'lucide-react';
import DirectionBadge from './DirectionBadge';
import Pagination from '../../../components/ui/Pagination';
import { fmt } from '../../../lib/format';
import type { PredictionPoint } from '../../../api/client';

interface PredictionHistoryProps {
  open: boolean;
  onToggle: () => void;
  totalRecords: number;
  rows: PredictionPoint[];
  decimals: number;
  page: number;
  totalPages: number;
  pageWindow: number[];
  onPageChange: (page: number) => void;
}

/** Collapsible historical prediction-run table with windowed pagination. */
export default function PredictionHistory({
  open, onToggle, totalRecords, rows, decimals, page, totalPages, pageWindow, onPageChange,
}: PredictionHistoryProps) {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', padding: '14px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'none', border: 'none', cursor: 'pointer',
          borderBottom: open ? '1px solid var(--border)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
          <Brain size={14} color="var(--purple)" />
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans' }}>
            Prediction Run History
          </span>
          <span style={{
            padding: '1px 7px', borderRadius: '5px', fontSize: '10px', fontFamily: 'IBM Plex Mono',
            background: 'var(--purple-subtle)', color: 'var(--purple)',
          }}>
            {totalRecords}
          </span>
        </div>
        {open ? <ChevronUp size={14} color="var(--text-secondary)" /> : <ChevronDown size={14} color="var(--text-secondary)" />}
      </button>
      {open && (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>Prediction Date</th>
                <th style={{ textAlign: 'right' }}>Predicted</th>
                <th style={{ textAlign: 'right' }}>Actual</th>
                <th style={{ textAlign: 'right' }}>Error</th>
                <th style={{ textAlign: 'center' }}>Direction</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={i}>
                  <td><span className="font-mono" style={{ fontSize: '12px' }}>{p.prediction_date.split('T')[0]}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="font-mono" style={{ color: 'var(--warn)', fontWeight: 500 }}>{fmt(p.predicted_price, decimals)}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="font-mono" style={{ color: p.actual_price ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {p.actual_price ? fmt(p.actual_price, decimals) : '—'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {p.error_pct != null ? (
                      <span className="font-mono" style={{
                        fontSize: '11px', fontWeight: 500,
                        color: Math.abs(p.error_pct) < 2 ? 'var(--up)' : Math.abs(p.error_pct) < 5 ? 'var(--warn)' : 'var(--down)',
                      }}>
                        {p.error_pct >= 0 ? '+' : ''}{p.error_pct.toFixed(2)}%
                      </span>
                    ) : <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <DirectionBadge direction={p.direction} prob={p.direction_prob} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              pages={pageWindow}
              showTotal
              onChange={onPageChange}
            />
          )}
        </>
      )}
    </div>
  );
}
