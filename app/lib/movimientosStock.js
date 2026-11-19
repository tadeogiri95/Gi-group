// app/lib/movimientosStock.js — Movimientos de stock cargados en la app
// (Stock, parte 14; ítem 40; migración 107).
//
// El operario retira material (consumo) escaneando el QR del artículo, con la
// OT y la cantidad; también puede devolver lo que sobró. La oficina carga los
// ingresos de compras y los ajustes de inventario. La planilla MRP sigue
// mandando: su script trae estos movimientos (parte 15, lib/planillaMrp.js).

import { otCompleta, textoOt } from "./nombreOt";

export const TIPOS_MOVIMIENTO = {
  consumo:    { id: "consumo",    nombre: "Retiro",     icono: "📦", gestion: false },
  devolucion: { id: "devolucion", nombre: "Devolución", icono: "↩️", gestion: false },
  ingreso:    { id: "ingreso",    nombre: "Ingreso",    icono: "🚛", gestion: true },
  ajuste:     { id: "ajuste",     nombre: "Ajuste",     icono: "⚖️", gestion: true },
};

/** config_sistema: { hash, creada_at, ultima_lectura } de la clave con que la planilla MRP trae los movimientos (parte 15). */
export const CLAVE_PLANILLA_MRP = "stock_planilla_clave";

/** ¿Este rol puede cargar este tipo de movimiento? */
export function puedeCargar(tipo, rol) {
  const t = TIPOS_MOVIMIENTO[tipo];
  if (!t) return false;
  return !t.gestion || rol === "gerencial" || rol === "administrativo";
}

/** Horas en que quien cargó un movimiento lo puede anular él mismo. */
export const HORAS_ANULAR_PROPIO = 12;

/**
 * ¿Puede anular este movimiento? Gestión, cualquiera; el resto, solo los
 * suyos y recién cargados (se equivocó de artículo o de cantidad).
 */
export function puedeAnular(mov, { rol, empleadoId }, ahora = Date.now()) {
  if (!mov || mov.anulado) return false;
  if (rol === "gerencial" || rol === "administrativo") return true;
  if (!empleadoId || mov.empleado_id !== empleadoId) return false;
  const creado = Date.parse(mov.created_at || "");
  return Number.isFinite(creado) && ahora - creado < HORAS_ANULAR_PROPIO * 3600 * 1000;
}

/** "2,5", "3", "1.234,5" → número positivo; vacío, cero o texto → null. Con signo, para ajustes. */
export function leerCantidadMovimiento(texto, { conSigno = false } = {}) {
  let t = String(texto ?? "").replace(/\s/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) >= 1e10) return null;
  if (!conSigno && n < 0) return null;
  return Math.round(n * 1000) / 1000;
}

/** "📦 Retiro · 3 MT · OT M-7495" para las listas. */
export function textoMovimiento(m, porOt = null) {
  const t = TIPOS_MOVIMIENTO[m?.tipo];
  const cant = Number(m?.cantidad);
  const cantidad = Number.isFinite(cant) ? cant.toLocaleString("es-AR", { maximumFractionDigits: 3 }) : "?";
  return [
    `${t?.icono || ""} ${t?.nombre || m?.tipo || ""}`.trim(),
    `${m?.tipo === "ajuste" && cant > 0 ? "+" : ""}${cantidad}${m?.unidad ? ` ${m.unidad}` : ""}`,
    m?.ot ? textoOt(otCompleta(m.ot, porOt)) : null,
  ].filter(Boolean).join(" · ");
}

// ── Fecha del movimiento (19/11, migración 197) ─────────────────────────────
// Cada ingreso o consumo tiene la fecha del día en que pasó, que la oficina
// puede elegir al cargarlo (antes solo quedaba cuándo se cargó, created_at).

/** Hasta cuántos días para atrás se puede poner la fecha de un movimiento. */
export const DIAS_ATRAS_MOVIMIENTO = 366;

/** Fecha de hoy en Argentina (YYYY-MM-DD). */
export function hoyMovimiento(ahora = new Date()) {
  return new Date(ahora.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * La fecha que se guarda: la elegida o, si no viene, hoy. No puede ser
 * futura ni de hace más de un año.
 * @returns {{ fecha: string } | { error: string }}
 */
export function fechaDelMovimiento(fecha, ahora = new Date()) {
  const hoy = hoyMovimiento(ahora);
  if (!fecha) return { fecha: hoy };
  const t = Date.parse(`${fecha}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== fecha) return { error: "La fecha no es válida" };
  if (fecha > hoy) return { error: "La fecha no puede ser después de hoy" };
  const minimo = hoyMovimiento(new Date(ahora.getTime() - DIAS_ATRAS_MOVIMIENTO * 86400000));
  if (fecha < minimo) return { error: "La fecha es de hace más de un año" };
  return { fecha };
}

/** El día del movimiento: su fecha o, sin la migración 197, el día en que se cargó. */
export function diaDelMovimiento(m) {
  if (m?.fecha) return String(m.fecha).slice(0, 10);
  return m?.created_at ? hoyMovimiento(new Date(m.created_at)) : null;
}

/** "19/11/2026" desde "2026-11-19". */
export function fechaCorta(dia) {
  const [a, m, d] = String(dia || "").split("-");
  return a && m && d ? `${d}/${m}/${a}` : "";
}
