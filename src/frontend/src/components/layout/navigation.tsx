import {
  LayoutDashboard, Activity, BarChart2, Brain, GitBranch, Cpu, FileText,
} from 'lucide-react';

export type Page =
  | 'dashboard' | 'realtime' | 'technical' | 'predictions'
  | 'correlation' | 'models' | 'lstm-research' | 'docs';

export const PUBLIC_PAGES = new Set<Page>(['docs', 'lstm-research']);

export const NAV_ITEMS: { id: Page; label: string; icon: React.ReactNode; badge?: string }[] = [
  { id: 'dashboard',   label: 'Overview',        icon: <LayoutDashboard size={15} /> },
  { id: 'realtime',    label: 'Real-time',        icon: <Activity size={15} /> },
  { id: 'technical',   label: 'Technical',        icon: <BarChart2 size={15} /> },
  { id: 'predictions', label: 'Predictions',      icon: <Brain size={15} />, badge: 'LSTM' },
  { id: 'correlation', label: 'Correlation',      icon: <GitBranch size={15} /> },
  { id: 'models',      label: 'Model Registry',   icon: <Cpu size={15} /> },
  { id: 'docs',        label: 'Documents',        icon: <FileText size={15} />, badge: '12' },
];

export const pageVariants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -4 },
};
