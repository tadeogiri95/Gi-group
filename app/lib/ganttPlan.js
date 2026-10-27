// app/lib/ganttPlan.js — El plan de producción confirmado en el Gantt de OT y
// en ⏰ OT atrasadas del Panel (planificación de la producción; migración 138).
//
// Cada OT planificada muestra sus procesos (Corte, Canteado, Mecanizado,
// Armado) desde el primer hasta el último día que el plan les asigna. La fecha
// límite de un proceso es ese último día: si ya pasó y el proceso no está
// completo (todas sus piezas escaneadas en esa etapa, o la etapa terminada si
// no se escanea por pieza), el proceso está atrasado.
import { apiFetch, sb } from "./supabase";
import { CLAVE_PLANIFICACION, ETAPAS_PLAN, divisionPlan, etapasPlanDe, normalizarParametros } from "./planificacion";
import { pendienteEtapa } from "./cargaPlanta";
import { diasEntre } from "./semanaObjetivo";
import { porcentajeOt } from "./panelMantenimiento";

const nombreEtapa = Object.fromEntries(ETAPAS_PLAN.map((e) => [e.id, e.nombre]));
const largo = (p) => diasEntre(p.desde, p.hasta);

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
 * Procesos de cada OT planificada: Map<ot, { ot, inicio, fin, procesos, atrasados }>.
 * proceso = { etapa, nombre, desde, hasta, horas, hecho (0-100), completo, atrasado, diasAtraso }.
 * @param {{ etapasCodigo: Record<string, number|null>, avance?: object[], piezas?: object[], terminadas?: Set<string>, hoy: string }} opciones
 */
export function procesosPlan(items = [], { etapasCodigo = {}, avance = [], piezas = [], terminadas = new Set(), hoy }) {
  const porOt = new Map();
  for (const i of items || []) {
    const ot = String(i.ot);
    if (!porOt.has(ot)) porOt.set(ot, new Map());
    const etapas = porOt.get(ot);
    const e = etapas.get(i.etapa) || { desde: i.fecha, hasta: i.fecha, horas: 0 };
    if (i.fecha < e.desde) e.desde = i.fecha;
    if (i.fecha > e.hasta) e.hasta = i.fecha;
    e.horas += Number(i.horas) || 0;
    etapas.set(i.etapa, e);
  }
  const out = new Map();
  for (const [ot, etapas] of porOt) {
    const procesos = ETAPAS_PLAN.filter((ep) => etapas.has(ep.id)).map((ep) => {
      const e = etapas.get(ep.id);
      const falta = terminadas.has(ot) ? 0 : pendienteEtapa({ ot, codigo: etapasCodigo?.[ep.id], avance, piezas });
      const completo = falta <= 0;
      const diasAtraso = completo ? 0 : Math.max(0, diasEntre(e.hasta, hoy));
      return { etapa: ep.id, nombre: nombreEtapa[ep.id], ...e, hecho: Math.round((1 - falta) * 100), completo, atrasado: diasAtraso > 0, diasAtraso };
    });
    out.set(ot, {
      ot,
      inicio: procesos.reduce((m, p) => (p.desde < m ? p.desde : m), procesos[0].desde),
      fin: procesos.reduce((m, p) => (p.hasta > m ? p.hasta : m), procesos[0].hasta),
      procesos,
      atrasados: procesos.filter((p) => p.atrasado),
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
