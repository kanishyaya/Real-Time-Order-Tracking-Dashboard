"""
redis_broadcaster.py
--------------------
Reads from the Redis Stream and fans every event out to all WebSocket
clients via ConnectionManager.

## Why XREAD instead of SUBSCRIBE

With plain Pub/Sub, if this process restarts in the gap between a NOTIFY
firing and its own SUBSCRIBE, that event is lost at the Redis layer.
XREAD with a persistent last-read ID solves this:

  • On startup, load the last-read stream ID from Redis (key:
    REDIS_STREAM_CURSOR).  If the key doesn't exist, start from "$"
    (live tail — only new messages, same as Pub/Sub on first boot).
  • After each successful broadcast, save the stream ID back so the next
    restart resumes exactly where this one left off.
  • BLOCK=2000 means we wait up to 2 s for new messages instead of
    polling, so CPU use is negligible and latency is still sub-10 ms.

## Cursor persistence

The cursor is stored in Redis itself (REDIS_STREAM_CURSOR key) so it
survives process restarts without needing a separate DB write.  It is a
best-effort cursor: if Redis itself is wiped, we fall back to "$" (live
tail) and rely on client-side since_version resync to fill any gap.

## Duplicate delivery

If this process crashes after reading from the stream but before saving
the updated cursor, the same messages will be re-delivered on restart.
Clients are idempotent (they dedup by order id + version), so duplicates
are harmless.
"""

import asyncio
import json
import logging

import redis.asyncio as aioredis

from config            import settings
from websocket_manager import ConnectionManager

logger = logging.getLogger(__name__)


async def start_redis_broadcaster(
    redis_client: aioredis.Redis,
    manager: ConnectionManager,
) -> None:
    logger.info("Redis Broadcaster: starting (stream=%s)…", settings.REDIS_STREAM)

    while True:
        sub_client = None
        try:
            # Dedicated connection — Redis Streams don't require this the
            # way Pub/Sub does, but keeping it separate makes the flow
            # easier to reason about and mirrors the old pattern.
            sub_client = await aioredis.from_url(
                settings.REDIS_URL,
                decode_responses=True,
            )

            # Load the last-read cursor so we resume after a restart.
            last_id = await sub_client.get(settings.REDIS_STREAM_CURSOR) or "$"
            logger.info(
                "Redis Broadcaster: resuming from stream id=%s", last_id
            )

            while True:
                # XREAD BLOCK 2000: wait up to 2 s for new messages.
                # Returns None on timeout (no messages) — just loop again.
                results = await sub_client.xread(
                    {settings.REDIS_STREAM: last_id},
                    count=settings.STREAM_READ_COUNT,
                    block=2000,
                )

                if not results:
                    continue  # timeout — no messages, keep waiting

                # results: [ (stream_name, [(id, {field: value}), …]) ]
                _stream_name, messages = results[0]

                for msg_id, fields in messages:
                    try:
                        event = json.loads(fields["data"])
                        logger.info(
                            "Redis Broadcaster: %s → broadcasting to %d client(s)",
                            event.get("operation"), manager.count,
                        )
                        await manager.broadcast(event)
                    except Exception as exc:
                        logger.error(
                            "Redis Broadcaster: broadcast error for id=%s — %s",
                            msg_id, exc,
                        )

                    # Advance cursor even if broadcast failed — we do
                    # not want to replay a bad message forever.  The
                    # client-side since_version resync is the safety net.
                    last_id = msg_id

                # Persist cursor after processing the batch.
                await sub_client.set(settings.REDIS_STREAM_CURSOR, last_id)

        except asyncio.CancelledError:
            logger.info("Redis Broadcaster: cancelled.")
            break
        except Exception as exc:
            logger.error(
                "Redis Broadcaster: error — %s. Restarting in 2s…", exc
            )
            await asyncio.sleep(2)
        finally:
            if sub_client:
                try:
                    await sub_client.aclose()
                except Exception:
                    pass
