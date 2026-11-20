// app/lib/preciosArticulos.js — Lista de precios de los artículos con fecha
// (costo de materiales por OT, parte A; migración 164; diseño en
// notes/diseno-costo-ot.md).
//
// Los precios salen de tres lados y se leen todos juntos en la vista
// v_precios_articulos:
//   - 📗 'mrp': hoja fact_ingresos_stock de la planilla MRP, que copia la
//     sincronización de Stock (leerIngresosMrp). Los renglones "GY-…" se
//     saltean: los mandó Gypi desde una recepción de OC y ya están como 'oc'.
//   - 🧾 'oc': facturas de las órdenes de compra (la vista las lee en el
//     momento, por unidad de stock y en pesos con el tipo de cambio).
//   - 📄 'factura': facturas sueltas (parte D).
// Todos van sin IVA.

import { filasCsv, fechaPlanilla } from "./csvProyectos";
import { SKU_VALIDO, normalizarTitulo, numeroPlanilla, columnas } from "./stock";

export const ORIGENES_PRECIO = {
  mrp: { icono: "📗", texto: "Planilla MRP" },
  oc: { icono: "🧾", texto: "Factura de OC" },
  factura: { icono: "📄", texto: "Factura suelta" },
};

// Hoja fact_ingresos_stock: ID_INGRESO, ID_SKU, ID_PROVEEDOR, FECHA CARGA,
// NOMBRE NORMALIZADO, PROVEEDOR, N° COMPROBANTE, FECHA COMPRA, CANTIDAD
// INGRESADA, PRECIO UNIT. S/IVA, PRECIO TOTAL S/IVA, IVA, TOTAL
const CAMPOS_INGRESOS = {
  id: ["id_ingreso", "id ingreso"],
  sku: ["id_sku", "sku"],
  fecha_compra: ["fecha compra", "fecha de compra"],
  fecha_carga: ["fecha carga", "fecha de carga", "fecha"],
  nombre: ["nombre norma*", "articulo", "nombre*"],
  proveedor: ["proveedor"],
  comprobante: ["n° comprobante", "nº comprobante", "n comprobante", "comprobante*", "n°*"],
  cantidad: ["cantidad ingre*", "cantidad"],
  precio: ["precio unit*", "precio unitario*"],
};

const MAX_PRECIO = 1e10;
const corto = (s, n) => (s ? String(s).slice(0, n) : null);

/**
 * Lee la hoja fact_ingresos_stock publicada como CSV.
 * Se queda con los renglones con SKU, fecha y precio mayor a 0, y saltea los
 * que cargó Gypi ("GY-…"). Si un renglón no tiene ID_INGRESO, la referencia
 * se arma con sus datos (y un número si se repite igual).
 * @returns {{ filas: object[], salteados: number, faltaColumnas: boolean }}
 */
export function leerIngresosMrp(texto) {
  const todas = filasCsv(texto);
  const iTitulos = todas.findIndex((f) => {
    const t = f.map(normalizarTitulo);
    return t.some((c) => c === "id_sku" || c === "sku") && t.some((c) => c.startsWith("precio unit"));
  });
  if (iTitulos === -1) return { filas: [], salteados: 0, faltaColumnas: true };
  const col = columnas(todas[iTitulos], CAMPOS_INGRESOS);
  if (col.sku === undefined || col.precio === undefined) return { filas: [], salteados: 0, faltaColumnas: true };
  const celda = (f, campo) => (col[campo] === undefined ? "" : String(f[col[campo]] ?? "").replace(/\s+/g, " ").trim());

  const filas = [];
  const vistas = new Map();
  let salteados = 0;
  for (const f of todas.slice(iTitulos + 1)) {
    const id = celda(f, "id");
    const sku = celda(f, "sku");
    if (!sku && !id) continue;
    if (/^gy-/i.test(id)) { salteados++; continue; }
    const precio = numeroPlanilla(celda(f, "precio"));
    const fecha = fechaPlanilla(celda(f, "fecha_compra")) || fechaPlanilla(celda(f, "fecha_carga"));
    if (!SKU_VALIDO.test(sku) || !(precio > 0) || precio >= MAX_PRECIO || !fecha || fecha < "2000-01-01") { salteados++; continue; }
    const comprobante = corto(celda(f, "comprobante"), 60);
    const cantidad = numeroPlanilla(celda(f, "cantidad"));
    let referencia = id ? `ING-${id}` : `${sku}|${fecha}|${comprobante || ""}|${cantidad ?? ""}|${precio}`;
    const n = (vistas.get(referencia) || 0) + 1;
    vistas.set(referencia, n);
    if (n > 1) referencia = `${referencia}#${n}`;
    filas.push({
      sku,
      fecha,
      precio,
      moneda: "ARS",
      tipo_cambio: null,
      precio_ars: precio,
      origen: "mrp",
      referencia: referencia.slice(0, 200),
      proveedor: corto(celda(f, "proveedor"), 120),
      comprobante,
      cantidad: cantidad !== null && Math.abs(cantidad) < MAX_PRECIO ? cantidad : null,
      nombre: corto(celda(f, "nombre"), 200),
    });
  }
  return { filas, salteados, faltaColumnas: false };
}

/** Precios de un artículo, del más nuevo al más viejo (mismo día: el último cargado primero). */
export function historialPrecios(precios = []) {
  return [...precios].sort((a, b) => (a.fecha === b.fecha ? 0 : a.fecha < b.fecha ? 1 : -1));
}

/** 1234.5 → "$ 1.234,50"; null → "—". */
export function textoPrecio(n, moneda = "ARS") {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  const v = Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${moneda === "USD" ? "US$" : "$"} ${v}`;
}

/** Quién ve precios: Dueño, Supervisor y Administración (la RLS de 164 pide lo mismo). */
export const veePrecios = (usuario) => usuario?.rol === "gerencial" || usuario?.rol === "administrativo";

/**
 * Último precio de cada artículo, para la lista de Stock y la ficha.
 * Toma la compra con fecha más nueva y precio en pesos (mismo día: la primera
 * de la lista, que viene ordenada de la más nueva a la más vieja). Si un
 * artículo no tiene ninguna compra, usa el "último precio" de la planilla
 * (ARTICULOS) sin fecha.
 * @param {object[]} precios renglones de v_precios_articulos
 * @param {object[]} articulos renglones de articulos_stock (para ultimo_precio)
 * @returns {Map<string, { precio: number, fecha: string|null, origen: string, proveedor: string|null, moneda: string, precio_usd: number|null }>}
 */
export function ultimosPrecios(precios = [], articulos = []) {
  const res = new Map();
  for (const p of precios) {
    const v = Number(p?.precio_ars);
    if (!p?.sku || !p.fecha || p.precio_ars === null || p.precio_ars === undefined || !Number.isFinite(v) || v < 0) continue;
    const fecha = String(p.fecha).slice(0, 10);
    const ya = res.get(p.sku);
    if (ya && ya.fecha >= fecha) continue;
    res.set(p.sku, {
      precio: v,
      fecha,
      origen: p.origen || null,
      proveedor: p.proveedor || null,
      moneda: p.moneda || "ARS",
      precio_usd: p.moneda === "USD" && Number.isFinite(Number(p.precio)) ? Number(p.precio) : null,
    });
  }
  for (const a of articulos) {
    const v = Number(a?.ultimo_precio);
    if (!a?.sku || res.has(a.sku) || !(v > 0)) continue;
    res.set(a.sku, { precio: v, fecha: null, origen: "planilla", proveedor: null, moneda: "ARS", precio_usd: null });
  }
  return res;
}

/** "14/11/2026" o "sin fecha" para el último precio. */
export function textoFechaPrecio(u) {
  return u?.fecha ? u.fecha.split("-").reverse().join("/") : "sin fecha";
}
