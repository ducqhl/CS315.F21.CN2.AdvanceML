import { cn } from '../../lib/utils';

type BadgeVariant = 'live' | 'batch' | 'up' | 'down' | 'neutral' | 'pill' | 'model' | 'info';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  live:    'bg-green/10 border border-green/25 text-green',
  batch:   'bg-white/5 border border-border text-text-secondary',
  up:      'bg-green/10 border border-green/30 text-green',
  down:    'bg-red/10 border border-red/30 text-red',
  neutral: 'bg-gold/10 border border-gold/30 text-gold',
  pill:    'bg-bg-elevated border border-border text-text-secondary',
  model:   'bg-violet/10 border border-violet/25 text-violet',
  info:    'bg-cyan/10 border border-cyan/25 text-cyan',
};

export function Badge({ variant = 'pill', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider font-mono',
        variantStyles[variant],
        className,
      )}
    >
      {variant === 'live' && (
        <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse-slow" />
      )}
      {children}
    </span>
  );
}
