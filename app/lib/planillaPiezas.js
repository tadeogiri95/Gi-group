// app/lib/planillaPiezas.js — Piezas y módulos de cada OT cargados solos
// desde la carpeta de Drive con las planillas de despiece (Tadeo, 07/11).
//
// Antes, Técnica copiaba la hoja PLANILLA y la pegaba en 🧩 Piezas. Ahora un
// script de Apps Script, instalado una vez con una cuenta que ve la carpeta,
// cada 15 minutos:
//   1. le pasa a Gypi la lista de Excel de la carpeta (nombre, id y fecha);
//   2. Gypi contesta cuáles quiere: los de las OT con la Técnica lista (la
//      columna EXCEL del Plan de trabajo tiene las iniciales, no está vacía ni
//      dice N/A) que todavía no leyó o que cambiaron desde la última vez;
//   3. el script le manda esos archivos y Gypi lee la hoja PLANILLA igual que
//      cuando se pega (leerPiezas): una pieza por unidad física, con su
//      módulo (lo que va antes del primer guion o punto del nombre).
// La OT sale del número del principio del nombre del archivo, como los PDF:
// "7408-230-BCG-HOTEL AMANCAY-….xlsm" → OT M-7408-230. Si hay dos Excel de la
// misma OT, manda el más nuevo.
// Las piezas que ya se escanearon conservan el escaneo (mismo nombre y
// número). Si la planilla nueva ya no trae una pieza que tenía escaneos, Gypi
// no la borra sola: avisa.
// Sin migración: estado en config_sistema (CLAVE_PLANILLAS_PIEZAS):
// { hash, carpeta, creada_at, ultima_lectura, archivos, cargas: { [ot]: … } }.
// Sin red ni base: lo usan la ruta /api/piezas/planillas y la pantalla.
import { numeroDePdf, numeroDeOt } from "./pdfOt";

export const CLAVE_PLANILLAS_PIEZAS = "planillas_piezas_script";
/** Excel que se piden por vuelta del script (cada uno pesa ~2 MB). */
export const POR_VUELTA = 8;
/** Más grande que esto no entra en un pedido a Gypi (base64 suma un tercio). */
export const MAX_BYTES_EXCEL = 3 * 1024 * 1024;
export const MAX_EXCELS = 3000;
export const HOJA_PIEZAS = "PLANILLA";

const ID_DRIVE = /^[\w-]{10,200}$/;

/** ¿La Técnica de la OT está lista? Columna EXCEL del Plan con algo que no sea N/A. */
export function tecnicaLista(etapasDiseno) {
  return etapasDiseno?.excel?.e === "hecho";
}

/** Lo que manda el script, limpio: id válido, sin repetidos, hasta MAX_EXCELS. */
export function limpiarExcels(lista) {
  const vistos = new Set();
  const out = [];
  for (const a of Array.isArray(lista) ? lista : []) {
    const id = String(a?.id ?? "").trim();
    const nombre = String(a?.nombre ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!ID_DRIVE.test(id) || !nombre || vistos.has(id)) continue;
    const f = new Date(a?.fecha);
    vistos.add(id);
    const bytes = Number(a?.bytes);
    out.push({ nombre, id, fecha: Number.isNaN(f.getTime()) ? null : f.toISOString(), bytes: Number.isFinite(bytes) ? bytes : null });
    if (out.length >= MAX_EXCELS) break;
  }
  return out;
}

/**
 * El Excel de cada OT: número del nombre → OT de Gypi (misma sub-OT; el de
 * la madre no se usa para una sub-OT). Si hay varios, el más nuevo.
 * @param {{nombre:string,id:string,fecha:string|null}[]} archivos
 * @param {{ot:string}[]} proyectos
 * @returns {Map<string, {nombre:string,id:string,fecha:string|null}>} ot → archivo
 */
export function excelPorOt(archivos, proyectos) {
  const otDeNumero = new Map();
  for (const p of proyectos || []) {
    const n = numeroDeOt(p?.ot);
    if (n && !otDeNumero.has(n)) otDeNumero.set(n, p.ot);
  }
  const out = new Map();
  for (const a of archivos || []) {
    const ot = otDeNumero.get(numeroDePdf(a?.nombre));
    if (!ot) continue;
    const previo = out.get(ot);
    if (!previo || String(a.fecha || "") > String(previo.fecha || "")) out.set(ot, a);
  }
  return out;
}

/**
 * Qué Excel pedirle al script en esta vuelta: OT con la Técnica lista cuyo
 * Excel no se leyó todavía o cambió (otro archivo u otra fecha). Primero las
 * que nunca se cargaron, después las más nuevas.
 * @returns {{ ot: string, id: string, nombre: string }[]}
 */
export function excelsPendientes(archivos, proyectos, cargas = {}, max = POR_VUELTA) {
  const lista = [];
  const porOt = excelPorOt(archivos, proyectos);
  const etapas = new Map((proyectos || []).map((p) => [p.ot, p.etapas_diseno]));
  for (const [ot, a] of porOt) {
    if (!tecnicaLista(etapas.get(ot))) continue;
    if (a.bytes != null && a.bytes > MAX_BYTES_EXCEL) continue;
    const c = cargas?.[ot];
    if (c && c.id === a.id && c.fecha === a.fecha) continue;
    lista.push({ ot, id: a.id, nombre: a.nombre, fecha: a.fecha, nueva: !c });
  }
  lista.sort((x, y) => Number(y.nueva) - Number(x.nueva) || String(y.fecha || "").localeCompare(String(x.fecha || "")));
  return lista.slice(0, max).map(({ ot, id, nombre }) => ({ ot, id, nombre }));
}

/** Excel de la carpeta que no se pueden leer solos, para mostrarlos en la pantalla. */
export function excelsGrandes(archivos) {
  return (archivos || []).filter((a) => a.bytes != null && a.bytes > MAX_BYTES_EXCEL);
}

/**
 * Filas de la hoja PLANILLA → el mismo texto que sale al copiarla desde el
 * renglón de títulos (el de PANEL). Arriba quedan OT, cliente y proyecto,
 * que no son piezas. Null si la hoja no tiene la columna PANEL.
 * @param {string[][]} filas
 */
export function textoDesdePanel(filas) {
  const i = (filas || []).findIndex((r) => (r || []).some((c) => String(c ?? "").trim().toUpperCase() === "PANEL"));
  if (i < 0) return null;
  return filas.slice(i).map((r) => (r || []).map((c) => String(c ?? "").replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
}

/** Renglones sin código de módulo (todas las piezas tienen que tenerlo). */
export function sinCodigo(renglones = []) {
  return renglones.filter((r) => !r.modulo).map((r) => r.nombre);
}

/** Resumen de una carga para guardar y mostrar (corto: entra en config_sistema). */
export function resumenCarga({ archivo, piezas = 0, renglones = 0, modulos = 0, sinCod = [], errores = [], noBorradas = 0, error = null, ahora }) {
  return {
    id: archivo.id,
    nombre: archivo.nombre,
    fecha: archivo.fecha || null,
    at: ahora,
    piezas,
    renglones,
    modulos,
    sin_codigo: sinCod.slice(0, 30),
    sin_codigo_total: sinCod.length,
    errores: errores.slice(0, 10).map((e) => (typeof e === "string" ? e : `Fila ${e.fila}: ${e.motivo}`)),
    no_borradas: noBorradas,
    error: error ? String(error).slice(0, 300) : null,
  };
}

/** Cargas para la pantalla: las más nuevas primero, con problemas marcados. */
export function cargasParaVer(cargas = {}) {
  return Object.entries(cargas || {})
    .map(([ot, c]) => ({ ot, ...c, problema: !!(c.error || c.sin_codigo_total || c.errores?.length || c.no_borradas) }))
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
}

/** Una línea para la persona: "41 piezas en 6 módulos" o el problema. */
export function textoCarga(c) {
  if (!c) return "";
  if (c.error) return `No se pudo leer: ${c.error}`;
  const partes = [`${c.piezas} ${c.piezas === 1 ? "pieza" : "piezas"} en ${c.modulos} ${c.modulos === 1 ? "módulo" : "módulos"}`];
  if (c.sin_codigo_total) partes.push(`${c.sin_codigo_total} sin código de módulo`);
  if (c.errores?.length) partes.push(`${c.errores.length} ${c.errores.length === 1 ? "renglón" : "renglones"} con error`);
  if (c.no_borradas) partes.push(`${c.no_borradas} ya no están en la planilla pero tienen escaneos (no se borraron)`);
  return partes.join(" · ");
}

/**
 * Código para pegar en Apps Script (script.google.com → script nuevo, con
 * una cuenta que vea la carpeta). instalarPiezasGypi() se corre una vez:
 * pide permiso, deja la tarea de cada 15 minutos y hace la primera vuelta.
 * Mira la carpeta y sus subcarpetas (hasta 3 niveles). No cambia ni mueve
 * los archivos. Sin template strings adentro.
 */
export function scriptCarpetaPiezas({ url, clave, carpeta }) {
  return `// Gypi ← carpeta de Drive con las planillas de despiece: cada 15 minutos
// Gypi carga solo las piezas y los módulos de cada OT cuando la Técnica está
// lista (columna EXCEL del Plan de trabajo). No cambia ni mueve los archivos.
// Pegalo en un script nuevo de script.google.com, guardá y ejecutá
// instalarPiezasGypi una sola vez. Después corre solo cada 15 minutos.
// La clave es privada: no compartas este código.
var GYPI_PIEZAS_URL = ${JSON.stringify(url)};
var GYPI_PIEZAS_CLAVE = ${JSON.stringify(clave)};
var GYPI_PIEZAS_CARPETA = ${JSON.stringify(carpeta)};
var GYPI_EXCEL_TIPOS = [
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
];

function instalarPiezasGypi() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "pasarPiezasGypi") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("pasarPiezasGypi").timeBased().everyMinutes(15).create();
  pasarPiezasGypi();
}

function pasarPiezasGypi() {
  var lista = [];
  gypiPiezasRecorrer_(DriveApp.getFolderById(GYPI_PIEZAS_CARPETA), lista, 0);
  var r = gypiPiezasLlamar_({ accion: "lista", archivos: lista });
  var pedir = r.pedir || [];
  for (var i = 0; i < pedir.length; i++) {
    var p = pedir[i];
    try {
      var f = DriveApp.getFileById(p.id);
      gypiPiezasLlamar_({
        accion: "planilla",
        id: p.id,
        nombre: f.getName(),
        fecha: f.getLastUpdated().toISOString(),
        contenido: Utilities.base64Encode(f.getBlob().getBytes())
      });
    } catch (e) {
      console.warn("No se pudo pasar " + p.nombre + ": " + e);
    }
  }
}

function gypiPiezasLlamar_(datos) {
  var res = UrlFetchApp.fetch(GYPI_PIEZAS_URL, {
    method: "patch",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + GYPI_PIEZAS_CLAVE },
    payload: JSON.stringify(datos),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error("Gypi respondió " + res.getResponseCode() + ": " + res.getContentText());
  return JSON.parse(res.getContentText());
}

function gypiPiezasRecorrer_(carpeta, lista, nivel) {
  var archivos = carpeta.getFiles();
  while (archivos.hasNext()) {
    var f = archivos.next();
    if (f.isTrashed() || GYPI_EXCEL_TIPOS.indexOf(f.getMimeType()) < 0) continue;
    lista.push({ nombre: f.getName(), id: f.getId(), fecha: f.getLastUpdated().toISOString(), bytes: f.getSize() });
  }
  if (nivel >= 3) return;
  var subs = carpeta.getFolders();
  while (subs.hasNext()) gypiPiezasRecorrer_(subs.next(), lista, nivel + 1);
}
`;
}
