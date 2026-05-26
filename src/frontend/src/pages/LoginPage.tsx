import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Zap, Lock, User, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login({ username, password });
    } catch {
      setError('Invalid credentials. Access denied.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      width: '100%',
      minHeight: '100vh',
      background: 'var(--bg-void)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Grid background */}
      <div className="grid-bg" style={{
        position: 'absolute', inset: 0,
        backgroundImage: `
          linear-gradient(rgba(0,229,255,0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,229,255,0.04) 1px, transparent 1px)
        `,
        backgroundSize: '60px 60px',
      }} />

      {/* Glow orbs */}
      <div style={{
        position: 'absolute',
        top: '20%', left: '15%',
        width: '500px', height: '500px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(0,229,255,0.06) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        bottom: '15%', right: '10%',
        width: '400px', height: '400px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(139,92,246,0.07) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Login panel */}
      <div style={{
        position: 'relative',
        zIndex: 1,
        width: '100%',
        maxWidth: '420px',
        margin: '0 24px',
      }}>
        {/* Top accent line */}
        <div style={{
          height: '2px',
          background: 'linear-gradient(90deg, transparent, var(--cyan), transparent)',
          borderRadius: '1px',
          marginBottom: '-1px',
        }} />

        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '16px',
          padding: '40px',
          boxShadow: '0 0 40px rgba(0,229,255,0.06), 0 32px 64px rgba(0,0,0,0.5)',
        }}>
          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: '36px' }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '56px', height: '56px',
              borderRadius: '14px',
              background: 'var(--cyan-10)',
              border: '1px solid rgba(0,229,255,0.2)',
              marginBottom: '20px',
            }}>
              <Zap size={26} color="var(--cyan)" />
            </div>
            <div className="font-display" style={{
              fontSize: '22px',
              fontWeight: 800,
              color: 'var(--cyan)',
              letterSpacing: '0.12em',
              lineHeight: 1,
            }}>
              QUANTUM
            </div>
            <div style={{
              fontSize: '11px',
              color: 'var(--text-secondary)',
              marginTop: '6px',
              fontFamily: 'Manrope, sans-serif',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}>
              Crypto Intelligence Terminal
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: '8px',
                fontFamily: 'Manrope, sans-serif',
              }}>
                Username
              </label>
              <div style={{ position: 'relative' }}>
                <User
                  size={15}
                  color="var(--text-muted)"
                  style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)' }}
                />
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="input-field"
                  placeholder="admin"
                  autoComplete="username"
                  style={{ paddingLeft: '40px' }}
                  required
                />
              </div>
            </div>

            <div style={{ marginBottom: '28px' }}>
              <label style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: '8px',
                fontFamily: 'Manrope, sans-serif',
              }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <Lock
                  size={15}
                  color="var(--text-muted)"
                  style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)' }}
                />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="input-field"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  style={{ paddingLeft: '40px' }}
                  required
                />
              </div>
            </div>

            {error && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 14px',
                background: 'var(--red-10)',
                border: '1px solid rgba(255,56,100,0.25)',
                borderRadius: '8px',
                marginBottom: '20px',
                fontSize: '13px',
                color: 'var(--red)',
                fontFamily: 'Manrope, sans-serif',
              }}>
                <AlertCircle size={15} />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '13px',
                background: loading ? 'var(--bg-elevated)' : 'var(--cyan-10)',
                border: `1px solid ${loading ? 'var(--border)' : 'var(--cyan)'}`,
                borderRadius: '9px',
                color: loading ? 'var(--text-secondary)' : 'var(--cyan)',
                fontFamily: 'Orbitron, sans-serif',
                fontSize: '13px',
                fontWeight: 700,
                letterSpacing: '0.1em',
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: loading ? 'none' : '0 0 16px rgba(0,229,255,0.15)',
              }}
            >
              {loading ? 'AUTHENTICATING...' : 'AUTHENTICATE'}
            </button>
          </form>

          {/* Footer */}
          <div style={{
            marginTop: '28px',
            paddingTop: '20px',
            borderTop: '1px solid var(--border-dim)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '11px',
            color: 'var(--text-muted)',
            fontFamily: 'Manrope, sans-serif',
            justifyContent: 'center',
          }}>
            <div className="pulse-dot green" />
            Lambda Architecture · LSTM Dual-Head v2 · BTC/DOGE
          </div>
        </div>
      </div>
    </div>
  );
}
