import { motion } from 'framer-motion';
import { Wifi, WifiOff } from 'lucide-react';
import { fmt, fmtVolume } from '../../../lib/format';
import type { PredictionsResponse, RealtimeResponse } from '../../../api/client';

const stagger = {
  animate: { transition: { staggerChildren: 0.04 } },
};
const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.22 } },
};

interface StatCardsProps {
  decimals: number;
  price: number | null;
  realtime?: RealtimeResponse;
  prediction?: PredictionsResponse;
}

/** Top row of four KPI cards: price, 24h range, next-day forecast, volume. */
export default function StatCards({ decimals, price, realtime, prediction }: StatCardsProps) {
  const nextDayP = prediction?.next_day_price;

  return (
    <motion.div
      variants={stagger}
      initial="initial"
      animate="animate"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '16px' }}
    >
      {/* Current price */}
      <motion.div variants={fadeUp} className="metric-card">
        <div className="metric-label">Current Price</div>
        <div className="metric-value" style={{ fontSize: '20px', color: 'var(--text-primary)' }}>
          {fmt(price, decimals)}
        </div>
        <div className="metric-sub" style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '8px' }}>
          {realtime?.source === 'realtime'
            ? <><Wifi size={10} color="var(--up)" /> <span style={{ color: 'var(--up)' }}>Live stream</span></>
            : <><WifiOff size={10} /> Batch data</>}
        </div>
      </motion.div>

      {/* 24h range */}
      <motion.div variants={fadeUp} className="metric-card">
        <div className="metric-label">24h Range</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
          <div className="font-mono" style={{ fontSize: '14px', color: 'var(--up)', fontWeight: 500 }}>
            ↑ {fmt(realtime?.daily_high, decimals)}
          </div>
          <div className="font-mono" style={{ fontSize: '14px', color: 'var(--down)', fontWeight: 500 }}>
            ↓ {fmt(realtime?.daily_low, decimals)}
          </div>
        </div>
      </motion.div>

      {/* Next-day forecast */}
      <motion.div variants={fadeUp} className="metric-card" style={{
        background: nextDayP ? `linear-gradient(135deg, var(--bg-card) 70%, var(--accent-muted))` : 'var(--bg-card)',
      }}>
        <div className="metric-label">Next-Day Forecast</div>
        <div className="metric-value" style={{ color: nextDayP ? 'var(--accent-light)' : 'var(--text-muted)' }}>
          {fmt(nextDayP, decimals)}
        </div>
        {prediction?.model_version && (
          <div className="metric-sub">{prediction.model_version}</div>
        )}
      </motion.div>

      {/* Volume */}
      <motion.div variants={fadeUp} className="metric-card">
        <div className="metric-label">Avg Volume</div>
        <div className="metric-value" style={{ fontSize: '18px' }}>
          {fmtVolume(realtime?.avg_volume)}
        </div>
        <div className="metric-sub">24h trading volume</div>
      </motion.div>
    </motion.div>
  );
}
