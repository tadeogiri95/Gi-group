// app/lib/ganttPlan.js — El plan de producción confirmado en el Gantt de OT y
// en ⏰ OT atrasadas del Panel (planificación de la producción; migración 138).
//
// Cada OT planificada muestra sus procesos (Corte, Canteado, Mecanizado,
// Armado) en secuencia y con una sola OT a la vez por proceso (ver
// procesosPlan). La fecha límite de un proceso es el día en que termina: si ya
// pasó y el proceso no está completo (todas sus piezas escaneadas en esa
// etapa, o la etapa terminada si no se escanea por pieza), está atrasado.
//
// Poco margen (amarillo): un proceso sin completar y todavía en fecha, pero
// justo. Los procesos van uno detrás del otro, así que cuenta lo propio y lo
// del anterior:
//  - ya empezó y va más atrasado que lo que tenía que estar hecho hasta ayer,
//    o hoy es su último día;
//  - el anterior está atrasado y este arranca en 2 días o menos (o ya arrancó).
import { apiFetch, sb } from "./supabase";
import { CLAVE_PLANIFICACION, ETAPAS_PLAN, divisionPlan, etapasPlanDe, normalizarParametros } from "./planificacion";
import { pendienteEtapa } from "./cargaPlanta";
import { diasEntre } from "./semanaObjetivo";
import { porcentajeOt } from "./panelMantenimiento";

const nombreEtapa = Object.fromEntries(ETAPAS_PLAN.map((e) => [e.id, e.nombre]));
const largo = (p) => diasEntre(p.desde, p.hasta);
const DIAS_JUSTO = 2; // con el anterior atrasado, si este arranca en 2 días o menos ya no hay margen

/**
 * Lo que toca cada día según los planes confirmados. Si dos planes se pisan
 * (una semana dentro de un mes confirmado), cada día lo manda el más corto,
 * igual que en 📅 Plan de la semana.
 */
export function itemsVigentes(planes = []) {
  const ordenados = [...(planes || [])].sort((a, b) => largo(a) - largo(b) || String(b.confirmado_at || "").localeCompare(String(a.confirmado_at || "")));
  const tomados = [];
  const out = [];
  for (const p of ordenados) {
    for (const i of p.items || []) {
      if (tomados.some((t) => i.fecha >= t.desde && i.fecha <= t.hasta)) continue;
      out.push(i);
    }
    tomados.push({ desde: p.desde, hasta: p.hasta });
  }
  return out;
}

/** Horas productivas de cada proceso por día (pedido de Tadeo, 27/10). */
export const HORAS_DIA = 8;
const DIA_MS = 86400000;
const sumarDias = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const esFinde = (iso) => [0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay());

/** Días de horas extra de los planes confirmados (sábados o domingos que se trabajan). */
export function diasExtraDe(planes = []) {
  return new Set((planes || []).flatMap((p) => (p.dias_extra || []).map((d) => d.fecha)));
}

/**
 * Calendario de trabajo desde `base`: de lunes a viernes más los días extra,
 * HORAS_DIA horas por día. t = horas productivas desde el comienzo de `base`.
 */
function calendario(base, extra) {
  const dias = [];
  const laborable = (f) => !esFinde(f) || extra.has(f);
  let f = base;
  while (!laborable(f)) f = sumarDias(f, 1);
  dias.push(f);
  const dia = (i) => {
    while (dias.length <= i) {
      let g = sumarDias(dias[dias.length - 1], 1);
      while (!laborable(g)) g = sumarDias(g, 1);
      dias.push(g);
    }
    return dias[i];
  };
  /** Primer índice de día laborable en o después de la fecha. */
  const indice = (fecha) => {
    if (fecha <= dias[0]) return 0;
    let i = 0;
    while (dia(i) < fecha) i++;
    return i;
  };
  /** { fecha, frac } del momento t; si termina justo al final de un día, queda en ese día. */
  const punto = (t, esFin) => {
    let i = Math.floor(t / HORAS_DIA + 1e-9);
    let h = t - i * HORAS_DIA;
    if (esFin && i > 0 && h < 1e-9) { i -= 1; h = HORAS_DIA; }
    return { fecha: dia(i), frac: Math.min(1, Math.max(0, h / HORAS_DIA)) };
  };
  return { indice, punto };
}

/** Horas de reloj que el proceso ocupa su línea (el plan guarda horas de gente). */
function duracion(etapa, horas, params) {
  if (etapa === "canteado") return horas / (params?.personas_canteadora === 2 ? 2 : 1);
  if (etapa === "mecanizado") return horas / (params?.maquinas_cnc || 1);
  if (etapa === "corte") return horas / (params?.maquinas_corte || 1);
  return horas;
}

/**
 * Procesos de cada OT planificada, en secuencia: Map<ot, { ot, inicio, fin, horas, procesos, atrasados, pocoMargen }>.
 * Sale del plan confirmado con dos reglas más (Tadeo, 27/10):
 *  - en cada OT un proceso arranca cuando termina el anterior;
 *  - por cada proceso pasa una sola OT a la vez: si dos OT tienen que cortarse
 *    el mismo día, el corte de la segunda arranca cuando termina el de la primera;
 *  - ningún proceso arranca antes del primer día que le dio el plan.
 * Cada proceso tiene HORAS_DIA horas por día (de lunes a viernes y los días
 * extra del plan). Las OT van en el orden del plan (su primer día y la prioridad).
 * proceso = { etapa, nombre, desde, hasta, ini, fin (qué parte del primer y del
 * último día ocupa, 0-1), horas (de reloj), hecho (0-100), esperado, completo,
 * atrasado, diasAtraso, margen, motivoMargen }.
 * @param {{ etapasCodigo: Record<string, number|null>, avance?: object[], piezas?: object[], terminadas?: Set<string>, hoy: string, params?: object, diasExtra?: Set<string> }} opciones
 */
export function procesosPlan(items = [], { etapasCodigo = {}, avance = [], piezas = [], terminadas = new Set(), hoy, params = null, diasExtra = new Set() }) {
  const porOt = new Map();
  for (const i of items || []) {
    const ot = String(i.ot);
    if (!porOt.has(ot)) porOt.set(ot, { ot, primero: i.fecha, orden: Number(i.orden) || 0, horas: {}, desde: {} });
    const o = porOt.get(ot);
    if (i.fecha < o.primero) o.primero = i.fecha;
    o.orden = Math.min(o.orden, Number(i.orden) || 0);
    o.horas[i.etapa] = (o.horas[i.etapa] || 0) + (Number(i.horas) || 0);
    if (!o.desde[i.etapa] || i.fecha < o.desde[i.etapa]) o.desde[i.etapa] = i.fecha;
  }
  const out = new Map();
  if (!porOt.size) return out;
  const ots = [...porOt.values()].sort((a, b) => a.primero.localeCompare(b.primero) || a.orden - b.orden || a.ot.localeCompare(b.ot, "es", { numeric: true }));
  const cal = calendario(ots[0].primero, diasExtra);
  const tHoy = hoy < ots[0].primero ? 0 : cal.indice(hoy) * HORAS_DIA;
  const libre = {}; // hasta cuándo está ocupada la línea de cada proceso
  for (const o of ots) {
    let t = 0;
    const procesos = [];
    for (const ep of ETAPAS_PLAN) {
      const h = duracion(ep.id, o.horas[ep.id] || 0, params);
      if (h <= 0) continue;
      // No antes del día que le dio el plan, ni de que termine el anterior de la OT, ni de que se libere el proceso
      const t0 = Math.max(t, libre[ep.id] || 0, cal.indice(o.desde[ep.id]) * HORAS_DIA);
      const t1 = t0 + h;
      libre[ep.id] = t1;
      t = t1;
      const a = cal.punto(t0, false);
      const b = cal.punto(t1, true);
      const falta = terminadas.has(o.ot) ? 0 : pendienteEtapa({ ot: o.ot, codigo: etapasCodigo?.[ep.id], avance, piezas });
      const completo = falta <= 0;
      const diasAtraso = completo ? 0 : Math.max(0, diasEntre(b.fecha, hoy));
      procesos.push({
        etapa: ep.id, nombre: nombreEtapa[ep.id], desde: a.fecha, hasta: b.fecha, ini: a.frac, fin: b.frac, t0, t1, horas: h,
        hecho: Math.round((1 - falta) * 100),
        // Lo que tenía que estar hecho al empezar hoy, en % del proceso
        esperado: Math.round(Math.min(1, Math.max(0, (tHoy - t0) / h)) * 100),
        completo, atrasado: diasAtraso > 0, diasAtraso, margen: false, motivoMargen: null,
      });
    }
    if (!procesos.length) continue;
    procesos.forEach((q, i) => {
      if (q.completo || q.atrasado) return;
      const prev = procesos.slice(0, i).reverse().find((z) => !z.completo);
      if (prev?.atrasado && diasEntre(hoy, q.desde) <= DIAS_JUSTO) {
        q.motivoMargen = `${prev.nombre} viene ${prev.diasAtraso} ${prev.diasAtraso === 1 ? "día" : "días"} atrasado y ${q.nombre} va después`;
      } else if (q.desde <= hoy && q.hecho < q.esperado) {
        q.motivoMargen = `va ${q.hecho}% y tenía que ir ${q.esperado}%`;
      } else if (q.hasta === hoy) {
        q.motivoMargen = `hoy es su último día y va ${q.hecho}%`;
      }
      q.margen = !!q.motivoMargen;
    });
    out.set(o.ot, {
      ot: o.ot,
      inicio: procesos[0].desde,
      fin: procesos[procesos.length - 1].hasta,
      horas: procesos.reduce((s, p) => s + p.horas, 0), // la OT dura la suma de sus procesos
      procesos,
      atrasados: procesos.filter((p) => p.atrasado),
      pocoMargen: procesos.filter((p) => p.margen),
    });
  }
  return out;
}

/**
 * ⏰ OT atrasadas según el plan: las OT abiertas con algún proceso atrasado,
 * la más atrasada arriba. dias = el atraso del proceso más atrasado.
 * @returns {{ fila: object, dias: number, porcentaje: number|null, procesos: object[] }[]}
 */
export function otAtrasadasPlan(filas = [], procesos = new Map(), { porEscaneo = new Map() } = {}) {
  const out = [];
  for (const f of filas || []) {
    const r = procesos.get(String(f.proyecto?.ot));
    if (!r?.atrasados.length || f.proyecto.terminado_planilla) continue;
    out.push({ fila: f, dias: Math.max(...r.atrasados.map((p) => p.diasAtraso)), porcentaje: porcentajeOt(f, porEscaneo), procesos: r.atrasados });
  }
  return out.sort((a, b) => b.dias - a.dias || String(a.fila.proyecto.ot).localeCompare(String(b.fila.proyecto.ot), "es", { numeric: true }));
}

/** Etapa de Gypi de cada proceso del plan, según ⚙ Parámetros de la planificación. */
export function etapasDelPlan(cfgValor, etapas, divisiones) {
  const cfg = normalizarParametros(cfgValor);
  return etapasPlanDe(etapas, divisionPlan(divisiones, cfg.division_id), cfg.etapas);
}

/** Lee los planes confirmados y los parámetros (navegador). Sin la migración 138, planes vacío. */
export async function leerPlanesConfirmados() {
  const [r, cfg] = await Promise.all([
    apiFetch("/api/planificacion?confirmados=1").then((x) => (x.ok ? x.json() : null)).catch(() => null),
    sb.get(`config_sistema?clave=eq.${CLAVE_PLANIFICACION}&select=valor&limit=1`).catch(() => null),
  ]);
  return { planes: r?.planes || [], cfgValor: cfg?.[0]?.valor || null, faltaMigracion: !!r?.falta_migracion };
}
