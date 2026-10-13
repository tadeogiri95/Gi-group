// app/lib/sueltos.js — Hoja de sueltos y herrajes de la OT (Órdenes de
// Producción, parte 9; ítem 39). Todo lo que viaja fuera de un módulo
// (maderas sin módulo, perfiles, herrajes y accesorios que van a obra) se
// lista por OT y se tilda en acopio y en la carga.

/** Tipos de ítem sugeridos (se puede escribir otro). */
export const TIPOS_SUELTO = ["Madera", "Perfil", "Herraje", "Accesorio", "Insumo"];

export const MAX_SUELTOS_POR_VEZ = 300;
export const LIMITES = { tipo: 30, codigo: 40, descripcion: 200, medida: 40, va_con: 80 };

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Títulos de columna que se reconocen (normalizados)
const TITULOS = new Map([
  ["tipo", "tipo"],
  ["codigo", "codigo"], ["cod", "codigo"], ["codpanel", "codigo"],
  ["descripcion", "descripcion"], ["detalle", "descripcion"], ["desc", "descripcion"],
  ["medida", "medida"], ["medidas", "medida"],
  ["cant", "cantidad"], ["cantidad", "cantidad"],
  ["vacon", "va_con"], ["destino", "va_con"], ["modulo", "va_con"],
  ["acopio", null], ["carga", null],
]);
// Sin títulos: el orden de la hoja SUELTOS del mapa de procesos
const ORDEN_HOJA = ["tipo", "codigo", "descripcion", "medida", "cantidad", "va_con"];

/**
 * Texto copiado de Excel → filas de celdas. Excel separa las celdas con
 * tabulaciones y las filas con saltos de línea; una celda con salto de línea
 * o comillas viene entre comillas ("..." con "" adentro).
 */
export function filasTsv(texto) {
  const s = String(texto ?? "").replace(/\r\n?/g, "\n");
  const filas = [];
  let fila = [];
  let celda = "";
  let entreComillas = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (entreComillas) {
      if (c === '"' && s[i + 1] === '"') { celda += '"'; i++; }
      else if (c === '"') entreComillas = false;
      else celda += c;
    } else if (c === '"' && celda === "") entreComillas = true;
    else if (c === "\t") { fila.push(celda); celda = ""; }
    else if (c === "\n") { fila.push(celda); filas.push(fila); fila = []; celda = ""; }
    else celda += c;
  }
  fila.push(celda);
  filas.push(fila);
  return filas;
}

/** "1,5" → 1.5; "2 u" → 2; "" → 1 (si no dice, es uno). null si no se entiende. */
export function leerCantidad(texto) {
  const s = String(texto ?? "").trim();
  if (!s || s === "-" || s === "—") return 1;
  // Con coma decimal, los puntos son de miles ("1.234,5")
  const v = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^\d/.test(v)) return null;
  const n = Math.round(parseFloat(v) * 100) / 100;
  return n > 0 && n <= 99999 ? n : null;
}

const limpiar = (v, max) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return !s || s === "-" || s === "—" ? null : s.slice(0, max);
};

/** El tipo como está en la lista sugerida ("herraje" → "Herraje"); si no está, tal cual. */
export function tipoNormal(tipo) {
  const t = limpiar(tipo, LIMITES.tipo);
  if (!t) return null;
  return TIPOS_SUELTO.find((x) => norm(x) === norm(t)) || t;
}

/**
 * Lo pegado desde Excel → ítems listos para guardar.
 * Si la primera fila con datos tiene títulos (Tipo, Código, Descripción,
 * Medida, Cant., Va con), las columnas se toman por título y en cualquier
 * orden; si no, en el orden de la hoja SUELTOS.
 * @returns {{ items: object[], errores: { fila: number, motivo: string }[], conTitulos: boolean }}
 */
export function parsearPegado(texto) {
  const filas = filasTsv(texto).map((celdas, i) => ({ celdas, linea: i + 1 })).filter((f) => f.celdas.some((c) => c.trim()));
  let columnas = ORDEN_HOJA;
  let conTitulos = false;
  if (filas.length) {
    const titulos = filas[0].celdas.map((c) => (TITULOS.has(norm(c)) ? TITULOS.get(norm(c)) : undefined));
    // Es fila de títulos si reconoce al menos dos columnas con datos
    if (titulos.filter((t) => t).length >= 2) {
      columnas = titulos.map((t) => t ?? null);
      conTitulos = true;
      filas.shift();
    }
  }
  const items = [];
  const errores = [];
  for (const { celdas, linea } of filas) {
    if (items.length >= MAX_SUELTOS_POR_VEZ) {
      errores.push({ fila: linea, motivo: `Se agregan hasta ${MAX_SUELTOS_POR_VEZ} por vez` });
      break;
    }
    const v = {};
    if (!conTitulos && celdas.length === 1) v.descripcion = celdas[0];
    else celdas.forEach((c, i) => { if (columnas[i]) v[columnas[i]] = c; });
    const item = {
      tipo: tipoNormal(v.tipo),
      codigo: limpiar(v.codigo, LIMITES.codigo),
      descripcion: limpiar(v.descripcion, LIMITES.descripcion),
      medida: limpiar(v.medida, LIMITES.medida),
      cantidad: leerCantidad(v.cantidad),
      va_con: limpiar(v.va_con, LIMITES.va_con),
    };
    if (!item.codigo && !item.descripcion) errores.push({ fila: linea, motivo: "No tiene código ni descripción" });
    else if (item.cantidad == null) errores.push({ fila: linea, motivo: `No entiendo la cantidad "${String(v.cantidad).trim()}"` });
    else items.push(item);
  }
  return { items, errores, conTitulos };
}

/** Cuántos ítems hay y cuántos están tildados en acopio y en carga. */
export function resumenSueltos(items = []) {
  return {
    total: items.length,
    acopio: items.filter((i) => i.acopio).length,
    carga: items.filter((i) => i.carga).length,
  };
}

/** "AJ.1 · Ajuste grafito" (lo que se muestra de un ítem). */
export function nombreSuelto(item) {
  return [item.codigo, item.descripcion].filter(Boolean).join(" · ") || "—";
}
