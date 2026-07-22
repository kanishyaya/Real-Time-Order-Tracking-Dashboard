/**
 * EventLog.jsx
 * 
 * FIXED: Shows full event details — operation, order ID, customer,
 * product name, status, and timestamp for every single event.
 * DELETE events show what was removed.
 */

const OP = {
  INSERT: { color:'var(--green)', bg:'rgba(0,229,160,0.1)',  border:'rgba(0,229,160,0.2)',  label:'NEW' },
  UPDATE: { color:'var(--cyan)',  bg:'rgba(0,212,255,0.1)',  border:'rgba(0,212,255,0.2)',  label:'UPD' },
  DELETE: { color:'var(--red)',   bg:'rgba(255,91,91,0.1)',  border:'rgba(255,91,91,0.2)',  label:'DEL' },
}

export default function EventLog({ events }) {
  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column',
      background:'var(--surface-1)', border:'1px solid var(--border-0)',
      borderRadius:'var(--r3)', overflow:'hidden' }}>

      {/* Header */}
      <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border-0)',
        display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0,
        background:'rgba(255,255,255,0.015)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ width:5, height:5, borderRadius:'50%', background:'var(--cyan)',
            flexShrink:0, animation:'pulse 2s ease-in-out infinite' }} />
          <span style={{ fontSize:10, fontWeight:500, color:'var(--t2)', fontFamily:'var(--mono)',
            letterSpacing:'0.12em', textTransform:'uppercase' }}>Event Stream</span>
        </div>
        <span style={{ fontSize:10, fontFamily:'var(--mono)', color:'var(--cyan)',
          background:'rgba(0,212,255,0.1)', border:'1px solid rgba(0,212,255,0.2)',
          padding:'2px 8px', borderRadius:999 }}>{events.length}</span>
      </div>

      {/* Stream */}
      <div style={{ flex:1, overflowY:'auto' }}>
        {events.length === 0 ? (
          <div style={{ padding:'40px 18px', textAlign:'center' }}>
            <p style={{ fontSize:10, color:'var(--t4)', fontFamily:'var(--mono)', marginBottom:4 }}>
              awaiting events_
            </p>
            <p style={{ fontSize:10, color:'var(--t4)', opacity:0.5, fontFamily:'var(--mono)' }}>
              changes broadcast in real-time
            </p>
          </div>
        ) : events.map((evt, i) => {
          const op  = OP[evt.operation] || OP.UPDATE
          const row = evt.data || {}
          const ts  = evt.timestamp
            ? new Date(evt.timestamp * 1000).toLocaleTimeString([], { hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' })
            : '—'

          return (
            <div key={i} style={{
              padding:'10px 18px', borderBottom:'1px solid var(--border-0)',
              animation: i === 0 ? 'slideIn 0.2s var(--ease) both' : 'none',
              transition:'background 0.1s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {/* Row 1: badge + order id + timestamp */}
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                <span style={{ fontSize:9, fontWeight:600, fontFamily:'var(--mono)',
                  color:op.color, background:op.bg, border:`1px solid ${op.border}`,
                  padding:'2px 6px', borderRadius:4, letterSpacing:'0.08em', flexShrink:0 }}>
                  {op.label}
                </span>
                <span style={{ fontSize:11, color:'var(--t1)', fontFamily:'var(--mono)', fontWeight:500, flex:1 }}>
                  ORD-{row.id ? String(row.id).padStart(4,'0') : '????'}
                </span>
                <span style={{ fontSize:10, color:'var(--t4)', fontFamily:'var(--mono)', flexShrink:0 }}>
                  {ts}
                </span>
              </div>

              {/* Row 2: customer name */}
              {row.customer_name && (
                <div style={{ display:'flex', gap:8, alignItems:'baseline', marginBottom:3, paddingLeft:2 }}>
                  <span style={{ fontSize:9, color:'var(--t4)', fontFamily:'var(--mono)', width:44, flexShrink:0, letterSpacing:'0.04em' }}>
                    customer
                  </span>
                  <span style={{ fontSize:11, color:'var(--t2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {row.customer_name}
                  </span>
                </div>
              )}

              {/* Row 3: product name */}
              {row.product_name && (
                <div style={{ display:'flex', gap:8, alignItems:'baseline', marginBottom:3, paddingLeft:2 }}>
                  <span style={{ fontSize:9, color:'var(--t4)', fontFamily:'var(--mono)', width:44, flexShrink:0, letterSpacing:'0.04em' }}>
                    product
                  </span>
                  <span style={{ fontSize:11, color:'var(--t2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {row.product_name}
                  </span>
                </div>
              )}

              {/* Row 4: status badge */}
              {row.status && evt.operation !== 'DELETE' && (
                <div style={{ display:'flex', gap:8, alignItems:'center', paddingLeft:2, marginTop:1 }}>
                  <span style={{ fontSize:9, color:'var(--t4)', fontFamily:'var(--mono)', width:44, flexShrink:0, letterSpacing:'0.04em' }}>
                    status
                  </span>
                  <span style={{
                    fontSize:9, fontWeight:600, fontFamily:'var(--mono)',
                    letterSpacing:'0.08em', textTransform:'uppercase', padding:'2px 7px',
                    borderRadius:999,
                    color:  row.status==='delivered' ? 'var(--green)' : row.status==='shipped' ? 'var(--cyan)' : 'var(--amber)',
                    background: row.status==='delivered' ? 'rgba(0,229,160,0.1)' : row.status==='shipped' ? 'rgba(0,212,255,0.1)' : 'rgba(255,181,71,0.1)',
                  }}>
                    {row.status}
                  </span>
                </div>
              )}

              {/* DELETE — show what was removed */}
              {evt.operation === 'DELETE' && (
                <div style={{ paddingLeft:2 }}>
                  <span style={{ fontSize:10, color:'var(--t4)', fontFamily:'var(--mono)' }}>
                    order removed from system
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
