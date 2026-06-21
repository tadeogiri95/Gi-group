// ═══════════════════════════════════════════════════════════
// app/lib/rateLimit.js — Helpers de rate limiting
//
// Antes esta función estaba duplicada inline en login-empresa,
// registro-empresa y superadmin/auth. Centralizada para una única
// fuente de verdad y para poder testearla (tests/rate-limit.test.js).
// ═══════════════════════════════════════════════════════════

/**
 * Calcula la ventana de 15 minutos a la que pertenece una fecha, en el
 * formato usado por la RPC `rpc_login_attempt` ("YYYY-MM-DDTHH:mm").
 *
 * @param {Date} [fecha] - Por defecto, ahora.
 * @returns {string}
 */
export function ventana15min(fecha = new Date()) {
  const mins = Math.floor(fecha.getUTCMinutes() / 15) * 15;
  return `${fecha.toISOString().slice(0, 13)}:${String(mins).padStart(2, "0")}`;
}

/**
 * Valida el formato básico de un email (sin verificar existencia real).
 * Replicada antes en import-csv y en tests.
 *
 * @param {string} email
 * @returns {boolean}
 */
export function validarFormatoEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
