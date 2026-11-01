// app/lib/materialDia.js — Material de cada día en 📅 Plan de producción
// (Tadeo, 01/11): para ver rápido si hay material para lo que toca ese día.
//
// Reglas de Tadeo:
//  - solo el material del proceso planificado ese día: placas, fondos,
//    fibroplus… (familia "Placas, chapas, mallas y paneles") van con Corte;
//    los cantos (por el nombre; están en "Herrajes y Accesorios") con
//    Canteado; el resto de herrajes y accesorios (bisagras, correderas,
//    cerraduras…) con Armado;
//  - a lo que necesita la OT (necesidades_stock, de la planilla MRP) se le
//    resta lo ya retirado para esa OT (movimientos_stock, sin anulados);
//  - un proceso al 100 % ya no necesita nada;
//  - se compara con el stock de ese momento, día por día (no acumulado).

const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A qué proceso va un artículo: "corte" | "canteado" | "armado" | null (no se muestra). */
export function procesoMaterial(articulo) {
  const familia = sinTildes(articulo?.familia);
  const nombre = sinTildes(articulo?.nombre);
  if (/placa|chapa|malla|panel/.test(familia)) return "corte";
  if (/\b(tapa)?cantos?\b/.test(nombre)) return "canteado";
  if (/herraje|accesorio/.test(familia)) return "armado";
  // Sin familia cargada: por el nombre
  if (!familia && /\b(placas?|fondos?|fibroplus|fibro|mdf|melaminas?|aglomerados?)\b/.test(nombre)) return "corte";
  return null;
}

const r3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Lo que falta retirar de cada artículo por OT: Map<ot, Map<sku, cantidad>>.
 * @param {object[]} necesidades renglones de necesidades_stock (ot, sku, cantidad)
 * @param {object[]} movimientos renglones de movimientos_stock (ot, sku, cantidad, tipo, anulado)
 */
export function faltaPorOt(necesidades = [], movimientos = []) {
  const nec = new Map();
  const ret = new Map();
  const sumar = (m, ot, sku, n) => {
    if (!m.has(ot)) m.set(ot, new Map());
    m.get(ot).set(sku, (m.get(ot).get(sku) || 0) + n);
  };
  for (const n of necesidades) sumar(nec, String(n.ot), n.sku, Number(n.cantidad) || 0);
  for (const m of movimientos) {
    if (m.anulado || (m.tipo !== "consumo" && m.tipo !== "devolucion")) continue;
    sumar(ret, String(m.ot), m.sku, (m.tipo === "devolucion" ? -1 : 1) * (Number(m.cantidad) || 0));
  }
  const out = new Map();
  for (const [ot, skus] of nec) {
    const f = new Map();
    for (const [sku, n] of skus) {
      const falta = r3(n - (ret.get(ot)?.get(sku) || 0));
      if (falta > 0) f.set(sku, falta);
    }
    out.set(ot, f);
  }
  return out;
}

/**
 * Material de un día del plan.
 * @param {{ ot: string, etapas: { id: string }[] }[]} ots las OT del día con sus procesos
 * @param {{ falta: Map<string, Map<string, number>>, articulos: Map<string, object>, pendiente: (ot: string, etapa: string) => number }} datos
 * @returns {{ filas: { sku, nombre, unidad, proceso, cantidad, stock, faltan, ots: string[] }[], conFalta: number }}
 */
export function materialDelDia(ots = [], { falta, articulos, pendiente }) {
  const porSku = new Map();
  for (const o of ots) {
    const ot = String(o.ot);
    const procesos = new Set(o.etapas.map((e) => e.id).filter((id) => pendiente(ot, id) > 0));
    if (!procesos.size) continue;
    for (const [sku, cantidad] of falta.get(ot) || []) {
      const art = articulos.get(sku) || { sku };
      const proceso = procesoMaterial(art);
      if (!proceso || !procesos.has(proceso)) continue;
      if (!porSku.has(sku)) porSku.set(sku, { sku, nombre: art.nombre || sku, unidad: art.unidad || null, proceso, cantidad: 0, stock: art.stock == null ? null : Number(art.stock), ots: [] });
      const f = porSku.get(sku);
      f.cantidad = r3(f.cantidad + cantidad);
      if (!f.ots.includes(ot)) f.ots.push(ot);
    }
  }
  const filas = [...porSku.values()].map((f) => ({ ...f, faltan: Math.max(0, r3(f.cantidad - (f.stock || 0))) }))
    .sort((a, b) => (b.faltan > 0) - (a.faltan > 0) || a.nombre.localeCompare(b.nombre, "es"));
  return { filas, conFalta: filas.filter((f) => f.faltan > 0).length };
}
