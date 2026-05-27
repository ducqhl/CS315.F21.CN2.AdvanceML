/**
 * CandlestickPane.tsx
 * Full TradingView-style chart with:
 *   - Candlestick series + optional MA/BB line overlays
 *   - Volume histogram pane below (synced via time range subscription)
 *   - Crosshair sync between candle and volume charts
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

function makeOpts(width: number, height: number, showTimeScale = true) {
  return {
    width,
    height,
    layout: {
      background: { type: ColorType.Solid, color: BG },
      textColor: TEXT,
      fontSize: 11,
      fontFamily: "'Space Mono', monospace",
    },
    grid: {
      vertLines: { color: '#131B2A', style: LineStyle.Solid },
      horzLines: { color: '#131B2A', style: LineStyle.Solid },
    },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: BORDER, textColor: TEXT },
    timeScale: {
      borderColor: BORDER,
      textColor: TEXT,
      timeVisible: true,
      secondsVisible: false,
      visible: showTimeScale,
    },
    handleScroll: true,
    handleScale: true,
  } as const;
}

export interface CandlePoint {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface LinePoint {
  time: string;
  value: number;
}

export interface VolumePoint {
  time: string;
  value: number;
  color?: string;
}

interface CandlestickPaneProps {
  data: CandlePoint[];
  sma20?: LinePoint[];
  sma50?: LinePoint[];
  bbUpper?: LinePoint[];
  bbLower?: LinePoint[];
  volume?: VolumePoint[];
  height?: number;
  volumeHeight?: number;
  /** Callback to expose chart api for crosshair sync from parent */
  onChartReady?: (chart: IChartApi) => void;
}

export function CandlestickPane({
  data,
  sma20,
  sma50,
  bbUpper,
  bbLower,
  volume,
  height = 360,
  volumeHeight = 80,
  onChartReady,
}: CandlestickPaneProps) {
  const mainRef   = useRef<HTMLDivElement>(null);
  const volRef    = useRef<HTMLDivElement>(null);
  const chartRef  = useRef<IChartApi | null>(null);
  const volChartRef = useRef<IChartApi | null>(null);

  const candleRef  = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const sma20Ref   = useRef<ISeriesApi<'Line'> | null>(null);
  const sma50Ref   = useRef<ISeriesApi<'Line'> | null>(null);
  const bbUpRef    = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLowRef   = useRef<ISeriesApi<'Line'> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const isSyncing = useRef(false);

  // Mount charts
  useEffect(() => {
    const mainEl = mainRef.current;
    const volEl  = volRef.current;
    if (!mainEl) return;

    const mainW = mainEl.clientWidth || mainEl.offsetWidth;
    const mainChart = createChart(mainEl, { ...makeOpts(mainW, height, volEl == null) });
    chartRef.current = mainChart;

    // Candlestick series
    candleRef.current = mainChart.addCandlestickSeries({
      upColor:         '#00F0A0',
      downColor:       '#FF3864',
      borderUpColor:   '#00F0A0',
      borderDownColor: '#FF3864',
      wickUpColor:     '#00F0A0',
      wickDownColor:   '#FF3864',
    });

    // SMA20 overlay
    sma20Ref.current = mainChart.addLineSeries({
      color: '#FFB020', lineWidth: 1,
      crosshairMarkerVisible: false,
      lastValueVisible: false, priceLineVisible: false,
    });

    // SMA50 overlay
    sma50Ref.current = mainChart.addLineSeries({
      color: '#8B5CF6', lineWidth: 1,
      crosshairMarkerVisible: false,
      lastValueVisible: false, priceLineVisible: false,
    });

    // BB Upper
    bbUpRef.current = mainChart.addLineSeries({
      color: '#FF3864', lineWidth: 1, lineStyle: LineStyle.Dashed,
      crosshairMarkerVisible: false,
      lastValueVisible: false, priceLineVisible: false,
    });

    // BB Lower
    bbLowRef.current = mainChart.addLineSeries({
      color: '#00F0A0', lineWidth: 1, lineStyle: LineStyle.Dashed,
      crosshairMarkerVisible: false,
      lastValueVisible: false, priceLineVisible: false,
    });

    // Volume chart
    if (volEl) {
      const volW = volEl.clientWidth || volEl.offsetWidth;
      const volChart = createChart(volEl, { ...makeOpts(volW, volumeHeight, true) });
      volChartRef.current = volChart;

      volSeriesRef.current = volChart.addHistogramSeries({
        color: '#1C2840',
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      });
      volChart.priceScale('').applyOptions({
        scaleMargins: { top: 0.05, bottom: 0 },
      });

      // Sync time ranges
      mainChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (isSyncing.current || !range) return;
        isSyncing.current = true;
        volChart.timeScale().setVisibleLogicalRange(range);
        isSyncing.current = false;
      });
      volChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (isSyncing.current || !range) return;
        isSyncing.current = true;
        mainChart.timeScale().setVisibleLogicalRange(range);
        isSyncing.current = false;
      });

      // Resize observer for volume chart
      const volRo = new ResizeObserver(entries => {
        const w = entries[0]?.contentRect.width;
        if (w && volChartRef.current) volChartRef.current.applyOptions({ width: w });
      });
      volRo.observe(volEl);
    }

    // Resize observer for main chart
    const mainRo = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && chartRef.current) chartRef.current.applyOptions({ width: w });
    });
    mainRo.observe(mainEl);

    if (onChartReady) onChartReady(mainChart);

    return () => {
      mainRo.disconnect();
      mainChart.remove();
      chartRef.current = null;
      if (volChartRef.current) {
        volChartRef.current.remove();
        volChartRef.current = null;
      }
    };
  }, [height, volumeHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update data
  useEffect(() => {
    if (!candleRef.current) return;
    if (data.length) {
      candleRef.current.setData(data.map(d => ({ ...d, time: d.time as Time })));
    } else {
      candleRef.current.setData([]);
    }
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  useEffect(() => {
    if (!sma20Ref.current) return;
    sma20Ref.current.setData(
      (sma20 ?? []).filter(d => d.value != null).map(d => ({ time: d.time as Time, value: d.value }))
    );
  }, [sma20]);

  useEffect(() => {
    if (!sma50Ref.current) return;
    sma50Ref.current.setData(
      (sma50 ?? []).filter(d => d.value != null).map(d => ({ time: d.time as Time, value: d.value }))
    );
  }, [sma50]);

  useEffect(() => {
    if (!bbUpRef.current || !bbLowRef.current) return;
    const upData  = (bbUpper ?? []).filter(d => d.value != null).map(d => ({ time: d.time as Time, value: d.value }));
    const lowData = (bbLower ?? []).filter(d => d.value != null).map(d => ({ time: d.time as Time, value: d.value }));
    bbUpRef.current.setData(upData);
    bbLowRef.current.setData(lowData);
  }, [bbUpper, bbLower]);

  useEffect(() => {
    if (!volSeriesRef.current || !volume?.length) return;
    volSeriesRef.current.setData(
      volume.map(d => ({
        time: d.time as Time,
        value: d.value,
        color: d.color ?? '#1C2840',
      }))
    );
    volChartRef.current?.timeScale().fitContent();
  }, [volume]);

  return (
    <div>
      <div ref={mainRef} style={{ width: '100%', height }} />
      {volume !== undefined && (
        <div ref={volRef} style={{ width: '100%', height: volumeHeight, marginTop: 0 }} />
      )}
    </div>
  );
}
