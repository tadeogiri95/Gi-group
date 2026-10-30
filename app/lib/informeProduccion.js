// app/lib/informeProduccion.js — Informe de producción del día, la semana o
// el mes (Tadeo, 29/10; migración 146). Sale solo cada noche (cron
// reporte-diario: email a administración y aviso a gerencia) y se pide a mano
// en Reportes → 🏭 Producción.
//
// Por cada OT trabajada o planificada en el período, y por cada proceso:
//   planificado  % del proceso que el plan confirmado ponía en el período
//                (la parte del proceso que el plan repartió en esos días)
//   hecho        % que se avanzó en el período: piezas escaneadas, o lo que
//                subió el checkeo manual (historial de la 146) o la etapa
//                firmada como terminada (avance_etapas, cuenta como 100 %)
//   al final     % del proceso al terminar el período
// Todo en % de avance, sin horas (Tadeo, 30/10).
// Lo que se hizo sin estar en el plan del período va marcado fuera del plan
// (Tadeo, 29/10) y no entra en el cumplimiento.
// Nota: parte de 0 y suma puntos, de a 0,1 (Tadeo, 29/10 y 30/10):
//   hasta 7 cumplimiento: % avanzado de lo planificado, sumando los procesos,
//          sin pasarse de lo planificado en cada uno (adelantar otro no compensa)
//   hasta 2 OT que llegan a su semana (plan vivo a la hora del informe)
//   hasta 1 procesos sin corrimiento del plan confirmado (ídem)
// Nunca menos de 1 (la columna nota de la 146 va de 1 a 10).
// Retrabajo (Tadeo, 30/10; migración 147): las horas cargadas en el período,
// por OT y proceso con su motivo. No cambia el % ni la nota.
// Lead time (Tadeo, 30/10; app/lib/leadTimeHoras.js): los procesos y las OT
// que terminaron en el período, en horas de trabajo.
import { ETAPAS_PLAN } from "./planificacion";
import { hoyArg } from "./dates";
import { textoMotivoRetrabajo } from "./retrabajo";
import { leadTimeDelPeriodo } from "./leadTimeHoras";

export const TIPOS_INFORME = [
  { id: "dia", label: "Día" },
  { id: "semana", label: "Semana" },
  { id: "mes", label: "Mes" },
];
export const PUNTOS_NOTA = { cumplimiento: 7, enSemana: 2, sinCorrimiento: 1 };
export const AVISO_MIGRACION_146 = "Para guardar los informes falta correr la migración 146 en Supabase.";

const DIA = 86400000;
const sumarDias = (f, n) => new Date(Date.parse(`${f}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10);
const redondear = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const diaDe = (ts) => hoyArg(new Date(ts));

/** Días del período (inclusive): el día, su semana de lunes a domingo, o su mes. */
export function periodoDe(tipo, fecha) {
  if (tipo === "semana") {
    const dow = new Date(`${fecha}T00:00:00Z`).getUTCDay();
    const desde = sumarDias(fecha, -((dow + 6) % 7));
    return { tipo, desde, hasta: sumarDias(desde, 6) };
  }
  if (tipo === "mes") {
    const [y, m] = fecha.split("-").map(Number);
    const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { tipo, desde: `${fecha.slice(0, 7)}-01`, hasta: `${fecha.slice(0, 7)}-${String(ultimo).padStart(2, "0")}` };
  }
  return { tipo: "dia", desde: fecha, hasta: fecha };
}

/** Los puntos de cada parte de la nota (de a 0,1), con su % y su máximo. */
export function partesNota({ cumplimiento, enSemana, sinCorrimiento } = {}) {
  return [
    { id: "cumplimiento", label: "Cumplimiento de lo planificado", pct: cumplimiento ?? null },
    { id: "enSemana", label: "OT que llegan a su semana", pct: enSemana ?? 100 },
    { id: "sinCorrimiento", label: "Procesos sin correrse del plan", pct: sinCorrimiento ?? 100 },
  ].map((p) => ({ ...p, max: PUNTOS_NOTA[p.id], puntos: p.pct == null ? null : redondear((Math.max(0, Math.min(100, p.pct)) / 100) * PUNTOS_NOTA[p.id]) }));
}

/** Nota: la suma de los puntos de las tres partes (de 0 a 100 cada una), de a 0,1. null si no había nada planificado. */
export function notaInforme(s) {
  if (s?.cumplimiento == null) return null;
  const suma = partesNota(s).reduce((t, p) => t + p.puntos, 0);
  return Math.max(1, Math.min(10, redondear(suma)));
}

/**
 * Arma el informe.
 * @param {{ periodo: { tipo: string, desde: string, hasta: string }, items?: object[], etapasCodigo?: Record<string, number|null>,
 *   piezas?: object[], pasos?: object[], manual?: object[], proyectos?: Map<string, object>, vivo?: Map<string, object> }} datos
 *   items: plan confirmado vigente (ot, etapa, fecha, horas)
 *   piezas: v_avance_piezas (ot, etapa = código, total, pasaron)
 *   pasos: pasos_pieza requeridos desde el primer día del período hasta hoy (ot, etapa, created_at)
 *   manual: historial del checkeo manual (ot, etapa = código, pct, created_at)
 *   avance: avance_etapas (ot, etapa = código, estado, terminada_at, aprobada_at)
 *   proyectos: por OT; su avance_manual cubre a las OT sin historial (antes de la 146)
 *   vivo: planVivo de ahora (para las OT que llegan a su semana y los corrimientos)
 *   retrabajos: retrabajos_ot (migración 147); cuentan los cargados en el período
 *   leadTime: leadTimeProcesos de todas las OT (cuentan las que terminaron algo en el período)
 */
export function calcularInforme({ periodo, items = [], etapasCodigo = {}, piezas = [], pasos = [], manual = [], avance = [], proyectos = new Map(), vivo = new Map(), retrabajos = [], leadTime = null }) {
  const { desde, hasta } = periodo;
  const k = (ot, etapa) => `${ot}|${etapa}`;
  // Horas del plan por proceso: todas y las del período
  const horas = new Map();
  for (const i of items || []) {
    const c = k(String(i.ot), i.etapa);
    const h = horas.get(c) || { total: 0, periodo: 0 };
    h.total += Number(i.horas) || 0;
    if (i.fecha >= desde && i.fecha <= hasta) h.periodo += Number(i.horas) || 0;
    horas.set(c, h);
  }
  const etapaDeCodigo = new Map(Object.entries(etapasCodigo || {}).filter(([, c]) => c != null).map(([id, c]) => [Number(c), id]));
  const filaPiezas = new Map((piezas || []).filter((f) => Number(f.total) > 0).map((f) => [k(String(f.ot), etapaDeCodigo.get(Number(f.etapa))), f]));
  // Escaneos en el período y después
  const escaneos = new Map();
  for (const p of pasos || []) {
    const id = etapaDeCodigo.get(Number(p.etapa));
    if (!id) continue;
    const c = k(String(p.ot), id);
    const e = escaneos.get(c) || { en: 0, despues: 0 };
    const d = diaDe(p.created_at);
    if (d >= desde && d <= hasta) e.en++;
    else if (d > hasta) e.despues++;
    escaneos.set(c, e);
  }
  // Checkeo manual: el % al empezar y al terminar el período. Una OT sin
  // historial (cargada antes de correr la 146, o si no se pudo guardar) toma el
  // último checkeo de la OT si se hizo en el período, como si antes fuera 0.
  const conHistorial = new Set((manual || []).map((m) => String(m.ot)));
  const marcas = [...(manual || [])];
  for (const p of proyectos?.values?.() || []) {
    const am = p?.avance_manual;
    if (!am?.activo || !am.at || conHistorial.has(String(p.ot))) continue;
    for (const [codigo, pct] of Object.entries(am.etapas || {})) marcas.push({ ot: p.ot, etapa: codigo, pct, created_at: am.at });
  }
  // Etapa firmada como terminada o aprobada: llegó al 100 % ese día
  for (const a of avance || []) {
    const ts = a.terminada_at || a.aprobada_at;
    if ((a.estado === "terminada" || a.estado === "aprobada") && ts) marcas.push({ ot: a.ot, etapa: a.etapa, pct: 100, created_at: ts });
  }
  const hist = new Map();
  for (const m of marcas.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    const id = etapaDeCodigo.get(Number(m.etapa));
    if (!id) continue;
    const c = k(String(m.ot), id);
    const h = hist.get(c) || { antes: 0, fin: 0, hay: false };
    const d = diaDe(m.created_at);
    // Lo firmado como terminado no baja con un checkeo posterior más bajo
    const pct = Math.max(Number(m.pct) || 0, h.cien ? 100 : 0);
    if (Number(m.pct) >= 100) h.cien = true;
    if (d < desde) { h.antes = pct; h.fin = pct; }
    else if (d <= hasta) { h.fin = pct; h.hay = true; }
    hist.set(c, h);
  }

  const claves = new Set([...[...horas].filter(([, h]) => h.periodo > 0).map(([c]) => c), ...[...escaneos].filter(([, e]) => e.en > 0).map(([c]) => c), ...[...hist].filter(([, h]) => h.hay).map(([c]) => c)]);
  const porOt = new Map();
  for (const c of claves) {
    const [ot, etapa] = c.split("|");
    const h = horas.get(c) || { total: 0, periodo: 0 };
    const planificado = h.total > 0 ? (h.periodo / h.total) * 100 : 0;
    let hecho = 0, alFinal = 0;
    // Manda el escaneo si el proceso tiene piezas escaneadas; si no, el checkeo manual
    const f = filaPiezas.get(c);
    const escaneado = f && (Number(f.pasaron) > 0 || escaneos.has(c));
    let fuente = null;
    if (escaneado) {
      fuente = "escaneo";
      const e = escaneos.get(c) || { en: 0, despues: 0 };
      hecho = (e.en / Number(f.total)) * 100;
      alFinal = (Math.max(0, Number(f.pasaron) - e.despues) / Number(f.total)) * 100;
    } else {
      const m = hist.get(c);
      if (m) { hecho = Math.max(0, m.fin - m.antes); alFinal = m.fin; fuente = "manual"; }
    }
    hecho = Math.min(100, hecho);
    const q = { etapa, nombre: ETAPAS_PLAN.find((x) => x.id === etapa)?.nombre || etapa,
      planificado: redondear(planificado), hecho: redondear(hecho), alFinal: redondear(Math.min(100, alFinal)), desvio: redondear(hecho - planificado),
      fuente, enPlan: h.total > 0, fueraDelPlan: !(planificado > 0) && hecho > 0 };
    if (!porOt.has(ot)) porOt.set(ot, []);
    porOt.get(ot).push(q);
  }

  const orden = new Map(ETAPAS_PLAN.map((e, i) => [e.id, i]));
  const ots = [...porOt].map(([ot, procesos]) => {
    procesos.sort((a, b) => orden.get(a.etapa) - orden.get(b.etapa));
    // De toda la OT: el promedio de sus procesos
    const prom = (campo) => redondear(procesos.reduce((t, q) => t + q[campo], 0) / procesos.length);
    const v = vivo?.get?.(ot);
    const p = proyectos?.get?.(ot);
    // Fuera del plan: se avanzó sin nada planificado para la OT en el período
    const sinPlan = procesos.every((q) => !(q.planificado > 0));
    return {
      ot, cliente: p?.cliente || null, descripcion: p?.descripcion || null, procesos,
      planificado: prom("planificado"), hecho: prom("hecho"), alFinal: prom("alFinal"), desvio: redondear(prom("hecho") - prom("planificado")),
      diasCorrido: v?.diasCorrido || 0, diasTarde: v?.diasTarde || 0, tarde: !!v?.tarde,
      fueraDelPlan: sinPlan && procesos.some((q) => q.hecho > 0), enOtroPlan: sinPlan && procesos.some((q) => q.enPlan),
    };
  }).sort((a, b) => a.desvio - b.desvio || a.ot.localeCompare(b.ot, "es", { numeric: true }));

  // Cumplimiento: % avanzado de lo planificado, sumando los procesos, sin pasarse en cada uno
  const todos = ots.flatMap((o) => o.procesos);
  const plan = todos.reduce((t, q) => t + q.planificado, 0);
  const cumplido = todos.reduce((t, q) => t + Math.min(q.hecho, q.planificado), 0);
  const cumplimiento = plan > 0 ? redondear(Math.min(100, (cumplido / plan) * 100)) : null;
  // Plan vivo de ahora: OT que llegan a su semana y procesos sin correrse
  const abiertas = [...(vivo?.values?.() || [])].filter((r) => (r.procesos || []).some((q) => !q.completo));
  const procesosAbiertos = abiertas.flatMap((r) => r.procesos.filter((q) => !q.completo));
  const enSemana = abiertas.length ? redondear((abiertas.filter((r) => !r.tarde).length / abiertas.length) * 100) : 100;
  const sinCorrimiento = procesosAbiertos.length ? redondear((procesosAbiertos.filter((q) => !(q.diasCorrido > 0)).length / procesosAbiertos.length) * 100) : 100;
  const nota = notaInforme({ cumplimiento, enSemana, sinCorrimiento });
  // Retrabajo (147): las horas cargadas en el período, por proceso; no cambia la nota
  const rt = (retrabajos || []).filter((x) => { const d = diaDe(x.created_at); return d >= desde && d <= hasta && Number(x.horas) > 0; })
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((x) => ({ ot: String(x.ot), etapa: x.etapa, nombre: ETAPAS_PLAN.find((e) => e.id === x.etapa)?.nombre || x.etapa,
      horas: redondear(Number(x.horas)), motivo: textoMotivoRetrabajo(x), terminado: !!x.terminado_at, cliente: proyectos?.get?.(String(x.ot))?.cliente || null }));
  for (const o of ots) {
    const h = rt.filter((x) => x.ot === o.ot).reduce((t, x) => t + x.horas, 0);
    if (h > 0) o.retrabajo = redondear(h);
  }
  return {
    periodo: { tipo: periodo.tipo, desde, hasta },
    ots,
    retrabajos: rt,
    leadTime: leadTimeDelPeriodo(leadTime, { desde, hasta }, proyectos),
    resumen: {
      ots: ots.length, procesosPlanificados: todos.filter((q) => q.planificado > 0).length,
      procesosCumplidos: todos.filter((q) => q.planificado > 0 && q.hecho >= q.planificado).length,
      cumplimiento, enSemana, sinCorrimiento,
      otsAbiertas: abiertas.length, otsTarde: abiertas.filter((r) => r.tarde).length,
      otsFueraDelPlan: ots.filter((o) => o.fueraDelPlan).length,
      procesosFueraDelPlan: todos.filter((q) => q.fueraDelPlan).length,
      procesosAbiertos: procesosAbiertos.length, procesosCorridos: procesosAbiertos.filter((q) => q.diasCorrido > 0).length,
      horasRetrabajo: redondear(rt.reduce((t, x) => t + x.horas, 0)), otsConRetrabajo: new Set(rt.map((x) => x.ot)).size,
    },
    nota,
  };
}

/** Cómo se calcula la nota, con los números de este informe (va en el informe, Tadeo 29/10). */
export function explicacionNota(r) {
  const s = r?.resumen || {};
  if (r?.nota == null) return "No había nada planificado en el período: no hay nota.";
  const fmt = (n) => String(redondear(n)).replace(".", ",");
  const [c, e, n] = partesNota(s);
  return `La nota parte de 0 y suma puntos: cumplimiento ${fmt(c.pct)} % (avance hecho de lo planificado) da ${fmt(c.puntos)} de ${c.max}; `
    + `OT que llegan a su semana ${fmt(e.pct)} % da ${fmt(e.puntos)} de ${e.max}; `
    + `procesos sin correrse del plan ${fmt(n.pct)} % da ${fmt(n.puntos)} de ${n.max}. Total: ${fmt(r.nota)} de 10.`
    + (s.procesosFueraDelPlan ? " Lo que se hizo fuera del plan no cuenta en el cumplimiento." : "")
    + (s.horasRetrabajo ? " El retrabajo no cambia la nota." : "");
}

/** Texto corto para el aviso al celular. */
export function textoPushInforme(r) {
  const s = r.resumen;
  const fuera = (s.otsFueraDelPlan ? ` · ${s.otsFueraDelPlan} fuera del plan` : "")
    + (s.horasRetrabajo ? ` · 🔁 ${String(s.horasRetrabajo).replace(".", ",")} h de retrabajo` : "");
  return r.nota == null
    ? `${s.ots} OT trabajadas${fuera}. No había nada planificado.`
    : `Nota ${String(r.nota).replace(".", ",")} · cumplimiento ${String(s.cumplimiento).replace(".", ",")} % · ${s.ots} OT trabajadas${fuera}`;
}

/** El informe no tiene nada que contar (ni planificado ni hecho). */
export const informeVacio = (r) => !r?.ots?.length && !r?.retrabajos?.length;
