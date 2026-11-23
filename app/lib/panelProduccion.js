// app/lib/panelProduccion.js — Panel de control de la producción (Tadeo,
// 23/11): los indicadores que mira un jefe de planta de una fábrica de
// muebles, aberturas o herrería, en una pestaña de Producción.
//
// Todo sale de lo que Gypi ya registra (sin migración): escaneos y % manual,
// plan confirmado, actas, retrabajos, no conformidades, pendientes de obra,
// fallas de máquinas, fichadas y pausas. La semana elegida (de lunes a
// domingo) se compara con las 4 anteriores.
//
// Cinco bloques:
//   1. Entregas   OT entregadas en su semana (acta firmada, o cerrada con la
//                 producción hecha) contra su fecha objetivo; OT que según el
//                 plan vivo van a llegar tarde; OT en pausa y por qué.
//   2. Plan       cumplimiento del plan semanal (el mismo cálculo del informe
//                 de producción) y carga de la planta: horas del plan
//                 confirmado contra las horas de la grilla de los operarios.
//   3. Velocidad  lead time en horas de jornada, OT y piezas terminadas,
//                 $ producidos (solo quien ve precios) y OT en proceso por
//                 etapa (lo mismo que el 🗂️ Trello). El cuello de botella es
//                 la etapa donde más OT esperan.
//   4. Calidad    % de OT terminadas sin retrabajo, horas de retrabajo y sus
//                 motivos, no conformidades por defecto, pendientes de obra.
//   5. Máquinas   horas de máquina parada por falla, fallas nuevas,
//                 preventivo del mes, tiempo medio entre fallas y de arreglo.
//                 (Sin ausentismo ni llegadas tarde: la asistencia no la lleva
//                 Gypi por ahora; Tadeo, 23/11.)
// No hay OEE ni productividad por hora-hombre: sin "Iniciar Tarea" no se
// registran las paradas cortas ni las horas por OT (Tadeo eligió el panel con
// lo que ya hay, 23/11).
import { ETAPAS_PLAN } from "./planificacion";
import { hoyArg } from "./dates";
import { periodoDe, calcularInforme } from "./informeProduccion";
import { tableroEtapas, instalacionPorOt, pctPorProceso, otsDelPlan } from "./tableroEtapas";
import { leadTimeProcesos, ventanasDeGrilla } from "./leadTimeHoras";
import { ventanasSemana, capacidadPlanta, operariosDePlanta, diasDelPeriodo } from "./cargaPlanta";
import { piezasConManual } from "./avanceManual";
import { normalizarParametros } from "./planificacion";
import { feriadosDe } from "./secuencia";
import { diasEntre } from "./semanaObjetivo";
import { pausasAbiertas, textoMotivoPausa } from "./pausaOt";
import { textoMotivoRetrabajo } from "./retrabajo";
import { nombreDefecto } from "./calidad";
import { tramosParada, indicadoresMaquinaria } from "./fallasMaquinaria";
import { datosOt } from "./nombreOt";

/** Semanas que se comparan: la elegida y las 4 anteriores. */
export const SEMANAS_PANEL = 5;

/**
 * Semáforo de cada indicador: verde (bien), amarillo (atención) o rojo (mal).
 * Metas de referencia de una Pyme de amoblamiento, aberturas o herrería.
 * menor: el número es mejor cuanto más bajo.
 */
export const METAS = {
  entregas: { bien: 90, atencion: 75, texto: "Meta: 90 % o más a tiempo" },
  cumplimiento: { bien: 90, atencion: 75, texto: "Meta: 90 % o más de lo planificado" },
  sinRetrabajo: { bien: 95, atencion: 85, texto: "Meta: 95 % o más sin retrabajo" },
  preventivo: { bien: 80, atencion: 50, texto: "Meta: 80 % o más del preventivo hecho" },
};

const DIA = 86400000;
const redondear = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const pct = (parte, base) => (base > 0 ? redondear((parte / base) * 100) : null);
const promedio = (xs) => (xs.length ? redondear(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
const diaDe = (ts) => (ts ? hoyArg(new Date(ts)) : null);
const enSemana = (dia, s) => !!dia && dia >= s.desde && dia <= s.hasta;
const sumarDias = (f, n) => new Date(Date.parse(`${f}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10);
/** Inicio y fin de la semana en milisegundos (hora de Argentina). */
const limites = (s) => [Date.parse(`${s.desde}T00:00:00-03:00`), Date.parse(`${sumarDias(s.hasta, 1)}T00:00:00-03:00`)];

/** La semana de la fecha (de lunes a domingo) y las anteriores, la más vieja primero. */
export function semanasPanel(fecha, n = SEMANAS_PANEL) {
  const ultima = periodoDe("semana", fecha);
  return Array.from({ length: n }, (_, i) => {
    const desde = sumarDias(ultima.desde, -7 * (n - 1 - i));
    return { desde, hasta: sumarDias(desde, 6) };
  });
}

/** "bien" | "atencion" | "mal" según la meta; null sin dato. */
export function semaforo(valor, meta) {
  if (valor == null || !meta) return null;
  if (meta.menor) return valor <= meta.bien ? "bien" : valor <= meta.atencion ? "atencion" : "mal";
  return valor >= meta.bien ? "bien" : valor >= meta.atencion ? "atencion" : "mal";
}

/** Fin de la producción de una tarjeta del tablero: cuando terminó el último de sus procesos. */
export function finProduccionDe(t) {
  const procesos = t?.procesos || [];
  if (!procesos.length || !procesos.every((q) => q.fin)) return null;
  return procesos.reduce((m, q) => (!m || Date.parse(q.fin) > Date.parse(m) ? q.fin : m), null);
}

/**
 * OT entregadas en la semana contra su fecha objetivo. Entregada = acta
 * firmada, o cerrada con la producción hecha (el fin de la OT del tablero).
 * Las que no tienen fecha objetivo cuentan como entregadas pero no entran en el %.
 */
export function entregasDeSemana(porOt, s) {
  const filas = [];
  for (const t of porOt.values()) {
    const dia = diaDe(t.fin);
    if (!enSemana(dia, s)) continue;
    const objetivo = t.proyecto?.fecha_objetivo ? String(t.proyecto.fecha_objetivo).slice(0, 10) : null;
    const diasTarde = objetivo && dia > objetivo ? diasEntre(objetivo, dia) : 0;
    filas.push({ ot: t.ot, ...datosOt(t.proyecto), dia, objetivo, aTiempo: objetivo ? diasTarde === 0 : null, diasTarde, horas: t.horas });
  }
  const conFecha = filas.filter((f) => f.aTiempo != null);
  const aTiempo = conFecha.filter((f) => f.aTiempo).length;
  return {
    entregadas: filas.length, conFecha: conFecha.length, aTiempo, pct: pct(aTiempo, conFecha.length),
    tarde: filas.filter((f) => f.aTiempo === false).sort((a, b) => b.diasTarde - a.diasTarde),
    sinFecha: filas.length - conFecha.length,
    leadTime: promedio(filas.map((f) => f.horas).filter((h) => h != null)),
  };
}

/** OT con la producción terminada en la semana, piezas escaneadas y lo que valen. */
export function produccionDeSemana(porOt, pasos, s, precios = null, estimadas = new Set()) {
  const ots = [];
  for (const t of porOt.values()) {
    const fin = finProduccionDe(t);
    if (enSemana(diaDe(fin), s)) ots.push(t);
  }
  const piezas = (pasos || []).filter((p) => enSemana(diaDe(p.created_at), s)).length;
  const valor = precios ? ots.reduce((sum, t) => sum + (precios.get(String(t.ot)) || 0), 0) : null;
  // De ese valor, lo estimado por materiales (OT sin PRECIO en el Plan, 23/11)
  const valorEstimado = precios ? ots.filter((t) => estimadas.has(String(t.ot))).reduce((sum, t) => sum + (precios.get(String(t.ot)) || 0), 0) : null;
  return {
    ots: ots.length, piezas, valor, valorEstimado,
    otsLista: ots.map((t) => t.ot),
    leadTime: promedio(ots.map((t) => t.produccion).filter((h) => h != null)),
  };
}

/** Horas del plan confirmado de la semana por proceso, contra las horas de la grilla de los operarios. */
export function cargaDeSemana(items, s, capacidad) {
  const porEtapa = Object.fromEntries(ETAPAS_PLAN.map(({ id }) => [id, 0]));
  for (const i of items || []) if (enSemana(i.fecha, s) && i.etapa in porEtapa) porEtapa[i.etapa] += Number(i.horas) || 0;
  const horas = Object.values(porEtapa).reduce((a, b) => a + b, 0);
  return {
    horas: redondear(horas),
    disponibles: capacidad == null ? null : redondear(capacidad),
    pct: capacidad > 0 ? redondear((horas / capacidad) * 100) : null,
    porEtapa: ETAPAS_PLAN.map(({ id, nombre }) => ({ etapa: id, nombre, horas: redondear(porEtapa[id]) })),
  };
}

/** Semáforo de la carga: bien entre 70 y 100 %, atención entre 50 y 70 o hasta 115, mal fuera de eso. */
export function semaforoCarga(valor) {
  if (valor == null) return null;
  if (valor >= 70 && valor <= 100) return "bien";
  if (valor >= 50 && valor <= 115) return "atencion";
  return "mal";
}

/** Retrabajos vigentes (no anulados) con horas. */
const vigentes = (retrabajos) => (retrabajos || []).filter((x) => !x.anulado_at && Number(x.horas) > 0);

/** Calidad de la semana. */
export function calidadDeSemana({ s, retrabajos = [], producidas = [], noConformidades = [], defectos = null, pendientes = [] }) {
  const rt = vigentes(retrabajos).filter((x) => enSemana(diaDe(x.created_at), s));
  const motivos = new Map();
  for (const x of rt) {
    const m = textoMotivoRetrabajo(x);
    motivos.set(m, redondear((motivos.get(m) || 0) + Number(x.horas)));
  }
  // OT terminadas en la semana que nunca tuvieron retrabajo (bien a la primera)
  const conRetrabajo = new Set(vigentes(retrabajos).map((x) => String(x.ot)));
  const sinRetrabajo = producidas.filter((ot) => !conRetrabajo.has(String(ot))).length;
  const nc = (noConformidades || []).filter((n) => enSemana(diaDe(n.created_at), s));
  const porDefecto = new Map();
  for (const n of nc) porDefecto.set(n.defecto, (porDefecto.get(n.defecto) || 0) + (Number(n.cantidad) || 1));
  return {
    horasRetrabajo: redondear(rt.reduce((t, x) => t + Number(x.horas), 0)),
    otsConRetrabajo: new Set(rt.map((x) => String(x.ot))).size,
    motivos: [...motivos].map(([motivo, horas]) => ({ motivo, horas })).sort((a, b) => b.horas - a.horas),
    producidas: producidas.length,
    sinRetrabajo: pct(sinRetrabajo, producidas.length),
    noConformidades: nc.reduce((t, n) => t + (Number(n.cantidad) || 1), 0),
    defectos: [...porDefecto].map(([cod, cantidad]) => ({ cod, nombre: nombreDefecto(defectos, cod), cantidad })).sort((a, b) => b.cantidad - a.cantidad),
    pendientesNuevos: (pendientes || []).filter((p) => enSemana(diaDe(p.created_at), s)).length,
  };
}

/** Horas de máquina parada por falla y fallas nuevas en la semana. */
export function maquinasDeSemana({ s, maquinas = [], fallas = [], ahora = Date.now() }) {
  const [desde, hasta] = limites(s);
  const fin = Math.min(hasta, ahora);
  let msParada = 0;
  const porMaquina = [];
  for (const m of maquinas) {
    let propio = 0;
    for (const [a, b] of tramosParada(fallas, m.id, ahora)) propio += Math.max(0, Math.min(b, fin) - Math.max(a, desde));
    msParada += propio;
    if (propio > 0) porMaquina.push({ codigo: m.codigo, nombre: m.nombre, horas: redondear(propio / 3600000) });
  }
  const nuevas = (fallas || []).filter((f) => f.estado !== "descartada" && Date.parse(f.created_at) >= desde && Date.parse(f.created_at) < hasta).length;
  return { horasParada: redondear(msParada / 3600000), fallas: nuevas, porMaquina: porMaquina.sort((a, b) => b.horas - a.horas) };
}

/**
 * OT en proceso por etapa (las columnas del 🗂️ Trello), lo que esperan y el
 * cuello de botella: la etapa de producción con más OT esperando (y más
 * horas de espera); Instalación no cuenta.
 */
export function enProceso(columnas, precios = null, estimadas = new Set()) {
  const etapas = (columnas || []).filter((c) => c.id !== "terminadas").map((c) => {
    const enCurso = c.tarjetas.filter((t) => t.estado === "en_curso");
    const esperando = c.tarjetas.filter((t) => t.estado === "esperando");
    return {
      id: c.id, nombre: c.nombre, enCurso: enCurso.length, esperando: esperando.length,
      horasEspera: redondear(esperando.reduce((s, t) => s + (t.lleva || 0), 0)),
      esperaPromedio: promedio(esperando.map((t) => t.lleva).filter((h) => h != null)),
    };
  });
  const tarjetas = (columnas || []).filter((c) => c.id !== "terminadas").flatMap((c) => c.tarjetas);
  // Instalación no es producción (Tadeo, 23/11): nunca es el cuello de botella
  const conEspera = etapas.filter((e) => e.esperando > 0 && e.id !== "instalacion");
  const cuello = conEspera.length ? conEspera.reduce((a, b) => (b.esperando > a.esperando || (b.esperando === a.esperando && b.horasEspera > a.horasEspera) ? b : a)) : null;
  return {
    etapas,
    ots: tarjetas.length,
    esperando: tarjetas.filter((t) => t.estado === "esperando").length,
    valor: precios ? tarjetas.reduce((s, t) => s + (precios.get(String(t.ot)) || 0), 0) : null,
    valorEstimado: precios ? tarjetas.filter((t) => estimadas.has(String(t.ot))).reduce((s, t) => s + (precios.get(String(t.ot)) || 0), 0) : null,
    cuello: cuello ? { id: cuello.id, nombre: cuello.nombre, esperando: cuello.esperando, horasEspera: cuello.horasEspera } : null,
  };
}

/** OT que según el plan vivo terminan después de su fecha límite. */
export function atrasadasPlan(vivo, proyectos = new Map()) {
  const filas = [...(vivo?.values?.() || [])].filter((r) => r.tarde)
    .map((r) => ({ ot: String(r.ot), ...datosOt(proyectos.get(String(r.ot))), diasTarde: r.diasTarde, objetivo: r.objetivo, fin: r.fin }))
    .sort((a, b) => b.diasTarde - a.diasTarde);
  const abiertas = [...(vivo?.values?.() || [])].filter((r) => (r.procesos || []).some((q) => !q.completo)).length;
  return { cantidad: filas.length, abiertas, diasPromedio: promedio(filas.map((f) => f.diasTarde)), ots: filas };
}

/** OT en pausa ahora, con el motivo. */
export function pausadasAhora(pausas, proyectos = new Map()) {
  const filas = [...pausasAbiertas(pausas).values()].map((p) => ({ ot: String(p.ot), ...datosOt(proyectos.get(String(p.ot))), motivo: textoMotivoPausa(p), desde: p.desde }));
  const motivos = new Map();
  for (const f of filas) motivos.set(f.motivo, (motivos.get(f.motivo) || 0) + 1);
  return { cantidad: filas.length, ots: filas, motivos: [...motivos].map(([motivo, cantidad]) => ({ motivo, cantidad })).sort((a, b) => b.cantidad - a.cantidad) };
}

/**
 * Arma el panel con todo lo leído de la base.
 * @param {object} d
 *   base: lo de cargarPlanVivo (vivo, vigentes, etapasCodigo, cfgValor, proyectos, divisiones, empleados, piezas, avance, retrabajos, pausas)
 *   pasos: escaneos (pasos_pieza requeridos) desde la primera semana
 *   manual, cargas, bultos, reportes, actas: los del tablero de etapas
 *   precios: Map OT → valor (PRECIO del Plan o estimado por materiales, 23/11), o null si el usuario no ve precios
 *   estimadas: Set de las OT cuyo valor es estimado
 *   noConformidades, defectos (lista de la empresa), pendientes (pendientes_obra)
 *   maquinas, tareasMaquinas, registrosMaquinas, fallas: los de Maquinaria
 *   fecha: un día de la semana elegida; hoy; ahora (Date)
 */
export function armarPanel(d) {
  const { base, pasos = [], manual = [], cargas = [], bultos = [], reportes = [], actas = [], precios = null, estimadas = new Set(),
    noConformidades = [], defectos = null, pendientes = [],
    maquinas = [], tareasMaquinas = [], registrosMaquinas = [], fallas = [], fecha, hoy, ahora = new Date() } = d;
  const { vivo, vigentes: items, etapasCodigo, cfgValor, proyectos = [], divisiones = [], empleados = [], piezas = [], avance = [], retrabajos = [], pausas = [] } = base;
  const semanas = semanasPanel(fecha);
  const params = normalizarParametros(cfgValor);
  const feriados = feriadosDe(params);
  const ventanas = ventanasDeGrilla(empleados, divisiones, cfgValor);
  const vInst = ventanasSemana((empleados || []).filter((e) => e.es_instalador));
  const porOtProyecto = new Map(proyectos.map((p) => [String(p.ot), p]));

  // El tablero de etapas (el 🗂️ Trello) de ahora: de ahí salen fin de cada
  // proceso, de la producción y de la OT, y lo que está en proceso
  const lead = leadTimeProcesos({ etapasCodigo, piezas, manual, avance, proyectos, ventanas, pausas, feriados, ahora });
  const tablero = tableroEtapas({
    proyectos, lead, pct: pctPorProceso(piezasConManual(piezas, proyectos)),
    instalacion: instalacionPorOt({ cargas, bultos, reportes, actas }), etapasCodigo, divisiones, ventanas,
    ventanasInstalacion: vInst.some(Boolean) ? vInst : ventanas, feriados, pausas,
    planProduccion: otsDelPlan(items), planInstalacion: null, ahora, diasTerminadas: 3650,
  });

  const planta = operariosDePlanta(empleados, divisiones, null);
  const ahoraMs = ahora.getTime();

  const filas = semanas.map((s) => {
    const informe = calcularInforme({ periodo: { tipo: "semana", ...s }, items, etapasCodigo, piezas, pasos, manual, avance, proyectos: porOtProyecto, vivo, retrabajos, pausas });
    const produccion = produccionDeSemana(tablero.porOt, pasos, s, precios, estimadas);
    const capacidad = capacidadPlanta(planta, diasDelPeriodo(s.desde, s.hasta), { feriados }).gente;
    return {
      ...s,
      futura: s.desde > hoy,
      entregas: entregasDeSemana(tablero.porOt, s),
      plan: { cumplimiento: informe.resumen.cumplimiento, procesosPlanificados: informe.resumen.procesosPlanificados, procesosCumplidos: informe.resumen.procesosCumplidos, carga: cargaDeSemana(items, s, capacidad) },
      produccion,
      calidad: calidadDeSemana({ s, retrabajos, producidas: produccion.otsLista, noConformidades, defectos, pendientes }),
      maquinas: maquinasDeSemana({ s, maquinas, fallas, ahora: ahoraMs }),
    };
  });

  const elegida = semanas[semanas.length - 1];
  const mes = elegida.hasta.slice(0, 7) <= hoy.slice(0, 7) ? elegida.hasta.slice(0, 7) : hoy.slice(0, 7);
  const ind = maquinas.length ? indicadoresMaquinaria({ maquinas, tareas: tareasMaquinas, registros: registrosMaquinas, fallas, meses: [mes], hoy, ahora: ahoraMs }) : null;
  const conFallas = ind ? ind.filas.filter((f) => f.entreFallasDias != null) : [];

  return {
    fecha, hoy,
    semanas: filas,
    conPrecios: !!precios,
    ahora: {
      enProceso: enProceso(tablero.columnas, precios, estimadas),
      atrasadas: atrasadasPlan(vivo, porOtProyecto),
      pausadas: pausadasAhora(pausas, porOtProyecto),
      pendientesAbiertos: (pendientes || []).filter((p) => !p.resuelto).length,
    },
    maquinasMes: ind ? {
      mes,
      preventivo: ind.total.cumplimiento.pct,
      tocaban: ind.total.cumplimiento.tocaban,
      hechas: ind.total.cumplimiento.hechas,
      arregloHoras: ind.total.arregloHoras == null ? null : redondear(ind.total.arregloHoras),
      entreFallasDias: conFallas.length ? promedio(conFallas.map((f) => f.entreFallasDias)) : null,
      maquinas: ind.filas.length,
    } : null,
  };
}
