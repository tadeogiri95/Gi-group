// ═══════════════════════════════════════════════════════════
// Facturación electrónica ARCA (ex AFIP) — Factura C (monotributo)
//
// Kill-switch: sin AFIP_ACCESS_TOKEN configurada, emitirFacturaC() no
// hace ninguna llamada de red y retorna { ok:false, motivo:"no_configurado" }.
// Mismo patrón que app/components/AdSlot.jsx — agregar la env var es lo
// único que activa la feature, nunca rompe nada por omisión.
//
// Modo testing (AFIP_CERT/AFIP_KEY/AFIP_CUIT ausentes): usa el CUIT
// público de pruebas de ARCA (20409378472) — permite validar el flujo
// completo (createVoucher, CAE) sin certificado real.
// Modo producción: requiere AFIP_CUIT + AFIP_CERT + AFIP_KEY reales,
// generados en ARCA (Clave Fiscal nivel 3 → Administrador de Relaciones
// de Clave Fiscal → adherir al servicio "wsfe" → generar certificado).
//
// Paquete: @afipsdk/afip.js — desde la versión instalada, las llamadas
// pasan por el servidor de Afip SDK (no abre TLS directo contra ARCA
// desde este proceso), por eso pide también un AFIP_ACCESS_TOKEN propio
// (gratis, se consigue en https://app.afipsdk.com).
// ═══════════════════════════════════════════════════════════

import Afip from "@afipsdk/afip.js";
import { logger } from "./logger";

const CUIT_TESTING_PUBLICO = 20409378472;
const CBTE_TIPO_FACTURA_C = 11;
const CONCEPTO_SERVICIOS = 2;
const DOC_TIPO_CONSUMIDOR_FINAL = 99;

function yyyymmdd(fecha) {
  const d = fecha ? new Date(fecha) : new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return Number(`${y}${m}${day}`);
}

function getClienteAfip() {
  const accessToken = process.env.AFIP_ACCESS_TOKEN;
  if (!accessToken) return null;

  const cuit = process.env.AFIP_CUIT;
  const cert = process.env.AFIP_CERT;
  const key = process.env.AFIP_KEY;
  const modoProduccion = Boolean(cuit && cert && key);

  return new Afip({
    CUIT: modoProduccion ? Number(cuit) : CUIT_TESTING_PUBLICO,
    access_token: accessToken,
    ...(modoProduccion ? { cert, key, production: true } : {}),
  });
}

/**
 * Emite una Factura C (monotributo, sin IVA) por un pago ya aprobado.
 * Nunca tira excepción — siempre devuelve { ok, ... } para que el caller
 * (el webhook de MercadoPago) la use fire-and-forget sin arriesgar la
 * activación del plan si ARCA está caído o mal configurado.
 *
 * Nota: a montos altos, ARCA puede exigir identificar al comprador
 * (DNI/CUIT) en vez de "Consumidor Final" — el umbral se actualiza
 * periódicamente por resolución y no está hardcodeado acá. Si ARCA
 * rechaza por esto, el error de createVoucher lo va a indicar explícito
 * y queda guardado en pagos.factura_error.
 */
export async function emitirFacturaC({ monto, fechaPago, periodoInicio, periodoFin }) {
  const afip = getClienteAfip();
  if (!afip) return { ok: false, motivo: "no_configurado" };

  try {
    const ptoVta = Number(process.env.AFIP_PUNTO_VENTA) || 1;
    const cbteFch = yyyymmdd(fechaPago);
    const fchServDesde = yyyymmdd(periodoInicio || fechaPago);
    const fchServHasta = yyyymmdd(periodoFin || fechaPago);

    const ultimoNumero = await afip.ElectronicBilling.getLastVoucher(ptoVta, CBTE_TIPO_FACTURA_C);
    const numeroComprobante = ultimoNumero + 1;
    const importe = Math.round(Number(monto) * 100) / 100;

    const data = {
      CantReg: 1,
      PtoVta: ptoVta,
      CbteTipo: CBTE_TIPO_FACTURA_C,
      Concepto: CONCEPTO_SERVICIOS,
      DocTipo: DOC_TIPO_CONSUMIDOR_FINAL,
      DocNro: 0,
      CbteDesde: numeroComprobante,
      CbteHasta: numeroComprobante,
      CbteFch: cbteFch,
      ImpTotal: importe,
      ImpTotConc: 0,
      ImpNeto: importe,
      ImpOpEx: 0,
      ImpIVA: 0,
      ImpTrib: 0,
      FchServDesde: fchServDesde,
      FchServHasta: fchServHasta,
      FchVtoPago: fchServHasta,
      MonId: "PES",
      MonCotiz: 1,
    };

    const res = await afip.ElectronicBilling.createVoucher(data);

    return {
      ok: true,
      cae: res.CAE,
      caeVencimiento: res.CAEFchVto,
      numeroComprobante,
      puntoVenta: ptoVta,
      tipoComprobante: CBTE_TIPO_FACTURA_C,
    };
  } catch (err) {
    logger.error("[afip] Error emitiendo Factura C", err);
    return { ok: false, error: err?.message || "Error desconocido emitiendo factura" };
  }
}
