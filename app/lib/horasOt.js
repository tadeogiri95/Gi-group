// app/lib/horasOt.js — Horas-persona presupuestadas contra reales de una OT
// (costo de OT, parte E; migración 166; diseño en notes/diseno-costo-ot.md).
//
// Por proceso del plan (Corte, Canteado, Mecanizado, Armado) y en total.
// Cada número puede ser automático o escrito a mano (horas_ot; null = auto):
//   - Presupuestadas automáticas: la estimación del Gantt (horasOt de
//     cargaPlanta: placas, cantos, mecanizados, gabinetes y ⚙ Parámetros),
//     en horas de gente, con la eficiencia de la planta.
//   - Reales automáticas: horas de trabajo desde el primer avance del proceso
//     hasta el 100 % (o hasta ahora si sigue), sin los tramos en pausa
//     (leadTimeProcesos), × los operarios distintos que escanearon o
//     marcaron avance en ese proceso; más las horas de las tareas viejas de
//     "Iniciar Tarea" de esa etapa.
// El total presupuestado o real a mano reemplaza la suma de los procesos.

import { ETAPAS_PLAN } from "./planificacion";
import { horasOt as estimacionGantt } from "./cargaPlanta";

export const ETAPAS_HORAS = [...ETAPAS_PLAN.map(({ id, nombre }) => ({ id, nombre })), { id: "total", nombre: "Total" }];
const IDS = new Set(ETAPAS_HORAS.map((e) => e.id));
export const esEtapaHoras = (id) => IDS.has(id);

const r1 = (n) => Math.round(n * 10) / 10;
const numero = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Presupuesto del Gantt por proceso, en horas-persona (null si la OT no tiene placas, cantos ni mecanizados). */
export function presupuestoAutomatico(proyecto, params) {
  if (!proyecto || !params) return null;
  const h = estimacionGantt(proyecto, params);
  if (h.sinDatos) return null;
  const ef = (Number(params.eficiencia) || 100) / 100;
  const out = {};
  for (const { id } of ETAPAS_PLAN) out[id] = r1((h.etapas[id]?.gente || 0) / ef);
  return out;
}

/**
 * Horas-persona reales automáticas por proceso.
 * @param {{ ot: string, etapasCodigo: Record<string, number|null>, leadTime?: object|null, pasos?: object[], manual?: object[], tareasMin?: Record<string|number, number> }} d
 *   leadTime: el de esta OT en leadTimeProcesos (procesos con horas o lleva)
 *   pasos: pasos_pieza de la OT (etapa = código, empleado_id)
 *   manual: avance_manual_historial de la OT (etapa = código, creado_por)
 *   tareasMin: minutos de tareas viejas por código de etapa (resumirOp)
 * @returns {Record<string, { horas: number|null, personas: number, tareas: number, total: number, terminado: boolean }>}
 */
export function realesAutomaticas({ etapasCodigo = {}, leadTime = null, pasos = [], manual = [], tareasMin = {} }) {
  const procesos = new Map((leadTime?.procesos || []).map((p) => [p.etapa, p]));
  const out = {};
  for (const { id } of ETAPAS_PLAN) {
    const codigo = etapasCodigo?.[id];
    if (codigo == null) continue;
    const quienes = new Set();
    for (const p of pasos) if (Number(p.etapa) === Number(codigo) && p.empleado_id) quienes.add(p.empleado_id);
    for (const m of manual) if (Number(m.etapa) === Number(codigo) && Number(m.pct) > 0 && m.creado_por) quienes.add(m.creado_por);
    const proc = procesos.get(id);
    const horas = proc ? (proc.horas ?? proc.lleva ?? null) : null;
    // Avanzó pero no se sabe quién (escaneos viejos sin operario): cuenta una persona
    const personas = horas != null ? Math.max(1, quienes.size) : quienes.size;
    const tareas = r1((Number(tareasMin?.[codigo]) || 0) / 60);
    out[id] = { horas, personas, tareas, total: r1((horas || 0) * personas + tareas), terminado: !!proc?.fin };
  }
  return out;
}

function lado(auto, mano) {
  const m = numero(mano);
  if (m !== null) return { valor: m, auto, aMano: true };
  return { valor: auto ?? null, auto: auto ?? null, aMano: false };
}

/**
 * Tabla presupuestado contra real.
 * @param {{ presupuesto: Record<string, number>|null, reales: Record<string, object>, manuales?: object[] }} d
 *   manuales: horas_ot de la OT
 * @returns {{ filas: object[], total: object }}
 *   cada fila: { etapa, nombre, presupuestadas: {valor, auto, aMano}, reales: {...}, diferencia, pct, cambiadoPor, detalle }
 */
export function tablaHoras({ presupuesto = null, reales = {}, manuales = [] }) {
  const mano = new Map(manuales.map((m) => [m.etapa, m]));
  const fila = (id, nombre, autoP, autoR, detalle = null) => {
    const m = mano.get(id);
    const p = lado(autoP, m?.presupuestadas);
    const r = lado(autoR, m?.reales);
    const diferencia = p.valor != null && r.valor != null ? r1(r.valor - p.valor) : null;
    const pct = p.valor > 0 && r.valor != null ? Math.round((r.valor / p.valor) * 100) : null;
    return { etapa: id, nombre, presupuestadas: p, reales: r, diferencia, pct, cambiadoPor: m?.cambiado_por_nombre || null, detalle };
  };
  const filas = ETAPAS_PLAN.map(({ id, nombre }) => fila(id, nombre, presupuesto?.[id] ?? null, reales[id]?.total ?? null, reales[id] || null));
  const suma = (lado) => {
    const vals = filas.map((f) => f[lado].valor).filter((v) => v != null);
    return vals.length ? r1(vals.reduce((s, v) => s + v, 0)) : null;
  };
  const total = fila("total", "Total", suma("presupuestadas"), suma("reales"));
  return { filas, total };
}

/** 12.5 → "12,5 h"; null → "—". */
export function textoHoras(h) {
  if (h === null || h === undefined) return "—";
  return `${Number(h).toLocaleString("es-AR", { maximumFractionDigits: 1 })} h`;
}
