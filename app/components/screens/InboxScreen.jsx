"use client";
// Extraído de [slug]/page.js líneas 653-735
import { useState, useEffect, useCallback } from "react";
import { C, fH, fB, fM } from "../../lib/theme";
import { sb } from "../../lib/supabase";
import { sendPushToLegajo } from "../../../lib/push";
import { Ic } from "../Icons";
import SolCard from "../cards/SolCard";
import { Chip } from "../ui";

export default function InboxScreen({ ctx, reload, usuario }) {
  const [f, setF] = useState("pendiente");
  const [solicitudes, setSolicitudes] = useState(ctx.solicitudes || []);
  const [cargando, setCargando] = useState(false);
  const [pagina, setPagina] = useState(0);
  const [hayMas, setHayMas] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const LIMIT = 30;

  const cargarSolicitudes = useCallback(async (pag = 0) => {
    setCargando(true);
    try {
      const offset = pag * LIMIT;
      const sols = await sb.get(`solicitudes?select=*&order=created_at.desc&limit=${LIMIT}&offset=${offset}`);
      if (pag === 0) setSolicitudes(sols || []); else setSolicitudes(prev => [...prev, ...(sols || [])]);
      setHayMas((sols || []).length === LIMIT);
      setPagina(pag);
    } catch (e) { console.error("Error cargando solicitudes:", e); }
    setCargando(false);
  }, []);

  useEffect(() => { cargarSolicitudes(0); }, [cargarSolicitudes]);
  useEffect(() => { if (ctx.solicitudes?.length > 0 && pagina === 0) setSolicitudes(ctx.solicitudes); }, [ctx.solicitudes, pagina]);

  const filtered = solicitudes.filter(s => { if (s.estado === "registrado") return false; if (f === "todas") return true; return s.estado === f; });
  const pend = solicitudes.filter(s => s.estado === "pendiente").length;
  const sortedFiltered = [...filtered].sort((a, b) => {
    const aI = a.motivo?.includes("INGRESO") || a.motivo?.includes("🔓") ? 1 : 0;
    const bI = b.motivo?.includes("INGRESO") || b.motivo?.includes("🔓") ? 1 : 0;
    return bI - aI;
  });

  const resolver = async (id, estado) => {
    setErrorMsg(null);
    try {
      const sol = solicitudes.find(s => s.id === id);
      await sb.patch(`solicitudes?id=eq.${id}`, { estado, aprobador: usuario.apodo, resuelto_at: new Date().toISOString() });
      if (sol) {
        const esPermisoIngreso = sol.motivo?.includes("🔓") || sol.motivo?.toLowerCase().includes("permiso de ingreso");
        const esCambioHorario = sol.tipo === "cambio_horario" || sol.motivo?.toLowerCase().includes("cambio de horario");

        if (esPermisoIngreso && estado === "aprobado") {
          const today = new Date().toISOString().split("T")[0];
          const matchHora = sol.motivo?.match(/\((\d{1,2}:\d{2})/);
          const horaIngreso = matchHora ? matchHora[1] : sol.desde && sol.desde !== "—" ? sol.desde : new Date(sol.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
          const ex = await sb.get(`fichadas?legajo=eq.${sol.legajo}&fecha=eq.${today}`);
          if (!ex || !ex.length) {
            await sb.post("fichadas", { empleado_id: sol.empleado_id, legajo: sol.legajo, fecha: today, ingreso: horaIngreso, llegada_tarde: true, minutos_tarde: 0, permiso_ingreso: true, empresa_id: usuario.empresa_id });
          }
          await sb.post("notificaciones", { destinatario_rol: String(sol.legajo), tipo: "aprobacion", asunto: "✅ Ingreso APROBADO — Ya quedaste fichado", detalle: `${usuario.apodo} aprobó tu ingreso. Se registró tu fichada de las ${horaIngreso}.`, urgencia: "alta", solicitud_id: id, empresa_id: usuario.empresa_id });
          sendPushToLegajo(String(sol.legajo), "✅ Ingreso aprobado", `Tu ingreso fue aprobado por ${usuario.apodo}. Fichada registrada a las ${horaIngreso}.`, { empresa_id: usuario.empresa_id }).catch(() => {});
        } else if (esCambioHorario && estado === "aprobado" && sol.datos_horario) {
          try {
            const nuevoHorario = typeof sol.datos_horario === "string" ? JSON.parse(sol.datos_horario) : sol.datos_horario;
            if (nuevoHorario && sol.empleado_id) {
              const horas = Object.values(nuevoHorario).reduce((acc, v) => { if (!v) return acc; const [hI, mI] = v.in.split(":").map(Number); const [hO, mO] = v.out.split(":").map(Number); return acc + (hO * 60 + mO - hI * 60 - mI) / 60; }, 0);
              await sb.patch(`empleados?id=eq.${sol.empleado_id}`, { diagrama: nuevoHorario, horas_semanales: Math.round(horas) });
            }
          } catch (e) { console.error("Error actualizando grilla:", e); }
          await sb.post("notificaciones", { destinatario_rol: String(sol.legajo), tipo: "aprobacion", asunto: "✅ Cambio de horario APROBADO", detalle: `${usuario.apodo} aprobó tu solicitud de cambio de horario.`, urgencia: "alta", solicitud_id: id, empresa_id: usuario.empresa_id });
          sendPushToLegajo(String(sol.legajo), "✅ Horario actualizado", `Tu cambio de horario fue aprobado por ${usuario.apodo}.`, { empresa_id: usuario.empresa_id }).catch(() => {});
        } else {
          await sb.post("notificaciones", { destinatario_rol: String(sol.legajo), tipo: "aprobacion", asunto: `Solicitud ${estado === "aprobado" ? "APROBADA ✅" : "RECHAZADA ❌"}`, detalle: `${sol.tipo}: "${sol.motivo}" por ${usuario.apodo}`, urgencia: "alta", solicitud_id: id, empresa_id: usuario.empresa_id });
          sendPushToLegajo(String(sol.legajo), estado === "aprobado" ? "✅ Permiso aprobado" : "❌ Permiso rechazado", estado === "aprobado" ? `Tu ${sol.tipo} fue aprobado por ${usuario.apodo}` : `Tu ${sol.tipo} fue rechazado por ${usuario.apodo}`, { empresa_id: usuario.empresa_id }).catch(() => {});
        }
      }
      await cargarSolicitudes(0); reload();
    } catch (e) { console.error(e); setErrorMsg("Error al procesar la solicitud. Intentá de nuevo."); }
  };

  return (
    <div style={{ padding: "0 18px 110px", overflowY: "auto", flex: 1 }}>
      {errorMsg && <div style={{ padding: 12, background: C.redS, color: C.red, borderRadius: 10, fontSize: 12, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}><span>{errorMsg}</span><button onClick={() => setErrorMsg(null)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>✕</button></div>}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto", alignItems: "center" }}>
        <Chip active={f === "pendiente"} onClick={() => setF("pendiente")} color={C.amber}>Pendientes · {pend}</Chip>
        <Chip active={f === "aprobado"} onClick={() => setF("aprobado")} color={C.green}>Aprobados</Chip>
        <Chip active={f === "rechazado"} onClick={() => setF("rechazado")} color={C.red}>Rechazados</Chip>
        <Chip active={f === "todas"} onClick={() => setF("todas")}>Todas</Chip>
        <button onClick={() => cargarSolicitudes(0)} style={{ width: 30, height: 30, borderRadius: 8, background: C.surface, border: `1px solid ${C.border}`, color: C.dim, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}><Ic.refresh /></button>
      </div>
      {cargando && pagina === 0 ? <div style={{ textAlign: "center", padding: 30, color: C.dim, fontSize: 13 }}>Cargando solicitudes...</div> :
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sortedFiltered.length === 0 ? <div style={{ background: C.surface, borderRadius: 14, padding: 40, textAlign: "center", border: `1px solid ${C.border}` }}><div style={{ color: C.green, display: "inline-flex", marginBottom: 12 }}><Ic.check size={20} /></div><div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Todo al día</div></div> : sortedFiltered.map(s => <SolCard key={s.id} s={s} showActions onResolve={resolver} />)}
          {hayMas && !cargando && <button onClick={() => cargarSolicitudes(pagina + 1)} style={{ width: "100%", padding: 14, borderRadius: 14, background: C.surface, border: `1px solid ${C.border}`, color: C.amber, fontSize: 13, fontWeight: 700, fontFamily: fB, cursor: "pointer", marginTop: 4 }}>Cargar más solicitudes</button>}
          {cargando && pagina > 0 && <div style={{ textAlign: "center", padding: 14, color: C.dim, fontSize: 12 }}>Cargando...</div>}
        </div>}
    </div>
  );
}
