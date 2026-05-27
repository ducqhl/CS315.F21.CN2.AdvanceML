// Shared ApexCharts base options for Quantum Terminal theme
// Use hex values — never CSS variables inside ApexCharts options

export const C = {
  cyan:      '#00E5FF',
  green:     '#00F0A0',
  red:       '#FF3864',
  gold:      '#FFB020',
  violet:    '#8B5CF6',
  bg:        '#0A0F1E',
  border:    '#1C2840',
  borderDim: '#131B2A',
  textSec:   '#556070',
  textMut:   '#2A3545',
  textPri:   '#D0DDF5',
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function baseApexOptions(height = 300): any {
  return {
    chart: {
      background: 'transparent',
      foreColor: C.textSec,
      fontFamily: "'Space Mono', monospace",
      height,
      toolbar: {
        show: true,
        tools: { download: false, selection: true, zoom: true, zoomin: true, zoomout: true, pan: true, reset: true },
        autoSelected: 'zoom',
      },
      zoom: { enabled: true },
      animations: { enabled: true, easing: 'easeinout', speed: 400 },
    },
    theme: { mode: 'dark' },
    grid: {
      borderColor: C.borderDim,
      strokeDashArray: 3,
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } },
    },
    xaxis: {
      axisBorder: { color: C.border },
      axisTicks: { color: C.border },
      labels: { style: { colors: C.textSec, fontSize: '10px', fontFamily: "'Space Mono', monospace" } },
      crosshairs: { stroke: { color: C.border, width: 1, dashArray: 3 } },
    },
    yaxis: {
      labels: { style: { colors: C.textSec, fontSize: '10px', fontFamily: "'Space Mono', monospace" } },
    },
    tooltip: {
      theme: 'dark',
      style: { fontSize: '12px', fontFamily: "'Manrope', sans-serif" },
      x: { format: 'yyyy-MM-dd' },
    },
    stroke: { curve: 'smooth' },
    dataLabels: { enabled: false },
    legend: {
      labels: { colors: C.textSec },
      fontFamily: "'Manrope', sans-serif",
      fontSize: '11px',
    },
  };
}
