// app/lib/finProceso.js — Avisos de fin de proceso (Tadeo, 01/11): cuando
// llega la hora en que el plan vivo dice que termina un proceso de una OT y
// todavía no está terminado, avisa para revisarlo o anotar que necesita más
// tiempo (⏱ Faltan X h). Lo usan el cron fin-proceso (cada 15 minutos, desde
// Supabase; migración 149) y el aviso del Gantt en el navegador.

const DIA_MIN = 24 * 60;
const ARG_MIN = -3 * 60; // Argentina, sin horario de verano

/** Minutos desde la medianoche en Argentina. */
export function minutosArg(ahora = new Date()) {
  const m = ahora.getUTCHours() * 60 + ahora.getUTCMinutes() + ARG_MIN;
  return ((m % DIA_MIN) + DIA_MIN) % DIA_MIN;
}

export const horaTexto = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;

/**
 * Procesos de hoy cuyo fin planificado ya llegó y que siguen sin terminar,
 * del que tenía que terminar antes al último.
 * @param {Map<string, { ot: string, procesos: object[] }>} vivo  planVivo() de hoy
 * @param {{ hoy: string, ahoraMin: number, ventanas: (null|{ini:number, fin:number})[] }} opciones
 *   ventanas: horario de la planta por día de la semana (ventanasDeGrilla), en minutos
 * @returns {{ ot: string, etapa: string, nombre: string, finMin: number, hora: string, clave: string }[]}
 */
export function finesVencidos(vivo, { hoy, ahoraMin, ventanas = [] }) {
  const dia = new Date(`${hoy}T00:00:00Z`).getUTCDay();
  // Un día de horas extra sin horario en la grilla: el horario más largo
  const largo = (ventanas || []).filter(Boolean).reduce((a, v) => (!a || v.fin - v.ini > a.fin - a.ini ? v : a), null) || { ini: 8 * 60, fin: 16 * 60 };
  const v = ventanas?.[dia] || largo;
  const out = [];
  for (const r of vivo?.values?.() || []) {
    for (const q of r.procesos || []) {
      if (q.completo || q.hasta !== hoy || !(q.pendiente > 0)) continue;
      const finMin = Math.round(v.ini + (q.fin ?? 1) * (v.fin - v.ini));
      if (finMin > ahoraMin) continue;
      out.push({ ot: String(r.ot), etapa: q.etapa, nombre: q.nombre, finMin, hora: horaTexto(finMin), clave: `${r.ot}|${q.etapa}|${hoy}|${finMin}` });
    }
  }
  return out.sort((a, b) => a.finMin - b.finMin || a.ot.localeCompare(b.ot, "es", { numeric: true }));
}

/** Texto del aviso al celular. */
export function textoAvisoFin(lista) {
  if (lista.length === 1) {
    const x = lista[0];
    return `OT ${x.ot} · ${x.nombre} tenía que terminar a las ${x.hora}. ¿Está terminado o necesita más tiempo?`;
  }
  const primeros = lista.slice(0, 4).map((x) => `OT ${x.ot} ${x.nombre} (${x.hora})`).join(", ");
  return `${lista.length} procesos tenían que terminar: ${primeros}${lista.length > 4 ? "…" : ""}. Revisalos en el Gantt.`;
}
