# ============================================================
#  Backend Dockerfile
#  Build context: project root (configured in docker-compose.yml)
# ============================================================

FROM python:3.12-slim

WORKDIR /app

# Install system dependencies required by asyncpg
RUN apt-get update && apt-get install -y \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies first (better layer caching)
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the backend source code
COPY backend/ .

# The sql/ directory is mounted as a Docker volume at runtime

# Expose the application port
EXPOSE 8000

# Run with uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
