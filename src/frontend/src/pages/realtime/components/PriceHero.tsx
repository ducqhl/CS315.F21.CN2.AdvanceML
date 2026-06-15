import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { fmt, fmtVolume } from '../../../lib/format';
import type { RealtimeResponse } from '../../../api/client';

interface PriceHeroProps {
  symbol: string;
  decimals: number;
  price: number | null;
  priceChange: number | null;
  rangeLabel: string;
  realtime?: RealtimeResponse;
  loading: boolean;
}

/** Animated current-price hero card with 24h high/low/volume column. */
export default function PriceHero({
  symbol, decimals, price, priceChange, rangeLabel, realtime, loading,
}: PriceHeroProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="card"
      style={{ padding: '28px 32px', marginBottom: '14px' }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '24px', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px' }}>
            Current Price · {symbol}
          </div>
          {loading ? (
            <div className="skeleton" style={{ height: '48px', width: '240px', borderRadius: '8px' }} />
          ) : (
            <>
              <div className="font-mono" style={{ fontSize: '44px', fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1 }}>
                {fmt(price, decimals)}
              </div>
              {priceChange != null && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px',
                  marginTop: '10px', fontSize: '13px', fontWeight: 600, fontFamily: 'Plus Jakarta Sans',
                  color: priceChange >= 0 ? 'var(--up)' : 'var(--down)',
                }}>
                  {priceChange >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}% ({rangeLabel})
                </div>
              )}
            </>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '3px' }}>24h High</div>
            <div className="font-mono" style={{ fontSize: '15px', color: 'var(--up)' }}>{fmt(realtime?.daily_high, decimals)}</div>
          </div>
          <div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '3px' }}>24h Low</div>
            <div className="font-mono" style={{ fontSize: '15px', color: 'var(--down)' }}>{fmt(realtime?.daily_low, decimals)}</div>
          </div>
          <div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '3px' }}>Volume</div>
            <div className="font-mono" style={{ fontSize: '15px', color: 'var(--text-primary)' }}>
              {fmtVolume(realtime?.avg_volume)}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
