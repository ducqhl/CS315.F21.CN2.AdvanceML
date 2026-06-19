import { motion } from 'framer-motion';
import {
  PageHeader, SectionCard, SectionTitle, BodyText, Callout,
  CodeBlock, DataTable, Mono, StepList,
  GlossarySection, type GlossaryTerm,
} from './shared';

export default function DeploymentDoc() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <PageHeader
        title="Docker Compose Deployment"
        subtitle="docker/docker-compose.yml — 11 services, health checks, dependency chain"
        badge="10"
        badgeColor="#22C55E"
      />

      {/* Service Dependency Chain */}
      <SectionCard>
        <SectionTitle>Service Dependency Chain</SectionTitle>
        <BodyText>
          Docker Compose quản lý dependency chain giữa các services thông qua điều kiện <Mono>condition: service_healthy</Mono> và <Mono>condition: service_started</Mono>. Điều kiện <Mono>service_healthy</Mono> đảm bảo service phụ thuộc chỉ start sau khi health check pass thành công — tránh race condition như Producer start trước khi Kafka sẵn sàng nhận connections.
        </BodyText>
        <CodeBlock>{`zookeeper
  └── kafka  (depends_on: zookeeper — condition: service_healthy)
        ├── kafka-ui
        └── producer  (depends_on: kafka — condition: service_healthy)

mongodb  (independent — no dependencies)
  ├── api        (depends_on: mongodb — condition: service_started)
  ├── dashboard  (depends_on: mongodb — condition: service_started)
  └── inference_scheduler  (depends_on: mongodb — condition: service_started)

spark-master  (independent)
  └── spark-worker  (depends_on: spark-master — condition: service_healthy)

api
  └── frontend  (depends_on: api — condition: service_started)`}</CodeBlock>
        <Callout variant="info">
          <strong>Health check conditions:</strong> <Mono>condition: service_healthy</Mono> đảm bảo service phụ thuộc chỉ start sau khi health check pass. Điều này tránh race condition nghiêm trọng như Producer start trước khi Kafka sẵn sàng nhận connections — nếu không có điều kiện này, Producer sẽ crash ngay khi startup vì không thể connect đến Kafka.
        </Callout>
      </SectionCard>

      {/* Service Table */}
      <SectionCard>
        <SectionTitle>11 Services — Chi tiết</SectionTitle>
        <DataTable
          headers={['Service', 'Image', 'Port (host)', 'Depends On (condition)', 'Health Check']}
          rows={[
            [<Mono>zookeeper</Mono>, 'confluentinc/cp-zookeeper:7.5.0', '2181', '—', 'ruok command'],
            [<Mono>kafka</Mono>, 'confluentinc/cp-kafka:7.5.0', '9092 (ext), 29092 (int)', 'zookeeper (healthy)', 'broker list check'],
            [<Mono>kafka-ui</Mono>, 'provectuslabs/kafka-ui:latest', '8080', 'kafka (started)', '—'],
            [<Mono>mongodb</Mono>, 'mongo:7.0', '27017', '—', 'mongosh --eval "db.adminCommand(\'ping\')"'],
            [<Mono>spark-master</Mono>, 'apache/spark:3.5.5', '8081 (UI), 7077', '—', 'HTTP /'],
            [<Mono>spark-worker</Mono>, 'apache/spark:3.5.5', '8082', 'spark-master (healthy)', 'HTTP /'],
            [<Mono>producer</Mono>, 'custom Python image', '—', 'kafka (healthy)', '—'],
            [<Mono>api</Mono>, 'custom FastAPI + uvicorn', '8000', 'mongodb (started)', 'GET /health → 200'],
            [<Mono>dashboard</Mono>, 'custom Streamlit', '8501', 'mongodb (started)', '—'],
            [<Mono>frontend</Mono>, 'React 19 + Nginx alpine', '3000', 'api (started)', '—'],
            [<Mono>inference_scheduler</Mono>, 'custom PyTorch + schedule', '—', 'mongodb (started)', '—'],
          ]}
        />
      </SectionCard>

      {/* Service URLs */}
      <SectionCard>
        <SectionTitle>Service URLs</SectionTitle>
        <DataTable
          headers={['Service', 'URL', 'Dùng để']}
          rows={[
            ['React Frontend', <a href="http://localhost:3000" target="_blank" rel="noopener noreferrer"><Mono>http://localhost:3000</Mono></a>, 'Giao diện chính — 5 trang phân tích, JWT auth'],
            ['FastAPI Swagger UI', <a href="http://localhost:8000/docs" target="_blank" rel="noopener noreferrer"><Mono>http://localhost:8000/docs</Mono></a>, 'Interactive API docs, test endpoints với JWT'],
            ['Kafka UI', <a href="http://localhost:8080" target="_blank" rel="noopener noreferrer"><Mono>http://localhost:8080</Mono></a>, 'Monitor Kafka topics, messages, consumer groups, offsets'],
            ['Spark Master UI', <a href="http://localhost:8081" target="_blank" rel="noopener noreferrer"><Mono>http://localhost:8081</Mono></a>, 'Spark job monitoring, workers status, active jobs'],
            ['MongoDB', <Mono>localhost:27017</Mono>, 'Direct connection (admin/password123) — MongoCompass, mongosh'],
          ]}
        />
      </SectionCard>

      {/* Quick Start */}
      <SectionCard>
        <SectionTitle>Quick Start — 6 Bước</SectionTitle>
        <StepList steps={[
          {
            title: 'Setup environment variables',
            body: (
              <CodeBlock lang="bash">{`cp .env.example .env
# Sửa COINGECKO_API_KEY trong .env`}</CodeBlock>
            ),
          },
          {
            title: 'Start tất cả services',
            body: (
              <CodeBlock lang="bash">{`make docker-up
# hoặc: docker compose -f docker/docker-compose.yml up -d
# Chờ ~60 giây cho Kafka/Zookeeper healthy`}</CodeBlock>
            ),
          },
          {
            title: 'Tạo Kafka topics',
            body: (
              <CodeBlock lang="bash">{`bash scripts/create_topics.sh
# Creates: crypto_raw, crypto_alerts`}</CodeBlock>
            ),
          },
          {
            title: 'Populate MongoDB với lịch sử',
            body: (
              <CodeBlock lang="bash">{`bash scripts/run_batch.sh
# Runs Spark Batch → populates daily_stats, historical_sma, coin_correlation`}</CodeBlock>
            ),
          },
          {
            title: 'Train LSTM và chạy inference',
            body: (
              <CodeBlock lang="bash">{`make infer-all
# hoặc: bash scripts/run_inference.sh
# Trains BTC + DOGE models → populates predictions collection`}</CodeBlock>
            ),
          },
          {
            title: 'Verify và access',
            body: (
              <CodeBlock lang="bash">{`bash scripts/verify_acceptance.sh
# Kiểm tra acceptance criteria
# Mở http://localhost:3000 để xem React Frontend`}</CodeBlock>
            ),
          },
        ]} />
      </SectionCard>

      {/* Common Commands */}
      <SectionCard>
        <SectionTitle>Common Commands</SectionTitle>
        <CodeBlock lang="bash">{`make docker-up      # Start tất cả 9 services
make docker-down    # Stop và remove containers
make docker-logs    # Follow logs tất cả services

make batch          # Submit Spark batch job (populate MongoDB)
make infer-all      # Train + infer cả BTC và DOGE
make train-btc      # Train BTC LSTM only
make train-doge     # Train DOGE LSTM only

make test           # Run unit tests (không cần Docker)
make e2e            # Run E2E tests (cần Docker running)
make e2e-layer-1    # Producer → Kafka only
make e2e-layer-2    # Spark Batch → MongoDB only
make e2e-layer-3    # ML Pipeline → MongoDB only`}</CodeBlock>
      </SectionCard>

      {/* Docker Volumes */}
      <SectionCard>
        <SectionTitle>Docker Volumes</SectionTitle>
        <DataTable
          headers={['Volume', 'Mount Point (container)', 'Dùng cho', 'Persistence']}
          rows={[
            [<Mono>mongodb_data</Mono>, '/data/db', 'MongoDB data — không mất khi container restart', 'Named volume, persistent'],
            [<Mono>./src</Mono>, '/app/src', 'Source code bind mount — hot reload trong dev', 'Bind mount'],
            [<Mono>./data</Mono>, '/app/data', 'CSV lịch sử + model artifacts (lstm_*.pt, scaler_*.pkl)', 'Bind mount'],
          ]}
        />
        <Callout variant="warning">
          <strong>Kafka checkpoint (/tmp):</strong> Spark checkpoint dir là <Mono>/tmp/spark-checkpoints</Mono> bên trong container — mất khi container restart. Sau restart, Spark đọc từ latest Kafka offset và bỏ qua data trong thời gian downtime. Production cần mount persistent volume cho checkpoint dir (HDFS, S3, hoặc Docker named volume).
        </Callout>
      </SectionCard>

      {/* Docker Compose vs Kubernetes */}
      <SectionCard>
        <SectionTitle>Tại sao Docker Compose thay vì Kubernetes?</SectionTitle>
        <BodyText>
          Lựa chọn Docker Compose là quyết định thiết kế có ý thức dựa trên quy mô và mục đích của đề tài. Kubernetes cung cấp nhiều tính năng powerful hơn nhưng kèm theo complexity vận hành không cần thiết cho single-machine deployment.
        </BodyText>
        <DataTable
          headers={['Docker Compose (chọn)', 'Kubernetes']}
          rows={[
            ['Single-machine deployment — phù hợp với laptop/server local, không cần cluster', 'Multi-node cluster management — overkill cho single machine, cần ít nhất 3 nodes cho HA'],
            ['Đơn giản: 1 file YAML, make docker-up — toàn bộ hệ thống start trong 2 lệnh', 'Phức tạp: manifests, services, ingress, PVC, secrets management, RBAC...'],
            ['Learning curve thấp — không che khuất Lambda Architecture concepts chính của đề tài', 'Learning curve cao — K8s complexity che khuất mục tiêu học tập và làm demo khó hơn'],
            ['Migration path rõ ràng: Docker Compose → Docker Swarm → Kubernetes khi cần scale', 'Phù hợp cho production scale thực, multi-datacenter, hàng nghìn users'],
          ]}
        />
      </SectionCard>

      {/* Hardware */}
      <SectionCard>
        <SectionTitle>Cấu hình phần cứng thực nghiệm</SectionTitle>
        <div style={{
          background: 'color-mix(in srgb, #5C8AFF 5%, var(--bg-card))',
          border: '1px solid color-mix(in srgb, #5C8AFF 18%, var(--border))',
          borderTop: '3px solid #5C8AFF',
          borderRadius: '8px', padding: '16px',
        }}>
          <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: '13.5px', color: 'var(--text-primary)', marginBottom: '12px' }}>
            Môi trường thực nghiệm
          </div>
          <DataTable
            headers={['Thông số', 'Giá trị']}
            rows={[
              ['CPU', 'Intel Core i7 (8 cores)'],
              ['RAM', '16 GB'],
              ['Storage', 'SSD'],
              ['GPU', 'Không cần — LSTM train trên CPU (~3.000 samples nhỏ)'],
              ['OS', 'macOS Darwin / Linux'],
            ]}
          />
        </div>
        <Callout variant="info">
          <strong>LSTM training trên CPU:</strong> Dataset chỉ khoảng 3.000 samples sau sliding window, model có khoảng 220K parameters. Thời gian training: 2 đến 5 phút cho mỗi coin trên CPU. GPU không cần thiết và không cải thiện đáng kể thời gian training cho dataset size này — GPU sẽ bắt đầu có lợi khi dataset lớn hơn 10 lần.
        </Callout>
      </SectionCard>

      <GlossarySection terms={DEPLOY_GLOSSARY} />
    </motion.div>
  );
}

const DEPLOY_GLOSSARY: GlossaryTerm[] = [
  { term: 'Docker', category: 'Docker', def: 'Nền tảng container hóa. Đóng gói ứng dụng + dependencies vào container cô lập. Chạy nhất quán trên mọi máy dù OS hay môi trường khác nhau.' },
  { term: 'Docker Compose', category: 'Docker', def: 'Tool định nghĩa và chạy nhiều container cùng lúc qua file YAML. docker-compose.yml định nghĩa 11 services với network, volume, port, health check.' },
  { term: 'Container', category: 'Docker', def: 'Môi trường chạy cô lập cho một service. Có filesystem, network, process namespace riêng. Nhẹ hơn VM vì dùng chung kernel host.' },
  { term: 'Image', category: 'Docker', def: 'Template bất biến để tạo container. Được build từ Dockerfile, gồm nhiều layers. Mỗi service có image riêng (python:3.10, bitnami/kafka, nginx:alpine...).' },
  { term: 'Volume', category: 'Docker', def: 'Cơ chế lưu data persistent ngoài container. mongodb_data, kafka_data, spark_checkpoint: mất container nhưng data vẫn còn. Không dùng volume → data mất khi restart.' },
  { term: 'depends_on', category: 'Docker', def: 'Khai báo thứ tự khởi động: service này chỉ start sau khi service kia healthy. Ví dụ: producer depends_on kafka, spark depends_on mongodb.' },
  { term: 'Health check', category: 'Docker', def: 'Lệnh Docker chạy định kỳ để kiểm tra service đang hoạt động. depends_on kết hợp condition: service_healthy để đảm bảo chờ đúng đến khi service thực sự sẵn sàng.' },
  { term: 'Nginx', category: 'Docker', def: 'Web server kiêm reverse proxy cho React Frontend. Phục vụ static files (JS/CSS), cấu hình SPA routing (redirect về index.html), proxy /api/ đến FastAPI.' },
  { term: 'Multi-stage build', category: 'Docker', def: 'Dockerfile dùng nhiều stage: stage 1 build (Node.js + npm build), stage 2 serve (chỉ copy dist/ vào Nginx image). Image production nhỏ hơn nhiều — không có Node.js, source code.' },
  { term: 'restart policy', category: 'Docker', def: 'unless-stopped: container tự khởi động lại sau crash hoặc machine reboot. Trừ khi bị stop thủ công (docker stop). Đảm bảo service luôn chạy trong production.' },
  { term: '.env file', category: 'Docker', def: 'File chứa environment variables nhạy cảm (API keys, passwords). Không commit vào git. Docker Compose đọc từ .env và inject vào containers qua env_file:.' },
  { term: 'Zookeeper', category: 'Docker', def: 'Service coordination cho Kafka (Kafka 2.x cần Zookeeper quản lý broker metadata và leader election). Kafka 3.x+ có KRaft mode không cần Zookeeper.' },
  { term: 'Kafka UI', category: 'Docker', def: 'Web UI tại port 8080 để monitor Kafka topics, xem messages, consumer groups. Tiện lợi cho debug khi producer ghi hay streaming có vấn đề.' },
];
