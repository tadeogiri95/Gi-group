// app/lib/qrClienteOt.js — QR del link de la OT para el cliente (04/11):
// imagen para la pantalla, mensaje de WhatsApp y hoja para imprimir (una hoja
// A4 con el QR grande y la OT completa). El link lo arma el servidor
// (/api/proyectos/link-cliente); acá solo se dibuja.
import QRCode from "qrcode";

const ESCAPES = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES.get(c));

/** Imagen (data URL PNG) del QR para mostrar en la pantalla. */
export function imagenQr(url) {
  return QRCode.toDataURL(url, { margin: 1, width: 480, errorCorrectionLevel: "M" });
}

/** Mensaje para mandarle al cliente por WhatsApp. */
export function mensajeCliente({ empresa, textoOt, url }) {
  return `Hola! Desde ${empresa || "acá"} te compartimos el seguimiento de tu proyecto (${textoOt}). Ahí vas a ver cómo va la fabricación y la instalación, y el plano: ${url}`;
}

/** Hoja para imprimir con el QR. */
export async function htmlQrCliente({ empresa, textoOt, url }) {
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>QR para el cliente — ${esc(textoOt)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  body { font-family: system-ui, sans-serif; color: #111; text-align: center; margin: 0; }
  .empresa { font-size: 14px; text-transform: uppercase; letter-spacing: .06em; color: #555; margin-top: 10mm; }
  h1 { font-size: 26px; margin: 6mm 0 2mm; }
  .ot { font-size: 18px; margin: 0 0 8mm; }
  .qr svg { width: 110mm; height: 110mm; }
  .pie { font-size: 15px; margin-top: 8mm; }
</style></head><body>
<div class="empresa">${esc(empresa)}</div>
<h1>Seguí el avance de tu proyecto</h1>
<p class="ot">${esc(textoOt)}</p>
<div class="qr">${svg}</div>
<p class="pie">Escaneá el código con la cámara del celular.</p>
</body></html>`;
}

/** Abre la hoja en una pestaña nueva con el diálogo de impresión. */
export async function imprimirQrCliente(datos) {
  const ventana = window.open("", "_blank");
  if (!ventana) throw new Error("El navegador bloqueó la ventana. Permití las ventanas emergentes e intentá de nuevo.");
  ventana.document.write(await htmlQrCliente(datos));
  ventana.document.close();
  ventana.focus();
  setTimeout(() => ventana.print(), 300);
}
