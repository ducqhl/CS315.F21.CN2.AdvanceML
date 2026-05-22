import { useState, useEffect } from 'react';
import {
  Activity,
  TrendingUp,
  Brain,
  GitBranch,
  Zap,
} from 'lucide-react';
import { fetchStats } from './api/client';
import RealtimePage from './pages/RealtimePage';
import TechnicalPage from './pages/TechnicalPage';
import PredictionsPage from './pages/PredictionsPage';
import CorrelationPage from './pages/CorrelationPage';
import './index.css';

type Page = 'realtime' | 'technical' | 'predictions' | 'correlation';
type Coin = 'bitcoin' | 'dogecoin';

const NAV_ITEMS: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: 'realtime', label: 'Real-time Prices', icon: <Activity size={18} /> },
  { id: 'technical', label: 'Technical Analysis', icon: <TrendingUp size={18} /> },
  { id: 'predictions', label: 'LSTM Predictions', icon: <Brain size={18} /> },
  { id: 'correlation', label: 'Correlation', icon: <GitBranch size={18} /> },
];

export default function App() {
  const [page, setPage] = useState<Page>('realtime');
  const [coin, setCoin] = useState<Coin>('bitcoin');
  const [btcPrice, setBtcPrice] = useState<number | null>(null);
  const [dogePrice, setDogePrice] = useState<number | null>(null);

  useEffect(() => {
    fetchStats()
      .then(data => {
        setBtcPrice(data.latest_prices?.BTC?.price ?? null);
        setDogePrice(data.latest_prices?.DOGE?.price ?? null);
      })
      .catch(() => {});

    const interval = setInterval(() => {
      fetchStats()
        .then(data => {
          setBtcPrice(data.latest_prices?.BTC?.price ?? null);
          setDogePrice(data.latest_prices?.DOGE?.price ?? null);
        })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatPrice = (p: number | null, decimals = 2) =>
    p != null ? `$${p.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}` : '—';

  return (
    <div style={{ display: 'flex', width: '100%', minHeight: '100vh', background: 'var(--bg-primary)' }}>
      {/* Sidebar */}
      <aside style={{
        width: '240px',
        minWidth: '240px',
        background: 'var(--bg-card)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '0',
      }}>
        {/* Logo */}
        <div style={{
          padding: '20px 20px 16px',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <Zap size={22} color="var(--accent)" />
            <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
              Crypto Big Data
            </span>
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Lambda Architecture Dashboard</span>
        </div>

        {/* Coin Selector */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Select Coin
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {(['bitcoin', 'dogecoin'] as Coin[]).map(c => (
              <button
                key={c}
                onClick={() => setCoin(c)}
                style={{
                  flex: 1,
                  padding: '6px 4px',
                  borderRadius: '6px',
                  border: coin === c ? '1px solid var(--accent)' : '1px solid var(--border)',
                  background: coin === c ? 'rgba(0, 212, 255, 0.1)' : 'transparent',
                  color: coin === c ? 'var(--accent)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: coin === c ? 600 : 400,
                  transition: 'all 0.15s',
                }}
              >
                {c === 'bitcoin' ? 'BTC' : 'DOGE'}
              </button>
            ))}
          </div>
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: '12px 12px' }}>
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: 'none',
                background: page === item.id ? 'rgba(0, 212, 255, 0.1)' : 'transparent',
                color: page === item.id ? 'var(--accent)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '14px',
                textAlign: 'left',
                marginBottom: '2px',
                transition: 'all 0.15s',
                borderLeft: page === item.id ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        {/* Price ticker at bottom */}
        <div style={{
          padding: '14px 20px',
          borderTop: '1px solid var(--border)',
          fontSize: '12px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>BTC</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{formatPrice(btcPrice)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-secondary)' }}>DOGE</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{formatPrice(dogePrice, 4)}</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        {page === 'realtime' && <RealtimePage coin={coin} />}
        {page === 'technical' && <TechnicalPage coin={coin} />}
        {page === 'predictions' && <PredictionsPage coin={coin} />}
        {page === 'correlation' && <CorrelationPage />}
      </main>
    </div>
  );
}
