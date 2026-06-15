import { TrendingUp, LogOut } from 'lucide-react';
import { NAV_ITEMS, type Page } from './navigation';
import type { Coin } from '../../lib/coin';
import type { AuthUser } from '../../api/client';

interface SidebarProps {
  page: Page;
  coin: Coin;
  user: AuthUser | null;
  btcPrice: string;
  dogePrice: string;
  onSelectPage: (p: Page) => void;
  onSelectCoin: (c: Coin) => void;
  onLogout: () => void;
}

/** Fixed left navigation rail for the authenticated layout. */
export default function Sidebar({
  page, coin, user, btcPrice, dogePrice, onSelectPage, onSelectCoin, onLogout,
}: SidebarProps) {
  return (
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
            ['bitcoin',  'BTC',  btcPrice],
            ['dogecoin', 'DOGE', dogePrice],
          ] as const).map(([c, sym, price]) => (
            <button
              key={c}
              onClick={() => onSelectCoin(c)}
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
            onClick={() => onSelectPage(item.id)}
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
            onClick={onLogout}
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
  );
}
