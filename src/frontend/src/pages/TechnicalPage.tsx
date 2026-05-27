import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { BarChart2 } from 'lucide-react';
import type { IChartApi } from 'lightweight-charts';
import { fetchTechnical } from '../api/client';
import type { HistoricalPoint } from '../api/client';
import { Card, Badge, Button, Skeleton } from '../components/ui';
import { CandlestickPane } from '../components/charts/CandlestickPane';
import type { CandlePoint, LinePoint, VolumePoint } from '../components/charts/CandlestickPane';
import { SyncedIndicatorPane } from '../components/charts/SyncedIndicatorPane';
import type { RsiPoint, MacdPoint } from '../components/charts/SyncedIndicatorPane';

interface Props { coin: 'bitcoin' | 'dogecoin' }

type Timeframe = '1M' | '3M' | '6M' | '1Y';
const TIMEFRAME_DAYS: Record<Timeframe, number> = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365 };

type OverlayKey = 'ma20' | 'ma50' | 'bb';
const OVERLAY_META: { key: OverlayKey; label: string; color: string }[] = [
  { key: 'ma20', label: 'MA20', color: '#FFB020' },
  { key: 'ma50', label: 'MA50', color: '#8B5CF6' },
  { key: 'bb',   label: 'BB',   color: '#FF3864'  },
];

/** Sync visible range across lightweight-charts instances */
function useSyncedCharts() {
  const chartsRef  = useRef<IChartApi[]>([]);
  const isSyncing  = useRef(false);

  const registerChart = useCallback((chart: IChartApi) => {
    chartsRef.current.push(chart);
    chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (isSyncing.current || !range) return;
      isSyncing.current = true;
      chartsRef.current.forEach(c => {
        if (c !== chart) c.timeScale().setVisibleLogicalRange(range);
      });
      isSyncing.current = false;
    });
  }, []);

  return registerChart;
}

export default function TechnicalPage({ coin }: Props) {
  const [timeframe, setTimeframe] = useState<Timeframe>('3M');
  const [data, setData]           = useState<HistoricalPoint[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [overlays, setOverlays]   = useState<Record<OverlayKey, boolean>>({ ma20: true, ma50: true, bb: false });

  const registerChart = useSyncedCharts();

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchTechnical(coin, TIMEFRAME_DAYS[timeframe])
      .then(d => setData(d))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [coin, timeframe]);

  const symbol = coin === 'bitcoin' ? 'BTC' : 'DOGE';

  const toggleOverlay = (key: OverlayKey) => setOverlays(prev => ({ ...prev, [key]: !prev[key] }));

  // ── Derived data for candlestick chart ────────────────────────────────────────
  const candleData = useMemo<CandlePoint[]>(() => data.map(d => ({
    time:  d.date.split('T')[0],
    open:  d.open   ?? d.avg_close,
    high:  d.daily_high ?? d.avg_close,
    low:   d.daily_low  ?? d.avg_close,
    close: d.avg_close,
  })), [data]);

  const sma20Data = useMemo<LinePoint[]>(
    () => overlays.ma20 ? data.filter(d => d.sma_20 != null).map(d => ({ time: d.date.split('T')[0], value: d.sma_20! })) : [],
    [data, overlays.ma20],
  );
  const sma50Data = useMemo<LinePoint[]>(
    () => overlays.ma50 ? data.filter(d => d.sma_50 != null).map(d => ({ time: d.date.split('T')[0], value: d.sma_50! })) : [],
    [data, overlays.ma50],
  );
  const bbUpperData = useMemo<LinePoint[]>(
    () => overlays.bb ? data.filter(d => d.bb_upper != null).map(d => ({ time: d.date.split('T')[0], value: d.bb_upper! })) : [],
    [data, overlays.bb],
  );
  const bbLowerData = useMemo<LinePoint[]>(
    () => overlays.bb ? data.filter(d => d.bb_lower != null).map(d => ({ time: d.date.split('T')[0], value: d.bb_lower! })) : [],
    [data, overlays.bb],
  );

  // Volume with color based on candle direction
  const volumeData = useMemo<VolumePoint[]>(() => data.map((d, i) => {
    const prev   = i > 0 ? data[i - 1].avg_close : d.avg_close;
    const isGreen = d.avg_close >= prev;
    return {
      time:  d.date.split('T')[0],
      value: d.avg_volume ?? 0,
      color: isGreen ? 'rgba(0,240,160,0.4)' : 'rgba(255,56,100,0.4)',
    };
  }), [data]);

  // RSI data
  const rsiData = useMemo<RsiPoint[]>(
    () => data.map(d => ({ time: d.date.split('T')[0], value: d.rsi ?? null })),
    [data],
  );

  // MACD data
  const macdData = useMemo<MacdPoint[]>(
    () => data.map(d => ({
      time:      d.date.split('T')[0],
      macd:      d.macd ?? null,
      signal:    d.macd_signal ?? null,
      histogram: d.macd_histogram ?? null,
    })),
    [data],
  );

  const latestRsi = useMemo(() => {
    const pts = data.filter(d => d.rsi != null);
    return pts.length ? pts[pts.length - 1].rsi : null;
  }, [data]);

  const hasMacd = useMemo(() => data.some(d => d.macd != null), [data]);

  if (loading) {
    return (
      <div>
        <Skeleton style={{ height: '36px', width: '200px', borderRadius: '8px', marginBottom: '28px' }} />
        <Skeleton style={{ height: '460px', borderRadius: '12px', marginBottom: '8px' }} />
        <Skeleton style={{ height: '160px', borderRadius: '12px' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-red font-body text-sm">
        <BarChart2 size={32} style={{ opacity: 0.5 }} />
        <div>Error loading technical data: {error}</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center mb-6">
        <div>
          <h1 className="font-display text-lg font-bold text-text-primary tracking-wider m-0">TECHNICAL ANALYSIS</h1>
          <p className="text-text-secondary text-xs mt-1 font-body">
            {symbol} · Candlestick · MA overlays · Bollinger · RSI(14) · MACD
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Timeframe buttons */}
          {(['1M', '3M', '6M', '1Y'] as Timeframe[]).map(tf => (
            <Button key={tf} variant="ghost" active={timeframe === tf} size="sm" onClick={() => setTimeframe(tf)}>
              {tf}
            </Button>
          ))}

          <div className="w-px h-6 bg-border mx-1" />

          {/* Overlay toggles */}
          {OVERLAY_META.map(({ key, label, color }) => (
            <button
              key={key}
              onClick={() => toggleOverlay(key)}
              className="px-2.5 py-1.5 text-[11px] font-mono font-bold rounded-lg cursor-pointer transition-all duration-150"
              style={{
                background: overlays[key] ? `${color}18` : 'transparent',
                border: `1px solid ${overlays[key] ? color : 'var(--border)'}`,
                color: overlays[key] ? color : 'var(--text-secondary)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* RSI badge */}
      {latestRsi != null && (
        <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-lg mb-3 border border-border bg-cyan/[0.04]">
          <span className="text-[11px] text-text-secondary font-body">Current RSI:</span>
          <span
            className="font-mono font-bold text-[13px]"
            style={{
              color: Number(latestRsi) >= 70 ? '#FF3864' : Number(latestRsi) <= 30 ? '#00F0A0' : '#00E5FF',
            }}
          >
            {Number(latestRsi).toFixed(1)}
            {Number(latestRsi) >= 70 && ' · OVERBOUGHT'}
            {Number(latestRsi) <= 30 && ' · OVERSOLD'}
          </span>
          <Badge variant={Number(latestRsi) >= 70 ? 'down' : Number(latestRsi) <= 30 ? 'up' : 'info'}>
            {Number(latestRsi) >= 70 ? 'OB' : Number(latestRsi) <= 30 ? 'OS' : 'NEUTRAL'}
          </Badge>
        </div>
      )}

      {/* Main candlestick chart + volume */}
      <Card className="mb-2 overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <span className="text-[13px] font-semibold text-text-primary font-body">
            {symbol} Price Chart
          </span>
          <div className="flex items-center gap-3 text-[11px] font-body ml-auto">
            {overlays.ma20 && (
              <span className="flex items-center gap-1.5">
                <div className="w-4 h-0.5 rounded" style={{ background: '#FFB020' }} />
                <span className="text-text-secondary">MA20</span>
              </span>
            )}
            {overlays.ma50 && (
              <span className="flex items-center gap-1.5">
                <div className="w-4 h-0.5 rounded" style={{ background: '#8B5CF6' }} />
                <span className="text-text-secondary">MA50</span>
              </span>
            )}
            {overlays.bb && (
              <span className="flex items-center gap-1.5">
                <div className="w-4 h-0.5 border-t-2 border-dashed" style={{ borderColor: '#FF3864' }} />
                <span className="text-text-secondary">BB</span>
              </span>
            )}
          </div>
        </div>
        {data.length > 0 ? (
          <CandlestickPane
            data={candleData}
            sma20={sma20Data}
            sma50={sma50Data}
            bbUpper={bbUpperData}
            bbLower={bbLowerData}
            volume={volumeData}
            height={360}
            volumeHeight={80}
            onChartReady={registerChart}
          />
        ) : (
          <div className="h-96 flex items-center justify-center text-text-secondary font-body text-sm">
            No price data
          </div>
        )}
      </Card>

      {/* RSI sub-chart */}
      <Card className="mb-2 overflow-hidden">
        <div className="px-5 py-2.5 border-b border-border flex items-center justify-between">
          <span className="text-xs font-semibold text-text-primary font-body">RSI (14)</span>
          <div className="flex items-center gap-4 text-[11px] font-body">
            <span style={{ color: '#FF3864' }}>— 70 Overbought</span>
            <span style={{ color: '#00F0A0' }}>— 30 Oversold</span>
          </div>
        </div>
        {data.some(d => d.rsi != null) ? (
          <SyncedIndicatorPane
            type="rsi"
            data={rsiData}
            height={110}
            onChartReady={registerChart}
          />
        ) : (
          <div className="h-24 flex items-center justify-center text-text-secondary font-body text-xs">
            RSI data not available for this timeframe
          </div>
        )}
      </Card>

      {/* MACD sub-chart */}
      {hasMacd && (
        <Card className="mb-2 overflow-hidden">
          <div className="px-5 py-2.5 border-b border-border flex items-center justify-between">
            <span className="text-xs font-semibold text-text-primary font-body">MACD (12, 26, 9)</span>
            <div className="flex items-center gap-4 text-[11px] font-body">
              <span className="flex items-center gap-1.5">
                <div className="w-4 h-0.5 rounded" style={{ background: '#00E5FF' }} />
                <span className="text-text-secondary">MACD</span>
              </span>
              <span className="flex items-center gap-1.5">
                <svg width="16" height="8">
                  <line x1="0" y1="4" x2="16" y2="4" stroke="#FFB020" strokeWidth="1.5" strokeDasharray="4 2" />
                </svg>
                <span className="text-text-secondary">Signal</span>
              </span>
            </div>
          </div>
          <SyncedIndicatorPane
            type="macd"
            data={macdData}
            height={110}
            onChartReady={registerChart}
          />
        </Card>
      )}

      {/* Legend + info strip */}
      <div className="flex items-center justify-between mt-2 px-1">
        <div className="flex items-center gap-2 text-[10px] text-text-muted font-body">
          <div className="w-3 h-3 rounded-sm" style={{ background: 'rgba(0,240,160,0.4)' }} />
          <span>Bullish candle</span>
          <div className="w-3 h-3 rounded-sm ml-2" style={{ background: 'rgba(255,56,100,0.4)' }} />
          <span>Bearish candle</span>
        </div>
        <div className="text-[10px] text-text-muted font-body">
          Drag to scroll · Scroll wheel to zoom · {data.length} data points
        </div>
      </div>
    </div>
  );
}
