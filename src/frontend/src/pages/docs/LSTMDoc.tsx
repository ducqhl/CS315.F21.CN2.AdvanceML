import { motion } from 'framer-motion';
import {
  PageHeader, SectionCard, SectionTitle, BodyText, Callout,
  CodeBlock, DataTable, FlowDiagram, MathBlock, EqBlock, TeX, Mono, SpecRow, SubTitle, Tag,
} from './shared';

/* ── Colah's blog image URLs (used with attribution) ────────────────────── */
const COLAH = 'https://colah.github.io/posts/2015-08-Understanding-LSTMs/img';

function BlogImage({
  file, alt, caption, small,
}: {
  file: string;
  alt: string;
  caption?: string;
  small?: boolean;
}) {
  return (
    <figure style={{ margin: '14px 0', textAlign: 'center' }}>
      <img
        src={`${COLAH}/${file}`}
        alt={alt}
        style={{
          maxWidth: small ? '480px' : '100%',
          width: '100%',
          borderRadius: '8px',
          border: '1px solid var(--border)',
          background: '#fff',
          padding: '10px',
          display: 'block',
          margin: '0 auto',
        }}
      />
      {caption && (
        <figcaption style={{
          marginTop: '7px',
          fontSize: '11.5px',
          color: 'var(--text-muted)',
          fontFamily: 'Plus Jakarta Sans',
          fontStyle: 'italic',
          lineHeight: 1.6,
        }}>
          {caption}{' '}
          <a
            href="https://colah.github.io/posts/2015-08-Understanding-LSTMs/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent-light)', textDecoration: 'none' }}
          >
            [nguồn: Colah, 2015]
          </a>
        </figcaption>
      )}
    </figure>
  );
}

function SourceCredit() {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '10px',
      padding: '12px 16px',
      background: 'color-mix(in srgb, #a78bfa 8%, transparent)',
      border: '1px solid color-mix(in srgb, #a78bfa 22%, transparent)',
      borderRadius: '8px', marginBottom: '20px',
    }}>
      <span style={{ fontSize: '15px', flexShrink: 0 }}>📚</span>
      <p style={{ margin: 0, fontSize: '12.5px', lineHeight: 1.7, color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans' }}>
        Phần lý thuyết và hình ảnh kiến trúc LSTM trong tài liệu này được giải thích lại (bằng ngôn ngữ dễ hiểu cho người mới) dựa trên bài viết kinh điển:{' '}
        <a
          href="https://colah.github.io/posts/2015-08-Understanding-LSTMs/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#a78bfa', fontWeight: 600 }}
        >
          Christopher Olah, "Understanding LSTM Networks", 2015
        </a>
        {' '}— được trích dẫn hơn 10.000 lần trong cộng đồng Deep Learning. Mọi câu chữ đều cố gắng diễn giải lại ý của tác giả, kèm chú thích từng ký hiệu trong công thức. Hình ảnh thuộc bản quyền của tác giả.
      </p>
    </div>
  );
}

/* Hộp giải thích ký hiệu — đặt trước các công thức để người mới đọc được */
function NotationKey() {
  return (
    <div style={{
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      borderRadius: '8px', padding: '14px 18px', margin: '10px 0',
    }}>
      <div style={{
        fontFamily: 'IBM Plex Mono', fontSize: '10px', color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px',
      }}>
        Bảng tra ký hiệu — đọc trước khi xem công thức
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', alignItems: 'baseline' }}>
        {[
          [<TeX>{String.raw`x_t`}</TeX>, 'Đầu vào (input) tại thời điểm t. Trong dự án: vector 9 con số mô tả thị trường của ngày t.'],
          [<TeX>{String.raw`h_t`}</TeX>, 'Hidden state — "trí nhớ ngắn hạn" / đầu ra của ô LSTM tại bước t. Cũng là thứ truyền sang bước t+1.'],
          [<TeX>{String.raw`C_t`}</TeX>, 'Cell state — "trí nhớ dài hạn", băng chuyền chạy xuyên suốt chuỗi.'],
          [<TeX>{String.raw`t`}</TeX>, 'Chỉ số thời gian (bước hiện tại). t−1 là bước ngay trước đó.'],
          [<TeX>{String.raw`W,\ b`}</TeX>, 'Ma trận trọng số (W) và độ lệch (b) — các con số mà mô hình tự học trong lúc training.'],
          [<TeX>{String.raw`\sigma`}</TeX>, 'Hàm sigmoid: bóp mọi số về khoảng (0, 1). Dùng làm "van" mở/đóng.'],
          [<TeX>{String.raw`\tanh`}</TeX>, 'Hàm tanh: bóp mọi số về khoảng (−1, 1). Tạo ra giá trị mới có cả âm lẫn dương.'],
          [<TeX>{String.raw`\odot`}</TeX>, 'Nhân từng phần tử (element-wise): nhân số ở vị trí i của vector này với số ở vị trí i của vector kia.'],
          [<TeX>{String.raw`[h_{t-1},\, x_t]`}</TeX>, 'Ghép (nối) hai vector "trí nhớ trước" và "input hiện tại" thành một vector dài hơn rồi đưa vào lớp tính toán.'],
        ].map(([sym, desc], i) => (
          <div key={i} style={{ display: 'contents' }}>
            <div style={{ fontSize: '13px' }}>{sym}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans', lineHeight: 1.55 }}>{desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════════════════════ */

export default function LSTMDoc() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <PageHeader
        title="LSTM — Long Short-Term Memory"
        subtitle="Giải thích từ số 0 · Trực giác · Công thức từng ký hiệu · Cài đặt trong dự án"
        badge="06"
        badgeColor="#A78BFA"
      />

      <SpecRow items={[
        { label: 'Giới thiệu', value: '1997', color: '#A78BFA' },
        { label: 'Tác giả', value: 'Hochreiter & Schmidhuber', color: '#A78BFA' },
        { label: 'Hidden units (dự án)', value: '128', color: '#22C55E' },
        { label: 'LSTM layers (dự án)', value: '2', color: '#22C55E' },
        { label: 'Seq len (H7/H15/H60)', value: '60/90/120 ngày', color: '#22C55E' },
        { label: 'Dir. accuracy (BTC H7)', value: '61.1% (backtest)', color: '#F59E0B' },
      ]} />

      <SourceCredit />

      {/* ── 0. Bắt đầu từ con số 0 ──────────────────────────────────────── */}
      <SectionCard>
        <SectionTitle accent="#5C8AFF">0. Trước hết: tại sao cần một mạng "có trí nhớ"?</SectionTitle>
        <BodyText>
          Hãy bắt đầu từ thứ quen thuộc nhất: <strong style={{ color: 'var(--text-primary)' }}>khi bạn đọc câu này, bạn không quên sạch mọi từ phía trước</strong>. Bạn hiểu mỗi từ mới dựa trên những từ đã đọc — suy nghĩ của bạn có <em>tính liên tục</em>. Như Olah viết: "con người không bắt đầu suy nghĩ lại từ đầu mỗi giây".
        </BodyText>
        <BodyText>
          Một mạng nơ-ron thông thường (feed-forward) thì không như vậy: mỗi lần bạn đưa một input vào, nó xử lý độc lập và <strong style={{ color: 'var(--text-primary)' }}>không nhớ gì về input trước đó</strong>. Điều này ổn với ảnh tĩnh, nhưng tệ với <em>dữ liệu chuỗi</em> — như văn bản, giọng nói, hay giá Bitcoin theo ngày — nơi thứ tự và quá khứ là tất cả.
        </BodyText>
        <Callout variant="info">
          <strong>Dữ liệu chuỗi (sequence) là gì?</strong> Là một dãy các quan sát có thứ tự thời gian:{' '}
          <TeX>{String.raw`x_1, x_2, x_3, \dots, x_t`}</TeX>. Trong dự án của chúng ta, mỗi <TeX>{String.raw`x_t`}</TeX> là "bức ảnh thị trường" của một ngày (giá, khối lượng, các chỉ báo kỹ thuật...), và mục tiêu là dùng 60 ngày quá khứ để đoán nhiều ngày tương lai (3 horizon: 7 / 15 / 60 ngày, mỗi horizon một model riêng).
        </Callout>

        <Callout variant="success">
          <strong>Trực giác đời thường (để bám theo suốt bài):</strong> hãy hình dung LSTM như một người{' '}
          <em>ghi sổ tay</em> khi đọc tin tức thị trường mỗi ngày. Cuốn sổ (<strong>Cell State</strong>) lưu những
          điều quan trọng cần nhớ lâu. Mỗi ngày, người này làm 3 việc: <strong>gạch bỏ</strong> ghi chú đã lỗi thời
          (cổng <em>quên</em>), <strong>viết thêm</strong> điều mới đáng nhớ (cổng <em>ghi</em>), và{' '}
          <strong>chọn vài dòng</strong> để nói ra lúc này (cổng <em>xuất</em>). Ba việc đó đúng là ba cổng của LSTM —
          phần còn lại của trang chỉ là viết ba việc này thành công thức.
        </Callout>
      </SectionCard>

      {/* ── 1. RNN và vấn đề của nó ─────────────────────────────────────── */}
      <SectionCard>
        <SectionTitle>1. RNN — mạng có vòng lặp, và vì sao nó "quên" quá khứ</SectionTitle>
        <BodyText>
          <strong style={{ color: 'var(--text-primary)' }}>Recurrent Neural Network (RNN)</strong> giải quyết vấn đề trí nhớ bằng một ý tưởng đơn giản: thêm một <em>vòng lặp</em>. Tại mỗi bước, mạng nhận input mới <TeX>{String.raw`x_t`}</TeX> <strong style={{ color: 'var(--text-primary)' }}>và</strong> cả "trí nhớ" của chính nó từ bước trước (<TeX>{String.raw`h_{t-1}`}</TeX>), trộn lại, rồi sinh ra trí nhớ mới <TeX>{String.raw`h_t`}</TeX> để chuyển cho bước sau. Vòng lặp này "cho phép thông tin được truyền tiếp từ bước này sang bước kế tiếp".
        </BodyText>

        <BlogImage
          file="RNN-unrolled.png"
          alt="Simple RNN unrolled"
          caption="RNN được 'trải phẳng' (unroll) theo thời gian. Cùng một khối A lặp lại nhiều lần — mỗi bản sao nhận một input x_t và truyền trí nhớ h_t cho bản sao kế tiếp. Đây chính là 'nhiều bản sao của cùng một mạng, mỗi bản gửi một thông điệp cho bản sau'."
        />

        <BodyText>
          Mẹo để hiểu: hãy hình dung "trải" vòng lặp ra thành một dãy dài như hình trên. Lúc này RNN trông như <strong style={{ color: 'var(--text-primary)' }}>nhiều bản sao của cùng một mạng nối đuôi nhau</strong> — rất hợp với dữ liệu chuỗi.
        </BodyText>

        <SubTitle>Vấn đề: phụ thuộc xa (long-term dependency)</SubTitle>
        <BodyText>
          Khi thông tin cần thiết nằm <em>gần</em>, RNN làm tốt. Ví dụ đoán từ cuối trong "<em>những đám mây trôi trên bầu ___</em>" → "trời": ngữ cảnh ngay sát đủ để đoán.
        </BodyText>
        <BodyText>
          Nhưng hãy đoán từ cuối trong "<em>Tôi lớn lên ở Pháp… tôi nói thành thạo tiếng ___</em>" → "Pháp". Manh mối ("ở Pháp") nằm <strong style={{ color: 'var(--text-primary)' }}>rất xa</strong> phía trước. Olah chỉ ra: "khi khoảng cách đó lớn dần, RNN trở nên không học nổi cách kết nối thông tin". Về lý thuyết RNN làm được, "nhưng trong thực tế thì không".
        </BodyText>

        <SubTitle>Vì sao RNN quên? — Vanishing Gradient, giải thích bằng lời</SubTitle>
        <BodyText>
          Mạng học bằng cách lan truyền "tín hiệu sửa lỗi" (gradient) ngược từ kết quả về quá khứ — gọi là <em>backpropagation through time</em>. Vấn đề: để đi ngược k bước, tín hiệu này bị <strong style={{ color: 'var(--text-primary)' }}>nhân với cùng một ma trận trọng số <TeX>{String.raw`W_h`}</TeX> lặp đi lặp lại k lần</strong>. Nhân một số nhỏ hơn 1 với chính nó nhiều lần → tiến nhanh về 0 (tín hiệu <em>biến mất</em>, vanishing); lớn hơn 1 → bùng nổ về vô cực (exploding). Cả hai đều khiến mạng không học được quá khứ xa.
        </BodyText>

        <NotationKey />

        <EqBlock
          title="Gradient lan truyền ngược qua k bước (BPTT)"
          equations={[
            {
              tex: String.raw`\frac{\partial L}{\partial h_{t-k}} = \frac{\partial L}{\partial h_t}\prod_{i=1}^{k} W_h\,\sigma'\!\left(W_h h_{t-i} + b\right)`,
              note: <>Đọc: "ảnh hưởng của trí nhớ xa <TeX>{String.raw`h_{t-k}`}</TeX> lên lỗi <TeX>{String.raw`L`}</TeX>" = tích của <strong>k</strong> lần nhân ma trận <TeX>{String.raw`W_h`}</TeX>. Dấu <TeX>{String.raw`\prod`}</TeX> nghĩa là "nhân liên tiếp".</>,
            },
            {
              tex: String.raw`\left\lVert \tfrac{\partial L}{\partial h_{t-k}} \right\rVert \to 0 \quad (k \to \infty)`,
              note: <>nếu trị riêng (eigenvalue) lớn nhất của <TeX>{String.raw`W_h < 1`}</TeX> → tín hiệu <strong>biến mất</strong> (vanishing): quá khứ xa bị bỏ quên.</>,
            },
            {
              tex: String.raw`\left\lVert \tfrac{\partial L}{\partial h_{t-k}} \right\rVert \to \infty \quad (k \to \infty)`,
              note: <>nếu trị riêng lớn nhất <TeX>{String.raw`> 1`}</TeX> → tín hiệu <strong>bùng nổ</strong> (exploding): training mất ổn định.</>,
            },
          ]}
        />

        <Callout variant="warning">
          <strong>Tại sao điều này nghiêm trọng với bài toán crypto?</strong> Để đoán giá Bitcoin ngày t+7, mô hình cần nhớ xu hướng từ 30–60 ngày trước. RNN thường chỉ "nhớ" được 5–10 bước — không đủ cho chuỗi thời gian tài chính. Đây chính là khoảng trống mà LSTM ra đời để lấp.
        </Callout>
      </SectionCard>

      {/* ── 2. Ý tưởng cốt lõi của LSTM ──────────────────────────────────── */}
      <SectionCard>
        <SectionTitle accent="#A78BFA">2. Ý tưởng cốt lõi của LSTM — "băng chuyền trí nhớ" và các van</SectionTitle>
        <BodyText>
          LSTM (Long Short-Term Memory), do Hochreiter & Schmidhuber đề xuất năm 1997, được thiết kế <em>đặc biệt</em> để nhớ lâu. Bí quyết nằm ở <strong style={{ color: 'var(--text-primary)' }}>Cell State <TeX>{String.raw`C_t`}</TeX></strong> — đường kẻ ngang chạy thẳng qua đỉnh mỗi ô.
        </BodyText>

        <BlogImage
          file="LSTM3-chain.png"
          alt="LSTM chain architecture"
          caption="Bên trong một ô LSTM có 4 lớp tương tác với nhau (3 van sigmoid + 1 lớp tanh tạo giá trị mới), trong khi RNN thường chỉ có 1 lớp tanh đơn giản."
        />

        <BodyText>
          Olah ví Cell State như một <strong style={{ color: 'var(--text-primary)' }}>"băng chuyền" (conveyor belt)</strong>: thông tin chạy thẳng dọc theo nó, chỉ qua vài phép cộng và nhân nhỏ, nên "có thể trôi đi gần như không đổi". Đây chính là "đường cao tốc gradient" giúp tín hiệu lan truyền ngược qua hàng chục bước mà không bị biến mất.
        </BodyText>

        <BlogImage
          file="LSTM3-C-line.png"
          alt="LSTM cell state highway"
          caption="Cell State C_t — 'băng chuyền'. Thông tin chạy thẳng qua chuỗi, chỉ bị chỉnh sửa nhẹ bởi các phép toán nhỏ ở mỗi bước."
          small
        />

        <BodyText>
          Nhưng nếu trí nhớ chỉ chạy thẳng thì làm sao thêm/xóa thông tin? LSTM kiểm soát băng chuyền bằng các <strong style={{ color: 'var(--text-primary)' }}>cổng (gate)</strong>. Mỗi cổng là một <em>van</em>: một lớp sigmoid + một phép nhân từng phần tử.
        </BodyText>

        <Callout variant="info">
          <strong>Tại sao sigmoid lại là "van"?</strong> Hàm sigmoid <TeX>{String.raw`\sigma`}</TeX> luôn cho ra số trong khoảng <strong>(0, 1)</strong> — Olah mô tả nó "cho biết để bao nhiêu phần của mỗi thành phần được đi qua. Giá trị 0 nghĩa là 'không cho gì qua', giá trị 1 nghĩa là 'cho qua tất cả!'". Nhân vector trí nhớ với van này: chỗ nào van ≈ 0 thì thông tin bị chặn, chỗ nào ≈ 1 thì giữ nguyên. LSTM có <strong>3 van</strong> như vậy: Forget, Input, Output.
        </Callout>
      </SectionCard>

      {/* ── 3. Ba cổng — đi qua từng bước ────────────────────────────────── */}
      <SectionCard>
        <SectionTitle>3. Ba cổng của LSTM — đi qua từng bước với một ví dụ xuyên suốt</SectionTitle>
        <Callout variant="info">
          <strong>Ví dụ xuyên suốt (của Olah):</strong> tưởng tượng mô hình đang đọc câu để đoán từ tiếp theo. Cell State có thể đang lưu <em>giới tính của chủ ngữ hiện tại</em> để dùng đúng đại từ ("anh ấy" / "cô ấy"). Khi gặp một chủ ngữ mới, ta cần <strong>quên</strong> giới tính cũ và <strong>ghi</strong> giới tính mới. Mỗi cổng dưới đây tương ứng một bước của câu chuyện này.
        </Callout>

        <SubTitle>3.1. Forget Gate — Cổng Quên: "bỏ gì khỏi trí nhớ?"</SubTitle>
        <BodyText>
          Bước đầu: quyết định <strong style={{ color: 'var(--text-primary)' }}>thông tin nào trong Cell State cũ <TeX>{String.raw`C_{t-1}`}</TeX> cần vứt đi</strong>. Cổng quên "nhìn vào <TeX>{String.raw`h_{t-1}`}</TeX> và <TeX>{String.raw`x_t`}</TeX>, rồi xuất ra một số trong [0,1] cho mỗi con số trong <TeX>{String.raw`C_{t-1}`}</TeX>" — 1 là "giữ lại trọn vẹn", 0 là "vứt hoàn toàn". Trong ví dụ: khi thấy chủ ngữ mới, cổng này hạ van về 0 ở vị trí lưu giới tính cũ để quên nó.
        </BodyText>

        <BlogImage
          file="LSTM3-focus-f.png"
          alt="LSTM forget gate"
          caption="Forget Gate: một van sigmoid nhìn vào (h_{t-1}, x_t) và sinh ra f_t ∈ (0,1), chuẩn bị nhân vào C_{t-1}."
        />

        <EqBlock
          equations={[
            {
              tex: String.raw`f_t = \sigma\!\left(W_f \cdot [\,h_{t-1},\, x_t\,] + b_f\right)`,
              note: <>Ghép trí nhớ trước <TeX>{String.raw`h_{t-1}`}</TeX> với input <TeX>{String.raw`x_t`}</TeX>, nhân trọng số <TeX>{String.raw`W_f`}</TeX>, cộng lệch <TeX>{String.raw`b_f`}</TeX>, rồi bóp qua <TeX>{String.raw`\sigma`}</TeX> để ra van <TeX>{String.raw`f_t \in (0,1)`}</TeX>.</>,
            },
          ]}
        />
        <BodyText style={{ margin: '8px 0 0' }}>
          Cách đọc kết quả: <TeX>{String.raw`f_t \approx 0`}</TeX> → "xóa thông tin cũ"; <TeX>{String.raw`f_t \approx 1`}</TeX> → "giữ nguyên".
        </BodyText>

        <div style={{ height: '8px' }} />
        <SubTitle>3.2. Input Gate — Cổng Ghi: "thêm thông tin mới nào?"</SubTitle>
        <BodyText>
          Bước hai gồm <strong style={{ color: 'var(--text-primary)' }}>hai phần làm việc cùng nhau</strong>: (1) một van sigmoid <TeX>{String.raw`i_t`}</TeX> quyết định <em>vị trí nào</em> cần cập nhật; (2) một lớp tanh tạo ra <strong style={{ color: 'var(--text-primary)' }}>vector giá trị ứng viên mới <TeX>{String.raw`\tilde{C}_t`}</TeX></strong> (giá trị có thể được thêm vào). Trong ví dụ: đây là lúc ta chuẩn bị giới tính của chủ ngữ <em>mới</em> để thay cái vừa quên.
        </BodyText>

        <BlogImage
          file="LSTM3-focus-i.png"
          alt="LSTM input gate"
          caption="Input Gate: van i_t (chọn cập nhật ở đâu) và tanh C̃_t (giá trị mới) cùng quyết định thông tin nào được ghi vào Cell State."
        />

        <EqBlock
          equations={[
            {
              tex: String.raw`i_t = \sigma\!\left(W_i \cdot [\,h_{t-1},\, x_t\,] + b_i\right)`,
              note: <>van sigmoid → chọn <em>vị trí nào</em> được cập nhật (0 = bỏ qua, 1 = cập nhật mạnh).</>,
            },
            {
              tex: String.raw`\tilde{C}_t = \tanh\!\left(W_C \cdot [\,h_{t-1},\, x_t\,] + b_C\right)`,
              note: <>tanh → tạo vector giá trị mới trong (−1, 1). Có cả âm/dương nên có thể đẩy trí nhớ lên hoặc xuống.</>,
            },
            {
              tex: String.raw`C_t = \underbrace{f_t \odot C_{t-1}}_{\text{phần giữ lại}} + \underbrace{i_t \odot \tilde{C}_t}_{\text{phần ghi mới}}`,
              note: <>Cập nhật băng chuyền: <TeX>{String.raw`\odot`}</TeX> = nhân từng phần tử. "Quên cái cần quên, rồi cộng thêm cái mới đã chọn".</>,
            },
          ]}
        />

        <BlogImage
          file="LSTM3-focus-C.png"
          alt="LSTM cell state update"
          caption="Cập nhật Cell State: nhân trí nhớ cũ với van quên f_t, rồi cộng giá trị mới i_t ⊙ C̃_t. Đây đúng là bước 'bỏ giới tính cũ, ghi giới tính mới' trong ví dụ."
        />
        <BodyText style={{ margin: '8px 0 0' }}>
          Để ý: <TeX>{String.raw`C_t`}</TeX> được tạo <strong style={{ color: 'var(--text-primary)' }}>chỉ bằng phép nhân và cộng</strong> với <TeX>{String.raw`C_{t-1}`}</TeX> — không có phép biến đổi nặng. Chính điều này giữ cho gradient không bị biến mất (mục 1).
        </BodyText>

        <div style={{ height: '8px' }} />
        <SubTitle>3.3. Output Gate — Cổng Xuất: "xuất gì ra ngoài?"</SubTitle>
        <BodyText>
          Bước cuối: quyết định <strong style={{ color: 'var(--text-primary)' }}>phần nào của Cell State được đưa ra làm trí nhớ ngắn hạn <TeX>{String.raw`h_t`}</TeX></strong> (cũng là đầu ra của ô). Đầu ra "dựa trên Cell State nhưng là một phiên bản đã lọc": đẩy <TeX>{String.raw`C_t`}</TeX> qua tanh (về khoảng −1..1) rồi nhân với van <TeX>{String.raw`o_t`}</TeX>. Trong ví dụ: vừa thấy chủ ngữ, mô hình có thể xuất ra thông tin "số ít hay số nhiều" để phòng khi từ kế tiếp là động từ.
        </BodyText>

        <BlogImage
          file="LSTM3-focus-o.png"
          alt="LSTM output gate"
          caption="Output Gate: van o_t chọn phần nào của Cell State (sau khi qua tanh) được đưa ra thành hidden state h_t."
        />

        <EqBlock
          equations={[
            { tex: String.raw`o_t = \sigma\!\left(W_o \cdot [\,h_{t-1},\, x_t\,] + b_o\right)`, note: 'van xuất: chọn phần nào của trí nhớ được lộ ra ngoài.' },
            { tex: String.raw`h_t = o_t \odot \tanh(C_t)`, note: <>trí nhớ ngắn hạn / đầu ra: lọc <TeX>{String.raw`C_t`}</TeX> qua tanh rồi nhân van <TeX>{String.raw`o_t`}</TeX>.</> },
          ]}
        />

        <SubTitle>Tóm tắt: 6 phương trình cốt lõi (đây là toàn bộ LSTM)</SubTitle>
        <BodyText>
          Chỉ cần hiểu sáu dòng này là hiểu LSTM. Ba van (<TeX>{String.raw`f_t, i_t, o_t`}</TeX>) đều cùng dạng "ghép input → nhân trọng số → sigmoid"; khác nhau ở bộ trọng số riêng (<TeX>{String.raw`W_f, W_i, W_o`}</TeX>) mà mô hình tự học.
        </BodyText>
        <EqBlock
          equations={[
            { tex: String.raw`f_t = \sigma\!\left(W_f \cdot [\,h_{t-1},\, x_t\,] + b_f\right)`, note: 'Forget Gate — quên gì' },
            { tex: String.raw`i_t = \sigma\!\left(W_i \cdot [\,h_{t-1},\, x_t\,] + b_i\right)`, note: 'Input Gate — cập nhật ở đâu' },
            { tex: String.raw`\tilde{C}_t = \tanh\!\left(W_C \cdot [\,h_{t-1},\, x_t\,] + b_C\right)`, note: 'Giá trị ứng viên mới' },
            { tex: String.raw`o_t = \sigma\!\left(W_o \cdot [\,h_{t-1},\, x_t\,] + b_o\right)`, note: 'Output Gate — xuất gì' },
            { tex: String.raw`C_t = f_t \odot C_{t-1} + i_t \odot \tilde{C}_t`, note: 'Cập nhật trí nhớ dài hạn' },
            { tex: String.raw`h_t = o_t \odot \tanh(C_t)`, note: 'Trí nhớ ngắn hạn / đầu ra' },
          ]}
        />
      </SectionCard>

      {/* ── 4. Biến thể LSTM ─────────────────────────────────────────────── */}
      <SectionCard>
        <SectionTitle>4. Các biến thể phổ biến</SectionTitle>
        <BodyText>
          LSTM "chuẩn" ở trên chỉ là một trong nhiều phiên bản. Olah nhấn mạnh: dù khác nhau, các biến thể này khi so sánh "gần như ngang nhau" về hiệu quả. Ba biến thể đáng biết:
        </BodyText>

        <SubTitle>4.1. Peephole Connections — "lỗ nhìn trộm"</SubTitle>
        <BodyText>
          Do Gers & Schmidhuber (2000) giới thiệu: cho phép các van <strong style={{ color: 'var(--text-primary)' }}>nhìn trực tiếp vào Cell State</strong> chứ không chỉ <TeX>{String.raw`h_{t-1}`}</TeX>. Nhờ vậy van học được "thời điểm" (timing) chính xác hơn.
        </BodyText>
        <EqBlock
          equations={[
            { tex: String.raw`f_t = \sigma\!\left(W_f \cdot [\,C_{t-1},\, h_{t-1},\, x_t\,] + b_f\right)`, note: <>thêm <TeX>{String.raw`C_{t-1}`}</TeX> vào đầu vào của van</> },
            { tex: String.raw`i_t = \sigma\!\left(W_i \cdot [\,C_{t-1},\, h_{t-1},\, x_t\,] + b_i\right)`, note: <>nhìn <TeX>{String.raw`C_{t-1}`}</TeX></> },
            { tex: String.raw`o_t = \sigma\!\left(W_o \cdot [\,C_t,\, h_{t-1},\, x_t\,] + b_o\right)`, note: <>nhìn <TeX>{String.raw`C_t`}</TeX></> },
          ]}
        />

        <SubTitle>4.2. Coupled Forget/Input — quên và ghi đi đôi với nhau</SubTitle>
        <BodyText>
          Thay vì quyết định "quên gì" và "ghi gì" riêng rẽ, biến thể này <strong style={{ color: 'var(--text-primary)' }}>quyết định chung</strong>: "chỉ quên khi sắp ghi cái khác vào chỗ đó". Cụ thể, thay <TeX>{String.raw`i_t`}</TeX> bằng <TeX>{String.raw`(1 - f_t)`}</TeX>:
        </BodyText>
        <EqBlock
          equations={[
            { tex: String.raw`C_t = f_t \odot C_{t-1} + (1 - f_t) \odot \tilde{C}_t`, note: 'quên bao nhiêu thì ghi mới bấy nhiêu — một van duy nhất' },
          ]}
        />

        <SubTitle>4.3. GRU — Gated Recurrent Unit</SubTitle>
        <BodyText>
          GRU (Cho et al., 2014) là biến thể <strong style={{ color: 'var(--text-primary)' }}>đơn giản hóa mạnh</strong> và ngày càng phổ biến: gộp Forget Gate + Input Gate thành một <strong style={{ color: 'var(--text-primary)' }}>Update Gate <TeX>{String.raw`z_t`}</TeX></strong>, và <strong style={{ color: 'var(--text-primary)' }}>bỏ luôn Cell State riêng</strong> (gộp <TeX>{String.raw`C_t`}</TeX> và <TeX>{String.raw`h_t`}</TeX> làm một). Ít tham số hơn nhưng nhiều bài toán cho kết quả tương đương.
        </BodyText>

        <BlogImage
          file="LSTM3-var-GRU.png"
          alt="GRU architecture"
          caption="GRU: chỉ còn 2 van (update z_t + reset r_t), không có Cell State riêng. Đơn giản hơn LSTM mà vẫn giải quyết được vanishing gradient."
        />

        <EqBlock
          title="GRU — 2 van thay vì 3"
          equations={[
            { tex: String.raw`z_t = \sigma\!\left(W_z \cdot [\,h_{t-1},\, x_t\,]\right)`, note: 'Update Gate (thay cho forget + input)' },
            { tex: String.raw`r_t = \sigma\!\left(W_r \cdot [\,h_{t-1},\, x_t\,]\right)`, note: 'Reset Gate — quên bao nhiêu trí nhớ cũ khi tạo ứng viên' },
            { tex: String.raw`\tilde{h}_t = \tanh\!\left(W \cdot [\,r_t \odot h_{t-1},\, x_t\,]\right)`, note: 'Trí nhớ ứng viên mới' },
            { tex: String.raw`h_t = (1 - z_t) \odot h_{t-1} + z_t \odot \tilde{h}_t`, note: 'Trộn trí nhớ cũ và mới theo van z_t' },
          ]}
        />
        <EqBlock
          title="So sánh số tham số (n_h = hidden, n_x = input)"
          equations={[
            { tex: String.raw`\text{LSTM}: 4 \times n_h\,(n_h + n_x)`, note: '4 bộ trọng số (3 van + 1 candidate)' },
            { tex: String.raw`\text{GRU}: 3 \times n_h\,(n_h + n_x)`, note: 'ít hơn ~25% → train nhanh hơn' },
          ]}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '4px' }}>
          {[
            {
              title: 'LSTM — Chọn khi nào?', color: '#A78BFA',
              items: [
                'Cần học phụ thuộc rất dài (>100 bước)',
                'Cần tách riêng h_t (ngắn hạn) và C_t (dài hạn)',
                'Dữ liệu tài chính nhiễu cao, cần "forget" chính xác',
                'Dự án hiện tại → chọn LSTM 2 layers',
              ],
            },
            {
              title: 'GRU — Chọn khi nào?', color: '#5C8AFF',
              items: [
                'Tập dữ liệu nhỏ, cần regularization ngầm',
                'Muốn training nhanh hơn (ít tham số hơn)',
                'Bài toán NLP ngắn, nhận dạng giọng nói',
                'Làm baseline nhanh trước khi thử LSTM',
              ],
            },
          ].map(card => (
            <div key={card.title} style={{
              background: `color-mix(in srgb, ${card.color} 6%, var(--bg-card))`,
              border: `1px solid color-mix(in srgb, ${card.color} 20%, var(--border))`,
              borderTop: `3px solid ${card.color}`,
              borderRadius: '8px', padding: '14px',
            }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: '12.5px', color: 'var(--text-primary)', marginBottom: '8px' }}>
                {card.title}
              </div>
              {card.items.map(item => (
                <div key={item} style={{ display: 'flex', gap: '7px', alignItems: 'flex-start', marginBottom: '5px' }}>
                  <div style={{ width: '3px', height: '3px', borderRadius: '50%', background: card.color, flexShrink: 0, marginTop: '7px' }} />
                  <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans', lineHeight: 1.5 }}>{item}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </SectionCard>

      {/* ── 5. Tại sao LSTM phù hợp với bài toán giá crypto ─────────────── */}
      <SectionCard>
        <SectionTitle accent="#F59E0B">5. Tại sao LSTM phù hợp với Dự đoán Giá Crypto?</SectionTitle>
        <BodyText>
          Chuỗi giá Bitcoin/Dogecoin có nhiều đặc điểm khiến LSTM trở thành lựa chọn phù hợp hơn các mô hình thống kê cổ điển như ARIMA hay Prophet:
        </BodyText>

        <DataTable
          headers={['Đặc điểm dữ liệu', 'Vấn đề với ARIMA/MLP', 'LSTM giải quyết thế nào?']}
          rows={[
            ['Non-stationary (giá không dừng)', 'ARIMA cần differencing; MLP bỏ qua thứ tự thời gian', 'Cell State học pattern biến đổi theo thời gian; log-return làm input dừng'],
            ['Long-range dependency (chu kỳ 30-90 ngày)', 'ARIMA(p,d,q) với p nhỏ không bắt được', 'Cơ chế cổng giữ thông tin qua 60 timesteps'],
            ['Fat tails / đột biến (kurtosis 11-77)', 'MSE bị outlier kéo lệch', 'HuberLoss + Dropout regularization'],
            ['Non-linear regime shifts (bull/bear)', 'ARIMA tuyến tính không bắt được', 'LSTM học ánh xạ phi tuyến qua tanh'],
            ['Multi-scale seasonality', 'Khó model; phải decompose thủ công', 'Hai layer LSTM: layer 1 học ngắn hạn, layer 2 học dài hạn'],
          ]}
        />

        <Callout variant="info">
          <strong>Stacked LSTM (2 layers) trong dự án:</strong> Layer 1 nhận input (batch, 60, 9) và xuất ra <em>toàn bộ</em> chuỗi, giúp Layer 2 học ở mức trừu tượng cao hơn. Layer 2 chỉ lấy hidden state ở bước cuối <TeX>{String.raw`h_T`}</TeX> — một vector 128 chiều gói trọn ngữ cảnh 60 ngày — rồi hai "đầu" dự đoán tách ra để đoán giá và độ biến động độc lập.
        </Callout>
      </SectionCard>

      {/* ── 6. Cài đặt trong dự án ───────────────────────────────────────── */}
      <SectionCard>
        <SectionTitle accent="#A78BFA">6. Cài đặt trong Dự án — LSTM v3 Dual-Head</SectionTitle>

        <FlowDiagram nodes={[
          { label: 'CSV / MongoDB', sub: 'daily_stats', variant: 'mongo' },
          { label: 'Feature Eng.', sub: '9 features', variant: 'lstm' },
          { label: 'StandardScaler', sub: 'fit on train', variant: 'lstm' },
          { label: 'Sliding Windows', sub: '60×9 → 7', variant: 'lstm' },
          { label: 'LSTM Encoder', sub: '2L, 128h', variant: 'lstm' },
          { label: 'Price + Vol Head', variant: 'lstm' },
          { label: 'predictions', variant: 'mongo' },
        ]} />

        <figure style={{ margin: '0 0 16px', textAlign: 'center' }}>
          <img
            src="/figures/lstm_architecture.png"
            alt="LSTM v3 Architecture Dual-Head"
            style={{ maxWidth: '100%', borderRadius: '8px', border: '1px solid var(--border)', background: '#f8f8f8' }}
          />
          <figcaption style={{ marginTop: '7px', fontSize: '11.5px', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans', fontStyle: 'italic' }}>
            LSTM v3 — Dual-Head: Price Head (đỏ) + Volatility Head (xanh). Tổng 219.662 tham số. Direction head không được sử dụng trong training v3.
          </figcaption>
        </figure>
        <DataTable
          headers={['Thành phần', 'Chi tiết', 'Số tham số']}
          rows={[
            ['LSTM Layer 1', 'input_size=9, hidden=128, dropout=0.2 giữa layers', '70.656'],
            ['LSTM Layer 2', 'input_size=128, hidden=128, dropout=0.2 giữa layers', '131.584'],
            ['Price Head', 'Linear(128→64) → ReLU → Dropout(0.1) → Linear(64→horizon)', '8.711'],
            ['Volatility Head', 'Linear(128→64) → ReLU → Dropout(0.1) → Linear(64→horizon) → Softplus', '8.711'],
            [<strong>TỔNG</strong>, '—', <strong>219.662</strong>],
          ]}
        />

        <SubTitle>Ánh xạ lý thuyết → cài đặt PyTorch</SubTitle>
        <BodyText>
          Để ý: <Mono>nn.LSTM</Mono> đã đóng gói sẵn cả 6 phương trình ở mục 3 — ta không phải tự viết các van. Việc của ta là lấy đúng <TeX>{String.raw`h_T`}</TeX> (trí nhớ tại bước cuối) rồi nối hai đầu dự đoán.
        </BodyText>
        <CodeBlock lang="python">{`import torch.nn as nn

class LSTMModel(nn.Module):
    def __init__(self, input_size=9, hidden_size=128, num_layers=2,
                 dropout=0.2, output_size=7,
                 use_direction_head=False,   # direction head TẮT trong v3
                 use_volatility_head=True):  # volatility head BẬT trong v3
        super().__init__()
        # 2-layer stacked LSTM — h_T gói trọn ngữ cảnh seq_len ngày
        # Layer 1: input_size=9 → hidden=128  (học đặc trưng ngắn hạn)
        # Layer 2: input_size=128 → hidden=128 (học trừu tượng dài hạn)
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            dropout=dropout,    # dropout GIỮA các layer (không áp lên layer cuối)
            batch_first=True,   # input shape: (batch, seq_len, features)
        )
        # Price Head: không giới hạn dấu — log-return có thể âm
        self.fc = nn.Sequential(
            nn.Linear(hidden_size, 64), nn.ReLU(), nn.Dropout(0.1),
            nn.Linear(64, output_size),  # MIMO: output_size = horizon (7 / 15 / 60)
        )
        # Volatility Head: luôn > 0 — dùng Softplus = ln(1 + eˣ)
        self.vol_head = nn.Sequential(
            nn.Linear(hidden_size, 64), nn.ReLU(), nn.Dropout(0.1),
            nn.Linear(64, output_size), nn.Softplus(),
        )

    def forward(self, x):
        # x: (batch, seq_len, 9) — seq_len = 60 (H7), 90 (H15), 120 (H60)
        lstm_out, _ = self.lstm(x)
        last_hidden = lstm_out[:, -1, :]  # lấy bước thời gian cuối: (batch, 128)
        # last_hidden chính là h_T — "trí nhớ" gói trọn ngữ cảnh seq_len ngày
        return self.fc(last_hidden), self.vol_head(last_hidden)`}</CodeBlock>

        <SubTitle>Hàm mất mát: Direction-weighted HuberLoss + Volatility Loss</SubTitle>
        <BodyText>
          Mô hình v3 học đồng thời hai mục tiêu: dự báo <em>log-return giá</em> và <em>volatility</em>. Direction head đã bị tắt trong v3 — hướng UP/DOWN được suy ra từ dấu của predicted log-return thay vì train riêng.
        </BodyText>
        <EqBlock
          equations={[
            { tex: String.raw`L_{\text{total}} = \alpha\, L_{\text{price}} + \gamma\, L_{\text{vol}}`, note: <>tổng lỗi: <TeX>{String.raw`\alpha=1.0`}</TeX> (price) + <TeX>{String.raw`\gamma`}</TeX> (volatility). Direction head bị tắt (<TeX>{String.raw`\beta=0`}</TeX>).</> },
            { tex: String.raw`L_{\text{price}} = \text{huber}_w(\hat{y}, y), \quad w = 1 + \text{PENALTY}{\cdot}\mathbb{1}[\text{sai chiều}]`, note: <>phạt nặng hơn khi sai chiều — <TeX>{String.raw`\text{PENALTY}=2.0`}</TeX>, nên <TeX>{String.raw`w \in \{1, 3\}`}</TeX></> },
            { tex: String.raw`L_{\text{vol}} = \text{MSE}(\hat{\sigma}, \sigma_{\text{realized}})`, note: 'MSE giữa predicted volatility và realized volatility 14 ngày' },
          ]}
        />
        <Callout variant="info">
          <strong>Vì sao HuberLoss thay vì MSE?</strong> MSE bình phương lỗi → một cú pump/crash bất thường (outlier) tạo lỗi khổng lồ, kéo cả mô hình chạy theo. HuberLoss xử nhẹ nhàng: lỗi nhỏ thì bình phương (mượt), lỗi lớn (<TeX>{String.raw`|e| > \delta`}</TeX>) thì chuyển sang tuyến tính → bền vững (robust) trước outlier. Crypto đầy outlier nên rất hợp.
        </Callout>
      </SectionCard>

      {/* ── 7. Dữ liệu và phân tích ──────────────────────────────────────── */}
      <SectionCard>
        <SectionTitle>7. Dữ liệu Huấn luyện và Phân tích Thống kê</SectionTitle>

        <BodyText>
          Bộ dữ liệu gồm <strong style={{ color: 'var(--text-primary)' }}>4.165 quan sát</strong> mỗi coin (01/01/2015–29/05/2026, ~11,4 năm). Sau khi loại 29 hàng warmup của SMA30, còn <strong style={{ color: 'var(--text-primary)' }}>4.136 hàng hợp lệ</strong>.
        </BodyText>

        <DataTable
          headers={['Coin', 'Thuộc tính', 'Min', 'Max', 'Mean', 'Kurtosis']}
          rows={[
            ['Bitcoin', 'Log-return 1 ngày', '−43,37%', '+28,71%', '+0,131%', '11,11'],
            ['Dogecoin', 'Log-return 1 ngày', '−50,71%', '+147,91%', '+0,151%', '77,02'],
          ]}
        />

        <Callout variant="info">
          <strong>Kurtosis &gt; 3 (fat tails) → vì sao chọn HuberLoss:</strong> Kurtosis của phân phối chuẩn = 3. BTC = 11,11, DOGE = 77,02 — nghĩa là các cú crash và pump cực đoan xảy ra <em>thường xuyên hơn nhiều</em> so với phân phối chuẩn. Đây chính là lý do dùng HuberLoss (mục 6) thay cho MSE.
        </Callout>

        <SubTitle>9 Input Features — mỗi cột trong x_t là gì</SubTitle>
        <BodyText>
          Mỗi ngày <TeX>{String.raw`x_t`}</TeX> là một vector 9 con số. Đây là "9 giác quan" mà mô hình dùng để cảm nhận thị trường:
        </BodyText>
        <DataTable
          headers={['#', 'Feature', 'Nhóm', 'Lý do chọn']}
          rows={[
            ['0', <Mono>log_return_1d</Mono>, <Tag variant="blue">Momentum</Tag>, 'Có tính dừng (ADF p≈0). Bắt buộc ở index 0 — dùng để inverse-transform về giá USD.'],
            ['1', <Mono>momentum_30d</Mono>, <Tag variant="blue">Momentum</Tag>, 'Khoảng cách tương đối tới SMA30. Xu hướng trung hạn.'],
            ['2', <Mono>realized_vol_14d</Mono>, <Tag variant="amber">Volatility</Tag>, 'Input chính cho Volatility Head. Trạng thái biến động gần đây.'],
            ['3', <Mono>RSI_14</Mono>, <Tag variant="purple">Oscillator</Tag>, 'Nằm [0,100], không cần normalize thêm. Tín hiệu quá mua/quá bán.'],
            ['4', <Mono>log_volume</Mono>, <Tag variant="green">Volume</Tag>, 'Log giảm độ lệch (skewness). Volume xác nhận breakout.'],
            ['5', <Mono>macd_norm</Mono>, <Tag variant="purple">Oscillator</Tag>, 'MACD chuẩn hóa theo giá — bất biến theo scale ở mọi mức giá.'],
            ['6', <Mono>bb_pct_b</Mono>, <Tag variant="purple">Oscillator</Tag>, '%B=0: dải dưới, %B=1: dải trên Bollinger. Bị chặn [0,1].'],
            ['7', <Mono>atr_norm</Mono>, <Tag variant="amber">Volatility</Tag>, 'Proxy ATR tức thì. Bổ sung cho realized_vol_14d.'],
            ['8', <Mono>fear_greed</Mono>, <Tag variant="red">Sentiment</Tag>, 'PLACEHOLDER = 0.5 — cần tích hợp Alternative.me API.'],
          ]}
        />
      </SectionCard>

      {/* ── 8. Validation và kết quả ─────────────────────────────────────── */}
      <SectionCard>
        <SectionTitle accent="#22C55E">8. Walk-Forward Validation và Kết quả</SectionTitle>

        <BodyText>
          Với chuỗi thời gian, <strong style={{ color: 'var(--text-primary)' }}>không được xáo trộn (shuffle) dữ liệu</strong> như bài toán thường — vì sẽ "nhìn trộm tương lai" (temporal leakage). Thay vào đó dùng Walk-Forward: luôn train trên quá khứ, kiểm tra trên tương lai liền sau.
        </BodyText>
        <figure style={{ margin: '0 0 16px', textAlign: 'center' }}>
          <img
            src="/figures/diagram_walk_forward.png"
            alt="Walk-Forward Validation 6 Folds"
            style={{ maxWidth: '100%', borderRadius: '8px', border: '1px solid var(--border)', background: '#f8f8f8' }}
          />
          <figcaption style={{ marginTop: '7px', fontSize: '11.5px', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans', fontStyle: 'italic' }}>
            Walk-Forward Validation — 6 folds, cửa sổ train 730 ngày, validation 60 ngày, trượt 60 ngày giữa các fold
          </figcaption>
        </figure>
        <MathBlock>{`Walk-Forward với cửa sổ trượt 730 ngày (H7):
  Fold 1: Train [t₀, t₀+730), Validate [t₀+730, t₀+790)
  Fold 2: Train [t₁, t₁+730), Validate [t₁+730, t₁+790)
  ...
  Fold 6: Train [t₅, t₅+730), Validate [t₅+730, t₅+790)

Trượt 60 ngày giữa các fold — không có temporal leakage
H15 dùng window 1095 ngày, H60 dùng toàn bộ lịch sử`}</MathBlock>

        <DataTable
          headers={['Phương pháp', 'Directional Accuracy', 'Ghi chú']}
          rows={[
            ['Walk-forward (6 folds)', '49,4% (trung bình)', 'Thực tế — gộp cả bull/bear/sideways'],
            ['Backtest 6 tháng unseen', '61,1% (H7)', 'Giai đoạn có xu hướng rõ ràng'],
            ['Random baseline', '50,0%', 'Mốc tung đồng xu'],
            ['K-Fold có shuffle', '~65-70%', 'KHÔNG đáng tin — temporal leakage'],
          ]}
        />

        <Callout variant="success">
          <strong>MIMO thay vì Autoregressive:</strong> Mô hình đoán cả 7 bước cùng lúc từ <TeX>{String.raw`h_T`}</TeX> (một forward pass) — không tích lũy lỗi. Cách autoregressive (đoán t+1 rồi nạp lại để đoán t+2) sẽ khuếch đại lỗi với crypto biến động mạnh.
        </Callout>
      </SectionCard>

      {/* ── 9. Nguồn tham khảo ───────────────────────────────────────────── */}
      <SectionCard>
        <SectionTitle>9. Nguồn Tham khảo</SectionTitle>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[
            {
              cite: '[1] Hochreiter, S., & Schmidhuber, J. (1997)',
              title: 'Long Short-Term Memory.',
              venue: 'Neural Computation, 9(8), 1735–1780.',
              note: 'Bài báo gốc đề xuất LSTM.',
              url: 'https://doi.org/10.1162/neco.1997.9.8.1735',
            },
            {
              cite: '[2] Olah, C. (2015)',
              title: 'Understanding LSTM Networks.',
              venue: 'colah.github.io/posts/2015-08-Understanding-LSTMs/',
              note: 'Nguồn chính cho hình ảnh và toàn bộ phần trực giác/giải thích trong tài liệu này. Hình ảnh thuộc bản quyền của tác giả.',
              url: 'https://colah.github.io/posts/2015-08-Understanding-LSTMs/',
              highlight: true,
            },
            {
              cite: '[3] Gers, F., & Schmidhuber, J. (2000)',
              title: 'Recurrent nets that time and count.',
              venue: 'IJCNN 2000.',
              note: 'Đề xuất Peephole Connections cho LSTM.',
              url: 'https://doi.org/10.1109/IJCNN.2000.861302',
            },
            {
              cite: '[4] Cho, K. et al. (2014)',
              title: 'Learning Phrase Representations using RNN Encoder-Decoder.',
              venue: 'EMNLP 2014.',
              note: 'Đề xuất GRU — biến thể LSTM đơn giản hơn.',
              url: 'https://arxiv.org/abs/1406.1078',
            },
            {
              cite: '[5] Graves, A. (2013)',
              title: 'Generating Sequences With Recurrent Neural Networks.',
              venue: 'arXiv:1308.0850.',
              note: 'Mở rộng LSTM cho sequence generation và nhận dạng giọng nói.',
              url: 'https://arxiv.org/abs/1308.0850',
            },
          ].map((ref) => (
            <div key={ref.cite} style={{
              padding: '12px 16px',
              background: ref.highlight ? 'color-mix(in srgb, #a78bfa 8%, var(--bg-elevated))' : 'var(--bg-elevated)',
              border: `1px solid ${ref.highlight ? 'color-mix(in srgb, #a78bfa 25%, var(--border))' : 'var(--border)'}`,
              borderRadius: '7px',
            }}>
              <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '11px', color: ref.highlight ? '#a78bfa' : 'var(--accent-light)', marginBottom: '4px', fontWeight: 600 }}>
                {ref.url ? (
                  <a href={ref.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                    {ref.cite} <span style={{ textDecoration: 'underline' }}>↗</span>
                  </a>
                ) : ref.cite}
              </div>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600, marginBottom: '3px' }}>
                {ref.url ? (
                  <a href={ref.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-primary)', textDecoration: 'underline' }}>
                    {ref.title}
                  </a>
                ) : ref.title}
              </div>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: '12px', color: 'var(--text-secondary)' }}>
                <em>{ref.venue}</em>
              </div>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
                {ref.note}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </motion.div>
  );
}
