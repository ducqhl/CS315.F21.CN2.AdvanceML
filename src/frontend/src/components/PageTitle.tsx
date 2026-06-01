import { useEffect, useRef } from 'react';

interface PageTitleProps {
  title: string;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
}

/**
 * Stretches the page title text to fill the full container width.
 * Uses a binary-search on font-size via ResizeObserver so it reacts
 * to sidebar expand/collapse and window resize automatically.
 */
export default function PageTitle({ title, subtitle, right }: PageTitleProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef      = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fit = () => {
      const container = containerRef.current;
      const text      = textRef.current;
      if (!container || !text) return;

      const maxW = container.clientWidth;
      if (maxW <= 0) return;

      // Binary search: largest font-size where scrollWidth ≤ containerWidth
      let lo = 12, hi = 300;
      text.style.fontSize = `${hi}px`;
      while (hi - lo > 0.4) {
        const mid = (lo + hi) / 2;
        text.style.fontSize = `${mid}px`;
        if (text.scrollWidth <= maxW) lo = mid;
        else hi = mid;
      }
      text.style.fontSize = `${lo}px`;
    };

    const ro = new ResizeObserver(fit);
    if (containerRef.current) ro.observe(containerRef.current);
    fit();
    return () => ro.disconnect();
  }, [title]);

  return (
    <div ref={containerRef} style={{ marginBottom: '28px', overflow: 'hidden' }}>
      {/* Stretched title */}
      <div
        ref={textRef}
        className="font-display"
        style={{
          color:      'var(--text-primary)',
          whiteSpace: 'nowrap',
          lineHeight: 0.92,
          display:    'block',
          letterSpacing: '-0.02em',
        }}
      >
        {title}
      </div>

      {/* Subtitle row */}
      {(subtitle || right) && (
        <div style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          marginTop:      '10px',
        }}>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
            {subtitle}
          </div>
          {right && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {right}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
