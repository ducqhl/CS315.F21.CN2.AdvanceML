export interface LegendItem {
  color: string;
  label: string;
  /** Render the swatch line as dashed (moving averages / signal lines). */
  dash?: boolean;
}

interface ChartLegendProps {
  items: LegendItem[];
  /** Width of the swatch <svg> line (16 on small charts, 20 on the dashboard). */
  swatchWidth?: number;
  /** Gap between legend entries. */
  gap?: number;
  /** Top margin (used below in-card charts). */
  marginTop?: number;
}

/** Inline color-swatch legend rendered beneath line/area charts. */
export default function ChartLegend({ items, swatchWidth = 16, gap = 16, marginTop }: ChartLegendProps) {
  return (
    <div style={{
      display: 'flex', gap: `${gap}px`, fontSize: '11px', fontFamily: 'Plus Jakarta Sans',
      ...(marginTop != null ? { marginTop: `${marginTop}px` } : {}),
    }}>
      {items.map(({ color, label, dash }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <svg width={swatchWidth} height="8">
            <line x1="0" y1="4" x2={swatchWidth} y2="4" stroke={color} strokeWidth="1.5"
              strokeDasharray={dash ? '4 2' : undefined} />
          </svg>
          <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        </div>
      ))}
    </div>
  );
}
