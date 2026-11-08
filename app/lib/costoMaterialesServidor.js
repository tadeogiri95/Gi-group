// app/lib/costoMaterialesServidor.js — Lee y arma el costo de materiales de
// una OT (costo de OT, parte B; migraciones 164 y 165; app/lib/costoMateriales.js).
// Lo usan /api/costo-ot y el costo final al cerrar la OT (parte C). Va con la
// clave del servidor: quien lo llama ya verificó el permiso, y todo se filtra
// por la empresa.
import { sbGet, sbGetAll, sbHeaders } from "./sbHelpers";
import { costoMaterialesOt, elegirPrecio, fechaCargaOt, filaPrecioFijo } from "./costoMateriales";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const MAX_SKUS = 500;

export const FALTA_164 = "Para el costo de materiales falta correr la migración 164 en Supabase.";
export const FALTA_165 = "Para el costo de materiales falta correr la migración 165 en Supabase.";

/** Mensaje si el error es porque falta la 164 o la 165; si no, null. */
export function faltaMigracionCosto(err) {
  const m = String(err?.message);
  if (m.includes("precios_fijos_ot")) return FALTA_165;
  if (m.includes("v_precios_articulos") || m.includes("precios_articulos")) return FALTA_164;
  return null;
}

const lista = (skus) => skus.map((s) => `%22${encodeURIComponent(s)}%22`).join(",");

/** Precios de la vista para esos artículos (con precio en pesos), por artículo. */
export async function preciosDe(e, skus) {
  if (!skus.length) return new Map();
  const { data } = await sbGetAll(
    `v_precios_articulos?empresa_id=eq.${e}&sku=in.(${lista(skus)})&precio_ars=not.is.null&select=sku,fecha,precio,moneda,tipo_cambio,precio_ars,origen,referencia,proveedor,comprobante&order=sku.asc,fecha.asc,referencia.asc`,
    { maxFilas: 50000 }
  );
  const porSku = new Map();
  for (const p of data || []) {
    if (!porSku.has(p.sku)) porSku.set(p.sku, []);
    porSku.get(p.sku).push(p);
  }
  return porSku;
}

export async function proyectoDe(e, ot) {
  const [p] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}&select=ot,created_at&limit=1`)) || [];
  return p || null;
}

/** Guarda precios fijos nuevos; si el artículo ya tenía uno, queda el de antes. */
export async function guardarFijos(filas) {
  if (!filas.length) return;
  const r = await fetch(`${SB_URL}/rest/v1/precios_fijos_ot?on_conflict=empresa_id,ot,sku`, {
    method: "POST",
    headers: await sbHeaders({}, { Prefer: "resolution=ignore-duplicates,return=minimal" }),
    body: JSON.stringify(filas),
  });
  if (!r.ok) throw new Error(`POST precios_fijos_ot: ${await r.text()}`);
}

/**
 * Costo de materiales de la OT. Los artículos que todavía no tienen precio
 * fijo lo buscan y, si lo encuentran, queda guardado.
 * @returns {Promise<{ ot, fecha_ot, filas, total, sinPrecio, provisorio }>}
 */
export async function costoMaterialesDeOt(e, ot) {
  const o = encodeURIComponent(ot);
  const [proyecto, necesidades, fijosAntes, movimientos] = await Promise.all([
    proyectoDe(e, ot),
    sbGet(`necesidades_stock?empresa_id=eq.${e}&ot=eq.${o}&select=sku,nombre,cantidad`).catch(() => []),
    sbGet(`precios_fijos_ot?empresa_id=eq.${e}&ot=eq.${o}&select=*`),
    sbGet(`movimientos_stock?empresa_id=eq.${e}&ot=eq.${o}&anulado=eq.false&tipo=in.(consumo,devolucion)&select=sku,cantidad,tipo,anulado`).catch(() => []),
  ]);
  const fechaOt = fechaCargaOt(proyecto);
  const yaFijos = new Set((fijosAntes || []).map((f) => f.sku));
  const skus = [...new Set((necesidades || []).filter((n) => Number(n.cantidad) > 0).map((n) => n.sku))].slice(0, MAX_SKUS);
  const faltan = skus.filter((s) => !yaFijos.has(s));

  const precios = await preciosDe(e, faltan);
  const nuevos = [];
  for (const sku of faltan) {
    const p = elegirPrecio(precios.get(sku) || [], fechaOt);
    if (p) nuevos.push(filaPrecioFijo(e, ot, sku, p));
  }
  await guardarFijos(nuevos);
  const fijos = nuevos.length ? (await sbGet(`precios_fijos_ot?empresa_id=eq.${e}&ot=eq.${o}&select=*`)) || [] : fijosAntes || [];

  const articulos = skus.length
    ? (await sbGet(`articulos_stock?empresa_id=eq.${e}&sku=in.(${lista(skus)})&select=sku,nombre,unidad`).catch(() => [])) || []
    : [];
  const costo = costoMaterialesOt({ necesidades: necesidades || [], fijos, articulos, movimientos: movimientos || [] });
  return { ot, fecha_ot: fechaOt, ...costo };
}

const MAX_LOTE_OT = 60;
const MAX_LOTE_SKU = 150;
const trozos = (lista, n) => Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, i * n + n));
const agrupar = (filas) => {
  const m = new Map();
  for (const f of filas || []) {
    const k = String(f.ot);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(f);
  }
  return m;
};

/**
 * Costo de materiales de varias OT a la vez (reporte de costo, parte F). Igual
 * que costoMaterialesDeOt: lo que todavía no tiene precio fijo lo busca y lo fija.
 * @param {string} e empresa
 * @param {object[]} proyectos filas de proyectos (ot, created_at)
 * @returns {Promise<Map<string, { fecha_ot, filas, total, sinPrecio, provisorio }>>}
 */
export async function costoMaterialesDeOts(e, proyectos) {
  const out = new Map();
  for (const grupo of trozos(proyectos || [], MAX_LOTE_OT)) {
    const l = lista(grupo.map((p) => String(p.ot)));
    const [necesidades, fijosAntes, movimientos] = await Promise.all([
      sbGetAll(`necesidades_stock?empresa_id=eq.${e}&ot=in.(${l})&select=ot,sku,nombre,cantidad`, { maxFilas: 100000 }).then((r) => r.data).catch(() => []),
      sbGetAll(`precios_fijos_ot?empresa_id=eq.${e}&ot=in.(${l})&select=*`, { maxFilas: 100000 }).then((r) => r.data),
      sbGetAll(`movimientos_stock?empresa_id=eq.${e}&ot=in.(${l})&anulado=eq.false&tipo=in.(consumo,devolucion)&select=ot,sku,cantidad,tipo,anulado`, { maxFilas: 100000 }).then((r) => r.data).catch(() => []),
    ]);
    const necDe = agrupar(necesidades), fijosDe = agrupar(fijosAntes), movDe = agrupar(movimientos);
    // Lo que falta fijar, por OT
    const faltanDe = new Map();
    const todosFaltan = new Set();
    const todos = new Set();
    for (const p of grupo) {
      const ot = String(p.ot);
      const ya = new Set((fijosDe.get(ot) || []).map((f) => f.sku));
      const skus = [...new Set((necDe.get(ot) || []).filter((n) => Number(n.cantidad) > 0).map((n) => n.sku))].slice(0, MAX_SKUS);
      skus.forEach((s) => todos.add(s));
      const faltan = skus.filter((s) => !ya.has(s));
      faltan.forEach((s) => todosFaltan.add(s));
      faltanDe.set(ot, faltan);
    }
    const precios = new Map();
    for (const t of trozos([...todosFaltan], MAX_LOTE_SKU)) for (const [k, v] of await preciosDe(e, t)) precios.set(k, v);
    const nuevos = [];
    for (const p of grupo) {
      const ot = String(p.ot);
      const fechaOt = fechaCargaOt(p);
      for (const sku of faltanDe.get(ot)) {
        const elegido = elegirPrecio(precios.get(sku) || [], fechaOt);
        if (elegido) nuevos.push(filaPrecioFijo(e, ot, sku, elegido));
      }
    }
    await guardarFijos(nuevos);
    // Si otro lo fijó a la vez, gana el que quedó guardado
    const fijos = nuevos.length ? agrupar((await sbGetAll(`precios_fijos_ot?empresa_id=eq.${e}&ot=in.(${l})&select=*`, { maxFilas: 100000 })).data) : fijosDe;
    const articulos = [];
    for (const t of trozos([...todos], MAX_LOTE_SKU)) {
      articulos.push(...((await sbGet(`articulos_stock?empresa_id=eq.${e}&sku=in.(${lista(t)})&select=sku,nombre,unidad`).catch(() => [])) || []));
    }
    for (const p of grupo) {
      const ot = String(p.ot);
      out.set(ot, { fecha_ot: fechaCargaOt(p), ...costoMaterialesOt({ necesidades: necDe.get(ot) || [], fijos: fijos.get(ot) || [], articulos, movimientos: movDe.get(ot) || [] }) });
    }
  }
  return out;
}
