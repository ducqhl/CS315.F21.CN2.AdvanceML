interface RsiPillProps {
  rsi: number;
}

/** Inline current-RSI status pill with overbought/oversold annotation. */
export default function RsiPill({ rsi }: RsiPillProps) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '8px',
      padding: '5px 12px', borderRadius: '7px', marginBottom: '14px',
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
        Current RSI:
      </span>
      <span className="font-mono" style={{
        fontSize: '13px', fontWeight: 500,
        color: rsi >= 70 ? 'var(--down)' : rsi <= 30 ? 'var(--up)' : 'var(--accent-light)',
      }}>
        {Number(rsi).toFixed(1)}
        {rsi >= 70 && <span style={{ fontSize: '11px', marginLeft: '6px', opacity: 0.8 }}>Overbought</span>}
        {rsi <= 30 && <span style={{ fontSize: '11px', marginLeft: '6px', opacity: 0.8 }}>Oversold</span>}
      </span>
    </div>
  );
}
