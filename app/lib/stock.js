// app/lib/stock.js — Artículos y stock leídos de la planilla MRP (Stock,
// parte 13; ítem 40; migración 106).
//
// La planilla MRP de la empresa sigue mandando: artículos, necesidades,
// cálculo de stock, semáforo y plan de compras se hacen allá. Gypi copia dos
// hojas publicadas como CSV:
//   - INVENTARIO (obligatoria): SKU, ARTICULO, STOCK TOTAL, NECESIDAD…,
//     DISPONIBLE, PUNTO DE PEDIDO, PRÓXIMA NECESIDAD, SEMÁFORO MRP, CANTIDAD
//     SUGERIDA, DIVISIÓN, EN TRÁNSITO, MÚLTIPLO, LEAD TIME (d).
//   - ARTICULOS (opcional): ID_SKU, Nombre normalizado (el nombre que se
//     muestra; si está vacío, Nombre Articulo), División, Familia, Tipo de
//     Material, Marca, Color/Acabado, Unidad Medida, ÚLTIMO PRECIO,
//     PROVEEDOR PRINCIPAL, LOTE MÍNIMO / MÚLTIPLO (los usa Compras, parte 21).
// Las columnas se buscan por título (sin importar mayúsculas, acentos ni el
// orden), así una columna nueva en la planilla no rompe nada.
//
// Cada artículo lleva una etiqueta con QR (linkArticulo) que abre su ficha en
// la app; en la parte 14 el mismo QR sirve para retirar material.
import { filasCsv, fechaPlanilla } from "./csvProyectos";
import { svgQR } from "./tarjetasQR";

export const CLAVE_STOCK_CSV = "stock_csv_url";

/** SKU que se acepta: el código por niveles de la planilla ("1.3.2.69.155"). */
export const SKU_VALIDO = /^[\w.-]{1,60}$/;

const sinAcentos = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
/** "  Unidad   Medida " → "unidad medida" (para comparar títulos). */
export const normalizarTitulo = (s) => sinAcentos(s).toLowerCase().replace(/\s+/g, " ").trim();

// Títulos de cada campo, en orden de preferencia. "x*" = empieza con "x".
const CAMPOS_INVENTARIO = {
  sku: ["sku", "id_sku"],
  nombre: ["articulo", "nombre articulo"],
  division: ["division"],
  stock: ["stock total", "stock"],
  necesidad: ["necesidad pe*", "necesidad bruta"],
  disponible: ["disponible"],
  en_transito: ["en transito"],
  punto_pedido: ["punto de pedido"],
  sugerido: ["cantidad sug*"],
  proxima_necesidad: ["proxima nece*"],
  semaforo: ["semaforo mrp"],
  // Compras (parte 21, migración 114)
  multiplo: ["multiplo"],
  plazo_dias: ["lead time*"],
};
const CAMPOS_ARTICULOS = {
  sku: ["id_sku", "sku"],
  // El nombre que se muestra es el normalizado (pedido del dueño, 15/10)
  nombre: ["nombre norma*", "nombre articulo", "articulo"],
  nombre_original: ["nombre articulo", "articulo"],
  division: ["division"],
  familia: ["familia"],
  tipo: ["tipo de mate*", "tipo"],
  unidad: ["unidad medida", "unidad*"],
  marca: ["marca"],
  color: ["color*"],
  // Compras (parte 21, migración 114)
  ultimo_precio: ["ultimo precio"],
  proveedor_principal: ["proveedor principal"],
  multiplo: ["lote minimo*"],
};

// Largo máximo de cada texto (los mismos que la migración 106)
const LARGO = { sku: 60, nombre: 200, nombre_original: 200, division: 60, familia: 80, tipo: 60, unidad: 20, marca: 80, color: 80, semaforo: 40, proveedor_principal: 120 };
const TEXTOS = ["nombre", "division", "familia", "tipo", "unidad", "marca", "color", "semaforo"];
const NUMEROS = ["stock", "necesidad", "disponible", "en_transito", "punto_pedido", "sugerido", "ultimo_precio", "multiplo", "plazo_dias"];
const MAX_NUMERO = 1e10;

/**
 * Número como lo escribe la planilla: "$1.012,00", "15,7", "-24", "1.234".
 * Vacío, guion, texto o error de fórmula (#N/A) → null.
 */
export function numeroPlanilla(texto) {
  let t = String(texto ?? "").replace(/[$\s ]/g, "");
  if (!t || t.startsWith("#")) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  if (!Number.isFinite(n) || Math.abs(n) >= MAX_NUMERO) return null;
  return Math.round(n * 1000) / 1000;
}

/** Índice de la columna de cada campo, según los títulos. */
function columnas(titulos, campos) {
  const norm = titulos.map(normalizarTitulo);
  const out = {};
  for (const [campo, patrones] of Object.entries(campos)) {
    for (const p of patrones) {
      const i = p.endsWith("*") ? norm.findIndex((t) => t.startsWith(p.slice(0, -1))) : norm.indexOf(p);
      if (i !== -1) { out[campo] = i; break; }
    }
  }
  return out;
}

/**
 * Lee una hoja: busca la fila de títulos (la primera que tiene una columna
 * SKU; arriba puede haber títulos de la hoja) y arma un objeto por renglón.
 * @returns {{ filas: object[], conSku: boolean, sinSku: number }}
 */
function leerHoja(texto, campos) {
  const todas = filasCsv(texto);
  const iTitulos = todas.findIndex((f) => f.some((c) => ["sku", "id_sku"].includes(normalizarTitulo(c))));
  if (iTitulos === -1) return { filas: [], conSku: false, sinSku: 0 };
  const col = columnas(todas[iTitulos], campos);
  const filas = [];
  let sinSku = 0;
  for (const f of todas.slice(iTitulos + 1)) {
    const sku = String(f[col.sku] ?? "").trim();
    if (!SKU_VALIDO.test(sku) || normalizarTitulo(sku) === "sku") { sinSku++; continue; }
    const fila = { sku };
    for (const campo of Object.keys(campos)) {
      if (campo === "sku" || col[campo] === undefined) continue;
      const valor = String(f[col[campo]] ?? "").replace(/\s+/g, " ").trim();
      if (campo === "plazo_dias") {
        const n = numeroPlanilla(valor);
        fila[campo] = n !== null && n >= 0 && n <= 3650 ? Math.round(n) : null;
      } else if (NUMEROS.includes(campo)) fila[campo] = numeroPlanilla(valor);
      else if (campo === "proxima_necesidad") fila[campo] = fechaPlanilla(valor);
      else fila[campo] = valor ? valor.slice(0, LARGO[campo]) : null;
    }
    filas.push(fila);
  }
  return { filas, conSku: true, sinSku };
}

const VACIO = Object.freeze({
  nombre: null, division: null, familia: null, tipo: null, unidad: null, marca: null, color: null,
  stock: null, necesidad: null, disponible: null, en_transito: null, punto_pedido: null, sugerido: null,
  proxima_necesidad: null, semaforo: null,
  ultimo_precio: null, proveedor_principal: null, multiplo: null, plazo_dias: null,
});

/**
 * Junta las dos hojas en un artículo por SKU: los datos del artículo salen de
 * ARTICULOS y el stock de INVENTARIO (el nombre y la división de INVENTARIO
 * sirven si ARTICULOS no los tiene). Todas las filas traen las mismas claves
 * (PostgREST lo pide en un lote).
 * @param {{ inventario: string, articulos?: string|null }} csv
 * @returns {{ filas: object[], sinSku: number, faltaColumnaSku: boolean }}
 */
export function unirArticulos({ inventario, articulos = null }) {
  const inv = leerHoja(inventario, CAMPOS_INVENTARIO);
  const art = articulos ? leerHoja(articulos, CAMPOS_ARTICULOS) : { filas: [], conSku: true, sinSku: 0 };
  const porSku = new Map();
  for (const { nombre_original, ...a } of art.filas) porSku.set(a.sku, { ...VACIO, ...a, nombre: a.nombre || nombre_original || null });
  for (const i of inv.filas) {
    const previo = porSku.get(i.sku) || { ...VACIO, sku: i.sku };
    const unido = { ...previo };
    for (const [k, v] of Object.entries(i)) {
      if (k === "sku") continue;
      if ((k === "nombre" || k === "division") && previo[k]) continue;
      unido[k] = v;
    }
    porSku.set(i.sku, unido);
  }
  return {
    filas: [...porSku.values()],
    sinSku: inv.sinSku + art.sinSku,
    faltaColumnaSku: !inv.conSku || !art.conSku,
  };
}

/** Color del semáforo MRP de la planilla ("✅ OK", "🔴 URGENTE"…): rojo, amarillo, verde o null. */
export function nivelSemaforo(texto) {
  const t = sinAcentos(texto).toUpperCase();
  if (!t.trim()) return null;
  if (/🔴|URGENTE|ROJO|SIN STOCK/.test(t)) return "rojo";
  if (/🟡|🟠|⚠|PEDIR|ATENCION|AMARILLO|REVISAR|BAJO/.test(t)) return "amarillo";
  if (/✅|🟢|\bOK\b|VERDE/.test(t)) return "verde";
  return null;
}

const ORDEN_NIVEL = { rojo: 0, amarillo: 1 };

/**
 * Artículos que coinciden con la búsqueda, los urgentes primero.
 * @param {object[]} lista
 * @param {{ texto?: string, division?: string, urgentes?: boolean }} filtro
 *   texto: palabras que tienen que estar en el nombre, el SKU o la familia
 */
export function filtrarArticulos(lista, { texto = "", division = "", urgentes = false } = {}) {
  const palabras = normalizarTitulo(texto).split(" ").filter(Boolean);
  return (Array.isArray(lista) ? lista : [])
    .filter((a) => a && a.activo !== false)
    .filter((a) => !division || a.division === division)
    .filter((a) => !urgentes || nivelSemaforo(a.semaforo) === "rojo")
    .filter((a) => {
      if (!palabras.length) return true;
      const donde = normalizarTitulo([a.nombre, a.sku, a.familia].filter(Boolean).join(" "));
      return palabras.every((p) => donde.includes(p));
    })
    .sort((a, b) => (ORDEN_NIVEL[nivelSemaforo(a.semaforo)] ?? 2) - (ORDEN_NIVEL[nivelSemaforo(b.semaforo)] ?? 2)
      || String(a.nombre || a.sku).localeCompare(String(b.nombre || b.sku), "es"));
}

/** Cuántos artículos se sugieren al buscar en un formulario. */
export const MAX_SUGERIDOS = 20;

/**
 * Sugerencias para el buscador de un formulario (Pedir material, Movimientos):
 * las primeras MAX_SUGERIDOS y cuántas quedan afuera, para avisar que hay más
 * y que se escriba otra palabra (con 8 y sin aviso, un artículo nuevo podía
 * quedar escondido detrás de los urgentes).
 * @returns {{ lista: object[], resto: number }}
 */
export function sugerirArticulos(lista, texto, max = MAX_SUGERIDOS) {
  if (!String(texto ?? "").trim()) return { lista: [], resto: 0 };
  const todos = filtrarArticulos(lista, { texto });
  return { lista: todos.slice(0, max), resto: Math.max(0, todos.length - max) };
}

/** Divisiones de los artículos, para los filtros. */
export function divisionesDe(lista) {
  return [...new Set((Array.isArray(lista) ? lista : []).map((a) => a?.division).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
}

/** "1234.5" → "1.234,5" (sin ceros de más); null → "—". */
export function cantidadTexto(n) {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString("es-AR", { maximumFractionDigits: 3 }) : "—";
}

/* ─── QR del artículo ─────────────────────────────────────────────────────── */

/** Link que abre la ficha del artículo en la app (va en el QR de la etiqueta). */
export function linkArticulo(origen, slug, sku) {
  return `${String(origen).replace(/\/$/, "")}/${encodeURIComponent(slug)}?articulo=${encodeURIComponent(String(sku))}`;
}

/**
 * SKU de un QR escaneado: el link de la etiqueta (…?articulo=SKU) o el SKU
 * solo (por si la planilla imprime sus propios QR). Si no, null.
 */
export function leerQrArticulo(texto) {
  const s = String(texto ?? "").trim();
  if (!s || s.length > 500) return null;
  if (/^https?:\/\//i.test(s)) {
    let url;
    try { url = new URL(s); } catch { return null; }
    const sku = url.searchParams.get("articulo");
    return sku && SKU_VALIDO.test(sku) ? sku : null;
  }
  return SKU_VALIDO.test(s) ? s : null;
}

/* ─── Etiquetas para imprimir ─────────────────────────────────────────────── */

export const MAX_ETIQUETAS_ARTICULO = 300;

const ESCAPES = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES.get(c));

/**
 * Página con una etiqueta por artículo, del tamaño del rollo de la impresora
 * de etiquetas (una por página): nombre, SKU, unidad y división, y el QR.
 * @param {{ empresa: string, articulos: object[], origen: string, slug: string, tamano: { ancho: number, alto: number } }} datos
 */
export async function htmlEtiquetasArticulos({ empresa, articulos, origen, slug, tamano }) {
  const lista = articulos.slice(0, MAX_ETIQUETAS_ARTICULO);
  const qrs = await Promise.all(lista.map((a) => svgQR(linkArticulo(origen, slug, a.sku))));
  const qrMm = Math.min(tamano.alto - 8, tamano.ancho * 0.42);
  const items = lista.map((a, i) => {
    const detalle = [a.unidad, a.division].filter(Boolean).join(" · ");
    return `
  <div class="etiqueta">
    <div class="texto">
      <div class="empresa">${esc(empresa)}</div>
      <div class="nombre">${esc(a.nombre || a.sku)}</div>
      <div class="sku">${esc(a.sku)}</div>
      ${detalle ? `<div class="detalle">${esc(detalle)}</div>` : ""}
    </div>
    <div class="qr">${qrs[i]}</div>
  </div>`;
  }).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas de artículos</title>
<style>
  @page { size: ${tamano.ancho}mm ${tamano.alto}mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; color: #000; }
  .etiqueta { width: ${tamano.ancho}mm; height: ${tamano.alto}mm; padding: 3mm; display: flex; gap: 3mm; align-items: center; overflow: hidden; page-break-after: always; break-after: page; }
  .texto { flex: 1; min-width: 0; }
  .empresa { font-size: 7pt; text-transform: uppercase; letter-spacing: .04em; }
  .nombre { font-size: 11pt; font-weight: 800; line-height: 1.15; max-height: 3.5em; overflow: hidden; }
  .sku { font-size: 10pt; font-family: ui-monospace, monospace; margin-top: 1mm; }
  .detalle { font-size: 8pt; margin-top: .5mm; }
  .qr svg { width: ${qrMm}mm; height: ${qrMm}mm; display: block; }
</style></head><body>${items}</body></html>`;
}

/** Abre las etiquetas en una pestaña nueva con el diálogo de impresión. */
export async function imprimirEtiquetasArticulos(datos) {
  const ventana = window.open("", "_blank");
  if (!ventana) throw new Error("El navegador bloqueó la ventana. Permití las ventanas emergentes e intentá de nuevo.");
  ventana.document.write(await htmlEtiquetasArticulos(datos));
  ventana.document.close();
  ventana.focus();
  setTimeout(() => ventana.print(), 300);
}

// ─── Necesidades por OT (Stock, parte 16; migración 108) ───────────────────
// Hoja fact_necesidades_stock: SKU, FECHA, ARTICULO, CANTIDAD PRESUPUESTADA,
// CANT. CANCELADA, OT, ¿OBRA TERMINADA?… Arriba tiene dos filas de título.

const CAMPOS_NECESIDADES = {
  sku: ["sku", "id_sku"],
  nombre: ["articulo", "nombre*"],
  cantidad: ["cantidad presu*", "cantidad"],
  cancelada: ["cant. cancel*", "cantidad cancel*"],
  ot: ["ot", "codigo proy*"],
  fecha: ["fecha requ*", "fecha"],
  terminada: ["obra terminada*"],
};
const SI_NO = { si: true, "sí": true, no: false };

/**
 * Lee la hoja de necesidades y junta los renglones de la misma OT y artículo:
 * cantidad = presupuestada − cancelada; fecha = la primera; nombre = el primero.
 * @returns {{ filas: object[], sinSku: number, faltaColumnas: boolean }}
 */
export function leerNecesidades(texto) {
  const todas = filasCsv(texto);
  const limpiarTitulo = (c) => String(c ?? "").replace(/[¿?]/g, "");
  const iTitulos = todas.findIndex((f) => {
    const t = f.map((c) => normalizarTitulo(limpiarTitulo(c)));
    return t.some((c) => c === "sku" || c === "id_sku") && t.includes("ot");
  });
  if (iTitulos === -1) return { filas: [], sinSku: 0, faltaColumnas: true };
  const col = columnas(todas[iTitulos].map(limpiarTitulo), CAMPOS_NECESIDADES);
  if (col.cantidad === undefined) return { filas: [], sinSku: 0, faltaColumnas: true };
  const celda = (f, campo) => (col[campo] === undefined ? "" : String(f[col[campo]] ?? "").replace(/\s+/g, " ").trim());

  const porClave = new Map();
  let sinSku = 0;
  for (const f of todas.slice(iTitulos + 1)) {
    const ot = celda(f, "ot").slice(0, 40);
    const sku = celda(f, "sku");
    if (!ot || !/\d/.test(ot)) continue;
    if (!SKU_VALIDO.test(sku)) { sinSku++; continue; }
    const cantidad = (numeroPlanilla(celda(f, "cantidad")) ?? 0) - (numeroPlanilla(celda(f, "cancelada")) ?? 0);
    const fechaLeida = fechaPlanilla(celda(f, "fecha"));
    const fecha = fechaLeida && fechaLeida >= "2000-01-01" ? fechaLeida : null;
    const terminada = SI_NO[normalizarTitulo(celda(f, "terminada"))] ?? null;
    const clave = `${ot}|${sku}`;
    const previa = porClave.get(clave);
    if (previa) {
      previa.cantidad = Math.round((previa.cantidad + cantidad) * 1000) / 1000;
      if (fecha && (!previa.fecha || fecha < previa.fecha)) previa.fecha = fecha;
      if (terminada !== null) previa.obra_terminada = terminada;
    } else {
      porClave.set(clave, {
        ot, sku,
        nombre: celda(f, "nombre").slice(0, LARGO.nombre) || null,
        cantidad: Math.round(cantidad * 1000) / 1000,
        fecha,
        obra_terminada: terminada,
      });
    }
  }
  return { filas: [...porClave.values()], sinSku, faltaColumnas: false };
}

/**
 * Material de una OT: lo necesario (planilla) contra lo retirado desde la app
 * (retiros menos devoluciones, sin los anulados).
 * @param {object[]} necesidades renglones de necesidades_stock de la OT
 * @param {object[]} movimientos renglones de movimientos_stock de la OT
 * @param {object[]} [articulos] articulos_stock, para el nombre y la unidad
 */
export function materialOt(necesidades = [], movimientos = [], articulos = []) {
  const art = new Map(articulos.map((a) => [a.sku, a]));
  const porSku = new Map();
  const fila = (sku) => {
    if (!porSku.has(sku)) porSku.set(sku, { sku, nombre: art.get(sku)?.nombre || null, unidad: art.get(sku)?.unidad || null, necesario: 0, retirado: 0, conNecesidad: false });
    return porSku.get(sku);
  };
  for (const n of necesidades) {
    const f = fila(n.sku);
    f.necesario += Number(n.cantidad) || 0;
    f.conNecesidad = true;
    f.nombre = f.nombre || n.nombre || null;
  }
  for (const m of movimientos) {
    if (m.anulado || (m.tipo !== "consumo" && m.tipo !== "devolucion")) continue;
    const f = fila(m.sku);
    f.retirado += (m.tipo === "devolucion" ? -1 : 1) * (Number(m.cantidad) || 0);
    f.nombre = f.nombre || m.nombre || null;
    f.unidad = f.unidad || m.unidad || null;
  }
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const filas = [...porSku.values()].map((f) => ({
    ...f,
    necesario: r3(f.necesario),
    retirado: r3(f.retirado),
    falta: f.conNecesidad ? Math.max(0, r3(f.necesario - f.retirado)) : 0,
  })).sort((a, b) => (b.falta > 0) - (a.falta > 0) || String(a.nombre || a.sku).localeCompare(String(b.nombre || b.sku), "es"));
  return {
    filas,
    conFalta: filas.filter((f) => f.falta > 0).length,
    completos: filas.filter((f) => f.conNecesidad && f.falta === 0).length,
    sinNecesidad: filas.filter((f) => !f.conNecesidad).length,
  };
}
