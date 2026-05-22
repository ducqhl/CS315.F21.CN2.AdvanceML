import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
});

// Types
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
  rsi?: number | null;
  symbol?: string;
}

export interface PredictionPoint {
  coin: string;
  predicted_price: number;
  prediction_date: string;
  confidence: number;
  model_version: string;
  created_at: string;
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

// API functions
export const fetchRealtime = (coin: string) =>
  api.get<RealtimeResponse>(`/realtime/${coin}`).then(r => r.data);

export const fetchHistorical = (coin: string, days = 90) =>
  api.get<HistoricalPoint[]>(`/historical/${coin}`, { params: { days } }).then(r => r.data);

export const fetchPredictions = (coin: string) =>
  api.get<PredictionsResponse>(`/predictions/${coin}`).then(r => r.data);

export const fetchTechnical = (coin: string, days = 180) =>
  api.get<HistoricalPoint[]>(`/technical/${coin}`, { params: { days } }).then(r => r.data);

export const fetchCorrelation = () =>
  api.get<CorrelationResponse>('/correlation').then(r => r.data);

export const fetchStats = () =>
  api.get<StatsResponse>('/stats').then(r => r.data);
