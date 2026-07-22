import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    DATABASE_URL: str  = os.getenv("DATABASE_URL",  "postgresql://postgres:password@db:5432/orders_db")
    REDIS_URL: str     = os.getenv("REDIS_URL",     "redis://redis:6379")

    # ── Redis Streams (Fix 5) ──────────────────────────────────────────────
    # Stream key that carries order-change events from the DB listener to
    # the broadcaster.  A dedicated key (not the old channel name) keeps
    # Pub/Sub and Streams separate in Redis keyspace.
    REDIS_STREAM: str       = os.getenv("REDIS_STREAM",  "order_events_stream")

    # Redis key that stores the broadcaster's last-read stream ID so it
    # can resume from exactly where it left off after a restart.
    REDIS_STREAM_CURSOR: str = os.getenv("REDIS_STREAM_CURSOR", "order_events_stream:cursor")

    # How many messages to fetch per XREAD call.  Small batches keep
    # fan-out latency low; 100 is plenty for order-volume workloads.
    STREAM_READ_COUNT: int  = int(os.getenv("STREAM_READ_COUNT", "100"))

    # Approximate maximum number of entries kept in the stream.
    # ~ trim means Redis trims lazily (O(1)) instead of exactly (O(N)).
    # 10 000 entries × ~200 bytes each ≈ 2 MB — comfortable headroom.
    STREAM_MAXLEN: int      = int(os.getenv("STREAM_MAXLEN", "10000"))

    # ── Auth ───────────────────────────────────────────────────────────────
    JWT_SECRET: str         = os.getenv("JWT_SECRET",           "change-this-secret")
    JWT_ALGORITHM: str      = os.getenv("JWT_ALGORITHM",         "HS256")
    JWT_EXPIRY_MINUTES: int = int(os.getenv("JWT_EXPIRY_MINUTES", "60"))

    # ── CORS ───────────────────────────────────────────────────────────────
    CORS_ORIGINS: list[str] = os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://localhost:4000,http://localhost:4001,http://localhost:4002,http://localhost:5173"
    ).split(",")

    # ── App meta ───────────────────────────────────────────────────────────
    APP_ENV: str     = os.getenv("APP_ENV", "development")
    APP_TITLE: str   = "Real-Time Order Tracking API"
    APP_VERSION: str = "1.0.0"


settings = Settings()
