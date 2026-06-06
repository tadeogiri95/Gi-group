'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { sb, setToken, getToken, clearToken, onUnauthorized, setEmpresaId } from '../lib/supabase';
import { setDivisionesEmpresa } from '../lib/constants';
import { C, fH, fB, fM, fmtTime, fmtDate, fmtDateLong, DIAS_KEY, setColoresEmpresa } from '../lib/theme';
import { callClaude, parseAction } from '../lib/claude';
import { haversine } from '../lib/calc';
import PushManager from '../../components/PushManager';
import { sendPushToLegajo } from '../../lib/push';
import ActividadScreen from '../actividad_screen';
import { useActividad } from '../hooks/useActividad';
import GerenciaActividadScreen from '../gerencia_actividad_screen';
import GrillaHorarioScreen from '../grilla_horario_screen';
import GestionPersonalScreen from '../gestion_personal_screen';
import CalendarioScreen from '../calendario_screen';
import DashboardGerencia from '../dashboard_gerencia';
import ReportesScreen from '../reportes_screen';
import GeolocalizacionScreen from '../geolocalizacion_screen';
import InstaladorScreen from '../instalador_screen.jsx';
import AdminEmpresaScreen from '../admin_empresa_screen.js';
import ProyectosScreen from '../proyectos_screen.jsx';
import OnboardingWizard from '../onboarding_wizard.jsx';

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

import { Tag, Chip } from "../components/ui";
import LoginScreenNew from '../components/LoginScreen';
import CambiarPasswordScreenNew from '../components/CambiarPasswordScreen';

/* ═══ LOGIN ═══ */
/* ═══ LOGIN ═══ */
function LoginScreen({onLogin,empresa}) {
  const [legajo,setLegajo]=useState("");
  const [password,setPassword]=useState("");
  const [showPwd,setShowPwd]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");

  const login=async()=>{
    if(!legajo||!password)return;
    setLoading(true);setError("");
    try{
      const res=await fetch("/api/login-empresa",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({legajo:legajo.trim(),password,empresa_id:empresa?.id||null}),
      });
      const data=await res.json();
      if(!res.ok||data.error){setError(data.error||"Error de conexión");setLoading(false);return;}
      if(data.token)setToken(data.token);
      onLogin(data.usuario);
    }catch(err){setError(err.message);setLoading(false);}
  };

  return <div className="login-shell">
    {/* Brand panel — solo visible en tablet+ via CSS */}
    <div className="login-brand">
      <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse at 30% 40%, ${C.amber}15 0%, transparent 60%), radial-gradient(ellipse at 70% 70%, ${C.violet}12 0%, transparent 50%)`}}/>
      <div style={{position:"relative",textAlign:"center"}}>
        {empresa?.logo_url?<img src={empresa.logo_url} alt={empresa?.nombre_corto||"Logo"} style={{width:96,height:96,borderRadius:24,objectFit:"contain",marginBottom:32}}/>:
        <div style={{width:96,height:96,borderRadius:24,background:`linear-gradient(135deg,${C.amber},${C.violet})`,display:"flex",alignItems:"center",justifyContent:"center",color:"#000",marginBottom:32,margin:"0 auto 32px"}}>
          <span style={{fontFamily:fH,fontSize:empresa?.nombre_corto?.length>4?22:32,fontWeight:800}}>{empresa?.nombre_corto||"Gypi"}</span>
        </div>}
        <h1 style={{margin:0,fontFamily:fH,fontSize:36,fontWeight:800,color:C.text,letterSpacing:"-0.03em",lineHeight:1.1}}>{empresa?.nombre_corto||"Gypi"}</h1>
        <div style={{fontSize:15,color:C.dim,marginTop:12,maxWidth:300,lineHeight:1.6}}>Gestión de personal inteligente. Fichajes, permisos y productividad en un solo lugar.</div>
      </div>
    </div>

    {/* Form panel */}
    <div className="login-form anim-fade">
      <div className="show-mobile-only" style={{flexDirection:"column",marginBottom:24}}>
        {empresa?.logo_url?<img src={empresa.logo_url} alt={empresa?.nombre_corto||"Logo"} style={{width:72,height:72,borderRadius:20,objectFit:"contain",marginBottom:0}}/>:
        <div style={{width:72,height:72,borderRadius:20,background:`linear-gradient(135deg,${C.amber},${C.violet})`,display:"flex",alignItems:"center",justifyContent:"center",color:"#000"}}>
          <span style={{fontFamily:fH,fontSize:empresa?.nombre_corto?.length>4?18:26,fontWeight:800}}>{empresa?.nombre_corto||"Gypi"}</span>
        </div>}
      </div>

      <h1 style={{margin:0,fontFamily:fH,fontSize:30,fontWeight:700,color:C.text,letterSpacing:"-0.025em"}}>Bienvenido</h1>
      <div style={{fontSize:14,color:C.dim,marginTop:6,marginBottom:32}}>{"Iniciá sesión en "+(empresa?.nombre_corto||"Gypi")}</div>
      <div style={{marginBottom:14}}>
        <label style={{display:"block",fontSize:11,fontWeight:700,color:C.dim,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Legajo / DNI</label>
        <input value={legajo} onChange={e=>setLegajo(e.target.value)} inputMode="numeric" placeholder="Ingresá tu número de legajo" style={{width:"100%",padding:"14px 16px",borderRadius:12,background:C.surface,border:`1px solid ${C.border}`,color:C.text,fontSize:15,fontFamily:fB,outline:"none",boxSizing:"border-box"}}/>
      </div>
      <div style={{marginBottom:18}}>
        <label style={{display:"block",fontSize:11,fontWeight:700,color:C.dim,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Contraseña</label>
        <div style={{position:"relative"}}>
          <input type={showPwd?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&login()} placeholder="Ingresá tu contraseña" style={{width:"100%",padding:"14px 16px",paddingRight:48,borderRadius:12,background:C.surface,border:`1px solid ${C.border}`,color:C.text,fontSize:15,fontFamily:fB,outline:"none",boxSizing:"border-box"}}/>
          <button onClick={()=>setShowPwd(!showPwd)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:12,fontFamily:fB,padding:4}}>{showPwd?"Ocultar":"Ver"}</button>
        </div>
      </div>
      <button onClick={login} disabled={loading||!legajo||!password} style={{width:"100%",padding:14,borderRadius:12,background:legajo&&password&&!loading?C.amber:C.surface,color:legajo&&password&&!loading?"#000":C.mute,border:"none",fontSize:15,fontWeight:700,fontFamily:fB,cursor:legajo&&password&&!loading?"pointer":"default",marginBottom:8}}>
        {loading?"Conectando...":"Iniciar sesión"}
      </button>
      {error&&<div style={{padding:12,background:C.redS,color:C.red,borderRadius:10,fontSize:12,marginTop:8}}>{error}</div>}
    </div>
  </div>;
}


/* ═══ CAMBIAR CONTRASEÑA ═══ */
function CambiarPasswordScreen({usuario,onDone}) {
  const [nueva,setNueva]=useState("");
  const [confirmar,setConfirmar]=useState("");
  const [showPwd,setShowPwd]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");

  const cambiar=async()=>{
    if(!nueva||!confirmar)return;
    if(nueva.length<4){setError("La contraseña debe tener al menos 4 caracteres");return;}
    if(nueva!==confirmar){setError("Las contraseñas no coinciden");return;}
    
    setLoading(true);setError("");
    try{
      const res=await fetch("/api/login-empresa",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"cambiar_password",userId:usuario.id,nuevaPassword:nueva,token:getToken()}),
      });
      const data=await res.json();
      if(!res.ok||data.error){setError(data.error||"Error al cambiar");setLoading(false);return;}
      onDone(data.usuario);
    }catch(err){setError(err.message);setLoading(false);}
  };

  return <div style={{display:"flex",flexDirection:"column",height:"100%",padding:"0 28px",justifyContent:"center"}}>
    <div style={{width:56,height:56,borderRadius:16,background:C.amberS,display:"flex",alignItems:"center",justifyContent:"center",color:C.amber,marginBottom:20}}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    </div>
    <h1 style={{margin:0,fontFamily:fH,fontSize:24,fontWeight:700,color:C.text}}>Crear tu contraseña</h1>
    <div style={{fontSize:13,color:C.dim,marginTop:6,marginBottom:28,lineHeight:1.5}}>Hola <b style={{color:C.text}}>{usuario.apodo}</b>, es tu primer ingreso. Elegí una contraseña personal para tu cuenta.</div>
    <div style={{marginBottom:14}}>
      <label style={{display:"block",fontSize:11,fontWeight:700,color:C.dim,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Nueva contraseña</label>
      <input type={showPwd?"text":"password"} value={nueva} onChange={e=>setNueva(e.target.value)} placeholder="Mínimo 4 caracteres" style={{width:"100%",padding:"14px 16px",borderRadius:12,background:C.surface,border:`1px solid ${C.border}`,color:C.text,fontSize:15,fontFamily:fB,outline:"none",boxSizing:"border-box"}}/>
    </div>
    <div style={{marginBottom:8}}>
      <label style={{display:"block",fontSize:11,fontWeight:700,color:C.dim,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Confirmar contraseña</label>
      <input type={showPwd?"text":"password"} value={confirmar} onChange={e=>setConfirmar(e.target.value)} onKeyDown={e=>e.key==="Enter"&&cambiar()} placeholder="Repetí la contraseña" style={{width:"100%",padding:"14px 16px",borderRadius:12,background:C.surface,border:`1px solid ${C.border}`,color:C.text,fontSize:15,fontFamily:fB,outline:"none",boxSizing:"border-box"}}/>
    </div>
    <button onClick={()=>setShowPwd(!showPwd)} style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:12,fontFamily:fB,padding:"4px 0",marginBottom:16,textAlign:"left"}}>{showPwd?"🙈 Ocultar contraseñas":"👁️ Mostrar contraseñas"}</button>
    <button onClick={cambiar} disabled={loading||!nueva||!confirmar} style={{width:"100%",padding:14,borderRadius:12,background:nueva&&confirmar&&!loading?C.amber:C.surface,color:nueva&&confirmar&&!loading?"#000":C.mute,border:"none",fontSize:15,fontWeight:700,fontFamily:fB,cursor:nueva&&confirmar&&!loading?"pointer":"default"}}>
      {loading?"Guardando...":"Confirmar contraseña"}
    </button>
    {error&&<div style={{padding:12,background:C.redS,color:C.red,borderRadius:10,fontSize:12,marginTop:8}}>{error}</div>}
  </div>;
}

/* ═══ FICHADA CARD ═══ */
function FichadaCard({tipo,hora,geoMsg,tardanza}){
  let color, bgColor, label, extraMsg;
  if(tipo==="egreso"){
    if(tardanza?.autoFichaje){
      color="#F59E0B";bgColor="rgba(245,158,11,0.15)";
      label="SALIDA AUTO-REGISTRADA";
      extraMsg="⚠️ Fichaje automático por falta de registro";
    } else {
      color=C.cyan;bgColor=`${C.cyan}12`;label="SALIDA REGISTRADA";
    }
  } else {
    if(!tardanza||tardanza.estado==="puntual"){
      color=C.green;bgColor=`${C.green}12`;label="INGRESO A HORARIO ✅";
    } else if(tardanza.estado==="bloqueado"){
      color=C.red;bgColor=`${C.red}20`;
      label="⛔ REQUIERE PERMISO DE GERENCIA";
      extraMsg=tardanza.llegadasTarde>=3
        ?`3ra llegada tarde del mes — ingreso bloqueado`
        :`Tardanza de ${tardanza.minutos} min (supera tolerancia de 30 min)`;
    } else {
      color="#F59E0B";bgColor="rgba(245,158,11,0.18)";
      label=`⚠️ LLEGADA TARDE — ${tardanza.minutos} min`;
      extraMsg=`Llegada tarde #${tardanza.llegadasTarde} del mes — Recordá: a la 3ra llegada tarde perdés el premio por presentismo`;
    }
  }
  return <div style={{marginTop:8,padding:16,background:bgColor,borderRadius:14,border:`2px solid ${color}50`,minWidth:220}}>
    <div style={{display:"flex",alignItems:"center",gap:10}}>
      <div style={{width:42,height:42,borderRadius:12,background:`${color}30`,color,display:"flex",alignItems:"center",justifyContent:"center"}}>{tipo==="ingreso"?Ic.enter:Ic.exit}</div>
      <div style={{flex:1}}>
        <div style={{fontSize:tardanza&&tardanza.estado!=="puntual"?14:11,color,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em"}}>{label}</div>
        <div style={{fontFamily:fH,fontSize:tardanza&&tardanza.estado!=="puntual"?28:22,fontWeight:700,color:C.text,marginTop:2}}>{hora}</div>
        {extraMsg && <div style={{fontSize:12,color,fontWeight:600,marginTop:4}}>{extraMsg}</div>}
        {geoMsg && <div style={{fontSize:10,color:C.dim,marginTop:4}}>{geoMsg}</div>}
      </div>
      {(!tardanza||tardanza.estado==="puntual")&&<span style={{color:C.green}}>{Ic.check}</span>}
      {tardanza?.estado==="bloqueado"&&<span style={{color:C.red,fontSize:24}}>⛔</span>}
      {tardanza?.estado==="tarde"&&<span style={{color:"#F59E0B",fontSize:24}}>⚠️</span>}
    </div>
  </div>;
}
function SolSentCard({motivo,fecha}){return<div style={{marginTop:8,padding:14,background:C.amberS,borderRadius:14,border:`1px solid ${C.amber}30`,minWidth:220}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}><div><div style={{fontSize:11,color:C.amber,fontWeight:700,letterSpacing:"0.06em"}}>ENVIADA A GERENCIA</div><div style={{fontSize:13,color:C.text,fontWeight:600,marginTop:4}}>{motivo}</div><div style={{fontSize:11,color:C.dim,marginTop:4}}>📅 {fecha} · ⏳ Esperando</div></div><Tag color={C.amber}>{Ic.clock} PENDIENTE</Tag></div></div>;}

/* ═══ FICHAJE SERVER-SIDE (ETAPA 3) ═══ */
async function ficharServer(accion, opciones = {}) {
  const token = getToken();
  if (!token) throw new Error("Sin sesión");
  const res = await fetch("/api/fichar", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ accion, ...opciones }),
  });
  const data = await res.json();
  if (res.status === 401) { clearToken(); throw new Error("Sesión expirada"); }
  return data;
}

async function obtenerGeo(empleado) {
  const ub = empleado.ubicacion_fichaje;
  if (!ub || !ub.activa || ub.tipo === "home_office") return { ok: true, msg: ub?.tipo === "home_office" ? "Home Office" : "Sin control de ubicación" };
  if (!navigator.geolocation) return { ok: false, msg: "Tu navegador no soporta geolocalización." };
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      pos => {
        const dist = Math.round(haversine(pos.coords.latitude, pos.coords.longitude, ub.lat, ub.lng));
        const ok = dist <= (ub.radio || 200);
        resolve({
          ok, lat: pos.coords.latitude, lng: pos.coords.longitude, distancia: dist,
          msg: ok ? "✅ Ubicación verificada (" + dist + "m)" : "❌ Estás a " + dist + "m (máximo " + (ub.radio || 200) + "m)",
        });
      },
      err => resolve({ ok: false, msg: err.code === 1 ? "⚠️ Necesitás dar permiso de ubicación." : "Error GPS: " + err.message }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  });
}

/* ═══ CHAT ═══ */
function ChatScreen({usuario,ctx,reload,empresa}){
  const dH=DIAS_KEY[new Date().getDay()];const diagH=usuario.diagrama?.[dH];
  const [msgs,setMsgs]=useState([{from:"bot",text:`¡Hola ${usuario.apodo}! 🤖\n\nHoy es ${fmtDate(new Date())}, son las ${fmtTime(new Date())}.\n${ctx.fichadaHoy?.ingreso?`Tu ingreso: ${ctx.fichadaHoy.ingreso.slice(0,5)}.`:diagH?`Jornada hoy: ${diagH.in} a ${diagH.out}.`:"Hoy es franco 🎉"}\n\nContame qué necesitás.`,quickReplies:["Ya llegué","Necesito un permiso","Me voy"],time:new Date()}]);
  const [input,setInput]=useState("");const [loading,setLoading]=useState(false);const ref=useRef(null);
  useEffect(()=>{ref.current&&(ref.current.scrollTop=ref.current.scrollHeight)},[msgs,loading]);

  const execAction=async(action)=>{
    let card=null;const hora=fmtTime(new Date());
    try{switch(action.type){
      case"FICHAR_INGRESO":{
        const geo = await obtenerGeo(usuario);
        if (!geo.ok) return { type: "geo_error", msg: geo.msg };
        const res = await ficharServer("ingreso", {
          geo_lat: geo.lat, geo_lng: geo.lng, geo_distancia: geo.distancia,
        });
        if (!res.ok) {
          if (res.tipo === "bloqueado_tardanza" || res.tipo === "bloqueado_3ra_tarde") {
            return { type: "fichada_bloqueada", msg: "⛔ " + res.error };
          }
          if (res.tipo === "bloqueado_horario") {
            return { type: "fichada_bloqueada", msg: "⛔ " + res.error };
          }
          return { type: "fichada_bloqueada", msg: res.error };
        }
        card={type:"fichada",sub:"ingreso",hora:res.hora||hora,geoMsg:geo.msg,tardanza:res.tardanza};
        break;
      }
      case"FICHAR_EGRESO":{
        const geo = await obtenerGeo(usuario);
        if (!geo.ok) return { type: "geo_error", msg: geo.msg };
        const res = await ficharServer("egreso", {
          geo_lat: geo.lat, geo_lng: geo.lng, geo_distancia: geo.distancia,
        });
        if (!res.ok) {
          if (res.tipo === "tarea_activa") {
            return { type: "tarea_activa", msg: "⚠️ " + res.error, tareaId: res.tarea_id };
          }
          return { type: "fichada_bloqueada", msg: res.error };
        }
        card={type:"fichada",sub:"egreso",hora:res.hora||hora,geoMsg:geo.msg};
        break;
      }
      case"FICHAR_EGRESO_FORZAR":{
        const geo = await obtenerGeo(usuario);
        if (!geo.ok) return { type: "geo_error", msg: geo.msg };
        const res = await ficharServer("egreso", {
          forzar_cierre_tarea: true,
          geo_lat: geo.lat, geo_lng: geo.lng, geo_distancia: geo.distancia,
        });
        if (!res.ok) return { type: "fichada_bloqueada", msg: res.error };
        card={type:"fichada",sub:"egreso",hora:res.hora||hora,geoMsg:geo.msg};
        break;
      }
      case"SOLICITAR_PERMISO":await sb.post("solicitudes",{empleado_id:usuario.id,legajo:usuario.legajo,nombre_empleado:usuario.nombre,tipo:"permiso",motivo:action.motivo||"",fecha:action.fecha||"",desde:action.desde||"—",hasta:action.hasta||"—",estado:"pendiente",empresa_id:usuario.empresa_id});await sb.post("notificaciones",{destinatario_rol:"gerencial",tipo:"solicitud",asunto:`${usuario.apodo} pidió permiso`,detalle:action.motivo,urgencia:"normal",empresa_id:usuario.empresa_id});sendPushToLegajo("1","📋 Nuevo permiso",`${usuario.apodo} solicitó permiso: ${action.motivo||"sin detalle"}`,{empresa_id:usuario.empresa_id}).catch(()=>{});card={type:"solicitud",motivo:action.motivo,fecha:action.fecha};break;
      case"AVISAR_TARDANZA":await sb.post("solicitudes",{empleado_id:usuario.id,legajo:usuario.legajo,nombre_empleado:usuario.nombre,tipo:"tardanza",motivo:`Tardanza: ${action.motivo||""}`,fecha:"hoy",estado:"registrado",empresa_id:usuario.empresa_id});await sb.post("notificaciones",{destinatario_rol:"gerencial",tipo:"alerta",asunto:`Tardanza de ${usuario.apodo}`,detalle:action.motivo,urgencia:"normal",empresa_id:usuario.empresa_id});sendPushToLegajo("1","⏰ Tardanza",`${usuario.apodo}: ${action.motivo||"sin detalle"}`,{empresa_id:usuario.empresa_id}).catch(()=>{});break;
      case"AVISAR_AUSENCIA":await sb.post("solicitudes",{empleado_id:usuario.id,legajo:usuario.legajo,nombre_empleado:usuario.nombre,tipo:"ausencia",motivo:action.motivo||"Ausencia",fecha:action.fecha||"hoy",estado:"pendiente",empresa_id:usuario.empresa_id});await sb.post("notificaciones",{destinatario_rol:"gerencial",tipo:"alerta",asunto:`Ausencia de ${usuario.apodo}`,detalle:action.motivo,urgencia:"alta",empresa_id:usuario.empresa_id});sendPushToLegajo("1","🚨 Ausencia",`${usuario.apodo}: ${action.motivo||"Ausencia"}`,{empresa_id:usuario.empresa_id}).catch(()=>{});break;
      case"NOTIFICAR_GERENCIA":await sb.post("notificaciones",{destinatario_rol:"gerencial",tipo:"info",asunto:action.asunto,detalle:action.detalle,urgencia:action.urgencia||"normal",empresa_id:usuario.empresa_id});break;
    }reload&&reload();}catch(e){console.error(e);}return card;
  };

  const handleSend=async(txt=input)=>{const t=txt.trim();if(!t||loading)return;
    const um={from:"user",text:t,time:new Date()};const nm=[...msgs,um];setMsgs(nm);setInput("");setLoading(true);
    sb.post("mensajes_chat",{legajo:usuario.legajo,rol:"user",mensaje:t,empresa_id:usuario.empresa_id}).catch(()=>{});
    if(t==="✅ Sí, solicitar permiso"){
      try{
        const hoy=new Date().toISOString().split("T")[0];
        const hora=fmtTime(new Date());
        await sb.post("solicitudes",{empleado_id:usuario.id,legajo:usuario.legajo,nombre_empleado:usuario.nombre,tipo:"permiso",motivo:`🔓 Permiso de INGRESO por bloqueo (${hora})`,fecha:hoy,desde:hora,hasta:"—",estado:"pendiente",empresa_id:usuario.empresa_id});
        await sb.post("notificaciones",{destinatario_rol:"gerencial",tipo:"solicitud",asunto:`🔓 ${usuario.apodo} solicita permiso de INGRESO`,detalle:`Ingreso bloqueado a las ${hora}. Requiere autorización para fichar.`,urgencia:"alta",empresa_id:usuario.empresa_id});
        sendPushToLegajo("1","🔓 Permiso de ingreso",`${usuario.apodo} solicita autorización para ingresar (${hora})`,{empresa_id:usuario.empresa_id}).catch(()=>{});
        setMsgs(m=>[...m,{from:"bot",text:"✅ Listo, se envió la solicitud de permiso de ingreso a gerencia. Te voy a avisar cuando la resuelvan.",time:new Date(),card:{type:"solicitud",motivo:"🔓 Permiso de INGRESO por bloqueo",fecha:hoy}}]);
        if(reload)reload();
      }catch(e){console.error("Error solicitud permiso ingreso:",e);setMsgs(m=>[...m,{from:"bot",text:"Error al enviar la solicitud. Probá de nuevo.",time:new Date()}]);}
      setLoading(false);return;
    }
    if(t==="❌ No, cancelar"){
      setMsgs(m=>[...m,{from:"bot",text:"Entendido. Si necesitás algo más, avisame.",time:new Date()}]);
      setLoading(false);return;
    }
    if(t==="✅ Sí, fichar salida"){
      try{
        const cardResult=await execAction({type:"FICHAR_EGRESO_FORZAR"});
        if(cardResult?.type==="geo_error"){
          setMsgs(m=>[...m,{from:"bot",text:cardResult.msg,time:new Date()}]);
        }else{
          setMsgs(m=>[...m,{from:"bot",text:"✅ Actividad finalizada y salida registrada.",card:cardResult,time:new Date()}]);
        }
        if(reload)reload();
      }catch(e){console.error(e);setMsgs(m=>[...m,{from:"bot",text:"Error al fichar salida. Probá de nuevo.",time:new Date()}]);}
      setLoading(false);return;
    }
    /* ═══ FICHAJE DIRECTO: "Ya llegué" ═══ */
    if(t==="Ya llegué"){
      try{
        const cardResult=await execAction({type:"FICHAR_INGRESO"});
        if(cardResult?.type==="geo_error"){
          setMsgs(m=>[...m,{from:"bot",text:cardResult.msg,time:new Date()}]);
        }else if(cardResult?.type==="fichada_bloqueada"){
          setMsgs(m=>[...m,{from:"bot",text:cardResult.msg+"\n\n¿Querés que solicite el permiso de ingreso a gerencia?",time:new Date(),quickReplies:["✅ Sí, solicitar permiso","❌ No, cancelar"]}]);
        }else if(cardResult){
          // Armar mensaje con info de tardanza
          let tardMsg="✅ ¡Fichado! Buen día, "+usuario.apodo+" 👋";
          const trd=cardResult.tardanza;
          if(trd&&trd.estado==="tarde"){
            tardMsg=`⚠️ Fichado, pero llegás ${trd.minutos} min tarde.\nEs tu llegada tarde #${trd.llegadasTarde} del mes.`;
            if(trd.llegadasTarde===2)tardMsg+="\n⚡ Recordá: a la 3ra llegada tarde perdés el premio por presentismo.";
            if(trd.llegadasTarde>=3)tardMsg+="\n🚨 ¡PERDISTE EL PREMIO POR PRESENTISMO este mes!";
          }
          setMsgs(m=>[...m,{from:"bot",text:tardMsg,card:cardResult,time:new Date()}]);
          sb.post("mensajes_chat",{legajo:usuario.legajo,rol:"bot",mensaje:tardMsg,empresa_id:usuario.empresa_id}).catch(()=>{});
        }else{
          setMsgs(m=>[...m,{from:"bot",text:"✅ Ingreso registrado. ¡Buen día!",time:new Date()}]);
        }
        if(reload)reload();
      }catch(e){console.error("Error fichando ingreso:",e);setMsgs(m=>[...m,{from:"bot",text:"Error al fichar ingreso. Probá de nuevo.",time:new Date()}]);}
      setLoading(false);return;
    }
    /* ═══ FICHAJE DIRECTO: "Me voy" ═══ */
    if(t==="Me voy"){
      try{
        const cardResult=await execAction({type:"FICHAR_EGRESO"});
        if(cardResult?.type==="geo_error"){
          setMsgs(m=>[...m,{from:"bot",text:cardResult.msg,time:new Date()}]);
        }else if(cardResult?.type==="tarea_activa"){
          setMsgs(m=>[...m,{from:"bot",text:cardResult.msg,time:new Date(),quickReplies:["✅ Sí, fichar salida","❌ No, cancelar"]}]);
        }else if(cardResult?.type==="fichada_bloqueada"){
          setMsgs(m=>[...m,{from:"bot",text:cardResult.msg,time:new Date()}]);
        }else{
          setMsgs(m=>[...m,{from:"bot",text:"✅ Salida registrada. ¡Hasta mañana, "+usuario.apodo+"! 👋",card:cardResult,time:new Date()}]);
          sb.post("mensajes_chat",{legajo:usuario.legajo,rol:"bot",mensaje:"Salida registrada.",empresa_id:usuario.empresa_id}).catch(()=>{});
        }
        if(reload)reload();
      }catch(e){console.error("Error fichando egreso:",e);setMsgs(m=>[...m,{from:"bot",text:"Error al fichar salida. Probá de nuevo.",time:new Date()}]);}
      setLoading(false);return;
    }
    try{const hist=nm.slice(-20).map(m=>({from:m.from,text:m.text}));const raw=await callClaude(hist,ctx,usuario,empresa);const{clean,action}=parseAction(raw);
      let card=action?await execAction(action):null;
      if (card?.type === "geo_error") {
        setMsgs(m=>[...m,{from:"bot",text:card.msg,time:new Date()}]);
        setLoading(false);
        return;
      }
      if (card?.type === "fichada_bloqueada") {
        setMsgs(m=>[...m,{from:"bot",text:card.msg+"\n\n¿Querés que solicite el permiso de ingreso a gerencia?",time:new Date(),quickReplies:["✅ Sí, solicitar permiso","❌ No, cancelar"]}]);
        setLoading(false);
        return;
      }
      if (card?.type === "tarea_activa") {
        setMsgs(m=>[...m,{from:"bot",text:card.msg,time:new Date(),quickReplies:["✅ Sí, fichar salida","❌ No, cancelar"]}]);
        setLoading(false);
        return;
      }
      setMsgs(m=>[...m,{from:"bot",text:clean,card,time:new Date()}]);sb.post("mensajes_chat",{legajo:usuario.legajo,rol:"bot",mensaje:clean,empresa_id:usuario.empresa_id}).catch(()=>{});
    }catch{setMsgs(m=>[...m,{from:"bot",text:"Error de conexión. Probá de nuevo.",time:new Date()}]);}setLoading(false);};

  return<div style={{display:"flex",flexDirection:"column",height:"100%"}}>
    <div ref={ref} style={{flex:1,overflowY:"auto",padding:"8px 18px 12px",WebkitOverflowScrolling:"touch"}}>
      {msgs.map((m,i)=><div key={i} style={{display:"flex",justifyContent:m.from==="bot"?"flex-start":"flex-end",marginBottom:12}}>
        {m.from==="bot"&&<div style={{width:30,height:30,borderRadius:10,marginRight:8,background:`linear-gradient(135deg,${C.amber},${C.violet})`,display:"flex",alignItems:"center",justifyContent:"center",color:"#000",flexShrink:0}}>{Ic.bot}</div>}
        <div style={{maxWidth:"78%",display:"flex",flexDirection:"column",alignItems:m.from==="bot"?"flex-start":"flex-end"}}>
          <div style={{padding:"10px 14px",background:m.from==="bot"?C.surfHi:C.amber,color:m.from==="bot"?C.text:"#000",borderRadius:m.from==="bot"?"16px 16px 16px 4px":"16px 16px 4px 16px",fontSize:14,fontFamily:fB,lineHeight:1.5,whiteSpace:"pre-wrap",wordBreak:"break-word",border:m.from==="bot"?`1px solid ${C.border}`:"none",fontWeight:m.from==="bot"?400:500}}>{m.text}</div>
          {m.card?.type==="fichada"&&<FichadaCard tipo={m.card.sub} hora={m.card.hora} geoMsg={m.card.geoMsg} tardanza={m.card.tardanza}/>}
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
function SolCard({s,showActions,onResolve}){const ec={pendiente:C.amber,aprobado:C.green,rechazado:C.red,registrado:C.cyan};const esPermisoIngreso=s.motivo?.includes("🔓")||s.motivo?.toLowerCase().includes("permiso de ingreso")||s.motivo?.toLowerCase().includes("ingreso por bloqueo");return<div style={{background:esPermisoIngreso&&s.estado==="pendiente"?`${C.red}08`:C.surface,borderRadius:14,padding:14,border:`1px solid ${esPermisoIngreso&&s.estado==="pendiente"?C.red+"40":s.estado==="pendiente"?C.amber+"30":C.border}`,position:"relative",overflow:"hidden"}}>
  {s.estado==="pendiente"&&<div style={{position:"absolute",top:0,left:0,right:0,height:2,background:esPermisoIngreso?`linear-gradient(90deg,${C.red},${C.amber},${C.red})`:`linear-gradient(90deg,${C.amber},${C.red},${C.amber})`}}/>}
  {esPermisoIngreso&&s.estado==="pendiente"&&<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8,padding:"6px 10px",background:`${C.red}15`,borderRadius:8}}><span style={{fontSize:14}}>🔓</span><span style={{fontSize:11,fontWeight:700,color:C.red}}>PERMISO DE INGRESO — REQUIERE ACCIÓN INMEDIATA</span></div>}
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}><div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}><span style={{fontFamily:fM,fontSize:10,color:C.mute}}>#{s.id}</span><span style={{fontSize:13,fontWeight:700,color:C.text}}>{s.nombre_empleado}</span></div><Tag color={ec[s.estado]||C.dim}>{esPermisoIngreso?"🔓 "+s.estado:s.estado}</Tag></div>
  <div style={{fontSize:13,color:C.text,marginTop:4,lineHeight:1.4}}>{s.motivo}</div>
  <div style={{display:"flex",gap:8,marginTop:6,fontSize:11,color:C.dim,flexWrap:"wrap"}}><span>📅 {s.fecha}</span>{s.desde&&s.desde!=="—"&&<span>⏰ {s.desde}–{s.hasta}</span>}<span>· {new Date(s.created_at).toLocaleString("es-AR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</span></div>
  {s.aprobador&&<div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${C.border}`,fontSize:11,color:C.dim}}>✅ {s.aprobador}</div>}
  {showActions&&s.estado==="pendiente"&&<div style={{display:"flex",gap:8,marginTop:12}}><button onClick={()=>onResolve(s.id,"rechazado")} style={{flex:1,padding:9,borderRadius:10,background:"transparent",border:`1px solid ${C.red}40`,color:C.red,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:fB,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>{Ic.x} Rechazar</button><button onClick={()=>onResolve(s.id,"aprobado")} style={{flex:2,padding:9,borderRadius:10,background:C.green,border:"none",color:"#000",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:fB,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>{Ic.check} Aprobar</button></div>}
</div>;}

/* ═══ HISTORIAL DE FICHAJES ═══ */
function HistorialFichajesScreen({usuario,ctx,legajoVer,onBack}){
  const [fichadas,setFichadas]=useState([]);const [loading,setLoading]=useState(true);const [mes,setMes]=useState(()=>{const n=new Date();return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`;});
  const [chatHistory,setChatHistory]=useState([]);const [showChat,setShowChat]=useState(false);
  const legajo=legajoVer||usuario.legajo;
  const isGer=usuario.rol==="gerencial"||usuario.rol==="administrativo";
  const empNombre=isGer&&legajoVer?(ctx.empleados||[]).find(e=>e.legajo===legajo)?.apodo||`L-${legajo}`:usuario.apodo;

  useEffect(()=>{
    (async()=>{
      setLoading(true);
      try{
        const [y,m]=mes.split("-").map(Number);
        const desde=`${y}-${String(m).padStart(2,"0")}-01`;
        const hasta=new Date(y,m,0);const hastaStr=`${y}-${String(m).padStart(2,"0")}-${String(hasta.getDate()).padStart(2,"0")}`;
        const f=await sb.get(`fichadas?legajo=eq.${legajo}&fecha=gte.${desde}&fecha=lte.${hastaStr}&order=fecha.desc&select=*`);
        setFichadas(f||[]);
        const ch=await sb.get(`mensajes_chat?legajo=eq.${legajo}&order=created_at.desc&limit=100`);
        setChatHistory(ch||[]);
      }catch(e){console.error(e);}
      setLoading(false);
    })();
  },[legajo,mes]);

  const tardesComunes=fichadas.filter(f=>f.llegada_tarde&&f.minutos_tarde<=30&&!(fichadas.filter(ff=>ff.llegada_tarde&&ff.fecha<=f.fecha).length>=3));
  const tardesConPerdida=fichadas.filter(f=>{
    if(!f.llegada_tarde)return false;
    if(f.minutos_tarde>30)return true;
    const anteriores=fichadas.filter(ff=>ff.llegada_tarde&&ff.fecha<=f.fecha);
    return anteriores.length>=3;
  });
  const totalTardes=fichadas.filter(f=>f.llegada_tarde).length;

  const cambiarMes=(dir)=>{const [y,m]=mes.split("-").map(Number);const d=new Date(y,m-1+dir,1);setMes(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);};
  const mesLabel=(()=>{const [y,m]=mes.split("-").map(Number);const meses=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];return `${meses[m-1]} ${y}`;})();

  return<div style={{padding:"0 18px 110px",overflowY:"auto",flex:1}}>
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
      <button onClick={onBack} style={{background:"none",border:"none",color:C.text,cursor:"pointer",padding:6,display:"flex"}}>{Ic.chevL}</button>
      <h2 style={{margin:0,fontFamily:fH,fontSize:20,fontWeight:700,color:C.text,flex:1}}>Fichajes de {empNombre}</h2>
    </div>

    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,background:C.surface,borderRadius:14,padding:"10px 16px",border:`1px solid ${C.border}`}}>
      <button onClick={()=>cambiarMes(-1)} style={{background:"none",border:"none",color:C.text,cursor:"pointer",fontSize:18,padding:4}}>←</button>
      <span style={{fontFamily:fH,fontSize:16,fontWeight:700,color:C.text}}>{mesLabel}</span>
      <button onClick={()=>cambiarMes(1)} style={{background:"none",border:"none",color:C.text,cursor:"pointer",fontSize:18,padding:4}}>→</button>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16}}>
      <div style={{background:C.surface,borderRadius:14,padding:14,border:`1px solid ${C.border}`,textAlign:"center"}}>
        <div style={{fontFamily:fH,fontSize:22,fontWeight:700,color:totalTardes>0?"#F59E0B":C.green}}>{totalTardes}</div>
        <div style={{fontSize:10,color:C.dim,fontWeight:600,marginTop:2}}>Tardes total</div>
      </div>
      <div style={{background:`${C.amber}08`,borderRadius:14,padding:14,border:`1px solid #F59E0B30`,textAlign:"center"}}>
        <div style={{fontFamily:fH,fontSize:22,fontWeight:700,color:"#F59E0B"}}>{tardesComunes.length}</div>
        <div style={{fontSize:10,color:C.dim,fontWeight:600,marginTop:2}}>Comunes</div>
      </div>
      <div style={{background:`${C.red}08`,borderRadius:14,padding:14,border:`1px solid ${C.red}30`,textAlign:"center"}}>
        <div style={{fontFamily:fH,fontSize:22,fontWeight:700,color:C.red}}>{tardesConPerdida.length}</div>
        <div style={{fontSize:10,color:C.dim,fontWeight:600,marginTop:2}}>Con pérdida</div>
      </div>
    </div>

    <div style={{background:C.surface,borderRadius:12,padding:12,border:`1px solid ${C.border}`,marginBottom:16,display:"flex",gap:16,flexWrap:"wrap"}}>
      <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:C.dim}}><span style={{width:10,height:10,borderRadius:3,background:C.green}}/> Puntual</div>
      <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:C.dim}}><span style={{width:10,height:10,borderRadius:3,background:"#F59E0B"}}/> Tarde común</div>
      <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:C.dim}}><span style={{width:10,height:10,borderRadius:3,background:C.red}}/> Pérdida presentismo</div>
    </div>

    {loading?<div style={{textAlign:"center",padding:30,color:C.dim}}>Cargando...</div>:
    fichadas.length===0?<div style={{background:C.surface,borderRadius:14,padding:30,textAlign:"center",border:`1px solid ${C.border}`,color:C.dim,fontSize:13}}>Sin fichadas en este mes</div>:
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {fichadas.map((f,i)=>{
        const esTardeComun=f.llegada_tarde&&f.minutos_tarde<=30&&!(fichadas.filter(ff=>ff.llegada_tarde&&ff.fecha<=f.fecha).length>=3);
        const esTardeConPerdida=f.llegada_tarde&&(f.minutos_tarde>30||fichadas.filter(ff=>ff.llegada_tarde&&ff.fecha<=f.fecha).length>=3);
        const bgColor=esTardeConPerdida?`${C.red}10`:esTardeComun?"rgba(245,158,11,0.08)":f.llegada_tarde?`${C.amber}08`:`${C.green}05`;
        const borderColor=esTardeConPerdida?`${C.red}30`:esTardeComun?"#F59E0B30":C.border;
        const statusColor=esTardeConPerdida?C.red:esTardeComun?"#F59E0B":C.green;
        const statusIcon=esTardeConPerdida?"⛔":esTardeComun?"⚠️":"✓";
        const statusLabel=esTardeConPerdida?"Pérdida de presentismo":esTardeComun?`Tarde +${f.minutos_tarde}min`:"Puntual";
        const tardeCuenta=f.llegada_tarde?fichadas.filter(ff=>ff.llegada_tarde&&ff.fecha<=f.fecha).length:0;
        return<div key={f.id||i} style={{background:bgColor,borderRadius:14,padding:14,border:`1px solid ${borderColor}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:C.text}}>{new Date(f.fecha+"T12:00:00").toLocaleDateString("es-AR",{weekday:"short",day:"2-digit",month:"2-digit"})}</div>
              <div style={{fontSize:12,color:C.dim,marginTop:4,fontFamily:fM}}>{f.ingreso?.slice(0,5)||"—"} → {f.egreso?.slice(0,5)||"sin egreso"}</div>
              {f.horas_trabajadas&&<div style={{fontSize:11,color:C.dim,marginTop:2}}>{Number(f.horas_trabajadas).toFixed(1)}h trabajadas</div>}
            </div>
            <div style={{textAlign:"right"}}>
              <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 8px",borderRadius:6,background:`${statusColor}22`,color:statusColor,fontSize:10,fontWeight:700}}>{statusIcon} {statusLabel}</span>
              {f.llegada_tarde&&tardeCuenta>0&&<div style={{fontSize:10,color:statusColor,marginTop:4,fontWeight:600}}>Tarde #{tardeCuenta} del mes</div>}
            </div>
          </div>
          {esTardeConPerdida&&<div style={{marginTop:8,padding:8,background:`${C.red}15`,borderRadius:8,fontSize:11,color:C.red,fontWeight:600}}>
            {f.minutos_tarde>30?`⛔ Tardanza de ${f.minutos_tarde} min (supera 30min de tolerancia)`:`⛔ 3ra llegada tarde del mes — pérdida de presentismo`}
          </div>}
        </div>;
      })}
    </div>}

    <div style={{marginTop:24,marginBottom:12}}><h3 style={{margin:0,fontSize:16,fontWeight:700,color:C.text,fontFamily:fH}}>💬 Historial de conversaciones</h3></div>
    <button onClick={()=>setShowChat(!showChat)} style={{width:"100%",padding:14,borderRadius:14,background:C.surface,border:`1px solid ${C.border}`,color:C.text,fontSize:13,fontWeight:600,fontFamily:fB,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <span>{showChat?"Ocultar":"Ver"} conversaciones ({chatHistory.length})</span>
      <span style={{fontSize:11,color:C.dim}}>{showChat?"▲":"▼"}</span>
    </button>
    {showChat&&<div style={{marginTop:10,background:C.surface,borderRadius:14,padding:14,border:`1px solid ${C.border}`,maxHeight:400,overflowY:"auto"}}>
      {chatHistory.length===0?<div style={{textAlign:"center",color:C.dim,fontSize:13,padding:16}}>Sin conversaciones</div>:
      chatHistory.map((m,i)=><div key={i} style={{display:"flex",justifyContent:m.rol==="user"?"flex-end":"flex-start",marginBottom:8}}>
        <div style={{maxWidth:"80%",padding:"8px 12px",borderRadius:m.rol==="user"?"12px 12px 4px 12px":"12px 12px 12px 4px",background:m.rol==="user"?`${C.amber}30`:C.surfHi,fontSize:12,color:C.text,lineHeight:1.4}}>
          <div style={{whiteSpace:"pre-wrap"}}>{m.mensaje}</div>
          <div style={{fontSize:9,color:C.mute,marginTop:4,textAlign:m.rol==="user"?"right":"left"}}>{new Date(m.created_at).toLocaleString("es-AR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</div>
        </div>
      </div>)}
    </div>}
  </div>;
}

/* ═══ HOME EMPLEADO ═══ */
function HomeEmp({goto,usuario,ctx,logout,empresa}){
  const misSols=ctx.misSolicitudes||[];const dH=DIAS_KEY[new Date().getDay()];const diagH=usuario.diagrama?.[dH];
  /* Notificaciones de resolución: solo la última del día actual */
  const notisResolucion=(()=>{
    const hoy=new Date().toISOString().split("T")[0];
    const dH2=DIAS_KEY[new Date().getDay()];
    const diagH2=usuario.diagrama?.[dH2];
    /* Si ya pasó el horario de salida, no mostrar */
    if(diagH2){
      const [hS,mS]=diagH2.out.split(":").map(Number);
      const ahoraMin=new Date().getHours()*60+new Date().getMinutes();
      if(ahoraMin>=hS*60+mS)return[];
    }
    const todasResol=(ctx.notificaciones||[]).filter(n=>n.tipo==="aprobacion"&&n.created_at?.startsWith(hoy));
    return todasResol.length>0?[todasResol[0]]:[];
  })();
  return<div style={{padding:"0 18px 110px",overflowY:"auto",flex:1}}>
    {/* Hero card con logout */}
    <div style={{background:`linear-gradient(135deg,${ctx.fichadaHoy?.ingreso?C.green:C.amber}08,${C.surface} 60%)`,borderRadius:20,padding:20,border:`1px solid ${ctx.fichadaHoy?.ingreso?C.green+"30":C.border}`,marginBottom:16,position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:-50,right:-50,width:170,height:170,borderRadius:"50%",background:`${ctx.fichadaHoy?.ingreso?C.green:C.amber}12`,filter:"blur(60px)"}}/>
      <div style={{position:"relative"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
          <div>
            <div style={{fontSize:13,color:C.dim,marginBottom:4}}>{fmtDate(new Date())}</div>
            <h2 style={{margin:0,fontFamily:fH,fontSize:24,fontWeight:700,color:C.text}}>Hola, {usuario.apodo}</h2>
            {diagH&&<div style={{fontSize:12,color:C.dim,marginTop:4}}>Jornada: <span style={{color:C.text,fontWeight:600}}>{diagH.in} a {diagH.out}</span></div>}
            {!diagH&&usuario.diagrama&&<div style={{fontSize:12,color:C.green,fontWeight:600,marginTop:4}}>Hoy es franco 🎉</div>}
          </div>
          <button onClick={logout} style={{width:36,height:36,borderRadius:10,background:C.surface,color:C.dim,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}} title="Cerrar sesión">{Ic.logout}</button>
        </div>
        {/* Fichada de hoy */}
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <span style={{width:8,height:8,borderRadius:4,background:ctx.fichadaHoy?.ingreso?C.green:C.amber}}/>
          <span style={{fontSize:13,fontWeight:600,color:ctx.fichadaHoy?.ingreso?C.green:C.amber}}>{ctx.fichadaHoy?.ingreso?`Ingreso ${ctx.fichadaHoy.ingreso.slice(0,5)}${ctx.fichadaHoy?.egreso?" · Egreso "+ctx.fichadaHoy.egreso.slice(0,5):""}`:"Sin fichar"}</span>
        </div>
      </div>
    </div>

    {/* Notificaciones de resoluciones */}
    {notisResolucion.length>0&&<div style={{marginBottom:16}}>
      <div style={{marginBottom:8}}><h3 style={{margin:0,fontSize:14,fontWeight:700,color:C.text,fontFamily:fH}}>🔔 Notificaciones</h3></div>
      {notisResolucion.slice(0,5).map(n=><div key={n.id} style={{background:n.asunto?.includes("APROBADA")||n.asunto?.includes("aprobado")?`${C.green}10`:`${C.red}10`,borderRadius:12,padding:12,border:`1px solid ${n.asunto?.includes("APROBADA")||n.asunto?.includes("aprobado")?C.green+"30":C.red+"30"}`,marginBottom:6}}>
        <div style={{fontSize:13,fontWeight:700,color:C.text}}>{n.asunto}</div>
        <div style={{fontSize:12,color:C.dim,marginTop:4}}>{n.detalle}</div>
        <div style={{fontSize:10,color:C.mute,marginTop:4}}>{new Date(n.created_at).toLocaleString("es-AR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</div>
      </div>)}
    </div>}

    {/* Bot */}
    <button onClick={()=>goto("chat")} style={{width:"100%",padding:"16px 20px",borderRadius:16,background:`linear-gradient(135deg,${C.amber}15,${C.violet}15)`,border:`1px solid ${C.amber}30`,cursor:"pointer",display:"flex",alignItems:"center",gap:14,fontFamily:fB,marginBottom:18}}>
      <div style={{width:44,height:44,borderRadius:14,background:`linear-gradient(135deg,${C.amber},${C.violet})`,display:"flex",alignItems:"center",justifyContent:"center",color:"#000",flexShrink:0}}>{Ic.bot}</div>
      <div style={{flex:1,textAlign:"left"}}>
        <div style={{fontSize:14,fontWeight:700,color:C.text,lineHeight:1.3}}>Tocame para fichar ingreso, salida,</div>
        <div style={{fontSize:14,fontWeight:700,color:C.text,lineHeight:1.3}}>pedir permisos o dar avisos</div>
      </div>
      <span style={{color:C.amber,flexShrink:0}}>{Ic.chevR}</span>
    </button>

    {/* Historial de fichajes */}
    <button onClick={()=>goto("historial-fichajes")} style={{width:"100%",padding:14,borderRadius:14,background:`linear-gradient(135deg,${C.cyan}08,${C.surface})`,border:`1px solid ${C.cyan}30`,color:C.text,fontSize:13,fontWeight:600,fontFamily:fB,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:34,height:34,borderRadius:10,background:`${C.cyan}22`,color:C.cyan,display:"flex",alignItems:"center",justifyContent:"center"}}>📊</div>
        <div style={{textAlign:"left"}}>
          <div style={{fontSize:13,fontWeight:700,color:C.text}}>Historial de fichajes</div>
          <div style={{fontSize:11,color:C.dim,marginTop:2}}>Tardanzas, presentismo y conversaciones</div>
        </div>
      </div>
      <span style={{color:C.dim}}>{Ic.chevR}</span>
    </button>

    {/* Grilla semanal */}
    {usuario.diagrama && (() => {
      const DIAS_G = ["lun","mar","mie","jue","vie","sab","dom"];
      const DIAS_LABEL = {lun:"Lunes",mar:"Martes",mie:"Miércoles",jue:"Jueves",vie:"Viernes",sab:"Sábado",dom:"Domingo"};
      const diaHoy = DIAS_KEY[new Date().getDay()];
      const diag = usuario.diagrama;
      let totalH = 0;
      DIAS_G.forEach(d=>{if(diag[d]){const [hI,mI]=diag[d].in.split(":").map(Number);const [hO,mO]=diag[d].out.split(":").map(Number);totalH+=(hO*60+mO-hI*60-mI)/60;}});
      return <>
        <div style={{marginBottom:12}}><h3 style={{margin:0,fontSize:16,fontWeight:700,color:C.text,fontFamily:fH}}>📅 Mi grilla semanal</h3></div>
        <div style={{background:C.surface,borderRadius:16,padding:14,border:`1px solid ${C.border}`,marginBottom:18}}>
          {DIAS_G.map((d,i)=>{
            const h=diag[d];
            const esHoy=d===diaHoy;
            return <div key={d} style={{display:"flex",alignItems:"center",padding:"10px 8px",borderRadius:10,background:esHoy?`${C.amber}12`:"transparent",border:esHoy?`1px solid ${C.amber}30`:"1px solid transparent",marginBottom:i<6?4:0}}>
              <div style={{width:70,fontSize:13,fontWeight:esHoy?700:500,color:esHoy?C.amber:C.text,fontFamily:fH}}>{DIAS_LABEL[d]}</div>
              {h?<div style={{flex:1,display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontFamily:fM,fontSize:14,fontWeight:600,color:esHoy?C.text:C.dim}}>{h.in}</span>
                <span style={{color:C.mute,fontSize:10}}>→</span>
                <span style={{fontFamily:fM,fontSize:14,fontWeight:600,color:esHoy?C.text:C.dim}}>{h.out}</span>
                <span style={{fontSize:10,color:C.mute,marginLeft:"auto"}}>{((parseInt(h.out.split(":")[0])*60+parseInt(h.out.split(":")[1])-parseInt(h.in.split(":")[0])*60-parseInt(h.in.split(":")[1]))/60).toFixed(1)}h</span>
              </div>:<div style={{flex:1,fontSize:13,color:C.green,fontWeight:600}}>Franco 🎉</div>}
              {esHoy&&<span style={{fontSize:10,color:C.amber,fontWeight:700,background:`${C.amber}22`,padding:"2px 8px",borderRadius:6,marginLeft:6}}>HOY</span>}
            </div>;
          })}
          <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",fontSize:12}}>
            <span style={{color:C.dim}}>{DIAS_G.filter(d=>diag[d]).length} días laborales</span>
            <span style={{color:C.text,fontWeight:700,fontFamily:fM}}>{totalH.toFixed(1)}h/semana</span>
          </div>
        </div>
      </>;
    })()}

    {/* Mi semana */}
    <div style={{marginBottom:12}}><h3 style={{margin:0,fontSize:16,fontWeight:700,color:C.text,fontFamily:fH}}>Mi semana</h3></div>
    <div style={{background:C.surface,borderRadius:16,padding:14,border:`1px solid ${C.border}`,marginBottom:18}}>
      {(ctx.fichadasSemana||[]).length===0?<div style={{padding:16,textAlign:"center",color:C.dim,fontSize:13}}>Sin fichadas</div>:(ctx.fichadasSemana||[]).map((d,i,a)=><div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:i<a.length-1?`1px solid ${C.border}`:"none"}}><div><div style={{fontSize:13,fontWeight:600,color:C.text}}>{new Date(d.fecha+"T12:00:00").toLocaleDateString("es-AR",{weekday:"short",day:"2-digit",month:"2-digit"})}</div>{d.ingreso&&<div style={{fontSize:11,color:C.dim,marginTop:2,fontFamily:fM}}>{d.ingreso.slice(0,5)} → {d.egreso?d.egreso.slice(0,5):"en curso"}</div>}</div><div style={{display:"flex",alignItems:"center",gap:6}}>{d.horas_trabajadas&&<span style={{fontSize:10,color:C.dim,fontFamily:fM}}>{Number(d.horas_trabajadas).toFixed(1)}h</span>}<span style={{fontFamily:fM,fontSize:14,fontWeight:700,color:d.ingreso?C.green:C.mute}}>{d.ingreso?"✓":"—"}</span></div></div>)}
    </div>

    {/* Mis solicitudes */}
    <div style={{marginBottom:12}}><h3 style={{margin:0,fontSize:16,fontWeight:700,color:C.text,fontFamily:fH}}>Mis solicitudes</h3></div>
    <div style={{display:"flex",flexDirection:"column",gap:10}}>{misSols.length===0?<div style={{background:C.surface,borderRadius:14,padding:30,textAlign:"center",border:`1px solid ${C.border}`,color:C.dim,fontSize:13}}>No tenés solicitudes</div>:misSols.map(s=><SolCard key={s.id} s={s}/>)}</div>
  </div>;
}

/* ═══ INBOX ═══ */
function InboxScreen({ctx,reload,usuario}){
  const [f,setF]=useState("pendiente");
  const [solicitudes,setSolicitudes]=useState(ctx.solicitudes||[]);
  const [cargando,setCargando]=useState(false);
  const [pagina,setPagina]=useState(0);
  const [hayMas,setHayMas]=useState(true);
  const LIMIT=30;

  const cargarSolicitudes=useCallback(async(pag=0)=>{
    setCargando(true);
    try{
      const offset=pag*LIMIT;
      const sols=await sb.get(`solicitudes?select=*&order=created_at.desc&limit=${LIMIT}&offset=${offset}`);
      if(pag===0){setSolicitudes(sols||[]);}else{setSolicitudes(prev=>[...prev,...(sols||[])]);}
      setHayMas((sols||[]).length===LIMIT);
      setPagina(pag);
    }catch(e){console.error("Error cargando solicitudes:",e);}
    setCargando(false);
  },[]);

  useEffect(()=>{cargarSolicitudes(0);},[cargarSolicitudes]);
  useEffect(()=>{if(ctx.solicitudes&&ctx.solicitudes.length>0&&pagina===0)setSolicitudes(ctx.solicitudes);},[ctx.solicitudes,pagina]);

  const filtered=solicitudes.filter(s=>{
    if(s.estado==="registrado")return false;
    if(f==="todas")return true;
    return s.estado===f;
  });
  const pend=solicitudes.filter(s=>s.estado==="pendiente").length;
  const sortedFiltered=[...filtered].sort((a,b)=>{
    const aIngreso=a.motivo?.includes("INGRESO")||a.motivo?.includes("ingreso")||a.motivo?.includes("🔓")?1:0;
    const bIngreso=b.motivo?.includes("INGRESO")||b.motivo?.includes("ingreso")||b.motivo?.includes("🔓")?1:0;
    if(aIngreso!==bIngreso)return bIngreso-aIngreso;
    return 0;
  });

  const [errorMsg, setErrorMsg] = useState(null);

  const resolver=async(id,estado)=>{setErrorMsg(null);try{const sol=solicitudes.find(s=>s.id===id);await sb.patch(`solicitudes?id=eq.${id}`,{estado,aprobador:usuario.apodo,resuelto_at:new Date().toISOString()});if(sol){
    const esPermisoIngreso=sol.motivo?.includes("🔓")||sol.motivo?.toLowerCase().includes("permiso de ingreso")||sol.motivo?.toLowerCase().includes("ingreso por bloqueo");
    const esCambioHorario=sol.tipo==="cambio_horario"||sol.motivo?.toLowerCase().includes("cambio de horario")||sol.motivo?.toLowerCase().includes("cambiar horario");
    if(esPermisoIngreso&&estado==="aprobado"){
      const today=new Date().toISOString().split("T")[0];
      const matchHora=sol.motivo?.match(/\((\d{1,2}:\d{2})/);
      const horaIngreso=matchHora?matchHora[1]:sol.desde&&sol.desde!=="—"?sol.desde:new Date(sol.created_at).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit",hour12:false});
      const ex=await sb.get(`fichadas?legajo=eq.${sol.legajo}&fecha=eq.${today}`);
      if(!ex||!ex.length){
        await sb.post("fichadas",{empleado_id:sol.empleado_id,legajo:sol.legajo,fecha:today,ingreso:horaIngreso,llegada_tarde:true,minutos_tarde:0,permiso_ingreso:true,empresa_id:usuario.empresa_id});
      }
      await sb.post("notificaciones",{destinatario_rol:String(sol.legajo),tipo:"aprobacion",asunto:"✅ Ingreso APROBADO — Ya quedaste fichado",detalle:`${usuario.apodo} aprobó tu ingreso. Se registró tu fichada de las ${horaIngreso}.`,urgencia:"alta",solicitud_id:id,empresa_id:usuario.empresa_id});
      sendPushToLegajo(String(sol.legajo),"✅ Ingreso aprobado",`Tu ingreso fue aprobado por ${usuario.apodo}. Fichada registrada a las ${horaIngreso}.`,{empresa_id:usuario.empresa_id}).catch(()=>{});
    } else if(esCambioHorario&&estado==="aprobado"&&sol.datos_horario){
      // Actualizar grilla del empleado con el nuevo horario aprobado
      try{
        const nuevoHorario=typeof sol.datos_horario==="string"?JSON.parse(sol.datos_horario):sol.datos_horario;
        if(nuevoHorario&&sol.empleado_id){
          const horas=Object.values(nuevoHorario).reduce((acc,v)=>{if(!v)return acc;const[hI,mI]=v.in.split(":").map(Number);const[hO,mO]=v.out.split(":").map(Number);return acc+(hO*60+mO-hI*60-mI)/60;},0);
          await sb.patch(`empleados?id=eq.${sol.empleado_id}`,{diagrama:nuevoHorario,horas_semanales:Math.round(horas)});
        }
      }catch(e){console.error("Error actualizando grilla:",e);}
      await sb.post("notificaciones",{destinatario_rol:String(sol.legajo),tipo:"aprobacion",asunto:"✅ Cambio de horario APROBADO",detalle:`${usuario.apodo} aprobó tu solicitud de cambio de horario. Tu grilla fue actualizada.`,urgencia:"alta",solicitud_id:id,empresa_id:usuario.empresa_id});
      sendPushToLegajo(String(sol.legajo),"✅ Horario actualizado",`Tu cambio de horario fue aprobado por ${usuario.apodo}.`,{empresa_id:usuario.empresa_id}).catch(()=>{});
    } else {
      await sb.post("notificaciones",{destinatario_rol:String(sol.legajo),tipo:"aprobacion",asunto:`Solicitud ${estado==="aprobado"?"APROBADA ✅":"RECHAZADA ❌"}`,detalle:`${sol.tipo}: "${sol.motivo}" por ${usuario.apodo}`,urgencia:"alta",solicitud_id:id,empresa_id:usuario.empresa_id});
      sendPushToLegajo(String(sol.legajo),estado==="aprobado"?"✅ Permiso aprobado":"❌ Permiso rechazado",estado==="aprobado"?`Tu ${sol.tipo} fue aprobado por ${usuario.apodo}`:`Tu ${sol.tipo} fue rechazado por ${usuario.apodo}`,{empresa_id:usuario.empresa_id}).catch(()=>{});
    }
  }await cargarSolicitudes(0);reload();}catch(e){console.error(e);setErrorMsg("Error al procesar la solicitud. Intentá de nuevo.");}};
  return<div style={{padding:"0 18px 110px",overflowY:"auto",flex:1}}>
    {errorMsg&&<div style={{padding:12,background:C.redS,color:C.red,borderRadius:10,fontSize:12,marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}><span>{errorMsg}</span><button onClick={()=>setErrorMsg(null)} style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontWeight:700,fontSize:14}}>✕</button></div>}
    <div style={{display:"flex",gap:6,marginBottom:14,overflowX:"auto",alignItems:"center"}}>
      <Chip active={f==="pendiente"} onClick={()=>setF("pendiente")} color={C.amber}>Pendientes · {pend}</Chip>
      <Chip active={f==="aprobado"} onClick={()=>setF("aprobado")} color={C.green}>Aprobados</Chip>
      <Chip active={f==="rechazado"} onClick={()=>setF("rechazado")} color={C.red}>Rechazados</Chip>
      <Chip active={f==="todas"} onClick={()=>setF("todas")}>Todas</Chip>
      <button onClick={()=>cargarSolicitudes(0)} style={{width:30,height:30,borderRadius:8,background:C.surface,border:`1px solid ${C.border}`,color:C.dim,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>{Ic.refresh}</button>
    </div>
    {cargando&&pagina===0?<div style={{textAlign:"center",padding:30,color:C.dim,fontSize:13}}>Cargando solicitudes...</div>:
    <div style={{display:"flex",flexDirection:"column",gap:12}}>{sortedFiltered.length===0?<div style={{background:C.surface,borderRadius:14,padding:40,textAlign:"center",border:`1px solid ${C.border}`}}><div style={{color:C.green,display:"inline-flex",marginBottom:12}}>{Ic.check}</div><div style={{fontSize:14,fontWeight:700,color:C.text}}>Todo al día</div></div>:sortedFiltered.map(s=><SolCard key={s.id} s={s} showActions onResolve={resolver}/>)}
    {hayMas&&!cargando&&<button onClick={()=>cargarSolicitudes(pagina+1)} style={{width:"100%",padding:14,borderRadius:14,background:C.surface,border:`1px solid ${C.border}`,color:C.amber,fontSize:13,fontWeight:700,fontFamily:fB,cursor:"pointer",marginTop:4}}>Cargar más solicitudes</button>}
    {cargando&&pagina>0&&<div style={{textAlign:"center",padding:14,color:C.dim,fontSize:12}}>Cargando...</div>}
    </div>}
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

/* ═══ CONFIGURACIÓN ═══ */
function ConfigScreen({goto,ctx,reload,usuario,empresa,onUpdateEmpresa}){
  const [tab,setTab]=useState("reportes");
  const tabs=[["reportes","📊 Asistencia"],["horarios","📅 Horarios"],["proyectos","📋 Proyectos"],["ubicaciones","📍 Ubicaciones"],["calendario","🗓️ Calendario"],["reglas","⚙️ Reglas Bot"],["admin","🏢 Empresa"]];
  return<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    <div style={{padding:"0 18px 10px",display:"flex",gap:6,overflowX:"auto",flexShrink:0}}>
      {tabs.map(([id,lbl])=><button key={id} onClick={()=>setTab(id)} style={{padding:"8px 14px",borderRadius:20,border:"none",cursor:"pointer",background:tab===id?`${C.amber}22`:C.surface,color:tab===id?C.amber:C.dim,fontSize:12,fontWeight:700,fontFamily:fB,whiteSpace:"nowrap"}}>{lbl}</button>)}
    </div>
    <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
      {tab==="reportes"&&<ReportesScreen/>}
      {tab==="horarios"&&<GrillaHorarioScreen empresaId={usuario?.empresa_id || empresa?.id}/>}
      {tab==="proyectos"&&<ProyectosScreen empresaId={usuario?.empresa_id || empresa?.id}/>}
      {tab==="ubicaciones"&&<GeolocalizacionScreen empresaId={usuario?.empresa_id || empresa?.id}/>}
      {tab==="calendario"&&<CalendarioScreen empresaId={usuario?.empresa_id || empresa?.id}/>}
      {tab==="reglas"&&<ReglasScreen ctx={ctx} reload={reload} usuario={usuario}/>}
      {tab==="admin"&&<AdminEmpresaScreen empresa={empresa} empresaId={usuario?.empresa_id} onUpdate={onUpdateEmpresa}/>}
    </div>
  </div>;
}

/* ═══ NAV ═══ */
function Nav({active,onChange,role,pend}){
  const items=role==="gerencial"||role==="administrativo"?[["home","Inicio","home"],["solicitudes","Inbox","inbox",pend],["equipo","Equipo","users"],["config","Gestión","settings"]]:[["home","Inicio","home"],["actividad","Actividad","play"],["chat","Chat","chat"],["mis-sols","Solicitudes","clock"]];
  return<nav className="fixed bottom-0 left-0 right-0 z-50 flex justify-around items-center h-16 border-t border-[var(--color-border)] bg-white/95 backdrop-blur-lg pb-[env(safe-area-inset-bottom)] max-w-lg mx-auto">
    {items.map(([id,lbl,iconName,badge])=>{const a=active===id;return<button key={id} onClick={()=>onChange(id)} className={`flex-1 flex flex-col items-center gap-1 py-1.5 transition-colors ${a?"text-[var(--color-empresa-primary)]":"text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"}`}>
      <div className={`relative flex items-center ${a?"bg-[var(--color-empresa-primary)]/10 rounded-xl px-3.5 py-1":""}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={a?2.2:1.8} strokeLinecap="round" strokeLinejoin="round">
          {iconName==="home"&&<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10"/>}
          {iconName==="inbox"&&<><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></>}
          {iconName==="users"&&<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></>}
          {iconName==="settings"&&<><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 10v6M4.22 4.22l4.24 4.24m7.08 7.08l4.24 4.24M1 12h6m10 0h6M4.22 19.78l4.24-4.24m7.08-7.08l4.24-4.24"/></>}
          {iconName==="play"&&<><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></>}
          {iconName==="chat"&&<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>}
          {iconName==="clock"&&<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>}
        </svg>
        {badge>0&&<span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center border-2 border-white">{badge}</span>}
      </div>
      <span className="text-[10px] font-semibold">{lbl}</span>
    </button>})}
  </nav>;
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
  const [historialLegajo,setHistorialLegajo]=useState(null);
  const [divisionesEmpresa, setDivisionesEmpresaState] = useState([]);
  const [etapasEmpresa, setEtapasEmpresa] = useState([]);
  const [empresa,setEmpresa]=useState({nombre:"Gypi",nombre_corto:"Gypi",color_primario:"#F97316",color_secundario:"#7C3AED",color_fondo:"#F7F7F5",color_texto:"#1A1A1A",prompt_ia_obra:"",prompt_ia_chat:""});
  const [,forceRender]=useState(0);
  // Cargar empresa: requiere token, así que se hace después del login
  // Resolver empresa por slug (pre-login) o por token (post-login)
  const params = useParams();
  const router = useRouter();
  const slug = params?.slug;
  const [slugInvalido, setSlugInvalido] = useState(false);

  const cargarEmpresa = useCallback(async () => {
    const token = getToken();
    try {
      // Pre-login: resolver por slug (público, sin token)
      if (!token && slug) {
        const r = await fetch(`/api/empresa?slug=${encodeURIComponent(slug)}`);
        const d = await r.json();
        if (r.status === 404 || d?.error) { setSlugInvalido(true); return; }
        setEmpresa(d);
        setColoresEmpresa(d);
        forceRender(n => n + 1);
        return;
      }
      // Post-login: traer empresa completa con token
      if (token) {
        const r = await fetch("/api/empresa", { headers: { Authorization: `Bearer ${token}` } });
        const d = await r.json();
        if (d && !d.error) {
          setEmpresa(d);
          setColoresEmpresa(d);
          forceRender(n => n + 1);
          loadConfigEmpresa(d?.id);
        }
      }
    } catch {}
  }, [slug]);

  // Resolver branding al montar (antes del login)
  useEffect(() => { cargarEmpresa(); }, [cargarEmpresa]);

  const actividad=useActividad(usuario?{id:usuario.id,legajo:usuario.legajo,division:usuario.division,empresa_id:usuario?.empresa_id||empresa?.id}:null);

  useEffect(()=>{try{const s=localStorage.getItem("gi-session");if(s){const parsed=JSON.parse(s);const guardado=localStorage.getItem("gi-session-time");const ahora=Date.now();const SIETE_DIAS=7*24*60*60*1000;if(guardado&&(ahora-Number(guardado))>SIETE_DIAS){localStorage.removeItem("gi-session");localStorage.removeItem("gi-session-time");clearToken();}else{setUsuario(parsed);if(parsed.empresa_id)setEmpresaId(parsed.empresa_id);}}}catch{}setInit(true);},[]);
  const login=u=>{const safe={...u};delete safe.password;setUsuario(safe);if(safe.empresa_id)setEmpresaId(safe.empresa_id);try{localStorage.setItem("gi-session",JSON.stringify(safe));localStorage.setItem("gi-session-time",String(Date.now()));}catch{} if(safe.empresa_id)loadConfigEmpresa(safe.empresa_id);};
  const logout=()=>{setUsuario(null);setScreen("home");clearToken();try{localStorage.removeItem("gi-session");localStorage.removeItem("gi-session-time");}catch{} router.push("/");};

  // Auto-logout si el servidor responde 401 (sesión expirada)
  useEffect(()=>{onUnauthorized(()=>{setUsuario(null);setScreen("home");clearToken();try{localStorage.removeItem("gi-session");localStorage.removeItem("gi-session-time");}catch{}});},[]);

  const loadConfigEmpresa = async (eid) => {
    if (!eid) return;
    try {
      const res = await fetch("/api/config-empresa?empresa_id=" + eid);
      const data = await res.json();
      if (data.divisiones && data.divisiones.length > 0) {
        setDivisionesEmpresaState(data.divisiones);
        setDivisionesEmpresa(data.divisiones);
      }
      if (data.etapas) setEtapasEmpresa(data.etapas);
    } catch (e) { console.error("Error cargando config empresa:", e); }
  };

const loadData=useCallback(async()=>{
    if(!usuario)return;
    try{
      // Usar fecha local (Argentina UTC-3) en lugar de UTC
      const now=new Date();
      const today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
      const mon=new Date(now);mon.setDate(mon.getDate()-((mon.getDay()+6)%7));
      const monStr=`${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,"0")}-${String(mon.getDate()).padStart(2,"0")}`;
      const isGer=usuario.rol==="gerencial"||usuario.rol==="administrativo";
      const [empleados,fichadasHoy,miFichada,fichadasSemana,solicitudes,misSolicitudes,reglas,notificaciones]=await Promise.all([
        sb.get("empleados?select=*&activo=eq.true&order=legajo.asc"),
        sb.get(`fichadas?select=legajo,ingreso,egreso,horas_trabajadas,llegada_tarde,minutos_tarde,empleados(nombre,division)&fecha=eq.${today}`),
        sb.get(`fichadas?legajo=eq.${usuario.legajo}&fecha=eq.${today}`),
        sb.get(`fichadas?legajo=eq.${usuario.legajo}&fecha=gte.${monStr}&order=fecha.asc`),
        sb.get("solicitudes?select=*&order=created_at.desc&limit=50"),
        sb.get(`solicitudes?legajo=eq.${usuario.legajo}&order=created_at.desc&limit=20`),
        sb.get("reglas_bot?activa=eq.true&order=id.asc"),
        sb.get(isGer?"notificaciones?destinatario_rol=eq.gerencial&order=created_at.desc&limit=10":`notificaciones?destinatario_rol=eq.${usuario.legajo}&order=created_at.desc&limit=10`),
      ]);
      const fHoy=fichadasHoy.map(f=>({...f,nombre:f.empleados?.nombre||"",division:f.empleados?.division||""}));
      setCtx({empleados,fichadasHoy:fHoy,fichadaHoy:miFichada[0]||null,fichadasSemana,solicitudes,misSolicitudes,reglas:reglas.map(r=>r.regla),reglasRaw:reglas,notificaciones});

      setReady(true);
    }catch(e){console.error(e);setReady(true);}
  },[usuario]);

  useEffect(()=>{if(usuario){setReady(false);loadData();cargarEmpresa();}},[usuario,loadData,cargarEmpresa]);
  useEffect(()=>{if(!usuario)return;const t=setInterval(loadData,60000);return()=>clearInterval(t);},[usuario,loadData]);
  useEffect(()=>{const t=setInterval(()=>setTime(new Date()),30000);return()=>clearInterval(t);},[]);

  const isGer=usuario&&(usuario.rol==="gerencial"||usuario.rol==="administrativo");
  const pend=(ctx.solicitudes||[]).filter(s=>s.estado==="pendiente").length;
  const isChat=screen==="chat";
  const showBack=screen==="reglas"||screen==="historial-fichajes"||screen==="ger-actividad";

// Slug no existe
  if (slugInvalido) {
    return (
      <div className="max-w-lg mx-auto min-h-[100dvh] flex flex-col items-center justify-center p-7 text-center">
        <div style={{ fontSize: 52, marginBottom: 16 }}>🔍</div>
        <h2 style={{ fontFamily: fH, fontSize: 22, fontWeight: 700, margin: 0 }}>Empresa no encontrada</h2>
        <p style={{ color: C.dim, fontSize: 14, marginTop: 8 }}>El enlace <code style={{ color: C.amber }}>gypi.app/{slug}</code> no corresponde a ninguna empresa registrada.</p>
        <button onClick={() => router.push("/")} style={{ marginTop: 24, padding: "12px 24px", borderRadius: 12, background: C.amber, color: "#000", border: "none", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Volver al inicio</button>
      </div>
    );
  }
  if(!init)return null;

  return<div className="max-w-lg mx-auto h-[100dvh] bg-[var(--color-bg)] relative overflow-hidden flex flex-col">
    {/* Status bar */}
    

    {!usuario?(
      <div style={{flex:1,overflow:"hidden"}}><LoginScreenNew onLogin={login} empresa={empresa}/></div>
    ):usuario.debe_cambiar_password?(
      <div style={{flex:1,overflow:"hidden"}}><CambiarPasswordScreenNew usuario={usuario} onDone={(u)=>{login(u);}}/></div>
):isGer&&empresa&&empresa.onboarding_completado===false?(
      <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
        <OnboardingWizard
          empresa={empresa}
          usuario={usuario}
          onComplete={(empActualizada)=>{
            setEmpresa(empActualizada);
            setColoresEmpresa(empActualizada);
            forceRender(n=>n+1);
            loadConfigEmpresa(usuario?.empresa_id||empresa?.id);
            loadData();
          }}
        />
      </div>
    ):!ready?(
      <div className="flex-1 flex items-center justify-center flex-col gap-3.5">
        <div style={{color:C.amber,animation:"spin 1s linear infinite",display:"flex"}}>{Ic.refresh}</div>
        <div style={{fontSize:13,color:C.dim}}>Cargando datos...</div>
      </div>
    ):<>
      {/* FIX #2: PushManager ARRIBA, no fijo abajo */}
      <PushManager legajo={String(usuario.legajo)} empresaId={usuario.empresa_id} onNotification={()=>loadData()}/>

      {/* Header */}
      {isChat?<div style={{padding:"8px 16px 14px",display:"flex",alignItems:"center",gap:12,borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
        <button onClick={()=>setScreen("home")} style={{background:"none",border:"none",color:C.text,cursor:"pointer",padding:6,display:"flex"}}>{Ic.chevL}</button>
        <div style={{width:36,height:36,borderRadius:12,background:`linear-gradient(135deg,${C.amber},${C.violet})`,display:"flex",alignItems:"center",justifyContent:"center",color:"#000"}}>{Ic.bot}</div>
        <div style={{flex:1}}><div style={{fontSize:14,fontWeight:700,color:C.text,fontFamily:fH}}>{"Asistente "+(empresa?.nombre_corto||"Gypi")}</div><div style={{display:"flex",alignItems:"center",gap:5,marginTop:1}}><span style={{width:6,height:6,borderRadius:3,background:C.green}}/><span style={{fontSize:11,color:C.dim}}>IA activa</span></div></div>
        <span style={{color:C.amber,opacity:.6}}>{Ic.sparkle}</span>
      </div>
      :screen==="home"&&isGer?null
      :screen==="home"&&!isGer?null
      :<div style={{padding:"8px 22px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {showBack&&<button onClick={()=>setScreen("home")} style={{background:"none",border:"none",color:C.text,cursor:"pointer",padding:4,display:"flex"}}>{Ic.chevL}</button>}
          <div>
            <div style={{fontSize:11,color:C.dim,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:2}}>{isGer?showBack?"Configuración":screen==="ger-actividad"?"Producción en vivo":screen==="config"?"Configuración":screen==="equipo"?"Gestión de personal":screen==="historial-fichajes"?"Control de asistencia":(empresa?.nombre_corto||"Gypi"):screen==="actividad"?"Registro de actividades":screen==="historial-fichajes"?"Mi asistencia":(empresa?.nombre_corto||"Gypi")}</div>
            <h1 style={{margin:0,fontSize:22,fontWeight:700,color:C.text,fontFamily:fH,letterSpacing:"-0.02em"}}>{screen==="solicitudes"?"Inbox":screen==="equipo"?"Personal":screen==="mis-sols"?"Solicitudes":screen==="actividad"?"Mi Jornada":screen==="ger-actividad"?"Taller":screen==="config"?"Gestión":screen==="historial-fichajes"?"Fichajes":(empresa?.nombre_corto||"Gypi")}</h1>
          </div>
        </div>
        <div style={{display:"flex",gap:6}}>
          <button onClick={()=>{loadData();setRefreshCounter(c=>c+1);}} style={{width:36,height:36,borderRadius:10,background:C.surface,color:C.dim,border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>{Ic.refresh}</button>
          <button onClick={logout} style={{width:36,height:36,borderRadius:10,background:C.surface,color:C.dim,border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>{Ic.logout}</button>
        </div>
      </div>}

      {/* Content */}
      <div className="se" key={`${usuario.legajo}-${screen}-${refreshCounter}`} style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column",paddingBottom:isChat?0:88}}>
        {!isGer&&screen==="home"&&<HomeEmp goto={setScreen} usuario={usuario} ctx={ctx} logout={logout} empresa={empresa}/>}
        {!isGer&&screen==="historial-fichajes"&&<HistorialFichajesScreen usuario={usuario} ctx={ctx} onBack={()=>setScreen("home")}/>}
        {!isGer&&screen==="actividad"&&<ActividadScreen {...actividad} usuario={usuario} empresa={empresa} fichadaHoy={ctx.fichadaHoy}/>}
        {!isGer&&screen==="chat"&&<ChatScreen usuario={usuario} ctx={ctx} reload={loadData} empresa={empresa}/>}
        {!isGer&&screen==="mis-sols"&&<div style={{padding:"0 18px 20px",overflowY:"auto",flex:1}}><div style={{display:"flex",flexDirection:"column",gap:10}}>{(ctx.misSolicitudes||[]).map(s=><SolCard key={s.id} s={s}/>)}</div></div>}
        {isGer&&screen==="home"&&<DashboardGerencia goto={(s,leg)=>{if(leg)setHistorialLegajo(leg);setScreen(s);}} ctx={ctx} reload={loadData} logout={logout} empresa={empresa}/>}
        {isGer&&screen==="historial-fichajes"&&<HistorialFichajesScreen usuario={usuario} ctx={ctx} legajoVer={historialLegajo} onBack={()=>setScreen("home")}/>}
        {isGer&&screen==="solicitudes"&&<InboxScreen ctx={ctx} reload={loadData} usuario={usuario}/>}
        {isGer&&screen==="equipo"&&<GestionPersonalScreen ctx={ctx} reload={loadData} empresaId={usuario?.empresa_id || empresa?.id}/>}
        {isGer&&screen==="ger-actividad"&&<GerenciaActividadScreen empresaId={empresa?.id}/>}
        {isGer&&screen==="config"&&<ConfigScreen goto={(s,leg)=>{if(leg)setHistorialLegajo(leg);setScreen(s);}} ctx={ctx} reload={loadData} usuario={usuario} empresa={empresa} onUpdateEmpresa={(e)=>{const updated={...empresa, ...e}; setEmpresa(updated); setColoresEmpresa(updated.color_primario, updated.color_secundario); forceRender(n=>n+1); loadConfigEmpresa(usuario?.empresa_id);}}/>}
        {isGer&&screen==="chat"&&<ChatScreen usuario={usuario} ctx={ctx} reload={loadData} empresa={empresa}/>}
      </div>

      {!isChat&&<Nav active={screen} onChange={setScreen} role={usuario.rol} pend={pend}/>}
    </>}
  </div>;
}