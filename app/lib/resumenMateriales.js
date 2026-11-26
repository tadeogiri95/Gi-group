// app/lib/resumenMateriales.js — Resumen de materiales de los días elegidos
// del plan (Tadeo, 26/11): en el Tablero se eligen días o una semana (por
// defecto la que viene) y sale lo necesario y lo que falta, separado en
// resúmenes para pasar al proveedor, en PDF y en Excel:
//   - Faplac: placas y fondos de marca Faplac (las de Masisa también: Tadeo,
//     26/11, "esas placas tienen que cambiar su marca por Faplac");
//   - Egger: placas y fondos de marca Egger;
//   - Herrajes: agrupados por tipo (bisagras, correderas…);
//   - Cantos: agrupados por tipo, de cualquier marca (Tadeo, 26/11);
//   - Otros: placas de otra marca o sin marca, para que no se pierda nada.
// Las cantidades salen de materialDelDia (app/lib/materialDia.js): lo que
// le falta retirar a cada OT, solo del proceso planificado esos días.
import { descargarPdfDeHtml } from "./pdfDeHtml";
import { ESTILO, armarXlsx } from "./xlsxSimple";
import { inicioDeSemana, numeroSemana } from "./semanaObjetivo";
import { cantidadTexto } from "./stock";

export const RESUMENES = [
  { id: "faplac", nombre: "Faplac", porTipo: false },
  { id: "egger", nombre: "Egger", porTipo: false },
  { id: "herrajes", nombre: "Herrajes", porTipo: true },
  { id: "cantos", nombre: "Cantos", porTipo: true },
  { id: "otros", nombre: "Otros", porTipo: true },
];

const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const DIA = 86400000;
const sumarDias = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10);
const ddmm = (f) => `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}`;

/** En qué resumen va un renglón de materialDelDia. */
export function resumenDe(fila) {
  if (fila?.proceso === "canteado") return "cantos";
  if (fila?.proceso === "armado") return "herrajes";
  // Placas: por la marca; sin marca cargada, por el nombre
  const marca = sinTildes(fila?.marca);
  const texto = marca || sinTildes(fila?.nombre);
  if (/\begger\b/.test(texto)) return "egger";
  if (/\b(faplac|masisa)\b/.test(texto)) return "faplac";
  return "otros";
}

/**
 * Separa los renglones en los resúmenes, cada uno ordenado por tipo (si va
 * agrupado) y por nombre. Con soloFalta quedan solo los que faltan.
 * @returns {{ id, nombre, porTipo, filas: object[], grupos: { tipo: string, filas: object[] }[], conFalta: number }[]}
 */
export function armarResumenes(filas = [], { soloFalta = false } = {}) {
  return RESUMENES.map((r) => {
    const todas = filas.filter((f) => resumenDe(f) === r.id);
    const lista = (soloFalta ? todas.filter((f) => f.faltan > 0) : todas)
      .map((f) => ({ ...f, tipo: String(f.tipo || "").trim() || "Sin tipo" }))
      .sort((a, b) => (r.porTipo ? a.tipo.localeCompare(b.tipo, "es") : 0) || a.nombre.localeCompare(b.nombre, "es"));
    const grupos = [];
    for (const f of lista) {
      const clave = r.porTipo ? f.tipo : "";
      if (!grupos.length || grupos.at(-1).tipo !== clave) grupos.push({ tipo: clave, filas: [] });
      grupos.at(-1).filas.push(f);
    }
    return { ...r, filas: lista, grupos, conFalta: todas.filter((f) => f.faltan > 0).length, total: todas.length };
  });
}

/**
 * Las semanas del plan para elegir rápido: { numero, desde, hasta, fechas }.
 * El número es el de la empresa (cuenta de domingo o de lunes; sigue contando
 * pasado diciembre, como la columna SEMANA del Plan de trabajo).
 * @param {string[]} fechas días del plan que vienen (AAAA-MM-DD)
 * @param {string} hoy
 * @param {string} modo "semana_domingo" | "semana_lunes"
 */
export function semanasDelPlan(fechas = [], hoy, modo) {
  const anio = Number(String(hoy).slice(0, 4));
  const porInicio = new Map();
  for (const f of [...fechas].sort()) {
    const desde = inicioDeSemana(f, modo);
    if (!porInicio.has(desde)) porInicio.set(desde, { numero: numeroSemana(desde, anio, modo), desde, hasta: sumarDias(desde, 6), fechas: [] });
    porInicio.get(desde).fechas.push(f);
  }
  return [...porInicio.values()];
}

/** La semana que viene: { numero, desde, hasta }. */
export function semanaQueViene(hoy, modo) {
  const desde = sumarDias(inicioDeSemana(hoy, modo), 7);
  return { numero: numeroSemana(desde, Number(String(hoy).slice(0, 4)), modo), desde, hasta: sumarDias(desde, 6) };
}

/**
 * "Semana 50 (del 07/12 al 13/12)" si se eligió justo una semana entera del
 * plan; si no, la lista de días.
 */
export function textoPeriodo(elegidas = [], semanas = []) {
  const set = new Set(elegidas);
  if (!set.size) return "";
  const enteras = semanas.filter((s) => s.fechas.length && s.fechas.every((f) => set.has(f)));
  const cubiertas = new Set(enteras.flatMap((s) => s.fechas));
  if (enteras.length && [...set].every((f) => cubiertas.has(f))) {
    return enteras.map((s) => `Semana ${s.numero} (del ${ddmm(s.desde)} al ${ddmm(s.hasta)})`).join(" y ");
  }
  const dias = [...set].sort();
  return `${dias.length === 1 ? "Día" : "Días"} ${dias.map(ddmm).join(", ")}`;
}

const num = (n) => (n == null || !Number.isFinite(Number(n)) ? "" : Number(n));

/**
 * El Excel: una hoja por resumen (sin las vacías).
 * @param {object[]} resumenes lo de armarResumenes (los que se quieran bajar)
 */
export function resumenesXlsx(resumenes, { periodo, empresa = "" }) {
  const hojas = resumenes.filter((r) => r.filas.length).map((r) => {
    const cab = [...(r.porTipo ? ["Tipo"] : []), "Artículo", "SKU", "Unidad", "Necesario", "En stock", "Falta pedir"];
    const filas = [
      [{ v: `Resumen de ${r.nombre}`, estilo: ESTILO.titulo }],
      [[empresa, periodo].filter(Boolean).join(" · ")],
      [],
      cab.map((v) => ({ v, estilo: ESTILO.negrita })),
      ...r.filas.map((f) => [...(r.porTipo ? [f.tipo] : []), f.nombre, f.sku, f.unidad || "", num(f.cantidad), num(f.stock), num(f.faltan)]),
    ];
    return { nombre: r.nombre, filas, anchos: [...(r.porTipo ? [22] : []), 44, 16, 9, 12, 12, 12] };
  });
  return hojas.length ? armarXlsx(hojas) : null;
}

const ESCAPES = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES.get(c));

/** La hoja A4 (HTML) con uno o varios resúmenes. */
export function htmlResumenes(resumenes, { periodo, empresa = "", fecha = "" }) {
  const conFilas = resumenes.filter((r) => r.filas.length);
  const tabla = (r) => `<table><thead><tr><th class="n">Artículo</th><th>SKU</th><th>Unidad</th><th class="v">Necesario</th><th class="v">En stock</th><th class="v">Falta pedir</th></tr></thead><tbody>${
    r.grupos.map((g) => `${r.porTipo ? `<tr class="tipo"><td colspan="6">${esc(g.tipo)}</td></tr>` : ""}${
      g.filas.map((f) => `<tr><td class="n">${esc(f.nombre)}</td><td>${esc(f.sku)}</td><td>${esc(f.unidad || "")}</td><td class="v">${esc(cantidadTexto(f.cantidad))}</td><td class="v">${esc(cantidadTexto(f.stock))}</td><td class="v ${f.faltan > 0 ? "falta" : ""}">${f.faltan > 0 ? esc(cantidadTexto(f.faltan)) : "—"}</td></tr>`).join("")}`).join("")
  }</tbody></table>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Resumen de materiales</title><style>
body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;padding:0 4px;font-size:12px}
.cabecera{padding:6px 0 4px}
h1{font-size:18px;margin:10px 0 2px}
p.sub{margin:0 0 8px;color:#555}
section{padding-bottom:14px}
table{width:100%;border-collapse:collapse}
th{text-align:left;border-bottom:2px solid #111;padding:4px}
td{border-bottom:1px solid #ddd;padding:4px}
.v{text-align:right;white-space:nowrap}
tr.tipo td{background:#eee;font-weight:bold;border-bottom:1px solid #999}
td.falta{font-weight:bold}
</style></head><body>${conFilas.map((r) => `<section><div class="cabecera"><h1>Resumen de ${esc(r.nombre)}</h1><p class="sub">${esc([empresa, periodo, fecha && `Armado el ${fecha}`].filter(Boolean).join(" · "))}</p></div>${tabla(r)}</section>`).join("")}</body></html>`;
}

const limpio = (s) => String(s || "").replace(/[()]+/g, "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();

/** Nombre del archivo: "Resumen Faplac - Semana 50.pdf". */
export function nombreArchivo(resumenes, periodo, ext) {
  const que = resumenes.length === 1 ? `Resumen ${resumenes[0].nombre}` : "Resumen de materiales";
  return `${que} - ${limpio(periodo).slice(0, 60)}.${ext}`;
}

/** Baja el PDF de uno o varios resúmenes. */
export function descargarPdfResumenes(resumenes, datos) {
  return descargarPdfDeHtml(htmlResumenes(resumenes, datos), { archivo: nombreArchivo(resumenes, datos.periodo, "pdf") });
}
