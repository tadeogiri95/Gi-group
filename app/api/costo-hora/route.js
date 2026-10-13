// /api/costo-hora — Costo de la hora de mano de obra (Órdenes de Producción,
// parte 8; ítem 39; migración 102). Un solo valor para toda la empresa.
//
//   GET  → { costo_hora } (null si todavía no se cargó)
//   POST → { costo_hora } guarda el valor
//
// Solo el dueño (rol gerencial): ni el supervisor ni el administrativo ven
// costos. Con RLS_RUTAS=on va con el pase del usuario ({ sesion }) y la base
// también exige el rol gerencial.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { costoHoraBody } from "../../lib/schemas";
import { sbGet, sbPost, sbPatch } from "../../lib/sbHelpers";
import { logger } from "../../lib/logger";

const FALTA_MIGRACION = "Para guardar el costo de la hora falta correr la migración 102 en Supabase.";

function faltaMigracion(err) {
  return String(err?.message).includes("costos_empresa");
}

async function sesionDueno(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return { response: respuestaNoAutorizado() };
  if (sesion.rol !== "gerencial") {
    return { response: NextResponse.json({ error: "Solo el dueño puede ver y cambiar los costos" }, { status: 403 }) };
  }
  return { sesion };
}

export async function GET(request) {
  try {
    const { sesion, response } = await sesionDueno(request);
    if (response) return response;
    try {
      const [fila] = (await sbGet(`costos_empresa?empresa_id=eq.${sesion.empresa_id}&select=costo_hora&limit=1`, { sesion })) || [];
      return NextResponse.json({ costo_hora: fila ? Number(fila.costo_hora) : null });
    } catch (err) {
      // Sin la migración no hay costo cargado: la app sigue, sin costos
      if (faltaMigracion(err)) return NextResponse.json({ costo_hora: null, falta_migracion: true });
      throw err;
    }
  } catch (err) {
    logger.error("[costo-hora] GET", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { sesion, response } = await sesionDueno(request);
    if (response) return response;
    const raw = await request.json().catch(() => null);
    const parsed = validateBody(costoHoraBody, raw);
    if (parsed.response) return parsed.response;

    const e = sesion.empresa_id;
    const opts = { sesion };
    const cambios = { costo_hora: parsed.data.costo_hora, actualizado_por: sesion.empleado_id || null, updated_at: new Date().toISOString() };
    try {
      const filtro = `costos_empresa?empresa_id=eq.${e}`;
      const [actual] = (await sbGet(`${filtro}&select=empresa_id&limit=1`, opts)) || [];
      if (actual) await sbPatch(filtro, cambios, opts);
      else await sbPost("costos_empresa", { empresa_id: e, ...cambios }, opts);
    } catch (err) {
      if (faltaMigracion(err)) return NextResponse.json({ error: FALTA_MIGRACION }, { status: 409 });
      throw err;
    }
    return NextResponse.json({ ok: true, costo_hora: parsed.data.costo_hora });
  } catch (err) {
    logger.error("[costo-hora] POST", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
