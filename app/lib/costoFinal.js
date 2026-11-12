// app/lib/costoFinal.js — Costo final de la OT al cerrarse, con constancia
// (costo de OT, parte C; migración 167; diseño en notes/diseno-costo-ot.md).
//
//   Costo final = costo de materiales + costo de la hora × horas-persona
//
// Desde el 12/11 (auditoría, parte 3) es el costo real: suma también lo
// retirado de más, las compras sin stock para la OT, el retrabajo, la
// instalación y los gastos de Finanzas con la OT, y guarda el previsto al
// lado (detalle.comparativa; app/lib/costoReal.js).
//
// Materiales: el total de los renglones (precio fijo de cada artículo en la OT,
// app/lib/costoMateriales.js). Horas-persona: las reales del total de la tabla
// de horas (automáticas o a mano, app/lib/horasOt.js). Costo de la hora: el de
// Costos (costos_empresa, migración 102). La constancia guarda la foto de todo
// lo usado; si después cambia un precio o una hora, la constancia no cambia.

import { resumenReal } from "./costoReal";

const r2 = (n) => Math.round(n * 100) / 100;
const r1 = (n) => Math.round(n * 10) / 10;
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export const MOTIVOS_COSTO = {
  cierre: "Al cerrarse la OT",
  manual: "Calculado a mano",
  recalculo: "Vuelto a calcular",
};

/**
 * Arma la constancia del costo final.
 * @param {{ materiales: { fecha_ot?, filas: object[], total: number, sinPrecio: number }, horas: { filas: object[], total: object } | null, costoHora: number|null, real?: { comparativa, extras } | null }} d
 *   real: el previsto contra real (costosRealesDeOts); sin él, solo materiales del MRP + horas de planta
 * @returns {{ materiales, sin_precio, horas_persona, costo_hora, mano_obra, total, detalle }}
 */
export function armarConstancia({ materiales, horas = null, costoHora = null, real = null }) {
  const totalMat = r2(num(materiales?.total) || 0);
  const sinPrecio = Number(materiales?.sinPrecio) || 0;
  const horasPersona = num(horas?.total?.reales?.valor);
  const ch = num(costoHora);
  const manoObra = ch != null && horasPersona != null ? r2(ch * horasPersona) : null;
  const avisos = [];
  if (sinPrecio) avisos.push(sinPrecio === 1 ? "1 artículo sin precio (no suma)" : `${sinPrecio} artículos sin precio (no suman)`);
  if (!materiales?.filas?.length) avisos.push("La OT no tiene materiales en la hoja de necesidades");
  if (horasPersona == null) avisos.push("Sin horas-persona reales");
  if (ch == null) avisos.push("Sin costo de la hora cargado en Costos");
  const lado = (l) => (l ? { valor: num(l.valor), aMano: !!l.aMano } : null);
  const c = real?.comparativa || null;
  const x = real?.extras || {};
  const resumen = c ? resumenReal(c) : null;
  if (c) for (const a of c.avisos) if (!avisos.includes(a) && !/sin precio|Sin costo de la hora|Sin horas reales/.test(a)) avisos.push(a);
  return {
    materiales: resumen ? resumen.materiales : totalMat,
    sin_precio: sinPrecio + (x.fuera?.sinPrecio || 0) + (x.compras?.sinPrecio || 0),
    horas_persona: horasPersona != null ? r1(horasPersona) : null,
    costo_hora: ch,
    mano_obra: resumen ? resumen.mano_obra : manoObra,
    total: resumen ? resumen.total : r2(totalMat + (manoObra || 0)),
    detalle: {
      ...(c ? {
        comparativa: { renglones: c.renglones, previsto: c.previsto, real: c.real, diferencia: c.diferencia, pct: c.pct },
        fuera: x.fuera?.filas || [], compras: x.compras?.filas || [], gastos: x.gastos?.filas || [],
        retrabajo_horas: x.retrabajo || 0, instalacion: x.instalacion || null,
      } : {}),
      fecha_ot: materiales?.fecha_ot || null,
      renglones: (materiales?.filas || []).map((f) => ({
        sku: f.sku, nombre: f.nombre || null, unidad: f.unidad || null, cantidad: f.cantidad,
        precio: f.precio ?? null, moneda: f.moneda || null, precio_moneda: f.precioMoneda ?? null, tipo_cambio: f.tipoCambio ?? null,
        fecha: f.fecha || null, origen: f.origen || null, proveedor: f.proveedor || null, comprobante: f.comprobante || null,
        subtotal: f.subtotal ?? null,
      })),
      horas: [...(horas?.filas || []), ...(horas?.total ? [horas.total] : [])].map((f) => ({
        etapa: f.etapa, nombre: f.nombre, presupuestadas: lado(f.presupuestadas), reales: lado(f.reales),
      })),
      costo_hora: ch,
      avisos,
    },
  };
}

/** Lo que se guarda en costos_finales_ot al calcular. */
export function filaCalculada(constancia, { nombre = null, ahora = new Date() } = {}) {
  return {
    estado: "calculado",
    calculado_at: ahora.toISOString(),
    calculado_por_nombre: nombre ? String(nombre).slice(0, 120) : null,
    ...constancia,
  };
}

/** De las filas de la OT (más nueva primero): la vigente, la pendiente y el historial. */
export function separarCostos(filas = []) {
  const vigente = filas.find((f) => f.estado === "calculado") || null;
  const pendiente = filas.find((f) => f.estado === "pendiente") || null;
  const historial = filas.filter((f) => f.estado === "anulado");
  return { vigente, pendiente, historial };
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pesos = (n) => (n === null || n === undefined ? "—" : `$ ${Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const horasTxt = (h) => (h === null || h === undefined ? "—" : `${Number(h).toLocaleString("es-AR", { maximumFractionDigits: 1 })} h`);
const fechaHora = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const fechaCorta = (f) => (f ? String(f).split("-").reverse().join("/") : "");
const ORIGEN = { mrp: "Planilla MRP", oc: "Factura de OC", factura: "Factura suelta" };

/** Hoja imprimible de la constancia (de ahí se guarda como PDF). */
export function htmlConstancia({ costo, otTexto = "", empresa = "" }) {
  const d = costo?.detalle || {};
  const renglones = d.renglones || [];
  const horas = d.horas || [];
  const cmp = d.comparativa || null;
  const extra = (titulo, filas, cols) => (filas?.length ? `<h2>${esc(titulo)} (${filas.length})</h2><table>${cols(filas)}</table>` : "");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Costo final ${esc(otTexto)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:14mm}
  h1{font-size:18px;margin:0 0 2px} h2{font-size:14px;margin:16px 0 6px}
  .dim{color:#555} table{border-collapse:collapse;width:100%} td,th{border:1px solid #ccc;padding:4px 6px;text-align:left}
  th{background:#f2f2f2} .n{text-align:right;white-space:nowrap} .tot td{font-weight:bold;background:#fafafa}
  .rojo{color:#b00020} .resumen td{font-size:13px}
</style></head><body>
  <h1>Constancia de costo final · ${esc(otTexto)}</h1>
  <div class="dim">${esc(empresa)}${empresa ? " · " : ""}${esc(MOTIVOS_COSTO[costo?.motivo] || "")} · cerrada el ${esc(fechaHora(costo?.cerrada_at))} · calculado el ${esc(fechaHora(costo?.calculado_at))}${costo?.calculado_por_nombre ? ` por ${esc(costo.calculado_por_nombre)}` : ""}</div>
  <div class="dim">Fecha de carga de la OT (para elegir los precios): ${esc(fechaCorta(d.fecha_ot) || "sin fecha")}</div>
  <h2>Resumen</h2>
  ${cmp ? `<table class="resumen">
    <tr><th>Concepto</th><th class="n">Previsto</th><th class="n">Real</th><th class="n">Diferencia</th></tr>
    ${cmp.renglones.map((f) => `<tr><td>${esc(f.nombre)}${f.horasReales != null && f.id !== "materiales" ? `<br><span class="dim">${f.horasPrevistas != null ? `${horasTxt(f.horasPrevistas)} previstas · ` : ""}${horasTxt(f.horasReales)} reales</span>` : ""}</td><td class="n">${pesos(f.previsto)}</td><td class="n">${pesos(f.real)}</td><td class="n${f.diferencia > 0 ? " rojo" : ""}">${f.diferencia ? `${f.diferencia > 0 ? "+" : ""}${pesos(f.diferencia)}` : "—"}</td></tr>`).join("")}
    <tr class="tot"><td>Costo final</td><td class="n">${pesos(cmp.previsto)}</td><td class="n">${pesos(cmp.real)}</td><td class="n${cmp.diferencia > 0 ? " rojo" : ""}">${cmp.diferencia ? `${cmp.diferencia > 0 ? "+" : ""}${pesos(cmp.diferencia)}${cmp.pct != null ? ` (${cmp.pct} %)` : ""}` : "—"}</td></tr>
  </table>
  <div class="dim">Costo de la hora: ${pesos(costo?.costo_hora)}. Instalación: 8 h por persona por día.</div>` : `<table class="resumen">
    <tr><td>Materiales</td><td class="n">${pesos(costo?.materiales)}</td></tr>
    <tr><td>Mano de obra: ${horasTxt(costo?.horas_persona)} × ${pesos(costo?.costo_hora)} la hora</td><td class="n">${pesos(costo?.mano_obra)}</td></tr>
    <tr class="tot"><td>Costo final</td><td class="n">${pesos(costo?.total)}</td></tr>
  </table>`}
  ${(d.avisos || []).length ? `<p class="rojo">${d.avisos.map(esc).join(" · ")}</p>` : ""}
  <h2>Horas-persona</h2>
  <table><tr><th>Proceso</th><th class="n">Presupuestadas</th><th class="n">Reales</th></tr>
  ${horas.map((h) => `<tr${h.etapa === "total" ? ' class="tot"' : ""}><td>${esc(h.nombre)}</td><td class="n">${horasTxt(h.presupuestadas?.valor)}${h.presupuestadas?.aMano ? " (a mano)" : ""}</td><td class="n">${horasTxt(h.reales?.valor)}${h.reales?.aMano ? " (a mano)" : ""}</td></tr>`).join("")}
  </table>
  <h2>Materiales (${renglones.length})</h2>
  <table><tr><th>Artículo</th><th class="n">Cantidad</th><th class="n">Precio sin IVA</th><th>Fecha y origen del precio</th><th class="n">Subtotal</th></tr>
  ${renglones.map((r) => `<tr${r.precio == null ? ' class="rojo"' : ""}><td>${esc(r.nombre || r.sku)}<br><span class="dim">${esc(r.sku)}</span></td><td class="n">${esc(Number(r.cantidad).toLocaleString("es-AR", { maximumFractionDigits: 3 }))} ${esc(r.unidad || "")}</td><td class="n">${r.precio == null ? "sin precio" : pesos(r.precio)}${r.moneda === "USD" && r.precio_moneda != null ? `<br><span class="dim">US$ ${esc(Number(r.precio_moneda).toLocaleString("es-AR"))} × ${esc(r.tipo_cambio)}</span>` : ""}</td><td>${esc(fechaCorta(r.fecha))} ${esc(ORIGEN[r.origen] || "")}${r.proveedor ? ` · ${esc(r.proveedor)}` : ""}${r.comprobante ? ` · ${esc(r.comprobante)}` : ""}</td><td class="n">${r.subtotal == null ? "—" : pesos(r.subtotal)}</td></tr>`).join("")}
  <tr class="tot"><td colspan="4">Total materiales del MRP</td><td class="n">${pesos(cmp ? cmp.renglones.find((f) => f.id === "materiales")?.real : costo?.materiales)}</td></tr>
  </table>
  ${extra("Retirado de más o fuera del MRP", d.fuera, (fs) => `<tr><th>Artículo</th><th class="n">MRP</th><th class="n">Retirado</th><th class="n">De más</th><th class="n">Subtotal</th></tr>${fs.map((r) => `<tr${r.precio == null ? ' class="rojo"' : ""}><td>${esc(r.nombre || r.sku)}<br><span class="dim">${esc(r.sku)}</span></td><td class="n">${esc(r.necesario)}</td><td class="n">${esc(r.retirado)}</td><td class="n">${esc(r.cantidad)} ${esc(r.unidad || "")}</td><td class="n">${r.subtotal == null ? "sin precio" : pesos(r.subtotal)}</td></tr>`).join("")}`)}
  ${extra("Compras para la OT sin stock", d.compras, (fs) => `<tr><th>Renglón</th><th>OC</th><th class="n">Cantidad</th><th class="n">Precio sin IVA</th><th class="n">Subtotal</th></tr>${fs.map((r) => `<tr${r.precio == null ? ' class="rojo"' : ""}><td>${esc(r.descripcion)}</td><td>N° ${esc(r.oc_numero ?? "")}${r.proveedor ? ` · ${esc(r.proveedor)}` : ""}</td><td class="n">${esc(r.cantidad)} ${esc(r.unidad || "")}</td><td class="n">${r.precio == null ? "sin precio" : pesos(r.precio)}</td><td class="n">${r.subtotal == null ? "—" : pesos(r.subtotal)}</td></tr>`).join("")}`)}
  ${extra("Gastos de Finanzas con esta OT", d.gastos, (fs) => `<tr><th>Fecha</th><th>Gasto</th><th class="n">Neto sin IVA</th></tr>${fs.map((r) => `<tr><td>${esc(fechaCorta(r.fecha))}</td><td>${esc(r.descripcion || r.tipo)}${r.entidad ? ` · ${esc(r.entidad)}` : ""}${r.paraRevisar ? " (para revisar)" : ""}</td><td class="n">${pesos(r.importe)}</td></tr>`).join("")}`)}
</body></html>`;
}

/** Abre la constancia en una pestaña nueva con el diálogo de impresión. */
export function imprimirConstancia(datos) {
  const ventana = window.open("", "_blank");
  if (!ventana) throw new Error("El navegador bloqueó la ventana. Permití las ventanas emergentes e intentá de nuevo.");
  ventana.document.write(htmlConstancia(datos));
  ventana.document.close();
  ventana.focus();
  setTimeout(() => ventana.print(), 300);
}
