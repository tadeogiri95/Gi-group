// app/lib/planillaPlan.js — Pasar al Plan de trabajo la SEMANA cambiada en
// Gypi (Tadeo, 29/10; migración 144). Como la planilla MRP (planillaMrp.js):
// un script de Apps Script en el Plan de trabajo le pide a Gypi, con una clave
// privada de la empresa, las semanas cambiadas y las anota en la columna
// SEMANA de cada renglón de la OT, en todas las hojas que tengan OT y SEMANA.
// Si en la planilla la semana ya no es la que Gypi vio por última vez (alguien
// la cambió ahí), no la pisa: la próxima sincronización decide cuál es más
// reciente (semanaEditable.js).
export { generarClave, empresaDeClave, claveValida } from "./planillaMrp";
export { CLAVE_PLANILLA_PLAN } from "./semanaEditable";

/** Semanas cambiadas en Gypi como las pide el script: [{ ot, semana, antes }]. */
export function semanasParaPlanilla(proyectos) {
  return (proyectos || [])
    .filter((p) => p?.ot && Number.isInteger(Number(p.semana_app)) && Number(p.semana_app) > 0)
    .map((p) => ({ ot: String(p.ot), semana: Number(p.semana_app), antes: p.semana_planilla == null ? null : Number(p.semana_planilla) }));
}

/**
 * Código para pegar en Apps Script del Plan de trabajo (Extensiones → Apps
 * Script). instalarSemanasGypi() se corre una vez: pide permiso, deja la
 * tarea de cada 15 minutos y pasa lo que haya. Sin template strings adentro,
 * para que el texto salga igual.
 */
export function scriptPlanPlanilla({ url, clave }) {
  return `// Gypi → Plan de trabajo: anota en la columna SEMANA las semanas de OT que
// se cambiaron en Gypi (Planificación o Detalle OT). Busca la OT en todas las
// hojas que tengan las columnas OT y SEMANA (PLAN y las hojas de cada obra).
// Si alguien cambió la semana en la planilla, no la pisa.
// Pegalo en un archivo nuevo de Apps Script, guardá y ejecutá
// instalarSemanasGypi una sola vez. Después corre solo cada 15 minutos.
// La clave es privada: no compartas este código.
var GYPI_SEMANAS_URL = ${JSON.stringify(url)};
var GYPI_SEMANAS_CLAVE = ${JSON.stringify(clave)};

function instalarSemanasGypi() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "pasarSemanasGypi") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("pasarSemanasGypi").timeBased().everyMinutes(15).create();
  pasarSemanasGypi();
}

function pasarSemanasGypi() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var r = gypiSemanasPedir_("get", null);
    if (!r.semanas || !r.semanas.length) return;
    var pend = {};
    r.semanas.forEach(function (s) { pend[s.ot] = { semana: s.semana, antes: s.antes, celdas: [] }; });
    SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (hoja) { gypiSemanasBuscar_(hoja, pend); });
    var escritas = [];
    Object.keys(pend).forEach(function (ot) {
      var p = pend[ot];
      if (!p.celdas.length) return;
      // La semana de la OT en la planilla es la más tardía de sus renglones
      var max = null;
      p.celdas.forEach(function (c) { if (c.valor !== null && (max === null || c.valor > max)) max = c.valor; });
      if (max === p.semana) { escritas.push({ ot: ot, semana: p.semana }); return; }
      if (max !== p.antes) return; // la cambiaron en la planilla: decide la sincronización
      p.celdas.forEach(function (c) { c.rango.setValue(p.semana); });
      escritas.push({ ot: ot, semana: p.semana });
    });
    if (escritas.length) gypiSemanasPedir_("patch", { escritas: escritas });
  } finally {
    lock.releaseLock();
  }
}

// Títulos: la primera de las 10 primeras filas con una celda que diga OT
function gypiSemanasBuscar_(hoja, pend) {
  var ultima = hoja.getLastRow();
  var ancho = hoja.getLastColumn();
  if (ultima < 2 || ancho < 2) return;
  var arriba = hoja.getRange(1, 1, Math.min(10, ultima), ancho).getDisplayValues();
  var fila = -1, iOt = -1, iSem = -1;
  for (var i = 0; i < arriba.length && fila < 0; i++) {
    var t = arriba[i].map(function (c) { return String(c).replace(/\\s+/g, " ").trim().toLowerCase(); });
    if (t.indexOf("ot") < 0) continue;
    fila = i + 1;
    iOt = t.indexOf("ot");
    iSem = t.indexOf("semana");
    if (iSem < 0) iSem = t.findIndex(function (c) { return c.indexOf("semana") >= 0; });
  }
  if (fila < 0 || iSem < 0 || ultima <= fila) return;
  var n = ultima - fila;
  var ots = hoja.getRange(fila + 1, iOt + 1, n, 1).getDisplayValues();
  var rango = hoja.getRange(fila + 1, iSem + 1, n, 1);
  var sems = rango.getDisplayValues();
  var formulas = rango.getFormulas();
  for (var j = 0; j < n; j++) {
    var ot = String(ots[j][0]).replace(/\\s+/g, " ").trim();
    var p = pend[ot];
    if (!p || formulas[j][0]) continue;
    var txt = String(sems[j][0]).trim();
    var num = Number(txt);
    p.celdas.push({ rango: hoja.getRange(fila + 1 + j, iSem + 1), valor: txt !== "" && Math.floor(num) === num && num > 0 ? num : null });
  }
}

function gypiSemanasPedir_(metodo, cuerpo) {
  var opciones = { method: metodo, headers: { Authorization: "Bearer " + GYPI_SEMANAS_CLAVE }, muteHttpExceptions: true };
  if (cuerpo) { opciones.contentType = "application/json"; opciones.payload = JSON.stringify(cuerpo); }
  var res = UrlFetchApp.fetch(GYPI_SEMANAS_URL, opciones);
  if (res.getResponseCode() !== 200) throw new Error("Gypi respondió " + res.getResponseCode() + ": " + res.getContentText());
  return JSON.parse(res.getContentText());
}
`;
}
