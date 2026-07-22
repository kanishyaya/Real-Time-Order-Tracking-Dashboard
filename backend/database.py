"""
database.py
-----------
Manages the asyncpg connection pool.
All database access goes through the pool created here.
"""

import asyncpg
from config import settings


# Module-level pool — initialised on startup, closed on shutdown
_pool: asyncpg.Pool | None = None


async def create_pool() -> asyncpg.Pool:
    """Create and return the asyncpg connection pool."""

    pool = await asyncpg.create_pool(
        dsn=settings.DATABASE_URL,
        min_size=2,
        max_size=10,
        command_timeout=60,
    )

    return pool


async def get_pool() -> asyncpg.Pool:
    """Return the existing pool (raises if not initialised)."""

    if _pool is None:
        raise RuntimeError("Database pool has not been initialised.")

    return _pool


async def init_db(pool: asyncpg.Pool) -> None:
    """
    Run schema and trigger SQL files on startup.
    Safe to run multiple times — all statements use IF NOT EXISTS.
    """

    sql_files = [
        "/app/sql/schema.sql",
        "/app/sql/triggers.sql",
    ]

    async with pool.acquire() as conn:
        for path in sql_files:
            with open(path, "r") as f:
                sql = f.read()
            await conn.execute(sql)


async def fetch_recent_events(pool: asyncpg.Pool, limit: int = 50) -> list[dict]:
    """
    Fetch the most recent order events for event replay.
    Called when a client first connects so they get caught up.

    FIX: occurred_at is cast to TEXT in SQL so it is always a plain
    string — never a datetime object — and JSON serialisation never fails.
    A datetime object coming out of asyncpg cannot be passed to
    websocket.send_json() which is what was crashing every connection
    on connect and dropping all clients immediately.
    """

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT payload, occurred_at::TEXT AS occurred_at
            FROM   order_events
            ORDER  BY occurred_at DESC
            LIMIT  $1
            """,
            limit,
        )

    # Convert to plain dicts and reverse so oldest-first
    events = [dict(row) for row in rows]
    events.reverse()

    return events


async def fetch_all_orders(pool: asyncpg.Pool) -> list[dict]:
    """Return current snapshot of all orders."""

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, customer_name, product_name, status,
                   updated_at::TEXT AS updated_at, version
            FROM   orders
            ORDER  BY id
            """
        )

    return [dict(row) for row in rows]
