import { Info, AlertTriangle, CheckCircle } from 'lucide-react';
import katex from 'katex';

/* ─── Typography ─────────────────────────────────────────────────────────── */

export function PageHeader({
  title, subtitle, badge, badgeColor = 'var(--accent)',
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: string;
}) {
  return (
    <div style={{ marginBottom: '28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
        <h1 className="font-display" style={{ margin: 0, fontSize: '22px', color: 'var(--text-primary)' }}>
          {title}
        </h1>
        {badge && (
          <span style={{
            fontFamily: 'IBM Plex Mono', fontSize: '9px', fontWeight: 700,
            padding: '3px 8px', borderRadius: '5px',
            background: `color-mix(in srgb, ${badgeColor} 12%, transparent)`,
            border: `1px solid color-mix(in srgb, ${badgeColor} 25%, transparent)`,
            color: badgeColor, letterSpacing: '0.05em',
          }}>
            {badge}
          </span>
        )}
      </div>
      {subtitle && (
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

export function SectionCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="card" style={{ padding: '24px', marginBottom: '16px', ...style }}>
      {children}
    </div>
  );
}

export function SectionTitle({
  children, accent = 'var(--accent-light)',
}: { children: React.ReactNode; accent?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
      <div style={{ width: '3px', height: '18px', background: accent, borderRadius: '2px', flexShrink: 0 }} />
      <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans' }}>
        {children}
      </h2>
    </div>
  );
}

export function SubTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      margin: '20px 0 10px', fontSize: '13.5px', fontWeight: 700,
      color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans',
    }}>
      {children}
    </h3>
  );
}

export function BodyText({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <p style={{
      margin: '0 0 12px', fontSize: '13.5px', lineHeight: 1.75,
      color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans',
      ...style,
    }}>
      {children}
    </p>
  );
}

/* ─── Callout boxes ──────────────────────────────────────────────────────── */

type CalloutVariant = 'info' | 'warning' | 'success';

const CALLOUT_CONFIG: Record<CalloutVariant, { color: string; Icon: typeof Info }> = {
  info:    { color: 'var(--accent)',  Icon: Info },
  warning: { color: '#F97316',        Icon: AlertTriangle },
  success: { color: '#22C55E',        Icon: CheckCircle },
};

export function Callout({ variant = 'info', children }: { variant?: CalloutVariant; children: React.ReactNode }) {
  const { color, Icon } = CALLOUT_CONFIG[variant];
  return (
    <div style={{
      display: 'flex', gap: '10px', padding: '14px 16px',
      background: `color-mix(in srgb, ${color} 8%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 22%, transparent)`,
      borderRadius: '8px', marginBottom: '14px',
    }}>
      <Icon size={15} color={color} style={{ flexShrink: 0, marginTop: '2px' }} />
      <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.7, color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
        {children}
      </p>
    </div>
  );
}

/* ─── Code block ─────────────────────────────────────────────────────────── */

export function CodeBlock({ children, lang = '' }: { children: string; lang?: string }) {
  return (
    <div style={{
      background: '#0d1117', border: '1px solid var(--border)',
      borderRadius: '8px', padding: '16px 18px', margin: '12px 0',
      overflowX: 'auto',
    }}>
      {lang && (
        <div style={{
          fontFamily: 'IBM Plex Mono', fontSize: '10px', color: 'var(--text-muted)',
          marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          {lang}
        </div>
      )}
      <pre style={{ margin: 0 }}>
        <code style={{
          fontFamily: 'IBM Plex Mono', fontSize: '12px', color: '#e6edf3',
          whiteSpace: 'pre', display: 'block',
        }}>
          {children}
        </code>
      </pre>
    </div>
  );
}

/* ─── Math block ─────────────────────────────────────────────────────────── */

export function MathBlock({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      borderRadius: '8px', padding: '14px 18px', margin: '10px 0',
      overflowX: 'auto',
    }}>
      <code style={{
        fontFamily: 'IBM Plex Mono', fontSize: '13px', color: 'var(--text-primary)',
        whiteSpace: 'pre', display: 'block', lineHeight: 1.7,
      }}>
        {children}
      </code>
    </div>
  );
}

/* ─── KaTeX math ─────────────────────────────────────────────────────────────
   TeX(): inline rendered LaTeX.
   EqBlock(): a block of display equations, each optionally annotated with a
   plain-language note shown to the right (or below on narrow screens). Replaces
   hand-written ASCII math so subscripts/symbols render properly and long lines
   scroll instead of being clipped.                                              */

export function TeX({ children, display = false }: { children: string; display?: boolean }) {
  const html = katex.renderToString(children, {
    displayMode: display, throwOnError: false, output: 'htmlAndMathml',
  });
  return (
    <span
      style={{ color: 'var(--text-primary)' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function EqBlock({
  title, equations,
}: {
  title?: string;
  equations: { tex: string; note?: React.ReactNode }[];
}) {
  return (
    <div style={{
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      borderRadius: '8px', padding: '16px 18px', margin: '10px 0',
    }}>
      {title && (
        <div style={{
          fontFamily: 'IBM Plex Mono', fontSize: '10px', color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px',
        }}>
          {title}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {equations.map((eq, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'baseline', gap: '14px',
            flexWrap: 'wrap', rowGap: '4px',
          }}>
            <div style={{ overflowX: 'auto', maxWidth: '100%', flexShrink: 0 }}>
              <TeX display>{eq.tex}</TeX>
            </div>
            {eq.note && (
              <span style={{
                fontFamily: 'Plus Jakarta Sans', fontSize: '12px',
                color: 'var(--text-muted)', lineHeight: 1.5,
              }}>
                {eq.note}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Data table ─────────────────────────────────────────────────────────── */

export function DataTable({
  headers, rows, caption,
}: {
  headers: string[];
  rows: (string | React.ReactNode)[][];
  caption?: string;
}) {
  return (
    <div style={{ overflowX: 'auto', marginBottom: '14px' }}>
      {caption && (
        <p style={{
          margin: '0 0 6px', fontFamily: 'IBM Plex Mono', fontSize: '10px',
          color: 'var(--text-muted)', letterSpacing: '0.04em',
        }}>
          {caption}
        </p>
      )}
      <table className="data-table">
        <thead>
          <tr>
            {headers.map(h => <th key={h}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci}>
                  {typeof cell === 'string'
                    ? <span style={{ fontSize: '12.5px', fontFamily: 'Plus Jakarta Sans', color: 'var(--text-secondary)' }}>{cell}</span>
                    : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Flow diagram ───────────────────────────────────────────────────────── */

type FlowNodeVariant = 'default' | 'kafka' | 'spark' | 'mongo' | 'lstm' | 'api' | 'ui';

const FLOW_NODE_COLORS: Record<FlowNodeVariant, string> = {
  default: 'var(--border)',
  kafka:   '#F97316',
  spark:   '#818CF8',
  mongo:   '#22C55E',
  lstm:    '#A78BFA',
  api:     '#6366F1',
  ui:      '#5C8AFF',
};

export function FlowDiagram({ nodes }: {
  nodes: { label: string; sub?: string; variant?: FlowNodeVariant }[];
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      flexWrap: 'wrap', padding: '14px 0', margin: '10px 0',
    }}>
      {nodes.map((node, i) => {
        const color = FLOW_NODE_COLORS[node.variant ?? 'default'];
        return (
          <React.Fragment key={i}>
            <div style={{
              padding: '8px 14px', borderRadius: '8px',
              border: `1.5px solid ${color}`,
              background: `color-mix(in srgb, ${color} 8%, var(--bg-elevated))`,
              textAlign: 'center', minWidth: '80px',
            }}>
              <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '11px', color, fontWeight: 600 }}>
                {node.label}
              </div>
              {node.sub && (
                <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {node.sub}
                </div>
              )}
            </div>
            {i < nodes.length - 1 && (
              <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '14px', color: 'var(--text-muted)', flexShrink: 0 }}>→</span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ─── Tag chip ───────────────────────────────────────────────────────────── */

type TagVariant = 'blue' | 'amber' | 'green' | 'purple' | 'red';

const TAG_COLORS: Record<TagVariant, string> = {
  blue:   '#5C8AFF',
  amber:  '#F59E0B',
  green:  '#22C55E',
  purple: '#A78BFA',
  red:    '#F87171',
};

export function Tag({ variant = 'blue', children }: { variant?: TagVariant; children: React.ReactNode }) {
  const color = TAG_COLORS[variant];
  return (
    <span style={{
      fontFamily: 'IBM Plex Mono', fontSize: '9px', fontWeight: 600,
      padding: '2px 7px', borderRadius: '4px',
      background: `color-mix(in srgb, ${color} 14%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
      color,
    }}>
      {children}
    </span>
  );
}

/* ─── Mono code inline ───────────────────────────────────────────────────── */

export function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code style={{
      fontFamily: 'IBM Plex Mono', fontSize: '11.5px',
      color: 'var(--accent-light)',
      background: 'var(--bg-elevated)', padding: '1px 5px',
      borderRadius: '3px', border: '1px solid var(--border)',
    }}>
      {children}
    </code>
  );
}

/* ─── Step list ──────────────────────────────────────────────────────────── */

export function StepList({ steps }: { steps: { title: string; body: React.ReactNode }[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
      {steps.map((step, i) => (
        <div key={i} style={{ display: 'flex', gap: '14px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
            <div style={{
              width: '26px', height: '26px', borderRadius: '50%',
              background: 'var(--accent-muted)', border: '1px solid rgba(99,102,241,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '11px', color: 'var(--accent-light)', fontWeight: 700 }}>
                {i + 1}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ width: '1px', flex: 1, background: 'var(--border)', marginTop: '6px' }} />
            )}
          </div>
          <div style={{ paddingTop: '2px', paddingBottom: '16px', flex: 1 }}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: '13.5px', color: 'var(--text-primary)', marginBottom: '6px' }}>
              {step.title}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans', lineHeight: 1.7 }}>
              {step.body}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Spec badge row ─────────────────────────────────────────────────────── */

export function SpecRow({ items }: { items: { label: string; value: string; color?: string }[] }) {
  return (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
      {items.map(({ label, value, color = 'var(--accent-light)' }) => (
        <div key={label} style={{
          padding: '6px 12px', borderRadius: '7px',
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
        }}>
          <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '13px', color, fontWeight: 700 }}>{value}</span>
          <span style={{ fontFamily: 'Plus Jakarta Sans', fontSize: '10px', color: 'var(--text-muted)' }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── Card grid helper ───────────────────────────────────────────────────── */

export function CardGrid({ children, cols = 3 }: { children: React.ReactNode; cols?: 2 | 3 }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fill, minmax(${cols === 3 ? '240px' : '300px'}, 1fr))`,
      gap: '12px', marginBottom: '14px',
    }}>
      {children}
    </div>
  );
}

export function InfoCard({
  title, children, accent = 'var(--accent)',
}: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <div style={{
      background: `color-mix(in srgb, ${accent} 5%, var(--bg-card))`,
      border: `1px solid color-mix(in srgb, ${accent} 18%, var(--border))`,
      borderTop: `3px solid ${accent}`,
      borderRadius: '8px', padding: '16px',
    }}>
      <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: '13.5px', color: 'var(--text-primary)', marginBottom: '8px' }}>
        {title}
      </div>
      <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans', lineHeight: 1.7 }}>
        {children}
      </div>
    </div>
  );
}

// Need React in scope for JSX
import React from 'react';
