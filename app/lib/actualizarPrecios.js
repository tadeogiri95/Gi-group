// app/lib/actualizarPrecios.js — Precio en pesos de los planes en USD (D18, ítem 25).
//
// Una vez por día se compara el precio en pesos de cada suscripción con el
// que daría la cotización de hoy. Si se movió 5% o más, se avisa al dueño y
// el precio nuevo queda programado a 30 días (lo que prometen los términos);
// cumplido el plazo, se cambia el monto del preapproval en Mercado Pago.

import { aPesos } from "./plans";

export const DIAS_AVISO = 30;
export const UMBRAL_CAMBIO = 0.05;

/**
 * Qué hacer hoy con una suscripción:
 *  - { accion: "aplicar", precio }        vence el aviso: cobrar el precio nuevo
 *  - { accion: "esperar" }                 hay un cambio avisado que todavía no rige
 *  - { accion: "avisar", precio, desde }   el dólar se movió: avisar y programar
 *  - { accion: "nada" }
 */
export function decidirPrecio(susc, cotizacion, ahora = new Date()) {
  if (!susc || susc.precio_usd == null) return { accion: "nada" };
  if (susc.precio_nuevo != null && susc.precio_nuevo_desde) {
    return new Date(susc.precio_nuevo_desde) <= ahora
      ? { accion: "aplicar", precio: Number(susc.precio_nuevo) }
      : { accion: "esperar" };
  }
  const actual = Number(susc.precio);
  const nuevo = aPesos(Number(susc.precio_usd), cotizacion);
  if (!nuevo || !(actual > 0)) return { accion: "nada" };
  if (Math.abs(nuevo - actual) / actual < UMBRAL_CAMBIO) return { accion: "nada" };
  return { accion: "avisar", precio: nuevo, desde: new Date(ahora.getTime() + DIAS_AVISO * 86400000).toISOString() };
}
