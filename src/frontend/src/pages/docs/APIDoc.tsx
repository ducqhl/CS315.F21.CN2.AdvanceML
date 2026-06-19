import { motion } from 'framer-motion';
import {
  PageHeader, SectionCard, SectionTitle, BodyText, Callout,
  CodeBlock, DataTable, Mono, StepList, Tag, CardGrid, InfoCard,
  GlossarySection, type GlossaryTerm,
} from './shared';

export default function APIDoc() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <PageHeader
        title="FastAPI Backend — Serving Layer"
        subtitle="src/api/main.py · port 8000 · JWT stateless authentication"
        badge="07"
        badgeColor="#6366F1"
      />

      {/* Trách nhiệm */}
      <SectionCard>
        <SectionTitle>Trách nhiệm</SectionTitle>
        <BodyText>
          FastAPI là lớp giao tiếp <strong style={{ color: 'var(--text-primary)' }}>duy nhất</strong> giữa MongoDB và các client (React Frontend). Nó xử lý authentication, truy vấn MongoDB, merge batch và speed views, và format JSON response cho từng endpoint. Không có cache layer — mỗi request là fresh MongoDB query, điều này chấp nhận được vì throughput thấp (poll 600 giây).
        </BodyText>
        <Callout variant="info">
          <strong>Sequence diagram request điển hình:</strong> React client gửi request với JWT token trong header → FastAPI middleware verify token signature và expiry → MongoDB query thực hiện → JSON response được format và trả về. Không có cache layer trung gian — fresh data mỗi request, phù hợp với throughput thấp của hệ thống này.
        </Callout>
      </SectionCard>

      {/* API Endpoints */}
      <SectionCard>
        <SectionTitle>API Endpoints</SectionTitle>
        <DataTable
          headers={['Method', 'Endpoint', 'Auth', 'MongoDB Source', 'Mô tả']}
          rows={[
            [<Tag variant="green">POST</Tag>, <Mono>/auth/login</Mono>, '—', '—', 'Đăng nhập, nhận JWT token (TTL 24h)'],
            [<Tag variant="green">POST</Tag>, <Mono>/auth/refresh</Mono>, 'JWT', '—', 'Refresh token trước khi hết hạn 24h'],
            [<Tag variant="blue">GET</Tag>, <Mono>/api/prices/realtime</Mono>, 'JWT', <Mono>realtime_prices</Mono>, 'Latest N ticks với enriched indicators từ Speed Layer'],
            [<Tag variant="blue">GET</Tag>, <Mono>/api/prices/historical</Mono>, 'JWT', <Mono>daily_stats</Mono>, 'Daily OHLCV từ Batch Layer (date range query)'],
            [<Tag variant="blue">GET</Tag>, <Mono>/api/indicators</Mono>, 'JWT', <Mono>realtime_prices</Mono>, 'RSI, MACD, Bollinger Bands, VWAP từ Speed Layer'],
            [<Tag variant="blue">GET</Tag>, <Mono>/api/correlation</Mono>, 'JWT', <Mono>coin_correlation</Mono>, 'Rolling BTC-DOGE Pearson correlation từ Batch Layer'],
            [<Tag variant="blue">GET</Tag>, <Mono>/api/predictions</Mono>, 'JWT', <Mono>predictions</Mono>, 'LSTM multi-horizon forecast (H7/H15/H60) + confidence band (volatility)'],
            [<Tag variant="blue">GET</Tag>, <Mono>/api/predictions/accuracy</Mono>, 'JWT', <Mono>predictions</Mono>, 'Historical accuracy tracking — so sánh dự đoán cũ vs giá thực'],
            [<Tag variant="blue">GET</Tag>, <Mono>/api/models</Mono>, 'JWT', '—', 'Model registry — list versions, metrics (RMSE, MAE, dir accuracy)'],
            [<Tag variant="green">POST</Tag>, <Mono>/api/model/retrain</Mono>, 'JWT', '—', 'Trigger on-demand LSTM retraining (chạy background job)'],
            [<Tag variant="blue">GET</Tag>, <Mono>/health</Mono>, '—', '—', 'Health check — Docker HEALTHCHECK endpoint'],
          ]}
        />
      </SectionCard>

      {/* JWT Auth Flow */}
      <SectionCard>
        <SectionTitle>JWT Authentication Flow</SectionTitle>
        <StepList steps={[
          {
            title: 'Client gửi POST /auth/login',
            body: 'FastAPI verify credentials so khớp với hardcoded admin credentials, tạo JWT token với payload {sub: user_id, exp: now + 24h}, ký bằng SECRET_KEY sử dụng HS256 algorithm. Token có TTL 24 giờ.',
          },
          {
            title: 'Client lưu token ở localStorage',
            body: 'React Frontend lưu token vào localStorage. Axios request interceptor tự động thêm Authorization: Bearer {token} vào mọi request tiếp theo. Client không cần quản lý token attachment thủ công.',
          },
          {
            title: 'FastAPI verify JWT mỗi request',
            body: 'Middleware decode token, verify signature với SECRET_KEY, kiểm tra expiry. Trả về 401 Unauthorized nếu token invalid, expired, hoặc missing. Mỗi request là stateless — server không lưu session.',
          },
          {
            title: 'Auto-refresh khi nhận 401',
            body: 'Axios response interceptor: nhận 401 → gọi POST /auth/refresh → lưu token mới vào localStorage → retry original request tự động. User không thấy interruption trong trải nghiệm sử dụng.',
          },
        ]} />
      </SectionCard>

      {/* JWT vs Session */}
      <SectionCard>
        <SectionTitle>JWT vs Session Authentication</SectionTitle>
        <DataTable
          headers={['JWT (dùng trong đề tài)', 'Session-based']}
          rows={[
            ['Stateless — server không lưu gì. Token là self-contained với đầy đủ thông tin authentication.', 'Stateful — server lưu session trong DB/Redis, cần lookup mỗi request.'],
            ['Scale horizontally dễ dàng — mọi FastAPI instance verify cùng SECRET_KEY, không cần shared state.', 'Scale phức tạp — cần shared session store (Redis) giữa các instances để đồng bộ.'],
            ['Cannot revoke ngay lập tức (phải đợi expire). TTL 24h là trade-off được chấp nhận.', 'Có thể delete session ngay lập tức khi user logout — revocation tức thì.'],
            ['Phù hợp cho SPA + REST API. Token ở client, không phụ thuộc cookie mechanism.', 'Phù hợp cho server-side rendered apps. Session ở server, cookie-based.'],
          ]}
        />
      </SectionCard>

      {/* Swagger UI */}
      <SectionCard>
        <SectionTitle>Swagger UI — Interactive Documentation</SectionTitle>
        <BodyText>
          FastAPI tự động generate Swagger UI (OpenAPI specification) tại <Mono>http://localhost:8000/docs</Mono>. Swagger UI cho phép test tất cả endpoints trực tiếp từ browser, kể cả các endpoint yêu cầu JWT (dùng nút "Authorize" để nhập Bearer token). Đây là công cụ quan trọng cho debugging và testing trong quá trình development.
        </BodyText>
        <BodyText>
          ReDoc alternative (tài liệu dạng đọc) có thể truy cập tại <Mono>http://localhost:8000/redoc</Mono>. Cả hai đều được tự động generate từ type annotations và Pydantic models trong source code — không cần viết documentation thủ công.
        </BodyText>
      </SectionCard>

      {/* Merge View */}
      <SectionCard>
        <SectionTitle>Merging Batch + Speed Views</SectionTitle>
        <BodyText>
          Một số endpoints merge dữ liệu từ cả batch layer và speed layer để cung cấp view đầy đủ nhất cho client. Pattern này là hiện thực hóa cốt lõi của Lambda Architecture serving layer — batch view cho historical accuracy, speed view cho realtime approximate data.
        </BodyText>
        <CodeBlock lang="python">{`@app.get("/api/prices/merged")
async def get_merged_prices(coin: str, days: int = 30, user = Depends(verify_jwt)):
    """
    Merge historical (batch) + realtime (speed) views.
    - Batch: daily_stats cho ngày trước (chính xác, đầy đủ)
    - Speed: realtime_prices cho hôm nay (approximate, low latency)
    """
    # Fetch historical from batch layer
    historical = db.daily_stats.find(
        {"coin_name": coin,
         "date": {"$gte": (datetime.now() - timedelta(days=days)).date().isoformat()}},
        sort=[("date", 1)]
    )

    # Fetch latest from speed layer
    realtime = db.realtime_prices.find_one(
        {"coin": coin.upper()},
        sort=[("event_time", -1)]
    )

    return {
        "historical": list(historical),
        "realtime":   realtime,
        "merged_at":  datetime.utcnow().isoformat()
    }`}</CodeBlock>
      </SectionCard>

      {/* Model Registry */}
      <SectionCard>
        <SectionTitle>Model Registry</SectionTitle>
        <BodyText>
          Endpoint <Mono>GET /api/models</Mono> trả về danh sách tất cả model versions đã train, kèm theo metrics đánh giá. Model registry cho phép track history của các lần training và so sánh performance giữa các versions để quyết định version nào được dùng cho inference.
        </BodyText>
        <CodeBlock lang="json">{`{
  "models": [
    {
      "model_id": "lstm_bitcoin_h7_v3",
      "coin": "bitcoin",
      "horizon": 7,
      "version": "v3",
      "trained_at": "2026-06-02T08:00:00Z",
      "metrics": {
        "rmse": 1799.50,
        "mae":  1288.92,
        "directional_accuracy": 0.611,
        "epochs_trained": 50
      },
      "artifact_path": "src/ml/model/lstm_bitcoin_h7_v3.pt",
      "scaler_path":   "src/ml/model/scaler_bitcoin_h7_v3.pkl"
    }
  ]
}`}</CodeBlock>
        <Callout variant="success">
          <strong>On-demand retrain:</strong> <Mono>POST /api/model/retrain</Mono> trigger LSTM retraining qua FastAPI, chạy training pipeline như background job. Kết quả được ghi vào model registry. React Frontend hiển thị version history và accuracy per fold trong Model Registry modal, cho phép user theo dõi và so sánh các lần training.
        </Callout>
      </SectionCard>

      {/* Inference Scheduler */}
      <SectionCard>
        <SectionTitle>Inference Scheduler</SectionTitle>
        <BodyText>
          Inference Scheduler chạy như background service độc lập với FastAPI, không qua API endpoint. Service có hai cadence: vòng lặp 5 phút chỉ refresh <Mono>live_prices</Mono> cho realtime frontend và xử lý on-demand predict/retrain từ API; còn ML inference theo lịch chạy 1 lần/ngày (cộng 1 lần lúc khởi động).
        </BodyText>
        <CardGrid cols={2}>
          <InfoCard title="Task 1 — Run Inference (daily)" accent="#5C8AFF">
            Load LSTM model từ disk tại <Mono>src/ml/model/lstm_bitcoin_h7_v3.pt</Mono> (và h15/h60), đọc ~60+30 ngày gần nhất từ MongoDB hoặc CSV, tính 9 features, forward pass cho cả 3 horizon (H7/H15/H60), rồi upsert prediction documents vào collection <Mono>predictions</Mono> với key (coin, prediction_date, horizon, model_id). Chu kỳ: 1 lần/ngày tại <Mono>DAILY_INFERENCE_HOUR</Mono> + 1 lần lúc khởi động. LSTM huấn luyện trên dữ liệu daily nên không infer ở độ phân giải 5 phút.
          </InfoCard>
          <InfoCard title="Task 2 — Track Accuracy (daily)" accent="#22C55E">
            So sánh các predictions của ngày hôm trước với giá thực tế. Tính directional accuracy rolling. Dữ liệu accuracy này được hiển thị trên trang Predictions của React Frontend để user có thể đánh giá hiệu quả của model qua thời gian. Chu kỳ: 1 lần/ngày (ngay sau daily inference).
          </InfoCard>
        </CardGrid>
      </SectionCard>

      <GlossarySection terms={API_GLOSSARY} />
    </motion.div>
  );
}

const API_GLOSSARY: GlossaryTerm[] = [
  { term: 'FastAPI', category: 'API', def: 'Python web framework hiệu năng cao, tự động generate OpenAPI docs. Dùng async/await để xử lý concurrent requests. Chạy ở port 8000.' },
  { term: 'JWT', category: 'API', def: 'JSON Web Token — chuỗi token mã hóa chứa thông tin user và thời hạn, được ký bằng SECRET_KEY. Stateless: server không cần lưu session, scale horizontally dễ dàng.' },
  { term: 'Bearer token', category: 'API', def: 'Kiểu authentication qua HTTP header: Authorization: Bearer <token>. Client gửi JWT token trong mỗi request để FastAPI verify. Không cần cookie hay session.' },
  { term: 'Stateless auth', category: 'API', def: 'Server không lưu session. Mọi thông tin cần thiết nằm trong JWT token. Không cần shared session store (Redis) khi scale. Trade-off: không thể revoke token ngay lập tức.' },
  { term: 'TTL', category: 'API', def: 'Time To Live — thời gian sống của JWT token. ACCESS_TOKEN_EXPIRE=1440 phút (24 giờ). Token hết hạn → user phải login lại. Trade-off chấp nhận được cho use case này.' },
  { term: 'OAuth2PasswordBearer', category: 'API', def: 'FastAPI dependency class chuẩn hóa việc extract Bearer token từ Authorization header và validate JWT. Dùng như Depends() trong route handler.' },
  { term: 'Pydantic', category: 'API', def: 'Thư viện validation data với Python type hints. FastAPI dùng Pydantic models (BaseModel) để validate request body và serialize response tự động.' },
  { term: 'CORS', category: 'API', def: 'Cross-Origin Resource Sharing — cơ chế browser cho phép frontend (port 3000) gọi API (port 8000) khác origin. CORSMiddleware config trong FastAPI cho phép các origin cụ thể.' },
  { term: 'Dependency Injection', category: 'API', def: 'Pattern FastAPI dùng Depends() để inject shared logic (verify token, get DB connection). Route handler nhận user đã verified mà không cần viết lại auth code.' },
  { term: 'REST endpoint', category: 'API', def: 'URL endpoint theo chuẩn REST: GET /api/prices/{coin} đọc giá, POST /api/predict/{coin} trigger inference on-demand. Verb HTTP phản ánh loại thao tác.' },
  { term: 'Inference on-demand', category: 'API', def: 'POST /api/predict/{coin} trigger LSTM inference ngay lập tức qua API. Inference Scheduler phục vụ request này trong vòng lặp 5 phút — không phải daily cadence.' },
  { term: 'Async/await', category: 'API', def: 'Python async programming: route handler có thể xử lý request khác trong khi chờ I/O (MongoDB query, file read). Tăng throughput mà không cần multi-threading phức tạp.' },
];
