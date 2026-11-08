// /api/facturas-sueltas — Facturas que no pasaron por una orden de compra
// (costo de OT, parte D; migración 168; app/lib/facturasSueltas.js).
//
//   GET                      → últimas facturas, con cuántos renglones están asociados
//   GET ?id=12               → una factura con sus renglones
//   GET ?vista=sin_asociar   → renglones sin artículo de las facturas y listas
//        vigentes (sin los marcados "No es del MRP")
//   POST { accion: "leer", archivo, tipo }  → la IA lee el PDF o la foto y
//        devuelve un borrador (con el artículo reconocido de cada renglón);
//        no guarda nada.
//   POST { accion: "guardar", ...factura }  → guarda la factura; reconoce los
//        renglones sin artículo y el precio de cada renglón asociado entra a
//        la lista de precios. Lo elegido a mano se recuerda para ese proveedor.
//   POST { accion: "asociar", renglon_id, sku } → elige el artículo de un renglón.
//   POST { accion: "descartar", renglon_ids | factura_id } → "No es del MRP":
//        salen de Sin asociar (de una lista, todos los que quedan sin asociar).
//   POST { accion: "restaurar", renglon_id } → vuelve a Sin asociar.
// Desde la 169 una "factura" puede ser una lista de precios (tipo 'lista'):
// hasta 5000 renglones, cantidad 1; se guarda en tandas.
//   POST { accion: "anular", id } → anula la factura y saca sus precios de la lista.
//
// Dueño y Administración (gestión). Lee y escribe con la clave del servidor
// después de verificar el rol, filtrando siempre por su empresa.
import { NextResponse } from "next/server";
import { validarToken, respuestaNoAutorizado } from "../../lib/auth";
import { safeErrorMessage } from "../../lib/validate";
import { sbDelete, sbGet, sbGetAll, sbHeaders, sbPatch, sbPost } from "../../lib/sbHelpers";
import { ROLES_GESTION } from "../../lib/dataPolicy";
import { SKU_VALIDO } from "../../lib/stock";
import { logger } from "../../lib/logger";
import { logAudit } from "../../lib/audit";
import { ipCliente } from "../../lib/ip";
import {
  MAX_ARCHIVO_B64, TIPOS_ARCHIVO, borradorDeLectura, claveProveedor, filaPrecioFactura, filasAsociacion,
  reconocerRenglon, validarFactura,
} from "../../lib/facturasSueltas";
import { ErrorIa, leerFacturaIa } from "../../lib/facturaIa";

export const maxDuration = 60;

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const FALTA = "Para las facturas sueltas y listas de precios falta correr las migraciones 168, 169 y 170 en Supabase.";
const faltaMigracion = (err) => /facturas_sueltas|asociaciones_articulos/.test(String(err?.message));
const TANDA = 1000;
const SIN_ASOCIAR = "sku=is.null&asociado_como=is.null";

/** Cuántas filas cumplen el filtro (sin traerlas). */
async function contar(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}&limit=1`, { headers: await sbHeaders({}, { Prefer: "count=exact" }) });
  if (!r.ok) throw new Error(`GET ${path}: ${await r.text()}`);
  const total = Number(String(r.headers.get("content-range") || "").split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

async function enTandas(filas, fn) {
  const out = [];
  for (let i = 0; i < filas.length; i += TANDA) out.push(...((await fn(filas.slice(i, i + TANDA))) || []));
  return out;
}

async function sesionGestion(request) {
  const sesion = await validarToken(request);
  if (!sesion?.empresa_id) return { response: respuestaNoAutorizado() };
  if (!ROLES_GESTION.has(sesion.rol)) {
    return { response: NextResponse.json({ error: "Solo el dueño y la oficina cargan facturas sueltas" }, { status: 403 }) };
  }
  return { sesion };
}

async function nombreDe(sesion) {
  if (!sesion.empleado_id) return null;
  const [emp] = (await sbGet(`empleados?id=eq.${sesion.empleado_id}&empresa_id=eq.${sesion.empresa_id}&select=nombre&limit=1`, { silent: true, fallback: [] })) || [];
  return emp?.nombre ? String(emp.nombre).slice(0, 120) : null;
}

async function articulosDe(e) {
  const { data } = await sbGetAll(`articulos_stock?empresa_id=eq.${e}&select=sku,nombre`, { maxFilas: 20000 });
  return data || [];
}

async function asociacionesDe(e, proveedor) {
  const p = claveProveedor(proveedor);
  if (!p) return [];
  return (await sbGet(`asociaciones_articulos?empresa_id=eq.${e}&proveedor_clave=eq.${encodeURIComponent(p)}&select=tipo,clave,sku`)) || [];
}

async function upsert(tabla, conflicto, filas) {
  if (!filas.length) return;
  const r = await fetch(`${SB_URL}/rest/v1/${tabla}?on_conflict=${conflicto}`, {
    method: "POST",
    headers: await sbHeaders({}, { Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(filas),
  });
  if (!r.ok) throw new Error(`POST ${tabla}: ${await r.text()}`);
}

const recordar = (filas) => upsert("asociaciones_articulos", "empresa_id,proveedor_clave,tipo,clave", filas);
const guardarPrecios = (filas) => enTandas(filas, (t) => upsert("precios_articulos", "empresa_id,origen,referencia", t));

export async function GET(request) {
  try {
    const { sesion, response } = await sesionGestion(request);
    if (response) return response;
    const e = sesion.empresa_id;
    const params = new URL(request.url).searchParams;
    try {
      const id = params.get("id");
      if (id) {
        if (!/^\d{1,15}$/.test(id)) return NextResponse.json({ error: "Factura inválida" }, { status: 400 });
        const [factura] = (await sbGet(`facturas_sueltas?id=eq.${id}&empresa_id=eq.${e}&select=*&limit=1`)) || [];
        if (!factura) return NextResponse.json({ error: "No encontré esa factura" }, { status: 404 });
        const { data: renglones } = await sbGetAll(`facturas_sueltas_renglones?factura_id=eq.${id}&empresa_id=eq.${e}&select=*&order=orden.asc,id.asc`, { maxFilas: 10000 });
        return NextResponse.json({ ok: true, factura, renglones });
      }
      if (params.get("vista") === "sin_asociar") {
        const { data } = await sbGetAll(`facturas_sueltas_renglones?empresa_id=eq.${e}&${SIN_ASOCIAR}&select=id,descripcion,codigo,detalle,cantidad,precio,factura_id,facturas_sueltas!inner(tipo,proveedor,numero,fecha,moneda,anulada_at)&facturas_sueltas.anulada_at=is.null&order=id.desc`, { maxFilas: 5000 });
        return NextResponse.json({ ok: true, renglones: data || [] });
      }
      const facturas = (await sbGet(`facturas_sueltas?empresa_id=eq.${e}&select=*,facturas_sueltas_renglones(cantidad,precio,sku,asociado_como)&order=created_at.desc,id.desc&limit=100`)) || [];
      const sinAsociar = await contar(`facturas_sueltas_renglones?empresa_id=eq.${e}&${SIN_ASOCIAR}&select=id,facturas_sueltas!inner(anulada_at)&facturas_sueltas.anulada_at=is.null`);
      return NextResponse.json({ ok: true, facturas, sinAsociar });
    } catch (err) {
      if (faltaMigracion(err)) return NextResponse.json({ ok: false, falta_migracion: FALTA });
      throw err;
    }
  } catch (err) {
    logger.error("[facturas-sueltas] GET", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

async function leer(request, sesion, d) {
  const tipo = String(d?.tipo ?? "");
  const archivo = typeof d?.archivo === "string" ? d.archivo : "";
  if (!TIPOS_ARCHIVO.includes(tipo)) return NextResponse.json({ error: "Subí un PDF, una foto (JPG, PNG o WEBP) o un Excel" }, { status: 400 });
  if (!archivo || archivo.length > MAX_ARCHIVO_B64 || !/^[A-Za-z0-9+/=]+$/.test(archivo.slice(0, 2000))) {
    return NextResponse.json({ error: "El archivo es muy grande (hasta 3 MB) o no se pudo leer" }, { status: 400 });
  }
  let r;
  try {
    r = await leerFacturaIa({ base64: archivo, tipo });
  } catch (err) {
    if (err instanceof ErrorIa) return NextResponse.json({ error: err.message }, { status: 502 });
    throw err;
  }
  logAudit({
    empresa_id: sesion.empresa_id, actor_id: sesion.empleado_id, actor_legajo: sesion.legajo, actor_rol: sesion.rol,
    accion: "chat_ia", entidad: "factura_suelta",
    datos_despues: { tipo: r.lectura?.tipo_documento === "lista" ? "lista_precios" : "factura", tokens_input: r.uso.input_tokens, tokens_output: r.uso.output_tokens, model: r.modelo },
    ip: ipCliente(request),
  });
  const borrador = borradorDeLectura(r.lectura);
  const [articulos, asociaciones] = await Promise.all([articulosDe(sesion.empresa_id), asociacionesDe(sesion.empresa_id, borrador.proveedor)]);
  const nombres = new Map(articulos.map((a) => [a.sku, a.nombre]));
  borrador.renglones = borrador.renglones.map((ren) => {
    const rec = reconocerRenglon(ren, { asociaciones, articulos });
    return rec ? { ...ren, sku: rec.sku, nombre_articulo: nombres.get(rec.sku) || null, como: rec.como } : { ...ren, sku: null };
  });
  return NextResponse.json({ ok: true, borrador });
}

async function guardar(sesion, d) {
  const e = sesion.empresa_id;
  const v = validarFactura(d);
  if (v.error) return NextResponse.json({ error: v.error }, { status: 400 });
  const [articulos, asociaciones, nombre] = await Promise.all([articulosDe(e), asociacionesDe(e, v.factura.proveedor), nombreDe(sesion)]);
  const existe = new Set(articulos.map((a) => a.sku));
  const malo = v.renglones.find((r) => r.sku && !existe.has(r.sku));
  if (malo) return NextResponse.json({ error: `El artículo ${malo.sku} no está en el MRP` }, { status: 400 });
  const ahora = new Date().toISOString();

  const [factura] = (await sbPost("facturas_sueltas", { empresa_id: e, ...v.factura, cargada_por_nombre: nombre })) || [];
  const filas = v.renglones.map((r) => {
    // El artículo que vino elegido se respeta; si coincide con lo que Gypi
    // reconoce, queda anotado cómo, y si no, cuenta como elegido a mano
    const auto = reconocerRenglon(r, { asociaciones, articulos });
    const rec = r.sku ? { sku: r.sku, como: !r.manual && auto?.sku === r.sku ? auto.como : "manual" } : auto;
    const como = rec?.como || null;
    return {
      empresa_id: e, factura_id: factura.id, orden: r.orden, descripcion: r.descripcion, codigo: r.codigo, detalle: r.detalle,
      cantidad: r.cantidad, precio: r.precio, sku: rec?.sku || null, asociado_como: rec ? como : null,
      asociado_por_nombre: rec && como === "manual" ? nombre : null, asociado_at: rec ? ahora : null,
    };
  });
  const renglones = await enTandas(filas, (t) => sbPost("facturas_sueltas_renglones", t));
  await recordar(renglones.filter((r) => r.asociado_como === "manual").flatMap((r) => filasAsociacion(e, factura.proveedor, r, r.sku, nombre)));
  await guardarPrecios(renglones.filter((r) => r.sku).map((r) => filaPrecioFactura(e, factura, r)));
  const asociados = renglones.filter((r) => r.sku).length;
  return NextResponse.json({ ok: true, id: factura.id, asociados, sinAsociar: renglones.length - asociados });
}

async function asociar(sesion, d) {
  const e = sesion.empresa_id;
  const id = Number(d?.renglon_id);
  const sku = String(d?.sku ?? "");
  if (!Number.isInteger(id) || id <= 0 || !SKU_VALIDO.test(sku)) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const [renglon] = (await sbGet(`facturas_sueltas_renglones?id=eq.${id}&empresa_id=eq.${e}&select=*,facturas_sueltas!inner(*)&limit=1`)) || [];
  if (!renglon) return NextResponse.json({ error: "No encontré ese renglón" }, { status: 404 });
  const factura = renglon.facturas_sueltas;
  if (factura.anulada_at) return NextResponse.json({ error: "La factura está anulada" }, { status: 409 });
  const [art] = (await sbGet(`articulos_stock?empresa_id=eq.${e}&sku=eq.${encodeURIComponent(sku)}&select=sku&limit=1`)) || [];
  if (!art) return NextResponse.json({ error: "Ese artículo no está en el MRP" }, { status: 400 });
  const nombre = await nombreDe(sesion);
  const [actual] = (await sbPatch(`facturas_sueltas_renglones?id=eq.${id}&empresa_id=eq.${e}`, {
    sku, asociado_como: "manual", asociado_por_nombre: nombre, asociado_at: new Date().toISOString(),
  })) || [];
  await recordar(filasAsociacion(e, factura.proveedor, renglon, sku, nombre));
  await guardarPrecios([filaPrecioFactura(e, factura, { ...renglon, ...actual, id: renglon.id, sku })]);
  return NextResponse.json({ ok: true });
}

async function descartar(sesion, d) {
  const e = sesion.empresa_id;
  const nombre = await nombreDe(sesion);
  const cambio = { asociado_como: "descartado", asociado_por_nombre: nombre, asociado_at: new Date().toISOString() };
  let filtro;
  if (d?.factura_id != null) {
    const fid = Number(d.factura_id);
    if (!Number.isInteger(fid) || fid <= 0) return NextResponse.json({ error: "Lista inválida" }, { status: 400 });
    filtro = `factura_id=eq.${fid}`;
  } else {
    const ids = Array.isArray(d?.renglon_ids) ? d.renglon_ids.map(Number) : [];
    if (!ids.length || ids.length > 500 || ids.some((n) => !Number.isInteger(n) || n <= 0)) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    filtro = `id=in.(${ids.join(",")})`;
  }
  const hechos = (await sbPatch(`facturas_sueltas_renglones?${filtro}&empresa_id=eq.${e}&${SIN_ASOCIAR}`, cambio)) || [];
  return NextResponse.json({ ok: true, descartados: hechos.length });
}

async function restaurar(sesion, d) {
  const e = sesion.empresa_id;
  const id = Number(d?.renglon_id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const [r] = (await sbPatch(`facturas_sueltas_renglones?id=eq.${id}&empresa_id=eq.${e}&asociado_como=eq.descartado`, {
    asociado_como: null, asociado_por_nombre: null, asociado_at: null,
  })) || [];
  if (!r) return NextResponse.json({ error: "No encontré ese renglón" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

async function anular(sesion, d) {
  const e = sesion.empresa_id;
  const id = Number(d?.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Factura inválida" }, { status: 400 });
  const nombre = await nombreDe(sesion);
  const [factura] = (await sbPatch(`facturas_sueltas?id=eq.${id}&empresa_id=eq.${e}&anulada_at=is.null`, { anulada_at: new Date().toISOString(), anulada_por_nombre: nombre })) || [];
  if (!factura) return NextResponse.json({ error: "No encontré esa factura o ya estaba anulada" }, { status: 404 });
  const { data: renglones } = await sbGetAll(`facturas_sueltas_renglones?factura_id=eq.${id}&empresa_id=eq.${e}&sku=not.is.null&select=id&order=id.asc`, { maxFilas: 10000 });
  for (let i = 0; i < (renglones || []).length; i += 200) {
    const refs = renglones.slice(i, i + 200).map((r) => `FS-${r.id}`).join(",");
    await sbDelete(`precios_articulos?empresa_id=eq.${e}&origen=eq.factura&referencia=in.(${refs})`);
  }
  return NextResponse.json({ ok: true });
}

export async function POST(request) {
  try {
    const { sesion, response } = await sesionGestion(request);
    if (response) return response;
    const d = await request.json().catch(() => null);
    try {
      switch (d?.accion) {
        case "leer": return await leer(request, sesion, d);
        case "guardar": return await guardar(sesion, d);
        case "asociar": return await asociar(sesion, d);
        case "descartar": return await descartar(sesion, d);
        case "restaurar": return await restaurar(sesion, d);
        case "anular": return await anular(sesion, d);
        default: return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
      }
    } catch (err) {
      if (faltaMigracion(err)) return NextResponse.json({ error: FALTA }, { status: 409 });
      throw err;
    }
  } catch (err) {
    logger.error("[facturas-sueltas] POST", err);
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
