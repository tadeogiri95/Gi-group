// app/lib/reportesCompras.js — Reportes de Compras (parte 23; ítem 41;
// diseño en notes/diseno-compras.md): cuánto se compró por mes y por
// proveedor, órdenes atrasadas, pedidos de los jefes sin atender y cómo
// cambió el precio de un artículo. Todo sin IVA; pesos y dólares por separado.
import { ocAtrasada } from "./ordenesCompra";
import { hoyArg } from "./dates";

const DIA = 86400e3;

/** OC que cuentan como compra: mandadas al proveedor (no borrador ni anulada). */
export const ocComprada = (oc) => Boolean(oc) && oc.estado !== "borrador" && oc.estado !== "anulada";

/** Fecha de la compra: cuando se mandó, o cuando se armó. "YYYY-MM-DD". */
export const fechaCompra = (oc) => String(oc?.enviada_at || oc?.created_at || "").slice(0, 10);

/** "2026-10" → "Octubre 2026" */
export function nombreMes(mes) {
  const [a, m] = String(mes || "").split("-").map(Number);
  if (!a || !m || m < 1 || m > 12) return String(mes || "");
  const nombre = new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString("es-AR", { month: "long", timeZone: "UTC" });
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${a}`;
}

const redondear = (n) => Math.round(n * 100) / 100;

/** Importe de cada OC (sin IVA) y cuántos renglones quedaron sin precio. */
function importesPorOrden(items) {
  const m = new Map();
  for (const it of items || []) {
    const r = m.get(it.orden_id) || { total: 0, sinPrecio: 0 };
    if (it.precio_unitario === null || it.precio_unitario === undefined || it.precio_unitario === "") r.sinPrecio++;
    else r.total += Number(it.cantidad) * Number(it.precio_unitario);
    m.set(it.orden_id, r);
  }
  return m;
}

function sumar(grupos, clave, oc, imp) {
  const g = grupos.get(clave) || { clave, ARS: 0, USD: 0, ordenes: 0, sinPrecio: 0 };
  g[oc.moneda === "USD" ? "USD" : "ARS"] += imp?.total || 0;
  g.ordenes++;
  g.sinPrecio += imp?.sinPrecio || 0;
  grupos.set(clave, g);
}

const cerrar = (g) => ({ ...g, ARS: redondear(g.ARS), USD: redondear(g.USD) });

/**
 * Compras por mes, del más nuevo al más viejo.
 * @returns {{ mes: string, ARS: number, USD: number, ordenes: number, sinPrecio: number }[]}
 */
export function comprasPorMes(ordenes, items) {
  const imp = importesPorOrden(items);
  const grupos = new Map();
  for (const oc of ordenes || []) {
    if (!ocComprada(oc)) continue;
    const mes = fechaCompra(oc).slice(0, 7);
    if (mes) sumar(grupos, mes, oc, imp.get(oc.id));
  }
  return [...grupos.values()].map(cerrar).map(({ clave, ...g }) => ({ mes: clave, ...g }))
    .sort((a, b) => b.mes.localeCompare(a.mes));
}

/**
 * Compras por proveedor (de un mes "YYYY-MM", o de todo si no se pasa), de
 * mayor a menor en pesos y después en dólares.
 */
export function comprasPorProveedor(ordenes, items, mes = null) {
  const imp = importesPorOrden(items);
  const grupos = new Map();
  for (const oc of ordenes || []) {
    if (!ocComprada(oc)) continue;
    if (mes && !fechaCompra(oc).startsWith(mes)) continue;
    sumar(grupos, oc.proveedor_nombre || "Sin proveedor", oc, imp.get(oc.id));
  }
  return [...grupos.values()].map(cerrar).map(({ clave, ...g }) => ({ proveedor: clave, ...g }))
    .sort((a, b) => b.ARS - a.ARS || b.USD - a.USD || a.proveedor.localeCompare(b.proveedor));
}

/** Días entre dos fechas "YYYY-MM-DD" (b − a). */
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA);

/** OC que pasaron la fecha prometida, la más atrasada primero, con los días de atraso. */
export function ordenesAtrasadas(ordenes, hoy = hoyArg()) {
  return (ordenes || [])
    .filter((oc) => ocAtrasada(oc, hoy))
    .map((oc) => ({ ...oc, dias_atraso: diasEntre(oc.fecha_prometida, hoy) }))
    .sort((a, b) => b.dias_atraso - a.dias_atraso || a.numero - b.numero);
}

/** Pedidos de los jefes que nadie pasó a una OC, el más viejo primero, con los días que llevan esperando. */
export function pedidosSinAtender(pedidos, hoy = hoyArg()) {
  return (pedidos || [])
    .filter((p) => p.estado === "pendiente")
    .map((p) => ({ ...p, dias_espera: Math.max(0, diasEntre(String(p.created_at).slice(0, 10), hoy)) }))
    .sort((a, b) => b.dias_espera - a.dias_espera || String(a.created_at).localeCompare(String(b.created_at)));
}

const normal = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Precio de un artículo en las OC (del más nuevo al más viejo), buscando por
 * SKU exacto o por parte de la descripción. Cada renglón trae cuánto cambió
 * contra la compra anterior en la misma moneda.
 * @returns {{ fecha, numero, proveedor, moneda, sku, descripcion, precio, cambio: number|null }[]}
 */
export function historialPrecio(ordenes, items, texto, maximo = 30) {
  const q = normal(texto);
  if (q.length < 2) return [];
  const porId = new Map((ordenes || []).filter(ocComprada).map((oc) => [oc.id, oc]));
  const filas = [];
  for (const it of items || []) {
    const oc = porId.get(it.orden_id);
    if (!oc || it.precio_unitario === null || it.precio_unitario === undefined || it.precio_unitario === "") continue;
    const coincide = normal(it.sku) === q || normal(it.descripcion).includes(q);
    if (!coincide) continue;
    filas.push({
      fecha: fechaCompra(oc), numero: oc.numero, proveedor: oc.proveedor_nombre || "", moneda: oc.moneda === "USD" ? "USD" : "ARS",
      sku: it.sku || "", descripcion: it.descripcion || "", precio: Number(it.precio_unitario),
    });
  }
  // Del más viejo al más nuevo para comparar cada compra con la anterior del mismo artículo y moneda
  filas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.numero - b.numero);
  const anterior = new Map();
  for (const f of filas) {
    const clave = `${f.sku || normal(f.descripcion)}|${f.moneda}`;
    const prev = anterior.get(clave);
    f.cambio = prev > 0 ? Math.round(((f.precio - prev) / prev) * 1000) / 10 : null;
    anterior.set(clave, f.precio);
  }
  return filas.reverse().slice(0, maximo);
}
