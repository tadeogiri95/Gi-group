// app/lib/semanaObjetivo.js — Fecha objetivo de cada OT (Gantt de OT y
// ⏰ OT atrasadas; migración 135; diseño en notes/diseno-gantt-ot.md).
//
// En el Plan de trabajo la OT tiene una semana objetivo (columna SEMANA):
// el número de semana del año, que pasado diciembre sigue contando (56 =
// fines de enero del año siguiente). La fecha objetivo es el último día de
// esa semana. Cada empresa elige cómo cuenta las semanas, o si usa la fecha
// de entrega (config_sistema clave ot_fecha_objetivo).

export const CLAVE_FECHA_OBJETIVO = "ot_fecha_objetivo";

export const MODOS_FECHA_OBJETIVO = [
  { id: "semana_domingo", nombre: "Semana del año, de domingo a sábado (como NUM.DE.SEMANA de Google)" },
  { id: "semana_lunes", nombre: "Semana del año, de lunes a domingo (ISO)" },
  { id: "entrega", nombre: "Fecha de entrega (columna ENTREGA)" },
];
export const MODO_POR_DEFECTO = "semana_domingo";

export function normalizarModo(modo) {
  return MODOS_FECHA_OBJETIVO.some((m) => m.id === modo) ? modo : MODO_POR_DEFECTO;
}

const DIA = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const ms = (fecha) => Date.parse(`${String(fecha).slice(0, 10)}T00:00:00Z`);

/** Primer día de la semana 1 del año: el domingo de la semana del 1/1, o el lunes de la semana del 4/1 (ISO). */
function inicioSemana1(anio, modo) {
  if (modo === "semana_lunes") {
    const cuatro = Date.UTC(anio, 0, 4);
    return cuatro - ((new Date(cuatro).getUTCDay() + 6) % 7) * DIA;
  }
  const uno = Date.UTC(anio, 0, 1);
  return uno - new Date(uno).getUTCDay() * DIA;
}

/** Primer y último día ("AAAA-MM-DD") de la semana N contada desde el año dado. */
export function rangoSemana(semana, anio, modo = MODO_POR_DEFECTO) {
  const inicio = inicioSemana1(anio, modo) + (Number(semana) - 1) * 7 * DIA;
  return { inicio: iso(inicio), fin: iso(inicio + 6 * DIA) };
}

/** Primer día de la semana que contiene la fecha (domingo, o lunes si la empresa cuenta de lunes; con fecha de entrega, lunes). */
export function inicioDeSemana(fecha, modo = MODO_POR_DEFECTO) {
  const t = ms(fecha);
  const dia = new Date(t).getUTCDay();
  return iso(t - (modo === "semana_domingo" ? dia : (dia + 6) % 7) * DIA);
}

/** Número de semana de una fecha, contado desde el año dado (sigue contando pasado diciembre). */
export function numeroSemana(fecha, anio, modo = MODO_POR_DEFECTO) {
  return Math.floor((ms(fecha) - inicioSemana1(anio, modo)) / (7 * DIA)) + 1;
}

/** "44" → 44; vacío, 0, texto o decimales → null. */
export function semanaPlanilla(texto) {
  const t = String(texto ?? "").trim();
  const n = Number(t);
  return t !== "" && Number.isInteger(n) && n >= 1 && n <= 160 ? n : null;
}

/**
 * Fecha objetivo de una OT ("AAAA-MM-DD" o null).
 * Con semana: el último día de esa semana. El año no está en la planilla:
 * de este año y el anterior, vale el que deja la fecha más cerca de hoy (en
 * enero, la semana 49 es la de diciembre pasado). Si la OT ya tenía una
 * fecha que corresponde a la misma semana, se queda con esa, así no cambia
 * de año sola con el paso del tiempo.
 * @param {{ semana_objetivo?: number|null, fecha_entrega?: string|null }} ot
 * @param {{ modo?: string, hoy: string, previa?: string|null }} opciones
 */
export function fechaObjetivo(ot, { modo = MODO_POR_DEFECTO, hoy, previa = null }) {
  if (modo === "entrega") return ot?.fecha_entrega || null;
  const semana = ot?.semana_objetivo;
  if (!semana) return null;
  const anio = Number(String(hoy).slice(0, 4));
  const candidatas = [anio - 1, anio].map((a) => rangoSemana(semana, a, modo).fin);
  if (previa && [anio - 2, anio - 1, anio].some((a) => rangoSemana(semana, a, modo).fin === String(previa).slice(0, 10))) {
    return String(previa).slice(0, 10);
  }
  const hoyMs = ms(hoy);
  return candidatas.reduce((mejor, f) => (Math.abs(ms(f) - hoyMs) < Math.abs(ms(mejor) - hoyMs) ? f : mejor));
}

/** Días entre dos fechas "AAAA-MM-DD" (b − a). */
export const diasEntre = (a, b) => Math.round((ms(b) - ms(a)) / DIA);

/** Cómo se ve la meta de una OT: "S44 (31/10)" o "entrega 31/10/2026". */
export function textoObjetivo(p, modo = MODO_POR_DEFECTO) {
  if (!p?.fecha_objetivo) return "";
  const [a, m, d] = String(p.fecha_objetivo).slice(0, 10).split("-");
  if (modo !== "entrega" && p.semana_objetivo) return `S${p.semana_objetivo} (${Number(d)}/${Number(m)})`;
  return `entrega ${Number(d)}/${Number(m)}/${a}`;
}
