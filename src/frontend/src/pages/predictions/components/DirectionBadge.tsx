import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

/** UP / DOWN / FLAT pill with optional probability percentage. */
export default function DirectionBadge({ direction, prob }: { direction?: string; prob?: number }) {
  const pct = prob != null ? ` ${(prob * 100).toFixed(0)}%` : '';
  if (direction === 'UP')   return <span className="badge-up"><TrendingUp size={9} /> UP{pct}</span>;
  if (direction === 'DOWN') return <span className="badge-down"><TrendingDown size={9} /> DOWN{pct}</span>;
  return <span className="badge-flat"><Minus size={9} /> FLAT{pct}</span>;
}
