"""
websocket_manager.py
--------------------
Manages ALL active WebSocket connections across every portal.

Because every portal (port 4000, 4001, 4002, …) connects back to the
SAME backend process, all connections land here.  When a broadcast fires
(e.g. an order status change), every connected client on every portal
receives the update in one pass — with no polling and no page refresh.

Responsibilities:
  - Track every connected client by a unique UUID.
  - Broadcast messages to ALL clients simultaneously.
  - Handle clean connect / disconnect lifecycle.
  - Run periodic heartbeat (ping/pong) to detect and prune zombie
    connections before they accumulate in the broadcast gather().
  - Expose a client count for the /metrics endpoint.

FIX 4 — Heartbeat / ping-pong:
  A WebSocket can go half-open: TCP thinks the connection is alive but
  the browser is gone (laptop lid closed, wifi drop, mobile background).
  Neither side gets an error — the socket just silently stops responding.
  Without a heartbeat, broadcast() calls gather() over an ever-growing
  set of zombie connections, each one blocking until its send times out.

  Fix: the ConnectionManager owns a background heartbeat task.  Every
  PING_INTERVAL seconds it sends {type: "ping"} to every client and
  records the send time in _ping_sent.  Any client that returns a
  {type: "pong"} message clears its entry via pong().  At the next
  heartbeat cycle, any client whose _ping_sent entry is still set
  (i.e. no pong arrived within PONG_TIMEOUT seconds) is forcibly closed
  and removed from the registry.

  The server-side receive loop in main.py now handles the "pong"
  message type rather than discarding all incoming text.
"""

import asyncio
import logging
import time

from fastapi import WebSocket


logger = logging.getLogger(__name__)

# How often to send a ping to every connected client (seconds).
PING_INTERVAL = 30

# How long to wait for a pong before treating the connection as dead (seconds).
# Must be < PING_INTERVAL so a missed pong is caught at the *next* cycle.
PONG_TIMEOUT = 10


class ConnectionManager:
    """Registry of every active WebSocket connection across all portals."""

    def __init__(self) -> None:
        self._connections: dict[str, WebSocket] = {}
        self._lock = asyncio.Lock()

        # Maps client_id → timestamp when the last ping was sent.
        # Cleared when a pong is received.  Any entry still present at
        # the next ping cycle means no pong arrived → zombie.
        self._ping_sent: dict[str, float] = {}

        # Background heartbeat task — started lazily on first connect
        # so the manager works in test contexts without a running loop.
        self._heartbeat_task: asyncio.Task | None = None

    # ── Lifecycle ──────────────────────────────────────────────────────────

    async def connect(self, client_id: str, websocket: WebSocket) -> None:
        """Accept and register a new WebSocket client."""
        await websocket.accept()
        async with self._lock:
            self._connections[client_id] = websocket

        logger.info(
            "WebSocket: client %s connected  (total across all portals: %d)",
            client_id, self.count,
        )

        # Start the heartbeat task on the first connection.
        if self._heartbeat_task is None or self._heartbeat_task.done():
            self._heartbeat_task = asyncio.create_task(
                self._heartbeat_loop(), name="ws_heartbeat"
            )

    async def disconnect(self, client_id: str) -> None:
        """Remove a client from the registry."""
        async with self._lock:
            self._connections.pop(client_id, None)
            self._ping_sent.pop(client_id, None)

        logger.info(
            "WebSocket: client %s disconnected (total across all portals: %d)",
            client_id, self.count,
        )

    def pong(self, client_id: str) -> None:
        """
        Record that client_id replied to our ping.

        Called from the per-connection receive loop in main.py when a
        {type: "pong"} message arrives.  Thread-safe: dict pop is atomic
        in CPython and we don't need the async lock here.
        """
        self._ping_sent.pop(client_id, None)
        logger.debug("WebSocket: pong from %s", client_id)

    # ── Heartbeat ──────────────────────────────────────────────────────────

    async def _heartbeat_loop(self) -> None:
        """
        Background task: ping every client every PING_INTERVAL seconds.

        Cycle:
          1. Check for clients that were pinged last cycle and never ponged
             → close + prune them (they're half-open / zombie).
          2. Send {type: "ping"} to every remaining client and record the
             send time in _ping_sent.
          3. Sleep for PING_INTERVAL seconds, then repeat.
        """
        logger.info(
            "WebSocket: heartbeat task started "
            "(interval=%ds, timeout=%ds)", PING_INTERVAL, PONG_TIMEOUT
        )

        while True:
            await asyncio.sleep(PING_INTERVAL)

            now = time.monotonic()

            # ── Step 1: prune zombies from the previous cycle ──────────
            async with self._lock:
                timed_out = [
                    cid for cid, sent_at in list(self._ping_sent.items())
                    if now - sent_at >= PONG_TIMEOUT
                ]

            for cid in timed_out:
                logger.warning(
                    "WebSocket: client %s did not pong within %ds — closing (zombie)",
                    cid, PONG_TIMEOUT,
                )
                await self._force_close(cid)

            # ── Step 2: ping every currently-connected client ──────────
            async with self._lock:
                snapshot = list(self._connections.items())

            if not snapshot:
                # No clients left — let the task exit; it will be
                # recreated on the next connect().
                logger.debug("WebSocket: no clients, heartbeat task exiting.")
                return

            ping_time = time.monotonic()
            results = await asyncio.gather(
                *[self._send_ping(cid, ws, ping_time) for cid, ws in snapshot],
                return_exceptions=True,
            )

            sent = sum(1 for r in results if r is True)
            logger.debug(
                "WebSocket: heartbeat sent ping to %d/%d client(s)",
                sent, len(snapshot),
            )

    async def _send_ping(
        self, client_id: str, websocket: WebSocket, ping_time: float
    ) -> bool:
        """
        Send a {type: "ping"} JSON message to one client.

        Records the send time in _ping_sent so the next heartbeat cycle
        can detect a missing pong.  Returns True on success, False if the
        send itself failed (connection already dead — prune immediately).
        """
        try:
            await websocket.send_json({"type": "ping"})
            async with self._lock:
                # Only record if the client is still registered (it may
                # have disconnected cleanly between the snapshot and now).
                if client_id in self._connections:
                    self._ping_sent[client_id] = ping_time
            return True
        except Exception as exc:
            logger.warning(
                "WebSocket: ping to %s failed (%s) — pruning immediately",
                client_id, exc,
            )
            await self.disconnect(client_id)
            return False

    async def _force_close(self, client_id: str) -> None:
        """Close and remove a zombie connection."""
        async with self._lock:
            websocket = self._connections.pop(client_id, None)
            self._ping_sent.pop(client_id, None)

        if websocket:
            try:
                await websocket.close(code=1001)  # Going Away
            except Exception:
                pass  # Already dead — that's the whole point

        logger.info(
            "WebSocket: zombie client %s pruned (total: %d)",
            client_id, self.count,
        )

    # ── Messaging ──────────────────────────────────────────────────────────

    async def send_to_client(self, client_id: str, message: dict) -> None:
        """Send a JSON message to a specific client."""
        websocket = self._connections.get(client_id)
        if websocket:
            try:
                await websocket.send_json(message)
            except Exception as exc:
                logger.warning("WebSocket: failed to send to %s — %s", client_id, exc)
                await self.disconnect(client_id)

    async def broadcast(self, message: dict) -> None:
        """
        Send a JSON message to EVERY connected client on EVERY portal.

        This is the core of the real-time sync: one event from Postgres
        flows through Redis and then fans out here to every browser tab,
        on every port, simultaneously — no polling, no refresh required.

        Because heartbeat pruning keeps _connections clean, gather() here
        only iterates over sockets that are actually alive.
        """
        clients = list(self._connections.items())   # snapshot before iteration

        if clients:
            logger.info(
                "WebSocket: broadcasting to %d client(s) across all portals",
                len(clients),
            )

        await asyncio.gather(*[
            self._safe_send(cid, ws, message)
            for cid, ws in clients
        ])

    async def _safe_send(
        self, client_id: str, websocket: WebSocket, message: dict
    ) -> None:
        """Send to one client; silently remove it if the connection is dead."""
        try:
            await websocket.send_json(message)
        except Exception:
            await self.disconnect(client_id)

    # ── Metrics ────────────────────────────────────────────────────────────

    @property
    def count(self) -> int:
        """Total number of connected clients across all portals."""
        return len(self._connections)
