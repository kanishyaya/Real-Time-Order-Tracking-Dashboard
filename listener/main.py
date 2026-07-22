"""
listener/main.py
----------------
Standalone DB-listener process.

## Why this is a separate service (Fix 6)

If the DB listener runs inside the API/WebSocket backend and that backend
is horizontally scaled (two or more replicas), EVERY replica listens on
the same Postgres NOTIFY channel and republishes to Redis.  Each order
change would generate N duplicate events on the stream — one per replica
— and every client would receive N broadcasts for a single mutation.

The fix is to run the DB listener as its own process that is ALWAYS kept
at exactly one replica.  The API/WebSocket workers scale freely; only
this service is pinned to scale=1.

docker-compose.yml enforces this via the `deploy.replicas: 1` constraint
(Swarm) and by not exposing this service behind a load balancer.  In
Kubernetes the equivalent is a Deployment with `replicas: 1` and a
PodDisruptionBudget of maxUnavailable=0/maxSurge=0 during rollouts.

## What this process does

  1. Connect to Postgres via asyncpg.
  2. LISTEN on the 'order_updates' channel.
  3. For each NOTIFY, write the payload to a Redis Stream via XADD.
  4. If the Postgres connection drops for any reason, reconnect with
     capped exponential backoff (same logic as the main backend).

That's it.  No HTTP server, no WebSocket handling, no REST endpoints.
The process is intentionally tiny so it is easy to reason about,
monitor, and restart.

## Delivery guarantee

This process converts a Postgres NOTIFY into a Redis Stream entry.
NOTIFY is not durable — if this process is not listening when a NOTIFY
fires (brief restart, network blip), that notification is lost.  The
Redis Stream IS durable (up to STREAM_MAXLEN entries) so once an event
reaches the stream it will be delivered to the broadcaster even if the
broadcaster itself restarts.

The remaining gap is the NOTIFY → XADD window.  This is addressed at the
client level via the version-based GET /orders?since_version=N resync
endpoint (Fix 3).  See redis_pubsub.py in the backend for the full
delivery-guarantee documentation.
"""

import asyncio
import json
import logging
import os
import sys

import asyncpg
import redis.asyncio as aioredis

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("listener")


# ---------------------------------------------------------------------------
# Config (read directly from env — no shared config module dependency)
# ---------------------------------------------------------------------------

DATABASE_URL        = os.environ.get("DATABASE_URL",         "postgresql://postgres:password@db:5432/orders_db")
REDIS_URL           = os.environ.get("REDIS_URL",            "redis://redis:6379")
REDIS_STREAM        = os.environ.get("REDIS_STREAM",         "order_events_stream")
STREAM_MAXLEN       = int(os.environ.get("STREAM_MAXLEN",    "10000"))
PG_NOTIFY_CHANNEL   = "order_updates"

# Backoff sequence (seconds): 2, 4, 8, 16, 30, 30, …
_BACKOFF = [2, 4, 8, 16, 30]


# ---------------------------------------------------------------------------
# Main listener loop
# ---------------------------------------------------------------------------

async def run() -> None:
    logger.info("=" * 60)
    logger.info("DB Listener service starting")
    logger.info("Postgres channel : %s", PG_NOTIFY_CHANNEL)
    logger.info("Redis stream     : %s", REDIS_STREAM)
    logger.info("=" * 60)

    # Create a single Redis client for the lifetime of the process.
    redis_client = await aioredis.from_url(REDIS_URL, decode_responses=True)

    attempt = 0

    while True:
        conn = None
        try:
            logger.info("Connecting to Postgres… (attempt %d)", attempt + 1)
            conn = await asyncpg.connect(dsn=DATABASE_URL)
            logger.info("Connected. Listening on '%s'…", PG_NOTIFY_CHANNEL)
            attempt = 0  # reset backoff on successful connect

            async def handle_notification(connection, pid, channel, payload):
                try:
                    event = json.loads(payload)
                    msg_id = await redis_client.xadd(
                        REDIS_STREAM,
                        {"data": payload},
                        maxlen=STREAM_MAXLEN,
                        approximate=True,
                    )
                    logger.info(
                        "NOTIFY → Stream  op=%s  order_id=%s  stream_id=%s",
                        event.get("operation"),
                        event.get("data", {}).get("id"),
                        msg_id,
                    )
                except Exception as exc:
                    logger.error("handle_notification error: %s", exc)

            await conn.add_listener(PG_NOTIFY_CHANNEL, handle_notification)

            # Keepalive: wake every 5 s to heartbeat the connection.
            while not conn.is_closed():
                await asyncio.sleep(5)
                try:
                    await asyncio.wait_for(conn.fetchval("SELECT 1"), timeout=3.0)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    logger.warning("Keepalive failed (%s) — reconnecting…", exc)
                    break

        except asyncio.CancelledError:
            logger.info("Listener cancelled — shutting down.")
            break

        except (
            asyncpg.exceptions.ConnectionDoesNotExistError,
            asyncpg.exceptions.ConnectionFailureError,
            OSError,
        ) as exc:
            delay = _BACKOFF[min(attempt, len(_BACKOFF) - 1)]
            logger.warning("Connection error (%s) — reconnecting in %ds…", exc, delay)
            attempt += 1
            await asyncio.sleep(delay)

        except Exception as exc:
            delay = _BACKOFF[min(attempt, len(_BACKOFF) - 1)]
            logger.error("Unexpected error (%s) — reconnecting in %ds…", exc, delay)
            attempt += 1
            await asyncio.sleep(delay)

        finally:
            if conn:
                try:
                    if not conn.is_closed():
                        await conn.close()
                except Exception:
                    pass

    await redis_client.aclose()
    logger.info("DB Listener service stopped.")


if __name__ == "__main__":
    asyncio.run(run())
