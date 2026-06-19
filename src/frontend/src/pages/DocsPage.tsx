import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, FileText } from 'lucide-react';

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
    description: 'Thiết kế tổng quan, lý do chọn Lambda vs Kappa, luồng dữ liệu ba layer, các quyết định thiết kế quan trọng và trade-off latency vs accuracy.',
    inApp: 'doc-architecture',
    category: 'Architecture',
    accent: '#5c8aff',
    tags: ['Lambda', 'Design', 'Trade-offs'],
    badge: 'IN-APP',
  },
  {
    id: 'producer',
    num: '02',
    title: 'CoinGecko Producer',
    emoji: '📡',
    description: 'Thành phần thu thập dữ liệu giá từ CoinGecko API mỗi 600 giây với acks=all, retries=3. OHLC mỗi 3 chu kỳ. Rate limit budget và exponential backoff.',
    inApp: 'doc-producer',
    category: 'Data Pipeline',
    accent: '#f97316',
    tags: ['Kafka', 'Ingestion', 'Rate Limit'],
    badge: 'IN-APP',
  },
  {
    id: 'streaming',
    num: '03',
    title: 'Spark Streaming',
    emoji: '⚡',
    description: 'Spark Structured Streaming với watermark 10 phút, micro-batch 30 giây. Query A: windowed aggregation. Query B: RSI/Bollinger/VWAP/ATR per-record. foreachBatch writes MongoDB.',
    inApp: 'doc-streaming',
    category: 'Data Pipeline',
    accent: '#f97316',
    tags: ['Spark', 'Streaming', 'Indicators'],
    badge: 'IN-APP',
  },
  {
    id: 'batch',
    num: '04',
    title: 'Spark Batch',
    emoji: '📦',
    description: 'Batch Layer xử lý 4.165 ngày lịch sử. Outputs: daily_stats, historical_sma (SMA-7/14/30/90), coin_correlation BTC-DOGE. Kết quả r=0.528.',
    inApp: 'doc-batch',
    category: 'Data Pipeline',
    accent: '#f97316',
    tags: ['Spark', 'Batch', 'SMA'],
    badge: 'IN-APP',
  },
  {
    id: 'mongodb',
    num: '05',
    title: 'MongoDB',
    emoji: '🗄️',
    description: 'Single serving store với 7+ collections. TTL policy trên Speed Layer (7 ngày). Compound indexes cho time-range queries. Upsert idempotency cho predictions.',
    inApp: 'doc-mongodb',
    category: 'Data Pipeline',
    accent: '#34d399',
    tags: ['MongoDB', 'Schema', 'Indexes'],
    badge: 'IN-APP',
  },
  {
    id: 'lstm',
    num: '06',
    title: 'LSTM Model',
    emoji: '🧠',
    description: '9 features, sequence_length=60, 2-layer LSTM encoder, 128 hidden units, dual-head output. Walk-forward validation với 61.1% directional accuracy (BTC backtest H7).',
    inApp: 'doc-lstm',
    category: 'Machine Learning',
    accent: '#c084fc',
    tags: ['LSTM', 'Dual-Head', '61.1% Acc'],
    badge: 'IN-APP',
  },
  {
    id: 'api',
    num: '07',
    title: 'FastAPI Backend',
    emoji: '🔌',
    description: 'JWT stateless auth (TTL 24h). REST endpoints: prices, predictions, model registry, accuracy. Merges batch + speed views per query. Auto-refresh interceptor.',
    inApp: 'doc-api',
    category: 'Serving Layer',
    accent: '#6366f1',
    tags: ['FastAPI', 'JWT', 'REST'],
    badge: 'IN-APP',
  },
  {
    id: 'frontend',
    num: '08',
    title: 'React + Streamlit',
    emoji: '🖥️',
    description: 'React 19 + TypeScript + Vite + Tailwind. 5 trang phân tích: Dashboard, Realtime, Technical, Predictions, Correlation. Streamlit dashboard port 8501.',
    inApp: 'doc-frontend',
    category: 'Serving Layer',
    accent: '#6366f1',
    tags: ['React', 'Streamlit', 'Frontend'],
    badge: 'IN-APP',
  },
  {
    id: 'testing',
    num: '09',
    title: 'E2E Testing',
    emoji: '🧪',
    description: '3-layer E2E với testcontainers thật. Layer 1: Producer→Kafka. Layer 2: Spark Batch→MongoDB. Layer 3: ML Pipeline→MongoDB. 7 unit test suites + 3 E2E suites.',
    inApp: 'doc-testing',
    category: 'Testing & Ops',
    accent: '#22c55e',
    tags: ['Pytest', 'E2E', 'testcontainers'],
    badge: 'IN-APP',
  },
  {
    id: 'deploy',
    num: '10',
    title: 'Docker Compose',
    emoji: '🐳',
    description: '9 services: Zookeeper, Kafka, Kafka-UI, MongoDB, Spark Master+Worker, Producer, API, Dashboard, Frontend, Inference Scheduler. Health checks và dependency chain.',
    inApp: 'doc-deployment',
    category: 'Testing & Ops',
    accent: '#22c55e',
    tags: ['Docker', '9 Services', 'DevOps'],
    badge: 'IN-APP',
  },
  {
    id: 'qa',
    num: '11',
    title: 'Q&A',
    emoji: '🎯',
    description: '28 câu hỏi với câu trả lời chi tiết cho buổi bảo vệ. Architectural decisions, ML limitations, production trade-offs. Accordion expand/collapse.',
    inApp: 'doc-qa',
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


/* ── Main DocsPage ──────────────────────────────────────────────────────── */
interface Props {
  onNavigate: (page: string) => void;
}

export default function DocsPage({ onNavigate }: Props) {
  const [activeCategory, setActiveCategory] = useState<string>('All');

  const handleCardClick = (entry: DocEntry) => {
    if (entry.inApp) {
      onNavigate(entry.inApp);
    }
  };

  const filtered = activeCategory === 'All'
    ? DOCS
    : DOCS.filter(d => d.category === activeCategory);

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
          Tất cả 12 tài liệu mở trực tiếp trong app ·
          <span style={{ color: 'var(--accent-light)', marginLeft: '4px' }}>IN-APP</span> — nội dung học thuật bằng tiếng Việt đầy đủ · CS315.F21.CN2
        </span>
      </div>
    </div>
  );
}
