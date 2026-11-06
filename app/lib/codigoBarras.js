// app/lib/codigoBarras.js — Código de barras de las piezas (06/11, Tadeo): la
// máquina que imprime las etiquetas de las piezas hace código de barras, no
// QR. El código es OT-Módulo-Pieza, "M7819-GB2P-11" (la OT sin el guion de
// adentro, para que sea corto; el resto es el nombre de la pieza tal cual en
// la planilla, que ya es Módulo-Pieza). Se lee con la cámara de Gypi.
//
// Code 128 (juego B: letras, números y signos comunes), dibujado como SVG sin
// librerías. Sin dependencias, para que lo usen piezas.js y escaneoCarga.js.

// Las 107 figuras del Code 128 (1 = barra, 0 = espacio); la última es el fin.
const BARRAS = [
  "11011001100", "11001101100", "11001100110", "10010011000", "10010001100", "10001001100", "10011001000", "10011000100",
  "10001100100", "11001001000", "11001000100", "11000100100", "10110011100", "10011011100", "10011001110", "10111001100",
  "10011101100", "10011100110", "11001110010", "11001011100", "11001001110", "11011100100", "11001110100", "11101101110",
  "11101001100", "11100101100", "11100100110", "11101100100", "11100110100", "11100110010", "11011011000", "11011000110",
  "11000110110", "10100011000", "10001011000", "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
  "11000101000", "11000100010", "10110111000", "10110001110", "10001101110", "10111011000", "10111000110", "10001110110",
  "11101110110", "11010001110", "11000101110", "11011101000", "11011100010", "11011101110", "11101011000", "11101000110",
  "11100010110", "11101101000", "11101100010", "11100011010", "11101111010", "11001000010", "11110001010", "10100110000",
  "10100001100", "10010110000", "10010000110", "10000101100", "10000100110", "10110010000", "10110000100", "10011010000",
  "10011000010", "10000110100", "10000110010", "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
  "10100111100", "10010111100", "10010011110", "10111100100", "10011110100", "10011110010", "11110100100", "11110010100",
  "11110010010", "11011011110", "11011110110", "11110110110", "10101111000", "10100011110", "10001011110", "10111101000",
  "10111100010", "11110101000", "11110100010", "10111011110", "10111101110", "11101011110", "11110101110", "11010000100",
  "11010010000", "11010011100", "1100011101011",
];
const INICIO_B = 104;
const FIN = 106;
export const MAX_TEXTO_BARRAS = 60;

/** ¿Se puede poner en un código de barras? (letras sin tilde, números y signos comunes) */
export function entraEnBarras(texto) {
  const s = String(texto ?? "");
  return s.length > 0 && s.length <= MAX_TEXTO_BARRAS && /^[\x20-\x7e]+$/.test(s);
}

/** Los 1 y 0 del código (inicio, texto, control y fin). Null si no entra. */
export function modulosCode128(texto) {
  const s = String(texto ?? "");
  if (!entraEnBarras(s)) return null;
  const valores = [...s].map((c) => c.charCodeAt(0) - 32);
  const control = valores.reduce((suma, v, i) => suma + v * (i + 1), INICIO_B) % 103;
  return [INICIO_B, ...valores, control, FIN].map((v) => BARRAS[v]).join("");
}

/**
 * SVG del código de barras: se estira al ancho y alto que le dé el CSS (las
 * barras no se deforman: solo cambia el ancho de todas por igual). Con el
 * margen blanco de 10 módulos a cada lado que piden los lectores.
 */
export function svgBarras(texto) {
  const bits = modulosCode128(texto);
  if (!bits) return null;
  const margen = 10;
  const rects = [];
  for (let i = 0; i < bits.length;) {
    if (bits[i] !== "1") { i++; continue; }
    let j = i;
    while (bits[j] === "1") j++;
    rects.push(`<rect x="${i + margen}" y="0" width="${j - i}" height="1"/>`);
    i = j;
  }
  const ancho = bits.length + margen * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} 1" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="Código de barras ${String(texto).replace(/[&<>"']/g, "")}"><rect width="${ancho}" height="1" fill="#fff"/><g fill="#000">${rects.join("")}</g></svg>`;
}

/** "M-7819" → "M7819"; "M-7498-36" → "M7498-36" (solo el guion entre la letra y el número). */
export function otParaBarras(ot) {
  return String(ot ?? "").trim().toUpperCase().replace(/^([A-Z]{1,3})-(?=\d)/, "$1");
}

/** Código de barras de una pieza: "M7819-GB2P-11". */
export function textoBarrasPieza(ot, nombre) {
  return `${otParaBarras(ot)}-${String(nombre ?? "").trim()}`;
}

/**
 * Código de barras de pieza → las lecturas posibles, la más probable primero:
 * [{ ot: "M-7819", nombre: "GB2P-11" }]. Acepta la OT con o sin guion
 * ("M-7819-GB2P-11" también). Con sub-OT ("M7498-36-GB2P-11") hay dos
 * lecturas: la OT M-7498-36 con la pieza GB2P-11, o la OT M-7498 con la pieza
 * "36-GB2P-11"; el servidor se queda con la que existe. Null si no es un
 * código de pieza: la pieza no puede ser solo un número, así "M-7498-36" (el
 * código de la OT) sigue siendo la OT.
 */
export function leerBarrasPieza(texto) {
  const s = String(texto ?? "").trim();
  if (s.length > MAX_TEXTO_BARRAS + 10) return null;
  const m = s.match(/^(?:([A-Za-z]{1,3})-?)?(\d{2,6})-(\S(?:.*\S)?)$/);
  if (!m) return null;
  const ot = m[1] ? `${m[1].toUpperCase()}-${m[2]}` : m[2];
  const resto = m[3];
  if (/^\d+$/.test(resto)) return null;
  const lecturas = [];
  const sub = resto.match(/^(\d{1,3})-(.*\D.*)$/);
  if (sub) lecturas.push({ ot: `${ot}-${sub[1]}`, nombre: sub[2] });
  lecturas.push({ ot, nombre: resto });
  return lecturas;
}
