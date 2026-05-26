import { useEffect, useState, useMemo } from 'react';
import ReactApexChart from 'react-apexcharts';
import { BarChart2 } from 'lucide-react';
import { fetchTechnical } from '../api/client';
import type { HistoricalPoint } from '../api/client';
import { C, baseApexOptions } from '../components/apexTheme';

interface Props {
  coin: 'bitcoin' | 'dogecoin';
}

type Timeframe = '1M' | '3M' | '6M' | '1Y';
const TIMEFRAME_DAYS: Record<Timeframe, number> = {
  '1M': 30, '3M': 90, '6M': 180, '1Y': 365,
};

// Overlay toggle keys
type OverlayKey = 'ma20' | 'ma50' | 'bb';

export default function TechnicalPage({ coin }: Props) {
  const [timeframe, setTimeframe] = useState<Timeframe>('3M');
  const [data, setData] = useState<HistoricalPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overlays, setOverlays] = useState<Record<OverlayKey, boolean>>({
    ma20: true,
    ma50: true,
    bb: false,
  });

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchTechnical(coin, TIMEFRAME_DAYS[timeframe])
      .then(d => setData(d))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [coin, timeframe]);

  const symbol = coin === 'bitcoin' ? 'BTC' : 'DOGE';
  const decimals = coin === 'bitcoin' ? 2 : 6;

  const fmt = (v: number) =>
    coin === 'bitcoin' ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(4)}`;

  const toggleOverlay = (key: OverlayKey) =>
    setOverlays(prev => ({ ...prev, [key]: !prev[key] }));

  // Derived date labels for x-axis
  const dates = useMemo(() => data.map(d => d.date.split('T')[0]), [data]);

  // ── Main chart series ────────────────────────────────────────────────────────
  const mainSeries = useMemo((): ApexCharts.ApexOptions['series'] => {
    const series: ApexCharts.ApexOptions['series'] = [
      {
        name: 'Close',
        type: 'line',
        data: data.map(d => d.avg_close),
      },
    ];
    if (overlays.ma20) {
      series.push({
        name: 'MA20',
        type: 'line',
        data: data.map(d => d.sma_20 ?? null) as number[],
      });
    }
    if (overlays.ma50) {
      series.push({
        name: 'MA50',
        type: 'line',
        data: data.map(d => d.sma_50 ?? null) as number[],
      });
    }
    if (overlays.bb) {
      series.push(
        {
          name: 'BB Upper',
          type: 'line',
          data: data.map(d => d.bb_upper ?? null) as number[],
        },
        {
          name: 'BB Lower',
          type: 'line',
          data: data.map(d => d.bb_lower ?? null) as number[],
        }
      );
    }
    return series;
  }, [data, overlays]);

  const mainColors = useMemo(() => {
    const colors: string[] = [C.cyan];
    if (overlays.ma20) colors.push(C.gold);
    if (overlays.ma50) colors.push(C.violet);
    if (overlays.bb) colors.push(C.red, C.green);
    return colors;
  }, [overlays]);

  const mainDash = useMemo(() => {
    const dash = [0];
    if (overlays.ma20) dash.push(0);
    if (overlays.ma50) dash.push(0);
    if (overlays.bb) dash.push(4, 4);
    return dash;
  }, [overlays]);

  const mainWidths = useMemo(() => {
    const w = [2];
    if (overlays.ma20) w.push(1);
    if (overlays.ma50) w.push(1);
    if (overlays.bb) w.push(1, 1);
    return w;
  }, [overlays]);

  const mainOptions = useMemo((): ApexCharts.ApexOptions => {
    const base = baseApexOptions(360);
    return {
      ...base,
      chart: {
        ...base.chart,
        id: 'tech-main',
        group: 'technical',
        type: 'line',
        height: 360,
        toolbar: { show: true, tools: { download: false, zoom: true, zoomin: true, zoomout: true, pan: true, reset: true }, autoSelected: 'zoom' },
      },
      colors: mainColors,
      stroke: {
        curve: 'smooth',
        width: mainWidths,
        dashArray: mainDash,
      },
      xaxis: {
        ...base.xaxis,
        categories: dates,
        tickAmount: 8,
        labels: {
          ...base.xaxis?.labels,
          formatter: (v: string) => v ? v.slice(5) : '',
        },
      },
      yaxis: {
        labels: {
          style: { colors: C.textSec, fontSize: '10px', fontFamily: "'Space Mono', monospace" },
          formatter: fmt,
        },
      },
      tooltip: {
        ...base.tooltip,
        shared: true,
        intersect: false,
        y: { formatter: (v: number) => v != null ? `$${v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}` : '—' },
      },
      legend: {
        ...base.legend,
        show: true,
        position: 'top',
        horizontalAlign: 'right',
      },
      markers: { size: 0 },
    };
  }, [dates, mainColors, mainDash, mainWidths, decimals]);

  // ── RSI series ───────────────────────────────────────────────────────────────
  const rsiSeries = useMemo((): ApexCharts.ApexOptions['series'] => [
    { name: 'RSI', data: data.map(d => d.rsi ?? null) as number[] },
  ], [data]);

  const rsiOptions = useMemo((): ApexCharts.ApexOptions => {
    const base = baseApexOptions(120);
    return {
      ...base,
      chart: {
        ...base.chart,
        id: 'tech-rsi',
        group: 'technical',
        type: 'line',
        height: 120,
        toolbar: { show: false },
        zoom: { enabled: false },
      },
      colors: [C.cyan],
      stroke: { curve: 'smooth', width: [1.5] },
      xaxis: {
        ...base.xaxis,
        categories: dates,
        tickAmount: 8,
        labels: {
          ...base.xaxis?.labels,
          formatter: (v: string) => v ? v.slice(5) : '',
        },
      },
      yaxis: {
        min: 0,
        max: 100,
        tickAmount: 4,
        labels: {
          style: { colors: C.textSec, fontSize: '10px', fontFamily: "'Space Mono', monospace" },
          formatter: (v: number) => v.toFixed(0),
        },
      },
      annotations: {
        yaxis: [
          {
            y: 70,
            borderColor: C.red,
            strokeDashArray: 3,
            label: {
              text: 'OB 70',
              style: { color: C.red, background: C.bg, fontSize: '9px', fontFamily: "'Space Mono', monospace" },
              position: 'right',
            },
          },
          {
            y: 30,
            borderColor: C.green,
            strokeDashArray: 3,
            label: {
              text: 'OS 30',
              style: { color: C.green, background: C.bg, fontSize: '9px', fontFamily: "'Space Mono', monospace" },
              position: 'right',
            },
          },
        ],
      },
      tooltip: {
        ...base.tooltip,
        shared: true,
        intersect: false,
        y: { formatter: (v: number) => v != null ? v.toFixed(2) : '—' },
      },
      markers: { size: 0 },
      legend: { show: false },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          type: 'vertical',
          shadeIntensity: 0.4,
          opacityFrom: 0.12,
          opacityTo: 0.01,
        },
      },
    };
  }, [dates]);

  // ── MACD series ──────────────────────────────────────────────────────────────
  const macdSeries = useMemo((): ApexCharts.ApexOptions['series'] => [
    { name: 'MACD', type: 'line', data: data.map(d => d.macd ?? null) as number[] },
    { name: 'Signal', type: 'line', data: data.map(d => d.macd_signal ?? null) as number[] },
    { name: 'Histogram', type: 'bar', data: data.map(d => d.macd_histogram ?? null) as number[] },
  ], [data]);

  const macdOptions = useMemo((): ApexCharts.ApexOptions => {
    const base = baseApexOptions(120);
    // Histogram bars: green if positive, red if negative
    const histColors = data.map(d =>
      (d.macd_histogram ?? 0) >= 0 ? C.green : C.red
    );
    return {
      ...base,
      chart: {
        ...base.chart,
        id: 'tech-macd',
        group: 'technical',
        type: 'line',
        height: 120,
        toolbar: { show: false },
        zoom: { enabled: false },
      },
      colors: [C.cyan, C.gold, C.green],
      stroke: {
        curve: 'smooth',
        width: [1.5, 1, 0],
        dashArray: [0, 4, 0],
      },
      plotOptions: {
        bar: {
          columnWidth: '80%',
          colors: {
            ranges: [
              { from: -1e9, to: 0, color: C.red },
              { from: 0, to: 1e9, color: C.green },
            ],
          },
        },
      },
      fill: {
        opacity: [1, 1, 0.6],
      },
      xaxis: {
        ...base.xaxis,
        categories: dates,
        tickAmount: 8,
        labels: {
          ...base.xaxis?.labels,
          formatter: (v: string) => v ? v.slice(5) : '',
        },
      },
      yaxis: {
        labels: {
          style: { colors: C.textSec, fontSize: '10px', fontFamily: "'Space Mono', monospace" },
          formatter: (v: number) => v.toFixed(coin === 'bitcoin' ? 0 : 5),
        },
      },
      tooltip: {
        ...base.tooltip,
        shared: true,
        intersect: false,
      },
      markers: { size: 0 },
      legend: { show: false },
      // suppress unused histColors variable TS warning
      ...(histColors && {}),
    };
  }, [dates, data, coin]);

  // ── Volume series ────────────────────────────────────────────────────────────
  const volumeSeries = useMemo((): ApexCharts.ApexOptions['series'] => [
    { name: 'Volume', data: data.map(d => d.avg_volume ?? null) as number[] },
  ], [data]);

  const volumeOptions = useMemo((): ApexCharts.ApexOptions => {
    const base = baseApexOptions(80);
    return {
      ...base,
      chart: {
        ...base.chart,
        id: 'tech-volume',
        group: 'technical',
        type: 'bar',
        height: 80,
        toolbar: { show: false },
        zoom: { enabled: false },
      },
      colors: [C.border],
      plotOptions: {
        bar: {
          columnWidth: '90%',
        },
      },
      xaxis: {
        ...base.xaxis,
        categories: dates,
        tickAmount: 8,
        labels: {
          ...base.xaxis?.labels,
          formatter: (v: string) => v ? v.slice(5) : '',
        },
      },
      yaxis: {
        labels: {
          style: { colors: C.textSec, fontSize: '10px', fontFamily: "'Space Mono', monospace" },
          formatter: (v: number) =>
            v > 1e9 ? `${(v / 1e9).toFixed(1)}B` : v > 1e6 ? `${(v / 1e6).toFixed(0)}M` : v.toFixed(0),
        },
      },
      tooltip: {
        ...base.tooltip,
        y: {
          formatter: (v: number) =>
            v > 1e9
              ? `$${(v / 1e9).toFixed(2)}B`
              : `$${(v / 1e6).toFixed(1)}M`,
        },
      },
      dataLabels: { enabled: false },
      legend: { show: false },
    };
  }, [dates]);

  // Latest RSI value
  const latestRsi = useMemo(() => {
    const rsiPoints = data.filter(d => d.rsi != null);
    return rsiPoints.length ? rsiPoints[rsiPoints.length - 1].rsi : null;
  }, [data]);

  const hasMacd = useMemo(() => data.some(d => d.macd != null), [data]);

  if (loading) {
    return (
      <div>
        <div className="skeleton" style={{ height: '36px', width: '200px', borderRadius: '8px', marginBottom: '28px' }} />
        <div className="skeleton" style={{ height: '420px', borderRadius: '12px', marginBottom: '16px' }} />
        <div className="skeleton" style={{ height: '180px', borderRadius: '12px' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--red)', fontFamily: 'Manrope' }}>
        <BarChart2 size={32} style={{ marginBottom: '12px', opacity: 0.5 }} />
        <div>Error loading technical data: {error}</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <div className="font-display" style={{
            fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.06em',
          }}>
            TECHNICAL ANALYSIS
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '4px', fontFamily: 'Manrope' }}>
            {symbol} · Price · MA overlays · BB · RSI(14) · MACD
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' }}>
          {/* Timeframe buttons */}
          {(['1M', '3M', '6M', '1Y'] as Timeframe[]).map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`btn-ghost ${timeframe === tf ? 'active' : ''}`}
              style={{ padding: '6px 14px', fontSize: '12px' }}
            >
              {tf}
            </button>
          ))}
          {/* Divider */}
          <div style={{ width: '1px', height: '24px', background: 'var(--border)', margin: '0 4px' }} />
          {/* Overlay toggles */}
          {([ ['ma20', 'MA20', C.gold], ['ma50', 'MA50', C.violet], ['bb', 'BB', C.red] ] as [OverlayKey, string, string][]).map(([key, label, color]) => (
            <button
              key={key}
              onClick={() => toggleOverlay(key)}
              style={{
                padding: '5px 10px',
                fontSize: '11px',
                fontFamily: 'Space Mono, monospace',
                fontWeight: 700,
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
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
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '10px',
          padding: '6px 14px', borderRadius: '8px',
          marginBottom: '12px',
          background: 'rgba(0,229,255,0.04)',
          border: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Manrope' }}>Current RSI:</span>
          <span className="font-mono" style={{
            color: Number(latestRsi) >= 70 ? C.red : Number(latestRsi) <= 30 ? C.green : C.cyan,
            fontWeight: 700, fontSize: '13px',
          }}>
            {Number(latestRsi).toFixed(1)}
            {Number(latestRsi) >= 70 && ' · OVERBOUGHT'}
            {Number(latestRsi) <= 30 && ' · OVERSOLD'}
          </span>
        </div>
      )}

      {/* Main price chart */}
      <div className="card" style={{ padding: '20px', marginBottom: '8px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Manrope', marginBottom: '4px' }}>
          Price · {overlays.ma20 ? 'MA20 · ' : ''}{overlays.ma50 ? 'MA50 · ' : ''}{overlays.bb ? 'Bollinger Bands · ' : ''}Close Line
        </div>
        {data.length > 0 ? (
          <ReactApexChart
            // @ts-ignore
            options={mainOptions}
            series={mainSeries}
            type="line"
            height={360}
          />
        ) : (
          <div style={{ height: '360px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontFamily: 'Manrope', fontSize: '13px' }}>
            No price data
          </div>
        )}
      </div>

      {/* RSI subchart */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: '8px' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px',
        }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Manrope' }}>
            RSI (14)
          </div>
          <div style={{ display: 'flex', gap: '16px', fontSize: '11px', fontFamily: 'Manrope' }}>
            <span style={{ color: C.red }}>— 70 Overbought</span>
            <span style={{ color: C.green }}>— 30 Oversold</span>
          </div>
        </div>
        {data.some(d => d.rsi != null) ? (
          <ReactApexChart
            // @ts-ignore
            options={rsiOptions}
            series={rsiSeries}
            type="line"
            height={120}
          />
        ) : (
          <div style={{ height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontFamily: 'Manrope', fontSize: '12px' }}>
            RSI data not available for this timeframe
          </div>
        )}
      </div>

      {/* MACD subchart */}
      {hasMacd && (
        <div className="card" style={{ padding: '16px 20px', marginBottom: '8px' }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px',
          }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Manrope' }}>
              MACD (12, 26, 9)
            </div>
            <div style={{ display: 'flex', gap: '16px', fontSize: '11px', fontFamily: 'Manrope' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <div style={{ width: '14px', height: '2px', background: C.cyan }} />
                <span style={{ color: 'var(--text-secondary)' }}>MACD</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <svg width="14" height="8"><line x1="0" y1="4" x2="14" y2="4" stroke={C.gold} strokeWidth="1.5" strokeDasharray="4 2"/></svg>
                <span style={{ color: 'var(--text-secondary)' }}>Signal</span>
              </div>
            </div>
          </div>
          <ReactApexChart
            // @ts-ignore
            options={macdOptions}
            series={macdSeries}
            type="line"
            height={120}
          />
        </div>
      )}

      {/* Volume subchart */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Manrope', marginBottom: '4px' }}>
          Volume
        </div>
        {data.some(d => d.avg_volume != null) ? (
          <ReactApexChart
            // @ts-ignore
            options={volumeOptions}
            series={volumeSeries}
            type="bar"
            height={80}
          />
        ) : (
          <div style={{ height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontFamily: 'Manrope', fontSize: '12px' }}>
            Volume data not available
          </div>
        )}
      </div>
    </div>
  );
}
