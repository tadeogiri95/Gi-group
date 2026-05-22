'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { sb } from './lib/supabase';
import { C, fH, fB, fM, fmtTime, fmtDate, fmtDateLong, DIAS_KEY } from './lib/theme';
import { callClaude, parseAction } from './lib/claude';
import PushManager from '../components/PushManager';
import { sendPushToLegajo } from '../lib/push';
import ActividadScreen from './actividad_screen';
import { useActividad } from './hooks/useActividad';
import GerenciaActividadScreen from './gerencia_actividad_screen';
import GrillaHorarioScreen from './grilla_horario_screen';
import GestionPersonalScreen from './gestion_personal_screen';
import CalendarioScreen from './calendario_screen';
import DashboardGerencia from './dashboard_gerencia';
import ReportesScreen from './reportes_screen';
import GeolocalizacionScreen from './geolocalizacion_screen';
import { validarGeoFichaje } from './geolocalizacion_screen';
import InstaladorScreen from './instalador_screen.jsx';

/* ═══ ICONS ═══ */
const Ic = {
  bot:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/></svg>,
  send:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  check:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>,
  x:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  bell:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  clock:<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  enter:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>,
  exit:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  home:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  chat:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  users:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>,
  inbox:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>,
  history:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  chevL:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>,
  chevR:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>,
  alert:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>,
  sparkle:<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0L14.59 8.41L23 12L14.59 15.59L12 24L9.41 15.59L1 12L9.41 8.41Z"/></svg>,
  gear:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 10v6M4.22 4.22l4.24 4.24m7.08 7.08l4.24 4.24M1 12h6m10 0h6M4.22 19.78l4.24-4.24m7.08-7.08l4.24-4.24"/></svg>,
  plus:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  trash:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
  logout:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  refresh:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
  hammer:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 12l-8.5 8.5c-.83.83-2.17.83-3 0 0 0 0 0 0 0a2.12 2.12 0 0 1 0-3L12 9"/><path d="M17.64 15L22 10.64"/><path d="M20.91 11.7l-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91"/></svg>,
};

/* ═══ PRIMITIVES ═══ */
const Tag = ({color=C.amber,children}) => <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 8px",borderRadius:6,background:`${color}22`,color,fontSize:10,fontWeight:700,letterSpacing:"0.04em",textTransform:"uppercase",fontFamily:fB}}>{children}</span>;
const Chip = ({active,onClick,children,color=C.amber}) => <button onClick={onClick} style={{padding:"7px 14px",borderRadius:999,border:`1px solid ${active?color:C.border}`,background:active?`${color}22`:"transparent",color:active?color:C.dim,fontSize:12,fontWeight:600,fontFamily:fB,whiteSpace:"nowrap",cursor:"pointer"}}>{children}</button>;

/* ═══ LOGIN ═══ */
function LoginScreen({onLogin}) {
  const [email,setEmail]=useState("");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [users,setUsers]=useState([]);

  useEffect(()=>{
    sb.get("empleados?select=email,nombre,apodo,rol,legajo&activo=eq.true&order=legajo.asc")
      .then(setUsers).catch(e=>setError("Error de conexión: "+e.message));
  },[]);

  const login=async(e)=>{
    const em=e||email; if(!em)return;
    setLoading(true);setError("");
    try{
      const r=await sb.get(`empleados?email=eq.${encodeURIComponent(em)}&select=*`);
      if(!r||!r.length){setError("Usuario no encontrado");setLoading(false);return;}
      onLogin(r[0]);
    }catch(err){setError(err.message);setLoading(false);}
  };

  return <div style={{display:"flex",flexDirection:"column",height:"100%",padding:"0 28px",justifyContent:"center"}}>
    <div style={{width:72,height:72,borderRadius:20,background:`linear-gradient(135deg,${C.amber},${C.violet})`,display:"flex",alignItems:"center",justifyContent:"center",color:"#000",marginBottom:24}}>
      <span style={{fontFamily:fH,fontSize:26,fontWeight:800}}>GI</span>
    </div>
    <h1 style={{margin:0,fontFamily:fH,fontSize:30,fontWeight:700,color:C.text,letterSpacing:"-0.025em"}}>Bienvenido</h1>
    <div style={{fontSize:14,color:C.dim,marginTop:6,marginBottom:32}}>Iniciá sesión en App GI</div>
    <div style={{marginBottom:14}}>
      <label style={{display:"block",fontSize:11,fontWeight:700,color:C.dim,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Email</label>
      <input value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&login()} placeholder="tunombre@gi-group.com" style={{width:"100%",padding:"14px 16px",borderRadius:12,background:C.surface,border:`1px solid ${C.border}`,color:C.text,fontSize:15,fontFamily:fB,outline:"none",boxSizing:"border-box"}}/>
    </div>
    <button onClick={()=>login()} disabled={loading||!email} style={{width:"100%",padding:14,borderRadius:12,background:email&&!loading?C.amber:C.surface,color:email&&!loading?"#000":C.mute,border:"none",fontSize:15,fontWeight:700,fontFamily:fB,cursor:email&&!loading?"pointer":"default",marginBottom:8}}>
      {loading?"Conectando...":"Iniciar sesión"}
    </button>
    {error&&<div style={{padding:12,background:C.redS,color:C.red,borderRadius:10,fontSize:12,marginTop:8}}>{error}</div>}
    {users.length>0&&<>
      <div style={{display:"flex",alignItems:"center",gap:12,margin:"24px 0 16px"}}>
        <div style={{flex:1,height:1,background:C.border}}/><span style={{fontSize:11,color:C.dim,fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase"}}>O elegí un usuario</span><div style={{flex:1,height:1,background:C.border}}/>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8,overflowY:"auto",maxHeight:300}}>
        {users.map(u=><button key={u.email} onClick={()=>login(u.email)} disabled={loading} style={{display:"flex",alignItems:"center",gap:12,padding:12,background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,cursor:"pointer",textAlign:"left",fontFamily:fB}}>
          <div style={{width:36,height:36,borderRadius:10,background:u.rol==="gerencial"?C.violetS:u.rol==="administrativo"?C.cyanS:C.amberS,color:u.rol==="gerencial"?C.violet:u.rol==="administrativo"?C.cyan:C.amber,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:fH,fontSize:13,fontWeight:700}}>{u.apodo[0]}</div>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.text}}>{u.apodo}</div><div style={{fontSize:11,color:C.dim,marginTop:1}}>{u.email}</div></div>
          <Tag color={u.rol==="gerencial"?C.violet:u.rol==="administrativo"?C.cyan:C.amber}>{u.rol}</Tag>
        </button>)}
      </div>
    </>}
  </div>;
}

/* ═══ FICHADA CARD ═══ */
function FichadaCard({tipo,hora,geoMsg}){
  const color=tipo==="ingreso"?C.green:C.cyan;
  return <div style={{marginTop:8,padding:14,background:`${color}12`,borderRadius:14,border:`1px solid ${color}30`,minWidth:220}}>
    <div style={{display:"flex",alignItems:"center",gap:10}}>
      <div style={{width:38,height:38,borderRadius:10,background:`${color}25`,color,display:"flex",alignItems:"center",justifyContent:"center"}}>{tipo==="ingreso"?Ic.enter:Ic.exit}</div>
      <div style={{flex:1}}>
        <div style={{fontSize:11,color,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>{tipo==="ingreso"?"INGRESO":"SALIDA"} REGISTRAD{tipo==="ingreso"?"O":"A"}</div>
        <div style={{fontFamily:fH,fontSize:22,fontWeight:700,color:C.text,marginTop:2}}>{hora}</div>
        {geoMsg && <div style={{fontSize:10,color:C.dim,marginTop:4}}>{geoMsg}</div>}
      </div>
      <span style={{color:C.green}}>{Ic.check}</span>
    </div>
  </div>;
}
function SolSentCard({motivo,fecha}){return<div style={{marginTop:8,padding:14,background:C.amberS,borderRadius:14,border:`1px solid ${C.amber}30`,minWidth:220}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}><div><div style={{fontSize:11,color:C.amber,fontWeight:700,letterSpacing:"0.06em"}}>ENVIADA A GERENCIA</div><div style={{fontSize:13,color:C.text,fontWeight:600,marginTop:4}}>{motivo}</div><div style={{fontSize:11,color:C.dim,marginTop:4}}>📅 {fecha} · ⏳ Esperando</div></div><Tag color={C.amber}>{Ic.clock} PENDIENTE</Tag></div></div>;}

/* ═══ CHAT ═══ */
function ChatScreen({usuario,ctx,reload}){
  const dH=DIAS_KEY[new Date().getDay()];const diagH=usuario.diagrama?.[dH];
  const [msgs,setMsgs]=useState([{from:"bot",text:`¡Hola ${usuario.apodo}! 🤖\n\nHoy es ${fmtDate(new Date())}, son las ${fmtTime(new Date())}.\n${ctx.fichadaHoy?.ingreso?`Tu ingreso: ${ctx.fichadaHoy.ingreso.slice(0,5)}.`:diagH?`Jornada hoy: ${diagH.in} a ${diagH.out}.`:"Hoy es franco 🎉"}\n\nContame qué necesitás.`,quickReplies:["Ya llegué","Necesito un permiso","¿Cuántas horas llevo?","Me voy"],time:new Date()}]);
  const [input,setInput]=useState("");const [loading,setLoading]=useState(false);const ref=useRef(null);
  useEffect(()=>{ref.current&&(ref.current.scrollTop=ref.current.scrollHeight)},[msgs,loading]);

  const execAction=async(action)=>{
    let card=null;const hora=fmtTime(new Date());const today=new Date().toISOString().split("T")[0];
    try{switch(action.type){
      case"FICHAR_INGRESO":{
        const geo = await validarGeoFichaje(usuario);
        if (!geo.ok) return { type: "geo_error", msg: geo.msg };
        const ex=await sb.get(`fichadas?legajo=eq.${usuario.legajo}&fecha=eq.${today}`);
        if(!ex.length)await sb.post("fichadas",{
          empleado_id:usuario.id,legajo:usuario.legajo,fecha:today,ingreso:hora,
          geo_ingreso: geo.coords ? { lat: geo.coords.lat, lng: geo.coords.lng, distancia: geo.distancia } : null,
        });
        card={type:"fichada",sub:"ingreso",hora,geoMsg:geo.msg};
        break;
      }
      case"FICHAR_EGRESO":{
        const geo = await validarGeoFichaje(usuario);
        if (!geo.ok) return { type: "geo_error", msg: geo.msg };
        const ex=await sb.get(`fichadas?legajo=eq.${usuario.legajo}&fecha=eq.${today}`);
        if(ex.length)await sb.patch(`fichadas?id=eq.${ex[0].id}`,{
          egreso:hora,
          geo_egreso: geo.coords ? { lat: geo.coords.lat, lng: geo.coords.lng, distancia: geo.distancia } : null,
        });
        card={type:"fichada",sub:"egreso",hora,geoMsg:geo.msg};
        break;
      }
      case"SOLICITAR_PERMISO":await sb.post("solicitudes",{empleado_id:usuario.id,legajo:usuario.legajo,nombre_empleado:usuario.nombre,tipo:"permiso",motivo:action.motivo||"",fecha:action.fecha||"",desde:action.desde||"—",hasta:action.hasta||"—",estado:"pendiente"});await sb.post("notificaciones",{destinatario_rol:"gerencial",tipo:"solicitud",asunto:`${usuario.apodo} pidió permiso`,detalle:action.motivo,urgencia:"normal"});sendPushToLegajo("1","📋 Nuevo permiso",`${usuario.apodo} solicitó permiso: ${action.motivo||"sin detalle"}`).catch(()=>{});card={type:"solicitud",motivo:action.motivo,fecha:action.fecha};break;
      case"AVISAR_TARDANZA":await sb.post("solicitudes",{empleado_id:usuario.id,legajo:usuario.legajo,nombre_empleado:usuario.nombre,tipo:"tardanza",motivo:`Tardanza: ${action.motivo||""}`,fecha:"hoy",estado:"registrado"});await sb.post("notificaciones",{destinatario_rol:"gerencial",tipo:"alerta",asunto:`Tardanza de ${usuario.apodo}`,detalle:action.motivo,urgencia:"normal"});sendPushToLegajo("1","⏰ Tardanza",`${usuario.apodo}: ${action.motivo||"sin detalle"}`).catch(()=>{});break;
      case"AVISAR_AUSENCIA":await sb.post("solicitudes",{empleado_id:usuario.id,legajo:usuario.legajo,nombre_empleado:usuario.nombre,tipo:"ausencia",motivo:action.motivo||"Ausencia",fecha:action.fecha||"hoy",estado:"pendiente"});await sb.post("notificaciones",{destinatario_rol:"gerencial",tipo:"alerta",asunto:`Ausencia de ${usuario.apodo}`,detalle:action.motivo,urgencia:"alta"});sendPushToLegajo("1","🚨 Ausencia",`${usuario.apodo}: ${action.motivo||"Ausencia"}`).catch(()=>{});break;
      case"NOTIFICAR_GERENCIA":await sb.post("notificaciones",{destinatario_rol:"gerencial",tipo:"info",asunto:action.asunto,detalle:action.detalle,urgencia:action.urgencia||"normal"});break;
    }reload&&reload();}catch(e){console.error(e);}return card;
  };

  const handleSend=async(txt=input)=>{const t=txt.trim();if(!t||loading)return;
    const um={from:"user",text:t,time:new Date()};const nm=[...msgs,um];setMsgs(nm);setInput("");setLoading(true);
    sb.post("mensajes_chat",{legajo:usuario.legajo,rol:"user",mensaje:t}).catch(()=>{});
    try{const hist=nm.slice(-20).map(m=>({from:m.from,text:m.text}));const raw=await callClaude(hist,ctx,usuario);const{clean,action}=parseAction(raw);
      let card=action?await execAction(action):null;
      if (card?.type === "geo_error") {
        setMsgs(m=>[...m,{from:"bot",text:card.msg,time:new Date()}]);
        setLoading(false);
        return;
      }
      setMsgs(m=>[...m,{from:"bot",text:clean,card,time:new Date()}]);sb.post("mensajes_chat",{legajo:usuario.legajo,rol:"bot",mensaje:clean}).catch(()=>{});
    }catch{setMsgs(m=>[...m,{from:"bot",text:"Error de conexión. Probá de nuevo.",time:new Date()}]);}setLoading(false);};

  return<div style={{display:"flex",flexDirection:"column",height:"100%"}}>
    <div ref={ref} style={{flex:1,overflowY:"auto",padding:"8px 18px 12px",WebkitOverflowScrolling:"touch"}}>
      {msgs.map((m,i)=><div key={i} style={{display:"flex",justifyContent:m.from==="bot"?"flex-start":"flex-end",marginBottom:12}}>
        {m.from==="bot"&&<div style={{width:30,height:30,borderRadius:10,marginRight:8,background:`linear-gradient(135deg,${C.amber},${C.violet})`,display:"flex",alignItems:"center",justifyContent:"center",color:"#000",flexShrink:0}}>{Ic.bot}</div>}
        <div style={{maxWidth:"78%",display:"flex",flexDirection:"column",alignItems:m.from==="bot"?"flex-start":"flex-end"}}>
          <div style={{padding:"10px 14px",background:m.from==="bot"?C.surfHi:C.amber,color:m.from==="bot"?C.text:"#000",borderRadius:m.from==="bot"?"16px 16px 16px 4px":"16px 16px 4px 16px",fontSize:14,fontFamily:fB,lineHeight:1.5,whiteSpace:"pre-wrap",wordBreak:"break-word",border:m.from==="bot"?`1px solid ${C.border}`:"none",fontWeight:m.from==="bot"?400:500}}>{m.text}</div>
          {m.card?.type==="fichada"&&<FichadaCard tipo={m.card.sub} hora={m.card.hora} geoMsg={m.card.geoMsg}/>}
          {m.card?.type==="solicitud"&&<SolSentCard motivo={m.card.motivo} fecha={m.card.fecha}/>}
          {m.quickReplies&&<div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>{m.quickReplies.map((c,j)=><button key={j} onClick={()=>handleSend(c)} style={{padding:"7px 12px",borderRadius:999,background:C.surfHi,border:`1px solid ${C.borderHi}`,color:C.text,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:fB}}>{c}</button>)}</div>}
          <span style={{fontSize:10,color:C.mute,marginTop:4,fontFamily:fM}}>{fmtTime(m.time)}</span>
        </div>
      </div>)}
      {loading&&<div style={{display:"flex",marginBottom:10,alignItems:"flex-end"}}><div style={{width:30,height:30,borderRadius:10,marginRight:8,background:`linear-gradient(135deg,${C.amber},${C.violet})`,display:"flex",alignItems:"center",justifyContent:"center",color:"#000"}}>{Ic.bot}</div><div style={{padding:"12px 16px",background:C.surfHi,borderRadius:"16px 16px 16px 4px",border:`1px solid ${C.border}`,display:"flex",gap:5,alignItems:"center"}}><span style={{color:C.amber,display:"flex"}}>{Ic.sparkle}</span><span style={{fontSize:12,color:C.dim}}>Pensando...</span><span style={{display:"flex",gap:3}}>{[0,1,2].map(i=><span key={i} style={{width:4,height:4,borderRadius:2,background:C.dim,animation:`typing 1.4s ${i*.2}s infinite`}}/>)}</span></div></div>}
    </div>
    <div className="safe-bottom" style={{padding:"10px 14px 12px",borderTop:`1px solid ${C.border}`,background:C.bg,display:"flex",alignItems:"center",gap:8}}>
      <div style={{flex:1,display:"flex",alignItems:"center",background:C.surface,borderRadius:22,padding:"4px 8px 4px 16px",border:`1px solid ${C.border}`}}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSend()} placeholder="Hablale al bot..." disabled={loading} style={{flex:1,border:"none",background:"transparent",color:C.text,fontSize:14,fontFamily:fB,outline:"none",padding:"10px 0",opacity:loading?.5:1}}/>
      </div>
      <button onClick={()=>handleSend()} disabled={!input.trim()||loading} style={{width:44,height:44,borderRadius:22,border:"none",background:input.trim()&&!loading?C.amber:C.surface,color:input.trim()&&!loading?"#000":C.mute,cursor:input.trim()&&!loading?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center"}}>{Ic.send}</button>
    </div>
  </div>;
}

/* ═══ SOL CARD ═══ */
function SolCard({s,showActions,onResolve}){const ec={pendiente:C.amber,aprobado:C.green,rechazado:C.red,registrado:C.cyan};return<div style={{background:C.surface,borderRadius:14,padding:14,border:`1px solid ${s.estado==="pendiente"?C.amber+"30":C.border}`,position:"relative",overflow:"hidden"}}>
  {s.estado==="pendiente"&&<div style={{position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,${C.amber},${C.red},${C.amber})`}}/>}
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}><div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}><span style={{fontFamily:fM,fontSize:10,color:C.mute}}>#{s.id}</span><span style={{fontSize:13,fontWeight:700,color:C.text}}>{s.nombre_empleado}</span></div><Tag color={ec[s.estado]||C.dim}>{s.estado}</Tag></div>
  <div style={{fontSize:13,color:C.text,marginTop:4,lineHeight:1.4}}>{s.motivo}</div>
  <div style={{display:"flex",gap:8,marginTop:6,fontSize:11,color:C.dim,flexWrap:"wrap"}}><span>📅 {s.fecha}</span>{s.desde&&s.desde!=="—"&&<span>⏰ {s.desde}–{s.hasta}</span>}<span>· {new Date(s.created_at).toLocaleString("es-AR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</span></div>
  {s.aprobador&&<div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${C.border}`,fontSize:11,color:C.dim}}>✅ {s.aprobador}</div>}
  {showActions&&s.estado==="pendiente"&&<div style={{display:"flex",gap:8,marginTop:12}}><button onClick={()=>onResolve(s.id,"rechazado")} style={{flex:1,padding:9,borderRadius:10,background:"transparent",border:`1px solid ${C.red}40`,color:C.red,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:fB,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>{Ic.x} Rechazar</button><button onClick={()=>onResolve(s.id,"aprobado")} style={{flex:2,padding:9,borderRadius:10,background:C.green,border:"none",color:"#000",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:fB,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>{Ic.check} Aprobar</button></div>}
</div>;}

/* ═══ HOME EMPLEADO ═══ */
function HomeEmp({goto,usuario,ctx}){
  const misSols=ctx.misSolicitudes||[];const dH=DIAS_KEY[new Date().getDay()];const diagH=usuario.diagrama?.[dH];
  return<div style={{padding:"0 18px 110px",overflowY:"auto",flex:1}}>
    {/* Hero card unificada — saludo + estado + acceso al bot */}
    <div onClick={()=>goto("chat")} style={{background:`linear-gradient(135deg,${ctx.fichadaHoy?.ingreso?C.green:C.amber}08,${C.surface} 60%)`,borderRadius:20,padding:20,border:`1px solid ${ctx.fichadaHoy?.ingreso?C.green+"30":C.border}`,marginBottom:16,cursor:"pointer",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:-50,right:-50,width:170,height:170,borderRadius:"50%",background:`${ctx.fichadaHoy?.ingreso?C.green:C.amber}12`,filter:"blur(60px)"}}/>
      <div style={{position:"relative"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
          <div>
            <div style={{fontSize:13,color:C.dim,marginBottom:4}}>{fmtDate(new Date())}</div>
            <h2 style={{margin:0,fontFamily:fH,fontSize:24,fontWeight:700,color:C.text}}>Hola, {usuario.apodo}</h2>
            {diagH&&<div style={{fontSize:12,color:C.dim,marginTop:4}}>Jornada: <span style={{color:C.text,fontWeight:600}}>{diagH.in} a {diagH.out}</span></div>}
            {!diagH&&usuario.diagrama&&<div style={{fontSize:12,color:C.green,fontWeight:600,marginTop:4}}>Hoy es franco 🎉</div>}
          </div>
          <div style={{width:44,height:44,borderRadius:14,background:`linear-gradient(135deg,${C.amber},${C.violet})`,display:"flex",alignItems:"center",justifyContent:"center",color:"#000",flexShrink:0}}>{Ic.bot}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{width:8,height:8,borderRadius:4,background:ctx.fichadaHoy?.ingreso?C.green:C.amber}}/>
            <span style={{fontSize:13,fontWeight:600,color:ctx.fichadaHoy?.ingreso?C.green:C.amber}}>{ctx.fichadaHoy?.ingreso?`Ingreso ${ctx.fichadaHoy.ingreso.slice(0,5)}`:"Sin fichar"}</span>
          </div>
          <div style={{padding:"6px 12px",background:`${C.amber}15`,borderRadius:10,display:"flex",alignItems:"center",gap:6}}>
            <span style={{color:C.amber}}>{Ic.sparkle}</span>
            <span style={{fontSize:12,color:C.text,fontWeight:600}}>Hablá con el bot</span>
          </div>
        </div>
      </div>
    </div>

    {/* Acciones rápidas */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:18}}>
      {[["Permiso",C.violet,Ic.history],["Tardanza",C.cyan,Ic.clock],["No vengo",C.red,Ic.alert]].map(([l,c,ic],i)=><button key={i} onClick={()=>goto("chat")} style={{background:C.surface,border:`1px solid ${C.border}`,padding:"14px 8px",borderRadius:14,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:8,fontFamily:fB}}><div style={{width:34,height:34,borderRadius:10,background:`${c}22`,color:c,display:"flex",alignItems:"center",justifyContent:"center"}}>{ic}</div><span style={{fontSize:11,color:C.text,fontWeight:600}}>{l}</span></button>)}
    </div>

    {/* Mi semana */}
    <div style={{marginBottom:12}}><h3 style={{margin:0,fontSize:16,fontWeight:700,color:C.text,fontFamily:fH}}>Mi semana</h3></div>
    <div style={{background:C.surface,borderRadius:16,padding:14,border:`1px solid ${C.border}`,marginBottom:18}}>
      {(ctx.fichadasSemana||[]).length===0?<div style={{padding:16,textAlign:"center",color:C.dim,fontSize:13}}>Sin fichadas</div>:(ctx.fichadasSemana||[]).map((d,i,a)=><div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:i<a.length-1?`1px solid ${C.border}`:"none"}}><div><div style={{fontSize:13,fontWeight:600,color:C.text}}>{new Date(d.fecha+"T12:00:00").toLocaleDateString("es-AR",{weekday:"short",day:"2-digit",month:"2-digit"})}</div>{d.ingreso&&<div style={{fontSize:11,color:C.dim,marginTop:2,fontFamily:fM}}>{d.ingreso.slice(0,5)} → {d.egreso?d.egreso.slice(0,5):"en curso"}</div>}</div><span style={{fontFamily:fM,fontSize:14,fontWeight:700,color:d.ingreso?C.green:C.mute}}>{d.ingreso?"✓":"—"}</span></div>)}
    </div>

    {/* Mis solicitudes */}
    <div style={{marginBottom:12}}><h3 style={{margin:0,fontSize:16,fontWeight:700,color:C.text,fontFamily:fH}}>Mis solicitudes</h3></div>
    <div style={{display:"flex",flexDirection:"column",gap:10}}>{misSols.length===0?<div style={{background:C.surface,borderRadius:14,padding:30,textAlign:"center",border:`1px solid ${C.border}`,color:C.dim,fontSize:13}}>No tenés solicitudes</div>:misSols.map(s=><SolCard key={s.id} s={s}/>)}</div>
  </div>;
}

/* ═══ INBOX ═══ */
function InboxScreen({ctx,reload,usuario}){
  const [f,setF]=useState("pendiente");const filtered=(ctx.solicitudes||[]).filter(s=>f==="todas"?true:s.estado===f);const pend=(ctx.solicitudes||[]).filter(s=>s.estado==="pendiente").length;
  const resolver=async(id,estado)=>{try{const sol=(ctx.solicitudes||[]).find(s=>s.id===id);await sb.patch(`solicitudes?id=eq.${id}`,{estado,aprobador:usuario.apodo,resuelto_at:new Date().toISOString()});if(sol){await sb.post("notificaciones",{destinatario_rol:String(sol.legajo),tipo:"aprobacion",asunto:`Solicitud ${estado==="aprobado"?"APROBADA ✅":"RECHAZADA ❌"}`,detalle:`${sol.tipo}: "${sol.motivo}" por ${usuario.apodo}`,urgencia:"alta",solicitud_id:id});sendPushToLegajo(String(sol.legajo),estado==="aprobado"?"✅ Permiso aprobado":"❌ Permiso rechazado",estado==="aprobado"?`Tu ${sol.tipo} fue aprobado por ${usuario.apodo}`:`Tu ${sol.tipo} fue rechazado por ${usuario.apodo}`).catch(()=>{});}reload();}catch(e){console.error(e);}};
  return<div style={{padding:"0 18px 110px",overflowY:"auto",flex:1}}>
    <div style={{display:"flex",gap:6,marginBottom:14,overflowX:"auto"}}><Chip active={f==="pendiente"} onClick={()=>setF("pendiente")} color={C.amber}>Pendientes · {pend}</Chip><Chip active={f==="aprobado"} onClick={()=>setF("aprobado")} color={C.green}>Aprobados</Chip><Chip active={f==="rechazado"} onClick={()=>setF("rechazado")} color={C.red}>Rechazados</Chip><Chip active={f==="todas"} onClick={()=>setF("todas")}>Todas</Chip></div>
    <div style={{display:"flex",flexDirection:"column",gap:12}}>{filtered.length===0?<div style={{background:C.surface,borderRadius:14,padding:40,textAlign:"center",border:`1px solid ${C.border}`}}><div style={{color:C.green,display:"inline-flex",marginBottom:12}}>{Ic.check}</div><div style={{fontSize:14,fontWeight:700,color:C.text}}>Todo al día</div></div>:filtered.map(s=><SolCard key={s.id} s={s} showActions onResolve={resolver}/>)}</div>
  </div>;
}

/* ═══ REGLAS ═══ */
function ReglasScreen({ctx,reload,usuario}){
  const [nr,setNr]=useState("");
  const add=async()=>{if(!nr.trim())return;await sb.post("reglas_bot",{regla:nr.trim(),creada_por:usuario.apodo});setNr("");reload();};
  const del=async(id)=>{await sb.del(`reglas_bot?id=eq.${id}`);reload();};
  return<div style={{padding:"0 18px 110px",overflowY:"auto",flex:1}}>
    <div style={{background:`linear-gradient(135deg,${C.violet}12,${C.surface})`,borderRadius:16,padding:16,border:`1px solid ${C.border}`,marginBottom:14}}><div style={{fontSize:11,color:C.violet,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em"}}>REGLAS DEL BOT</div><div style={{fontSize:13,color:C.text,marginTop:6,lineHeight:1.5}}>Cambios aplican inmediatamente al bot.</div></div>
    <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:18}}>{(ctx.reglasRaw||[]).map((r,i)=><div key={r.id} style={{background:C.surface,borderRadius:12,padding:14,border:`1px solid ${C.border}`,display:"flex",gap:10}}><div style={{width:24,height:24,borderRadius:7,background:C.amberS,color:C.amber,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:fM,fontSize:11,fontWeight:700,flexShrink:0}}>{i+1}</div><div style={{flex:1,fontSize:13,color:C.text,lineHeight:1.4}}>{r.regla}</div><button onClick={()=>del(r.id)} style={{background:"none",border:"none",color:C.red,cursor:"pointer",padding:4,display:"flex",flexShrink:0,opacity:.6}}>{Ic.trash}</button></div>)}</div>
    <div style={{marginBottom:12}}><h3 style={{margin:0,fontSize:14,fontWeight:700,color:C.text,fontFamily:fH}}>Agregar regla</h3></div>
    <div style={{display:"flex",gap:8}}><input value={nr} onChange={e=>setNr(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder='Ej: "Si piden permiso un viernes..."' style={{flex:1,padding:"11px 14px",borderRadius:10,background:C.surfLo,border:`1px solid ${C.border}`,color:C.text,fontSize:14,fontFamily:fB,outline:"none",boxSizing:"border-box"}}/><button onClick={add} disabled={!nr.trim()} style={{width:44,height:44,borderRadius:12,border:"none",background:nr.trim()?C.amber:C.surface,color:nr.trim()?"#000":C.mute,cursor:nr.trim()?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center"}}>{Ic.plus}</button></div>
  </div>;
}

/* ═══ NAV ═══ */
function Nav({active,onChange,role,pend}){
  const items=role==="gerencial"||role==="administrativo"?[["home","Inicio",Ic.home],["solicitudes","Inbox",Ic.inbox,pend],["reportes","Reportes",Ic.history],["equipo","Equipo",Ic.users],["ger-actividad","Taller",Ic.hammer],["chat","Bot",Ic.chat]]:[["home","Inicio",Ic.home],["actividad","Actividad",Ic.hammer],["obra","Obra",Ic.gear],["chat","Bot",Ic.chat],["mis-sols","Solicitudes",Ic.history]];
  return<div className="safe-bottom" style={{position:"fixed",bottom:0,left:0,right:0,background:`${C.bg}f0`,backdropFilter:"blur(20px)",borderTop:`1px solid ${C.border}`,padding:"8px 12px 22px",zIndex:50,display:"flex",justifyContent:"space-around",maxWidth:480,margin:"0 auto"}}>
    {items.map(([id,lbl,ic,badge])=>{const a=active===id;return<button key={id} onClick={()=>onChange(id)} style={{flex:1,background:"none",border:"none",padding:"6px 0",display:"flex",flexDirection:"column",alignItems:"center",gap:4,color:a?C.amber:C.dim,cursor:"pointer",fontFamily:fB,fontSize:10,fontWeight:600}}><div style={{...(a?{background:C.amberS,borderRadius:12,padding:"4px 14px"}:{}),display:"flex",alignItems:"center",position:"relative"}}>{ic}{badge>0&&<span style={{position:"absolute",top:-2,right:-2,minWidth:16,height:16,padding:"0 4px",borderRadius:8,background:C.red,color:"#fff",fontSize:9,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",border:`2px solid ${C.bg}`,fontFamily:fM}}>{badge}</span>}</div><span>{lbl}</span></button>})}
  </div>;
}

/* ═══ MAIN ═══ */
export default function Home() {
  const [usuario,setUsuario]=useState(null);
  const [screen,setScreen]=useState("home");
  const [time,setTime]=useState(new Date());
  const [ctx,setCtx]=useState({});
  const [ready,setReady]=useState(false);
  const [init,setInit]=useState(false);
  const [refreshCounter,setRefreshCounter]=useState(0);

  const actividad=useActividad(usuario?{id:usuario.id,legajo:usuario.legajo,division:usuario.division}:null);

  useEffect(()=>{try{const s=localStorage.getItem("gi-user");if(s)setUsuario(JSON.parse(s));}catch{}setInit(true);},[]);
  const login=u=>{setUsuario(u);try{localStorage.setItem("gi-user",JSON.stringify(u));}catch{}};
  const logout=()=>{setUsuario(null);setScreen("home");try{localStorage.removeItem("gi-user");}catch{}};

  const loadData=useCallback(async()=>{
    if(!usuario)return;
    try{
      const today=new Date().toISOString().split("T")[0];
      const mon=new Date();mon.setDate(mon.getDate()-((mon.getDay()+6)%7));const monStr=mon.toISOString().split("T")[0];
      const isGer=usuario.rol==="gerencial"||usuario.rol==="administrativo";
      const [empleados,fichadasHoy,miFichada,fichadasSemana,solicitudes,misSolicitudes,reglas,notificaciones]=await Promise.all([
        sb.get("empleados?select=*&activo=eq.true&order=legajo.asc"),
        sb.get(`fichadas?select=legajo,ingreso,egreso,horas_trabajadas,empleados(nombre)&fecha=eq.${today}`),
        sb.get(`fichadas?legajo=eq.${usuario.legajo}&fecha=eq.${today}`),
        sb.get(`fichadas?legajo=eq.${usuario.legajo}&fecha=gte.${monStr}&order=fecha.asc`),
        sb.get("solicitudes?select=*&order=created_at.desc&limit=50"),
        sb.get(`solicitudes?legajo=eq.${usuario.legajo}&order=created_at.desc&limit=20`),
        sb.get("reglas_bot?activa=eq.true&order=id.asc"),
        sb.get(isGer?"notificaciones?destinatario_rol=eq.gerencial&order=created_at.desc&limit=10":`notificaciones?destinatario_rol=eq.${usuario.legajo}&order=created_at.desc&limit=10`),
      ]);
      const fHoy=fichadasHoy.map(f=>({...f,nombre:f.empleados?.nombre||""}));
      setCtx({empleados,fichadasHoy:fHoy,fichadaHoy:miFichada[0]||null,fichadasSemana,solicitudes,misSolicitudes,reglas:reglas.map(r=>r.regla),reglasRaw:reglas,notificaciones});
      setReady(true);
    }catch(e){console.error(e);setReady(true);}
  },[usuario]);

  useEffect(()=>{if(usuario){setReady(false);loadData();}},[usuario,loadData]);
  useEffect(()=>{if(!usuario)return;const t=setInterval(loadData,15000);return()=>clearInterval(t);},[usuario,loadData]);
  useEffect(()=>{const t=setInterval(()=>setTime(new Date()),30000);return()=>clearInterval(t);},[]);

  const isGer=usuario&&(usuario.rol==="gerencial"||usuario.rol==="administrativo");
  const pend=(ctx.solicitudes||[]).filter(s=>s.estado==="pendiente").length;
  const isChat=screen==="chat";
  const showBack=screen==="reglas";

  if(!init)return null;

  return<div style={{maxWidth:480,margin:"0 auto",height:"100dvh",background:C.bg,position:"relative",overflow:"hidden",display:"flex",flexDirection:"column"}}>
    {/* Status bar */}
    <div className="safe-top" style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 22px 0",color:C.text,fontSize:14,fontWeight:700,flexShrink:0}}>
      <span style={{fontVariantNumeric:"tabular-nums"}}>{fmtTime(time)}</span>
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="2" y="14" width="3" height="6" rx="1"/><rect x="8" y="10" width="3" height="10" rx="1"/><rect x="14" y="6" width="3" height="14" rx="1"/><rect x="20" y="2" width="3" height="18" rx="1"/></svg>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
        <svg width="22" height="14" viewBox="0 0 24 14" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="1" width="18" height="12" rx="2"/><rect x="3" y="3" width="14" height="8" rx="1" fill="currentColor"/></svg>
      </div>
    </div>

    {!usuario?(
      <div style={{flex:1,overflow:"hidden"}}><LoginScreen onLogin={login}/></div>
    ):!ready?(
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:14}}>
        <div style={{color:C.amber,animation:"spin 1s linear infinite",display:"flex"}}>{Ic.refresh}</div>
        <div style={{fontSize:13,color:C.dim}}>Cargando datos...</div>
      </div>
    ):<>
      <PushManager legajo={String(usuario.legajo)} onNotification={()=>loadData()}/>

      {/* Header — oculto en dashboard gerencia y chat */}
      {isChat?<div style={{padding:"8px 16px 14px",display:"flex",alignItems:"center",gap:12,borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
        <button onClick={()=>setScreen("home")} style={{background:"none",border:"none",color:C.text,cursor:"pointer",padding:6,display:"flex"}}>{Ic.chevL}</button>
        <div style={{width:36,height:36,borderRadius:12,background:`linear-gradient(135deg,${C.amber},${C.violet})`,display:"flex",alignItems:"center",justifyContent:"center",color:"#000"}}>{Ic.bot}</div>
        <div style={{flex:1}}><div style={{fontSize:14,fontWeight:700,color:C.text,fontFamily:fH}}>Asistente GI</div><div style={{display:"flex",alignItems:"center",gap:5,marginTop:1}}><span style={{width:6,height:6,borderRadius:3,background:C.green}}/><span style={{fontSize:11,color:C.dim}}>IA activa</span></div></div>
        <span style={{color:C.amber,opacity:.6}}>{Ic.sparkle}</span>
      </div>
      :screen==="home"&&isGer?null
      :screen==="home"&&!isGer?null
      :<div style={{padding:"8px 22px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {showBack&&<button onClick={()=>setScreen("home")} style={{background:"none",border:"none",color:C.text,cursor:"pointer",padding:4,display:"flex"}}>{Ic.chevL}</button>}
          <div>
            <div style={{fontSize:11,color:C.dim,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:2}}>{isGer?showBack?"Configuración":screen==="ger-actividad"?"Producción en vivo":screen==="grilla-horario"?"Gestión de horarios":screen==="equipo"?"Gestión de personal":screen==="calendario"?"Planificación":screen==="reportes"?"Control horario":screen==="geolocalizacion"?"Control GPS":"App GI":screen==="actividad"?"Registro de actividades":screen==="obra"?"Reporte diario":"App GI"}</div>
            <h1 style={{margin:0,fontSize:22,fontWeight:700,color:C.text,fontFamily:fH,letterSpacing:"-0.02em"}}>{screen==="solicitudes"?"Inbox":screen==="equipo"?"Personal":screen==="mis-sols"?"Solicitudes":screen==="reglas"?"Reglas del Bot":screen==="actividad"?"Mi Jornada":screen==="ger-actividad"?"Taller":screen==="grilla-horario"?"Horarios":screen==="calendario"?"Calendario":screen==="reportes"?"Reportes":screen==="geolocalizacion"?"Ubicaciones":screen==="obra"?"Reporte de Obra":"App GI"}</h1>
          </div>
        </div>
        <div style={{display:"flex",gap:6}}>
          <button onClick={()=>{loadData();setRefreshCounter(c=>c+1);}} style={{width:36,height:36,borderRadius:10,background:C.surface,color:C.dim,border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>{Ic.refresh}</button>
          <button onClick={logout} style={{width:36,height:36,borderRadius:10,background:C.surface,color:C.dim,border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>{Ic.logout}</button>
        </div>
      </div>}

      {/* Content */}
      <div className="se" key={`${usuario.legajo}-${screen}-${refreshCounter}`} style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column",paddingBottom:isChat?0:88}}>
        {!isGer&&screen==="home"&&<HomeEmp goto={setScreen} usuario={usuario} ctx={ctx}/>}
        {!isGer&&screen==="actividad"&&<ActividadScreen {...actividad}/>}
        {!isGer&&screen==="chat"&&<ChatScreen usuario={usuario} ctx={ctx} reload={loadData}/>}
        {!isGer&&screen==="obra"&&<InstaladorScreen usuario={usuario}/>}
        {!isGer&&screen==="mis-sols"&&<div style={{padding:"0 18px 20px",overflowY:"auto",flex:1}}><div style={{display:"flex",flexDirection:"column",gap:10}}>{(ctx.misSolicitudes||[]).map(s=><SolCard key={s.id} s={s}/>)}</div></div>}
        {isGer&&screen==="home"&&<DashboardGerencia goto={setScreen} ctx={ctx} reload={loadData}/>}
        {isGer&&screen==="solicitudes"&&<InboxScreen ctx={ctx} reload={loadData} usuario={usuario}/>}
        {isGer&&screen==="equipo"&&<GestionPersonalScreen ctx={ctx} reload={loadData}/>}
        {isGer&&screen==="ger-actividad"&&<GerenciaActividadScreen/>}
        {isGer&&screen==="grilla-horario"&&<GrillaHorarioScreen/>}
        {isGer&&screen==="calendario"&&<CalendarioScreen/>}
        {isGer&&screen==="reportes"&&<ReportesScreen/>}
        {isGer&&screen==="geolocalizacion"&&<GeolocalizacionScreen/>}
        {isGer&&screen==="reglas"&&<ReglasScreen ctx={ctx} reload={loadData} usuario={usuario}/>}
        {isGer&&screen==="chat"&&<ChatScreen usuario={usuario} ctx={ctx} reload={loadData}/>}
      </div>

      {!isChat&&<Nav active={screen} onChange={setScreen} role={usuario.rol} pend={pend}/>}
    </>}
  </div>;
}
