import { useState } from 'react'
import { useAuth } from '../hooks/AuthContext'

export default function LoginPage() {
  const { login } = useAuth()
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async e => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { await login(u, p) }
    catch(e) { setErr(e.message || 'Invalid credentials') }
    finally { setBusy(false) }
  }

  return (
    <div style={{minHeight:'100vh', display:'flex', background:'var(--obsidian)', position:'relative', overflow:'hidden'}}>

      {/* Ambient cyan orb */}
      <div style={{position:'fixed',top:'20%',left:'30%',width:600,height:600,borderRadius:'50%',
        background:'radial-gradient(circle, rgba(0,212,255,0.04) 0%, transparent 65%)',
        pointerEvents:'none', zIndex:0}}/>
      <div style={{position:'fixed',bottom:'-10%',right:'10%',width:400,height:400,borderRadius:'50%',
        background:'radial-gradient(circle, rgba(167,139,250,0.04) 0%, transparent 65%)',
        pointerEvents:'none', zIndex:0}}/>

      {/* Dot grid background */}
      <div style={{position:'fixed',inset:0,zIndex:0,pointerEvents:'none',
        backgroundImage:'radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)',
        backgroundSize:'32px 32px'}}/>

      {/* Left panel */}
      <div style={{
        flex:1, position:'relative', zIndex:1,
        display:'flex', flexDirection:'column', justifyContent:'space-between',
        padding:'48px 56px', borderRight:'1px solid var(--border-0)',
        overflow:'hidden',
      }}>
        {/* Scanline animation */}
        <div style={{position:'absolute',inset:0,overflow:'hidden',pointerEvents:'none',opacity:0.015,zIndex:0}}>
          <div style={{position:'absolute',left:0,right:0,height:'2px',background:'var(--cyan)',animation:'scanline 8s linear infinite'}}/>
        </div>

        {/* Logo */}
        <div style={{position:'relative',zIndex:1,display:'flex',alignItems:'center',gap:12, animation:'fadeIn 0.5s var(--ease)'}}>
          <div style={{
            width:36, height:36, borderRadius:10, position:'relative',
            background:'rgba(0,212,255,0.08)', border:'1px solid rgba(0,212,255,0.25)',
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>
            <div style={{width:10,height:10,borderRadius:'50%',background:'var(--cyan)',
              boxShadow:'0 0 8px rgba(0,212,255,0.6)'}}/>
          </div>
          <div>
            <p style={{fontSize:14,fontWeight:600,color:'var(--t0)',letterSpacing:'-0.01em'}}>OrderStream</p>
            <p style={{fontSize:10,color:'var(--t3)',fontFamily:'var(--mono)',marginTop:1}}>v2.0 // LIVE</p>
          </div>
        </div>

        {/* Hero text */}
        <div style={{position:'relative',zIndex:1,animation:'fadeUp 0.6s 0.1s var(--ease) both'}}>
          <p style={{fontSize:11,fontWeight:500,color:'var(--cyan)',letterSpacing:'0.14em',textTransform:'uppercase',marginBottom:24,fontFamily:'var(--mono)'}}>
            Real-time Order Intelligence
          </p>
          <h1 style={{fontSize:52,fontWeight:300,color:'var(--t0)',lineHeight:1.1,letterSpacing:'-0.04em',marginBottom:28}}>
            Zero latency.<br/>
            <span style={{fontWeight:600,background:'linear-gradient(135deg,#fff 0%,rgba(0,212,255,0.9) 100%)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>
              Every update.
            </span>
          </h1>
          <p style={{fontSize:15,color:'var(--t3)',lineHeight:1.8,maxWidth:360,fontWeight:300}}>
            PostgreSQL triggers fire the instant a transaction commits. Redis fans out to every WebSocket in milliseconds. No polling. No compromise.
          </p>
        </div>

        {/* Spec table */}
        <div style={{position:'relative',zIndex:1,animation:'fadeUp 0.6s 0.2s var(--ease) both'}}>
          {[
            {k:'Transport',  v:'WebSocket / LISTEN·NOTIFY'},
            {k:'Latency',    v:'< 40ms p99'},
            {k:'Fan-out',    v:'Redis Pub/Sub'},
            {k:'Auth',       v:'JWT / HS256'},
          ].map(r => (
            <div key={r.k} style={{display:'flex',justifyContent:'space-between',alignItems:'center',
              padding:'11px 0',borderTop:'1px solid var(--border-0)'}}>
              <span style={{fontSize:11,color:'var(--t3)',fontWeight:500,letterSpacing:'0.02em'}}>{r.k}</span>
              <span style={{fontSize:11,color:'var(--t2)',fontFamily:'var(--mono)'}}>{r.v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — form */}
      <div style={{
        width:460, position:'relative', zIndex:1,
        display:'flex', flexDirection:'column', justifyContent:'center',
        padding:'56px 52px',
        animation:'fadeUp 0.5s var(--ease)',
      }}>
        <p style={{fontSize:11,color:'var(--cyan)',fontFamily:'var(--mono)',letterSpacing:'0.12em',textTransform:'uppercase',marginBottom:6}}>
          // authenticate
        </p>
        <h2 style={{fontSize:28,fontWeight:500,color:'var(--t0)',letterSpacing:'-0.03em',marginBottom:8}}>Sign in</h2>
        <p style={{fontSize:13,color:'var(--t3)',marginBottom:36}}>Access the real-time control surface</p>

        {/* Demo badge */}
        <div style={{
          display:'flex',alignItems:'center',gap:10,
          background:'rgba(0,212,255,0.05)',
          border:'1px solid rgba(0,212,255,0.15)',
          borderRadius:'var(--r2)',padding:'10px 14px',marginBottom:28,
        }}>
          <div style={{width:5,height:5,borderRadius:'50%',background:'var(--cyan)',flexShrink:0,animation:'pulse 2s ease-in-out infinite'}}/>
          <span style={{fontSize:12,color:'var(--t3)'}}>
            Demo credentials: <code style={{fontFamily:'var(--mono)',color:'var(--cyan)',fontSize:12}}>admin / admin123</code>
          </span>
        </div>

        <form onSubmit={submit} style={{display:'flex',flexDirection:'column',gap:16}}>
          {[
            {label:'USERNAME', val:u, set:setU, type:'text',     ph:'admin'},
            {label:'PASSWORD', val:p, set:setP, type:'password', ph:'••••••••'},
          ].map(f => (
            <div key={f.label}>
              <label style={{display:'block',fontSize:10,fontWeight:500,color:'var(--t3)',fontFamily:'var(--mono)',letterSpacing:'0.1em',marginBottom:8}}>
                {f.label}
              </label>
              <input type={f.type} value={f.val} placeholder={f.ph} required
                onChange={e=>f.set(e.target.value)}
                style={{
                  width:'100%',padding:'12px 16px',
                  background:'var(--surface-2)',
                  border:'1px solid var(--border-1)',
                  borderRadius:'var(--r2)',fontSize:14,color:'var(--t0)',
                  outline:'none',transition:'border-color 0.15s var(--ease)',
                }}
                onFocus={e=>e.target.style.borderColor='rgba(0,212,255,0.4)'}
                onBlur={e=>e.target.style.borderColor='var(--border-1)'}
              />
            </div>
          ))}

          {err && (
            <div style={{padding:'10px 14px',background:'rgba(255,91,91,0.08)',border:'1px solid rgba(255,91,91,0.2)',
              borderRadius:'var(--r1)',fontSize:12,color:'var(--red)'}}>
              {err}
            </div>
          )}

          <button type="submit" disabled={busy} style={{
            marginTop:8,padding:'13px',
            background: busy ? 'rgba(0,212,255,0.08)' : 'rgba(0,212,255,0.1)',
            border:'1px solid rgba(0,212,255,0.3)',borderRadius:'var(--r2)',
            fontSize:14,fontWeight:500,color:'var(--cyan)',
            transition:'all 0.18s var(--ease)',display:'flex',alignItems:'center',justifyContent:'center',gap:8,
            letterSpacing:'0.01em',
          }}
            onMouseEnter={e=>{if(!busy){e.currentTarget.style.background='rgba(0,212,255,0.18)';e.currentTarget.style.borderColor='rgba(0,212,255,0.5)'}}}
            onMouseLeave={e=>{e.currentTarget.style.background='rgba(0,212,255,0.1)';e.currentTarget.style.borderColor='rgba(0,212,255,0.3)'}}
          >
            {busy
              ? <><span style={{width:14,height:14,border:'1.5px solid rgba(0,212,255,0.25)',borderTop:'1.5px solid var(--cyan)',borderRadius:'50%',animation:'spin 0.6s linear infinite'}}/> Authenticating</>
              : 'Access dashboard →'
            }
          </button>
        </form>

        <p style={{marginTop:48,fontSize:10,color:'var(--t4)',fontFamily:'var(--mono)',textAlign:'center',letterSpacing:'0.06em'}}>
          POSTGRESQL · REDIS · FASTAPI · WEBSOCKETS
        </p>
      </div>
    </div>
  )
}
