// ═══════════════════════════════════════════════════════════
// app/lib/calc.js — Funciones de cálculo puras y reutilizables
//
// Antes estas funciones estaban duplicadas inline en page.js y en
// geolocalizacion_screen.jsx (haversine), o repartidas entre /api/fichar
// y reportes_screen.jsx (tardanza, horas, conteo de tardes).
//
// Centralizar acá permite:
//   1. Una única fuente de verdad de la lógica de negocio.
//   2. Testearlas con `node --test` (ver tests/calc.test.js).
//   3. Importarlas tanto desde el frontend como desde API routes.
// ═══════════════════════════════════════════════════════════

/**
 * Duración en minutos de un registro de actividad.
 * Prefiere la columna duracion_min (se escribe al cerrar la tarea desde
 * useActividad y /api/fichar); para filas cerradas antes de que ese cálculo
 * existiera, la deriva de los timestamps. Tarea aún abierta ⇒ 0.
 *
 * @param {{duracion_min?: number|string, hora_inicio?: string, hora_fin?: string}} r
 * @returns {number} minutos (puede tener decimales)
 */
export function duracionMinutos(r) {
  const guardada = parseFloat(r?.duracion_min);
  if (Number.isFinite(guardada) && guardada > 0) return guardada;
  if (r?.hora_inicio && r?.hora_fin) {
    const min = (new Date(r.hora_fin) - new Date(r.hora_inicio)) / 60000;
    return Number.isFinite(min) && min > 0 ? min : 0;
  }
  return 0;
}

/**
 * Distancia geográfica entre dos puntos GPS en metros.
 * Implementación de la fórmula de Haversine.
 *
 * @param {number} lat1 - Latitud del punto A (grados)
 * @param {number} lng1 - Longitud del punto A (grados)
 * @param {number} lat2 - Latitud del punto B (grados)
 * @param {number} lng2 - Longitud del punto B (grados)
 * @returns {number} Distancia en metros (sin redondear)
 */
export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Radio de la Tierra en metros
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Convierte una hora "HH:MM" a minutos desde 00:00.
 * Devuelve null si el formato es inválido.
 *
 * @param {string} hhmm - Hora en formato "HH:MM"
 * @returns {number|null}
 */
export function parseHoraAMinutos(hhmm) {
  if (typeof hhmm !== "string") return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Reglas de asistencia por empresa (empresa.reglas_asistencia, migración 068).
 * Son reglas de cada fábrica, no del producto (decisión D5): por defecto solo
 * hay tolerancia y NO se bloquea a nadie. Cada empresa las ajusta en "Reglas".
 *   tolerancia_min          minutos de gracia antes de contar como tarde
 *   bloqueo_min             si llega más tarde que esto, no puede fichar sin permiso (null = nunca)
 *   bloqueo_tardanzas_mes   a la N-ésima tardanza del mes se bloquea (null = nunca)
 *   permiso_salida_anticipada  para fichar salida antes del fin de la grilla
 *                              (menos la tolerancia) hace falta permiso aprobado
 */
export const REGLAS_ASISTENCIA_DEFAULT = Object.freeze({
  tolerancia_min: 5,
  bloqueo_min: null,
  bloqueo_tardanzas_mes: null,
  permiso_salida_anticipada: false,
});

/** Mezcla las reglas guardadas con los defaults, descartando valores inválidos. */
export function normalizarReglasAsistencia(reglas) {
  const r = { ...REGLAS_ASISTENCIA_DEFAULT };
  if (!reglas || typeof reglas !== "object") return r;
  const entero = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : undefined);
  const t = entero(reglas.tolerancia_min, 0, 120);
  if (t !== undefined) r.tolerancia_min = t;
  if (reglas.bloqueo_min === null) r.bloqueo_min = null;
  else if (entero(reglas.bloqueo_min, 1, 600) !== undefined) r.bloqueo_min = reglas.bloqueo_min;
  if (reglas.bloqueo_tardanzas_mes === null) r.bloqueo_tardanzas_mes = null;
  else if (entero(reglas.bloqueo_tardanzas_mes, 1, 31) !== undefined) r.bloqueo_tardanzas_mes = reglas.bloqueo_tardanzas_mes;
  if (typeof reglas.permiso_salida_anticipada === "boolean") r.permiso_salida_anticipada = reglas.permiso_salida_anticipada;
  return r;
}

/**
 * Calcula el estado de tardanza de un fichaje de ingreso según las reglas
 * de la empresa (ver REGLAS_ASISTENCIA_DEFAULT).
 *
 * @param {string} horaEsperada - Hora "HH:MM" del diagrama (ej "08:00")
 * @param {string} horaReal     - Hora "HH:MM" del fichaje real
 * @param {number} llegadasTardePreviasDelMes - cantidad ya acumulada antes de hoy
 * @param {object} [reglas]     - reglas de asistencia de la empresa
 * @returns {{ estado: "puntual"|"tarde"|"bloqueado", minutos: number, llegadasTarde: number, motivo?: string, tipoBloqueo?: "minutos"|"tardanzas" }}
 */
export function calcularTardanza(horaEsperada, horaReal, llegadasTardePreviasDelMes = 0, reglas) {
  const { tolerancia_min, bloqueo_min, bloqueo_tardanzas_mes } = normalizarReglasAsistencia(reglas);
  const esperado = parseHoraAMinutos(horaEsperada);
  const real = parseHoraAMinutos(horaReal);

  if (esperado == null || real == null) {
    return { estado: "puntual", minutos: 0, llegadasTarde: llegadasTardePreviasDelMes };
  }

  const diff = real - esperado;

  if (diff <= tolerancia_min) {
    return { estado: "puntual", minutos: Math.max(0, diff), llegadasTarde: llegadasTardePreviasDelMes };
  }

  const llegadas = llegadasTardePreviasDelMes + 1;

  if (bloqueo_min != null && diff > bloqueo_min) {
    return {
      estado: "bloqueado",
      tipoBloqueo: "minutos",
      minutos: diff,
      llegadasTarde: llegadas,
      motivo: `Tardanza de ${diff} min (supera el máximo de ${bloqueo_min} min)`,
    };
  }

  if (bloqueo_tardanzas_mes != null && llegadas >= bloqueo_tardanzas_mes) {
    return {
      estado: "bloqueado",
      tipoBloqueo: "tardanzas",
      minutos: diff,
      llegadasTarde: llegadas,
      motivo: `Llegada tarde n.º ${llegadas} del mes (el máximo es ${bloqueo_tardanzas_mes - 1})`,
    };
  }

  return { estado: "tarde", minutos: diff, llegadasTarde: llegadas };
}

/**
 * Calcula horas trabajadas (decimales) entre ingreso y egreso del mismo día,
 * recibiendo solo horas "HH:MM" (sin fecha). Si egreso < ingreso devuelve 0
 * en vez de negativo.
 *
 * No soporta cruce de medianoche — para eso hace falta la fecha de cada
 * extremo, que esta función no recibe. /api/fichar SÍ soporta turno nocturno,
 * pero con aritmética de timestamps completos (fecha+hora), no con esta
 * función — ver app/api/fichar/route.js.
 *
 * @param {string} horaIngreso - "HH:MM"
 * @param {string} horaEgreso  - "HH:MM"
 * @returns {number} horas decimales (ej 8.5)
 */
export function calcularHorasTrabajadas(horaIngreso, horaEgreso) {
  const ing = parseHoraAMinutos(horaIngreso);
  const egr = parseHoraAMinutos(horaEgreso);
  if (ing == null || egr == null) return 0;
  return Math.max(0, (egr - ing) / 60);
}

/**
 * Cuenta llegadas tarde a partir de un array de fichadas (típicamente del mes).
 *
 * @param {Array<{ llegada_tarde?: boolean }>} fichadas
 * @returns {{ total: number, pierdePresentismo: boolean }}
 *   pierdePresentismo = true cuando total >= 3
 *   (a la 3ra llegada tarde del mes se pierde el premio por presentismo)
 */
export function contarLlegadasTarde(fichadas) {
  if (!Array.isArray(fichadas)) return { total: 0, pierdePresentismo: false };
  const total = fichadas.reduce((n, f) => n + (f && f.llegada_tarde ? 1 : 0), 0);
  return { total, pierdePresentismo: total >= 3 };
}

/**
 * Pesos del score mensual de empleado (dashboard gerencial). Suman 100.
 * Documentación se redujo proporcionalmente de las 4 variables originales
 * (Asistencia 40, Puntualidad 25, Disponibilidad 20, Esfuerzo 15) para
 * dejarle 15 puntos.
 */
export const PESOS_SCORE = {
  asistencia: 34,
  puntualidad: 21,
  disponibilidad: 17,
  esfuerzo: 13,
  documentacion: 15,
};

/**
 * Calcula el score mensual (0-100) de un empleado operativo y su desglose
 * por variable. Única fuente de verdad — usado por dashboard_gerencia.jsx
 * (ranking) y por el Score Detail Modal.
 *
 * Documentación puntúa el 100% de su peso SOLO si están cargados TODOS los
 * documentos exigidos vigentes; cumplimiento parcial puntúa 0 (no
 * proporcional, a diferencia de las otras 4 variables).
 *
 * @param {object} datos
 * @param {number} datos.diasProgramados
 * @param {number} datos.diasTrabajados
 * @param {number} datos.tardanzas
 * @param {number} datos.horasTrabajadas
 * @param {number} datos.horasExtra
 * @param {number} datos.horasPermiso
 * @param {number} datos.horasEsperadas
 * @param {number} [datos.documentosExigidos] - cantidad de tipos exigidos asignados
 * @param {number} [datos.documentosCompletos] - cuántos de esos tipos tienen carga vigente
 * @returns {object} score (0-100) + porcentaje (0-100) por variable
 */
export function calcularScoreEmpleado({
  diasProgramados, diasTrabajados, tardanzas,
  horasTrabajadas, horasExtra, horasPermiso, horasEsperadas,
  documentosExigidos = 0, documentosCompletos = 0,
}) {
  const pAsistencia = diasProgramados > 0 ? Math.min(1, diasTrabajados / diasProgramados) : 0;
  const pPuntualidad = diasTrabajados > 0 ? Math.max(0, 1 - (tardanzas / diasTrabajados)) : 0;
  const pDisponibilidad = horasEsperadas > 0 ? Math.max(0, 1 - (horasPermiso / horasEsperadas)) : 1;
  const pEsfuerzo = horasTrabajadas > 0 ? Math.min(1, horasExtra / horasTrabajadas) : 0;
  const pDocumentacion = documentosExigidos === 0 ? 1 : (documentosCompletos >= documentosExigidos ? 1 : 0);

  const score = Math.round(
    pAsistencia * PESOS_SCORE.asistencia +
    pPuntualidad * PESOS_SCORE.puntualidad +
    pDisponibilidad * PESOS_SCORE.disponibilidad +
    pEsfuerzo * PESOS_SCORE.esfuerzo +
    pDocumentacion * PESOS_SCORE.documentacion
  );

  return {
    score: Math.min(100, Math.max(0, score)),
    pAsistencia: Math.round(pAsistencia * 100),
    pPuntualidad: Math.round(pPuntualidad * 100),
    pDisponibilidad: Math.round(pDisponibilidad * 100),
    pEsfuerzo: Math.round(pEsfuerzo * 100),
    pDocumentacion: Math.round(pDocumentacion * 100),
    documentosExigidos,
    documentosCompletos,
  };
}

// ─── Jornada al fichar egreso (auditoría F1-01, F1-11) ───────────────────────
const DIAS_SEMANA = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
const MIN_MS = 60_000;

/** "08:00:00" o "08:00" → "08:00". PostgREST devuelve las columnas time con segundos. */
export function horaHHMM(hora) {
  const m = String(hora ?? "").match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (!m) return null;
  const h = `${m[1].padStart(2, "0")}:${m[2]}`;
  return parseHoraAMinutos(h) === null ? null : h;
}

/** Timestamp (ms) de una fecha YYYY-MM-DD + hora HH:MM, en un reloj fijo (UTC) para poder restar. */
function instante(fecha, hhmm) {
  return Date.parse(`${fecha}T${hhmm}:00Z`);
}

/**
 * Horas trabajadas y horas extra de una fichada al cerrarla.
 * Todo se calcula con instantes completos, así el turno noche (ingreso un día,
 * egreso al siguiente) no da negativo, y la grilla que vale es la del día del
 * INGRESO, no la del egreso.
 *
 * @returns {null | {
 *   horasTrabajadas: number, horasExtra: number,
 *   solicitarHoraExtra: boolean, datosJornada: object|null
 * }} null si alguna hora es inválida
 */
export function calcularJornada({ fechaIngreso, horaIngreso, fechaEgreso, horaEgreso, diagrama }) {
  const hIn = horaHHMM(horaIngreso);
  const hOut = horaHHMM(horaEgreso);
  if (!hIn || !hOut) return null;
  const tIn = instante(fechaIngreso, hIn);
  const tOut = instante(fechaEgreso, hOut);
  if (!Number.isFinite(tIn) || !Number.isFinite(tOut)) return null;

  const minutosReales = Math.max(0, (tOut - tIn) / MIN_MS);
  const res = { horasTrabajadas: minutosReales / 60, horasExtra: 0, solicitarHoraExtra: false, datosJornada: null };

  const diaKey = DIAS_SEMANA[new Date(`${fechaIngreso}T12:00:00Z`).getUTCDay()];
  const grilla = diagrama?.[diaKey];
  const gIn = horaHHMM(grilla?.in);
  const gOutH = horaHHMM(grilla?.out);
  if (!gIn || !gOutH) return res;

  const tGrillaIn = instante(fechaIngreso, gIn);
  let tGrillaOut = instante(fechaIngreso, gOutH);
  if (tGrillaOut <= tGrillaIn) tGrillaOut += 24 * 60 * MIN_MS; // grilla que cruza la medianoche

  const jornadaGrilla = (tGrillaOut - tGrillaIn) / MIN_MS;
  const minutosMasTarde = (tOut - tGrillaOut) / MIN_MS;
  const fuePuntual = tIn <= tGrillaIn + 5 * MIN_MS;

  if (fuePuntual && minutosMasTarde > 0) {
    res.horasExtra = +(minutosMasTarde / 60).toFixed(2);
  } else if (!fuePuntual && minutosReales > jornadaGrilla) {
    res.solicitarHoraExtra = true;
    res.datosJornada = {
      ingreso_grilla: gIn,
      egreso_grilla: gOutH,
      ingreso_real: hIn,
      egreso_real: hOut,
      jornada_grilla_min: jornadaGrilla,
      jornada_real_min: minutosReales,
      excedente_min: minutosReales - jornadaGrilla,
    };
  }
  return res;
}

/**
 * ¿Cuántos minutos antes del fin de su grilla se está yendo? Usa la grilla del
 * día del INGRESO y cruza la medianoche (turno noche). null si no hay grilla.
 * @returns {null | { minutos: number, finGrilla: string }}
 */
export function salidaAnticipada({ fechaIngreso, fechaAhora, horaAhora, diagrama }) {
  const ahora = horaHHMM(horaAhora);
  const diaKey = DIAS_SEMANA[new Date(`${fechaIngreso}T12:00:00Z`).getUTCDay()];
  const grilla = diagrama?.[diaKey];
  const gIn = horaHHMM(grilla?.in);
  const gOut = horaHHMM(grilla?.out);
  if (!ahora || !gIn || !gOut) return null;
  const tIn = instante(fechaIngreso, gIn);
  let tFin = instante(fechaIngreso, gOut);
  if (tFin <= tIn) tFin += 24 * 60 * MIN_MS;
  const tAhora = instante(fechaAhora, ahora);
  if (!Number.isFinite(tAhora) || !Number.isFinite(tFin)) return null;
  return { minutos: Math.round((tFin - tAhora) / MIN_MS), finGrilla: gOut };
}
