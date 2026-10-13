// POST /api/avance — Avance de etapas por OT y liberación de la OT
// (Órdenes de Producción, parte 5; ítem 39; migración 100).
//
// Body: { accion, ot, etapa?, liberacion?, puntos_criticos? }
//   terminar   → cualquiera: "Terminé esta etapa" (queda esperando la firma)
//   aprobar    → gestión: firma el cierre de la etapa
//   no_aplica  → gestión: la etapa no corresponde a esta OT
//   reabrir    → gestión: vuelve la etapa a pendiente
//   liberar    → gestión: libera la OT con lo tildado del checklist
//   desliberar → gestión: le quita la liberación
//   puntos     → gestión: guarda los puntos críticos de la OT
// Con RLS_RUTAS=on todo va con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { avanceBody } from "../../lib/schemas";
import { sbGet, sbPost, sbPatch, sbDelete } from "../../lib/sbHelpers";
import { ROLES_GESTION } from "../../lib/dataPolicy";
import { broadcastRefresh } from "../../lib/broadcast";
import { rechazarSiSinPlan, requireModulo } from "../../lib/planEnforcement";
import { logger } from "../../lib/logger";

const SOLO_GESTION = new Set(["aprobar", "no_aplica", "reabrir", "liberar", "desliberar", "puntos"]);

function faltaMigracion(err) {
  const m = String(err?.message);
  return m.includes("avance_etapas") || m.includes("liberada_at") || m.includes("puntos_criticos") || m.includes("liberacion");
}

async function procesar(sesion, datos) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const ahora = new Date().toISOString();
  const { accion, ot } = datos;

  const [proyecto] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}&select=id,ot&limit=1`, opts)) || [];
  if (!proyecto) return NextResponse.json({ error: "No encontré esa OT" }, { status: 404 });

  if (accion === "liberar" || accion === "desliberar" || accion === "puntos") {
    const cambios = {};
    if (accion === "liberar") Object.assign(cambios, { liberada_at: ahora, liberada_por: sesion.empleado_id, liberacion: { items: datos.liberacion || [] } });
    if (accion === "desliberar") Object.assign(cambios, { liberada_at: null, liberada_por: null, liberacion: null });
    if (datos.puntos_criticos !== undefined) cambios.puntos_criticos = datos.puntos_criticos || null;
    const [act] = (await sbPatch(`proyectos?id=eq.${proyecto.id}&empresa_id=eq.${e}`, cambios, opts)) || [];
    broadcastRefresh(e, "proyectos");
    return NextResponse.json({ ok: true, proyecto: act || null });
  }

  const filtro = `avance_etapas?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}&etapa=eq.${datos.etapa}`;
  const [actual] = (await sbGet(`${filtro}&select=id,estado&limit=1`, opts)) || [];

  if (accion === "reabrir") {
    if (actual) await sbDelete(filtro, opts);
    broadcastRefresh(e, "avance_etapas");
    return NextResponse.json({ ok: true, avance: null });
  }

  let cambios;
  if (accion === "terminar") {
    // Una etapa ya firmada (o marcada "no aplica") no vuelve atrás por esto
    if (actual && actual.estado !== "terminada") return NextResponse.json({ ok: true, avance: actual });
    cambios = { estado: "terminada", terminada_por: sesion.empleado_id, terminada_at: ahora };
  } else {
    cambios = { estado: accion === "aprobar" ? "aprobada" : "no_aplica", aprobada_por: sesion.empleado_id, aprobada_at: ahora };
  }
  cambios.updated_at = ahora;
  const [fila] = actual
    ? (await sbPatch(`${filtro}`, cambios, opts)) || []
    : (await sbPost("avance_etapas", { empresa_id: e, ot: proyecto.ot, etapa: datos.etapa, ...cambios }, opts)) || [];
  broadcastRefresh(e, "avance_etapas");
  return NextResponse.json({ ok: true, avance: fila || null });
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    const raw = await request.json().catch(() => null);
    const parsed = validateBody(avanceBody, raw);
    if (parsed.response) return parsed.response;
    if (SOLO_GESTION.has(parsed.data.accion) && !ROLES_GESTION.has(sesion.rol)) {
      return NextResponse.json({ error: "Solo el responsable puede firmar o liberar" }, { status: 403 });
    }
    const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
    if (sinPlan) return sinPlan;
    const sinModulo = await requireModulo(sesion.empresa_id, "actividad");
    if (sinModulo) return sinModulo;
    try {
      return await procesar(sesion, parsed.data);
    } catch (err) {
      if (faltaMigracion(err)) {
        return NextResponse.json({ error: "Para guardar el avance falta correr la migración 100 en Supabase." }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    logger.error("[avance] error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
