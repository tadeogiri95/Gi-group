// app/lib/pinServidor.js — Verificación del PIN en el servidor (F4-06, D7).
// La usan el ingreso con PIN (/api/login-empresa) y el kiosco
// (/api/kiosco/fichar). El límite de intentos por conexión lo aplica cada uno.
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { sbGet, sbPatch } from "./sbHelpers";
import { logger } from "./logger";
import { minutosBloqueo, registrarFalloPin, problemaPin } from "./pin";

/**
 * Busca al operario por legajo en la empresa y comprueba su PIN, con bloqueo
 * por intentos (ver lib/pin.js).
 * @param {{ empresaId: string, legajo: string|number, pin: string, alBloquear?: string }} p
 *   alBloquear: qué hacer si se bloquea (p. ej. "entrá con tu contraseña").
 * @returns {Promise<{ empleado: object } | { status: number, error: string }>}
 */
export async function verificarPin({ empresaId, legajo, pin, alBloquear = "pedile a administración un PIN nuevo" }) {
  const incorrecto = (extra = "") => ({ status: 401, error: "Legajo o PIN incorrectos." + extra });
  const empleados = await sbGet(`empleados?legajo=eq.${encodeURIComponent(String(legajo))}&activo=eq.true&empresa_id=eq.${empresaId}&select=*`);
  const candidatos = (empleados || []).filter((e) => e.rol === "operativo" && e.pin_hash);
  if (candidatos.length !== 1) return incorrecto();
  const emp = candidatos[0];

  const minutos = minutosBloqueo(emp);
  if (minutos > 0) {
    return { status: 429, error: `El PIN está bloqueado por demasiados intentos. Probá en ${minutos} min o ${alBloquear}.` };
  }

  if (!(await bcrypt.compare(pin, emp.pin_hash))) {
    const fallo = registrarFalloPin(emp);
    await sbPatch(`empleados?id=eq.${emp.id}`, fallo.cambios).catch((e) => logger.error("PIN: no se pudo registrar el intento", e));
    if (fallo.borrado) {
      return { status: 429, error: "Por seguridad borramos tu PIN después de muchos intentos fallidos. Pedile a administración uno nuevo." };
    }
    if (fallo.bloqueado) {
      return { status: 429, error: `PIN bloqueado por demasiados intentos. Esperá 15 min o ${alBloquear}.` };
    }
    return incorrecto(fallo.restantes <= 2 ? ` Te quedan ${fallo.restantes} intento${fallo.restantes === 1 ? "" : "s"}.` : "");
  }
  if (emp.pin_intentos || emp.pin_bloqueado_hasta) {
    await sbPatch(`empleados?id=eq.${emp.id}`, { pin_intentos: 0, pin_bloqueado_hasta: null }).catch(() => {});
  }
  return { empleado: emp };
}

/** PIN de 4 números al azar que cumple las reglas (sin repetidos ni escaleras). */
export function pinAleatorio() {
  for (;;) {
    const pin = String(randomInt(0, 10000)).padStart(4, "0");
    if (!problemaPin(pin)) return pin;
  }
}
