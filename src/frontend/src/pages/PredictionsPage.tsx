/**
 * PredictionsPage — trend-first layout with model selector
 */
import { useEffect, useState, useMemo, useCallback } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import {
  TrendingUp, TrendingDown, Minus, Brain,
  ChevronDown, ChevronUp, Activity, Calendar, Clock,
  ChevronLeft, ChevronRight, Layers,
} from 'lucide-react';
import {
  fetchIntraday, fetchIntradayDates, fetchPredictionsForModel, fetchPredictionHistory, fetchModels,
} from '../api/client';
import type {
  IntradayResponse, IntradayDateEntry,
  PredictionsResponse, PredictionPoint,
  ModelRegistryEntry,
} from '../api/client';
import { C } from '../components/apexTheme';
import {
  IntradayCandlestickChart,
  IntradayCompareChart,
  type IntraCandle,
  type IntraLine,
} from '../components/LightweightChart';

interface Props { coin: 'bitcoin' | 'dogecoin' }

// ── Helpers ─────────────────────────────────────────────────────────────────────
function toUnixSeconds(isoString: string): number {
  return Math.floor(new Date(isoString).getTime() / 1000);
}

function formatLocalHHMM(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// Parse "YYYY-MM-DD" without timezone shift (treat as local midnight).
function parseDateLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Format Date → "YYYY-MM-DD" in local time.
function formatDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Sub-components ──────────────────────────────────────────────────────────────
function DirectionBadge({ direction, prob }: { direction?: string; prob?: number }) {
  const pct = prob != null ? `${(prob * 100).toFixed(0)}%` : '';
  if (direction === 'UP')   return <span className="badge-up"><TrendingUp size={10} /> UP {pct}</span>;
  if (direction === 'DOWN') return <span className="badge-down"><TrendingDown size={10} /> DOWN {pct}</span>;
  return <span className="badge-flat"><Minus size={10} /> FLAT {pct}</span>;
}

function StrengthBar({ strength }: { strength?: string }) {
  const { pct, color, label } = strength === 'STRONG'
    ? { pct: 90, color: C.cyan,    label: 'STRONG'   }
    : strength === 'MODERATE'
    ? { pct: 52, color: C.gold,    label: 'MODERATE' }
    : { pct: 20, color: C.textSec, label: 'WEAK'     };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: '120px' }}>
      <div style={{ flex: 1, height: '4px', borderRadius: '2px', background: 'var(--border)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '2px' }} />
      </div>
      <span className="font-mono" style={{ fontSize: '9px', color, fontWeight: 700, minWidth: '52px' }}>{label}</span>
    </div>
  );
}

// ── Date Picker (react-datepicker) ──────────────────────────────────────────────
interface DatePickerNavProps {
  dates: IntradayDateEntry[];
  selected: string;
  onChange: (d: string) => void;
}

function DatePickerNav({ dates, selected, onChange }: DatePickerNavProps) {
  const availSet   = useMemo(() => new Set(dates.map(d => d.date)), [dates]);
  const predSet    = useMemo(() => new Set(dates.filter(d => d.has_predictions).map(d => d.date)), [dates]);

  const idx     = dates.findIndex(d => d.date === selected);
  const hasPrev = idx > 0;
  const hasNext = idx < dates.length - 1;

  const selectedDate  = parseDateLocal(selected);
  const minDate       = dates[0] ? parseDateLocal(dates[0].date) : undefined;
  const maxDate       = dates[dates.length - 1] ? parseDateLocal(dates[dates.length - 1].date) : undefined;
  const todayStr      = new Date().toISOString().slice(0, 10);
  const isToday       = selected === todayStr;

  const filterDate = (d: Date) => availSet.has(formatDateLocal(d));

  const dayClassName = (d: Date): string => {
    const s = formatDateLocal(d);
    return predSet.has(s) ? 'has-predictions' : '';
  };

  const btnStyle = (enabled: boolean): React.CSSProperties => ({
    width: '32px', height: '32px', borderRadius: '8px',
    border: '1px solid var(--border)',
    background: enabled ? 'var(--bg-elevated)' : 'transparent',
    color: enabled ? 'var(--text-primary)' : 'var(--border)',
    cursor: enabled ? 'pointer' : 'default',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      {/* Prev */}
      <button
        style={btnStyle(hasPrev)}
        disabled={!hasPrev}
        onClick={() => hasPrev && onChange(dates[idx - 1].date)}
        aria-label="Previous day"
      >
        <ChevronLeft size={14} />
      </button>

      {/* DatePicker trigger */}
      <DatePicker
        selected={selectedDate}
        onChange={(d: Date | null) => { if (d) onChange(formatDateLocal(d)); }}
        filterDate={filterDate}
        dayClassName={dayClassName}
        minDate={minDate}
        maxDate={maxDate}
        dateFormat="EEE, MMM d"
        customInput={
          <button
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '6px 14px', borderRadius: '8px',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              minWidth: '190px', cursor: 'pointer',
            }}
          >
            <Calendar size={13} color={C.cyan} />
            <span
              className="font-mono"
              style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 700, flex: 1, textAlign: 'center' }}
            >
              {parseDateLocal(selected).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
            {predSet.has(selected) && (
              <span
                style={{ width: '6px', height: '6px', borderRadius: '50%', background: C.gold, boxShadow: `0 0 6px ${C.gold}`, flexShrink: 0 }}
                title="Predictions available"
              />
            )}
          </button>
        }
        popperPlacement="bottom-start"
      />

      {/* Next */}
      <button
        style={btnStyle(hasNext)}
        disabled={!hasNext}
        onClick={() => hasNext && onChange(dates[idx + 1].date)}
        aria-label="Next day"
      >
        <ChevronRight size={14} />
      </button>

      {/* Today shortcut */}
      {!isToday && availSet.has(todayStr) && (
        <button
          onClick={() => onChange(todayStr)}
          style={{
            padding: '6px 10px', borderRadius: '6px', fontSize: '10px', fontWeight: 700,
            fontFamily: 'Space Mono, monospace', cursor: 'pointer',
            border: `1px solid ${C.cyan}40`, background: `${C.cyan}10`,
            color: C.cyan,
          }}
        >
          TODAY
        </button>
      )}
    </div>
  );
}

// ── Last Prediction Badge ───────────────────────────────────────────────────────
function LastPredictionBadge({ lastTs }: { lastTs: string | null }) {
  if (!lastTs) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '20px', background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <Clock size={11} color={C.textSec} />
        <span className="font-mono" style={{ fontSize: '10px', color: C.textSec }}>No predictions yet</span>
      </div>
    );
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '20px', background: `${C.gold}12`, border: `1px solid ${C.gold}40` }}>
      <Clock size={11} color={C.gold} />
      <span className="font-mono" style={{ fontSize: '10px', color: C.gold, fontWeight: 700 }}>
        Last prediction: {formatLocalHHMM(lastTs)}
      </span>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: C.gold, boxShadow: `0 0 5px ${C.gold}` }} />
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────────
export default function PredictionsPage({ coin }: Props) {
  const today = new Date().toISOString().slice(0, 10);

  const [availDates, setAvailDates]   = useState<IntradayDateEntry[]>([]);
  const [selDate, setSelDate]         = useState<string>(today);
  const [intraday, setIntraday]       = useState<IntradayResponse | null>(null);
  const [predictions, setPredictions] = useState<PredictionsResponse | null>(null);
  const [predHistory, setPredHistory] = useState<PredictionPoint[]>([]);
  const [loading, setLoading]         = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Model selection
  const [models, setModels]                   = useState<ModelRegistryEntry[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  const symbol   = coin === 'bitcoin' ? 'BTC' : 'DOGE';
  const decimals = coin === 'bitcoin' ? 2 : 6;
  const fmt = (n: number | null | undefined) =>
    n != null ? `$${n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}` : '—';

  // Load available dates + 7-day forecast + models once
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchIntradayDates(coin),
      fetchPredictionsForModel(coin),
      fetchPredictionHistory(coin, 60).catch(() => [] as PredictionPoint[]),
      fetchModels(coin).catch(() => [] as ModelRegistryEntry[]),
    ]).then(([datesResp, pred, hist, mods]) => {
      setAvailDates(datesResp.dates);
      setPredictions(pred);
      setPredHistory(hist);
      setModels(mods.filter((m: ModelRegistryEntry) => m.enabled && !m.deleted_at));
      setSelectedModelId(null);
      const lastDate = datesResp.dates[datesResp.dates.length - 1]?.date ?? today;
      setSelDate(lastDate);
    }).finally(() => setLoading(false));
  }, [coin]);

  // Reload predictions when model selection changes
  useEffect(() => {
    if (loading) return; // avoid double-fetch on initial load
    fetchPredictionsForModel(coin, selectedModelId ?? undefined)
      .then(setPredictions)
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModelId]);

  // Load intraday data for selected date
  const loadIntraday = useCallback(() => {
    if (!selDate) return;
    setChartLoading(true);
    fetchIntraday(coin, { date: selDate })
      .then(d => setIntraday(d))
      .catch(() => {})
      .finally(() => setChartLoading(false));
  }, [coin, selDate]);

  useEffect(() => { loadIntraday(); }, [loadIntraday]);

  // Auto-refresh every 5 min when viewing today
  useEffect(() => {
    const t = setInterval(() => {
      if (selDate === today) loadIntraday();
    }, 300_000);
    return () => clearInterval(t);
  }, [loadIntraday, selDate, today]);

  // ── Derived chart data ────────────────────────────────────────────────────────
  const { candleData, actualLineData, predictedLineData, hasPredictions, accuracyStats, lastPredTs } = useMemo(() => {
    if (!intraday) {
      return { candleData: [], actualLineData: [], predictedLineData: [], hasPredictions: false, accuracyStats: null, lastPredTs: null };
    }

    const candleData: IntraCandle[] = intraday.actual.map(d => ({
      time:  toUnixSeconds(d.t),
      open:  d.o ?? d.c,
      high:  d.h ?? d.c,
      low:   d.l ?? d.c,
      close: d.c,
    }));

    const actualLineData: IntraLine[] = intraday.actual.map(d => ({
      time:  toUnixSeconds(d.t),
      value: d.c,
    }));

    const hasPredictions = intraday.predicted.length > 0;

    const predictedLineData: IntraLine[] = intraday.predicted.map(p => ({
      time:  toUnixSeconds(p.t),
      value: p.close,
    }));

    const lastPredTs: string | null = hasPredictions
      ? intraday.predicted[intraday.predicted.length - 1].t
      : null;

    // Accuracy: compare predictions against actual closes at matching timestamps
    const actualMap = new Map<number, number>();
    intraday.actual.forEach(d => {
      actualMap.set(toUnixSeconds(d.t), d.c);
    });

    const pairs = intraday.predicted
      .map(p => {
        const ts  = toUnixSeconds(p.t);
        const act = actualMap.get(ts);
        return act != null ? { actual: act, pred: p.close } : null;
      })
      .filter((x): x is { actual: number; pred: number } => x !== null);

    const accuracyStats = pairs.length >= 3 ? {
      mae: pairs.reduce((s, p) => s + Math.abs((p.pred - p.actual) / p.actual) * 100, 0) / pairs.length,
      n:   pairs.length,
    } : null;

    return { candleData, actualLineData, predictedLineData, hasPredictions, accuracyStats, lastPredTs };
  }, [intraday]);

  // ── 7-day outlook summary ─────────────────────────────────────────────────────
  const outlook = useMemo(() => {
    const preds = predictions?.predictions ?? [];
    const up   = preds.filter(p => p.direction === 'UP').length;
    const down = preds.filter(p => p.direction === 'DOWN').length;
    const flat = preds.filter(p => p.direction === 'FLAT').length;
    if (up > down && up > flat)   return { label: 'BULLISH', color: C.green,  Icon: TrendingUp,   count: `${up}/7`   };
    if (down > up && down > flat) return { label: 'BEARISH', color: C.red,    Icon: TrendingDown, count: `${down}/7` };
    return                               { label: 'NEUTRAL', color: C.gold,   Icon: Minus,        count: `${flat}/7` };
  }, [predictions]);

  // ── Loading skeleton ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '20px' }}>
          {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: '88px', borderRadius: '12px' }} />)}
        </div>
        <div className="skeleton" style={{ height: '560px', borderRadius: '12px', marginBottom: '16px' }} />
        <div className="skeleton" style={{ height: '240px', borderRadius: '12px' }} />
      </div>
    );
  }

  const selEntry = availDates.find(d => d.date === selDate);
  const maeBadgeColor = accuracyStats
    ? (accuracyStats.mae < 0.5 ? C.green : accuracyStats.mae < 2 ? C.gold : C.red)
    : C.textSec;

  return (
    <div>
      {/* ── Page header ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
            <div
              className="font-display"
              style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.06em' }}
            >
              TREND FORECAST
            </div>
            <span style={{
              padding: '3px 10px', borderRadius: '12px', fontSize: '10px', fontWeight: 700,
              background: 'var(--violet-10)', border: '1px solid rgba(139,92,246,0.25)',
              color: 'var(--violet)', fontFamily: 'Space Mono',
            }}>
              DUAL-HEAD v2
            </span>
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '12px', fontFamily: 'Manrope' }}>
            {symbol} · day-ahead trend prediction + 7-day outlook
          </div>
        </div>
        {accuracyStats && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '5px 12px', borderRadius: '20px',
            background: `${maeBadgeColor}18`,
            border: `1px solid ${maeBadgeColor}40`,
          }}>
            <Activity size={12} color={maeBadgeColor} />
            <span className="font-mono" style={{ fontSize: '11px', fontWeight: 700, color: maeBadgeColor }}>
              MAE {accuracyStats.mae.toFixed(3)}%
            </span>
            <span style={{ fontSize: '10px', color: C.textSec, fontFamily: 'Manrope' }}>on {accuracyStats.n} pts</span>
          </div>
        )}
      </div>

      {/* ── Model selector ────────────────────────────────────────────────────── */}
      {models.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <Layers size={13} color={C.textSec} />
          <span style={{ fontSize: '11px', color: C.textSec, fontFamily: 'Manrope', marginRight: '4px' }}>Model:</span>

          {/* All models (default) */}
          <button
            onClick={() => setSelectedModelId(null)}
            style={{
              padding: '4px 12px', borderRadius: '20px', fontSize: '10px', fontWeight: 700,
              fontFamily: 'Space Mono, monospace', cursor: 'pointer',
              border: `1px solid ${selectedModelId === null ? 'rgba(139,92,246,0.5)' : 'var(--border)'}`,
              background: selectedModelId === null ? 'var(--violet-10)' : 'transparent',
              color: selectedModelId === null ? 'var(--violet)' : C.textSec,
            }}
          >
            LATEST
          </button>

          {models.map(m => (
            <button
              key={m.model_id}
              onClick={() => setSelectedModelId(m.model_id)}
              title={`F1: ${m.metrics?.f1_macro?.toFixed(3) ?? '—'}  RMSE: $${m.metrics?.rmse?.toFixed(0) ?? '—'}`}
              style={{
                padding: '4px 12px', borderRadius: '20px', fontSize: '10px', fontWeight: 700,
                fontFamily: 'Space Mono, monospace', cursor: 'pointer',
                border: `1px solid ${selectedModelId === m.model_id ? `${C.cyan}60` : 'var(--border)'}`,
                background: selectedModelId === m.model_id ? `${C.cyan}12` : 'transparent',
                color: selectedModelId === m.model_id ? C.cyan : C.textSec,
              }}
            >
              {m.version_tag}
            </button>
          ))}
        </div>
      )}

      {/* ── Metric cards ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
        <div className="metric-card" style={{ borderColor: 'rgba(0,229,255,0.2)', background: 'linear-gradient(135deg, var(--bg-card), rgba(0,229,255,0.03))' }}>
          <div className="metric-label">Next-Day Forecast</div>
          <div className="metric-value" style={{ color: 'var(--cyan)', fontSize: '18px' }}>{fmt(predictions?.next_day_price)}</div>
          {predictions?.predictions?.[0] && (
            <div style={{ marginTop: '6px' }}>
              <DirectionBadge direction={predictions.predictions[0].direction} prob={predictions.predictions[0].direction_prob} />
            </div>
          )}
        </div>

        <div className="metric-card">
          <div className="metric-label">7-Day High</div>
          <div className="metric-value" style={{ color: 'var(--green)', fontSize: '18px' }}>{fmt(predictions?.seven_day_high)}</div>
          <div className="metric-sub">Ceiling forecast</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">7-Day Low</div>
          <div className="metric-value" style={{ color: 'var(--red)', fontSize: '18px' }}>{fmt(predictions?.seven_day_low)}</div>
          <div className="metric-sub">Floor forecast</div>
        </div>

        <div className="metric-card" style={{ background: `linear-gradient(135deg, var(--bg-card), ${outlook.color}06)` }}>
          <div className="metric-label">7-Day Outlook</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <outlook.Icon size={18} color={outlook.color} />
            <span className="font-display" style={{ fontSize: '13px', color: outlook.color, letterSpacing: '0.06em' }}>{outlook.label}</span>
          </div>
          <div className="metric-sub">{outlook.count} days · direction head</div>
        </div>
      </div>

      {/* ── Intraday chart card ────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '20px', marginBottom: '16px' }}>
        {/* Card header: title + date picker */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          marginBottom: '16px', flexWrap: 'wrap', gap: '12px',
        }}>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'Manrope', marginBottom: '3px' }}>
              5-Min Price — {selDate}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Manrope', display: 'flex', gap: '12px', alignItems: 'center' }}>
              <span>{selEntry?.candle_count ?? intraday?.actual_count ?? 0} candles</span>
              {hasPredictions
                ? <span style={{ color: C.gold }}>· {intraday!.predicted_count} predictions</span>
                : <span style={{ color: C.textSec }}>· no predictions for this day</span>
              }
            </div>
          </div>

          {availDates.length > 0 && (
            <DatePickerNav dates={availDates} selected={selDate} onChange={setSelDate} />
          )}
        </div>

        {/* Chart 1: Intraday OHLCV candlesticks */}
        <div style={{ position: 'relative', opacity: chartLoading ? 0.5 : 1, transition: 'opacity 0.2s' }}>
          {intraday && candleData.length > 0 ? (
            <IntradayCandlestickChart candles={candleData} height={280} />
          ) : (
            <div style={{
              height: '280px', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: '12px',
              color: 'var(--text-secondary)', fontFamily: 'Manrope', fontSize: '13px',
            }}>
              <Activity size={28} style={{ opacity: 0.4 }} />
              {chartLoading ? 'Loading…' : 'No 5-min data for this date'}
            </div>
          )}
        </div>

        {/* Divider */}
        <div style={{ height: '1px', background: 'var(--border)', margin: '16px 0' }} />

        {/* Chart 2 header: legend + last prediction badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '20px', fontSize: '11px', fontFamily: 'Manrope' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '16px', height: '2px', background: C.cyan, borderRadius: '1px' }} />
              <span style={{ color: 'var(--text-secondary)' }}>Actual close</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <svg width="16" height="8">
                <line x1="0" y1="4" x2="16" y2="4" stroke={C.gold} strokeWidth="2" strokeDasharray="4 2" />
              </svg>
              <span style={{ color: 'var(--text-secondary)' }}>Predicted close</span>
            </div>
          </div>
          <LastPredictionBadge lastTs={lastPredTs} />
        </div>

        {/* Chart 2: Predicted vs actual comparison */}
        <div style={{ position: 'relative', opacity: chartLoading ? 0.5 : 1, transition: 'opacity 0.2s' }}>
          {intraday && (actualLineData.length > 0 || predictedLineData.length > 0) ? (
            <IntradayCompareChart
              actualLine={actualLineData}
              predictedLine={predictedLineData}
              height={220}
            />
          ) : (
            <div style={{
              height: '220px', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: '10px',
              color: 'var(--text-secondary)', fontFamily: 'Manrope', fontSize: '12px',
            }}>
              <Minus size={22} style={{ opacity: 0.3 }} />
              {chartLoading ? 'Loading…' : 'No comparison data available'}
            </div>
          )}
        </div>

        {/* Gold dot legend hint */}
        <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px', color: C.textSec, fontFamily: 'Manrope' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: C.gold, boxShadow: `0 0 5px ${C.gold}`, display: 'inline-block' }} />
          Dates with a gold dot in the picker have prediction data available
        </div>
      </div>

      {/* ── 7-Day Forecast Table ───────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '16px', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'Manrope' }}>7-Day Daily Forecast</div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'Manrope' }}>
            Model: <span className="font-mono" style={{ color: 'var(--violet)' }}>{predictions?.model_version ?? '—'}</span>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Day</th><th>Date</th>
              <th style={{ textAlign: 'right' }}>Predicted Price</th>
              <th style={{ textAlign: 'center' }}>Direction</th>
              <th>Trend Strength</th>
              <th style={{ textAlign: 'right' }}>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {predictions?.predictions.map((p, i) => (
              <tr key={i}>
                <td>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: '24px', height: '24px', borderRadius: '6px',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    fontSize: '11px', color: 'var(--text-secondary)',
                    fontFamily: 'Space Mono', fontWeight: 700,
                  }}>{i + 1}</span>
                </td>
                <td><span className="font-mono" style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{p.prediction_date.split('T')[0]}</span></td>
                <td style={{ textAlign: 'right' }}><span className="font-mono" style={{ fontSize: '14px', fontWeight: 700, color: 'var(--cyan)' }}>{fmt(p.predicted_price)}</span></td>
                <td style={{ textAlign: 'center' }}><DirectionBadge direction={p.direction} prob={p.direction_prob} /></td>
                <td><StrengthBar strength={p.trend_strength} /></td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                    <div style={{ width: '40px', height: '3px', borderRadius: '2px', background: 'var(--border)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${p.confidence * 100}%`, background: 'var(--violet)', borderRadius: '2px' }} />
                    </div>
                    <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-secondary)', minWidth: '28px' }}>{(p.confidence * 100).toFixed(0)}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Prediction Run History ────────────────────────────────────────────── */}
      {predHistory.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <button
            onClick={() => setShowHistory(!showHistory)}
            style={{ width: '100%', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', borderBottom: showHistory ? '1px solid var(--border)' : 'none' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Brain size={15} color="var(--violet)" />
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Manrope' }}>Daily Prediction Run History</span>
              <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '10px', fontWeight: 600, background: 'var(--violet-10)', border: '1px solid rgba(139,92,246,0.25)', color: 'var(--violet)', fontFamily: 'Manrope' }}>{predHistory.length} records</span>
            </div>
            {showHistory ? <ChevronUp size={15} color="var(--text-secondary)" /> : <ChevronDown size={15} color="var(--text-secondary)" />}
          </button>
          {showHistory && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Prediction Date</th>
                  <th style={{ textAlign: 'right' }}>Predicted</th>
                  <th style={{ textAlign: 'right' }}>Actual</th>
                  <th style={{ textAlign: 'right' }}>Error</th>
                  <th style={{ textAlign: 'center' }}>Direction</th>
                </tr>
              </thead>
              <tbody>
                {predHistory.map((p, i) => (
                  <tr key={i}>
                    <td className="font-mono" style={{ fontSize: '12px' }}>{p.prediction_date.split('T')[0]}</td>
                    <td style={{ textAlign: 'right' }}><span className="font-mono" style={{ color: C.gold, fontWeight: 700 }}>{fmt(p.predicted_price)}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="font-mono" style={{ color: p.actual_price ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {p.actual_price ? fmt(p.actual_price) : '—'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {p.error_pct != null ? (
                        <span className="font-mono" style={{ fontSize: '11px', fontWeight: 700, color: Math.abs(p.error_pct) < 2 ? C.green : Math.abs(p.error_pct) < 5 ? C.gold : C.red }}>
                          {p.error_pct >= 0 ? '+' : ''}{p.error_pct.toFixed(2)}%
                        </span>
                      ) : <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>—</span>}
                    </td>
                    <td style={{ textAlign: 'center' }}><DirectionBadge direction={p.direction} prob={p.direction_prob} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
