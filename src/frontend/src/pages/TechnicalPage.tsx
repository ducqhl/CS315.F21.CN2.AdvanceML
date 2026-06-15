import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart2 } from 'lucide-react';
import { fetchTechnical } from '../api/client';
import { coinSymbol, coinDecimals, type Coin } from '../lib/coin';
import PageHeader from '../components/ui/PageHeader';
import { TF_DAYS, type Timeframe, type OverlayKey, type TechnicalPoint } from './technical/types';
import TechnicalToolbar from './technical/components/TechnicalToolbar';
import RsiPill from './technical/components/RsiPill';
import PriceChart from './technical/components/PriceChart';
import RsiChart from './technical/components/RsiChart';
import MacdChart from './technical/components/MacdChart';
import VolumeChart from './technical/components/VolumeChart';

interface Props { coin: Coin }

export default function TechnicalPage({ coin }: Props) {
  const [timeframe, setTimeframe] = useState<Timeframe>('3M');
  const [overlays, setOverlays]   = useState<Record<OverlayKey, boolean>>({ ma20: true, ma50: true, bb: false });

  const symbol   = coinSymbol(coin);
  const decimals = coinDecimals(coin);

  const { data: rawData = [], isLoading, error } = useQuery({
    queryKey: ['technical', coin, TF_DAYS[timeframe]],
    queryFn:  () => fetchTechnical(coin, TF_DAYS[timeframe]),
    staleTime: 300_000,
  });

  const data = useMemo<TechnicalPoint[]>(() =>
    rawData.map(d => ({
      date:  d.date.split('T')[0],
      close: d.avg_close,
      sma20: d.sma_20 ?? null,
      sma50: d.sma_50 ?? null,
      bbUp:  d.bb_upper ?? null,
      bbLo:  d.bb_lower ?? null,
      bbMid: d.bb_middle ?? null,
      rsi:   d.rsi    ?? null,
      macd:  d.macd   ?? null,
      sig:   d.macd_signal    ?? null,
      hist:  d.macd_histogram ?? null,
      vol:   d.avg_volume ?? null,
    })),
    [rawData]
  );

  const latestRsi = useMemo(() => {
    const pts = data.filter(d => d.rsi != null);
    return pts.length ? pts[pts.length - 1].rsi : null;
  }, [data]);

  const xInterval = Math.max(1, Math.floor(data.length / 8));
  const yWidth    = coin === 'bitcoin' ? 52 : 68;

  const toggleOverlay = (k: OverlayKey) =>
    setOverlays(p => ({ ...p, [k]: !p[k] }));

  if (isLoading) {
    return (
      <div>
        <div className="skeleton" style={{ height: '32px', width: '220px', borderRadius: '8px', marginBottom: '28px' }} />
        <div className="skeleton" style={{ height: '380px', borderRadius: '12px', marginBottom: '12px' }} />
        <div className="skeleton" style={{ height: '140px', borderRadius: '12px', marginBottom: '12px' }} />
        <div className="skeleton" style={{ height: '140px', borderRadius: '12px' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--down)', fontFamily: 'Plus Jakarta Sans' }}>
        <BarChart2 size={32} style={{ marginBottom: '12px', opacity: 0.4 }} />
        <div>Error loading technical data</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Technical Analysis"
        subtitle={`${symbol} · Price · MA overlays · Bollinger Bands · RSI(14) · MACD`}
        alignStart={false}
        marginBottom={24}
        right={
          <TechnicalToolbar
            timeframe={timeframe}
            overlays={overlays}
            onTimeframeChange={setTimeframe}
            onToggleOverlay={toggleOverlay}
          />
        }
      />

      {latestRsi != null && <RsiPill rsi={latestRsi} />}

      <PriceChart coin={coin} data={data} overlays={overlays} xInterval={xInterval} yWidth={yWidth} />

      <RsiChart data={data} xInterval={xInterval} />

      {data.some(d => d.macd != null) && (
        <MacdChart coin={coin} decimals={decimals} data={data} xInterval={xInterval} yWidth={yWidth} />
      )}

      {data.some(d => d.vol != null) && (
        <VolumeChart data={data} xInterval={xInterval} />
      )}
    </div>
  );
}
