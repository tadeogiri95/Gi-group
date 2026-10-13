// POST /api/sueltos — Hoja de sueltos y herrajes de cada OT (Órdenes de
// Producción, parte 9; ítem 39; migración 103).
//
// Body: { accion, ... }
//   agregar → gestión: suma ítems a la OT (a mano o pegados desde Excel)
//   borrar  → gestión: saca un ítem
//   vaciar  → gestión: borra la hoja entera de la OT (se pegó mal)
//   tildar  → cualquiera: marca o desmarca un ítem en acopio o en carga
// Con RLS_RUTAS=on todo va con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { sueltosBody } from "../../lib/schemas";
import { sbGet, sbPost, sbPatch, sbDelete } from "../../lib/sbHelpers";
import { ROLES_GESTION } from "../../lib/dataPolicy";
import { broadcastRefresh } from "../../lib/broadcast";
import { rechazarSiSinPlan, requireModulo } from "../../lib/planEnforcement";
import { logger } from "../../lib/logger";

function faltaMigracion(err) {
  return String(err?.message).includes("sueltos_ot");
}

async function procesar(sesion, datos) {
  const e = sesion.empresa_id;
  const opts = { sesion };

  if (datos.accion === "agregar" || datos.accion === "vaciar") {
    const [proyecto] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(datos.ot)}&select=id,ot&limit=1`, opts)) || [];
    if (!proyecto) return NextResponse.json({ error: "No encontré esa OT" }, { status: 404 });
    const filtroOt = `sueltos_ot?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(proyecto.ot)}`;
    if (datos.accion === "vaciar") {
      await sbDelete(filtroOt, opts);
      broadcastRefresh(e, "sueltos_ot");
      return NextResponse.json({ ok: true });
    }
    // Los nuevos van después de los que ya están
    const [ultimo] = (await sbGet(`${filtroOt}&select=orden&order=orden.desc&limit=1`, opts)) || [];
    const base = (ultimo?.orden ?? -1) + 1;
    // Mismas claves en todas las filas (PostgREST lo exige en un lote)
    const filas = datos.items.map((item, i) => ({
      empresa_id: e,
      ot: proyecto.ot,
      orden: base + i,
      tipo: item.tipo ?? null,
      codigo: item.codigo ?? null,
      descripcion: item.descripcion ?? null,
      medida: item.medida ?? null,
      cantidad: item.cantidad ?? 1,
      va_con: item.va_con ?? null,
      creado_por: sesion.empleado_id || null,
    }));
    const creados = (await sbPost("sueltos_ot", filas, opts)) || [];
    broadcastRefresh(e, "sueltos_ot");
    return NextResponse.json({ ok: true, sueltos: creados });
  }

  const filtro = `sueltos_ot?id=eq.${datos.id}&empresa_id=eq.${e}`;
  const [actual] = (await sbGet(`${filtro}&select=id&limit=1`, opts)) || [];
  if (!actual) return NextResponse.json({ error: "No encontré ese ítem" }, { status: 404 });

  if (datos.accion === "borrar") {
    await sbDelete(filtro, opts);
    broadcastRefresh(e, "sueltos_ot");
    return NextResponse.json({ ok: true });
  }

  // tildar: quién y cuándo, o se borra si se destilda
  const c = datos.columna;
  const cambios = datos.valor
    ? { [c]: true, [`${c}_por`]: sesion.empleado_id || null, [`${c}_at`]: new Date().toISOString() }
    : { [c]: false, [`${c}_por`]: null, [`${c}_at`]: null };
  const [fila] = (await sbPatch(filtro, cambios, opts)) || [];
  broadcastRefresh(e, "sueltos_ot");
  return NextResponse.json({ ok: true, suelto: fila || null });
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    const raw = await request.json().catch(() => null);
    const parsed = validateBody(sueltosBody, raw);
    if (parsed.response) return parsed.response;
    if (parsed.data.accion !== "tildar" && !ROLES_GESTION.has(sesion.rol)) {
      return NextResponse.json({ error: "Solo el encargado o técnica pueden cambiar la hoja de sueltos" }, { status: 403 });
    }
    const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
    if (sinPlan) return sinPlan;
    const sinModulo = await requireModulo(sesion.empresa_id, "actividad");
    if (sinModulo) return sinModulo;
    try {
      return await procesar(sesion, parsed.data);
    } catch (err) {
      if (faltaMigracion(err)) {
        return NextResponse.json({ error: "Para la hoja de sueltos falta correr la migración 103 en Supabase." }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    logger.error("[sueltos] error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
