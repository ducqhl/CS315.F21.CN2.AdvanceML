import { useState } from 'react';
import {
  LayoutDashboard, Activity, BarChart2, Brain, GitBranch,
  Zap, LogOut, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { cn } from '../../lib/utils';

type Page = 'dashboard' | 'realtime' | 'technical' | 'predictions' | 'correlation';
type Coin = 'bitcoin' | 'dogecoin';

interface SidebarProps {
  page: Page;
  setPage: (p: Page) => void;
  coin: Coin;
  setCoin: (c: Coin) => void;
  btcPrice: number | null;
  dogePrice: number | null;
  user: { username: string; role: string } | null;
  logout: () => void;
}

const NAV_ITEMS: { id: Page; label: string; icon: React.ReactNode; badge?: string }[] = [
  { id: 'dashboard',   label: 'Overview',    icon: <LayoutDashboard size={16} /> },
  { id: 'realtime',    label: 'Real-time',   icon: <Activity size={16} /> },
  { id: 'technical',   label: 'Technical',   icon: <BarChart2 size={16} /> },
  { id: 'predictions', label: 'Predictions', icon: <Brain size={16} />, badge: 'v2' },
  { id: 'correlation', label: 'Correlation', icon: <GitBranch size={16} /> },
];

function formatP(p: number | null, dec = 2) {
  return p != null ? `$${p.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}` : '—';
}

export default function Sidebar({ page, setPage, coin, setCoin, btcPrice, dogePrice, user, logout }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        'relative z-10 flex flex-col flex-shrink-0 transition-all duration-200',
        collapsed ? 'sidebar-collapsed' : '',
      )}
      style={{
        width: collapsed ? '64px' : '220px',
        background: 'var(--bg-card)',
        borderRight: '1px solid var(--border)',
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center px-4 py-4 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)', minHeight: '60px' }}
      >
        {collapsed ? (
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center mx-auto"
            style={{ background: 'var(--cyan-10)', border: '1px solid rgba(0,229,255,0.2)' }}
          >
            <Zap size={16} color="var(--cyan)" />
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--cyan-10)', border: '1px solid rgba(0,229,255,0.2)' }}
            >
              <Zap size={16} color="var(--cyan)" />
            </div>
            <div className="logo-text">
              <div className="font-display text-sm font-extrabold text-cyan tracking-widest leading-none">QUANTUM</div>
              <div className="font-body text-[9px] text-text-muted tracking-widest mt-0.5 uppercase">Crypto Terminal</div>
            </div>
          </div>
        )}
      </div>

      {/* Coin selector */}
      {!collapsed && (
        <div className="px-3.5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="active-market-label text-[9px] text-text-muted tracking-widest uppercase font-body mb-2 pl-1">Active Market</div>
          <div className="flex flex-col gap-1">
            {([['bitcoin', 'BTC', formatP(btcPrice)], ['dogecoin', 'DOGE', formatP(dogePrice, 6)]] as const).map(([c, sym, price]) => (
              <button
                key={c}
                onClick={() => setCoin(c)}
                className={cn(
                  'flex items-center justify-between px-2.5 py-2 rounded-lg border transition-all duration-150 cursor-pointer',
                  coin === c
                    ? 'border-cyan/25 bg-cyan/5'
                    : 'border-transparent hover:bg-white/[0.02]',
                )}
              >
                <span
                  className="font-display text-xs font-bold tracking-widest"
                  style={{ color: coin === c ? 'var(--cyan)' : 'var(--text-secondary)' }}
                >
                  {sym}
                </span>
                <span
                  className="coin-price font-mono text-[11px]"
                  style={{ color: coin === c ? 'var(--text-primary)' : 'var(--text-muted)' }}
                >
                  {price}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Collapsed coin dots */}
      {collapsed && (
        <div className="flex flex-col items-center gap-2 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          {(['bitcoin', 'dogecoin'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCoin(c)}
              data-tooltip={c === 'bitcoin' ? 'BTC' : 'DOGE'}
              className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-mono font-bold transition-all duration-150',
                coin === c
                  ? 'bg-cyan/10 text-cyan border border-cyan/25'
                  : 'text-text-secondary border border-transparent hover:border-border',
              )}
            >
              {c === 'bitcoin' ? '₿' : 'Ð'}
            </button>
          ))}
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 p-2.5">
        {!collapsed && (
          <div className="section-label text-[9px] text-text-muted tracking-widest uppercase font-body px-1 py-1.5 mb-1">
            Navigation
          </div>
        )}
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            onClick={() => setPage(item.id)}
            data-tooltip={collapsed ? item.label : undefined}
            className={cn(
              'nav-item w-full mb-0.5',
              page === item.id ? 'active' : '',
              collapsed ? 'justify-center px-0 py-2.5' : '',
            )}
          >
            {item.icon}
            {!collapsed && (
              <>
                <span className="nav-label flex-1">{item.label}</span>
                {item.badge && (
                  <span
                    className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-full border"
                    style={{
                      background: page === item.id ? 'rgba(0,229,255,0.15)' : 'var(--bg-elevated)',
                      color: page === item.id ? 'var(--cyan)' : 'var(--text-muted)',
                      borderColor: page === item.id ? 'rgba(0,229,255,0.2)' : 'transparent',
                    }}
                  >
                    {item.badge}
                  </span>
                )}
              </>
            )}
          </button>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(v => !v)}
        className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center z-20 cursor-pointer transition-all duration-150 hover:border-cyan/25"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          color: 'var(--text-secondary)',
        }}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>

      {/* User / logout */}
      <div className="p-3.5" style={{ borderTop: '1px solid var(--border)' }}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--violet-10)', border: '1px solid rgba(139,92,246,0.2)' }}
            >
              <span className="font-mono text-[11px] font-bold" style={{ color: 'var(--violet)' }}>
                {user?.username?.[0]?.toUpperCase() ?? 'A'}
              </span>
            </div>
            <button
              onClick={logout}
              className="text-text-muted hover:text-red transition-colors cursor-pointer"
              style={{ background: 'none', border: 'none', padding: '4px', borderRadius: '4px' }}
            >
              <LogOut size={13} />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="user-info flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--violet-10)', border: '1px solid rgba(139,92,246,0.2)' }}
              >
                <span className="font-mono text-[11px] font-bold" style={{ color: 'var(--violet)' }}>
                  {user?.username?.[0]?.toUpperCase() ?? 'A'}
                </span>
              </div>
              <div>
                <div className="text-[12px] font-semibold text-text-primary font-body">
                  {user?.username ?? 'admin'}
                </div>
                <div className="text-[10px] text-text-muted font-body">
                  {user?.role ?? 'admin'}
                </div>
              </div>
            </div>
            <button
              onClick={logout}
              className="text-text-muted hover:text-red transition-colors cursor-pointer p-1.5 rounded"
              style={{ background: 'none', border: 'none' }}
              title="Logout"
            >
              <LogOut size={14} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
