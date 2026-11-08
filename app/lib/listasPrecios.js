// app/lib/listasPrecios.js — Listas de precios de proveedores en Excel o CSV
// (migración 169; se guardan como facturas_sueltas con tipo 'lista', ver
// app/lib/facturasSueltas.js). Lee la grilla, busca solo la fila de títulos
// y las columnas de descripción, código y precio, y arma los renglones. Todo
// puro: corre en el navegador (el Excel se lee con app/lib/leerXlsx.js) y se
// prueba sin red.
import { MAX_RENGLONES_LISTA, normalizarTexto } from "./facturasSueltas";

export { MAX_RENGLONES_LISTA };

/** "A", "B", … "AA" para mostrar la columna como en Excel. */
export function letraColumna(i) {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Separador de un CSV: el que más aparece (fuera de comillas) en las primeras líneas. */
function separadorCsv(texto) {
  const muestra = texto.split(/\r?\n/).slice(0, 20).join("\n").replace(/"[^"]*"/g, "");
  const cuenta = (c) => muestra.split(c).length - 1;
  const [mejor, veces] = [";", "\t", ","].map((c) => [c, cuenta(c)]).sort((a, b) => b[1] - a[1])[0];
  return veces > 0 ? mejor : ",";
}

/** Un CSV (o texto con tabulaciones) como filas de texto. Respeta comillas. */
export function parsearCsv(texto) {
  const t = String(texto ?? "").replace(/^﻿/, "");
  const sep = separadorCsv(t);
  const filas = [];
  let fila = [];
  let celda = "";
  let comillas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (comillas) {
      if (ch === '"' && t[i + 1] === '"') { celda += '"'; i++; }
      else if (ch === '"') comillas = false;
      else celda += ch;
    } else if (ch === '"' && celda === "") comillas = true;
    else if (ch === sep) { fila.push(celda.trim()); celda = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      fila.push(celda.trim());
      filas.push(fila);
      fila = [];
      celda = "";
    } else celda += ch;
  }
  if (celda !== "" || fila.length) { fila.push(celda.trim()); filas.push(fila); }
  return filas;
}

/**
 * Número de una celda. Del Excel ya viene con punto decimal ("1234.5"); de un
 * CSV o un texto puede venir como "$ 1.234,56", "1,234.56" o "1.234" (mil).
 * @param {unknown} v
 * @param {{ excel?: boolean }} [opts]
 */
export function numeroCelda(v, { excel = false } = {}) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const crudo = String(v ?? "").trim();
  if (!crudo) return null;
  if (excel && /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(crudo)) return Number(crudo);
  // Solo números con signo de moneda: "18mm" o "Placa 18" no son un precio
  const t = crudo.replace(/u\$s|us\$|usd|ars|\$|€|\s/gi, "");
  if (!/^-?[\d.,]*\d[\d.,]*$/.test(t)) return null;
  const coma = t.lastIndexOf(",");
  const punto = t.lastIndexOf(".");
  let limpio;
  if (coma >= 0 && punto >= 0) {
    limpio = coma > punto ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (coma >= 0) {
    limpio = (t.match(/,/g).length > 1) ? t.replace(/,/g, "") : t.replace(",", ".");
  } else if (punto >= 0) {
    const partes = t.split(".");
    const miles = partes.length > 2 || (partes[1].length === 3 && !/^-?0*$/.test(partes[0]));
    limpio = miles ? t.replace(/\./g, "") : t;
  } else limpio = t;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

const PALABRAS = {
  codigo: ["cod", "codigo", "codigos", "sku", "ref", "referencia", "art nro", "nro art", "id"],
  precio: ["precio", "precios", "importe", "unitario", "valor", "neto", "costo", "lista", "pvp", "usd", "u s", "ars", "monto"],
  descripcion: ["descripcion", "descrip", "desc", "articulo", "articulos", "producto", "productos", "detalle", "nombre", "item", "material"],
};

/** Qué es un título de columna: "codigo", "precio", "descripcion" o null. */
export function rolDeTitulo(titulo) {
  const t = normalizarTexto(titulo);
  if (!t || t.length > 60) return null;
  const palabras = t.split(" ");
  const tiene = (lista) => lista.some((p) => (p.includes(" ") ? t.includes(p) : palabras.includes(p)));
  if (tiene(PALABRAS.codigo) && !tiene(["descripcion", "descrip", "detalle", "nombre"])) return "codigo";
  if (tiene(PALABRAS.precio)) return "precio";
  if (tiene(PALABRAS.descripcion)) return "descripcion";
  return null;
}

/** Entre varias columnas de precio: la sin IVA o neta antes que la con IVA. */
function mejorPrecio(columnas, titulos) {
  const puntaje = (i) => {
    const t = normalizarTexto(titulos[i]);
    if (/\bsin iva\b|\bs iva\b|\bneto\b/.test(t)) return 3;
    if (/\bcon iva\b|\bc iva\b|\bfinal\b|\bpublico\b/.test(t)) return 0;
    if (/\biva\b/.test(t) && !/\bprecio\b/.test(t)) return -1;
    return 2;
  };
  return [...columnas].sort((a, b) => puntaje(b) - puntaje(a))[0];
}

/**
 * Busca las columnas de una lista de precios.
 * @param {string[][]} grilla
 * @param {{ excel?: boolean }} [opts]
 * @returns {{ titulos: number, descripcion: number, codigo: number, precio: number,
 *   moneda: "ARS"|"USD"|null, conIva: boolean, porTitulos: boolean }}
 *   titulos = fila de títulos (-1 si no tiene); columnas desde 0 (-1 = no hay).
 */
export function detectarColumnas(grilla, { excel = false } = {}) {
  const filas = Array.isArray(grilla) ? grilla : [];
  for (let f = 0; f < Math.min(filas.length, 30); f++) {
    const fila = filas[f] || [];
    const roles = { codigo: [], precio: [], descripcion: [] };
    fila.forEach((c, i) => {
      const rol = rolDeTitulo(c);
      if (rol) roles[rol].push(i);
    });
    if (!roles.precio.length || !roles.descripcion.length) continue;
    const precio = mejorPrecio(roles.precio, fila);
    const tituloPrecio = normalizarTexto(fila[precio]);
    // "Artículo" a veces es el código y "Descripción" el nombre: de las
    // columnas que parecen descripción gana la de textos más largos (con
    // espacios); otra corta y sin espacios pasa a ser el código si no hay.
    const datos = filas.slice(f + 1, f + 301);
    const ordenadas = [...roles.descripcion].sort((a, b) => puntajeTexto(datos, b, excel) - puntajeTexto(datos, a, excel));
    const descripcion = ordenadas[0];
    const codigoCorto = ordenadas.slice(1).find((i) => largoMedio(datos, i) <= 25);
    return {
      titulos: f,
      descripcion,
      codigo: roles.codigo[0] ?? codigoCorto ?? -1,
      precio,
      moneda: /\busd\b|\bu s s?\b|\bdolar(es)?\b|\bus\b/.test(tituloPrecio) ? "USD" : /\bars\b|\bpesos?\b/.test(tituloPrecio) ? "ARS" : null,
      conIva: /\bcon iva\b|\bc iva\b|\biva incluido\b|\bfinal\b/.test(tituloPrecio),
      porTitulos: true,
    };
  }
  return { ...adivinarColumnas(filas, { excel }), titulos: -1, moneda: null, conIva: false, porTitulos: false };
}

/** Largo medio de los textos (no números) de una columna. */
function largoMedio(filas, i, excel = false) {
  let n = 0, largo = 0;
  for (const f of filas) {
    const c = String(f?.[i] ?? "").trim();
    if (!c || numeroCelda(c, { excel }) !== null) continue;
    n++;
    largo += c.length;
  }
  return n ? largo / n : 0;
}

/** Cuánto parece una columna un nombre de artículo: textos largos y con espacios. */
function puntajeTexto(filas, i, excel) {
  let n = 0, conEspacio = 0;
  for (const f of filas) {
    const c = String(f?.[i] ?? "").trim();
    if (!c || numeroCelda(c, { excel }) !== null) continue;
    n++;
    if (/\s/.test(c)) conEspacio++;
  }
  return largoMedio(filas, i, excel) * (0.5 + (n ? conEspacio / n : 0));
}

/** Sin títulos: precio = la columna de números más a la derecha; descripción = la de textos más largos. */
function adivinarColumnas(filas, { excel }) {
  const muestra = filas.slice(0, 300).filter((f) => (f || []).some((c) => String(c).trim()));
  const ancho = Math.max(0, ...muestra.map((f) => f.length));
  const stats = [];
  for (let i = 0; i < ancho; i++) {
    let llenas = 0, numeros = 0, largoTexto = 0, textos = 0;
    for (const f of muestra) {
      const c = String(f[i] ?? "").trim();
      if (!c) continue;
      llenas++;
      if (numeroCelda(c, { excel }) !== null) numeros++;
      else { textos++; largoTexto += c.length; }
    }
    stats.push({ i, llenas, numeros, textos, largo: textos ? largoTexto / textos : 0 });
  }
  const minimo = Math.max(1, muestra.length * 0.5);
  const descripcion = [...stats].filter((s) => s.textos >= minimo).sort((a, b) => b.largo - a.largo)[0]?.i ?? -1;
  const precio = [...stats].filter((s) => s.i !== descripcion && s.numeros >= minimo).sort((a, b) => b.i - a.i)[0]?.i ?? -1;
  const codigo = [...stats]
    .filter((s) => s.i !== descripcion && s.i !== precio && s.llenas >= minimo && s.i < descripcion && s.largo <= 25)
    .sort((a, b) => b.i - a.i)[0]?.i ?? -1;
  return { descripcion, codigo, precio };
}

/**
 * Renglones de la lista con las columnas elegidas. Saltea los que no tienen
 * descripción o precio (títulos de rubro, totales, filas vacías).
 * @returns {{ renglones: { descripcion: string, codigo: string, cantidad: number, precio: number }[], salteados: number, demas: number }}
 */
export function renglonesDeGrilla(grilla, cols, { excel = false, max = MAX_RENGLONES_LISTA } = {}) {
  const renglones = [];
  let salteados = 0;
  let demas = 0;
  if (!cols || cols.descripcion < 0 || cols.precio < 0) return { renglones, salteados, demas };
  const todas = Array.isArray(grilla) ? grilla : [];
  const titulos = cols.titulos >= 0 ? todas[cols.titulos] || [] : [];
  const filas = todas.slice(cols.titulos + 1);
  for (const f of filas) {
    if (!f || !f.some((c) => String(c).trim())) continue;
    const descripcion = String(f[cols.descripcion] ?? "").trim().slice(0, 200);
    const precio = numeroCelda(f[cols.precio], { excel });
    if (!descripcion || precio === null || precio <= 0 || precio >= 1e10 || numeroCelda(descripcion) !== null) { salteados++; continue; }
    if (renglones.length >= max) { demas++; continue; }
    renglones.push({
      descripcion,
      codigo: cols.codigo >= 0 ? String(f[cols.codigo] ?? "").trim().slice(0, 60) : "",
      cantidad: 1,
      precio: Math.round(precio * 10000) / 10000,
      detalle: detalleDeFila(f, titulos, cols),
    });
  }
  return { renglones, salteados, demas };
}

/**
 * El resto de la fila ("Rubro: Herrajes · Unidad: u · Precio c/IVA: 1.493"),
 * para reconocer el artículo en Sin asociar aunque la descripción sea corta.
 */
export function detalleDeFila(fila, titulos, cols) {
  const usadas = new Set([cols.descripcion, cols.codigo, cols.precio]);
  const partes = [];
  (fila || []).forEach((c, i) => {
    const v = String(c ?? "").trim();
    if (!v || usadas.has(i)) return;
    const t = String(titulos?.[i] ?? "").trim();
    partes.push(t ? `${t}: ${v}` : v);
  });
  return partes.join(" · ").slice(0, 600);
}

/** Proveedor probable por el nombre del archivo ("Lista Faplac 11-2026.xlsx" → "Faplac"). */
export function proveedorDeArchivo(nombre) {
  return String(nombre || "").replace(/\.[^.]+$/, "").replace(/lista( de)?( precios?)?/i, "").replace(/[\d_\-./]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

/** Sin IVA: divide cada precio por (1 + alícuota). */
export function sacarIva(renglones, alicuota = 21) {
  const f = 1 + Number(alicuota) / 100;
  return renglones.map((r) => {
    const p = numeroCelda(r.precio);
    return p === null ? r : { ...r, precio: Math.round((p / f) * 10000) / 10000 };
  });
}

/* ─── Sugerencias para Sin asociar ────────────────────────────────────────── */

const VACIAS = new Set(["de", "la", "el", "los", "las", "x", "con", "para", "en", "y", "por", "mm", "cm", "un", "u"]);
const fichas = (s) => new Set(normalizarTexto(s).split(" ").filter((p) => p.length > 1 && !VACIAS.has(p)));
const cacheFichas = new WeakMap();

/**
 * Hasta `cuantos` artículos del MRP que se parecen a la descripción (palabras
 * en común). Es solo una sugerencia: el artículo lo elige una persona.
 */
export function sugerirParecidos(descripcion, articulos, cuantos = 3) {
  const buscadas = fichas(descripcion);
  if (!buscadas.size || !Array.isArray(articulos)) return [];
  let indice = cacheFichas.get(articulos);
  if (!indice) {
    indice = articulos.map((a) => ({ a, f: fichas(a.nombre) }));
    cacheFichas.set(articulos, indice);
  }
  const res = [];
  for (const { a, f } of indice) {
    if (!f.size) continue;
    let comunes = 0;
    for (const p of buscadas) if (f.has(p)) comunes++;
    if (comunes < Math.min(2, buscadas.size)) continue;
    const puntaje = comunes / (buscadas.size + f.size - comunes);
    if (puntaje >= 0.25) res.push({ a, puntaje });
  }
  return res.sort((x, y) => y.puntaje - x.puntaje).slice(0, cuantos).map((x) => x.a);
}
