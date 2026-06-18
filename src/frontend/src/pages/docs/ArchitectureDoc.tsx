import { motion } from 'framer-motion';
import {
  PageHeader, SectionCard, SectionTitle, BodyText, Callout,
  DataTable, Mono, CardGrid, InfoCard,
} from './shared';

const fadeUp = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.2 },
};

/* ════════════════════════════════════════════════════════════════════════════
   Sơ đồ kiến trúc Lambda — vẽ trực tiếp bằng SVG, đồng bộ 100% với code thật
   (docker-compose.yml, src/spark/*, src/ml/inference_scheduler.py).
   Hình thể hiện đúng tinh thần Lambda: dữ liệu rẽ thành hai nhánh Batch + Speed
   xử lý song song, cùng đổ về một Serving Store (MongoDB), rồi phục vụ client.
   ════════════════════════════════════════════════════════════════════════════ */

const PALETTE = {
  source: '#5C8AFF',
  ingest: '#F97316',
  speed:  '#818CF8',
  batch:  '#22D3EE',
  mongo:  '#22C55E',
  ml:     '#A78BFA',
  api:    '#6366F1',
  fe:     '#EC4899',
};

function Box({
  x, y, w, h, color, lines,
}: {
  x: number; y: number; w: number; h: number; color: string; lines: string[];
}) {
  const startY = y + h / 2 - ((lines.length - 1) * 8);
  return (
    <g>
      <rect
        x={x} y={y} width={w} height={h} rx={10}
        style={{ fill: `color-mix(in srgb, ${color} 14%, transparent)`, stroke: color, strokeWidth: 1.5 }}
      />
      {lines.map((t, i) => (
        <text
          key={i}
          x={x + w / 2}
          y={startY + i * 16}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{
            fill: i === 0 ? 'var(--text-primary)' : 'var(--text-muted)',
            fontFamily: i === 0 ? 'Plus Jakarta Sans' : 'IBM Plex Mono',
            fontSize: i === 0 ? 12.5 : 9.5,
            fontWeight: i === 0 ? 700 : 500,
          }}
        >
          {t}
        </text>
      ))}
    </g>
  );
}

function Arrow({
  x1, y1, x2, y2, dashed,
}: {
  x1: number; y1: number; x2: number; y2: number; dashed?: boolean;
}) {
  return (
    <line
      x1={x1} y1={y1} x2={x2} y2={y2}
      markerEnd="url(#arrowhead)"
      style={{
        stroke: 'var(--text-muted)', strokeWidth: 1.5,
        strokeDasharray: dashed ? '5 4' : undefined,
      }}
    />
  );
}

function LaneLabel({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <text
      x={x} y={y}
      style={{
        fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono',
        fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
      }}
    >
      {text}
    </text>
  );
}

function LambdaFigure() {
  return (
    <figure style={{ margin: '4px 0 0' }}>
      <div style={{
        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        borderRadius: '10px', padding: '12px', overflowX: 'auto',
      }}>
        <svg viewBox="0 0 1146 452" width="100%" style={{ minWidth: 880, display: 'block' }}>
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" style={{ fill: 'var(--text-muted)' }} />
            </marker>
          </defs>

          {/* Nhãn các lane */}
          <LaneLabel x={16} y={18} text="SPEED LAYER — thời gian thực" />
          <LaneLabel x={16} y={350} text="BATCH LAYER — lịch sử" />
          <LaneLabel x={744} y={350} text="ML LAYER — dự báo" />
          <LaneLabel x={744} y={140} text="SERVING STORE" />
          <LaneLabel x={980} y={62} text="CLIENT" />

          {/* ── Speed lane ────────────────────────────────────────────── */}
          <Box x={16}  y={44} w={132} h={52} color={PALETTE.source} lines={['CoinGecko API', 'REST · poll 600s']} />
          <Box x={176} y={44} w={150} h={52} color={PALETTE.ingest} lines={['Kafka Producer', 'acks=all · retries=3']} />
          <Box x={354} y={44} w={130} h={52} color={PALETTE.ingest} lines={['Kafka', 'topic: crypto_raw']} />
          <Box x={512} y={24} w={184} h={86} color={PALETTE.speed}  lines={['Spark Streaming', 'SMA·RSI·VWAP·Bollinger', 'watermark 10′ · trigger 30s']} />

          {/* ── Batch lane ────────────────────────────────────────────── */}
          <Box x={16}  y={372} w={132} h={56} color={PALETTE.source} lines={['CSV lịch sử', '~4.165 ngày BTC/DOGE']} />
          <Box x={300} y={360} w={212} h={76} color={PALETTE.batch}  lines={['Spark Batch', 'daily_stats · historical_sma', 'coin_correlation']} />

          {/* ── Serving store ─────────────────────────────────────────── */}
          <Box x={740} y={150} w={170} h={150} color={PALETTE.mongo} lines={['MongoDB', 'Serving Store', '7 collection']} />

          {/* ── ML lane ───────────────────────────────────────────────── */}
          <Box x={740} y={360} w={200} h={72} color={PALETTE.ml} lines={['Inference Scheduler', 'LSTM v3 · H7/H15/H60', 'MIMO · dual-head']} />

          {/* ── Clients ───────────────────────────────────────────────── */}
          <Box x={980} y={70}  w={150} h={54} color={PALETTE.api} lines={['FastAPI', ':8000 · JWT']} />
          <Box x={980} y={150} w={150} h={48} color={PALETTE.fe}  lines={['React Frontend', ':3000']} />
          <Box x={980} y={224} w={150} h={54} color={PALETTE.fe}  lines={['Streamlit', ':8501 · đọc thẳng']} />

          {/* ── Connectors ────────────────────────────────────────────── */}
          {/* speed lane chain */}
          <Arrow x1={148} y1={70} x2={176} y2={70} />
          <Arrow x1={326} y1={70} x2={354} y2={70} />
          <Arrow x1={484} y1={70} x2={512} y2={67} />
          <Arrow x1={696} y1={67} x2={740} y2={186} />
          {/* batch lane chain */}
          <Arrow x1={148} y1={400} x2={300} y2={398} />
          <Arrow x1={512} y1={398} x2={740} y2={272} />
          {/* ML đọc/ghi loop với MongoDB */}
          <Arrow x1={800} y1={300} x2={800} y2={360} />
          <Arrow x1={870} y1={360} x2={870} y2={300} />
          {/* serving → clients */}
          <Arrow x1={910} y1={200} x2={980} y2={97} />
          <Arrow x1={1055} y1={124} x2={1055} y2={150} />
          <Arrow x1={910} y1={255} x2={980} y2={251} dashed />

          {/* nhãn nhỏ trên cạnh */}
          <text x={764} y={335} style={{ fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono', fontSize: 8.5 }}>đọc seed</text>
          <text x={844} y={335} style={{ fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono', fontSize: 8.5 }}>predictions</text>
        </svg>
      </div>
      <figcaption style={{
        marginTop: '8px', fontSize: '11.5px', color: 'var(--text-muted)',
        fontFamily: 'Plus Jakarta Sans', fontStyle: 'italic', lineHeight: 1.6,
      }}>
        Hình 1. Kiến trúc Lambda của hệ thống. Hai nhánh xử lý song song — Speed Layer (Kafka → Spark Streaming) và
        Batch Layer (CSV → Spark Batch) — cùng ghi về một Serving Store (MongoDB). Inference Scheduler đọc lịch sử
        từ MongoDB làm seed rồi ghi ngược kết quả dự báo vào collection <code>predictions</code>. Đường nét đứt:
        Streamlit đọc trực tiếp MongoDB, không qua FastAPI.
      </figcaption>
    </figure>
  );
}

export default function ArchitectureDoc() {
  return (
    <motion.div {...fadeUp}>
      <PageHeader
        title="Lambda Architecture"
        subtitle="Tổng quan kiến trúc hệ thống — thiết kế ba layer và lý do lựa chọn · CS315.F21.CN2"
        badge="01"
      />

      {/* Sơ đồ tổng thể */}
      <SectionCard>
        <SectionTitle>Sơ đồ kiến trúc tổng thể</SectionTitle>
        <BodyText>
          Toàn bộ hệ thống được tổ chức theo mô hình Lambda Architecture: dữ liệu giá được xử lý đồng thời qua hai
          nhánh độc lập, sau đó hợp nhất tại một kho phục vụ duy nhất. Sơ đồ dưới đây phản ánh đúng các thành phần
          đang chạy trong <Mono>docker-compose.yml</Mono> và logic trong <Mono>src/spark</Mono>, <Mono>src/ml</Mono>.
        </BodyText>
        <LambdaFigure />
      </SectionCard>

      {/* Ba layer tổng quan */}
      <SectionCard>
        <SectionTitle>Lambda Architecture — ba layer</SectionTitle>
        <BodyText>
          Hệ thống triển khai đúng mô hình Lambda Architecture với ba layer riêng biệt. Mỗi layer được tối ưu cho một
          tập yêu cầu kỹ thuật khác nhau về độ trễ (latency), độ chính xác (correctness) và khối lượng dữ liệu xử lý.
          Sự phân tách này là lý do nhóm chọn Lambda thay vì Kappa.
        </BodyText>
        <CardGrid cols={3}>
          <InfoCard title="Batch Layer — lớp xử lý hàng loạt" accent="#34D399">
            <p style={{ margin: '0 0 8px' }}>
              Batch Layer xử lý toàn bộ lịch sử (~4.165 ngày mỗi coin) với độ chính xác tuyệt đối, không bị ràng buộc
              về độ trễ. Spark Batch tổng hợp dữ liệu theo ngày, tính SMA dài hạn và hệ số tương quan giữa các coin.
              Tác vụ chạy định kỳ hàng ngày hoặc thủ công theo yêu cầu.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {['daily_stats', 'historical_sma', 'coin_correlation'].map(c => (
                <Mono key={c}>{c}</Mono>
              ))}
            </div>
          </InfoCard>
          <InfoCard title="Speed Layer — lớp xử lý tốc độ" accent="#F59E0B">
            <p style={{ margin: '0 0 8px' }}>
              Speed Layer tiêu thụ dữ liệu streaming từ Kafka. Spark Structured Streaming dùng watermark 10 phút để
              xử lý dữ liệu đến trễ (late data) và trigger 30 giây cho cửa sổ tổng hợp. Mọi write vào MongoDB đều qua
              pattern <Mono>foreachBatch</Mono> để đảm bảo ghi idempotent. Kết quả có độ trễ thấp nhưng là gần đúng.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {['realtime_prices', 'window_stats', 'alerts'].map(c => (
                <Mono key={c}>{c}</Mono>
              ))}
            </div>
          </InfoCard>
          <InfoCard title="Serving Layer — lớp phục vụ" accent="#5C8AFF">
            <p style={{ margin: '0 0 8px' }}>
              MongoDB đóng vai trò serving store duy nhất, hợp nhất kết quả của cả Batch Layer và Speed Layer. Batch
              ghi đè (overwrite) mỗi lần chạy; Speed ghi liên tục kèm TTL. FastAPI đọc và hợp nhất các view trước khi
              trả về cho client; Streamlit đọc trực tiếp MongoDB.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {['predictions', '+ 6 collection trên'].map(c => (
                <Mono key={c}>{c}</Mono>
              ))}
            </div>
          </InfoCard>
        </CardGrid>

        <Callout variant="info">
          <strong>Tại sao Lambda, không phải Kappa?</strong> Có ba lý do kỹ thuật cụ thể. (1) Tính lại SMA-200 và hệ
          số tương quan Pearson trên toàn bộ lịch sử mỗi khi có dữ liệu mới là chi phí không chấp nhận được trong môi
          trường streaming. (2) Mô hình LSTM cần một <Mono>StandardScaler</Mono> nhất quán, được fit trên một cửa sổ
          huấn luyện cố định — điều không thể đạt được với xử lý streaming tăng dần (incremental). (3) Hai loại truy
          vấn có yêu cầu hoàn toàn khác nhau: tương quan lịch sử cần toàn bộ dataset để chính xác, trong khi RSI/VWAP
          thời gian thực chỉ cần độ trễ thấp với khoảng 60 điểm dữ liệu gần nhất.
        </Callout>
      </SectionCard>

      {/* Lambda là gì */}
      <SectionCard>
        <SectionTitle accent="#22C55E">Lambda Architecture là gì?</SectionTitle>
        <BodyText>
          Lambda Architecture là mô hình xử lý dữ liệu do Nathan Marz đề xuất, phân tách rõ ràng ba mối quan tâm thành
          ba layer độc lập. Mỗi layer được tối ưu cho một yêu cầu riêng về độ trễ, độ chính xác và khối lượng dữ liệu.
          Sự phân tách này cho phép hệ thống đáp ứng đồng thời các yêu cầu trái ngược nhau mà một pipeline đơn lẻ
          không thể thỏa mãn.
        </BodyText>
        <BodyText>
          Trong đề tài này, Batch Layer xử lý toàn bộ lịch sử Bitcoin và Dogecoin, tạo ra ba tập kết quả chính:{' '}
          <Mono>daily_stats</Mono> (tổng hợp theo ngày: <Mono>avg_close</Mono>, <Mono>daily_high</Mono>,{' '}
          <Mono>daily_low</Mono>, <Mono>avg_volume</Mono>, <Mono>total_volume</Mono>, <Mono>avg_vwap</Mono>,{' '}
          <Mono>trade_count</Mono> — nguồn dữ liệu chính cho huấn luyện LSTM), <Mono>historical_sma</Mono> (Simple
          Moving Average trên ba chu kỳ 20/50/200 ngày, tính trên cột <Mono>avg_close</Mono>), và{' '}
          <Mono>coin_correlation</Mono> (hệ số tương quan Pearson cho từng cặp coin, tính trên toàn bộ lịch sử). Speed
          Layer xử lý streaming từ Kafka và tính các chỉ báo kỹ thuật như SMA, RSI, VWAP, Bollinger Bands cho mỗi
          micro-batch giá đến. Serving Layer (MongoDB + FastAPI) hợp nhất kết quả từ cả hai nguồn để phục vụ client.
        </BodyText>
      </SectionCard>

      {/* Tại sao Lambda thay vì Kappa */}
      <SectionCard>
        <SectionTitle accent="#F97316">Tại sao chọn Lambda thay vì Kappa?</SectionTitle>
        <BodyText>
          Kappa Architecture chỉ có Speed Layer. Khi cần view lịch sử, toàn bộ dữ liệu phải được reprocess từ đầu qua
          stream processor. Mặc dù đơn giản hơn về vận hành, Kappa không phù hợp với hệ thống này vì ba lý do kỹ thuật
          cụ thể dưới đây.
        </BodyText>
        <Callout variant="info">
          <strong>Kappa Architecture</strong> loại bỏ Batch Layer để đơn giản hóa hệ thống, nhưng yêu cầu stream
          processor có khả năng xử lý toàn bộ lịch sử khi cần replay. Đây là phương án hợp lý cho các trường hợp không
          cần tính toán trên dữ liệu lịch sử lớn, hoặc khi chi phí reprocessing chấp nhận được.
        </Callout>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[
            {
              title: 'Chi phí reprocessing quá cao',
              body: 'Với ~4.165 ngày lịch sử, tính SMA-200 và tương quan Pearson theo cặp coin phải quét toàn bộ dataset mỗi khi có dữ liệu mới. Với Batch Layer, các phép tính này chỉ chạy một lần mỗi ngày và kết quả được lưu sẵn trong MongoDB — tính một lần, phục vụ nhiều lần, không lãng phí tài nguyên.',
            },
            {
              title: 'LSTM cần huấn luyện theo batch nhất quán',
              body: 'Mô hình LSTM cần một cửa sổ huấn luyện cố định, được tiền xử lý nhất quán với cùng một StandardScaler được fit trên đúng tập train. Stream processing không đảm bảo điều này vì dữ liệu đến dần theo từng micro-batch — scaler phải được fit trên toàn bộ tập train, không phải fit tăng dần theo từng điểm mới. Nếu scaler thay đổi theo thời gian, các dự báo từ inference pipeline sẽ không nhất quán và không đáng tin cậy.',
            },
            {
              title: 'Hai loại truy vấn có yêu cầu hoàn toàn khác nhau',
              body: 'Tương quan lịch sử (batch) cần toàn bộ lịch sử để chính xác — không thể đánh đổi. RSI/VWAP thời gian thực (speed) cần độ trễ thấp nhưng chỉ cần khoảng 60 điểm dữ liệu gần nhất. Lambda giải quyết hai yêu cầu này một cách độc lập, thay vì ép một hệ thống duy nhất phải vừa đảm bảo độ chính xác vừa đảm bảo độ trễ thấp.',
            },
          ].map((item, i) => (
            <div key={i} style={{
              background: 'var(--bg-elevated)', borderRadius: '8px',
              padding: '16px', border: '1px solid var(--border)',
            }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: '13.5px', color: 'var(--text-primary)', marginBottom: '8px' }}>
                {item.title}
              </div>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.7, fontFamily: 'Plus Jakarta Sans' }}>
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Các thành phần */}
      <SectionCard>
        <SectionTitle>Các thành phần và trách nhiệm</SectionTitle>
        <DataTable
          headers={['Thành phần', 'Công nghệ', 'Trách nhiệm chính', 'Port']}
          rows={[
            [<Mono>CoinGecko Producer</Mono>, 'Python · pycoingecko', 'Thu thập giá BTC/DOGE mỗi 600 giây; đẩy JSON vào Kafka với acks=all, retries=3', '—'],
            [<Mono>Kafka Broker</Mono>, 'Confluent Platform 7.5.0', 'Hàng đợi bền vững cho streaming; at-least-once delivery; cho phép replay offset; topic crypto_raw + crypto_alerts', '9092'],
            [<Mono>Spark Streaming</Mono>, 'Apache Spark 3.5.5', 'Tính chỉ báo kỹ thuật thời gian thực (SMA, RSI, VWAP, Bollinger); watermark 10 phút; ghi qua foreachBatch', '—'],
            [<Mono>Spark Batch</Mono>, 'Apache Spark 3.5.5', 'Tổng hợp daily_stats, historical_sma (20/50/200), coin_correlation từ toàn bộ lịch sử', '8081'],
            [<Mono>MongoDB</Mono>, 'MongoDB 7.0', 'Serving store duy nhất; lưu toàn bộ 7 collection từ mọi layer; compound index trên (coin, date)', '27017'],
            [<Mono>FastAPI Backend</Mono>, 'Python · FastAPI + Uvicorn', 'REST API với JWT authentication; cầu nối giữa MongoDB và client; hợp nhất batch view + speed view', '8000'],
            [<Mono>React Frontend</Mono>, 'React 19 · TypeScript · Vite', 'Giao diện web chính; các trang phân tích với biểu đồ thời gian thực và dự báo LSTM', '3000'],
            [<Mono>Streamlit Dashboard</Mono>, 'Streamlit', 'Dashboard phân tích nhanh; kết nối trực tiếp MongoDB, không qua FastAPI', '8501'],
            [<Mono>Inference Scheduler</Mono>, 'PyTorch · schedule', 'Chạy LSTM inference 1 lần/ngày (H7/H15/H60) + 1 lần lúc khởi động; vòng lặp 5 phút chỉ refresh live_prices và xử lý request predict/retrain on-demand', '—'],
          ]}
        />
      </SectionCard>

      {/* Quyết định thiết kế */}
      <SectionCard>
        <SectionTitle accent="#A78BFA">Các quyết định thiết kế quan trọng</SectionTitle>
        <DataTable
          headers={['Quyết định', 'Lựa chọn', 'Lý do']}
          rows={[
            ['Stream processor', 'Spark Structured Streaming', 'Dùng chung DataFrame API với batch job nên dùng lại được codebase indicators. Watermark cho late data; foreachBatch cho write idempotent vào MongoDB.'],
            ['Message queue', 'Kafka (Confluent Platform 7.5.0)', 'Persistent log có thể replay; at-least-once delivery; chuẩn công nghiệp. acks=all bảo đảm không mất tick giá tài chính.'],
            ['Serving store', 'MongoDB 7.0 (một store duy nhất)', 'Schema linh hoạt cho nhiều loại document. Compound index trên (coin, date) đủ hiệu quả. Không cần nhiều store kèm logic đồng bộ phức tạp.'],
            ['MongoDB write pattern', 'foreachBatch + PyMongo', 'MongoDB Spark Connector không ổn định ở chế độ streaming. foreachBatch cho phép kiểm soát write idempotent theo từng micro-batch.'],
            ['Mô hình dự báo', 'LSTM v3 (MIMO, dual-head, H7/H15/H60)', 'Phù hợp chuỗi thời gian tài chính có phụ thuộc xa. MIMO tránh tích lũy lỗi. Volatility head cung cấp khoảng tin cậy.'],
            ['Xác thực API', 'JWT stateless', 'Không cần kho session dùng chung; dễ mở rộng theo chiều ngang; phù hợp với mô hình SPA + REST API.'],
            ['Đóng gói', 'Docker Compose (11 service)', 'Triển khai trên một máy; môi trường tái lập được; "make docker-up" khởi động toàn hệ thống. Đủ phức tạp để minh họa Lambda mà không phức tạp hóa quá mức như Kubernetes.'],
          ]}
        />
      </SectionCard>

      {/* MongoDB Collections */}
      <SectionCard>
        <SectionTitle>MongoDB Collections — Serving Layer</SectionTitle>
        <BodyText>
          MongoDB đóng vai trò <strong style={{ color: 'var(--text-primary)' }}>serving store duy nhất</strong> cho
          toàn hệ thống. Mọi thành phần ghi (Spark Streaming, Spark Batch, Inference Scheduler) đều ghi vào MongoDB;
          mọi thành phần đọc (FastAPI, Streamlit) đều đọc từ MongoDB. Thiết kế một kho duy nhất giúp giảm đáng kể độ
          phức tạp vận hành vì không phải duy trì logic đồng bộ giữa nhiều cơ sở dữ liệu.
        </BodyText>
        <DataTable
          headers={['Collection', 'Layer nguồn', 'Writer', 'Nội dung']}
          rows={[
            [<Mono>realtime_prices</Mono>, 'Speed', 'Spark Streaming', 'Bản ghi đã enrich theo từng micro-batch: OHLC, price_usd, volume_24h, market_cap, change_24h + chỉ báo SMA-5/20, RSI-14, VWAP-60, Bollinger-20 (bb_mid/bb_upper/bb_lower).'],
            [<Mono>window_stats</Mono>, 'Speed', 'Spark Streaming', 'Cửa sổ trượt 20 phút / bước trượt 5 phút (output mode append): sma_20, high_window, low_window, total_volume, avg_volume.'],
            [<Mono>alerts</Mono>, 'Speed', 'Spark Streaming', 'Sự kiện PRICE_SPIKE khi |change_24h| > 5%: coin, alert_type, change_pct, price_usd, timestamp. Đồng thời được publish sang Kafka topic crypto_alerts.'],
            [<Mono>daily_stats</Mono>, 'Batch', 'Spark Batch', 'Tổng hợp theo ngày: avg_close, daily_high, daily_low, avg_volume, total_volume, avg_vwap, trade_count — nguồn dữ liệu chính cho huấn luyện LSTM.'],
            [<Mono>historical_sma</Mono>, 'Batch', 'Spark Batch', 'daily_stats được bổ sung SMA-20, SMA-50, SMA-200 tính trên cột avg_close, trên toàn bộ lịch sử.'],
            [<Mono>coin_correlation</Mono>, 'Batch', 'Spark Batch', 'Hệ số tương quan Pearson cho từng cặp coin (mọi tổ hợp 2 phần tử): coin_a, coin_b, pearson_corr, computed_at.'],
            [<Mono>predictions</Mono>, 'ML', 'Inference Scheduler', 'Dự báo đa horizon (H7/H15/H60): predicted_price, predicted_volatility, model_version, horizon, horizon_step. Khóa upsert: (coin, prediction_date, horizon, model_id).'],
          ]}
        />
        <Callout variant="success">
          <strong>Ý chính:</strong> Lambda Architecture tách <em>correctness</em> (Batch Layer) khỏi <em>latency</em>{' '}
          (Speed Layer). Serving Layer hợp nhất cả hai để client luôn nhận được dữ liệu đầy đủ nhất — batch view cho
          lịch sử chính xác, speed view cho thời gian thực gần đúng.
        </Callout>
        <Callout variant="info">
          <strong>Vì sao MongoDB là store duy nhất?</strong> Giảm độ phức tạp vận hành — không phải duy trì nhiều
          cơ sở dữ liệu kèm logic đồng bộ. Với thông lượng rất thấp (poll mỗi 600 giây, tức ~2 bản tin mỗi 10 phút cho
          mỗi coin), MongoDB hoàn toàn đủ cho trường hợp này. Nếu mở rộng lên hàng triệu tick mỗi ngày, InfluxDB hoặc
          Cassandra sẽ phù hợp hơn cho dữ liệu chuỗi thời gian. Ngoài 7 collection trên, Inference Scheduler còn refresh{' '}
          <Mono>live_prices</Mono> phục vụ frontend thời gian thực.
        </Callout>
      </SectionCard>

      {/* Docker Services */}
      <SectionCard>
        <SectionTitle>Các service trong Docker Compose (11)</SectionTitle>
        <DataTable
          headers={['Service', 'Layer', 'Image', 'Port', 'Phụ thuộc']}
          rows={[
            [<Mono>zookeeper</Mono>, 'Infrastructure', 'confluentinc/cp-zookeeper:7.5.0', '2181', '—'],
            [<Mono>kafka</Mono>, 'Speed — Transport', 'confluentinc/cp-kafka:7.5.0', '9092, 9101', 'zookeeper (healthy)'],
            [<Mono>kafka-ui</Mono>, 'Monitoring', 'provectuslabs/kafka-ui:latest', '8080', 'kafka'],
            [<Mono>mongodb</Mono>, 'Serving Store', 'mongo:7.0', '27017', '—'],
            [<Mono>producer</Mono>, 'Speed — Ingestion', 'build (Python)', '—', 'kafka (healthy)'],
            [<Mono>spark-master</Mono>, 'Batch + Speed', 'apache/spark:3.5.5', '8081, 7077', '—'],
            [<Mono>spark-worker</Mono>, 'Batch + Speed', 'apache/spark:3.5.5', '—', 'spark-master'],
            [<Mono>dashboard</Mono>, 'Presentation', 'build (Streamlit)', '8501', 'mongodb'],
            [<Mono>inference_scheduler</Mono>, 'ML Pipeline', 'build (PyTorch)', '—', 'mongodb'],
            [<Mono>api</Mono>, 'Serving', 'build (FastAPI + Uvicorn)', '8000', 'mongodb'],
            [<Mono>frontend</Mono>, 'Presentation', 'build (React 19 + Nginx)', '3000', 'api'],
          ]}
        />
        <Callout variant="info">
          <strong>Lưu ý về port.</strong> Spark Master expose <Mono>8081:8080</Mono> (Web UI) và <Mono>7077</Mono>{' '}
          (master). Kafka mở thêm <Mono>9101</Mono> cho JMX. Các service <Mono>producer</Mono>,{' '}
          <Mono>spark-worker</Mono> và <Mono>inference_scheduler</Mono> không expose port ra host.
        </Callout>
      </SectionCard>
    </motion.div>
  );
}
