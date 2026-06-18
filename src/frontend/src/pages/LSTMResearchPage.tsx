import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Target, Database, Boxes, Dumbbell, Sparkles, BarChart3,
  BookMarked, ExternalLink, ArrowRight, Network,
} from 'lucide-react';
import {
  SectionCard, SectionTitle, BodyText, Callout, CodeBlock,
  EqBlock, TeX, DataTable, FlowDiagram, Mono, Tag, SubTitle,
} from './docs/shared';

/* ════════════════════════════════════════════════════════════════════════════
   LSTM — Ứng dụng vào bài toán dự đoán giá crypto của dự án
   Trang này KHÔNG dạy lại lý thuyết LSTM (xem trang "LSTM — Long Short-Term
   Memory" trong Docs). Ở đây ta đi thẳng vào: dự án dùng LSTM NHƯ THẾ NÀO,
   kèm code thật trích từ src/ml/.
   ════════════════════════════════════════════════════════════════════════════ */

type Tab =
  | 'overview' | 'data' | 'model' | 'training' | 'inference'
  | 'results' | 'references';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview',   label: 'Tổng quan',   icon: <Target size={13} /> },
  { id: 'data',       label: 'Dữ liệu',     icon: <Database size={13} /> },
  { id: 'model',      label: 'Mô hình',     icon: <Boxes size={13} /> },
  { id: 'training',   label: 'Huấn luyện',  icon: <Dumbbell size={13} /> },
  { id: 'inference',  label: 'Suy luận',    icon: <Sparkles size={13} /> },
  { id: 'results',    label: 'Kết quả',     icon: <BarChart3 size={13} /> },
  { id: 'references', label: 'Tài liệu',    icon: <BookMarked size={13} /> },
];

function Cite({ n }: { n: number }) {
  return (
    <sup style={{ fontFamily: 'IBM Plex Mono', fontSize: '10px', color: 'var(--accent-light)', marginLeft: '2px' }}>
      [{n}]
    </sup>
  );
}

/* Một dòng "lý thuyết → code của chúng ta" */
function MapRow({ theory, code }: { theory: React.ReactNode; code: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
      <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans', flex: '1 1 200px' }}>
        {theory}
      </span>
      <ArrowRight size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
      <span style={{ flex: '1 1 200px' }}>{code}</span>
    </div>
  );
}

/* ── 1. TỔNG QUAN ─────────────────────────────────────────────────────────── */

function OverviewSection() {
  return (
    <div>
      <SectionCard>
        <SectionTitle accent="#5C8AFF">Bài toán: dự đoán giá Bitcoin & Dogecoin</SectionTitle>
        <BodyText>
          Mục tiêu cụ thể của dự án: <strong style={{ color: 'var(--text-primary)' }}>nhìn 60 ngày gần nhất của một
          đồng coin, rồi dự đoán đường giá cho nhiều ngày tới</strong>. Đây đúng là dạng bài "dữ liệu chuỗi" mà LSTM
          sinh ra để giải — quá khứ có thứ tự, và thứ tự đó mang thông tin (xu hướng, đà tăng/giảm, chu kỳ).
        </BodyText>
        <BodyText>
          Thay vì đoán một con số duy nhất, ta huấn luyện <strong style={{ color: 'var(--text-primary)' }}>3 mô hình
          riêng cho 3 "tầm nhìn" (horizon)</strong>: 7, 15 và 60 ngày. Mỗi mô hình đoán <em>cả</em> chuỗi ngày của
          horizon đó trong <strong style={{ color: 'var(--text-primary)' }}>một lần chạy duy nhất</strong> (gọi là
          MIMO — Multi-Input Multi-Output), nên lỗi không bị tích lũy dần như cách "đoán từng ngày rồi nạp lại".
        </BodyText>
        <Callout variant="info">
          <strong>Trang này nói về "cách dùng", không phải "lý thuyết".</strong> Nếu bạn cần hiểu LSTM hoạt động
          bên trong ra sao (cổng quên/ghi/xuất, băng chuyền Cell State, vì sao tránh được vanishing gradient), hãy
          đọc trang <em>"LSTM — Long Short-Term Memory"</em> trong mục Docs. Ở đây ta tập trung vào{' '}
          <strong style={{ color: 'var(--text-primary)' }}>dữ liệu, kiến trúc, cách huấn luyện và suy luận thực tế
          của dự án</strong> — kèm code thật.
        </Callout>
      </SectionCard>

      <SectionCard>
        <SectionTitle>Đường đi của dữ liệu — từ giá thô tới dự đoán</SectionTitle>
        <BodyText>
          Toàn bộ pipeline có thể tóm trong một dòng. Mỗi khối dưới đây tương ứng một phần của trang này:
        </BodyText>
        <FlowDiagram nodes={[
          { label: 'CSV / MongoDB', sub: 'giá lịch sử', variant: 'mongo' },
          { label: '9 Features', sub: 'log-return…', variant: 'lstm' },
          { label: 'StandardScaler', sub: 'fit trên train', variant: 'lstm' },
          { label: 'Cửa sổ trượt', sub: '60 × 9 → 7', variant: 'lstm' },
          { label: 'LSTM 2 lớp', sub: 'hidden 128', variant: 'lstm' },
          { label: 'Price + Vol Head', variant: 'lstm' },
          { label: 'predictions', sub: 'MongoDB', variant: 'mongo' },
        ]} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px', marginTop: '12px' }}>
          {[
            { c: '#22C55E', t: 'Vì sao LSTM hợp?', d: 'Giá crypto phụ thuộc xa (chu kỳ 30–90 ngày) — đúng thế mạnh của Cell State.' },
            { c: '#A78BFA', t: 'Dữ liệu nhiễu mạnh', d: 'Kurtosis 11–77: pump/crash cực đoan thường xuyên → cần loss bền với outlier (Huber).' },
            { c: '#F59E0B', t: 'Không stationary', d: 'Giá trôi theo thời gian → ta học trên log-return (đã dừng) thay vì giá thô.' },
          ].map(x => (
            <div key={x.t} style={{
              background: `color-mix(in srgb, ${x.c} 6%, var(--bg-card))`,
              border: `1px solid color-mix(in srgb, ${x.c} 20%, var(--border))`,
              borderTop: `3px solid ${x.c}`, borderRadius: '8px', padding: '13px',
            }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: '12.5px', color: 'var(--text-primary)', marginBottom: '5px' }}>{x.t}</div>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: '11.5px', color: 'var(--text-secondary)', lineHeight: 1.55 }}>{x.d}</div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

/* ── 2. DỮ LIỆU ───────────────────────────────────────────────────────────── */

function DataSection() {
  return (
    <div>
      <SectionCard>
        <SectionTitle accent="#22C55E">Mỗi ngày là một vector 9 con số</SectionTitle>
        <BodyText>
          LSTM không "nhìn" giá thô. Mỗi ngày <TeX>{String.raw`x_t`}</TeX> được mô tả bằng{' '}
          <strong style={{ color: 'var(--text-primary)' }}>9 đặc trưng (feature)</strong> — coi như "9 giác quan" để
          cảm nhận thị trường: đà tăng, độ biến động, quá mua/quá bán… Quan trọng nhất:{' '}
          <strong style={{ color: 'var(--text-primary)' }}>feature số 0 bắt buộc là <Mono>log_return_1d</Mono></strong>{' '}
          — vì lúc suy luận ta sẽ đảo ngược chính cột này để dựng lại giá USD.
        </BodyText>
        <DataTable
          headers={['#', 'Feature', 'Nhóm', 'Ý nghĩa dễ hiểu']}
          rows={[
            ['0', <Mono>log_return_1d</Mono>, <Tag variant="blue">Momentum</Tag>, '% thay đổi giá so với hôm qua (dạng log). Có tính dừng — đầu vào "sạch" cho mô hình.'],
            ['1', <Mono>momentum_30d</Mono>, <Tag variant="blue">Momentum</Tag>, 'Giá đang cao/thấp bao nhiêu so với trung bình 30 ngày → xu hướng trung hạn.'],
            ['2', <Mono>realized_vol_14d</Mono>, <Tag variant="amber">Volatility</Tag>, 'Thị trường gần đây "rung lắc" mạnh hay êm. Đầu vào chính cho Volatility Head.'],
            ['3', <Mono>RSI_14</Mono>, <Tag variant="purple">Oscillator</Tag>, 'Quá mua / quá bán (0–100). Đã nằm sẵn trong khoảng đẹp.'],
            ['4', <Mono>log_volume</Mono>, <Tag variant="green">Volume</Tag>, 'Khối lượng giao dịch (lấy log). Volume xác nhận một cú breakout là thật hay giả.'],
            ['5', <Mono>macd_norm</Mono>, <Tag variant="purple">Oscillator</Tag>, 'MACD chuẩn hoá theo giá → dùng được ở mọi mức giá.'],
            ['6', <Mono>bb_pct_b</Mono>, <Tag variant="purple">Oscillator</Tag>, 'Giá đang ở đâu trong dải Bollinger (0 = đáy dải, 1 = đỉnh dải).'],
            ['7', <Mono>atr_norm</Mono>, <Tag variant="amber">Volatility</Tag>, 'Biên độ dao động tức thì — bổ sung cho realized_vol.'],
            ['8', <Mono>fear_greed</Mono>, <Tag variant="red">Sentiment</Tag>, 'Tâm lý thị trường (sợ hãi/tham lam). Hiện để placeholder 0.5.'],
          ]}
        />
      </SectionCard>

      <SectionCard>
        <SectionTitle>Chuẩn hoá: chỉ "học" thống kê từ quá khứ</SectionTitle>
        <BodyText>
          9 feature có thang đo rất khác nhau (RSI tới 100, log-return quanh 0). Ta đưa tất cả về cùng thang bằng{' '}
          <Mono>StandardScaler</Mono>. Mấu chốt: <strong style={{ color: 'var(--text-primary)' }}>chỉ <Mono>fit</Mono>{' '}
          trên tập train</strong> rồi mới <Mono>transform</Mono> cả train/val/test — nếu fit trên toàn bộ, mô hình sẽ
          "nhìn trộm" thống kê của tương lai (data leakage) và kết quả đẹp giả tạo.
        </BodyText>
        <CodeBlock lang="python">{`# src/ml/preprocess.py
scaler = StandardScaler()
scaler.fit(feat_train)               # CHỈ fit trên tập train → tránh data leakage
scaled_train = scaler.transform(feat_train)
scaled_val   = scaler.transform(feat_val)
scaled_test  = scaler.transform(feat_test)

# Lưu lại giá USD cuối cùng để lúc suy luận dựng ngược ra giá
scaler.last_price_usd_ = float(close_prices[-1])`}</CodeBlock>
      </SectionCard>

      <SectionCard>
        <SectionTitle>Cửa sổ trượt: cắt chuỗi dài thành các mẫu (60 → 7)</SectionTitle>
        <BodyText>
          LSTM cần các mẫu có dạng "60 ngày quá khứ → 7 ngày tương lai". Ta trượt một cửa sổ dọc theo chuỗi: mỗi vị
          trí lấy 60 ngày làm <strong style={{ color: 'var(--text-primary)' }}>input <TeX>{String.raw`X`}</TeX></strong>{' '}
          và 7 ngày kế tiếp (chỉ cột log-return, feature 0) làm{' '}
          <strong style={{ color: 'var(--text-primary)' }}>mục tiêu <TeX>{String.raw`y`}</TeX></strong>.
        </BodyText>
        <CodeBlock lang="python">{`# src/ml/preprocess.py — _create_sequences()
for i in range(seq_len, n - horizon + 1):
    X.append(scaled[i - seq_len : i])      # (60, 9)  — 60 ngày quá khứ
    y.append(scaled[i : i + horizon, 0])   # (7,)     — log-return 7 ngày tới
# → X: (M, 60, 9)   y: (M, 7)`}</CodeBlock>
        <Callout variant="info">
          <strong>Sao chỉ lấy cột 0 làm target?</strong> Vì ta chỉ cần dự đoán <em>log-return</em> (cột 0). Từ chuỗi
          log-return dự đoán được, công thức <TeX>{String.raw`\text{price}_k = \text{price}_0 \cdot e^{\sum \text{log-ret}}`}</TeX>{' '}
          sẽ dựng lại giá USD (xem tab "Suy luận"). 8 feature còn lại chỉ là <em>ngữ cảnh đầu vào</em>, không phải thứ cần đoán.
        </Callout>
      </SectionCard>
    </div>
  );
}

/* ── 3. MÔ HÌNH ───────────────────────────────────────────────────────────── */

function ModelSection() {
  return (
    <div>
      <SectionCard>
        <SectionTitle accent="#A78BFA">Kiến trúc: 1 thân LSTM, 2 cái đầu</SectionTitle>
        <BodyText>
          Mô hình gồm một <strong style={{ color: 'var(--text-primary)' }}>thân LSTM 2 lớp (hidden = 128)</strong> đóng
          vai trò "đọc hiểu" 60 ngày, rồi nén toàn bộ ngữ cảnh vào{' '}
          <strong style={{ color: 'var(--text-primary)' }}>hidden state ở bước cuối <TeX>{String.raw`h_T`}</TeX></strong>{' '}
          (một vector 128 chiều). Từ <TeX>{String.raw`h_T`}</TeX> ta gắn 2 "đầu" (head) dự đoán song song:
        </BodyText>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
          {[
            { c: '#5C8AFF', t: 'Price Head', d: 'Đoán log-return cho cả horizon. Không chặn dấu (giá lên hoặc xuống đều được).' },
            { c: '#F59E0B', t: 'Volatility Head', d: 'Đoán độ biến động mỗi ngày. Có Softplus ở cuối nên kết quả luôn > 0.' },
          ].map(x => (
            <div key={x.t} style={{
              background: `color-mix(in srgb, ${x.c} 6%, var(--bg-card))`,
              border: `1px solid color-mix(in srgb, ${x.c} 22%, var(--border))`,
              borderTop: `3px solid ${x.c}`, borderRadius: '8px', padding: '14px',
            }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)', marginBottom: '6px' }}>{x.t}</div>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{x.d}</div>
            </div>
          ))}
        </div>
        <BodyText>
          Điểm hay: <Mono>nn.LSTM</Mono> đã gói sẵn toàn bộ cơ chế cổng (forget/input/output) — ta không phải tự cài.
          Việc của ta chỉ là <strong style={{ color: 'var(--text-primary)' }}>lấy đúng <TeX>{String.raw`h_T`}</TeX></strong>{' '}
          rồi nối hai đầu dự đoán vào.
        </BodyText>
      </SectionCard>

      <SectionCard>
        <SectionTitle>Định nghĩa mô hình — code thật</SectionTitle>
        <CodeBlock lang="python">{`# src/ml/model.py — LSTMModel.__init__
self.lstm = nn.LSTM(
    input_size=9, hidden_size=128, num_layers=2,
    batch_first=True,      # x: (batch, seq_len, features)
    dropout=0.2,           # dropout GIỮA 2 lớp LSTM
)

# Price Head: 128 → 64 → output_size (= horizon 7/15/60)
self.fc = nn.Sequential(
    nn.Linear(128, 64), nn.ReLU(), nn.Dropout(0.1),
    nn.Linear(64, output_size),
)

# Volatility Head: kết thúc bằng Softplus → vol luôn > 0
self.vol_head = nn.Sequential(
    nn.Linear(128, 64), nn.ReLU(), nn.Dropout(0.1),
    nn.Linear(64, output_size), nn.Softplus(),
)`}</CodeBlock>

        <SubTitle>Forward pass: chỗ lấy <TeX>{String.raw`h_T`}</TeX></SubTitle>
        <CodeBlock lang="python">{`# src/ml/model.py — LSTMModel.forward
def forward(self, x):                  # x: (batch, 60, 9)
    lstm_out, _ = self.lstm(x)         # (batch, 60, 128)
    last_hidden = lstm_out[:, -1, :]   # (batch, 128) — trí nhớ ở NGÀY CUỐI
    price_preds = self.fc(last_hidden)         # (batch, 7) — log-return
    vol_preds   = self.vol_head(last_hidden)   # (batch, 7) — độ biến động > 0
    return price_preds, vol_preds`}</CodeBlock>
        <Callout variant="info">
          <strong><Mono>lstm_out[:, -1, :]</Mono> chính là lý thuyết.</strong> Đây đúng là{' '}
          <TeX>{String.raw`h_T`}</TeX> trong các công thức LSTM — hidden state sau khi đã "đọc" hết 60 ngày. Cả 60
          ngày ngữ cảnh được cô đọng vào 128 con số này, rồi hai head đọc nó để đoán.
        </Callout>
      </SectionCard>

      <SectionCard>
        <SectionTitle>Bảng tham số (model H7)</SectionTitle>
        <DataTable
          headers={['Thành phần', 'Cấu hình', 'Tham số']}
          rows={[
            ['LSTM Layer 1', 'input 9 → hidden 128', '70.656'],
            ['LSTM Layer 2', 'input 128 → hidden 128', '131.584'],
            ['Price Head', 'Linear(128→64)→ReLU→Dropout→Linear(64→7)', '8.711'],
            ['Volatility Head', '… → Linear(64→7) → Softplus', '8.711'],
            [<strong>TỔNG</strong>, '—', <strong>219.662</strong>],
          ]}
        />
      </SectionCard>
    </div>
  );
}

/* ── 4. HUẤN LUYỆN ────────────────────────────────────────────────────────── */

function TrainingSection() {
  return (
    <div>
      <SectionCard>
        <SectionTitle accent="#F97316">Hàm mất mát: phạt nặng khi đoán SAI CHIỀU</SectionTitle>
        <BodyText>
          Với một trader, <strong style={{ color: 'var(--text-primary)' }}>đoán sai chiều (nói lên mà thực tế xuống)
          tệ hơn nhiều</strong> so với lệch vài %. Vì vậy ta không dùng loss thường mà dùng{' '}
          <strong style={{ color: 'var(--text-primary)' }}>Direction-weighted Huber</strong>: bắt đầu từ HuberLoss
          (bền với outlier), rồi <em>nhân thêm trọng số</em> cho những mẫu mà mô hình đoán <strong style={{ color: 'var(--text-primary)' }}>ngược dấu</strong> với thực tế.
        </BodyText>
        <CodeBlock lang="python">{`# src/ml/train_lstm.py — _direction_weighted_huber
base = F.huber_loss(pred, target, reduction="none", delta=delta)
direction_correct = (pred.sign() == target.sign()).float()
weight = 1.0 + (1.0 - direction_correct) * penalty_factor  # sai chiều → phạt nặng hơn
return (base * weight).mean()`}</CodeBlock>
        <BodyText>
          Diễn giải: nếu dấu dự đoán <em>trùng</em> dấu thực tế thì <Mono>weight = 1</Mono> (lỗi tính bình thường);
          nếu <em>ngược</em> dấu, <Mono>weight = 1 + penalty</Mono> → lỗi bị phóng đại, ép mô hình ưu tiên đoán đúng hướng.
        </BodyText>
      </SectionCard>

      <SectionCard>
        <SectionTitle>Vì sao Huber, không phải MSE?</SectionTitle>
        <Callout variant="warning">
          MSE bình phương lỗi → một cú pump/crash bất thường tạo lỗi khổng lồ, kéo cả mô hình chạy theo. HuberLoss xử
          nhẹ nhàng hơn: lỗi nhỏ thì bình phương (mượt), lỗi lớn (<TeX>{String.raw`|e| > \delta`}</TeX>) chuyển sang
          tuyến tính → bền (robust) trước outlier. Crypto đầy outlier (kurtosis BTC 11, DOGE 77) nên rất hợp.
        </Callout>
        <CodeBlock lang="python">{`# src/ml/train_lstm.py — setup
price_criterion = nn.HuberLoss(delta=1.0)
optimizer = torch.optim.Adam(
    model.parameters(), lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY,
)`}</CodeBlock>
      </SectionCard>

      <SectionCard>
        <SectionTitle>Ánh xạ lý thuyết → cài đặt</SectionTitle>
        <BodyText>Mỗi khái niệm trong lý thuyết LSTM tương ứng một dòng code cụ thể trong dự án:</BodyText>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px' }}>
          <MapRow theory={<>Hidden state cuối <TeX>{String.raw`h_T`}</TeX> (cô đọng 60 ngày)</>} code={<Mono>lstm_out[:, -1, :]</Mono>} />
          <MapRow theory="3 cổng forget / input / output" code={<Mono>nn.LSTM(...)</Mono>} />
          <MapRow theory="Stacked LSTM 2 lớp (ngắn → dài hạn)" code={<Mono>num_layers=2</Mono>} />
          <MapRow theory={<>Dự báo cả horizon 1 lần (MIMO)</>} code={<Mono>Linear(64, output_size)</Mono>} />
          <MapRow theory="Độ biến động luôn dương" code={<Mono>nn.Softplus()</Mono>} />
          <MapRow theory="Loss bền với outlier" code={<Mono>nn.HuberLoss(delta=1.0)</Mono>} />
        </div>
      </SectionCard>
    </div>
  );
}

/* ── 5. SUY LUẬN ──────────────────────────────────────────────────────────── */

function InferenceSection() {
  return (
    <div>
      <SectionCard>
        <SectionTitle accent="#5C8AFF">Dự báo cả chuỗi trong MỘT lần chạy (MIMO)</SectionTitle>
        <BodyText>
          Khi suy luận, ta lấy 60 ngày gần nhất (đã chuẩn hoá) làm "hạt giống" (seed), đưa qua mô hình{' '}
          <strong style={{ color: 'var(--text-primary)' }}>một lần duy nhất</strong>, và nhận về cả 7 (hoặc 15/60)
          bước log-return cùng lúc. Cách này tránh "đoán t+1 rồi nạp lại để đoán t+2" — vốn khuếch đại lỗi với crypto biến động mạnh.
        </BodyText>
        <CodeBlock lang="python">{`# src/ml/inference.py — _mimo_predict
x = torch.tensor(seed_features[np.newaxis, :, :], dtype=torch.float32)  # (1, 60, 9)
result = model(x)
log_rets_norm = result[0].squeeze(0).cpu().numpy()   # (7,) — đã chuẩn hoá`}</CodeBlock>
      </SectionCard>

      <SectionCard>
        <SectionTitle>Đảo ngược: từ log-return chuẩn hoá → giá USD</SectionTitle>
        <BodyText>
          Mô hình xuất ra log-return <em>đã chuẩn hoá</em>. Hai bước để ra giá thật: (1) đảo chuẩn hoá feature-0 bằng
          chính <Mono>scale_</Mono> và <Mono>mean_</Mono> của scaler; (2) cộng dồn log-return rồi mũ hoá để dựng lại giá.
        </BodyText>
        <CodeBlock lang="python">{`# src/ml/inference.py — _mimo_predict (tiếp)
# (1) Đưa feature-0 (log_return) về thang gốc:  norm * scale + mean
log_rets = log_rets_norm * scaler.scale_[0] + scaler.mean_[0]

# (2) Dựng lại giá USD:  price[k] = last_price * exp(cumsum(log_rets)[k])
prices_usd = last_price_usd * np.exp(np.cumsum(log_rets))`}</CodeBlock>
        <EqBlock
          equations={[
            { tex: String.raw`\text{price}_k = \text{price}_{\text{last}} \cdot \exp\!\Big(\sum_{j=0}^{k} r_j\Big)`,
              note: <>cộng dồn (cumsum) log-return <TeX>{String.raw`r_j`}</TeX> rồi mũ hoá → giá ngày thứ k</> },
          ]}
        />
        <Callout variant="info">
          Đây chính là lý do <strong style={{ color: 'var(--text-primary)' }}>feature 0 bắt buộc là log-return</strong>{' '}
          (tab "Dữ liệu"): ta cần biết đúng <Mono>scale_[0]</Mono> / <Mono>mean_[0]</Mono> để đảo ngược về giá USD.
        </Callout>
      </SectionCard>

      <SectionCard>
        <SectionTitle>Lịch chạy suy luận trong dự án</SectionTitle>
        <DataTable
          headers={['Vòng lặp', 'Tần suất', 'Làm gì']}
          rows={[
            ['Inference hằng ngày', '1 lần/ngày UTC (+ 1 lần lúc khởi động)', 'Đọc lịch sử → đoán H7/H15/H60 → upsert vào collection predictions'],
            ['Vòng 5 phút', 'mỗi 5 phút', 'Chỉ refresh live_prices cho frontend realtime + phục vụ request predict/retrain on-demand'],
          ]}
        />
        <BodyText style={{ margin: '8px 0 0' }}>
          Khoá upsert của collection <Mono>predictions</Mono>: <Mono>(coin, prediction_date, horizon, model_id)</Mono>.
          Artifact lưu dạng <Mono>lstm_{'{coin}'}_h7_v3.pt</Mono> + <Mono>scaler_{'{coin}'}_h7_v3.pkl</Mono>.
        </BodyText>
      </SectionCard>
    </div>
  );
}

/* ── 6. KẾT QUẢ ───────────────────────────────────────────────────────────── */

function ResultsSection() {
  return (
    <div>
      <SectionCard>
        <SectionTitle accent="#22C55E">Đánh giá đúng cách: Walk-Forward</SectionTitle>
        <BodyText>
          Với chuỗi thời gian, <strong style={{ color: 'var(--text-primary)' }}>tuyệt đối không xáo trộn (shuffle)
          dữ liệu</strong> — vì sẽ "nhìn trộm tương lai" (temporal leakage) và cho điểm số đẹp giả. Thay vào đó dùng
          Walk-Forward: luôn train trên quá khứ, kiểm tra trên đoạn tương lai liền sau.
        </BodyText>
        <CodeBlock lang="text">{`Walk-Forward, cửa sổ trượt 730 ngày:
  Fold 1: Train [t0, t0+730)  →  Validate [t0+730, t0+790)
  Fold 2: Train [t1, t1+730)  →  Validate [t1+730, t1+790)
  ...trượt 60 ngày mỗi fold — KHÔNG có temporal leakage`}</CodeBlock>
        <DataTable
          headers={['Phương pháp', 'Directional Accuracy', 'Ghi chú']}
          rows={[
            ['Walk-forward (6 folds)', '49,4% (trung bình)', 'Thực tế — gộp cả bull/bear/sideways'],
            ['Backtest 6 tháng unseen', '61,1% (H7)', 'Giai đoạn có xu hướng rõ ràng'],
            ['Random baseline', '50,0%', 'Mốc tung đồng xu'],
            ['K-Fold có shuffle', '~65–70%', 'KHÔNG đáng tin — temporal leakage'],
          ]}
        />
        <Callout variant="success">
          <strong>Vì sao MIMO ăn đứt Autoregressive ở đây?</strong> Mô hình đoán cả 7 bước cùng lúc từ{' '}
          <TeX>{String.raw`h_T`}</TeX> (một forward pass) → lỗi không tích lũy. Cách autoregressive (đoán t+1 rồi nạp
          lại để đoán t+2) sẽ nhân lỗi lên với crypto biến động mạnh.
        </Callout>
      </SectionCard>

      <SectionCard>
        <SectionTitle>Bằng chứng từ tài liệu khoa học</SectionTitle>
        <BodyText>
          Fischer &amp; Krauss (2018)<Cite n={2} /> dùng LSTM dự báo chiều biến động cổ phiếu S&amp;P 500 (1992–2015),
          đạt directional accuracy ~56% và vượt Random Forest, mạng feed-forward sâu, hồi quy logistic. Siami-Namini
          et al. (2018)<Cite n={3} /> báo cáo LSTM giảm RMSE ~84–87% so với ARIMA trên chuỗi kinh tế - tài chính. Kết
          quả ~61% (H7) của dự án nằm trong vùng hợp lý cho bài toán khó này.
        </BodyText>
      </SectionCard>
    </div>
  );
}

/* ── 7. TÀI LIỆU ──────────────────────────────────────────────────────────── */

function ReferencesSection() {
  const refs = [
    { n: 1, citation: 'Hochreiter, S., & Schmidhuber, J. (1997). Long short-term memory. Neural Computation, 9(8), 1735–1780.', doi: 'https://doi.org/10.1162/neco.1997.9.8.1735', type: 'Journal' },
    { n: 2, citation: 'Fischer, T., & Krauss, C. (2018). Deep learning with long short-term memory networks for financial market predictions. European Journal of Operational Research, 270(2), 654–669.', doi: 'https://doi.org/10.1016/j.ejor.2017.11.054', type: 'Journal' },
    { n: 3, citation: 'Siami-Namini, S., Tavakoli, N., & Namin, A. S. (2018). A comparison of ARIMA and LSTM in forecasting time series. 17th IEEE ICMLA.', doi: 'https://doi.org/10.1109/ICMLA.2018.00227', type: 'Conference' },
    { n: 4, citation: 'Olah, C. (2015). Understanding LSTM Networks. Colah\'s Blog.', doi: 'https://colah.github.io/posts/2015-08-Understanding-LSTMs/', type: 'Blog' },
    { n: 5, citation: 'Goodfellow, I., Bengio, Y., & Courville, A. (2016). Deep Learning. MIT Press. Ch. 10.', doi: 'https://www.deeplearningbook.org/', type: 'Book' },
  ];
  const typeColor: Record<string, string> = {
    Journal: 'var(--accent-light)', Conference: 'var(--warn)', Blog: '#22C55E', Book: '#A78BFA',
  };
  return (
    <div>
      <SectionCard>
        <SectionTitle>Tài liệu tham khảo</SectionTitle>
        <BodyText style={{ marginBottom: '16px' }}>
          Phần lý thuyết LSTM đầy đủ (trực giác, công thức từng ký hiệu, các biến thể) nằm ở trang{' '}
          <strong style={{ color: 'var(--text-primary)' }}>"LSTM — Long Short-Term Memory"</strong> trong mục Docs.
          Trang ứng dụng này dẫn các nguồn liên quan trực tiếp tới cách dùng:
        </BodyText>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {refs.map(ref => (
            <div key={ref.n} style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: '9px', padding: '14px 16px', display: 'flex', gap: '12px', alignItems: 'flex-start',
            }}>
              <div style={{
                width: '26px', height: '26px', borderRadius: '6px',
                background: 'var(--accent-muted)', border: '1px solid rgba(99,102,241,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '11px', color: 'var(--accent-light)', fontWeight: 700 }}>{ref.n}</span>
              </div>
              <div style={{ flex: 1 }}>
                <span style={{
                  fontFamily: 'IBM Plex Mono', fontSize: '9px', fontWeight: 600,
                  color: typeColor[ref.type] ?? 'var(--text-muted)', padding: '2px 7px', borderRadius: '4px',
                  background: `color-mix(in srgb, ${typeColor[ref.type] ?? 'gray'} 12%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${typeColor[ref.type] ?? 'gray'} 25%, transparent)`,
                }}>{ref.type.toUpperCase()}</span>
                <p style={{ margin: '6px 0 6px', fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans', lineHeight: 1.6 }}>
                  {ref.citation}
                </p>
                <a href={ref.doi} target="_blank" rel="noopener noreferrer" style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  fontFamily: 'IBM Plex Mono', fontSize: '10px', color: 'var(--accent-light)', textDecoration: 'none',
                }}>
                  <ExternalLink size={10} />{ref.doi}
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
            Code minh hoạ trích trực tiếp từ <strong style={{ color: 'var(--text-secondary)' }}>src/ml/</strong>{' '}
            (model.py, preprocess.py, train_lstm.py, inference.py) — môn <strong style={{ color: 'var(--text-secondary)' }}>CS315.F21.CN2 — Advanced Machine Learning</strong>.
          </span>
        </div>
      </SectionCard>
    </div>
  );
}

/* ── Main page component ────────────────────────────────────────────────────── */

export default function LSTMResearchPage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  return (
    <div>
      <div style={{ marginBottom: '26px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
          <Boxes size={19} color="var(--accent-light)" />
          <h1 className="font-display" style={{ margin: 0, fontSize: '22px', color: 'var(--text-primary)' }}>
            LSTM — Ứng dụng vào dự án
          </h1>
          <span style={{
            fontFamily: 'IBM Plex Mono', fontSize: '9px', fontWeight: 600,
            padding: '3px 8px', borderRadius: '5px',
            background: 'var(--purple-subtle)', border: '1px solid rgba(167,139,250,0.2)', color: 'var(--purple)',
          }}>
            APPLIED
          </span>
        </div>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
          Cách dự án dùng LSTM để dự đoán giá BTC / DOGE · code thật từ src/ml/ · CS315.F21.CN2
        </p>
      </div>

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

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
        >
          {activeTab === 'overview'   && <OverviewSection />}
          {activeTab === 'data'       && <DataSection />}
          {activeTab === 'model'      && <ModelSection />}
          {activeTab === 'training'   && <TrainingSection />}
          {activeTab === 'inference'  && <InferenceSection />}
          {activeTab === 'results'    && <ResultsSection />}
          {activeTab === 'references' && <ReferencesSection />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
