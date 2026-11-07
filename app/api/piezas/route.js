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
//   destino → 📍 Destinos (163): módulos que van sueltos, piezas sin módulo
//            a un módulo o sueltas, herrajes sueltos o dentro del mueble
//            (app/lib/destinosPiezas.js). Después corrige el módulo de las
//            piezas asignadas y deja 📦 Sueltos al día.
// Con RLS_RUTAS=on todo va con el pase del usuario ({ sesion }).
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { validateBody, safeErrorMessage } from "../../lib/validate";
import { piezasBody } from "../../lib/schemas";
import { sbGet, sbPatch, sbDelete, sbHeaders } from "../../lib/sbHelpers";
import { ROLES_GESTION } from "../../lib/dataPolicy";
import { broadcastRefresh } from "../../lib/broadcast";
import { rechazarSiSinPlan, requireModulo } from "../../lib/planEnforcement";
import { ordenarEtapas, guardarPiezas, leerDestinos, aplicarDestinos } from "../../lib/piezasServidor";
import { moduloDe } from "../../lib/piezas";
import { logger } from "../../lib/logger";

function faltaMigracion(err) {
  const m = String(err?.message);
  return m.includes("piezas_ot") && /does not exist|could not find|PGRST205|42P01/i.test(m);
}
const faltaDestinos = (err) => /destinos_ot|origen/.test(String(err?.message)) && /does not exist|could not find|PGRST20|42P01|42703/i.test(String(err?.message));
const falta112 = (err) => /por_pieza|columna_pieza/.test(String(err?.message));

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

  if (datos.accion === "destino") return cambiarDestinos(sesion, proyecto.ot, datos.cambios);

  // cargar
  const r = await guardarPiezas({ e, ot: proyecto.ot, renglones: datos.renglones, opts, empleadoId: sesion.empleado_id || null });
  // Las piezas sin módulo que ya tenían destino vuelven a su módulo; sin la 163, nada
  await aplicarDestinos({ e, ot: proyecto.ot, opts }).catch((err) => {
    if (!faltaDestinos(err)) logger.error("[piezas] destinos al pegar", err);
  });
  broadcastRefresh(e, "piezas_ot");
  const { noBorradas: _n, ...cambios } = r;
  return NextResponse.json({ ok: true, ...cambios });
}

/** 📍 Destinos: valida cada cambio contra las piezas de la OT y lo guarda. */
async function cambiarDestinos(sesion, ot, cambios) {
  const e = sesion.empresa_id;
  const opts = { sesion };
  const { piezas, destinos } = await leerDestinos({ e, ot, opts });
  const nombres = new Set(piezas.map((p) => p.nombre));
  const modulos = new Set(piezas.map((p) => moduloDe(p.nombre)).filter(Boolean));
  const herrajes = new Set(destinos.filter((d) => d.tipo === "herraje").map((d) => d.clave));
  const ahora = new Date().toISOString();
  const filas = new Map();
  for (const c of cambios) {
    let fila;
    if (c.tipo === "modulo") {
      if (!modulos.has(c.clave)) return NextResponse.json({ error: `La OT no tiene el módulo ${c.clave}` }, { status: 400 });
      fila = { suelto: c.suelto ? true : null, modulo: null };
    } else if (c.tipo === "pieza") {
      if (!nombres.has(c.clave)) return NextResponse.json({ error: `No encontré la pieza ${c.clave}` }, { status: 404 });
      if (moduloDe(c.clave)) return NextResponse.json({ error: `${c.clave} ya es del módulo ${moduloDe(c.clave)} por su código. Si va en otro, se corrige en la planilla.` }, { status: 400 });
      if (c.modulo && !modulos.has(c.modulo)) return NextResponse.json({ error: `La OT no tiene el módulo ${c.modulo}` }, { status: 400 });
      fila = c.suelto === true ? { suelto: true, modulo: null } : c.modulo ? { suelto: null, modulo: c.modulo } : { suelto: c.suelto === false ? false : null, modulo: null };
    } else {
      if (!herrajes.has(c.clave)) return NextResponse.json({ error: "No encontré ese herraje en la planilla de la OT" }, { status: 404 });
      fila = { suelto: c.suelto, modulo: null };
    }
    filas.set(`${c.tipo}|${c.clave}`, { empresa_id: e, ot, tipo: c.tipo, clave: c.clave, ...fila, actualizado_por: sesion.empleado_id || null, updated_at: ahora });
  }
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/destinos_ot?on_conflict=empresa_id,ot,tipo,clave`, {
    method: "POST",
    headers: await sbHeaders(opts, { Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify([...filas.values()]),
  });
  if (!r.ok) throw new Error(`POST destinos_ot: ${await r.text()}`);
  const a = await aplicarDestinos({ e, ot, opts });
  broadcastRefresh(e, "piezas_ot");
  broadcastRefresh(e, "sueltos_ot");
  return NextResponse.json({ ok: true, cambios: filas.size, sueltos: a.sueltos.ids.length });
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
      if (faltaDestinos(err)) {
        return NextResponse.json({ error: "Para los destinos de módulos y piezas falta correr la migración 163 en Supabase." }, { status: 409 });
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
