// app/lib/offline.js — Reglas compartidas (cliente y servidor) de lo que se
// registra sin conexión y se envía después (F4-05, ítem 21).

// Hasta cuánto tiempo después se acepta algo hecho sin conexión. Más que eso
// lo tiene que cargar un supervisor (evita "fichar" horas viejas a mano).
export const MAX_ATRASO_OFFLINE_H = 12;
// El reloj del teléfono puede estar un poco adelantado
const TOLERANCIA_FUTURO_MS = 2 * 60 * 1000;

/**
 * Valida el momento (ISO) en que se hizo algo sin conexión.
 * @returns {{ ok: true, fecha: Date } | { ok: false, error: string, tipo: string }}
 */
export function validarMomento(iso, ahora = Date.now()) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return { ok: false, tipo: "momento_invalido", error: "La hora registrada sin conexión no es válida." };
  if (t - ahora > TOLERANCIA_FUTURO_MS) return { ok: false, tipo: "momento_futuro", error: "La hora del teléfono está adelantada. Revisá la fecha y hora del celular." };
  if (ahora - t > MAX_ATRASO_OFFLINE_H * 3600000) {
    return { ok: false, tipo: "offline_vencido", error: `Pasaron más de ${MAX_ATRASO_OFFLINE_H} horas sin conexión: pedile a tu supervisor que lo cargue.` };
  }
  return { ok: true, fecha: new Date(t) };
}

/** Fecha, hora y día (clave del diagrama) de un instante en la zona horaria dada. */
export function horaLocal(tz = "America/Argentina/Buenos_Aires", instante = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(instante).map((x) => [x.type, x.value])
  );
  const DIAS = { Sun: "dom", Mon: "lun", Tue: "mar", Wed: "mie", Thu: "jue", Fri: "vie", Sat: "sab" };
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}`, diaKey: DIAS[p.weekday] };
}
