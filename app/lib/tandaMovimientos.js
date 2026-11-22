// app/lib/tandaMovimientos.js — Carga por tanda en Materiales → Movimientos
// (22/11, pedido de Tadeo: "seleccionar una fecha y cargar toda la tanda de
// consumos o de ingresos de esa fecha de una sola vez").
//
// Una tanda es una lista de renglones con la misma fecha. En consumos y
// devoluciones cada renglón lleva artículo, cantidad y OT (opcional); en
// ingresos, artículo, cantidad, precio sin IVA, proveedor y comprobante. El
// mismo artículo puede ir en más de un renglón (la misma placa para dos OT).
//
// También se puede pegar desde Excel o la planilla: una fila por renglón, con
// las columnas en este orden (separadas por tabulación, como sale al copiar):
//   consumo:  código o nombre · cantidad · OT
//   ingreso:  código o nombre · cantidad · precio sin IVA · proveedor · comprobante
// Si la primera fila son títulos (sin cantidad), se saltea.
//
// Lo que se va cargando queda guardado en el navegador (borrador), para no
// perderlo si se cierra la app.
import { filasTsv } from "./sueltos";
import { normalizarTitulo, filtrarArticulos } from "./stock";
import { leerCantidadMovimiento } from "./movimientosStock";

export const MAX_TANDA = 200;

let siguiente = 0;
/** Un renglón nuevo de la tanda. `de` trae lo que se copia (OT, proveedor, comprobante). */
export function renglonTanda(articulo, de = {}) {
  siguiente += 1;
  return {
    id: `r${Date.now().toString(36)}${siguiente}`,
    articulo,
    cantidad: de.cantidad ?? "",
    ot: de.ot ?? "",
    precio: de.precio ?? "",
    proveedor: de.proveedor ?? "",
    comprobante: de.comprobante ?? "",
  };
}

/**
 * Lo que hereda un renglón nuevo: la OT de todos (consumo) o el proveedor y
 * comprobante del último renglón (ingreso: una factura trae varios artículos).
 */
export function heredado(form) {
  if (form.tipo !== "ingreso") return { ot: form.otTodos || "" };
  const ult = form.renglones[form.renglones.length - 1];
  return { proveedor: ult?.proveedor ?? form.proveedor ?? "", comprobante: ult?.comprobante ?? form.comprobante ?? "" };
}

/** El artículo para lo escrito en una celda: el código exacto, el nombre exacto o, si hay uno solo, el que lo contiene. */
export function articuloDeTexto(texto, articulos = []) {
  const t = String(texto ?? "").trim();
  if (!t) return null;
  const lista = Array.isArray(articulos) ? articulos : [];
  const porSku = lista.find((a) => String(a?.sku).trim() === t);
  if (porSku) return porSku;
  const k = normalizarTitulo(t);
  const porNombre = lista.find((a) => a?.nombre && normalizarTitulo(a.nombre) === k);
  if (porNombre) return porNombre;
  const parecidos = filtrarArticulos(lista, { texto: t });
  return parecidos.length === 1 ? parecidos[0] : null;
}

/**
 * Lee lo pegado y arma los renglones.
 * @returns {{ renglones: object[], noEncontrados: string[], sinCantidad: string[], demasiados: boolean }}
 */
export function leerTandaPegada(texto, articulos = [], tipo = "consumo") {
  const filas = filasTsv(texto).map((f) => f.map((c) => String(c ?? "").trim())).filter((f) => f.some(Boolean));
  // La fila de títulos (sin número en la cantidad) se saltea
  if (filas.length && !leerCantidadMovimiento(filas[0][1])) {
    const t = normalizarTitulo(filas[0][1] || "");
    if (!t || /cant/.test(t)) filas.shift();
  }
  const renglones = [];
  const noEncontrados = [];
  const sinCantidad = [];
  for (const f of filas) {
    const articulo = articuloDeTexto(f[0], articulos);
    if (!articulo) { noEncontrados.push(f[0] || f.join(" ")); continue; }
    const cantidad = leerCantidadMovimiento(f[1]);
    if (!cantidad) { sinCantidad.push(articulo.nombre || articulo.sku); continue; }
    const cant = String(f[1]);
    renglones.push(tipo === "ingreso"
      ? renglonTanda(articulo, { cantidad: cant, precio: f[2] || "", proveedor: f[3] || "", comprobante: f[4] || "" })
      : renglonTanda(articulo, { cantidad: cant, ot: f[2] || "" }));
  }
  return { renglones: renglones.slice(0, MAX_TANDA), noEncontrados, sinCantidad, demasiados: renglones.length > MAX_TANDA };
}

/** Lo que se manda a la API por cada renglón, o el error del primero que está mal. */
export function renglonesParaGuardar(form) {
  const esIngreso = form.tipo === "ingreso";
  const salida = [];
  for (const r of form.renglones) {
    const nombre = r.articulo?.nombre || r.articulo?.sku;
    const cantidad = leerCantidadMovimiento(r.cantidad);
    if (!cantidad) return { error: `Poné la cantidad de ${nombre}` };
    if (!esIngreso) { salida.push({ sku: r.articulo.sku, cantidad, ot: String(r.ot || "").trim() || null }); continue; }
    const precioTxt = String(r.precio || "").trim();
    const precio = precioTxt ? leerCantidadMovimiento(precioTxt) : null;
    const esCero = Number(precioTxt.replace(",", ".")) === 0;
    if (precioTxt && precio === null && !esCero) return { error: `El precio de ${nombre} no es un número` };
    salida.push({
      sku: r.articulo.sku, cantidad,
      proveedor: String(r.proveedor || "").trim() || null,
      comprobante: String(r.comprobante || "").trim() || null,
      precio_unitario: precioTxt ? precio ?? 0 : null,
    });
  }
  if (salida.length > MAX_TANDA) return { error: `Son muchos: cargá hasta ${MAX_TANDA} por vez` };
  return { renglones: salida };
}

/* ─── Borrador (en este navegador) ────────────────────────────────────────── */

const clave = (tipo) => `gypi-tanda-${tipo}`;

export function leerBorrador(tipo) {
  try {
    const b = JSON.parse(window.localStorage.getItem(clave(tipo)) || "null");
    return b && Array.isArray(b.renglones) && b.renglones.length ? b : null;
  } catch {
    return null;
  }
}

export function guardarBorrador(form) {
  try {
    if (!form || !form.renglones?.length) window.localStorage.removeItem(clave(form?.tipo));
    else window.localStorage.setItem(clave(form.tipo), JSON.stringify({ ...form, texto: "" }));
  } catch { /* sin almacenamiento: no pasa nada */ }
}

export function borrarBorrador(tipo) {
  try { window.localStorage.removeItem(clave(tipo)); } catch { /* nada */ }
}
