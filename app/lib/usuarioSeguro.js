// app/lib/usuarioSeguro.js — Datos del empleado que se pueden mandar al
// navegador (login y /api/me): sin contraseña ni secretos de activación.
const CAMPOS_PRIVADOS = new Set(["password", "password_reset_jti", "activacion_codigo_hash", "activacion_expira", "pin_hash", "pin_intentos", "pin_bloqueado_hasta"]);

export function usuarioSeguro(emp) {
  return Object.fromEntries(Object.entries(emp || {}).filter(([c]) => !CAMPOS_PRIVADOS.has(c)));
}
