import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import RealtimePage from './pages/RealtimePage';
import TechnicalPage from './pages/TechnicalPage';
import PredictionsPage from './pages/PredictionsPage';
import CorrelationPage from './pages/CorrelationPage';
import TopBar from './components/layout/TopBar';
import Sidebar from './components/layout/Sidebar';
import { fetchStats } from './api/client';
import './index.css';

type Page = 'dashboard' | 'realtime' | 'technical' | 'predictions' | 'correlation';
type Coin = 'bitcoin' | 'dogecoin';

function AppShell() {
  const { user, logout, isAuthenticated, isLoading } = useAuth();
  const [page, setPage]   = useState<Page>('dashboard');
  const [coin, setCoin]   = useState<Coin>('bitcoin');
  const [btcPrice, setBtcPrice]   = useState<number | null>(null);
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

  if (isLoading) {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center bg-bg-void gap-4">
        <div className="font-display text-xl text-cyan tracking-widest">QUANTUM</div>
        <div className="text-xs text-text-secondary font-body">Initializing...</div>
        <div className="flex gap-1 mt-2">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-cyan animate-pulse-slow"
              style={{ animationDelay: `${i * 0.2}s` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return <LoginPage />;

  return (
    <div className="flex flex-col w-full min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* Fixed top bar */}
      <TopBar btcPrice={btcPrice} dogePrice={dogePrice} />

      {/* Body: sidebar + main */}
      <div className="flex flex-1 overflow-hidden" style={{ marginTop: '40px' }}>
        {/* Grid overlay */}
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            zIndex: 0,
            top: '40px',
            backgroundImage: `
              linear-gradient(rgba(0,229,255,0.018) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,229,255,0.018) 1px, transparent 1px)
            `,
            backgroundSize: '48px 48px',
          }}
        />

        <Sidebar
          page={page}
          setPage={setPage}
          coin={coin}
          setCoin={setCoin}
          btcPrice={btcPrice}
          dogePrice={dogePrice}
          user={user}
          logout={logout}
        />

        <main
          className="flex-1 overflow-auto relative"
          style={{ zIndex: 1, padding: '28px 32px' }}
        >
          <div className="animate-fade-in">
            {page === 'dashboard'   && <DashboardPage coin={coin} />}
            {page === 'realtime'    && <RealtimePage coin={coin} />}
            {page === 'technical'   && <TechnicalPage coin={coin} />}
            {page === 'predictions' && <PredictionsPage coin={coin} />}
            {page === 'correlation' && <CorrelationPage />}
          </div>
        </main>
      </div>
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
