// POST /api/piezas — Piezas de cada OT con etiqueta QR (Órdenes de
// Producción, parte 17; migración 109).
//
// Body: { accion, ... } (solo gestión)
//   cargar → pega la planilla técnica: una pieza por unidad física. Las que
//            ya estaban (mismo nombre y número) conservan su id, así las
//            etiquetas impresas siguen valiendo; las que ya no están se borran.
//   etapas → cambia las etapas de un renglón (todas sus unidades)
// Las etapas de cada pieza son códigos de las etapas de la empresa que se
// escanean por pieza (migración 112); se guardan en el orden de las etapas.
//   vaciar → borra las piezas de la OT (se pegó mal)
// Con RLS_RUTAS=on todo va con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { piezasBody } from "../../lib/schemas";
import { sbGet, sbGetAll, sbPatch, sbDelete, sbHeaders } from "../../lib/sbHelpers";
import { ROLES_GESTION } from "../../lib/dataPolicy";
import { broadcastRefresh } from "../../lib/broadcast";
import { rechazarSiSinPlan, requireModulo } from "../../lib/planEnforcement";
import { expandirPiezas, cambiosAlReemplazar, reglasPieza } from "../../lib/piezas";
import { logger } from "../../lib/logger";

const LOTE = 500;

function faltaMigracion(err) {
  const m = String(err?.message);
  return m.includes("piezas_ot") && /does not exist|could not find|PGRST205|42P01/i.test(m);
}
const falta112 = (err) => /por_pieza|columna_pieza/.test(String(err?.message));

/** Deja solo las etapas de la empresa que se escanean por pieza, en su orden. */
async function ordenarEtapas(e, opts) {
  const etapas = (await sbGet(`etapas?empresa_id=eq.${e}&select=codigo,nombre,orden,activa,por_pieza,columna_pieza`, opts)) || [];
  const orden = reglasPieza(etapas).map((r) => r.codigo);
  return (lista) => orden.filter((c) => lista.includes(c));
}

async function upsertPiezas(filas, opts) {
  for (let i = 0; i < filas.length; i += LOTE) {
    const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/piezas_ot?on_conflict=empresa_id,ot,nombre,unidad`, {
      method: "POST",
      headers: await sbHeaders(opts, { Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(filas.slice(i, i + LOTE)),
    });
    if (!r.ok) throw new Error(`POST piezas_ot: ${await r.text()}`);
  }
}

async function procesar(sesion, datos) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const [proyecto] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(datos.ot)}&select=id,ot&limit=1`, opts)) || [];
  if (!proyecto) return NextResponse.json({ error: "No encontré esa OT" }, { status: 404 });
  const filtroOt = `piezas_ot?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(proyecto.ot)}`;

  if (datos.accion === "vaciar") {
    await sbDelete(filtroOt, opts);
    broadcastRefresh(e, "piezas_ot");
    return NextResponse.json({ ok: true });
  }

  const ordenar = await ordenarEtapas(e, opts);

  if (datos.accion === "etapas") {
    const etapas = ordenar(datos.etapas);
    const filas = (await sbPatch(`${filtroOt}&nombre=eq.${encodeURIComponent(datos.nombre)}`, { etapas }, opts)) || [];
    if (!filas.length) return NextResponse.json({ error: "No encontré esa pieza" }, { status: 404 });
    broadcastRefresh(e, "piezas_ot");
    return NextResponse.json({ ok: true, etapas, piezas: filas.length });
  }

  // cargar
  const { data: actuales } = await sbGetAll(`${filtroOt}&select=nombre,unidad&order=id.asc`, { sesion, maxFilas: 5000 });
  const piezas = expandirPiezas(datos.renglones);
  const cambios = cambiosAlReemplazar(actuales, piezas);
  const ahora = new Date().toISOString();
  // Mismas claves en todas las filas (PostgREST lo exige en un lote)
  await upsertPiezas(piezas.map((p) => ({
    empresa_id: e,
    ot: proyecto.ot,
    renglon: p.renglon,
    nombre: p.nombre,
    modulo: p.modulo,
    material: p.material,
    l1: p.l1,
    l2: p.l2,
    unidad: p.unidad,
    de: p.de,
    etapas: ordenar(p.etapas),
    cargada_at: ahora,
    creado_por: sesion.empleado_id || null,
  })), opts);
  // Lo que no vino en esta carga ya no está en la planilla
  if (cambios.salen) await sbDelete(`${filtroOt}&cargada_at=lt.${encodeURIComponent(ahora)}`, opts);
  broadcastRefresh(e, "piezas_ot");
  return NextResponse.json({ ok: true, piezas: piezas.length, ...cambios });
}

export async function POST(request) {
  try {
    const sesion = await validarToken(request);
    if (!sesion?.empresa_id) return respuestaNoAutorizado();
    if (!ROLES_GESTION.has(sesion.rol)) {
      return NextResponse.json({ error: "Solo el encargado o técnica pueden cargar las piezas" }, { status: 403 });
    }
    const raw = await request.json().catch(() => null);
    const parsed = validateBody(piezasBody, raw);
    if (parsed.response) return parsed.response;
    const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
    if (sinPlan) return sinPlan;
    const sinModulo = await requireModulo(sesion.empresa_id, "actividad");
    if (sinModulo) return sinModulo;
    try {
      return await procesar(sesion, parsed.data);
    } catch (err) {
      if (faltaMigracion(err)) {
        return NextResponse.json({ error: "Para las piezas con QR falta correr la migración 109 en Supabase." }, { status: 409 });
      }
      if (falta112(err)) {
        return NextResponse.json({ error: "Para elegir qué etapas se escanean por pieza falta correr la migración 112 en Supabase." }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    logger.error("[piezas] error", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
