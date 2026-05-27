import { cn } from '../../lib/utils';

interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
  icon?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export function MetricCard({ label, value, sub, valueColor, icon, className, children, style }: MetricCardProps) {
  return (
    <div
      className={cn('metric-card bg-bg-card border border-border rounded-xl p-5', className)}
      style={style}
    >
      <div className="flex items-center gap-1.5 mb-2.5">
        {icon && <span className="text-text-secondary">{icon}</span>}
        <span className="metric-label text-[10px] font-semibold text-text-secondary uppercase tracking-widest font-body">
          {label}
        </span>
      </div>
      <div
        className="metric-value font-mono text-[22px] font-bold leading-none"
        style={{ color: valueColor ?? 'var(--text-primary)' }}
      >
        {value}
      </div>
      {sub && (
        <div className="metric-sub text-[11px] text-text-secondary mt-1.5 font-body">
          {sub}
        </div>
      )}
      {children}
    </div>
  );
}
