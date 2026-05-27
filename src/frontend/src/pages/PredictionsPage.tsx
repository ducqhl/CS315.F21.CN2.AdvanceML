/**
 * PredictionsPage — redesigned with UI component library
 * Charts: lightweight-charts (IntradayCandlestickChart, IntradayCompareChart)
 */
import { useEffect, useState, useMemo, useCallback } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import {
  TrendingUp, TrendingDown, Minus, Brain,
  ChevronDown, ChevronUp, Activity, Calendar, Clock,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import {
  fetchIntraday, fetchIntradayDates, fetchPredictions, fetchPredictionHistory,
} from '../api/client';
import type {
  IntradayResponse, IntradayDateEntry, PredictionsResponse, PredictionPoint,
} from '../api/client';
import {
  IntradayCandlestickChart, IntradayCompareChart,
  type IntraCandle, type IntraLine,
} from '../components/LightweightChart';
import { Card, Badge, Button, MetricCard, Skeleton } from '../components/ui';
import { cn } from '../lib/utils';

interface Props { coin: 'bitcoin' | 'dogecoin' }

// ── Helpers ─────────────────────────────────────────────────────────────────────
function toUnixSeconds(isoString: string): number { return Math.floor(new Date(isoString).getTime() / 1000); }
function formatLocalHHMM(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}
function parseDateLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function formatDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Sub-components ──────────────────────────────────────────────────────────────
function DirectionBadge({ direction, prob }: { direction?: string; prob?: number }) {
  const pct = prob != null ? ` ${(prob * 100).toFixed(0)}%` : '';
  if (direction === 'UP')   return <Badge variant="up"><TrendingUp size={9} /> UP{pct}</Badge>;
  if (direction === 'DOWN') return <Badge variant="down"><TrendingDown size={9} /> DOWN{pct}</Badge>;
  return <Badge variant="neutral"><Minus size={9} /> FLAT{pct}</Badge>;
}

function StrengthBar({ strength }: { strength?: string }) {
  const { pct, color, label } = strength === 'STRONG'
    ? { pct: 90, color: '#00E5FF', label: 'STRONG'   }
    : strength === 'MODERATE'
    ? { pct: 52, color: '#FFB020', label: 'MODERATE' }
    : { pct: 20, color: '#556070', label: 'WEAK'     };
  return (
    <div className="flex items-center gap-2.5 min-w-[120px]">
      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '2px' }} />
      </div>
      <span className="font-mono text-[9px] font-bold min-w-[52px]" style={{ color }}>{label}</span>
    </div>
  );
}

// ── Date Picker Nav ─────────────────────────────────────────────────────────────
interface DatePickerNavProps { dates: IntradayDateEntry[]; selected: string; onChange: (d: string) => void; }

function DatePickerNav({ dates, selected, onChange }: DatePickerNavProps) {
  const availSet = useMemo(() => new Set(dates.map(d => d.date)), [dates]);
  const predSet  = useMemo(() => new Set(dates.filter(d => d.has_predictions).map(d => d.date)), [dates]);
  const idx      = dates.findIndex(d => d.date === selected);
  const hasPrev  = idx > 0;
  const hasNext  = idx < dates.length - 1;
  const selectedDate = parseDateLocal(selected);
  const minDate  = dates[0] ? parseDateLocal(dates[0].date) : undefined;
  const maxDate  = dates[dates.length - 1] ? parseDateLocal(dates[dates.length - 1].date) : undefined;
  const todayStr = new Date().toISOString().slice(0, 10);
  const isToday  = selected === todayStr;

  return (
    <div className="flex items-center gap-2">
      <Button variant="icon" disabled={!hasPrev} onClick={() => hasPrev && onChange(dates[idx - 1].date)}>
        <ChevronLeft size={14} />
      </Button>
      <DatePicker
        selected={selectedDate}
        onChange={(d: Date | null) => { if (d) onChange(formatDateLocal(d)); }}
        filterDate={(d: Date) => availSet.has(formatDateLocal(d))}
        dayClassName={(d: Date) => predSet.has(formatDateLocal(d)) ? 'has-predictions' : ''}
        minDate={minDate}
        maxDate={maxDate}
        dateFormat="EEE, MMM d"
        customInput={
          <button className={cn(
            'flex items-center gap-2 px-3.5 py-1.5 rounded-lg cursor-pointer min-w-[190px]',
            'border border-border bg-bg-elevated text-text-primary font-body transition-all duration-150 hover:border-border-bright',
          )}>
            <Calendar size={13} color="#00E5FF" />
            <span className="font-mono text-xs font-bold flex-1 text-center">
              {parseDateLocal(selected).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
            {predSet.has(selected) && (
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#FFB020', boxShadow: '0 0 6px #FFB020' }} />
            )}
          </button>
        }
        popperPlacement="bottom-start"
      />
      <Button variant="icon" disabled={!hasNext} onClick={() => hasNext && onChange(dates[idx + 1].date)}>
        <ChevronRight size={14} />
      </Button>
      {!isToday && availSet.has(todayStr) && (
        <Button variant="primary" size="sm" onClick={() => onChange(todayStr)}>TODAY</Button>
      )}
    </div>
  );
}

// ── Last Prediction Badge ───────────────────────────────────────────────────────
function LastPredictionBadge({ lastTs }: { lastTs: string | null }) {
  if (!lastTs) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bg-elevated border border-border">
        <Clock size={10} color="var(--text-secondary)" />
        <span className="font-mono text-[10px] text-text-secondary">No predictions yet</span>
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border" style={{ background: 'rgba(255,176,32,0.12)', borderColor: 'rgba(255,176,32,0.4)' }}>
      <Clock size={10} color="#FFB020" />
      <span className="font-mono text-[10px] font-bold" style={{ color: '#FFB020' }}>Last: {formatLocalHHMM(lastTs)}</span>
      <span className="w-1.5 h-1.5 rounded-full animate-pulse-slow" style={{ background: '#FFB020' }} />
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────────
export default function PredictionsPage({ coin }: Props) {
  const today = new Date().toISOString().slice(0, 10);

  const [availDates, setAvailDates]       = useState<IntradayDateEntry[]>([]);
  const [selDate, setSelDate]             = useState<string>(today);
  const [intraday, setIntraday]           = useState<IntradayResponse | null>(null);
  const [predictions, setPredictions]     = useState<PredictionsResponse | null>(null);
  const [predHistory, setPredHistory]     = useState<PredictionPoint[]>([]);
  const [loading, setLoading]             = useState(true);
  const [chartLoading, setChartLoading]   = useState(false);
  const [showHistory, setShowHistory]     = useState(false);

  const symbol   = coin === 'bitcoin' ? 'BTC' : 'DOGE';
  const decimals = coin === 'bitcoin' ? 2 : 6;
  const fmt = (n: number | null | undefined) =>
    n != null ? `$${n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}` : '—';

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchIntradayDates(coin),
      fetchPredictions(coin),
      fetchPredictionHistory(coin, 60).catch(() => [] as PredictionPoint[]),
    ]).then(([datesResp, pred, hist]) => {
      setAvailDates(datesResp.dates);
      setPredictions(pred);
      setPredHistory(hist);
      const lastDate = datesResp.dates[datesResp.dates.length - 1]?.date ?? today;
      setSelDate(lastDate);
    }).finally(() => setLoading(false));
  }, [coin]);

  const loadIntraday = useCallback(() => {
    if (!selDate) return;
    setChartLoading(true);
    fetchIntraday(coin, { date: selDate })
      .then(d => setIntraday(d))
      .catch(() => {})
      .finally(() => setChartLoading(false));
  }, [coin, selDate]);

  useEffect(() => { loadIntraday(); }, [loadIntraday]);

  useEffect(() => {
    const t = setInterval(() => { if (selDate === today) loadIntraday(); }, 300_000);
    return () => clearInterval(t);
  }, [loadIntraday, selDate, today]);

  const { candleData, actualLineData, predictedLineData, hasPredictions, accuracyStats, lastPredTs } = useMemo(() => {
    if (!intraday) return { candleData: [], actualLineData: [], predictedLineData: [], hasPredictions: false, accuracyStats: null, lastPredTs: null };

    const candleData: IntraCandle[] = intraday.actual.map(d => ({
      time: toUnixSeconds(d.t), open: d.o ?? d.c, high: d.h ?? d.c, low: d.l ?? d.c, close: d.c,
    }));
    const actualLineData: IntraLine[]    = intraday.actual.map(d => ({ time: toUnixSeconds(d.t), value: d.c }));
    const hasPredictions                  = intraday.predicted.length > 0;
    const predictedLineData: IntraLine[] = intraday.predicted.map(p => ({ time: toUnixSeconds(p.t), value: p.close }));
    const lastPredTs: string | null      = hasPredictions ? intraday.predicted[intraday.predicted.length - 1].t : null;

    const actualMap = new Map<number, number>();
    intraday.actual.forEach(d => actualMap.set(toUnixSeconds(d.t), d.c));
    const pairs = intraday.predicted.map(p => {
      const ts = toUnixSeconds(p.t);
      const act = actualMap.get(ts);
      return act != null ? { actual: act, pred: p.close } : null;
    }).filter((x): x is { actual: number; pred: number } => x !== null);

    const accuracyStats = pairs.length >= 3
      ? { mae: pairs.reduce((s, p) => s + Math.abs((p.pred - p.actual) / p.actual) * 100, 0) / pairs.length, n: pairs.length }
      : null;

    return { candleData, actualLineData, predictedLineData, hasPredictions, accuracyStats, lastPredTs };
  }, [intraday]);

  const outlook = useMemo(() => {
    const preds = predictions?.predictions ?? [];
    const up   = preds.filter(p => p.direction === 'UP').length;
    const down = preds.filter(p => p.direction === 'DOWN').length;
    const flat = preds.filter(p => p.direction === 'FLAT').length;
    if (up > down && up > flat)   return { label: 'BULLISH', color: '#00F0A0', Icon: TrendingUp,   count: `${up}/7` };
    if (down > up && down > flat) return { label: 'BEARISH', color: '#FF3864', Icon: TrendingDown, count: `${down}/7` };
    return                               { label: 'NEUTRAL', color: '#FFB020', Icon: Minus,        count: `${flat}/7` };
  }, [predictions]);

  if (loading) {
    return (
      <div>
        <div className="grid grid-cols-4 gap-3 mb-5">
          {[1,2,3,4].map(i => <Skeleton key={i} style={{ height: '88px', borderRadius: '12px' }} />)}
        </div>
        <Skeleton style={{ height: '560px', borderRadius: '12px', marginBottom: '16px' }} />
        <Skeleton style={{ height: '240px', borderRadius: '12px' }} />
      </div>
    );
  }

  const selEntry = availDates.find(d => d.date === selDate);
  const maeBadgeColor = accuracyStats
    ? (accuracyStats.mae < 0.5 ? '#00F0A0' : accuracyStats.mae < 2 ? '#FFB020' : '#FF3864')
    : '#556070';

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="font-display text-lg font-bold text-text-primary tracking-wider m-0">LSTM PREDICTIONS</h1>
            <Badge variant="model">DUAL-HEAD v2</Badge>
          </div>
          <p className="text-text-secondary text-xs font-body">
            {symbol} · 5-min intraday predictions + 7-day daily outlook
          </p>
        </div>
        {accuracyStats && (
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border"
            style={{ background: `${maeBadgeColor}18`, borderColor: `${maeBadgeColor}40` }}
          >
            <Activity size={12} color={maeBadgeColor} />
            <span className="font-mono text-[11px] font-bold" style={{ color: maeBadgeColor }}>
              MAE {accuracyStats.mae.toFixed(3)}%
            </span>
            <span className="text-[10px] text-text-secondary font-body">on {accuracyStats.n} pts</span>
          </div>
        )}
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <Card variant="highlight" accent="cyan" className="p-5">
          <div className="metric-label text-[10px] font-semibold text-text-secondary uppercase tracking-widest font-body mb-2.5">Next-Day Forecast</div>
          <div className="font-mono text-[18px] font-bold text-cyan leading-none mb-2">{fmt(predictions?.next_day_price)}</div>
          {predictions?.predictions?.[0] && (
            <DirectionBadge direction={predictions.predictions[0].direction} prob={predictions.predictions[0].direction_prob} />
          )}
        </Card>

        <MetricCard label="7-Day High" value={fmt(predictions?.seven_day_high)} valueColor="#00F0A0" sub="Ceiling forecast" />
        <MetricCard label="7-Day Low"  value={fmt(predictions?.seven_day_low)}  valueColor="#FF3864" sub="Floor forecast" />

        <Card className="p-5" style={{ background: `linear-gradient(135deg, var(--bg-card), ${outlook.color}06)` }}>
          <div className="metric-label text-[10px] font-semibold text-text-secondary uppercase tracking-widest font-body mb-2.5">7-Day Outlook</div>
          <div className="flex items-center gap-2 mb-1">
            <outlook.Icon size={18} color={outlook.color} />
            <span className="font-display text-[13px] font-bold tracking-widest" style={{ color: outlook.color }}>{outlook.label}</span>
          </div>
          <div className="text-[11px] text-text-secondary font-body">{outlook.count} days · direction head</div>
        </Card>
      </div>

      {/* Intraday chart card */}
      <Card className="mb-4">
        <div className="flex items-start justify-between px-5 py-4 border-b border-border flex-wrap gap-3">
          <div>
            <div className="text-[13px] font-bold text-text-primary font-body mb-1">5-Min Price — {selDate}</div>
            <div className="text-[11px] text-text-secondary font-body flex gap-3 items-center">
              <span>{selEntry?.candle_count ?? intraday?.actual_count ?? 0} candles</span>
              {hasPredictions
                ? <span className="text-gold">· {intraday!.predicted_count} predictions</span>
                : <span>· no predictions for this day</span>
              }
            </div>
          </div>
          {availDates.length > 0 && (
            <DatePickerNav dates={availDates} selected={selDate} onChange={setSelDate} />
          )}
        </div>

        <div className="p-5">
          {/* Candlestick */}
          <div style={{ opacity: chartLoading ? 0.5 : 1, transition: 'opacity 0.2s' }}>
            {intraday && candleData.length > 0 ? (
              <IntradayCandlestickChart candles={candleData} height={280} />
            ) : (
              <div className="h-72 flex flex-col items-center justify-center gap-3 text-text-secondary font-body text-sm">
                <Activity size={28} style={{ opacity: 0.4 }} />
                {chartLoading ? 'Loading…' : 'No 5-min data for this date'}
              </div>
            )}
          </div>

          <div className="h-px bg-border my-4" />

          {/* Compare chart header */}
          <div className="flex items-center justify-between mb-2.5 flex-wrap gap-2">
            <div className="flex gap-5 text-[11px] font-body">
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-0.5 rounded bg-cyan" />
                <span className="text-text-secondary">Actual close</span>
              </div>
              <div className="flex items-center gap-1.5">
                <svg width="16" height="8">
                  <line x1="0" y1="4" x2="16" y2="4" stroke="#FFB020" strokeWidth="2" strokeDasharray="4 2" />
                </svg>
                <span className="text-text-secondary">Predicted close</span>
              </div>
            </div>
            <LastPredictionBadge lastTs={lastPredTs} />
          </div>

          {/* Compare chart */}
          <div style={{ opacity: chartLoading ? 0.5 : 1, transition: 'opacity 0.2s' }}>
            {intraday && (actualLineData.length > 0 || predictedLineData.length > 0) ? (
              <IntradayCompareChart actualLine={actualLineData} predictedLine={predictedLineData} height={220} />
            ) : (
              <div className="h-52 flex flex-col items-center justify-center gap-2.5 text-text-secondary font-body text-xs">
                <Minus size={22} style={{ opacity: 0.3 }} />
                {chartLoading ? 'Loading…' : 'No comparison data available'}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 mt-3 text-[10px] text-text-muted font-body">
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#FFB020', boxShadow: '0 0 5px #FFB020' }} />
            Dates with a gold dot in the picker have prediction data available
          </div>
        </div>
      </Card>

      {/* 7-Day Forecast Table */}
      <Card className="mb-4 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <div className="text-[13px] font-bold text-text-primary font-body">7-Day Daily Forecast</div>
          <div className="text-[11px] text-text-secondary font-body">
            Model: <span className="font-mono text-violet">{predictions?.model_version ?? '—'}</span>
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
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-md text-[11px] font-mono font-bold text-text-secondary bg-bg-elevated border border-border">{i + 1}</span>
                </td>
                <td><span className="font-mono text-xs text-text-primary">{p.prediction_date.split('T')[0]}</span></td>
                <td style={{ textAlign: 'right' }}>
                  <span className="font-mono text-sm font-bold text-cyan">{fmt(p.predicted_price)}</span>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <DirectionBadge direction={p.direction} prob={p.direction_prob} />
                </td>
                <td><StrengthBar strength={p.trend_strength} /></td>
                <td style={{ textAlign: 'right' }}>
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-10 h-0.5 rounded-full overflow-hidden bg-border">
                      <div className="h-full rounded-full" style={{ width: `${p.confidence * 100}%`, background: '#8B5CF6' }} />
                    </div>
                    <span className="font-mono text-[11px] text-text-secondary min-w-[28px]">{(p.confidence * 100).toFixed(0)}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Prediction History */}
      {predHistory.length > 0 && (
        <Card className="overflow-hidden">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-white/[0.015] transition-colors duration-150"
            style={{ background: 'none', border: 'none', borderBottom: showHistory ? '1px solid var(--border)' : 'none' }}
          >
            <div className="flex items-center gap-2.5">
              <Brain size={15} color="var(--violet)" />
              <span className="text-[13px] font-semibold text-text-primary font-body">Daily Prediction Run History</span>
              <Badge variant="model">{predHistory.length} records</Badge>
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
                    <td className="font-mono text-xs">{p.prediction_date.split('T')[0]}</td>
                    <td style={{ textAlign: 'right' }}><span className="font-mono font-bold text-gold">{fmt(p.predicted_price)}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="font-mono" style={{ color: p.actual_price ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {p.actual_price ? fmt(p.actual_price) : '—'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {p.error_pct != null ? (
                        <span className="font-mono text-[11px] font-bold" style={{
                          color: Math.abs(p.error_pct) < 2 ? '#00F0A0' : Math.abs(p.error_pct) < 5 ? '#FFB020' : '#FF3864',
                        }}>
                          {p.error_pct >= 0 ? '+' : ''}{p.error_pct.toFixed(2)}%
                        </span>
                      ) : <span className="text-text-muted text-[11px]">—</span>}
                    </td>
                    <td style={{ textAlign: 'center' }}><DirectionBadge direction={p.direction} prob={p.direction_prob} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
