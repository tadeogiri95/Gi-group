// app/lib/finanzasResumenPago.js — Resumen de órdenes de pago para el CFO
// (12/11, migración 186). Reglas puras; las usan /api/finanzas/pagos, la
// página del CFO (/op/resumen/<token>) y Finanzas → 💸 Pagos.
//
//   - El dueño junta varias órdenes de pago (175) en un resumen: por cada
//     forma de pago un renglón con fecha, proveedor, medio e importe, y el
//     comprobante de la orden si lo cargó (opcional).
//   - Al pie: lo que se paga en forma inmediata (efectivo y transferencia), lo
//     que se paga con cheques (e-cheq propios y cheques de terceros) y el total.
//   - Se le manda al CFO un link (sin usuario) para verlo y aprobar las
//     órdenes, o se exporta en PDF. Las anuladas no suman.
import { FORMAS_PAGO, ESTADOS_ORDEN, fechaCorta, textoForma } from "./finanzasPagos";
import { plata } from "./finanzasOperaciones";

/** Formas que se pagan en el momento; el resto son cheques. */
export const FORMAS_INMEDIATAS = ["efectivo", "transferencia"];
export const FORMAS_CHEQUE = ["echeq", "cheque_tercero"];
/** Órdenes que se pueden juntar en un resumen. */
export const ENTRAN_EN_RESUMEN = ["borrador", "para_aprobar", "rechazada", "aprobada"];
export const ESTADOS_RESUMEN = {
  armado: { nombre: "Armado, sin mandar", icono: "📝" },
  enviado: { nombre: "Mandado al CFO", icono: "📲" },
  anulado: { nombre: "Anulado", icono: "🚫" },
};
export const MAX_ORDENES_RESUMEN = 100;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** "inmediato" o "cheque" según la forma de pago. */
export const claseForma = (forma) => (FORMAS_CHEQUE.includes(forma) ? "cheque" : "inmediato");

/** Una orden puede entrar en un resumen nuevo: estado vivo y en ningún otro resumen. */
export const puedeEntrar = (o) => ENTRAN_EN_RESUMEN.includes(o?.estado) && !o?.resumen_id;

/**
 * Revisa un resumen nuevo.
 * @param {{ ordenes: any[], fecha: string, notas?: string }} f  ordenes: los id elegidos
 * @param {object[]} ordenes  las órdenes de la empresa
 * @returns {{ resumen?: { fecha: string, notas: string|null }, ids?: number[], errores: string[] }}
 */
export function validarResumen(f = {}, ordenes = []) {
  const errores = [];
  if (!FECHA.test(String(f.fecha || ""))) errores.push("Falta la fecha del resumen");
  const ids = [...new Set((Array.isArray(f.ordenes) ? f.ordenes : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) errores.push("Elegí al menos una orden de pago");
  if (ids.length > MAX_ORDENES_RESUMEN) errores.push(`Hasta ${MAX_ORDENES_RESUMEN} órdenes por resumen`);
  for (const id of ids.slice(0, MAX_ORDENES_RESUMEN)) {
    const o = ordenes.find((x) => Number(x.id) === id);
    if (!o) { errores.push("Una de las órdenes ya no está. Actualizá la pantalla."); break; }
    if (o.resumen_id) { errores.push(`La orden N° ${o.numero} ya está en otro resumen`); continue; }
    if (!ENTRAN_EN_RESUMEN.includes(o.estado)) errores.push(`La orden N° ${o.numero} está ${String(ESTADOS_ORDEN[o.estado]?.nombre || o.estado).toLowerCase()}: no entra en el resumen`);
  }
  if (errores.length) return { errores };
  return { errores, ids, resumen: { fecha: f.fecha, notas: txt(f.notas, 500) || null } };
}

/**
 * Un renglón por forma de pago de cada orden (sin las anuladas), ordenado
 * por fecha y número de orden.
 */
export function renglonesResumen(ordenes = []) {
  return ordenes
    .filter((o) => o && o.estado !== "anulada")
    .slice()
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || Number(a.numero) - Number(b.numero))
    .flatMap((o) => (o.formas || []).map((x, i) => ({
      orden_id: o.id, numero: o.numero, fecha: o.fecha, proveedor: o.proveedor_nombre, estado: o.estado,
      forma: x.forma, medio: textoForma(x), clase: claseForma(x.forma), importe: centavos(x.importe),
      comprobante: i === 0 ? o.comprobante_url || null : null,
    })));
}

/** Las sumas del pie: inmediato (efectivo + transferencia), cheques y total, y por forma. */
export function totalesResumen(ordenes = []) {
  const porForma = Object.fromEntries(Object.keys(FORMAS_PAGO).map((k) => [k, 0]));
  for (const r of renglonesResumen(ordenes)) if (r.forma in porForma) porForma[r.forma] = centavos(porForma[r.forma] + r.importe);
  const inmediato = centavos(FORMAS_INMEDIATAS.reduce((s, k) => s + porForma[k], 0));
  const cheques = centavos(FORMAS_CHEQUE.reduce((s, k) => s + porForma[k], 0));
  const vivas = ordenes.filter((o) => o && o.estado !== "anulada");
  return { inmediato, cheques, total: centavos(inmediato + cheques), porForma, ordenes: vivas.length, aprobadas: vivas.filter((o) => ["aprobada", "pagada"].includes(o.estado)).length };
}

/** Lo que ve el CFO en la página del resumen (nada de cuentas contables de más). */
export function datosResumenParaCfo(resumen, ordenes = [], empresa = {}) {
  const vivas = ordenes.filter((o) => o && o.estado !== "anulada")
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || Number(a.numero) - Number(b.numero));
  return {
    empresa: { nombre: empresa.nombre || "", logo: /^https:\/\//.test(String(empresa.logo_url || "")) ? empresa.logo_url : null },
    numero: resumen.numero, fecha: resumen.fecha, notas: resumen.notas || null, cargado_por: resumen.cargado_por_nombre || null,
    totales: totalesResumen(vivas),
    ordenes: vivas.map((o) => ({
      numero: o.numero, fecha: o.fecha, proveedor: o.proveedor_nombre, estado: o.estado, total: Number(o.total) || 0,
      comprobante: /^https:\/\//.test(String(o.comprobante_url || "")) ? o.comprobante_url : null,
      formas: (o.formas || []).map((x) => ({ texto: textoForma(x), importe: x.importe, clase: claseForma(x.forma) })),
      // El link de la orden, para decidirla de a una (solo mientras espera)
      token: o.estado === "para_aprobar" && o.token ? o.token : null,
      decision: o.decidida_at ? { por: o.decidida_por_nombre || null, nota: o.decision_nota || null } : null,
    })),
  };
}

/** Mensaje de WhatsApp para invitar al CFO a ver el resumen. */
export function textoWhatsappResumen(resumen, ordenes, url, { empresa = "", cfo = "" } = {}) {
  const t = totalesResumen(ordenes);
  return [
    `${cfo ? `Hola ${cfo}, ` : ""}te paso el resumen de órdenes de pago N° ${resumen.numero}${empresa ? ` de ${empresa}` : ""} (${t.ordenes} ${t.ordenes === 1 ? "orden" : "órdenes"}).`,
    `Transferencia, efectivo o inmediato: ${plata(t.inmediato, "ARS")}`,
    `Cheques: ${plata(t.cheques, "ARS")}`,
    `Total: ${plata(t.total, "ARS")}`,
    "",
    `Para verlo y aprobar las órdenes abrí este link: ${url}`,
  ].join("\n");
}

const ESCAPES = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ESCAPES.get(ch));
const urlSegura = (u) => (/^https:\/\//.test(String(u || "")) ? u : null);

/** El resumen listo para imprimir o guardar en PDF (hoja A4). */
export function htmlResumenPago({ empresa = {}, resumen, ordenes = [] }) {
  const logo = urlSegura(empresa?.logo_url);
  const nombre = empresa?.razon_social || empresa?.nombre || "";
  const filas = renglonesResumen(ordenes);
  const t = totalesResumen(ordenes);
  const tr = filas.map((r) => {
    const comp = urlSegura(r.comprobante);
    return `<tr><td>${esc(fechaCorta(r.fecha))}</td><td>${esc(r.proveedor)}<span class="chico" style="display:block">OP N° ${esc(r.numero)}</span></td><td>${esc(r.medio)}</td><td class="n">${esc(plata(r.importe))}</td><td>${comp ? `<a href="${esc(comp)}">Ver</a>` : ""}</td></tr>`;
  }).join("");
  const est = ESTADOS_RESUMEN[resumen.estado];
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Resumen de órdenes de pago N° ${esc(resumen.numero)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; color: #000; font-size: 10pt; }
  .cabecera { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; margin-bottom: 6mm; }
  .cabecera img { max-height: 20mm; max-width: 50mm; object-fit: contain; display: block; margin-bottom: 2mm; }
  .der { text-align: right; }
  h1 { font-size: 15pt; margin: 0; }
  .chico { font-size: 8.5pt; color: #333; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; border-bottom: .4mm solid #000; padding: 1.5mm 1mm; font-size: 8.5pt; }
  td { border-bottom: .2mm solid #999; padding: 1.5mm 1mm; vertical-align: top; }
  tr { break-inside: avoid; }
  .n { text-align: right; white-space: nowrap; }
  .sumas { margin-top: 5mm; margin-left: auto; width: 115mm; }
  .sumas td { border: none; padding: 1mm; }
  .sumas .tot td { border-top: .4mm solid #000; font-size: 12pt; font-weight: 800; }
  .nota { margin-top: 5mm; font-size: 9.5pt; }
  .firmas { display: flex; gap: 20mm; margin-top: 22mm; }
  .firmas div { flex: 1; border-top: .3mm solid #000; padding-top: 1.5mm; text-align: center; font-size: 9pt; }
</style></head><body>
  <div class="cabecera">
    <div>${logo ? `<img src="${esc(logo)}" alt="">` : ""}<b>${esc(nombre)}</b></div>
    <div class="der">
      <h1>Resumen de órdenes de pago N° ${esc(resumen.numero)}</h1>
      <div class="chico">Fecha: ${esc(fechaCorta(resumen.fecha))} · ${t.ordenes} ${t.ordenes === 1 ? "orden" : "órdenes"}</div>
      ${est ? `<div class="chico">${esc(est.nombre)}</div>` : ""}
    </div>
  </div>
  <table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Medio de pago</th><th class="n">Importe</th><th>Comprobante</th></tr></thead><tbody>${tr}</tbody></table>
  <table class="sumas"><tbody>
    <tr><td>Transferencia, efectivo o inmediato</td><td class="n">${esc(plata(t.inmediato))}</td></tr>
    <tr><td>Cheques (e-cheq y de terceros)</td><td class="n">${esc(plata(t.cheques))}</td></tr>
    <tr class="tot"><td>Total</td><td class="n">${esc(plata(t.total))}</td></tr>
  </tbody></table>
  ${resumen.notas ? `<p class="nota">${esc(resumen.notas)}</p>` : ""}
  <div class="firmas"><div>Preparó${resumen.cargado_por_nombre ? `: ${esc(resumen.cargado_por_nombre)}` : ""}</div><div>Aprobó</div></div>
</body></html>`;
}

/** Abre el resumen en una pestaña nueva con el diálogo de impresión (ahí se elige "Guardar como PDF"). */
export function imprimirResumenPago(datos) {
  const ventana = window.open("", "_blank");
  if (!ventana) throw new Error("El navegador bloqueó la ventana. Permití las ventanas emergentes e intentá de nuevo.");
  ventana.document.write(htmlResumenPago(datos));
  ventana.document.close();
  ventana.focus();
  setTimeout(() => ventana.print(), 600);
}
