// app/lib/csvProyectos.js — Lee la planilla de OT (CSV publicado de Google Sheets)
// para /api/proyectos/sync-csv.
//
// Planillas armadas juntando bloques de varias hojas traen cosas que el lector
// anterior (línea por línea) manejaba mal:
//   - celdas con saltos de línea → partían la fila en dos;
//   - la fila de títulos repetida al comienzo de cada bloque → creaba una OT "OT";
//   - la misma OT en dos filas → la base rechazaba el lote entero de 100 OT.
// Las filas vacías (",,,,") se saltean.

import { semanaPlanilla } from "./semanaObjetivo";

/** Lo que se le avisa a quien sincroniza: Google actualiza la copia publicada
 *  de la planilla con unos minutos de demora. */
export const AVISO_DEMORA_GOOGLE = "Si cargaste algo recién en la planilla, Google puede tardar unos 5 minutos en mostrarlo.";

/* Las obras grandes tienen su hoja propia en el Plan de trabajo y cada hoja se
 * publica por separado: config_sistema (proyectos_csv_url) guarda el link
 * principal en `url` y los de las otras hojas en `urls`. */

/** Los links de la planilla, el principal primero y sin repetir. */
export function linksPlanilla(valor) {
  const todos = [valor?.url, ...(Array.isArray(valor?.urls) ? valor.urls : [])];
  return [...new Set(todos.map((u) => String(u || "").trim()).filter(Boolean))];
}

/** Lo que se escribe en la configuración (un link por renglón) → { url, urls }. */
export function valorLinks(texto) {
  const [url = "", ...urls] = linksPlanilla({ urls: String(texto || "").split(/\s+/) });
  return { url, urls };
}

/** Divide el texto CSV en filas de celdas, respetando comillas, "" y saltos de línea dentro de comillas. */
export function filasCsv(text) {
  const filas = [];
  let fila = [];
  let celda = "";
  let enComillas = false;
  const src = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (enComillas) {
      if (ch === '"') {
        if (src[i + 1] === '"') { celda += '"'; i++; }
        else enComillas = false;
      } else celda += ch;
    } else if (ch === '"') enComillas = true;
    else if (ch === ",") { fila.push(celda); celda = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      fila.push(celda); filas.push(fila);
      fila = []; celda = "";
    } else celda += ch;
  }
  if (celda !== "" || fila.length) { fila.push(celda); filas.push(fila); }
  return filas.map(f => f.map(c => c.trim())).filter(f => f.some(c => c));
}

const MAX_DESCRIPCION = 500;
const limpio = (s) => (s || "").replace(/\s+/g, " ").trim();

/** "1/05/2026", "1/5/26" o "2026-05-01" → "2026-05-01"; cualquier otra cosa → null. */
export function fechaPlanilla(texto) {
  const t = limpio(texto);
  let d, m, a;
  let r = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (r) { [, d, m, a] = r; if (a.length === 2) a = `20${a}`; }
  else if ((r = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [, a, m, d] = r;
  else return null;
  const fecha = new Date(Date.UTC(+a, +m - 1, +d));
  if (fecha.getUTCFullYear() !== +a || fecha.getUTCMonth() !== +m - 1 || fecha.getUTCDate() !== +d) return null;
  return fecha.toISOString().slice(0, 10);
}

/** "12" → 12; vacío, texto o con decimales → null (total de módulos, 101). */
function enteroPlanilla(texto) {
  const n = Number(limpio(texto));
  return limpio(texto) !== "" && Number.isInteger(n) && n >= 0 && n <= 9999 ? n : null;
}

/** "3", "2,5" o "1.5" → número; vacío o texto → null. */
function cantidadPlanilla(texto) {
  const t = limpio(texto).replace(",", ".");
  const n = Number(t);
  return t !== "" && Number.isFinite(n) && n >= 0 ? n : null;
}

/** Placas, fondos o metros de canto (136): "21,8" → 21.8, "1.200" → 1200,
 *  "1.200,5" → 1200.5; vacío, "N/A" o texto → null. */
export function numeroPlanilla(texto) {
  let t = limpio(texto).replace(/\s/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return t !== "" && Number.isFinite(n) && n >= 0 ? n : null;
}

/** PRECIO del Plan de trabajo (142, columna AE): "$38.352.296,68" → 38352296.68; vacío o texto → null. */
export function precioPlanilla(texto) {
  return numeroPlanilla(limpio(texto).replace(/^(ars|\$)\s*/i, "").replace(/\$/g, ""));
}

/** Material de producción del Plan de trabajo (136): columnas X a AA. */
const MATERIAL = [
  { campo: "placas", titulos: ["pla 18", "pla18", "placas"] },
  { campo: "fondos", titulos: ["fondos"] },
  { campo: "metros_canto", titulos: ["cantos"] },
  { campo: "placas_mecanizadas", titulos: ["mecanizados", "mecanizadas"] },
];
export const CAMPOS_MATERIAL = MATERIAL.map((m) => m.campo);
const sumar = (a, b) => (a == null && b == null ? null : Math.round(((a || 0) + (b || 0)) * 100) / 100);

const FILAS_ANTES_DE_TITULOS = 10;

const SI = new Set(["si", "sí", "x", "ok", "terminado", "terminada"]);

/**
 * @returns {{ filas: {ot,cliente,obra,proyecto,division,descripcion,fecha_entrega,cantidad,total_modulos,terminado_planilla,semana_objetivo,placas,fondos,metros_canto,placas_mecanizadas,precio}[], repetidas: number }}
 * filas: una por OT. Si una OT aparece varias veces (un renglón por ítem), vale
 * la última fila, las columnas vacías se completan con las anteriores y las
 * descripciones de todos los ítems se juntan con " / ". De todos sus ítems:
 * la fecha de entrega y la SEMANA son las más tardías, la cantidad, los módulos,
 * las placas, los fondos, los cantos, los mecanizados y el PRECIO se suman, y la OT está
 * terminada en la planilla solo si todos sus ítems dicen SI en TERMINADO
 * (null si la planilla no tiene esa columna).
 */
export function parseCsvProyectos(text) {
  // Las hojas del Plan de trabajo tienen los títulos en la fila 3 (arriba van
  // contadores como "NUMERO SIGUIENTE"): los títulos son la primera fila con
  // una celda que dice exactamente OT, entre las primeras; si no hay, la primera.
  const leidas = filasCsv(text);
  const iTitulos = leidas.slice(0, FILAS_ANTES_DE_TITULOS).findIndex(f => f.some(c => c.toLowerCase() === "ot"));
  const todas = iTitulos > 0 ? leidas.slice(iTitulos) : leidas;
  if (todas.length < 2) return { filas: [], repetidas: 0 };
  const headers = todas[0].map(h => h.toLowerCase());
  // Primero el título exacto ("OBRA"), después uno que lo contenga: si no,
  // "PROYECTO / OBRA" (columna C) le ganaba a "OBRA" (columna E).
  const idx = (n) => {
    const exacto = headers.findIndex(h => h === n);
    return exacto >= 0 ? exacto : headers.findIndex(h => h.includes(n));
  };
  const iOt = idx("ot");
  if (iOt < 0) return { filas: [], repetidas: 0 };
  const iCli = idx("cliente");
  const iObra = idx("obra");
  const iProy = idx("proyecto");
  const iDiv = idx("divis");
  const iDesc = idx("descripcion") >= 0 ? idx("descripcion") : idx("descrip");
  const iEntrega = idx("entrega");
  // Total de módulos (101): "MÓDULOS", "Modulos", "Cant. módulos"…
  const sinTilde = headers.map(h => h.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  const iMod = sinTilde.findIndex(h => h.includes("modulo"));
  const iCant = headers.findIndex((h, i) => i !== iMod && h === "cant") >= 0
    ? headers.findIndex((h, i) => i !== iMod && h === "cant")
    : headers.findIndex((h, i) => i !== iMod && h.includes("cant"));
  const iTerminado = idx("terminado");
  // SEMANA objetivo del Plan de trabajo (135): el título viene con espacio al final
  const iSemana = idx("semana");
  // Placas, fondos, cantos y mecanizados (136): solo título exacto, así
  // "CANTOS" no se confunde con "CANT" ni "PLA 18" con otra columna.
  const iMaterial = MATERIAL
    .map((m) => ({ ...m, i: headers.findIndex((h) => m.titulos.includes(h)) }))
    .filter((m) => m.i >= 0);
  // PRECIO en pesos (142): título exacto; no va a proyectos sino a precios_ot
  const iPrecio = headers.findIndex((h) => h.trim() === "precio");
  const tituloOt = todas[0][iOt];
  const valor = (c, i) => (i >= 0 ? limpio(c[i]) || null : null);

  const porOt = new Map();
  let repetidas = 0;
  for (const c of todas.slice(1)) {
    const ot = limpio(c[iOt]);
    // vacía, título repetido de otro bloque, o renglón sin número ("M-", "-")
    if (!ot || ot === tituloOt || !/\d/.test(ot)) continue;
    const fila = {
      ot, cliente: valor(c, iCli), obra: valor(c, iObra), proyecto: valor(c, iProy), division: valor(c, iDiv), descripcion: valor(c, iDesc),
      fecha_entrega: iEntrega >= 0 ? fechaPlanilla(c[iEntrega]) : null,
      cantidad: iCant >= 0 ? cantidadPlanilla(c[iCant]) : null,
      // Sin columna de módulos la clave no va: no pisa el total cargado a mano
      ...(iMod >= 0 ? { total_modulos: enteroPlanilla(c[iMod]) } : {}),
      terminado_planilla: iTerminado >= 0 ? SI.has(limpio(c[iTerminado]).toLowerCase()) : null,
      semana_objetivo: iSemana >= 0 ? semanaPlanilla(c[iSemana]) : null,
      // Sin la columna, la clave no va (no pisa lo que ya había)
      ...Object.fromEntries(iMaterial.map((m) => [m.campo, numeroPlanilla(c[m.i])])),
      ...(iPrecio >= 0 ? { precio: precioPlanilla(c[iPrecio]) } : {}),
    };
    const previa = porOt.get(ot);
    if (previa) {
      // Una OT con varios ítems (P1, P3, P4…): se juntan las descripciones
      repetidas++;
      const descs = [previa.descripcion, fila.descripcion].filter(Boolean);
      const fechas = [previa.fecha_entrega, fila.fecha_entrega].filter(Boolean).sort();
      const cantidad = previa.cantidad == null && fila.cantidad == null ? null : (previa.cantidad || 0) + (fila.cantidad || 0);
      const modulos = previa.total_modulos == null && fila.total_modulos == null ? null : (previa.total_modulos || 0) + (fila.total_modulos || 0);
      const terminado = iTerminado >= 0 ? previa.terminado_planilla && fila.terminado_planilla : null;
      const semanas = [previa.semana_objetivo, fila.semana_objetivo].filter(Boolean);
      const material = Object.fromEntries(iMaterial.map((m) => [m.campo, sumar(previa[m.campo], fila[m.campo])]));
      const precio = iPrecio >= 0 ? sumar(previa.precio, fila.precio) : undefined;
      for (const k of Object.keys(fila)) if (fila[k] == null) fila[k] = previa[k];
      fila.descripcion = [...new Set(descs.flatMap(d => d.split(" / ")))].join(" / ").slice(0, MAX_DESCRIPCION) || null;
      fila.fecha_entrega = fechas.at(-1) || null;
      fila.cantidad = cantidad;
      if (iMod >= 0) fila.total_modulos = modulos == null ? null : Math.min(modulos, 9999);
      fila.terminado_planilla = terminado;
      fila.semana_objetivo = semanas.length ? Math.max(...semanas) : null;
      Object.assign(fila, material);
      if (iPrecio >= 0) fila.precio = precio;
    }
    porOt.set(ot, fila);
  }
  return { filas: [...porOt.values()], repetidas };
}
