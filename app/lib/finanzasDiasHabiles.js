// app/lib/finanzasDiasHabiles.js — Finanzas: cuándo se mueve de verdad la
// plata de un cheque (Tadeo, 11/11). Sin migración.
//
// Un cheque se deposita el día que vence si es día hábil; si vence un día no
// hábil, el siguiente día hábil. El banco lo debita (o lo acredita, si es de
// un tercero) el día hábil siguiente al depósito. Ejemplos:
//   vence el martes 10        → se deposita el 10 → se debita el miércoles 11
//   vence el sábado 14        → se deposita el lunes 16 → se debita el martes 17
//   vence el viernes 6/11 (Día del Bancario) → se deposita el lunes 9 → martes 10
//
// Días no hábiles: sábados, domingos, los feriados que la empresa cargó en
// Parámetros de planificación y los feriados bancarios de abajo (los
// nacionales, los días no laborables y el Día del Bancario, 6/11).
import { esDiaHabil, diaHabilSiguiente } from "./planInstalacion";
import { normalizarFeriados } from "./planificacion";

/** Feriados y días sin bancos (BCRA). Revisar cada año: los puentes los fija el Gobierno. */
export const FERIADOS_BANCARIOS = [
  // 2026
  ["2026-01-01", "Año Nuevo"], ["2026-02-16", "Carnaval"], ["2026-02-17", "Carnaval"],
  ["2026-03-23", "Día no laborable"], ["2026-03-24", "Día de la Memoria"], ["2026-04-02", "Malvinas / Jueves Santo"],
  ["2026-04-03", "Viernes Santo"], ["2026-05-01", "Día del Trabajador"], ["2026-05-25", "Revolución de Mayo"],
  ["2026-06-15", "Paso a la Inmortalidad de Güemes"], ["2026-06-20", "Día de la Bandera"], ["2026-07-09", "Día de la Independencia"],
  ["2026-07-10", "Día no laborable"], ["2026-08-17", "Paso a la Inmortalidad de San Martín"], ["2026-10-12", "Diversidad Cultural"],
  ["2026-11-06", "Día del Bancario"], ["2026-11-23", "Soberanía Nacional"], ["2026-12-07", "Día no laborable"],
  ["2026-12-08", "Inmaculada Concepción"], ["2026-12-25", "Navidad"],
  // 2027
  ["2027-01-01", "Año Nuevo"], ["2027-02-08", "Carnaval"], ["2027-02-09", "Carnaval"],
  ["2027-03-24", "Día de la Memoria"], ["2027-03-25", "Jueves Santo"], ["2027-03-26", "Viernes Santo"],
  ["2027-04-02", "Malvinas"], ["2027-05-01", "Día del Trabajador"], ["2027-05-25", "Revolución de Mayo"],
  ["2027-06-21", "Paso a la Inmortalidad de Güemes"], ["2027-06-20", "Día de la Bandera"], ["2027-07-09", "Día de la Independencia"],
  ["2027-08-16", "Paso a la Inmortalidad de San Martín"], ["2027-10-11", "Diversidad Cultural"], ["2027-11-06", "Día del Bancario"],
  ["2027-11-22", "Soberanía Nacional"], ["2027-12-08", "Inmaculada Concepción"], ["2027-12-25", "Navidad"],
].map(([fecha, nombre]) => ({ fecha, nombre }));

/**
 * Los días sin bancos: los bancarios más los que cargó la empresa.
 * @param {any} configPlanificacion el valor de config_sistema "planificacion" (o null)
 * @returns {Set<string>}
 */
export function feriadosFinanzas(configPlanificacion = null) {
  const propios = normalizarFeriados(configPlanificacion?.feriados);
  return new Set([...FERIADOS_BANCARIOS, ...propios].map((f) => f.fecha));
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** El día que se deposita un cheque que vence en `vence`. */
export function fechaDeposito(vence, feriados = null) {
  if (!FECHA.test(String(vence || ""))) return null;
  return esDiaHabil(vence, feriados) ? vence : diaHabilSiguiente(vence, feriados);
}

/** El día que el banco lo debita (propio) o lo acredita (de un tercero): el hábil siguiente al depósito. */
export function fechaDebito(vence, feriados = null) {
  const d = fechaDeposito(vence, feriados);
  return d ? diaHabilSiguiente(d, feriados) : null;
}
