// app/lib/materialMrp.js — Placas, fondos y metros de canto de una OT sacados
// de las necesidades del MRP (necesidades_stock, 108), como respaldo cuando el
// Nuevo Plan de Trabajo no los trae (pedido de Tadeo, 23/11; migración 202).
//
// Reglas (pre-análisis del 23/11 con el libro MRP y el Plan: en 325 OT que
// tienen las dos cosas, la mitad o más dan exactamente igual):
//  - Placa: familia "Placas, chapas, mallas y paneles" de la división Madera
//    (melaminas, MDF, aglomerados, enchapados, fibroplus…). Las de hasta 6 mm
//    (Fibroplus 3, Fondo MDF 5,5, MDF 5,5, Enchapado 3,7) son fondos. Las
//    chapas de hierro y la tabla de cielorraso de PVC no cuentan.
//  - Canto: "CANTO" en el nombre (ABS, PVC, chapa con tela), aunque esté mal
//    cargado en otra familia; menos el "PERFIL CANTO DE ALUMINIO".
//  - El Plan manda: cada dato que está cargado en el Plan queda; solo se
//    completa con el MRP lo que está vacío (Tadeo eligió completar lo que
//    falte). Con placas en el Plan y fondos vacíos (N/A) los fondos son 0.
// La sincronización de la planilla MRP guarda los totales en
// proyectos.placas_mrp, fondos_mrp y metros_canto_mrp (app/lib/syncStock.js).

const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r3 = (n) => Math.round(n * 1000) / 1000;

/** Hasta este espesor (mm) una placa cuenta como fondo. */
export const ESPESOR_MAX_FONDO = 6;

const NOMBRE_PLACA = /^(MELAMINA|FIBROPLUS|FIBRO|FONDO|ENCHAPADO|MDF|HDF|AGLOMERADO|TERCIADO|MULTILAMINADO|LAMINADO|ALTO BRILLO|OSB)\b/;
const NO_MADERA = /\b(CHAPA|ACERO|HIERRO|PVC|ALUMINIO|ALUCOBOND|MALLA|POLICARBONATO|INOXIDABLE)\b/;

/** Espesor en mm que figura en el nombre ("… 5,5 MM" → 5.5), o null. */
export function espesorMm(nombre) {
  const m = sinTildes(nombre).match(/(\d+(?:[.,]\d+)?)\s*MM\b/);
  return m ? Number(m[1].replace(",", ".")) : null;
}

/**
 * Qué es un artículo para el cálculo de tiempos.
 * @param {{ nombre?: string, familia?: string, division?: string }} articulo
 * @returns {"placa"|"fondo"|"canto"|null}
 */
export function claseMaterialMrp(articulo) {
  const nombre = sinTildes(articulo?.nombre).trim();
  if (!nombre) return null;
  if (/CANTO/.test(nombre)) return /PERFIL/.test(nombre) ? null : "canto";
  const familia = sinTildes(articulo?.familia);
  const division = sinTildes(articulo?.division);
  let esPlaca;
  if (familia) {
    esPlaca = /PLACA|CHAPA|MALLA|PANEL/.test(familia) && (division ? /MADERA/.test(division) : !NO_MADERA.test(nombre));
  } else {
    // Sin familia cargada: por el nombre
    esPlaca = NOMBRE_PLACA.test(nombre) && !NO_MADERA.test(nombre);
  }
  if (!esPlaca) return null;
  const e = espesorMm(nombre);
  return e != null && e <= ESPESOR_MAX_FONDO ? "fondo" : "placa";
}

/**
 * Totales por OT de las necesidades del MRP.
 * @param {object[]} necesidades renglones de necesidades_stock (ot, sku, nombre, cantidad)
 * @param {object[]|Map<string, object>} articulos articulos_stock (sku, nombre, familia, division)
 * @returns {Map<string, { placas: number, fondos: number, metros: number }>} solo las OT con algo
 */
export function materialMrpPorOt(necesidades = [], articulos = []) {
  const porSku = articulos instanceof Map ? articulos : new Map((articulos || []).map((a) => [String(a.sku), a]));
  const out = new Map();
  for (const n of necesidades || []) {
    const ot = String(n?.ot ?? "").trim();
    const q = num(n?.cantidad);
    if (!ot || q == null || q <= 0) continue;
    const art = porSku.get(String(n.sku)) || { nombre: n.nombre };
    const clase = claseMaterialMrp({ ...art, nombre: art.nombre || n.nombre });
    if (!clase) continue;
    const t = out.get(ot) || { placas: 0, fondos: 0, metros: 0 };
    if (clase === "placa") t.placas += q;
    else if (clase === "fondo") t.fondos += q;
    else t.metros += q;
    out.set(ot, t);
  }
  for (const t of out.values()) { t.placas = r3(t.placas); t.fondos = r3(t.fondos); t.metros = r3(t.metros); }
  return out;
}

/**
 * Cambios para guardar en proyectos: las OT cuyo material del MRP cambió
 * (incluye las que ya no tienen y hay que dejar vacías).
 * @param {object[]} proyectos ot, placas_mrp, fondos_mrp, metros_canto_mrp
 * @param {Map<string, { placas, fondos, metros }>} totales de materialMrpPorOt
 * @returns {{ ot: string, placas_mrp: number|null, fondos_mrp: number|null, metros_canto_mrp: number|null }[]}
 */
export function cambiosMaterialMrp(proyectos = [], totales = new Map()) {
  const out = [];
  const vistos = new Set();
  for (const p of proyectos) {
    const ot = String(p?.ot ?? "").trim();
    if (!ot || vistos.has(ot)) continue;
    vistos.add(ot);
    const t = totales.get(ot);
    const nuevo = {
      placas_mrp: t ? t.placas : null,
      fondos_mrp: t ? t.fondos : null,
      metros_canto_mrp: t ? t.metros : null,
    };
    const igual = Object.keys(nuevo).every((k) => num(p[k]) === nuevo[k]);
    if (!igual) out.push({ ot, ...nuevo });
  }
  return out;
}

/**
 * Placas, fondos y metros de canto con los que se calculan los tiempos de la
 * OT: los del Plan y, lo que falte, del MRP.
 * @param {object} proyecto con placas, fondos, metros_canto (Plan) y *_mrp
 * @returns {{ placas: number|null, fondos: number|null, metros: number|null, delMrp: { placas: boolean, fondos: boolean, metros: boolean }, algunoDelMrp: boolean }}
 */
export function materialProduccion(proyecto) {
  const plan = { placas: num(proyecto?.placas), fondos: num(proyecto?.fondos), metros: num(proyecto?.metros_canto) };
  const mrp = { placas: num(proyecto?.placas_mrp), fondos: num(proyecto?.fondos_mrp), metros: num(proyecto?.metros_canto_mrp) };
  const delMrp = { placas: false, fondos: false, metros: false };
  const elegir = (k, siVacio) => {
    if (plan[k] != null) return plan[k];
    if (siVacio !== undefined) return siVacio;
    if (mrp[k] != null) { delMrp[k] = true; return mrp[k]; }
    return null;
  };
  const placas = elegir("placas");
  // Placas en el Plan con los fondos vacíos (N/A): esa OT no lleva fondos
  const fondos = elegir("fondos", plan.placas != null ? 0 : undefined);
  const metros = elegir("metros");
  return { placas, fondos, metros, delMrp, algunoDelMrp: delMrp.placas || delMrp.fondos || delMrp.metros };
}

/** Marca para mostrar junto a un número que salió del MRP. */
export const MARCA_MRP = "📦 del MRP";
