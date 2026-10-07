// app/lib/tarjetasQR.js — Tarjetas con QR para imprimir (ítem 18 del plan, D7).
//
// - QR de activación: el link con el código de un solo uso (/{slug}/unirse?code=…).
//   El empleado lo escanea y crea su contraseña, sin tipear nada.
// - QR personal: /{slug}?legajo=N. Abre el ingreso con PIN y el legajo ya
//   cargado. No es un secreto (el legajo figura en el recibo): sin el PIN no
//   sirve para entrar.
import QRCode from "qrcode";

export function linkPersonal(origen, slug, legajo) {
  return `${String(origen).replace(/\/$/, "")}/${encodeURIComponent(slug)}?legajo=${encodeURIComponent(String(legajo))}`;
}

const ESCAPES = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES.get(c));

/** SVG del QR (texto). */
export function svgQR(texto) {
  return QRCode.toString(texto, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}

/**
 * Página HTML lista para imprimir, con una tarjeta por persona.
 * @param {{ titulo: string, empresa: string, tarjetas: { nombre: string, detalle?: string, link: string, pie: string }[] }} datos
 */
export async function htmlTarjetas({ titulo, empresa, tarjetas }) {
  const qrs = await Promise.all(tarjetas.map((t) => svgQR(t.link)));
  const items = tarjetas.map((t, i) => `
    <div class="tarjeta">
      <div class="empresa">${esc(empresa)}</div>
      <div class="qr">${qrs[i]}</div>
      <div class="nombre">${esc(t.nombre)}</div>
      ${t.detalle ? `<div class="detalle">${esc(t.detalle)}</div>` : ""}
      <div class="pie">${esc(t.pie)}</div>
    </div>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 12mm; color: #111; }
  h1 { font-size: 16px; margin: 0 0 8mm; }
  .grilla { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; }
  .tarjeta { border: 1px dashed #999; border-radius: 4mm; padding: 5mm; text-align: center; break-inside: avoid; }
  .empresa { font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: .05em; }
  .qr svg { width: 38mm; height: 38mm; }
  .nombre { font-weight: 700; font-size: 14px; margin-top: 2mm; }
  .detalle { font-family: monospace; font-size: 13px; margin-top: 1mm; }
  .pie { font-size: 10px; color: #444; margin-top: 2mm; }
  @media print { h1 { display: none; } body { margin: 8mm; } }
</style></head><body>
<h1>${esc(titulo)} — imprimí esta página y recortá las tarjetas</h1>
<div class="grilla">${items}</div>
</body></html>`;
}

/** Abre las tarjetas en una pestaña nueva y abre el diálogo de impresión. */
export async function imprimirTarjetas(datos) {
  const ventana = window.open("", "_blank");
  if (!ventana) throw new Error("El navegador bloqueó la ventana. Permití las ventanas emergentes e intentá de nuevo.");
  ventana.document.write(await htmlTarjetas(datos));
  ventana.document.close();
  ventana.focus();
  setTimeout(() => ventana.print(), 300);
}
