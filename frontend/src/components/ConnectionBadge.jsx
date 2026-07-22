const S = {
  connected:    {label:'LIVE',       color:'var(--green)', bg:'rgba(0,229,160,0.08)',  border:'rgba(0,229,160,0.2)',  pulse:true},
  connecting:   {label:'SYNCING',    color:'var(--amber)', bg:'rgba(255,181,71,0.08)', border:'rgba(255,181,71,0.2)', pulse:true},
  disconnected: {label:'OFFLINE',    color:'var(--t3)',    bg:'rgba(77,90,114,0.08)',  border:'rgba(77,90,114,0.2)', pulse:false},
  error:        {label:'ERROR',      color:'var(--red)',   bg:'rgba(255,91,91,0.08)',  border:'rgba(255,91,91,0.2)', pulse:false},
}
export default function ConnectionBadge({status}) {
  const c = S[status] || S.disconnected
  return (
    <div style={{display:'inline-flex',alignItems:'center',gap:8,padding:'5px 12px',
      borderRadius:999,background:c.bg,border:`1px solid ${c.border}`}}>
      <span style={{position:'relative',width:6,height:6,flexShrink:0}}>
        <span style={{position:'absolute',inset:0,borderRadius:'50%',background:c.color,
          animation:c.pulse?'pulse 2s ease-in-out infinite':'none'}}/>
        {c.pulse && <span style={{position:'absolute',inset:-2,borderRadius:'50%',
          background:c.color,opacity:0.3,animation:'ping 1.8s ease-out infinite'}}/>}
      </span>
      <span style={{fontSize:10,fontWeight:500,color:c.color,fontFamily:'var(--mono)',letterSpacing:'0.1em'}}>{c.label}</span>
    </div>
  )
}
