// app/lib/planInstalacion.js — Plan vivo de la instalación (parte 43; diseño
// en notes/diseno-gantt-instalacion.md).
//
// Tadeo (02/11): la SEMANA es la entrega del proyecto ya instalado. Cada OT de
// Muebles entra a la instalación el día hábil siguiente a que termina su
// producción (plan vivo del Gantt de producción, o ya terminada). No hay
// cuadrillas fijas: cada OT lleva sus instaladores (2 por defecto) y sus días
// de obra (app/lib/instalacionPlan.js); las OT de la misma obra se instalan
// juntas y se reparten la gente (por ejemplo, 2 OT de 2 = 4 instaladores).
// Un dúo puede hacer dos trabajos cortos el mismo día: se planifica de a
// medio día (mañana y tarde). Cada instalador trabaja los días de su grilla de
// horarios; los feriados no se trabajan.
//
// Orden: prioridad de instalación (153), después la fecha de entrega, después
// el fin de producción. Cada obra va al primer medio día en que haya gente
// libre para hacerla seguida.
import { diasInstalacion, medioDia } from "./instalacionPlan";
import { normalizar } from "./rutas";
import { diasEntre } from "./semanaObjetivo";

const DIA_MS = 86400000;
const DIAS_KEY = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
export const HORIZONTE_DIAS = 400;
const sumarDias = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const diaSemana = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/** Lunes a viernes sin feriado (para "fin de producción + 1 día hábil"). */
export const esDiaHabil = (fecha, feriados = null) => {
  const d = diaSemana(fecha);
  return d >= 1 && d <= 5 && !feriados?.has(fecha);
};

/** El primer día hábil después de `fecha`. */
export function diaHabilSiguiente(fecha, feriados = null) {
  let f = sumarDias(fecha, 1);
  for (let i = 0; i < 30 && !esDiaHabil(f, feriados); i++) f = sumarDias(f, 1);
  return f;
}

/** El instalador trabaja ese día según su grilla (sin grilla cargada: lunes a viernes). */
export function trabajaElDia(instalador, fecha, feriados = null) {
  if (feriados?.has(fecha)) return false;
  const d = instalador?.diagrama;
  if (!d || typeof d !== "object" || !Object.keys(d).length) return esDiaHabil(fecha);
  const t = d[DIAS_KEY[diaSemana(fecha)]];
  return !!(t && t.in && t.out && t.in !== t.out);
}

/** Clave de la obra: cliente + obra sin tildes ni mayúsculas; sin obra, la OT sola. */
export function claveObra(p) {
  const obra = normalizar(p?.obra || "").trim();
  if (!obra) return `ot:${p?.ot}`;
  return `obra:${normalizar(p?.cliente || "").trim()}|${obra}`;
}

const numeroOt = (ot) => Number(String(ot).replace(/\D/g, "")) || 0;
const conPrioridad = (n) => Number.isInteger(n) && n > 0;

/**
 * Las OT que van a la instalación, agrupadas por obra.
 * @param {object} a
 * @param {object[]} a.proyectos OT abiertas de la división
 * @param {Map<string, {fin: string}>} a.finProduccion fin de producción del plan vivo, por OT
 * @param {Set<string>} a.producidas OT con la producción ya terminada (Armado al 100 %)
 * @param {Set<string>} a.instaladas OT con el acta de instalación firmada
 * @param {Set<string>} a.pausadas OT en pausa (151)
 * @param {Map<string, number>} a.avance % de instalación (último reporte), por OT
 * @returns {{ trabajos: object[], sinProduccion: object[], sinDato: object[] }}
 *   trabajos: una por obra, con sus OT, días de una persona que faltan, instaladores y desde cuándo puede arrancar
 *   sinProduccion: OT sin plan de producción y sin terminar (no se sabe cuándo salen)
 *   sinDato: OT sin días de instalación (faltan gabinetes o el parámetro)
 */
export function trabajosInstalacion({ proyectos = [], finProduccion = new Map(), producidas = new Set(), instaladas = new Set(), pausadas = new Set(), avance = new Map(), params, inst, modulos = new Map(), hoy, feriados = null, maxPersonas = Infinity }) {
  const porObra = new Map();
  const sinProduccion = [], sinDato = [];
  for (const p of proyectos) {
    const ot = String(p.ot);
    if (p.estado === "cerrado" || instaladas.has(ot) || pausadas.has(ot)) continue;
    const fin = finProduccion.get(ot)?.fin || null;
    const lista = producidas.has(ot);
    if (!fin && !lista) { sinProduccion.push(p); continue; }
    const r = diasInstalacion(p, params, inst, { modulosEtiquetas: modulos.get(ot) || null });
    if (r.dias == null) { sinDato.push({ proyecto: p, motivo: r.sinDato }); continue; }
    const pct = Math.min(100, Math.max(0, Number(avance.get(ot)) || 0));
    const enCurso = pct > 0;
    // Fin de producción + 1 día hábil; ya producida (o empezada en obra), desde hoy
    let desde = lista || enCurso ? hoy : diaHabilSiguiente(fin, feriados);
    if (desde < hoy) desde = hoy;
    // Lo más temprano posible (fin de producción + 1 día hábil); una fecha
    // elegida a mano en el Gantt (157) solo puede correrla para después
    const minimo = desde;
    const fijada = /^\d{4}-\d{2}-\d{2}/.test(String(p.instalacion_desde || "")) ? String(p.instalacion_desde).slice(0, 10) : null;
    if (fijada && fijada > desde) desde = fijada;
    const k = claveObra(p);
    if (!porObra.has(k)) porObra.set(k, { clave: k, ots: [], diasPersona: 0, personas: 0, desde, minimo, fijada: null, esperaHasta: null, entrega: null, prioridad: null, finProduccion: null, enCurso: false });
    const t = porObra.get(k);
    if (minimo > t.minimo) t.minimo = minimo;
    if (fijada && (!t.fijada || fijada > t.fijada)) t.fijada = fijada;
    t.ots.push({ ot, proyecto: p, dias: r.dias, personas: r.personas, diasPersona: r.diasPersona * (1 - pct / 100), avance: pct, manual: r.manual, finProduccion: fin, producida: lista });
    t.diasPersona += r.diasPersona * (1 - pct / 100);
    t.personas += r.personas;
    if (desde > t.desde) t.desde = desde;
    if (fin && (!t.finProduccion || fin > t.finProduccion)) t.finProduccion = fin;
    if (p.fecha_objetivo && (!t.entrega || p.fecha_objetivo < t.entrega)) t.entrega = p.fecha_objetivo;
    const pr = Number(p.prioridad_instalacion);
    if (conPrioridad(pr) && (t.prioridad == null || pr < t.prioridad)) t.prioridad = pr;
    t.enCurso = t.enCurso || enCurso;
  }
  const trabajos = [...porObra.values()].map((t) => {
    const personas = Math.max(1, Math.min(t.personas, maxPersonas));
    const dias = t.diasPersona > 0 ? medioDia(t.diasPersona / personas) : 0;
    return { ...t, personas, dias, medios: Math.round(dias * 2) };
  }).filter((t) => t.medios > 0);
  return { trabajos: ordenarTrabajos(trabajos), sinProduccion, sinDato };
}

/**
 * En curso primero; después las que se movieron a mano a un día (157, por
 * fecha: así toman ese lugar y las demás se acomodan alrededor); después
 * prioridad de instalación, fecha de entrega, desde cuándo puede arrancar y
 * número de OT.
 */
export function ordenarTrabajos(trabajos) {
  return [...trabajos].sort((a, b) => {
    if (a.enCurso !== b.enCurso) return a.enCurso ? -1 : 1;
    if (!!a.fijada !== !!b.fijada) return a.fijada ? -1 : 1;
    if (a.fijada && b.fijada && a.fijada !== b.fijada) return a.fijada < b.fijada ? -1 : 1;
    const pa = conPrioridad(a.prioridad), pb = conPrioridad(b.prioridad);
    if (pa !== pb) return pa ? -1 : 1;
    if (pa && a.prioridad !== b.prioridad) return a.prioridad - b.prioridad;
    const ea = a.entrega || "9999", eb = b.entrega || "9999";
    if (ea !== eb) return ea < eb ? -1 : 1;
    if (a.desde !== b.desde) return a.desde < b.desde ? -1 : 1;
    return numeroOt(a.ots[0]?.ot) - numeroOt(b.ots[0]?.ot);
  });
}

/**
 * Reparte las obras entre los instaladores, de a medio día.
 * @param {object[]} trabajos de trabajosInstalacion (en orden)
 * @param {object[]} instaladores [{ id, nombre, diagrama }]; vacío = 2 instaladores de lunes a viernes
 * @returns {object[]} cada obra con: tramos [{ fecha, medio }] (medio 0 = mañana, 1 = tarde),
 *   inicio, fin (fechas), finMedio, equipo (ids), esperaProduccion, tarde, diasTarde, poco (poco margen)
 */
export function planInstalacion(trabajos, instaladores, { hoy, feriados = null } = {}) {
  const gente = instaladores?.length ? instaladores : [{ id: "i1", nombre: "Instalador 1" }, { id: "i2", nombre: "Instalador 2" }];
  const ocupado = new Map(gente.map((g) => [g.id, new Set()])); // "fecha|medio"
  const trabaja = new Map(); // "id|fecha" → bool
  const puede = (g, fecha) => {
    const k = `${g.id}|${fecha}`;
    if (!trabaja.has(k)) trabaja.set(k, trabajaElDia(g, fecha, feriados));
    return trabaja.get(k);
  };
  const slot = (i) => ({ fecha: sumarDias(hoy, Math.floor(i / 2)), medio: i % 2 });
  const indice = (fecha) => Math.max(0, diasEntre(hoy, fecha) * 2);
  const maxSlot = HORIZONTE_DIAS * 2;

  // Desde el medio día s, los medios días seguidos (saltando los que el equipo no trabaja) que necesita la obra
  const tramosDesde = (equipo, s, n) => {
    const out = [];
    for (let i = s; i < maxSlot && out.length < n; i++) {
      const { fecha, medio } = slot(i);
      if (!equipo.every((g) => puede(g, fecha))) {
        // Un día que nadie del equipo trabaja se salta; si trabaja uno solo, también (el equipo va junto)
        continue;
      }
      if (equipo.some((g) => ocupado.get(g.id).has(`${fecha}|${medio}`))) return null;
      out.push({ fecha, medio });
    }
    return out.length === n ? out : null;
  };

  const salida = [];
  for (const t of trabajos) {
    const p = Math.min(t.personas, gente.length);
    let puesto = null;
    for (let s = indice(t.desde); s < maxSlot && !puesto; s++) {
      const { fecha, medio } = slot(s);
      const libres = gente.filter((g) => puede(g, fecha) && !ocupado.get(g.id).has(`${fecha}|${medio}`));
      if (libres.length < p) continue;
      // Los que tienen más medios días libres seguidos desde acá (para no cortar la obra)
      const racha = (g) => {
        let n = 0;
        for (let i = s; i < Math.min(maxSlot, s + t.medios * 6) && n < t.medios; i++) {
          const z = slot(i);
          if (!puede(g, z.fecha)) continue;
          if (ocupado.get(g.id).has(`${z.fecha}|${z.medio}`)) break;
          n++;
        }
        return n;
      };
      const equipo = libres.map((g) => ({ g, n: racha(g) })).sort((a, b) => b.n - a.n).slice(0, p).map((x) => x.g);
      const tramos = tramosDesde(equipo, s, t.medios);
      if (tramos) puesto = { equipo, tramos };
    }
    if (!puesto) { salida.push({ ...t, tramos: [], equipo: [], inicio: null, fin: null, sinLugar: true }); continue; }
    for (const g of puesto.equipo) for (const z of puesto.tramos) ocupado.get(g.id).add(`${z.fecha}|${z.medio}`);
    const inicio = puesto.tramos[0], ultimo = puesto.tramos[puesto.tramos.length - 1];
    const diasTarde = t.entrega ? Math.max(0, diasEntre(t.entrega, ultimo.fecha)) : 0;
    salida.push({
      ...t,
      tramos: puesto.tramos,
      equipo: puesto.equipo.map((g) => g.id),
      inicio: inicio.fecha, inicioMedio: inicio.medio,
      fin: ultimo.fecha, finMedio: ultimo.medio,
      // La obra arranca apenas sale de fábrica: si producción se atrasa, se corre
      esperaProduccion: !t.enCurso && (t.minimo ?? t.desde) > hoy && inicio.fecha === (t.minimo ?? t.desde),
      tarde: diasTarde > 0,
      diasTarde,
      // Termina el mismo día de la entrega o el día hábil anterior
      poco: !!t.entrega && diasTarde === 0 && diaHabilSiguiente(ultimo.fecha, feriados) > t.entrega,
      sinLugar: false,
    });
  }
  return salida;
}

/**
 * A qué día se puede llevar una obra que se arrastró en el Gantt: nunca antes
 * del día hábil siguiente al fin de producción (`obra.minimo`).
 * @returns {{ fecha: string, ajustada: boolean }} ajustada = se pidió antes de lo posible
 */
export function fechaArrastrada(obra, fecha) {
  const minimo = obra?.minimo || obra?.desde || fecha;
  return fecha < minimo ? { fecha: minimo, ajustada: true } : { fecha, ajustada: false };
}

/** "mañana" / "tarde" / "todo el día" de cada fecha de una obra. */
export function diasDeObra(tramos = []) {
  const m = new Map();
  for (const z of tramos) m.set(z.fecha, (m.get(z.fecha) || 0) | (z.medio ? 2 : 1));
  return [...m].map(([fecha, v]) => ({ fecha, parte: v === 3 ? "dia" : v === 1 ? "manana" : "tarde" }));
}

// ─── Plan confirmado (parte 44; migración 154, /api/plan-instalacion) ───────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lo que se guarda al confirmar: un renglón por obra, medio día e instalador (sin instaladores marcados, uno sin nombre). */
export function itemsDelPlan(obras = []) {
  const out = [];
  obras.filter((o) => !o.sinLugar).forEach((o, orden) => {
    const ots = o.ots.map((t) => String(t.ot));
    const equipo = o.equipo.filter((id) => UUID.test(String(id)));
    for (const z of o.tramos) {
      for (const empleado_id of equipo.length ? equipo : [null]) {
        out.push({ obra: o.clave.slice(0, 300), ots, fecha: z.fecha, medio: z.medio, empleado_id, orden });
      }
    }
  });
  return out;
}

/**
 * ¿El plan vivo es el mismo que el confirmado? Compara desde hoy (los días
 * pasados ya no están en el plan vivo) obra, día, medio día e instalador.
 * Sirve para no volver a ofrecer "Confirmar" si no cambió nada.
 */
export function mismoPlan(items = [], confirmados = [], hoy = null) {
  const clave = (i) => `${i.obra}|${String(i.fecha).slice(0, 10)}|${Number(i.medio)}|${i.empleado_id || ""}`;
  const desdeHoy = (l) => new Set((l || []).filter((i) => !hoy || String(i.fecha).slice(0, 10) >= hoy).map(clave));
  const a = desdeHoy(items), b = desdeHoy(confirmados);
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

/** Último día confirmado de cada OT: Map<ot, fecha>. */
export function finConfirmadoPorOt(planes = []) {
  const m = new Map();
  for (const p of planes || []) {
    for (const i of p.items || []) {
      for (const ot of i.ots || []) {
        const k = String(ot);
        if (!m.has(k) || i.fecha > m.get(k)) m.set(k, i.fecha);
      }
    }
  }
  return m;
}

/** Cuántos días se corrió el fin de cada obra contra el plan confirmado (0 si no se corrió o no estaba). */
export function conCorrimiento(obras = [], finConfirmado = new Map()) {
  return obras.map((o) => {
    const fechas = o.ots.map((t) => finConfirmado.get(String(t.ot))).filter(Boolean);
    const confirmado = fechas.length ? fechas.sort().pop() : null;
    const diasCorrido = confirmado && o.fin ? Math.max(0, diasEntre(confirmado, o.fin)) : 0;
    return { ...o, finConfirmado: confirmado, diasCorrido };
  });
}

/** 📅 Mis instalaciones: por día y obra, si es mañana, tarde o todo el día. */
export function misDias(items = []) {
  const m = new Map();
  for (const i of items) {
    const k = `${i.fecha}|${i.obra}`;
    if (!m.has(k)) m.set(k, { fecha: i.fecha, obra: i.obra, ots: i.ots, proyectos: i.proyectos || [], con: new Set(), medios: 0 });
    const d = m.get(k);
    d.medios |= i.medio ? 2 : 1;
    for (const c of i.con || []) d.con.add(c);
  }
  return [...m.values()]
    .map((d) => ({ ...d, con: [...d.con], parte: d.medios === 3 ? "Todo el día" : d.medios === 1 ? "Mañana" : "Tarde" }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.medios & 1 ? -1 : 1));
}

/** El día hábil anterior a `fecha`. */
export function diaHabilAnterior(fecha, feriados = null) {
  let f = sumarDias(fecha, -1);
  for (let i = 0; i < 30 && !esDiaHabil(f, feriados); i++) f = sumarDias(f, -1);
  return f;
}

/** El último día hábil hasta `fecha` (ella misma si es hábil). */
export function ultimoDiaHabil(fecha, feriados = null) {
  return esDiaHabil(fecha, feriados) ? fecha : diaHabilAnterior(fecha, feriados);
}

/**
 * Fecha límite de producción (parte 45; Tadeo, 02/11): la SEMANA es la
 * entrega ya instalada. La instalación tiene que terminar el último día hábil
 * de esa semana, así que producción tiene que terminar el día hábil antes de
 * empezar a instalar: entrega − días de instalación (enteros, para arriba) en
 * días hábiles. Ej.: entrega semana 10-16/11, 2 días → instala J13 y V14 →
 * producción hasta X12.
 * Sin días de instalación (faltan los parámetros) queda la fecha de la semana, como antes.
 * @returns {{ entrega: string, dias: number|null, limite: string }|null} null sin fecha objetivo
 */
export function limiteProduccion(proyecto, params, { modulosEtiquetas = null, feriados = null } = {}) {
  const objetivo = proyecto?.fecha_objetivo ? String(proyecto.fecha_objetivo).slice(0, 10) : null;
  if (!objetivo) return null;
  if (!params) return { entrega: objetivo, dias: null, limite: objetivo };
  const { dias } = diasInstalacion(proyecto, params, params?.instalacion, { modulosEtiquetas });
  if (dias == null) return { entrega: objetivo, dias: null, limite: objetivo };
  const entrega = ultimoDiaHabil(objetivo, feriados);
  let limite = entrega;
  for (let i = 0; i < Math.ceil(dias - 1e-9); i++) limite = diaHabilAnterior(limite, feriados);
  return { entrega, dias, limite };
}
