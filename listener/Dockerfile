# ============================================================
#  DB Listener Dockerfile
#  Standalone service: Postgres NOTIFY → Redis Stream
#  Build context: project root (configured in docker-compose.yml)
# ============================================================

FROM python:3.12-slim

WORKDIR /app

# System deps for asyncpg
RUN apt-get update && apt-get install -y \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY listener/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY listener/main.py .

# No EXPOSE — this service has no HTTP interface.
# It only holds a Postgres connection and writes to Redis.

CMD ["python", "-u", "main.py"]
