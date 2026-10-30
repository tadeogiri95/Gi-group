// app/lib/leadTimeHoras.js — Lead time por proceso y de la OT, en horas de
// trabajo con un decimal (Tadeo, 30/10).
//   Proceso: desde su primer avance (primer escaneo o primera carga del
//            checkeo manual) hasta que llega al 100 % (la última pieza
//            escaneada, el checkeo manual en 100 % o la etapa firmada como
//            terminada; lo que pase primero).
//   OT:      desde el primer avance de cualquier proceso hasta que Armado
//            llega al 100 %.
// Horas de trabajo: solo cuentan las horas en que la planta trabaja según la
// grilla de horarios de los operarios (desde que entra el primero hasta que
// sale el último de cada día). Todo sale de lo que ya queda registrado
// (escaneos, historial del checkeo manual de la 146 y firmas de etapa).
import { ETAPAS_PLAN, divisionPlan, normalizarParametros } from "./planificacion";
import { HORAS_SEMANA_POR_DEFECTO } from "./secuencia";
import { operariosDePlanta, ventanasSemana } from "./cargaPlanta";

const HORA = 3600000;
const DIA = 86400000;
const ARG = 3 * HORA; // Argentina: UTC-3, sin horario de verano
const ms = (t) => (t ? Date.parse(t) : NaN);
const redondear = (n) => Math.round(n * 10) / 10;

/** Sin grilla cargada: de lunes a viernes de 8 a 16 (las 8 h por día del plan). */
export const VENTANAS_POR_DEFECTO = HORAS_SEMANA_POR_DEFECTO.map((h) => (h > 0 ? { ini: 8 * 60, fin: 8 * 60 + h * 60 } : null));

/** Horario de la planta de cada día de la semana, con los operarios de la división que se planifica. */
export function ventanasDeGrilla(empleados, divisiones, cfgValor) {
  const cfg = normalizarParametros(cfgValor);
  const vs = ventanasSemana(operariosDePlanta(empleados, divisiones, divisionPlan(divisiones, cfg.division_id)));
  return vs.some(Boolean) ? vs : VENTANAS_POR_DEFECTO;
}

/**
 * Horas de trabajo entre dos momentos, con un decimal; null si falta alguno.
 * @param {(null|{ini:number, fin:number})[]} ventanas  horario de cada día de la semana (0 = domingo), en minutos
 */
export function horasTrabajo(desde, hasta, ventanas = VENTANAS_POR_DEFECTO) {
  const a = ms(desde), b = ms(hasta);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  const vs = ventanas?.some(Boolean) ? ventanas : VENTANAS_POR_DEFECTO;
  let total = 0;
  // Desde el día anterior (un turno que cruza la medianoche) hasta el último
  const dia0 = Math.floor((a - ARG) / DIA) - 1;
  const dia1 = Math.floor((b - ARG) / DIA);
  for (let d = dia0; d <= dia1; d++) {
    const v = vs[((d + 4) % 7 + 7) % 7]; // el día 0 (1/1/1970) fue jueves
    if (!v) continue;
    const ini = d * DIA + ARG + v.ini * 60000;
    const fin = d * DIA + ARG + v.fin * 60000;
    total += Math.max(0, Math.min(fin, b) - Math.max(ini, a));
  }
  return redondear(total / HORA);
}

const primero = (ts) => ts.filter((t) => Number.isFinite(ms(t))).sort((x, y) => ms(x) - ms(y))[0] ?? null;

/**
 * Inicio, fin y horas de cada proceso de cada OT, y de la OT entera.
 * @param {{ ots?: string[], etapasCodigo: Record<string, number|null>, piezas?: object[], manual?: object[], avance?: object[], proyectos?: object[], ventanas?: object[], ahora?: Date }} datos
 *   piezas: v_avance_piezas (ot, etapa, total, pasaron, primer_paso, ultimo_paso), sin el checkeo manual mezclado
 *   manual: avance_manual_historial (ot, etapa = código, pct, created_at)
 *   avance: avance_etapas (ot, etapa, estado, terminada_at, aprobada_at)
 *   proyectos: su avance_manual cubre a las OT sin historial (antes de la 146)
 * @returns {Map<string, { ot, inicio, fin, horas, lleva, procesos: { etapa, nombre, inicio, fin, horas, lleva }[] }>}
 *   horas: de inicio a fin (null si no terminó); lleva: de inicio a ahora si no terminó
 */
export function leadTimeProcesos({ ots = null, etapasCodigo = {}, piezas = [], manual = [], avance = [], proyectos = [], ventanas, ahora = new Date() }) {
  const k = (ot, codigo) => `${ot}|${Number(codigo)}`;
  const ini = new Map(), fin = new Map();
  const anotar = (m, c, t) => { if (Number.isFinite(ms(t)) && (!m.has(c) || ms(t) < ms(m.get(c)))) m.set(c, t); };
  for (const f of piezas || []) {
    if (!(Number(f.total) > 0) || f.manual) continue;
    const c = k(f.ot, f.etapa);
    if (Number(f.pasaron) > 0) anotar(ini, c, f.primer_paso);
    if (Number(f.pasaron) >= Number(f.total)) anotar(fin, c, f.ultimo_paso);
  }
  const conHistorial = new Set();
  for (const m of manual || []) {
    conHistorial.add(String(m.ot));
    const c = k(m.ot, m.etapa);
    if (Number(m.pct) > 0) anotar(ini, c, m.created_at);
    if (Number(m.pct) >= 100) anotar(fin, c, m.created_at);
  }
  for (const p of proyectos || []) {
    const am = p?.avance_manual;
    if (!am?.activo || !am.at || conHistorial.has(String(p.ot))) continue;
    for (const [codigo, pct] of Object.entries(am.etapas || {})) {
      if (Number(pct) > 0) anotar(ini, k(p.ot, codigo), am.at);
      if (Number(pct) >= 100) anotar(fin, k(p.ot, codigo), am.at);
    }
  }
  for (const a of avance || []) {
    if (a.estado === "terminada" || a.estado === "aprobada") anotar(fin, k(a.ot, a.etapa), a.terminada_at || a.aprobada_at);
  }

  const lista = ots ? ots.map(String) : [...new Set([...ini.keys()].map((c) => c.split("|")[0]))];
  const out = new Map();
  const ahoraIso = ahora.toISOString();
  for (const ot of lista) {
    const procesos = [];
    for (const { id, nombre } of ETAPAS_PLAN) {
      const codigo = etapasCodigo?.[id];
      if (codigo == null) continue;
      const i = ini.get(k(ot, codigo)) || null;
      if (!i) continue;
      const f = fin.get(k(ot, codigo));
      const termino = f && ms(f) >= ms(i) ? f : null;
      procesos.push({ etapa: id, nombre, inicio: i, fin: termino,
        horas: termino ? horasTrabajo(i, termino, ventanas) : null, lleva: termino ? null : horasTrabajo(i, ahoraIso, ventanas) });
    }
    if (!procesos.length) continue;
    const inicio = primero(procesos.map((q) => q.inicio));
    const armado = procesos.find((q) => q.etapa === "armado");
    const terminada = armado?.fin || null;
    out.set(ot, { ot, inicio, fin: terminada, procesos,
      horas: terminada ? horasTrabajo(inicio, terminada, ventanas) : null, lleva: terminada ? null : horasTrabajo(inicio, ahoraIso, ventanas) });
  }
  return out;
}

const diaArg = (t) => new Date(ms(t) - ARG).toISOString().slice(0, 10);
const enPeriodo = (t, desde, hasta) => !!t && diaArg(t) >= desde && diaArg(t) <= hasta;
const promedio = (xs) => (xs.length ? redondear(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

/**
 * Lo que terminó en el período: procesos y OT (Armado al 100 %), con el
 * promedio de cada proceso y de la OT completa.
 * @returns {{ promedios: { etapa, nombre, cantidad, promedio }[], ots: object[] }}
 *   ots: las OT con algún proceso terminado en el período, con solo esos procesos
 */
export function leadTimeDelPeriodo(lead, { desde, hasta }, datosOt = new Map()) {
  const ots = [];
  for (const o of lead?.values?.() || []) {
    const procesos = o.procesos.filter((q) => q.horas != null && enPeriodo(q.fin, desde, hasta));
    if (!procesos.length) continue;
    const terminada = o.horas != null && enPeriodo(o.fin, desde, hasta);
    const p = datosOt.get?.(o.ot);
    ots.push({ ot: o.ot, cliente: p?.cliente || null, procesos: procesos.map(({ etapa, nombre, horas }) => ({ etapa, nombre, horas })),
      horas: terminada ? o.horas : null, fin: terminada ? o.fin : null });
  }
  ots.sort((a, b) => (b.horas != null) - (a.horas != null) || a.ot.localeCompare(b.ot, "es", { numeric: true }));
  const promedios = [
    ...ETAPAS_PLAN.map(({ id, nombre }) => {
      const hs = ots.flatMap((o) => o.procesos.filter((q) => q.etapa === id).map((q) => q.horas));
      return { etapa: id, nombre, cantidad: hs.length, promedio: promedio(hs) };
    }),
    (() => { const hs = ots.filter((o) => o.horas != null).map((o) => o.horas); return { etapa: "ot", nombre: "OT completa", cantidad: hs.length, promedio: promedio(hs) }; })(),
  ].filter((x) => x.cantidad > 0);
  return { promedios, ots };
}

/** "12,5 h" */
export const fmtHoras = (h) => (h == null ? "—" : `${String(redondear(h)).replace(".", ",")} h`);
