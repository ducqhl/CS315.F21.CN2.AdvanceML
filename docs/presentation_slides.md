# Presentation Slides — Lambda Architecture for Crypto Analytics

**Môn:** CS315 — Advanced Machine Learning · **Nhóm:** CN2

---

## SLIDE 1 — TITLE

**HỆ THỐNG PHÂN TÍCH VÀ DỰ ĐOÁN GIÁ TIỀN MÃ HÓA THEO THỜI GIAN THỰC DỰA TRÊN KIẾN TRÚC LAMBDA**

- Môn: CS315 — Advanced Machine Learning
- Nhóm CN2
- Bitcoin (BTC) · Dogecoin (DOGE)

---

## SLIDE 2 — VẤN ĐỀ & ĐỘNG LỰC

**Tại sao?**
- Thị trường crypto biến động cao, cần phân tích *gần thời gian thực*
- Hầu hết hệ thống hiện tại chỉ xử lý batch — không đáp ứng dashboard realtime
- Dự đoán giá ngắn hạn có giá trị lớn nhưng rất khó do bản chất phi tuyến

**Câu hỏi nghiên cứu:**
> *Có thể kết hợp Lambda Architecture + LSTM để phân tích crypto realtime không?*

---

## SLIDE 3 — MỤC TIÊU ĐỀ TÀI

4 mục tiêu cụ thể:

1. Xây dựng **Lambda Pipeline** hoàn chỉnh (Batch + Streaming)
2. Tính **chỉ số kỹ thuật** (SMA, RSI, VWAP, Bollinger, ATR) theo thời gian thực
3. Huấn luyện **LSTM Dual-Head** dự đoán giá + xu hướng 7 ngày
4. Xây dựng **API + giao diện người dùng** (React + Streamlit)

**Phạm vi:** BTC + DOGE · Dữ liệu 11,4 năm · Chạy local với Docker Compose (9 services)

---

## SLIDE 4 — NGHIÊN CỨU LIÊN QUAN

| Vấn đề | Nghiên cứu nền |
|---|---|
| LSTM cho chuỗi thời gian tài chính | Fischer & Krauss — vượt ARIMA/RF trên S&P 500 |
| Vanishing gradient → LSTM gates | Hochreiter & Schmidhuber (1997) |
| Kafka + Spark Streaming | Zaharia et al. — unified batch+stream engine |
| Kiến trúc Lambda | Nathan Marz — batch layer + speed layer + serving layer |
| Chỉ số kỹ thuật | Murphy — SMA, RSI, Bollinger, VWAP |

**Điểm mới của đề tài:**
- LSTM v3 với **volatility head** + **direction-weighted Huber loss**
- Walk-forward validation (6 fold) + backtest 6 tháng
- End-to-end system với React frontend + model registry

---

## SLIDE 5 — KIẾN TRÚC TỔNG QUAN (Lambda)

```
┌─────────────────────────────────────────────────────┐
│  BATCH LAYER     │  CSV → Spark Batch → MongoDB      │
│  (Accuracy high) │  daily_stats · historical_sma     │
│                  │  coin_correlation                 │
├─────────────────────────────────────────────────────┤
│  SPEED LAYER     │  CoinGecko → Kafka → Spark Stream │
│  (Latency low)   │  → realtime_prices (MongoDB)      │
├─────────────────────────────────────────────────────┤
│  SERVING LAYER   │  MongoDB → FastAPI (JWT)          │
│                  │  → React Frontend · Streamlit     │
│                  │  → LSTM Inference → predictions   │
└─────────────────────────────────────────────────────┘
```

**9 Docker services:** Zookeeper · Kafka · Kafka UI · MongoDB · Spark Master/Worker · Producer · Dashboard · API · Frontend · Inference Scheduler

---

## SLIDE 6 — DỮ LIỆU: THU THẬP & TỔNG QUAN

**Nguồn:** CoinGecko API — hai kênh song song:

| Kênh | Mục đích | Cách lấy |
|---|---|---|
| **Offline CSV** | Huấn luyện LSTM | Download lịch sử toàn bộ |
| **Streaming** | Realtime serving | Kafka producer poll 600s |

> *Lý do tách biệt: CoinGecko demo tier giới hạn 10k calls/tháng — dùng streaming để train sẽ cạn hạn mức trong vài ngày*

**Quy mô dữ liệu:**
- **4.165 quan sát / coin** — từ 01/01/2015 đến 29/05/2026 (~11,4 năm)
- Schema: `{date, close, total_volume, market_cap, coin_name}`
- Chất lượng: < 0,03% null (chỉ market_cap — không dùng làm feature)

---

## SLIDE 7 — EDA: ĐẶC ĐIỂM GIÁ BTC vs DOGE

**Bitcoin:**
- Tăng trưởng bậc thang theo chu kỳ halving (2017, 2020–21, 2024)
- Max drawdown: **–83,64%**
- Biên độ giá: $172 → $124.753

**Dogecoin:**
- Phần lớn thời gian dưới $0,01 — pump đột biến do sự kiện ngoại sinh (Elon Musk tweet tháng 5/2021 → $0,68)
- Max drawdown: **–92,21%** (sâu hơn BTC đáng kể)
- Kurtosis log-return: **77,02** (BTC: 11,11) — fat tails cực đoan

> *Hai coin có tính chất khác nhau căn bản: BTC là store-of-value, DOGE là đầu cơ/meme*

---

## SLIDE 8 — EDA: STATIONARITY & LÝ DO CHỌN LOG-RETURN

**Kiểm định ADF (Augmented Dickey-Fuller):**

| Chuỗi | p-value | Kết luận |
|---|---|---|
| BTC — raw price | 0,683 | Không dừng ❌ |
| BTC — log-return | ≈ 0 | **Dừng mạnh** ✅ |
| DOGE — log-return | ≈ 0 | **Dừng mạnh** ✅ |

**Tại sao HuberLoss thay vì MSE?**
- Kurtosis BTC = 11 · DOGE = 77 → fat tails → outliers nhiều
- Huber = L2 cho sai số nhỏ + L1 cho sai số lớn → robust với crash/pump

**Tương quan BTC–DOGE:**
- Pearson tổng thể: r = **0,528** — vừa phải, không đủ cao để dùng chung mô hình
- Dao động 30-ngày: từ 0,2 đến 0,8 → **phải huấn luyện 2 mô hình riêng biệt**

---

## SLIDE 9 — FEATURE ENGINEERING: 9 ĐẶC TRƯNG

| # | Feature | Vai trò |
|---|---|---|
| 0 | `log_return_1d` | Tín hiệu chính — dừng |
| 1 | `momentum_30d` | Xu hướng trung hạn (close/SMA30 - 1) |
| 2 | `realized_vol_14d` | Trạng thái biến động gần đây |
| 3 | `RSI_14` | Overbought/oversold |
| 4 | `log_volume` | Xác nhận breakout |
| 5 | `macd_norm` | Động lượng ngắn vs dài hạn |
| 6 | `bb_pct_b` | Vị trí trong Bollinger Band |
| 7 | `atr_norm` | Proxy biên độ dao động tức thì |
| 8 | `fear_greed` | Sentiment (⚠️ placeholder = 0,5) |

**Quyết định quan trọng:** Dùng kỹ thuật indicators thay vì raw price → tất cả features đều có tính dừng.

Cửa sổ input: **60 ngày × 9 features** → target: **7 log-return tương lai (MIMO)**

---

## SLIDE 10 — PHÂN CHIA DỮ LIỆU

**Nguyên tắc:** Tuyệt đối không shuffle — chronological split để tránh data leakage

**Rolling window:** Chỉ dùng **730 ngày gần nhất** để huấn luyện (crypto thay đổi regime nhanh)

```
|←────── Train (80%) ────→|← Val (10%) →|← Test (10%) →|
     ~584 ngày               ~73 ngày       ~73 ngày
```

**Nhãn hướng (UP/DOWN):** Adaptive threshold theo median của training set → phân phối cân bằng (UP ≈ 50,5%) → tránh class imbalance

---

## SLIDE 11 — HÀNH TRÌNH PHÁT TRIỂN LSTM: v1 → v2 → v3

> *Đây là phần cốt lõi nhất của quá trình phát triển mô hình*

**Mục tiêu ban đầu:** Chỉ dự đoán giá (log-return) 7 ngày → nhanh chóng nhận ra thiếu sót

```
v1: Price Only  →  v2: + Direction Head  →  v3: + Volatility Head + Direction-Weighted Loss
    (log-return)       (UP/DOWN per step)        (khoảng tin cậy + phạt sai hướng ×3)
```

---

## SLIDE 12 — LSTM v1: DỰ ĐOÁN GIÁ (PRICE ONLY)

**Kiến trúc:**
- 2-layer LSTM (hidden=128) → **1 Price Head** → 7 log-return
- Loss: **Huber Loss** thuần (δ=1)

**Đạt được:**
- Pipeline hoạt động end-to-end
- RMSE và MAE trên log-return có thể đo được
- Mô hình học được pattern giá ngắn hạn

**Vấn đề phát sinh:**
- Mô hình "đúng giá trị" nhưng **sai hướng** — dự đoán tăng 1% nhưng thực tế giảm 1%
- Không có thông tin về *mức độ tin cậy* của dự đoán
- Directional accuracy thấp do loss không ưu tiên hướng

---

## SLIDE 13 — LSTM v2: THÊM DỰ ĐOÁN XU HƯỚNG (DIRECTION)

**Nâng cấp:**
- Thêm **Direction Head** (Classification) → UP/DOWN per step
- Loss kết hợp: `L = α·L_price + β·L_direction`
- L_direction = Cross-Entropy trên nhãn UP/DOWN (adaptive threshold)

**Đạt được:**
- Directional accuracy cải thiện
- Mô hình có tín hiệu hướng rõ ràng cho dashboard
- Adaptive labelling giải quyết class imbalance

**Vấn đề còn lại:**
- Regression head và classification head hoạt động độc lập — khi regression head tự tin sai hướng, không có cơ chế phạt nặng
- Không có thông tin về *độ biến động dự kiến* — mọi dự đoán đều "confident như nhau" dù thị trường đang sideway hay crash

---

## SLIDE 14 — LSTM v3: KẾT HỢP — DUAL-HEAD + DIRECTION-WEIGHTED LOSS

**Giải pháp cuối:**

```
Input (60×9) → LSTM Layer 1 → LSTM Layer 2 → hidden state h_T
                                                      │
                    ┌─────────────────────────────────┤
                    ▼                                 ▼
            Price Head                      Volatility Head
     Linear(128→64)→ReLU→Linear(64→7)    Linear(128→64)→ReLU→Softplus→(64→7)
     → 7 log-return dự đoán              → 7 forward volatility (luôn > 0)
```

**Hai đổi mới then chốt:**

**1. Direction-Weighted Huber Loss:**
```
w = 1 + 2 × 𝟏[sign(ŷ) ≠ sign(y)]
L_price = mean(w × Huber(ŷ - y))
```
→ Phạt **gấp 3 lần** khi dự đoán sai hướng → buộc mô hình ưu tiên hướng đúng

**2. Volatility Head (Softplus output):**
→ Dự đoán **khoảng tin cậy** cho giá — giai đoạn biến động cao → vùng tô màu rộng hơn

**Tổng loss:** `L = 1.0 × L_price + 0.3 × L_vol`

---

## SLIDE 15 — KIẾN TRÚC MÔ HÌNH v3 — CHI TIẾT

| Thành phần | Chi tiết | Tham số |
|---|---|---|
| LSTM Layer 1 | input=9, hidden=128, dropout=0,2 | 70.656 |
| LSTM Layer 2 | input=128, hidden=128, dropout=0,2 | 131.584 |
| Price Head | Linear(128→64)→ReLU→Dropout(0,1)→Linear(64→7) | 8.711 |
| Volatility Head | Linear(128→64)→ReLU→Dropout(0,1)→Linear(64→7)→Softplus | 8.711 |
| **Tổng** | | **219.662** |

**Hyperparameters:**

| Tham số | Giá trị |
|---|---|
| Optimizer | Adam |
| Learning rate | 1e-3 |
| Weight decay | 1e-5 |
| Batch size | 64 |
| Max epochs | 50 |
| Early stopping patience | 7 |
| LR scheduler | ReduceLROnPlateau (factor=0,5, patience=5) |
| Gradient clipping | max_norm = 1,0 |

> *LSTM encoder chiếm > 90% tham số — heads nhẹ để tránh overfitting*

---

## SLIDE 16 — SPEED LAYER: KAFKA + SPARK STREAMING

**Kafka Producer:**
- `acks=all` · `retries=3` · `linger_ms=100` — đảm bảo độ tin cậy
- Poll CoinGecko mỗi 600s → topic `crypto_raw`

**Spark Structured Streaming:**
- Cửa sổ trượt 5 phút · Watermark 10 phút cho dữ liệu trễ
- **foreachBatch pattern** — ghi MongoDB idempotent (không dùng streaming sink trực tiếp)

**Chỉ số kỹ thuật tính realtime:**

| Chỉ số | Công thức tóm tắt | Ý nghĩa |
|---|---|---|
| SMA-n | mean(p_{t-n}…p_t) | Xu hướng n kỳ |
| RSI-14 | 100 − 100/(1 + ĀU/ĀD) | Overbought/oversold |
| Bollinger | SMA20 ± 2σ20 | Phát hiện breakout |
| VWAP | Σ(p×v)/Σv | Giá theo khối lượng |
| ATR-14 | mean(True Range × 14) | Biên độ dao động |

---

## SLIDE 17 — BATCH LAYER + SERVING LAYER

**Batch Layer (Spark Batch):**
- Input: CSV lịch sử (4.165 dòng/coin)
- Output 3 MongoDB collections:
  - `daily_stats` — OHLCV hàng ngày
  - `historical_sma` — SMA 7/30/90/200 ngày
  - `coin_correlation` — Rolling Pearson BTC-DOGE (30d, 90d)

**Serving Layer:**

| Service | Công nghệ | Port |
|---|---|---|
| API Backend | FastAPI + JWT auth | 8000 |
| React Frontend | React 19 + Nginx | 3000 |
| Streamlit Dashboard | Streamlit 1.32 | 8501 |
| Inference Scheduler | PyTorch 2.2 (5-min cron) | — |

**React Frontend — 5 trang:** Dashboard · Realtime · Technical · Predictions · Correlation

---

## SLIDE 18 — WALK-FORWARD VALIDATION

**Tại sao Walk-Forward thay vì CV thông thường?**
→ Mô phỏng thực tế: chỉ dùng quá khứ dự đoán tương lai — tránh leakage

**6 fold × 60 ngày validation/fold:**

| Coin | WF RMSE (avg) | WF MAE (avg) | WF Dir Acc (avg) |
|---|---|---|---|
| **BTC** | $3.604,46 | $2.482,59 | **49,38%** |
| **DOGE** | $0,01357 | $0,01000 | **46,30%** |

**Chi tiết từng fold — Bitcoin:**

| Fold | RMSE ($) | Dir Acc |
|---|---|---|
| 1 | 3.902 | 46,3% |
| 2 | 3.028 | 50,0% |
| 3 | 4.810 | 50,0% |
| 4 | 3.160 | **55,6%** |
| 5 | 4.144 | 38,9% |
| 6 | 2.580 | **55,6%** |

> *Biến động RMSE $2.580–$4.810 phản ánh thay đổi regime thị trường — fold tốt khi trending, kém khi sideway/crash*

---

## SLIDE 19 — BACKTEST 6 THÁNG (BTC)

**Giai đoạn:** 23/01/2026 – 29/05/2026 · Mô hình không thấy dữ liệu này trước khi đánh giá

| Horizon | # cửa sổ | RMSE | Dir Acc | Mean Err % |
|---|---|---|---|---|
| **7 ngày** | 18 | $3.009,77 | **61,1%** | 0,37% |
| 15 ngày | 8 | $4.289,60 | 50,0% | 2,72% |
| 60 ngày | 2 | $13.452,73 | 50,0% | 15,89% |

**Điểm nổi bật:**
- **7-ngày: 61,1% directional accuracy** — vượt random 11,1 điểm phần trăm — có ý nghĩa thực tiễn
- Mean Error = 0,37% → mô hình **không có bias hệ thống** một chiều
- Horizon 15+ ngày = random (50%) → LSTM không phù hợp cho dự đoán dài hạn

**Sự kiện cực đoan:** 30/01–05/02/2026 — crash từ $84.561 xuống $62.702 (−25,8% trong 7 ngày) → RMSE = $11.086 → tail event không thể dự đoán được

---

## SLIDE 20 — KẾT QUẢ TRÊN TẬP TEST

| Coin | RMSE | MAE | Dir Acc (bước 1) | Epochs |
|---|---|---|---|---|
| BTC | $1.799,50 | $1.288,92 | 40,0% | 10 |
| DOGE | $0,00325 | $0,00267 | 20,0% | 18 |

**Tại sao Dir Acc thấp trên test set?**
- Tập test chỉ ~73 quan sát — dao động lớn theo thời kỳ thị trường cụ thể
- Mô hình tối ưu hóa Huber loss, không trực tiếp tối đa hóa directional accuracy
- **Walk-forward (6 fold) đáng tin cậy hơn** vì đa dạng thời kỳ

**MAE tăng theo horizon:** Step 1 < Step 3 < Step 7 — xác nhận mô hình tốt hơn cho ngắn hạn

---

## SLIDE 21 — VOLATILITY HEAD — KẾT QUẢ

**Vol head học được volatility clustering** — giai đoạn biến động cao nối tiếp nhau (đặc tính phổ biến trong tài chính)

| Coin | Vol Head RMSE |
|---|---|
| BTC | 0,794 (đơn vị chuẩn hóa) |
| DOGE | 0,622 |

**Ứng dụng thực tiễn:**
- Dashboard hiển thị vùng tin cậy ±1σ quanh dự đoán giá
- Giai đoạn biến động cao → vùng tô màu rộng → nhà đầu tư thấy rủi ro cao hơn
- Tính năng này **không có** trong LSTM đơn giản — là điểm phân biệt của v3

---

## SLIDE 22 — ĐÃ LÀM — TỔNG KẾT ĐÓNG GÓP

✅ **Pipeline Lambda Architecture end-to-end** — khởi động 1 lệnh `make docker-up`

✅ **LSTM v3 Dual-Head** — price + volatility — 219k parameters — MIMO 7-step

✅ **Direction-weighted Huber Loss** — phạt 3× khi sai hướng — thiết kế loss có chủ đích

✅ **Walk-forward validation (6 fold)** + **backtest 6 tháng thực tế**

✅ **Directional accuracy 61,1%** cho horizon 7 ngày — vượt baseline random 11,1 pp

✅ **Volatility head** cho khoảng tin cậy dự đoán — feature thực tiễn

✅ **React Frontend hoàn chỉnh** — 5 trang · JWT auth · Model registry

✅ **Đánh giá nghiêm túc** — không chỉ báo cáo test set tĩnh

---

## SLIDE 23 — CHƯA LÀM TỐT & HẠN CHẾ

⚠️ **1. `fear_greed` = placeholder 0,5**
- Feature luôn bằng 0,5 (neutral) — không mang thông tin thực
- Chưa tích hợp Alternative.me Fear & Greed API thực

⚠️ **2. Thiếu OHLC đầy đủ**
- CoinGecko daily chỉ có close/volume — thiếu high/low/open
- ATR dùng `|log_return|` làm proxy thay vì True Range thực sự

⚠️ **3. Directional accuracy thấp trên test set tĩnh**
- BTC: 40% · DOGE: 20% — dưới ngưỡng random trên ~73 quan sát
- Kết quả nhạy cảm với thời kỳ thị trường cụ thể

⚠️ **4. Không xét yếu tố ngoại sinh**
- Tweet · quy định pháp lý · fork tác động mạnh nhưng không được mã hóa trong features
- Không có NLP/sentiment từ Twitter/Reddit

⚠️ **5. Horizon ≥ 15 ngày không hiệu quả**
- Dir Acc = 50% (random) cho 15 và 60 ngày
- LSTM đơn giản không phù hợp cho dự đoán dài hạn

---

## SLIDE 24 — HƯỚNG PHÁT TRIỂN

| Ưu tiên | Cải tiến |
|---|---|
| 🔴 Ngay | Tích hợp Fear & Greed Index thực (Alternative.me API) |
| 🔴 Ngay | Chuyển sang Binance API để có OHLC đầy đủ → ATR thực |
| 🟡 Trung hạn | Thêm sentiment NLP — FinBERT trên Twitter/Reddit |
| 🟡 Trung hạn | Thử Temporal Fusion Transformer (TFT) — attention giải thích được |
| 🟡 Trung hạn | Backtesting chiến lược giao dịch — Sharpe ratio, PnL thực |
| 🟢 Dài hạn | Kappa Architecture — thay batch layer bằng stream reprocessing |
| 🟢 Dài hạn | Cloud deployment (AWS/GCP) — Kubernetes + managed Kafka + EMR |
| 🟢 Dài hạn | Mở rộng đa coin: ETH · BNB · SOL |

---

## SLIDE 25 — KẾT LUẬN

**Trả lời câu hỏi nghiên cứu:**
> *Có thể xây dựng hệ thống crypto realtime kết hợp Lambda Architecture + LSTM* **→ CÓ**

**Kết quả chính:**
- **61,1% directional accuracy** (7 ngày, backtest 18 cửa sổ) — vượt random 11,1 pp
- Volatility head cho khoảng tin cậy — thực tiễn hơn dự đoán điểm
- System hoàn chỉnh: 9 services · React · FastAPI · MongoDB · Kafka · Spark

**Diễn giải thận trọng:**
- 18 cửa sổ trên 1 giai đoạn thị trường — cần thêm dữ liệu để khẳng định
- Dự đoán crypto dài hạn vẫn là **bài toán mở**
- Tail events (crash đột ngột) nằm ngoài khả năng dự đoán của mọi mô hình hiện tại

---

## Gợi ý trình bày

- **Slides 11–14** (hành trình LSTM v1→v2→v3) là phần quan trọng nhất — dành 4–5 phút kể câu chuyện: *tại sao phải nâng cấp, vấn đề gặp phải, giải pháp tìm ra*
- **Slide 19** (backtest 6 tháng) là kết quả thuyết phục nhất — highlight 61,1% vs 50% baseline
- **Slide 23** (hạn chế) nên trình bày chủ động, tự tin — thể hiện hiểu rõ giới hạn công việc đã làm
- Thêm screenshot giao diện React frontend vào **Slide 17** để minh họa trực quan
