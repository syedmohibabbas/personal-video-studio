FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=10000 \
    PVS_WHISPER_MODEL=small \
    PVS_WHISPER_DEVICE=cpu \
    PVS_WHISPER_COMPUTE_TYPE=int8 \
    PVS_MODEL_CACHE=/var/cache/pvs-whisper
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --upgrade pip && pip install -r /app/backend/requirements.txt
COPY . /app
RUN mkdir -p /var/cache/pvs-whisper
EXPOSE 10000
CMD ["sh","-c","uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
