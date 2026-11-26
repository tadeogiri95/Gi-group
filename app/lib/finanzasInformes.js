// app/lib/finanzasInformes.js — Finanzas: bajar cada informe por separado,
// en PDF o en Excel (pedido de Tadeo del 19/11). Sin migración.
//
// La hoja HTML de todos los informes sueltos sale de acá (mismo estilo que el
// Reporte financiero) y se pasa a PDF con pdfDeHtml.js; el Excel se arma con
// xlsxSimple.js (números como números y fechas como fechas).
import { plata } from "./finanzasOperaciones";
import { ESTILO, armarXlsx } from "./xlsxSimple";

const ESCAPES = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]]);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES.get(c));
export const $ = (n, m = "ARS") => esc(plata(n, m));
export const dma = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : "");

/** Celdas para el Excel. */
export const N = (v) => ({ v: Math.round((Number(v) || 0) * 100) / 100, estilo: ESTILO.numero });
export const NB = (v) => ({ v: Math.round((Number(v) || 0) * 100) / 100, estilo: ESTILO.numeroNegrita });
export const B = (v) => ({ v: String(v ?? ""), estilo: ESTILO.negrita });
export const T = (v) => ({ v: String(v ?? ""), estilo: ESTILO.titulo });
export const F = (v) => (v ? { v, estilo: ESTILO.fecha } : "");

/** Nombre de archivo sin caracteres que Windows no acepta. */
export const nombreArchivo = (s) => String(s || "Informe").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();

/**
 * La hoja completa de un informe suelto.
 * @param {{ titulo: string, subtitulo?: string, empresa?: string, cuerpo: string }} h
 */
export function hojaInforme({ titulo, subtitulo = "", empresa = "", cuerpo }) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;margin:0;padding:24px;font-size:12px;background:#fff}
  .cabecera{background:linear-gradient(90deg,#0e7490,#1d4ed8);color:#fff;border-radius:10px;padding:14px 16px;margin-bottom:12px}
  .cabecera h1{font-size:20px;margin:0}.cabecera p{margin:4px 0 0;opacity:.9}
  h2{font-size:15px;margin:0 0 8px;padding:6px 10px;border-radius:6px;background:#eef6f8;border-left:5px solid #0e7490}
  section{margin:16px 0 0}
  table{width:100%;border-collapse:collapse}
  th,td{padding:4px 6px;border-bottom:1px solid #e3e7eb;text-align:left;vertical-align:top}
  th{font-size:11px;color:#4b5563;background:#f6f8fa}
  td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  tr.sec td{font-weight:700;background:#f3f6f9}
  tr.tot td{font-weight:700;border-top:2px solid #94a3b8}
  tr.sub td{color:#4b5563;padding-left:18px}
  .rojo{color:#c62828}.verde{color:#15803d}.dim{color:#6b7280}
  .kpis{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 8px}
  .kpi{flex:1 1 140px;border:1px solid #e3e7eb;border-radius:8px;padding:8px}
  .kpi span{display:block;font-size:11px;color:#4b5563}.kpi b{font-size:15px}
  .pie{margin-top:18px;font-size:10px;color:#6b7280}
</style></head><body>
<div class="cabecera"><h1>${esc(titulo)}</h1><p>${esc([empresa, subtitulo].filter(Boolean).join(" · "))}</p></div>
${cuerpo}
<p class="pie">Generado por Gypi el ${esc(dma(new Date().toISOString().slice(0, 10)))}.</p>
</body></html>`;
}

/** Baja un archivo armado en el navegador. */
export function bajarArchivo(bytes, nombre, tipo) {
  const blob = new Blob([bytes], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Baja un informe en PDF o en Excel.
 * @param {{ titulo: string, html: () => string, hojas: () => { nombre: string, filas: any[][], anchos?: number[] }[], apaisado?: boolean, bloques?: string, paginaPorBloque?: string }} inf
 *   paginaPorBloque: cada elemento que cumple ese selector va entero en su propia hoja (26/11, Estado de Resultados)
 * @param {"pdf"|"xlsx"} formato
 */
export async function descargarInforme(inf, formato) {
  const nombre = nombreArchivo(inf.titulo);
  if (formato === "pdf") {
    const { descargarPdfDeHtml } = await import("./pdfDeHtml");
    return descargarPdfDeHtml(inf.html(), { archivo: `${nombre}.pdf`, bloques: inf.bloques || ".cabecera, h2, .kpis, tr", apaisado: !!inf.apaisado, paginaPorBloque: inf.paginaPorBloque });
  }
  return bajarArchivo(armarXlsx(inf.hojas()), `${nombre}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
