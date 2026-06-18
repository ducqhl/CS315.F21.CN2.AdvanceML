import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Minus, Clock } from 'lucide-react';
import {
  fetchHistorical, fetchPredictions, fetchPredictionHistory,
  fetchModels, triggerRetrain, fetchRetrainStatus,
  predictNow, fetchPredictStatus,
} from '../api/client';
import type { RetrainJob, ModelRegistryEntry, PredictJob } from '../api/client';
import { coinSymbol, coinDecimals, type Coin } from '../lib/coin';
import Toast, { type ToastState } from '../components/ui/Toast';
import { HORIZONS, type HorizonValue } from './predictions/constants';
import HorizonSelector from './predictions/components/HorizonSelector';
import ModelVersionSelector from './predictions/components/ModelVersionSelector';
import ForecastChart, { type ForecastChartPoint } from './predictions/components/ForecastChart';
import MetricsPanel from './predictions/components/MetricsPanel';
import ForecastTable from './predictions/components/ForecastTable';
import RetrainPanel from './predictions/components/RetrainPanel';
import PredictionHistory from './predictions/components/PredictionHistory';

interface Props { coin: Coin }

export default function PredictionsPage({ coin }: Props) {
  const symbol   = coinSymbol(coin);
  const decimals = coinDecimals(coin);
  const queryClient = useQueryClient();

  const [activeHorizon,   setActiveHorizon]   = useState<HorizonValue>(7);
  const [selectedModelId, setSelectedModelId]  = useState<string | null>(null);
  const [predicting,      setPredicting]       = useState(false);
  const [predictJobs,     setPredictJobs]      = useState<Record<string, PredictJob>>({});
  const [retrainLoading,  setRetrainLoading]   = useState(false);
  const [showHistory,     setShowHistory]      = useState(false);
  const [showRetrain,     setShowRetrain]      = useState(false);
  const [forecastPage,    setForecastPage]     = useState(1);
  const FORECAST_PAGE_SIZE = 7;
  const [histPage,        setHistPage]         = useState(1);
  const HIST_PAGE_SIZE = 15;
  const [toast,           setToast]            = useState<ToastState>(null);
  const [retrainJobs,     setRetrainJobs]      = useState<RetrainJob[]>([]);

  const { data: history = [] } = useQuery({
    queryKey: ['historical', coin, 180],
    queryFn:  () => fetchHistorical(coin, 180),
    staleTime: 300_000,
  });

  const { data: models = [] } = useQuery({
    queryKey: ['ml-models', symbol],
    queryFn:  async () => {
      const r = await fetchModels(symbol);
      // Default the view to H7 if trained, else the first horizon that has a model.
      if (!r.models.some(m => m.horizon === activeHorizon && m.model_exists)) {
        const firstTrained = [7, 15, 60].find(h => r.models.some(m => m.horizon === h && m.model_exists));
        if (firstTrained) setActiveHorizon(firstTrained as HorizonValue);
      }
      return r.models;
    },
    staleTime: 60_000,
  });

  // Versions available for the active horizon, newest-first (the default lives at [0])
  const activeVersions = useMemo<ModelRegistryEntry[]>(() => (
    models
      .filter(m => m.horizon === activeHorizon)
      .sort((a, b) => Number(b.is_newest) - Number(a.is_newest) || b.version - a.version)
  ), [models, activeHorizon]);

  const newestModel   = activeVersions.find(m => m.is_newest) ?? activeVersions[0] ?? null;
  const selectedModel = activeVersions.find(m => m.model_id === selectedModelId) ?? newestModel;
  const viewingArchived = !!selectedModel && !selectedModel.is_newest;

  // When the active horizon (or its model set) changes, snap selection back to newest
  useEffect(() => {
    if (newestModel) setSelectedModelId(newestModel.model_id);
  }, [activeHorizon, newestModel?.model_id]);

  // Newest is auto-predicted by the scheduler → query by horizon (keeps legacy fallback).
  // Archived versions are filtered strictly by model_id.
  const viewModelId = viewingArchived ? selectedModel!.model_id : undefined;

  const { data: predictions, isLoading: loadingPred } = useQuery({
    queryKey: ['predictions', coin, activeHorizon, viewModelId ?? 'newest'],
    queryFn:  () => fetchPredictions(coin, activeHorizon, viewModelId),
    staleTime: 120_000,
  });

  // Poll on-demand predict job status while one is in flight for the selected model
  const selectedJob = selectedModel ? predictJobs[selectedModel.model_id] : undefined;
  const jobInFlight = selectedJob?.status === 'pending' || selectedJob?.status === 'running';
  useQuery({
    queryKey: ['predict-status', symbol, selectedModel?.model_id],
    queryFn:  async () => {
      const r = await fetchPredictStatus(symbol, selectedModel?.model_id);
      const latest = r.jobs[0];
      if (latest && selectedModel) {
        setPredictJobs(prev => ({ ...prev, [selectedModel.model_id]: latest }));
        if (latest.status === 'completed') {
          queryClient.invalidateQueries({ queryKey: ['predictions', coin, activeHorizon, selectedModel.model_id] });
        }
      }
      return r.jobs;
    },
    enabled: jobInFlight,
    refetchInterval: jobInFlight ? 5_000 : false,
    staleTime: 0,
  });

  const { data: predHistoryPage } = useQuery({
    queryKey: ['predictions-history', coin, activeHorizon, histPage, HIST_PAGE_SIZE],
    queryFn:  () => fetchPredictionHistory(coin, histPage, HIST_PAGE_SIZE, activeHorizon),
    staleTime: 300_000,
    placeholderData: keepPreviousData,
  });

  // Reset to first page + newest model when the coin changes
  useEffect(() => { setHistPage(1); setSelectedModelId(null); }, [coin]);

  // Polling for retrain jobs when panel is open
  useQuery({
    queryKey: ['retrain-jobs', symbol],
    queryFn:  async () => {
      const r = await fetchRetrainStatus(symbol);
      setRetrainJobs(r.jobs);
      return r.jobs;
    },
    enabled: showRetrain,
    refetchInterval: showRetrain ? 8_000 : false,
    staleTime: 0,
  });

  const showToast = useCallback((msg: string, type: 'ok' | 'err') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // H7 / H15 / H60 are independent models that run in parallel — selecting one is
  // a pure client-side view switch (no server-side "active" mutation, no toast).
  const handleHorizonSelect = useCallback((h: HorizonValue) => {
    if (h === activeHorizon) return;
    const entry = models.find(m => m.horizon === h);
    if (!entry?.model_exists) return;
    setActiveHorizon(h);
    setForecastPage(1);
    setHistPage(1);
    setSelectedModelId(null);
  }, [activeHorizon, models]);

  const handleRetrain = useCallback(async (h: number) => {
    setRetrainLoading(true);
    try {
      const job = await triggerRetrain(coin, h);
      setRetrainJobs(prev => [job, ...prev.filter(j => j.job_id !== job.job_id)]);
      showToast(`Retrain queued for H${h}`, 'ok');
    } catch {
      showToast('Failed to queue retrain', 'err');
    } finally {
      setRetrainLoading(false);
    }
  }, [coin, showToast]);

  const handlePredictNow = useCallback(async (model: ModelRegistryEntry) => {
    setPredicting(true);
    try {
      const job = await predictNow(coin, model.model_id);
      setPredictJobs(prev => ({ ...prev, [model.model_id]: job }));
      showToast(`Prediction queued for ${model.version_label}`, 'ok');
    } catch {
      showToast('Failed to queue prediction', 'err');
    } finally {
      setPredicting(false);
    }
  }, [coin, showToast]);

  const activeHistoryDays = HORIZONS.find(h => h.value === activeHorizon)?.historyDays ?? 30;

  // Chart data: N-day history + forecast
  const chartData = useMemo<ForecastChartPoint[]>(() => {
    const histPts = history.slice(-activeHistoryDays).map(d => ({
      date:     d.date.slice(0, 10),
      actual:   d.avg_close,
      forecast: null as number | null,
      isForecast: false,
    }));
    // Dedupe forecast points by date. The API back-compat filter can return both
    // the active model's doc and a stale legacy doc (no model_id) for the same
    // date — two prices per day plotted in date order produce a sawtooth wave.
    // Keep the active model's doc when present, else the first seen.
    const activeId = predictions?.active_model_id ?? null;
    const byDate = new Map<string, number>();
    for (const p of predictions?.predictions ?? []) {
      const day = p.prediction_date.slice(0, 10);
      const isActive = activeId != null && p.model_id === activeId;
      if (!byDate.has(day) || isActive) byDate.set(day, p.predicted_price);
    }
    const fcstPts = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, price]) => ({
        date,
        actual:     null as number | null,
        forecast:   price,
        isForecast: true,
      }));
    // Bridge: connect last history point to first forecast
    if (histPts.length && fcstPts.length) {
      fcstPts[0] = { ...fcstPts[0], actual: histPts[histPts.length - 1].actual };
    }
    return [...histPts, ...fcstPts];
  }, [history, predictions, activeHistoryDays]);

  const historicalMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const h of history) {
      map[h.date.slice(0, 10)] = h.avg_close;
    }
    return map;
  }, [history]);

  const todayIndex  = history.slice(-activeHistoryDays).length - 1;
  const todayDate   = chartData[todayIndex]?.date ?? null;

  const outlook = useMemo(() => {
    const preds = predictions?.predictions ?? [];
    const n = preds.length || 1;
    const up   = preds.filter(p => p.direction === 'UP').length;
    const down = preds.filter(p => p.direction === 'DOWN').length;
    const flat = preds.filter(p => p.direction === 'FLAT').length;
    if (up   > down && up   > flat) return { label: 'Bullish',  color: 'var(--up)',   Icon: TrendingUp,   count: `${up}/${n}` };
    if (down > up   && down > flat) return { label: 'Bearish',  color: 'var(--down)', Icon: TrendingDown, count: `${down}/${n}` };
    return                                 { label: 'Neutral',  color: 'var(--warn)', Icon: Minus,        count: `${flat}/${n}` };
  }, [predictions]);

  const allForecasts = predictions?.predictions ?? [];
  const totalPages = Math.max(1, Math.ceil(allForecasts.length / FORECAST_PAGE_SIZE));
  const visibleForecasts = allForecasts.slice(
    (forecastPage - 1) * FORECAST_PAGE_SIZE,
    forecastPage * FORECAST_PAGE_SIZE,
  );

  const visibleHistory   = predHistoryPage?.items ?? [];
  const totalHistRecords = predHistoryPage?.total ?? 0;
  const totalHistPages   = predHistoryPage?.total_pages ?? 1;

  // Windowed page numbers (current ±2) so the control never overflows its row
  const histPageWindow = useMemo(() => {
    const span = 2;
    const start = Math.max(1, histPage - span);
    const end   = Math.min(totalHistPages, histPage + span);
    const pages: number[] = [];
    for (let p = start; p <= end; p++) pages.push(p);
    return pages;
  }, [histPage, totalHistPages]);

  const periodLabel = `${activeHorizon}-Day`;

  return (
    <div style={{ position: 'relative' }}>
      <Toast toast={toast} />

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 className="font-display" style={{ margin: 0, fontSize: '22px', color: 'var(--text-primary)' }}>
            Predictions
          </h1>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px', fontFamily: 'Plus Jakarta Sans' }}>
            {symbol} · LSTM dual-head · {periodLabel} daily forecast
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans' }}>
          <Clock size={11} />
          {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      <HorizonSelector
        activeHorizon={activeHorizon}
        models={models}
        onSelect={handleHorizonSelect}
      />

      {activeVersions.length > 0 && (
        <ModelVersionSelector
          activeHorizon={activeHorizon}
          activeVersions={activeVersions}
          selectedModel={selectedModel}
          viewingArchived={viewingArchived}
          hasForecast={(predictions?.predictions?.length ?? 0) > 0}
          selectedJob={selectedJob}
          predicting={predicting}
          onSelectModel={setSelectedModelId}
          onPredictNow={handlePredictNow}
        />
      )}

      {/* ── Main: chart + sidebar metrics ─────────────────────────────────────── */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 280px', gap: '14px',
        marginBottom: '14px',
        opacity: loadingPred ? 0.5 : 1,
        transition: 'opacity 0.2s',
        pointerEvents: loadingPred ? 'none' : undefined,
      }}>
        <ForecastChart
          coin={coin}
          decimals={decimals}
          data={chartData}
          historyDays={activeHistoryDays}
          periodLabel={periodLabel}
          todayDate={todayDate}
          loading={loadingPred}
        />
        <MetricsPanel
          predictions={predictions}
          decimals={decimals}
          periodLabel={periodLabel}
          outlook={outlook}
        />
      </div>

      <ForecastTable
        periodLabel={periodLabel}
        decimals={decimals}
        loading={loadingPred}
        viewingArchived={viewingArchived}
        modelLabel={selectedModel?.model_id ?? predictions?.active_model_id ?? predictions?.model_version ?? '—'}
        rows={visibleForecasts}
        historicalMap={historicalMap}
        pageOffset={(forecastPage - 1) * FORECAST_PAGE_SIZE}
        page={forecastPage}
        totalPages={totalPages}
        onPageChange={setForecastPage}
      />

      <RetrainPanel
        open={showRetrain}
        onToggle={() => setShowRetrain(v => !v)}
        retrainJobs={retrainJobs}
        retrainLoading={retrainLoading}
        onRetrain={handleRetrain}
      />

      {totalHistRecords > 0 && (
        <PredictionHistory
          open={showHistory}
          onToggle={() => setShowHistory(v => !v)}
          totalRecords={totalHistRecords}
          rows={visibleHistory}
          decimals={decimals}
          page={histPage}
          totalPages={totalHistPages}
          pageWindow={histPageWindow}
          onPageChange={setHistPage}
        />
      )}
    </div>
  );
}
