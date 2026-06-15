import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { fetchRealtime, fetchHistorical } from '../api/client';
import { coinSymbol, coinDecimals, type Coin } from '../lib/coin';
import PageHeader from '../components/ui/PageHeader';
import PriceHero from './realtime/components/PriceHero';
import PriceHistoryChart, { type Overlay, type RealtimeChartPoint } from './realtime/components/PriceHistoryChart';
import DailyRecordsTable from './realtime/components/DailyRecordsTable';

interface Props { coin: Coin }

const TIMEFRAMES = [
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
];

export default function RealtimePage({ coin }: Props) {
  const [days, setDays]         = useState(90);
  const [overlays, setOverlays] = useState<Set<Overlay>>(new Set(['sma20']));
  const [tablePage, setTablePage] = useState(1);
  const TABLE_PAGE_SIZE = 25;

  const symbol   = coinSymbol(coin);
  const decimals = coinDecimals(coin);

  const { data: realtime, isLoading: rtLoading, dataUpdatedAt } = useQuery({
    queryKey: ['realtime', coin],
    queryFn:  () => fetchRealtime(coin),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { data: history = [], isLoading: histLoading } = useQuery({
    queryKey: ['historical', coin, days],
    queryFn:  () => fetchHistorical(coin, days),
    staleTime: 300_000,
  });

  const price        = realtime?.price ?? realtime?.avg_close ?? null;
  const isLive       = realtime?.source === 'realtime';
  const lastUpdated  = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—';

  const priceChange = useMemo(() => {
    if (history.length < 2) return null;
    const first = history[0].avg_close;
    const last  = history[history.length - 1].avg_close;
    return ((last - first) / first) * 100;
  }, [history]);

  const chartData = useMemo<RealtimeChartPoint[]>(() =>
    history.map(d => ({
      date:  d.date.split('T')[0],
      close: d.avg_close,
      sma20: d.sma_20 ?? null,
      sma50: d.sma_50 ?? null,
      high:  d.daily_high ?? null,
      low:   d.daily_low  ?? null,
    })),
    [history]
  );

  const allTableRows  = useMemo(() => [...history].reverse(), [history]);
  const totalTablePages = Math.max(1, Math.ceil(allTableRows.length / TABLE_PAGE_SIZE));
  const tableRows = useMemo(
    () => allTableRows.slice((tablePage - 1) * TABLE_PAGE_SIZE, tablePage * TABLE_PAGE_SIZE),
    [allTableRows, tablePage],
  );

  const toggleOverlay = (key: Overlay) =>
    setOverlays(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  const handleDaysChange = (d: number) => { setDays(d); setTablePage(1); };

  const loading = rtLoading || histLoading;
  const rangeLabel = TIMEFRAMES.find(t => t.days === days)?.label ?? `${days}d`;

  return (
    <div>
      <PageHeader
        title="Real-time"
        subtitle={`${symbol} · Latest prices and historical data`}
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '7px',
              padding: '6px 13px', borderRadius: '20px',
              background: isLive ? 'var(--up-subtle)' : 'var(--bg-elevated)',
              border: `1px solid ${isLive ? 'var(--up-border)' : 'var(--border)'}`,
              fontSize: '11px', fontWeight: 600, fontFamily: 'Plus Jakarta Sans',
              color: isLive ? 'var(--up)' : 'var(--text-secondary)',
            }}>
              {isLive ? <Wifi size={11} /> : <WifiOff size={11} />}
              {isLive ? 'Live' : 'Batch'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans' }}>
              <RefreshCw size={10} />
              {lastUpdated}
            </div>
          </div>
        }
      />

      <PriceHero
        symbol={symbol}
        decimals={decimals}
        price={price}
        priceChange={priceChange}
        rangeLabel={rangeLabel}
        realtime={realtime}
        loading={loading}
      />

      <PriceHistoryChart
        coin={coin}
        decimals={decimals}
        data={chartData}
        days={days}
        overlays={overlays}
        timeframes={TIMEFRAMES}
        loading={loading}
        onToggleOverlay={toggleOverlay}
        onDaysChange={handleDaysChange}
      />

      <DailyRecordsTable
        rows={tableRows}
        totalRecords={allTableRows.length}
        decimals={decimals}
        loading={loading}
        page={tablePage}
        totalPages={totalTablePages}
        onPageChange={setTablePage}
      />
    </div>
  );
}
