// app/lib/capacidadReal.js — La capacidad de la planta con lo que de verdad
// hay (auditoría del 12/11, parte 7; Tadeo: "que bajen la capacidad solas,
// dando aviso igualmente"). Sin migración.
//
//   - Vacaciones, ausencias y faltas justificadas aprobadas: ese operario no
//     suma horas esos días.
//   - Feriados de la planificación: nadie suma horas (como en el Gantt).
//   - Máquinas paradas o fuera de servicio (Mantenimiento → Maquinaria): la
//     seccionadora, la pegadora de canto y la CNC o el router restan de las
//     máquinas de su proceso mientras no vuelvan a servicio.
// Todo sale con su aviso, para que se vea por qué bajó.

/** Las solicitudes aprobadas que sacan al operario todo el día. */
export const TIPOS_FUERA = ["vacaciones", "ausencia", "justificacion"];

/** Qué proceso de la planificación hace cada tipo de máquina. */
export const PROCESO_DE_MAQUINA = { seccionadora: "corte", pegadora: "canteado", cnc: "mecanizado", router: "mecanizado" };
const NOMBRE_PROCESO = { corte: "Corte", canteado: "Canteado", mecanizado: "Mecanizado" };

const DIA = 86400000;
const fechaDe = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || "")) ? String(v).slice(0, 10) : null);
const sumar = (f, n) => new Date(Date.parse(`${f}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10);
const corta = (f) => { const [, m, d] = String(f).split("-"); return `${Number(d)}/${Number(m)}`; };

/**
 * Los días que cada operario no está (de las solicitudes aprobadas).
 * @param {object[]} solicitudes con empleado_id, legajo, tipo, estado, fecha, fecha_hasta
 * @param {object[]} operarios con id y legajo
 * @returns {Map<string, Set<string>>} id del empleado → fechas AAAA-MM-DD
 */
export function ausenciasDe(solicitudes = [], operarios = []) {
  const porLegajo = new Map(operarios.filter((e) => e.legajo != null).map((e) => [String(e.legajo), e.id]));
  const ids = new Set(operarios.map((e) => e.id));
  const out = new Map();
  for (const s of solicitudes) {
    if (s.estado !== "aprobado" || !TIPOS_FUERA.includes(s.tipo)) continue;
    const id = s.empleado_id && ids.has(s.empleado_id) ? s.empleado_id : porLegajo.get(String(s.legajo));
    const desde = fechaDe(s.fecha);
    if (!id || !desde) continue;
    const hasta = fechaDe(s.fecha_hasta) || desde;
    if (hasta < desde) continue;
    if (!out.has(id)) out.set(id, new Set());
    // Como mucho un año por solicitud
    for (let f = desde, i = 0; f <= hasta && i < 366; f = sumar(f, 1), i++) out.get(id).add(f);
  }
  return out;
}

/**
 * Máquinas que hoy no trabajan, por proceso, de la división (o sin división).
 * @returns {{ corte: number, canteado: number, mecanizado: number, lista: object[] }}
 */
export function maquinasParadas(maquinas = [], division = null) {
  const out = { corte: 0, canteado: 0, mecanizado: 0, lista: [] };
  const k = (s) => String(s || "").trim().toLowerCase();
  for (const m of maquinas) {
    const proceso = PROCESO_DE_MAQUINA[m.tipo];
    if (!proceso || m.activo === false || !["parada", "fuera_de_servicio"].includes(m.estado)) continue;
    if (division && m.division && k(m.division) !== k(division.id) && k(m.division) !== k(division.nombre)) continue;
    out[proceso] += 1;
    out.lista.push({ id: m.id, codigo: m.codigo, nombre: m.nombre, estado: m.estado, proceso });
  }
  return out;
}

/**
 * Los avisos de lo que bajó la capacidad en el período.
 * @param {{ operarios: object[], ausencias: Map<string, Set<string>>, dias: string[], paradas: object, cantidades: object, feriados?: Set<string> }} d
 * @returns {string[]}
 */
export function avisosCapacidad({ operarios = [], ausencias = new Map(), dias = [], paradas = null, cantidades = {}, feriados = null }) {
  const avisos = [];
  const enPeriodo = new Set(dias);
  for (const e of operarios) {
    const suyos = [...(ausencias.get(e.id) || [])].filter((f) => enPeriodo.has(f)).sort();
    if (!suyos.length) continue;
    const rango = suyos.length === 1 ? `el ${corta(suyos[0])}` : `del ${corta(suyos[0])} al ${corta(suyos[suyos.length - 1])}`;
    avisos.push(`${e.nombre || "Un operario"} no está ${rango} (${suyos.length} día${suyos.length === 1 ? "" : "s"})`);
  }
  const fer = dias.filter((f) => feriados?.has(f));
  if (fer.length) avisos.push(`Feriado${fer.length === 1 ? "" : "s"}: ${fer.map(corta).join(", ")}`);
  for (const m of paradas?.lista || []) {
    const quedan = Math.max(0, (cantidades[m.proceso] || 1) - (paradas[m.proceso] || 0));
    avisos.push(`${m.codigo || m.nombre} ${m.estado === "parada" ? "parada" : "fuera de servicio"}: ${NOMBRE_PROCESO[m.proceso]} queda con ${quedan} máquina${quedan === 1 ? "" : "s"} hasta que vuelva a servicio`);
  }
  return avisos;
}
