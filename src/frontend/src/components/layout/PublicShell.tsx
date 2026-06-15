import { AnimatePresence, motion } from 'framer-motion';
import { TrendingUp, Brain, FileText, ArrowLeft } from 'lucide-react';
import { pageVariants, type Page } from './navigation';
import FeatureBanner from './FeatureBanner';

interface PublicShellProps {
  page: Page;
  setPage: (p: Page) => void;
  children: React.ReactNode;
}

/** Unauthenticated shell: top bar, feature banner (docs) and page content. */
export default function PublicShell({ page, setPage, children }: PublicShellProps) {
  return (
    <div style={{ width: '100%', minHeight: '100vh', background: 'var(--bg-base)' }}>
      {/* Top bar */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 30,
        height: '52px',
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '0', padding: '0 24px',
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '20px' }}>
          <div style={{
            width: '26px', height: '26px', borderRadius: '7px',
            background: 'var(--accent-subtle)', border: '1px solid rgba(99,102,241,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <TrendingUp size={13} color="var(--accent-light)" />
          </div>
          <span className="font-display" style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 700, letterSpacing: '-0.03em' }}>
            Bitconiacs
          </span>
        </div>

        <span style={{ color: 'var(--border-active)', fontSize: '18px', marginRight: '12px', userSelect: 'none' }}>/</span>

        {/* Public nav tabs */}
        <div style={{ display: 'flex', gap: '3px' }}>
          <button
            onClick={() => setPage('docs')}
            className={`btn-ghost ${page === 'docs' ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '5px 12px' }}
          >
            <FileText size={12} />
            Documents
          </button>
          <button
            onClick={() => setPage('lstm-research')}
            className={`btn-ghost ${page === 'lstm-research' ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '5px 12px' }}
          >
            <Brain size={12} />
            LSTM Research
          </button>
        </div>

        {/* Back-to-docs breadcrumb when on lstm-research */}
        {page === 'lstm-research' && (
          <button
            onClick={() => setPage('docs')}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              marginLeft: '12px', background: 'none', border: 'none',
              cursor: 'pointer', color: 'var(--text-muted)',
              fontFamily: 'Plus Jakarta Sans', fontSize: '11px',
              padding: '4px 8px', borderRadius: '5px',
              transition: 'color 0.12s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            <ArrowLeft size={11} />
            Back to docs
          </button>
        )}

        <div style={{ flex: 1 }} />

        {/* Sign-in CTA */}
        <button
          onClick={() => setPage('dashboard')}
          className="btn-primary"
          style={{ fontSize: '12px', padding: '7px 16px' }}
        >
          Sign In →
        </button>
      </div>

      {/* Content */}
      <main style={{ paddingTop: '52px', minHeight: '100vh' }}>
        {page === 'docs' && <FeatureBanner onSignIn={() => setPage('dashboard')} />}

        <div style={{ padding: '32px 36px' }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={page}
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.2 }}
              className="page-content"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
