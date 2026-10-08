// app/lib/vibrar.js — Respuesta física al tocar (reforma UX R7): con guantes y
// ruido de planta, una vibración corta confirma que se fichó o se inició la
// tarea. En teléfonos sin vibración (o iPhone) no hace nada.
export function vibrar(ms = 40) {
  try { if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(ms); } catch { /* sin vibración */ }
}
