// app/lib/finanzasMaterialesOt.js — el costo de materiales de varias OT sin
// guardar nada (necesidades de la OT × precio fijo de la OT o el elegido por
// fecha). Lo usan la cuenta corriente de clientes por OT (parte 6) y el
// estado de resultados para estimar las entregas sin PRECIO en el Plan
// (13/11). Antes vivía en /api/finanzas/ot-clientes.
import { sbGetAll } from "./sbHelpers";
import { fechaCargaOt } from "./costoMateriales";
import { materialesOt } from "./finanzasOtClientes";

const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);
const lista = (xs) => xs.map((s) => `%22${encodeURIComponent(s)}%22`).join(",");
const enTandas = async (xs, n, fn) => {
  const out = [];
  for (let i = 0; i < xs.length; i += n) out.push(...(await fn(xs.slice(i, i + n))));
  return out;
};

/**
 * Costo de materiales de cada OT (de a tandas, sin guardar).
 * @param {object} sesion la del usuario (con su empresa_id)
 * @param {object[]} proyectos con ot y created_at
 * @returns {Promise<Map<string, { total: number, sinPrecio: number, articulos: number }>>} por código de OT
 */
export async function materialesDeOts(sesion, proyectos) {
  const e = sesion.empresa_id;
  const ots = proyectos.map((p) => String(p.ot));
  if (!ots.length) return new Map();
  const [necesidades, fijos] = await Promise.all([
    enTandas(ots, 80, (t) => leer(sesion, `necesidades_stock?empresa_id=eq.${e}&ot=in.(${lista(t)})&select=ot,sku,cantidad`, 100000).catch(() => [])),
    enTandas(ots, 80, (t) => leer(sesion, `precios_fijos_ot?empresa_id=eq.${e}&ot=in.(${lista(t)})&select=ot,sku,precio_ars`, 100000).catch(() => [])),
  ]);
  const fijosDe = new Map();
  for (const f of fijos) {
    if (!fijosDe.has(f.ot)) fijosDe.set(f.ot, new Map());
    fijosDe.get(f.ot).set(f.sku, f);
  }
  const necDe = new Map();
  for (const n of necesidades) {
    if (!necDe.has(n.ot)) necDe.set(n.ot, []);
    necDe.get(n.ot).push(n);
  }
  const faltan = [...new Set(necesidades.filter((n) => !fijosDe.get(n.ot)?.has(n.sku)).map((n) => n.sku))];
  const filas = await enTandas(faltan, 150, (t) => leer(sesion,
    `v_precios_articulos?empresa_id=eq.${e}&sku=in.(${lista(t)})&precio_ars=not.is.null&select=sku,fecha,precio_ars&order=sku.asc,fecha.asc`, 100000).catch(() => []));
  const precios = new Map();
  for (const p of filas) {
    if (!precios.has(p.sku)) precios.set(p.sku, []);
    precios.get(p.sku).push(p);
  }
  const out = new Map();
  for (const p of proyectos) {
    const ot = String(p.ot);
    out.set(ot, materialesOt({ necesidades: necDe.get(ot) || [], fijos: fijosDe.get(ot) || new Map(), precios, fechaOt: fechaCargaOt(p) }));
  }
  return out;
}
