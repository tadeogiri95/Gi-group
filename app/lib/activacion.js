// ═══════════════════════════════════════════════════════════
// app/lib/activacion.js — Códigos de activación de un solo uso
//
// Cada empleado nuevo nace "pendiente de activación" con un código
// aleatorio (p. ej. "K7P2-M9QX") que el admin le entrega en mano, por
// WhatsApp, por email o como QR. Con ese código el empleado define su
// contraseña en /{slug}/unirse. El código:
//   - se guarda solo como hash SHA-256 (nunca en texto plano),
//   - vence a los DIAS_VIGENCIA días,
//   - se borra al usarse (un solo uso).
// El admin puede generar uno nuevo para cualquier empleado: sirve también
// para recuperar el acceso de quien no tiene email.
//
// Auditoría: F2-03 (activación con slug + legajo), F4-01 (empleados sin
// email no podían entrar), F4-02 (link de invitación roto).
// ═══════════════════════════════════════════════════════════

import crypto from "crypto";

// Sin 0/O, 1/I/L para que se pueda dictar y copiar sin errores.
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const DIAS_VIGENCIA = 14;

export function generarCodigo() {
  const bytes = crypto.randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += ALFABETO[bytes[i] % ALFABETO.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Normaliza lo que tipea el usuario: mayúsculas, sin espacios ni guiones. */
export function normalizarCodigo(codigo) {
  return String(codigo || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashCodigo(codigo) {
  return crypto.createHash("sha256").update(normalizarCodigo(codigo)).digest("hex");
}

export function vencimiento(desde = new Date()) {
  return new Date(desde.getTime() + DIAS_VIGENCIA * 24 * 60 * 60 * 1000).toISOString();
}

export function linkActivacion(base, slug, codigo) {
  return `${base}/${slug}/unirse?code=${encodeURIComponent(codigo)}`;
}

/**
 * Datos listos para guardar en `empleados` y para mostrarle al admin.
 * @returns {{ codigo: string, columnas: { activacion_codigo_hash: string, activacion_expira: string } }}
 */
export function nuevaActivacion() {
  const codigo = generarCodigo();
  return {
    codigo,
    columnas: { activacion_codigo_hash: hashCodigo(codigo), activacion_expira: vencimiento() },
  };
}
