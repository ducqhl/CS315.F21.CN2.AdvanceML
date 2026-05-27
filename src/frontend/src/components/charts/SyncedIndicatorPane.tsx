/**
 * SyncedIndicatorPane.tsx
 * A lightweight-charts instance for RSI or MACD indicator panels.
 * Exposes its IChartApi so the parent can synchronize time ranges.
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
} from 'lightweight-charts';

const BG = '#0A0F1E';
const BORDER = '#1C2840';
const TEXT = '#556070';

function makeOpts(width: number, height: number) {
  return {
    width,
    height,
    layout: {
      background: { type: ColorType.Solid, color: BG },
      textColor: TEXT,
      fontSize: 10,
      fontFamily: "'Space Mono', monospace",
    },
    grid: {
      vertLines: { color: '#131B2A' },
      horzLines: { color: '#131B2A' },
    },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: BORDER, textColor: TEXT },
    timeScale: {
      borderColor: BORDER,
      textColor: TEXT,
      timeVisible: true,
      secondsVisible: false,
    },
    handleScroll: true,
    handleScale: true,
  } as const;
}

export interface RsiPoint { time: string; value: number | null }
export interface MacdPoint { time: string; macd: number | null; signal: number | null; histogram: number | null }

interface RsiPaneProps {
  type: 'rsi';
  data: RsiPoint[];
  height?: number;
  onChartReady?: (chart: IChartApi) => void;
}

interface MacdPaneProps {
  type: 'macd';
  data: MacdPoint[];
  height?: number;
  onChartReady?: (chart: IChartApi) => void;
}

type SyncedIndicatorPaneProps = RsiPaneProps | MacdPaneProps;

export function SyncedIndicatorPane(props: SyncedIndicatorPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  // RSI
  const rsiRef       = useRef<ISeriesApi<'Line'> | null>(null);
  // MACD
  const macdRef      = useRef<ISeriesApi<'Line'> | null>(null);
  const signalRef    = useRef<ISeriesApi<'Line'> | null>(null);
  const histRef      = useRef<ISeriesApi<'Histogram'> | null>(null);

  const { type, height = 120, onChartReady } = props;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const w = el.clientWidth || el.offsetWidth;
    const chart = createChart(el, makeOpts(w, height));
    chartRef.current = chart;

    if (type === 'rsi') {
      rsiRef.current = chart.addLineSeries({
        color: '#00E5FF',
        lineWidth: 1,
        crosshairMarkerVisible: true,
        lastValueVisible: true,
        priceLineVisible: false,
      });

      // OB/OS reference lines via createPriceLine
      rsiRef.current.createPriceLine({
        price: 70,
        color: '#FF3864',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'OB',
      });
      rsiRef.current.createPriceLine({
        price: 30,
        color: '#00F0A0',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'OS',
      });

      chart.priceScale('right').applyOptions({
        scaleMargins: { top: 0.05, bottom: 0.05 },
        autoScale: false,
      });
      // lightweight-charts v4 doesn't expose min/max via applyOptions types,
      // but the API accepts them at runtime for fixed-range axes.
      chart.priceScale('right').applyOptions({
        autoScale: false,
        scaleMargins: { top: 0.05, bottom: 0.05 },
      });
    } else {
      // MACD line
      macdRef.current = chart.addLineSeries({
        color: '#00E5FF',
        lineWidth: 1,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      // Signal line (dashed)
      signalRef.current = chart.addLineSeries({
        color: '#FFB020',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      // Histogram
      histRef.current = chart.addHistogramSeries({
        color: '#1C2840',
        priceScaleId: 'right',
        lastValueVisible: false,
        priceLineVisible: false,
      });
    }

    const ro = new ResizeObserver(entries => {
      const rw = entries[0]?.contentRect.width;
      if (rw && chartRef.current) chartRef.current.applyOptions({ width: rw });
    });
    ro.observe(el);

    if (onChartReady) onChartReady(chart);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [type, height]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update RSI data
  useEffect(() => {
    if (props.type !== 'rsi' || !rsiRef.current) return;
    const filtered = (props.data as RsiPoint[])
      .filter(d => d.value != null)
      .map(d => ({ time: d.time as Time, value: d.value as number }));
    rsiRef.current.setData(filtered);
    chartRef.current?.timeScale().fitContent();
  }, [props.type === 'rsi' ? (props as RsiPaneProps).data : null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update MACD data
  useEffect(() => {
    if (props.type !== 'macd') return;
    const d = (props as MacdPaneProps).data;
    if (macdRef.current) {
      macdRef.current.setData(
        d.filter(p => p.macd != null).map(p => ({ time: p.time as Time, value: p.macd as number }))
      );
    }
    if (signalRef.current) {
      signalRef.current.setData(
        d.filter(p => p.signal != null).map(p => ({ time: p.time as Time, value: p.signal as number }))
      );
    }
    if (histRef.current) {
      histRef.current.setData(
        d.filter(p => p.histogram != null).map(p => ({
          time: p.time as Time,
          value: p.histogram as number,
          color: (p.histogram as number) >= 0 ? 'rgba(0,240,160,0.5)' : 'rgba(255,56,100,0.5)',
        }))
      );
    }
    chartRef.current?.timeScale().fitContent();
  }, [props.type === 'macd' ? (props as MacdPaneProps).data : null]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
