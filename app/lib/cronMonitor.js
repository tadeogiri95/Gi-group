// app/lib/cronMonitor.js — Registro de ejecuciones de los crons (F3-12).
//
// Cada cron se envuelve con conMonitoreoCron(nombre, handler): al terminar
// guarda en `cron_ejecuciones` (migración 072) cuándo corrió y si salió bien,
// y si falló lo manda a Sentry. /api/health usa esa tabla para detectar crons
// que dejaron de correr; el monitor externo de uptime avisa cuando eso pasa.

import { logger } from "./logger";

const HORA = 60 * 60 * 1000;

// Máximo tiempo sin una corrida OK antes de considerar el cron atrasado.
// Un poco más que su frecuencia (vercel.json) para tolerar demoras de Vercel.
export const CRONS_ESPERADOS = {
  "auto-fichaje": 26 * HORA,
  "limpiar-tokens": 8 * 24 * HORA, // semanal (domingos)
  "trial-reminder": 26 * HORA,
  "vencer-trials": 26 * HORA,
  "push-ausencias": 74 * HORA, // lunes a viernes: del viernes al lunes pasan 72 h
  "inactividad-produccion": 74 * HORA, // lunes a viernes
  "health-check": 26 * HORA,
  "refresh-scores": 26 * HORA,
  "reengagement-onboarding": 26 * HORA,
  "reconciliacion-mp": 26 * HORA,
  "purgar-empresas": 26 * HORA,
};

async function registrar(nombre, datos) {
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) return;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/cron_ejecuciones?on_conflict=nombre`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({ nombre, ...datos }),
    });
    if (!r.ok) logger.warn(`[cron/${nombre}] no se pudo registrar la ejecución (HTTP ${r.status})`);
  } catch (e) {
    logger.warn(`[cron/${nombre}] no se pudo registrar la ejecución`, { error: e?.message });
  }
}

/**
 * Envuelve el GET de un cron. Un 401 (llamada sin CRON_SECRET) no se registra;
 * una respuesta 5xx o una excepción cuentan como falla.
 */
export function conMonitoreoCron(nombre, handler) {
  return async function GET(request, ...resto) {
    const inicio = Date.now();
    const ahora = () => new Date().toISOString();
    let res;
    try {
      res = await handler(request, ...resto);
    } catch (e) {
      logger.error(`[cron/${nombre}] falló con una excepción`, e);
      await registrar(nombre, { ultima_corrida: ahora(), ultimo_error: String(e?.message || e).slice(0, 500) });
      throw e;
    }
    if (res?.status === 401) return res;
    const duracion_ms = Date.now() - inicio;
    if (res && res.status < 500) {
      await registrar(nombre, { ultima_corrida: ahora(), ultima_ok: ahora(), ultimo_error: null, duracion_ms });
    } else {
      logger.error(`[cron/${nombre}] terminó con error`, new Error(`HTTP ${res?.status}`));
      await registrar(nombre, { ultima_corrida: ahora(), ultimo_error: `HTTP ${res?.status}`, duracion_ms });
    }
    return res;
  };
}

/**
 * Crons sin una corrida OK dentro de su ventana. `filas` viene de
 * cron_ejecuciones; un cron esperado que no figura cuenta como atrasado.
 * @returns {string[]} nombres de los crons atrasados
 */
export function cronsAtrasados(filas, ahora = Date.now()) {
  const ultimaOk = new Map((filas || []).map((f) => [f.nombre, f.ultima_ok ? Date.parse(f.ultima_ok) : NaN]));
  return Object.entries(CRONS_ESPERADOS)
    .filter(([nombre, limite]) => {
      const t = ultimaOk.get(nombre);
      return !Number.isFinite(t) || ahora - t > limite;
    })
    .map(([nombre]) => nombre);
}
