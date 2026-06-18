import { motion } from 'framer-motion';
import {
  PageHeader, SectionCard, SectionTitle, BodyText, Callout,
  CodeBlock, DataTable, FlowDiagram, Mono, SpecRow, SubTitle, Tag,
} from './shared';

export default function SparkStreamingDoc() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <PageHeader
        title="Spark Structured Streaming — Speed Layer"
        subtitle="src/spark/streaming_job.py — xử lý realtime indicators, 2 parallel queries"
        badge="03"
        badgeColor="#818CF8"
      />

      <SpecRow items={[
        { label: 'Parallel queries', value: '2', color: 'var(--accent-light)' },
        { label: 'Trigger interval', value: '30s', color: '#F59E0B' },
        { label: 'Watermark', value: '10 min', color: 'var(--accent-light)' },
        { label: 'Indicators (Query B)', value: '5', color: '#22C55E' },
        { label: 'Write pattern', value: 'foreachBatch', color: '#F87171' },
        { label: 'Output mode', value: 'append', color: 'var(--accent-light)' },
      ]} />

      {/* Pipeline tổng quan */}
      <SectionCard>
        <SectionTitle>Pipeline Tổng quan</SectionTitle>
        <BodyText>
          Speed Layer sử dụng Spark Structured Streaming với <strong style={{ color: 'var(--text-primary)' }}>hai parallel queries</strong> chạy đồng thời từ cùng một parsed DataFrame. Query A tính windowed aggregations theo sliding window 20 phút với slide 5 phút, tạo ra dữ liệu OHLCV tổng hợp. Query B tính per-record technical indicators (RSI, Bollinger Bands, VWAP, ATR) trên mỗi micro-batch. Cả hai query ghi vào MongoDB qua pattern <Mono>foreachBatch</Mono> để đảm bảo tính idempotent.
        </BodyText>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          {[
            {
              title: 'Query A — Window Aggregation',
              output: 'window_stats',
              type: 'Stateful — groupBy + sliding window (20min/5min)',
              state: 'Giữ window state trong memory cho đến khi watermark pass',
              checkpoint: 'Lớn hơn (offset + aggregation state)',
              accent: '#5C8AFF',
            },
            {
              title: 'Query B — Per-Record Enrichment',
              output: 'realtime_prices + alerts',
              type: 'Stateless per-batch — PySpark Window Functions',
              state: 'Không giữ state giữa các micro-batch',
              checkpoint: 'Nhỏ hơn (chỉ offset Kafka)',
              accent: '#F59E0B',
            },
          ].map(q => (
            <div key={q.title} style={{
              background: `color-mix(in srgb, ${q.accent} 6%, var(--bg-card))`,
              border: `1px solid color-mix(in srgb, ${q.accent} 20%, var(--border))`,
              borderTop: `3px solid ${q.accent}`,
              borderRadius: '8px', padding: '16px',
            }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: '13.5px', color: 'var(--text-primary)', marginBottom: '10px' }}>
                {q.title}
              </div>
              {[
                { k: 'Output', v: <Mono>{q.output}</Mono> },
                { k: 'Type', v: q.type },
                { k: 'State', v: q.state },
                { k: 'Checkpoint', v: q.checkpoint },
              ].map(row => (
                <div key={row.k} style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0, paddingTop: '2px', minWidth: '80px' }}>
                    {row.k}:
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans', lineHeight: 1.6 }}>
                    {row.v}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <SubTitle>Query A — Kafka → Parse → Watermark → Window Aggregation → window_stats</SubTitle>
        <FlowDiagram nodes={[
          { label: 'Kafka', sub: 'crypto_raw', variant: 'kafka' },
          { label: 'Parse JSON', sub: 'CRYPTO_SCHEMA', variant: 'spark' },
          { label: 'Watermark', sub: '10 min', variant: 'spark' },
          { label: 'Query A', sub: 'window 20min/5min', variant: 'spark' },
          { label: 'window_stats', variant: 'mongo' },
        ]} />

        <SubTitle>Query B — Per-record Enrichment → realtime_prices + alerts</SubTitle>
        <FlowDiagram nodes={[
          { label: 'Watermark', sub: '(shared)', variant: 'spark' },
          { label: 'Query B', sub: 'per-record enrichment', variant: 'spark' },
          { label: 'realtime_prices', variant: 'mongo' },
          { label: 'alerts', sub: 'spike >5%', variant: 'default' },
        ]} />

        <figure style={{ margin: '16px 0 0', textAlign: 'center' }}>
          <img
            src="/figures/diagram_spark_streaming.png"
            alt="Spark Streaming sequence diagram"
            style={{ maxWidth: '100%', borderRadius: '8px', border: '1px solid var(--border)', background: '#111' }}
          />
          <figcaption style={{ marginTop: '7px', fontSize: '11.5px', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans', fontStyle: 'italic' }}>
            Sequence diagram: Producer → Kafka → Spark Streaming → MongoDB (Query A + Query B + alerts)
          </figcaption>
        </figure>
      </SectionCard>

      {/* Đọc Kafka */}
      <SectionCard>
        <SectionTitle>Bước 1 — Đọc Stream từ Kafka</SectionTitle>
        <CodeBlock lang="python">{`df_raw = spark.readStream \\
    .format("kafka") \\
    .option("kafka.bootstrap.servers", KAFKA_BOOTSTRAP)   # kafka:29092 (internal)
    .option("subscribe", KAFKA_TOPIC_RAW)                  # crypto_raw
    .option("startingOffsets", "latest")
    .option("maxOffsetsPerTrigger", "1000")
    .option("failOnDataLoss", "false")
    .load()`}</CodeBlock>
        <Callout variant="info">
          <strong>failOnDataLoss=false:</strong> Nếu Kafka topic bị xóa hoặc offset bị reset do retention policy, Spark không crash mà tiếp tục từ earliest available offset. Đây là cấu hình phù hợp cho demo setup. Trong môi trường production với yêu cầu at-least-once delivery nghiêm ngặt, cần set <Mono>failOnDataLoss=true</Mono>.
        </Callout>
      </SectionCard>

      {/* Parse JSON và Watermark */}
      <SectionCard>
        <SectionTitle>Bước 2 — Parse JSON và Watermark</SectionTitle>
        <CodeBlock lang="python">{`# Parse value bytes → JSON → typed DataFrame
parsed_df = df_raw.select(
    F.from_json(F.col("value").cast("string"), CRYPTO_SCHEMA).alias("data"),
    F.col("timestamp").alias("kafka_ts")
).select("data.*", "kafka_ts")

# Convert event_time string → TimestampType (UTC)
parsed_df = parsed_df.withColumn(
    "event_time",
    F.to_timestamp(F.col("timestamp"), "yyyy-MM-dd'T'HH:mm:ssXXX")
)

# Watermark: tolerate data late up to 10 minutes
parsed_df = parsed_df.withWatermark("event_time", "10 minutes")`}</CodeBlock>

        <DataTable
          caption="Watermark = 10 phút — bằng đúng 1 poll cycle của Producer (600s), tránh bỏ sót data hợp lệ"
          headers={['Không có watermark', 'Với watermark 10 phút']}
          rows={[
            [
              'Spark giữ state cho tất cả windows chưa đóng → RAM tăng không giới hạn → OutOfMemory sau vài ngày chạy liên tục',
              'Spark chỉ giữ state cho windows trong vòng 10 phút qua event_time. State được released sau khi watermark vượt qua.',
            ],
            [
              'Data trễ luôn được xử lý — không sustainable với long-running streaming job',
              'Data trễ hơn 10 phút bị discard. Acceptable vì producer poll mỗi 10 phút — data không thể trễ hơn 1 poll cycle trong điều kiện mạng bình thường.',
            ],
          ]}
        />
      </SectionCard>

      {/* Query A */}
      <SectionCard>
        <SectionTitle>Query A — Window Aggregation</SectionTitle>
        <BodyText>
          Query A tính OHLCV rollups theo sliding window 20 phút với slide mỗi 5 phút. <Mono>sma_20</Mono> ở đây là giá trung bình trên <strong style={{ color: 'var(--text-primary)' }}>cửa sổ thời gian 20 phút</strong> (không phải trung bình 20 điểm dữ liệu). Vì producer poll mỗi 10 phút, mỗi cửa sổ chứa khoảng 2 điểm giá; slide 5 phút nhỏ hơn poll interval để giữ output cập nhật đều và linh hoạt nếu poll interval được giảm sau này. Kết quả ghi vào collection <Mono>window_stats</Mono>.
        </BodyText>
        <CodeBlock lang="python">{`windowed = parsed_df \\
    .groupBy(
        F.window("event_time", "20 minutes", "5 minutes"),  # 20-min window, 5-min slide
        "coin"
    ) \\
    .agg(
        F.avg("price_usd").alias("sma_20"),
        F.max("price_usd").alias("high_window"),
        F.min("price_usd").alias("low_window"),
        F.sum("volume_24h").alias("total_volume"),
        F.last("market_cap").alias("market_cap"),
    )

windowed.writeStream \\
    .trigger(processingTime="30 seconds") \\
    .outputMode("append") \\
    .foreachBatch(lambda df, id: write_batch(df, "window_stats", batch_id=id)) \\
    .option("checkpointLocation", f"{CHECKPOINT_DIR}/window_stats") \\
    .start()`}</CodeBlock>
        <Callout variant="info">
          <strong>Sliding vs Tumbling window:</strong> Window 20 phút slide mỗi 5 phút tạo ra overlap — về mặt hình học 1 event thuộc tối đa 4 windows chồng nhau (20 / 5 = 4). Khác tumbling window có biên cứng mỗi 20 phút, sliding window không reset đột ngột ở mốc cố định. Với poll 10 phút mỗi cửa sổ chỉ chứa ~2 điểm nên giá trị giữa các slide liền kề thay đổi ít. <Mono>outputMode("append")</Mono> phù hợp vì với watermark, mỗi window chỉ được output sau khi đóng, đảm bảo mỗi window chỉ xuất hiện một lần trong output stream.
        </Callout>
      </SectionCard>

      {/* Query B */}
      <SectionCard>
        <SectionTitle>Query B — Per-Record Enrichment</SectionTitle>
        <BodyText>
          Trong mỗi micro-batch, Query B nhận một static DataFrame và tính các technical indicators bằng PySpark Window Functions trên dữ liệu đã tích lũy. Đây là stateless computation — không giữ state giữa các micro-batch, khác với Query A có stateful aggregation.
        </BodyText>

        <DataTable
          caption="Tính bằng PySpark Window Functions trên mỗi micro-batch"
          headers={['Indicator', 'Loại', 'Công thức', 'Window', 'Ý nghĩa']}
          rows={[
            [
              <strong>SMA-5</strong>,
              <Tag variant="blue">Trend</Tag>,
              <Mono>avg(price_usd).over(Window.rowsBetween(-4, 0))</Mono>,
              '5 rows',
              'Short-term trend — phản ứng nhanh với biến động giá, ít smooth hơn SMA-20',
            ],
            [
              <strong>SMA-20</strong>,
              <Tag variant="blue">Trend</Tag>,
              <Mono>avg(price_usd).over(Window.rowsBetween(-19, 0))</Mono>,
              '20 rows',
              'Medium-term trend — ít noise hơn SMA-5, dùng cho Bollinger Bands midline',
            ],
            [
              <strong>RSI-14</strong>,
              <Tag variant="amber">Momentum</Tag>,
              '100 - 100/(1 + EMA14(U)/EMA14(D))',
              '14 rows',
              'Momentum oscillator [0,100]. >70: overbought (có thể sắp giảm), <30: oversold',
            ],
            [
              <strong>VWAP-60</strong>,
              <Tag variant="green">Volume</Tag>,
              'Σ(pᵢ × vᵢ) / Σ(vᵢ) over 60 rows',
              '60 rows',
              'Volume-weighted average price — institutional reference price cho intraday trading',
            ],
            [
              <strong>Bollinger-20</strong>,
              <Tag variant="purple">Volatility</Tag>,
              'SMA₂₀ ± 2σ₂₀',
              '20 rows',
              'Price channel: bb_upper, bb_mid, bb_lower. Giá vượt band là breakout signal',
            ],
          ]}
        />

        <SubTitle>Alert Logic — PRICE_SPIKE Events</SubTitle>
        <CodeBlock lang="python">{`# Sau khi tính indicators, scan batch cho price spikes
ALERT_THRESHOLD_PCT = 5.0  # 5%

alerts = batch.filter(F.abs(F.col("change_24h")) > ALERT_THRESHOLD_PCT)

if alerts.count() > 0:
    # Ghi vào MongoDB alerts collection
    upsert_alerts(alerts)
    # Đồng thời publish lên Kafka topic crypto_alerts
    for row in alerts.collect():
        kafka_producer.send("crypto_alerts", key=row["coin"],
                           value={"type": "PRICE_SPIKE", "change": row["change_24h"]})`}</CodeBlock>
      </SectionCard>

      {/* foreachBatch */}
      <SectionCard>
        <SectionTitle>foreachBatch Pattern — Exactly-Once Writes</SectionTitle>
        <BodyText>
          Pattern <Mono>foreachBatch</Mono> cho phép thực hiện các write operations tùy chỉnh thay vì dùng built-in streaming sinks. Quan trọng hơn, nó hỗ trợ exactly-once semantics thông qua cơ chế delete+insert với batch_id — đảm bảo không có duplicates dù micro-batch bị retry nhiều lần.
        </BodyText>
        <CodeBlock lang="python">{`def write_batch(batch_df: DataFrame, collection_name: str, batch_id: int):
    """
    Idempotent write: delete existing records for this batch_id,
    then insert new ones. Safe to retry.
    """
    records = batch_df.toPandas().to_dict("records")
    if not records:
        return

    col = db[collection_name]
    # Step 1: Remove any previous attempt with same batch_id (idempotent)
    col.delete_many({"batch_id": batch_id})
    # Step 2: Insert current batch
    for r in records:
        r["batch_id"] = batch_id
        r["created_at"] = datetime.utcnow()
    col.insert_many(records)`}</CodeBlock>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
          <div style={{ background: 'color-mix(in srgb, #22C55E 6%, var(--bg-card))', border: '1px solid color-mix(in srgb, #22C55E 20%, var(--border))', borderTop: '3px solid #22C55E', borderRadius: '8px', padding: '16px' }}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)', marginBottom: '8px' }}>Idempotency guarantee</div>
            <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.7, fontFamily: 'Plus Jakarta Sans' }}>
              Chạy lại cùng <Mono>batch_id</Mono> cho cùng kết quả. <Mono>delete_many(batch_id)</Mono> trước <Mono>insert_many</Mono> loại bỏ duplicates từ Spark retry một cách an toàn.
            </p>
          </div>
          <div style={{ background: 'color-mix(in srgb, #F87171 6%, var(--bg-card))', border: '1px solid color-mix(in srgb, #F87171 20%, var(--border))', borderTop: '3px solid #F87171', borderRadius: '8px', padding: '16px' }}>
            <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)', marginBottom: '8px' }}>Tại sao không dùng Connector?</div>
            <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.7, fontFamily: 'Plus Jakarta Sans' }}>
              <Mono>com.mongodb.spark</Mono> không ổn định trong streaming mode — checkpoint state bị corrupt sau restart. <Mono>foreachBatch</Mono> + PyMongo cho full control và dễ debug hơn.
            </p>
          </div>
        </div>

        <Callout variant="success">
          <strong>Tại sao foreachBatch thay vì MongoDB Spark Connector?</strong> MongoDB Spark Connector có vấn đề về checkpointing trong streaming mode — không ổn định với Spark Structured Streaming. <Mono>foreachBatch</Mono> gọi PyMongo trực tiếp, cho phép exactly-once semantics thông qua delete+insert với <Mono>batch_id</Mono>. Pattern này đảm bảo: nếu micro-batch bị retry, delete_many trước khi insert loại bỏ duplicates hoàn toàn.
        </Callout>
      </SectionCard>

      {/* Checkpoint */}
      <SectionCard>
        <SectionTitle accent="#F59E0B">Checkpoint và Fault Tolerance</SectionTitle>
        <DataTable
          caption="CANH BAO: Checkpoint ở /tmp — mất khi container restart. Production cần persistent volume (HDFS, S3, Docker named volume)."
          headers={['Query', 'Checkpoint Dir', 'Nội dung được lưu']}
          rows={[
            [
              'Query A (window_stats)',
              <Mono>/tmp/spark-checkpoints/window_stats</Mono>,
              'Lưu Kafka offset đã xử lý + window aggregation state. Khi restart, tiếp tục từ offset cũ mà không reprocess dữ liệu đã xử lý.',
            ],
            [
              'Query B (enrichment)',
              <Mono>/tmp/spark-checkpoints/enrichment</Mono>,
              'Lưu offset. Per-record enrichment không có stateful aggregation nên checkpoint nhỏ hơn đáng kể so với Query A.',
            ],
          ]}
        />
        <Callout variant="warning">
          <strong>Checkpoint ở /tmp:</strong> Mất khi container restart. Sau restart, Spark đọc lại từ <Mono>startingOffsets="latest"</Mono> — bỏ qua data trong thời gian downtime. Trong production, checkpoint nên ở persistent storage (HDFS, S3, hoặc Docker volume mount). Đây là trade-off được chấp nhận có ý thức cho demo setup nhằm đơn giản hóa cấu hình.
        </Callout>
      </SectionCard>

      {/* Technical indicators table */}
      <SectionCard>
        <SectionTitle>Các chỉ số kỹ thuật — Công thức chi tiết</SectionTitle>
        <DataTable
          headers={['Chỉ số', 'Loại', 'Công thức', 'Ý nghĩa thực tiễn']}
          rows={[
            [<strong>SMA-n</strong>, <Tag variant="blue">Trend</Tag>, '(1/n) × Σᵢ₌₀ⁿ⁻¹ p_{t-i}', 'Trung bình động n kỳ — lọc noise ngắn hạn, xác định xu hướng ngắn/trung hạn'],
            [<strong>RSI-14</strong>, <Tag variant="amber">Momentum</Tag>, '100 - 100/(1 + EMA14(U)/EMA14(D))', 'Sức mạnh tương đối [0–100]. >70: overbought, <30: oversold — tín hiệu đảo chiều tiềm năng'],
            [<strong>Bollinger Bands</strong>, <Tag variant="purple">Volatility</Tag>, 'SMA₂₀ ± 2σ₂₀', 'Dải giá ±2 std. Giá vượt band upper/lower = breakout signal. Band giãn nở = volatility tăng'],
            [<strong>VWAP</strong>, <Tag variant="green">Volume</Tag>, 'Σ(pᵢ × vᵢ) / Σ(vᵢ)', 'Giá trung bình có trọng số theo khối lượng — benchmark cho institutional traders và algo trading'],
          ]}
        />
        <Callout variant="info">
          <strong>RSI warmup limitation:</strong> RSI-14 cần đủ 14 data points để cho kết quả chính xác. Trong streaming mode, các record đầu tiên của session (khi chưa đủ data trong window) RSI sẽ không chính xác. Đây là inherent limitation của streaming calculation — batch layer tính RSI chính xác trên full history, còn streaming RSI là approximate phục vụ realtime display.
        </Callout>
      </SectionCard>
    </motion.div>
  );
}
