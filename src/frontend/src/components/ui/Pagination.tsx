interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  /** Explicit list of page numbers to render (e.g. a windowed range). Defaults to 1…totalPages. */
  pages?: number[];
  /** Render a trailing "of N" label after the page numbers (Realtime / history tables). */
  showTotal?: boolean;
}

/**
 * Prev / numbered-pages / Next control shared by every paginated table.
 * Visual output matches the original inline implementation exactly.
 */
export default function Pagination({ page, totalPages, onChange, pages, showTotal = false }: PaginationProps) {
  const pageList = pages ?? Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <div style={{
      padding: '12px 20px', borderTop: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="btn-ghost"
        style={{ fontSize: '11px', padding: '5px 14px', opacity: page === 1 ? 0.4 : 1 }}
      >
        ← Prev
      </button>
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        {pageList.map(p => (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={p === page ? undefined : 'btn-ghost'}
            style={{
              fontSize: '10px', padding: '4px 8px', borderRadius: '5px',
              fontFamily: 'IBM Plex Mono', cursor: 'pointer',
              background: p === page ? 'var(--accent-subtle)' : 'transparent',
              border: p === page ? '1px solid rgba(99,102,241,0.3)' : '1px solid transparent',
              color: p === page ? 'var(--accent-light)' : 'var(--text-secondary)',
            }}
          >
            {p}
          </button>
        ))}
        {showTotal && (
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans', marginLeft: '4px' }}>
            of {totalPages}
          </span>
        )}
      </div>
      <button
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        className="btn-ghost"
        style={{ fontSize: '11px', padding: '5px 14px', opacity: page === totalPages ? 0.4 : 1 }}
      >
        Next →
      </button>
    </div>
  );
}
