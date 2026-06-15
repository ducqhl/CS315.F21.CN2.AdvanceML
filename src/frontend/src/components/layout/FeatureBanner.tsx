import { TrendingUp } from 'lucide-react';

const FEATURES = [
  { icon: '📊', label: 'Live Dashboard' },
  { icon: '⚡', label: 'Realtime Prices' },
  { icon: '📈', label: 'Technical Analysis' },
  { icon: '🧠', label: 'LSTM Predictions' },
  { icon: '🔗', label: 'Correlation' },
  { icon: '🤖', label: 'Model Registry' },
];

interface FeatureBannerProps {
  onSignIn: () => void;
}

/** Sign-in-to-unlock feature banner shown on the public docs homepage. */
export default function FeatureBanner({ onSignIn }: FeatureBannerProps) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(167,139,250,0.06) 100%)',
      borderBottom: '1px solid rgba(99,102,241,0.15)',
      padding: '14px 36px',
      display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap',
    }}>
      {/* Left: label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <div style={{
          width: '6px', height: '6px', borderRadius: '50%',
          background: 'var(--up)', boxShadow: '0 0 6px var(--up)',
          animation: 'none',
        }} />
        <span style={{
          fontFamily: 'Plus Jakarta Sans', fontSize: '12px', fontWeight: 600,
          color: 'var(--text-secondary)',
        }}>
          Đăng nhập để truy cập đầy đủ tính năng:
        </span>
      </div>

      {/* Feature chips */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', flex: 1 }}>
        {FEATURES.map(f => (
          <span
            key={f.label}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px',
              padding: '3px 10px', borderRadius: '20px',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              fontFamily: 'Plus Jakarta Sans', fontSize: '11px', fontWeight: 500,
              color: 'var(--text-secondary)',
            }}
          >
            <span style={{ fontSize: '11px' }}>{f.icon}</span>
            {f.label}
          </span>
        ))}
      </div>

      {/* CTA button */}
      <button
        onClick={onSignIn}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '8px 18px', borderRadius: '8px',
          background: 'var(--accent)', border: 'none',
          color: '#fff', cursor: 'pointer',
          fontFamily: 'Plus Jakarta Sans', fontSize: '12px', fontWeight: 600,
          transition: 'background 0.15s, transform 0.1s',
          flexShrink: 0,
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-light)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'var(--accent)')}
        onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.97)')}
        onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
      >
        <TrendingUp size={13} />
        Đăng nhập ngay
      </button>
    </div>
  );
}
