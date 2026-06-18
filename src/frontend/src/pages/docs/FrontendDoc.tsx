import { motion } from 'framer-motion';
import {
  PageHeader, SectionCard, SectionTitle, BodyText,
  CodeBlock, DataTable, Mono,
} from './shared';

export default function FrontendDoc() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <PageHeader
        title="React Frontend"
        subtitle="Presentation Layer — React 19 + TypeScript + Vite + Tailwind · Port 3000"
        badge="08"
        badgeColor="#6366F1"
      />

      {/* 5 trang React */}
      <SectionCard>
        <SectionTitle>React Frontend — 5 Trang Phân tích</SectionTitle>
        <BodyText>
          Frontend được xây dựng bằng React 19 với TypeScript, Vite, và Tailwind CSS. Tất cả dữ liệu được lấy từ FastAPI backend qua Axios client (<Mono>src/api/client.ts</Mono>) với JWT request và response interceptors. Mỗi trang đại diện cho một góc nhìn phân tích khác nhau về dữ liệu thị trường crypto.
        </BodyText>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
          {[
            {
              title: 'Dashboard',
              desc: 'Tổng quan giá BTC/DOGE, market cap, 24h change. Quick stats cards. Entry point cho mọi user flow — hiển thị trạng thái tổng quan của thị trường.',
              api: '/api/prices/realtime',
              source: 'live_prices + realtime_prices',
            },
            {
              title: 'Realtime',
              desc: 'Live price feed cập nhật định kỳ. Line chart giá theo thời gian. Hiển thị enriched data từ Speed Layer bao gồm các technical indicators tính bởi Spark Streaming.',
              api: '/api/prices/realtime',
              source: 'realtime_prices (TTL 7 ngày)',
            },
            {
              title: 'Technical Analysis',
              desc: 'Candlestick chart với RSI, MACD, Bollinger Bands overlay. Timeframe selector (1D/1W/1M). Tất cả indicators được tính từ Spark Streaming Query B.',
              api: '/api/indicators',
              source: 'window_stats, realtime_prices',
            },
            {
              title: 'Predictions',
              desc: 'LSTM multi-horizon forecast (H7/H15/H60) với confidence band ±1σ từ Volatility Head. Accuracy tracking chart. Model Registry modal với version history và metrics per fold.',
              api: '/api/predictions, /api/predictions/accuracy',
              source: 'predictions collection',
            },
            {
              title: 'Correlation',
              desc: 'Rolling BTC-DOGE correlation heatmap và scatter plot. Pearson r tổng thể = 0.528, rolling 30-ngày mean = 0.637. Data từ Batch Layer trên toàn bộ 4.165 ngày.',
              api: '/api/correlation',
              source: 'coin_correlation (Batch Layer)',
            },
          ].map(page => (
            <div key={page.title} style={{
              background: 'color-mix(in srgb, #6366F1 5%, var(--bg-card))',
              border: '1px solid color-mix(in srgb, #6366F1 18%, var(--border))',
              borderTop: '3px solid #6366F1',
              borderRadius: '8px', padding: '16px',
            }}>
              <div style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: '13.5px', color: 'var(--text-primary)', marginBottom: '8px' }}>
                {page.title}
              </div>
              <p style={{ margin: '0 0 10px', fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.7, fontFamily: 'Plus Jakarta Sans' }}>
                {page.desc}
              </p>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono', marginBottom: '3px' }}>
                  API: {page.api}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}>
                  Source: {page.source}
                </div>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Tech Stack */}
      <SectionCard>
        <SectionTitle>Tech Stack — React Frontend</SectionTitle>
        <DataTable
          headers={['Công nghệ', 'Version', 'Vai trò']}
          rows={[
            ['React', '19', 'UI framework với concurrent features. Functional components + hooks. React 19 cải thiện performance với automatic batching.'],
            ['TypeScript', '5.x', 'Type safety cho props interfaces, API response types, và state management. Giúp phát hiện lỗi tại compile time.'],
            ['Vite', '5.x', 'Build tool với Hot Module Replacement cho dev server, tree-shaking và code splitting cho production bundle.'],
            ['Tailwind CSS', '3.x', 'Utility-first styling — rapid UI development, consistent design system, và purging unused CSS trong production build.'],
            ['Axios', '—', 'HTTP client với JWT request interceptors và 401 auto-refresh response interceptors được cấu hình tập trung.'],
            ['ApexCharts', '—', 'Candlestick, line, area, heatmap charts với realtime data update support và rich customization options.'],
            ['Framer Motion', '—', 'Animation library cho page transitions, card hover effects, và modal animations với GPU-accelerated rendering.'],
            ['Nginx', 'alpine', 'Static file serving trong Docker production container. SPA routing config (redirect về index.html) và API proxy.'],
          ]}
        />
      </SectionCard>

      {/* Axios JWT Interceptor */}
      <SectionCard>
        <SectionTitle>Axios JWT Interceptor — src/api/client.ts</SectionTitle>
        <BodyText>
          Axios client được cấu hình tập trung với hai interceptors: request interceptor tự động attach JWT token vào mọi request, response interceptor tự động refresh token khi nhận 401. Điều này đảm bảo user không bao giờ thấy màn hình login bắt buộc do token hết hạn trong quá trình sử dụng bình thường.
        </BodyText>
        <CodeBlock lang="typescript">{`const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8000",
});

// REQUEST interceptor: tự động attach JWT token
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("jwt_token");
  if (token) {
    config.headers.Authorization = \`Bearer \${token}\`;
  }
  return config;
});

// RESPONSE interceptor: auto-refresh khi nhận 401
apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;
      try {
        const { data } = await apiClient.post("/auth/refresh");
        localStorage.setItem("jwt_token", data.access_token);
        // Retry original request với token mới
        return apiClient(error.config);
      } catch (refreshError) {
        // Refresh cũng fail → redirect to login
        localStorage.removeItem("jwt_token");
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;`}</CodeBlock>
      </SectionCard>

      {/* Docker Build */}
      <SectionCard>
        <SectionTitle>Docker Build — React Frontend</SectionTitle>
        <BodyText>
          React Frontend được build và deploy bằng multi-stage Docker build, tách biệt rõ ràng giữa build stage (Node.js + npm) và production stage (Nginx static serving). Điều này giữ production image nhỏ — không có Node.js hay npm trong production image.
        </BodyText>
        <CodeBlock lang="dockerfile">{`# Build stage: compile TypeScript + bundle với Vite
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build          # Output: /app/dist/

# Production stage: serve với Nginx
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]`}</CodeBlock>
        <BodyText>
          <Mono>nginx.conf</Mono> được cấu hình với hai chức năng chính: SPA routing (redirect mọi path không tìm thấy về <Mono>index.html</Mono> để React Router xử lý) và proxy các requests tới <Mono>/api/</Mono> đến FastAPI backend. Multi-stage build đảm bảo production image chỉ chứa static files và Nginx binary — kích thước image tối thiểu.
        </BodyText>
      </SectionCard>
    </motion.div>
  );
}
