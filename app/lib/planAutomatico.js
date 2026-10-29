// app/lib/planAutomatico.js — Plan día por día de las OT tildadas
// (planificación de la producción, parte 40; diseño en
// notes/diseno-planificacion-produccion.md).
//
// Desde el 29/10 (Tadeo: "usa un solo cálculo") el plan sale del mismo
// cálculo que el Gantt de Proyectos (secuencia.js):
// - Las OT van en el orden de prioridad: la primera pasa antes por cada máquina.
// - Cada OT sigue Corte → Canteado → Mecanizado → Armado; por cada máquina pasa
//   una OT a la vez y Armado se reparte entre los armadores.
// - Cada día tiene las horas de la grilla de horarios del personal operativo;
//   los días de horas extra (sábados, después domingos) rinden como el día
//   más largo.
// Las horas de las OT (horasOt) son efectivas; el plan las pasa a horas de
// reloj con la eficiencia.
import { ETAPAS_PLAN } from "./planificacion";
import { inicioDeSemana } from "./semanaObjetivo";
import { calendario, secuenciar } from "./secuencia";

const EPS = 1e-6;
const diaSemana = (fecha) => new Date(`${fecha}T00:00:00Z`).getUTCDay();

/**
 * Horas de cada día de la semana sacadas de la capacidad de los días (las
 * horas en que la planta está abierta). Índice = día de la semana.
 */
export function horasSemanaDeDias(dias = []) {
  const hs = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dias.slice(0, 14)) hs[diaSemana(d.fecha)] = Math.max(hs[diaSemana(d.fecha)], Number(d.maquina) || 0);
  return hs;
}

/**
 * Programa las OT (en orden de prioridad) desde `desde` y reparte cada
 * proceso en los días: segmentos { id, ot, etapa, fecha, gente, maquina } en
 * horas de reloj (maquina = horas de máquina; en la canteadora con 2
 * personas, la mitad de las de gente).
 */
function programar(trabajos, { desde, params, horasSemana, personal, extras, ordenEtapa = null }) {
  const ef = (params.eficiencia || 100) / 100;
  const cal = calendario(desde, horasSemana, extras);
  const ots = trabajos.map((t) => ({ clave: t.id, horas: Object.fromEntries(ETAPAS_PLAN.map(({ id }) => [id, (t.etapas?.[id]?.gente || 0) / ef])) }));
  const tramos = secuenciar(ots, { params, personal, ordenEtapa });
  const segmentos = [];
  for (const t of trabajos) {
    for (const tr of tramos.get(t.id) || []) {
      const e = t.etapas[tr.etapa];
      const total = e.gente / ef;
      const porMaq = e.maquina > EPS ? e.gente / e.maquina : 1;
      const largo = tr.t1 - tr.t0;
      for (const d of cal.reparto(tr.t0, tr.t1)) {
        const gente = (total * d.horas) / largo;
        segmentos.push({ id: t.id, ot: t.ot, etapa: tr.etapa, fecha: d.fecha, gente, maquina: gente / porMaq });
      }
    }
  }
  return { segmentos, pendientes: [] };
}

/** Sin nadie en la grilla de horarios no hay plan: todo queda pendiente. */
function sinCapacidad(trabajos, params) {
  const ef = (params.eficiencia || 100) / 100;
  const pendientes = [];
  for (const t of trabajos) {
    for (const { id } of ETAPAS_PLAN) {
      const e = t.etapas?.[id];
      if (e && e.gente > EPS) pendientes.push({ id: t.id, ot: t.ot, etapa: id, gente: e.gente / ef });
    }
  }
  return { segmentos: [], pendientes };
}

const finDeCadaOt = (segmentos) => {
  const fin = new Map();
  for (const s of segmentos) if (!fin.has(s.id) || s.fecha > fin.get(s.id)) fin.set(s.id, s.fecha);
  return fin;
};

/**
 * Plan hacia adelante, sin límite de semanas (Tadeo, 27/10): las OT elegidas
 * se reparten desde hoy hasta que terminan, con la capacidad de cada día
 * (`dias`: la grilla de horarios, ya calculada para un año o lo que haga falta)
 * y el mismo cálculo que el Gantt de Proyectos (horasSemana y personal: los
 * de ganttPlan; sin horasSemana se sacan de `dias`).
 *
 * Dos formas (switch en 📊 Carga):
 * - "objetivo": cada OT tiene que terminar en su semana (fecha_objetivo). Si
 *   no llega, se suman días de horas extra antes de esa fecha (primero los
 *   sábados, después los domingos, con todo el equipo). La que no llega ni
 *   así (o ya estaba atrasada) queda marcada.
 * - "capacidad": solo el horario normal. Cada OT sale con su fecha estimada
 *   de fin; las que terminan después de su semana quedan marcadas.
 *
 * @param {{ trabajos: object[], dias: {fecha,gente,maquina}[], params: object, base?: "objetivo"|"capacidad", modo?: string, horasSemana?: number[], personal?: object|null, ordenEtapa?: Record<string, any[]>|null }} p
 *   trabajos: en orden de prioridad, con `objetivo` ("AAAA-MM-DD" o null)
 *   ordenEtapa: orden propio de algún proceso, por id de trabajo (ver secuenciar)
 * @returns {{ desde, hasta, segmentos, pendientes, diasExtra, extraPorSemana: {desde, horas}[], porDia, finPorOt: Map, tarde: {id, ot, objetivo, fin, motivo}[] }}
 *   motivo: "atrasada" (la semana ya pasó), "no_llega" (ni con horas extra),
 *   "tarde" (con la capacidad normal termina después de su semana) o
 *   "sin_capacidad" (no entra en los días calculados)
 */
export function planHorizonte({ trabajos, dias, params, base = "objetivo", modo, horasSemana = null, personal = null, ordenEtapa = null }) {
  const desde = dias[0]?.fecha || null;
  const mejor = dias.reduce((a, d) => (d.gente > a.gente ? d : a), { gente: 0, maquina: 0 });
  const hs = horasSemana || horasSemanaDeDias(dias);
  const libres = dias.filter((d) => !(hs[diaSemana(d.fecha)] > 0));
  const sabados = libres.filter((d) => diaSemana(d.fecha) === 6).map((d) => d.fecha);
  const domingos = libres.filter((d) => diaSemana(d.fecha) === 0).map((d) => d.fecha);

  let extras = new Set();
  const correr = () => (mejor.gente > EPS ? programar(trabajos, { desde, params, horasSemana: hs, personal, extras, ordenEtapa }) : sinCapacidad(trabajos, params));
  // OT con semana que no llegan (o no terminan en los días calculados)
  const tardias = (r) => {
    const fin = finDeCadaOt(r.segmentos);
    const pend = new Set(r.pendientes.map((x) => x.id));
    return new Set(trabajos.filter((t) => t.objetivo && (pend.has(t.id) || (fin.has(t.id) && fin.get(t.id) > t.objetivo))).map((t) => t.id));
  };

  let r = correr();
  const imposibles = new Set(trabajos.filter((t) => t.objetivo && desde && t.objetivo < desde).map((t) => t.id));
  if (base === "objetivo" && mejor.gente > EPS) {
    // De a un día extra por vez, para la OT más prioritaria que no llega
    for (let vuelta = 0; vuelta < 400; vuelta++) {
      const tarde = tardias(r);
      const t = trabajos.find((x) => tarde.has(x.id) && !imposibles.has(x.id));
      if (!t) break;
      const dia = sabados.find((f) => f <= t.objetivo && !extras.has(f)) || domingos.find((f) => f <= t.objetivo && !extras.has(f));
      if (!dia) { imposibles.add(t.id); continue; }
      extras = new Set([...extras, dia]);
      r = correr();
    }
    // Se sacan los días extra que no cambian nada (del último para atrás)
    const antes = tardias(r);
    for (const dia of [...extras].sort().reverse()) {
      const sin = new Set(extras);
      sin.delete(dia);
      const previo = extras;
      extras = sin;
      const prueba = correr();
      if ([...tardias(prueba)].every((id) => antes.has(id))) r = prueba;
      else extras = previo;
    }
  }

  const fin = finDeCadaOt(r.segmentos);
  const usadasPorDia = new Map();
  for (const s of r.segmentos) usadasPorDia.set(s.fecha, (usadasPorDia.get(s.fecha) || 0) + s.gente);
  const diasExtra = [...extras].filter((f) => (usadasPorDia.get(f) || 0) > EPS)
    .sort().map((fecha) => ({ fecha, horas: usadasPorDia.get(fecha) }));
  const esExtra = new Set(diasExtra.map((d) => d.fecha));
  const extraPorSemana = new Map();
  for (const d of diasExtra) {
    const s = inicioDeSemana(d.fecha, modo);
    extraPorSemana.set(s, (extraPorSemana.get(s) || 0) + d.horas);
  }
  const pend = new Set(r.pendientes.map((x) => x.id));
  const tarde = [];
  for (const t of trabajos) {
    const f = pend.has(t.id) ? null : fin.get(t.id) || null;
    if (pend.has(t.id) && !t.objetivo) { tarde.push({ id: t.id, ot: t.ot, objetivo: null, fin: null, motivo: "sin_capacidad" }); continue; }
    if (!t.objetivo) continue;
    if (t.objetivo < desde) tarde.push({ id: t.id, ot: t.ot, objetivo: t.objetivo, fin: f, motivo: "atrasada" });
    else if (pend.has(t.id) || (f && f > t.objetivo)) {
      tarde.push({ id: t.id, ot: t.ot, objetivo: t.objetivo, fin: f, motivo: pend.has(t.id) ? "sin_capacidad" : base === "objetivo" ? "no_llega" : "tarde" });
    }
  }
  const hasta = r.segmentos.reduce((m, s) => (s.fecha > m ? s.fecha : m), desde);
  return {
    desde,
    hasta,
    segmentos: r.segmentos,
    pendientes: r.pendientes,
    diasExtra,
    extraPorSemana: [...extraPorSemana].sort((a, b) => a[0].localeCompare(b[0])).map(([d, horas]) => ({ desde: d, horas })),
    porDia: dias.filter((d) => d.fecha <= hasta).map((d) => ({
      fecha: d.fecha,
      usadas: usadasPorDia.get(d.fecha) || 0,
      disponibles: esExtra.has(d.fecha) ? mejor.gente : d.gente,
      extra: esExtra.has(d.fecha),
    })),
    finPorOt: fin,
    tarde,
  };
}

/**
 * Orden más eficiente de las OT tildadas ("⚡ Ordenar de la forma más eficiente", Tadeo
 * 27/10). Arranca por la fecha objetivo más cercana (las sin semana al final)
 * y prueba cambiar de lugar OT vecinas mientras mejore, con la capacidad
 * normal: primero menos OT fuera de su semana, después menos días de atraso
 * y después que terminen antes en total.
 * @returns el mismo arreglo de trabajos, en el orden nuevo
 */
export function ordenEficiente({ trabajos, dias, params, horasSemana = null, personal = null }) {
  if (trabajos.length < 2) return [...trabajos];
  const dia = (f) => Date.parse(`${f}T00:00:00Z`) / 86400000;
  const ultimo = dias.at(-1)?.fecha;
  const hs = horasSemana || horasSemanaDeDias(dias);
  const conGente = dias.some((d) => d.gente > EPS);
  const costo = (orden) => {
    const r = conGente ? programar(orden, { desde: dias[0]?.fecha, params, horasSemana: hs, personal }) : sinCapacidad(orden, params);
    const fin = finDeCadaOt(r.segmentos);
    const pend = new Set(r.pendientes.map((x) => x.id));
    let tarde = 0, atraso = 0, total = 0;
    for (const t of orden) {
      const f = pend.has(t.id) || !fin.has(t.id) ? ultimo : fin.get(t.id);
      if (!f) continue;
      total += dia(f);
      if (t.objetivo && f > t.objetivo) { tarde++; atraso += dia(f) - dia(t.objetivo); }
    }
    return [tarde, atraso, total];
  };
  const mejor = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  let orden = [...trabajos].sort((a, b) => (a.objetivo || "9999").localeCompare(b.objetivo || "9999"));
  let actual = costo(orden);
  for (let pasada = 0; pasada < 3; pasada++) {
    let cambio = false;
    for (let i = 0; i < orden.length - 1; i++) {
      const prueba = [...orden];
      [prueba[i], prueba[i + 1]] = [prueba[i + 1], prueba[i]];
      const c = costo(prueba);
      if (mejor(c, actual) < 0) { orden = prueba; actual = c; cambio = true; }
    }
    if (!cambio) break;
  }
  return orden;
}

/**
 * Lo que el plan pone en un período (la semana o el mes elegidos), como una
 * OT más para cargaPeriodo: horas efectivas de gente y de máquina por etapa.
 */
export function trabajoDelPeriodo(segmentos, desde, hasta, eficiencia = 100) {
  const ef = (eficiencia || 100) / 100;
  const etapas = Object.fromEntries(ETAPAS_PLAN.map(({ id }) => [id, { gente: 0, maquina: 0 }]));
  for (const s of segmentos || []) {
    if (s.fecha < desde || s.fecha > hasta) continue;
    etapas[s.etapa].gente += s.gente * ef;
    etapas[s.etapa].maquina += (s.maquina ?? s.gente) * ef;
  }
  return { etapas };
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
