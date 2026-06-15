// Shared formatting helpers used across pages.

/** Format a number as a USD price, or an em-dash when nullish. */
export function fmt(n: number | null | undefined, dec = 2): string {
  if (n == null) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

/** Format a coin price for an axis tick (compact for BTC, fixed for DOGE). */
export function fmtAxisPrice(v: number, coin: string): string {
  return coin === 'bitcoin' ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(4)}`;
}

/** Format a trading volume into a compact $B / $M string. */
export function fmtVolume(v: number | null | undefined, withDollar = true): string {
  if (v == null) return '—';
  const prefix = withDollar ? '$' : '';
  return v > 1e9 ? `${prefix}${(v / 1e9).toFixed(2)}B` : `${prefix}${(v / 1e6).toFixed(1)}M`;
}

/** Format a metric value (RMSE / MAE) with $K compaction above 1000. */
export function fmtMetricDollar(v: number | null | undefined): string {
  if (v == null) return '—';
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${v.toFixed(0)}`;
}

/** Relative time string ("5m ago"); resolution scales from seconds to days. */
export function timeAgo(iso?: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
