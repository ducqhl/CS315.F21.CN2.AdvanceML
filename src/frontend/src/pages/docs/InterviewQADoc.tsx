import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { PageHeader, SectionCard, SectionTitle, Callout } from './shared';

interface QA {
  q: string;
  category: string;
  answer: string[];
}

const QA_DATA: QA[] = [
  // ─── Kiến trúc Hệ thống ───────────────────────────────────────────────────
  {
    category: 'Kiến trúc Hệ thống',
    q: '1. Tại sao chọn Lambda Architecture thay vì Kappa Architecture?',
    answer: [
      'LSTM cần batch training nhất quán: Mô hình cần rolling window 730 ngày được preprocessing với cùng StandardScaler fit một lần trên fixed dataset. Stream processing fit scaler incremental dẫn đến scaler thay đổi theo thời gian, khiến model inference sai khi giá trị mới ra ngoài range training.',
      'Chi phí reprocessing không cần thiết: SMA-90 và rolling correlation 30 ngày phải scan 4.165 ngày mỗi khi có update mới. Với Batch Layer, tính một lần mỗi ngày và cache trong MongoDB — tính một lần, phục vụ nhiều lần, không lãng phí tài nguyên tính toán.',
      'Hai SLA khác nhau: Historical correlation (batch) cần correctness trên full dataset. Realtime RSI/VWAP (speed) cần latency dưới 1 giây. Một hệ thống không thể đáp ứng cả hai — Lambda giải quyết độc lập.',
    ],
  },
  {
    category: 'Kiến trúc Hệ thống',
    q: '2. Tại sao dùng foreachBatch thay vì MongoDB Spark Connector?',
    answer: [
      'MongoDB Spark Connector vấn đề checkpointing: com.mongodb.spark không ổn định trong Spark Structured Streaming mode — checkpoint state bị corrupt sau restart.',
      'foreachBatch + PyMongo = exactly-once: Pattern delete_many(batch_id) → insert_many. Nếu micro-batch bị retry (Spark failure), delete trước khi insert loại bỏ duplicates. Chạy lại với cùng batch_id cho kết quả y hệt — idempotent hoàn toàn.',
      'Kiểm soát tốt hơn: Retry logic, error handling, schema validation nằm trong Python code — dễ debug và test. Không phụ thuộc vào Spark Connector configuration phức tạp.',
    ],
  },
  {
    category: 'Kiến trúc Hệ thống',
    q: '3. Tại sao dùng MongoDB thay vì PostgreSQL hoặc Cassandra?',
    answer: [
      'Flexible schema: Các collections có document structure khác nhau (realtime_prices 18 fields, predictions 7 fields, alerts 5 fields). MongoDB không cần ALTER TABLE khi thêm field mới — đặc biệt hữu ích khi schema thay đổi trong quá trình development.',
      'Single serving store: Đơn giản hóa vận hành — không phải maintain 2-3 databases với sync logic phức tạp. Tất cả writers và readers dùng cùng 1 connection string.',
      'Throughput thấp nên MongoDB đủ: Với poll interval 600 giây, chỉ có 2 messages mỗi 10 phút cho mỗi coin. Không cần time series database chuyên dụng như InfluxDB hay Cassandra.',
      'Giới hạn được thừa nhận: Nếu scale lên hàng triệu ticks mỗi ngày, InfluxDB hoặc Cassandra phù hợp hơn cho time series workload. Đây là trade-off có ý thức cho demo setup.',
    ],
  },
  {
    category: 'Kiến trúc Hệ thống',
    q: '4. Tại sao Kafka cần acks=all? Acks=1 không đủ sao?',
    answer: [
      'acks=1 vấn đề: Leader broker xác nhận nhận message nhưng chưa chắc đã replicate đến ISR. Nếu leader crash trước khi replicate, message mất vĩnh viễn — không thể recover.',
      'acks=all đảm bảo: Tất cả ISR (In-Sync Replicas) xác nhận → message không mất dù leader crash sau khi acknowledge. Đây là cấu hình phù hợp cho dữ liệu tài chính critical.',
      'Hậu quả mất tick giá: Gap trong time series → SMA-5 tính trên 4 điểm thay vì 5 → sai. RSI-14 trên 13 điểm → sai. Các indicators downstream đều bị ảnh hưởng theo dây chuyền.',
      'Kết hợp max_in_flight_requests_per_connection=1: Đảm bảo message ordering khi retry. Nếu để >1 và retry xảy ra, messages có thể đến sai thứ tự thời gian.',
    ],
  },
  {
    category: 'Kiến trúc Hệ thống',
    q: '5. Watermark 10 phút trong Spark Streaming có nghĩa gì? Tại sao 10 phút?',
    answer: [
      'Watermark định nghĩa: Spark chấp nhận xử lý data trễ tối đa 10 phút sau event_time đã qua. Data trễ hơn 10 phút bị discard hoàn toàn và không được xử lý.',
      'Không có watermark → OOM: Spark giữ state cho tất cả windows chưa đóng → RAM tăng không giới hạn → OutOfMemory sau vài ngày running liên tục.',
      'Tại sao 10 phút: Producer poll mỗi 600 giây (10 phút). Nếu một poll bị delay vì network chậm, data sẽ đến trễ tối đa khoảng 1 poll cycle. Watermark = poll interval = không bỏ sót data hợp lệ trong điều kiện mạng bình thường.',
    ],
  },
  // ─── Machine Learning ─────────────────────────────────────────────────────
  {
    category: 'Machine Learning',
    q: '6. Tại sao dùng LSTM thay vì Transformer/BERT cho time series?',
    answer: [
      'Dataset quá nhỏ cho Transformer: Chỉ có khoảng 4.000 ngày lịch sử tương đương khoảng 3.000 training samples sau sliding window. Transformer cần 10k+ samples để train hiệu quả và không bị overfit nghiêm trọng.',
      'Sequential inductive bias: LSTM có built-in assumption rằng data là sequential — đúng với time series tài chính. Transformer phải học temporal ordering từ đầu qua positional encoding, tốn thêm capacity.',
      'Complexity phù hợp: LSTM 2 lớp khoảng 220K params phù hợp với dataset size. Transformer tương đương sẽ overfit trầm trọng với ít data như vậy.',
      'Hướng cải tiến: Temporal Fusion Transformer (TFT) có attention mechanism giải thích được, phù hợp cho bài toán tài chính khi có nhiều data hơn. Đây là hướng phát triển tiếp theo tự nhiên.',
    ],
  },
  {
    category: 'Machine Learning',
    q: '7. Tại sao dùng MIMO thay vì Autoregressive forecasting?',
    answer: [
      'Autoregressive tích lũy lỗi: Predict t+1, dùng làm input cho t+2, và tiếp tục. Nếu t+1 sai 2%, t+7 có thể sai 14% do error propagation. Với crypto volatile, lỗi nhỏ ban đầu phóng đại rất nhanh.',
      'MIMO (Multiple Input Multiple Output): Predict tất cả 7 steps trong 1 forward pass từ h_T. Không có error accumulation — tất cả predictions độc lập nhau và được tính đồng thời.',
      'Confidence interval từ Volatility Head: MIMO + Volatility Head cho confidence band cho cả 7 steps trong 1 forward pass. Autoregressive phải làm nhiều forward passes để estimate uncertainty.',
      'Trade-off: MIMO không cho per-step uncertainty từ chính LSTM encoder. Volatility Head bù đắp bằng cách predict confidence band riêng biệt từ cùng hidden state h_T.',
    ],
  },
  {
    category: 'Machine Learning',
    q: '8. Tại sao Walk-Forward thay vì K-Fold Cross-Validation?',
    answer: [
      'K-Fold gây temporal leakage: Shuffle ngẫu nhiên → fold train trên data tháng 6/2025, test trên tháng 3/2025 → model nhìn thấy tương lai khi training. Directional accuracy khoảng 65-70% với K-Fold là ảo, không phản ánh performance thực tế.',
      'Walk-Forward tôn trọng thứ tự thời gian: Fold k luôn train trên [t0, tk), validate trên [tk, tk+delta). Không có overlap và không có temporal leakage — phản ánh đúng điều kiện production.',
      'Rolling window 730 ngày: Simulate realistic production scenario — model chỉ dùng 2 năm data gần nhất, không expand vô hạn. Phù hợp với đặc tính crypto thay đổi regime nhanh.',
      'Số liệu thực tế: Walk-forward cho 49.4% dir acc (realistic), backtest trên 6 tháng unseen data cho 61.1%. Hai kết quả này cùng nhau cho đánh giá toàn diện về performance thực tế.',
    ],
  },
  {
    category: 'Machine Learning',
    q: '9. Tại sao dùng log_return thay vì price trực tiếp làm feature và target?',
    answer: [
      'Price không dừng (non-stationary): ADF test BTC price → p-value = 0.683 → không reject unit root hypothesis → random walk. LSTM train trên non-stationary series không generalize tốt sang period mới.',
      'Log-return dừng mạnh: ADF test BTC log-return → p ≈ 0 → strongly stationary. Model có thể học patterns ổn định, không bị drift theo trend tổng thể của giá theo thời gian.',
      'Cộng dồn được (additive): R(t, t+k) = Σ r(t+i) — dễ reconstruct price USD từ cumulative log-returns: price_t+k = last_price × exp(cumsum(log_returns)).',
      'Đơn vị tương đối và scale-invariant: Return 5% có cùng ý nghĩa dù giá $100 hay $100.000. Giúp model generalize qua các mức giá rất khác nhau trong lịch sử 11 năm của BTC.',
    ],
  },
  {
    category: 'Machine Learning',
    q: '10. Tại sao dùng StandardScaler thay vì MinMaxScaler?',
    answer: [
      'MinMaxScaler giới hạn range [0,1]: Dựa trên min/max trong training set. Nếu test set có giá trị ngoài range (BTC đạt đỉnh mới $124.753, vượt max training), feature sẽ có giá trị >1 hoặc <0 — LSTM không thấy pattern này khi training.',
      'StandardScaler (z-score) robust hơn: Dựa trên mean và std. Giá trị ngoài training range vẫn có z-score hợp lý (z=3 nghĩa là 3 std above mean) — LSTM vẫn hiểu được vị trí tương đối của giá trị.',
      'Crypto có outlier mạnh: DOGE kurtosis 77.02 — rất nhiều extreme values. StandardScaler ít bị ảnh hưởng bởi outlier hơn MinMaxScaler vốn bị distort bởi max value extreme.',
      'Scaler fit chỉ trên train: Val và test được transform bằng scaler của train tương ứng — tránh look-ahead bias từ future statistics khi fit scaler trên toàn bộ dataset.',
    ],
  },
  {
    category: 'Machine Learning',
    q: '11. Tại sao sequence length = 60? Tại sao không 30 hoặc 90?',
    answer: [
      '60 ngày ≈ 2 tháng: Capture được short-term momentum (1-2 tuần) và medium-term trend (1-2 tháng). Với crypto, market cycle thường kéo dài 4-8 tuần — 60 ngày đủ để capture đầy đủ context.',
      'Trade-off: Quá ngắn (30 ngày) → không đủ context cho trend. Quá dài (120 ngày) → nhiều noise từ distant past, Backpropagation Through Time khó hơn, training chậm hơn đáng kể.',
      'Practical constraint: SMA-30 warmup cần 30 rows. seq_len=60 yêu cầu load 60+30=90 rows mỗi inference. Balanced giữa information richness và computational cost.',
      'Adaptive seq_len: Cho horizon 15 ngày, dùng seq_len=90. Cho horizon 60 ngày, seq_len=120 — HORIZON_SEQ_LEN_MAP adaptive theo forecast horizon được cấu hình trong code.',
    ],
  },
  {
    category: 'Machine Learning',
    q: '12. Tại sao Softplus trong Volatility Head thay vì ReLU hoặc e^x?',
    answer: [
      'Volatility phải > 0: Standard deviation luôn dương — output âm từ model là phi lý về mặt thống kê.',
      'ReLU vấn đề dying neurons: ReLU = max(0, x) → gradient = 0 khi x < 0. Nếu nhiều activations âm, neurons "chết" và không update nữa — Volatility Head không học được.',
      'e^x vấn đề overflow: Với x lớn (ví dụ x=100), e^100 = 2.7e43 → NaN trong float32. Numerically unstable và gây training crash.',
      'Softplus = ln(1+e^x): Luôn > 0. Gradient = sigmoid(x) → luôn khác 0 (không có dying neurons). Smooth không có kink tại 0. Numerically stable — không overflow trong float32.',
    ],
  },
  {
    category: 'Machine Learning',
    q: '13. fear_greed = 0.5 constant — đây có phải vấn đề nghiêm trọng không?',
    answer: [
      'Thừa nhận thẳng thắn: Đây là placeholder được biết rõ. Feature không đóng góp thông tin thực sự vào model và đây là điểm yếu được thừa nhận công khai trong báo cáo.',
      'Tác động thực tế tối thiểu: Sau StandardScaler, constant feature có std=0 → z-score = 0 với mọi giá trị. Model học weight ≈ 0 cho feature này. Xóa feature 8 sẽ không làm giảm performance đáng kể.',
      'Giải pháp: Tích hợp Alternative.me Fear & Greed Index API (1 call/ngày, miễn phí). Hoặc tính proxy từ price và volume (high realized vol → fear, giá tăng mạnh → greed).',
      'Lý do giữ lại: Giữ N_FEATURES=9 nhất quán, placeholder cho future improvement. Software engineering decision để không phải thay đổi model architecture khi tích hợp feature thực sau.',
    ],
  },
  {
    category: 'Machine Learning',
    q: '14. Model đạt 61.1% directional accuracy — điều này có ý nghĩa thực tiễn không?',
    answer: [
      'Statistical significance: 18 windows là sample nhỏ. Confidence interval rộng. Cần 50+ windows để kết luận chắc chắn về edge >50% với độ tin cậy thống kê cao.',
      'Vượt random 11.1 điểm %: 61.1% so với 50% random baseline. Mean Error = 0.37% — không có systematic bias theo một chiều (bias có thể exploit làm profitable signal).',
      'Practical trading caveat: Edge 11% không đủ profitable sau transaction costs và slippage trong thực tế. Nhưng có thể dùng như một signal trong ensemble strategy với nhiều model khác.',
      'Honest evaluation: Backtest với hindsight bias — thực tế deploy sẽ thấp hơn do market conditions thay đổi. Inference Scheduler track accuracy rolling theo thời gian thực — đây là honest long-term evaluation.',
    ],
  },
  {
    category: 'Machine Learning',
    q: '15. Tại sao chọn 9 features? Cơ sở gì để chọn bộ này?',
    answer: [
      'Mỗi feature nhóm nắm bắt một khía cạnh khác nhau: Momentum (log_return_1d, momentum_30d), Volatility (realized_vol_14d, atr_norm), Oscillator (RSI_14, macd_norm, bb_pct_b), Volume (log_volume), Sentiment (fear_greed).',
      'Tính dừng: Tất cả features (trừ fear_greed constant) đều dừng hoặc bounded — đảm bảo mô hình học patterns ổn định và không bị ảnh hưởng bởi non-stationarity.',
      'Ít redundancy: Correlation matrix cho thấy hầu hết features có r thấp với nhau. Ngoại lệ: atr_norm và realized_vol_14d có r≈0.7 — chấp nhận được vì đo volatility ở thang thời gian khác nhau.',
      'v3 thay đổi so với v2: Thêm realized_vol_14d (input cho Volatility Head), thay log_return_7d bằng momentum_30d (ít redundancy hơn với log_return_1d).',
    ],
  },
  // ─── Dữ liệu ─────────────────────────────────────────────────────────────
  {
    category: 'Dữ liệu và Feature Engineering',
    q: '16. Tại sao chọn BTC và DOGE? Tại sao không thêm ETH?',
    answer: [
      'Rate limiting CoinGecko demo tier: 10.000 calls/month. BTC + DOGE: 7.200 calls/month (72% budget). Thêm ETH sẽ thêm khoảng 2.160 price và 1.440 OHLC = 3.600 calls → exceed quota và gây 429 errors thường xuyên.',
      'Tương quan thú vị cho phân tích: BTC-DOGE r = 0.528 — có tương quan dương vừa phải nhưng DOGE có dynamics riêng (pump độc lập). Đủ để phân tích correlation meaningfully với kết quả thú vị.',
      'Contrast rõ ràng: BTC = store of value (serious crypto), DOGE = meme coin. Hai loại tài sản rất khác nhau về risk profile, kurtosis (11.11 vs 77.02), max drawdown (-83.64% vs -92.21%).',
      'ETH có thể thêm: Bằng cách tăng poll interval lên 900 giây hoặc upgrade lên Paid tier. Đây là natural extension được lên kế hoạch cho version tiếp theo.',
    ],
  },
  {
    category: 'Dữ liệu và Feature Engineering',
    q: '17. Tại sao kiểm định ADF quan trọng với bài toán này?',
    answer: [
      'Non-stationary series → model không generalize: Nếu price series có trend (BTC: ADF p=0.683, không dừng), LSTM học "trend chung" thay vì "pattern" → overfit vào mean level của training period và fail khi giá ở mức mới.',
      'Log-return stationary: ADF p≈0 cho cả BTC và DOGE log-return. Model học trên stationary space → features có distribution ổn định qua thời gian → generalize tốt hơn sang period mới.',
      'DOGE special case: ADF p=0.0105 cho DOGE price — "dừng" theo test nhưng đây là artifact của các pump đột biến gây mean-reverting behavior trong statistical sense. Log-return (p≈0) là không gian an toàn hơn.',
    ],
  },
  {
    category: 'Dữ liệu và Feature Engineering',
    q: '18. Adaptive-threshold labelling là gì? Tại sao không dùng ngưỡng tuyệt đối (UP = return > 0)?',
    answer: [
      'Class imbalance với ngưỡng tuyệt đối: Nếu UP = return > 0, và mean log-return = +0.0014 (dương nhỏ), thì UP chiếm hơn 50% ngày. Class imbalance khiến model bias về một chiều và directional accuracy ảo.',
      'Adaptive-threshold theo median: y_dir[k] = UP nếu y[k] > median(y_train[:, k]). Median chia dataset đúng 50-50 → balanced classes → model không bias theo hướng tăng hay giảm.',
      'Hệ quả cần lưu ý: UP/DOWN là tương đối so với median của training set, không phải tăng/giảm giá tuyệt đối. Điều này cần lưu ý khi diễn giải directional accuracy — "đúng chiều" có nghĩa là "cao hơn/thấp hơn mức trung bình lịch sử".',
    ],
  },
  // ─── Spark & Data Processing ──────────────────────────────────────────────
  {
    category: 'Spark & Data Processing',
    q: '19. Spark Streaming dùng outputMode gì? Tại sao?',
    answer: [
      'Query A và B đều dùng outputMode("append"). Với watermark, window chỉ output sau khi đóng (sau event_time + watermark delay). Mỗi window và record chỉ được output một lần duy nhất — đây là semantics append.',
      'outputMode("complete") không phù hợp: Re-output toàn bộ aggregation state mỗi micro-batch → volume tăng không giới hạn theo thời gian → không scalable cho long-running job.',
      'outputMode("update") có thể dùng: Chỉ output rows đã thay đổi. Nhưng append với watermark đơn giản hơn, đủ cho use case này, và dễ debug hơn.',
    ],
  },
  {
    category: 'Spark & Data Processing',
    q: '20. Tại sao Spark Streaming trigger processingTime 30 giây?',
    answer: [
      'Producer poll mỗi 600 giây: Trong 30 giây thường không có data mới → micro-batch rỗng hoặc rất nhỏ. 30 giây là trigger interval hợp lý để balance giữa latency và overhead.',
      'Giảm xuống 5 giây sẽ tệ hơn: Overhead của nhiều micro-batch trống (29/30 batches trống). Mỗi batch có context switching, checkpoint, network overhead dù không có data.',
      'Tăng lên 60 giây: Latency hiển thị cao hơn nhưng không có benefit rõ ràng vì producer vẫn chỉ poll 600 giây — data không đến thường xuyên hơn.',
      'Với WebSocket tick-by-tick data: Có thể dùng continuous trigger với micro-batch thật sự nhỏ. Với poll-based ingestion 600 giây, processingTime trigger hợp lý hơn nhiều.',
    ],
  },
  // ─── API & Infrastructure ─────────────────────────────────────────────────
  {
    category: 'API & Infrastructure',
    q: '21. Tại sao JWT thay vì Session-based authentication?',
    answer: [
      'Stateless: JWT không cần server lưu session state → không cần shared session store (Redis) giữa FastAPI instances → scale horizontally dễ dàng.',
      'Microservices ready: Nếu thêm service mới cần auth, chỉ cần share SECRET_KEY — không cần centralized session DB. Phù hợp với kiến trúc phân tán.',
      'Mobile/SPA friendly: Token lưu ở client (localStorage), không phụ thuộc cookie mechanism. Phù hợp cho React SPA và mobile apps.',
      'Trade-off được thừa nhận: JWT không thể revoke ngay lập tức — phải đợi expire. TTL 24 giờ là acceptable trade-off cho use case này — không phải banking application yêu cầu revocation tức thì.',
    ],
  },
  {
    category: 'API & Infrastructure',
    q: '22. Tại sao Docker Compose thay vì Kubernetes?',
    answer: [
      'Scale phù hợp: Hệ thống chạy trên single machine. Kubernetes cho multi-node cluster — overkill và không cần thiết cho một máy laptop hay server local.',
      'Complexity: K8s cần YAML manifests, services, ingress, PVC, secrets management, RBAC. Docker Compose: 1 file YAML, make docker-up — đơn giản và dễ reproduce.',
      'Learning curve: Docker Compose đủ để demo Lambda Architecture mà không che khuất các concepts chính của đề tài là mục tiêu học tập.',
      'Migration path: Docker Compose → Docker Swarm → Kubernetes là natural path khi cần scale lên multi-node hoặc multi-datacenter trong tương lai.',
    ],
  },
  // ─── Testing ──────────────────────────────────────────────────────────────
  {
    category: 'Testing',
    q: '23. Tại sao E2E tests dùng real Kafka container thay vì mock?',
    answer: [
      'Mock không đủ: Mock Kafka chỉ verify rằng producer.send() được gọi với đúng arguments — không verify message thực sự được delivered, serialized đúng, và consumer có thể đọc và parse lại.',
      'Integration failures chỉ xảy ra với real Kafka: Serialization bugs, schema mismatch giữa producer và consumer, partition assignment issues, offset management — tất cả chỉ xuất hiện với real broker.',
      'testcontainers: Spin up real Kafka container trong test, cô lập, reproducible, không cần external Kafka service. Tear down sau mỗi test suite — clean state mỗi lần test.',
      'Chỉ mock CoinGecko API: External HTTP dependency cần mock để kiểm soát input data và tránh phụ thuộc network và quota giới hạn.',
    ],
  },
  {
    category: 'Testing',
    q: '24. test_upsert_idempotency quan trọng như thế nào?',
    answer: [
      'Vì sao quan trọng: Scheduled inference chạy 1 lần/ngày, nhưng cùng một (coin, ngày, horizon) vẫn bị ghi lại nhiều lần qua daily re-run, on-demand predict từ API, và bootstrap lúc container restart. Không idempotent → các lần ghi này tích lũy duplicate, collection bị bloat.',
      'Test scenario: Chạy inference 2 lần liên tiếp với cùng data → count documents giữ nguyên (không nhân đôi). Upsert key (coin, prediction_date, horizon, model_id) đảm bảo tối đa 1 document/forecast point.',
      'Restart safety: Hệ thống có thể restart bất kỳ lúc nào (Docker restart policy, container OOM) mà không gây data corruption. Property này thiết yếu cho production stability.',
      'Đây là safety net quan trọng nhất của Layer 3 — test này phải pass trước khi deploy bất kỳ thay đổi nào liên quan đến inference pipeline.',
    ],
  },
  // ─── Giới hạn ─────────────────────────────────────────────────────────────
  {
    category: 'Giới hạn và Hướng cải tiến',
    q: '25. Hệ thống có những giới hạn gì? Nếu phải cải thiện, bạn làm gì trước?',
    answer: [
      '1. Retrain theo lịch chứ chưa theo hiệu năng (ưu tiên cao nhất): Inference Scheduler đã có weekly retrain tự động (RETRAIN_INTERVAL_DAYS=7, retrain cả 3 horizon trên cửa sổ 730 ngày, log vào retrain_log). Nhưng trigger chỉ dựa trên thời gian, không dựa trên drift — khi market regime đổi (bull→bear) giữa chu kỳ, model degrade mà không được phát hiện sớm. Cần thêm walk-forward evaluation + drift detection để retrain ngay khi directional accuracy tụt, thay vì chờ đủ 7 ngày.',
      '2. fear_greed placeholder: Feature = 0.5 constant, không đóng góp thông tin. Cần tích hợp Alternative.me API (free, 1 call/ngày) hoặc tính proxy từ price và volume dynamics.',
      '3. Thiếu OHLC đầy đủ: CoinGecko daily chỉ có close và volume. ATR proxy = |log_return_1d| thay vì True Range. Dùng Binance WebSocket API có OHLC đầy đủ, miễn phí, là giải pháp tốt hơn.',
      '4. Single-node Spark local mode: Không scale với nhiều coin hoặc tick-by-tick data. Cần Spark cluster với YARN hoặc EMR nếu cần horizontal scalability.',
      '5. Horizon dài hạn không hiệu quả: Directional accuracy chỉ 50% (random) cho horizon 15 và 60 ngày. LSTM không phù hợp cho dự đoán dài hạn crypto. Ensemble model hoặc TFT cho horizon dài là hướng cải tiến.',
    ],
  },
  {
    category: 'Giới hạn và Hướng cải tiến',
    q: '26. Nếu CoinGecko API thay đổi schema, hệ thống bị ảnh hưởng thế nào?',
    answer: [
      'Producer graceful defaults: transform_to_record() dùng .get("usd", 0.0) — graceful default cho trường missing. Không crash nhưng có thể ghi giá = 0 vào Kafka nếu field bị rename.',
      'Kafka message schema là contract: Nếu thêm field mới, Spark Streaming CRYPTO_SCHEMA cần update (nullable field an toàn). Nếu xóa field bắt buộc → Spark parse error downstream cho toàn bộ batch.',
      'E2E test sẽ catch ngay: test_message_schema_is_complete verify REQUIRED_FIELDS. Schema change → test fail → developer được alert ngay mà không cần manual monitoring.',
      'Mitigation dài hạn: Schema Registry (Confluent) để version schema Kafka messages, đảm bảo backward compatibility và phát hiện breaking changes trước khi deploy.',
    ],
  },
  {
    category: 'Giới hạn và Hướng cải tiến',
    q: '27. Model có thể overfit không? Làm sao biết và ngăn chặn?',
    answer: [
      'Dấu hiệu overfit: Training loss giảm liên tục nhưng validation loss tăng sau best checkpoint — đường cong loss curves trong báo cáo cho thấy pattern này rõ ràng ở các epoch cuối.',
      'Biện pháp ngăn chặn: Early stopping (patience=7), dropout 0.2 trong LSTM layers, dropout 0.1 trong heads, gradient clipping max_norm=1.0, weight decay 1e-5 trong optimizer.',
      'Validation: Walk-forward với 6 folds unseen validation sets và backtest 6 tháng data hoàn toàn unseen. Directional accuracy thực tế (49.4% WF, 61.1% backtest) là honest evaluation.',
      'fear_greed constant ironically helps: Constant feature sau StandardScaler = z-score 0 → implicit L1-like regularization cho weight của feature đó — một side effect tích cực của placeholder.',
    ],
  },
  {
    category: 'Giới hạn và Hướng cải tiến',
    q: '28. Direction-weighted Huber Loss — tại sao weight = 3 khi sai chiều?',
    answer: [
      'Hành vi nhà đầu tư: Nhà đầu tư quan tâm đúng chiều (tăng/giảm) hơn đúng magnitude. Dự đoán tăng +1% khi thực tế tăng +5% là lỗi nhỏ. Dự đoán tăng +1% khi thực tế giảm -5% là lỗi nghiêm trọng.',
      'w = 1 + 2×I[sai_chiều] = 3: Phạt gấp 3 lần khi dự đoán sai chiều. Tạo incentive rõ ràng để model ưu tiên đúng direction trước khi lo về magnitude của prediction.',
      'Tại sao 3, không phải 5 hay 10? Thực nghiệm cho thấy weight quá cao (5+) làm model overfit vào direction, bỏ qua magnitude hoàn toàn → RMSE tệ đi rõ rệt. Weight 3 là balance giữa direction incentive và magnitude accuracy.',
      'Kết hợp Huber (không phải MSE): Huber robust với fat tails (DOGE kurtosis 77). MSE bị dominated bởi crash và pump extreme events, khiến gradient update không ổn định.',
    ],
  },
  {
    category: 'Kiến trúc Hệ thống',
    q: '29. Hệ thống có nhiều chu kỳ thời gian (10 phút, 5 phút, 30 phút, hàng ngày) — chúng khác nhau thế nào?',
    answer: [
      'Đây là bốn cadence độc lập phục vụ bốn tầng khác nhau, không phải cùng một việc lặp lại. Mỗi cadence được chọn để khớp với tốc độ thay đổi thực của dữ liệu ở tầng đó và ràng buộc tài nguyên tương ứng.',
      'Producer poll CoinGecko = 10 phút (POLL_INTERVAL_SECONDS=600): Đây là nhịp nạp dữ liệu mới từ bên ngoài vào hệ thống. Chọn 10 phút để nằm trong demo tier 10.000 calls/tháng — 6 lần/giờ × 24 × 30 = 4.320 price calls/tháng, còn dư budget cho retry khi gặp 429. Giá crypto đủ chậm ở thang phút nên 10 phút không mất thông tin đáng kể.',
      'OHLC fetch = 30 phút (mỗi 3 chu kỳ poll, OHLC_POLL_MULTIPLIER=3): OHLC là call API riêng và tốn budget hơn, nên chỉ lấy mỗi chu kỳ thứ 3 để tiết kiệm quota. Hai chu kỳ còn lại các trường OHLC để null — Spark xử lý null bình thường.',
      'Scheduler live loop = 5 phút (INFERENCE_INTERVAL_SECONDS=300): Đây là vòng lặp nội bộ của inference daemon, KHÔNG phải đường nạp dữ liệu chính. Nó làm hai việc: phục vụ request predict/retrain on-demand từ API (người dùng bấm nút cần phản hồi ngay, không đợi tới hôm sau), và refresh một snapshot live_prices để dữ liệu realtime vẫn tươi kể cả khi Kafka/Spark tạm dừng. Vì là vòng phục vụ + dự phòng nên chạy dày hơn producer.',
      'Spark sliding window = window 20 phút / slide 5 phút: Đây là cách Spark TÍNH chỉ số trên dữ liệu đã có, không phải đi lấy dữ liệu. sma_20 là giá trung bình trên cửa sổ thời gian 20 phút (không phải 20 điểm dữ liệu); slide 5 phút quyết định tần suất emit. Vì producer poll 10 phút nên mỗi cửa sổ chứa khoảng 2 điểm giá; slide nhỏ hơn poll interval chủ yếu để output cập nhật đều và linh hoạt nếu poll interval giảm sau này.',
      'LSTM inference = 1 lần/ngày (DAILY_INFERENCE_HOUR + 1 lần lúc khởi động): Model train trên dữ liệu daily và horizon tính bằng ngày (H7/H15/H60). daily_stats chỉ đổi một lần mỗi ngày, nên chạy inference dày hơn cho ra kết quả gần như y hệt — chạy theo ngày là đúng tần suất.',
    ],
  },
];

const CATEGORIES = ['Tất cả', 'Kiến trúc Hệ thống', 'Machine Learning', 'Dữ liệu và Feature Engineering', 'Spark & Data Processing', 'API & Infrastructure', 'Testing', 'Giới hạn và Hướng cải tiến'];

function QAItem({ qa, defaultOpen = false }: { qa: QA; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: '10px', marginBottom: '8px',
      overflow: 'hidden',
      transition: 'border-color 0.15s',
      borderColor: open ? 'var(--border-active)' : 'var(--border)',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', textAlign: 'left', background: open ? 'color-mix(in srgb, var(--accent) 5%, var(--bg-card))' : 'var(--bg-card)',
          border: 'none', padding: '14px 18px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
          transition: 'background 0.15s',
        }}
      >
        <span style={{ fontFamily: 'Plus Jakarta Sans', fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)', textAlign: 'left', lineHeight: 1.5 }}>
          {qa.q}
        </span>
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          style={{ flexShrink: 0 }}
        >
          <ChevronDown size={16} color="var(--text-muted)" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '14px 18px 16px', borderTop: '1px solid var(--border)' }}>
              {qa.answer.map((point, i) => {
                // split bold prefix from rest
                const colonIdx = point.indexOf(': ');
                const hasBold = colonIdx > 0 && colonIdx < 60;
                const bold = hasBold ? point.slice(0, colonIdx) : null;
                const rest = hasBold ? point.slice(colonIdx + 2) : point;
                return (
                  <div key={i} style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                    <div style={{
                      width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0,
                      background: 'var(--accent-muted)', border: '1px solid rgba(99,102,241,0.25)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '1px',
                    }}>
                      <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '9px', color: 'var(--accent-light)', fontWeight: 700 }}>
                        {i + 1}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'Plus Jakarta Sans', lineHeight: 1.75 }}>
                      {bold && <strong style={{ color: 'var(--text-primary)' }}>{bold}: </strong>}
                      {rest}
                    </p>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function InterviewQADoc() {
  const [activeCategory, setActiveCategory] = useState('Tất cả');

  const filtered = activeCategory === 'Tất cả'
    ? QA_DATA
    : QA_DATA.filter(q => q.category === activeCategory);

  const grouped: Record<string, QA[]> = {};
  for (const qa of filtered) {
    if (!grouped[qa.category]) grouped[qa.category] = [];
    grouped[qa.category].push(qa);
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <PageHeader
        title="Câu hỏi tự tư duy — Q&A"
        subtitle="25+ câu hỏi thường gặp trong buổi bảo vệ đồ án CS315.F21.CN2"
        badge="HOT"
        badgeColor="#F87171"
      />

      <Callout variant="warning">
        <strong>Cách dùng trang này:</strong> Đọc câu hỏi và thử trả lời trong đầu trước khi mở đáp án. Mỗi câu trả lời có 3–4 điểm chính — chỉ cần nhớ điểm chính, không cần thuộc lòng từng chữ. Số liệu quan trọng nhất cần nhớ: <strong>4.165 ngày</strong>, <strong>9 features</strong>, <strong>seq_len=60</strong>, <strong>multi-horizon H7/H15/H60</strong>, <strong>inference daily</strong>, <strong>61.1% dir acc (BTC backtest H7)</strong>, <strong>730-ngày rolling window</strong>.
      </Callout>

      {/* Category filter */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '20px' }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`btn-ghost ${activeCategory === cat ? 'active' : ''}`}
            style={{ fontSize: '11px', padding: '5px 12px' }}
          >
            {cat}
            {cat !== 'Tất cả' && (
              <span style={{ marginLeft: '5px', fontFamily: 'IBM Plex Mono', fontSize: '9px', color: 'var(--text-muted)' }}>
                {QA_DATA.filter(q => q.category === cat).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Q&A accordion grouped by category */}
      {Object.entries(grouped).map(([category, qas]) => (
        <SectionCard key={category}>
          <SectionTitle>{category}</SectionTitle>
          {qas.map((qa, i) => (
            <QAItem key={qa.q} qa={qa} defaultOpen={i === 0 && activeCategory !== 'Tất cả'} />
          ))}
        </SectionCard>
      ))}

      <Callout variant="success">
        <strong>Tip cuối cho buổi phản biện:</strong> Nếu không nhớ con số chính xác, hãy mô tả trend và pattern thay vì im lặng. Ví dụ: "Walk-forward fold trên trending market cho accuracy cao hơn sideway khoảng 5-15 điểm %" là câu trả lời tốt. Phong cách trả lời tự tin, thừa nhận limitations thẳng thắn, và đề xuất hướng cải tiến cụ thể luôn được đánh giá cao hơn trả lời vòng vo.
      </Callout>
    </motion.div>
  );
}
