# Real-Time Order Tracking Platform

A scalable, event-driven order tracking system built with FastAPI, PostgreSQL, Redis Pub/Sub, WebSockets, Docker, and React. The system listens for database changes and instantly pushes updates to all connected clients — no polling, no page refreshes.

Open three browser tabs on different ports. Create an order on one. Watch it appear on all others in under a second.

---

## Features

- Real-time order updates across all connected clients simultaneously
- PostgreSQL `LISTEN`/`NOTIFY` triggers — the DB itself fires the event
- Redis Pub/Sub messaging layer for horizontal scalability
- WebSocket broadcasting to every browser tab at once
- Event replay on reconnect (last 50 events sent on connect)
- JWT authentication on both REST and WebSocket endpoints
- Live dashboard: order grid, event log sidebar, connected-client counter
- Fully Dockerized — one command to start everything

---

## Architecture

### How a database change reaches the browser

```
Database Change (INSERT / UPDATE / DELETE)
           ↓
  PostgreSQL Trigger
  notify_order_change()
  pg_notify('order_updates', payload)
           ↓
  DB Listener Service
  (asyncpg LISTEN — db_listener.py)
           ↓
  Redis Pub/Sub
  channel: "order_updates"
           ↓
  Redis Broadcaster
  (redis_broadcaster.py)
           ↓
  WebSocket Manager
  ConnectionManager.broadcast()
           ↓
  React Frontend Updates Instantly
  (all tabs, all portals, simultaneously)
```

### Full system diagram

```
Browser :4000    Browser :4001    Browser :4002
    │                 │                 │
    └─────────────────┼─────────────────┘
                      │  WebSocket connections
                ┌─────▼──────┐
                │  FastAPI   │
                │  Backend   │
                └─────┬──────┘
                      │
         ┌────────────┴────────────┐
         │                         │
  ┌──────▼──────┐        ┌─────────▼────────┐
  │  asyncpg    │        │ ConnectionManager │
  │  REST pool  │        │ (WebSocket reg.)  │
  └──────┬──────┘        └─────────▲────────┘
         │                         │
  ┌──────▼──────┐        ┌─────────┴────────┐
  │ PostgreSQL  │        │ Redis Broadcaster │
  │ orders      │        │ (SUBSCRIBE)       │
  │             │        └─────────▲────────┘
  │ Trigger →   │                  │
  │ NOTIFY      │        ┌─────────┴────────┐
  └──────┬──────┘        │  Redis Pub/Sub   │
         │               │  "order_updates" │
         └───DB Listener─┘
              (LISTEN)
```

---

## Tech Stack

**Backend**
- Python 3.11, FastAPI, uvicorn (async-first ASGI stack)
- PostgreSQL 16 with `LISTEN`/`NOTIFY` and PL/pgSQL triggers
- Redis 7 Pub/Sub (message bus between DB listener and WebSocket broadcaster)
- asyncpg (native async PostgreSQL driver with LISTEN support)
- JWT authentication (python-jose, HS256)

**Frontend**
- React 18, Vite
- TailwindCSS
- nginx (serves React build and proxies `/api/*` and `/ws` to backend)

**DevOps**
- Docker, Docker Compose
- Three frontend replicas on ports 4000, 4001, 4002 sharing one backend

---

## Why I Chose This Architecture

### Event-driven over polling

I used an **event-driven architecture** instead of polling to achieve low-latency real-time updates efficiently.

With polling, every client repeatedly asks "did anything change?" — cost scales as **O(clients × poll_frequency)**. With 1,000 clients polling every 5 seconds, that is 200 database requests per second at idle, even when nothing has changed. With this event-driven design, the cost is **O(1) per actual change** — one trigger, one Redis publish, one fan-out — regardless of how many clients are connected.

### Why PostgreSQL `LISTEN`/`NOTIFY` over application-level events?

The database is the authoritative source of truth. If you fire events at the application layer — "publish to Redis after my INSERT succeeds" — you risk a silent failure: a crash between the INSERT and the publish leaves clients permanently out of sync. Using a **database trigger** guarantees that every committed write fires exactly one notification, regardless of which code path or backend instance caused it. There is no way to insert, update, or delete an order without the trigger firing. Even direct `psql` edits by a DBA propagate automatically.

### Why Redis Pub/Sub as the middle layer?

**Decoupling and horizontal scalability.** A single FastAPI process could receive the PostgreSQL NOTIFY and directly broadcast to its own WebSocket clients — but with multiple backend replicas behind a load balancer, each replica only sees its own connected clients. Redis Pub/Sub solves this: every backend subscribes to the same channel. When any backend publishes an event, all replicas receive it and broadcast to their own client pools. Scaling from one backend to ten requires no code changes.

Redis also decouples the `db_listener` from the `redis_broadcaster` — each has independent reconnect logic and can restart without affecting the other.

### Why WebSockets over Server-Sent Events or long polling?

| Mechanism | Latency | Overhead | Bi-directional | Notes |
|-----------|---------|----------|----------------|-------|
| **WebSockets** | ~0ms | Very low | Yes | Used here |
| SSE | ~0ms | Low | No | Would also work |
| Long Polling | High | High (new conn each time) | No | Wasteful |

WebSockets were chosen over SSE because they allow future bi-directional use (e.g., the client sending actions without a separate REST call), and FastAPI's WebSocket support is first-class. JWT auth passes cleanly as a `?token=` query parameter on the upgrade request — a standard, well-understood pattern.

### Why asyncpg specifically?

`asyncpg` is the only Python PostgreSQL driver with **native async support for `LISTEN`/`NOTIFY`**. When PostgreSQL fires `pg_notify`, asyncpg dispatches the callback directly on the asyncio event loop — zero polling latency, no sleep loops, no thread overhead. The event arrives within milliseconds of the commit.

---

## How to Run

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- Ports `4000`, `4001`, `4002` free on your machine

### 1 — Unzip the project

```bash
unzip os4-final.zip
cd os4-final
```

### 2 — Start everything

```bash
docker compose up --build
```

This builds and starts six containers: PostgreSQL, Redis, the FastAPI backend, and three nginx/React frontends.

### 3 — Wait for these log lines

```
redis-1     | Ready to accept connections
backend-1   | Schema and triggers applied.
backend-1   | Application startup complete.
frontend-1  | start worker process
```

The backend automatically runs `schema.sql` and `triggers.sql` on first boot.

### 4 — Open the portals

| Portal   | URL                       | Login                   |
|----------|---------------------------|-------------------------|
| Portal 1 | http://localhost:4000     | `admin` / `admin123`    |
| Portal 2 | http://localhost:4001     | `viewer` / `viewer123`  |
| Portal 3 | http://localhost:4002     | `admin` / `admin123`    |

All three portals connect to the **same backend** — every client on every port receives every broadcast.

Interactive API docs: **http://localhost:4000/api/docs**

---

## Verifying Real-Time Updates

### Browser test

1. Open all three URLs in separate browser tabs and log in
2. On Portal 1: click **"New Order"** and create an order
3. Watch it appear instantly on Portal 2 and Portal 3 — no refresh
4. Change a status on Portal 2 — both other tabs update immediately
5. Check the **Event Log** sidebar on the right — every change streams in live
6. The **MetricsBar** at the top shows the live connected client count

### CLI test (no browser needed)

**Get a token:**
```bash
curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | python3 -m json.tool
```

**Open a WebSocket listener** (install `wscat` with `npm install -g wscat`):
```bash
wscat -c "ws://localhost:4000/ws?token=<YOUR_TOKEN>"
```

You immediately receive a connection confirmation and a replay of recent events.

**Trigger an event from a second terminal:**
```bash
TOKEN="<paste your token>"

curl -s -X POST http://localhost:4000/api/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"customer_name":"CLI Test","product_name":"Keyboard","status":"pending"}' \
  | python3 -m json.tool
```

The WebSocket terminal prints the broadcast instantly:
```json
{
  "operation": "INSERT",
  "table": "orders",
  "data": {
    "id": 1,
    "customer_name": "CLI Test",
    "product_name": "Keyboard",
    "status": "pending",
    "updated_at": "2024-01-15 10:30:00"
  },
  "timestamp": 1705312200.123
}
```

### Health and metrics

```bash
# Health check (no auth needed)
curl http://localhost:4000/api/health

# Live metrics: connected clients, events fired, uptime
curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/metrics
```

---

## API Reference

Base URL: `http://localhost:4000/api`

### Auth

| Method | Endpoint        | Description       | Auth |
|--------|-----------------|-------------------|------|
| POST   | `/auth/login`   | Returns JWT token | No   |

### Orders

All endpoints require `Authorization: Bearer <token>`.

| Method | Endpoint          | Description      | Status |
|--------|-------------------|------------------|--------|
| GET    | `/orders`         | List all orders  | 200    |
| POST   | `/orders`         | Create an order  | 201    |
| PUT    | `/orders/{id}`    | Update an order  | 200    |
| DELETE | `/orders/{id}`    | Delete an order  | 204    |

**Create order body:**
```json
{
  "customer_name": "Alice Johnson",
  "product_name": "Wireless Headphones",
  "status": "pending"
}
```

Valid statuses: `pending` → `shipped` → `delivered`

### System

| Method | Endpoint    | Description                   | Auth |
|--------|-------------|-------------------------------|------|
| GET    | `/health`   | DB + Redis health check       | No   |
| GET    | `/metrics`  | Clients, events fired, uptime | Yes  |

---

## WebSocket Protocol

Connect: `ws://localhost:<PORT>/ws?token=<JWT>`

**Message types received from server:**

| Type | When | Description |
|------|------|-------------|
| `connection` | On connect | Confirms auth, sends `client_id` |
| `replay` | On connect | Last 50 events for catch-up |
| *(no type field)* | On any DB change | Live broadcast: `{ operation, table, data, timestamp }` |

`operation` is one of `INSERT`, `UPDATE`, `DELETE`.

---

## Project Structure

```
os4-final/
├── docker-compose.yml          # All services + 3 portal replicas
├── sql/
│   ├── schema.sql              # orders + order_events tables
│   ├── triggers.sql            # notify_order_change() PL/pgSQL trigger
│   └── seed.sql                # Sample data (optional)
├── backend/
│   ├── main.py                 # FastAPI app, lifespan, /ws endpoint
│   ├── db_listener.py          # Background task: PostgreSQL → Redis
│   ├── redis_broadcaster.py    # Background task: Redis → WebSockets
│   ├── websocket_manager.py    # ConnectionManager (registry + broadcast)
│   ├── redis_pubsub.py         # Redis publish/subscribe helpers
│   ├── routes_orders.py        # REST CRUD endpoints
│   ├── database.py             # asyncpg pool + schema init
│   ├── auth.py                 # JWT create/verify
│   ├── config.py               # All env vars (Settings)
│   ├── models.py               # Pydantic models
│   └── Dockerfile
└── frontend/
    ├── src/
    │   ├── components/         # Dashboard, OrderCard, EventLog, MetricsBar, ...
    │   ├── hooks/              # useWebSocket.js, AuthContext.jsx
    │   └── utils/api.js        # REST API wrapper
    ├── nginx.conf              # Proxies /api/* and /ws to backend
    └── Dockerfile
```

---

## Environment Variables

| Variable             | Default                                             | Description                    |
|----------------------|-----------------------------------------------------|--------------------------------|
| `DATABASE_URL`       | `postgresql://postgres:password@db:5432/orders_db`  | asyncpg connection string      |
| `REDIS_URL`          | `redis://redis:6379`                                | Redis connection string        |
| `JWT_SECRET`         | `orderstream-secret-key-2024`                       | **Change in production**       |
| `JWT_EXPIRY_MINUTES` | `60`                                                | Token lifetime (minutes)       |
| `CORS_ORIGINS`       | `http://localhost:4000,...`                         | Comma-separated allowed origins|
| `APP_ENV`            | `production`                                        | `development` or `production`  |

---

## Docker Commands

```bash
# Start (first run — builds images)
docker compose up --build

# Start in background
docker compose up --build -d

# View all logs live
docker compose logs -f

# Backend logs only
docker compose logs backend -f

# Stop (keeps database data)
docker compose down

# Full reset (wipes database)
docker compose down -v

# Rebuild after code changes
docker compose down -v && docker compose up --build

# Shell inside backend
docker compose exec backend bash

# PostgreSQL shell
docker compose exec db psql -U postgres -d orders_db
```

---

## Scalability

The Redis Pub/Sub layer means you can run multiple backend replicas without any code changes:

```
Load Balancer
      │
   ┌──┴──┬──────┐
   │     │      │
Back1  Back2  Back3      ← each has its own WebSocket clients
   │     │      │
   └──┬──┴──────┘
      │
    Redis            ← single shared channel; all backends subscribe
      │
  PostgreSQL         ← one primary; trigger fires once per commit
```

One DB commit → one NOTIFY → one Redis publish → all backends fan out to all their clients. Cost is O(1) per event, not O(clients).

---

## Demo Credentials

| Username | Password     | Role   |
|----------|--------------|--------|
| `admin`  | `admin123`   | admin  |
| `viewer` | `viewer123`  | viewer |
