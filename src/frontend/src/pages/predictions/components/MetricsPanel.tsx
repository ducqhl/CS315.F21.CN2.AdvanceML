import DirectionBadge from './DirectionBadge';
import { fmt } from '../../../lib/format';
import type { PredictionsResponse } from '../../../api/client';

interface Outlook {
  label: string;
  color: string;
  Icon: React.ElementType;
  count: string;
}

interface MetricsPanelProps {
  predictions?: PredictionsResponse;
  decimals: number;
  periodLabel: string;
  outlook: Outlook;
}

/** Right-hand metric stack: next-day forecast, period high/low and outlook. */
export default function MetricsPanel({ predictions, decimals, periodLabel, outlook }: MetricsPanelProps) {
  const first = predictions?.predictions?.[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* Next-day */}
      <div className="card" style={{
        padding: '16px',
        borderColor: 'rgba(99,102,241,0.2)',
        background: 'linear-gradient(135deg, var(--bg-card) 60%, var(--accent-muted))',
      }}>
        <div style={{ fontSize: '10px', fontFamily: 'Plus Jakarta Sans', fontWeight: 600, color: 'var(--accent-light)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px' }}>
          Next-Day Forecast
        </div>
        <div className="font-mono" style={{ fontSize: '20px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '10px', lineHeight: 1 }}>
          {fmt(predictions?.next_day_price, decimals)}
        </div>
        {first && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <DirectionBadge direction={first.direction} prob={first.direction_prob} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '44px', height: '3px', borderRadius: '2px', background: 'var(--border)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${(first.confidence ?? 0) * 100}%`,
                  background: 'var(--purple)',
                }} />
              </div>
              <span className="font-mono" style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                {((first.confidence ?? 0) * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Period high */}
      <div className="card" style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: '10px', fontFamily: 'Plus Jakarta Sans', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '4px' }}>
          {periodLabel} High
        </div>
        <div className="font-mono" style={{ fontSize: '15px', color: 'var(--up)' }}>
          {fmt(predictions?.seven_day_high, decimals)}
        </div>
      </div>

      {/* Period low */}
      <div className="card" style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: '10px', fontFamily: 'Plus Jakarta Sans', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '4px' }}>
          {periodLabel} Low
        </div>
        <div className="font-mono" style={{ fontSize: '15px', color: 'var(--down)' }}>
          {fmt(predictions?.seven_day_low, decimals)}
        </div>
      </div>

      {/* Outlook */}
      <div className="card" style={{
        padding: '14px 16px',
        background: `linear-gradient(135deg, var(--bg-card) 60%, ${outlook.color}0A)`,
      }}>
        <div style={{ fontSize: '10px', fontFamily: 'Plus Jakarta Sans', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '6px' }}>
          {periodLabel} Outlook
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <outlook.Icon size={16} color={outlook.color} />
          <span className="font-display" style={{ fontSize: '14px', color: outlook.color }}>
            {outlook.label}
          </span>
        </div>
        <div style={{ fontSize: '10px', fontFamily: 'Plus Jakarta Sans', color: 'var(--text-secondary)', marginTop: '4px' }}>
          {outlook.count} days
        </div>
      </div>
    </div>
  );
}
