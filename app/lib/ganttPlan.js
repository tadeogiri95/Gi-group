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
import { pendienteEtapa, capacidadPlanta, operariosDePlanta, personalPlanta, horasOt } from "./cargaPlanta";
import { hoyArg } from "./dates";
import { diasEntre } from "./semanaObjetivo";
import { porcentajeOt } from "./panelMantenimiento";
import { HORAS_SEMANA_POR_DEFECTO, MAQUINAS_PLAN, calendario, duracion, secuenciar } from "./secuencia";
import { horasManuales } from "./ajustesTiempo";

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
 * Las OT de un plan guardado en su orden, con las horas y el primer día de
 * cada proceso, y el orden propio de cada proceso ("OT por proceso"; si no se
 * tocó, el de la OT).
 */
function ordenDeItems(items) {
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
  const ots = [...porOt.values()].sort((a, b) => a.orden - b.orden || a.primero.localeCompare(b.primero) || a.ot.localeCompare(b.ot, "es", { numeric: true }));
  const lugar = new Map(ots.map((o, i) => [o.ot, i]));
  const ordenEtapa = Object.fromEntries(ETAPAS_PLAN.map(({ id }) => [id, ots.filter((o) => id in o.enEtapa)
    .sort((a, b) => a.enEtapa[id] - b.enEtapa[id] || lugar.get(a.ot) - lugar.get(b.ot)).map((o) => o.ot)]));
  return { ots, ordenEtapa };
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
  const { ots, ordenEtapa } = ordenDeItems(items);
  const out = new Map();
  if (!ots.length) return out;
  const base = ots.reduce((m, o) => (o.primero < m ? o.primero : m), ots[0].primero);
  const cal = calendario(base, horasSemana, diasExtra);
  const tHoy = hoy < base ? 0 : cal.inicio(hoy);
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

const diaArg = (ts) => hoyArg(new Date(ts));
const maxFecha = (fs) => fs.reduce((m, f) => (f > m ? f : m), fs[0]);
const minFecha = (fs) => fs.reduce((m, f) => (f < m ? f : m), fs[0]);

/**
 * Plan vivo (Tadeo, 29/10): el plan confirmado fija solo el orden de las OT
 * (y el de cada proceso); las fechas se vuelven a armar cada vez, desde hoy,
 * con lo que le falta a cada proceso (escaneo o checkeo manual) calculado con
 * los ⚙ Parámetros de ahora y la grilla de horarios de ahora. Lo que no se
 * terminó en su día pasa al día siguiente y todo lo demás se corre.
 * Cada proceso se dibuja desde el día en que arrancó (primer escaneo; o el
 * día del plan si tiene avance sin escaneo) hasta que termina.
 * Dos alertas distintas:
 *  - tarde: el proceso (o la OT) termina después de su semana objetivo;
 *  - corrido: termina después de lo que decía el plan confirmado.
 * Devuelve lo mismo que procesosPlan, con además, por OT: tarde, diasTarde,
 * diasCorrido, finConfirmado, objetivo; y por proceso: tarde, diasTarde,
 * corrido, diasCorrido, hastaConfirmado, empezo, manual (lo manda un
 * "⏱ Faltan X h", migración 145), retrabajo (horas de retrabajo sin terminar,
 * migración 147: van al final del proceso, aunque estuviera completo) y
 * retrabajoDesde/retrabajoIni (dónde empieza la parte roja de la barra).
 * @param {{ manual?: Map<string, { horas: number, pendiente: number|null }>, proyectos?: Map<string, object>, etapasCodigo: Record<string, number|null>, avance?: object[], piezas?: object[], modulos?: Map<string, number>, terminadas?: Set<string>, hoy: string, params?: object, horasSemana?: number[], personal?: object|null, diasExtra?: Set<string>|null }} opciones
 *   proyectos: las OT por número (fecha objetivo y datos para las horas)
 */
export function planVivo(items = [], opciones) {
  const { proyectos = new Map(), etapasCodigo = {}, avance = [], piezas = [], modulos = new Map(), terminadas = new Set(), hoy,
    params = null, horasSemana = HORAS_SEMANA_POR_DEFECTO, personal = null, diasExtra = null, manual = null, retrabajo = null } = opciones;
  const confirmado = procesosPlan(items, { etapasCodigo, avance, piezas, terminadas, hoy, params, horasSemana, personal, diasExtra });
  const out = new Map();
  if (!confirmado.size) return out;
  const { ots, ordenEtapa } = ordenDeItems(items);
  const ef = (params?.eficiencia || 100) / 100;
  const falta = (ot, etapa) => (terminadas.has(ot) ? 0 : pendienteEtapa({ ot, codigo: etapasCodigo?.[etapa], avance, piezas }));
  // Lo que falta de cada proceso, en horas de reloj (como el plan)
  const restantes = ots.map((o) => {
    const p = proyectos.get(o.ot);
    let horas;
    if (terminadas.has(o.ot)) horas = {};
    else {
      // Con los parámetros de ahora; si un proceso no da horas (la OT sin datos
      // de la planilla o el parámetro sin cargar), lo que decía el plan por lo que falta
      const h = p && params ? horasOt(p, params, { modulosEtiquetas: modulos.get(o.ot) || null, avance, piezas }) : null;
      horas = Object.fromEntries(ETAPAS_PLAN.map(({ id }) => {
        const vivo = (h?.etapas[id]?.gente || 0) / ef;
        return [id, vivo > 0 ? vivo : (o.horas[id] || 0) * falta(o.ot, id)];
      }));
    }
    return { clave: o.ot, horas };
  });
  const extras = diasExtra ? new Set([...diasExtra].filter((f) => f >= hoy)) : null;
  const cal = calendario(hoy, horasSemana, extras);
  // "⏱ Faltan X h" (145): X son horas como las muestra el Gantt (de máquina,
  // o de Armado con los armadores que le tocan); se pasan a horas de gente
  const manuales = [];
  for (const r of restantes) {
    for (const { id } of ETAPAS_PLAN) {
      const m = manual?.get(`${r.clave}|${id}`);
      const resta = m && !terminadas.has(r.clave) ? falta(r.clave, id) : 0;
      if (m && resta > 0) manuales.push({ r, id, horas: horasManuales(m, resta) });
    }
  }
  // Retrabajo (147): horas como las muestra el Gantt, que se suman al proceso hasta que se termina
  const retrabajos = [];
  for (const r of restantes) {
    if (terminadas.has(r.clave)) continue;
    for (const { id } of ETAPAS_PLAN) {
      const h = Number(retrabajo?.get(`${r.clave}|${id}`)) || 0;
      if (h > 0) retrabajos.push({ r, id, horas: h });
    }
  }
  const usaArmado = [...manuales, ...retrabajos].some((m) => m.id === "armado");
  const armadores = usaArmado ? secuenciar(restantes, { params, personal, ordenEtapa }) : null;
  const aGente = (r, id) => (id === "armado" ? (armadores.get(r.clave) || []).find((t) => t.etapa === "armado")?.personas || 1 : 1 / duracion(id, 1, params));
  for (const { r, id, horas } of manuales) r.horas = { ...r.horas, [id]: horas * aGente(r, id) };
  for (const { r, id, horas } of retrabajos) r.horas = { ...r.horas, [id]: (r.horas[id] || 0) + horas * aGente(r, id) };
  const conRetrabajo = new Map(retrabajos.map((m) => [`${m.r.clave}|${m.id}`, m.horas]));
  const conManual = new Set(manuales.map((m) => `${m.r.clave}|${m.id}`));
  const tramos = secuenciar(restantes, { params, personal, ordenEtapa });

  for (const o of ots) {
    const c = confirmado.get(o.ot);
    const objetivo = proyectos.get(o.ot)?.fecha_objetivo || null;
    const porEtapa = new Map((tramos.get(o.ot) || []).map((t) => [t.etapa, t]));
    const procesos = [];
    for (const { id, nombre } of ETAPAS_PLAN) {
      const qc = c?.procesos.find((q) => q.etapa === id) || null;
      const tr = porEtapa.get(id);
      if (!qc && !tr) continue;
      const resta = falta(o.ot, id);
      const fila = (piezas || []).find((x) => String(x.ot) === o.ot && Number(x.etapa) === Number(etapasCodigo?.[id]));
      const empezo = fila?.primer_paso ? diaArg(fila.primer_paso) : resta < 1 && qc && qc.desde < hoy ? qc.desde : null;
      let q;
      if (tr) {
        const a = cal.punto(tr.t0, false);
        const b = cal.punto(tr.t1, true);
        const desde = empezo && empezo < a.fecha ? empezo : a.fecha;
        q = { etapa: id, nombre, desde, hasta: b.fecha, ini: desde === a.fecha ? a.frac : 0, fin: b.frac, t0: tr.t0, horas: tr.horas, personas: tr.personas, completo: false };
      } else {
        // Terminado (o sin horas que hacer): desde que arrancó hasta su último escaneo, o hasta donde decía el plan
        const hasta = fila?.ultimo_paso ? diaArg(fila.ultimo_paso) : qc.hasta < hoy ? qc.hasta : hoy;
        const desde = empezo && empezo <= hasta ? empezo : qc.desde <= hasta ? qc.desde : hasta;
        q = { etapa: id, nombre, desde, hasta, ini: desde === qc.desde ? qc.ini : 0, fin: hasta === qc.hasta ? qc.fin : 1, t0: -1, horas: qc.horas, personas: qc.personas, completo: resta <= 0 };
      }
      q.manual = conManual.has(`${o.ot}|${id}`);
      // Retrabajo: la parte final del proceso (en rojo en el Gantt)
      const rt = tr ? conRetrabajo.get(`${o.ot}|${id}`) || 0 : 0;
      q.retrabajo = rt;
      if (rt > 0) {
        const r0 = cal.punto(Math.max(tr.t0, tr.t1 - Math.min(rt, tr.t1 - tr.t0)), false);
        q.retrabajoDesde = r0.fecha;
        q.retrabajoIni = r0.frac;
      }
      q.pendiente = resta;
      q.hecho = Math.round((1 - resta) * 100);
      q.empezo = empezo;
      q.hastaConfirmado = qc?.hasta || null;
      q.diasCorrido = !q.completo && qc ? Math.max(0, diasEntre(qc.hasta, q.hasta)) : 0;
      q.corrido = q.diasCorrido > 0;
      q.diasTarde = !q.completo && objetivo ? Math.max(0, diasEntre(objetivo, q.hasta)) : 0;
      q.tarde = q.diasTarde > 0;
      // Lo mismo con los nombres de antes (⏰ OT atrasadas, colores del Gantt)
      q.atrasado = q.tarde;
      q.diasAtraso = q.diasTarde;
      q.margen = q.corrido && !q.tarde;
      q.motivoMargen = q.corrido ? `se corrió ${q.diasCorrido} ${q.diasCorrido === 1 ? "día" : "días"} del plan confirmado` : null;
      procesos.push(q);
    }
    if (!procesos.length) continue;
    const fin = maxFecha(procesos.map((q) => q.hasta));
    const abiertos = procesos.filter((q) => !q.completo);
    const diasTarde = objetivo && abiertos.length ? Math.max(0, diasEntre(objetivo, fin)) : 0;
    out.set(o.ot, {
      ot: o.ot,
      inicio: minFecha(procesos.map((q) => q.desde)),
      fin,
      horas: abiertos.reduce((t, q) => t + q.horas, 0), // lo que le falta a la OT
      procesos,
      atrasados: procesos.filter((q) => q.tarde),
      pocoMargen: procesos.filter((q) => q.margen),
      objetivo,
      tarde: diasTarde > 0,
      diasTarde,
      finConfirmado: c?.fin || null,
      // Lo que más se corrió alguno de sus procesos
      diasCorrido: Math.max(0, ...procesos.map((q) => q.diasCorrido)),
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
 * ⏰ OT atrasadas según el plan vivo: las OT abiertas que van a terminar
 * después de su semana (dias = días tarde) o que se corrieron del plan
 * confirmado (corrido = días). Primero la más tarde.
 * @returns {{ fila: object, dias: number, corrido: number, porcentaje: number|null, procesos: object[] }[]}
 */
export function otAtrasadasPlan(filas = [], procesos = new Map(), { porEscaneo = new Map() } = {}) {
  const out = [];
  for (const f of filas || []) {
    const r = procesos.get(String(f.proyecto?.ot));
    if (!r || f.proyecto.terminado_planilla) continue;
    const dias = r.diasTarde ?? Math.max(0, ...r.atrasados.map((p) => p.diasAtraso));
    const corrido = r.diasCorrido || 0;
    if (!(dias > 0) && !(corrido > 0)) continue;
    out.push({ fila: f, dias, corrido, porcentaje: porcentajeOt(f, porEscaneo), procesos: dias > 0 ? r.atrasados : r.procesos.filter((q) => q.corrido) });
  }
  return out.sort((a, b) => b.dias - a.dias || b.corrido - a.corrido || String(a.fila.proyecto.ot).localeCompare(String(b.fila.proyecto.ot), "es", { numeric: true }));
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

/**
 * Cuándo se confirmó el plan más nuevo (ISO), sin contar la vista previa del
 * reordenar: los motivos anotados antes no cubren lo que se corrió después.
 */
export function ultimaConfirmacion(planes = []) {
  return (planes || []).map((p) => String(p?.confirmado_at || "")).filter((f) => f && !f.startsWith("9999")).sort().pop() || null;
}
