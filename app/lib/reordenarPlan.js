// app/lib/reordenarPlan.js — Reordenar las OT arrastrándolas en el Gantt de
// Proyectos (Tadeo, 29/10). Al soltar, el plan se vuelve a armar en el momento
// con el orden nuevo y el mismo cálculo que 📊 Carga en Planificación (horas
// que faltan de cada OT con horasOt, capacidad de la grilla de horarios,
// planHorizonte y cuerpoPlan): el Gantt lo muestra como vista previa y con
// "✅ Confirmar nuevo orden" se guarda igual que "Confirmar plan" del paso ④.
import { horasOt, operariosDePlanta, capacidadPlanta, diasDesde } from "./cargaPlanta";
import { horasSemanaDeGrilla, personalGantt } from "./ganttPlan";
import { planHorizonte } from "./planAutomatico";
import { cuerpoPlan } from "./planGuardado";

/** Clave del navegador de lo que se eligió en Planificación (la forma del plan, lo tildado…), por empresa y división. */
export const clavePlan = (empresaId, divisionId, que) => `gypi_plan_${que}_${empresaId}_${divisionId || "todas"}`;

/** Forma del plan elegida en Planificación ("objetivo" o "capacidad"); sin nada guardado, capacidad. */
export function baseGuardada(empresaId, divisionId) {
  try { return JSON.parse(localStorage.getItem(clavePlan(empresaId, divisionId, "base")) || "null") === "objetivo" ? "objetivo" : "capacidad"; } catch { return "capacidad"; }
}

/** Mueve el elemento de la posición `desde` a la posición `hasta`. */
export function mover(lista, desde, hasta) {
  const out = [...lista];
  const [x] = out.splice(desde, 1);
  out.splice(hasta, 0, x);
  return out;
}

/**
 * Cuerpo del plan (como el POST a /api/planificacion, confirmado) con las OT en el orden dado.
 * @param {{ orden: object[], params: object, empleados: object[], divisiones: object[], division: object|null, avance?: object[], piezas?: object[], modulos?: Map<string, number>, hoy: string, base?: string, modo?: string, ordenEtapa?: Record<string, string[]>|null }} p
 *   orden: las OT (proyectos) en el orden nuevo
 *   ordenEtapa: orden propio de algún proceso, por número de OT ({ canteado: ["7858", …] }),
 *   el que se arma en "OT por proceso" (Tadeo, 29/10: queda solo en el plan confirmado)
 * @returns {object|null} null si el plan queda vacío (nada que hacer o nadie en la grilla)
 */
export function planReordenado({ orden, params, empleados, divisiones, division, avance = [], piezas = [], modulos = new Map(), hoy, base = "capacidad", modo, ordenEtapa = null }) {
  const trabajos = orden.map((p) => ({
    ...horasOt(p, params, { modulosEtiquetas: modulos.get(String(p.ot)) || null, avance, piezas }),
    id: p.id, objetivo: p.fecha_objetivo || null,
  }));
  if (!trabajos.length) return null;
  const idDe = new Map(orden.map((p) => [String(p.ot), p.id]));
  const porId = ordenEtapa ? Object.fromEntries(Object.entries(ordenEtapa).map(([etapa, ots]) => [etapa, ots.map((ot) => idDe.get(String(ot))).filter((id) => id != null)])) : null;
  const dias = capacidadPlanta(operariosDePlanta(empleados, divisiones, division), diasDesde(hoy, 366)).porDia;
  const plan = planHorizonte({
    trabajos, dias, params, base, modo,
    horasSemana: horasSemanaDeGrilla(empleados, divisiones, params), personal: personalGantt(empleados, divisiones, params), ordenEtapa: porId,
  });
  if (!plan.segmentos.length) return null;
  return cuerpoPlan({ per: { tipo: "horizonte", desde: plan.desde, hasta: plan.hasta }, plan, division, ots: orden, estado: "confirmado", ordenEtapa: porId });
}
