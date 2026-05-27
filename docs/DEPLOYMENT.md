# Deployment Guide — Crypto Big Data Analytics Platform

## 1. Local Development (Docker Compose)

### Prerequisites
- Docker 24+ and Docker Compose V2
- CoinGecko API key (free at https://www.coingecko.com/en/api)

### Setup

```bash
git clone <repo-url>
cd crypto-bigdata

# Copy and populate environment file
cp .env.example .env
# Set COINGECKO_API_KEY in .env

# Start all 9 services
make docker-up
# or: docker compose -f docker/docker-compose.yml up -d
```

**Service URLs after startup:**

| Service | URL |
|---------|-----|
| React Frontend | http://localhost:3000 |
| FastAPI Backend | http://localhost:8000 |
| Streamlit Dashboard | http://localhost:8501 |
| Kafka UI | http://localhost:8080 |
| Spark Web UI | http://localhost:8081 |
| MongoDB | localhost:27017 |

### First-Time Data Load

```bash
# Create Kafka topic
bash scripts/create_topics.sh

# Load historical data (required before ML training)
bash scripts/run_batch.sh

# Train LSTM models for both coins
bash scripts/run_inference.sh
# or individually:
python src/ml/train_lstm.py --coin bitcoin --epochs 50
python src/ml/train_lstm.py --coin dogecoin --epochs 50
```

---

## 2. Production — Docker Compose + Nginx

### Overview

The production overlay (`docker/docker-compose.prod.yml`) adds:
- Resource limits on all services
- `restart: always` policy
- Nginx reverse proxy (routes `/api` → FastAPI, `/` → React)
- Removes dev volume mounts

### Deployment Steps

```bash
# 1. Copy production env
cp .env.example .env.prod
# Edit .env.prod — set strong passwords, real API keys

# 2. Build and start
docker compose \
  -f docker/docker-compose.yml \
  -f docker/docker-compose.prod.yml \
  --env-file .env.prod \
  up -d --build

# 3. Check services
docker compose ps
```

### TLS / HTTPS (Certbot)

Edit `nginx/nginx.prod.conf` to enable the HTTPS server block (see the commented section), then:

```bash
# Issue certificate (replace example.com with your domain)
docker run --rm \
  -v $(pwd)/nginx/certbot/conf:/etc/letsencrypt \
  -v $(pwd)/nginx/certbot/www:/var/www/certbot \
  certbot/certbot certonly --webroot \
  -w /var/www/certbot \
  -d example.com --email you@example.com --agree-tos
```

Reload Nginx after certificate issuance:
```bash
docker compose exec nginx nginx -s reload
```

### Environment Variables (Production)

| Variable | Required | Description |
|----------|----------|-------------|
| `COINGECKO_API_KEY` | Yes | CoinGecko API key |
| `MONGO_INITDB_ROOT_USERNAME` | Yes | MongoDB admin username |
| `MONGO_INITDB_ROOT_PASSWORD` | Yes | Strong password (min 16 chars) |
| `JWT_SECRET_KEY` | Yes | JWT signing secret (min 32 chars random) |
| `ADMIN_USERNAME` | Yes | FastAPI admin username |
| `ADMIN_PASSWORD` | Yes | FastAPI admin password |
| `INFERENCE_INTERVAL_SECONDS` | No | Default: 300 |
| `RETRAIN_INTERVAL_DAYS` | No | Default: 7 |
| `SCHEDULER_FETCH_COINGECKO` | No | Default: true |

---

## 3. Production — VPS (Systemd + Nginx)

For bare-metal or cloud VM deployment without Docker:

### System Setup (Ubuntu 22.04)

```bash
sudo apt update && sudo apt install -y python3.11 python3-pip nodejs npm nginx
pip install -r src/api/requirements.txt
pip install -r src/ml/requirements.txt

# Build React frontend
cd src/frontend && npm ci && npm run build
cd ../..
```

### Systemd Services

Create `/etc/systemd/system/crypto-api.service`:
```ini
[Unit]
Description=Crypto Big Data FastAPI
After=network.target mongod.service

[Service]
User=crypto
WorkingDirectory=/opt/crypto-bigdata
EnvironmentFile=/opt/crypto-bigdata/.env
ExecStart=/usr/bin/uvicorn src.api.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Create `/etc/systemd/system/crypto-scheduler.service`:
```ini
[Unit]
Description=Crypto LSTM Inference Scheduler
After=network.target mongod.service

[Service]
User=crypto
WorkingDirectory=/opt/crypto-bigdata/src/ml
EnvironmentFile=/opt/crypto-bigdata/.env
ExecStart=/usr/bin/python3 inference_scheduler.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now crypto-api crypto-scheduler
```

### Nginx Config (VPS)

```nginx
server {
    listen 80;
    server_name example.com;

    # React frontend (static build)
    root /opt/crypto-bigdata/src/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # FastAPI backend
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 4. Production — Fly.io

### Prerequisites

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh
fly auth login
```

### Deploy API

```bash
fly launch --name crypto-api --no-deploy
# Edit fly.toml (see fly.toml in repo root)
fly secrets set JWT_SECRET_KEY=$(openssl rand -hex 32)
fly secrets set MONGO_URI="mongodb+srv://..."  # Use MongoDB Atlas
fly deploy
```

### Deploy Frontend

The React build is a static site — deploy to Fly.io as a static app or use Vercel/Netlify:

```bash
# Vercel (simplest)
cd src/frontend
npx vercel --prod
# Set VITE_API_URL env var to your Fly.io API URL
```

### MongoDB on Fly.io

Use [MongoDB Atlas](https://www.mongodb.com/atlas) (free M0 tier) for production:
1. Create a free cluster
2. Whitelist Fly.io outbound IP or use `0.0.0.0/0` (with auth)
3. Copy the connection string to `MONGO_URI` in Fly secrets

---

## 5. Monitoring & Operations

### Health Check

```bash
curl http://localhost:8000/api/health
# { "status": "ok", "mongo": "connected" }
```

### Model Retraining (Manual)

```bash
# Via API
curl -X POST http://localhost:8000/api/models/train \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"coin": "bitcoin", "epochs": 50}'

# Direct script
python src/ml/train_lstm.py --coin bitcoin --epochs 50
```

### Logs

```bash
# Docker
docker compose logs -f inference_scheduler
docker compose logs -f api

# Systemd
journalctl -u crypto-scheduler -f
```

### Backup MongoDB

```bash
# Dump
docker exec mongodb mongodump \
  --username admin --password password123 \
  --authenticationDatabase admin \
  --db crypto_db --out /data/backup

# Restore
docker exec mongodb mongorestore \
  --username admin --password password123 \
  --authenticationDatabase admin \
  /data/backup
```

---

## 6. Scaling Considerations

| Component | Scaling Strategy |
|-----------|-----------------|
| FastAPI | Horizontal: multiple uvicorn workers behind Nginx (`--workers 4`) |
| Kafka | Add brokers; increase replication factor |
| Spark | Add workers; increase `SPARK_WORKER_MEMORY` |
| MongoDB | Enable replica set for HA; consider Atlas M10+ for production |
| Inference | Run scheduler per region; model files on shared volume |
| Frontend | CDN (Cloudflare, Vercel Edge) for static assets |
