import { useState } from 'react'
import { createOrder } from '../utils/api'
import { useAuth } from '../hooks/AuthContext'

export default function CreateOrderModal({onClose, onOptimisticInsert}) {
  const {token} = useAuth()
  const [form, setForm] = useState({customer_name:'',product_name:'',status:'pending'})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = async e => {
    e.preventDefault(); setError(''); setBusy(true)
    try {
      const created = await createOrder(token, form)
      onOptimisticInsert(created)
      onClose()
    } catch(err) { setError(err.message || 'Failed'); setBusy(false) }
  }

  const inp = {
    width:'100%',padding:'11px 14px',
    background:'var(--surface-3)',border:'1px solid var(--border-1)',
    borderRadius:'var(--r2)',fontSize:13,color:'var(--t0)',
    outline:'none',transition:'border-color 0.15s var(--ease)',
    fontFamily:'var(--sans)',
  }

  return (
    <div style={{
      position:'fixed',inset:0,background:'rgba(6,8,13,0.82)',
      backdropFilter:'blur(16px)',display:'flex',alignItems:'center',
      justifyContent:'center',zIndex:200,padding:24,animation:'fadeIn 0.15s ease',
    }} onClick={onClose}>
      <div style={{
        width:'100%',maxWidth:420,
        background:'var(--surface-2)',
        border:'1px solid var(--border-1)',
        borderRadius:'var(--r4)',overflow:'hidden',
        animation:'fadeUp 0.22s var(--spring) both',
        boxShadow:'0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,212,255,0.08)',
      }} onClick={e=>e.stopPropagation()}>

        {/* Cyan top accent */}
        <div style={{height:1,background:'linear-gradient(90deg,transparent,rgba(0,212,255,0.4),transparent)'}}/>

        {/* Header */}
        <div style={{padding:'22px 24px 20px',borderBottom:'1px solid var(--border-0)',
          display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
          <div>
            <p style={{fontSize:10,color:'var(--cyan)',fontFamily:'var(--mono)',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:5}}>
              // new_order
            </p>
            <h2 style={{fontSize:16,fontWeight:600,color:'var(--t0)',letterSpacing:'-0.02em',marginBottom:3}}>Create order</h2>
            <p style={{fontSize:11,color:'var(--t3)'}}>Broadcasts to all live clients instantly</p>
          </div>
          <button onClick={onClose} style={{
            width:28,height:28,borderRadius:7,background:'var(--surface-3)',
            border:'1px solid var(--border-0)',color:'var(--t3)',fontSize:14,
            display:'flex',alignItems:'center',justifyContent:'center',
            transition:'all 0.15s',marginTop:2,
          }}
            onMouseEnter={e=>e.currentTarget.style.background='var(--surface-4)'}
            onMouseLeave={e=>e.currentTarget.style.background='var(--surface-3)'}
          >✕</button>
        </div>

        {/* Form */}
        <form onSubmit={onSubmit} style={{padding:'22px 24px',display:'flex',flexDirection:'column',gap:14}}>
          {[
            {name:'customer_name', label:'CUSTOMER NAME', ph:'e.g. Alice Johnson'},
            {name:'product_name',  label:'PRODUCT',       ph:'e.g. Wireless Headphones'},
          ].map((f,i) => (
            <div key={f.name}>
              <label style={{display:'block',fontSize:10,fontWeight:500,color:'var(--t3)',
                fontFamily:'var(--mono)',letterSpacing:'0.1em',marginBottom:7}}>{f.label}</label>
              <input name={f.name} value={form[f.name]} placeholder={f.ph} required
                autoFocus={i===0} style={inp}
                onChange={e=>setForm({...form,[e.target.name]:e.target.value})}
                onFocus={e=>e.target.style.borderColor='rgba(0,212,255,0.4)'}
                onBlur={e=>e.target.style.borderColor='var(--border-1)'}
              />
            </div>
          ))}

          <div>
            <label style={{display:'block',fontSize:10,fontWeight:500,color:'var(--t3)',
              fontFamily:'var(--mono)',letterSpacing:'0.1em',marginBottom:7}}>INITIAL STATUS</label>
            <select name="status" value={form.status} style={{...inp,cursor:'pointer',fontFamily:'var(--mono)',fontSize:12}}
              onChange={e=>setForm({...form,status:e.target.value})}>
              <option value="pending">PENDING</option>
              <option value="shipped">SHIPPED</option>
              <option value="delivered">DELIVERED</option>
            </select>
          </div>

          {error && (
            <div style={{padding:'9px 12px',background:'rgba(255,91,91,0.08)',
              border:'1px solid rgba(255,91,91,0.2)',borderRadius:'var(--r1)',
              fontSize:12,color:'var(--red)'}}>
              {error}
            </div>
          )}

          <div style={{display:'flex',gap:8,paddingTop:6}}>
            <button type="button" onClick={onClose} style={{
              flex:1,padding:'10px',background:'transparent',
              border:'1px solid var(--border-1)',borderRadius:'var(--r2)',
              fontSize:12,fontWeight:500,color:'var(--t3)',
              fontFamily:'var(--mono)',letterSpacing:'0.04em',transition:'all 0.15s',
            }}
              onMouseEnter={e=>e.currentTarget.style.background='var(--surface-3)'}
              onMouseLeave={e=>e.currentTarget.style.background='transparent'}
            >CANCEL</button>
            <button type="submit" disabled={busy} style={{
              flex:2,padding:'10px',
              background:'rgba(0,212,255,0.1)',border:'1px solid rgba(0,212,255,0.3)',
              borderRadius:'var(--r2)',fontSize:12,fontWeight:500,color:'var(--cyan)',
              fontFamily:'var(--mono)',letterSpacing:'0.04em',
              display:'flex',alignItems:'center',justifyContent:'center',gap:8,
              transition:'all 0.15s',opacity:busy?0.7:1,
            }}
              onMouseEnter={e=>{if(!busy)e.currentTarget.style.background='rgba(0,212,255,0.2)'}}
              onMouseLeave={e=>e.currentTarget.style.background='rgba(0,212,255,0.1)'}
            >
              {busy
                ? <><span style={{width:12,height:12,border:'1.5px solid rgba(0,212,255,0.3)',borderTop:'1.5px solid var(--cyan)',borderRadius:'50%',animation:'spin 0.6s linear infinite'}}/> CREATING</>
                : 'CREATE ORDER'
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
