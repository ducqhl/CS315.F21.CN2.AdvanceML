import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  withCredentials: true,
});

// ── Types ──────────────────────────────────────────────────────────────────────
export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  username: string;
  expires_in: number;
}

export interface AuthUser {
  username: string;
  role: string;
}

export interface HistoricalPoint {
  date: string;
  avg_close: number;
  sma_20?: number;
  sma_50?: number;
  sma_200?: number;
  avg_volume?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  daily_high?: number;
  daily_low?: number;
  rsi?: number | null;
  macd?: number | null;
  macd_signal?: number | null;
  macd_histogram?: number | null;
  bb_upper?: number | null;
  bb_lower?: number | null;
  bb_middle?: number | null;
  symbol?: string;
}

export interface PredictionPoint {
  coin: string;
  predicted_price: number;
  prediction_date: string;
  confidence: number;
  model_version: string;
  model_id?: string;          // model file stem that produced this forecast
  version?: number;           // numeric version of that model
  created_at: string;
  run_date?: string;          // when this prediction was made (from prediction_runs)
  actual_price?: number;      // actual closing price for that date (joined from historical_sma)
  error_pct?: number;         // (predicted - actual) / actual * 100
  direction?: 'UP' | 'FLAT' | 'DOWN';
  direction_prob?: number;
  trend_strength?: 'STRONG' | 'MODERATE' | 'WEAK';
}

export interface PredictionHistoryResponse {
  items: PredictionPoint[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface PredictionsResponse {
  coin: string;
  model_version: string | null;
  active_horizon: number;
  active_model_id?: string | null;
  predictions: PredictionPoint[];
  next_day_price: number | null;
  seven_day_high: number | null;
  seven_day_low: number | null;
  dominant_direction?: string;
  avg_confidence?: number | null;
  message?: string;
}

export interface CorrelationResponse {
  coins: string[];
  matrix: Record<string, Record<string, number>>;
  docs: Array<{
    coin_a: string;
    coin_b: string;
    pearson_corr: number;
    computed_at: string;
  }>;
}

export interface StatsResponse {
  doc_counts: Record<string, number>;
  latest_prices: Record<string, { price: number; date: string }>;
  timestamp: string;
}

export interface RealtimeResponse {
  symbol?: string;
  price?: number;
  avg_close?: number;
  source: string;
  date?: string;
  timestamp?: string;
  daily_high?: number;
  daily_low?: number;
  avg_volume?: number;
  [key: string]: unknown;
}

export interface InferenceJobStatus {
  coin: string;
  status: 'ok' | 'error' | 'unknown' | 'running';
  last_run_at?: string;
  last_run_duration_ms?: number;
  seed_source?: string;
  model_version?: string;
  run_count?: number;
}

export interface InferenceStatusResponse {
  jobs: Record<string, InferenceJobStatus>;
  interval_seconds: number;
  timestamp: string;
}

// Response interceptor — dispatch logout event on 401
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      window.dispatchEvent(new Event('auth:logout'));
    }
    return Promise.reject(error);
  }
);

// ── Auth API ───────────────────────────────────────────────────────────────────
export const login = (req: LoginRequest) =>
  api.post<LoginResponse>('/auth/login', req).then(r => r.data);

export const logoutApi = () =>
  api.post('/auth/logout').then(r => r.data);

export const getMe = () =>
  api.get<AuthUser>('/auth/me').then(r => r.data);

// ── Data API ───────────────────────────────────────────────────────────────────
export const fetchRealtime = (coin: string) =>
  api.get<RealtimeResponse>(`/realtime/${coin}`).then(r => r.data);

export const fetchHistorical = (coin: string, days = 90) =>
  api.get<HistoricalPoint[]>(`/historical/${coin}`, { params: { days } }).then(r => r.data);

export const fetchPredictions = (coin: string, horizon?: number, modelId?: string) =>
  api.get<PredictionsResponse>(`/predictions/${coin}`, {
    params: { ...(horizon ? { horizon } : {}), ...(modelId ? { model_id: modelId } : {}) },
  }).then(r => r.data);

export const fetchPredictionHistory = (coin: string, page = 1, limit = 15, horizon?: number, days = 60) =>
  api.get<PredictionHistoryResponse>(`/predictions/${coin}/history`, {
    params: { page, limit, days, ...(horizon ? { horizon } : {}) },
  }).then(r => r.data);

export const fetchTechnical = (coin: string, days = 180) =>
  api.get<HistoricalPoint[]>(`/technical/${coin}`, { params: { days } }).then(r => r.data);

export const fetchCorrelation = () =>
  api.get<CorrelationResponse>('/correlation').then(r => r.data);

export const fetchStats = () =>
  api.get<StatsResponse>('/stats').then(r => r.data);

export const fetchInferenceStatus = () =>
  api.get<InferenceStatusResponse>('/inference/status').then(r => r.data);

// ── Intraday types ─────────────────────────────────────────────────────────────
export interface IntradayCandle {
  t: string;   // ISO timestamp
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface IntradayResponse {
  symbol: string;
  range: string;
  actual: IntradayCandle[];
  actual_count: number;
}

export type IntradayRange = '24h' | '3d' | '7d' | 'all';

export interface IntradayDateEntry {
  date: string;          // YYYY-MM-DD
  candle_count: number;
  has_predictions: boolean;
}

export interface IntradayDatesResponse {
  symbol: string;
  dates: IntradayDateEntry[];
}

export const fetchIntradayDates = (coin: string) =>
  api.get<IntradayDatesResponse>(`/intraday/${coin}/dates`).then(r => r.data);

export const fetchIntraday = (coin: string, params: { date?: string; range?: IntradayRange } = {}) =>
  api.get<IntradayResponse>(`/intraday/${coin}`, { params }).then(r => r.data);

// ── ML Model Registry types ────────────────────────────────────────────────────
export interface FoldMetric {
  fold: number;
  rmse: number;
  mae: number;
  dir_acc: number;
  n_train: number;
  n_val: number;
}

export interface ScoreReport {
  coin: string;
  horizon: number;
  rmse: number;
  mae: number;
  directional_accuracy_pct: number;
  walk_forward_dir_acc_mean?: number | null;
  walk_forward_rmse_mean?: number | null;
  per_fold_metrics?: FoldMetric[];
  epochs_trained?: number | null;
  best_val_loss?: number | null;
  window_days?: number | null;
}

export interface ModelRegistryEntry {
  coin: string;
  coin_id: string;
  horizon: number;
  version: number;
  version_label: string;       // "v3" | "v2 (legacy)"
  model_id: string;            // "lstm_bitcoin_h7_v3"
  is_legacy: boolean;
  is_newest: boolean;          // newest version for its horizon (default)
  model_exists: boolean;
  is_active: boolean;          // newest model of the coin's active horizon
  metrics?: {
    rmse?: number;
    mae?: number;
    directional_accuracy_pct?: number;
    epochs_trained?: number;
    best_val_loss?: number;
  } | null;
  score_report?: ScoreReport | null;
  registered_at?: string;
}

export interface ModelRegistryResponse {
  models: ModelRegistryEntry[];
  count: number;
  valid_horizons: number[];
}

export interface RetrainJob {
  job_id: string;
  coin: string;
  horizon: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  message?: string;
  created_at?: string;
  started_at?: string;
  finished_at?: string;
  error?: string | null;
}

export interface RetrainStatusResponse {
  jobs: RetrainJob[];
  count: number;
}

export const fetchModels = (coin?: string) =>
  api.get<ModelRegistryResponse>('/ml/models', { params: coin ? { coin } : {} }).then(r => r.data);

export const setActiveModel = (coin: string, horizon: number) =>
  api.put<{ status: string; coin: string; horizon: number; message: string }>('/ml/models/active', { coin, horizon }).then(r => r.data);

export const triggerRetrain = (coin: string, horizon: number) =>
  api.post<RetrainJob>('/ml/retrain', { coin, horizon }).then(r => r.data);

export const fetchRetrainStatus = (coin?: string) =>
  api.get<RetrainStatusResponse>('/ml/retrain/status', { params: coin ? { coin } : {} }).then(r => r.data);

// ── On-demand prediction (predict with a specific model version) ─────────────────
export interface PredictJob {
  job_id: string;
  coin: string;
  model_id: string;
  horizon?: number;
  version?: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  message?: string;
  created_at?: string;
  started_at?: string;
  finished_at?: string;
  error?: string | null;
}

export interface PredictStatusResponse {
  jobs: PredictJob[];
  count: number;
}

export const predictNow = (coin: string, modelId: string) =>
  api.post<PredictJob>('/ml/predict', { coin, model_id: modelId }).then(r => r.data);

export const fetchPredictStatus = (coin?: string, modelId?: string) =>
  api.get<PredictStatusResponse>('/ml/predict/status', {
    params: { ...(coin ? { coin } : {}), ...(modelId ? { model_id: modelId } : {}) },
  }).then(r => r.data);

// ── System Overview ────────────────────────────────────────────────────────────
export const fetchSystemOverview = () =>
  api.get('/system/overview').then(r => r.data);
