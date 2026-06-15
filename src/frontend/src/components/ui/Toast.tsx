import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, XCircle, AlertCircle } from 'lucide-react';

export type ToastState = { msg: string; type: 'ok' | 'err' } | null;

interface ToastProps {
  toast: ToastState;
  /** Icon used for the error variant (AlertCircle on Model Registry, XCircle on Predictions). */
  errorIcon?: 'x' | 'alert';
}

/** Fixed top-right notification toast shared across pages. */
export default function Toast({ toast, errorIcon = 'x' }: ToastProps) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          style={{
            position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
            padding: '11px 16px', borderRadius: '9px',
            background: toast.type === 'ok' ? 'var(--up-subtle)' : 'var(--down-subtle)',
            border: `1px solid ${toast.type === 'ok' ? 'var(--up-border)' : 'var(--down-border)'}`,
            color: toast.type === 'ok' ? 'var(--up)' : 'var(--down)',
            fontSize: '13px', fontWeight: 600, fontFamily: 'Plus Jakarta Sans',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}
        >
          {toast.type === 'ok'
            ? <CheckCircle size={14} />
            : errorIcon === 'alert' ? <AlertCircle size={14} /> : <XCircle size={14} />}
          {toast.msg}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
