import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen, Brain, Cpu, Layers, Network, ExternalLink,
  ChevronRight, Info, BookMarked, Calculator,
} from 'lucide-react';

type Tab = 'intro' | 'architecture' | 'math' | 'variants' | 'application' | 'references';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'intro',        label: 'Giới thiệu',  icon: <BookOpen size={13} /> },
  { id: 'architecture', label: 'Kiến trúc',   icon: <Brain size={13} /> },
  { id: 'math',         label: 'Toán học',    icon: <Calculator size={13} /> },
  { id: 'variants',     label: 'Biến thể',    icon: <Layers size={13} /> },
  { id: 'application',  label: 'Ứng dụng',    icon: <Cpu size={13} /> },
  { id: 'references',   label: 'Tài liệu',    icon: <BookMarked size={13} /> },
];

/* ── shared sub-components ──────────────────────────────────────────────── */

function SectionCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="card" style={{ padding: '24px', marginBottom: '16px', ...style }}>
      {children}
    </div>
  );
}

function SectionTitle({ children, accent = 'var(--accent-light)' }: { children: React.ReactNode; accent?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      marginBottom: '14px',
    }}>
      <div style={{ width: '3px', height: '18px', background: accent, borderRadius: '2px', flexShrink: 0 }} />
      <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans' }}>
        {children}
      </h2>
    </div>
  );
}

function BodyText({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
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

function MathBlock({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      borderRadius: '8px', padding: '14px 18px', margin: '10px 0',
    }}>
      <code style={{ fontFamily: 'IBM Plex Mono', fontSize: '13px', color: 'var(--text-primary)', whiteSpace: 'pre' }}>
        {children}
      </code>
    </div>
  );
}

function Cite({ n }: { n: number }) {
  return (
    <sup style={{
      fontFamily: 'IBM Plex Mono', fontSize: '10px',
      color: 'var(--accent-light)', marginLeft: '2px',
    }}>
      [{n}]
    </sup>
  );
}

function InfoBox({ children, color = 'var(--accent)' }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{
      display: 'flex', gap: '10px', padding: '12px 14px',
      background: `color-mix(in srgb, ${color} 8%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
      borderRadius: '8px', marginBottom: '12px',
    }}>
      <Info size={14} color={color} style={{ flexShrink: 0, marginTop: '2px' }} />
      <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.65, color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
        {children}
      </p>
    </div>
  );
}

/* ── LSTM Cell SVG Diagram ──────────────────────────────────────────────── */
function LSTMDiagram() {
  const gateForget = '#F97316';  // orange
  const gateInput  = '#818CF8';  // indigo
  const gateOutput = '#22C55E';  // green
  const stateLine  = '#94A3B8';  // slate

  return (
    <div style={{ overflowX: 'auto', margin: '16px 0' }}>
      <svg viewBox="0 0 780 310" style={{ width: '100%', maxWidth: '780px', minWidth: '600px' }} aria-label="LSTM Cell Diagram">
        <defs>
          <marker id="arr-gray" markerWidth="7" markerHeight="7" refX="4" refY="3.5" orient="auto">
            <path d="M0,0.5 L0,6.5 L6,3.5 z" fill={stateLine} />
          </marker>
          <marker id="arr-orange" markerWidth="7" markerHeight="7" refX="4" refY="3.5" orient="auto">
            <path d="M0,0.5 L0,6.5 L6,3.5 z" fill={gateForget} />
          </marker>
          <marker id="arr-indigo" markerWidth="7" markerHeight="7" refX="4" refY="3.5" orient="auto">
            <path d="M0,0.5 L0,6.5 L6,3.5 z" fill={gateInput} />
          </marker>
          <marker id="arr-green" markerWidth="7" markerHeight="7" refX="4" refY="3.5" orient="auto">
            <path d="M0,0.5 L0,6.5 L6,3.5 z" fill={gateOutput} />
          </marker>
        </defs>

        {/* ── Cell state conveyor belt (top) ── */}
        {/* C_{t-1} input */}
        <line x1="10" y1="75" x2="148" y2="75" stroke={stateLine} strokeWidth="2.5" markerEnd="url(#arr-gray)" />
        <text x="8" y="64" fontFamily="IBM Plex Mono" fontSize="11" fill={stateLine}>C</text>
        <text x="14" y="67" fontFamily="IBM Plex Mono" fontSize="8" fill={stateLine}>t-1</text>

        {/* × Forget on cell state */}
        <circle cx="165" cy="75" r="14" fill="none" stroke={gateForget} strokeWidth="2" />
        <text x="165" y="80" textAnchor="middle" fontFamily="IBM Plex Mono" fontSize="16" fill={gateForget} fontWeight="bold">×</text>

        {/* Cell state line: forget → add */}
        <line x1="179" y1="75" x2="358" y2="75" stroke={stateLine} strokeWidth="2.5" markerEnd="url(#arr-gray)" />

        {/* + Add (input gate) on cell state */}
        <circle cx="374" cy="75" r="14" fill="none" stroke={gateInput} strokeWidth="2" />
        <text x="374" y="81" textAnchor="middle" fontFamily="IBM Plex Mono" fontSize="18" fill={gateInput} fontWeight="bold">+</text>

        {/* Cell state line: add → C_t */}
        <line x1="388" y1="75" x2="620" y2="75" stroke={stateLine} strokeWidth="2.5" />

        {/* tanh applied to C_t for output */}
        <rect x="621" y="58" width="56" height="34" rx="7" fill="none" stroke={gateOutput} strokeWidth="1.5" strokeDasharray="4 2" />
        <text x="649" y="76" textAnchor="middle" fontFamily="IBM Plex Mono" fontSize="11" fill={gateOutput}>tanh</text>
        <text x="649" y="86" textAnchor="middle" fontFamily="IBM Plex Mono" fontSize="8" fill="var(--text-muted)">(C_t)</text>

        {/* C_t label + arrow out */}
        <line x1="677" y1="75" x2="710" y2="75" stroke={stateLine} strokeWidth="2.5" markerEnd="url(#arr-gray)" />
        <text x="716" y="79" fontFamily="IBM Plex Mono" fontSize="11" fill={stateLine}>C</text>
        <text x="722" y="82" fontFamily="IBM Plex Mono" fontSize="8" fill={stateLine}>t</text>

        {/* ── FORGET GATE ── */}
        <rect x="128" y="148" width="74" height="38" rx="8" fill={`${gateForget}22`} stroke={gateForget} strokeWidth="1.5" />
        <text x="165" y="164" textAnchor="middle" fontFamily="IBM Plex Mono" fontSize="10" fill={gateForget} fontWeight="600">σ  f</text>
        <text x="172" y="167" fontFamily="IBM Plex Mono" fontSize="7" fill={gateForget}>t</text>
        <text x="165" y="178" textAnchor="middle" fontFamily="Plus Jakarta Sans" fontSize="9" fill="var(--text-muted)">Forget Gate</text>

        {/* Forget gate → × on cell state */}
        <line x1="165" y1="148" x2="165" y2="90" stroke={gateForget} strokeWidth="1.5" markerEnd="url(#arr-orange)" strokeDasharray="3 2" />

        {/* ── INPUT GATE: σ ── */}
        <rect x="278" y="148" width="68" height="38" rx="8" fill={`${gateInput}22`} stroke={gateInput} strokeWidth="1.5" />
        <text x="312" y="164" textAnchor="middle" fontFamily="IBM Plex Mono" fontSize="10" fill={gateInput} fontWeight="600">σ  i</text>
        <text x="319" y="167" fontFamily="IBM Plex Mono" fontSize="7" fill={gateInput}>t</text>
        <text x="312" y="178" textAnchor="middle" fontFamily="Plus Jakarta Sans" fontSize="9" fill="var(--text-muted)">Input Gate</text>

        {/* ── INPUT GATE: tanh (candidate) ── */}
        <rect x="360" y="148" width="76" height="38" rx="8" fill={`${gateInput}22`} stroke={gateInput} strokeWidth="1.5" />
        <text x="398" y="164" textAnchor="middle" fontFamily="IBM Plex Mono" fontSize="10" fill={gateInput} fontWeight="600">tanh g̃</text>
        <text x="398" y="178" textAnchor="middle" fontFamily="Plus Jakarta Sans" fontSize="9" fill="var(--text-muted)">Candidate</text>

        {/* i_t × g̃_t → + on cell state */}
        <line x1="374" y1="148" x2="374" y2="90" stroke={gateInput} strokeWidth="1.5" markerEnd="url(#arr-indigo)" strokeDasharray="3 2" />

        {/* ── OUTPUT GATE ── */}
        <rect x="536" y="148" width="74" height="38" rx="8" fill={`${gateOutput}22`} stroke={gateOutput} strokeWidth="1.5" />
        <text x="573" y="164" textAnchor="middle" fontFamily="IBM Plex Mono" fontSize="10" fill={gateOutput} fontWeight="600">σ  o</text>
        <text x="580" y="167" fontFamily="IBM Plex Mono" fontSize="7" fill={gateOutput}>t</text>
        <text x="573" y="178" textAnchor="middle" fontFamily="Plus Jakarta Sans" fontSize="9" fill="var(--text-muted)">Output Gate</text>

        {/* ── × for h_t (output gate × tanh(C_t)) ── */}
        <circle cx="573" cy="240" r="14" fill="none" stroke={gateOutput} strokeWidth="2" />
        <text x="573" y="245" textAnchor="middle" fontFamily="IBM Plex Mono" fontSize="16" fill={gateOutput} fontWeight="bold">×</text>

        {/* output gate → × (h_t) */}
        <line x1="573" y1="186" x2="573" y2="226" stroke={gateOutput} strokeWidth="1.5" markerEnd="url(#arr-green)" />

        {/* tanh(C_t) → × (h_t) */}
        <line x1="649" y1="92" x2="649" y2="240" stroke={gateOutput} strokeWidth="1.5" />
        <line x1="649" y1="240" x2="587" y2="240" stroke={gateOutput} strokeWidth="1.5" markerEnd="url(#arr-green)" />

        {/* h_t output */}
        <line x1="573" y1="254" x2="573" y2="285" stroke={gateOutput} strokeWidth="2" markerEnd="url(#arr-green)" />
        <text x="573" y="300" textAnchor="middle" fontFamily="IBM Plex Mono" fontSize="12" fill={gateOutput} fontWeight="600">h</text>
        <text x="580" y="303" fontFamily="IBM Plex Mono" fontSize="8" fill={gateOutput}>t</text>

        {/* h_t also feeds back as h_{t+1} */}
        <line x1="587" y1="240" x2="730" y2="240" stroke={gateOutput} strokeWidth="1.5" strokeDasharray="4 3" />
        <text x="735" y="244" fontFamily="IBM Plex Mono" fontSize="9" fill="var(--text-muted)">→ next step</text>

        {/* ── Shared input [h_{t-1}, x_t] ── */}
        <rect x="90" y="238" width="150" height="32" rx="8" fill="var(--bg-elevated)" stroke="var(--border)" strokeWidth="1.5" />
        <text x="165" y="254" textAnchor="middle" fontFamily="IBM Plex Mono" fontSize="10" fill="var(--text-secondary)">[h</text>
        <text x="181" y="257" fontFamily="IBM Plex Mono" fontSize="7" fill="var(--text-secondary)">t-1</text>
        <text x="188" y="254" fontFamily="IBM Plex Mono" fontSize="10" fill="var(--text-secondary)">, x</text>
        <text x="202" y="257" fontFamily="IBM Plex Mono" fontSize="7" fill="var(--text-secondary)">t</text>
        <text x="207" y="254" fontFamily="IBM Plex Mono" fontSize="10" fill="var(--text-secondary)">]</text>
        <text x="165" y="265" textAnchor="middle" fontFamily="Plus Jakarta Sans" fontSize="9" fill="var(--text-muted)">Concatenated Input</text>

        {/* Lines from input to each gate */}
        <line x1="165" y1="238" x2="165" y2="186" stroke={stateLine} strokeWidth="1.2" markerEnd="url(#arr-gray)" />
        <line x1="180" y1="254" x2="312" y2="186" stroke={stateLine} strokeWidth="1.2" markerEnd="url(#arr-gray)" />
        <line x1="200" y1="238" x2="398" y2="186" stroke={stateLine} strokeWidth="1.2" markerEnd="url(#arr-gray)" />
        <line x1="240" y1="250" x2="573" y2="186" stroke={stateLine} strokeWidth="1.2" strokeDasharray="3 2" markerEnd="url(#arr-gray)" />

        {/* Legend */}
        <rect x="10" y="270" width="10" height="10" rx="2" fill={`${gateForget}33`} stroke={gateForget} strokeWidth="1" />
        <text x="24" y="279" fontFamily="Plus Jakarta Sans" fontSize="9" fill="var(--text-secondary)">Forget</text>
        <rect x="78" y="270" width="10" height="10" rx="2" fill={`${gateInput}33`} stroke={gateInput} strokeWidth="1" />
        <text x="92" y="279" fontFamily="Plus Jakarta Sans" fontSize="9" fill="var(--text-secondary)">Input</text>
        <rect x="130" y="270" width="10" height="10" rx="2" fill={`${gateOutput}33`} stroke={gateOutput} strokeWidth="1" />
        <text x="144" y="279" fontFamily="Plus Jakarta Sans" fontSize="9" fill="var(--text-secondary)">Output</text>
      </svg>
    </div>
  );
}

/* ── Gate explanation card ──────────────────────────────────────────────── */
function GateCard({
  color, label, symbol, formula, description,
}: {
  color: string; label: string; symbol: string; formula: string; description: string;
}) {
  return (
    <div style={{
      background: `color-mix(in srgb, ${color} 6%, var(--bg-card))`,
      border: `1px solid color-mix(in srgb, ${color} 22%, var(--border))`,
      borderRadius: '10px', padding: '16px', flex: '1 1 220px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <div style={{
          width: '28px', height: '28px', borderRadius: '7px',
          background: `color-mix(in srgb, ${color} 18%, transparent)`,
          border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'IBM Plex Mono', fontSize: '14px', color, fontWeight: 700,
        }}>
          {symbol}
        </div>
        <span style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>
          {label}
        </span>
      </div>
      <code style={{ display: 'block', fontFamily: 'IBM Plex Mono', fontSize: '11.5px', color, marginBottom: '8px' }}>
        {formula}
      </code>
      <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.65, fontFamily: 'Plus Jakarta Sans' }}>
        {description}
      </p>
    </div>
  );
}

/* ── Timeline item ──────────────────────────────────────────────────────── */
function TimelineItem({ year, event, citation }: { year: string; event: string; citation?: string }) {
  return (
    <div style={{ display: 'flex', gap: '14px', marginBottom: '14px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <div style={{
          width: '52px', height: '22px', borderRadius: '5px',
          background: 'var(--accent-muted)', border: '1px solid rgba(99,102,241,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '10px', color: 'var(--accent-light)', fontWeight: 600 }}>{year}</span>
        </div>
        <div style={{ width: '1px', flex: 1, background: 'var(--border)', marginTop: '4px' }} />
      </div>
      <div style={{ paddingTop: '2px', paddingBottom: '14px' }}>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans', lineHeight: 1.6 }}>
          {event}
          {citation && <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '10px', color: 'var(--accent-light)', marginLeft: '4px' }}>{citation}</span>}
        </p>
      </div>
    </div>
  );
}

/* ── Sections ───────────────────────────────────────────────────────────── */

function IntroSection() {
  return (
    <div>
      <SectionCard>
        <SectionTitle>LSTM là gì?</SectionTitle>
        <BodyText>
          <strong style={{ color: 'var(--text-primary)' }}>Long Short-Term Memory (LSTM)</strong> là một kiến trúc mạng nơ-ron hồi tiếp (Recurrent Neural Network — RNN) đặc biệt, được thiết kế để học các <em>phụ thuộc dài hạn</em> trong dữ liệu tuần tự. LSTM được giới thiệu lần đầu bởi <strong style={{ color: 'var(--text-primary)' }}>Sepp Hochreiter và Jürgen Schmidhuber</strong> năm 1997 trong bài báo nổi tiếng đăng trên tạp chí <em>Neural Computation</em>.<Cite n={1} />
        </BodyText>
        <BodyText>
          Khác với RNN truyền thống — vốn bị hạn chế bởi vấn đề <strong style={{ color: 'var(--warn)' }}>vanishing gradient</strong> — LSTM sử dụng cơ chế <em>gate</em> (cổng) để kiểm soát luồng thông tin, cho phép mạng "nhớ" hoặc "quên" thông tin một cách có chọn lọc qua hàng trăm đến hàng nghìn bước thời gian.<Cite n={3} />
        </BodyText>
        <InfoBox>
          Tính đến năm 2017, LSTM là kiến trúc RNN được sử dụng rộng rãi nhất trong các bài toán nhận dạng giọng nói, dịch máy, phân tích cảm xúc và dự báo chuỗi thời gian — trước khi Transformer (Vaswani et al., 2017) dần chiếm ưu thế trong NLP.
        </InfoBox>
      </SectionCard>

      <SectionCard>
        <SectionTitle accent="var(--warn)">Vấn đề Vanishing Gradient trong RNN</SectionTitle>
        <BodyText>
          Khi huấn luyện RNN bằng giải thuật <strong style={{ color: 'var(--text-primary)' }}>Backpropagation Through Time (BPTT)</strong>, gradient lan truyền ngược qua nhiều timestep. Theo Bengio et al. (1994)<Cite n={2} />, gradient giảm theo hàm số mũ:
        </BodyText>
        <MathBlock>{`‖∂h_t / ∂h_k‖ ≤ (λ_max · ‖W‖)^(t-k)

Khi λ_max · ‖W‖ < 1:  gradient → 0  (vanishing)
Khi λ_max · ‖W‖ > 1:  gradient → ∞  (exploding)`}</MathBlock>
        <BodyText>
          Hệ quả: RNN thông thường chỉ học được các phụ thuộc ngắn hạn (short-term dependencies). LSTM giải quyết điều này thông qua <strong style={{ color: 'var(--accent-light)' }}>cell state</strong> — một "đường cao tốc" thẳng chạy qua toàn bộ chuỗi với rất ít phép biến đổi phi tuyến, giữ cho gradient ổn định.
        </BodyText>
      </SectionCard>

      <SectionCard>
        <SectionTitle accent="var(--purple)">Lịch sử phát triển</SectionTitle>
        <div style={{ marginTop: '4px' }}>
          <TimelineItem year="1991" event="Hochreiter chỉ ra vấn đề vanishing gradient trong luận văn tốt nghiệp tại TU Munich." citation="[8]" />
          <TimelineItem year="1997" event="Hochreiter & Schmidhuber công bố LSTM — kiến trúc đầu tiên dùng gated cell state để giải quyết long-term dependencies." citation="[1]" />
          <TimelineItem year="2000" event="Gers et al. bổ sung forget gate và peephole connections, giúp LSTM mô hình hóa thời gian tốt hơn." citation="[5]" />
          <TimelineItem year="2005" event="Graves & Schmidhuber giới thiệu Bidirectional LSTM (BiLSTM) cho bài toán nhận dạng ngữ âm." citation="[6]" />
          <TimelineItem year="2014" event="Cho et al. đề xuất GRU (Gated Recurrent Unit) — phiên bản đơn giản hóa của LSTM với 2 gate." citation="[4]" />
          <TimelineItem year="2015" event='Colah xuất bản bài viết nổi tiếng "Understanding LSTMs" giải thích kiến trúc một cách trực quan.' citation="[3]" />
          <TimelineItem year="2017" event="Google sử dụng LSTM đa tầng trong hệ thống dịch thuật Google Translate, đạt kết quả tiệm cận con người." />
        </div>
      </SectionCard>
    </div>
  );
}

function ArchitectureSection() {
  return (
    <div>
      <SectionCard>
        <SectionTitle>Sơ đồ LSTM Cell</SectionTitle>
        <BodyText>
          Mỗi LSTM cell nhận vào hai trạng thái từ bước trước: <code style={{ fontFamily: 'IBM Plex Mono', fontSize: '12px', color: 'var(--accent-light)' }}>h_{"{t-1}"}</code> (hidden state) và <code style={{ fontFamily: 'IBM Plex Mono', fontSize: '12px', color: 'var(--accent-light)' }}>C_{"{t-1}"}</code> (cell state). Cùng với input hiện tại <code style={{ fontFamily: 'IBM Plex Mono', fontSize: '12px', color: 'var(--accent-light)' }}>x_t</code>, chúng tạo ra <code style={{ fontFamily: 'IBM Plex Mono', fontSize: '12px', color: '#22C55E' }}>h_t</code> và <code style={{ fontFamily: 'IBM Plex Mono', fontSize: '12px', color: '#94A3B8' }}>C_t</code> mới.<Cite n={3} />
        </BodyText>
        <LSTMDiagram />
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '8px' }}>
          {[
            { color: '#F97316', label: '× Forget', desc: 'Loại bỏ thông tin cũ' },
            { color: '#818CF8', label: '+ Input',  desc: 'Thêm thông tin mới' },
            { color: '#22C55E', label: '× Output', desc: 'Lọc đầu ra h_t' },
            { color: '#94A3B8', label: 'C_t belt', desc: 'Conveyor cell state' },
          ].map(({ color, label, desc }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: color, flexShrink: 0 }} />
              <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '10px', color: 'var(--text-secondary)' }}>
                {label} — {desc}
              </span>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard>
        <SectionTitle>Ba cổng của LSTM</SectionTitle>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <GateCard
            color="#F97316" label="Forget Gate" symbol="f"
            formula="f_t = σ(W_f·[h_{t-1}, x_t] + b_f)"
            description="Quyết định thông tin nào trong cell state cũ cần được quên. Output là vector trong [0,1]: 0 = quên hoàn toàn, 1 = giữ lại hoàn toàn."
          />
          <GateCard
            color="#818CF8" label="Input Gate" symbol="i"
            formula={"i_t = σ(W_i·[h_{t-1}, x_t] + b_i)\ng̃_t = tanh(W_c·[h_{t-1}, x_t] + b_c)"}
            description="Hai phần: i_t (cổng sigmoid) quyết định thông tin nào được cập nhật; g̃_t (tanh) tạo ra vector ứng viên của giá trị mới cần thêm vào."
          />
          <GateCard
            color="#22C55E" label="Output Gate" symbol="o"
            formula={"o_t = σ(W_o·[h_{t-1}, x_t] + b_o)\nh_t = o_t ⊙ tanh(C_t)"}
            description="Lọc phần nào của cell state sẽ là output. tanh(C_t) đưa giá trị về [-1,1]; o_t (sigmoid) quyết định phần nào được phép qua."
          />
        </div>
      </SectionCard>

      <SectionCard>
        <SectionTitle>Cell State — Conveyor Belt</SectionTitle>
        <BodyText>
          Điểm mấu chốt của LSTM chính là <strong style={{ color: 'var(--accent-light)' }}>cell state C_t</strong> — một luồng thông tin chạy thẳng qua toàn bộ chuỗi, chỉ bị biến đổi bởi các phép tính tuyến tính nhỏ.<Cite n={3} /> Colah (2015) mô tả đây là "conveyor belt" — băng truyền chạy dọc theo chuỗi, dễ dàng truyền gradient về đầu mà không bị suy giảm.
        </BodyText>
        <MathBlock>{`C_t = f_t ⊙ C_{t-1}  +  i_t ⊙ g̃_t
         │                  │
         └── Quên cũ         └── Thêm mới`}</MathBlock>
        <BodyText>
          Ký hiệu <code style={{ fontFamily: 'IBM Plex Mono', fontSize: '12px', color: 'var(--text-primary)' }}>⊙</code> là phép nhân Hadamard (element-wise). Gradient của loss qua C_t chủ yếu chỉ đi qua phép cộng (<code style={{ fontFamily: 'IBM Plex Mono', fontSize: '11px', color: 'var(--text-primary)' }}>+</code>), tránh được vấn đề vanishing.
        </BodyText>
      </SectionCard>
    </div>
  );
}

function MathSection() {
  return (
    <div>
      <SectionCard>
        <SectionTitle>Hệ phương trình LSTM đầy đủ</SectionTitle>
        <BodyText>
          Tại mỗi timestep <em>t</em>, LSTM tính toán theo hệ 6 phương trình sau<Cite n={1} /><Cite n={7} />:
        </BodyText>
        <MathBlock>{`(1) Forget gate:      f_t = σ(W_f · [h_{t-1}, x_t] + b_f)

(2) Input gate:       i_t = σ(W_i · [h_{t-1}, x_t] + b_i)

(3) Candidate state:  g̃_t = tanh(W_c · [h_{t-1}, x_t] + b_c)

(4) Cell state:       C_t = f_t ⊙ C_{t-1} + i_t ⊙ g̃_t

(5) Output gate:      o_t = σ(W_o · [h_{t-1}, x_t] + b_o)

(6) Hidden state:     h_t = o_t ⊙ tanh(C_t)`}</MathBlock>
      </SectionCard>

      <SectionCard>
        <SectionTitle>Ký hiệu và chiều dữ liệu</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
          {[
            { sym: 'x_t ∈ ℝⁿ',       desc: 'Input tại timestep t (n = số features)' },
            { sym: 'h_t ∈ ℝʰ',        desc: 'Hidden state (h = hidden units, e.g. 128)' },
            { sym: 'C_t ∈ ℝʰ',        desc: 'Cell state, cùng chiều với h_t' },
            { sym: 'W_f, W_i, W_c, W_o', desc: 'Ma trận trọng số ∈ ℝʰˣ⁽ʰ⁺ⁿ⁾' },
            { sym: 'b_f, b_i, b_c, b_o', desc: 'Bias vectors ∈ ℝʰ' },
            { sym: 'σ(z) = 1/(1+e⁻ᶻ)', desc: 'Sigmoid — nén về [0, 1]' },
            { sym: 'tanh(z)',           desc: 'Hyperbolic tangent — nén về [-1, 1]' },
            { sym: '⊙',                desc: 'Element-wise (Hadamard) multiplication' },
          ].map(({ sym, desc }) => (
            <div key={sym} style={{
              background: 'var(--bg-elevated)', borderRadius: '8px', padding: '12px',
              display: 'flex', gap: '10px',
            }}>
              <code style={{ fontFamily: 'IBM Plex Mono', fontSize: '11px', color: 'var(--accent-light)', flexShrink: 0, paddingTop: '1px' }}>
                {sym}
              </code>
              <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans', lineHeight: 1.5 }}>
                {desc}
              </span>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard>
        <SectionTitle>Hàm mất mát và Backpropagation Through Time</SectionTitle>
        <BodyText>
          LSTM được huấn luyện bằng <strong style={{ color: 'var(--text-primary)' }}>BPTT (Backpropagation Through Time)</strong>. Gradient của loss được tính qua cả sequence:
        </BodyText>
        <MathBlock>{`∂L / ∂W = Σ_t  ∂L_t / ∂W

Gradient qua cell state (chain rule):
∂C_t / ∂C_{t-k} = Π_{j=t-k+1}^{t}  f_j     ← product of forget gates

→ Khi f_j ≈ 1: gradient không suy giảm  ✓
→ Khi f_j ≈ 0: cell state bị cắt đứt có chủ ý  ✓`}</MathBlock>
        <BodyText>
          Đây là lý do tại sao forget gate (với bias khởi tạo = 1) giúp LSTM tránh được vanishing gradient — gradient chỉ cần nhân với giá trị forget gate gần 1.<Cite n={5} />
        </BodyText>
      </SectionCard>

      <SectionCard>
        <SectionTitle>Số lượng tham số</SectionTitle>
        <BodyText>
          Tổng số tham số của một LSTM layer với input size <em>n</em> và hidden size <em>h</em>:
        </BodyText>
        <MathBlock>{`Params = 4 × (h × (h + n) + h)
       = 4 × (h² + h·n + h)

Ví dụ dự án này: h=128, n=số features (~10-20)
Params ≈ 4 × (128² + 128×15 + 128) = 4 × (16384 + 1920 + 128)
       ≈ 74,128 tham số / layer × 2 layers = ~148K params`}</MathBlock>
      </SectionCard>
    </div>
  );
}

function VariantsSection() {
  return (
    <div>
      <SectionCard>
        <SectionTitle>Peephole Connections</SectionTitle>
        <BodyText>
          Gers & Schmidhuber (2000)<Cite n={5} /> đề xuất cho phép các gate "nhìn vào" cell state C_{"{t-1}"} trực tiếp (không chỉ qua h_{"{t-1}"}):
        </BodyText>
        <MathBlock>{`f_t = σ(W_f · [C_{t-1}, h_{t-1}, x_t] + b_f)
i_t = σ(W_i · [C_{t-1}, h_{t-1}, x_t] + b_i)
o_t = σ(W_o · [C_t,   h_{t-1}, x_t] + b_o)  ← dùng C_t hiện tại`}</MathBlock>
        <BodyText>
          Điều này giúp LSTM mô hình hóa chính xác hơn các khoảng thời gian (timing), đặc biệt hữu ích trong nhận dạng giọng nói và nhịp điệu âm nhạc.
        </BodyText>
      </SectionCard>

      <SectionCard>
        <SectionTitle>GRU — Gated Recurrent Unit</SectionTitle>
        <BodyText>
          Cho et al. (2014)<Cite n={4} /> giới thiệu GRU — phiên bản đơn giản hóa của LSTM với <strong style={{ color: 'var(--text-primary)' }}>2 gate thay vì 3</strong>, không có cell state riêng:
        </BodyText>
        <MathBlock>{`z_t = σ(W_z · [h_{t-1}, x_t])       ← Update gate
r_t = σ(W_r · [h_{t-1}, x_t])       ← Reset gate
h̃_t = tanh(W · [r_t ⊙ h_{t-1}, x_t])
h_t = (1 - z_t) ⊙ h_{t-1} + z_t ⊙ h̃_t`}</MathBlock>
        <BodyText>
          GRU có ít tham số hơn (~75% so với LSTM) và thường đạt hiệu năng tương đương trên nhiều bài toán. Trong thực tế, việc lựa chọn giữa LSTM và GRU nên dựa trên thực nghiệm với dữ liệu cụ thể.<Cite n={7} />
        </BodyText>
      </SectionCard>

      <SectionCard>
        <SectionTitle>Bidirectional LSTM</SectionTitle>
        <BodyText>
          Graves & Schmidhuber (2005)<Cite n={6} /> đề xuất xử lý sequence theo <strong style={{ color: 'var(--text-primary)' }}>cả hai chiều</strong> — forward và backward — rồi ghép (concatenate) kết quả:
        </BodyText>
        <MathBlock>{`→h_t = LSTM_forward(x_1, ..., x_t)
←h_t = LSTM_backward(x_T, ..., x_t)
y_t  = [→h_t ; ←h_t]   ← concatenate, size = 2h`}</MathBlock>
        <BodyText>
          Đặc biệt hiệu quả khi toàn bộ sequence đã có sẵn (batch processing), ví dụ: phân loại văn bản, nhận dạng thực thể. Không áp dụng được cho real-time forecasting (vì chưa có dữ liệu tương lai).
        </BodyText>
      </SectionCard>

      <SectionCard>
        <SectionTitle>So sánh các biến thể</SectionTitle>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Kiến trúc</th>
                <th>Gates</th>
                <th>Tham số</th>
                <th>Cell State</th>
                <th>Ưu điểm</th>
                <th>Nguồn</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: 'Vanilla RNN', gates: '0', params: 'n²+nh', cell: '✗', pro: 'Đơn giản', src: '—' },
                { name: 'LSTM', gates: '3 (f, i, o)', params: '4(h²+hn)', cell: '✓', pro: 'Long-range deps', src: '[1]' },
                { name: 'LSTM + Peephole', gates: '3 + peep', params: '4(h²+hn)+3h', cell: '✓', pro: 'Precision timing', src: '[5]' },
                { name: 'GRU', gates: '2 (z, r)', params: '3(h²+hn)', cell: '✗', pro: 'Ít params hơn', src: '[4]' },
                { name: 'BiLSTM', gates: '3 × 2', params: '8(h²+hn)', cell: '✓', pro: 'Ngữ cảnh đầy đủ', src: '[6]' },
              ].map(r => (
                <tr key={r.name}>
                  <td><span className="font-mono" style={{ fontSize: '12px', color: 'var(--accent-light)' }}>{r.name}</span></td>
                  <td><span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>{r.gates}</span></td>
                  <td><code style={{ fontFamily: 'IBM Plex Mono', fontSize: '11px', color: 'var(--text-primary)' }}>{r.params}</code></td>
                  <td><span style={{ fontSize: '13px' }}>{r.cell}</span></td>
                  <td><span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>{r.pro}</span></td>
                  <td><span className="font-mono" style={{ fontSize: '10px', color: 'var(--accent-light)' }}>{r.src}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

function ApplicationSection() {
  return (
    <div>
      <SectionCard>
        <SectionTitle>LSTM trong dự án Crypto Analytics</SectionTitle>
        <BodyText>
          Dự án này triển khai mô hình LSTM <strong style={{ color: 'var(--text-primary)' }}>dual-head</strong> để dự báo giá Bitcoin và Dogecoin. Kiến trúc được thiết kế để vừa hồi quy (regression) vừa phân loại (classification) từ cùng một backbone LSTM.
        </BodyText>
        <MathBlock>{`Model: 2-layer LSTM
  Input:    sequence_length = 60 timesteps (60 phiên giao dịch)
  Layer 1:  LSTM(hidden=128, dropout=0.2)
  Layer 2:  LSTM(hidden=128, dropout=0.2)
            ↓
  ┌─────────────────────┬──────────────────────┐
  │  Regression Head    │ Classification Head  │
  │  Linear(128 → 1)    │ Linear(128 → 3)      │
  │  HuberLoss          │ CrossEntropyLoss      │
  │  → next-day price   │ → UP / FLAT / DOWN   │
  └─────────────────────┴──────────────────────┘`}</MathBlock>
      </SectionCard>

      <SectionCard>
        <SectionTitle accent="#22C55E">Đặc trưng đầu vào (Features)</SectionTitle>
        <BodyText>
          Mô hình học trên chuỗi 60 timestep, mỗi timestep gồm các đặc trưng kỹ thuật tính từ Spark Streaming:
        </BodyText>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px', marginTop: '12px' }}>
          {[
            { name: 'Price (close)', desc: 'Giá đóng cửa, chuẩn hóa MinMax' },
            { name: 'Volume',        desc: 'Khối lượng giao dịch' },
            { name: 'SMA-7/21/50',   desc: 'Simple Moving Average' },
            { name: 'RSI',           desc: 'Relative Strength Index (0–100)' },
            { name: 'VWAP',          desc: 'Volume-Weighted Average Price' },
            { name: 'Bollinger Bands', desc: 'Upper/Middle/Lower bands' },
            { name: 'ATR',           desc: 'Average True Range (volatility)' },
            { name: 'Log Returns',   desc: 'ln(P_t / P_{t-1})' },
          ].map(f => (
            <div key={f.name} style={{
              background: 'var(--bg-elevated)', borderRadius: '7px', padding: '10px 12px',
              display: 'flex', alignItems: 'flex-start', gap: '8px',
            }}>
              <ChevronRight size={12} color="var(--accent-light)" style={{ marginTop: '2px', flexShrink: 0 }} />
              <div>
                <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '11.5px', color: 'var(--text-primary)', fontWeight: 600 }}>{f.name}</div>
                <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard>
        <SectionTitle accent="var(--purple)">Huấn luyện và Suy luận</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          {[
            {
              title: 'Training Pipeline',
              items: [
                'Dữ liệu lịch sử từ CoinGecko API',
                'Chuẩn hóa: MinMaxScaler (lưu file .pkl)',
                'Train/Val split: 80/20 theo thời gian',
                'Optimizer: Adam (lr=1e-3, weight_decay=1e-5)',
                'Epochs: 50 (configurable)',
                'Artifact: lstm_{coin}_v2.pt',
              ],
            },
            {
              title: 'Inference Pipeline',
              items: [
                'Load model + scaler từ disk',
                'Lấy 60 ngày gần nhất từ MongoDB',
                'Dự báo 7 ngày tiếp theo (auto-regressive)',
                'Ghi kết quả vào collection predictions',
                'Scheduler chạy mỗi 5 phút (intraday)',
                'Fallback: đọc từ live_prices nếu thiếu data',
              ],
            },
          ].map(col => (
            <div key={col.title} style={{
              background: 'var(--bg-elevated)', borderRadius: '8px', padding: '14px',
            }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)', marginBottom: '10px' }}>
                {col.title}
              </div>
              {col.items.map(item => (
                <div key={item} style={{ display: 'flex', gap: '7px', alignItems: 'flex-start', marginBottom: '6px' }}>
                  <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--accent-light)', flexShrink: 0, marginTop: '6px' }} />
                  <span style={{ fontFamily: 'Plus Jakarta Sans', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{item}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard>
        <SectionTitle>Tại sao chọn LSTM cho Crypto Forecasting?</SectionTitle>
        <InfoBox color="var(--up)">
          Thị trường crypto thể hiện strong temporal dependencies — giá ngày hôm nay phụ thuộc vào hàng chục ngày trước. LSTM với sequence_length=60 cho phép mô hình "nhìn lại" 60 phiên giao dịch, đủ để nắm bắt các chu kỳ ngắn và trung hạn.
        </InfoBox>
        <BodyText>
          Nghiên cứu của Fischer & Krauss (2018) cho thấy LSTM vượt trội so với các phương pháp thống kê truyền thống (ARIMA, Random Forest) trong dự báo giá cổ phiếu với Sharpe ratio cao hơn ~0.4 điểm. Tương tự, Siami-Namini et al. (2018) xác nhận LSTM giảm RMSE lên đến 85% so với ARIMA trên chuỗi thời gian tài chính.
        </BodyText>
      </SectionCard>
    </div>
  );
}

function ReferencesSection() {
  const refs = [
    {
      n: 1,
      citation: 'Hochreiter, S., & Schmidhuber, J. (1997). Long short-term memory. Neural Computation, 9(8), 1735–1780.',
      doi: 'https://doi.org/10.1162/neco.1997.9.8.1735',
      type: 'Journal',
    },
    {
      n: 2,
      citation: 'Bengio, Y., Simard, P., & Frasconi, P. (1994). Learning long-term dependencies with gradient descent is difficult. IEEE Transactions on Neural Networks, 5(2), 157–166.',
      doi: 'https://doi.org/10.1109/72.279181',
      type: 'Journal',
    },
    {
      n: 3,
      citation: 'Olah, C. (2015). Understanding LSTM Networks. Colah\'s Blog.',
      doi: 'https://colah.github.io/posts/2015-08-Understanding-LSTMs/',
      type: 'Blog',
    },
    {
      n: 4,
      citation: 'Cho, K., van Merrienboer, B., Gulcehre, C., Bahdanau, D., Bougares, F., Schwenk, H., & Bengio, Y. (2014). Learning Phrase Representations using RNN Encoder-Decoder for Statistical Machine Translation. EMNLP 2014.',
      doi: 'https://arxiv.org/abs/1406.1078',
      type: 'Conference',
    },
    {
      n: 5,
      citation: 'Gers, F. A., Schmidhuber, J., & Cummins, F. (2000). Learning to forget: Continual prediction with LSTM. Neural Computation, 12(10), 2451–2471.',
      doi: 'https://doi.org/10.1162/089976600300015015',
      type: 'Journal',
    },
    {
      n: 6,
      citation: 'Graves, A., & Schmidhuber, J. (2005). Framewise phoneme classification with bidirectional LSTM and other neural network architectures. Neural Networks, 18(5–6), 602–610.',
      doi: 'https://doi.org/10.1016/j.neunet.2005.06.042',
      type: 'Journal',
    },
    {
      n: 7,
      citation: 'Goodfellow, I., Bengio, Y., & Courville, A. (2016). Deep Learning. MIT Press. Chapter 10: Sequence Modeling: Recurrent and Recursive Nets.',
      doi: 'https://www.deeplearningbook.org/',
      type: 'Book',
    },
    {
      n: 8,
      citation: 'Hochreiter, S. (1991). Untersuchungen zu dynamischen neuronalen Netzen [Diploma thesis]. Technische Universität München.',
      doi: 'https://people.idsia.ch/~juergen/SeppHochreiter1991ThesisAdvisorSchmidhuber.pdf',
      type: 'Thesis',
    },
    {
      n: 9,
      citation: 'Fischer, T., & Krauss, C. (2018). Deep learning with long short-term memory networks for financial market predictions. European Journal of Operational Research, 270(2), 654–669.',
      doi: 'https://doi.org/10.1016/j.ejor.2017.11.054',
      type: 'Journal',
    },
    {
      n: 10,
      citation: 'Siami-Namini, S., Tavakoli, N., & Namin, A. S. (2018). A comparison of ARIMA and LSTM in forecasting time series. 17th IEEE International Conference on Machine Learning and Applications (ICMLA).',
      doi: 'https://doi.org/10.1109/ICMLA.2018.00227',
      type: 'Conference',
    },
  ];

  const typeColor: Record<string, string> = {
    Journal:    'var(--accent-light)',
    Conference: 'var(--warn)',
    Blog:       '#22C55E',
    Book:       '#A78BFA',
    Thesis:     '#94A3B8',
  };

  return (
    <div>
      <SectionCard>
        <SectionTitle>Tài liệu tham khảo</SectionTitle>
        <BodyText style={{ marginBottom: '18px' }}>
          Tất cả nội dung trong trang này được tổng hợp từ các nguồn học thuật uy tín đã qua bình duyệt (peer-reviewed). Danh sách dưới đây sử dụng định dạng trích dẫn <strong style={{ color: 'var(--text-primary)' }}>IEEE</strong>.
        </BodyText>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {refs.map(ref => (
            <div key={ref.n} style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: '9px', padding: '14px 16px',
              display: 'flex', gap: '12px', alignItems: 'flex-start',
            }}>
              <div style={{
                width: '26px', height: '26px', borderRadius: '6px',
                background: 'var(--accent-muted)', border: '1px solid rgba(99,102,241,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '11px', color: 'var(--accent-light)', fontWeight: 700 }}>
                  {ref.n}
                </span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                  <span style={{
                    fontFamily: 'IBM Plex Mono', fontSize: '9px', fontWeight: 600,
                    color: typeColor[ref.type] ?? 'var(--text-muted)',
                    padding: '2px 7px', borderRadius: '4px',
                    background: `color-mix(in srgb, ${typeColor[ref.type] ?? 'gray'} 12%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${typeColor[ref.type] ?? 'gray'} 25%, transparent)`,
                  }}>
                    {ref.type.toUpperCase()}
                  </span>
                </div>
                <p style={{ margin: '0 0 6px', fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans', lineHeight: 1.6 }}>
                  {ref.citation}
                </p>
                <a
                  href={ref.doi}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    fontFamily: 'IBM Plex Mono', fontSize: '10px', color: 'var(--accent-light)',
                    textDecoration: 'none',
                  }}
                >
                  <ExternalLink size={10} />
                  {ref.doi}
                </a>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Network size={14} color="var(--text-muted)" />
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans' }}>
            Trang này được xây dựng phục vụ môn học <strong style={{ color: 'var(--text-secondary)' }}>CS315.F21.CN2 — Advanced Machine Learning</strong>.
            Nội dung tổng hợp từ các nguồn học thuật peer-reviewed; hình ảnh và sơ đồ được thiết kế mới.
          </span>
        </div>
      </SectionCard>
    </div>
  );
}

/* ── Main page component ────────────────────────────────────────────────── */

export default function LSTMResearchPage() {
  const [activeTab, setActiveTab] = useState<Tab>('intro');

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: '26px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
          <Brain size={19} color="var(--accent-light)" />
          <h1 className="font-display" style={{ margin: 0, fontSize: '22px', color: 'var(--text-primary)' }}>
            LSTM Deep Dive
          </h1>
          <span style={{
            fontFamily: 'IBM Plex Mono', fontSize: '9px', fontWeight: 600,
            padding: '3px 8px', borderRadius: '5px',
            background: 'var(--purple-subtle)', border: '1px solid rgba(167,139,250,0.2)',
            color: 'var(--purple)',
          }}>
            RESEARCH
          </span>
        </div>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
          Long Short-Term Memory Networks · Hochreiter &amp; Schmidhuber, 1997 · CS315.F21.CN2
        </p>
      </div>

      {/* Tab navigation */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '22px', flexWrap: 'wrap' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`btn-ghost ${activeTab === tab.id ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
        >
          {activeTab === 'intro'        && <IntroSection />}
          {activeTab === 'architecture' && <ArchitectureSection />}
          {activeTab === 'math'         && <MathSection />}
          {activeTab === 'variants'     && <VariantsSection />}
          {activeTab === 'application'  && <ApplicationSection />}
          {activeTab === 'references'   && <ReferencesSection />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
