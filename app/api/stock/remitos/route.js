// /api/stock/remitos — Ingreso al stock por foto del remito (parte 7 del plan
// Finanzas e Inventario, 11/11; migración 182; reglas en app/lib/remitosStock.js).
//
//   GET → los remitos para revisar (la oficina ve todos; los demás, los suyos)
//         y los últimos revisados.
//   POST { accion: "leer", foto_url } → la IA lee la foto (ya subida por
//         /api/upload) y devuelve el borrador con el artículo de cada renglón,
//         la orden de compra abierta que parece ser y si ese comprobante ya
//         entró. No guarda nada.
//   POST { accion: "guardar", proveedor, numero, fecha, foto_url, renglones,
//         notas?, confirmar?, forzar? } → queda para revisar; la oficina, con
//         confirmar, lo manda al stock en el momento.
//   POST { accion: "confirmar", id, ...cambios, forzar? } → la oficina lo
//         revisa (con lo que haya corregido) y entra al stock.
//   POST { accion: "descartar", id } → la oficina, o quien lo cargó mientras
//         sigue para revisar.
//   POST { accion: "ticket", foto_url, proveedor?, numero?, fecha? } → el
//         ticket de materiales de Mi caja: la IA lo lee y queda para revisar.
//
// Cualquiera de la empresa con el módulo Stock carga; confirman el Dueño y
// Administración. Lee y escribe con la clave del servidor, siempre filtrando
// por la empresa.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../../lib/auth";
import { safeErrorMessage } from "../../../lib/validate";
import { sbGet, sbGetAll, sbHeaders, sbPatch, sbPost } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { requireModuloSesion } from "../../../lib/accesosServidor";
import { broadcastRefresh } from "../../../lib/broadcast";
import { checkRateLimit } from "../../../lib/rateLimitMemory";
import { logAudit } from "../../../lib/audit";
import { ipCliente } from "../../../lib/ip";
import { logger } from "../../../lib/logger";
import { ROLES_GESTION } from "../../../lib/dataPolicy";
import { ESTADOS_OC_ABIERTA } from "../../../lib/ordenesCompra";
import { comprobanteValido } from "../../../lib/finanzasMiCaja";
import { MAX_ARCHIVO_B64, claveProveedor, filasAsociacion } from "../../../lib/facturasSueltas";
import { ErrorIa, leerDocumentoIa } from "../../../lib/facturaIa";
import { avisoIngresoRepetido, buscarIngresoRepetido } from "../../../lib/stockIngresos";
import {
  ESQUEMA_REMITO, PROMPT_REMITO, avisoOrden, borradorRemito, faltaParaConfirmar, ingresosDeRemito, ordenParaRecibir, validarRemito,
} from "../../../lib/remitosStock";

export const maxDuration = 60;

const FALTA = "Para el ingreso por foto del remito falta correr la migración 182 en Supabase.";
const faltaMigracion = (err) => /remitos_stock/.test(String(err?.message)) && /does not exist|42P01|PGRST20[045]|schema cache/.test(String(err?.message));
const TIPO_FOTO = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
const COLS = "id,origen,proveedor,numero,fecha,foto_url,renglones,notas,estado,cargado_por,cargado_por_nombre,revisado_por_nombre,revisado_at,created_at";
const esGestion = (sesion) => ROLES_GESTION.has(sesion.rol);
const enLista = (vals) => encodeURIComponent(`(${[...new Set(vals)].map((v) => `"${String(v).replace(/["\\]/g, "")}"`).join(",")})`);

/**
 * Lo elegido para cada renglón queda recordado para ese proveedor (la misma
 * memoria que las facturas sin OC): el próximo remito lo reconoce solo. Si
 * falla no frena el ingreso.
 */
async function recordar(e, remito, nombre) {
  const filas = (remito.renglones || []).filter((r) => r.sku && r.descripcion).flatMap((r) => filasAsociacion(e, remito.proveedor, r, r.sku, nombre));
  if (!filas.length) return;
  const unicas = [...new Map(filas.map((f) => [`${f.tipo}|${f.clave}`, f])).values()];
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/asociaciones_articulos?on_conflict=empresa_id,proveedor_clave,tipo,clave`, {
      method: "POST",
      headers: await sbHeaders({}, { Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(unicas),
    });
    if (!r.ok) logger.warn("[stock/remitos] recordar artículos", await r.text());
  } catch (err) {
    logger.warn("[stock/remitos] recordar artículos", err);
  }
}

async function nombreDe(sesion) {
  if (!sesion.empleado_id) return null;
  const [emp] = (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=nombre&limit=1`, { silent: true, fallback: [] })) || [];
  return emp?.nombre ? String(emp.nombre).slice(0, 120) : null;
}

/** La orden abierta que parece ser y el aviso de comprobante repetido. */
async function avisosDe(e, remito) {
  const avisos = [];
  const [ordenes, repetido] = await Promise.all([
    remito.proveedor ? sbGet(`ordenes_compra?empresa_id=eq.${e}&estado=in.(${ESTADOS_OC_ABIERTA.join(",")})&select=id,numero,proveedor_nombre&order=id.desc&limit=200`, { silent: true, fallback: [] }) : Promise.resolve([]),
    buscarIngresoRepetido(sbGet, e, { proveedor: remito.proveedor, comprobante: remito.numero }),
  ]);
  let orden = null;
  const skus = remito.renglones.map((r) => r.sku).filter(Boolean);
  if (ordenes?.length && skus.length) {
    const items = (await sbGet(`ordenes_compra_items?empresa_id=eq.${e}&orden_id=in.(${ordenes.map((o) => Number(o.id)).join(",")})&sku=in.${enLista(skus)}&select=orden_id,sku`, { silent: true, fallback: [] })) || [];
    orden = ordenParaRecibir(remito, ordenes, items);
  }
  if (orden) avisos.push(avisoOrden(orden));
  if (repetido) avisos.push(avisoIngresoRepetido(repetido));
  return { avisos, orden, repetido };
}

/** La IA lee la foto y Gypi reconoce los artículos: { borrador } o { response } con el error. */
async function lectura(request, sesion, url, proveedor = null) {
  const e = sesion.empresa_id;
  const tipo = TIPO_FOTO[(url.match(/\.([a-z]+)$/i)?.[1] || "").toLowerCase()];
  if (!url || !tipo || !comprobanteValido(url, { supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, empresaId: e })) {
    return { response: NextResponse.json({ error: "Sacá la foto del remito de nuevo" }, { status: 400 }) };
  }
  if (checkRateLimit(`remito-foto:${sesion.empleado_id || sesion.legajo}`, 30, 60 * 60 * 1000).limited) {
    return { response: NextResponse.json({ error: "Leíste muchos remitos seguidos: cargá este a mano." }, { status: 429 }) };
  }
  const res = await fetch(url).catch(() => null);
  if (!res?.ok) return { response: NextResponse.json({ error: "No se pudo bajar la foto del remito" }, { status: 400 }) };
  const archivo = Buffer.from(await res.arrayBuffer()).toString("base64");
  if (archivo.length > MAX_ARCHIVO_B64) return { response: NextResponse.json({ error: "La foto es muy grande para leerla" }, { status: 400 }) };
  let r;
  try {
    r = await leerDocumentoIa({ base64: archivo, tipo, sistema: PROMPT_REMITO, esquema: ESQUEMA_REMITO, maxTokens: 6000 });
  } catch (err) {
    if (err instanceof ErrorIa) return { response: NextResponse.json({ error: `${err.message} Cargá los artículos a mano.` }, { status: 502 }) };
    throw err;
  }
  logAudit({
    empresa_id: e, actor_id: sesion.empleado_id, actor_legajo: sesion.legajo, actor_rol: sesion.rol,
    accion: "chat_ia", entidad: "remitos_stock",
    datos_despues: { tipo: "remito_stock", tokens_input: r.uso.input_tokens, tokens_output: r.uso.output_tokens, model: r.modelo },
    ip: ipCliente(request),
  });
  const p = claveProveedor(proveedor || r.lectura?.proveedor);
  const [{ data: articulos }, asociaciones] = await Promise.all([
    sbGetAll(`articulos_stock?empresa_id=eq.${e}&activo=eq.true&select=sku,nombre&order=sku.asc`, { maxFilas: 20000 }),
    p ? sbGet(`asociaciones_articulos?empresa_id=eq.${e}&proveedor_clave=eq.${encodeURIComponent(p)}&select=tipo,clave,sku`, { silent: true, fallback: [] }) : Promise.resolve([]),
  ]);
  return { borrador: borradorRemito(r.lectura, { articulos: articulos || [], asociaciones: asociaciones || [] }) };
}

async function leer(request, sesion, d) {
  const url = String(d?.foto_url || "");
  const { borrador, response } = await lectura(request, sesion, url);
  if (response) return response;
  const { avisos, orden } = await avisosDe(sesion.empresa_id, borrador);
  return NextResponse.json({ ok: true, borrador: { ...borrador, foto_url: url }, avisos, orden });
}

/**
 * Ticket de materiales de Mi caja (11/11, conexión del plan): la IA lee los
 * renglones de la foto del ticket y queda para revisar en Stock, con el
 * comercio, el número y la fecha que se cargaron en Mi caja.
 */
async function ticket(request, sesion, d) {
  const e = sesion.empresa_id;
  const url = String(d?.foto_url || "");
  const { borrador, response } = await lectura(request, sesion, url, String(d.proveedor || "").trim() || null);
  if (response) return response;
  const datos = {
    proveedor: String(d.proveedor || "").trim() || borrador.proveedor,
    numero: String(d.numero || "").trim() || borrador.numero,
    fecha: d.fecha || borrador.fecha,
    notas: "Ticket de Mi caja",
    renglones: borrador.renglones,
  };
  const { remito, errores } = validarRemito(datos, { skus: await skusDe(e, datos.renglones), sinCantidades: true });
  if (errores.length) return NextResponse.json({ error: "No pude leer los materiales del ticket: cargalos en Stock → Movimientos." }, { status: 400 });
  const [nuevo] = (await sbPost("remitos_stock", {
    ...remito, empresa_id: e, origen: "ticket", foto_url: url, estado: "para_revisar",
    cargado_por: sesion.empleado_id || null, cargado_por_nombre: await nombreDe(sesion),
  })) || [];
  broadcastRefresh(e, "remitos_stock");
  return NextResponse.json({ ok: true, id: nuevo?.id || null, estado: "para_revisar", renglones: remito.renglones.length });
}

/** Los ingresos al stock del remito y el remito confirmado. */
async function alStock(sesion, fila, d) {
  const e = sesion.empresa_id;
  const falta = faltaParaConfirmar(fila);
  if (falta) return NextResponse.json({ error: falta }, { status: 400 });
  if (!d.forzar) {
    const repetido = await buscarIngresoRepetido(sbGet, e, { proveedor: fila.proveedor, comprobante: fila.numero });
    if (repetido) return NextResponse.json({ error: avisoIngresoRepetido(repetido), repetido: true }, { status: 409 });
  }
  const skus = [...new Set(fila.renglones.map((r) => r.sku))];
  const articulos = (await sbGet(`articulos_stock?empresa_id=eq.${e}&sku=in.${enLista(skus)}&select=sku,nombre,unidad,division`)) || [];
  const nombre = await nombreDe(sesion);
  const ahora = new Date().toISOString();
  const [remito] = fila.id
    ? (await sbPatch(`remitos_stock?id=eq.${fila.id}&empresa_id=eq.${e}&estado=eq.para_revisar`, {
      proveedor: fila.proveedor, numero: fila.numero, fecha: fila.fecha, notas: fila.notas, renglones: fila.renglones,
      estado: "confirmado", revisado_por_nombre: nombre, revisado_at: ahora,
    })) || []
    : (await sbPost("remitos_stock", { ...fila, empresa_id: e, estado: "confirmado", revisado_por_nombre: nombre, revisado_at: ahora })) || [];
  if (!remito) return NextResponse.json({ error: "Ese remito ya se revisó" }, { status: 409 });
  const filas = ingresosDeRemito({ ...remito, empresa_id: e }, articulos, { empleado_id: sesion.empleado_id, legajo: sesion.legajo, empleado_nombre: nombre });
  await sbPost("movimientos_stock", filas);
  await recordar(e, remito, nombre);
  broadcastRefresh(e, "movimientos_stock");
  broadcastRefresh(e, "remitos_stock");
  return NextResponse.json({ ok: true, id: remito.id, estado: "confirmado", cargados: filas.length });
}

async function skusDe(e, renglones) {
  const skus = [...new Set((renglones || []).map((r) => String(r?.sku || "").trim()).filter(Boolean))];
  if (!skus.length) return new Set();
  const filas = (await sbGet(`articulos_stock?empresa_id=eq.${e}&sku=in.${enLista(skus)}&select=sku`)) || [];
  return new Set(filas.map((a) => a.sku));
}

async function guardar(sesion, d) {
  const e = sesion.empresa_id;
  const url = d.foto_url ? String(d.foto_url) : null;
  if (url && !comprobanteValido(url, { supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, empresaId: e })) {
    return NextResponse.json({ error: "La foto del remito no es válida: sacala de nuevo" }, { status: 400 });
  }
  const { remito, errores } = validarRemito(d, { skus: await skusDe(e, d.renglones) });
  if (errores.length) return NextResponse.json({ error: errores[0], errores }, { status: 400 });
  const fila = { ...remito, origen: d.origen === "ticket" ? "ticket" : "remito", foto_url: url, cargado_por: sesion.empleado_id || null, cargado_por_nombre: await nombreDe(sesion) };
  if (d.confirmar) {
    if (!esGestion(sesion)) return NextResponse.json({ error: "Lo confirma la oficina: mandalo a revisar" }, { status: 403 });
    return await alStock(sesion, fila, d);
  }
  const [nuevo] = (await sbPost("remitos_stock", { ...fila, empresa_id: e, estado: "para_revisar" })) || [];
  broadcastRefresh(e, "remitos_stock");
  return NextResponse.json({ ok: true, id: nuevo?.id || null, estado: "para_revisar" });
}

async function leerRemito(e, id) {
  if (!Number.isInteger(id) || id <= 0) return null;
  const [r] = (await sbGet(`remitos_stock?id=eq.${id}&empresa_id=eq.${e}&select=${COLS}&limit=1`)) || [];
  return r || null;
}

async function confirmar(sesion, d) {
  if (!esGestion(sesion)) return NextResponse.json({ error: "Lo confirma la oficina" }, { status: 403 });
  const e = sesion.empresa_id;
  const actual = await leerRemito(e, Number(d.id));
  if (!actual) return NextResponse.json({ error: "No encontré ese remito" }, { status: 404 });
  if (actual.estado !== "para_revisar") return NextResponse.json({ error: "Ese remito ya se revisó" }, { status: 409 });
  // Lo que corrigió la oficina al revisarlo; si no manda cambios, el remito como está
  const datos = {
    proveedor: "proveedor" in d ? d.proveedor : actual.proveedor,
    numero: "numero" in d ? d.numero : actual.numero,
    fecha: "fecha" in d ? d.fecha : actual.fecha,
    notas: "notas" in d ? d.notas : actual.notas,
    renglones: "renglones" in d ? d.renglones : actual.renglones,
  };
  const { remito, errores } = validarRemito(datos, { skus: await skusDe(e, datos.renglones) });
  if (errores.length) return NextResponse.json({ error: errores[0], errores }, { status: 400 });
  return await alStock(sesion, { ...remito, id: actual.id }, d);
}

async function descartar(sesion, d) {
  const e = sesion.empresa_id;
  const actual = await leerRemito(e, Number(d.id));
  if (!actual) return NextResponse.json({ error: "No encontré ese remito" }, { status: 404 });
  if (actual.estado !== "para_revisar") return NextResponse.json({ error: "Ese remito ya se revisó" }, { status: 409 });
  if (!esGestion(sesion) && actual.cargado_por !== sesion.empleado_id) return NextResponse.json({ error: "Solo podés descartar los remitos que cargaste vos" }, { status: 403 });
  await sbPatch(`remitos_stock?id=eq.${actual.id}&empresa_id=eq.${e}&estado=eq.para_revisar`, { estado: "descartado", revisado_por_nombre: await nombreDe(sesion), revisado_at: new Date().toISOString() });
  broadcastRefresh(e, "remitos_stock");
  return NextResponse.json({ ok: true, estado: "descartado" });
}

async function chequeos(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return { response: respuestaNoAutorizado() };
  const sinModulo = await requireModuloSesion(sesion, "stock");
  if (sinModulo) return { response: sinModulo };
  return { sesion };
}

export async function GET(request) {
  try {
    const { sesion, response } = await chequeos(request);
    if (response) return response;
    const e = sesion.empresa_id;
    if (!esGestion(sesion) && !sesion.empleado_id) return NextResponse.json({ ok: true, pendientes: [], revisados: [], puede_confirmar: false });
    const mios = esGestion(sesion) ? "" : `&cargado_por=eq.${sesion.empleado_id}`;
    try {
      const [pendientes, revisados] = await Promise.all([
        sbGet(`remitos_stock?empresa_id=eq.${e}&estado=eq.para_revisar${mios}&select=${COLS}&order=created_at.desc,id.desc&limit=50`),
        sbGet(`remitos_stock?empresa_id=eq.${e}&estado=neq.para_revisar${mios}&select=${COLS}&order=created_at.desc,id.desc&limit=10`),
      ]);
      return NextResponse.json({ ok: true, pendientes: pendientes || [], revisados: revisados || [], puede_confirmar: esGestion(sesion) });
    } catch (err) {
      if (faltaMigracion(err)) return NextResponse.json({ ok: false, falta_migracion: FALTA });
      throw err;
    }
  } catch (err) {
    logger.error("[stock/remitos] GET", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { sesion, response } = await chequeos(request);
    if (response) return response;
    const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
    if (sinPlan) return sinPlan;
    const d = await request.json().catch(() => null);
    if (!d || typeof d !== "object") return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    try {
      switch (d.accion) {
        case "leer": return await leer(request, sesion, d);
        case "ticket": return await ticket(request, sesion, d);
        case "guardar": return await guardar(sesion, d);
        case "confirmar": return await confirmar(sesion, d);
        case "descartar": return await descartar(sesion, d);
        default: return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
      }
    } catch (err) {
      if (faltaMigracion(err)) return NextResponse.json({ error: FALTA }, { status: 409 });
      throw err;
    }
  } catch (err) {
    logger.error("[stock/remitos] POST", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
