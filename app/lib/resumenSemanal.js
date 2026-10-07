// app/lib/resumenSemanal.js — Resumen semanal para el dueño (D10, ítem 31):
// horas por OT, tiempo muerto por causa y ausencias de la semana pasada.

export const CAUSAS = { M: "Falta material", H: "Falta herramienta", I: "Esperando indicación", O: "Otro" };
// Solicitudes aprobadas que cubren un día sin fichar (no es falta sin aviso)
export const TIPOS_QUE_JUSTIFICAN = ["ausencia", "vacaciones", "justificacion"];

const DIAS_KEY = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
const MAX_OTS = 8;

function sumarDias(fecha, n) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Lunes a domingo de la semana anterior a `hoy` (YYYY-MM-DD). */
export function semanaAnterior(hoy) {
  const d = new Date(`${hoy}T12:00:00Z`);
  const lunesActual = sumarDias(hoy, -((d.getUTCDay() + 6) % 7));
  return { desde: sumarDias(lunesActual, -7), hasta: sumarDias(lunesActual, -1) };
}

/** Fechas (inclusive) del período. */
export function fechasDe(desde, hasta) {
  const out = [];
  for (let f = desde; f <= hasta && out.length < 40; f = sumarDias(f, 1)) out.push(f);
  return out;
}

/** Minutos de un registro de actividad (duracion_min o fin − inicio). */
function minutosDe(a) {
  const d = Number(a.duracion_min);
  if (Number.isFinite(d) && d > 0) return d;
  if (!a.hora_inicio || !a.hora_fin) return 0;
  const m = (Date.parse(a.hora_fin) - Date.parse(a.hora_inicio)) / 60000;
  return Number.isFinite(m) && m > 0 ? m : 0;
}

function cubierto(sols, legajo, fecha) {
  return sols.some((s) => String(s.legajo) === String(legajo) && s.fecha <= fecha && (s.fecha_hasta || s.fecha) >= fecha);
}

/**
 * Arma el resumen. Entradas (todas de la empresa y del período):
 *  - actividades: registro_actividades { legajo, codigo_proyecto, etapa, causa, duracion_min, hora_inicio, hora_fin }
 *  - fichadas:    { legajo, fecha, horas_trabajadas, llegada_tarde }
 *  - solicitudes: aprobadas que justifican { legajo, fecha, fecha_hasta, tipo }
 *  - empleados:   operativos activos { legajo, nombre, diagrama, created_at }
 *  - proyectos:   { ot, cliente, proyecto } para ponerle nombre a cada OT
 */
export function armarResumen({ desde, hasta, actividades = [], fichadas = [], solicitudes = [], empleados = [], proyectos = [] }) {
  // Horas por OT
  const porOT = new Map();
  const muerto = new Map();
  for (const a of actividades) {
    const min = minutosDe(a);
    if (!min) continue;
    if (Number(a.etapa) === 0) {
      const causa = CAUSAS[a.causa] ? a.causa : "O";
      muerto.set(causa, (muerto.get(causa) || 0) + min);
    } else if (a.codigo_proyecto) {
      porOT.set(a.codigo_proyecto, (porOT.get(a.codigo_proyecto) || 0) + min);
    }
  }
  const nombreOT = new Map(proyectos.map((p) => [String(p.ot), [p.cliente, p.proyecto].filter(Boolean).join(" · ")]));
  const ots = [...porOT.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([ot, min]) => ({ ot, detalle: nombreOT.get(String(ot)) || "", horas: +(min / 60).toFixed(1) }));
  const minutosOT = [...porOT.values()].reduce((a, b) => a + b, 0);
  const minutosMuerto = [...muerto.values()].reduce((a, b) => a + b, 0);

  // Asistencia
  const horasFichadas = fichadas.reduce((t, f) => t + (Number(f.horas_trabajadas) || 0), 0);
  const tardanzas = fichadas.filter((f) => f.llegada_tarde).length;
  const fichoEl = new Set(fichadas.map((f) => `${f.legajo}|${f.fecha}`));
  const fechas = fechasDe(desde, hasta);
  const faltas = [];
  let diasJustificados = 0;
  for (const e of empleados) {
    let sinAviso = 0;
    const alta = String(e.created_at || "").slice(0, 10);
    for (const fecha of fechas) {
      if (alta && fecha < alta) continue; // todavía no estaba en la empresa
      const dia = DIAS_KEY[new Date(`${fecha}T12:00:00Z`).getUTCDay()];
      if (!e.diagrama?.[dia]) continue; // no le tocaba trabajar
      if (fichoEl.has(`${e.legajo}|${fecha}`)) continue;
      if (cubierto(solicitudes, e.legajo, fecha)) { diasJustificados++; continue; }
      sinAviso++;
    }
    if (sinAviso > 0) faltas.push({ legajo: e.legajo, nombre: e.nombre, dias: sinAviso });
  }
  faltas.sort((a, b) => b.dias - a.dias);

  return {
    desde,
    hasta,
    empleados: empleados.length,
    horasFichadas: +horasFichadas.toFixed(1),
    tardanzas,
    horasEnOTs: +(minutosOT / 60).toFixed(1),
    ots: ots.slice(0, MAX_OTS),
    otrasOTs: Math.max(0, ots.length - MAX_OTS),
    tiempoMuerto: {
      horas: +(minutosMuerto / 60).toFixed(1),
      porcentaje: minutosOT + minutosMuerto > 0 ? Math.round((minutosMuerto / (minutosOT + minutosMuerto)) * 100) : 0,
      causas: [...muerto.entries()].sort((a, b) => b[1] - a[1]).map(([c, min]) => ({ causa: CAUSAS[c], horas: +(min / 60).toFixed(1) })),
    },
    faltasSinAviso: faltas,
    diasJustificados,
  };
}

/** ¿Vale la pena mandarlo? Sin nada registrado en la semana, no. */
export function resumenVacio(r) {
  return r.horasFichadas === 0 && r.horasEnOTs === 0 && r.tiempoMuerto.horas === 0;
}
