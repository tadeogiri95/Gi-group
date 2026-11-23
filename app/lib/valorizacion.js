// app/lib/valorizacion.js — Precio de cada OT y valorización de la
// planificación (Tadeo, 27/10; migración 142). El precio sale de la columna
// PRECIO (AE) del Plan de trabajo, en pesos. Lo ven Dueño, Administración y
// Supervisor (desde 05/11); los operarios no.
// En la planificación, el precio de una OT se reparte entre semanas y meses
// según las horas que el plan pone en cada uno (Tadeo eligió "según las
// horas de cada semana").
import { apiFetch } from "./supabase";
import { inicioDeSemana } from "./semanaObjetivo";

/** Dueño, Administración y Supervisor ven los precios; los operarios no. */
export function puedeVerPrecios(usuario) {
  return usuario?.rol === "gerencial" || usuario?.rol === "administrativo";
}

/** Texto del valor de una OT: "$ 1.000" o "≈ $ 1.000 estimado". */
export const textoValorOt = (valor, estimado, fmt) => (estimado ? `≈ ${fmt(valor)} estimado` : fmt(valor));

/**
 * Valor de las OT (navegador, de /api/valor-ot): { precios: Map OT → valor,
 * estimadas: Set de OT cuyo valor es estimado por materiales }. Sin permiso
 * o si falla, vacío.
 */
export async function leerPrecios() {
  try {
    const r = await apiFetch("/api/valor-ot");
    if (!r.ok) return { precios: new Map(), estimadas: new Set() };
    const d = await r.json();
    const precios = new Map();
    const estimadas = new Set();
    for (const [ot, valor, estimado] of d.valores || []) {
      precios.set(String(ot), Number(valor));
      if (estimado) estimadas.add(String(ot));
    }
    return { precios, estimadas };
  } catch {
    return { precios: new Map(), estimadas: new Set() };
  }
}

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
/** "2026-10" → "Octubre 2026". */
export const nombreMes = (mes) => `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;

/**
 * Valorización del plan del período.
 * @param {{ ots: { id, ot, completo: number }[], segmentos: { id, fecha, gente }[], pendientes: { id, gente }[], precios: Map<string, number>, estimadas?: Set<string>, eficiencia?: number, modo?: string }} p
 *   ots: las OT tildadas, con `completo` = horas efectivas de toda la OT (lo hecho y lo que falta)
 *   segmentos y pendientes: los de planAutomatico (horas de reloj)
 *   precios: el valor de cada OT (PRECIO del Plan o estimado por materiales, 23/11)
 *   estimadas: las OT cuyo valor es estimado (cuentan en conPrecio y en el total)
 * @returns {{ total, conPrecio, sinPrecio, estimadas, totalEstimado, porSemana: { desde, valor }[], porMes: { mes, valor }[], pasa, hecho, sinHoras }}
 *   total: suma de los precios de las OT tildadas.
 *   porSemana / porMes: lo que el plan fabrica en cada semana o mes.
 *   pasa: lo que queda para el período siguiente; hecho: lo ya fabricado antes;
 *   sinHoras: OT con precio pero sin datos de la planilla para repartirlo.
 */
export function valorizarPlan({ ots, segmentos = [], pendientes = [], precios, estimadas = new Set(), eficiencia = 100, modo }) {
  const ef = (eficiencia || 100) / 100;
  const semanas = new Map(), meses = new Map();
  let total = 0, conPrecio = 0, sinPrecio = 0, pasa = 0, hecho = 0, sinHoras = 0, enPlan = 0, nEstimadas = 0, totalEstimado = 0;
  for (const o of ots || []) {
    const precio = precios?.get(String(o.ot));
    if (precio == null) { sinPrecio++; continue; }
    conPrecio++;
    total += precio;
    if (estimadas?.has(String(o.ot))) { nEstimadas++; totalEstimado += precio; }
    if (!(o.completo > 0)) { sinHoras += precio; continue; }
    // Horas efectivas: los segmentos y pendientes vienen en horas de reloj
    const porHora = precio / o.completo;
    let repartido = 0;
    for (const s of segmentos) {
      if (s.id !== o.id) continue;
      const v = s.gente * ef * porHora;
      const semana = inicioDeSemana(s.fecha, modo);
      semanas.set(semana, (semanas.get(semana) || 0) + v);
      meses.set(s.fecha.slice(0, 7), (meses.get(s.fecha.slice(0, 7)) || 0) + v);
      repartido += v;
    }
    const resto = pendientes.filter((x) => x.id === o.id).reduce((t, x) => t + x.gente * ef * porHora, 0);
    pasa += resto;
    enPlan += repartido;
    hecho += Math.max(0, precio - repartido - resto);
  }
  const orden = (m) => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return {
    total, conPrecio, sinPrecio, enPlan, pasa, hecho, sinHoras, estimadas: nEstimadas, totalEstimado,
    porSemana: orden(semanas).map(([desde, valor]) => ({ desde, valor })),
    porMes: orden(meses).map(([mes, valor]) => ({ mes, valor })),
  };
}
