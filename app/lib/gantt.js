// app/lib/gantt.js — Gantt de OT (Proyectos → OT → 📅 Gantt; migración 135;
// diseño en notes/diseno-gantt-ot.md).
//
// Solo OT abiertas, sin TERMINADO en la planilla y con fecha objetivo (su
// semana del Plan de trabajo). Cada barra va desde que la OT arrancó
// (liberación o primer escaneo) hasta el último día de su semana objetivo;
// si todavía no arrancó, o arrancó dentro de esa semana, la barra es la semana.
import { porcentajeOt } from "./panelMantenimiento";
import { diasEntre, inicioDeSemana, numeroSemana, rangoSemana, MODO_POR_DEFECTO } from "./semanaObjetivo";

const DIA = 86400000;
const sumarDias = (fecha, n) => new Date(Date.parse(`${fecha}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10);
/** Hasta cuántas semanas para atrás se dibuja (una OT muy vieja no estira todo el Gantt). */
export const SEMANAS_ATRAS = 26;

/** Primer escaneo de cada OT ("AAAA-MM-DD"), de las filas de v_avance_piezas con primer_paso (118). */
export function primerEscaneoPorOt(piezas = []) {
  const m = new Map();
  for (const f of piezas || []) {
    if (!f.primer_paso) continue;
    const ot = String(f.ot);
    const dia = String(f.primer_paso).slice(0, 10);
    if (!m.has(ot) || dia < m.get(ot)) m.set(ot, dia);
  }
  return m;
}

/**
 * Renglones del Gantt, ordenados por fecha objetivo y número de OT.
 * @param {object[]} filas de filasTablero() (OT abiertas)
 * @param {{ porEscaneo?: Map, primerEscaneo?: Map<string,string>, hoy: string, modo?: string }} opciones
 * @returns {{ proyecto: object, inicio: string, fin: string, semanaDesde: string, porcentaje: number|null, estado: "atrasada"|"esta_semana"|"a_tiempo" }[]}
 */
export function filasGantt(filas = [], { porEscaneo = new Map(), primerEscaneo = new Map(), hoy, modo = MODO_POR_DEFECTO }) {
  const out = [];
  for (const f of filas || []) {
    const p = f.proyecto;
    if (!p?.fecha_objetivo || p.terminado_planilla || p.estado === "cerrado") continue;
    const fin = String(p.fecha_objetivo).slice(0, 10);
    const semanaDesde = modo === "entrega" ? inicioDeSemana(fin, modo) : sumarDias(fin, -6);
    const arranco = [p.liberada_at && String(p.liberada_at).slice(0, 10), primerEscaneo.get(String(p.ot))].filter(Boolean).sort()[0];
    const inicio = arranco && arranco < semanaDesde ? arranco : semanaDesde;
    const estado = diasEntre(fin, hoy) > 0 ? "atrasada" : hoy >= semanaDesde ? "esta_semana" : "a_tiempo";
    out.push({ proyecto: p, inicio, fin, semanaDesde, porcentaje: porcentajeOt(f, porEscaneo), estado });
  }
  return out.sort((a, b) => a.fin.localeCompare(b.fin) || String(a.proyecto.ot).localeCompare(String(b.proyecto.ot), "es", { numeric: true }));
}

/** Año desde el que la planilla cuenta las semanas: el de una OT con semana, o el de hoy. */
function anioBase(renglones, hoy, modo) {
  const anio = Number(String(hoy).slice(0, 4));
  for (const r of renglones) {
    const s = r.proyecto.semana_objetivo;
    if (!s) continue;
    const a = [anio - 2, anio - 1, anio].find((x) => rangoSemana(s, x, modo).fin === r.fin);
    if (a) return a;
  }
  return anio;
}

/**
 * Las semanas que se dibujan: desde la del inicio más temprano (hasta
 * SEMANAS_ATRAS para atrás) hasta la de la fecha objetivo más tardía, siempre
 * con la de hoy adentro. numero = como la cuenta la planilla (sigue pasado
 * diciembre); null si la empresa usa la fecha de entrega.
 * @returns {{ desde: string, semanas: { inicio: string, numero: number|null, actual: boolean }[] }}
 */
export function escalaGantt(renglones = [], { hoy, modo = MODO_POR_DEFECTO }) {
  const limite = sumarDias(hoy, -7 * SEMANAS_ATRAS);
  let desde = inicioDeSemana(hoy, modo);
  let hasta = desde;
  for (const r of renglones) {
    const ini = inicioDeSemana(r.inicio < limite ? limite : r.inicio, modo);
    if (ini < desde) desde = ini;
    const fin = inicioDeSemana(r.fin, modo);
    if (fin > hasta) hasta = fin;
  }
  const base = anioBase(renglones, hoy, modo);
  const actual = inicioDeSemana(hoy, modo);
  const semanas = [];
  for (let s = desde; s <= hasta; s = sumarDias(s, 7)) {
    semanas.push({ inicio: s, numero: modo === "entrega" ? null : numeroSemana(s, base, modo), actual: s === actual });
  }
  return { desde, semanas };
}

/**
 * Lo que se puede elegir ver en el Gantt (Tadeo, 29/10), siempre desde hoy;
 * "Todo" es el plan entero. El plan sigue entero: solo cambia lo que se muestra.
 */
export const HORIZONTES_GANTT = [
  { id: "1d", dias: 1, label: "1 día" },
  { id: "2d", dias: 2, label: "2 días" },
  { id: "3d", dias: 3, label: "3 días" },
  { id: "1s", dias: 7, label: "1 semana" },
  { id: "2s", dias: 14, label: "2 semanas" },
  { id: "1m", meses: 1, label: "1 mes" },
  { id: "todo", label: "Todo" },
];

const sumarMes = (fecha) => {
  const d = new Date(`${fecha}T00:00:00Z`);
  const dia = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dia, ultimo));
  return d.toISOString().slice(0, 10);
};

/** La misma fecha n meses después (o antes, con n negativo). */
function restarOSumarMeses(fecha, n) {
  let f = fecha;
  if (n >= 0) { for (let i = 0; i < n; i++) f = sumarMes(f); return f; }
  const d = new Date(`${fecha}T00:00:00Z`);
  const dia = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dia, ultimo));
  return d.toISOString().slice(0, 10);
}

/**
 * Días que se ven en el Gantt: desde hoy hasta el horizonte elegido, o todo
 * el plan. Devuelve el primer día, el día siguiente al último, cuántos días
 * son y el tramo de cada semana que cae adentro (para rotular arriba; las
 * semanas que la escala no trae siguen la numeración de la planilla).
 * @returns {{ desde: string, hasta: string, dias: number, semanas: { inicio: string, numero: number|null, actual: boolean, desde: string, hasta: string }[] }}
 */
export function ventanaGantt(escala, horizonte = "todo", hoy, corrimiento = 0) {
  const todas = escala?.semanas || [];
  const h = HORIZONTES_GANTT.find((x) => x.id === horizonte && x.id !== "todo");
  let desde, hasta;
  if (h && hoy) {
    // ◀ ▶ (Tadeo, 29/10): `corrimiento` ventanas para atrás o para adelante
    desde = h.meses ? restarOSumarMeses(hoy, corrimiento) : sumarDias(hoy, corrimiento * h.dias);
    hasta = h.meses ? sumarMes(desde) : sumarDias(desde, h.dias);
  } else {
    if (!todas.length) return { semanas: [], desde: escala?.desde, hasta: escala?.desde, dias: 0 };
    desde = todas[0].inicio;
    hasta = sumarDias(todas[todas.length - 1].inicio, 7);
  }
  // Semanas que tocan la ventana; si la escala no llega, se siguen contando
  const lista = [...todas];
  while (lista.length && lista[0].inicio > desde) {
    const p = lista[0];
    const inicio = sumarDias(p.inicio, -7);
    lista.unshift({ inicio, numero: p.numero != null ? p.numero - 1 : null, actual: !!hoy && inicio <= hoy && hoy < sumarDias(inicio, 7) });
  }
  while (lista.length && sumarDias(lista[lista.length - 1].inicio, 7) < hasta) {
    const u = lista[lista.length - 1];
    const inicio = sumarDias(u.inicio, 7);
    lista.push({ inicio, numero: u.numero != null ? u.numero + 1 : null, actual: !!hoy && inicio <= hoy && hoy < sumarDias(inicio, 7) });
  }
  const semanas = lista.filter((s) => sumarDias(s.inicio, 7) > desde && s.inicio < hasta).map((s) => ({
    ...s,
    desde: s.inicio < desde ? desde : s.inicio,
    hasta: sumarDias(s.inicio, 7) > hasta ? hasta : sumarDias(s.inicio, 7),
  }));
  return { semanas, desde, hasta, dias: diasEntre(desde, hasta) };
}

/**
 * Ancho de un día para que lo elegido ocupe todo el ancho visible (Tadeo,
 * 28/10 y 29/10: también con 1 día), y con eso cómo se rotula arriba: por
 * días si entran los números, por semanas o por mes. `visible` = ancho de la
 * zona de las barras en píxeles (0 si todavía no se midió: se usa el ancho de
 * "por días").
 */
export function escalaAncho(visible, dias) {
  const px = visible > 0 && dias > 0 ? Math.max(2, visible / dias) : 44;
  return { px, vista: px >= 24 ? "dias" : px >= 8 ? "semanas" : "mes" };
}

/** Un proceso (desde/hasta, días inclusive) cae dentro de la ventana. */
export const enVentana = (q, v) => !!q && q.desde < v.hasta && q.hasta >= v.desde;

/** Días desde el comienzo del Gantt (para ubicar una fecha en el dibujo). */
export const diasDesde = (desde, fecha) => diasEntre(desde, fecha);

/**
 * Nombre del proyecto de una OT para los Gantt (Tadeo, 27/10: "Cama",
 * "Cocina", "Vanitory"…): la DESCRIPCIÓN, columna F del Plan de trabajo.
 * Nunca el código de la columna PROYECTO (C), que no le sirve. Vacío si
 * repite el cliente.
 */
export function nombreProyecto(p) {
  const n = String(p?.descripcion || "").trim();
  return n && n.toLowerCase() !== String(p?.cliente || "").trim().toLowerCase() ? n : "";
}
