// ═══════════════════════════════════════════════════════════
// app/lib/dates.js — Manejo unificado de fechas (zona Argentina)
//
// PROBLEMA QUE RESUELVE:
// Antes la app mezclaba new Date().toISOString().slice(0,10) (que da
// la fecha en UTC) con cálculos de fecha local. En Argentina (UTC-3),
// una fichada a las 22:00 podía guardarse con la fecha del día
// siguiente. Esto centraliza TODO en hora Argentina.
//
// USO:
//   import { hoyArg, ahoraArg, lunesDeLaSemana } from "./lib/dates";
//   const fecha = hoyArg();          // "2026-05-30"
//   const { fecha, hora } = ahoraArg();
// ═══════════════════════════════════════════════════════════

const TZ = "America/Argentina/Buenos_Aires";

// Devuelve un objeto Date "movido" a la hora local de Argentina.
function dateEnArg(d = new Date()) {
  return new Date(d.toLocaleString("en-US", { timeZone: TZ }));
}

// Fecha de hoy en formato YYYY-MM-DD según Argentina.
export function hoyArg(d = new Date()) {
  const a = dateEnArg(d);
  const y = a.getFullYear();
  const m = String(a.getMonth() + 1).padStart(2, "0");
  const dd = String(a.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Hora actual HH:MM según Argentina.
export function horaArg(d = new Date()) {
  const a = dateEnArg(d);
  return `${String(a.getHours()).padStart(2, "0")}:${String(a.getMinutes()).padStart(2, "0")}`;
}

// Fecha + hora + día de la semana, todo en Argentina.
export function ahoraArg(d = new Date()) {
  const a = dateEnArg(d);
  const DIAS_KEY = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
  return {
    fecha: hoyArg(d),
    hora: horaArg(d),
    diaKey: DIAS_KEY[a.getDay()],
    dow: a.getDay(),
  };
}

// Lunes de la semana actual (para reportes semanales), en YYYY-MM-DD.
export function lunesDeLaSemana(offsetSemanas = 0, d = new Date()) {
  const a = dateEnArg(d);
  a.setDate(a.getDate() - ((a.getDay() + 6) % 7) + offsetSemanas * 7);
  const y = a.getFullYear();
  const m = String(a.getMonth() + 1).padStart(2, "0");
  const dd = String(a.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Convierte una fecha YYYY-MM-DD a Date al mediodía (evita saltos de día
// al renderizar con toLocaleDateString).
export function fechaSegura(fechaStr) {
  return new Date(fechaStr + "T12:00:00");
}
