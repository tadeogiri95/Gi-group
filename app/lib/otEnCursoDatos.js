// app/lib/otEnCursoDatos.js — Lee lo que hace falta para saber qué OT están
// en curso (avance de etapas, horas cargadas y piezas escaneadas). La cuenta la hace otEnCurso()
// de app/lib/avance.js; esto lo usan el panel de OT y el Panel de control.
import { sbGetAll } from "./supabase";
import { hoyArg } from "./dates";
import { clavesEscaneadas } from "./piezas";
import { piezasConManual } from "./avanceManual";

/**
 * @returns {Promise<{ avance: object[], horas: Set<string>, piezas: object[], piezasEscaneo: object[] }>}
 *   horas: claves "OT|etapa" con horas en los últimos 6 meses o con alguna
 *   pieza escaneada (igual que el tablero)
 *   piezas: filas de v_avance_piezas (% por escaneo, parte 25; primer_paso para el Gantt)
 *   con el checkeo manual de OT encima (141, app/lib/avanceManual.js)
 *   piezasEscaneo: las mismas filas, solo del escaneo
 */
export async function leerAvanceYHoras(empresaId) {
  const desde = hoyArg(new Date(Date.now() - 183 * 86400000));
  const [av, hs, pz, man] = await Promise.all([
    // Sin la migración 100 no hay avance: quedan solo las horas
    sbGetAll(`avance_etapas?empresa_id=eq.${empresaId}&select=ot,etapa,estado`).catch(() => ({ data: [] })),
    sbGetAll(`registro_actividades?empresa_id=eq.${empresaId}&etapa=gt.0&fecha=gte.${desde}&select=codigo_proyecto,etapa`, { maxFilas: 20000 }).catch(() => ({ data: [] })),
    // Sin la migración 118 no hay vista: sin % por escaneo
    sbGetAll(`v_avance_piezas?empresa_id=eq.${empresaId}&select=ot,etapa,total,pasaron,primer_paso`, { maxFilas: 20000 }).catch(() => ({ data: [] })),
    // Checkeo manual de OT (141): sin la migración, solo el escaneo
    sbGetAll(`proyectos?empresa_id=eq.${empresaId}&avance_manual=not.is.null&select=ot,avance_manual`, { maxFilas: 20000 }).catch(() => ({ data: [] })),
  ]);
  const piezasEscaneo = pz?.data || [];
  const piezas = piezasConManual(piezasEscaneo, man?.data || []);
  return {
    avance: av?.data || [],
    horas: new Set([...(hs?.data || []).map((r) => `${r.codigo_proyecto}|${r.etapa}`), ...clavesEscaneadas(piezas)]),
    piezas,
    piezasEscaneo,
  };
}
