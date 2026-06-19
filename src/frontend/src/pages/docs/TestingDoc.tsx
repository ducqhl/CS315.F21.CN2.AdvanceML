import { motion } from 'framer-motion';
import {
  PageHeader, SectionCard, SectionTitle, BodyText, Callout,
  CodeBlock, DataTable, Mono, CardGrid, InfoCard,
  GlossarySection, type GlossaryTerm,
} from './shared';

export default function TestingDoc() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <PageHeader
        title="E2E Testing Strategy"
        subtitle="tests/ — 3 layer E2E tests + 7 unit test suites · testcontainers"
        badge="09"
        badgeColor="#22C55E"
      />

      <Callout variant="info">
        <strong>Nguyên tắc thiết kế:</strong> E2E tests sử dụng infrastructure <em>thật</em> (Kafka container, MongoDB container thông qua testcontainers). Chỉ mock CoinGecko API để kiểm soát input data và tránh phụ thuộc vào network ngoài và quota API. Unit tests sử dụng mock và stub hoàn toàn, không yêu cầu infrastructure và có thể chạy trên bất kỳ máy nào.
      </Callout>

      {/* Test Pyramid */}
      <SectionCard>
        <SectionTitle>Test Pyramid</SectionTitle>
        <CardGrid cols={2}>
          <InfoCard title="Unit Tests — 7 suites" accent="#22C55E">
            <p style={{ margin: '0 0 10px' }}>Không cần Docker infrastructure. Chạy ngay với <Mono>make test</Mono>.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {[
                ['test_lstm.py', 'model forward pass, loss, output shapes'],
                ['test_indicators.py', 'SMA, RSI, VWAP, Bollinger correctness'],
                ['test_batch_job.py', 'aggregation logic'],
                ['test_producer.py', 'schema building, OHLC logic'],
                ['test_mongo_writer.py', 'upsert pattern'],
                ['test_dashboard.py', 'widget render, data loading'],
                ['test_accuracy_tracker.py', 'comparison logic, metric calculation'],
              ].map(([file, desc]) => (
                <div key={file} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  <Mono>{file}</Mono>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans', marginTop: '1px' }}>{desc}</span>
                </div>
              ))}
            </div>
          </InfoCard>
          <InfoCard title="E2E Tests — 3 suites" accent="#F59E0B">
            <p style={{ margin: '0 0 10px' }}>Cần Docker running. Đánh dấu <Mono>@pytest.mark.e2e</Mono>. Chạy với <Mono>make e2e</Mono>. Loại khỏi default pytest run.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {[
                ['test_producer_kafka.py', 'Layer 1: Producer → Kafka'],
                ['test_batch_mongo.py', 'Layer 2: Spark Batch → MongoDB'],
                ['test_ml_mongo.py', 'Layer 3: ML Pipeline → MongoDB'],
              ].map(([file, desc]) => (
                <div key={file} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  <Mono>{file}</Mono>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'Plus Jakarta Sans', marginTop: '1px' }}>{desc}</span>
                </div>
              ))}
            </div>
          </InfoCard>
        </CardGrid>
      </SectionCard>

      {/* Layer 1 */}
      <SectionCard>
        <SectionTitle>Layer 1: Producer → Kafka</SectionTitle>
        <BodyText>
          File <Mono>tests/e2e/test_producer_kafka.py</Mono> xác nhận CoinGecko Producer hoạt động đúng với Kafka broker thật được spin up bởi testcontainers. Producer chạy 1 poll cycle, sau đó Consumer đọc và verify messages. Test này là safety net quan trọng nhất chống schema regression — nếu Producer thay đổi field names, toàn bộ downstream pipeline sẽ thất bại.
        </BodyText>
        <DataTable
          headers={['Test Case', 'Assertion', 'Tại sao quan trọng']}
          rows={[
            [<Mono>test_produces_two_messages_per_cycle</Mono>, 'Đúng 2 messages: BTC + DOGE', 'Contract: mỗi cycle đúng 2 coin. Thêm coin sẽ exceed CoinGecko quota 10k/month.'],
            [<Mono>test_message_schema_is_complete</Mono>, '12 required fields có đủ', 'Spark Streaming CRYPTO_SCHEMA cần đủ fields — thiếu 1 field gây parse error downstream cho toàn bộ batch.'],
            [<Mono>test_only_btc_and_doge_produced</Mono>, 'Không có coin nào khác trong topic', 'Scope isolation — ETH hoặc coin khác không được phép vào pipeline này.'],
            [<Mono>test_ohlc_fields_populated_from_candles</Mono>, 'open/high/low/close từ OHLC data', 'OHLC fetch logic riêng biệt với price fetch — cần test độc lập.'],
            [<Mono>test_message_values_are_correct</Mono>, 'Giá trị khớp với mock CoinGecko data', 'End-to-end correctness: không có data corruption qua JSON serialization.'],
          ]}
        />
        <Callout variant="info">
          <strong>Tại sao test này quan trọng?</strong> Đây là điểm đầu vào duy nhất của dữ liệu. Schema contract giữa Producer và Spark Streaming Consumer phải được giữ chặt chẽ — nếu Producer thay đổi field names mà không cập nhật CRYPTO_SCHEMA, toàn bộ downstream pipeline thất bại một cách lặng lẽ. Test này là guardrail tự động phát hiện schema regression ngay khi có thay đổi.
        </Callout>
      </SectionCard>

      {/* Layer 2 */}
      <SectionCard>
        <SectionTitle>Layer 2: Spark Batch → MongoDB</SectionTitle>
        <BodyText>
          File <Mono>tests/e2e/test_batch_mongo.py</Mono> xác nhận Spark Batch Job tạo ra đúng aggregations và ghi vào MongoDB với schema và giá trị hợp lệ. MongoDB container được spin up qua testcontainers; batch job chạy trên test data; tất cả ba collections được verify cả về schema lẫn data quality.
        </BodyText>
        <DataTable
          headers={['Class', 'Test', 'Assertion']}
          rows={[
            [<strong>TestDailyStats</strong>, <Mono>test_row_count_positive</Mono>, 'Collection không rỗng sau batch job'],
            ['', <Mono>test_only_btc_and_doge</Mono>, 'Chỉ có BTC và DOGE, không có coin khác'],
            ['', <Mono>test_required_columns</Mono>, 'Schema: date, close, volume, avg_price, price_std đều tồn tại'],
            ['', <Mono>test_prices_are_positive</Mono>, 'Mọi close và volume > 0 — data quality check'],
            [<strong>TestHistoricalSma</strong>, <Mono>test_row_count_matches</Mono>, 'SMA row count = daily_stats row count (join không mất rows)'],
            ['', <Mono>test_has_sma_columns</Mono>, 'SMA-7, SMA-14, SMA-30, SMA-90 đều tồn tại'],
            ['', <Mono>test_only_btc_and_doge</Mono>, 'Coin scope nhất quán với daily_stats'],
            [<strong>TestCoinCorrelation</strong>, <Mono>test_exactly_one_pair</Mono>, 'Chỉ 1 pair BTC-DOGE trong collection'],
            ['', <Mono>test_pair_is_btc_doge</Mono>, 'Coin names: "bitcoin" và "dogecoin"'],
            ['', <Mono>test_pearson_value_in_range</Mono>, 'Pearson r ∈ [−1, 1] — mathematical constraint'],
            ['', <Mono>test_no_ethereum</Mono>, 'ETH không xuất hiện — scope isolation'],
          ]}
        />
      </SectionCard>

      {/* Layer 3 */}
      <SectionCard>
        <SectionTitle>Layer 3: ML Pipeline → MongoDB</SectionTitle>
        <BodyText>
          File <Mono>tests/e2e/test_ml_mongo.py</Mono> xác nhận toàn bộ ML pipeline: từ LSTM training, lưu artifacts, đến inference và ghi predictions vào MongoDB. Test này bao gồm cả việc kiểm tra tính idempotent của upsert operation — property thiết yếu cho production stability.
        </BodyText>
        <DataTable
          headers={['Class', 'Test', 'Assertion']}
          rows={[
            [<strong>TestLstmTraining</strong>, <Mono>test_training_returns_metrics</Mono>, 'Training pipeline trả về dict chứa RMSE, MAE, dir accuracy'],
            ['', <Mono>test_model_file_saved</Mono>, 'lstm_{coin}_v2.pt tồn tại tại đúng path'],
            ['', <Mono>test_scaler_file_saved</Mono>, 'scaler_{coin}.pkl tồn tại — cần cho inference inverse transform'],
            ['', <Mono>test_rmse_is_non_negative</Mono>, 'RMSE ≥ 0'],
            ['', <Mono>test_mae_is_non_negative</Mono>, 'MAE ≥ 0'],
            ['', <Mono>test_directional_accuracy_in_range</Mono>, 'Dir accuracy ∈ [0, 1]'],
            [<strong>TestInferenceToMongo</strong>, <Mono>test_writes_7_predictions</Mono>, 'Inference ghi đúng 7 documents (horizon = 7)'],
            ['', <Mono>test_prediction_document_schema</Mono>, 'Fields bắt buộc: coin, date, predicted_price, model_version'],
            ['', <Mono>test_predicted_prices_are_positive</Mono>, 'Mọi giá dự đoán > 0'],
            ['', <Mono>test_prediction_dates_are_in_future</Mono>, 'Các ngày dự đoán (HORIZON bước) đều sau ngày hiện tại'],
            ['', <Mono>test_prediction_dates_are_unique</Mono>, 'Không có ngày trùng — mỗi ngày chỉ 1 prediction/horizon'],
            ['', <strong><Mono>test_upsert_idempotency</Mono></strong>, 'Chạy inference 2 lần → số documents giữ nguyên (không nhân đôi)'],
          ]}
        />
        <Callout variant="warning">
          <strong>test_upsert_idempotency là test quan trọng nhất của Layer 3:</strong> Scheduled inference chỉ chạy 1 lần/ngày, nhưng cùng một (coin, ngày, horizon) vẫn bị ghi lại nhiều lần qua daily re-run, on-demand predict từ API, và bootstrap lúc container restart. Nếu không idempotent, các lần ghi này sẽ tích lũy duplicate. Upsert key (coin, prediction_date, horizon, model_id) + restart safety là property thiết yếu cho production stability.
        </Callout>
      </SectionCard>

      {/* Chạy Tests */}
      <SectionCard>
        <SectionTitle>Chạy Tests</SectionTitle>
        <CodeBlock lang="bash">{`# Unit tests (không cần Docker)
make test
pytest tests/ -v --ignore=tests/e2e

# Specific test suites
make test-producer      # test_producer.py only
make test-lstm          # test_lstm.py only
make test-batch         # test_batch_job.py only
make test-dashboard     # test_dashboard.py + test_indicators.py + test_mongo_writer.py

# E2E tests (cần Docker running)
make e2e
make e2e-layer-1        # Producer → Kafka only
make e2e-layer-2        # Spark Batch → MongoDB only
make e2e-layer-3        # ML Pipeline → MongoDB only

# Một test cụ thể
pytest tests/test_lstm.py::TestLSTMModel::test_forward -v

# Với coverage report
pytest tests/ --cov=src --cov-report=html
# → htmlcov/index.html`}</CodeBlock>
      </SectionCard>

      {/* Coverage Matrix */}
      <SectionCard>
        <SectionTitle>Ma trận Phủ Kiểm thử</SectionTitle>
        <DataTable
          headers={['Component', 'Unit Test', 'E2E Test', 'Property chính được verify']}
          rows={[
            ['Producer', 'test_producer.py', 'Layer 1', 'Schema message đủ 12 fields, OHLC logic (fetch mỗi 3 chu kỳ), giá trị khớp mock CoinGecko, coin scope chỉ BTC+DOGE'],
            ['Kafka delivery', '—', 'Layer 1', 'Message thực sự được delivered đến Kafka broker, consumer đọc và parse lại thành công — xác nhận serialization/deserialization'],
            ['Spark indicators', 'test_indicators.py', '—', 'SMA, RSI (Wilder EMA), VWAP (price×volume weighted), Bollinger Bands (SMA±2σ) — numerical correctness'],
            ['Spark Batch output', 'test_batch_job.py', 'Layer 2', 'Schema đủ fields, data quality (price >0), coin scope, value range hợp lệ'],
            ['MongoDB write pattern', 'test_mongo_writer.py', 'Layer 2, 3', 'Upsert idempotency, foreachBatch exactly-once semantics'],
            ['LSTM forward pass', 'test_lstm.py', '—', 'Output shape đúng (batch, HORIZON) cho cả hai heads, không có NaN/Inf trong predictions'],
            ['LSTM training', '—', 'Layer 3', 'Artifacts saved to disk, metrics in valid range'],
            ['Inference → MongoDB', '—', 'Layer 3', 'Đúng HORIZON predictions/model, mọi predicted_price >0, ngày unique, upsert idempotency'],
            ['Accuracy tracker', 'test_accuracy_tracker.py', '—', 'Comparison logic, metric calculation, rolling window tracking'],
            ['Dashboard', 'test_dashboard.py', '—', 'Widget render không có exception, data loading với mocked MongoDB, sidebar coin selector'],
          ]}
        />
      </SectionCard>

      {/* pytest.ini */}
      <SectionCard>
        <SectionTitle>pytest.ini Configuration</SectionTitle>
        <CodeBlock lang="ini">{`[pytest]
markers =
    e2e: marks tests as end-to-end (deselect with '-m not e2e')

# E2E tests excluded from default run
addopts = -m "not e2e"

testpaths = tests/
python_files = test_*.py
python_classes = Test*
python_functions = test_*`}</CodeBlock>
        <Callout variant="success">
          <strong>Design rationale:</strong> E2E tests dùng real Kafka/MongoDB containers (testcontainers) bởi vì mock không đủ. Mock Kafka chỉ verify rằng <Mono>producer.send()</Mono> được gọi với đúng arguments — không verify message thực sự được delivered và consumer có thể đọc lại. Schema mismatch và serialization bugs chỉ xuất hiện với real infrastructure, không xuất hiện khi chạy với mock.
        </Callout>
      </SectionCard>

      <GlossarySection terms={TESTING_GLOSSARY} />
    </motion.div>
  );
}

const TESTING_GLOSSARY: GlossaryTerm[] = [
  { term: 'Unit test', category: 'Testing', def: 'Test một function/class riêng lẻ trong môi trường cô lập. Dùng mock/stub để loại bỏ dependencies bên ngoài. Chạy nhanh, không cần infrastructure.' },
  { term: 'Integration test', category: 'Testing', def: 'Test sự phối hợp giữa nhiều component. E2E tests trong project là integration tests dùng real Kafka + MongoDB containers để verify toàn bộ pipeline.' },
  { term: 'E2E test', category: 'Testing', def: 'End-to-End test: kiểm tra toàn bộ luồng dữ liệu từ đầu đến cuối. Layer 1: Producer→Kafka→Consumer. Layer 2: Spark Batch→MongoDB. Layer 3: LSTM→MongoDB.' },
  { term: 'testcontainers', category: 'Testing', def: 'Thư viện Python tự động spin up Docker containers (Kafka, MongoDB) trong test, chạy test, rồi tear down. Real infrastructure, isolated, reproducible — mỗi test run sạch.' },
  { term: 'Mock', category: 'Testing', def: 'Object giả lập dependency bên ngoài. CoinGecko API được mock trong tests để kiểm soát input data, tránh network dependency và quota giới hạn.' },
  { term: 'Fixture', category: 'Testing', def: 'Pytest mechanism cung cấp dữ liệu hoặc object tái sử dụng cho nhiều tests. Kafka container, MongoDB client, sample message — định nghĩa một lần, inject vào mọi test cần.' },
  { term: 'pytest.mark.e2e', category: 'Testing', def: 'Custom pytest marker đánh dấu E2E tests. Mặc định bị skip trong pytest (addopts = --ignore-glob=tests/e2e*) — chỉ chạy khi có infrastructure thật.' },
  { term: 'Idempotency test', category: 'Testing', def: 'test_upsert_idempotency: chạy inference 2 lần → count documents giữ nguyên. Đảm bảo restart không tạo duplicate. Safety net quan trọng nhất của Layer 3.' },
  { term: 'Schema test', category: 'Testing', def: 'test_message_schema_is_complete: verify tất cả REQUIRED_FIELDS có mặt trong Kafka message. Phát hiện ngay khi CoinGecko API thay đổi response format.' },
  { term: 'Acceptance criteria', category: 'Testing', def: 'scripts/verify_acceptance.sh: chạy tất cả kiểm tra để verify hệ thống đáp ứng yêu cầu đồ án. Bao gồm: Kafka topics tồn tại, MongoDB có data, model artifacts có mặt.' },
  { term: 'pytest.ini', category: 'Testing', def: 'File cấu hình pytest: đăng ký custom markers (e2e), cấu hình addopts để exclude E2E tests mặc định, testpaths để tìm tests.' },
  { term: 'Coverage', category: 'Testing', def: 'Tỷ lệ % code được chạy bởi tests. Không phải mục tiêu tối thượng — 100% coverage không đảm bảo đúng behavior. Unit + integration tests quan trọng hơn con số coverage.' },
];
