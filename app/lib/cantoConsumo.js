// app/lib/cantoConsumo.js — Consumo de canto desde los escaneos (pedido de
// Tadeo, 26/11; migración 210). Sigue al canto por lados (25/11, 209).
//
// La planilla técnica dice, por cada lado del panel (L1 A, L1 B, L2 A, L2 B),
// el espesor (E: "0.45-", "2-") y el COLOR del canto. Gypi guarda en cada
// pieza qué canto lleva cada lado y su largo (L1 para L1 A y L1 B, L2 para
// L2 A y L2 B). Cada escaneo de un lado en la etapa de canto suma ese largo.
// Desde el 27/11 (214) el escaneo dice qué lado y qué canto se pegó (el
// operario elige el canto de la máquina, ver cantoLados.js); los escaneos
// viejos se toman en el orden de la planilla.
//
// A los metros se les suma el desperdicio (Planificación → Parámetros, 5 % si
// no se cargó). En Materiales → ✂️ Canto usado la oficina ve, por OT, el canto
// usado que todavía no se asentó y lo asienta en el MRP: un consumo con la OT
// (movimientos_stock, canto = la clave del tipo) que el script "Gypi" lleva a
// fact_consumos_stock como cualquier otro.
//
// Qué artículo del MRP es cada tipo (espesor + color + espesor de la placa):
//   1. el canto de las necesidades de esa OT con ese espesor y color;
//   2. el que la oficina eligió antes para ese tipo (canto_articulos);
//   3. el único del catálogo con ese espesor y color.
// Si no hay uno solo, la oficina lo elige y Gypi lo recuerda.

import { ladosHechos } from "./cantoLados";

export const PCT_DESPERDICIO_DEFECTO = 5;
/** Anchos de canto que se venden: el de la placa + 3 mm o más (placa 18 → 22). */
const MARGEN_ANCHO = 3;

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const redondear = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** "MELAMINA SOBRE MDF 18MM BLANCO" → 18; null si no dice el espesor. */
export function grosorMaterial(material) {
  const m = String(material ?? "").match(/(\d+(?:[.,]\d+)?)\s*MM\b/i);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return n > 0 && n < 200 ? n : null;
}

/** El tipo de canto: "0.45|GRAFITO|18" (espesor, color y espesor de la placa; vacío si no se sabe). */
export function claveCanto(canto, grosor) {
  return `${canto.e}|${norm(canto.c)}|${grosor ?? ""}`;
}

/** "0.45|GRAFITO|18" → { espesor: 0.45, color: "GRAFITO", grosor: 18 }. */
export function leerClave(clave) {
  const [e, color, g] = String(clave ?? "").split("|");
  return { espesor: Number(e), color: color || "", grosor: g ? Number(g) : null };
}

const num = (n) => Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });

/** "Canto 0,45 mm GRAFITO · placa 18 mm". */
export function textoCanto(clave) {
  const { espesor, color, grosor } = leerClave(clave);
  return `Canto ${num(espesor)} mm ${color}${grosor ? ` · placa ${num(grosor)} mm` : ""}`;
}

/** "045" → 0.45, "2" → 2, "08" → 0.8, "0.8" → 0.8. */
function espesorDeNombre(t) {
  const s = String(t).replace(",", ".");
  if (s.includes(".")) return Number(s);
  if (s.length > 1 && s.startsWith("0")) return Number(`0.${s.slice(1)}`);
  return Number(s);
}

/**
 * Lo que dice el nombre de un artículo de canto del MRP: "CANTO ABS 22/045
 * LISO SIN COLA" → { ancho: 22, espesor: 0.45 }. null si no es un canto
 * (los perfiles y esquineros con "canto" en el nombre no cuentan).
 */
export function medidasArticuloCanto(nombre) {
  const n = norm(nombre);
  if (!/^CANTO\b/.test(n)) return null;
  const m = n.match(/\b(\d{2})\s*\/\s*(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const espesor = espesorDeNombre(m[2]);
  return Number.isFinite(espesor) && espesor > 0 ? { ancho: Number(m[1]), espesor } : null;
}

/** Color del artículo: Color/Acabado de la planilla, o lo que el nombre normalizado trae después de la marca. */
function colorArticulo(a) {
  if (a.color) return norm(a.color);
  const partes = String(a.nombre ?? "").split("-");
  return partes.length >= 3 ? norm(partes[2]) : "";
}

/**
 * Artículos del catálogo que sirven para un tipo de canto: mismo espesor y
 * color; si se sabe el espesor de la placa, los del ancho más chico que
 * alcanza (placa 18 → 22 antes que 45).
 */
export function candidatosCanto(clave, articulos = []) {
  const { espesor, color, grosor } = leerClave(clave);
  const iguales = (articulos || []).filter((a) => {
    if (a.activo === false) return false;
    const m = medidasArticuloCanto(a.nombre);
    return m && Math.abs(m.espesor - espesor) < 0.001 && colorArticulo(a) === color;
  }).map((a) => ({ ...a, ancho: medidasArticuloCanto(a.nombre).ancho }));
  if (!grosor) return iguales;
  const alcanzan = iguales.filter((a) => a.ancho >= grosor + MARGEN_ANCHO);
  if (!alcanzan.length) return iguales;
  const ancho = Math.min(...alcanzan.map((a) => a.ancho));
  return alcanzan.filter((a) => a.ancho === ancho);
}

/**
 * El artículo del MRP para un tipo de canto en una OT.
 * @param {object} p
 * @param {string} p.clave
 * @param {object[]} p.articulos   articulos_stock (sku, nombre, color, activo)
 * @param {Set<string>} [p.necesidadesOt]  SKU que el MRP necesita para la OT
 * @param {Map<string,string>} [p.recordados]  clave → SKU elegido antes
 * @returns {{ sku: string|null, por: "necesidad"|"recordado"|"unico"|null, opciones: object[] }}
 */
export function elegirArticuloCanto({ clave, articulos = [], necesidadesOt = new Set(), recordados = new Map() }) {
  const opciones = candidatosCanto(clave, articulos);
  const enOt = opciones.filter((a) => necesidadesOt.has(a.sku));
  if (enOt.length === 1) return { sku: enOt[0].sku, por: "necesidad", opciones };
  const rec = recordados.get(clave);
  const activo = rec && (articulos || []).some((a) => a.sku === rec && a.activo !== false);
  if (activo) return { sku: rec, por: "recordado", opciones };
  if (opciones.length === 1) return { sku: opciones[0].sku, por: "unico", opciones };
  return { sku: null, por: null, opciones };
}

/**
 * Los lados de una pieza que ya se pegaron. escaneos = los escaneos de lado
 * de la pieza ([{ lado }], 214: cada uno dice qué lado; los viejos, sin lado,
 * se toman en el orden de la planilla) o solo cuántos son. Todos si la pieza
 * ya pasó la etapa (por ejemplo, escaneada con la etiqueta del módulo).
 */
export function cantosPegados(pieza, escaneos = 0, completa = false) {
  const cantos = Array.isArray(pieza?.cantos) ? pieza.cantos : [];
  if (completa) return cantos;
  const filas = Array.isArray(escaneos) ? escaneos : Array.from({ length: Math.max(0, Number(escaneos) || 0) }, () => ({}));
  const hechos = ladosHechos(pieza, filas);
  return cantos.filter((c) => hechos.has(c.l));
}

/**
 * Canto usado por OT y tipo, con el desperdicio.
 * @param {object} p
 * @param {object[]} p.piezas   piezas_ot con id, ot, material, cantos
 * @param {Map<number,number|object[]>} p.escaneos  pieza_id → escaneos de lado ([{ lado }]) o cuántos
 * @param {Set<number>} p.completas   piezas que ya pasaron la etapa de canto
 * @param {number} p.pct   desperdicio en %
 * @returns {Map<string, Map<string, { metros: number, lados: number }>>} ot → clave → uso
 */
export function cantoUsado({ piezas = [], escaneos = new Map(), completas = new Set(), pct = PCT_DESPERDICIO_DEFECTO }) {
  const factor = 1 + (Number(pct) || 0) / 100;
  const out = new Map();
  for (const p of piezas) {
    const pegados = cantosPegados(p, escaneos.get(Number(p.id)) ?? 0, completas.has(Number(p.id)));
    if (!pegados.length) continue;
    const grosor = grosorMaterial(p.material);
    const delOt = out.get(p.ot) || new Map();
    out.set(p.ot, delOt);
    for (const c of pegados) {
      const clave = claveCanto(c, grosor);
      const u = delOt.get(clave) || { metros: 0, lados: 0 };
      u.metros += (Number(c.mm) || 0) / 1000 * factor;
      u.lados += 1;
      delOt.set(clave, u);
    }
  }
  for (const delOt of out.values()) for (const u of delOt.values()) u.metros = redondear(u.metros);
  return out;
}

/**
 * Lo usado menos lo ya asentado, por OT: [{ ot, renglones: [{ clave, metros,
 * asentado, pendiente, lados }] }]. Solo las OT con algo para asentar.
 * @param {Map} usado  cantoUsado(...)
 * @param {object[]} asentados  movimientos_stock vivos con canto: { ot, canto, cantidad }
 */
export function pendientesCanto(usado, asentados = []) {
  const ya = new Map();
  for (const m of asentados || []) {
    if (!m?.canto || !m.ot) continue;
    const k = `${m.ot}\u0000${m.canto}`;
    ya.set(k, (ya.get(k) || 0) + (Number(m.cantidad) || 0));
  }
  const out = [];
  for (const [ot, delOt] of usado) {
    const renglones = [...delOt].map(([clave, u]) => {
      const asentado = redondear(ya.get(`${ot}\u0000${clave}`) || 0);
      return { clave, metros: u.metros, lados: u.lados, asentado, pendiente: redondear(Math.max(0, u.metros - asentado)) };
    }).filter((r) => r.pendiente >= 0.01).sort((a, b) => a.clave.localeCompare(b.clave, "es"));
    if (renglones.length) out.push({ ot, renglones });
  }
  return out.sort((a, b) => String(a.ot).localeCompare(String(b.ot), "es", { numeric: true }));
}
