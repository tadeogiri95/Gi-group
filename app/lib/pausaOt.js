// app/lib/pausaOt.js — Poner en pausa una OT (Tadeo, 02/11; migración 151).
//
// Cuando el proyecto queda en suspenso por una contingencia y se para la
// producción, gerencia, supervisores o administración ponen la OT en pausa
// con un motivo y después la reanudan. Mientras está en pausa no suma tiempo
// que no es real:
//   · el lead time no cuenta las horas en pausa (app/lib/leadTimeHoras.js),
//   · la OT sale del plan vivo y del Gantt (planVivo con `pausadas`), así las
//     otras toman su lugar; al reanudar vuelve al plan desde ese día,
//   · no manda avisos de fin de proceso ni aparece en ⏰ OT atrasadas (salen
//     del plan vivo),
//   · el informe de producción no cuenta lo planificado los días en pausa.
// La fecha de entrega no se mueve sola: el detalle muestra cuántos días estuvo
// en pausa. El escaneo no se bloquea: el operario ve un aviso amarillo.
// No se usa proyectos.estado porque la sincronización con la planilla lo pisa.

export const MOTIVOS_PAUSA = [
  { id: "cliente", label: "El cliente pidió frenar o no definió" },
  { id: "falta_pago", label: "Falta de pago" },
  { id: "obra_no_lista", label: "La obra no está lista" },
  { id: "falta_material", label: "Falta de material" },
  { id: "otros", label: "Otro" },
];
const IDS = new Set(MOTIVOS_PAUSA.map((m) => m.id));
export const AVISO_MIGRACION_151 = "Para poner la OT en pausa falta correr la migración 151 en Supabase.";

const DIA = 86400000;
const ARG = 3 * 3600000; // Argentina: UTC-3
const ms = (t) => (t ? Date.parse(t) : NaN);
const esFecha = (t) => typeof t === "string" && Number.isFinite(Date.parse(t));
const diaArg = (t) => new Date(ms(t) - ARG).toISOString().slice(0, 10);

/** "Falta de pago", u "Otro: …" con lo que se escribió. */
export function textoMotivoPausa(p) {
  const m = MOTIVOS_PAUSA.find((x) => x.id === p?.motivo);
  if (!m) return "—";
  if (m.id === "otros") return p.detalle ? p.detalle : m.label;
  return p.detalle ? `${m.label} · ${p.detalle}` : m.label;
}

/** Revisa una pausa nueva antes de guardarla (en la pantalla y en /api/data). null si está bien. */
export function validarPausa(p) {
  if (!p || typeof p !== "object") return "Faltan los datos";
  if (typeof p.ot !== "string" || !p.ot.trim() || p.ot.length > 40) return "Falta la OT";
  if (!IDS.has(p.motivo)) return "Elegí el motivo de la pausa";
  const detalle = typeof p.detalle === "string" ? p.detalle.trim() : "";
  if (p.motivo === "otros" && !detalle) return "Escribí cuál es el motivo";
  if (detalle.length > 300) return "La nota es muy larga (hasta 300 letras)";
  if (p.hasta !== undefined && p.hasta !== null) return "Una pausa nueva no puede venir terminada";
  return null;
}

/** Solo se reanuda: hasta (y quién). null si está bien. */
export function validarReanudar(body) {
  if (!body || typeof body !== "object") return "Falta cuándo se reanudó";
  const extra = Object.keys(body).find((k) => k !== "hasta" && k !== "reanudada_nombre");
  if (extra) return "A una pausa solo se le puede poner cuándo se reanudó";
  if (!esFecha(body.hasta)) return "Falta cuándo se reanudó";
  if (body.reanudada_nombre != null && (typeof body.reanudada_nombre !== "string" || body.reanudada_nombre.length > 120)) return "Nombre inválido";
  return null;
}

/** Pausas abiertas (sin reanudar): Map OT → pausa. */
export function pausasAbiertas(pausas = []) {
  const m = new Map();
  for (const p of pausas || []) if (p?.ot != null && !p.hasta) m.set(String(p.ot), p);
  return m;
}

/** OT que hoy están en pausa. */
export const otsEnPausa = (pausas = []) => new Set(pausasAbiertas(pausas).keys());

/** Pausas de una OT, la más nueva primero. */
export function pausasDe(pausas = [], ot) {
  return (pausas || []).filter((p) => String(p.ot) === String(ot))
    .sort((a, b) => String(b.desde || "").localeCompare(String(a.desde || "")));
}

/**
 * Tramos en pausa de una OT, en milisegundos; una pausa abierta llega hasta ahora.
 * @returns {{ a: number, b: number }[]}
 */
export function intervalosPausa(pausas = [], ot, ahora = new Date()) {
  const hoy = ahora.getTime();
  return (pausas || [])
    .filter((p) => String(p.ot) === String(ot) && Number.isFinite(ms(p.desde)))
    .map((p) => ({ a: ms(p.desde), b: Number.isFinite(ms(p.hasta)) ? ms(p.hasta) : hoy }))
    .filter((t) => t.b > t.a)
    .sort((x, y) => x.a - y.a);
}

/** Días corridos que la OT estuvo (o está) en pausa, con un decimal. */
export function diasEnPausa(pausas = [], ot, ahora = new Date()) {
  const total = intervalosPausa(pausas, ot, ahora).reduce((s, t) => s + (t.b - t.a), 0);
  return Math.round((total / DIA) * 10) / 10;
}

/** ¿La OT estuvo en pausa ese día (AAAA-MM-DD, Argentina)? Cuenta el día en que se pausó; el día en que se reanudó ya no (vuelve al plan). */
export function enPausaElDia(pausas = [], ot, fecha) {
  return (pausas || []).some((p) => String(p.ot) === String(ot) && esFecha(p.desde)
    && diaArg(p.desde) <= fecha && (!esFecha(p.hasta) || diaArg(p.hasta) > fecha));
}

/** "02/11" */
const fechaCorta = (t) => { const d = diaArg(t); return `${d.slice(8, 10)}/${d.slice(5, 7)}`; };

/** "⏸ En pausa desde 02/11 · Falta de pago" */
export function textoPausa(p) {
  if (!p) return "";
  return `⏸ En pausa desde ${fechaCorta(p.desde)} · ${textoMotivoPausa(p)}`;
}

/** "3 días", "1 día", "menos de un día" */
export function textoDias(n) {
  if (!(n > 0)) return "0 días";
  if (n < 1) return "menos de un día";
  const r = Math.round(n);
  return `${r} ${r === 1 ? "día" : "días"}`;
}
