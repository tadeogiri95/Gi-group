"use client";
// Extraído de [slug]/page.js líneas 230-406
// ENTREGA 2D: ChatScreen como componente independiente.
// Depende de fichar.js helpers (ficharServer, obtenerGeo)

import { useState, useEffect, useRef } from "react";
import { fmtTime, fmtDate } from "../../lib/theme";

import { sb } from "../../lib/supabase";
import { callClaude, parseAction, ACCIONES_CON_EFECTO, descripcionAccion } from "../../lib/claude";
import { sendPushToRole } from "../../lib/push";
import { ficharServer, obtenerGeo } from "../../lib/fichar";
import { pedirPermisoIngreso, pedirSalidaAnticipada, pedirHoraExtra } from "../../lib/pedidosOperario";
import { Ic } from "../Icons";
import FichadaCard from "../cards/FichadaCard";
import SolSentCard from "../cards/SolSentCard";
import { hoyArg, ahoraArg } from "../../lib/dates";

// solicitudes.fecha es DATE en la DB — nunca debe recibir literales como "hoy"
// o un string vacío. Si la IA no extrajo una fecha válida, usamos hoy.
const fechaValida = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f || "") ? f : hoyArg();

export default function ChatScreen({ usuario, ctx, reload, onBack }) {
  const dH = ahoraArg().diaKey;
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
  // Acción propuesta por la IA esperando que el usuario la confirme (F2-06)
  const accionPendiente = useRef(null);

  useEffect(() => { ref.current && (ref.current.scrollTop = ref.current.scrollHeight); }, [msgs, loading]);

  const execAction = async (action) => {
    let card = null;
    const hora = fmtTime(new Date());
    try {
      switch (action.type) {
        case "FICHAR_INGRESO": {
          const geo = await obtenerGeo(usuario, { timeoutMs: 8000 }); // igual que el botón grande (D6, F1-17)
          // empleadoId: sin señal queda guardada y se envía sola, igual que con el botón grande (R8, U-08)
          const res = await ficharServer("ingreso", { geo_lat: geo.lat, geo_lng: geo.lng, geo_precision: geo.precision, empleadoId: usuario.id });
          card = { type: "fichada", sub: "ingreso", hora: res.hora || hora, geoMsg: geo.msg, tardanza: res.tardanza, encolado: res.encolado };
          break;
        }
        case "FICHAR_EGRESO": {
          const geo = await obtenerGeo(usuario, { timeoutMs: 8000 }); // igual que el botón grande (D6, F1-17)
          const res = await ficharServer("egreso", { geo_lat: geo.lat, geo_lng: geo.lng, geo_precision: geo.precision, empleadoId: usuario.id });
          card = { type: "fichada", sub: "egreso", hora: res.hora || hora, geoMsg: geo.msg, horas_extra: res.horas_extra, solicitar_hora_extra: res.solicitar_hora_extra, datos_jornada: res.datos_jornada, encolado: res.encolado };
          break;
        }
        case "FICHAR_EGRESO_FORZAR": {
          const geo = await obtenerGeo(usuario, { timeoutMs: 8000 }); // igual que el botón grande (D6, F1-17)
          const res = await ficharServer("egreso", { forzar_cierre_tarea: true, geo_lat: geo.lat, geo_lng: geo.lng, geo_precision: geo.precision });
          card = { type: "fichada", sub: "egreso", hora: res.hora || hora, geoMsg: geo.msg, horas_extra: res.horas_extra, solicitar_hora_extra: res.solicitar_hora_extra, datos_jornada: res.datos_jornada };
          break;
        }
        case "SOLICITAR_PERMISO":
          await sb.post("solicitudes", { empleado_id: usuario.id, legajo: usuario.legajo, nombre_empleado: usuario.nombre, tipo: "permiso", motivo: action.motivo || "", fecha: fechaValida(action.fecha), desde: action.desde || "—", hasta: action.hasta || "—", estado: "pendiente", empresa_id: usuario.empresa_id });
          await sb.post("notificaciones", { destinatario_rol: "gerencial", tipo: "solicitud", asunto: `${usuario.apodo} pidió permiso`, detalle: action.motivo, urgencia: "normal", empresa_id: usuario.empresa_id });
          sendPushToRole("gerencial", "📋 Nuevo permiso", `${usuario.apodo} solicitó permiso: ${action.motivo || "sin detalle"}`, { empresa_id: usuario.empresa_id }).catch(() => {});
          card = { type: "solicitud", motivo: action.motivo, fecha: action.fecha };
          break;
        case "AVISAR_TARDANZA":
          await sb.post("solicitudes", { empleado_id: usuario.id, legajo: usuario.legajo, nombre_empleado: usuario.nombre, tipo: "tardanza", motivo: `Tardanza: ${action.motivo || ""}`, fecha: fechaValida(), estado: "registrado", empresa_id: usuario.empresa_id });
          await sb.post("notificaciones", { destinatario_rol: "gerencial", tipo: "alerta", asunto: `Tardanza de ${usuario.apodo}`, detalle: action.motivo, urgencia: "normal", empresa_id: usuario.empresa_id });
          sendPushToRole("gerencial", "⏰ Tardanza", `${usuario.apodo}: ${action.motivo || "sin detalle"}`, { empresa_id: usuario.empresa_id }).catch(() => {});
          break;
        case "AVISAR_AUSENCIA":
          await sb.post("solicitudes", { empleado_id: usuario.id, legajo: usuario.legajo, nombre_empleado: usuario.nombre, tipo: "ausencia", motivo: action.motivo || "Ausencia", fecha: fechaValida(action.fecha), estado: "pendiente", empresa_id: usuario.empresa_id });
          await sb.post("notificaciones", { destinatario_rol: "gerencial", tipo: "alerta", asunto: `Ausencia de ${usuario.apodo}`, detalle: action.motivo, urgencia: "alta", empresa_id: usuario.empresa_id });
          sendPushToRole("gerencial", "🚨 Ausencia", `${usuario.apodo}: ${action.motivo || "Ausencia"}`, { empresa_id: usuario.empresa_id }).catch(() => {});
          break;
        case "NOTIFICAR_GERENCIA":
          await sb.post("notificaciones", { destinatario_rol: "gerencial", tipo: "info", asunto: action.asunto, detalle: action.detalle, urgencia: action.urgencia || "normal", empresa_id: usuario.empresa_id });
          break;
      }
      reload && reload();
    } catch (e) {
      if (e.tipo === "bloqueado_tardanza" || e.tipo === "bloqueado_3ra_tarde") return { type: "fichada_bloqueada", permiso: true, msg: "⛔ " + e.message };
      if (e.tipo === "salida_anticipada") return { type: "fichada_bloqueada", permisoSalida: !e.pendiente, finGrilla: e.fin_grilla, msg: "🚪 " + e.message };
      if (e.tipo === "tarea_activa") return { type: "tarea_activa", msg: "⚠️ " + e.message, tareaId: e.tarea_id };
      if (e.tipo === "geo_error") { setGeoError(e.message); return { type: "fichada_bloqueada", msg: e.message }; }
      if (e.tipo) return { type: "fichada_bloqueada", msg: "⚠️ " + e.message };
      // Nunca mostrar como hecho algo que falló (antes devolvía null y el chat decía "✅ registrado").
      console.error(e);
      return { type: "error", msg: "⚠️ No se pudo completar: " + (e.message || "error desconocido") + ". Probá de nuevo." };
    }
    return card;
  };

  // Mensaje del bot para un fichaje bloqueado, con el pedido de permiso que corresponda
  const msgBloqueo = (cr) => {
    if (cr.permiso) return { from: "bot", text: cr.msg + "\n\n¿Querés que solicite el permiso de ingreso a gerencia?", time: new Date(), quickReplies: ["✅ Sí, solicitar permiso", "❌ No, cancelar"] };
    if (cr.permisoSalida) return { from: "bot", text: cr.msg + "\n\n¿Querés pedirle permiso a gerencia para salir antes?", time: new Date(), quickReplies: ["✅ Sí, pedir permiso de salida", "❌ No, cancelar"] };
    return { from: "bot", text: cr.msg, time: new Date() };
  };

  const handleSend = async (txt = input) => {
    const t = txt.trim();
    if (!t || loading) return;
    const um = { from: "user", text: t, time: new Date() };
    const nm = [...msgs, um];
    setMsgs(nm); setInput(""); setLoading(true);
    sb.post("mensajes_chat", { empleado_id: usuario.id, role: "user", content: t, empresa_id: usuario.empresa_id }).catch(() => {});

    // Quick-action shortcuts
    if (t === "✅ Sí, solicitar permiso") {
      try {
        const p = await pedirPermisoIngreso(usuario);
        setMsgs(m => [...m, { from: "bot", text: "✅ Listo, se envió la solicitud de permiso de ingreso a gerencia. Te voy a avisar cuando la resuelvan.", time: new Date(), card: { type: "solicitud", motivo: p.motivo, fecha: p.fecha } }]);
        if (reload) reload();
      } catch (e) { console.error(e); setMsgs(m => [...m, { from: "bot", text: "Error al enviar la solicitud. Probá de nuevo.", time: new Date() }]); }
      setLoading(false); return;
    }
    if (t === "✅ Sí, pedir permiso de salida") {
      try {
        const p = await pedirSalidaAnticipada(usuario);
        setMsgs(m => [...m, { from: "bot", text: "✅ Le pedí el permiso a gerencia. Cuando lo aprueben te aviso y ahí fichás tu salida con \"Me voy\".", time: new Date(), card: { type: "solicitud", motivo: p.motivo, fecha: p.fecha } }]);
        if (reload) reload();
      } catch (e) { console.error(e); setMsgs(m => [...m, { from: "bot", text: "Error al enviar la solicitud. Probá de nuevo.", time: new Date() }]); }
      setLoading(false); return;
    }
    if (t === "❌ No, cancelar") { accionPendiente.current = null; setMsgs(m => [...m, { from: "bot", text: "Entendido. Si necesitás algo más, avisame.", time: new Date() }]); setLoading(false); return; }
    if (t === "✅ Sí, fichar salida") {
      try {
        const cr = await execAction({ type: "FICHAR_EGRESO_FORZAR" });
        if (cr?.type === "fichada_bloqueada" || cr?.type === "error") {
          setMsgs(m => [...m, msgBloqueo(cr)]);
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
        const p = await pedirHoraExtra(usuario);
        setMsgs(m => [...m, { from: "bot", text: "✅ Solicitud de hora extra enviada a gerencia. Te aviso cuando la resuelvan.", time: new Date(), card: { type: "solicitud", motivo: p.motivo, fecha: p.fecha } }]);
        if (reload) reload();
      } catch (e) { setMsgs(m => [...m, { from: "bot", text: "Error al enviar la solicitud.", time: new Date() }]); }
      setLoading(false); return;
    }

    // Confirmación de una acción propuesta por la IA
    if (t === "✅ Confirmar") {
      const action = accionPendiente.current;
      accionPendiente.current = null;
      if (!action) { setMsgs(m => [...m, { from: "bot", text: "No hay nada pendiente para confirmar.", time: new Date() }]); setLoading(false); return; }
      const card = await execAction(action);
      if (card?.type === "fichada_bloqueada") { setMsgs(m => [...m, msgBloqueo(card)]); setLoading(false); return; }
      if (card?.type === "tarea_activa") { setMsgs(m => [...m, { from: "bot", text: card.msg, time: new Date(), quickReplies: ["✅ Sí, fichar salida", "❌ No, cancelar"] }]); setLoading(false); return; }
      if (card?.type === "error") { setMsgs(m => [...m, { from: "bot", text: card.msg, time: new Date() }]); setLoading(false); return; }
      setMsgs(m => [...m, { from: "bot", text: "✅ Listo.", card, time: new Date() }]);
      setLoading(false); return;
    }

    // "Ya llegué" direct action
    if (t === "Ya llegué") {
      try {
        const cr = await execAction({ type: "FICHAR_INGRESO" });
        if (cr?.type === "error") { setMsgs(m => [...m, { from: "bot", text: cr.msg, time: new Date() }]); }
        else if (cr?.type === "fichada_bloqueada" && cr.permiso) { setMsgs(m => [...m, { from: "bot", text: cr.msg + "\n\n¿Querés que solicite el permiso de ingreso a gerencia?", time: new Date(), quickReplies: ["✅ Sí, solicitar permiso", "❌ No, cancelar"] }]); }
        else if (cr?.type === "fichada_bloqueada") { setMsgs(m => [...m, { from: "bot", text: cr.msg, time: new Date() }]); }
        else if (cr?.encolado) {
          setMsgs(m => [...m, { from: "bot", text: `📶 Sin señal: guardamos tu entrada de las ${cr.hora}. Se envía sola cuando vuelva la conexión, con esa hora.`, time: new Date() }]);
        }
        else if (cr) {
          let tardMsg = "✅ ¡Fichado! Buen día, " + usuario.apodo + " 👋";
          const trd = cr.tardanza;
          if (trd?.estado === "tarde") {
            tardMsg = `⚠️ Fichado, pero llegás ${trd.minutos} min tarde.\nEs tu llegada tarde #${trd.llegadasTarde} del mes.`;
          }
          setMsgs(m => [...m, { from: "bot", text: tardMsg, card: cr, time: new Date() }]);
        }
        if (reload) reload();
      } catch (e) { setMsgs(m => [...m, { from: "bot", text: "No se pudo fichar la entrada. Probá con el botón de Inicio.", time: new Date() }]); }
      setLoading(false); return;
    }

    // "Me voy" direct action
    if (t === "Me voy") {
      try {
        const cr = await execAction({ type: "FICHAR_EGRESO" });
        if (cr?.type === "tarea_activa") { setMsgs(m => [...m, { from: "bot", text: cr.msg, time: new Date(), quickReplies: ["✅ Sí, fichar salida", "❌ No, cancelar"] }]); }
        else if (cr?.type === "fichada_bloqueada" || cr?.type === "error") { setMsgs(m => [...m, msgBloqueo(cr)]); }
        else if (cr?.encolado) {
          setMsgs(m => [...m, { from: "bot", text: `📶 Sin señal: guardamos tu salida de las ${cr.hora}. Se envía sola cuando vuelva la conexión, con esa hora.`, time: new Date() }]);
        }
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
      let raw = await callClaude(hist);
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
          const raw2 = await callClaude(histConDatos);
          const parsed2 = parseAction(raw2);
          clean = parsed2.clean;
          action = parsed2.action;
        } catch {
          clean = clean || "Tuve un problema consultando los datos. Probá de nuevo.";
          action = null;
        }
      }

      // Las acciones que registran algo no se ejecutan solas: se confirman con un botón.
      if (action && ACCIONES_CON_EFECTO.has(action.type)) {
        accionPendiente.current = action;
        const texto = `${clean ? clean + "\n\n" : ""}¿Confirmás que querés ${descripcionAccion(action)}?`;
        setMsgs(m => [...m, { from: "bot", text: texto, time: new Date(), quickReplies: ["✅ Confirmar", "❌ No, cancelar"] }]);
        sb.post("mensajes_chat", { empleado_id: usuario.id, role: "assistant", content: clean, empresa_id: usuario.empresa_id }).catch(() => {});
        setLoading(false); return;
      }
      setMsgs(m => [...m, { from: "bot", text: clean, time: new Date() }]);
      sb.post("mensajes_chat", { empleado_id: usuario.id, role: "assistant", content: clean, empresa_id: usuario.empresa_id }).catch(() => {});
    } catch { setMsgs(m => [...m, { from: "bot", text: "Error de conexión. Probá de nuevo.", time: new Date() }]); }
    setLoading(false);
  };

  const avatarBot = (
    <div className="w-[30px] h-[30px] rounded-[10px] mr-2 bg-linear-135 from-gypi-amber to-gypi-violet flex items-center justify-center text-black shrink-0" aria-hidden="true">
      <Ic.bot size={16} />
    </div>
  );
  const puedeEnviar = input.trim() && !loading;

  return (
    <div className="flex flex-col h-full font-body">
      {/* F4-03: el chat oculta la barra de navegación; sin esto, en la app instalada en iOS no había forma de salir */}
      {onBack && (
        <div className="safe-top flex items-center gap-1.5 px-2.5 py-2 border-b border-gypi-border bg-gypi-bg shrink-0">
          <button onClick={onBack} aria-label="Volver al inicio" className="flex items-center gap-1 bg-transparent border-none text-gypi-text cursor-pointer text-[14px] font-semibold px-2 py-1 min-h-11">
            <Ic.chevL /> Volver
          </button>
          <span className="flex-1 text-center text-[15px] font-bold text-gypi-text mr-[60px]">Asistente</span>
        </div>
      )}
      {geoError && (
        <div role="alert" className="flex items-center gap-2.5 px-4 py-2.5 bg-gypi-red/[0.07] border-b border-gypi-red/20">
          <span className="text-[14px]" aria-hidden="true">📍</span>
          <span className="flex-1 text-[12px] font-semibold text-gypi-red">{geoError}</span>
          <button onClick={() => setGeoError(null)} aria-label="Cerrar alerta de ubicación" className="bg-transparent border-none text-gypi-red cursor-pointer text-[16px] p-1 min-h-11 min-w-11 flex items-center justify-center">✕</button>
        </div>
      )}
      <div ref={ref} role="log" aria-label="Historial de mensajes" aria-live="polite" className="flex-1 overflow-y-auto px-[18px] pt-2 pb-3">
        {msgs.map((m, i) => {
          const esBot = m.from === "bot";
          return (
            <div key={i} className={`flex mb-3 ${esBot ? "justify-start" : "justify-end"}`}>
              {esBot && avatarBot}
              <div className={`max-w-[78%] flex flex-col ${esBot ? "items-start" : "items-end"}`}>
                <div className={`px-3.5 py-2.5 text-[14px] leading-normal whitespace-pre-wrap wrap-break-word ${esBot ? "bg-gypi-surf-hi text-gypi-text rounded-[16px_16px_16px_4px] border border-gypi-border font-normal" : "bg-gypi-amber text-gypi-on-amber rounded-[16px_16px_4px_16px] font-medium"}`}>{m.text}</div>
                {m.card?.type === "fichada" && <FichadaCard tipo={m.card.sub} hora={m.card.hora} geoMsg={m.card.geoMsg} tardanza={m.card.tardanza} />}
                {m.card?.type === "solicitud" && <SolSentCard motivo={m.card.motivo} fecha={m.card.fecha} />}
                {m.quickReplies && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {m.quickReplies.map((c, j) => (
                      <button key={j} onClick={() => handleSend(c)} className="px-4 py-2.5 rounded-full bg-gypi-surf-hi border border-(--color-border-hi) text-gypi-text text-[13px] font-semibold cursor-pointer min-h-11">{c}</button>
                    ))}
                  </div>
                )}
                <span className="text-[12px] text-gypi-mute mt-1 font-mono">{fmtTime(m.time)}</span>
              </div>
            </div>
          );
        })}
        {loading && (
          <div className="flex mb-2.5 items-end">
            {avatarBot}
            <div className="px-4 py-3 bg-gypi-surf-hi rounded-[16px_16px_16px_4px] border border-gypi-border flex gap-[5px] items-center">
              <span className="text-gypi-amber-ink flex"><Ic.sparkle size={14} /></span>
              <span className="text-[12px] text-gypi-dim">Pensando...</span>
              <span className="flex gap-[3px]" aria-hidden="true">
                {["[animation-delay:0s]", "[animation-delay:0.2s]", "[animation-delay:0.4s]"].map((d) => <span key={d} className={`w-1 h-1 rounded-[2px] bg-gypi-dim animate-[typing_1.4s_infinite] ${d}`} />)}
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="safe-bottom px-3.5 pt-2.5 pb-3 border-t border-gypi-border bg-gypi-bg flex items-center gap-2">
        <div className="flex-1 flex items-center bg-gypi-surface rounded-[22px] py-1 pr-2 pl-4 border border-gypi-border">
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSend()} placeholder="Escribile al asistente..." aria-label="Mensaje para el asistente" disabled={loading} className={`flex-1 border-none bg-transparent text-gypi-text text-[16px] outline-none py-2.5 ${loading ? "opacity-50" : ""}`} />
        </div>
        <button onClick={() => handleSend()} disabled={!puedeEnviar} aria-label="Enviar mensaje" className={`w-12 h-12 rounded-full border-none flex items-center justify-center shrink-0 ${puedeEnviar ? "bg-gypi-amber text-gypi-on-amber cursor-pointer" : "bg-gypi-surface text-gypi-mute cursor-default"}`}><Ic.send size={18} /></button>
      </div>
    </div>
  );
}
