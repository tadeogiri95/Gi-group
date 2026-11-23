// app/lib/tableroEtapas.js — Tablero de etapas (Tadeo, 22/11): una columna por
// proceso de producción (Corte, Canteado, Mecanizado, Armado) más Instalación
// y Terminadas, con cada OT en la etapa en que está y cuánto lleva ahí.
//
// Todo en horas de jornada (la grilla de horarios, sin feriados ni pausas;
// app/lib/leadTimeHoras.js), nunca horas corridas:
//   - Un proceso empieza con la primera pieza escaneada o el primer % cargado
//     a mano y termina cuando pasa la última pieza (o el % llega a 100).
//   - Instalación empieza con la carga al camión (firma o primer bulto) o el
//     primer reporte de instalación, y termina con el acta firmada. Se cuenta
//     con el horario de los instaladores (sin horario cargado, el de la planta).
//   - Una OT que terminó un proceso y no empezó el siguiente va al siguiente
//     como "⏳ Esperando", con las horas desde que terminó el anterior.
//   - Una OT que avanza en un proceso sin haber terminado uno anterior va en
//     el más adelantado, marcada en naranja con lo que le falta atrás.
//   - Una OT en curso que no está en el plan confirmado (el Gantt) va marcada
//     "Fuera del Gantt".
// No guarda nada nuevo: sale de lo que ya queda registrado (escaneos,
// historial del % manual, firmas, cargas, reportes de instalación y actas),
// así que también muestra el historial de las OT de antes.
import { ETAPAS_PLAN } from "./planificacion";
import { buscarDivision, rutaDe } from "./rutas";
import { horasSinPausa } from "./leadTimeHoras";
import { intervalosPausa } from "./pausaOt";

export const COLUMNAS_TABLERO = [
  ...ETAPAS_PLAN.map(({ id, nombre }) => ({ id, nombre })),
  { id: "instalacion", nombre: "Instalación" },
  { id: "terminadas", nombre: "Terminadas" },
];

/** Días hacia atrás que se ven en Terminadas. */
export const DIAS_TERMINADAS = 30;

const ms = (t) => (t ? Date.parse(t) : NaN);
const DIA = 86400000;
const menor = (a, b) => (!a ? b : !b ? a : ms(b) < ms(a) ? b : a);
const redondear = (n) => Math.round(n * 10) / 10;

/**
 * Inicio, fin y % de la instalación de cada OT.
 * @param {{ cargas?: object[], bultos?: object[], reportes?: object[], actas?: object[] }} d
 *   cargas: cargas_ot (ot, firma_carga_at); bultos: bultos_ot cargados (ot, cargado_at);
 *   reportes: reportes_instalacion (ot, avance, created_at); actas: actas_ot firmadas (ot, firmada_at)
 * @returns {Map<string, { inicio: string|null, fin: string|null, pct: number|null }>}
 */
export function instalacionPorOt({ cargas = [], bultos = [], reportes = [], actas = [] } = {}) {
  const m = new Map();
  const de = (ot) => {
    const k = String(ot);
    if (!m.has(k)) m.set(k, { inicio: null, fin: null, pct: null, _ult: null });
    return m.get(k);
  };
  for (const c of cargas || []) if (c?.firma_carga_at) { const x = de(c.ot); x.inicio = menor(x.inicio, c.firma_carga_at); }
  for (const b of bultos || []) if (b?.cargado_at) { const x = de(b.ot); x.inicio = menor(x.inicio, b.cargado_at); }
  for (const r of reportes || []) {
    if (!r?.created_at) continue;
    const x = de(r.ot);
    x.inicio = menor(x.inicio, r.created_at);
    if (r.avance != null && (!x._ult || ms(r.created_at) > ms(x._ult))) { x._ult = r.created_at; x.pct = Number(r.avance); }
  }
  for (const a of actas || []) if (a?.firmada_at) { const x = de(a.ot); x.fin = menor(x.fin, a.firmada_at); x.pct = 100; }
  for (const x of m.values()) delete x._ult;
  return m;
}

/**
 * % de cada proceso de cada OT, con el checkeo manual encima (piezasConManual).
 * @returns {Map<string, number>} clave "OT|código de etapa"
 */
export function pctPorProceso(piezas = []) {
  const m = new Map();
  for (const f of piezas || []) {
    const total = Number(f.total);
    if (!(total > 0)) continue;
    m.set(`${f.ot}|${Number(f.etapa)}`, Math.min(100, Math.round((Number(f.pasaron) / total) * 100)));
  }
  return m;
}

/**
 * Las tarjetas de cada columna.
 * @param {{
 *   proyectos: object[], lead: Map<string, object>, pct?: Map<string, number>,
 *   instalacion?: Map<string, object>, etapasCodigo: Record<string, number|null>, divisiones?: object[],
 *   ventanas?: object[], ventanasInstalacion?: object[], feriados?: Set<string>|null, pausas?: object[],
 *   planProduccion?: Set<string>|null, planInstalacion?: Set<string>|null, ahora?: Date, diasTerminadas?: number,
 * }} d
 *   lead: leadTimeProcesos de app/lib/leadTimeHoras.js (inicio y fin de cada proceso)
 *   planProduccion / planInstalacion: OT de los planes confirmados; null = no se marca "Fuera del Gantt"
 * @returns {{ columnas: { id, nombre, tarjetas: object[], promedios?: object[] }[], porOt: Map<string, object> }}
 */
export function tableroEtapas({
  proyectos = [], lead = new Map(), pct = new Map(), instalacion = new Map(), etapasCodigo = {}, divisiones = [],
  ventanas, ventanasInstalacion, feriados = null, pausas = [], planProduccion = null, planInstalacion = null,
  ahora = new Date(), diasTerminadas = DIAS_TERMINADAS,
}) {
  const ahoraIso = ahora.toISOString();
  const desdeTerminadas = ahora.getTime() - diasTerminadas * DIA;
  const columnas = COLUMNAS_TABLERO.map((c) => ({ ...c, tarjetas: [] }));
  const col = Object.fromEntries(columnas.map((c) => [c.id, c]));
  const porOt = new Map();
  const conCodigo = ETAPAS_PLAN.filter(({ id }) => etapasCodigo?.[id] != null);

  for (const p of proyectos || []) {
    const ot = String(p.ot);
    const lt = lead.get(ot);
    const inst = instalacion.get(ot) || null;
    if (!lt && !inst?.inicio) continue; // sin ningún avance: todavía no entró al tablero
    const tramos = intervalosPausa(pausas, ot, ahora);
    const hs = (a, b, vs = ventanas) => horasSinPausa(a, b, vs, tramos, feriados);

    // Procesos por los que pasa la OT: la ruta de su división (o todos), más
    // cualquiera que haya tenido avance aunque no esté en la ruta
    const ruta = rutaDe(buscarDivision(divisiones, p.division));
    const registrados = new Map((lt?.procesos || []).map((q) => [q.etapa, q]));
    const procesos = conCodigo
      .filter(({ id }) => !ruta.length || ruta.includes(Number(etapasCodigo[id])) || registrados.has(id))
      .map(({ id, nombre }) => {
        const q = registrados.get(id);
        const valor = pct.get(`${ot}|${Number(etapasCodigo[id])}`);
        return {
          etapa: id, nombre, inicio: q?.inicio || null, fin: q?.fin || null,
          horas: q?.horas ?? null, lleva: q?.lleva ?? null,
          pct: q?.fin ? 100 : valor ?? (q?.inicio ? 0 : null),
        };
      });

    const enCurso = procesos.filter((q) => q.inicio && !q.fin);
    const terminados = procesos.filter((q) => q.fin);
    const produccionLista = procesos.length > 0 && procesos.every((q) => q.fin);
    const finProduccion = produccionLista ? procesos.reduce((m, q) => (!m || ms(q.fin) > ms(m) ? q.fin : m), null) : null;
    const inicioOt = [...procesos.map((q) => q.inicio), inst?.inicio].filter(Boolean).reduce((m, t) => menor(m, t), null);

    const instalacionInfo = inst?.inicio || inst?.fin ? {
      inicio: inst.inicio || null, fin: inst.fin || null, pct: inst.pct ?? null,
      horas: inst.inicio && inst.fin ? hs(inst.inicio, inst.fin, ventanasInstalacion) : null,
      lleva: inst.inicio && !inst.fin ? hs(inst.inicio, ahoraIso, ventanasInstalacion) : null,
    } : null;

    // Fin de la OT: el acta firmada; sin acta, cerrada con la producción hecha
    const cerrada = p.estado === "cerrado" || p.terminado_planilla === true;
    const finOt = inst?.fin || (cerrada && finProduccion) || null;
    const tarjeta = {
      ot, proyecto: p, procesos, instalacion: instalacionInfo, inicio: inicioOt, fin: finOt,
      produccion: finProduccion && inicioOt ? hs(inicioOt, finProduccion) : null,
      horas: finOt && inicioOt ? hs(inicioOt, finOt) : null,
      llevaOt: !finOt && inicioOt ? hs(inicioOt, ahoraIso) : null,
      enPausa: tramos.some((t) => t.b >= ahora.getTime() && t.a <= ahora.getTime()),
      columna: null, estado: null, lleva: null, desde: null, pct: null, atrasados: [], fueraDelGantt: false,
    };
    porOt.set(ot, tarjeta);

    if (finOt) {
      if (ms(finOt) < desdeTerminadas) continue;
      Object.assign(tarjeta, { columna: "terminadas", estado: "terminada", desde: finOt });
    } else if (cerrada) {
      continue; // cerrada sin haber terminado la producción en la app: no se muestra
    } else if (inst?.inicio) {
      Object.assign(tarjeta, { columna: "instalacion", estado: "en_curso", desde: inst.inicio, lleva: instalacionInfo.lleva, pct: inst.pct });
      tarjeta.atrasados = procesos.filter((q) => !q.fin).map(({ etapa, nombre, pct: v }) => ({ etapa, nombre, pct: v }));
      tarjeta.fueraDelGantt = !!planInstalacion && !planInstalacion.has(ot);
    } else if (enCurso.length) {
      const ultimo = enCurso[enCurso.length - 1];
      const idx = procesos.indexOf(ultimo);
      Object.assign(tarjeta, { columna: ultimo.etapa, estado: "en_curso", desde: ultimo.inicio, lleva: ultimo.lleva, pct: ultimo.pct });
      tarjeta.atrasados = procesos.slice(0, idx).filter((q) => !q.fin).map(({ etapa, nombre, pct: v }) => ({ etapa, nombre, pct: v }));
      tarjeta.fueraDelGantt = !!planProduccion && !planProduccion.has(ot);
    } else if (produccionLista) {
      Object.assign(tarjeta, { columna: "instalacion", estado: "esperando", desde: finProduccion, lleva: hs(finProduccion, ahoraIso, ventanasInstalacion) });
    } else if (terminados.length) {
      // Terminó uno y no empezó el siguiente: espera en el siguiente sin empezar
      const ultimoFin = terminados.reduce((m, q) => (!m || ms(q.fin) > ms(m.fin) ? q : m), null);
      const siguiente = procesos.slice(procesos.indexOf(ultimoFin) + 1).find((q) => !q.inicio) || procesos.find((q) => !q.inicio);
      if (!siguiente) continue;
      Object.assign(tarjeta, { columna: siguiente.etapa, estado: "esperando", desde: ultimoFin.fin, lleva: hs(ultimoFin.fin, ahoraIso), pct: 0 });
      tarjeta.atrasados = procesos.slice(0, procesos.indexOf(siguiente)).filter((q) => !q.fin).map(({ etapa, nombre, pct: v }) => ({ etapa, nombre, pct: v }));
    } else {
      continue;
    }
    col[tarjeta.columna].tarjetas.push(tarjeta);
  }

  for (const c of columnas) {
    if (c.id === "terminadas") c.tarjetas.sort((a, b) => ms(b.fin) - ms(a.fin));
    // En curso primero, y las que más llevan arriba
    else c.tarjetas.sort((a, b) => (a.estado === "esperando") - (b.estado === "esperando") || (b.lleva ?? 0) - (a.lleva ?? 0));
  }
  col.terminadas.promedios = promediosTerminadas(col.terminadas.tarjetas);
  return { columnas, porOt };
}

const promedio = (xs) => (xs.length ? redondear(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

/** Promedio de horas de cada etapa y de la OT completa entre las terminadas. */
export function promediosTerminadas(tarjetas = []) {
  return [
    ...ETAPAS_PLAN.map(({ id, nombre }) => {
      const hs = tarjetas.flatMap((t) => t.procesos.filter((q) => q.etapa === id && q.horas != null).map((q) => q.horas));
      return { etapa: id, nombre, cantidad: hs.length, promedio: promedio(hs) };
    }),
    (() => { const hs = tarjetas.map((t) => t.instalacion?.horas).filter((h) => h != null); return { etapa: "instalacion", nombre: "Instalación", cantidad: hs.length, promedio: promedio(hs) }; })(),
    (() => { const hs = tarjetas.map((t) => t.horas).filter((h) => h != null); return { etapa: "ot", nombre: "OT completa", cantidad: hs.length, promedio: promedio(hs) }; })(),
  ].filter((x) => x.cantidad > 0);
}

/** OT de los planes confirmados vigentes (el último de cada división). */
export function otsDelPlan(items = []) {
  return new Set((items || []).flatMap((i) => (Array.isArray(i.ots) ? i.ots : [i.ot])).filter((o) => o != null).map(String));
}
