import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Zap, Lock, User, AlertCircle, TrendingUp } from 'lucide-react';

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
      setError('Invalid credentials. Access denied.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full min-h-screen flex items-center justify-center relative overflow-hidden bg-bg-void">
      {/* Grid background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(0,229,255,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,229,255,0.04) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />

      {/* Glow orbs */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: '20%', left: '15%',
          width: '500px', height: '500px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,229,255,0.06) 0%, transparent 70%)',
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          bottom: '15%', right: '10%',
          width: '400px', height: '400px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(139,92,246,0.07) 0%, transparent 70%)',
        }}
      />

      {/* Stats strip — decorative background */}
      <div className="absolute bottom-12 left-0 right-0 flex justify-center gap-16 pointer-events-none opacity-30">
        {['Kafka · Real-time', 'Spark Streaming', 'LSTM Dual-Head', 'MongoDB'].map(item => (
          <span key={item} className="font-mono text-[10px] text-text-secondary tracking-widest">{item}</span>
        ))}
      </div>

      {/* Login panel */}
      <div className="relative z-10 w-full max-w-md mx-6 animate-slide-up">
        {/* Top gradient line */}
        <div
          className="h-0.5 rounded-t-sm"
          style={{ background: 'linear-gradient(90deg, transparent, #00E5FF, transparent)' }}
        />

        <div
          className="bg-bg-card border border-border rounded-b-2xl p-10"
          style={{ boxShadow: '0 0 40px rgba(0,229,255,0.06), 0 32px 64px rgba(0,0,0,0.5)' }}
        >
          {/* Logo */}
          <div className="text-center mb-9">
            <div
              className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-5"
              style={{ background: 'var(--cyan-10)', border: '1px solid rgba(0,229,255,0.2)' }}
            >
              <Zap size={26} color="#00E5FF" />
            </div>
            <div className="font-display text-[22px] font-extrabold text-cyan tracking-widest leading-none">
              QUANTUM
            </div>
            <div className="text-[11px] text-text-secondary mt-1.5 font-body uppercase tracking-widest">
              Crypto Intelligence Terminal
            </div>

            {/* Mini feature badges */}
            <div className="flex items-center justify-center gap-2 mt-4 flex-wrap">
              {['BTC', 'DOGE', 'LSTM v2', 'Live'].map(tag => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold tracking-wider border"
                  style={{ background: 'rgba(0,229,255,0.05)', borderColor: 'rgba(0,229,255,0.15)', color: 'var(--text-secondary)' }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            {/* Username */}
            <div className="mb-4">
              <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-widest mb-2 font-body">
                Username
              </label>
              <div className="relative">
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

            {/* Password */}
            <div className="mb-7">
              <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-widest mb-2 font-body">
                Password
              </label>
              <div className="relative">
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

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg mb-5 text-sm text-red font-body border"
                style={{ background: 'var(--red-10)', borderColor: 'rgba(255,56,100,0.25)' }}>
                <AlertCircle size={15} className="flex-shrink-0" />
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-xl font-display text-[13px] font-bold tracking-widest transition-all duration-150 cursor-pointer"
              style={{
                background: loading ? 'var(--bg-elevated)' : 'var(--cyan-10)',
                border: `1px solid ${loading ? 'var(--border)' : '#00E5FF'}`,
                color: loading ? 'var(--text-secondary)' : '#00E5FF',
                boxShadow: loading ? 'none' : '0 0 20px rgba(0,229,255,0.18)',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full" />
                  AUTHENTICATING...
                </span>
              ) : 'AUTHENTICATE'}
            </button>
          </form>

          {/* Footer */}
          <div className="flex items-center justify-center gap-2 mt-7 pt-5 border-t border-border-dim text-[11px] text-text-muted font-body">
            <div className="pulse-dot green" style={{ width: '6px', height: '6px' }} />
            <span>Lambda Architecture</span>
            <span className="text-border">·</span>
            <TrendingUp size={10} />
            <span>LSTM Dual-Head v2</span>
            <span className="text-border">·</span>
            <span>BTC / DOGE</span>
          </div>
        </div>
      </div>
    </div>
  );
}
