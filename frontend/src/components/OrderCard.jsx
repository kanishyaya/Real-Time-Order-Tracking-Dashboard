import { useEffect, useState } from 'react'
import { updateOrder, deleteOrder } from '../utils/api'
import { useAuth } from '../hooks/AuthContext'

const ST = {
  pending:   {color:'var(--amber)', bg:'rgba(255,181,71,0.08)',  border:'rgba(255,181,71,0.2)',  bar:'#ffb547', pct:20},
  shipped:   {color:'var(--cyan)',  bg:'rgba(0,212,255,0.08)',   border:'rgba(0,212,255,0.2)',   bar:'#00d4ff', pct:60},
  delivered: {color:'var(--green)', bg:'rgba(0,229,160,0.08)', border:'rgba(0,229,160,0.2)',  bar:'#00e5a0', pct:100},
}

export default function OrderCard({order, highlighted, onOptimisticUpdate}) {
  const {token} = useAuth()
  const [hovered, setHovered] = useState(false)
  const [flash,   setFlash]   = useState(false)
  const [busy,    setBusy]    = useState(false)

  useEffect(() => {
    if (highlighted) {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 2200)
      return () => clearTimeout(t)
    }
  }, [highlighted])

  const handleStatus = async e => {
    const next = e.target.value
    if (busy || next === order.status) return
    setBusy(true)
    onOptimisticUpdate('UPDATE', {...order, status:next})
    try { await updateOrder(token, order.id, {status:next}) }
    catch(err) { console.error(err); onOptimisticUpdate('UPDATE', {...order}) }
    finally { setBusy(false) }
  }

  const handleDelete = async () => {
    if (busy || !window.confirm(`Delete order #${order.id}?`)) return
    setBusy(true)
    onOptimisticUpdate('DELETE', {id:order.id})
    try { await deleteOrder(token, order.id) }
    catch(err) { console.error(err); onOptimisticUpdate('INSERT', {...order}); setBusy(false) }
  }

  const s = ST[order.status] || ST.pending

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position:'relative',
        background: hovered ? 'var(--surface-3)' : 'var(--surface-2)',
        border: flash
          ? '1px solid rgba(0,212,255,0.45)'
          : `1px solid ${hovered ? 'var(--border-1)' : 'var(--border-0)'}`,
        borderRadius:'var(--r3)',overflow:'hidden',
        transition:'all 0.2s var(--ease)',
        transform: hovered ? 'translateY(-4px)' : 'translateY(0)',
        boxShadow: flash
          ? '0 0 0 4px rgba(0,212,255,0.08), 0 16px 48px rgba(0,0,0,0.5)'
          : hovered ? '0 16px 48px rgba(0,0,0,0.45)' : 'none',
        animation:'cardIn 0.3s var(--ease) both',
      }}
    >
      {/* Top progress bar */}
      <div style={{height:2,background:'var(--border-0)',position:'relative',overflow:'hidden'}}>
        <div style={{
          position:'absolute',top:0,left:0,height:'100%',width:`${s.pct}%`,
          background:s.bar,borderRadius:1,
          transition:'width 0.55s var(--spring)',
          transformOrigin:'left',
        }}/>
      </div>

      {/* Glow on flash */}
      {flash && (
        <div style={{position:'absolute',top:0,left:0,right:0,height:60,pointerEvents:'none',
          background:'linear-gradient(180deg,rgba(0,212,255,0.06) 0%,transparent 100%)'}}/>
      )}

      <div style={{padding:'18px 20px 18px'}}>

        {/* Header */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:10,fontFamily:'var(--mono)',color:'var(--t4)',fontWeight:500,letterSpacing:'0.06em'}}>
              ORD-{String(order.id).padStart(4,'0')}
            </span>
            {flash && (
              <span style={{
                fontSize:9,fontWeight:500,letterSpacing:'0.1em',textTransform:'uppercase',
                color:'var(--cyan)',background:'rgba(0,212,255,0.1)',
                border:'1px solid rgba(0,212,255,0.25)',padding:'2px 6px',
                borderRadius:4,fontFamily:'var(--mono)',animation:'fadeIn 0.2s ease',
              }}>UPDATED</span>
            )}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:5,
            background:s.bg,border:`1px solid ${s.border}`,
            padding:'4px 10px',borderRadius:999,transition:'all 0.22s var(--ease)'}}>
            <span style={{width:4,height:4,borderRadius:'50%',background:s.color,flexShrink:0}}/>
            <span style={{fontSize:10,fontWeight:500,color:s.color,fontFamily:'var(--mono)',letterSpacing:'0.08em',textTransform:'uppercase'}}>
              {order.status}
            </span>
          </div>
        </div>

        {/* Customer — hero */}
        <p style={{fontSize:16,fontWeight:500,color:'var(--t0)',marginBottom:4,
          letterSpacing:'-0.02em',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          {order.customer_name}
        </p>
        <p style={{fontSize:12,color:'var(--t3)',marginBottom:16,
          overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          {order.product_name}
        </p>

        {/* Timestamp */}
        <p style={{fontSize:10,color:'var(--t4)',fontFamily:'var(--mono)',marginBottom:18,letterSpacing:'0.02em'}}>
          {new Date(order.updated_at).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})}
        </p>

        {/* Divider */}
        <div style={{height:1,background:'var(--border-0)',marginBottom:14}}/>

        {/* Actions */}
        <div style={{display:'flex',gap:8}}>
          <select value={order.status} onChange={handleStatus} disabled={busy} style={{
            flex:1,padding:'8px 10px',
            background:'var(--surface-4)',border:'1px solid var(--border-1)',
            borderRadius:'var(--r1)',fontSize:11,color:'var(--t2)',fontFamily:'var(--mono)',
            cursor:busy?'wait':'pointer',outline:'none',
            transition:'border-color 0.15s',opacity:busy?0.5:1,
            letterSpacing:'0.02em',
          }}
            onFocus={e=>e.target.style.borderColor='rgba(0,212,255,0.35)'}
            onBlur={e=>e.target.style.borderColor='var(--border-1)'}
          >
            <option value="pending">→ Pending</option>
            <option value="shipped">→ Shipped</option>
            <option value="delivered">→ Delivered</option>
          </select>

          <button onClick={handleDelete} disabled={busy} style={{
            padding:'8px 14px',
            background:'rgba(255,91,91,0.06)',
            border:'1px solid rgba(255,91,91,0.15)',
            borderRadius:'var(--r1)',fontSize:11,color:'var(--red)',
            fontFamily:'var(--mono)',letterSpacing:'0.04em',
            transition:'all 0.15s',opacity:busy?0.4:1,
          }}
            onMouseEnter={e=>{if(!busy){e.currentTarget.style.background='rgba(255,91,91,0.14)';e.currentTarget.style.borderColor='rgba(255,91,91,0.3)'}}}
            onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,91,91,0.06)';e.currentTarget.style.borderColor='rgba(255,91,91,0.15)'}}
          >{busy ? '...' : 'DEL'}</button>
        </div>
      </div>
    </div>
  )
}
