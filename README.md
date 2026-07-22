# Real-Time Order Tracking Platform

A scalable, event-driven order tracking system built with FastAPI, PostgreSQL, Redis Streams, WebSockets, Docker, and React. The system listens for database changes and instantly pushes updates to all connected clients — no polling, no page refreshes.

Open three browser tabs on different ports. Create an order on one. Watch it appear on all others in under a second.

---

## Features

- Real-time order updates across all connected clients simultaneously
- PostgreSQL `LISTEN`/`NOTIFY` triggers — the DB itself fires the event
- Redis Streams (`XADD`/`XREAD`) as the durable messaging layer between the DB listener and the backend — survives broadcaster restarts without dropping events, unlike plain Pub/Sub
- A dedicated, singleton `listener` service converts `NOTIFY` into stream entries, so scaling the backend never produces duplicate broadcasts
- WebSocket broadcasting to every browser tab at once
- Event replay on reconnect (last 50 events sent on connect)
- Version-based catch-up: `GET /orders?since_version=N` lets a reconnecting client fetch only what it missed, on top of the event replay
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
  bump_order_version() / notify_order_change()
  pg_notify('order_updates', payload)
           ↓
  listener service (singleton, listener/main.py)
  asyncpg LISTEN on 'order_updates'
           ↓
  Redis Stream
  key: "order_events_stream"  (XADD)
           ↓
  backend service (redis_broadcaster.py)
  XREAD, resumes from a persisted cursor on restart
           ↓
  WebSocket Manager
  ConnectionManager.broadcast()
           ↓
  React Frontend Updates Instantly
  (all tabs, all portals, simultaneously)
```

Two independent processes do the DB→browser hop, on purpose:

- **`listener`** is pinned to exactly one replica. It is the only thing allowed to `LISTEN` on Postgres and `XADD` to the stream — if this ran inside a horizontally-scaled `backend`, every replica would re-publish the same change and clients would see duplicate broadcasts.
- **`backend`** scales freely. Every replica does its own `XREAD` of the same stream and fans events out to only the WebSocket clients connected to *that* replica.
- Using a **Redis Stream** instead of plain Pub/Sub means a `backend` restart doesn't lose events: the read cursor is persisted in Redis (`REDIS_STREAM_CURSOR`), so a restarted broadcaster resumes exactly where it left off instead of only seeing new messages.

### Full system diagram

```
Browser :4000    Browser :4001    Browser :4002
    │                 │                 │
    └─────────────────┼─────────────────┘
                      │  WebSocket connections
                ┌─────▼──────┐
                │  FastAPI   │
                │  Backend   │   (scales freely)
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
  │ PostgreSQL  │        │ redis_broadcaster │
  │ orders      │        │ (XREAD, backend)  │
  │             │        └─────────▲────────┘
  │ Trigger →   │                  │
  │ NOTIFY      │        ┌─────────┴────────┐
  └──────┬──────┘        │   Redis Stream    │
         │               │ "order_events_    │
         │               │      stream"      │
         │               └─────────▲────────┘
         │                         │
         │               ┌─────────┴────────┐
         └───LISTEN───────▶   listener       │
                          │  (singleton,      │
                          │   XADD only)      │
                          └───────────────────┘
```

---

## Tech Stack

**Backend**
- Python 3.12, FastAPI, uvicorn (async-first ASGI stack)
- PostgreSQL 16 (Alpine image) with `LISTEN`/`NOTIFY` and PL/pgSQL triggers
- Redis 7 (Alpine image) Streams (`XADD`/`XREAD`) as a durable message bus between the `listener` service and the `backend`'s broadcaster
- asyncpg (native async PostgreSQL driver with LISTEN support)
- JWT authentication (python-jose, HS256) — demo credentials only, plain-text compare, not production-hardened
- Separate `listener` microservice (singleton) so `backend` can be scaled without duplicate events

**Frontend**
- React 18, Vite
- TailwindCSS
- nginx (serves React build and proxies `/api/*` and `/ws` to backend)

**DevOps**
- Docker, Docker Compose (v2 syntax, `docker compose ...`)
- 7 containers total: `db`, `redis`, `listener`, `backend`, and three frontend replicas (`frontend`, `frontend2`, `frontend3`) on ports 4000, 4001, 4002, all sharing one backend
- Postgres and Redis both have Compose healthchecks; `listener` and `backend` wait on `service_healthy` before starting

---

## Why I Chose This Architecture

### Event-driven over polling

I used an **event-driven architecture** instead of polling to achieve low-latency real-time updates efficiently.

With polling, every client repeatedly asks "did anything change?" — cost scales as **O(clients × poll_frequency)**. With 1,000 clients polling every 5 seconds, that is 200 database requests per second at idle, even when nothing has changed. With this event-driven design, the cost is **O(1) per actual change** — one trigger, one Redis publish, one fan-out — regardless of how many clients are connected.

### Why PostgreSQL `LISTEN`/`NOTIFY` over application-level events?

The database is the authoritative source of truth. If you fire events at the application layer — "publish to Redis after my INSERT succeeds" — you risk a silent failure: a crash between the INSERT and the publish leaves clients permanently out of sync. Using a **database trigger** guarantees that every committed write fires exactly one notification, regardless of which code path or backend instance caused it. There is no way to insert, update, or delete an order without the trigger firing. Even direct `psql` edits by a DBA propagate automatically.

### Why Redis Streams (not plain Pub/Sub) as the middle layer?

**Decoupling and horizontal scalability.** A single FastAPI process could receive the PostgreSQL NOTIFY and directly broadcast to its own WebSocket clients — but with multiple backend replicas behind a load balancer, each replica only sees its own connected clients. Redis solves this: every backend replica reads the same stream. When the `listener` writes an event, every replica sees it and broadcasts to its own client pool. Scaling from one backend to ten requires no code changes.

Plain Pub/Sub was considered and rejected: a `SUBSCRIBE`-based broadcaster that restarts in the gap between a `NOTIFY` firing and its resubscribe silently loses that event forever. A **Redis Stream** (`XADD`/`XREAD`) keeps entries durable up to `STREAM_MAXLEN`, and each backend replica persists its own last-read ID (`REDIS_STREAM_CURSOR`) in Redis, so a restart resumes exactly where it left off instead of only catching new messages.

Redis also decouples the singleton `listener` service from the `backend`'s broadcaster — each has independent reconnect logic and can restart without affecting the other. The `listener` is deliberately kept to exactly one replica (`deploy.replicas: 1` in `docker-compose.yml`): if the NOTIFY→stream step ran inside a horizontally-scaled `backend`, every replica would republish the same change and clients would receive duplicate broadcasts.

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

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running (Docker Compose v2 — check with `docker compose version`)
- Ports `4000`, `4001`, `4002` free on your machine
- (Optional) [VS Code](https://code.visualstudio.com/) with the **Docker** and **Dev Containers** extensions, for a nicer log/container view than the raw CLI

### 1 — Unzip the project

```bash
unzip os4-fixed.zip
cd os4-fixed
```

> The `docker-compose.yml` file must be directly inside the folder you `cd` into. If `docker compose up` says `no configuration file provided: not found`, you're one level too high or too low — run `dir` (Windows) / `ls` (macOS/Linux) and `cd` into the folder that directly contains `docker-compose.yml`.

### 2 — (Optional) Open in VS Code

```bash
code .
```

Use the integrated terminal (`` Ctrl+` ``) for the commands below, or use the **Docker** sidebar extension to start/stop/inspect containers and stream logs visually instead of the CLI.

### 3 — Start everything

```bash
docker compose up --build
```

This builds and starts **7 containers**: PostgreSQL, Redis, the singleton `listener` service, the FastAPI `backend`, and three nginx/React frontend replicas (`frontend`, `frontend2`, `frontend3`).

To run in the background instead (frees up your terminal):
```bash
docker compose up --build -d
docker compose logs -f
```

### 4 — Wait for these log lines

```
db-1         | database system is ready to accept connections
redis-1      | Ready to accept connections
listener-1   | Listener: subscribed to 'order_updates'
backend-1    | Schema and triggers applied.
backend-1    | Application startup complete.
frontend-1   | start worker process
```

The backend automatically runs `sql/schema.sql` and `sql/triggers.sql` against Postgres on first boot (see [Troubleshooting](#troubleshooting) if this fails on a second run).

### 5 — Open the portals

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
os4-fixed/
├── docker-compose.yml          # All 7 services: db, redis, listener, backend, 3x frontend
├── .gitignore
├── sql/
│   ├── schema.sql              # orders (incl. version col) + order_events tables
│   ├── triggers.sql            # notify_order_change() PL/pgSQL trigger
│   └── seed.sql                # Sample data (optional)
├── listener/
│   ├── main.py                 # Singleton: Postgres LISTEN → Redis XADD
│   ├── requirements.txt
│   └── Dockerfile
├── backend/
│   ├── main.py                 # FastAPI app, lifespan, /ws endpoint
│   ├── db_listener.py          # Legacy/alt DB listener helper
│   ├── redis_broadcaster.py    # Background task: Redis Stream (XREAD) → WebSockets
│   ├── redis_pubsub.py         # Redis publish/subscribe helpers
│   ├── websocket_manager.py    # ConnectionManager (registry + broadcast)
│   ├── routes_orders.py        # REST CRUD + since_version catch-up endpoint
│   ├── database.py             # asyncpg pool + schema init + query helpers
│   ├── auth.py                 # JWT create/verify, demo user store
│   ├── config.py                # All env vars (Settings)
│   ├── models.py                # Pydantic models
│   ├── requirements.txt
│   ├── .env.example             # Template for running backend outside Docker
│   └── Dockerfile
└── frontend/
    ├── src/
    │   ├── components/         # Dashboard, OrderCard, EventLog, MetricsBar, LoginPage, ConnectionBadge, CreateOrderModal
    │   ├── hooks/               # useWebSocket.js, AuthContext.jsx
    │   └── utils/api.js         # REST API wrapper
    ├── index.html
    ├── vite.config.js
    ├── package.json
    ├── nginx.conf                # Proxies /api/* and /ws to backend
    └── Dockerfile
```

---

## Environment Variables

| Variable               | Default                                             | Description                                          |
|------------------------|-----------------------------------------------------|-------------------------------------------------------|
| `DATABASE_URL`         | `postgresql://postgres:password@db:5432/orders_db`  | asyncpg connection string                              |
| `REDIS_URL`            | `redis://redis:6379`                                | Redis connection string                                |
| `REDIS_STREAM`         | `order_events_stream`                               | Stream key carrying DB change events (listener → backend) |
| `REDIS_STREAM_CURSOR`  | `order_events_stream:cursor`                        | Redis key storing the backend's last-read stream ID (backend only) |
| `STREAM_MAXLEN`        | `10000`                                             | Approx. max entries kept in the stream                 |
| `STREAM_READ_COUNT`    | `100`                                               | Messages fetched per `XREAD` call (backend only)        |
| `JWT_SECRET`           | `orderstream-secret-key-2024`                       | **Change in production**                                |
| `JWT_ALGORITHM`        | `HS256`                                             | JWT signing algorithm                                   |
| `JWT_EXPIRY_MINUTES`   | `60`                                                | Token lifetime (minutes)                                |
| `CORS_ORIGINS`         | `http://localhost:4000,http://localhost:4001,http://localhost:4002,...` | Comma-separated allowed origins    |
| `APP_ENV`              | `production` (via compose) / `development` (default in code) | `development` or `production`         |

All of the above are already set for you inside `docker-compose.yml` for the containerized run — you only need `backend/.env.example` → `.env` if running the backend outside Docker (e.g. via VS Code's Python debugger).

---

## Troubleshooting

### `no configuration file provided: not found`

You ran `docker compose up` from the wrong directory. Zip tools sometimes nest the project inside an extra folder with the same name (e.g. `os4-fixed\os4-fixed\docker-compose.yml`). Run `dir` / `ls` and `cd` into whichever folder directly contains `docker-compose.yml`.

### `backend-1 exited with code 3 (restarting)` / restart loop

The backend crashed on startup and Compose is retrying forever. This is not "still starting up" — check the actual error:

```bash
docker compose logs backend --tail=50
```

### `asyncpg.exceptions.UndefinedColumnError: column "version" does not exist` (or similar schema errors)

This happens when a Postgres data volume from an **earlier run** already has an `orders` (or other) table, but with an older shape. `sql/schema.sql` uses `CREATE TABLE IF NOT EXISTS`, so it silently skips re-creating a table that already exists — even if that table is missing columns the current backend code expects.

Fix: wipe the Postgres volume and rebuild from a clean database.

```bash
docker compose down -v
docker compose up --build
```

`-v` removes the named volumes (`postgres_data`), so you lose any data in the database — fine for local dev, not something to do against a real deployment.

### Port already in use (`4000`/`4001`/`4002`/`5432`/`6379`)

Something else on your machine is bound to one of these ports. Either stop that process, or change the host-side port mapping in `docker-compose.yml`, e.g.:
```yaml
frontend:
  ports:
    - "4010:80"   # was 4000:80
```
(Postgres/Redis ports aren't published to the host by default in this compose file, so conflicts there usually mean a leftover container — check `docker ps -a`.)

### Frontend loads but WebSocket won't connect / login fails

- Confirm `backend` actually reached `Application startup complete` (see previous sections) — if it's mid-crash-loop, nginx has nothing to proxy to.
- Check the browser console/network tab for the `/ws?token=...` request status.
- Confirm you're using one of the demo logins exactly: `admin`/`admin123` or `viewer`/`viewer123`.

### Changed backend/frontend code but don't see the changes

Docker cached the old build layer. Force a rebuild:
```bash
docker compose down -v && docker compose up --build
```

### Still stuck

Grab the full logs and inspect the first error, not the last (later errors are often just restart-loop noise from the first failure):
```bash
docker compose logs > full-logs.txt
```

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

The Redis Streams layer means you can run multiple `backend` replicas without any code changes — the `listener` stays a singleton, everything else scales:

```
Load Balancer
      │
   ┌──┴──┬──────┐
   │     │      │
Back1  Back2  Back3      ← each has its own WebSocket clients, each does its own XREAD
   │     │      │
   └──┬──┴──────┘
      │
    Redis Stream     ← single shared stream; every backend replica reads every entry
      │
   listener          ← SINGLETON — only process that LISTENs + XADDs
      │
  PostgreSQL         ← one primary; trigger fires once per commit
```

One DB commit → one NOTIFY → one `XADD` → every `backend` replica's `XREAD` fans out to its own clients. Cost is O(1) per event, not O(clients). Try it locally:

```bash
docker compose up --build --scale backend=3
```

(Note: with multiple `backend` replicas you'd also need a load balancer in front of them for this to be useful beyond a demo — this compose file doesn't set one up.)

---

## Demo Credentials

| Username | Password     | Role   |
|----------|--------------|--------|
| `admin`  | `admin123`   | admin  |
| `viewer` | `viewer123`  | viewer |
