// app/lib/pin.js — Reglas del PIN de 4 números del operario (F4-06, D7).
//
// El PIN es un atajo para entrar rápido en planta; la contraseña sigue
// funcionando siempre. Por eso se limita a operarios (gestión entra con
// contraseña) y se bloquea unos minutos tras varios intentos fallidos.

export const MAX_INTENTOS_PIN = 5; // fallos seguidos antes de cada bloqueo
export const BLOQUEO_PIN_MIN = 15;
// Con 4 números hay 10.000 PIN posibles: tras 15 fallos seguidos el PIN se
// borra y hay que entrar con contraseña y crear otro (como mucho 15 intentos
// por PIN, en vez de 5 cada 15 minutos para siempre).
export const MAX_FALLOS_TOTALES_PIN = 15;

/**
 * ¿El PIN se puede usar? 4 dígitos, sin repetidos (1111) ni escaleras
 * (1234, 4321). Devuelve null si está bien o el motivo si no.
 */
export function problemaPin(pin) {
  if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) return "El PIN tiene que tener 4 números";
  if (/^(\d)\1{3}$/.test(pin)) return "Elegí un PIN que no repita el mismo número";
  const d = [...pin].map(Number);
  const paso = d[1] - d[0];
  if ((paso === 1 || paso === -1) && d.every((x, i) => i === 0 || x - d[i - 1] === paso)) {
    return "Elegí un PIN que no sea una escalera (como 1234)";
  }
  return null;
}

/** Minutos que faltan si el PIN está bloqueado, o 0 si se puede usar. */
export function minutosBloqueo(emp, ahora = Date.now()) {
  const hasta = emp?.pin_bloqueado_hasta ? Date.parse(emp.pin_bloqueado_hasta) : NaN;
  return Number.isFinite(hasta) && hasta > ahora ? Math.ceil((hasta - ahora) / 60000) : 0;
}

/**
 * Cambios a guardar tras un PIN incorrecto. pin_intentos cuenta los fallos
 * seguidos (se pone en 0 al acertar): cada MAX_INTENTOS_PIN se bloquea un rato
 * y al llegar a MAX_FALLOS_TOTALES_PIN se borra el PIN.
 * @returns {{ cambios: object, bloqueado: boolean, borrado: boolean, restantes: number }}
 */
export function registrarFalloPin(emp, ahora = Date.now()) {
  const intentos = (Number(emp?.pin_intentos) || 0) + 1;
  if (intentos >= MAX_FALLOS_TOTALES_PIN) {
    return { cambios: { pin_hash: null, pin_intentos: 0, pin_bloqueado_hasta: null }, bloqueado: false, borrado: true, restantes: 0 };
  }
  if (intentos % MAX_INTENTOS_PIN === 0) {
    return {
      cambios: { pin_intentos: intentos, pin_bloqueado_hasta: new Date(ahora + BLOQUEO_PIN_MIN * 60000).toISOString() },
      bloqueado: true,
      borrado: false,
      restantes: 0,
    };
  }
  return { cambios: { pin_intentos: intentos }, bloqueado: false, borrado: false, restantes: MAX_INTENTOS_PIN - (intentos % MAX_INTENTOS_PIN) };
}

// ─── En el navegador: recordar el legajo para el próximo ingreso con PIN ───
// No es un secreto (el legajo está impreso en el recibo); se guarda por empresa.
const CLAVE_LEGAJO = "gypi_legajo_pin";

export function recordarLegajoPin(slug, legajo) {
  if (!slug || !legajo) return;
  try {
    const todos = JSON.parse(localStorage.getItem(CLAVE_LEGAJO) || "{}");
    localStorage.setItem(CLAVE_LEGAJO, JSON.stringify({ ...todos, [slug]: String(legajo) }));
  } catch { /* sin almacenamiento: se ignora */ }
}

/** @returns {string} el legajo recordado para esa empresa, o "" */
export function legajoPinRecordado(slug) {
  try {
    const v = new Map(Object.entries(JSON.parse(localStorage.getItem(CLAVE_LEGAJO) || "{}"))).get(slug);
    return typeof v === "string" && /^\d{1,9}$/.test(v) ? v : "";
  } catch {
    return "";
  }
}
