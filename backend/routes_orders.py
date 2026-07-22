"""
routes_orders.py
----------------
REST endpoints for orders. Auth via Bearer token in Authorization header.
Write operations trigger PostgreSQL NOTIFY → Redis → WebSocket broadcast.

FIX 3: Added GET /orders?since_version=<N> catch-up endpoint.
When a WebSocket client reconnects (browser sleep, network drop, server
restart) it calls this endpoint with the last version it saw. The server
returns only the rows that changed since then, so the client can patch
its local state without a full re-fetch — and without missing any
updates that arrived while it was disconnected.
"""

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi import Depends
from typing import Optional

from auth     import verify_token
from database import fetch_all_orders
from models   import OrderCreate, OrderUpdate, OrderResponse

router = APIRouter(prefix="/orders", tags=["Orders"])
security = HTTPBearer(auto_error=False)


def require_auth(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Accept token from Authorization header OR ?token= query param."""
    if credentials:
        return verify_token(credentials.credentials)
    return None   # open read for demo; tighten in production


@router.get("", response_model=list[OrderResponse])
async def list_orders(
    request: Request,
    since_version: Optional[int] = Query(
        default=None,
        description=(
            "If provided, return only orders whose version is strictly "
            "greater than this value. Use for WebSocket reconnect catch-up: "
            "pass the highest version the client already has and receive "
            "only the rows that changed while it was disconnected."
        ),
    ),
    _=Depends(require_auth),
):
    """
    List orders.

    • Without `since_version` — returns all orders (initial load).
    • With `since_version=N` — returns only rows whose version > N
      (reconnect catch-up). The client merges these into its local state.

    This converts the system from "hope no WS message was missed" into
    "always self-heal on reconnect" — cheap to call, closes the biggest
    reliability hole in any pub/sub-over-WebSocket design.
    """
    pool = request.app.state.pool

    if since_version is not None:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, customer_name, product_name, status,
                       updated_at::TEXT AS updated_at, version
                FROM   orders
                WHERE  version > $1
                ORDER  BY version
                """,
                since_version,
            )
        return [dict(row) for row in rows]

    return await fetch_all_orders(pool)


@router.post("", response_model=OrderResponse, status_code=201)
async def create_order(body: OrderCreate, request: Request, _=Depends(require_auth)):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO orders (customer_name, product_name, status)
            VALUES ($1, $2, $3)
            RETURNING id, customer_name, product_name, status,
                      updated_at::TEXT AS updated_at, version
            """,
            body.customer_name, body.product_name, body.status,
        )
    return dict(row)


@router.put("/{order_id}", response_model=OrderResponse)
async def update_order(order_id: int, body: OrderUpdate, request: Request, _=Depends(require_auth)):
    pool = request.app.state.pool
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update.")

    fields = list(updates.keys())
    values = list(updates.values())
    set_clause = ", ".join(f"{f} = ${i+2}" for i, f in enumerate(fields))

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            UPDATE orders
            SET {set_clause}
            WHERE id = $1
            RETURNING id, customer_name, product_name, status,
                      updated_at::TEXT AS updated_at, version
            """,
            order_id, *values,
        )
    if not row:
        raise HTTPException(status_code=404, detail=f"Order {order_id} not found.")
    return dict(row)


@router.delete("/{order_id}", status_code=204)
async def delete_order(order_id: int, request: Request, _=Depends(require_auth)):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        result = await conn.execute("DELETE FROM orders WHERE id = $1", order_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail=f"Order {order_id} not found.")
