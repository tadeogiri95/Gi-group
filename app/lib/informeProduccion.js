// app/lib/informeProduccion.js — Informe de producción del día, la semana o
// el mes (Tadeo, 29/10; migración 146). Sale solo cada noche (cron
// reporte-diario: email a administración y aviso a gerencia) y se pide a mano
// en Reportes → 🏭 Producción.
//
// Por cada OT trabajada o planificada en el período, y por cada proceso:
//   planificado  % del proceso que el plan confirmado ponía en el período
//                (horas del plan en esos días / horas del proceso en el plan)
//   hecho        % que se avanzó en el período: piezas escaneadas, o lo que
//                subió el checkeo manual (historial de la 146) o la etapa
//                firmada como terminada (avance_etapas, cuenta como 100 %)
//   al final     % del proceso al terminar el período
//   desvío       hecho − planificado (puntos)
// Lo que se hizo sin estar en el plan del período va marcado fuera del plan
// (Tadeo, 29/10) y no entra en el cumplimiento.
// Nota del 1 al 10, de a 0,5 (Tadeo, 29/10):
//   70 % cumplimiento: lo hecho de lo planificado, en horas, sin pasarse de lo
//        planificado en cada proceso (adelantar otro no compensa)
//   20 % OT que llegan a su semana (plan vivo a la hora del informe)
//   10 % procesos sin corrimiento del plan confirmado (ídem)
import { ETAPAS_PLAN } from "./planificacion";
import { hoyArg } from "./dates";

export const TIPOS_INFORME = [
  { id: "dia", label: "Día" },
  { id: "semana", label: "Semana" },
  { id: "mes", label: "Mes" },
];
export const PESOS_NOTA = { cumplimiento: 0.7, enSemana: 0.2, sinCorrimiento: 0.1 };
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

/** Nota del 1 al 10, de a 0,5, con los tres números de 0 a 100. null si no había nada planificado. */
export function notaInforme({ cumplimiento, enSemana, sinCorrimiento }) {
  if (cumplimiento == null) return null;
  const x = PESOS_NOTA.cumplimiento * cumplimiento + PESOS_NOTA.enSemana * (enSemana ?? 100) + PESOS_NOTA.sinCorrimiento * (sinCorrimiento ?? 100);
  return Math.max(1, Math.min(10, Math.round((x / 10) * 2) / 2));
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
 */
export function calcularInforme({ periodo, items = [], etapasCodigo = {}, piezas = [], pasos = [], manual = [], avance = [], proyectos = new Map(), vivo = new Map() }) {
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
    const q = { etapa, nombre: ETAPAS_PLAN.find((x) => x.id === etapa)?.nombre || etapa, horas: redondear(h.total), horasPlan: redondear(h.periodo),
      planificado: redondear(planificado), hecho: redondear(hecho), alFinal: redondear(Math.min(100, alFinal)), desvio: redondear(hecho - planificado),
      fuente, fueraDelPlan: h.periodo <= 0 && hecho > 0, horasHechas: (hecho / 100) * h.total };
    if (!porOt.has(ot)) porOt.set(ot, []);
    porOt.get(ot).push(q);
  }

  const orden = new Map(ETAPAS_PLAN.map((e, i) => [e.id, i]));
  const ots = [...porOt].map(([ot, procesos]) => {
    procesos.sort((a, b) => orden.get(a.etapa) - orden.get(b.etapa));
    // De toda la OT: pesado por las horas de cada proceso (o parejo si el plan no tiene horas)
    const pesos = procesos.map((q) => q.horas || 0);
    const total = pesos.reduce((t, x) => t + x, 0);
    const prom = (campo) => redondear(total > 0 ? procesos.reduce((t, q, i) => t + q[campo] * pesos[i], 0) / total : procesos.reduce((t, q) => t + q[campo], 0) / procesos.length);
    const v = vivo?.get?.(ot);
    const p = proyectos?.get?.(ot);
    // Fuera del plan: se avanzó sin nada planificado para la OT en el período
    const sinPlan = procesos.every((q) => !(q.horasPlan > 0));
    return {
      ot, cliente: p?.cliente || null, descripcion: p?.descripcion || null, procesos,
      planificado: prom("planificado"), hecho: prom("hecho"), alFinal: prom("alFinal"), desvio: redondear(prom("hecho") - prom("planificado")),
      diasCorrido: v?.diasCorrido || 0, diasTarde: v?.diasTarde || 0, tarde: !!v?.tarde,
      fueraDelPlan: sinPlan && procesos.some((q) => q.hecho > 0), enOtroPlan: sinPlan && procesos.some((q) => q.horas > 0),
    };
  }).sort((a, b) => a.desvio - b.desvio || a.ot.localeCompare(b.ot, "es", { numeric: true }));

  // Cumplimiento: horas hechas de las planificadas, sin pasarse en cada proceso
  const todos = ots.flatMap((o) => o.procesos);
  const horasPlan = todos.reduce((t, q) => t + q.horasPlan, 0);
  const horasCumplidas = todos.reduce((t, q) => t + Math.min(q.horasHechas, q.horasPlan), 0);
  const horasHechas = todos.reduce((t, q) => t + q.horasHechas, 0);
  const cumplimiento = horasPlan > 0 ? redondear(Math.min(100, (horasCumplidas / horasPlan) * 100)) : null;
  // Plan vivo de ahora: OT que llegan a su semana y procesos sin correrse
  const abiertas = [...(vivo?.values?.() || [])].filter((r) => (r.procesos || []).some((q) => !q.completo));
  const procesosAbiertos = abiertas.flatMap((r) => r.procesos.filter((q) => !q.completo));
  const enSemana = abiertas.length ? redondear((abiertas.filter((r) => !r.tarde).length / abiertas.length) * 100) : 100;
  const sinCorrimiento = procesosAbiertos.length ? redondear((procesosAbiertos.filter((q) => !(q.diasCorrido > 0)).length / procesosAbiertos.length) * 100) : 100;
  const nota = notaInforme({ cumplimiento, enSemana, sinCorrimiento });
  for (const q of todos) delete q.horasHechas;
  return {
    periodo: { tipo: periodo.tipo, desde, hasta },
    ots,
    resumen: {
      ots: ots.length, horasPlan: redondear(horasPlan), horasHechas: redondear(horasHechas),
      cumplimiento, enSemana, sinCorrimiento,
      otsAbiertas: abiertas.length, otsTarde: abiertas.filter((r) => r.tarde).length,
      otsFueraDelPlan: ots.filter((o) => o.fueraDelPlan).length,
      procesosFueraDelPlan: todos.filter((q) => q.fueraDelPlan).length,
      procesosAbiertos: procesosAbiertos.length, procesosCorridos: procesosAbiertos.filter((q) => q.diasCorrido > 0).length,
    },
    nota,
  };
}

/** Cómo se calcula la nota, con los números de este informe (va en el informe, Tadeo 29/10). */
export function explicacionNota(r) {
  const s = r?.resumen || {};
  if (r?.nota == null) return "No había nada planificado en el período: no hay nota.";
  const fmt = (n) => String(redondear(n)).replace(".", ",");
  return `Nota = 70 % del cumplimiento (${fmt(s.cumplimiento)} %: horas hechas de las planificadas, sin contar lo que se adelantó de más en cada proceso) `
    + `+ 20 % de las OT que llegan a su semana (${fmt(s.enSemana)} %) `
    + `+ 10 % de los procesos que no se corrieron del plan confirmado (${fmt(s.sinCorrimiento)} %). `
    + `Da ${fmt((PESOS_NOTA.cumplimiento * s.cumplimiento + PESOS_NOTA.enSemana * s.enSemana + PESOS_NOTA.sinCorrimiento * s.sinCorrimiento) / 10)} sobre 10 y se redondea de a 0,5: ${fmt(r.nota)}.`
    + (s.procesosFueraDelPlan ? " Lo que se hizo fuera del plan no cuenta en el cumplimiento." : "");
}

/** Texto corto para el aviso al celular. */
export function textoPushInforme(r) {
  const s = r.resumen;
  const fuera = s.otsFueraDelPlan ? ` · ${s.otsFueraDelPlan} fuera del plan` : "";
  return r.nota == null
    ? `${s.ots} OT trabajadas${fuera}. No había nada planificado.`
    : `Nota ${String(r.nota).replace(".", ",")} · cumplimiento ${String(s.cumplimiento).replace(".", ",")} % · ${s.ots} OT trabajadas${fuera}`;
}

/** El informe no tiene nada que contar (ni planificado ni hecho). */
export const informeVacio = (r) => !r?.ots?.length;
