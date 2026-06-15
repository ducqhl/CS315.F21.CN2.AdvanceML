/** Text color for a Pearson correlation value. */
export function corrColor(v: number): string {
  if (v >= 0.7) return 'var(--up)';
  if (v >= 0.4) return 'var(--accent-light)';
  if (v >= 0.0) return 'var(--warn)';
  if (v >= -0.4) return 'var(--text-secondary)';
  return 'var(--down)';
}

/** Background color for a correlation cell / pill. */
export function corrBg(v: number): string {
  if (v >= 0.7) return 'var(--up-subtle)';
  if (v >= 0.4) return 'var(--accent-muted)';
  if (v >= 0.0) return 'var(--warn-subtle)';
  if (v >= -0.4) return 'var(--bg-elevated)';
  return 'var(--down-subtle)';
}

/** Human-readable strength label for a correlation value. */
export function corrLabel(v: number): string {
  const abs = Math.abs(v);
  const dir = v >= 0 ? 'positive' : 'negative';
  if (abs >= 0.9) return `Very strong ${dir}`;
  if (abs >= 0.7) return `Strong ${dir}`;
  if (abs >= 0.4) return `Moderate ${dir}`;
  if (abs >= 0.2) return `Weak ${dir}`;
  return 'No correlation';
}
