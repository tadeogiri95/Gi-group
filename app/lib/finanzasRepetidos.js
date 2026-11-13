// app/lib/finanzasRepetidos.js — Finanzas (13/11, parte 1 del plan de
// Tesorería): una sola regla contra los movimientos repetidos en cajas y
// bancos, para todas las cargas. Sin migración.
//
// Pedido de Tadeo: "al coincidir fecha y monto de operación debe ser bastante
// sospechoso". Para cada caja o banco que toca un movimiento nuevo se busca
// otro movimiento vivo de esa misma caja, en el mismo sentido (entra o sale)
// y por el mismo importe (al centavo), venga de donde venga (a mano, extracto,
// libro, cheque, plazo fijo, Mi caja…):
//   🔴 rojo:     la misma fecha.
//   🟡 amarillo: hasta 3 días de diferencia.
// No se guarda sin un OK explícito ("Es otro distinto, cargarlo igual"); lo
// que se carga igual se puede corregir o anular después.
import { DIAS_SOSPECHA, NOMBRE_ORIGEN, movimientoEnCuenta } from "./finanzasBanco";
import { ORIGENES } from "./finanzasOperaciones";

export const DIAS_REPETIDO = DIAS_SOSPECHA;
const MAX_PARECIDAS = 5;

const dias = (a, b) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000;
const fechaDma = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : "");

/** Las cajas y bancos (cuentas de fin_tesoreria) que mueve una operación. */
export function cajasDeOperacion(op, cajas) {
  return [op?.cuenta_debe, op?.cuenta_haber].filter((c, i, l) => c && cajas.has(c) && l.indexOf(c) === i);
}

/**
 * Lo que se mostraría de una operación parecida (sin datos de más).
 * @param {object} o operación de la base
 * @param {string} cuenta la caja
 */
export function resumenParecida(o, cuenta) {
  return {
    id: o.id, fecha: o.fecha, tipo: o.tipo || "", descripcion: o.descripcion || "", entidad: o.entidad || "",
    origen: o.origen || "manual", importe: movimientoEnCuenta(o, cuenta), cuenta,
  };
}

/**
 * Para cada operación nueva, las que ya están en la misma caja con el mismo
 * importe y fecha cerca.
 * @param {object[]} nuevas las que se van a guardar
 * @param {object[]} existentes las de la base (de esas cajas y fechas)
 * @param {Iterable<string>} cajas cuentas de fin_tesoreria
 * @param {{ excluir?: Iterable<number>, diasMax?: number }} [opts] excluir = ids que no cuentan (la que se corrige)
 * @returns {{ i: number, nivel: "rojo"|"amarillo", cuenta: string, importe: number, fecha: string, parecidas: object[] }[]}
 */
export function buscarRepetidos(nuevas = [], existentes = [], cajas = [], { excluir = [], diasMax = DIAS_REPETIDO } = {}) {
  const enCaja = new Set(cajas);
  const fuera = new Set([...excluir].map(Number));
  const vivas = existentes.filter((o) => !o.anulada_at && !fuera.has(Number(o.id)));
  const salida = [];
  nuevas.forEach((n, i) => {
    if (!n || !/^\d{4}-\d{2}-\d{2}$/.test(String(n.fecha || ""))) return;
    for (const cuenta of cajasDeOperacion(n, enCaja)) {
      const importe = movimientoEnCuenta(n, cuenta);
      if (!importe) continue;
      const parecidas = vivas
        .filter((o) => Math.abs(movimientoEnCuenta(o, cuenta) - importe) < 0.01 && dias(o.fecha, n.fecha) <= diasMax)
        .sort((a, b) => dias(a.fecha, n.fecha) - dias(b.fecha, n.fecha) || a.id - b.id);
      if (!parecidas.length) continue;
      const nivel = parecidas.some((o) => o.fecha === n.fecha) ? "rojo" : "amarillo";
      salida.push({ i, nivel, cuenta, importe, fecha: n.fecha, parecidas: parecidas.slice(0, MAX_PARECIDAS).map((o) => resumenParecida(o, cuenta)) });
      break;
    }
  });
  return salida;
}

/** El rango de fechas a leer de la base para revisar estas operaciones. */
export function rangoRevision(nuevas = [], diasMax = DIAS_REPETIDO) {
  const fechas = nuevas.map((n) => n?.fecha).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(String(f || ""))).sort();
  if (!fechas.length) return null;
  const mover = (f, d) => new Date(Date.parse(`${f}T12:00:00Z`) + d * 86400000).toISOString().slice(0, 10);
  return { desde: mover(fechas[0], -diasMax), hasta: mover(fechas[fechas.length - 1], diasMax) };
}

export const origenTexto = (o) => (o === "manual" || !o ? "cargado a mano" : ORIGENES[o] || NOMBRE_ORIGEN[o] || "cargado en otra pantalla");

/** Una línea por operación parecida: "12/11/2026 · PAGO A PROVEEDORES · Bosques (de un extracto)". */
export function lineaParecida(p) {
  return [fechaDma(p.fecha), p.tipo, p.entidad || p.descripcion].filter(Boolean).join(" · ").slice(0, 160) + ` (${origenTexto(p.origen)})`;
}

/** El aviso para la pantalla y el error del servidor. */
export function textoRepetido(r, nombreCaja = "") {
  const donde = nombreCaja ? ` en ${nombreCaja}` : "";
  const cuando = r.nivel === "rojo" ? "el mismo día" : `con ${DIAS_REPETIDO} días o menos de diferencia`;
  return `${r.nivel === "rojo" ? "🔴" : "🟡"} Ya hay${donde} un movimiento por el mismo importe ${cuando}: ${lineaParecida(r.parecidas[0])}.`;
}

/** El cuerpo de la respuesta 409 cuando hay repetidos sin confirmar. */
export function respuestaRepetidos(repetidos, nombres = {}) {
  const primero = repetidos[0];
  return {
    error: `${textoRepetido(primero, nombres[primero.cuenta])} Si es otro distinto, confirmá "cargarlo igual".`,
    repetidos,
  };
}
