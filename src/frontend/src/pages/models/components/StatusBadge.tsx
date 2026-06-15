import { Clock, Loader, CheckCircle, XCircle } from 'lucide-react';

/** Colored status pill for retrain job rows. */
export default function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; bg: string; Icon: React.ElementType }> = {
    pending:   { color: 'var(--warn)',         bg: 'var(--warn-subtle)',  Icon: Clock },
    running:   { color: 'var(--accent-light)', bg: 'var(--accent-muted)', Icon: Loader },
    completed: { color: 'var(--up)',            bg: 'var(--up-subtle)',    Icon: CheckCircle },
    failed:    { color: 'var(--down)',          bg: 'var(--down-subtle)',  Icon: XCircle },
  };
  const cfg = map[status] ?? map.pending;
  const { color, bg, Icon } = cfg;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '3px 9px', borderRadius: '6px',
      background: bg, color,
      fontSize: '11px', fontFamily: 'IBM Plex Mono',
    }}>
      <Icon size={10} className={status === 'running' ? 'spin' : undefined} />
      {status}
    </span>
  );
}
