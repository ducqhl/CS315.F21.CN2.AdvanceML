import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ExternalLink, Brain, FileText } from 'lucide-react';

/* ── Types ──────────────────────────────────────────────────────────────── */
type DocEntry = {
  id: string;
  num: string;
  title: string;
  emoji: string;
  description: string;
  file?: string;
  inApp?: string;
  category: string;
  accent: string;
  tags: string[];
  badge?: string;
};

/* ── Data ───────────────────────────────────────────────────────────────── */
const DOCS: DocEntry[] = [
  {
    id: 'lstm-research',
    num: 'R',
    title: 'LSTM Deep Dive',
    emoji: '🧠',
    description: 'Nghiên cứu sâu về kiến trúc LSTM, vanishing gradient, toán học, biến thể GRU/BiLSTM và ứng dụng vào dự báo giá crypto.',
    inApp: 'lstm-research',
    category: 'Research',
    accent: '#a78bfa',
    tags: ['LSTM', 'Deep Learning', 'Math'],
    badge: 'IN-APP',
  },
  {
    id: 'arch',
    num: '01',
    title: 'Lambda Architecture',
    emoji: '🏗️',
    description: 'Thiết kế tổng quan, lý do chọn Lambda vs Kappa, luồng dữ liệu ba layer. Trade-off latency vs accuracy.',
    file: '/docs/01_architecture.html',
    category: 'Architecture',
    accent: '#5c8aff',
    tags: ['Lambda', 'Design', 'Trade-offs'],
  },
  {
    id: 'producer',
    num: '02',
    title: 'CoinGecko Producer',
    emoji: '📡',
    description: 'Poll mỗi 600s, acks=all, retries=3, linger_ms=100. OHLC mỗi 3 cycle. Rate limit + exponential backoff.',
    file: '/docs/02_producer.html',
    category: 'Data Pipeline',
    accent: '#f97316',
    tags: ['Kafka', 'Ingestion', 'Rate Limit'],
  },
  {
    id: 'streaming',
    num: '03',
    title: 'Spark Streaming',
    emoji: '⚡',
    description: 'Watermark 10min, micro-batch 30s. Query A: windowed agg. Query B: RSI/Bollinger/VWAP/ATR per-record. foreachBatch writes MongoDB.',
    file: '/docs/03_spark_streaming.html',
    category: 'Data Pipeline',
    accent: '#f97316',
    tags: ['Spark', 'Streaming', 'Indicators'],
  },
  {
    id: 'batch',
    num: '04',
    title: 'Spark Batch',
    emoji: '📦',
    description: '4,165 ngày lịch sử. Outputs: daily_stats, historical_sma (SMA-7/30/90), coin_correlation. Submitted via run_batch.sh.',
    file: '/docs/04_spark_batch.html',
    category: 'Data Pipeline',
    accent: '#f97316',
    tags: ['Spark', 'Batch', 'SMA'],
  },
  {
    id: 'mongodb',
    num: '05',
    title: 'MongoDB',
    emoji: '🗄️',
    description: '7 collections. TTL policy trên speed layer. Compound indexes cho time-range queries. Single serving store.',
    file: '/docs/05_mongodb.html',
    category: 'Data Pipeline',
    accent: '#34d399',
    tags: ['MongoDB', 'Schema', 'Indexes'],
  },
  {
    id: 'lstm',
    num: '06',
    title: 'LSTM Model',
    emoji: '🧠',
    description: '9 features · 2-layer encoder · 128 hidden units · dual-head. Walk-forward validation, 61.1% directional accuracy (BTC).',
    file: '/docs/06_lstm.html',
    category: 'Machine Learning',
    accent: '#c084fc',
    tags: ['LSTM', 'Dual-Head', '61.1% Acc'],
  },
  {
    id: 'api',
    num: '07',
    title: 'FastAPI Backend',
    emoji: '🔌',
    description: 'JWT stateless auth. REST endpoints: prices, predictions, model registry, accuracy. Merges batch + speed views per query.',
    file: '/docs/07_api.html',
    category: 'Serving Layer',
    accent: '#6366f1',
    tags: ['FastAPI', 'JWT', 'REST'],
  },
  {
    id: 'frontend',
    num: '08',
    title: 'React + Streamlit',
    emoji: '🖥️',
    description: 'React 19 + TypeScript + Vite + Tailwind. 5 trang: Dashboard, Realtime, Technical, Predictions, Correlation. Streamlit port 8501.',
    file: '/docs/08_frontend.html',
    category: 'Serving Layer',
    accent: '#6366f1',
    tags: ['React', 'Streamlit', 'Frontend'],
  },
  {
    id: 'testing',
    num: '09',
    title: 'E2E Testing',
    emoji: '🧪',
    description: '3-layer E2E với testcontainers thật. Layer 1: Producer→Kafka. Layer 2: Spark Batch→MongoDB. Layer 3: ML Pipeline→MongoDB. 24 test cases.',
    file: '/docs/09_testing.html',
    category: 'Testing & Ops',
    accent: '#22c55e',
    tags: ['Pytest', 'E2E', '24 Tests'],
  },
  {
    id: 'deploy',
    num: '10',
    title: 'Docker Compose',
    emoji: '🐳',
    description: '9 services: Zookeeper, Kafka, Kafka-UI, MongoDB, Spark Master+Worker, Producer, API, Dashboard, Frontend, Inference Scheduler.',
    file: '/docs/10_deployment.html',
    category: 'Testing & Ops',
    accent: '#22c55e',
    tags: ['Docker', '9 Services', 'DevOps'],
  },
  {
    id: 'qa',
    num: '11',
    title: 'Phản biện Q&A',
    emoji: '🎯',
    description: '20+ câu hỏi phản biện với câu trả lời chi tiết cho buổi bảo vệ. Architectural decisions, ML limitations, production trade-offs.',
    file: '/docs/11_interview_qa.html',
    category: 'Interview Prep',
    accent: '#f87171',
    tags: ['Q&A', 'Defense', 'Important'],
    badge: 'HOT',
  },
];

const CATEGORIES = ['All', 'Research', 'Architecture', 'Data Pipeline', 'Machine Learning', 'Serving Layer', 'Testing & Ops', 'Interview Prep'];

/* ── DocCard ────────────────────────────────────────────────────────────── */
function DocCard({
  entry, index, onClick,
}: {
  entry: DocEntry;
  index: number;
  onClick: () => void;
}) {
  const isResearch = entry.inApp != null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.04 }}
      onClick={onClick}
      style={{
        background: isResearch
          ? `linear-gradient(135deg, color-mix(in srgb, ${entry.accent} 10%, var(--bg-card)), var(--bg-card))`
          : 'var(--bg-card)',
        border: `1px solid var(--border)`,
        borderTop: `3px solid ${entry.accent}`,
        borderRadius: '10px',
        padding: '18px 20px',
        cursor: 'pointer',
        transition: 'border-color 0.15s, transform 0.15s, box-shadow 0.15s',
        position: 'relative',
        overflow: 'hidden',
      }}
      whileHover={{
        y: -3,
        boxShadow: `0 8px 28px color-mix(in srgb, ${entry.accent} 15%, transparent)`,
      }}
      whileTap={{ scale: 0.98 }}
    >
      {/* subtle inner glow for research card */}
      {isResearch && (
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '10px', pointerEvents: 'none',
          background: `radial-gradient(ellipse at 20% 20%, color-mix(in srgb, ${entry.accent} 8%, transparent) 0%, transparent 60%)`,
        }} />
      )}

      {/* Top row: category chip + number */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <span style={{
          fontFamily: 'IBM Plex Mono', fontSize: '9px', fontWeight: 700,
          color: entry.accent,
          padding: '2px 8px', borderRadius: '4px',
          background: `color-mix(in srgb, ${entry.accent} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${entry.accent} 25%, transparent)`,
          letterSpacing: '0.06em', textTransform: 'uppercase',
        }}>
          {entry.category}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {entry.badge && (
            <span style={{
              fontFamily: 'IBM Plex Mono', fontSize: '8px', fontWeight: 700,
              padding: '2px 6px', borderRadius: '4px',
              background: entry.badge === 'HOT' ? 'rgba(248,113,113,0.15)' : 'rgba(167,139,250,0.15)',
              border: entry.badge === 'HOT' ? '1px solid rgba(248,113,113,0.3)' : '1px solid rgba(167,139,250,0.3)',
              color: entry.badge === 'HOT' ? '#f87171' : '#a78bfa',
              letterSpacing: '0.06em',
            }}>
              {entry.badge}
            </span>
          )}
          <span style={{
            fontFamily: 'IBM Plex Mono', fontSize: '10px', fontWeight: 700,
            color: 'var(--text-muted)',
          }}>
            #{entry.num}
          </span>
        </div>
      </div>

      {/* Icon + Title */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '8px' }}>
        <span style={{ fontSize: '20px', lineHeight: 1, flexShrink: 0 }}>{entry.emoji}</span>
        <h3 style={{
          margin: 0, fontSize: '14px', fontWeight: 700,
          color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans', lineHeight: 1.3,
        }}>
          {entry.title}
        </h3>
      </div>

      {/* Description */}
      <p style={{
        margin: '0 0 12px', fontSize: '12px', lineHeight: 1.65,
        color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans',
      }}>
        {entry.description}
      </p>

      {/* Tags */}
      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
        {entry.tags.map(tag => (
          <span key={tag} style={{
            fontFamily: 'IBM Plex Mono', fontSize: '9px', fontWeight: 500,
            padding: '2px 7px', borderRadius: '4px',
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            color: 'var(--text-muted)',
          }}>
            {tag}
          </span>
        ))}
      </div>

      {/* CTA indicator */}
      <div style={{
        position: 'absolute', bottom: '16px', right: '16px',
        display: 'flex', alignItems: 'center', gap: '4px',
        opacity: 0.4, transition: 'opacity 0.15s',
      }}
        className="card-cta"
      >
        {isResearch
          ? <Brain size={12} color={entry.accent} />
          : <FileText size={12} color={entry.accent} />}
      </div>
    </motion.div>
  );
}

/* ── DocViewer ──────────────────────────────────────────────────────────── */
function DocViewer({ entry, onBack }: { entry: DocEntry; onBack: () => void }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18 }}
      style={{ display: 'flex', flexDirection: 'column' }}
    >
      {/* Viewer header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '10px 0', marginBottom: '12px',
        borderBottom: `1px solid color-mix(in srgb, ${entry.accent} 25%, var(--border))`,
      }}>
        <button
          onClick={onBack}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'none', border: '1px solid var(--border)', borderRadius: '7px',
            padding: '6px 12px', cursor: 'pointer', color: 'var(--text-secondary)',
            fontFamily: 'Plus Jakarta Sans', fontSize: '12px', fontWeight: 500,
            transition: 'all 0.12s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--border-active)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--border)';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          <ArrowLeft size={13} />
          Documents
        </button>

        <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />

        <span style={{ fontSize: '18px' }}>{entry.emoji}</span>

        <div>
          <span style={{ fontFamily: 'Plus Jakarta Sans', fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
            {entry.title}
          </span>
          <span style={{
            marginLeft: '8px', fontFamily: 'IBM Plex Mono', fontSize: '9px',
            color: entry.accent,
            padding: '1px 6px', borderRadius: '3px',
            background: `color-mix(in srgb, ${entry.accent} 12%, transparent)`,
          }}>
            {entry.category}
          </span>
        </div>

        <div style={{ flex: 1 }} />

        <a
          href={entry.file}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            fontFamily: 'Plus Jakarta Sans', fontSize: '12px', fontWeight: 500,
            color: 'var(--text-muted)', textDecoration: 'none',
            padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)',
            transition: 'all 0.12s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = 'var(--text-secondary)';
            e.currentTarget.style.borderColor = 'var(--border-active)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = 'var(--text-muted)';
            e.currentTarget.style.borderColor = 'var(--border)';
          }}
        >
          <ExternalLink size={11} />
          New tab
        </a>
      </div>

      {/* Loading skeleton */}
      {!loaded && (
        <div className="skeleton" style={{ width: '100%', height: 'calc(100vh - 200px)', borderRadius: '8px' }} />
      )}

      {/* Iframe */}
      <div style={{
        borderRadius: '10px', overflow: 'hidden',
        border: `1px solid color-mix(in srgb, ${entry.accent} 20%, var(--border))`,
        display: loaded ? 'block' : 'none',
      }}>
        <iframe
          src={entry.file}
          title={entry.title}
          onLoad={() => setLoaded(true)}
          style={{
            width: '100%',
            height: 'calc(100vh - 200px)',
            border: 'none',
            display: 'block',
            minHeight: '700px',
          }}
        />
      </div>
    </motion.div>
  );
}

/* ── Main DocsPage ──────────────────────────────────────────────────────── */
interface Props {
  onNavigate: (page: string) => void;
}

export default function DocsPage({ onNavigate }: Props) {
  const [viewing, setViewing] = useState<DocEntry | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('All');

  const handleCardClick = (entry: DocEntry) => {
    if (entry.inApp) {
      onNavigate(entry.inApp);
    } else if (entry.file) {
      setViewing(entry);
    }
  };

  const filtered = activeCategory === 'All'
    ? DOCS
    : DOCS.filter(d => d.category === activeCategory);

  /* ── Viewer mode ── */
  if (viewing) {
    return (
      <AnimatePresence mode="wait">
        <DocViewer
          key={viewing.id}
          entry={viewing}
          onBack={() => setViewing(null)}
        />
      </AnimatePresence>
    );
  }

  /* ── Grid mode ── */
  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px' }}>
          <FileText size={18} color="var(--accent-light)" />
          <h1 className="font-display" style={{ margin: 0, fontSize: '22px', color: 'var(--text-primary)' }}>
            Documents
          </h1>
          <span style={{
            fontFamily: 'IBM Plex Mono', fontSize: '9px', fontWeight: 700,
            padding: '3px 8px', borderRadius: '5px',
            background: 'var(--accent-subtle)', border: '1px solid rgba(99,102,241,0.2)',
            color: 'var(--accent-light)', letterSpacing: '0.05em',
          }}>
            {DOCS.length} DOCS
          </span>
        </div>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
          Tài liệu kỹ thuật · CS315.F21.CN2 Advanced Machine Learning · Lê Quang Hoài Đức
        </p>
      </div>

      {/* Category filter */}
      <div style={{
        display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap',
        paddingBottom: '16px', borderBottom: '1px solid var(--border)',
      }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`btn-ghost ${activeCategory === cat ? 'active' : ''}`}
            style={{ fontSize: '11px', padding: '5px 12px' }}
          >
            {cat}
            {cat !== 'All' && (
              <span style={{
                marginLeft: '5px', fontFamily: 'IBM Plex Mono', fontSize: '9px',
                color: activeCategory === cat ? 'var(--accent-light)' : 'var(--text-muted)',
              }}>
                {DOCS.filter(d => d.category === cat).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Card grid */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeCategory}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '14px',
          }}
        >
          {filtered.map((entry, i) => (
            <DocCard
              key={entry.id}
              entry={entry}
              index={i}
              onClick={() => handleCardClick(entry)}
            />
          ))}
        </motion.div>
      </AnimatePresence>

      {/* Footer note */}
      <div style={{
        marginTop: '28px', padding: '14px 18px',
        background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '10px',
      }}>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans' }}>
          Nhấn vào card để xem tài liệu trong app ·
          <span style={{ color: 'var(--accent-light)', marginLeft: '4px' }}>IN-APP</span> docs mở ngay trong trang ·
          <span style={{ color: '#5c8aff', marginLeft: '4px' }}>HTML</span> docs hiển thị trong trình xem nhúng
        </span>
      </div>
    </div>
  );
}
