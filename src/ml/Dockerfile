# src/ml/Dockerfile
# Image for the inference_scheduler service.
# Bind-mounts src/ml at runtime so model artifacts (.pt / .pkl) are always fresh.

FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies first (layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Copy source — runtime bind-mount in docker-compose will override
COPY . .

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

CMD ["python", "inference_scheduler.py"]
