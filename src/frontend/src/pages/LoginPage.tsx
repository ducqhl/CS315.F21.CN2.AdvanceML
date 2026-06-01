import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../auth/AuthContext';
import { TrendingUp, Lock, User, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login({ username, password });
    } catch {
      setError('Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      width: '100%', minHeight: '100vh',
      background: 'var(--bg-base)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Ambient background blobs */}
      <div style={{
        position: 'absolute', top: '10%', left: '-5%',
        width: '600px', height: '600px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 65%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '5%', right: '-8%',
        width: '500px', height: '500px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(167,139,250,0.05) 0%, transparent 65%)',
        pointerEvents: 'none',
      }} />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '400px', margin: '0 24px' }}
      >
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '16px',
          padding: '40px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        }}>
          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: '36px' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '52px', height: '52px', borderRadius: '14px',
              background: 'var(--accent-subtle)',
              border: '1px solid rgba(99,102,241,0.25)',
              marginBottom: '18px',
            }}>
              <TrendingUp size={24} color="var(--accent-light)" />
            </div>
            <div className="font-display" style={{ fontSize: '26px', color: 'var(--text-primary)', lineHeight: 1, fontWeight: 700, letterSpacing: '-0.03em' }}>
              Bitconiacs
            </div>
            <div style={{
              fontSize: '12px', color: 'var(--text-secondary)',
              marginTop: '6px', fontFamily: 'Plus Jakarta Sans',
              letterSpacing: '0.02em',
            }}>
              Crypto Analytics · Lambda Architecture
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Username */}
            <div style={{ marginBottom: '14px' }}>
              <label style={{
                display: 'block', fontSize: '11px', fontWeight: 600,
                color: 'var(--text-secondary)', textTransform: 'uppercase',
                letterSpacing: '0.07em', marginBottom: '7px',
                fontFamily: 'Plus Jakarta Sans',
              }}>
                Username
              </label>
              <div style={{ position: 'relative' }}>
                <User size={14} color="var(--text-muted)" style={{
                  position: 'absolute', left: '13px', top: '50%',
                  transform: 'translateY(-50%)', pointerEvents: 'none',
                }} />
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="input-field"
                  placeholder="admin"
                  autoComplete="username"
                  style={{ paddingLeft: '38px' }}
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div style={{ marginBottom: '24px' }}>
              <label style={{
                display: 'block', fontSize: '11px', fontWeight: 600,
                color: 'var(--text-secondary)', textTransform: 'uppercase',
                letterSpacing: '0.07em', marginBottom: '7px',
                fontFamily: 'Plus Jakarta Sans',
              }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={14} color="var(--text-muted)" style={{
                  position: 'absolute', left: '13px', top: '50%',
                  transform: 'translateY(-50%)', pointerEvents: 'none',
                }} />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="input-field"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  style={{ paddingLeft: '38px' }}
                  required
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 13px',
                background: 'var(--down-subtle)',
                border: '1px solid var(--down-border)',
                borderRadius: '8px', marginBottom: '18px',
                fontSize: '13px', color: 'var(--down)',
                fontFamily: 'Plus Jakarta Sans',
              }}>
                <AlertCircle size={14} />
                {error}
              </div>
            )}

            {/* Submit */}
            <motion.button
              type="submit"
              disabled={loading}
              whileTap={{ scale: 0.98 }}
              style={{
                width: '100%', padding: '12px',
                background: loading ? 'var(--bg-elevated)' : 'var(--accent)',
                border: 'none', borderRadius: '9px',
                color: loading ? 'var(--text-muted)' : '#fff',
                fontFamily: 'Plus Jakarta Sans', fontSize: '14px', fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
              }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </motion.button>
          </form>

          {/* Footer */}
          <div style={{
            marginTop: '28px', paddingTop: '20px',
            borderTop: '1px solid var(--border)',
            textAlign: 'center', fontSize: '11px',
            color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans',
            lineHeight: '1.6',
          }}>
            BTC · DOGE · LSTM dual-head v3
            <br />
            Spark Streaming + Batch · FastAPI
          </div>
        </div>
      </motion.div>
    </div>
  );
}
