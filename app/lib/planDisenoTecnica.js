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
//  • Orden: la prioridad de Producción (arrastrar en el Gantt de Producción),
//    después la semana de entrega y el número de OT.
// Las fechas son "AAAA-MM-DD"; cada tramo es un pedazo de un día (desde/hasta
// entre 0 y 1 de la jornada).
import { avanceArea } from "./complejidad";
import { tiemposOt } from "./disenoTecnicaPlan";
import { esDiaHabil } from "./planInstalacion";

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

/** Orden del plan: prioridad de Producción, semana de entrega, OT. */
export function ordenDiseno(proyectos = []) {
  return [...proyectos].sort((a, b) => {
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
 * @returns {{ renglones: object[], sinDato: object[], sinEtapas: number, terminadas: number, arquitectas: object[] }}
 */
export function planDisenoTecnica({ proyectos = [], dt, personal = [], hoy, feriados = null, pausadas = new Set() }) {
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
      const resta = Math.max(0.5, Math.ceil(t.diasDiseno * (1 - dis.pct / 100) * 2 - EPS) / 2);
      const d = llenar({ fecha: hoy, usado: 0 }, resta, 1, feriados);
      r.diseno = { tramos: d.tramos, inicio: d.tramos[0]?.fecha || null, fin: d.tramos.at(-1)?.fecha || null, dias: resta, pct: dis.pct };
      const ultimo = d.tramos.at(-1);
      listo = ultimo && ultimo.hasta < 1 - EPS ? { fecha: ultimo.fecha, frac: ultimo.hasta } : { fecha: d.fin.fecha, frac: 0 };
      const suya = deDiseno.find((a) => dis.quienes.some((q) => sonSusIniciales(q, a.nombre)));
      r.arquitectaDiseno = suya ? suya.nombre : null;
      if (d.sinLugar) r.sinLugar = true;
    }

    // Técnica: horas de una arquitecta, una planilla por vez
    if (tec && !tec.terminada) {
      if (t.horasTecnica == null) { r.faltanHoras = true; sinDato.push(r); renglones.push(r); continue; }
      const resta = Math.max(0.5, Math.round(t.horasTecnica * (1 - tec.pct / 100) * 2) / 2);
      if (!deTecnica.length) { r.sinArquitecta = true; r.tecnica = { horas: resta, pct: tec.pct, tramos: [] }; renglones.push(r); continue; }
      const desdeListo = (a) => {
        const pa = fraccion(a.punto, a.horasTecnica);
        return despues(listo, pa) ? { fecha: listo.fecha, usado: listo.frac * a.horasTecnica } : a.punto;
      };
      const fija = deTecnica.find((a) => tec.quienes.some((q) => sonSusIniciales(q, a.nombre)));
      let elegida = fija, mejor = null;
      if (!elegida) {
        for (const a of deTecnica) {
          const prueba = llenar(desdeListo(a), resta, a.horasTecnica, feriados);
          const fin = prueba.tramos.at(-1);
          const clave = fin ? `${fin.fecha}|${fin.hasta.toFixed(4)}` : "9999";
          if (!mejor || clave < mejor.clave || (clave === mejor.clave && a.ots < mejor.a.ots)) mejor = { a, clave };
        }
        elegida = mejor.a;
      }
      const res = llenar(desdeListo(elegida), resta, elegida.horasTecnica, feriados);
      elegida.punto = res.fin;
      elegida.ots++;
      r.arquitecta = elegida.nombre;
      r.arquitectaId = elegida.id;
      r.tecnica = { tramos: res.tramos, inicio: res.tramos[0]?.fecha || null, fin: res.tramos.at(-1)?.fecha || null, horas: resta, pct: tec.pct };
      if (res.sinLugar) r.sinLugar = true;
    }
    renglones.push(r);
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
