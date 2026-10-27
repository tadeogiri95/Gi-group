// app/lib/ganttPlan.js — El plan de producción confirmado en el Gantt de OT y
// en ⏰ OT atrasadas del Panel (planificación de la producción; migración 138).
//
// Cada OT planificada muestra sus procesos (Corte, Canteado, Mecanizado,
// Armado) desde el primer hasta el último día que el plan les asigna. La fecha
// límite de un proceso es ese último día: si ya pasó y el proceso no está
// completo (todas sus piezas escaneadas en esa etapa, o la etapa terminada si
// no se escanea por pieza), el proceso está atrasado.
//
// Poco margen (amarillo): un proceso sin completar y todavía en fecha, pero
// justo. Los procesos van uno detrás del otro, así que cuenta lo propio y lo
// del anterior:
//  - ya empezó y va más atrasado que lo que el plan tenía hecho hasta ayer, o
//    hoy es su último día del plan;
//  - el anterior está atrasado y este arranca en 2 días o menos (o ya
//    arrancó), o el anterior tiene poco margen y este arranca enseguida.
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

/**
 * Procesos de cada OT planificada: Map<ot, { ot, inicio, fin, procesos, atrasados, pocoMargen }>.
 * proceso = { etapa, nombre, desde, hasta, horas, hecho (0-100), completo, atrasado, diasAtraso, margen, motivoMargen }.
 * margen = true si está en fecha pero con poco margen (ver arriba).
 * @param {{ etapasCodigo: Record<string, number|null>, avance?: object[], piezas?: object[], terminadas?: Set<string>, hoy: string }} opciones
 */
export function procesosPlan(items = [], { etapasCodigo = {}, avance = [], piezas = [], terminadas = new Set(), hoy }) {
  const porOt = new Map();
  for (const i of items || []) {
    const ot = String(i.ot);
    if (!porOt.has(ot)) porOt.set(ot, new Map());
    const etapas = porOt.get(ot);
    const e = etapas.get(i.etapa) || { desde: i.fecha, hasta: i.fecha, horas: 0, porDia: new Map() };
    if (i.fecha < e.desde) e.desde = i.fecha;
    if (i.fecha > e.hasta) e.hasta = i.fecha;
    const h = Number(i.horas) || 0;
    e.horas += h;
    e.porDia.set(i.fecha, (e.porDia.get(i.fecha) || 0) + h);
    etapas.set(i.etapa, e);
  }
  const out = new Map();
  for (const [ot, etapas] of porOt) {
    const procesos = ETAPAS_PLAN.filter((ep) => etapas.has(ep.id)).map((ep) => {
      const { porDia, ...e } = etapas.get(ep.id);
      const falta = terminadas.has(ot) ? 0 : pendienteEtapa({ ot, codigo: etapasCodigo?.[ep.id], avance, piezas });
      const completo = falta <= 0;
      const diasAtraso = completo ? 0 : Math.max(0, diasEntre(e.hasta, hoy));
      const hecho = Math.round((1 - falta) * 100);
      // Lo que el plan tenía hecho antes de hoy, en % de las horas del proceso
      const antes = [...porDia].reduce((s, [f, h]) => (f < hoy ? s + h : s), 0);
      const esperado = e.horas > 0 ? Math.round((antes / e.horas) * 100) : 0;
      return { etapa: ep.id, nombre: nombreEtapa[ep.id], ...e, hecho, esperado, completo, atrasado: diasAtraso > 0, diasAtraso, margen: false, motivoMargen: null };
    });
    procesos.forEach((q, i) => {
      if (q.completo || q.atrasado) return;
      const prev = procesos.slice(0, i).reverse().find((z) => !z.completo);
      const libres = prev ? Math.max(0, diasEntre(prev.hasta, q.desde) - 1) : 0; // días entre que termina el anterior y arranca este
      if (prev?.atrasado && diasEntre(hoy, q.desde) <= DIAS_JUSTO) {
        q.motivoMargen = `${prev.nombre} viene ${prev.diasAtraso} ${prev.diasAtraso === 1 ? "día" : "días"} atrasado y ${q.nombre} va después`;
      } else if (prev?.margen && libres <= 1) {
        q.motivoMargen = `${prev.nombre} viene justo y ${q.nombre} arranca enseguida`;
      } else if (q.desde <= hoy && q.hecho < q.esperado) {
        q.motivoMargen = `va ${q.hecho}% y el plan tenía ${q.esperado}% hasta ayer`;
      } else if (q.hasta === hoy) {
        q.motivoMargen = `hoy es su último día y va ${q.hecho}%`;
      }
      q.margen = !!q.motivoMargen;
    });
    out.set(ot, {
      ot,
      inicio: procesos.reduce((m, p) => (p.desde < m ? p.desde : m), procesos[0].desde),
      fin: procesos.reduce((m, p) => (p.hasta > m ? p.hasta : m), procesos[0].hasta),
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
