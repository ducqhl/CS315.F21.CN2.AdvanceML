import { cn } from '../../lib/utils';

type CardVariant = 'default' | 'elevated' | 'highlight';
type AccentColor = 'cyan' | 'green' | 'red' | 'gold' | 'violet';

interface CardProps {
  variant?: CardVariant;
  accent?: AccentColor;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  style?: React.CSSProperties;
}

const accentBorderColor: Record<AccentColor, string> = {
  cyan:   '#00E5FF',
  green:  '#00F0A0',
  red:    '#FF3864',
  gold:   '#FFB020',
  violet: '#8B5CF6',
};

export function Card({ variant = 'default', accent, className, children, onClick, style }: CardProps) {
  const base = 'rounded-xl border transition-colors duration-150';

  const variantClass = {
    default:  'bg-bg-card border-border',
    elevated: 'bg-bg-elevated border-border-bright',
    highlight: 'bg-bg-card border-border',
  }[variant];

  const highlightStyle = variant === 'highlight' && accent
    ? { borderLeftColor: accentBorderColor[accent], borderLeftWidth: '3px' }
    : {};

  return (
    <div
      className={cn(base, variantClass, onClick && 'cursor-pointer hover:border-border-bright', className)}
      style={{ ...highlightStyle, ...style }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
