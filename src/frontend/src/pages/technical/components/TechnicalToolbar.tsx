import type { Timeframe, OverlayKey, ChartType } from '../types';

interface TechnicalToolbarProps {
  timeframe: Timeframe;
  overlays: Record<OverlayKey, boolean>;
  chartType: ChartType;
  onTimeframeChange: (tf: Timeframe) => void;
  onToggleOverlay: (key: OverlayKey) => void;
  onChartTypeChange: (t: ChartType) => void;
}

/** Timeframe selector + line/candle switch + MA/BB overlay toggles. */
export default function TechnicalToolbar({
  timeframe, overlays, chartType, onTimeframeChange, onToggleOverlay, onChartTypeChange,
}: TechnicalToolbarProps) {
  return (
    <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
      {(['1M', '3M', '6M', '1Y'] as Timeframe[]).map(tf => (
        <button key={tf} onClick={() => onTimeframeChange(tf)}
          className={`btn-ghost ${timeframe === tf ? 'active' : ''}`}
          style={{ padding: '5px 12px', fontSize: '11px' }}>
          {tf}
        </button>
      ))}
      <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />
      {(['line', 'candle'] as ChartType[]).map(t => (
        <button key={t} onClick={() => onChartTypeChange(t)}
          className={`btn-ghost ${chartType === t ? 'active' : ''}`}
          style={{ padding: '5px 12px', fontSize: '11px', textTransform: 'capitalize' }}>
          {t}
        </button>
      ))}
      <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />
      {([
        ['ma20', 'MA20', 'var(--warn)'],
        ['ma50', 'MA50', 'var(--purple)'],
        ['bb',   'BB',   'var(--down)'],
      ] as [OverlayKey, string, string][]).map(([k, label, color]) => (
        <button key={k} onClick={() => onToggleOverlay(k)}
          className="btn-ghost"
          style={{
            padding: '5px 10px', fontSize: '11px',
            borderColor: overlays[k] ? color : 'var(--border)',
            color: overlays[k] ? color : 'var(--text-secondary)',
            background: overlays[k] ? `${color}18` : 'transparent',
          }}>
          {label}
        </button>
      ))}
    </div>
  );
}
