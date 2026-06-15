import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
  fetchStats, fetchPredictions, fetchRealtime, fetchHistorical, fetchInferenceStatus,
} from '../api/client';
import { coinSymbol, coinDecimals, type Coin } from '../lib/coin';
import PageHeader from '../components/ui/PageHeader';
import StatCards from './dashboard/components/StatCards';
import StatusRow from './dashboard/components/StatusRow';
import HistoryChart, { type DashboardChartPoint } from './dashboard/components/HistoryChart';

interface Props { coin: Coin }

export default function DashboardPage({ coin }: Props) {
  const symbol   = coinSymbol(coin);
  const decimals = coinDecimals(coin);

  const { data: stats }       = useQuery({ queryKey: ['stats'], queryFn: fetchStats, staleTime: 30_000, refetchInterval: 30_000 });
  const { data: prediction }  = useQuery({ queryKey: ['predictions', coin, 7], queryFn: () => fetchPredictions(coin, 7), staleTime: 120_000 });
  const { data: realtime }    = useQuery({ queryKey: ['realtime', coin], queryFn: () => fetchRealtime(coin), staleTime: 30_000, refetchInterval: 30_000 });
  const { data: history = [] } = useQuery({ queryKey: ['historical', coin, 90], queryFn: () => fetchHistorical(coin, 90), staleTime: 300_000 });
  const { data: inference }   = useQuery({ queryKey: ['inference-status'], queryFn: fetchInferenceStatus, staleTime: 30_000, refetchInterval: 30_000 });

  const price = realtime?.price ?? realtime?.avg_close ?? null;

  const chartData = useMemo<DashboardChartPoint[]>(() =>
    history.map(d => ({
      date:  d.date.split('T')[0],
      close: d.avg_close,
      sma20: d.sma_20 ?? null,
      sma50: d.sma_50 ?? null,
    })),
    [history]
  );

  const outlook = useMemo(() => {
    const preds = prediction?.predictions ?? [];
    const up   = preds.filter(p => p.direction === 'UP').length;
    const down = preds.filter(p => p.direction === 'DOWN').length;
    if (up > down)   return { label: 'Bullish',  color: 'var(--up)',   Icon: TrendingUp,   count: `${up}/${preds.length}` };
    if (down > up)   return { label: 'Bearish',  color: 'var(--down)', Icon: TrendingDown, count: `${down}/${preds.length}` };
    return              { label: 'Neutral',  color: 'var(--warn)', Icon: Minus,        count: '—' };
  }, [prediction]);

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle={<>{symbol} · Live prices, LSTM forecasts &amp; inference status</>}
      />

      <StatCards
        decimals={decimals}
        price={price}
        realtime={realtime}
        prediction={prediction}
      />

      <StatusRow
        symbol={symbol}
        outlook={outlook}
        inference={inference}
        stats={stats}
      />

      <HistoryChart
        coin={coin}
        decimals={decimals}
        symbol={symbol}
        data={chartData}
      />
    </div>
  );
}
