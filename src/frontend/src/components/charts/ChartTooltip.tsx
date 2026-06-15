import { fmt } from '../../lib/format';

interface ChartTooltipProps {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  /** Decimal places for the value (price tooltips). */
  decimals?: number;
  /** Custom value formatter; overrides `decimals`-based price formatting. */
  format?: (value: number) => string;
  /** Skip rows whose value is nullish (Predictions / Technical). */
  skipNull?: boolean;
}

/**
 * Recharts custom tooltip used by the price/forecast/MACD charts.
 * Renders a color-swatch + name + formatted value per series.
 */
export default function ChartTooltip({
  active, payload, label, decimals = 2, format, skipNull = false,
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const fmtValue = format ?? ((v: number) => fmt(v, decimals));
  return (
    <div className="chart-tooltip">
      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '5px', fontFamily: 'IBM Plex Mono' }}>
        {label}
      </div>
      {payload.map((p, i) => (
        (!skipNull || p.value != null) && (
          <div key={i} style={{ display: 'flex', gap: '7px', alignItems: 'center', marginBottom: '2px' }}>
            <div style={{ width: '7px', height: '7px', borderRadius: '2px', background: p.color }} />
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flex: 1, fontFamily: 'Plus Jakarta Sans' }}>{p.name}</span>
            <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-primary)' }}>{fmtValue(p.value)}</span>
          </div>
        )
      ))}
    </div>
  );
}
