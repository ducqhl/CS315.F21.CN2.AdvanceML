import { motion } from 'framer-motion';
import {
  PageHeader, SectionCard, SectionTitle, BodyText, Callout,
  CodeBlock, DataTable, FlowDiagram, Mono, SpecRow, StepList,
  GlossarySection, type GlossaryTerm,
} from './shared';

export default function ProducerDoc() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <PageHeader
        title="CoinGecko Producer"
        subtitle="Speed Layer — điểm đầu vào dữ liệu · src/producer/crypto_producer.py"
        badge="02"
        badgeColor="#F97316"
      />

      <SpecRow items={[
        { label: 'Coins', value: '2', color: 'var(--accent-light)' },
        { label: 'Poll interval', value: '600s', color: '#F59E0B' },
        { label: 'Fields/message', value: '12', color: 'var(--accent-light)' },
        { label: 'Calls/tháng', value: '7.200', color: '#22C55E' },
        { label: 'Reliability', value: 'acks=all', color: '#F87171' },
        { label: 'Destinations', value: '2', color: 'var(--accent-light)' },
      ]} />

      {/* Trách nhiệm */}
      <SectionCard>
        <SectionTitle>Trách nhiệm</SectionTitle>
        <BodyText>
          Producer là <strong style={{ color: 'var(--text-primary)' }}>điểm đầu vào duy nhất</strong> của dữ liệu thị trường vào hệ thống. Thành phần này được thiết kế như một long-running service không bao giờ dừng, thực hiện đồng thời ba nhiệm vụ chính trong mỗi chu kỳ poll 600 giây.
        </BodyText>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
          {[
            {
              title: '1. Thu thập dữ liệu',
              body: 'Gọi CoinGecko API mỗi 600 giây để lấy giá tức thời của Bitcoin và Dogecoin. Cứ mỗi 3 chu kỳ (tức mỗi 30 phút), thực hiện thêm cuộc gọi API để lấy dữ liệu OHLC (Open/High/Low/Close) từ candle 4 giờ gần nhất.',
              accent: '#F97316',
            },
            {
              title: '2. Publish lên Kafka',
              body: 'Serialize message thành JSON và publish lên Kafka topic crypto_raw với key là coin symbol (BTC hoặc DOGE). Cấu hình Kafka được thiết lập với acks=all và retries=3 để đảm bảo không mất dữ liệu giá tài chính quan trọng.',
              accent: '#5C8AFF',
            },
            {
              title: '3. Dual-write tới MongoDB',
              body: 'Song song ghi raw tick vào collection live_prices (không qua Spark). Điều này cho phép FastAPI đọc dữ liệu giá ngay lập tức mà không phải đợi Spark Streaming hoàn thành micro-batch 30 giây tiếp theo.',
              accent: '#22C55E',
            },
          ].map(card => (
            <div key={card.title} style={{
              background: `color-mix(in srgb, ${card.accent} 5%, var(--bg-card))`,
              border: `1px solid color-mix(in srgb, ${card.accent} 18%, var(--border))`,
              borderTop: `3px solid ${card.accent}`,
              borderRadius: '8px', padding: '16px',
            }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: '13.5px', color: 'var(--text-primary)', marginBottom: '8px' }}>
                {card.title}
              </div>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.7, fontFamily: 'Plus Jakarta Sans' }}>
                {card.body}
              </p>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Kafka Message Schema */}
      <SectionCard>
        <SectionTitle>Kafka Message Schema — 12 trường</SectionTitle>
        <BodyText>
          Mỗi message được publish lên topic <Mono>crypto_raw</Mono> có cấu trúc JSON đầy đủ với 12 trường. Schema này là contract giữa Producer và Spark Streaming Consumer — bất kỳ thay đổi nào về tên trường đều yêu cầu cập nhật đồng thời ở cả <Mono>CRYPTO_SCHEMA</Mono> phía Spark.
        </BodyText>
        <CodeBlock lang="json">{`{
  "coin":       "BTC",                           // trading symbol
  "coin_id":    "bitcoin",                       // CoinGecko internal ID
  "price_usd":  77473.37,                        // giá hiện tại (USD)
  "volume_24h": 32816206284.10,                  // khối lượng giao dịch 24h
  "market_cap": 1548812855182.45,                // vốn hóa thị trường
  "change_24h": -1.24,                           // % thay đổi trong 24h
  "timestamp":  "2026-06-02T10:30:00+00:00",    // ISO-8601 UTC
  "source":     "coingecko",
  "open":       77200.00,   // từ OHLC 4h candle gần nhất (nullable)
  "high":       77600.00,
  "low":        77100.00,
  "close":      77473.37
}`}</CodeBlock>
        <Callout variant="info">
          <strong>OHLC nullable:</strong> Các trường <Mono>open/high/low/close</Mono> có giá trị <Mono>null</Mono> trong 2 chu kỳ không fetch OHLC (OHLC chỉ được lấy mỗi 3 chu kỳ, tức mỗi 30 phút). Spark Streaming xử lý null bình thường vì <Mono>OHLC_SCHEMA</Mono> định nghĩa các field này là <Mono>nullable=True</Mono>.
        </Callout>
      </SectionCard>

      {/* Kafka Config */}
      <SectionCard>
        <SectionTitle>Kafka Producer Configuration</SectionTitle>
        <BodyText>
          Năm tham số cấu hình được thiết lập cẩn thận để đảm bảo tính at-least-once delivery và message ordering — hai thuộc tính thiết yếu cho dữ liệu giá tài chính.
        </BodyText>
        <DataTable
          caption="5 tham số cấu hình đảm bảo at-least-once delivery và message ordering"
          headers={['Config', 'Giá trị', 'Lý do']}
          rows={[
            [<Mono>acks</Mono>, '"all"', 'Đợi tất cả ISR replicas xác nhận. Dữ liệu giá tài chính là critical — mất một tick gây gap trong time series, ảnh hưởng indicator calculation (SMA-5 trên 4 điểm thay vì 5 cho kết quả sai).'],
            [<Mono>retries</Mono>, '3', 'Tự động retry khi transient network failure hoặc broker overload xảy ra.'],
            [<Mono>max_in_flight_requests_per_connection</Mono>, '1', 'Kết hợp với retries=3 để đảm bảo message ordering khi retry. Nếu để >1 và retry, messages có thể đến ngoài thứ tự thời gian.'],
            [<Mono>linger_ms</Mono>, '100', 'Gom messages trong 100 mili-giây để batch hiệu quả hơn, dù với chỉ 2 coin thì batch thường nhỏ.'],
            [<Mono>request_timeout_ms</Mono>, '30,000', '30 giây timeout cho mỗi produce request trước khi thực hiện retry.'],
          ]}
        />
      </SectionCard>

      {/* Rate Limiting */}
      <SectionCard>
        <SectionTitle accent="#F59E0B">Rate Limiting Strategy</SectionTitle>
        <BodyText>
          CoinGecko demo tier giới hạn tổng cộng <strong style={{ color: 'var(--text-primary)' }}>10.000 calls mỗi tháng</strong>. Budget API được tính toán chặt chẽ để tránh exceed quota, đồng thời giữ lại dự phòng cho các trường hợp retry khi gặp lỗi HTTP 429.
        </BodyText>

        <div style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: '10px', padding: '20px', marginBottom: '14px',
        }}>
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: '13.5px', color: 'var(--text-primary)', marginBottom: '14px' }}>
            Budget Calculation
          </div>
          <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans', lineHeight: 1.7 }}>
            Poll interval 600 giây tương ứng với 6 chu kỳ mỗi giờ, hay 4.320 price calls mỗi tháng. OHLC được fetch mỗi 3 chu kỳ cho 2 coin, tạo ra thêm 2.880 OHLC calls mỗi tháng.
          </p>
          {[
            { label: 'Price calls (/simple/price)', used: 4320, total: 10000, pct: 43.2 },
            { label: 'OHLC calls (/coins/{id}/ohlc)', used: 2880, total: 10000, pct: 28.8 },
            { label: 'Tổng sử dụng', used: 7200, total: 10000, pct: 72, highlight: true },
          ].map(row => (
            <div key={row.label} style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                <span style={{ fontFamily: 'Plus Jakarta Sans', fontSize: '12px', color: 'var(--text-secondary)' }}>{row.label}</span>
                <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '11px', color: row.highlight ? '#22C55E' : 'var(--text-primary)', fontWeight: 700 }}>
                  {row.used.toLocaleString()} / {row.total.toLocaleString()}
                </span>
              </div>
              <div style={{ height: row.highlight ? '8px' : '5px', background: 'var(--bg-base)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${row.pct}%`, borderRadius: '3px',
                  background: row.highlight
                    ? 'linear-gradient(90deg, #22C55E, #5C8AFF)'
                    : 'var(--accent)',
                  transition: 'width 0.5s ease',
                }} />
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
            {[
              { key: 'Dự phòng', val: '2.800 calls (28%)' },
              { key: 'Buffer dùng cho', val: 'HTTP 429 retries' },
              { key: 'Mở rộng thêm', val: '+1 coin khả dụng (~3.600 calls)' },
            ].map(item => (
              <div key={item.key} style={{ fontSize: '11px', fontFamily: 'Plus Jakarta Sans', color: 'var(--text-muted)' }}>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{item.key}: </span>
                {item.val}
              </div>
            ))}
          </div>
        </div>

        <Callout variant="warning">
          <strong>Rate limit HTTP 429:</strong> Khi CoinGecko trả về HTTP 429, Producer tự động sleep thêm 60 giây trước khi thử lại. Logic này được xử lý trong hàm <Mono>produce_loop()</Mono> với <Mono>except requests.exceptions.HTTPError</Mono>. Trường hợp này không được tính vào bộ đếm <Mono>consecutive_errors</Mono> vì đây là rate limit của API, không phải lỗi hệ thống.
        </Callout>
      </SectionCard>

      {/* Error Handling */}
      <SectionCard>
        <SectionTitle accent="#F87171">Error Handling và Exponential Backoff</SectionTitle>
        <StepList steps={[
          {
            title: 'HTTP 429 — Rate Limited',
            body: 'Producer sleep thêm 60 giây và không tăng bộ đếm consecutive_errors. Sau thời gian chờ, chu kỳ tiếp tục bình thường với poll interval 600 giây.',
          },
          {
            title: 'Lỗi khác (network, timeout, parse error...)',
            body: (
              <>
                <p style={{ margin: '0 0 8px' }}>Bộ đếm consecutive_errors được tăng lên. Backoff được tính theo công thức:</p>
                <CodeBlock>{`backoff = min(30 × 2^(n-1), 3600) giây

consecutive_errors = 1 → backoff = 30s
consecutive_errors = 2 → backoff = 60s
consecutive_errors = 3 → backoff = 120s
consecutive_errors = 4 → backoff = 240s
...
consecutive_errors = 7 → backoff = 3600s (max 1 giờ)`}</CodeBlock>
              </>
            ),
          },
          {
            title: 'Reset sau thành công',
            body: 'Sau mỗi chu kỳ poll thành công, bộ đếm consecutive_errors được reset về 0. Backoff trở về 0 và chu kỳ tiếp tục với poll interval bình thường 600 giây.',
          },
        ]} />
      </SectionCard>

      {/* Dual-Write Pattern */}
      <SectionCard>
        <SectionTitle>Dual-Write Pattern</SectionTitle>
        <BodyText>
          Producer ghi vào <strong style={{ color: 'var(--text-primary)' }}>hai đích đến song song</strong> để phục vụ hai use case khác nhau với yêu cầu latency khác nhau. Kafka là transport layer chính cho Spark Streaming, trong khi MongoDB direct write là convenience layer cho API access ngay lập tức.
        </BodyText>
        <FlowDiagram nodes={[
          { label: 'CoinGecko API', sub: 'price + OHLC', variant: 'default' },
          { label: 'Producer', sub: 'produce_loop()', variant: 'kafka' },
          { label: 'Kafka', sub: 'crypto_raw (12 fields)', variant: 'kafka' },
          { label: 'MongoDB', sub: 'live_prices (8 fields)', variant: 'mongo' },
        ]} />
        <DataTable
          headers={['Destination', 'Collection/Topic', 'Nội dung', 'Mục đích']}
          rows={[
            ['Kafka', <Mono>topic: crypto_raw</Mono>, 'Full message schema (12 fields)', 'Spark Streaming consume để tính technical indicators; replay được khi cần recover từ offset cũ'],
            ['MongoDB', <Mono>live_prices</Mono>, 'Raw tick (8 fields, không OHLC)', 'Direct API access không qua Spark — FastAPI đọc raw tick ngay lập tức, không đợi micro-batch 30 giây'],
          ]}
        />
        <Callout variant="info">
          <strong>MongoDB write failure không làm crash producer:</strong> Lỗi MongoDB chỉ được log WARNING, còn Kafka send vẫn tiếp tục bình thường. Hàm <Mono>write_to_live_prices()</Mono> bọc toàn bộ logic trong <Mono>try/except Exception</Mono>. Kafka là primary transport; MongoDB direct write là secondary convenience — đây là design decision rõ ràng về priority.
        </Callout>
      </SectionCard>

      {/* OHLC Fetching */}
      <SectionCard>
        <SectionTitle>OHLC Fetching Logic</SectionTitle>
        <CodeBlock lang="python">{`# cycle = 0, 1, 2, 3, 4, 5, ...
# OHLC_POLL_MULTIPLIER = 3  (config)

fetch_ohlc_this_cycle = (cycle % OHLC_POLL_MULTIPLIER == 0)
# True khi cycle = 0, 3, 6, 9, ... (mỗi 1800 giây = 30 phút)

if fetch_ohlc_this_cycle:
    ohlc_data = coingecko.get_coin_ohlc_by_id(coin_id, vs_currency='usd', days=1)
    # Lấy candle gần nhất (phần tử cuối của list)
    latest_candle = ohlc_data[-1]  # [timestamp, open, high, low, close]
    message["open"]  = latest_candle[1]
    message["high"]  = latest_candle[2]
    message["low"]   = latest_candle[3]
    message["close"] = latest_candle[4]
else:
    # Các trường OHLC = null trong 2 chu kỳ không fetch
    message["open"] = message["high"] = message["low"] = message["close"] = None`}</CodeBlock>
        <BodyText>
          Khi OHLC fetch thành công, candle gần nhất (phần tử cuối của list trả về từ API) được lấy làm giá trị open, high, low, close cho message. Nếu OHLC fetch thất bại vì bất kỳ lý do gì, các trường này được set null — điều này không làm gián đoạn price feed vì Spark xử lý null bình thường.
        </BodyText>
        <Callout variant="success">
          <strong>Design principle:</strong> Producer được thiết kế để <em>không bao giờ dừng</em>. Mọi lỗi đều được handle với exponential backoff hoặc graceful skip. Main loop chỉ dừng khi nhận KeyboardInterrupt. Đây là pattern phù hợp cho long-running service trong Docker container với restart policy always.
        </Callout>
      </SectionCard>

      {/* E2E Test Contract */}
      <SectionCard>
        <SectionTitle accent="#22C55E">E2E Test Contract (Layer 1)</SectionTitle>
        <BodyText>
          File <Mono>tests/e2e/test_producer_kafka.py</Mono> xác nhận Producer hoạt động đúng với Kafka container thật (testcontainers). Kafka container được spin up, Producer chạy 1 poll cycle, Consumer đọc và verify messages. Đây là safety net quan trọng chống schema regression — nếu Producer thay đổi field names, toàn bộ downstream pipeline sẽ thất bại.
        </BodyText>
        <DataTable
          caption="5 test cases — file: tests/e2e/test_producer_kafka.py"
          headers={['Test Case', 'Assertion', 'Tại sao quan trọng']}
          rows={[
            [<Mono>test_produces_two_messages_per_cycle</Mono>, 'Đúng 2 messages: BTC + DOGE', 'Contract giữa Producer và Spark — mỗi cycle đúng 2 coin. Thêm coin sẽ exceed CoinGecko quota 10k/month'],
            [<Mono>test_message_schema_is_complete</Mono>, '12 required fields có đủ', 'Spark Streaming CRYPTO_SCHEMA cần đủ fields — thiếu 1 field gây parse error downstream cho toàn bộ batch'],
            [<Mono>test_only_btc_and_doge_produced</Mono>, 'Không có coin nào khác', 'Rate limit budget tính cho 2 coins — thêm coin sẽ exceed quota và gây 429 errors'],
            [<Mono>test_ohlc_fields_populated_from_candles</Mono>, 'open/high/low/close từ OHLC data', 'OHLC logic riêng biệt với price logic — cần test độc lập để verify candle parsing'],
            [<Mono>test_message_values_are_correct</Mono>, 'Giá trị khớp với mock CoinGecko', 'End-to-end correctness: không có data corruption qua serialization/deserialization JSON'],
          ]}
        />
      </SectionCard>

      <GlossarySection terms={PRODUCER_GLOSSARY} />
    </motion.div>
  );
}

const PRODUCER_GLOSSARY: GlossaryTerm[] = [
  { term: 'CoinGecko API', category: 'Kafka', def: 'REST API cung cấp dữ liệu giá và volume cryptocurrency. Demo tier: 10.000 calls/tháng. Producer poll mỗi 600 giây (10 phút) để nằm trong ngân sách quota.' },
  { term: 'pycoingecko', category: 'Kafka', def: 'Python client wrapper cho CoinGecko API. Cung cấp hàm get_price() và get_coin_ohlc_by_id() để lấy price, volume, market_cap và OHLC data.' },
  { term: 'Kafka Producer', category: 'Kafka', def: 'Component gửi message vào Kafka topic. Cấu hình quan trọng: acks=all (không mất message), retries=3 (tự retry khi lỗi), linger_ms=100 (gom batch để giảm overhead).' },
  { term: 'acks=all', category: 'Kafka', def: 'Producer chờ toàn bộ ISR (In-Sync Replicas) xác nhận trước khi trả về success. Đảm bảo message không mất kể cả khi leader broker crash ngay sau khi nhận.' },
  { term: 'ISR', category: 'Kafka', def: 'In-Sync Replicas — tập hợp các Kafka broker replica đang đồng bộ với leader. acks=all cần toàn bộ ISR đồng ý → đảm bảo durability.' },
  { term: 'linger_ms', category: 'Kafka', def: 'Thời gian producer chờ để gom thêm message vào một batch trước khi gửi. 100ms — giảm số lần network round-trip khi gửi nhiều message liên tiếp.' },
  { term: 'max_in_flight', category: 'Kafka', def: 'Số request tối đa đang bay (chưa nhận ack) cùng lúc. max_in_flight=1 đảm bảo message ordering khi retry — nếu >1, retry có thể gây message đến sai thứ tự.' },
  { term: 'Kafka Topic', category: 'Kafka', def: 'Kênh phân loại message trong Kafka. Topic crypto_raw nhận tất cả message từ Producer (BTC + DOGE). Partition giúp scale throughput và đảm bảo ordering trong partition.' },
  { term: 'Poll interval', category: 'Kafka', def: 'Khoảng thời gian giữa các lần Producer gọi CoinGecko API. POLL_INTERVAL_SECONDS=600 (10 phút). Configurable qua env var.' },
  { term: 'OHLC', category: 'Kafka', def: 'Open/High/Low/Close — giá mở/cao/thấp/đóng trong mỗi phiên. Chỉ fetch mỗi 30 phút (mỗi 3 poll cycle, OHLC_POLL_MULTIPLIER=3) vì tốn quota hơn price call.' },
  { term: '429 Error', category: 'Kafka', def: 'HTTP status CoinGecko trả về khi vượt rate limit. Producer handle với exponential backoff và retry logic. Hết retry → log warning, bỏ qua poll cycle đó.' },
  { term: 'Serialization', category: 'Kafka', def: 'Quá trình chuyển Python dict → JSON bytes để gửi qua Kafka. Spark deserialize lại khi đọc. Schema phải khớp giữa producer và consumer để parse đúng.' },
  { term: 'Schema contract', category: 'Kafka', def: 'Tập hợp các field bắt buộc trong Kafka message (REQUIRED_FIELDS). test_message_schema_is_complete() verify contract. Schema change → test fail → cảnh báo developer.' },
  { term: 'transform_to_record()', category: 'Kafka', def: 'Hàm chuyển CoinGecko API response thành Kafka message. Dùng .get(field, default) — graceful fallback thay vì crash khi API thay đổi response format.' },
];
