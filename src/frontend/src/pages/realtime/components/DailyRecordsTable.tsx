import Pagination from '../../../components/ui/Pagination';
import { fmt, fmtVolume } from '../../../lib/format';
import type { HistoricalPoint } from '../../../api/client';

interface DailyRecordsTableProps {
  rows: HistoricalPoint[];
  totalRecords: number;
  decimals: number;
  loading: boolean;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

/** Paginated newest-first daily OHLC + volume + SMA records table. */
export default function DailyRecordsTable({
  rows, totalRecords, decimals, loading, page, totalPages, onPageChange,
}: DailyRecordsTableProps) {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans' }}>
          Daily Records
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
          {totalRecords} records · newest first
        </div>
      </div>
      {loading ? (
        <div style={{ padding: '20px' }}>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="skeleton" style={{ height: '40px', borderRadius: '6px', marginBottom: '8px' }} />
          ))}
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th style={{ textAlign: 'right' }}>Close</th>
              <th style={{ textAlign: 'right' }}>High</th>
              <th style={{ textAlign: 'right' }}>Low</th>
              <th style={{ textAlign: 'right' }}>Volume</th>
              <th style={{ textAlign: 'right' }}>SMA 20</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d, i) => (
              <tr key={i}>
                <td>
                  <span className="font-mono" style={{ fontSize: '12px' }}>{d.date.split('T')[0]}</span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className="font-mono" style={{ color: 'var(--accent-light)', fontWeight: 500 }}>
                    {fmt(d.avg_close, decimals)}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className="font-mono" style={{ color: 'var(--up)', fontSize: '12px' }}>
                    {d.daily_high != null ? fmt(d.daily_high, decimals) : '—'}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className="font-mono" style={{ color: 'var(--down)', fontSize: '12px' }}>
                    {d.daily_low != null ? fmt(d.daily_low, decimals) : '—'}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className="font-mono" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {d.avg_volume != null ? fmtVolume(d.avg_volume, false) : '—'}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className="font-mono" style={{ color: d.sma_20 ? 'var(--warn)' : 'var(--text-muted)', fontSize: '12px' }}>
                    {d.sma_20 ? fmt(d.sma_20, decimals) : '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onChange={onPageChange} showTotal />
      )}
    </div>
  );
}
