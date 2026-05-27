import { cn } from '../../lib/utils';

type ButtonVariant = 'primary' | 'ghost' | 'icon';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  active?: boolean;
  size?: 'sm' | 'md';
  children?: React.ReactNode;
}

export function Button({
  variant = 'ghost',
  active = false,
  size = 'md',
  className,
  children,
  ...props
}: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-lg font-body font-semibold transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

  const sizeClass = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
  }[size];

  const variantClass = {
    primary: 'bg-cyan/10 border border-cyan text-cyan hover:bg-cyan/20 shadow-[0_0_12px_rgba(0,229,255,0.15)]',
    ghost: cn(
      'border text-text-secondary hover:text-text-primary',
      active
        ? 'border-cyan text-cyan bg-cyan/5'
        : 'border-border hover:border-border-bright',
    ),
    icon: cn(
      'w-8 h-8 p-0 border',
      active
        ? 'border-cyan text-cyan bg-cyan/5'
        : 'border-border text-text-secondary hover:text-text-primary hover:border-border-bright',
    ),
  }[variant];

  return (
    <button
      className={cn(base, variant !== 'icon' && sizeClass, variantClass, className)}
      {...props}
    >
      {children}
    </button>
  );
}
