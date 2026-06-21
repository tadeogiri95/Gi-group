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
 * Calcula el estado de tardanza de un fichaje de ingreso.
 *
 * Reglas (replicadas de /api/fichar/route.js):
 *   - Tolerancia: ≤ 5 minutos → puntual
 *   - 5 a 30 min Y menos de 3 tardes en el mes → tarde (aceptado)
 *   - > 30 min → bloqueado (requiere permiso)
 *   - ≥ 3 tardes en el mes (contando esta) → bloqueado
 *
 * @param {string} horaEsperada - Hora "HH:MM" del diagrama (ej "08:00")
 * @param {string} horaReal     - Hora "HH:MM" del fichaje real
 * @param {number} llegadasTardePreviasDelMes - cantidad ya acumulada antes de hoy
 * @returns {{ estado: "puntual"|"tarde"|"bloqueado", minutos: number, llegadasTarde: number, motivo?: string }}
 */
export function calcularTardanza(horaEsperada, horaReal, llegadasTardePreviasDelMes = 0) {
  const esperado = parseHoraAMinutos(horaEsperada);
  const real = parseHoraAMinutos(horaReal);

  if (esperado == null || real == null) {
    return { estado: "puntual", minutos: 0, llegadasTarde: llegadasTardePreviasDelMes };
  }

  const diff = real - esperado;

  if (diff <= 5) {
    return { estado: "puntual", minutos: Math.max(0, diff), llegadasTarde: llegadasTardePreviasDelMes };
  }

  const llegadas = llegadasTardePreviasDelMes + 1;

  if (diff > 30) {
    return {
      estado: "bloqueado",
      minutos: diff,
      llegadasTarde: llegadas,
      motivo: `Tardanza de ${diff} min (supera tolerancia de 30 min)`,
    };
  }

  if (llegadas >= 3) {
    return {
      estado: "bloqueado",
      minutos: diff,
      llegadasTarde: llegadas,
      motivo: "3ra llegada tarde del mes",
    };
  }

  return { estado: "tarde", minutos: diff, llegadasTarde: llegadas };
}

/**
 * Calcula horas trabajadas (decimales) entre ingreso y egreso del mismo día.
 *
 * Replica la lógica de /api/fichar: si egreso < ingreso devuelve 0 en vez
 * de negativo. No contempla turnos partidos ni cruce de medianoche
 * (la app no lo soporta).
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
