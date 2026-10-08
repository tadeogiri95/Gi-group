// app/lib/onboarding.js — Alta self-service (ítem 24, F4-14, D17): horario tipo
// del asistente y checklist de activación de los primeros 14 días.

export const DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
export const DIAS_LABEL = { lun: "Lun", mar: "Mar", mie: "Mié", jue: "Jue", vie: "Vie", sab: "Sáb", dom: "Dom" };
export const DIAS_CHECKLIST = 14;

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Horario tipo por defecto: lunes a viernes de 8 a 17. */
export function horarioTipoDefault() {
  return { dias: ["lun", "mar", "mie", "jue", "vie"], entrada: "08:00", salida: "17:00" };
}

/**
 * Pasa el horario tipo ({ dias, entrada, salida }) al formato `diagrama` de
 * empleados: { lun: { in, out } | null, ... }. Devuelve null si es inválido.
 * La salida puede ser menor que la entrada (turno noche).
 */
export function diagramaDesde({ dias, entrada, salida } = {}) {
  if (!Array.isArray(dias) || dias.length === 0) return null;
  if (!HORA.test(entrada || "") || !HORA.test(salida || "") || entrada === salida) return null;
  const d = {};
  for (const dia of DIAS) d[dia] = dias.includes(dia) ? { in: entrada, out: salida } : null;
  return d;
}

function minutos(h) {
  const [hh, mm] = h.split(":").map(Number);
  return hh * 60 + mm;
}

/** Valida un diagrama recibido del cliente. Devuelve una copia limpia o null. */
export function validarDiagrama(diagrama) {
  if (!diagrama || typeof diagrama !== "object" || Array.isArray(diagrama)) return null;
  const limpio = {};
  let alguno = false;
  for (const dia of DIAS) {
    const v = diagrama[dia];
    if (v == null) { limpio[dia] = null; continue; }
    if (typeof v !== "object" || !HORA.test(v.in || "") || !HORA.test(v.out || "") || v.in === v.out) return null;
    limpio[dia] = { in: v.in, out: v.out };
    alguno = true;
  }
  return alguno ? limpio : null;
}

/** Horas semanales de un diagrama (cruza la medianoche si la salida es menor). */
export function horasSemanales(diagrama) {
  let total = 0;
  for (const dia of DIAS) {
    const v = diagrama?.[dia];
    if (!v) continue;
    let m = minutos(v.out) - minutos(v.in);
    if (m <= 0) m += 24 * 60;
    total += m;
  }
  return Math.round(total / 60);
}

/** Texto corto: "Lun a Vie · 08:00 a 17:00". */
export function textoHorario({ dias = [], entrada, salida } = {}) {
  const orden = DIAS.filter((d) => dias.includes(d));
  if (orden.length === 0) return "Sin días";
  const seguidos = orden.every((d, i) => i === 0 || DIAS.indexOf(d) === DIAS.indexOf(orden[i - 1]) + 1);
  const diasTxt = seguidos && orden.length > 2
    ? `${DIAS_LABEL[orden[0]]} a ${DIAS_LABEL[orden.at(-1)]}`
    : orden.map((d) => DIAS_LABEL[d]).join(", ");
  return `${diasTxt} · ${entrada} a ${salida}`;
}

/**
 * ¿Se muestra el checklist? Solo los primeros 14 días desde el alta de la
 * empresa, si no lo cerraron y mientras quede algo por hacer.
 */
export function mostrarChecklist({ creadaEl, cerrado, pasos, ahora = Date.now() }) {
  if (cerrado) return false;
  const t = Date.parse(creadaEl || "");
  if (!Number.isFinite(t)) return false;
  if (ahora - t > DIAS_CHECKLIST * 24 * 60 * 60 * 1000) return false;
  return Array.isArray(pasos) && pasos.some((p) => !p.hecho);
}

/** Días que quedan del período de activación (mínimo 0). */
export function diasRestantes(creadaEl, ahora = Date.now()) {
  const t = Date.parse(creadaEl || "");
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil((t + DIAS_CHECKLIST * 86400000 - ahora) / 86400000));
}

/**
 * Pasos del checklist a partir de lo que ya existe en la empresa.
 * `hay` = { ubicacion, horario, equipo, equipoActivo, ot, fichada, tarea }.
 * `ir` es la pantalla de gestión donde se resuelve.
 */
export function pasosActivacion(hay = {}) {
  return [
    { id: "ubicacion", titulo: "Cargar la ubicación de la planta", detalle: "Para que solo se pueda fichar estando ahí.", hecho: !!hay.ubicacion, ir: "config:ubicaciones" },
    { id: "horario", titulo: "Asignar el horario de trabajo", detalle: "Con el horario se calculan las tardanzas y las horas.", hecho: !!hay.horario, ir: "config:horarios" },
    { id: "equipo", titulo: "Cargar a tu equipo", detalle: "Uno por uno, con un archivo o desde el asistente.", hecho: !!hay.equipo, ir: "equipo" },
    { id: "equipoActivo", titulo: "Que tu equipo entre a la app", detalle: "Imprimí los QR de activación desde Equipo.", hecho: !!hay.equipoActivo, ir: "equipo" },
    { id: "ot", titulo: "Crear la primera OT", detalle: "Las tareas se cargan contra una orden de trabajo.", hecho: !!hay.ot, ir: "config:proyectos" },
    { id: "fichada", titulo: "Primera fichada", detalle: "Alguien de tu equipo ficha su entrada.", hecho: !!hay.fichada, ir: null },
    { id: "tarea", titulo: "Primera tarea registrada", detalle: "Un operario inicia una tarea sobre una OT.", hecho: !!hay.tarea, ir: null },
  ];
}
