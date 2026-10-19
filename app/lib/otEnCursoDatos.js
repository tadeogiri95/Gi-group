// app/lib/otEnCursoDatos.js — Lee lo que hace falta para saber qué OT están
// en curso (avance de etapas y horas cargadas). La cuenta la hace otEnCurso()
// de app/lib/avance.js; esto lo usan el panel de OT y el Panel de control.
import { sbGetAll } from "./supabase";
import { hoyArg } from "./dates";

/**
 * @returns {Promise<{ avance: object[], horas: Set<string> }>}
 *   horas: claves "OT|etapa" con horas en los últimos 6 meses (igual que el tablero)
 */
export async function leerAvanceYHoras(empresaId) {
  const desde = hoyArg(new Date(Date.now() - 183 * 86400000));
  const [av, hs] = await Promise.all([
    // Sin la migración 100 no hay avance: quedan solo las horas
    sbGetAll(`avance_etapas?empresa_id=eq.${empresaId}&select=ot,etapa,estado`).catch(() => ({ data: [] })),
    sbGetAll(`registro_actividades?empresa_id=eq.${empresaId}&etapa=gt.0&fecha=gte.${desde}&select=codigo_proyecto,etapa`, { maxFilas: 20000 }).catch(() => ({ data: [] })),
  ]);
  return {
    avance: av?.data || [],
    horas: new Set((hs?.data || []).map((r) => `${r.codigo_proyecto}|${r.etapa}`)),
  };
}
