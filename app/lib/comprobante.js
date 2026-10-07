// app/lib/comprobante.js — Factura C descargable con el QR de ARCA
// (F6-11, ítem 26). La página se imprime o se guarda como PDF desde el navegador.
import { svgQR } from "./tarjetasQR";
import { CONDICIONES_IVA, formatearCuit, limpiarCuit, cuitValido } from "./perfilFiscal";

const ESCAPES = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]]);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES.get(c));

/** Datos del emisor (Gypi) desde variables de entorno; no son secretos. */
export function emisorDesdeEnv(env = process.env) {
  return {
    razonSocial: env.AFIP_RAZON_SOCIAL || "",
    cuit: limpiarCuit(env.AFIP_CUIT),
    domicilio: env.AFIP_DOMICILIO || "",
    inicioActividades: env.AFIP_INICIO_ACTIVIDADES || "",
    iibb: env.AFIP_IIBB || "",
  };
}

const fecha = (d) => {
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? "" : x.toISOString().slice(0, 10);
};

/**
 * Link del QR que exige ARCA (RG 4892): https://www.afip.gob.ar/fe/qr/?p=<JSON en base64>
 */
export function urlQrArca({ emisorCuit, pago }) {
  const receptorCuit = limpiarCuit(pago.receptor?.cuit);
  const conCuit = cuitValido(receptorCuit);
  const datos = {
    ver: 1,
    fecha: fecha(pago.fecha_pago),
    cuit: Number(emisorCuit),
    ptoVta: Number(pago.punto_venta),
    tipoCmp: Number(pago.tipo_comprobante || 11),
    nroCmp: Number(pago.numero_comprobante),
    importe: Number(pago.monto),
    moneda: "PES",
    ctz: 1,
    tipoDocRec: conCuit ? 80 : 99,
    nroDocRec: conCuit ? Number(receptorCuit) : 0,
    tipoCodAut: "E",
    codAut: Number(pago.cae),
  };
  return `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(datos)).toString("base64")}`;
}

const pad = (n, largo) => String(n ?? "").padStart(largo, "0");
const pesos = (n) => Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** HTML del comprobante. `pago` es la fila de pagos con CAE. */
export async function htmlComprobante({ pago, emisor, plan, periodo }) {
  const qr = await svgQR(urlQrArca({ emisorCuit: emisor.cuit, pago }));
  const r = pago.receptor || {};
  const receptorCuit = cuitValido(r.cuit) ? formatearCuit(r.cuit) : "";
  const fila = (k, v) => `<div><span>${esc(k)}</span> ${esc(v || "—")}</div>`;
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Factura C ${pad(pago.punto_venta, 5)}-${pad(pago.numero_comprobante, 8)}</title>
<style>
  body{font-family:system-ui,sans-serif;color:#111;max-width:760px;margin:24px auto;padding:0 16px;font-size:13px}
  .caja{border:1px solid #333;padding:12px;margin-bottom:10px}
  .cab{display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:start}
  .letra{border:2px solid #111;font-size:32px;font-weight:800;width:56px;text-align:center;line-height:1.2}
  .letra small{display:block;font-size:10px;font-weight:600}
  h1{font-size:18px;margin:0 0 6px} span{color:#555}
  table{width:100%;border-collapse:collapse} th,td{border-bottom:1px solid #ccc;padding:6px;text-align:left} td.n,th.n{text-align:right}
  .total{font-size:16px;font-weight:800;text-align:right;margin-top:8px}
  .pie{display:flex;gap:16px;align-items:center} .pie svg{width:120px;height:120px}
  .ayuda{color:#777;font-size:11px;margin-top:14px} @media print{.ayuda{display:none}}
</style></head><body>
<div class="caja cab">
  <div><h1>${esc(emisor.razonSocial || "[Configurar AFIP_RAZON_SOCIAL]")}</h1>
    ${fila("Domicilio:", emisor.domicilio)}${fila("Condición frente al IVA:", "Responsable Monotributo")}</div>
  <div class="letra">C<small>COD. 011</small></div>
  <div><h1>FACTURA</h1>
    ${fila("Punto de venta:", pad(pago.punto_venta, 5))}${fila("Comp. Nro:", pad(pago.numero_comprobante, 8))}
    ${fila("Fecha de emisión:", fecha(pago.fecha_pago).split("-").reverse().join("/"))}
    ${fila("CUIT:", formatearCuit(emisor.cuit))}${fila("Ingresos Brutos:", emisor.iibb)}${fila("Inicio de actividades:", emisor.inicioActividades)}</div>
</div>
<div class="caja">
  ${fila("Período facturado:", periodo || "")}
  ${fila("Razón social:", r.razon_social || "Consumidor Final")}
  ${fila("CUIT:", receptorCuit)}
  ${fila("Condición frente al IVA:", CONDICIONES_IVA[r.condicion_iva]?.nombre || "Consumidor Final")}
  ${fila("Domicilio:", r.domicilio_fiscal)}
</div>
<table><thead><tr><th>Descripción</th><th class="n">Importe</th></tr></thead>
<tbody><tr><td>Suscripción Gypi${plan ? ` — Plan ${esc(plan)}` : ""}</td><td class="n">$ ${pesos(pago.monto)}</td></tr></tbody></table>
<div class="total">Total: $ ${pesos(pago.monto)}</div>
<div class="caja pie" style="margin-top:14px">${qr}
  <div>${fila("CAE N°:", pago.cae)}${fila("Vencimiento del CAE:", fecha(pago.cae_vencimiento).split("-").reverse().join("/"))}
  <div style="margin-top:6px">Comprobante autorizado por ARCA</div></div></div>
<p class="ayuda">Para guardarla en PDF: menú del navegador → Imprimir → "Guardar como PDF".</p>
</body></html>`;
}
