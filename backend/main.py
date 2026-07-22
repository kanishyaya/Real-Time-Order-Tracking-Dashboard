"""
main.py
-------
FastAPI application entry point.

Real-time sync architecture:
  PostgreSQL trigger
      → NOTIFY on 'order_updates' channel
      → DB Listener (asyncpg) picks it up
      → Publishes JSON to Redis Pub/Sub
      → Redis Broadcaster subscribes and calls manager.broadcast()
      → ConnectionManager fans out to EVERY WebSocket client
         (across all portals: :4000, :4001, :4002, …)

Startup sequence:
  1. Create asyncpg connection pool
  2. Run schema + trigger SQL (idempotent)
  3. Create Redis client
  4. Start Redis broadcaster background task (Redis Stream → WebSockets)

  NOTE: The Postgres → Redis Stream step runs in the SEPARATE 'listener'
  service (listener/main.py).  This process never connects to the Postgres
  NOTIFY channel.  See docker-compose.yml and Fix 6 notes.

Shutdown sequence:
  - Cancel background tasks
  - Close DB pool and Redis client
"""

import asyncio
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware

import database        as db
import redis_pubsub    as rp
from auth               import authenticate_user, create_access_token, get_token_from_query
from config             import settings
from models             import (
    HealthResponse, MetricsResponse, LoginRequest, TokenResponse
)
from redis_broadcaster  import start_redis_broadcaster
from routes_orders      import router as orders_router
from websocket_manager  import ConnectionManager


# ── Logging ───────────────────────────────────────────────────

logging.basicConfig(
    level   = logging.INFO,
    format  = "%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
    datefmt = "%H:%M:%S",
)

logger = logging.getLogger(__name__)


# ── Shared state ──────────────────────────────────────────────

manager    = ConnectionManager()
start_time = time.time()


# ── Lifespan ──────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=" * 60)
    logger.info("OrderStream starting up…")
    logger.info("Portals: :4000  :4001  :4002  (or any port behind nginx)")
    logger.info("=" * 60)

    # 1. Database pool
    pool = await db.create_pool()
    db._pool = pool
    app.state.pool = pool
    logger.info("Database pool ready.")

    # 2. Schema + triggers
    await db.init_db(pool)
    logger.info("Schema and triggers applied.")

    # 3. Redis client
    redis_client = await rp.create_redis_client()
    app.state.redis = redis_client
    logger.info("Redis client ready.")

    # 4. Background: Redis Stream → WebSockets (all portals)
    #
    # FIX 6: The Postgres → Redis Stream step has been moved to the
    # standalone 'listener' service (listener/main.py).  This backend
    # process never touches the Postgres NOTIFY channel, so scaling it
    # to multiple replicas will NOT produce duplicate broadcasts.
    broadcaster_task = asyncio.create_task(
        start_redis_broadcaster(redis_client, manager),
        name="redis_broadcaster",
    )

    logger.info("Background tasks started. Real-time sync is ACTIVE.")
    logger.info("DB → Stream pipeline runs in the 'listener' service.")

    yield   # ← application runs

    # Shutdown
    logger.info("Shutting down…")
    broadcaster_task.cancel()
    await asyncio.gather(broadcaster_task, return_exceptions=True)
    await pool.close()
    await redis_client.aclose()
    logger.info("Shutdown complete.")


# ── Application ───────────────────────────────────────────────

app = FastAPI(
    title       = settings.APP_TITLE,
    version     = settings.APP_VERSION,
    description = (
        "Event-driven real-time order tracking. "
        "PostgreSQL triggers → Redis Pub/Sub → WebSockets → all portals."
    ),
    lifespan    = lifespan,
)


# ── CORS ──────────────────────────────────────────────────────
# Allow all configured origins. This must include every portal port
# (:4000, :4001, :4002, …) so browsers don't block the WS upgrade.

app.add_middleware(
    CORSMiddleware,
    allow_origins     = settings.CORS_ORIGINS,
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)


# ── Routers ───────────────────────────────────────────────────

app.include_router(orders_router)


# ── Auth ──────────────────────────────────────────────────────

@app.post("/auth/login", response_model=TokenResponse, tags=["Auth"])
async def login(body: LoginRequest):
    """
    Authenticate with username + password.
    Returns a JWT for use with protected endpoints and WebSockets.

    Demo credentials:
      admin  / admin123
      viewer / viewer123
    """
    user = authenticate_user(body.username, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials.")
    token = create_access_token({"sub": user["username"], "role": user["role"]})
    return TokenResponse(access_token=token)


# ── WebSocket ─────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token:     str | None = None,
):
    """
    WebSocket gateway — shared by ALL portals.

    Every browser tab on every portal (:4000, :4001, :4002, …) lands here.
    When any client mutates an order, the DB trigger fires, Redis broadcasts
    the event, and THIS handler fans it out to every connected client
    simultaneously — without any polling or page refresh.

    Connect with:  ws://localhost:<PORT>/ws?token=<JWT>

    On connect:
      • Authenticates the JWT.
      • Sends a snapshot of the 50 most recent events (replay).
      • Subscribes to live broadcasts.

    Each message is a JSON object: { operation, data, timestamp }.
    """
    # Authenticate before accepting
    try:
        get_token_from_query(token)
    except Exception:
        await websocket.close(code=1008)   # Policy Violation
        return

    client_id = str(uuid.uuid4())
    await manager.connect(client_id, websocket)

    # Welcome
    await manager.send_to_client(client_id, {
        "type":      "connection",
        "message":   "Connected to real-time order updates.",
        "client_id": client_id,
    })

    # Replay — send recent events so the new tab is immediately in sync
    pool   = app.state.pool
    events = await db.fetch_recent_events(pool, limit=50)
    if events:
        await manager.send_to_client(client_id, {
            "type":   "replay",
            "events": [dict(e) for e in events],
            "count":  len(events),
        })
        logger.info("WebSocket: replayed %d events to client %s", len(events), client_id)

    # Hold the connection open and handle incoming messages.
    # FIX 4: route {type: "pong"} to manager.pong() so the heartbeat
    # loop knows this client is still alive. Any other text is ignored
    # (clients don't currently send commands, but the loop is ready if
    # they ever do).
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
                if isinstance(msg, dict) and msg.get("type") == "pong":
                    manager.pong(client_id)
            except (ValueError, AttributeError):
                pass  # non-JSON text — ignore
    except WebSocketDisconnect:
        await manager.disconnect(client_id)


# ── Health ────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse, tags=["System"])
async def health_check():
    """Check the health of the database and Redis connections."""
    try:
        async with app.state.pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        db_status = "ok"
    except Exception:
        db_status = "error"

    try:
        await app.state.redis.ping()
        redis_status = "ok"
    except Exception:
        redis_status = "error"

    return HealthResponse(
        status      = "ok" if db_status == "ok" and redis_status == "ok" else "degraded",
        database    = db_status,
        redis       = redis_status,
        environment = settings.APP_ENV,
    )


# ── Metrics ───────────────────────────────────────────────────

@app.get("/metrics", response_model=MetricsResponse, tags=["System"])
async def metrics():
    """Runtime metrics — includes total clients across all portals.

    NOTE: total_events_fired is now 0 here because the DB listener runs
    in the separate 'listener' service.  To expose that counter, add a
    lightweight HTTP endpoint to listener/main.py and aggregate here, or
    store the counter in Redis and read it back.
    """
    return MetricsResponse(
        connected_clients  = manager.count,
        total_events_fired = 0,  # counter lives in the listener service
        uptime_seconds     = round(time.time() - start_time, 2),
    )


# ── Root ──────────────────────────────────────────────────────

@app.get("/", tags=["System"])
async def root():
    return {
        "name":    settings.APP_TITLE,
        "version": settings.APP_VERSION,
        "docs":    "/docs",
        "health":  "/health",
        "metrics": "/metrics",
        "portals": {
            "1": "http://localhost:4000",
            "2": "http://localhost:4001",
            "3": "http://localhost:4002",
        },
        "websocket": "ws://localhost:<PORT>/ws?token=<JWT>",
        "note":      "Changes on any portal sync to ALL portals in real time.",
    }
