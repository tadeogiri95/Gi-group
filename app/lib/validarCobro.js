// app/lib/validarCobro.js — Chequeos del webhook de Mercado Pago (F2-11, ítem 25).
//
// El external_reference ("gypi-<empresa>-<suscripción>") lo arma Gypi, pero
// viaja por Mercado Pago: antes de activar un plan se confirma que la
// suscripción existe, es de esa empresa, corresponde a ese preapproval y que
// el monto cobrado es el acordado (el precio vigente o el ya avisado).

import { montoCobro } from "./plans";

const TOLERANCIA_ARS = 1;

/** Montos que Mercado Pago puede cobrar legítimamente por esta suscripción. */
export function montosEsperados(susc) {
  return [susc?.precio, susc?.precio_nuevo]
    .map((p) => montoCobro(p, susc?.periodo))
    .filter((m) => m > 0);
}

/**
 * ¿El monto coincide? Si la fila no trae el precio (consulta vieja), no se
 * puede comparar y no se bloquea; con el precio en 0 (prueba, manual) ningún
 * cobro corresponde.
 */
export function montoCoincide(susc, monto) {
  if (!susc || !("precio" in susc)) return true;
  const m = Number(monto);
  return Number.isFinite(m) && montosEsperados(susc).some((e) => Math.abs(e - m) <= TOLERANCIA_ARS);
}

/** { ok: true } o { ok: false, motivo } */
export function verificarSuscripcion(susc, { empresaId, preapprovalId } = {}) {
  if (!susc) return { ok: false, motivo: "suscripcion_inexistente" };
  if (susc.empresa_id && susc.empresa_id !== empresaId) return { ok: false, motivo: "empresa_no_coincide" };
  if (preapprovalId && susc.gateway_subscription_id && String(susc.gateway_subscription_id) !== String(preapprovalId)) {
    return { ok: false, motivo: "preapproval_no_coincide" };
  }
  return { ok: true };
}
