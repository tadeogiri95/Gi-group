// app/lib/semanaEditable.js — SEMANA de cada OT editable desde Gypi (Tadeo,
// 29/10; migración 144). La SEMANA viene del Plan de trabajo; si se cambia en
// Gypi, queda en semana_app hasta que el script de la planilla la anota en la
// columna SEMANA. Si se cambia en los dos lados, gana el cambio más reciente.
// El número de prioridad sigue mandando sobre la semana (planificacion.js).
import { fechaObjetivo, numeroSemana, rangoSemana } from "./semanaObjetivo";

/** config_sistema del script del Plan de trabajo que anota la SEMANA (planillaPlan.js). */
export const CLAVE_PLANILLA_PLAN = "planilla_plan_script";

/** Semanas para elegir: de 8 antes de la actual a 30 después, y la que ya tiene la OT. */
export function opcionesSemana(hoy, modo, actual = null) {
  const anio = Number(String(hoy).slice(0, 4));
  const ahora = numeroSemana(hoy, anio, modo);
  const desde = Math.max(1, Math.min(ahora - 8, actual || Infinity));
  const hasta = Math.max(ahora + 30, actual || 0);
  const out = [];
  for (let n = desde; n <= hasta; n++) {
    const { inicio, fin } = rangoSemana(n, anio, modo);
    const corta = (f) => `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}`;
    out.push({ semana: n, texto: `S${n} · ${corta(inicio)} al ${corta(fin)}${n === ahora ? " (esta)" : ""}` });
  }
  return out;
}

/**
 * Lo que se guarda en la OT al elegir una semana en Gypi. Si vuelve a la que
 * trajo la planilla, no queda nada pendiente para el script.
 */
export function cambioSemana(p, semana, { modo, hoy, ahora = new Date().toISOString() }) {
  const n = Number(semana);
  const fecha = fechaObjetivo({ semana_objetivo: n }, { modo, hoy });
  const comoPlanilla = p.semana_planilla != null && Number(p.semana_planilla) === n;
  return {
    semana_objetivo: n,
    fecha_objetivo: fecha,
    semana_app: comoPlanilla ? null : n,
    semana_app_at: comoPlanilla ? null : ahora,
  };
}

/**
 * Qué semana queda en una sincronización.
 * @param {{ semana_app?: number|null, semana_app_at?: string|null, semana_planilla?: number|null }|undefined} previa  la OT en Gypi
 * @param {number|null} planilla  la SEMANA que trae ahora la planilla
 * @param {string|null} ultimaSync  cuándo fue la sincronización anterior
 * @returns {{ semana: number|null, semana_app: number|null, semana_app_at: string|null, semana_planilla: number|null, gano: "planilla"|"app"|null }}
 */
export function resolverSemana(previa, planilla, ultimaSync) {
  const base = { semana_planilla: planilla ?? null };
  const app = previa?.semana_app ?? null;
  if (app == null) return { ...base, semana: planilla ?? null, semana_app: null, semana_app_at: null, gano: null };
  // Ya llegó a la planilla
  if (planilla === app) return { ...base, semana: planilla, semana_app: null, semana_app_at: null, gano: null };
  // La planilla cambió desde la sincronización anterior. El cambio de la
  // planilla es de después de esa sincronización: gana si el de Gypi es de antes.
  const cambioPlanilla = (previa.semana_planilla ?? null) !== (planilla ?? null);
  const tAnterior = Date.parse(ultimaSync || "");
  const tApp = Date.parse(previa.semana_app_at || "");
  const appEsAnterior = Number.isFinite(tAnterior) && Number.isFinite(tApp) && tApp <= tAnterior;
  if (cambioPlanilla && (appEsAnterior || !Number.isFinite(tApp))) {
    return { ...base, semana: planilla ?? null, semana_app: null, semana_app_at: null, gano: "planilla" };
  }
  return { ...base, semana: app, semana_app: app, semana_app_at: previa.semana_app_at, gano: "app" };
}

/** "Pendiente de pasar a la planilla" para mostrar al lado de la semana. */
export const pendientePlanilla = (p) => p?.semana_app != null && Number(p.semana_app) === Number(p.semana_objetivo);
