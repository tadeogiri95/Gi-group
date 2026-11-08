// app/lib/costoMateriales.js — Costo de materiales de una OT (costo de OT,
// parte B; migración 165; diseño en notes/diseno-costo-ot.md).
//
// Costo = suma de cantidad necesaria (hoja de necesidades del MRP) × precio
// unitario sin IVA en pesos. El precio de cada artículo:
//   1. el de fecha más cercana al día en que la OT entró a Gypi, sin pasarse;
//   2. si no hay uno anterior, el primero después;
//   3. si la OT no tiene fecha, el último;
//   4. en dólares, pasado a pesos con el tipo de cambio de la factura (la
//      vista v_precios_articulos ya trae precio_ars).
// La primera vez que un artículo de la OT consigue precio, queda fijo en la
// OT (precios_fijos_ot): las compras más nuevas no lo cambian.

const ZONA = "America/Argentina/Buenos_Aires";

/** Día (YYYY-MM-DD, hora argentina) en que la OT entró a Gypi; null sin fecha. */
export function fechaCargaOt(proyecto) {
  const d = new Date(proyecto?.created_at ?? "");
  if (!proyecto?.created_at || Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(d);
}

const conPrecio = (p) => p && p.fecha && p.precio_ars !== null && p.precio_ars !== undefined && Number.isFinite(Number(p.precio_ars));

/**
 * Elige el precio de un artículo para una OT.
 * @param {object[]} precios renglones de v_precios_articulos del artículo
 * @param {string|null} fechaOt YYYY-MM-DD
 * @returns {object|null} el renglón elegido (null si no hay ninguno con precio en pesos)
 */
export function elegirPrecio(precios = [], fechaOt = null) {
  const validos = precios.filter(conPrecio);
  if (!validos.length) return null;
  // Mismo día: gana el último de la lista (el más recién cargado)
  const masNuevo = (lista) => lista.reduce((a, b) => (b.fecha >= a.fecha ? b : a));
  if (!fechaOt) return masNuevo(validos);
  const antes = validos.filter((p) => p.fecha <= fechaOt);
  if (antes.length) return masNuevo(antes);
  return validos.reduce((a, b) => (b.fecha < a.fecha ? b : a));
}

/** Lo que se guarda en precios_fijos_ot a partir del precio elegido. */
export function filaPrecioFijo(empresaId, ot, sku, p) {
  return {
    empresa_id: empresaId,
    ot,
    sku,
    fecha: p.fecha,
    precio: Number(p.precio ?? p.precio_ars),
    moneda: p.moneda === "USD" ? "USD" : "ARS",
    tipo_cambio: p.moneda === "USD" && p.tipo_cambio ? Number(p.tipo_cambio) : null,
    precio_ars: Number(p.precio_ars),
    origen: ["mrp", "oc", "factura"].includes(p.origen) ? p.origen : "mrp",
    referencia: p.referencia ? String(p.referencia).slice(0, 200) : null,
    proveedor: p.proveedor ? String(p.proveedor).slice(0, 120) : null,
    comprobante: p.comprobante ? String(p.comprobante).slice(0, 60) : null,
  };
}

const redondear = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Renglones del costo de materiales.
 * @param {{ necesidades: object[], fijos: object[], articulos?: object[], movimientos?: object[] }} datos
 *   necesidades: necesidades_stock de la OT (sku, nombre, cantidad)
 *   fijos: precios_fijos_ot de la OT
 *   articulos: articulos_stock (nombre y unidad)
 *   movimientos: retiros y devoluciones de la OT (para ver lo retirado al lado)
 * @returns {{ filas: object[], total: number, sinPrecio: number, provisorio: boolean }}
 */
export function costoMaterialesOt({ necesidades = [], fijos = [], articulos = [], movimientos = [] }) {
  const art = new Map(articulos.map((a) => [a.sku, a]));
  const fijo = new Map(fijos.map((f) => [f.sku, f]));
  const retirado = new Map();
  for (const m of movimientos) {
    if (m.anulado) continue;
    const signo = m.tipo === "consumo" ? 1 : m.tipo === "devolucion" ? -1 : 0;
    if (signo) retirado.set(m.sku, (retirado.get(m.sku) || 0) + signo * (Number(m.cantidad) || 0));
  }
  const porSku = new Map();
  for (const n of necesidades) {
    const previa = porSku.get(n.sku);
    if (previa) previa.cantidad += Number(n.cantidad) || 0;
    else porSku.set(n.sku, { sku: n.sku, nombre: art.get(n.sku)?.nombre || n.nombre || null, unidad: art.get(n.sku)?.unidad || null, cantidad: Number(n.cantidad) || 0 });
  }
  let total = 0;
  let sinPrecio = 0;
  const filas = [...porSku.values()].filter((f) => f.cantidad > 0).map((f) => {
    const p = fijo.get(f.sku);
    const cantidad = redondear(f.cantidad);
    const fila = { ...f, cantidad, retirado: redondear(retirado.get(f.sku) || 0) };
    if (!p) {
      sinPrecio++;
      return { ...fila, sinPrecio: true, precio: null, subtotal: null };
    }
    const subtotal = Math.round(cantidad * Number(p.precio_ars) * 100) / 100;
    total += subtotal;
    return {
      ...fila,
      sinPrecio: false,
      precio: Number(p.precio_ars),
      precioMoneda: Number(p.precio),
      moneda: p.moneda,
      tipoCambio: p.tipo_cambio,
      fecha: p.fecha,
      origen: p.origen,
      proveedor: p.proveedor,
      comprobante: p.comprobante,
      cambiadoPor: p.cambiado_por_nombre || null,
      cambiadoAt: p.cambiado_at || null,
      subtotal,
    };
  });
  // Sin precio primero (en rojo), después los más caros
  filas.sort((a, b) => (a.sinPrecio !== b.sinPrecio ? (a.sinPrecio ? -1 : 1) : (b.subtotal || 0) - (a.subtotal || 0)));
  return { filas, total: Math.round(total * 100) / 100, sinPrecio, provisorio: sinPrecio > 0 };
}
