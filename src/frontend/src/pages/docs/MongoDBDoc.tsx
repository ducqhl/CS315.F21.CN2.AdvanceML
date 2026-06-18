import { motion } from 'framer-motion';
import {
  PageHeader, SectionCard, SectionTitle, BodyText, Callout,
  CodeBlock, DataTable, Mono, Tag,
} from './shared';

export default function MongoDBDoc() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <PageHeader
        title="MongoDB — Serving Layer"
        subtitle="Single serving store cho toàn bộ hệ thống · 7+ collections · port 27017"
        badge="05"
        badgeColor="#34D399"
      />

      <Callout variant="info">
        <strong>Design principle:</strong> MongoDB là <em>single source of truth</em> cho serving layer. Tất cả writers (Spark Streaming, Spark Batch, Inference Scheduler, Producer) ghi vào MongoDB. Tất cả readers (FastAPI) đọc từ MongoDB. Không có cache layer trung gian — giảm complexity vận hành và loại bỏ vấn đề cache invalidation.
      </Callout>

      {/* Collections tổng quan */}
      <SectionCard>
        <SectionTitle>7+ Collections — Cấu trúc tổng quan</SectionTitle>
        <BodyText>
          Bảy collections trong MongoDB phản ánh rõ ràng nguồn gốc của dữ liệu: ba collections từ Speed Layer (TTL policy cho cleanup tự động), ba collections từ Batch Layer (permanent storage), và một collection từ ML Pipeline (upsert idempotent). Mỗi collection có schema và index pattern được thiết kế cho query pattern cụ thể của mình.
        </BodyText>
        <DataTable
          headers={['Collection', 'Layer', 'Writer', 'TTL', 'Index', 'Nội dung']}
          rows={[
            [
              <Mono>live_prices</Mono>,
              <Tag variant="amber">Speed</Tag>,
              'Producer (direct)',
              '—',
              '(coin, timestamp)',
              'Raw tick từ Producer (8 fields): coin symbol, price_usd, volume_24h, market_cap, change_24h. Không qua Spark — API đọc ngay lập tức.',
            ],
            [
              <Mono>realtime_prices</Mono>,
              <Tag variant="amber">Speed</Tag>,
              'Spark Streaming',
              '7 ngày',
              '(coin, event_time)',
              'Enriched tick (18 columns): OHLC + sma_5/20, rsi_14, vwap, bb_mid/upper/lower. Output từ Spark Streaming Query B.',
            ],
            [
              <Mono>window_stats</Mono>,
              <Tag variant="amber">Speed</Tag>,
              'Spark Streaming',
              '—',
              '(coin, window.start)',
              'Sliding window 20-min/5-min: sma_20 (price avg), high_window, low_window, total_volume. Output từ Query A.',
            ],
            [
              <Mono>alerts</Mono>,
              <Tag variant="amber">Speed</Tag>,
              'Spark Streaming',
              '30 ngày',
              '(coin, timestamp)',
              'PRICE_SPIKE events khi |change_24h| > 5%.',
            ],
            [
              <Mono>daily_stats</Mono>,
              <Tag variant="green">Batch</Tag>,
              'Spark Batch',
              '—',
              '(coin_name, date)',
              'Daily OHLCV, avg_price, price_std. Primary input cho LSTM training: rolling window 730 ngày gần nhất.',
            ],
            [
              <Mono>historical_sma</Mono>,
              <Tag variant="green">Batch</Tag>,
              'Spark Batch',
              '—',
              '(coin_name, date)',
              'SMA-7/14/30/90 trên toàn bộ 4.165 ngày — cho phép so sánh cross-window trend trên cùng chart.',
            ],
            [
              <Mono>coin_correlation</Mono>,
              <Tag variant="green">Batch</Tag>,
              'Spark Batch',
              '—',
              '(date)',
              'Rolling 30-ngày Pearson correlation BTC-DOGE. r tổng thể = 0.528.',
            ],
            [
              <Mono>predictions</Mono>,
              <Tag variant="purple">ML</Tag>,
              'Inference Scheduler',
              '—',
              '(coin, prediction_date, horizon, model_id)',
              'LSTM multi-horizon forecast (H7/H15/H60): predicted_price, predicted_volatility, model_version, horizon, horizon_step. Upsert key idempotent.',
            ],
          ]}
        />
      </SectionCard>

      {/* Document Schema Examples */}
      <SectionCard>
        <SectionTitle>Document Schema Examples</SectionTitle>

        <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)', marginBottom: '8px', marginTop: '4px' }}>
          realtime_prices — Speed Layer Output (18 fields)
        </div>
        <CodeBlock lang="json">{`{
  "_id": ObjectId("..."),
  "coin": "BTC",
  "coin_id": "bitcoin",
  "price_usd": 77473.37,
  "volume_24h": 32816206284.10,
  "market_cap": 1548812855182.45,
  "change_24h": -1.24,
  "event_time": ISODate("2026-06-02T10:30:00Z"),
  "open":  77200.00,
  "high":  77600.00,
  "low":   77100.00,
  "close": 77473.37,
  "sma_5":    77350.00,
  "sma_20":   76900.00,
  "rsi_14":   58.3,
  "vwap":     77200.50,
  "bb_mid":   76900.00,
  "bb_upper": 78500.00,
  "bb_lower": 75300.00,
  "created_at": ISODate("2026-06-02T10:30:05Z"),
  "batch_id": 1234
}`}</CodeBlock>

        <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)', marginBottom: '8px', marginTop: '16px' }}>
          predictions — ML Pipeline Output (7 fields)
        </div>
        <CodeBlock lang="json">{`{
  "_id": ObjectId("..."),
  "coin": "bitcoin",
  "prediction_date": ISODate("2026-06-09T00:00:00Z"),  // t+7
  "predicted_price": 79500.00,
  "predicted_volatility": 0.032,                         // ~3.2% std dev
  "model_version": "lstm_bitcoin_h7_v3",                 // format: {coin}_h{horizon}_v{version}
  "horizon": 7,                                          // H7 / H15 / H60
  "created_at": ISODate("2026-06-02T10:35:00Z"),
  "horizon_step": 7                                      // 1-7 (step within the horizon)
}`}</CodeBlock>

        <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)', marginBottom: '8px', marginTop: '16px' }}>
          daily_stats — Batch Layer Output (8 fields)
        </div>
        <CodeBlock lang="json">{`{
  "_id": ObjectId("..."),
  "date": "2026-05-29",
  "coin_name": "bitcoin",
  "close": 95000.00,
  "volume": 32000000000.00,
  "avg_price": 94800.00,
  "price_std": 450.00,
  "high": 95500.00,
  "low":  94200.00
}`}</CodeBlock>
      </SectionCard>

      {/* Upsert Pattern */}
      <SectionCard>
        <SectionTitle>Upsert Pattern cho Predictions</SectionTitle>
        <BodyText>
          Scheduled inference chạy 1 lần/ngày, nhưng vẫn có nhiều nguồn ghi đè cùng một prediction: daily re-run, on-demand predict từ API, và restart container giữa chừng. Tính idempotency là bắt buộc để tránh duplicate documents. Pattern upsert với key duy nhất (coin, prediction_date, horizon, model_id) đảm bảo mỗi tổ hợp chỉ tồn tại tối đa một document, bất kể inference chạy bao nhiêu lần.
        </BodyText>
        <CodeBlock lang="python">{`# Key = (coin, prediction_date, horizon, model_id) — unique per forecast point
collection.update_one(
    filter={"coin": coin, "prediction_date": pred_date,
            "horizon": horizon, "model_id": model_id},
    update={"$set": document},
    upsert=True   # Insert if not exists, update if exists
)

# Daily re-run + on-demand predict + restart → vẫn chỉ 1 document/key`}</CodeBlock>
        <Callout variant="success">
          <strong>Tại sao upsert idempotency quan trọng?</strong> Dù scheduled inference chỉ chạy 1 lần/ngày, cùng một (coin, ngày, horizon) có thể bị ghi lại nhiều lần: daily re-run, on-demand predict request từ API, hoặc container restart rồi bootstrap lại lúc khởi động. Nếu dùng insert thay vì upsert, các lần ghi này sẽ tích lũy duplicate. Upsert key (coin, prediction_date, horizon, model_id) đảm bảo mỗi forecast point chỉ có tối đa 1 document, và hệ thống có thể restart bất kỳ lúc nào mà không gây data corruption.
        </Callout>
      </SectionCard>

      {/* TTL Index */}
      <SectionCard>
        <SectionTitle>TTL Index — Automatic Data Expiry</SectionTitle>
        <BodyText>
          TTL (Time-To-Live) index cho phép MongoDB tự động xóa documents sau một khoảng thời gian nhất định. Đây là cơ chế quan trọng để kiểm soát kích thước của các collections Speed Layer vốn liên tục được append thêm data mới.
        </BodyText>
        <CodeBlock lang="javascript">{`// realtime_prices: xóa sau 7 ngày
db.realtime_prices.createIndex(
    { "created_at": 1 },
    { "expireAfterSeconds": 604800 }  // 7 × 24 × 3600
)

// alerts: xóa sau 30 ngày
db.alerts.createIndex(
    { "timestamp": 1 },
    { "expireAfterSeconds": 2592000 }  // 30 × 24 × 3600
)`}</CodeBlock>
        <Callout variant="info">
          <strong>TTL cho realtime_prices:</strong> Với poll interval 600 giây, 1 tuần tương đương 1.008 price ticks nhân với 2 coins tạo ra khoảng 2.016 documents. TTL giữ collection nhỏ và queries nhanh. Collection <Mono>daily_stats</Mono> không cần TTL vì là historical data dùng cho LSTM — cần giữ lại vĩnh viễn để đảm bảo consistency của training data.
        </Callout>
      </SectionCard>

      {/* Indexes */}
      <SectionCard>
        <SectionTitle>Indexes cho Query Performance</SectionTitle>
        <BodyText>
          Mỗi collection được trang bị index phù hợp với query pattern của nó. Compound indexes trên (coin_name, date) được dùng cho các collections batch vì query pattern chủ yếu là date range scan cho một coin cụ thể — đây là use case của LSTM training window và historical chart.
        </BodyText>
        <DataTable
          headers={['Collection', 'Index', 'Query Pattern']}
          rows={[
            [<Mono>realtime_prices</Mono>, '(coin, event_time DESC)', 'Latest N records for a specific coin — đọc N ticks gần nhất'],
            [<Mono>daily_stats</Mono>, '(coin_name, date) — unique', 'Date range query cho LSTM training window (730 ngày gần nhất)'],
            [<Mono>historical_sma</Mono>, '(coin_name, date)', 'Historical SMA lookup theo coin và date range'],
            [<Mono>coin_correlation</Mono>, '(date DESC)', 'Rolling correlation time series — đọc N ngày gần nhất'],
            [<Mono>predictions</Mono>, '(coin, prediction_date, horizon, model_id) — unique', 'Upsert key + lookup latest predictions per coin/horizon'],
          ]}
        />
      </SectionCard>

      {/* Connection Config */}
      <SectionCard>
        <SectionTitle>MongoDB Connection Configuration</SectionTitle>
        <CodeBlock lang="python">{`MONGO_URI = "mongodb://admin:password123@mongodb:27017/crypto_db?authSource=admin"
# Trong Docker network: hostname = "mongodb" (service name trong docker-compose)
# Ngoài Docker (local dev): hostname = "localhost"

# Python connection via PyMongo
from pymongo import MongoClient
client = MongoClient(MONGO_URI)
db = client["crypto_db"]`}</CodeBlock>
        <Callout variant="warning">
          <strong>Security:</strong> Credentials hardcoded trong <Mono>docker-compose.yml</Mono> và <Mono>.env</Mono> là cho demo. Production cần secrets management: Docker Secrets, HashiCorp Vault, hoặc Kubernetes Secrets. Tuyệt đối không commit credentials vào Git — dùng <Mono>.env.example</Mono> làm template và thêm <Mono>.env</Mono> vào <Mono>.gitignore</Mono>.
        </Callout>
      </SectionCard>

      {/* Trade-off Analysis */}
      <SectionCard>
        <SectionTitle accent="#A78BFA">Trade-off: MongoDB vs. Alternatives</SectionTitle>
        <BodyText>
          Lựa chọn MongoDB là quyết định thiết kế có ý thức dựa trên đặc điểm cụ thể của hệ thống: throughput thấp (poll 600 giây), schema linh hoạt cho nhiều loại document, và yêu cầu về tính đơn giản vận hành. Bảng dưới đây so sánh các lựa chọn thay thế và lý do tại sao chúng không phù hợp.
        </BodyText>
        <DataTable
          headers={['Option', 'Phù hợp khi', 'Hạn chế với hệ thống này']}
          rows={[
            ['MongoDB (chọn)', 'Flexible schema, throughput thấp (poll 600s), cần single serving store đơn giản', 'Không tối ưu cho time series queries với hàng triệu records/ngày — cần InfluxDB nếu scale lên'],
            ['PostgreSQL', 'Cần ACID transactions, complex joins, fixed schema', 'Schema migration phức tạp khi thêm collection mới. ALTER TABLE làm gián đoạn service.'],
            ['InfluxDB', 'Time series chuyên dụng, tick-by-tick data (hàng triệu/ngày)', 'Overkill cho throughput thấp. ML pipeline cần flexible document format cho predictions — không phù hợp với time series schema cứng.'],
            ['Cassandra', 'Horizontal scale, high write throughput, multi-datacenter', 'Operational complexity quá cao cho single-machine demo. Query patterns đơn giản không cần Cassandra distributed architecture.'],
          ]}
        />
      </SectionCard>
    </motion.div>
  );
}
