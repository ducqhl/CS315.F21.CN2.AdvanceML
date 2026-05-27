/**
 * TwoLineChart — two synchronized line series on one lightweight-chart.
 * Used for BTC vs DOGE normalized price comparison in CorrelationPage.
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

export interface LineDataPoint { time: string; value: number }

interface TwoLineChartProps {
  lineA: LineDataPoint[];
  lineB: LineDataPoint[];
  colorA?: string;
  colorB?: string;
  height?: number;
  labelA?: string;
  labelB?: string;
}

export function TwoLineChart({
  lineA,
  lineB,
  colorA = '#00E5FF',
  colorB = '#FFB020',
  height = 200,
}: TwoLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesARef   = useRef<ISeriesApi<'Area'> | null>(null);
  const seriesBRef   = useRef<ISeriesApi<'Line'> | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const w = el.clientWidth || el.offsetWidth;

    const chart = createChart(el, {
      width: w,
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
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: true,
      handleScale: true,
    });
    chartRef.current = chart;

    seriesARef.current = chart.addAreaSeries({
      lineColor: colorA,
      topColor: colorA + '18',
      bottomColor: colorA + '00',
      lineWidth: 2,
      crosshairMarkerVisible: true,
      lastValueVisible: true,
      priceLineVisible: false,
    });

    seriesBRef.current = chart.addLineSeries({
      color: colorB,
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      crosshairMarkerVisible: true,
      lastValueVisible: true,
      priceLineVisible: false,
    });

    const ro = new ResizeObserver(entries => {
      const rw = entries[0]?.contentRect.width;
      if (rw && chartRef.current) chartRef.current.applyOptions({ width: rw });
    });
    ro.observe(el);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [height, colorA, colorB]); // colorA/colorB trigger chart recreation (correct)

  useEffect(() => {
    if (!seriesARef.current || !lineA.length) return;
    seriesARef.current.setData(lineA.map(d => ({ time: d.time as Time, value: d.value })));
    chartRef.current?.timeScale().fitContent();
  }, [lineA]);

  useEffect(() => {
    if (!seriesBRef.current || !lineB.length) return;
    seriesBRef.current.setData(lineB.map(d => ({ time: d.time as Time, value: d.value })));
  }, [lineB]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
