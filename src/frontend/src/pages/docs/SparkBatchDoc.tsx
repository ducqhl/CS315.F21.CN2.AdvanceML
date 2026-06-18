import { motion } from 'framer-motion';
import {
  PageHeader, SectionCard, SectionTitle, BodyText, Callout,
  CodeBlock, DataTable, Mono, SubTitle,
} from './shared';

export default function SparkBatchDoc() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <PageHeader
        title="Spark Batch Job — Batch Layer"
        subtitle="src/spark/batch_job.py — xử lý dữ liệu lịch sử 4.165 ngày"
        badge="04"
        badgeColor="#34D399"
      />

      {/* Trách nhiệm */}
      <SectionCard>
        <SectionTitle>Trách nhiệm</SectionTitle>
        <BodyText>
          Batch Layer chịu trách nhiệm tính toán ba aggregation mà Speed Layer không thể cung cấp do thiếu ngữ cảnh lịch sử đủ dài. Kết quả từ Batch Layer chính xác hơn streaming vì có toàn bộ lịch sử 4.165 ngày. Đây là lý do cốt lõi tại sao hệ thống cần Lambda Architecture thay vì chỉ có Speed Layer — một số loại tính toán về bản chất không thể thực hiện tốt theo kiểu streaming incremental.
        </BodyText>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
          {[
            {
              title: 'daily_stats',
              body: 'Thống kê hàng ngày: OHLCV (open/high/low/close/volume), avg_price (mean giá trong ngày), price_std (biến động nội ngày) cho BTC và DOGE. Đây là nguồn dữ liệu chính cho LSTM Training với rolling window 730 ngày, và là input cho Historical Charts API.',
              index: 'Compound index (coin_name, date) — unique',
            },
            {
              title: 'historical_sma',
              body: 'SMA-7 (xu hướng 1 tuần), SMA-14 (2 tuần), SMA-30 (1 tháng), SMA-90 (3 tháng) trên toàn bộ chuỗi lịch sử — cho phép so sánh cross-window trend cùng lúc. Được dùng bởi Technical Analysis page và Correlation page.',
              index: 'Compound index (coin_name, date)',
            },
            {
              title: 'coin_correlation',
              body: 'Rolling Pearson correlation 30 ngày giữa log-return BTC và DOGE. Kết quả cho thấy tương quan tổng thể r = 0.528, trung bình rolling r = 0.637. Dữ liệu hiển thị trên Correlation page của React Frontend.',
              index: 'Index (date DESC)',
            },
          ].map(card => (
            <div key={card.title} style={{
              background: 'color-mix(in srgb, #34D399 5%, var(--bg-card))',
              border: '1px solid color-mix(in srgb, #34D399 18%, var(--border))',
              borderTop: '3px solid #34D399',
              borderRadius: '8px', padding: '16px',
            }}>
              <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '12px', color: '#34D399', fontWeight: 700, marginBottom: '8px' }}>
                {card.title}
              </div>
              <p style={{ margin: '0 0 8px', fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.7, fontFamily: 'Plus Jakarta Sans' }}>
                {card.body}
              </p>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}>
                {card.index}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Tại sao cần Batch Layer */}
      <SectionCard>
        <SectionTitle accent="#22C55E">Tại sao cần Batch Layer?</SectionTitle>
        <BodyText>
          Câu hỏi then chốt là: tại sao không dùng Speed Layer (Kappa Architecture) cho tất cả? Bảng dưới đây phân tích từng aggregation và cho thấy Speed Layer không thể thay thế Batch Layer cho các tính toán yêu cầu ngữ cảnh lịch sử dài hạn.
        </BodyText>
        <DataTable
          headers={['Aggregation', 'Speed Layer có làm được?', 'Vấn đề nếu chỉ dùng Speed']}
          rows={[
            [
              'SMA-90',
              'Có thể, nhưng cần 90 rows trong window state',
              'Với poll interval 600 giây, cần ~15 giờ data trong window mới có đủ 90 points. State memory tăng liên tục. Restart mất hết state và phải warmup lại từ đầu.',
            ],
            [
              'Correlation BTC-DOGE 30 ngày',
              'Có thể với cross-stream join',
              'Cross-stream join phức tạp, dễ lỗi trong Spark Streaming. Alignment theo date giữa 2 coin streams cần careful watermark design và có thể bỏ sót data.',
            ],
            [
              'daily_stats cho LSTM training',
              'Không',
              'LSTM cần 730 ngày history nhất quán. Streaming data có gaps (service restart, 429 errors) → không reliable cho training. Scaler phải được fit trên full dataset.',
            ],
          ]}
        />
      </SectionCard>

      {/* Spark Batch Jobs */}
      <SectionCard>
        <SectionTitle>Ba Spark Batch Jobs</SectionTitle>

        <SubTitle>Job 1 — daily_stats</SubTitle>
        <BodyText>
          Job 1 đọc CSV lịch sử BTC và DOGE, thực hiện groupBy theo ngày và tên coin, tính toán các aggregations OHLCV. Do dữ liệu CSV chỉ có giá close hàng ngày (không có OHLC intraday), high và low được dùng làm proxy từ close trong ngày.
        </BodyText>
        <CodeBlock lang="python">{`df = spark.read.csv(CSV_PATH, header=True, inferSchema=True)

daily_stats = df.groupBy("date", "coin_name").agg(
    F.first("close").alias("close"),
    F.sum("total_volume").alias("volume"),
    F.avg("close").alias("avg_price"),
    F.stddev("close").alias("price_std"),
    F.max("close").alias("high"),         # proxy high (chỉ có close trong CSV)
    F.min("close").alias("low"),          # proxy low
)

# Ghi vào MongoDB
write_to_mongo(daily_stats, "daily_stats")`}</CodeBlock>

        <SubTitle>Job 2 — historical_sma</SubTitle>
        <BodyText>
          Job 2 tính Simple Moving Average với bốn window sizes khác nhau sử dụng PySpark Window Functions. Mỗi window được định nghĩa với <Mono>rowsBetween</Mono> để đảm bảo rolling calculation đúng thứ tự thời gian.
        </BodyText>
        <CodeBlock lang="python">{`w7  = Window.partitionBy("coin_name").orderBy("date").rowsBetween(-6, 0)
w14 = Window.partitionBy("coin_name").orderBy("date").rowsBetween(-13, 0)
w30 = Window.partitionBy("coin_name").orderBy("date").rowsBetween(-29, 0)
w90 = Window.partitionBy("coin_name").orderBy("date").rowsBetween(-89, 0)

sma_df = daily_stats \\
    .withColumn("sma_7",  F.avg("close").over(w7)) \\
    .withColumn("sma_14", F.avg("close").over(w14)) \\
    .withColumn("sma_30", F.avg("close").over(w30)) \\
    .withColumn("sma_90", F.avg("close").over(w90))

write_to_mongo(sma_df, "historical_sma")`}</CodeBlock>

        <SubTitle>Job 3 — coin_correlation</SubTitle>
        <BodyText>
          Job 3 tính rolling Pearson correlation 30 ngày giữa log-return của Bitcoin và Dogecoin. Hai coin được tách ra, join trên date (để đảm bảo alignment), sau đó tính log-return và rolling correlation.
        </BodyText>
        <CodeBlock lang="python">{`# Tách BTC và DOGE
btc_df  = daily_stats.filter(F.col("coin_name") == "bitcoin").alias("btc")
doge_df = daily_stats.filter(F.col("coin_name") == "dogecoin").alias("doge")

# Inner join trên date (aligned timestamps)
joined = btc_df.join(doge_df, on="date")

# Tính log-returns
w_day = Window.orderBy("date")
btc_ret  = F.log(F.col("btc.close")  / F.lag("btc.close").over(w_day))
doge_ret = F.log(F.col("doge.close") / F.lag("doge.close").over(w_day))

# Rolling 30-day Pearson correlation
w30 = Window.orderBy("date").rowsBetween(-29, 0)
corr_df = joined.withColumn("corr_30d", F.corr(btc_ret, doge_ret).over(w30))

write_to_mongo(corr_df, "coin_correlation")`}</CodeBlock>
      </SectionCard>

      {/* Kết quả tương quan */}
      <SectionCard>
        <SectionTitle accent="#A78BFA">Kết quả Phân tích Tương quan BTC-DOGE</SectionTitle>
        <BodyText>
          Kết quả từ Batch Layer cung cấp bức tranh toàn diện về mối quan hệ giữa Bitcoin và Dogecoin qua 11,4 năm lịch sử. Tương quan biến thiên mạnh theo thời gian, đặc biệt trong các giai đoạn DOGE có pump độc lập do yếu tố sentiment thay vì market dynamics chung.
        </BodyText>
        <DataTable
          headers={['Metric', 'Giá trị', 'Nhận xét']}
          rows={[
            ['Tương quan tổng thể (Pearson r)', '0.528', 'Tương quan dương vừa phải — không đủ cao để hai coin thay thế nhau trong portfolio'],
            ['Tương quan trượt 30 ngày (trung bình)', '0.637', 'Trong ngắn hạn, hai coin thường di chuyển cùng chiều theo dòng tiền thị trường chung'],
            ['Biên độ dao động', '0.2 – 0.85', 'Đặc biệt thấp khi DOGE có pump độc lập (2021, tweet Elon Musk) — tương quan xuống dưới 0.2'],
            ['Kết luận mô hình', '2 mô hình riêng biệt', 'Tương quan biến thiên mạnh → cần train model riêng cho BTC và DOGE, không dùng shared model'],
          ]}
        />
        <Callout variant="info">
          <strong>Tại sao train hai mô hình riêng?</strong> Tương quan BTC-DOGE dao động từ thấp hơn 0.2 đến cao hơn 0.8 theo thời gian. Trong giai đoạn DOGE pump độc lập (tháng 5/2021), tương quan xuống dưới 0.2 — mô hình chung sẽ không capture được dynamics riêng của mỗi coin trong các regime như vậy. Hai mô hình riêng biệt cho phép mỗi mô hình học đặc trưng của coin đó một cách độc lập.
        </Callout>
      </SectionCard>

      {/* Chạy Batch Job */}
      <SectionCard>
        <SectionTitle>Chạy Batch Job</SectionTitle>
        <CodeBlock lang="bash">{`# Cách 1: make command (khuyến nghị)
make batch

# Cách 2: script trực tiếp
bash scripts/run_batch.sh

# Cách 3: spark-submit thủ công
spark-submit \\
  --master spark://localhost:7077 \\
  --packages org.mongodb.spark:mongo-spark-connector_2.12:10.3.0 \\
  src/spark/batch_job.py

# Cách 4: chạy sau batch để populate predictions
bash scripts/run_inference.sh`}</CodeBlock>
        <Callout variant="warning">
          <strong>Khi nào chạy batch?</strong> Batch job nên chạy hàng ngày (cron job) hoặc thủ công trước khi train LSTM. Hiện tại chưa có auto-scheduling trong Docker Compose — đây là limitation cần cải thiện trong giai đoạn tiếp theo (Airflow, cron, hoặc Spark scheduler). Việc thiếu auto-scheduling là một trong năm điểm yếu kỹ thuật được thừa nhận của hệ thống.
        </Callout>
      </SectionCard>

      {/* Performance */}
      <SectionCard>
        <SectionTitle>Performance</SectionTitle>
        <DataTable
          headers={['Dataset', 'Thời gian', 'Ghi chú']}
          rows={[
            ['BTC CSV (4.136 rows sau warmup)', '~45 giây', 'Local Spark master, single worker trên Intel Core i7'],
            ['DOGE CSV (~4.000 rows)', '~40 giây', 'Dataset tương tự kích thước với BTC'],
            ['Correlation (joined 4k × 4k)', '~15 giây', 'Sau khi individual stats đã được tính và cached'],
            ['Tổng batch job (3 jobs tuần tự)', '~2–3 phút', 'Thời gian chấp nhận được cho daily batch'],
          ]}
        />
        <Callout variant="info">
          <strong>Single-node limitation:</strong> <Mono>spark.sql.shuffle.partitions=3</Mono> (thay vì default 200) vì chạy local mode. Với nhiều coin hơn hoặc tick-by-tick data (hàng triệu records mỗi ngày), cần Spark cluster thực với YARN hoặc Kubernetes để có horizontal scalability.
        </Callout>
      </SectionCard>

      {/* E2E Test Contract */}
      <SectionCard>
        <SectionTitle accent="#22C55E">E2E Test Contract (Layer 2)</SectionTitle>
        <BodyText>
          File <Mono>tests/e2e/test_batch_mongo.py</Mono> xác nhận Spark Batch Job tạo ra đúng aggregations và ghi vào MongoDB với schema và giá trị hợp lệ. MongoDB container được spin up qua testcontainers; batch job chạy trên test data; tất cả collections được verify cả về schema lẫn data quality.
        </BodyText>
        <DataTable
          headers={['Class', 'Test', 'Assertion']}
          rows={[
            [<strong>TestDailyStats</strong>, <Mono>test_row_count_positive</Mono>, 'Collection không rỗng sau khi batch job hoàn thành'],
            ['', <Mono>test_only_btc_and_doge</Mono>, 'Scope coins đúng — không có ETH hay coin khác ngoài BTC và DOGE'],
            ['', <Mono>test_required_columns</Mono>, 'Schema contract: date, close, volume, avg_price, price_std đều tồn tại'],
            ['', <Mono>test_prices_are_positive</Mono>, 'Data quality: không có giá âm hoặc zero — phát hiện data corruption sớm'],
            [<strong>TestHistoricalSma</strong>, <Mono>test_row_count_matches</Mono>, 'SMA count = daily_stats count (join không mất rows)'],
            ['', <Mono>test_has_sma_columns</Mono>, 'SMA-7, SMA-14, SMA-30, SMA-90 đều tồn tại trong collection'],
            ['', <Mono>test_only_btc_and_doge</Mono>, 'Coin scope nhất quán với daily_stats collection'],
            [<strong>TestCoinCorrelation</strong>, <Mono>test_exactly_one_pair</Mono>, 'Chỉ 1 pair BTC-DOGE, không có duplicate pairs'],
            ['', <Mono>test_pair_is_btc_doge</Mono>, 'Coin names đúng (bitcoin, dogecoin) — không phải symbol viết tắt'],
            ['', <Mono>test_pearson_value_in_range</Mono>, 'Correlation ∈ [−1, 1] — mathematical constraint phải luôn đúng'],
            ['', <Mono>test_no_ethereum</Mono>, 'ETH không xuất hiện — scope isolation được đảm bảo'],
          ]}
        />
      </SectionCard>
    </motion.div>
  );
}
