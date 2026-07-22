"""
db_listener.py
--------------
Listens on PostgreSQL 'order_updates' and publishes to Redis.

FIX 1: handle_notification is defined OUTSIDE the inner while loop so the
closure captures the correct conn reference and isn't redefined on
every iteration.

FIX 2: Uses asyncio.wait_for with a raw connection keepalive — no sleep(1)
polling that blocked the event loop.

FIX 3: asyncpg LISTEN callbacks are dispatched immediately on the event
loop — zero added latency.

FIX 2 (reliability): The outer reconnect loop now distinguishes between
transient failures (network blip, Postgres restart, idle timeout) and a
clean CancelledError shutdown signal. On any transient failure it logs,
waits with capped exponential backoff, and reconnects — meaning the
pipeline never goes dark silently while REST and WebSocket connections
look healthy. Only asyncio.CancelledError (process shutdown) breaks the
loop entirely.
"""

import asyncio
import json
import logging

import asyncpg
import redis.asyncio as aioredis

from config       import settings
from redis_pubsub import publish_event

logger = logging.getLogger(__name__)
total_events_fired: int = 0

# Backoff sequence (seconds): 2, 4, 8, 16, 30, 30, 30, …
_BACKOFF = [2, 4, 8, 16, 30]


async def start_db_listener(redis_client: aioredis.Redis) -> None:
    global total_events_fired

    attempt = 0  # counts consecutive failures for backoff

    while True:
        conn = None
        try:
            logger.info("DB Listener: connecting to PostgreSQL… (attempt %d)", attempt + 1)
            conn = await asyncpg.connect(dsn=settings.DATABASE_URL)
            logger.info("DB Listener: connected. Listening on 'order_updates'…")

            # Reset backoff on a successful connection.
            attempt = 0

            # Define the callback ONCE per connection — not inside a loop.
            # The closure captures `conn` at definition time, which is
            # correct because this function is re-defined on every
            # outer-loop iteration (i.e. every reconnect).
            async def handle_notification(connection, pid, channel, payload):
                global total_events_fired
                try:
                    event = json.loads(payload)
                    await publish_event(redis_client, event)
                    total_events_fired += 1
                    logger.info(
                        "DB Listener: %s order #%s → published to Redis",
                        event.get("operation"),
                        event.get("data", {}).get("id"),
                    )
                except Exception as exc:
                    logger.error("DB Listener: error handling notification — %s", exc)

            await conn.add_listener("order_updates", handle_notification)

            # Keep alive: wake every 5 s to heartbeat the connection.
            # asyncpg fires handle_notification immediately via the event
            # loop — no polling needed for notifications themselves.
            while not conn.is_closed():
                await asyncio.sleep(5)
                try:
                    await asyncio.wait_for(conn.fetchval("SELECT 1"), timeout=3.0)
                except asyncio.CancelledError:
                    # Propagate shutdown signal — do not treat as a
                    # transient failure or we'd swallow the cancellation.
                    raise
                except Exception as exc:
                    logger.warning(
                        "DB Listener: keepalive failed (%s) — reconnecting…", exc
                    )
                    break

        except asyncio.CancelledError:
            # Clean shutdown requested by lifespan — exit the loop.
            logger.info("DB Listener: cancelled, shutting down.")
            break

        except (
            asyncpg.exceptions.ConnectionDoesNotExistError,
            asyncpg.exceptions.ConnectionFailureError,
            OSError,
        ) as exc:
            # Known transient network/Postgres failures — reconnect with backoff.
            delay = _BACKOFF[min(attempt, len(_BACKOFF) - 1)]
            logger.warning(
                "DB Listener: connection error (%s) — reconnecting in %ds…", exc, delay
            )
            attempt += 1
            await asyncio.sleep(delay)

        except Exception as exc:
            # Unexpected errors — log at ERROR so they surface in alerting,
            # then reconnect with backoff rather than crashing the task.
            delay = _BACKOFF[min(attempt, len(_BACKOFF) - 1)]
            logger.error(
                "DB Listener: unexpected error (%s) — reconnecting in %ds…", exc, delay
            )
            attempt += 1
            await asyncio.sleep(delay)

        finally:
            if conn:
                try:
                    if not conn.is_closed():
                        await conn.close()
                except Exception:
                    pass
