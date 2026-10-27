// app/lib/planGuardado.js — Plan de producción guardado (planificación de la
// producción, parte 41; migración 138, /api/planificacion).
// Gerencia guarda el plan automático del período como borrador o lo confirma;
// confirmado, la planta lo ve en solo lectura (📅 Plan de la semana).
import { ETAPAS_PLAN } from "./planificacion";
import { pendientesPorOt } from "./planAutomatico";
import { buscarDivision } from "./rutas";

const r1 = (h) => Math.round((Number(h) || 0) * 10) / 10;

/**
 * Cuerpo del POST a /api/planificacion con el plan automático. Sin `carga`
 * (plan sin límite de semanas, tipo 'horizonte'), las horas salen del plan.
 */
export function cuerpoPlan({ per, plan, carga, division, ots, estado }) {
  const necesarias = carga ? carga.necesarias : plan.segmentos.reduce((t, s) => t + s.gente, 0);
  const disponibles = carga ? carga.disponibles : plan.porDia.reduce((t, d) => t + (d.extra ? 0 : d.disponibles), 0);
  const orden = new Map(ots.map((p, i) => [p.id, i]));
  // Un renglón por OT, etapa y día (el reparto puede dejar dos tramos el mismo día)
  const juntos = new Map();
  for (const s of plan.segmentos) {
    const k = `${s.id}|${s.etapa}|${s.fecha}`;
    if (!juntos.has(k)) juntos.set(k, { ot: String(s.ot), etapa: s.etapa, fecha: s.fecha, horas: 0, orden: orden.get(s.id) ?? 0 });
    juntos.get(k).horas += s.gente;
  }
  return {
    tipo: per.tipo,
    desde: per.desde,
    hasta: per.hasta,
    estado,
    division_id: division?.id || null,
    horas_necesarias: r1(necesarias),
    horas_disponibles: r1(disponibles),
    horas_extra: r1(plan.diasExtra.reduce((t, d) => t + d.horas, 0)),
    dias_extra: plan.diasExtra.map((d) => ({ fecha: d.fecha, horas: r1(d.horas) })),
    pendientes: pendientesPorOt(plan.pendientes).map((o) => ({ ot: String(o.ot), horas: r1(o.horas) })),
    items: [...juntos.values()].map((i) => ({ ...i, horas: r1(i.horas) })).filter((i) => i.horas > 0),
  };
}

/** Lo que toca cada día: [{ fecha, ots: [{ ot, etapas: [{ id, nombre, horas }] }] }], ordenado. */
export function planPorDia(items) {
  const dias = new Map();
  for (const i of items || []) {
    if (!dias.has(i.fecha)) dias.set(i.fecha, new Map());
    const ots = dias.get(i.fecha);
    if (!ots.has(i.ot)) ots.set(i.ot, { ot: i.ot, orden: Number(i.orden) || 0, etapas: {} });
    const o = ots.get(i.ot);
    o.etapas[i.etapa] = (o.etapas[i.etapa] || 0) + (Number(i.horas) || 0);
  }
  return [...dias.keys()].sort().map((fecha) => ({
    fecha,
    ots: [...dias.get(fecha).values()].sort((a, b) => a.orden - b.orden).map((o) => ({
      ot: o.ot,
      etapas: ETAPAS_PLAN.filter((e) => o.etapas[e.id] > 0).map((e) => ({ id: e.id, nombre: e.nombre, horas: o.etapas[e.id] })),
    })),
  }));
}

/** El plan es para la división del usuario (o para toda la planta si no tiene división). */
export function planEsDeMiDivision(plan, divisiones, divisionUsuario) {
  if (!plan) return false;
  if (!plan.division_id) return true;
  const mia = buscarDivision(divisiones, divisionUsuario);
  return !mia || mia.id === plan.division_id;
}
