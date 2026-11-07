// app/lib/leerXlsx.js — Lee UNA hoja de un Excel (.xlsx / .xlsm) en el
// servidor, sin librerías nuevas: el archivo es un zip (fflate, que ya se usa
// en exportar.js) con XML adentro. Se toman los valores que Excel dejó
// guardados en cada celda (el resultado de las fórmulas), no las fórmulas:
// es lo mismo que se ve en pantalla y lo que se copia al pegar.
// Lo usa la carga automática de piezas desde la carpeta de planillas
// (app/lib/planillaPiezas.js). Sin red ni base: se puede probar con un
// archivo de verdad.
import { unzipSync, strFromU8 } from "fflate";

const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** "&amp;" → "&", "&#10;" → salto de línea. */
export function decodificarXml(s) {
  return String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTIDADES[e.toLowerCase()] ?? m;
  });
}

/** Texto de un <si> o un <is>: junta los <t> (los "runs" con formato), sin la fonética <rPh>. */
function textoDeRuns(xml) {
  const sinFonetica = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of sinFonetica.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) out += decodificarXml(m[1] ?? "");
  return out;
}

/** "AB12" → { fila: 11, col: 27 } (desde 0). */
export function posicionCelda(ref) {
  const m = String(ref ?? "").match(/^([A-Z]{1,3})(\d+)$/);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { fila: Number(m[2]) - 1, col: col - 1 };
}

/** Número guardado por Excel → texto como se ve: 0.44999999999999996 → "0.45". */
function numeroComoTexto(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return String(Number(n.toPrecision(12)));
}

const atributo = (attrs, nombre) => {
  const m = attrs.match(new RegExp(`\\b${nombre}="([^"]*)"`));
  return m ? decodificarXml(m[1]) : null;
};

/** Ruta del XML de cada hoja por su nombre ("PLANILLA" → "xl/worksheets/sheet3.xml"). */
function rutasDeHojas(workbookXml, relsXml) {
  const rels = new Map();
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = atributo(m[1], "Id");
    const target = atributo(m[1], "Target");
    if (id && target) rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
  }
  const hojas = new Map();
  for (const m of workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const nombre = atributo(m[1], "name");
    const rid = atributo(m[1], "r:id");
    if (nombre != null && rid && rels.has(rid)) hojas.set(nombre, rels.get(rid));
  }
  return hojas;
}

/** Nombres de las hojas del libro, en orden. */
export function hojasXlsx(bytes) {
  const z = unzipSync(bytes, { filter: (f) => f.name === "xl/workbook.xml" || f.name === "xl/_rels/workbook.xml.rels" });
  if (!z["xl/workbook.xml"]) throw new Error("No es un archivo de Excel");
  return [...rutasDeHojas(strFromU8(z["xl/workbook.xml"]), strFromU8(z["xl/_rels/workbook.xml.rels"] || new Uint8Array())).keys()];
}

/**
 * Una hoja como filas de texto: filas[fila][col] (desde 0), "" en las vacías.
 * El nombre se busca sin importar mayúsculas ni espacios de más
 * ("PERFILES " = "perfiles"). Null si el libro no tiene esa hoja.
 * @param {Uint8Array} bytes
 * @param {string} nombreHoja
 * @param {{ maxFilas?: number, maxCols?: number }} [limites]
 * @returns {string[][] | null}
 */
export function leerHojaXlsx(bytes, nombreHoja, { maxFilas = 5000, maxCols = 120 } = {}) {
  const base = unzipSync(bytes, {
    filter: (f) => f.name === "xl/workbook.xml" || f.name === "xl/_rels/workbook.xml.rels" || f.name === "xl/sharedStrings.xml",
  });
  if (!base["xl/workbook.xml"]) throw new Error("No es un archivo de Excel");
  const hojas = rutasDeHojas(strFromU8(base["xl/workbook.xml"]), strFromU8(base["xl/_rels/workbook.xml.rels"] || new Uint8Array()));
  const norm = (s) => String(s).replace(/\s+/g, " ").trim().toLowerCase();
  const buscado = norm(nombreHoja);
  const ruta = [...hojas].find(([n]) => norm(n) === buscado)?.[1];
  if (!ruta) return null;

  const compartidos = [];
  if (base["xl/sharedStrings.xml"]) {
    for (const m of strFromU8(base["xl/sharedStrings.xml"]).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) compartidos.push(textoDeRuns(m[1] ?? ""));
  }
  const hoja = unzipSync(bytes, { filter: (f) => f.name === ruta })[ruta];
  if (!hoja) return null;
  const xml = strFromU8(hoja);

  const filas = [];
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const pos = posicionCelda(atributo(m[1], "r"));
    if (!pos || pos.fila >= maxFilas || pos.col >= maxCols) continue;
    const tipo = atributo(m[1], "t");
    const cuerpo = m[2] || "";
    let valor = "";
    if (tipo === "inlineStr") {
      const is = cuerpo.match(/<is\b[^>]*>([\s\S]*?)<\/is>/);
      valor = is ? textoDeRuns(is[1]) : "";
    } else {
      const v = cuerpo.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
      if (!v) continue;
      const crudo = decodificarXml(v[1]);
      if (tipo === "s") valor = compartidos[Number(crudo)] ?? "";
      else if (tipo === "b") valor = crudo === "1" ? "TRUE" : "FALSE";
      else if (tipo === "str" || tipo === "e" || tipo === "d") valor = crudo;
      else valor = numeroComoTexto(crudo);
    }
    if (valor === "") continue;
    while (filas.length <= pos.fila) filas.push([]);
    const fila = filas[pos.fila];
    while (fila.length < pos.col) fila.push("");
    fila[pos.col] = valor;
  }
  return filas.map((f) => f.map((c) => c ?? ""));
}
