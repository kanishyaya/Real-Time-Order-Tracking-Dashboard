/**
 * Dashboard.jsx
 *
 * Real-time order dashboard.  Works identically on every portal
 * (:4000, :4001, :4002, …) — changes from any portal appear here
 * instantly via WebSocket without a page refresh.
 *
 * Data flow:
 *   User action (create/update/delete)
 *     → REST call to /api/orders
 *     → Postgres trigger fires NOTIFY
 *     → DB Listener publishes to Redis
 *     → Redis Broadcaster fans out to ALL connected WebSocket clients
 *     → handleEvent patches the local orders list + flashes the card
 *
 * Optimistic updates:
 *   The local state is patched immediately on action so the UI feels
 *   instant.  The WebSocket event deduplicates against the optimistic
 *   update so there is no double-apply.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchOrders }  from '../utils/api'
import { useWebSocket } from '../hooks/useWebSocket'
import { useAuth }      from '../hooks/AuthContext'
import ConnectionBadge  from './ConnectionBadge'
import CreateOrderModal from './CreateOrderModal'
import EventLog         from './EventLog'
import MetricsBar       from './MetricsBar'
import OrderCard        from './OrderCard'

const MAX_LOG = 50
const FILTERS = ['all', 'pending', 'shipped', 'delivered']

export default function Dashboard() {
  const { token, logout } = useAuth()

  const [orders,      setOrders]      = useState([])
  const [eventLog,    setEventLog]    = useState([])
  const [highlighted, setHighlighted] = useState(new Set())
  const [showModal,   setShowModal]   = useState(false)
  const [loading,     setLoading]     = useState(true)
  const [filter,      setFilter]      = useState('all')

  // Keep a ref to token so handleEvent can call fetchOrders without
  // being listed as a dep (which would recreate the WS on every re-render)
  const tokenRef = useRef(token)
  useEffect(() => { tokenRef.current = token }, [token])

  // FIX 3: Track the highest `version` value we have seen across all
  // orders. On WebSocket reconnect we call GET /orders?since_version=<N>
  // to fetch only the rows that changed while we were disconnected,
  // then merge them into local state. This closes the gap window without
  // a full re-fetch.
  const maxVersionRef = useRef(0)

  // Helper: update maxVersionRef whenever we ingest a batch of orders.
  const trackVersion = useCallback((orderOrOrders) => {
    const list = Array.isArray(orderOrOrders) ? orderOrOrders : [orderOrOrders]
    list.forEach(o => {
      if (o.version != null && o.version > maxVersionRef.current) {
        maxVersionRef.current = o.version
      }
    })
  }, [])

  // ── Initial fetch ───────────────────────────────────────────
  useEffect(() => {
    fetchOrders(token)
      .then(orders => {
        setOrders(orders)
        trackVersion(orders)   // seed maxVersionRef from initial snapshot
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [token, trackVersion])

  // ── Flash a card for 2.5 s ──────────────────────────────────
  const flash = useCallback((id) => {
    setHighlighted(prev => new Set([...prev, id]))
    setTimeout(() => setHighlighted(prev => {
      const n = new Set(prev)
      n.delete(id)
      return n
    }), 2500)
  }, [])

  // ── Optimistic update — instant local state patch ───────────
  const applyOptimistic = useCallback((op, row) => {
    setOrders(prev => {
      if (op === 'UPDATE') return prev.map(o => o.id === row.id ? { ...o, ...row } : o)
      if (op === 'DELETE') return prev.filter(o => o.id !== row.id)
      if (op === 'INSERT') return prev.some(o => o.id === row.id) ? prev : [row, ...prev]
      return prev
    })
  }, [])

  // ── WebSocket event handler ─────────────────────────────────
  // Stable reference — does NOT list `token` as a dep to avoid
  // reconstructing the WebSocket every time the token object changes.
  const handleEvent = useCallback((data) => {

    // Connection confirmation — ignore
    if (data.type === 'connection') return

    // Replay — another client joined; refetch a fresh snapshot so
    // the orders list is guaranteed consistent.
    if (data.type === 'replay') {
      fetchOrders(tokenRef.current).then(setOrders).catch(console.error)
      return
    }

    const { operation, data: row } = data
    if (!operation || !row) return

    // FIX 3: keep maxVersionRef current so reconnect catch-up is precise.
    trackVersion(row)

    // Push to event log (capped at MAX_LOG entries)
    setEventLog(prev => [
      { operation, data: row, timestamp: data.timestamp },
      ...prev,
    ].slice(0, MAX_LOG))

    // Patch the orders list — deduplicate against any optimistic update
    setOrders(prev => {
      if (operation === 'INSERT') {
        // Skip if optimistic insert already added it
        return prev.some(o => o.id === row.id) ? prev : [row, ...prev]
      }
      if (operation === 'UPDATE') {
        return prev.map(o => {
          if (o.id !== row.id) return o
          // Skip if optimistic already applied this exact state
          if (
            o.status        === row.status &&
            o.customer_name === row.customer_name &&
            o.product_name  === row.product_name
          ) return o
          return { ...o, ...row }
        })
      }
      if (operation === 'DELETE') {
        return prev.filter(o => o.id !== row.id)
      }
      return prev
    })

    // Flash the card so the user sees what changed
    if (operation === 'INSERT' || operation === 'UPDATE') {
      flash(row.id)
    }

  }, [flash, trackVersion])   // flash and trackVersion are stable; token via tokenRef

  // FIX 3: On reconnect, fetch only rows that changed since the last
  // version we saw. Merge them in via applyOptimistic so we don't
  // overwrite cards the user is looking at.
  const handleReconnect = useCallback(() => {
    const sinceVersion = maxVersionRef.current
    fetchOrders(tokenRef.current, sinceVersion)
      .then(changedOrders => {
        if (changedOrders.length === 0) return
        trackVersion(changedOrders)
        changedOrders.forEach(order => applyOptimistic('UPDATE', order))
        console.info(
          `[WS] reconnect catch-up: ${changedOrders.length} order(s) changed since version ${sinceVersion}`
        )
      })
      .catch(err => console.error('[WS] reconnect catch-up failed', err))
  }, [applyOptimistic, trackVersion])

  const { status: wsStatus } = useWebSocket(token, handleEvent, handleReconnect)

  // ── Filter counts ───────────────────────────────────────────
  const counts = {
    all:       orders.length,
    pending:   orders.filter(o => o.status === 'pending').length,
    shipped:   orders.filter(o => o.status === 'shipped').length,
    delivered: orders.filter(o => o.status === 'delivered').length,
  }

  const displayed = filter === 'all' ? orders : orders.filter(o => o.status === filter)

  const FILTER_COLOR = {
    all: 'var(--t2)', pending: 'var(--amber)', shipped: 'var(--cyan)', delivered: 'var(--green)',
  }

  return (
    <div style={{ minHeight:'100vh', background:'var(--obsidian)', display:'flex', flexDirection:'column', position:'relative' }}>

      {/* Global ambient glow */}
      <div style={{ position:'fixed', top:0, left:'40%', width:500, height:300, pointerEvents:'none', zIndex:0,
        background:'radial-gradient(ellipse, rgba(0,212,255,0.03) 0%, transparent 70%)' }} />

      {/* Top cyan rule */}
      <div style={{ height:1, background:'linear-gradient(90deg,transparent 0%,rgba(0,212,255,0.35) 35%,rgba(0,212,255,0.35) 65%,transparent 100%)', flexShrink:0, position:'relative', zIndex:10 }} />

      {/* Header */}
      <header style={{
        position:'sticky', top:0, zIndex:50,
        display:'flex', justifyContent:'space-between', alignItems:'center',
        padding:'0 28px', height:60, flexShrink:0,
        background:'rgba(9,12,20,0.92)', borderBottom:'1px solid var(--border-0)',
        backdropFilter:'blur(20px)',
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:18 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:28, height:28, borderRadius:8,
              background:'rgba(0,212,255,0.08)', border:'1px solid rgba(0,212,255,0.22)',
              display:'flex', alignItems:'center', justifyContent:'center' }}>
              <div style={{ width:7, height:7, borderRadius:'50%', background:'var(--cyan)',
                boxShadow:'0 0 6px rgba(0,212,255,0.5)' }} />
            </div>
            <div>
              <p style={{ fontSize:13, fontWeight:600, color:'var(--t0)', letterSpacing:'-0.01em', lineHeight:1 }}>OrderStream</p>
              <p style={{ fontSize:9, color:'var(--t4)', fontFamily:'var(--mono)', marginTop:2, letterSpacing:'0.06em' }}>CONTROL SURFACE</p>
            </div>
          </div>
          <MetricsBar />
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <ConnectionBadge status={wsStatus} />

          <button onClick={() => setShowModal(true)} style={{
            display:'flex', alignItems:'center', gap:7,
            padding:'7px 16px',
            background:'rgba(0,212,255,0.08)', border:'1px solid rgba(0,212,255,0.25)',
            borderRadius:'var(--r2)', fontSize:12, fontWeight:500, color:'var(--cyan)',
            fontFamily:'var(--mono)', letterSpacing:'0.06em', transition:'all 0.15s',
          }}
            onMouseEnter={e => { e.currentTarget.style.background='rgba(0,212,255,0.16)'; e.currentTarget.style.borderColor='rgba(0,212,255,0.4)' }}
            onMouseLeave={e => { e.currentTarget.style.background='rgba(0,212,255,0.08)'; e.currentTarget.style.borderColor='rgba(0,212,255,0.25)' }}
          >
            <span style={{ fontSize:15, lineHeight:1, marginTop:-1 }}>+</span>
            NEW ORDER
          </button>

          <button onClick={logout} style={{
            padding:'7px 14px', background:'transparent',
            border:'1px solid var(--border-0)', borderRadius:'var(--r2)',
            fontSize:11, color:'var(--t3)', fontFamily:'var(--mono)',
            letterSpacing:'0.06em', transition:'all 0.15s',
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor='var(--border-1)'; e.currentTarget.style.color='var(--t2)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border-0)'; e.currentTarget.style.color='var(--t3)' }}
          >SIGN OUT</button>
        </div>
      </header>

      {/* Body */}
      <div style={{
        flex:1, display:'flex', gap:18, padding:'22px 28px',
        maxWidth:1480, width:'100%', margin:'0 auto', boxSizing:'border-box',
        position:'relative', zIndex:1,
      }}>
        <main style={{ flex:1, display:'flex', flexDirection:'column', gap:18, minWidth:0 }}>

          {/* Filter bar */}
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            {FILTERS.map(f => {
              const active = filter === f
              const rgb = f==='all' ? '141,154,181' : f==='pending' ? '255,181,71' : f==='shipped' ? '0,212,255' : '0,229,160'
              return (
                <button key={f} onClick={() => setFilter(f)} style={{
                  display:'flex', alignItems:'center', gap:7,
                  padding:'6px 14px', borderRadius:'var(--r2)',
                  background: active ? `rgba(${rgb},0.1)` : 'var(--surface-2)',
                  border: active ? `1px solid rgba(${rgb},0.3)` : '1px solid var(--border-0)',
                  color: active ? FILTER_COLOR[f] : 'var(--t3)',
                  fontSize:11, fontWeight:active ? 500 : 400, fontFamily:'var(--mono)',
                  letterSpacing:'0.08em', textTransform:'uppercase',
                  transition:'all 0.15s var(--ease)', cursor:'pointer',
                }}>
                  {f}
                  <span style={{
                    fontSize:10, fontFamily:'var(--mono)',
                    color: active ? FILTER_COLOR[f] : 'var(--t4)',
                    background: active ? `rgba(${rgb},0.15)` : 'var(--surface-3)',
                    padding:'1px 7px', borderRadius:999,
                  }}>{counts[f]}</span>
                </button>
              )
            })}
          </div>

          {/* Order grid */}
          {loading ? (
            <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:12, color:'var(--t3)', fontSize:13, fontFamily:'var(--mono)' }}>
              <span style={{ width:16, height:16, border:'1.5px solid rgba(0,212,255,0.2)', borderTop:'1.5px solid var(--cyan)', borderRadius:'50%', animation:'spin 0.6s linear infinite' }} />
              initializing...
            </div>
          ) : displayed.length === 0 ? (
            <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10 }}>
              <div style={{ width:48, height:48, borderRadius:14, background:'var(--surface-2)', border:'1px solid var(--border-0)',
                display:'flex', alignItems:'center', justifyContent:'center', marginBottom:4 }}>
                <span style={{ fontSize:20, opacity:0.2 }}>◎</span>
              </div>
              <p style={{ fontSize:14, fontWeight:500, color:'var(--t2)' }}>No orders</p>
              <p style={{ fontSize:12, color:'var(--t4)', fontFamily:'var(--mono)' }}>
                {filter === 'all' ? '// create your first order' : `// no ${filter} orders`}
              </p>
            </div>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(290px,1fr))', gap:14, alignContent:'start' }}>
              {displayed.map(order => (
                <OrderCard
                  key={order.id}
                  order={order}
                  highlighted={highlighted.has(order.id)}
                  onOptimisticUpdate={applyOptimistic}
                />
              ))}
            </div>
          )}
        </main>

        {/* Event log sidebar */}
        <aside style={{ width:264, flexShrink:0, height:'calc(100vh - 102px)', position:'sticky', top:78 }}>
          <EventLog events={eventLog} />
        </aside>
      </div>

      {showModal && (
        <CreateOrderModal
          onClose={() => setShowModal(false)}
          onOptimisticInsert={row => applyOptimistic('INSERT', row)}
        />
      )}
    </div>
  )
}
