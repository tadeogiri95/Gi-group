// app/lib/pdfOt.js — El PDF de cada OT, desde una carpeta de Google Drive
// (Tadeo, 04/11; notes/diseno-pdf-ot.md). Sin migración: la lista de PDF se
// guarda en config_sistema (CLAVE_PDF_OT) junto con el hash de la clave.
//
// Un script de Apps Script (scriptCarpetaPdf), instalado una vez con una
// cuenta que ve la carpeta, le manda a Gypi cada 15 minutos la lista de PDF
// (nombre, id y fecha). Gypi une cada PDF con su OT por el número del
// principio del nombre:
//   "7498-36-GRUPO ELYON-TORRE AURUS-….pdf"   → 7498-36 → OT M-7498-36
//   "7285-STOM-MALMO-CASAS 9 A 14-COCINAS.pdf" → 7285    → OT M-7285
//   "7573-04 - BUGLIOTTI - NARANJO VI ….pdf"   → 7573-4  → OT M-7573-04
// La letra de la división (M-) no está en el nombre del PDF: se ignora.
// Si una sub-OT (M-7498-36) no tiene PDF propio, se ofrece el de la madre.
//
// El PDF se abre en Drive (la carpeta está compartida "cualquier persona con
// el enlace puede ver"), así el operario no necesita cuenta de Google.
// Sin crypto ni nada de servidor: lo usan las pantallas.
//
// 📄 Ver PDF de una OT (PR 2): otDeQr saca la OT de cualquier QR de Gypi o de
// la planilla (el de la OT, una pieza, un bulto, un suelto o un módulo).
import { textoDeQr } from "./linkQr";
import { leerQr } from "./escaneoCarga";

export const CLAVE_PDF_OT = "pdf_ot_script";
export const MAX_PDFS = 5000;

const ID_DRIVE = /^[\w-]{10,200}$/;

/** "7498", "36" → "7498-36"; la sub-OT sin ceros adelante ("04" → "4"). */
const clave = (num, sub) => (sub != null && sub !== "" ? `${Number(num)}-${Number(sub)}` : String(Number(num)));

/**
 * Número de OT del nombre de un PDF: "7498-36-GRUPO…" → "7498-36",
 * "7532 - BCG…" → "7532". La sub-OT solo cuenta si después viene un guion
 * (o termina el nombre), para no confundir "7300-15 MODULOS" con una sub-OT.
 * Null si el nombre no empieza con un número.
 */
export function numeroDePdf(nombre) {
  const m = String(nombre ?? "").trim().match(/^(\d{3,6})(?:\s*-\s*(\d{1,3})(?=\s*[-–]|\s*\.pdf$|$))?/i);
  return m ? clave(m[1], m[2]) : null;
}

/** Número de una OT de Gypi sin la letra: "M-7498-36" → "7498-36", "m-7495 " → "7495". */
export function numeroDeOt(ot) {
  const m = String(ot ?? "").trim().toUpperCase().match(/^[A-ZÁÉÍÓÚÑ]*\s*-?\s*(\d{3,6})(?:\s*-\s*(\d{1,3}))?$/);
  return m ? clave(m[1], m[2]) : null;
}

/**
 * Índice número → PDF (el más nuevo primero), para no recorrer la lista
 * entera por cada OT de la tabla. Los PDF sin número no entran.
 */
export function indicePdfs(archivos) {
  const indice = new Map();
  for (const a of Array.isArray(archivos) ? archivos : []) {
    const n = numeroDePdf(a?.nombre);
    const url = urlDrive(a?.id);
    if (!n || !url) continue;
    if (!indice.has(n)) indice.set(n, []);
    indice.get(n).push({ ...a, url });
  }
  for (const lista of indice.values()) {
    lista.sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")) || String(a.nombre).localeCompare(String(b.nombre), "es"));
  }
  return indice;
}

/**
 * PDF de una OT, el más nuevo primero: { pdfs: [{ nombre, id, fecha, url }],
 * deLaMadre } (deLaMadre = la sub-OT no tiene PDF propio y son los de la OT
 * madre). Sin PDF: { pdfs: [], deLaMadre: false }. Recibe la lista que manda
 * el script o el índice de indicePdfs.
 */
export function pdfsDeOt(ot, archivosOIndice) {
  const indice = archivosOIndice instanceof Map ? archivosOIndice : indicePdfs(archivosOIndice);
  const numero = numeroDeOt(ot);
  if (!numero) return { pdfs: [], deLaMadre: false };
  const propios = indice.get(numero) || [];
  if (propios.length || !numero.includes("-")) return { pdfs: propios, deLaMadre: false };
  const madre = indice.get(numero.split("-")[0]) || [];
  return { pdfs: madre, deLaMadre: madre.length > 0 };
}

/**
 * La OT de cualquier QR: "M-7495", "OT M-7495 - PIEZA - 12",
 * "OT M-7495 - BULTO 3 DE 4", "OT M-7495 - MODULO - M.izq", el link del rótulo
 * (?carga=M-7495) o el número escrito a mano. Null si no trae una OT.
 */
export function otDeQr(texto) {
  const s = textoDeQr(texto);
  const lectura = leerQr(s);
  if (lectura?.ot) return lectura.ot;
  const m = s.match(/^OT\s+([\w.-]{1,40})\s+-\s+/i);
  return m ? m[1] : null;
}

/** Link para ver el PDF en Drive (el id viene del script; se arma acá, no se confía en un link). */
export function urlDrive(id) {
  return ID_DRIVE.test(String(id ?? "")) ? `https://drive.google.com/file/d/${id}/view` : null;
}

/** Id de la carpeta desde el link de Drive (o el id solo). Null si no se reconoce. */
export function idCarpeta(link) {
  const s = String(link ?? "").trim();
  const m = s.match(/\/folders\/([\w-]{10,200})/) || s.match(/[?&]id=([\w-]{10,200})/);
  if (m) return m[1];
  return ID_DRIVE.test(s) ? s : null;
}

/** Lo que manda el script, limpio: solo PDF con id válido, sin repetidos, hasta MAX_PDFS. */
export function limpiarArchivos(lista) {
  const vistos = new Set();
  const out = [];
  for (const a of Array.isArray(lista) ? lista : []) {
    const id = String(a?.id ?? "").trim();
    const nombre = String(a?.nombre ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!ID_DRIVE.test(id) || !nombre || vistos.has(id)) continue;
    const f = new Date(a?.fecha);
    vistos.add(id);
    out.push({ nombre, id, fecha: Number.isNaN(f.getTime()) ? null : f.toISOString() });
    if (out.length >= MAX_PDFS) break;
  }
  return out;
}

/**
 * Código para pegar en Apps Script (script.google.com → script nuevo, con
 * una cuenta que vea la carpeta). instalarPdfGypi() se corre una vez: pide
 * permiso, deja la tarea de cada 15 minutos y manda la lista. Mira la
 * carpeta y sus subcarpetas (hasta 3 niveles). Sin template strings adentro.
 */
export function scriptCarpetaPdf({ url, clave: claveScript, carpeta }) {
  return `// Gypi ← carpeta de Drive con los PDF de las OT: cada 15 minutos le pasa
// a Gypi la lista de PDF (nombre, id y fecha) para que cada OT tenga su
// botón 📄 PDF. No sube ni cambia los archivos.
// Pegalo en un script nuevo de script.google.com, guardá y ejecutá
// instalarPdfGypi una sola vez. Después corre solo cada 15 minutos.
// La clave es privada: no compartas este código.
var GYPI_PDF_URL = ${JSON.stringify(url)};
var GYPI_PDF_CLAVE = ${JSON.stringify(claveScript)};
var GYPI_PDF_CARPETA = ${JSON.stringify(carpeta)};

function instalarPdfGypi() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "pasarPdfGypi") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("pasarPdfGypi").timeBased().everyMinutes(15).create();
  pasarPdfGypi();
}

function pasarPdfGypi() {
  var lista = [];
  gypiPdfRecorrer_(DriveApp.getFolderById(GYPI_PDF_CARPETA), lista, 0);
  var res = UrlFetchApp.fetch(GYPI_PDF_URL, {
    method: "patch",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + GYPI_PDF_CLAVE },
    payload: JSON.stringify({ archivos: lista }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error("Gypi respondió " + res.getResponseCode() + ": " + res.getContentText());
}

function gypiPdfRecorrer_(carpeta, lista, nivel) {
  var archivos = carpeta.getFilesByType(MimeType.PDF);
  while (archivos.hasNext()) {
    var f = archivos.next();
    if (f.isTrashed()) continue;
    lista.push({ nombre: f.getName(), id: f.getId(), fecha: f.getLastUpdated().toISOString() });
  }
  if (nivel >= 3) return;
  var subs = carpeta.getFolders();
  while (subs.hasNext()) gypiPdfRecorrer_(subs.next(), lista, nivel + 1);
}
`;
}
