import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  LayoutDashboard, Activity, BarChart2, Brain, GitBranch,
  Cpu, LogOut, TrendingUp, FileText, ArrowLeft,
} from 'lucide-react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import RealtimePage from './pages/RealtimePage';
import TechnicalPage from './pages/TechnicalPage';
import PredictionsPage from './pages/PredictionsPage';
import CorrelationPage from './pages/CorrelationPage';
import ModelRegistryPage from './pages/ModelRegistryPage';
import LSTMResearchPage from './pages/LSTMResearchPage';
import DocsPage from './pages/DocsPage';
import { fetchStats } from './api/client';
import './index.css';

type Page = 'dashboard' | 'realtime' | 'technical' | 'predictions' | 'correlation' | 'models' | 'lstm-research' | 'docs';
type Coin = 'bitcoin' | 'dogecoin';

const PUBLIC_PAGES = new Set<Page>(['docs', 'lstm-research']);

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
  { id: 'dashboard',   label: 'Overview',        icon: <LayoutDashboard size={15} /> },
  { id: 'realtime',    label: 'Real-time',        icon: <Activity size={15} /> },
  { id: 'technical',   label: 'Technical',        icon: <BarChart2 size={15} /> },
  { id: 'predictions', label: 'Predictions',      icon: <Brain size={15} />, badge: 'LSTM' },
  { id: 'correlation', label: 'Correlation',      icon: <GitBranch size={15} /> },
  { id: 'models',      label: 'Model Registry',   icon: <Cpu size={15} /> },
  { id: 'docs',        label: 'Documents',        icon: <FileText size={15} />, badge: '12' },
];

const pageVariants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -4 },
};

/* ── Public shell (no auth required) ───────────────────────────────────── */
function PublicShell({
  page, setPage,
}: {
  page: Page;
  setPage: (p: Page) => void;
}) {
  return (
    <div style={{ width: '100%', minHeight: '100vh', background: 'var(--bg-base)' }}>
      {/* Top bar */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 30,
        height: '52px',
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '0', padding: '0 24px',
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '20px' }}>
          <div style={{
            width: '26px', height: '26px', borderRadius: '7px',
            background: 'var(--accent-subtle)', border: '1px solid rgba(99,102,241,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <TrendingUp size={13} color="var(--accent-light)" />
          </div>
          <span className="font-display" style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 700, letterSpacing: '-0.03em' }}>
            Bitconiacs
          </span>
        </div>

        <span style={{ color: 'var(--border-active)', fontSize: '18px', marginRight: '12px', userSelect: 'none' }}>/</span>

        {/* Public nav tabs */}
        <div style={{ display: 'flex', gap: '3px' }}>
          <button
            onClick={() => setPage('docs')}
            className={`btn-ghost ${page === 'docs' ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '5px 12px' }}
          >
            <FileText size={12} />
            Documents
          </button>
          <button
            onClick={() => setPage('lstm-research')}
            className={`btn-ghost ${page === 'lstm-research' ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '5px 12px' }}
          >
            <Brain size={12} />
            LSTM Research
          </button>
        </div>

        {/* Back-to-docs breadcrumb when on lstm-research */}
        {page === 'lstm-research' && (
          <button
            onClick={() => setPage('docs')}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              marginLeft: '12px', background: 'none', border: 'none',
              cursor: 'pointer', color: 'var(--text-muted)',
              fontFamily: 'Plus Jakarta Sans', fontSize: '11px',
              padding: '4px 8px', borderRadius: '5px',
              transition: 'color 0.12s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            <ArrowLeft size={11} />
            Back to docs
          </button>
        )}

        <div style={{ flex: 1 }} />

        {/* Sign-in CTA */}
        <button
          onClick={() => setPage('dashboard')}
          className="btn-primary"
          style={{ fontSize: '12px', padding: '7px 16px' }}
        >
          Sign In →
        </button>
      </div>

      {/* Content */}
      <main style={{ paddingTop: '52px', minHeight: '100vh' }}>

        {/* ── Feature-access banner (homepage only) ── */}
        {page === 'docs' && (
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
              {[
                { icon: '📊', label: 'Live Dashboard' },
                { icon: '⚡', label: 'Realtime Prices' },
                { icon: '📈', label: 'Technical Analysis' },
                { icon: '🧠', label: 'LSTM Predictions' },
                { icon: '🔗', label: 'Correlation' },
                { icon: '🤖', label: 'Model Registry' },
              ].map(f => (
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
              onClick={() => setPage('dashboard')}
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
        )}

        <div style={{ padding: '32px 36px' }}>
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
              {page === 'docs'          && <DocsPage onNavigate={(p) => setPage(p as Page)} />}
              {page === 'lstm-research' && <LSTMResearchPage />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

/* ── Authenticated shell ────────────────────────────────────────────────── */
function AppShell() {
  const { user, logout, isAuthenticated, isLoading } = useAuth();
  const [page, setPage] = useState<Page>('docs');
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

  /* ── Loading ── */
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

  /* ── Public pages (no login needed) ── */
  if (!isAuthenticated && PUBLIC_PAGES.has(page)) {
    return <PublicShell page={page} setPage={setPage} />;
  }

  /* ── Login gate ── */
  if (!isAuthenticated) return <LoginPage />;

  /* ── Full authenticated layout ── */
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
            {page === 'models'        && <ModelRegistryPage />}
            {page === 'lstm-research' && <LSTMResearchPage />}
            {page === 'docs'          && <DocsPage onNavigate={(p) => setPage(p as Page)} />}
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
