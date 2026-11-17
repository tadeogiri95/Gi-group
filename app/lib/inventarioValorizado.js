// app/lib/inventarioValorizado.js — Inventario valorizado a una fecha
// (Materiales → 📊 Inventario, pedido de Tadeo 17/11; migración 196).
//
// Cantidad de cada artículo al final del día elegido:
//   - hoy (o una fecha futura): el stock que trajo la planilla MRP;
//   - un día pasado con foto (stock_fotos, una por noche): la primera foto
//     de ese día o posterior, deshaciendo los movimientos de Gypi cargados
//     entre el día elegido y la foto;
//   - un día pasado sin foto: el stock de hoy, deshaciendo los movimientos
//     de Gypi cargados después del día elegido. Lo que se cargó solo en la
//     planilla no se puede deshacer (se avisa).
// Precio unitario (elegido por Tadeo 17/11): el último precio de compra sin
// IVA en pesos hasta el día elegido (v_precios_articulos: ingresos de la
// planilla, órdenes de compra y facturas); si no hay ninguno, el último
// precio de la planilla de artículos. Sin precio, el artículo no suma.
// Las cantidades negativas se muestran pero no suman.

import { ESTILO, armarXlsx } from "./xlsxSimple";

const ZONA_OFFSET = "-03:00";

const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

/** ¿Es una fecha YYYY-MM-DD válida? */
export function fechaValida(f) {
  if (typeof f !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  const d = new Date(`${f}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
}

/** Último instante del día (hora argentina) en ISO, para comparar con created_at. */
export const finDelDia = (fecha) => new Date(`${fecha}T23:59:59.999${ZONA_OFFSET}`).toISOString();

/** Cuánto cambia el stock un movimiento: ingreso y devolución suman, consumo resta, ajuste con su signo. */
export function efectoMovimiento(m) {
  if (!m || m.anulado) return 0;
  const c = Number(m.cantidad) || 0;
  if (m.tipo === "ingreso" || m.tipo === "devolucion") return Math.abs(c);
  if (m.tipo === "consumo") return -Math.abs(c);
  if (m.tipo === "ajuste") return c;
  return 0;
}

/**
 * Cantidad por artículo al final del día, partiendo de una base (stock de hoy
 * o de una foto) y deshaciendo los movimientos posteriores al día.
 * @param {Map<string, number>} base sku → cantidad
 * @param {object[]} movimientos los cargados después del día elegido (y hasta la base)
 * @returns {Map<string, number>}
 */
export function deshacerMovimientos(base, movimientos = []) {
  const res = new Map(base);
  for (const m of movimientos) {
    const ef = efectoMovimiento(m);
    if (!ef || !m.sku) continue;
    res.set(m.sku, r3((res.get(m.sku) || 0) - ef));
  }
  return res;
}

/**
 * Último precio hasta el día (inclusive). Mismo día: el último de la lista.
 * @param {object[]} precios renglones de v_precios_articulos de un artículo
 * @returns {object|null}
 */
export function ultimoPrecioHasta(precios = [], fecha) {
  let elegido = null;
  for (const p of precios) {
    const v = Number(p?.precio_ars);
    if (!p?.fecha || p.precio_ars === null || p.precio_ars === undefined || !Number.isFinite(v) || v < 0) continue;
    if (fecha && String(p.fecha).slice(0, 10) > fecha) continue;
    if (!elegido || String(p.fecha) >= String(elegido.fecha)) elegido = p;
  }
  return elegido;
}

const ORIGEN = { mrp: "Ingreso en la planilla", oc: "Orden de compra", factura: "Factura" };

/**
 * Arma el inventario valorizado.
 * @param {{ fecha: string, articulos: object[], cantidades: Map<string, number>, precios: object[] }} d
 * @returns {{ fecha, filas, total, articulos, sin_precio, negativos, por_division: { division, valor }[] }}
 */
export function valorizar({ fecha, articulos = [], cantidades = new Map(), precios = [] }) {
  const porSku = new Map();
  for (const p of precios) {
    if (!p?.sku) continue;
    if (!porSku.has(p.sku)) porSku.set(p.sku, []);
    porSku.get(p.sku).push(p);
  }
  const datos = new Map(articulos.map((a) => [a.sku, a]));
  const filas = [];
  let total = 0;
  let sinPrecio = 0;
  let negativos = 0;
  const divisiones = new Map();
  for (const [sku, cant] of cantidades) {
    const cantidad = r3(Number(cant) || 0);
    if (!cantidad) continue;
    const a = datos.get(sku) || { sku };
    const p = ultimoPrecioHasta(porSku.get(sku), fecha);
    let precio = p ? Number(p.precio_ars) : null;
    let origen = p ? ORIGEN[p.origen] || "Compra" : null;
    let fechaPrecio = p ? String(p.fecha).slice(0, 10) : null;
    if (precio === null && Number(a.ultimo_precio) > 0) {
      precio = Number(a.ultimo_precio);
      origen = "Último precio de la planilla";
      fechaPrecio = null;
    }
    const negativo = cantidad < 0;
    const valor = precio !== null && !negativo ? r2(cantidad * precio) : null;
    if (negativo) negativos += 1;
    else if (precio === null) sinPrecio += 1;
    if (valor !== null) {
      total += valor;
      const div = a.division || "Sin división";
      divisiones.set(div, (divisiones.get(div) || 0) + valor);
    }
    filas.push({
      sku, nombre: a.nombre || null, unidad: a.unidad || null, division: a.division || null, familia: a.familia || null,
      cantidad, precio: precio === null ? null : r2(precio), origen_precio: origen, fecha_precio: fechaPrecio,
      proveedor: p?.proveedor || null, valor, negativo,
    });
  }
  filas.sort((x, y) => (y.valor ?? -1) - (x.valor ?? -1) || String(x.nombre || x.sku).localeCompare(String(y.nombre || y.sku), "es"));
  return {
    fecha,
    filas,
    total: r2(total),
    articulos: filas.length,
    sin_precio: sinPrecio,
    negativos,
    por_division: [...divisiones].map(([division, valor]) => ({ division, valor: r2(valor) })).sort((a, b) => b.valor - a.valor),
  };
}

/** Filtra por texto (nombre, código o familia) y división. */
export function filtrarInventario(filas = [], { texto = "", division = "" } = {}) {
  const t = texto.trim().toLowerCase();
  return filas.filter((f) => (!division || f.division === division)
    && (!t || [f.nombre, f.sku, f.familia].some((v) => String(v || "").toLowerCase().includes(t))));
}

/** Lo que suma una lista filtrada. */
export const sumaValor = (filas = []) => r2(filas.reduce((s, f) => s + (f.valor || 0), 0));

const dma = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : "");

/** El .xlsx del inventario (números como números, para sumar y filtrar en Excel). */
export function inventarioXlsx(inv, { empresa = "" } = {}) {
  const N = (v) => (v === null || v === undefined ? "" : { v, estilo: ESTILO.numero });
  const B = (v) => ({ v, estilo: ESTILO.negrita });
  const filas = [
    [{ v: `Inventario valorizado${empresa ? ` · ${empresa}` : ""}`, estilo: ESTILO.titulo }],
    [`Al ${dma(inv.fecha)} · precio unitario sin IVA: última compra hasta esa fecha`],
    [],
    ["Código", "Artículo", "División", "Familia", "Cantidad", "Unidad", "Precio unitario sin IVA", "Precio de", "Fecha del precio", "Valor"].map(B),
  ];
  for (const f of inv.filas || []) {
    filas.push([f.sku, f.nombre || "", f.division || "", f.familia || "", N(f.cantidad), f.unidad || "", N(f.precio), f.origen_precio || "", f.fecha_precio ? { v: f.fecha_precio, estilo: ESTILO.fecha } : "", N(f.valor)]);
  }
  filas.push([]);
  filas.push([B("Total del inventario"), "", "", "", "", "", "", "", "", { v: inv.total, estilo: ESTILO.numeroNegrita }]);
  return armarXlsx([{ nombre: "Inventario", filas, anchos: [14, 40, 16, 18, 12, 9, 16, 26, 12, 16] }]);
}
