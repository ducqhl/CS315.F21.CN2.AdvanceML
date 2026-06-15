import {
  ResponsiveContainer, ComposedChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { Loader } from 'lucide-react';
import ChartTooltip from '../../../components/charts/ChartTooltip';
import ChartLegend from '../../../components/charts/ChartLegend';
import { fmtAxisPrice } from '../../../lib/format';
import type { Coin } from '../../../lib/coin';

export interface ForecastChartPoint {
  date: string;
  actual: number | null;
  forecast: number | null;
  isForecast: boolean;
}

interface ForecastChartProps {
  coin: Coin;
  decimals: number;
  data: ForecastChartPoint[];
  historyDays: number;
  periodLabel: string;
  todayDate: string | null;
  loading: boolean;
}

/** History + forecast composed area chart for the Predictions page. */
export default function ForecastChart({
  coin, decimals, data, historyDays, periodLabel, todayDate, loading,
}: ForecastChartProps) {
  return (
    <div className="card" style={{ padding: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans' }}>
          {historyDays}-Day History + {periodLabel} Forecast
        </div>
        {loading && <Loader size={13} color="var(--accent-light)" className="spin" />}
      </div>

      <ResponsiveContainer width="100%" height={210}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--text-secondary)" stopOpacity={0.15} />
              <stop offset="100%" stopColor="var(--text-secondary)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="fcstGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.15} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="date" tickLine={false} axisLine={false}
            tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
            tickFormatter={v => v.slice(5)} />
          <YAxis tickLine={false} axisLine={false}
            tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
            domain={['auto', 'auto']}
            tickFormatter={v => fmtAxisPrice(v, coin)}
            width={coin === 'bitcoin' ? 52 : 64} />
          <Tooltip content={<ChartTooltip decimals={decimals} skipNull />} />
          {todayDate && (
            <ReferenceLine x={todayDate} stroke="rgba(255,255,255,0.12)" strokeDasharray="4 3"
              label={{ value: 'Today', position: 'top', fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'IBM Plex Mono' }} />
          )}
          <Area type="monotone" dataKey="actual" name="Actual"
            stroke="var(--text-secondary)" strokeWidth={2} fill="url(#actualGrad)" dot={false} connectNulls />
          <Area type="monotone" dataKey="forecast" name="Forecast"
            stroke="var(--accent-light)" strokeWidth={2} strokeDasharray="5 3"
            fill="url(#fcstGrad)" dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>

      <ChartLegend
        marginTop={8}
        items={[
          { color: 'var(--text-secondary)', label: 'History', dash: false },
          { color: 'var(--accent-light)', label: 'Forecast', dash: true },
        ]}
      />
    </div>
  );
}
