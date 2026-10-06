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

/**
 * Cuenta un intento contra la RPC `rpc_login_attempt` (contador atómico en la
 * base, global entre instancias de Vercel) y dice si se superó el máximo de la
 * ventana actual de 15 minutos. `clave` debe llevar un prefijo por endpoint
 * (p. ej. "recupero-ip:1.2.3.4") para no mezclar contadores.
 *
 * Fail-closed por defecto: si la base no responde, cuenta como excedido.
 *
 * @param {string} clave
 * @param {number} max - Intentos permitidos por ventana.
 * @param {{ failOpen?: boolean }} [opciones]
 * @returns {Promise<boolean>} true si hay que rechazar el pedido.
 */
export async function limiteExcedido(clave, max, { failOpen = false } = {}) {
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) return !failOpen;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/rpc_login_attempt`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_ip: clave, p_ventana: ventana15min() }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return !failOpen;
    const count = await res.json();
    return typeof count === "number" ? count > max : !failOpen;
  } catch {
    return !failOpen;
  }
}
