// GET /api/historial-ot?ot=X — Historial de cambios de una OT (Tadeo, 02/11):
// quién cargó avance, demoras, retrabajos, pausas, editó, cerró, cambió prioridad o
// semana, firmó etapas o liberó, y a qué hora de qué día. Solo gestión.
// audit_log solo la lee el servidor (la 008 la cierra a los usuarios), así que
// va con la llave del servidor y siempre filtrada por la empresa de la sesión.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { sbGet } from "../../lib/sbHelpers";
import { ROLES_GESTION } from "../../lib/dataPolicy";
import { ACCION_CAMBIO_OT, armarHistorial, cambioDeAudit, cambiosAnteriores } from "../../lib/historialOt";
import { logger } from "../../lib/logger";

const MAX = 300;
const vacio = () => [];

export async function GET(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return respuestaNoAutorizado();
  if (!ROLES_GESTION.has(sesion.rol)) return NextResponse.json({ error: "Solo gestión ve el historial" }, { status: 403 });
  const ot = (new URL(request.url).searchParams.get("ot") || "").trim();
  if (!ot || ot.length > 40) return NextResponse.json({ error: "Falta la OT" }, { status: 400 });
  const e = sesion.empresa_id;
  const q = encodeURIComponent(ot);
  try {
    const [audit, primero, ajustes, retrabajos, manual, etapas, proyectos, empleados, pausas] = await Promise.all([
      sbGet(`audit_log?empresa_id=eq.${e}&accion=eq.${ACCION_CAMBIO_OT}&entidad_id=eq.${q}&select=created_at,actor_id,entidad,datos_antes,datos_despues&order=created_at.desc&limit=${MAX}`),
      sbGet(`audit_log?empresa_id=eq.${e}&accion=eq.${ACCION_CAMBIO_OT}&select=created_at&order=created_at.asc&limit=1`).catch(vacio),
      sbGet(`ajustes_tiempo_ot?empresa_id=eq.${e}&ot=eq.${q}&select=*&limit=${MAX}`).catch(vacio),
      sbGet(`retrabajos_ot?empresa_id=eq.${e}&ot=eq.${q}&select=*&limit=${MAX}`).catch(vacio),
      sbGet(`avance_manual_historial?empresa_id=eq.${e}&ot=eq.${q}&select=etapa,pct,creado_por,created_at&limit=${MAX}`).catch(vacio),
      sbGet(`avance_etapas?empresa_id=eq.${e}&ot=eq.${q}&select=etapa,estado,terminada_por,terminada_at,aprobada_por,aprobada_at&limit=${MAX}`).catch(vacio),
      sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${q}&select=liberada_por,liberada_at&limit=1`).catch(vacio),
      sbGet(`empleados?empresa_id=eq.${e}&select=id,nombre&limit=5000`).catch(vacio),
      // Sin la 151 no hay pausas
      sbGet(`pausas_ot?empresa_id=eq.${e}&ot=eq.${q}&select=*&limit=${MAX}`).catch(vacio),
    ]);
    const desde = primero?.[0]?.created_at || null;
    // Demoras, retrabajos y pausas ya guardan quién y cuándo: salen siempre de su tabla
    const registrados = (audit || []).map(cambioDeAudit)
      .filter((c) => c.tabla !== "retrabajos_ot" && c.tabla !== "pausas_ot" && !(c.tabla === "ajustes_tiempo_ot" && c.metodo === "POST"));
    const lista = [
      ...registrados,
      ...cambiosAnteriores({ ajustes, retrabajos, pausas: pausas || [], desde: null }),
      // Avance manual, firmas y liberación: de la tabla solo lo anterior al registro
      ...cambiosAnteriores({ manual, etapas, proyecto: proyectos?.[0] || null, desde }),
    ];
    return NextResponse.json({ ok: true, cambios: armarHistorial(lista, empleados || []).slice(0, MAX), desde });
  } catch (err) {
    logger.error("[historial-ot] error", err);
    return NextResponse.json({ error: "No se pudo leer el historial" }, { status: 500 });
  }
}
