"use client";
// Extraído de [slug]/page.js líneas 230-406
// ENTREGA 2D: ChatScreen como componente independiente.
// Depende de fichar.js helpers (ficharServer, obtenerGeo)

import { useState, useEffect, useRef } from "react";
import { C, fB, fM, fmtTime, fmtDate, DIAS_KEY } from "../../lib/theme";
import { sb } from "../../lib/supabase";
import { callClaude, parseAction } from "../../lib/claude";
import { sendPushToLegajo } from "../../lib/push";
import { ficharServer, obtenerGeo } from "../../lib/fichar";
import { Ic } from "../Icons";
import FichadaCard from "../cards/FichadaCard";
import SolSentCard from "../cards/SolSentCard";
import { hoyArg } from "../../lib/dates";

// solicitudes.fecha es DATE en la DB — nunca debe recibir literales como "hoy"
// o un string vacío. Si la IA no extrajo una fecha válida, usamos hoy.
const fechaValida = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f || "") ? f : hoyArg();

export default function ChatScreen({ usuario, ctx, reload, empresa }) {
  const dH = DIAS_KEY[new Date().getDay()];
  const diagH = usuario.diagrama?.[dH];
  const [msgs, setMsgs] = useState([{
    from: "bot",
    text: `¡Hola ${usuario.apodo}! 🤖\n\nHoy es ${fmtDate(new Date())}, son las ${fmtTime(new Date())}.\n${ctx.fichadaHoy?.ingreso ? `Tu ingreso: ${ctx.fichadaHoy.ingreso.slice(0, 5)}.` : diagH ? `Jornada hoy: ${diagH.in} a ${diagH.out}.` : "Hoy es franco 🎉"}\n\nContame qué necesitás.`,
    quickReplies: ["Ya llegué", "Necesito un permiso", "Me voy"],
    time: new Date(),
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [geoError, setGeoError] = useState(null);
  const ref = useRef(null);

  useEffect(() => { ref.current && (ref.current.scrollTop = ref.current.scrollHeight); }, [msgs, loading]);

  const execAction = async (action) => {
    let card = null;
    const hora = fmtTime(new Date());
    try {
      switch (action.type) {
        case "FICHAR_INGRESO": {
          const geo = await obtenerGeo(usuario);
          const res = await ficharServer("ingreso", { geo_lat: geo.lat, geo_lng: geo.lng, geo_distancia: geo.distancia });
          card = { type: "fichada", sub: "ingreso", hora: res.hora || hora, geoMsg: geo.msg, tardanza: res.tardanza };
          break;
        }
        case "FICHAR_EGRESO": {
          const geo = await obtenerGeo(usuario);
          const res = await ficharServer("egreso", { geo_lat: geo.lat, geo_lng: geo.lng, geo_distancia: geo.distancia });
          card = { type: "fichada", sub: "egreso", hora: res.hora || hora, geoMsg: geo.msg, horas_extra: res.horas_extra, solicitar_hora_extra: res.solicitar_hora_extra, datos_jornada: res.datos_jornada };
          break;
        }
        case "FICHAR_EGRESO_FORZAR": {
          const geo = await obtenerGeo(usuario);
          const res = await ficharServer("egreso", { forzar_cierre_tarea: true, geo_lat: geo.lat, geo_lng: geo.lng, geo_distancia: geo.distancia });
          card = { type: "fichada", sub: "egreso", hora: res.hora || hora, geoMsg: geo.msg, horas_extra: res.horas_extra, solicitar_hora_extra: res.solicitar_hora_extra, datos_jornada: res.datos_jornada };
          break;
        }
        case "SOLICITAR_PERMISO":
          await sb.post("solicitudes", { empleado_id: usuario.id, legajo: usuario.legajo, nombre_empleado: usuario.nombre, tipo: "permiso", motivo: action.motivo || "", fecha: fechaValida(action.fecha), desde: action.desde || "—", hasta: action.hasta || "—", estado: "pendiente", empresa_id: usuario.empresa_id });
          await sb.post("notificaciones", { destinatario_rol: "gerencial", tipo: "solicitud", asunto: `${usuario.apodo} pidió permiso`, detalle: action.motivo, urgencia: "normal", empresa_id: usuario.empresa_id });
          sendPushToLegajo("1", "📋 Nuevo permiso", `${usuario.apodo} solicitó permiso: ${action.motivo || "sin detalle"}`, { empresa_id: usuario.empresa_id }).catch(() => {});
          card = { type: "solicitud", motivo: action.motivo, fecha: action.fecha };
          break;
        case "AVISAR_TARDANZA":
          await sb.post("solicitudes", { empleado_id: usuario.id, legajo: usuario.legajo, nombre_empleado: usuario.nombre, tipo: "tardanza", motivo: `Tardanza: ${action.motivo || ""}`, fecha: fechaValida(), estado: "registrado", empresa_id: usuario.empresa_id });
          await sb.post("notificaciones", { destinatario_rol: "gerencial", tipo: "alerta", asunto: `Tardanza de ${usuario.apodo}`, detalle: action.motivo, urgencia: "normal", empresa_id: usuario.empresa_id });
          sendPushToLegajo("1", "⏰ Tardanza", `${usuario.apodo}: ${action.motivo || "sin detalle"}`, { empresa_id: usuario.empresa_id }).catch(() => {});
          break;
        case "AVISAR_AUSENCIA":
          await sb.post("solicitudes", { empleado_id: usuario.id, legajo: usuario.legajo, nombre_empleado: usuario.nombre, tipo: "ausencia", motivo: action.motivo || "Ausencia", fecha: fechaValida(action.fecha), estado: "pendiente", empresa_id: usuario.empresa_id });
          await sb.post("notificaciones", { destinatario_rol: "gerencial", tipo: "alerta", asunto: `Ausencia de ${usuario.apodo}`, detalle: action.motivo, urgencia: "alta", empresa_id: usuario.empresa_id });
          sendPushToLegajo("1", "🚨 Ausencia", `${usuario.apodo}: ${action.motivo || "Ausencia"}`, { empresa_id: usuario.empresa_id }).catch(() => {});
          break;
        case "NOTIFICAR_GERENCIA":
          await sb.post("notificaciones", { destinatario_rol: "gerencial", tipo: "info", asunto: action.asunto, detalle: action.detalle, urgencia: action.urgencia || "normal", empresa_id: usuario.empresa_id });
          break;
      }
      reload && reload();
    } catch (e) {
      if (e.tipo === "bloqueado_tardanza" || e.tipo === "bloqueado_3ra_tarde") return { type: "fichada_bloqueada", msg: "⛔ " + e.message };
      if (e.tipo === "tarea_activa") return { type: "tarea_activa", msg: "⚠️ " + e.message, tareaId: e.tarea_id };
      if (e.tipo === "geo_error") { setGeoError(e.message); return { type: "fichada_bloqueada", msg: e.message }; }
      if (e.tipo) return { type: "fichada_bloqueada", msg: e.message };
      console.error(e);
    }
    return card;
  };

  const handleSend = async (txt = input) => {
    const t = txt.trim();
    if (!t || loading) return;
    const um = { from: "user", text: t, time: new Date() };
    const nm = [...msgs, um];
    setMsgs(nm); setInput(""); setLoading(true);
    sb.post("mensajes_chat", { legajo: usuario.legajo, rol: "user", mensaje: t, empresa_id: usuario.empresa_id }).catch(() => {});

    // Quick-action shortcuts
    if (t === "✅ Sí, solicitar permiso") {
      try {
        const hoy = hoyArg();
        const hora2 = fmtTime(new Date());
        await sb.post("solicitudes", { empleado_id: usuario.id, legajo: usuario.legajo, nombre_empleado: usuario.nombre, tipo: "permiso", motivo: `🔓 Permiso de INGRESO por bloqueo (${hora2})`, fecha: hoy, desde: hora2, hasta: "—", estado: "pendiente", empresa_id: usuario.empresa_id });
        await sb.post("notificaciones", { destinatario_rol: "gerencial", tipo: "solicitud", asunto: `🔓 ${usuario.apodo} solicita permiso de INGRESO`, detalle: `Ingreso bloqueado a las ${hora2}. Requiere autorización para fichar.`, urgencia: "alta", empresa_id: usuario.empresa_id });
        sendPushToLegajo("1", "🔓 Permiso de ingreso", `${usuario.apodo} solicita autorización para ingresar (${hora2})`, { empresa_id: usuario.empresa_id }).catch(() => {});
        setMsgs(m => [...m, { from: "bot", text: "✅ Listo, se envió la solicitud de permiso de ingreso a gerencia. Te voy a avisar cuando la resuelvan.", time: new Date(), card: { type: "solicitud", motivo: "🔓 Permiso de INGRESO por bloqueo", fecha: hoy } }]);
        if (reload) reload();
      } catch (e) { console.error(e); setMsgs(m => [...m, { from: "bot", text: "Error al enviar la solicitud. Probá de nuevo.", time: new Date() }]); }
      setLoading(false); return;
    }
    if (t === "❌ No, cancelar") { setMsgs(m => [...m, { from: "bot", text: "Entendido. Si necesitás algo más, avisame.", time: new Date() }]); setLoading(false); return; }
    if (t === "✅ Sí, fichar salida") {
      try {
        const cr = await execAction({ type: "FICHAR_EGRESO_FORZAR" });
        if (cr?.type === "fichada_bloqueada") {
          setMsgs(m => [...m, { from: "bot", text: cr.msg, time: new Date() }]);
        } else if (cr?.solicitar_hora_extra) {
          const dj = cr.datos_jornada;
          setMsgs(m => [...m, { from: "bot", text: `✅ Salida registrada.\n\nLlegaste tarde (${dj.ingreso_real} vs ${dj.ingreso_grilla}) pero trabajaste ${Math.round(dj.excedente_min)}min más de tu jornada habitual.\n\n¿Querés solicitar hora extra a gerencia?`, card: cr, time: new Date(), quickReplies: ["✅ Sí, solicitar hora extra", "❌ No, cancelar"] }]);
        } else {
          let msg = "✅ Actividad finalizada y salida registrada.";
          if (cr?.horas_extra > 0) msg += `\n🕐 Horas extra: ${cr.horas_extra}h`;
          setMsgs(m => [...m, { from: "bot", text: msg, card: cr, time: new Date() }]);
        }
        if (reload) reload();
      } catch (e) { setMsgs(m => [...m, { from: "bot", text: "Error al fichar salida.", time: new Date() }]); }
      setLoading(false); return;
    }
    if (t === "✅ Sí, solicitar hora extra") {
      try {
        const hoy = hoyArg();
        await sb.post("solicitudes", { empleado_id: usuario.id, legajo: usuario.legajo, nombre_empleado: usuario.nombre, tipo: "hora_extra", motivo: "Solicitud de hora extra — llegó tarde pero trabajó más de la jornada habitual", fecha: hoy, estado: "pendiente", empresa_id: usuario.empresa_id });
        await sb.post("notificaciones", { destinatario_rol: "gerencial", tipo: "solicitud", asunto: `${usuario.apodo} solicita hora extra`, detalle: "Llegó tarde pero trabajó más tiempo que su jornada habitual.", urgencia: "normal", empresa_id: usuario.empresa_id });
        sendPushToLegajo("1", "🕐 Hora extra", `${usuario.apodo} solicita aprobación de hora extra`, { empresa_id: usuario.empresa_id }).catch(() => {});
        setMsgs(m => [...m, { from: "bot", text: "✅ Solicitud de hora extra enviada a gerencia. Te aviso cuando la resuelvan.", time: new Date(), card: { type: "solicitud", motivo: "Hora extra", fecha: hoy } }]);
        if (reload) reload();
      } catch (e) { setMsgs(m => [...m, { from: "bot", text: "Error al enviar la solicitud.", time: new Date() }]); }
      setLoading(false); return;
    }

    // "Ya llegué" direct action
    if (t === "Ya llegué") {
      try {
        const cr = await execAction({ type: "FICHAR_INGRESO" });
        if (cr?.type === "fichada_bloqueada") { setMsgs(m => [...m, { from: "bot", text: cr.msg + "\n\n¿Querés que solicite el permiso de ingreso a gerencia?", time: new Date(), quickReplies: ["✅ Sí, solicitar permiso", "❌ No, cancelar"] }]); }
        else if (cr) {
          let tardMsg = "✅ ¡Fichado! Buen día, " + usuario.apodo + " 👋";
          const trd = cr.tardanza;
          if (trd?.estado === "tarde") {
            tardMsg = `⚠️ Fichado, pero llegás ${trd.minutos} min tarde.\nEs tu llegada tarde #${trd.llegadasTarde} del mes.`;
            if (trd.llegadasTarde === 2) tardMsg += "\n⚡ Recordá: a la 3ra llegada tarde perdés el premio por presentismo.";
            if (trd.llegadasTarde >= 3) tardMsg += "\n🚨 ¡PERDISTE EL PREMIO POR PRESENTISMO este mes!";
          }
          setMsgs(m => [...m, { from: "bot", text: tardMsg, card: cr, time: new Date() }]);
        } else { setMsgs(m => [...m, { from: "bot", text: "✅ Ingreso registrado. ¡Buen día!", time: new Date() }]); }
        if (reload) reload();
      } catch (e) { setMsgs(m => [...m, { from: "bot", text: "Error al fichar ingreso.", time: new Date() }]); }
      setLoading(false); return;
    }

    // "Me voy" direct action
    if (t === "Me voy") {
      try {
        const cr = await execAction({ type: "FICHAR_EGRESO" });
        if (cr?.type === "tarea_activa") { setMsgs(m => [...m, { from: "bot", text: cr.msg, time: new Date(), quickReplies: ["✅ Sí, fichar salida", "❌ No, cancelar"] }]); }
        else if (cr?.type === "fichada_bloqueada") { setMsgs(m => [...m, { from: "bot", text: cr.msg, time: new Date() }]); }
        else if (cr?.solicitar_hora_extra) {
          const dj = cr.datos_jornada;
          setMsgs(m => [...m, { from: "bot", text: `✅ Salida registrada. ¡Hasta mañana, ${usuario.apodo}! 👋\n\nLlegaste tarde (${dj.ingreso_real} vs ${dj.ingreso_grilla}) pero trabajaste ${Math.round(dj.excedente_min)}min más de tu jornada.\n\n¿Querés solicitar hora extra a gerencia?`, card: cr, time: new Date(), quickReplies: ["✅ Sí, solicitar hora extra", "❌ No, cancelar"] }]);
        } else {
          let msg = "✅ Salida registrada. ¡Hasta mañana, " + usuario.apodo + "! 👋";
          if (cr?.horas_extra > 0) msg += `\n🕐 Horas extra registradas: ${cr.horas_extra}h`;
          setMsgs(m => [...m, { from: "bot", text: msg, card: cr, time: new Date() }]);
        }
        if (reload) reload();
      } catch (e) { setMsgs(m => [...m, { from: "bot", text: "Error al fichar salida.", time: new Date() }]); }
      setLoading(false); return;
    }

    // AI chat
    try {
      const hist = nm.slice(-20).map(m => ({ from: m.from, text: m.text }));
      let raw = await callClaude(hist, ctx, usuario, empresa);
      let { clean, action } = parseAction(raw);

      // Si Claude pide consultar datos, ejecutar query y re-llamar con contexto
      if (action?.type === "CONSULTAR_DATOS" && action.query_type) {
        try {
          const qRes = await fetch("/api/chat/query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query_type: action.query_type, params: action.params || {} }),
          });
          const qData = await qRes.json();
          const resultado = qData.resultado || "Sin resultados.";
          const histConDatos = [
            ...hist,
            { from: "bot", text: clean || "(consultando datos...)" },
            { from: "user", text: `[DATOS DEL SISTEMA — resultado de ${action.query_type}]:\n${resultado}\n\nResumí esta info de forma clara y concisa para el empleado.` },
          ];
          const raw2 = await callClaude(histConDatos, ctx, usuario, empresa);
          const parsed2 = parseAction(raw2);
          clean = parsed2.clean;
          action = parsed2.action;
        } catch {
          clean = clean || "Tuve un problema consultando los datos. Probá de nuevo.";
          action = null;
        }
      }

      let card = action && action.type !== "CONSULTAR_DATOS" ? await execAction(action) : null;
      if (card?.type === "fichada_bloqueada") { setMsgs(m => [...m, { from: "bot", text: card.msg + "\n\n¿Querés que solicite el permiso de ingreso a gerencia?", time: new Date(), quickReplies: ["✅ Sí, solicitar permiso", "❌ No, cancelar"] }]); setLoading(false); return; }
      if (card?.type === "tarea_activa") { setMsgs(m => [...m, { from: "bot", text: card.msg, time: new Date(), quickReplies: ["✅ Sí, fichar salida", "❌ No, cancelar"] }]); setLoading(false); return; }
      setMsgs(m => [...m, { from: "bot", text: clean, card, time: new Date() }]);
      sb.post("mensajes_chat", { legajo: usuario.legajo, rol: "bot", mensaje: clean, empresa_id: usuario.empresa_id }).catch(() => {});
    } catch { setMsgs(m => [...m, { from: "bot", text: "Error de conexión. Probá de nuevo.", time: new Date() }]); }
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {geoError && (
        <div role="alert" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: `${C.red}12`, borderBottom: `1px solid ${C.red}30` }}>
          <span style={{ fontSize: 14 }} aria-hidden="true">📍</span>
          <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: C.red, fontFamily: fB }}>{geoError}</span>
          <button onClick={() => setGeoError(null)} aria-label="Cerrar alerta de ubicación" style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 16, padding: 4, minHeight: 44, minWidth: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
      )}
      <div ref={ref} role="log" aria-label="Historial de mensajes" aria-live="polite" style={{ flex: 1, overflowY: "auto", padding: "8px 18px 12px", WebkitOverflowScrolling: "touch" }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.from === "bot" ? "flex-start" : "flex-end", marginBottom: 12 }}>
            {m.from === "bot" && <div style={{ width: 30, height: 30, borderRadius: 10, marginRight: 8, background: `linear-gradient(135deg,${C.amber},${C.violet})`, display: "flex", alignItems: "center", justifyContent: "center", color: "#000", flexShrink: 0 }}><Ic.bot size={16} /></div>}
            <div style={{ maxWidth: "78%", display: "flex", flexDirection: "column", alignItems: m.from === "bot" ? "flex-start" : "flex-end" }}>
              <div style={{ padding: "10px 14px", background: m.from === "bot" ? C.surfHi : C.amber, color: m.from === "bot" ? C.text : C.amberText, borderRadius: m.from === "bot" ? "16px 16px 16px 4px" : "16px 16px 4px 16px", fontSize: 14, fontFamily: fB, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", border: m.from === "bot" ? `1px solid ${C.border}` : "none", fontWeight: m.from === "bot" ? 400 : 500 }}>{m.text}</div>
              {m.card?.type === "fichada" && <FichadaCard tipo={m.card.sub} hora={m.card.hora} geoMsg={m.card.geoMsg} tardanza={m.card.tardanza} />}
              {m.card?.type === "solicitud" && <SolSentCard motivo={m.card.motivo} fecha={m.card.fecha} />}
              {m.quickReplies && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>{m.quickReplies.map((c, j) => <button key={j} onClick={() => handleSend(c)} style={{ padding: "10px 16px", borderRadius: 999, background: C.surfHi, border: `1px solid ${C.borderHi}`, color: C.text, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: fB, minHeight: 44 }}>{c}</button>)}</div>}
              <span style={{ fontSize: 10, color: C.mute, marginTop: 4, fontFamily: fM }}>{fmtTime(m.time)}</span>
            </div>
          </div>
        ))}
        {loading && <div style={{ display: "flex", marginBottom: 10, alignItems: "flex-end" }}><div style={{ width: 30, height: 30, borderRadius: 10, marginRight: 8, background: `linear-gradient(135deg,${C.amber},${C.violet})`, display: "flex", alignItems: "center", justifyContent: "center", color: "#000" }}><Ic.bot size={16} /></div><div style={{ padding: "12px 16px", background: C.surfHi, borderRadius: "16px 16px 16px 4px", border: `1px solid ${C.border}`, display: "flex", gap: 5, alignItems: "center" }}><span style={{ color: C.amber, display: "flex" }}><Ic.sparkle size={14} /></span><span style={{ fontSize: 12, color: C.dim }}>Pensando...</span><span style={{ display: "flex", gap: 3 }}>{[0, 1, 2].map(i => <span key={i} style={{ width: 4, height: 4, borderRadius: 2, background: C.dim, animation: `typing 1.4s ${i * .2}s infinite` }} />)}</span></div></div>}
      </div>
      <div className="safe-bottom" style={{ padding: "10px 14px 12px", borderTop: `1px solid ${C.border}`, background: C.bg, display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", background: C.surface, borderRadius: 22, padding: "4px 8px 4px 16px", border: `1px solid ${C.border}` }}>
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSend()} placeholder="Hablale al bot..." aria-label="Mensaje para el asistente" disabled={loading} style={{ flex: 1, border: "none", background: "transparent", color: C.text, fontSize: 14, fontFamily: fB, outline: "none", padding: "10px 0", opacity: loading ? .5 : 1 }} />
        </div>
        <button onClick={() => handleSend()} disabled={!input.trim() || loading} aria-label="Enviar mensaje" style={{ width: 44, height: 44, borderRadius: 22, border: "none", background: input.trim() && !loading ? C.amber : C.surface, color: input.trim() && !loading ? C.amberText : C.mute, cursor: input.trim() && !loading ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center" }}><Ic.send size={18} /></button>
      </div>
    </div>
  );
}
