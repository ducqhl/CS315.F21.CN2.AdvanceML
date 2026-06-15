export const HORIZONS = [
  { value: 7,  label: 'H7',  days: '7-Day',  detail: 'Short-term momentum', historyDays: 30  },
  { value: 15, label: 'H15', days: '15-Day', detail: 'Medium-term trend',   historyDays: 90  },
  { value: 60, label: 'H60', days: '60-Day', detail: '6-Month context',     historyDays: 180 },
] as const;

export type HorizonValue = 7 | 15 | 60;
