/**
 * useWebSocket.js
 *
 * FIX 3: On reconnect, calls onReconnect() so the caller can do a
 * targeted GET /orders?since_version=<N> catch-up instead of a full
 * re-fetch. This converts "hope no message was missed" into
 * "always self-heal on reconnect".
 *
 * The hook itself stays transport-only — it doesn't know about orders
 * or versions. The caller (Dashboard) owns that state and passes the
 * callback in.
 */

import { useEffect, useRef, useState } from 'react'

const BACKOFF = [1000, 2000, 4000, 8000, 16000]

/**
 * @param {string|null} token  - JWT for the WS handshake
 * @param {function}    onEvent      - called with each parsed JSON message
 * @param {function}    [onReconnect] - called (with no args) whenever the
 *                                     socket reconnects after a prior
 *                                     successful connection. Use this to
 *                                     trigger a since_version catch-up fetch.
 */
export function useWebSocket(token, onEvent, onReconnect) {
  const [status, setStatus]  = useState('disconnected')
  const wsRef         = useRef(null)
  const onEventRef    = useRef(onEvent)
  const onReconnectRef= useRef(onReconnect)
  const attemptRef    = useRef(0)
  const deadRef       = useRef(false)
  const timerRef      = useRef(null)
  // Track whether we have ever had a successful connection so we can
  // distinguish "first connect" from "reconnect after a drop".
  const wasConnectedRef = useRef(false)

  useEffect(() => { onEventRef.current    = onEvent    }, [onEvent])
  useEffect(() => { onReconnectRef.current = onReconnect }, [onReconnect])

  useEffect(() => {
    if (!token) return
    deadRef.current = false

    function connect() {
      if (deadRef.current) return
      setStatus('connecting')

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${token}`)
      wsRef.current = ws

      ws.onopen = () => {
        if (deadRef.current) { ws.close(); return }
        setStatus('connected')

        // If this is a reconnect (not the first connection), give the
        // caller a chance to fetch missed updates before live events start
        // streaming in again.
        if (wasConnectedRef.current && onReconnectRef.current) {
          onReconnectRef.current()
        }
        wasConnectedRef.current = true
        attemptRef.current = 0
      }

      ws.onmessage = (evt) => {
        if (deadRef.current) return
        let msg
        try { msg = JSON.parse(evt.data) }
        catch (e) { console.warn('[WS] parse error', e); return }

        // FIX 4: reply to server heartbeat pings immediately.
        // The server sends {type: "ping"} every PING_INTERVAL seconds and
        // expects {type: "pong"} back within PONG_TIMEOUT seconds. If no
        // pong arrives the server treats the connection as a zombie and
        // closes it. We reply here before passing the message upstream so
        // the application layer never has to think about heartbeats.
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }))
          return  // ping/pong is transport-level — don't forward to app
        }

        onEventRef.current(msg)
      }

      ws.onerror = () => {
        if (!deadRef.current) setStatus('error')
      }

      ws.onclose = () => {
        if (deadRef.current) return
        setStatus('disconnected')
        const delay = BACKOFF[Math.min(attemptRef.current, BACKOFF.length - 1)]
        attemptRef.current++
        timerRef.current = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      deadRef.current = true
      clearTimeout(timerRef.current)
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
      setStatus('disconnected')
    }
  }, [token])

  return { status }
}
