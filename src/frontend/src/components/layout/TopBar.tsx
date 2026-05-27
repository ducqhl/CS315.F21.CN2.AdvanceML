import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Zap } from 'lucide-react';

interface TopBarProps {
  btcPrice: number | null;
  dogePrice: number | null;
  btcChange?: number | null;
  dogeChange?: number | null;
}

function fmt(p: number | null, dec = 2): string {
  if (p == null) return '—';
  return `$${p.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

interface TickerItem {
  symbol: string;
  price: number | null;
  change?: number | null;
  dec: number;
}

function TickerSegment({ symbol, price, change, dec }: TickerItem) {
  const up = change != null && change >= 0;
  const down = change != null && change < 0;
  return (
    <span className="inline-flex items-center gap-2 px-6">
      <span className="font-display text-[11px] font-bold tracking-wider text-cyan">{symbol}</span>
      <span className="font-mono text-[11px] font-bold text-text-primary">{fmt(price, dec)}</span>
      {change != null && (
        <span
          className="inline-flex items-center gap-0.5 text-[10px] font-mono font-bold"
          style={{ color: up ? '#00F0A0' : down ? '#FF3864' : '#FFB020' }}
        >
          {up ? <TrendingUp size={9} /> : down ? <TrendingDown size={9} /> : null}
          {up ? '+' : ''}{change.toFixed(2)}%
        </span>
      )}
      <span className="text-border-bright mx-1">│</span>
    </span>
  );
}

export default function TopBar({ btcPrice, dogePrice, btcChange, dogeChange }: TopBarProps) {
  const [time, setTime] = useState(() => new Date().toLocaleTimeString('en-US', { hour12: false }));

  useEffect(() => {
    const t = setInterval(() => setTime(new Date().toLocaleTimeString('en-US', { hour12: false })), 1000);
    return () => clearInterval(t);
  }, []);

  const items: TickerItem[] = [
    { symbol: 'BTC',  price: btcPrice,  change: btcChange,  dec: 2 },
    { symbol: 'DOGE', price: dogePrice, change: dogeChange, dec: 6 },
    { symbol: 'BTC',  price: btcPrice,  change: btcChange,  dec: 2 },
    { symbol: 'DOGE', price: dogePrice, change: dogeChange, dec: 6 },
    { symbol: 'BTC',  price: btcPrice,  change: btcChange,  dec: 2 },
    { symbol: 'DOGE', price: dogePrice, change: dogeChange, dec: 6 },
  ];

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between"
      style={{
        height: '40px',
        background: 'var(--bg-void)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {/* Left: logo mark */}
      <div
        className="flex items-center gap-2 px-4 flex-shrink-0"
        style={{ borderRight: '1px solid var(--border)', height: '100%' }}
      >
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: 'var(--cyan-10)', border: '1px solid rgba(0,229,255,0.2)' }}
        >
          <Zap size={12} color="var(--cyan)" />
        </div>
        <span className="font-display text-[11px] font-bold text-cyan tracking-widest">QUANTUM</span>
      </div>

      {/* Center: scrolling ticker */}
      <div className="ticker-strip flex-1 overflow-hidden mx-4" style={{ height: '100%', display: 'flex', alignItems: 'center' }}>
        <div className="ticker-inner">
          {items.map((item, i) => (
            <TickerSegment key={i} {...item} />
          ))}
        </div>
      </div>

      {/* Right: clock + live indicator */}
      <div
        className="flex items-center gap-3 px-4 flex-shrink-0"
        style={{ borderLeft: '1px solid var(--border)', height: '100%' }}
      >
        <div className="w-1.5 h-1.5 rounded-full bg-green animate-pulse-slow" />
        <span className="font-mono text-[11px] text-text-secondary tracking-wider">{time} UTC+0</span>
      </div>
    </div>
  );
}
