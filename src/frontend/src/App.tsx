import { useState, useEffect } from 'react';
import {
  LayoutDashboard, Activity, BarChart2, Brain, GitBranch,
  Zap, LogOut,
} from 'lucide-react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import RealtimePage from './pages/RealtimePage';
import TechnicalPage from './pages/TechnicalPage';
import PredictionsPage from './pages/PredictionsPage';
import CorrelationPage from './pages/CorrelationPage';
import { fetchStats } from './api/client';
import './index.css';

type Page = 'dashboard' | 'realtime' | 'technical' | 'predictions' | 'correlation';
type Coin = 'bitcoin' | 'dogecoin';

const NAV_ITEMS: { id: Page; label: string; icon: React.ReactNode; badge?: string }[] = [
  { id: 'dashboard',    label: 'Overview',         icon: <LayoutDashboard size={16} /> },
  { id: 'realtime',     label: 'Real-time',        icon: <Activity size={16} /> },
  { id: 'technical',    label: 'Technical',        icon: <BarChart2 size={16} /> },
  { id: 'predictions',  label: 'Predictions',      icon: <Brain size={16} />, badge: 'v2' },
  { id: 'correlation',  label: 'Correlation',      icon: <GitBranch size={16} /> },
];

function AppShell() {
  const { user, logout, isAuthenticated, isLoading } = useAuth();
  const [page, setPage] = useState<Page>('dashboard');
  const [coin, setCoin] = useState<Coin>('bitcoin');
  const [btcPrice, setBtcPrice] = useState<number | null>(null);
  const [dogePrice, setDogePrice] = useState<number | null>(null);
  useEffect(() => {
    if (!isAuthenticated) return;
    const load = () => {
      fetchStats()
        .then(data => {
          setBtcPrice(data.latest_prices?.BTC?.price ?? null);
          setDogePrice(data.latest_prices?.DOGE?.price ?? null);
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  const formatP = (p: number | null, dec = 2) =>
    p != null ? `$${p.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}` : '—';

  if (isLoading) {
    return (
      <div style={{
        width: '100%', height: '100vh', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-void)', flexDirection: 'column', gap: '16px',
      }}>
        <div className="font-display" style={{ fontSize: '20px', color: 'var(--cyan)', letterSpacing: '0.12em' }}>
          QUANTUM
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'Manrope' }}>
          Initializing...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return <LoginPage />;

  return (
    <div style={{ display: 'flex', width: '100%', minHeight: '100vh', background: 'var(--bg-primary)' }}>
      {/* Grid background overlay */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        backgroundImage: `
          linear-gradient(rgba(0,229,255,0.02) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,229,255,0.02) 1px, transparent 1px)
        `,
        backgroundSize: '48px 48px',
      }} />

      {/* Sidebar */}
      <aside style={{
        position: 'relative', zIndex: 10,
        width: '220px', minWidth: '220px', flexShrink: 0,
        background: 'var(--bg-card)',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Logo */}
        <div style={{
          padding: '20px 20px 18px',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <div style={{
              width: '30px', height: '30px', borderRadius: '8px',
              background: 'var(--cyan-10)', border: '1px solid rgba(0,229,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Zap size={16} color="var(--cyan)" />
            </div>
            <div>
              <div className="font-display" style={{
                fontSize: '14px', fontWeight: 800, color: 'var(--cyan)',
                letterSpacing: '0.1em', lineHeight: 1,
              }}>
                QUANTUM
              </div>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.06em', marginTop: '2px', fontFamily: 'Manrope' }}>
                CRYPTO TERMINAL
              </div>
            </div>
          </div>
        </div>

        {/* Coin selector */}
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'Manrope', marginBottom: '8px', paddingLeft: '2px' }}>
            Active Market
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {([['bitcoin', 'BTC', formatP(btcPrice)], ['dogecoin', 'DOGE', formatP(dogePrice, 6)]] as const).map(([c, sym, price]) => (
              <button
                key={c}
                onClick={() => setCoin(c)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 10px', borderRadius: '8px',
                  border: coin === c ? '1px solid rgba(0,229,255,0.25)' : '1px solid transparent',
                  background: coin === c ? 'var(--cyan-05)' : 'transparent',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                <span className="font-display" style={{
                  fontSize: '12px', fontWeight: 700,
                  color: coin === c ? 'var(--cyan)' : 'var(--text-secondary)',
                  letterSpacing: '0.06em',
                }}>
                  {sym}
                </span>
                <span className="font-mono" style={{
                  fontSize: '11px',
                  color: coin === c ? 'var(--text-primary)' : 'var(--text-muted)',
                }}>
                  {price}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: '10px 10px' }}>
          <div style={{ fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'Manrope', padding: '6px 4px 8px', marginBottom: '2px' }}>
            Navigation
          </div>
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              style={{ marginBottom: '2px' }}
            >
              {item.icon}
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.badge && (
                <span style={{
                  padding: '1px 6px', borderRadius: '10px', fontSize: '9px',
                  background: page === item.id ? 'rgba(0,229,255,0.15)' : 'var(--bg-elevated)',
                  color: page === item.id ? 'var(--cyan)' : 'var(--text-muted)',
                  fontFamily: 'Space Mono', fontWeight: 700, letterSpacing: '0.04em',
                  border: '1px solid transparent',
                  borderColor: page === item.id ? 'rgba(0,229,255,0.2)' : 'transparent',
                }}>
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* User / logout */}
        <div style={{
          padding: '12px 14px',
          borderTop: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '28px', height: '28px', borderRadius: '7px',
                background: 'var(--violet-10)', border: '1px solid rgba(139,92,246,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--violet)', fontFamily: 'Space Mono' }}>
                  {user?.username?.[0]?.toUpperCase() ?? 'A'}
                </span>
              </div>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Manrope' }}>
                  {user?.username ?? 'admin'}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'Manrope' }}>
                  {user?.role ?? 'admin'}
                </div>
              </div>
            </div>
            <button
              onClick={logout}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '6px', borderRadius: '6px',
                color: 'var(--text-muted)', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center',
              }}
              title="Logout"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main style={{
        flex: 1, overflow: 'auto', padding: '28px 32px',
        position: 'relative', zIndex: 1,
      }}>
        {page === 'dashboard'    && <DashboardPage coin={coin} />}
        {page === 'realtime'     && <RealtimePage coin={coin} />}
        {page === 'technical'    && <TechnicalPage coin={coin} />}
        {page === 'predictions'  && <PredictionsPage coin={coin} />}
        {page === 'correlation'  && <CorrelationPage />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
