"use client";
import { useState, useEffect, useCallback } from "react";
import { sb } from "../../lib/supabase";
import { sendPushToLegajo } from "../../lib/push";
import { Ic } from "../Icons";
import SolCard from "../cards/SolCard";
import { Chip } from "../ui";
import { hoyArg } from "../../lib/dates";

const AMBER = "var(--color-empresa-primary, #F97316)";
const GREEN = "#16A34A";
const RED = "#DC2626";

export default function InboxScreen({ ctx, reload, usuario }) {
  const [f, setF] = useState("pendiente");
  const [solicitudes, setSolicitudes] = useState(ctx.solicitudes || []);
  const [cargando, setCargando] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [enPrimeraPagina, setEnPrimeraPagina] = useState(true);
  const [hayMas, setHayMas] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const LIMIT = 30;

  const cargarSolicitudes = useCallback(async (cursorActual = null) => {
    const esPrimera = !cursorActual;
    if (esPrimera) setCargando(true); else setCargandoMas(true);
    try {
      const { data: sols, nextCursor } = await sb.getPage(`solicitudes?select=*&order=created_at.desc&limit=${LIMIT}`, cursorActual);
      if (esPrimera) setSolicitudes(sols || []); else setSolicitudes(prev => [...prev, ...(sols || [])]);
      setHayMas((sols || []).length === LIMIT);
      setCursor(nextCursor || null);
      setEnPrimeraPagina(esPrimera);
    } catch (e) { console.error("Error cargando solicitudes:", e); }
    if (esPrimera) setCargando(false); else setCargandoMas(false);
  }, []);

  useEffect(() => { cargarSolicitudes(); }, [cargarSolicitudes]);
  useEffect(() => { if (ctx.solicitudes?.length > 0 && enPrimeraPagina) setSolicitudes(ctx.solicitudes); }, [ctx.solicitudes, enPrimeraPagina]);

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
          const today = hoyArg();
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
      await cargarSolicitudes(); reload();
    } catch (e) { console.error(e); setErrorMsg("Error al procesar la solicitud. Intentá de nuevo."); }
  };

  return (
    <section aria-label="Bandeja de solicitudes" className="px-[18px] pb-[110px] overflow-y-auto flex-1">
      {errorMsg && (
        <div role="alert" className="p-3 bg-gypi-red/10 text-gypi-red rounded-[10px] text-xs mb-3 flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} aria-label="Cerrar error" className="bg-transparent border-none text-gypi-red cursor-pointer font-bold text-sm">✕</button>
        </div>
      )}
      <div role="group" aria-label="Filtros de solicitudes" className="flex gap-1.5 mb-3.5 overflow-x-auto items-center">
        <Chip active={f === "pendiente"} onClick={() => setF("pendiente")} color={AMBER}>Pendientes · {pend}</Chip>
        <Chip active={f === "aprobado"} onClick={() => setF("aprobado")} color={GREEN}>Aprobados</Chip>
        <Chip active={f === "rechazado"} onClick={() => setF("rechazado")} color={RED}>Rechazados</Chip>
        <Chip active={f === "todas"} onClick={() => setF("todas")}>Todas</Chip>
        <button onClick={() => cargarSolicitudes()} aria-label="Actualizar solicitudes" className="w-[30px] h-[30px] rounded-lg bg-gypi-surface border border-gypi-border text-gypi-dim flex items-center justify-center cursor-pointer shrink-0"><Ic.refresh /></button>
      </div>
      {cargando ? (
        <div role="status" aria-live="polite" className="text-center py-8 text-gypi-dim text-[13px]">Cargando solicitudes...</div>
      ) : (
        <div className="flex flex-col gap-3">
          {sortedFiltered.length === 0 ? (
            <div className="g-card py-10 text-center">
              <div className="text-gypi-green inline-flex mb-3"><Ic.check size={20} /></div>
              <div className="text-sm font-bold text-gypi-text">Todo al día</div>
            </div>
          ) : sortedFiltered.map(s => <SolCard key={s.id} s={s} showActions onResolve={resolver} />)}
          {hayMas && !cargandoMas && (
            <button onClick={() => cargarSolicitudes(cursor)} className="w-full py-3.5 rounded-[14px] bg-gypi-surface border border-gypi-border text-gypi-amber text-[13px] font-bold font-body cursor-pointer mt-1">Cargar más solicitudes</button>
          )}
          {cargandoMas && <div role="status" aria-live="polite" className="text-center py-3.5 text-gypi-dim text-xs">Cargando...</div>}
        </div>
      )}
    </section>
  );
}
