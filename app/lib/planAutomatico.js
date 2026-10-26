// app/lib/planAutomatico.js — Orden automático de las OT día por día
// (planificación de la producción, parte 40; diseño en
// notes/diseno-planificacion-produccion.md).
//
// Reglas:
// - Las OT van en el orden de prioridad (la manual primero, después la semana):
//   la primera toma la capacidad antes que la segunda.
// - Cada OT sigue Corte → Canteado → Mecanizado → Armado. Una etapa puede
//   arrancar el mismo día en que termina la anterior, nunca antes.
// - Cada día hay horas de gente (los turnos de los operarios) y horas de cada
//   máquina (las horas en que la planta está abierta × cantidad de máquinas).
//   La canteadora con 2 personas gasta el doble de horas de gente que de máquina.
// - Lo que no entra en los días de trabajo se pasa a días de horas extra
//   (primero los sábados, después los domingos), con todo el equipo. Lo que
//   tampoco entra queda para el período siguiente (la OT se parte).
// Todas las horas internas son efectivas (con la eficiencia ya descontada);
// lo que se muestra se pasa a horas de reloj.
import { ETAPAS_PLAN } from "./planificacion";

const EPS = 1e-6;
const diaSemana = (fecha) => new Date(`${fecha}T00:00:00Z`).getUTCDay();

const MAQUINA = {
  corte: (p) => p.maquinas_corte || 1,
  canteado: () => 1,
  mecanizado: (p) => p.maquinas_cnc || 1,
};

/**
 * Reparte el trabajo en los días habilitados.
 * @param {{ ot, id }[]} trabajos  en orden de prioridad, con `etapas[id].gente/maquina` (horas efectivas)
 * @param {{ fecha, gente, maquina }[]} dias  capacidad de reloj de cada día (gente y planta abierta)
 */
function repartir(trabajos, dias, params) {
  const ef = (params.eficiencia || 100) / 100;
  const libre = dias.map((d) => ({
    fecha: d.fecha,
    gente: d.gente * ef,
    maq: Object.fromEntries(Object.entries(MAQUINA).map(([k, n]) => [k, d.maquina * ef * n(params)])),
  }));
  const segmentos = [];
  const pendientes = [];
  for (const t of trabajos) {
    let desde = 0;
    for (const { id } of ETAPAS_PLAN) {
      const e = t.etapas[id];
      if (!e || e.gente <= EPS) continue;
      // Horas de gente por hora de máquina (2 en la canteadora con 2 personas)
      const porMaq = e.maquina > EPS ? e.gente / e.maquina : 1;
      let resta = e.gente;
      let ultimo = desde;
      for (let i = desde; i < libre.length && resta > EPS; i++) {
        const dia = libre[i];
        let puede = Math.min(resta, dia.gente);
        if (MAQUINA[id]) puede = Math.min(puede, dia.maq[id] * porMaq);
        if (puede <= EPS) continue;
        dia.gente -= puede;
        if (MAQUINA[id]) dia.maq[id] -= puede / porMaq;
        resta -= puede;
        ultimo = i;
        segmentos.push({ id: t.id, ot: t.ot, etapa: id, fecha: dia.fecha, gente: puede / ef });
      }
      if (resta > EPS) pendientes.push({ id: t.id, ot: t.ot, etapa: id, gente: resta / ef });
      desde = ultimo;
      // Si una etapa quedó sin terminar, las siguientes de esta OT tampoco entran
      if (resta > EPS) {
        for (const sig of ETAPAS_PLAN.slice(ETAPAS_PLAN.findIndex((x) => x.id === id) + 1)) {
          const s = t.etapas[sig.id];
          if (s && s.gente > EPS) pendientes.push({ id: t.id, ot: t.ot, etapa: sig.id, gente: s.gente / ef });
        }
        break;
      }
    }
  }
  return { segmentos, pendientes };
}

/**
 * Plan automático del período.
 * @param {{ trabajos: object[], capacidad: { porDia: {fecha,gente,maquina}[] }, params: object }} p
 * @returns {{ segmentos, pendientes, diasExtra: {fecha, horas}[], porDia: {fecha, usadas, disponibles, extra}[], finPorOt: Map }}
 */
export function planAutomatico({ trabajos, capacidad, params }) {
  const porDia = capacidad.porDia || [];
  const normales = porDia.map((d) => ({ ...d }));
  // Un día de horas extra rinde como el mejor día normal (todo el equipo)
  const mejor = porDia.reduce((a, d) => (d.gente > a.gente ? d : a), { gente: 0, maquina: 0 });
  const candidatos = [
    ...porDia.filter((d) => d.gente <= EPS && diaSemana(d.fecha) === 6),
    ...porDia.filter((d) => d.gente <= EPS && diaSemana(d.fecha) === 0),
  ].map((d) => d.fecha);

  let extras = new Set();
  const conExtras = () => normales.map((d) => (extras.has(d.fecha) ? { ...d, gente: mejor.gente, maquina: mejor.maquina } : d));
  let r = repartir(trabajos, conExtras(), params);
  // Se suman días extra de a uno hasta que entre todo (o no queden)
  for (const fecha of candidatos) {
    if (!r.pendientes.length || mejor.gente <= EPS) break;
    extras = new Set([...extras, fecha]);
    r = repartir(trabajos, conExtras(), params);
  }

  const usadasPorDia = new Map();
  for (const s of r.segmentos) usadasPorDia.set(s.fecha, (usadasPorDia.get(s.fecha) || 0) + s.gente);
  // Los días extra que al final no hicieron falta se descartan
  const diasExtra = [...extras].filter((f) => (usadasPorDia.get(f) || 0) > EPS)
    .sort().map((fecha) => ({ fecha, horas: usadasPorDia.get(fecha) }));
  const esExtra = new Set(diasExtra.map((d) => d.fecha));
  const finPorOt = new Map();
  for (const s of r.segmentos) if (!finPorOt.has(s.id) || s.fecha > finPorOt.get(s.id)) finPorOt.set(s.id, s.fecha);

  return {
    segmentos: r.segmentos,
    pendientes: r.pendientes,
    diasExtra,
    porDia: porDia.map((d) => ({
      fecha: d.fecha,
      usadas: usadasPorDia.get(d.fecha) || 0,
      disponibles: esExtra.has(d.fecha) ? mejor.gente : d.gente,
      extra: esExtra.has(d.fecha),
    })),
    finPorOt,
  };
}

/** Celdas del Gantt: por OT, por día, las etapas que se trabajan y sus horas. */
export function celdasGantt(segmentos) {
  const porOt = new Map();
  for (const s of segmentos) {
    if (!porOt.has(s.id)) porOt.set(s.id, new Map());
    const dias = porOt.get(s.id);
    if (!dias.has(s.fecha)) dias.set(s.fecha, {});
    const c = dias.get(s.fecha);
    c[s.etapa] = (c[s.etapa] || 0) + s.gente;
  }
  return porOt;
}

/** Horas que pasan al período siguiente, por OT: [{ id, ot, horas, etapas: [] }]. */
export function pendientesPorOt(pendientes) {
  const porOt = new Map();
  for (const p of pendientes) {
    if (!porOt.has(p.id)) porOt.set(p.id, { id: p.id, ot: p.ot, horas: 0, etapas: [] });
    const o = porOt.get(p.id);
    o.horas += p.gente;
    if (!o.etapas.includes(p.etapa)) o.etapas.push(p.etapa);
  }
  return [...porOt.values()];
}
