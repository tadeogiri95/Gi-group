// app/lib/minutasCalendario.js — Calendario al final de la minuta (Tadeo,
// 02/11): las fechas objetivo de la producción y de las instalaciones en
// curso, día por día, para ver de un vistazo qué vence cuándo.
//
// Lee los renglones de la minuta del día. `extras` deja sumar otras fechas
// (por ejemplo, las del Gantt de instalación cuando esté) con la misma forma.

import { textoRenglonOt } from "./nombreOt";

const DIA = 86400000;
const SECCIONES_CAL = { prod_en_curso: "produccion", inst_en_curso: "instalacion" };
export const MAX_SEMANAS = 6;
export const DIAS_CORTOS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const mas = (f, n) => new Date(Date.parse(`${f}T12:00:00Z`) + n * DIA).toISOString().slice(0, 10);
const lunes = (f) => mas(f, -((new Date(`${f}T12:00:00Z`).getUTCDay() + 6) % 7));
const ddmm = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

/**
 * @param {object[]} items  renglones de la minuta (seccion, ot, proyecto, semaforo, fecha_objetivo, responsable)
 * @param {string} fecha    el día de la minuta (AAAA-MM-DD)
 * @param {{ tipo: "produccion"|"instalacion", ot?, proyecto?, fecha, semaforo?, responsable?, origen? }[]} extras
 * @returns {{ semanas: { fecha, etiqueta, hoy, finde, eventos }[][], vencidas: object[], masAdelante: object[], sinFecha: object[], total: number }}
 */
export function calendarioMinuta(items = [], fecha, extras = []) {
  const eventos = [
    ...items.filter((it) => SECCIONES_CAL[it.seccion] && (it.ot || it.proyecto)).map((it) => ({
      tipo: SECCIONES_CAL[it.seccion], ot: it.ot || null, proyecto: it.proyecto || null, fecha: it.fecha_objetivo || null,
      semaforo: it.semaforo || null, responsable: it.responsable || null, origen: "minuta",
    })),
    ...extras.map((x) => ({ origen: "plan", semaforo: null, responsable: null, ...x })),
  ];
  // Una OT con la misma fecha y tipo va una sola vez
  const vistos = new Set();
  const unicos = eventos.filter((e) => {
    const k = `${e.tipo}|${e.ot || e.proyecto}|${e.fecha}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  const conFecha = unicos.filter((e) => FECHA.test(String(e.fecha || "")));
  const sinFecha = unicos.filter((e) => !FECHA.test(String(e.fecha || "")));
  const vencidas = conFecha.filter((e) => e.fecha < fecha).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const futuras = conFecha.filter((e) => e.fecha >= fecha);
  const inicio = lunes(fecha);
  const ultima = futuras.reduce((m, e) => (e.fecha > m ? e.fecha : m), fecha);
  const nSemanas = Math.min(MAX_SEMANAS, Math.max(2, Math.floor((Date.parse(`${lunes(ultima)}T12:00:00Z`) - Date.parse(`${inicio}T12:00:00Z`)) / (7 * DIA)) + 1));
  const fin = mas(inicio, nSemanas * 7 - 1);
  const porDia = new Map();
  for (const e of futuras) {
    if (e.fecha > fin) continue;
    if (!porDia.has(e.fecha)) porDia.set(e.fecha, []);
    porDia.get(e.fecha).push(e);
  }
  const orden = (a, b) => (a.tipo === b.tipo ? String(a.ot || a.proyecto).localeCompare(String(b.ot || b.proyecto), "es", { numeric: true }) : a.tipo === "produccion" ? -1 : 1);
  const semanas = Array.from({ length: nSemanas }, (_, s) => Array.from({ length: 7 }, (_, d) => {
    const f = mas(inicio, s * 7 + d);
    return { fecha: f, etiqueta: ddmm(f), hoy: f === fecha, pasado: f < fecha, finde: d >= 5, eventos: (porDia.get(f) || []).sort(orden) };
  }));
  return {
    semanas, vencidas, sinFecha,
    masAdelante: futuras.filter((e) => e.fecha > fin).sort((a, b) => a.fecha.localeCompare(b.fecha)),
    total: unicos.length,
  };
}

// La OT completa con lo que guardó el renglón (02/11)
export const nombreEvento = (e, porOt = null) => (e.ot ? textoRenglonOt(e, porOt) : e.proyecto || "");
export const iconoEvento = (e) => (e.tipo === "instalacion" ? "🔧" : "🏭");
export { ddmm as fechaCorta };
