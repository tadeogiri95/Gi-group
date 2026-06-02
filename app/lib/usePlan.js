// ═══════════════════════════════════════════════════════════
// Hook y helpers frontend para chequear plan/features
// ═══════════════════════════════════════════════════════════

import { PLANES } from "./plans";

/**
 * Devuelve info del plan actual basado en empresa.plan_activo
 */
export function infoPlan(empresa) {
  const plan = empresa?.plan_activo || "free";
  return PLANES[plan] || PLANES.free;
}

/**
 * ¿La empresa puede acceder a este módulo/feature?
 * Usage: puedeAcceder(empresa, "exportar_pdf")
 *        puedeAcceder(empresa, "modulo:calendario")
 */
export function puedeAcceder(empresa, feature) {
  const p = infoPlan(empresa);
  if (feature.startsWith("modulo:")) {
    const mod = feature.slice(7);
    return (p.modulos || []).includes(mod);
  }
  const v = p[feature];
  return v === true || typeof v === "string" || (typeof v === "number" && v > 0);
}

/**
 * ¿Cuánto del límite ya consumió la empresa?
 * Usage: porcentajeUso(empresa, "max_empleados", cantidadActual)
 */
export function porcentajeUso(empresa, campo, actual) {
  const limite = infoPlan(empresa)[campo] || 0;
  if (limite === 0) return 100;
  return Math.min(100, Math.round((actual / limite) * 100));
}

/**
 * Plan sugerido para upgrade desde el actual
 */
export function siguientePlan(empresa) {
  const actual = empresa?.plan_activo || "free";
  if (actual === "free") return "starter";
  if (actual === "starter") return "pro";
  if (actual === "pro") return "enterprise";
  return "enterprise";
}