"""
models.py
---------
Pydantic models used for request validation and response serialisation.
Keeping models here avoids circular imports and makes the API contract clear.
"""

from datetime import datetime
from typing import Literal, Any
from pydantic import BaseModel, Field


# ── Order Models ────────────────────────────────────────────


class OrderCreate(BaseModel):
    """Payload for creating a new order."""

    customer_name: str = Field(..., min_length=1, max_length=200)
    product_name:  str = Field(..., min_length=1, max_length=200)
    status:        Literal["pending", "shipped", "delivered"] = "pending"


class OrderUpdate(BaseModel):
    """Payload for updating an existing order (all fields optional)."""

    customer_name: str | None = Field(None, min_length=1, max_length=200)
    product_name:  str | None = Field(None, min_length=1, max_length=200)
    status:        Literal["pending", "shipped", "delivered"] | None = None


class OrderResponse(BaseModel):
    """Order as returned by the API."""

    id:            int
    customer_name: str
    product_name:  str
    status:        str
    updated_at:    str
    # Monotonically incrementing version (bumped on every UPDATE).
    # Clients store the highest version seen; on WebSocket reconnect they
    # call GET /orders?since_version=<N> to catch up on missed changes.
    version:       int = 0


# ── Auth Models ─────────────────────────────────────────────


class LoginRequest(BaseModel):
    """Credentials for obtaining a JWT token."""

    username: str
    password: str


class TokenResponse(BaseModel):
    """Returned after successful login."""

    access_token: str
    token_type:   str = "bearer"


# ── Event Models ────────────────────────────────────────────


class OrderEvent(BaseModel):
    """
    Represents a real-time event pushed to WebSocket clients.
    Mirrors the JSON payload emitted by the PostgreSQL trigger.
    """

    operation:  Literal["INSERT", "UPDATE", "DELETE"]
    table:      str
    data:       dict[str, Any]
    timestamp:  float


# ── Health / Metrics Models ──────────────────────────────────


class HealthResponse(BaseModel):
    """Response from the /health endpoint."""

    status:      str
    database:    str
    redis:       str
    environment: str


class MetricsResponse(BaseModel):
    """Basic metrics snapshot from the /metrics endpoint."""

    connected_clients:  int
    total_events_fired: int
    uptime_seconds:     float
