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

const limpio = (s) => (s || "").replace(/\s+/g, " ").trim();

/**
 * @returns {{ filas: {ot,cliente,obra,proyecto,division}[], repetidas: number }}
 * filas: una por OT (si una OT aparece varias veces, vale la última fila, y las
 * columnas vacías se completan con las filas anteriores).
 */
export function parseCsvProyectos(text) {
  const todas = filasCsv(text);
  if (todas.length < 2) return { filas: [], repetidas: 0 };
  const headers = todas[0].map(h => h.toLowerCase());
  const idx = (n) => headers.findIndex(h => h.includes(n));
  let iOt = headers.findIndex(h => h === "ot");
  if (iOt < 0) iOt = idx("ot");
  if (iOt < 0) return { filas: [], repetidas: 0 };
  const iCli = idx("cliente");
  const iObra = idx("obra");
  const iProy = idx("proyecto");
  const iDiv = idx("divis");
  const tituloOt = todas[0][iOt];
  const valor = (c, i) => (i >= 0 ? limpio(c[i]) || null : null);

  const porOt = new Map();
  let repetidas = 0;
  for (const c of todas.slice(1)) {
    const ot = limpio(c[iOt]);
    if (!ot || ot === tituloOt) continue; // vacía o título repetido de otro bloque
    const fila = { ot, cliente: valor(c, iCli), obra: valor(c, iObra), proyecto: valor(c, iProy), division: valor(c, iDiv) };
    const previa = porOt.get(ot);
    if (previa) {
      repetidas++;
      for (const k of Object.keys(fila)) if (fila[k] == null) fila[k] = previa[k];
    }
    porOt.set(ot, fila);
  }
  return { filas: [...porOt.values()], repetidas };
}
