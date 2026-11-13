// app/lib/xlsxSimple.js — Arma un .xlsx de verdad (no un CSV) con varias
// hojas, en el navegador o en el servidor, sin librerías nuevas: un .xlsx es
// un .zip con unos XML adentro (fflate ya está en el proyecto).
// Lo usa el extracto de cajas y bancos (13/11): los importes salen como
// números y las fechas como fechas, para que Excel pueda sumar y filtrar.
import { zipSync, strToU8 } from "fflate";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Estilos (índice en cellXfs): 0 normal, 1 negrita, 2 número, 3 número en negrita, 4 fecha, 5 título. */
export const ESTILO = { normal: 0, negrita: 1, numero: 2, numeroNegrita: 3, fecha: 4, titulo: 5 };

const esc = (s) => String(s)
  // Caracteres que XML no acepta
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "A", "B", … "Z", "AA"… */
export function letraColumna(i) {
  let n = i + 1;
  let s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** AAAA-MM-DD → número de serie de Excel (días desde 1899-12-30). */
export function serieExcel(fecha) {
  return Math.round((Date.parse(`${fecha}T00:00:00Z`) - Date.parse("1899-12-30T00:00:00Z")) / 86400000);
}

/**
 * Una celda: un valor suelto (texto o número) o { v, estilo }.
 * Las fechas AAAA-MM-DD con estilo "fecha" salen como fecha de Excel.
 */
function celdaXml(c, ref) {
  const { v, estilo } = c !== null && typeof c === "object" ? c : { v: c, estilo: undefined };
  if (v === null || v === undefined || v === "") return estilo ? `<c r="${ref}" s="${estilo}"/>` : "";
  if (estilo === ESTILO.fecha && FECHA.test(String(v))) return `<c r="${ref}" s="${estilo}"><v>${serieExcel(v)}</v></c>`;
  if (typeof v === "number" && Number.isFinite(v)) {
    const s = estilo ?? ESTILO.numero;
    return `<c r="${ref}" s="${s}"><v>${Math.round(v * 100) / 100}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"${estilo ? ` s="${estilo}"` : ""}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

function hojaXml({ filas = [], anchos = [] }) {
  const cols = anchos.length
    ? `<cols>${anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const rows = filas.map((fila, r) => {
    const celdas = (fila || []).map((c, i) => celdaXml(c, `${letraColumna(i)}${r + 1}`)).join("");
    return `<row r="${r + 1}">${celdas}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Nombre de hoja válido para Excel: sin []:*?/\ y de hasta 31 letras, sin repetir. */
function nombresDeHoja(hojas) {
  const usados = new Set();
  return hojas.map((h, i) => {
    let n = String(h.nombre || `Hoja${i + 1}`).replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || `Hoja${i + 1}`;
    let k = 2;
    while (usados.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${k++}`;
    usados.add(n.toLowerCase());
    return n;
  });
}

/**
 * Arma el .xlsx.
 * @param {{ nombre: string, filas: any[][], anchos?: number[] }[]} hojas
 * @returns {Uint8Array}
 */
export function armarXlsx(hojas) {
  const nombres = nombresDeHoja(hojas);
  const archivos = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nombres.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(ESTILOS),
  };
  hojas.forEach((h, i) => { archivos[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(hojaXml(h)); });
  return zipSync(archivos, { level: 6 });
}
