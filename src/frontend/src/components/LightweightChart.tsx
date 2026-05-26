/**
 * LightweightChart.tsx
 * React wrappers around TradingView lightweight-charts v4.
 *
 * Key fixes vs. naive usage:
 *   - Pass width: container.clientWidth at creation time (ResizeObserver alone
 *     doesn't fire on mount, so without this the chart starts at 0px wide).
 *   - Use real hex color for background — lightweight-charts v4 does not accept
 *     CSS keyword "transparent"; it must be a hex/rgb string.
 */
import { useEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';

const BG_CARD = '#0A0F1E';   // matches --bg-card CSS variable

// lightweight-charts is a canvas renderer — it cannot resolve CSS custom properties.
// Map design-system variable names to their literal hex equivalents.
const CSS_VAR_MAP: Record<string, string> = {
  'var(--cyan)':    '#00E5FF',
  'var(--green)':   '#00F0A0',
  'var(--red)':     '#FF3864',
  'var(--gold)':    '#FFB020',
  'var(--violet)':  '#8B5CF6',
  'var(--bg-card)': '#0A0F1E',
  'var(--border)':  '#1C2840',
};

function rc(color: string): string {
  return CSS_VAR_MAP[color] ?? color;
}

// ── Shared chart options factory ───────────────────────────────────────────────
function makeChartOptions(width: number, height: number) {
  return {
    width,
    height,
    layout: {
      background: { type: ColorType.Solid, color: BG_CARD },
      textColor: '#556070',
      fontSize: 11,
      fontFamily: "'Space Mono', monospace",
    },
    grid: {
      vertLines: { color: '#131B2A', style: LineStyle.Solid },
      horzLines: { color: '#131B2A', style: LineStyle.Solid },
    },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#1C2840', textColor: '#556070' },
    timeScale: {
      borderColor: '#1C2840',
      textColor: '#556070',
      timeVisible: true,
      secondsVisible: false,
    },
    handleScroll: true,
    handleScale: true,
  } as const;
}

// ── Area Chart ─────────────────────────────────────────────────────────────────
export interface AreaPoint {
  time: string; // 'YYYY-MM-DD'
  value: number;
}

export interface ForecastPoint extends AreaPoint {
  upperBound?: number;
  lowerBound?: number;
}

interface AreaChartProps {
  data: AreaPoint[];
  forecastData?: ForecastPoint[];
  height?: number;
  color?: string;
  forecastColor?: string;
  onCrosshairMove?: (price: number | null) => void;
}

export function AreaChart({
  data,
  forecastData,
  height = 360,
  color = '#00E5FF',
  forecastColor = '#FFB020',
  onCrosshairMove,
}: AreaChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const areaRef      = useRef<ISeriesApi<'Area'> | null>(null);
  const forecastRef  = useRef<ISeriesApi<'Line'> | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, makeChartOptions(el.clientWidth || el.offsetWidth, height));
    chartRef.current = chart;

    const lineHex = rc(color);
    const forecastHex = rc(forecastColor);

    areaRef.current = chart.addAreaSeries({
      lineColor: lineHex,
      topColor: lineHex + '28',
      bottomColor: lineHex + '00',
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBackgroundColor: lineHex,
    });

    forecastRef.current = chart.addLineSeries({
      color: forecastHex,
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBackgroundColor: forecastHex,
    });

    if (onCrosshairMove) {
      chart.subscribeCrosshairMove(param => {
        if (param.point && areaRef.current) {
          const d = param.seriesData.get(areaRef.current);
          onCrosshairMove(d ? (d as { value: number }).value : null);
        } else {
          onCrosshairMove(null);
        }
      });
    }

    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && chartRef.current) chartRef.current.applyOptions({ width: w });
    });
    ro.observe(el);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [height, color, forecastColor]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!areaRef.current || !forecastRef.current) return;
    if (data.length) {
      areaRef.current.setData(data.map(d => ({ time: d.time as Time, value: d.value })));
    }
    forecastRef.current.setData(
      forecastData?.length
        ? forecastData.map(d => ({ time: d.time as Time, value: d.value }))
        : []
    );
    chartRef.current?.timeScale().fitContent();
  }, [data, forecastData]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}

// ── Candlestick Chart ──────────────────────────────────────────────────────────
export interface CandlePoint {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SmaPoint {
  time: string;
  value: number;
}

interface CandlestickChartProps {
  data: CandlePoint[];
  sma20?: SmaPoint[];
  sma50?: SmaPoint[];
  height?: number;
}

export function CandlestickChart({ data, sma20, sma50, height = 400 }: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const candleRef    = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const sma20Ref     = useRef<ISeriesApi<'Line'> | null>(null);
  const sma50Ref     = useRef<ISeriesApi<'Line'> | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, makeChartOptions(el.clientWidth || el.offsetWidth, height));
    chartRef.current = chart;

    candleRef.current = chart.addCandlestickSeries({
      upColor:        '#00F0A0',
      downColor:      '#FF3864',
      borderUpColor:  '#00F0A0',
      borderDownColor:'#FF3864',
      wickUpColor:    '#00F0A0',
      wickDownColor:  '#FF3864',
    });

    sma20Ref.current = chart.addLineSeries({
      color: '#FFB020', lineWidth: 1,
      crosshairMarkerVisible: false, lastValueVisible: true, priceLineVisible: false,
    });

    sma50Ref.current = chart.addLineSeries({
      color: '#8B5CF6', lineWidth: 1,
      crosshairMarkerVisible: false, lastValueVisible: true, priceLineVisible: false,
    });

    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && chartRef.current) chartRef.current.applyOptions({ width: w });
    });
    ro.observe(el);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [height]);

  useEffect(() => {
    if (!candleRef.current) return;
    if (data.length) candleRef.current.setData(data.map(d => ({ ...d, time: d.time as Time })));
    if (sma20?.length && sma20Ref.current)
      sma20Ref.current.setData(sma20.map(d => ({ time: d.time as Time, value: d.value })));
    if (sma50?.length && sma50Ref.current)
      sma50Ref.current.setData(sma50.map(d => ({ time: d.time as Time, value: d.value })));
    chartRef.current?.timeScale().fitContent();
  }, [data, sma20, sma50]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}

// ── Mini Sparkline ─────────────────────────────────────────────────────────────
interface SparklineProps {
  data: AreaPoint[];
  height?: number;
  color?: string;
  positive?: boolean;
}

export function Sparkline({ data, height = 60, color, positive = true }: SparklineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<'Area'> | null>(null);

  const lineColor = rc(color ?? (positive ? '#00F0A0' : '#FF3864'));

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width:  el.clientWidth || el.offsetWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: BG_CARD },
        textColor: 'rgba(0,0,0,0)',
      },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      crosshair: { mode: CrosshairMode.Magnet },
      rightPriceScale: { visible: false },
      leftPriceScale:  { visible: false },
      timeScale:       { visible: false },
      handleScroll: false,
      handleScale:  false,
    });
    chartRef.current = chart;

    seriesRef.current = chart.addAreaSeries({
      lineColor,
      topColor:    lineColor + '20',
      bottomColor: lineColor + '00',
      lineWidth: 1,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && chartRef.current) chartRef.current.applyOptions({ width: w });
    });
    ro.observe(el);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [height, lineColor]);

  useEffect(() => {
    if (seriesRef.current && data.length) {
      seriesRef.current.setData(data.map(d => ({ time: d.time as Time, value: d.value })));
      chartRef.current?.timeScale().fitContent();
    }
  }, [data]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}

// ── Intraday Candlestick Chart ─────────────────────────────────────────────────
// Uses Unix seconds for `time` (5-min OHLCV intraday data).
export interface IntraCandle {
  time: number; // Unix seconds (UTCTimestamp)
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface IntraLine {
  time: number; // Unix seconds
  value: number;
}

function formatHHMM(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

export function IntradayCandlestickChart({
  candles,
  height = 300,
}: {
  candles: IntraCandle[];
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const candleRef    = useRef<ISeriesApi<'Candlestick'> | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const opts = makeChartOptions(el.clientWidth || el.offsetWidth, height);
    const chart = createChart(el, {
      ...opts,
      localization: {
        timeFormatter: (t: UTCTimestamp) => formatHHMM(t as number),
      },
    });
    chartRef.current = chart;

    candleRef.current = chart.addCandlestickSeries({
      upColor:         '#00F0A0',
      downColor:       '#FF3864',
      borderUpColor:   '#00F0A0',
      borderDownColor: '#FF3864',
      wickUpColor:     '#00F0A0',
      wickDownColor:   '#FF3864',
    });

    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && chartRef.current) chartRef.current.applyOptions({ width: w });
    });
    ro.observe(el);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [height]);

  useEffect(() => {
    if (!candleRef.current) return;
    if (candles.length) {
      candleRef.current.setData(
        candles.map(c => ({ ...c, time: c.time as UTCTimestamp })),
      );
      chartRef.current?.timeScale().fitContent();
    } else {
      candleRef.current.setData([]);
    }
  }, [candles]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}

// ── Intraday Compare Chart ─────────────────────────────────────────────────────
// Two line series: actual close (cyan solid) + predicted close (gold dashed).
export function IntradayCompareChart({
  actualLine,
  predictedLine,
  height = 240,
}: {
  actualLine: IntraLine[];
  predictedLine: IntraLine[];
  height?: number;
}) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const chartRef      = useRef<IChartApi | null>(null);
  const actualRef     = useRef<ISeriesApi<'Line'> | null>(null);
  const predictedRef  = useRef<ISeriesApi<'Line'> | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const opts = makeChartOptions(el.clientWidth || el.offsetWidth, height);
    const chart = createChart(el, {
      ...opts,
      localization: {
        timeFormatter: (t: UTCTimestamp) => formatHHMM(t as number),
      },
    });
    chartRef.current = chart;

    actualRef.current = chart.addLineSeries({
      color: '#00E5FF',
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBackgroundColor: '#00E5FF',
      lastValueVisible: true,
      priceLineVisible: false,
    });

    predictedRef.current = chart.addLineSeries({
      color: '#FFB020',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBackgroundColor: '#FFB020',
      lastValueVisible: true,
      priceLineVisible: false,
    });

    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && chartRef.current) chartRef.current.applyOptions({ width: w });
    });
    ro.observe(el);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [height]);

  useEffect(() => {
    if (!actualRef.current || !predictedRef.current) return;
    actualRef.current.setData(
      actualLine.map(p => ({ time: p.time as UTCTimestamp, value: p.value })),
    );
    predictedRef.current.setData(
      predictedLine.map(p => ({ time: p.time as UTCTimestamp, value: p.value })),
    );
    chartRef.current?.timeScale().fitContent();
  }, [actualLine, predictedLine]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
