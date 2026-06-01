import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  LayoutDashboard, Activity, BarChart2, Brain, GitBranch,
  Cpu, LogOut, TrendingUp,
} from 'lucide-react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import RealtimePage from './pages/RealtimePage';
import TechnicalPage from './pages/TechnicalPage';
import PredictionsPage from './pages/PredictionsPage';
import CorrelationPage from './pages/CorrelationPage';
import ModelRegistryPage from './pages/ModelRegistryPage';
import { fetchStats } from './api/client';
import './index.css';

type Page = 'dashboard' | 'realtime' | 'technical' | 'predictions' | 'correlation' | 'models';
type Coin = 'bitcoin' | 'dogecoin';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    },
  },
});

const NAV_ITEMS: { id: Page; label: string; icon: React.ReactNode; badge?: string }[] = [
  { id: 'dashboard',   label: 'Overview',         icon: <LayoutDashboard size={15} /> },
  { id: 'realtime',    label: 'Real-time',         icon: <Activity size={15} /> },
  { id: 'technical',   label: 'Technical',         icon: <BarChart2 size={15} /> },
  { id: 'predictions', label: 'Predictions',       icon: <Brain size={15} />, badge: 'LSTM' },
  { id: 'correlation', label: 'Correlation',       icon: <GitBranch size={15} /> },
  { id: 'models',      label: 'Model Registry',    icon: <Cpu size={15} /> },
];

const pageVariants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -4 },
};

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
        .then(d => {
          setBtcPrice(d.latest_prices?.BTC?.price ?? null);
          setDogePrice(d.latest_prices?.DOGE?.price ?? null);
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [isAuthenticated]);

  const fmtP = (p: number | null, dec = 2) =>
    p != null
      ? `$${p.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`
      : '—';

  if (isLoading) {
    return (
      <div style={{
        width: '100%', height: '100vh', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-base)', flexDirection: 'column', gap: '14px',
      }}>
        <div className="font-display" style={{ fontSize: '22px', color: 'var(--accent)', letterSpacing: '0.02em' }}>
          Bitconiacs
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans' }}>
          Loading...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return <LoginPage />;

  return (
    <div style={{ display: 'flex', width: '100%', minHeight: '100vh', background: 'var(--bg-base)' }}>
      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <aside style={{
        width: '232px',
        minWidth: '232px',
        flexShrink: 0,
        background: 'var(--bg-card)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        top: 0,
        left: 0,
        height: '100vh',
        zIndex: 20,
      }}>
        {/* Brand */}
        <div style={{ padding: '20px 18px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '9px',
              background: 'var(--accent-subtle)',
              border: '1px solid rgba(99,102,241,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <TrendingUp size={16} color="var(--accent-light)" />
            </div>
            <div>
              <div className="font-display" style={{
                fontSize: '16px', color: 'var(--text-primary)', lineHeight: 1,
                fontWeight: 700, letterSpacing: '-0.03em',
              }}>
                Bitconiacs
              </div>
              <div style={{
                fontSize: '10px', color: 'var(--text-muted)',
                letterSpacing: '0.04em', marginTop: '2px',
                fontFamily: 'Plus Jakarta Sans',
              }}>
                Crypto Analytics
              </div>
            </div>
          </div>
        </div>

        {/* Coin Selector */}
        <div style={{ padding: '12px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{
            fontSize: '10px', color: 'var(--text-muted)',
            letterSpacing: '0.08em', textTransform: 'uppercase',
            fontFamily: 'Plus Jakarta Sans', marginBottom: '8px', paddingLeft: '4px',
          }}>
            Active Asset
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {([
              ['bitcoin',  'BTC',  fmtP(btcPrice, 2)],
              ['dogecoin', 'DOGE', fmtP(dogePrice, 6)],
            ] as const).map(([c, sym, price]) => (
              <button
                key={c}
                onClick={() => setCoin(c)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 10px', borderRadius: '8px', border: 'none',
                  background: coin === c ? 'var(--accent-muted)' : 'transparent',
                  outline: coin === c ? '1px solid rgba(99,102,241,0.2)' : '1px solid transparent',
                  cursor: 'pointer', transition: 'all 0.12s',
                }}
              >
                <span style={{
                  fontSize: '13px', fontWeight: 600,
                  color: coin === c ? 'var(--accent-light)' : 'var(--text-secondary)',
                  fontFamily: 'Plus Jakarta Sans',
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
        <nav style={{ flex: 1, padding: '10px 10px', overflowY: 'auto' }}>
          <div style={{
            fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.08em',
            textTransform: 'uppercase', fontFamily: 'Plus Jakarta Sans',
            padding: '4px 4px 8px',
          }}>
            Navigation
          </div>
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              style={{ marginBottom: '1px' }}
            >
              {item.icon}
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.badge && (
                <span style={{
                  padding: '1px 6px', borderRadius: '5px', fontSize: '9px',
                  fontFamily: 'IBM Plex Mono', fontWeight: 500,
                  background: page === item.id ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
                  color: page === item.id ? 'var(--accent-light)' : 'var(--text-muted)',
                }}>
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* User */}
        <div style={{ padding: '12px 12px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <div style={{
                width: '30px', height: '30px', borderRadius: '8px',
                background: 'var(--purple-subtle)',
                border: '1px solid rgba(167,139,250,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{
                  fontSize: '12px', fontWeight: 600, color: 'var(--purple)',
                  fontFamily: 'Plus Jakarta Sans',
                }}>
                  {user?.username?.[0]?.toUpperCase() ?? 'A'}
                </span>
              </div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans' }}>
                  {user?.username ?? 'admin'}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans' }}>
                  {user?.role ?? 'admin'}
                </div>
              </div>
            </div>
            <button
              onClick={logout}
              title="Sign out"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '6px', borderRadius: '6px', color: 'var(--text-muted)',
                transition: 'color 0.12s', display: 'flex', alignItems: 'center',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────────── */}
      <main style={{
        flex: 1,
        marginLeft: '232px',
        overflow: 'auto',
        minHeight: '100vh',
        padding: '32px 36px',
      }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={page}
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.2 }}
            className="page-content"
          >
            {page === 'dashboard'   && <DashboardPage coin={coin} />}
            {page === 'realtime'    && <RealtimePage coin={coin} />}
            {page === 'technical'   && <TechnicalPage coin={coin} />}
            {page === 'predictions' && <PredictionsPage coin={coin} />}
            {page === 'correlation' && <CorrelationPage />}
            {page === 'models'      && <ModelRegistryPage />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </QueryClientProvider>
  );
}
