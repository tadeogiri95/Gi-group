// app/lib/costoRealServidor.js — Lee lo que hace falta para el costo previsto
// y real de una o varias OT (auditoría 12/11, parte 3; app/lib/costoReal.js).
// Lo usan /api/costo-real, el costo final al cerrar la OT y el reporte de
// costo. Va con la clave del servidor: quien lo llama ya verificó el permiso,
// y todo se filtra por la empresa.
import { sbGet, sbGetAll } from "./sbHelpers";
import { logger } from "./logger";
import { elegirPrecio, fechaCargaOt, filaPrecioFijo } from "./costoMateriales";
import { costoMaterialesDeOts, guardarFijos, preciosDe } from "./costoMaterialesServidor";
import { horasDeOts } from "./horasOtServidor";
import { CLAVE_MARGEN, margenMinimoDe } from "./margenOt";
import { comprasDirectas, costoPrevistoReal, gastosOt, horasInstalacion, horasRetrabajo, materialesFuera } from "./costoReal";

const MAX_LOTE = 60;
const vacio = () => ({ data: [] });
const lista = (vals) => vals.map((v) => `%22${encodeURIComponent(String(v))}%22`).join(",");
const trozos = (l, n) => Array.from({ length: Math.ceil(l.length / n) }, (_, i) => l.slice(i * n, i * n + n));
const agrupar = (filas, campo = "ot") => {
  const m = new Map();
  for (const f of filas || []) {
    const k = String(f[campo]);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(f);
  }
  return m;
};
// Una fuente que falla (tabla sin migración o la base no respondió) no frena el costo: suma cero
const leer = (path, opts) => sbGetAll(path, { maxFilas: 100000, ...opts }).catch((err) => { logger.warn(`[costo-real] ${path.split("?")[0]}: ${err?.message}`); return { data: [] }; });

/**
 * Lo que la OT gastó fuera del MRP, por OT.
 * @param {string} e empresa
 * @param {object[]} proyectos filas de proyectos (con select=*)
 * @param {Map<string, object>} materiales costoMaterialesDeOts de esas OT
 * @returns {Promise<Map<string, { fuera, compras, gastos, retrabajo, instalacion }>>}
 */
export async function extrasDeOts(e, proyectos, materiales) {
  const out = new Map();
  const cuentas = (await sbGetAll(`fin_cuentas?empresa_id=eq.${e}&select=codigo,linea_eerr,rubro,naturaleza`).catch(() => sbGetAll(`fin_cuentas?empresa_id=eq.${e}&select=codigo,rubro,naturaleza`)).catch(vacio)).data || [];
  for (const grupo of trozos(proyectos || [], MAX_LOTE)) {
    const ots = grupo.map((p) => String(p.ot));
    const l = lista(ots);
    const ids = grupo.map((p) => Number(p.id)).filter(Number.isFinite);
    const [movs, fijos, items, ops, retrabajos, reportes, colocados] = await Promise.all([
      leer(`movimientos_stock?empresa_id=eq.${e}&ot=in.(${l})&anulado=eq.false&tipo=in.(consumo,devolucion)&select=ot,sku,nombre,cantidad,tipo,anulado`),
      leer(`precios_fijos_ot?empresa_id=eq.${e}&ot=in.(${l})&select=*`),
      leer(`ordenes_compra_items?empresa_id=eq.${e}&ot=in.(${l})&sku=is.null&select=orden_id,ot,sku,descripcion,unidad,cantidad,cantidad_recibida,cantidad_facturada,precio_unitario`),
      ids.length ? leer(`fin_operaciones?empresa_id=eq.${e}&proyecto_id=in.(${ids.join(",")})&anulada_at=is.null&select=id,fecha,tipo,origen,estado,proyecto_id,entidad,descripcion,neto,moneda,tipo_cambio,cuenta_debe,cuenta_haber,anulada_at`) : vacio(),
      leer(`retrabajos_ot?empresa_id=eq.${e}&ot=in.(${l})&select=*`),
      leer(`reportes_instalacion?empresa_id=eq.${e}&ot=in.(${l})&select=ot,fecha,empleado_id`),
      leer(`modulos_instalados?empresa_id=eq.${e}&ot=in.(${l})&select=ot,instalado_por,created_at`),
    ]);
    const movDe = agrupar(movs.data), fijosDe = agrupar(fijos.data), itemsDe = agrupar(items.data), opsDe = agrupar(ops.data, "proyecto_id");
    const retDe = agrupar(retrabajos.data), repDe = agrupar(reportes.data), colDe = agrupar(colocados.data);

    // Lo retirado que no tiene precio fijo en la OT lo busca y lo fija, igual que el MRP
    const necesariosDe = new Map(grupo.map((p) => [String(p.ot), (materiales.get(String(p.ot))?.filas || []).map((f) => ({ sku: f.sku, cantidad: f.cantidad }))]));
    const nuevos = [];
    const faltanDe = new Map();
    const todos = new Set();
    for (const p of grupo) {
      const ot = String(p.ot);
      const ya = new Set((fijosDe.get(ot) || []).map((f) => f.sku));
      const faltan = [...new Set((movDe.get(ot) || []).map((m) => m.sku).filter((s) => s && !ya.has(s)))];
      faltan.forEach((s) => todos.add(s));
      faltanDe.set(ot, faltan);
    }
    if (todos.size) {
      const precios = new Map();
      for (const t of trozos([...todos], 150)) for (const [k, v] of await preciosDe(e, t)) precios.set(k, v);
      for (const p of grupo) {
        for (const sku of faltanDe.get(String(p.ot))) {
          const elegido = elegirPrecio(precios.get(sku) || [], fechaCargaOt(p));
          if (elegido) nuevos.push(filaPrecioFijo(e, String(p.ot), sku, elegido));
        }
      }
      await guardarFijos(nuevos).catch((err) => logger.warn(`[costo-real] precios fijos: ${err?.message}`));
    }
    const fijosNuevos = agrupar(nuevos);
    const ordenIds = [...new Set((items.data || []).map((i) => Number(i.orden_id)).filter(Number.isFinite))];
    const ordenes = ordenIds.length ? (await leer(`ordenes_compra?empresa_id=eq.${e}&id=in.(${ordenIds.join(",")})&select=id,numero,estado,moneda,tipo_cambio,proveedor_nombre`)).data : [];

    for (const p of grupo) {
      const ot = String(p.ot);
      out.set(ot, {
        fuera: materialesFuera({ necesarios: necesariosDe.get(ot), movimientos: movDe.get(ot) || [], fijos: [...(fijosDe.get(ot) || []), ...(fijosNuevos.get(ot) || [])] }),
        compras: comprasDirectas(itemsDe.get(ot) || [], ordenes),
        gastos: gastosOt(opsDe.get(String(p.id)) || [], cuentas),
        retrabajo: horasRetrabajo(retDe.get(ot) || []),
        instalacion: horasInstalacion(p, { reportes: repDe.get(ot) || [], colocados: colDe.get(ot) || [] }),
      });
    }
  }
  return out;
}

/**
 * Precio de cada OT (PRECIO del Plan, sin IVA; precios_ot, 142) y el margen
 * mínimo de la empresa (auditoría 12/11, parte 4). Sin la 142, sin precios.
 * @returns {Promise<{ precios: Map<string, number>, minimo: number }>}
 */
export async function preciosYMinimo(e, ots = []) {
  const precios = new Map();
  for (const t of trozos([...new Set(ots.map(String))], 150)) {
    for (const r of (await leer(`precios_ot?empresa_id=eq.${e}&ot=in.(${lista(t)})&precio=not.is.null&select=ot,precio`)).data || []) precios.set(String(r.ot), Number(r.precio));
  }
  const [cfg] = (await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_MARGEN}&select=valor&limit=1`, { silent: true, fallback: [] }).catch(() => [])) || [];
  return { precios, minimo: margenMinimoDe(cfg?.valor) };
}

/** Costo de la hora de la empresa (Costos), o null. */
export async function costoHoraDe(e) {
  const [c] = (await sbGet(`costos_empresa?empresa_id=eq.${e}&select=costo_hora&limit=1`).catch(() => [])) || [];
  return c?.costo_hora ?? null;
}

/**
 * Todo junto para varias OT: materiales, horas, lo de afuera y el previsto contra real.
 * @returns {Promise<Map<string, { materiales, horas, extras, comparativa }>>}
 */
export async function costosRealesDeOts(e, proyectos, { costoHora } = {}) {
  const ch = costoHora !== undefined ? costoHora : await costoHoraDe(e);
  const [materiales, horas] = await Promise.all([
    costoMaterialesDeOts(e, proyectos),
    // Sin la 166 (o sin datos de horas) sigue, sin horas
    horasDeOts(e, proyectos).catch((err) => { logger.warn(`[costo-real] horas: ${err?.message}`); return new Map(); }),
  ]);
  const extras = await extrasDeOts(e, proyectos, materiales);
  const out = new Map();
  for (const p of proyectos || []) {
    const ot = String(p.ot);
    const m = materiales.get(ot) || { filas: [], total: 0, sinPrecio: 0 };
    const h = horas.get(ot) || null;
    const x = extras.get(ot) || {};
    out.set(ot, { materiales: m, horas: h, extras: x, comparativa: costoPrevistoReal({ materiales: m, horas: h, costoHora: ch, ...x }) });
  }
  return out;
}

/** Una OT: null si no existe. */
export async function costoRealDeOt(e, ot) {
  const [p] = (await sbGet(`proyectos?empresa_id=eq.${e}&ot=eq.${encodeURIComponent(ot)}&select=*&limit=1`)) || [];
  if (!p) return null;
  return (await costosRealesDeOts(e, [p])).get(String(p.ot)) || null;
}

/**
 * Solo los materiales reales de cada OT (MRP + retirado de más + compras sin
 * stock), para el estado de resultados (parte 4).
 * @returns {Promise<Map<string, number>>} por código de OT
 */
export async function materialesRealesDeOts(e, proyectos) {
  const materiales = await costoMaterialesDeOts(e, proyectos);
  const extras = await extrasDeOts(e, proyectos, materiales);
  const out = new Map();
  for (const p of proyectos || []) {
    const ot = String(p.ot);
    const x = extras.get(ot) || {};
    out.set(ot, Math.round(((materiales.get(ot)?.total || 0) + (x.fuera?.total || 0) + (x.compras?.total || 0)) * 100) / 100);
  }
  return out;
}
