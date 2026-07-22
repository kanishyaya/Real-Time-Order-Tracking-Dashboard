import { useEffect, useState } from 'react'
import { fetchHealth, fetchMetrics } from '../utils/api'
import { useAuth } from '../hooks/AuthContext'

function uptime(s) {
  if (!s) return '—'
  if (s < 60)   return `${Math.floor(s)}s`
  if (s < 3600) return `${Math.floor(s/60)}m`
  return `${Math.floor(s/3600)}h`
}

function Cell({label, value, color}) {
  return (
    <div style={{display:'flex',flexDirection:'column',justifyContent:'center',gap:3,padding:'0 18px'}}>
      <span style={{fontSize:9,fontWeight:500,color:'var(--t4)',fontFamily:'var(--mono)',letterSpacing:'0.12em',textTransform:'uppercase'}}>{label}</span>
      <span style={{fontSize:12,fontWeight:500,color:color||'var(--t2)',fontFamily:'var(--mono)',lineHeight:1}}>{value ?? '—'}</span>
    </div>
  )
}

export default function MetricsBar() {
  const {token} = useAuth()
  const [h, setH] = useState(null)
  const [m, setM] = useState(null)

  useEffect(() => {
    const go = async () => {
      try {
        const [a,b] = await Promise.all([fetchHealth(), fetchMetrics(token)])
        setH(a); setM(b)
      } catch {}
    }
    go(); const id = setInterval(go, 8000); return () => clearInterval(id)
  }, [token])

  if (!h && !m) return null

  const dbOk = h?.database === 'ok'
  const rdOk = h?.redis === 'ok'

  return (
    <div style={{display:'flex',alignItems:'stretch',height:40,
      background:'var(--surface-2)',border:'1px solid var(--border-0)',borderRadius:'var(--r2)',overflow:'hidden'}}>
      <Cell label="DB"      value={h?.database ?? '—'} color={dbOk ? 'var(--green)' : 'var(--red)'} />
      <div style={{width:1,background:'var(--border-0)',alignSelf:'stretch'}}/>
      <Cell label="Redis"   value={h?.redis ?? '—'}    color={rdOk ? 'var(--green)' : 'var(--red)'} />
      <div style={{width:1,background:'var(--border-0)',alignSelf:'stretch'}}/>
      <Cell label="Clients" value={m?.connected_clients ?? '—'} color="var(--cyan)" />
      <div style={{width:1,background:'var(--border-0)',alignSelf:'stretch'}}/>
      <Cell label="Events"  value={m?.total_events_fired ?? '—'} />
      <div style={{width:1,background:'var(--border-0)',alignSelf:'stretch'}}/>
      <Cell label="Uptime"  value={m ? uptime(m.uptime_seconds) : '—'} />
    </div>
  )
}
