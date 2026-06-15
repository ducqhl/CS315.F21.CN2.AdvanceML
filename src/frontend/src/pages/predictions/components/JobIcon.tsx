import { CheckCircle, XCircle, Loader, Clock } from 'lucide-react';

/** Small status glyph for a retrain job row. */
export default function JobIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle size={13} color="var(--up)" />;
  if (status === 'failed')    return <XCircle size={13} color="var(--down)" />;
  if (status === 'running')   return <Loader size={13} color="var(--accent)" className="spin" />;
  return <Clock size={13} color="var(--warn)" />;
}
