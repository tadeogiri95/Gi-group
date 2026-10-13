// app/lib/csvProyectos.js — Lee la planilla de OT (CSV publicado de Google Sheets)
// para /api/proyectos/sync-csv.
//
// Planillas armadas juntando bloques de varias hojas traen cosas que el lector
// anterior (línea por línea) manejaba mal:
//   - celdas con saltos de línea → partían la fila en dos;
//   - la fila de títulos repetida al comienzo de cada bloque → creaba una OT "OT";
//   - la misma OT en dos filas → la base rechazaba el lote entero de 100 OT.
// Las filas vacías (",,,,") se saltean.

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

const SI = new Set(["si", "sí", "x", "ok", "terminado", "terminada"]);

/**
 * @returns {{ filas: {ot,cliente,obra,proyecto,division,descripcion,fecha_entrega,cantidad,total_modulos,terminado_planilla}[], repetidas: number }}
 * filas: una por OT. Si una OT aparece varias veces (un renglón por ítem), vale
 * la última fila, las columnas vacías se completan con las anteriores y las
 * descripciones de todos los ítems se juntan con " / ". De todos sus ítems:
 * la fecha de entrega es la más tardía, la cantidad y los módulos se suman, y la OT está
 * terminada en la planilla solo si todos sus ítems dicen SI en TERMINADO
 * (null si la planilla no tiene esa columna).
 */
export function parseCsvProyectos(text) {
  const todas = filasCsv(text);
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
      for (const k of Object.keys(fila)) if (fila[k] == null) fila[k] = previa[k];
      fila.descripcion = [...new Set(descs.flatMap(d => d.split(" / ")))].join(" / ").slice(0, MAX_DESCRIPCION) || null;
      fila.fecha_entrega = fechas.at(-1) || null;
      fila.cantidad = cantidad;
      if (iMod >= 0) fila.total_modulos = modulos == null ? null : Math.min(modulos, 9999);
      fila.terminado_planilla = terminado;
    }
    porOt.set(ot, fila);
  }
  return { filas: [...porOt.values()], repetidas };
}
