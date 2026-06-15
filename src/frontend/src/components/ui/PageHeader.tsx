interface PageHeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  /** Optional content rendered on the right of the header row. */
  right?: React.ReactNode;
  /** Aligns the right content to the start when items differ in height (Predictions). */
  alignStart?: boolean;
  /** Bottom margin in px (default 28). Predictions uses 24. */
  marginBottom?: number;
}

/**
 * Standard page header: a display-font H1 title with a secondary subtitle line,
 * and optional right-aligned content. Used on every authenticated page.
 */
export default function PageHeader({ title, subtitle, right, alignStart = true, marginBottom = 28 }: PageHeaderProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: alignStart ? 'flex-start' : 'center',
      justifyContent: 'space-between',
      marginBottom: `${marginBottom}px`,
    }}>
      <div>
        <h1 className="font-display" style={{ margin: 0, fontSize: '22px', color: 'var(--text-primary)' }}>
          {title}
        </h1>
        {subtitle != null && (
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px', fontFamily: 'Plus Jakarta Sans' }}>
            {subtitle}
          </div>
        )}
      </div>
      {right}
    </div>
  );
}
