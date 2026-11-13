// app/lib/finanzasExtracto.js — Finanzas, parte F5a: leer el extracto del
// banco. Sin red ni base, para poder probarlo con archivos de verdad.
//
// Dos formas de traerlo:
//   - El resumen mensual en PDF (Credicoop: FECHA, COMBTE, DESCRIPCION,
//     DEBITO, CREDITO, SALDO; la descripción puede seguir en el renglón de
//     abajo). Del PDF salen los textos con su posición: el importe es débito o
//     crédito según bajo qué título queda.
//   - Los movimientos bajados en Excel o CSV: se buscan los títulos (fecha,
//     descripción/concepto, débito, crédito o importe, saldo).
// Cada movimiento queda { fecha, comprobante, descripcion, importe } con el
// importe positivo si entra plata y negativo si sale.

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v, max = 300) => String(v ?? "").replace(/[−–]/g, "-").replace(/\s+/g, " ").trim().slice(0, max);
const sinAcentos = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");

/** "1.234.567,89" → 1234567.89; "-1,5" o "(1,5)" → -1.5; número de Excel → igual. null si no es un importe. */
export function importeAr(v) {
  if (typeof v === "number") return Number.isFinite(v) ? centavos(v) : null;
  let s = txt(v).replace(/\$|\s/g, "");
  if (!s) return null;
  let signo = 1;
  if (/^\(.*\)$/.test(s)) { signo = -1; s = s.slice(1, -1); }
  if (s.startsWith("-")) { signo = -signo; s = s.slice(1); }
  if (s.endsWith("-")) { signo = -signo; s = s.slice(0, -1); }
  if (/^\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(s) || /^\d+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(,\d{3})*(\.\d{1,2})?$/.test(s) || /^\d+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, "");
  else return null;
  const n = Number(s);
  return Number.isFinite(n) ? centavos(signo * n) : null;
}

/** "01/09/26", "01/09/2026", "2026-09-01", "20260901" (CSV de Credicoop) o fecha de Excel (número) → "2026-09-01"; null si no es fecha. */
export function fechaExtracto(v) {
  if (typeof v === "number" && v > 20000 && v < 80000) {
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const s = txt(v);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/) || s.match(/^(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/) || s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\s/);
  if (!m) return null;
  const [d, mes] = [Number(m[1]), Number(m[2])];
  if (!(d >= 1 && d <= 31 && mes >= 1 && mes <= 12)) return null;
  const anio = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${anio}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/* ─── PDF ─────────────────────────────────────────────────────────────── */

/**
 * Los renglones de una página: los textos con la misma altura, de izquierda a
 * derecha. Cada texto queda con su borde izquierdo (x) y derecho (fin).
 * @param {{str: string, x: number, y: number, w: number}[]} items
 */
export function renglonesDePagina(items = []) {
  const por = new Map();
  for (const it of items) {
    const s = String(it.str ?? "");
    if (!s.trim()) continue;
    const y = Math.round(Number(it.y) || 0);
    // Textos casi a la misma altura van al mismo renglón
    const clave = [...por.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
    if (!por.has(clave)) por.set(clave, []);
    por.get(clave).push({ str: s, x: Number(it.x) || 0, fin: (Number(it.x) || 0) + (Number(it.w) || 0) });
  }
  return [...por.entries()].sort((a, b) => b[0] - a[0]).map(([y, ts]) => ({ y, textos: ts.sort((a, b) => a.x - b.x) }));
}

const esTitulo = (r) => {
  const t = r.textos.map((x) => sinAcentos(x.str).toUpperCase().trim());
  return t.includes("FECHA") && t.some((x) => x.startsWith("DEBITO")) && t.some((x) => x.startsWith("CREDITO"));
};
const IMPORTE = /^-?\d{1,3}(\.\d{3})*,\d{2}-?$/;
const COMPROBANTE = /^\d{3,10}$/;

/**
 * Los movimientos de un resumen en PDF.
 * @param {{str: string, x: number, y: number, w: number}[][]} paginas los textos de cada página
 * @returns {{ movimientos: object[], saldo_anterior: number|null, saldo_final: number|null, cuenta: string|null, desde: string|null, hasta: string|null }}
 */
export function movimientosDePdf(paginas = []) {
  const movimientos = [];
  let saldoAnterior = null;
  let saldoFinal = null;
  let cuenta = null;
  let desde = null;
  let hasta = null;
  let terminado = false;
  for (const items of paginas) {
    if (terminado) break;
    const renglones = renglonesDePagina(items);
    const iTitulo = renglones.findIndex(esTitulo);
    // Datos de la cuenta, del encabezado
    for (const r of renglones.slice(0, iTitulo < 0 ? renglones.length : iTitulo)) {
      const linea = txt(r.textos.map((t) => t.str).join(" "));
      const c = linea.match(/Cta\.?\s*([\d.]+-?\d*)/i);
      if (c && !cuenta) cuenta = c[1];
      const p = linea.match(/del:\s*(\d{2}\/\d{2}\/\d{4})\s*al:\s*(\d{2}\/\d{2}\/\d{4})/i);
      if (p && !desde) { desde = fechaExtracto(p[1]); hasta = fechaExtracto(p[2]); }
    }
    if (iTitulo < 0) continue;
    const titulo = renglones[iTitulo].textos;
    const col = (re) => titulo.find((t) => re.test(sinAcentos(t.str).toUpperCase().trim()));
    const deb = col(/^DEBITO/);
    const cre = col(/^CREDITO/);
    const sal = col(/^SALDO/);
    const colFecha = col(/^FECHA/);
    if (!deb || !cre) continue;
    // A qué columna va un importe: la del título con el borde derecho más cerca
    const columnas = [["debito", deb], ["credito", cre], ...(sal ? [["saldo", sal]] : [])];
    const columnaDe = (t) => columnas.reduce((mejor, [n, c]) => (Math.abs(c.fin - t.fin) < Math.abs(mejor[1].fin - t.fin) ? [n, c] : mejor))[0];

    for (const r of renglones.slice(iTitulo + 1)) {
      const textos = r.textos;
      const linea = txt(textos.map((t) => t.str).join(" "));
      const lineaSin = sinAcentos(linea).toUpperCase();
      // Pie y encabezado de página: no son movimientos
      if (/CONTINUA EN PAGINA|VIENE DE PAGINA|BANCO CREDICOOP COOPERATIVO|CREDICOOP RESPONDE|CALIDAD DE SERVICIOS/.test(lineaSin)) continue;
      if (/^SALDO ANTERIOR/.test(lineaSin)) {
        const imp = textos.filter((t) => IMPORTE.test(t.str.trim())).pop();
        if (imp) saldoAnterior = importeAr(imp.str);
        continue;
      }
      if (/^SALDO AL\b/.test(lineaSin)) {
        const imp = textos.filter((t) => IMPORTE.test(t.str.trim())).pop();
        if (imp) saldoFinal = importeAr(imp.str);
        terminado = true;
        break;
      }
      const fecha = fechaExtracto(textos[0]?.str);
      // Los importes van a la derecha de la descripción (no un número dentro del texto)
      const importes = textos.filter((t) => IMPORTE.test(t.str.trim()) && t.fin > Math.min(deb.x, cre.x) - 40);
      if (fecha) {
        let resto = textos.slice(1).filter((t) => !importes.includes(t));
        let comprobante = null;
        if (resto[0] && COMPROBANTE.test(resto[0].str.trim()) && resto.length > 1) {
          comprobante = resto[0].str.trim();
          resto = resto.slice(1);
        }
        let importe = null;
        let saldo = null;
        for (const t of importes) {
          const n = importeAr(t.str);
          const c = columnaDe(t);
          if (c === "debito") importe = -Math.abs(n);
          else if (c === "credito") importe = Math.abs(n);
          else saldo = n;
        }
        if (importe == null) continue;
        movimientos.push({ fecha, comprobante, descripcion: txt(resto.map((t) => t.str).join(" ")), importe, saldo });
      } else if (movimientos.length && !importes.length && textos[0] && textos[0].x > (colFecha?.fin ?? 0) + 15) {
        // La descripción sigue en el renglón de abajo
        const ult = movimientos[movimientos.length - 1];
        ult.descripcion = txt(`${ult.descripcion} ${linea}`);
      }
    }
  }
  return { movimientos, saldo_anterior: saldoAnterior, saldo_final: saldoFinal, cuenta, desde, hasta };
}

/* ─── Excel / CSV ─────────────────────────────────────────────────────── */

const TITULOS = {
  fecha: /^FECHA( (DE )?(MOV(IMIENTO)?|OPERACION|CONTABLE))?$/,
  descripcion: /^(DESCRIPCION|CONCEPTO|DETALLE|MOVIMIENTO)/,
  comprobante: /^(COMPROBANTE|COMBTE|NRO\.? ?(DE )?COMPROBANTE|REFERENCIA|NUMERO)/,
  debito: /^(DEBITO|DEBITOS|DEBE|EGRESO)/,
  credito: /^(CREDITO|CREDITOS|HABER|INGRESO)/,
  importe: /^(IMPORTE|MONTO)/,
  saldo: /^SALDO/,
};

/**
 * Los movimientos de una grilla (Excel o CSV): busca el renglón de títulos en
 * las primeras 30 filas.
 * @param {any[][]} grilla
 */
export function movimientosDeGrilla(grilla = []) {
  for (let i = 0; i < Math.min(30, grilla.length); i++) {
    const fila = (grilla[i] || []).map((c) => sinAcentos(txt(c)).toUpperCase());
    const ix = {};
    for (const [k, re] of Object.entries(TITULOS)) {
      const j = fila.findIndex((c) => re.test(c));
      if (j >= 0) ix[k] = j;
    }
    if (ix.fecha == null || ix.descripcion == null || (ix.importe == null && (ix.debito == null || ix.credito == null))) continue;
    const movimientos = [];
    for (const f of grilla.slice(i + 1)) {
      const fecha = fechaExtracto(f?.[ix.fecha]);
      if (!fecha) continue;
      let importe;
      if (ix.debito != null && ix.credito != null) {
        const d = importeAr(f[ix.debito]);
        const c = importeAr(f[ix.credito]);
        importe = centavos((c ? Math.abs(c) : 0) - (d ? Math.abs(d) : 0));
      } else {
        importe = importeAr(f[ix.importe]);
      }
      if (!importe) continue;
      movimientos.push({
        fecha,
        comprobante: ix.comprobante != null ? txt(f[ix.comprobante], 40) || null : null,
        descripcion: txt(f[ix.descripcion]),
        importe,
        saldo: ix.saldo != null ? importeAr(f[ix.saldo]) : null,
      });
    }
    // Con la columna SALDO: el saldo de antes y el final salen del primer y el
    // último renglón en el tiempo (el CSV de Credicoop viene del más nuevo al más viejo)
    const crono = movimientos.length && movimientos[0].fecha > movimientos[movimientos.length - 1].fecha ? [...movimientos].reverse() : movimientos;
    const conSaldo = crono.length && crono.every((m) => m.saldo != null);
    return {
      movimientos: crono,
      saldo_anterior: conSaldo ? centavos(crono[0].saldo - crono[0].importe) : null,
      saldo_final: conSaldo ? crono[crono.length - 1].saldo : null,
      cuenta: null, desde: crono[0]?.fecha || null, hasta: crono[crono.length - 1]?.fecha || null,
    };
  }
  return { movimientos: [], error: "No encontré los títulos: hace falta Fecha, Descripción (o Concepto) y Débito/Crédito, Ingreso/Egreso o Importe." };
}

/**
 * La planilla de ejemplo para poner al día una caja (13/11, parte 7): se abre
 * con Excel (separada por punto y coma, importes argentinos) y se sube tal cual.
 */
export const PLANILLA_EJEMPLO = [
  "Fecha;Concepto;Ingreso;Egreso",
  "03/11/2026;Cobro en efectivo Cliente SA;150.000,00;",
  "04/11/2026;Compra de insumos de limpieza;;12.500,00",
  "05/11/2026;Retiro para viáticos;;30.000,00",
].join("\r\n");

/** Un CSV (con coma, punto y coma o tabulación) como grilla. */
export function grillaDeCsv(texto) {
  const lineas = String(texto ?? "").replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim());
  if (!lineas.length) return [];
  const muestra = lineas.slice(0, 20).join("\n");
  const sep = [";", "\t", ","].map((s) => [s, muestra.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  return lineas.map((l) => {
    const out = [];
    let campo = "";
    let comillas = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (comillas) {
        if (ch === '"' && l[i + 1] === '"') { campo += '"'; i++; } else if (ch === '"') comillas = false; else campo += ch;
      } else if (ch === '"') comillas = true;
      else if (ch === sep) { out.push(campo); campo = ""; } else campo += ch;
    }
    out.push(campo);
    return out.map((c) => c.trim());
  });
}

/** Una tabla HTML (algunos bancos bajan un ".xls" que en realidad es HTML) como grilla. */
export function grillaDeHtml(html) {
  const limpiar = (s) => txt(String(s).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n))));
  return [...String(html ?? "").matchAll(/<tr\b[\s\S]*?<\/tr>/gi)]
    .map((tr) => [...tr[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((td) => limpiar(td[1])))
    .filter((f) => f.length);
}

/**
 * Qué clase de archivo es, por los primeros bytes: "pdf", "xlsx" (zip),
 * "xls" (Excel viejo, se lee con leerXls.js), "html" o "csv".
 */
export function claseDeArchivo(bytes) {
  const b = bytes || new Uint8Array();
  const ascii = String.fromCharCode(...b.subarray(0, 512)).replace(/^﻿|^\xEF\xBB\xBF/, "").trimStart().toLowerCase();
  if (ascii.startsWith("%pdf-")) return "pdf";
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "xlsx";
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return "xls";
  if (ascii.startsWith("<") && /<(table|html|tr)\b/.test(ascii + String.fromCharCode(...b.subarray(512, 4096)).toLowerCase())) return "html";
  return "csv";
}

/**
 * La primera hoja de un archivo del banco como grilla de textos: .xlsx, .xls
 * (Excel viejo), HTML o CSV (en UTF-8 o, si no lo es, latin1 de Windows).
 * null si es un PDF.
 */
export async function grillaDeArchivo(bytes, { maxFilas = 5000, maxCols = 60 } = {}) {
  const clase = claseDeArchivo(bytes);
  if (clase === "pdf") return null;
  if (clase === "xlsx") {
    const { hojasXlsx, leerHojaXlsx } = await import("./leerXlsx");
    const [hoja] = hojasXlsx(bytes);
    return hoja ? leerHojaXlsx(bytes, hoja, { maxFilas, maxCols }) || [] : [];
  }
  if (clase === "xls") {
    const { leerHojaXls } = await import("./leerXls");
    return leerHojaXls(bytes, null, { maxFilas, maxCols }) || [];
  }
  let texto;
  try { texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { texto = new TextDecoder("latin1").decode(bytes); }
  return (clase === "html" ? grillaDeHtml(texto) : grillaDeCsv(texto)).slice(0, maxFilas);
}
