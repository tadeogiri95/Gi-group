// app/lib/logisticaRemito.js — La hoja del remito de una parada (Logística,
// parte 4; migración 206): sin precios, con lo entregado, las fotos y la
// firma. La usan la página pública /remito/<token> y el PDF (pdfDeHtml).
import { accionParada, estadoParada, numeroRemito, tipoViaje } from "./logistica";

const ESCAPES = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES.get(c));
const urlSegura = (u) => (typeof u === "string" && /^https:\/\//.test(u) ? u : null);
const cant = (n) => String(Math.round(Number(n || 0) * 100) / 100).replace(".", ",");

/** Fecha y hora en Argentina: "24/11/2026 12:35". */
export function fechaHora(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" }).replace(",", "");
}

/**
 * Los datos de la hoja, ya armados (los usan la página y el PDF).
 * @param {{ empresa: { nombre: string }, viaje: object, parada: object, origen?: object, chofer?: string, vehiculo?: string }} d
 */
export function filasRemito({ viaje = {}, parada = {}, origen = null, chofer = "", vehiculo = "" } = {}) {
  const retiro = parada.accion === "retirar";
  return [
    ["Fecha", fechaHora(parada.hecha_at) || String(viaje.fecha || "").split("-").reverse().join("/")],
    [retiro ? "Retiro en" : "Entrega en", [parada.nombre, parada.direccion].filter(Boolean).join(" · ")],
    ["Cliente", parada.cliente],
    ["OT", parada.ots?.length ? parada.ots.join(", ") : ""],
    ["Sale de", origen ? [origen.nombre, origen.direccion].filter(Boolean).join(" · ") : ""],
    ["Viaje", viaje.numero ? `N° ${viaje.numero} · ${tipoViaje(viaje.tipo).label} · ${accionParada(parada.accion).label}` : ""],
    ["Chofer", chofer],
    ["Vehículo", vehiculo],
    ["Remito oficial", parada.remito_oficial],
    ["COT", parada.cot],
  ].filter(([, v]) => v);
}

/** La hoja del remito lista para pasar a PDF (A4). */
export function htmlRemito(d) {
  const { empresa = {}, parada = {} } = d;
  const est = estadoParada(parada.estado, parada.accion);
  const rs = Array.isArray(parada.renglones) ? parada.renglones : [];
  const fotos = (parada.fotos || []).map(urlSegura).filter(Boolean);
  const firma = urlSegura(parada.firma_url);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Remito ${esc(numeroRemito(parada.remito_numero))}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 4px; font-family: system-ui, sans-serif; color: #000; font-size: 11pt; background: #fff; }
  .cabecera { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 8px; }
  .empresa { font-size: 15pt; font-weight: 700; }
  .num { text-align: right; }
  .num b { font-size: 15pt; display: block; }
  .chico { font-size: 9pt; color: #444; }
  table { border-collapse: collapse; width: 100%; }
  td, th { padding: 4px 6px; vertical-align: top; text-align: left; }
  td.k { width: 120px; font-weight: 700; }
  .renglones th { border-bottom: 1px solid #000; font-size: 10pt; }
  .renglones td { border-bottom: 1px solid #ddd; }
  .renglones td.n { text-align: right; white-space: nowrap; }
  h2 { font-size: 12pt; margin: 12px 0 4px; }
  .fotos img { width: 120px; height: 90px; object-fit: cover; margin: 0 6px 6px 0; border: 1px solid #ccc; }
  .firma img { max-width: 260px; max-height: 110px; display: block; }
  .linea { border-top: 1px solid #000; padding-top: 3px; font-size: 9pt; width: 260px; }
</style></head><body>
  <section class="cabecera">
    <div><div class="empresa">${esc(empresa.nombre)}</div><div class="chico">Remito interno · sin valor fiscal</div></div>
    <div class="num"><b>Remito N° ${esc(numeroRemito(parada.remito_numero))}</b><span class="chico">${esc(est.emoji)} ${esc(est.label)}</span></div>
  </section>
  <section><table>${filasRemito(d).map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table></section>
  <section>
    <h2>${parada.accion === "retirar" ? "Lo retirado" : "Lo entregado"}</h2>
    ${rs.length
      ? `<table class="renglones"><tr><th>Detalle</th><th style="text-align:right">Cantidad</th></tr>${rs.map((r) => `<tr><td>${esc(r.texto)}</td><td class="n">${Number(r.hecha) >= Number(r.cantidad) ? cant(r.cantidad) : `${cant(r.hecha)} de ${cant(r.cantidad)}`}</td></tr>`).join("")}</table>`
      : `<div>Sin detalle.</div>`}
    ${parada.motivo ? `<p><b>Observación:</b> ${esc(parada.motivo)}</p>` : ""}
  </section>
  ${fotos.length ? `<section class="fotos"><h2>Fotos</h2>${fotos.map((u, i) => `<img src="${esc(u)}" alt="Foto ${i + 1}" crossorigin="anonymous">`).join("")}</section>` : ""}
  <section class="firma">
    <h2>Recibió</h2>
    ${firma ? `<img src="${esc(firma)}" alt="Firma" crossorigin="anonymous">` : `<div style="height:70px"></div>`}
    <div class="linea">${firma ? esc([parada.firma_nombre, parada.firma_dni && `DNI ${parada.firma_dni}`].filter(Boolean).join(" · ") || "Firma") : "Firma, aclaración y DNI"}${parada.firmada_link_at ? ` · firmó desde el link el ${esc(fechaHora(parada.firmada_link_at))}` : ""}</div>
  </section>
</body></html>`;
}
