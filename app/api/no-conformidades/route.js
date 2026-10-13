// POST /api/no-conformidades — Piezas con defecto por OT (Órdenes de
// Producción, parte 6; ítem 39; migración 101).
//
// Body: { accion, ... }
//   crear   → cualquiera: registra una pieza (o tanda) no conforme
//   decidir → gestión: reprocesar, rehacer, usar igual o descartar, y los
//             minutos de retrabajo (decision null la vuelve a "sin decidir")
//   borrar  → gestión: se cargó por error
// Con RLS_RUTAS=on todo va con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { noConformidadBody } from "../../lib/schemas";
import { sbGet, sbPost, sbPatch, sbDelete } from "../../lib/sbHelpers";
import { ROLES_GESTION } from "../../lib/dataPolicy";
import { broadcastRefresh } from "../../lib/broadcast";
import { rechazarSiSinPlan, requireModulo } from "../../lib/planEnforcement";
import { logger } from "../../lib/logger";

function faltaMigracion(err) {
  return String(err?.message).includes("no_conformidades");
}

async function procesar(sesion, datos) {
  const e = sesion.empresa_id;
  const opts = { sesion };

  if (datos.accion === "crear") {
    const [proyecto] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(datos.ot)}&select=id,ot&limit=1`, opts)) || [];
    if (!proyecto) return NextResponse.json({ error: "No encontré esa OT" }, { status: 404 });
    const [fila] = (await sbPost("no_conformidades", {
      empresa_id: e,
      ot: proyecto.ot,
      defecto: datos.defecto,
      pieza: datos.pieza,
      cantidad: datos.cantidad ?? 1,
      etapa_detecta: datos.etapa_detecta ?? null,
      etapa_origen: datos.etapa_origen ?? null,
      nota: datos.nota,
      creada_por: sesion.empleado_id,
    }, opts)) || [];
    broadcastRefresh(e, "no_conformidades");
    return NextResponse.json({ ok: true, no_conformidad: fila || null });
  }

  const filtro = `no_conformidades?id=eq.${datos.id}&empresa_id=eq.${e}`;
  const [actual] = (await sbGet(`${filtro}&select=id&limit=1`, opts)) || [];
  if (!actual) return NextResponse.json({ error: "No encontré esa no conformidad" }, { status: 404 });

  if (datos.accion === "borrar") {
    await sbDelete(filtro, opts);
    broadcastRefresh(e, "no_conformidades");
    return NextResponse.json({ ok: true });
  }

  const cambios = datos.decision
    ? { decision: datos.decision, decidida_por: sesion.empleado_id, decidida_at: new Date().toISOString() }
    : { decision: null, decidida_por: null, decidida_at: null };
  if (datos.minutos_retrabajo !== undefined) cambios.minutos_retrabajo = datos.minutos_retrabajo;
  if (datos.etapa_origen !== undefined) cambios.etapa_origen = datos.etapa_origen;
  const [fila] = (await sbPatch(filtro, cambios, opts)) || [];
  broadcastRefresh(e, "no_conformidades");
  return NextResponse.json({ ok: true, no_conformidad: fila || null });
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    const raw = await request.json().catch(() => null);
    const parsed = validateBody(noConformidadBody, raw);
    if (parsed.response) return parsed.response;
    if (parsed.data.accion !== "crear" && !ROLES_GESTION.has(sesion.rol)) {
      return NextResponse.json({ error: "Solo el encargado puede decidir qué se hace con la pieza" }, { status: 403 });
    }
    const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
    if (sinPlan) return sinPlan;
    const sinModulo = await requireModulo(sesion.empresa_id, "actividad");
    if (sinModulo) return sinModulo;
    try {
      return await procesar(sesion, parsed.data);
    } catch (err) {
      if (faltaMigracion(err)) {
        return NextResponse.json({ error: "Para registrar no conformidades falta correr la migración 101 en Supabase." }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    logger.error("[no-conformidades] error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
