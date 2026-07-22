"""
redis_pubsub.py
---------------
Publisher side of the Redis Streams pipeline.

## Delivery-guarantee model — read this before changing anything

This system provides **at-least-once, trigger-sourced delivery** with
**client-side gap detection on reconnect** (version column + since_version
REST endpoint).  It does NOT provide exactly-once delivery.  That is a
deliberate choice, documented here so the next person doesn't accidentally
add code that assumes stronger guarantees.

                 ┌──────────────────────────────────────────┐
                 │  Why not exactly-once?                   │
                 │                                          │
                 │  PostgreSQL NOTIFY has no persistence.   │
                 │  If no listener is attached when it      │
                 │  fires (backend restart, network split), │
                 │  the notification is gone forever.       │
                 │  True exactly-once would require an      │
                 │  outbox table or a durable queue in      │
                 │  front of the stream.                    │
                 └──────────────────────────────────────────┘

### What we do instead

  1. Postgres NOTIFY → Redis Stream  (db_listener → this module)
  2. Redis Stream → WebSocket fan-out  (broadcaster → clients)
  3. On reconnect: client calls GET /orders?since_version=N to catch up
     on anything missed while it was disconnected (Fix 3 in this project).

### Why Redis Streams instead of Redis Pub/Sub

Plain Pub/Sub is fire-and-forget: if the broadcaster process restarts
in the sub-millisecond window between a NOTIFY and its own SUBSCRIBE,
that event is lost at the Redis layer too.  Redis Streams solve this:

  • Messages persist in the stream until trimmed (MAXLEN ~).
  • The broadcaster resumes from its last-read ID after restart — no
    gap even if it was down when the message was written.
  • Consumers can replay the tail of the stream without a full DB query.
  • The API surface (XADD / XREAD) is only marginally more code than
    PUBLISH / SUBSCRIBE.

### What this still does NOT guarantee

  • If Postgres restarts between two updates the NOTIFY for the missed
    update is gone.  The version-based client resync is the safety net.
  • If a WebSocket client is disconnected it misses live pushes; it must
    resync on reconnect via GET /orders?since_version=N.
  • Duplicate delivery is possible if the broadcaster crashes after
    reading from the stream but before the WebSocket send completes.
    Clients are idempotent (they dedup by order id + version), so
    duplicates are harmless.

### Path to exactly-once (not in scope for this project)

  Replace the Postgres trigger → NOTIFY path with a transactional
  outbox table: write to outbox in the same transaction as the order
  mutation, then have a separate poller (or Debezium) move rows from
  the outbox into the Redis Stream.  This closes the NOTIFY gap at the
  cost of an extra table and a polling loop (or CDC tooling).
"""

import json
import logging

import redis.asyncio as aioredis

from config import settings

logger = logging.getLogger(__name__)


# ── Client factory ───────────────────────────────────────────────────────────

async def create_redis_client() -> aioredis.Redis:
    """Create and return an async Redis client."""
    client = await aioredis.from_url(
        settings.REDIS_URL,
        decode_responses=True,
    )
    return client


# ── Publisher (XADD → Stream) ────────────────────────────────────────────────

async def publish_event(client: aioredis.Redis, event: dict) -> None:
    """
    Write an event to the Redis Stream.

    Uses XADD with MAXLEN ~ STREAM_MAXLEN to keep memory bounded while
    retaining enough history for a broadcaster restart to catch up.
    The auto-generated stream ID (millisecond timestamp + sequence) is
    what the broadcaster uses to resume after a restart.

    Called by the DB listener each time PostgreSQL fires a NOTIFY.
    """
    payload = json.dumps(event)
    msg_id = await client.xadd(
        settings.REDIS_STREAM,
        {"data": payload},
        maxlen=settings.STREAM_MAXLEN,
        approximate=True,   # ~ trim: O(1) instead of O(N)
    )
    logger.debug(
        "redis_pubsub: XADD %s id=%s op=%s",
        settings.REDIS_STREAM, msg_id, event.get("operation"),
    )
