// app/lib/planDisenoTecnica.js — Plan vivo de Diseño y Técnica (parte 48;
// diseño en notes/diseno-gantt-diseno-tecnica.md).
//
// Se arma cada vez desde hoy, de lunes a viernes sin feriados:
//  • Diseño (relevamiento, diseño y aprobación) dura los días hábiles de la OT
//    (⚙ Parámetros o a mano), menos lo que ya está hecho según el Plan de
//    trabajo. Es tiempo de calendario (incluye esperar la aprobación del
//    cliente), así que varias OT pueden estar en Diseño a la vez.
//  • Técnica (la planilla técnica) son horas de trabajo de UNA arquitecta, que
//    hace una planilla por vez con su % de Técnica de la jornada. Arranca
//    cuando termina Diseño. Si en el Plan ya figuran las iniciales de una
//    arquitecta en Técnica, la OT sigue con ella; si no, va a la que la
//    termina antes.
//  • Orden: el confirmado en este Gantt (parte 50, orden_tecnica), después la
//    prioridad de Producción, la semana de entrega y el número de OT.
//  • Arquitecta: la de las iniciales del Plan; si no hay, la elegida al
//    confirmar (arquitecta_tecnica); si no, la que la termina antes.
// Las fechas son "AAAA-MM-DD"; cada tramo es un pedazo de un día (desde/hasta
// entre 0 y 1 de la jornada).
import { avanceArea } from "./complejidad";
import { tiemposOt } from "./disenoTecnicaPlan";
import { esDiaHabil, diaHabilSiguiente, diaHabilAnterior } from "./planInstalacion";
import { normalizarParametros, divisionPlan } from "./planificacion";
import { buscarDivision } from "./rutas";
import { feriadosDe } from "./secuencia";
import { faltanManual, horasManuales } from "./ajustesTiempo";

const DIA_MS = 86400000;
const sumarDias = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
export const HORIZONTE_DT = 400;
const EPS = 1e-6;

/** Iniciales de un nombre: "María José Torres" → "MJT". */
export const inicialesDe = (nombre) => String(nombre || "").trim().split(/\s+/).filter(Boolean)
  .map((w) => w.normalize("NFD").replace(/[̀-ͯ]/g, "")[0] || "").join("").toUpperCase();

/**
 * ¿Las iniciales de la planilla son de esta persona? Iguales, o la misma
 * primera y última letra ("SLS" con "Sofía Scarafiocca", que da "SS").
 */
export function sonSusIniciales(q, nombre) {
  const a = String(q || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z]/g, "").toUpperCase();
  const b = inicialesDe(nombre);
  if (a.length < 2 || b.length < 2) return false;
  return a === b || (a[0] === b[0] && a.at(-1) === b.at(-1));
}

/** Primer día hábil desde `fecha` (incluida). */
function habilDesde(fecha, feriados) {
  let f = fecha;
  for (let i = 0; i < 30 && !esDiaHabil(f, feriados); i++) f = sumarDias(f, 1);
  return f;
}

/**
 * Llena `cantidad` días de jornada desde el punto { fecha, usado } con
 * `porDia` de capacidad (1 = la jornada entera). Devuelve los tramos y el
 * punto donde terminó.
 */
function llenar(punto, cantidad, porDia, feriados) {
  const tramos = [];
  let { fecha, usado } = punto;
  let resta = cantidad;
  fecha = habilDesde(fecha, feriados);
  for (let i = 0; resta > EPS && i < HORIZONTE_DT; i++) {
    const libre = porDia - usado;
    if (libre <= EPS) { fecha = habilDesde(sumarDias(fecha, 1), feriados); usado = 0; continue; }
    const toma = Math.min(libre, resta);
    tramos.push({ fecha, desde: usado / porDia, hasta: (usado + toma) / porDia });
    usado += toma;
    resta -= toma;
    if (resta > EPS && porDia - usado <= EPS) { fecha = habilDesde(sumarDias(fecha, 1), feriados); usado = 0; }
  }
  if (usado >= porDia - EPS) return { tramos, fin: { fecha: habilDesde(sumarDias(fecha, 1), feriados), usado: 0 }, sinLugar: resta > EPS };
  return { tramos, fin: { fecha, usado }, sinLugar: resta > EPS };
}

/** Punto de un área convertido a fracción del día (para pasar de Diseño a Técnica). */
const fraccion = (p, porDia) => ({ fecha: p.fecha, frac: porDia > 0 ? p.usado / porDia : 0 });
const despues = (a, b) => a.fecha > b.fecha || (a.fecha === b.fecha && a.frac > b.frac + EPS);

const ordenT = (p) => (Number.isInteger(p.orden_tecnica) && p.orden_tecnica >= 1 ? p.orden_tecnica : Infinity);

/** Orden del plan: el confirmado en el Gantt 📐 (parte 50), prioridad de Producción, semana de entrega, OT. */
export function ordenDiseno(proyectos = []) {
  return [...proyectos].sort((a, b) => {
    const oa = ordenT(a), ob = ordenT(b);
    if (oa !== ob) return oa - ob;
    const pa = Number.isInteger(a.prioridad) ? a.prioridad : Infinity;
    const pb = Number.isInteger(b.prioridad) ? b.prioridad : Infinity;
    if (pa !== pb) return pa - pb;
    const fa = a.fecha_objetivo || "9999", fb = b.fecha_objetivo || "9999";
    if (fa !== fb) return fa.localeCompare(fb);
    return String(a.ot).localeCompare(String(b.ot), "es", { numeric: true });
  });
}

/**
 * Plan de Diseño y Técnica.
 * @param {object} opts
 * @param {object[]} opts.proyectos OT abiertas de la división (con etapas_diseno, clase, tiempos)
 * @param {object} opts.dt normalizarDisenoTecnica(...)
 * @param {{ id: string, nombre: string }[]} opts.personal empleados (para los nombres de las arquitectas)
 * @param {string} opts.hoy "AAAA-MM-DD"
 * @param {Set<string>} [opts.feriados]
 * @param {Set<string>} [opts.pausadas] OT en pausa (no entran)
 * @param {Map} [opts.manual] faltanManual(ajustes): "⏱ Necesita más tiempo" de Diseño (días) y Técnica (horas)
 * @returns {{ renglones: object[], sinDato: object[], sinEtapas: number, terminadas: number, arquitectas: object[] }}
 */
export function planDisenoTecnica({ proyectos = [], dt, personal = [], hoy, feriados = null, pausadas = new Set(), manual = new Map() }) {
  const nombres = new Map((personal || []).map((e) => [String(e.id), e.nombre || ""]));
  const arquitectas = (dt?.arquitectas || []).map((a) => ({
    id: String(a.id),
    nombre: nombres.get(String(a.id)) || "Arquitecta",
    pctTecnica: a.pct_tecnica,
    horasTecnica: (dt.horas_dia * a.pct_tecnica) / 100, // horas de Técnica por día
    punto: { fecha: hoy, usado: 0 },
    ots: 0,
  }));
  const deTecnica = arquitectas.filter((a) => a.horasTecnica > 0);
  const deDiseno = arquitectas.filter((a) => a.pctTecnica < 100);
  const renglones = [];
  const pendientes = []; // Técnica por repartir
  const sinDato = [];
  let sinEtapas = 0, terminadas = 0;

  for (const p of ordenDiseno(proyectos)) {
    if (pausadas.has(String(p.ot))) continue;
    const etapas = p.etapas_diseno && typeof p.etapas_diseno === "object" ? p.etapas_diseno : null;
    const tec = avanceArea(etapas, "tecnica");
    const dis = avanceArea(etapas, "diseno");
    if (!tec && !dis) { sinEtapas++; continue; }
    if ((!tec || tec.terminada) && (!dis || dis.terminada)) { terminadas++; continue; }
    const t = tiemposOt(p, dt);
    const r = { proyecto: p, ot: String(p.ot), clase: t.clase, tipo: t.tipo, tiempos: t, diseno: null, tecnica: null, arquitecta: null, arquitectaDiseno: null, sinLugar: false, sinArquitecta: false, faltanHoras: false };

    // Diseño: lo que falta de los días fijos, desde hoy, en paralelo con las demás OT
    let listo = { fecha: habilDesde(hoy, feriados), frac: 0 };
    if (dis && !dis.terminada) {
      // "⏱ Necesita más tiempo" manda (162); si después avanza el Plan, baja en la misma proporción
      const mD = manual.get(`${r.ot}|diseno`);
      const base = mD ? horasManuales(mD, 1 - dis.pct / 100) : t.diasDiseno * (1 - dis.pct / 100);
      const resta = Math.max(0.5, Math.ceil(base * 2 - EPS) / 2);
      r.disenoManual = !!mD;
      const d = llenar({ fecha: hoy, usado: 0 }, resta, 1, feriados);
      r.diseno = { tramos: d.tramos, inicio: d.tramos[0]?.fecha || null, fin: d.tramos.at(-1)?.fecha || null, dias: resta, pct: dis.pct };
      const ultimo = d.tramos.at(-1);
      listo = ultimo && ultimo.hasta < 1 - EPS ? { fecha: ultimo.fecha, frac: ultimo.hasta } : { fecha: d.fin.fecha, frac: 0 };
      const suya = deDiseno.find((a) => dis.quienes.some((q) => sonSusIniciales(q, a.nombre)));
      r.arquitectaDiseno = suya ? suya.nombre : null;
      if (d.sinLugar) r.sinLugar = true;
    }

    // Técnica: se reparte después, cuando ya se sabe cuándo termina el Diseño de todas
    if (tec && !tec.terminada) {
      const mT = manual.get(`${r.ot}|tecnica`);
      if (t.horasTecnica == null && !mT) { r.faltanHoras = true; sinDato.push(r); renglones.push(r); continue; }
      const resta = Math.max(0.5, Math.round((mT ? horasManuales(mT, 1 - tec.pct / 100) : t.horasTecnica * (1 - tec.pct / 100)) * 2) / 2);
      r.tecnicaManual = !!mT;
      if (!deTecnica.length) { r.sinArquitecta = true; r.tecnica = { horas: resta, pct: tec.pct, tramos: [] }; renglones.push(r); continue; }
      // Manda el Plan de trabajo (ya la empezó); si no, la elegida al confirmar (parte 50)
      const delPlan = deTecnica.find((a) => tec.quienes.some((q) => sonSusIniciales(q, a.nombre))) || null;
      const elegida = p.arquitecta_tecnica != null ? deTecnica.find((a) => a.id === String(p.arquitecta_tecnica)) || null : null;
      const fija = delPlan || elegida;
      r.arquitectaPlan = !!delPlan;
      pendientes.push({ r, listo, resta, pct: tec.pct, fija, orden: pendientes.length });
    }
    renglones.push(r);
  }

  // Técnica: una planilla por vez por arquitecta, sin dejarla parada. Cada vez
  // se toma la planilla que puede empezar antes (a igual hora, la de más
  // prioridad) con la arquitecta que la termina antes (o la suya, si ya la empezó).
  const desdeListo = (a, listo) => {
    const pa = fraccion(a.punto, a.horasTecnica);
    return despues(listo, pa) ? { fecha: habilDesde(listo.fecha, feriados), usado: listo.frac * a.horasTecnica } : { ...a.punto, fecha: habilDesde(a.punto.fecha, feriados) };
  };
  const clavePunto = (p, porDia) => `${p.fecha}|${(p.usado / porDia).toFixed(4)}`;
  while (pendientes.length) {
    let mejor = null;
    for (const x of pendientes) {
      for (const a of x.fija ? [x.fija] : deTecnica) {
        const arranque = desdeListo(a, x.listo);
        const clave = clavePunto(arranque, a.horasTecnica);
        if (mejor && (clave > mejor.clave || (clave === mejor.clave && x.orden > mejor.x.orden))) continue;
        const prueba = llenar(arranque, x.resta, a.horasTecnica, feriados);
        const fin = prueba.tramos.at(-1);
        const claveFin = fin ? `${fin.fecha}|${fin.hasta.toFixed(4)}` : "9999";
        if (!mejor || clave < mejor.clave || x.orden < mejor.x.orden || claveFin < mejor.claveFin || (claveFin === mejor.claveFin && a.ots < mejor.a.ots)) {
          mejor = { x, a, clave, claveFin, res: prueba };
        }
      }
    }
    const { x, a, res } = mejor;
    pendientes.splice(pendientes.indexOf(x), 1);
    a.punto = res.fin;
    a.ots++;
    x.r.arquitecta = a.nombre;
    x.r.arquitectaId = a.id;
    x.r.tecnica = { tramos: res.tramos, inicio: res.tramos[0]?.fecha || null, fin: res.tramos.at(-1)?.fecha || null, horas: x.resta, pct: x.pct };
    if (res.sinLugar) x.r.sinLugar = true;
  }
  // Cuánto se corrió la Técnica desde el plan confirmado (parte 50)
  for (const r of renglones) {
    const conf = r.proyecto.tecnica_fin_confirmado || null;
    r.finConfirmado = conf;
    r.corrido = conf && r.tecnica?.fin && r.tecnica.fin > conf ? diasHabilesEntre(sumarDias(conf, 1), r.tecnica.fin, feriados) : 0;
  }
  return { renglones, sinDato, sinEtapas, terminadas, arquitectas };
}

/** Último día con trabajo en el plan (para el ancho del Gantt). */
export function finDelPlan(renglones = [], hoy) {
  let fin = hoy;
  for (const r of renglones) {
    for (const f of [r.diseno?.fin, r.tecnica?.fin]) if (f && f > fin) fin = f;
  }
  return fin;
}

/** Tramos de días seguidos del calendario juntados en una barra: [{ desde: {fecha, desde}, hasta: {fecha, hasta} }]. */
export function barrasSeguidas(tramos = []) {
  const out = [];
  for (const z of tramos) {
    const ult = out[out.length - 1];
    if (ult && ult.hasta.hasta >= 1 - EPS && z.desde <= EPS && sumarDias(ult.hasta.fecha, 1) === z.fecha) ult.hasta = z;
    else out.push({ desde: z, hasta: z });
  }
  return out;
}

// ─── Enlace con Producción (parte 49) ───────────────────────────────────────

const hechaONa = (c) => c?.e === "hecho" || c?.e === "na";

/**
 * Cuándo puede arrancar Producción cada OT según su Técnica: el día hábil
 * siguiente a que termina en el plan de Diseño y Técnica. Si EXCEL ya está
 * hecho, Producción puede arrancar igual (Tadeo, 05/11) y queda solo el aviso.
 * Solo las OT con Técnica sin terminar.
 * @returns {Map<string, { desde: string|null, finTecnica: string|null, excel: boolean, sinPlan: boolean }>}
 *   desde: no antes de ese día (null = no se espera: EXCEL hecho o Técnica sin planificar)
 *   sinPlan: Técnica sin terminar pero sin fecha (faltan las horas o no hay arquitectas)
 */
export function esperaTecnica(renglones = [], feriados = null) {
  const out = new Map();
  for (const r of renglones) {
    const tec = r.tecnica;
    const pendiente = r.faltanHoras || r.sinArquitecta || (tec && tec.pct < 100);
    if (!pendiente) continue;
    const excel = hechaONa(r.proyecto?.etapas_diseno?.excel);
    const finTecnica = tec?.fin || null;
    out.set(r.ot, {
      desde: finTecnica && !excel ? diaHabilSiguiente(finTecnica, feriados) : null,
      finTecnica,
      excel,
      sinPlan: !finTecnica,
    });
  }
  return out;
}

/** Días hábiles de `a` a `b`, los dos incluidos (0 si b < a). */
export function diasHabilesEntre(a, b, feriados = null) {
  if (!a || !b || b < a) return 0;
  let n = 0;
  for (let f = a, i = 0; f <= b && i < 800; f = sumarDias(f, 1), i++) if (esDiaHabil(f, feriados)) n++;
  return n;
}

/** Margen (días hábiles) desde el que Técnica queda amarilla. */
export const MARGEN_TECNICA = 2;

/**
 * Fecha límite de Técnica: el último día hábil en que puede terminar para que
 * Producción, con lo que dura en el plan vivo, llegue a su fecha límite (la de
 * la entrega menos la instalación, parte 45).
 * @param {{ inicio: string, fin: string, objetivo: string|null }} produccion renglón del plan vivo de Producción
 * @param {string|null} finTecnica
 * @returns {{ limite: string, estado: "verde"|"amarillo"|"rojo", diasTarde: number } | null}
 */
export function limiteTecnica(produccion, finTecnica, feriados = null) {
  if (!produccion?.objetivo || !produccion.inicio || !produccion.fin) return null;
  const dura = Math.max(1, diasHabilesEntre(produccion.inicio, produccion.fin, feriados));
  let inicioTarde = produccion.objetivo;
  if (!esDiaHabil(inicioTarde, feriados)) inicioTarde = diaHabilAnterior(inicioTarde, feriados);
  for (let i = 1; i < dura; i++) inicioTarde = diaHabilAnterior(inicioTarde, feriados);
  const limite = diaHabilAnterior(inicioTarde, feriados);
  if (!finTecnica) return { limite, estado: "verde", diasTarde: 0 };
  if (finTecnica > limite) return { limite, estado: "rojo", diasTarde: Math.max(1, diasHabilesEntre(diaHabilSiguiente(limite, feriados), finTecnica, feriados)) };
  const margen = diasHabilesEntre(diaHabilSiguiente(finTecnica, feriados), limite, feriados);
  return { limite, estado: margen < MARGEN_TECNICA ? "amarillo" : "verde", diasTarde: 0 };
}

/**
 * Plan de Diseño y Técnica de la empresa con lo que ya tienen el Gantt, el
 * Panel y el informe: las OT abiertas de la división que se planifica.
 * @returns {{ renglones, sinDato, sinEtapas, terminadas, arquitectas, feriados, dt, espera: Map }}
 */
export function planDeEmpresa({ proyectos = [], divisiones = [], cfgValor = null, personal = [], hoy, pausadas = new Set(), ajustes = [] }) {
  const params = normalizarParametros(cfgValor);
  const division = divisionPlan(divisiones, params.division_id);
  const abiertas = proyectos.filter((p) => p.estado !== "cerrado" && !p.terminado_planilla
    && (!division || buscarDivision(divisiones, p.division)?.id === division.id));
  const feriados = feriadosDe(params);
  const plan = planDisenoTecnica({ proyectos: abiertas, dt: params.diseno_tecnica, personal, hoy, feriados, pausadas, manual: faltanManual(ajustes) });
  return { ...plan, feriados, dt: params.diseno_tecnica, espera: esperaTecnica(plan.renglones, feriados) };
}

/** Lo que el plan vivo de Producción usa como noAntes: OT → primer día en que puede arrancar. */
export function noAntesDeTecnica(espera) {
  return new Map([...(espera || new Map())].filter(([, e]) => e.desde).map(([ot, e]) => [ot, e.desde]));
}

// ─── Plan confirmado y "Mis planillas" (parte 50) ───────────────────────────

/**
 * Proyectos con el orden y las arquitectas que se están probando (vista previa
 * antes de confirmar).
 * @param {object[]} proyectos
 * @param {{ orden: string[], arquitectas: Record<string, string|null> }} cambio
 *   orden: números de OT en el orden nuevo; arquitectas: OT → id elegido (null = automática)
 */
export function conCambio(proyectos = [], cambio = null) {
  if (!cambio) return proyectos;
  const lugar = new Map((cambio.orden || []).map((ot, i) => [String(ot), i + 1]));
  const elegidas = cambio.arquitectas || {};
  return proyectos.map((p) => {
    const ot = String(p.ot);
    if (!lugar.has(ot) && !(ot in elegidas)) return p;
    return {
      ...p,
      ...(lugar.has(ot) ? { orden_tecnica: lugar.get(ot) } : {}),
      ...(ot in elegidas ? { arquitecta_tecnica: elegidas[ot] || null } : {}),
    };
  });
}

/**
 * Lo que se guarda en cada OT al confirmar: orden, arquitecta elegida y el
 * día en que termina la Técnica en este plan.
 * @returns {{ id: any, ot: string, cuerpo: { orden_tecnica: number, arquitecta_tecnica: string|null, tecnica_fin_confirmado: string|null } }[]}
 */
export function cuerposConfirmar(renglones = []) {
  return renglones.map((r, i) => ({
    id: r.proyecto.id,
    ot: r.ot,
    cuerpo: {
      orden_tecnica: i + 1,
      arquitecta_tecnica: r.proyecto.arquitecta_tecnica != null ? String(r.proyecto.arquitecta_tecnica) : null,
      tecnica_fin_confirmado: r.tecnica?.fin || null,
    },
  }));
}

/** ¿Hay algo confirmado en el plan? */
export const hayConfirmado = (renglones = []) => renglones.some((r) => r.proyecto?.orden_tecnica != null || r.proyecto?.tecnica_fin_confirmado);

/**
 * Lo que le toca a una arquitecta: sus planillas técnicas en orden (la que
 * está haciendo primero) y las OT en las que figura en Diseño.
 * @param {{ renglones: object[], arquitectas: object[] }} plan planDeEmpresa(...)
 * @param {string} empleadoId
 * @returns {{ es: boolean, nombre: string|null, pctTecnica: number|null, tecnica: object[], diseno: object[] }}
 */
export function misPlanillas(plan, empleadoId) {
  const yo = (plan?.arquitectas || []).find((a) => a.id === String(empleadoId ?? ""));
  if (!yo) return { es: false, nombre: null, pctTecnica: null, tecnica: [], diseno: [] };
  const tecnica = plan.renglones.filter((r) => r.arquitectaId === yo.id && r.tecnica?.inicio)
    .sort((a, b) => a.tecnica.inicio.localeCompare(b.tecnica.inicio));
  const diseno = plan.renglones.filter((r) => r.diseno && r.arquitectaDiseno === yo.nombre);
  return { es: true, nombre: yo.nombre, pctTecnica: yo.pctTecnica, tecnica, diseno };
}

/** Renglón resumido para mandar a la pantalla de la arquitecta (sin la fila entera de la OT). */
export function renglonCorto(r) {
  const p = r.proyecto || {};
  return {
    ot: r.ot, clase: r.clase, tipo: r.tipo,
    cliente: p.cliente || null, obra: p.obra || null, proyecto: p.proyecto || null, descripcion: p.descripcion || null,
    diseno: r.diseno ? { inicio: r.diseno.inicio, fin: r.diseno.fin, dias: r.diseno.dias, pct: r.diseno.pct } : null,
    tecnica: r.tecnica?.inicio ? { inicio: r.tecnica.inicio, fin: r.tecnica.fin, horas: r.tecnica.horas, pct: r.tecnica.pct } : null,
    finConfirmado: r.finConfirmado || null, corrido: r.corrido || 0,
  };
}

/**
 * OT que un cambio de orden o de arquitecta deja más tarde contra su fecha
 * límite de Técnica (la que hace llegar a Producción a la entrega). Se compara
 * con el plan de antes: una OT que ya venía tarde solo cuenta si queda peor.
 * Sin el plan de Producción no se puede saber y no bloquea.
 * @param {{ renglones: object[], feriados?: Set<string> }} antes
 * @param {{ renglones: object[], feriados?: Set<string> }} despues
 * @param {{ renglones: object[] }|null} vivo plan vivo de Producción
 * @returns {{ ot: string, proyecto: object, diasTarde: number, limite: string }[]}
 */
export function entregasComprometidas(antes, despues, vivo) {
  if (!vivo?.renglones || !antes || !despues) return [];
  const prod = new Map(vivo.renglones.map((r) => [String(r.ot), r]));
  const tarde = (plan) => {
    const m = new Map();
    for (const r of plan.renglones) {
      const l = limiteTecnica(prod.get(r.ot), r.tecnica?.fin || null, plan.feriados || null);
      if (l?.estado === "rojo") m.set(r.ot, { ...l, proyecto: r.proyecto });
    }
    return m;
  };
  const a = tarde(antes);
  return [...tarde(despues)].filter(([ot, l]) => l.diasTarde > (a.get(ot)?.diasTarde || 0))
    .map(([ot, l]) => ({ ot, proyecto: l.proyecto, diasTarde: l.diasTarde, limite: l.limite }));
}
