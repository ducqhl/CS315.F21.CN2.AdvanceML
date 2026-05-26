import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
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
  created_at: string;
  run_date?: string;          // when this prediction was made (from prediction_runs)
  actual_price?: number;      // actual closing price for that date (joined from historical_sma)
  error_pct?: number;         // (predicted - actual) / actual * 100
  direction?: 'UP' | 'FLAT' | 'DOWN';
  direction_prob?: number;
  trend_strength?: 'STRONG' | 'MODERATE' | 'WEAK';
}

export interface PredictionsResponse {
  coin: string;
  model_version: string;
  predictions: PredictionPoint[];
  next_day_price: number | null;
  seven_day_high: number | null;
  seven_day_low: number | null;
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

// ── Auth token management ──────────────────────────────────────────────────────
const TOKEN_KEY = 'crypto_jwt';

export const authStorage = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (token: string): void => localStorage.setItem(TOKEN_KEY, token),
  clear: (): void => localStorage.removeItem(TOKEN_KEY),
};

// Request interceptor — attach Bearer token
api.interceptors.request.use(config => {
  const token = authStorage.get();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — clear token on 401
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      authStorage.clear();
      // Dispatch custom event so AuthContext can react
      window.dispatchEvent(new Event('auth:logout'));
    }
    return Promise.reject(error);
  }
);

// ── Auth API ───────────────────────────────────────────────────────────────────
export const login = (req: LoginRequest) =>
  api.post<LoginResponse>('/auth/login', req).then(r => r.data);

export const getMe = () =>
  api.get<AuthUser>('/auth/me').then(r => r.data);

// ── Data API ───────────────────────────────────────────────────────────────────
export const fetchRealtime = (coin: string) =>
  api.get<RealtimeResponse>(`/realtime/${coin}`).then(r => r.data);

export const fetchHistorical = (coin: string, days = 90) =>
  api.get<HistoricalPoint[]>(`/historical/${coin}`, { params: { days } }).then(r => r.data);

export const fetchPredictions = (coin: string) =>
  api.get<PredictionsResponse>(`/predictions/${coin}`).then(r => r.data);

export const fetchPredictionHistory = (coin: string, days = 30) =>
  api.get<PredictionPoint[]>(`/predictions/${coin}/history`, { params: { days } }).then(r => r.data);

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

export interface IntradayPrediction {
  t: string;   // target_timestamp ISO
  close: number;
  direction?: 'UP' | 'FLAT' | 'DOWN';
  confidence?: number;
}

export interface IntradayResponse {
  symbol: string;
  range: string;
  actual: IntradayCandle[];
  predicted: IntradayPrediction[];
  actual_count: number;
  predicted_count: number;
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
