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
import { apiFetch, sb, sbGetAll } from "./supabase";
import { CLAVE_PLANIFICACION, ETAPAS_PLAN, divisionPlan, etapasPlanDe, normalizarParametros } from "./planificacion";
import { pendienteEtapa, capacidadPlanta, operariosDePlanta, personalPlanta } from "./cargaPlanta";
import { diasEntre } from "./semanaObjetivo";
import { porcentajeOt } from "./panelMantenimiento";
import { HORAS_SEMANA_POR_DEFECTO, MAQUINAS_PLAN, calendario, secuenciar } from "./secuencia";

export { HORAS_SEMANA_POR_DEFECTO };
const DIA_MS = 86400000;
const sumarDias = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);

const nombreEtapa = Object.fromEntries(ETAPAS_PLAN.map((e) => [e.id, e.nombre]));
const DIAS_JUSTO = 2; // con el anterior atrasado, si este arranca en 2 días o menos ya no hay margen

/**
 * Lo que toca cada día según los planes confirmados: de cada división manda
 * solo el último que se confirmó, entero (Tadeo, 29/10: con un plan de 1 OT
 * confirmado, el Gantt seguía mostrando las OT de los días ya pasados de los
 * planes anteriores).
 */
/** El último plan confirmado de una división (null = toda la planta), o null. */
export function planVigente(planes = [], divisionId = null) {
  const clave = (x) => `${x.confirmado_at || ""}|${x.desde || ""}`;
  return (planes || []).filter((p) => (p.division_id || null) === (divisionId || null))
    .reduce((a, p) => (!a || clave(p) > clave(a) ? p : a), null);
}

export function itemsVigentes(planes = []) {
  const ultimo = new Map();
  for (const p of planes || []) {
    const k = p.division_id || "";
    const otro = ultimo.get(k);
    const clave = (x) => `${x.confirmado_at || ""}|${x.desde || ""}`;
    if (!otro || clave(p) > clave(otro)) ultimo.set(k, p);
  }
  return [...ultimo.values()].flatMap((p) => p.items || []);
}

/** Días de horas extra de esos mismos planes (los que confirmó gerencia según fechas objetivo). */
export function diasExtraVigentes(planes = []) {
  const ultimo = new Map();
  for (const p of planes || []) {
    const k = p.division_id || "";
    const otro = ultimo.get(k);
    const clave = (x) => `${x.confirmado_at || ""}|${x.desde || ""}`;
    if (!otro || clave(p) > clave(otro)) ultimo.set(k, p);
  }
  return new Set([...ultimo.values()].flatMap((p) => (p.dias_extra || []).map((d) => d.fecha)));
}

/**
 * Horas de trabajo de cada día de la semana según la grilla de horarios del
 * personal operativo de la planta (los que suman capacidad en la
 * planificación): del primero que entra al último que sale. Un día sin nadie
 * puesto vale 0 y no se planifica. Sin grilla, HORAS_SEMANA_POR_DEFECTO.
 */
export function horasSemanaDeGrilla(empleados, divisiones, cfgValor) {
  const cfg = normalizarParametros(cfgValor);
  const operarios = operariosDePlanta(empleados, divisiones, divisionPlan(divisiones, cfg.division_id));
  // Una semana cualquiera: del domingo 4 al sábado 10 de enero de 2026
  const { porDia } = capacidadPlanta(operarios, Array.from({ length: 7 }, (_, i) => sumarDias("2026-01-04", i)));
  const horas = porDia.map((d) => Math.round(d.maquina * 100) / 100);
  return horas.some((h) => h > 0) ? horas : HORAS_SEMANA_POR_DEFECTO;
}

/**
 * Procesos de cada OT planificada, en secuencia: Map<ot, { ot, inicio, fin, horas, procesos, atrasados, pocoMargen }>.
 * Sale del plan confirmado con estas reglas (Tadeo, 27/10):
 *  - en cada OT un proceso arranca cuando termina el anterior;
 *  - por cada máquina pasa una sola OT a la vez: si dos OT tienen que cortarse
 *    el mismo día, el corte de la segunda arranca cuando termina el de la primera;
 *  - Armado se reparte entre los armadores (personal: crearArmado);
 *  - ningún proceso arranca antes del primer día que le dio el plan.
 * Cada proceso tiene por día las horas de la grilla de horarios del personal
 * operativo (horasSemana): un día sin nadie puesto no se trabaja, salvo los
 * días de horas extra del plan (diasExtra). Las OT van en el orden del plan
 * (la prioridad con que se planificó). Es el mismo cálculo que arma el plan en
 * 📊 Carga (secuencia.js), así que el Gantt muestra lo mismo que se confirmó.
 * proceso = { etapa, nombre, desde, hasta, ini, fin (qué parte del primer y del
 * último día ocupa, 0-1), horas (de reloj), personas (armadores, en Armado),
 * hecho (0-100), esperado, completo, atrasado, diasAtraso, margen, motivoMargen }.
 * Sin `personal`, Armado lo hace una persona por vez (como una máquina).
 * @param {{ etapasCodigo: Record<string, number|null>, avance?: object[], piezas?: object[], terminadas?: Set<string>, hoy: string, params?: object, horasSemana?: number[], personal?: { armadores: number, maxPorOt: number, ayudantes?: Record<string, number> } }} opciones
 */
export function procesosPlan(items = [], { etapasCodigo = {}, avance = [], piezas = [], terminadas = new Set(), hoy, params = null, horasSemana = HORAS_SEMANA_POR_DEFECTO, personal = null, diasExtra = null }) {
  const porOt = new Map();
  for (const i of items || []) {
    const ot = String(i.ot);
    if (!porOt.has(ot)) porOt.set(ot, { ot, primero: i.fecha, orden: Number(i.orden) || 0, horas: {}, desde: {}, enEtapa: {} });
    const o = porOt.get(ot);
    if (i.fecha < o.primero) o.primero = i.fecha;
    o.enEtapa[i.etapa] = Math.min(o.enEtapa[i.etapa] ?? Infinity, Number(i.orden) || 0);
    o.horas[i.etapa] = (o.horas[i.etapa] || 0) + (Number(i.horas) || 0);
    if (!o.desde[i.etapa] || i.fecha < o.desde[i.etapa]) o.desde[i.etapa] = i.fecha;
  }
  // El lugar de la OT es el de su primer proceso (con un orden propio por proceso, cada uno tiene el suyo)
  for (const o of porOt.values()) {
    const primera = ETAPAS_PLAN.find(({ id }) => id in o.enEtapa);
    if (primera) o.orden = o.enEtapa[primera.id];
  }
  const out = new Map();
  if (!porOt.size) return out;
  const ots = [...porOt.values()].sort((a, b) => a.orden - b.orden || a.primero.localeCompare(b.primero) || a.ot.localeCompare(b.ot, "es", { numeric: true }));
  const base = ots.reduce((m, o) => (o.primero < m ? o.primero : m), ots[0].primero);
  const cal = calendario(base, horasSemana, diasExtra);
  const tHoy = hoy < base ? 0 : cal.inicio(hoy);
  // Cada proceso en su orden (el de "OT por proceso"; si no se tocó, el de la OT)
  const lugar = new Map(ots.map((o, i) => [o.ot, i]));
  const ordenEtapa = Object.fromEntries(ETAPAS_PLAN.map(({ id }) => [id, ots.filter((o) => id in o.enEtapa)
    .sort((a, b) => a.enEtapa[id] - b.enEtapa[id] || lugar.get(a.ot) - lugar.get(b.ot)).map((o) => o.ot)]));
  // Ningún proceso antes del primer día que le dio el plan
  const tramos = secuenciar(ots.map((o) => ({ ...o, clave: o.ot })), {
    params, personal, ordenEtapa, inicio: (o, etapa) => (o.desde[etapa] ? cal.inicio(o.desde[etapa]) : 0),
  });

  for (const o of ots) {
    const procesos = tramos.get(o.ot).map(({ etapa, t0, t1, horas: h, personas }) => {
      const a = cal.punto(t0, false);
      const b = cal.punto(t1, true);
      const falta = terminadas.has(o.ot) ? 0 : pendienteEtapa({ ot: o.ot, codigo: etapasCodigo?.[etapa], avance, piezas });
      const completo = falta <= 0;
      const diasAtraso = completo ? 0 : Math.max(0, diasEntre(b.fecha, hoy));
      return {
        etapa, nombre: nombreEtapa[etapa], desde: a.fecha, hasta: b.fecha, ini: a.frac, fin: b.frac, t0, t1, horas: h, personas,
        hecho: Math.round((1 - falta) * 100),
        // Lo que tenía que estar hecho al empezar hoy, en % del proceso
        esperado: Math.round(Math.min(1, Math.max(0, (tHoy - t0) / h)) * 100),
        completo, atrasado: diasAtraso > 0, diasAtraso, margen: false, motivoMargen: null,
      };
    });
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
 * Armadores para el Gantt según los puestos de los operarios de la planta y
 * ⚙ Parámetros: los de Armado (y los sin puesto), hasta "máximo de armadores
 * por OT" en cada una, y los de cada máquina cuando se queda sin trabajo.
 */
export function personalGantt(empleados, divisiones, cfgValor) {
  const params = normalizarParametros(cfgValor);
  const operarios = operariosDePlanta(empleados, divisiones, divisionPlan(divisiones, params.division_id));
  // Sin operarios en la grilla, armado en una sola línea como antes
  if (!operarios.length) return null;
  const p = personalPlanta(operarios, params);
  // Sin puestos, los que pasan de cada máquina a Armado no pueden ser más que
  // los operarios que hay (29/10: con 1 operario no arman 4)
  let quedan = p.total;
  const deMaquina = (m) => {
    const n = p.categorizados ? p.porPuesto[m] : Math.min(p.necesarios[m], quedan);
    quedan -= n;
    return n;
  };
  return {
    armadores: p.armadores,
    maxPorOt: params.max_armadores_ot || 1,
    ayudantes: Object.fromEntries(MAQUINAS_PLAN.map((m) => [m, deMaquina(m)])),
  };
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

/**
 * Operarios activos con su grilla y su puesto (navegador). filtro: el inicio
 * de la consulta, p. ej. "empresa_id=eq.1&". Sin la migración 116 no hay
 * es_instalador; sin la 140, no hay puesto_planta.
 */
export function leerOperariosPlanta(filtro = "", campos = "id,rol,division,diagrama,activo") {
  const leer = (extra) => sbGetAll(`empleados?${filtro}activo=eq.true&rol=eq.operativo&select=${campos}${extra}`, { maxFilas: 5000 });
  return leer(",es_instalador,puesto_planta").catch(() => leer(",es_instalador")).catch(() => leer(""));
}

/** Lee los planes confirmados, los parámetros y la grilla de horarios del personal operativo (navegador). Sin la migración 138, planes vacío. */
export async function leerPlanesConfirmados() {
  const empleados = () => leerOperariosPlanta();
  const [r, cfg, emp] = await Promise.all([
    apiFetch("/api/planificacion?confirmados=1").then((x) => (x.ok ? x.json() : null)).catch(() => null),
    sb.get(`config_sistema?clave=eq.${CLAVE_PLANIFICACION}&select=valor&limit=1`).catch(() => null),
    empleados().catch(() => null),
  ]);
  return { planes: r?.planes || [], cfgValor: cfg?.[0]?.valor || null, empleados: emp?.data || [], faltaMigracion: !!r?.falta_migracion };
}
