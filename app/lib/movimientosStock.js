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

/* ─── Corregir un movimiento (19/11, punto 12; migración 199) ─────────── */

/** Lo que se corrige de un movimiento, con su nombre para el historial. */
export const CAMPOS_MOVIMIENTO = { fecha: "Fecha", cantidad: "Cantidad", ot: "OT", notas: "Notas", precio_unitario: "Precio unitario" };

/**
 * Lo que queda del movimiento con los cambios: la fecha (como al cargar, no
 * futura ni de hace más de un año), la cantidad (mayor a cero, salvo un
 * ajuste), la OT, las notas y, en un ingreso, el precio. Lo que no viene
 * queda igual.
 * @returns {{ campos?: object, detalle?: { campo: string, antes: any, despues: any }[], errores: string[] }}
 */
export function movimientoCorregido(mov, cambios = {}, ahora = new Date()) {
  const errores = [];
  if (!mov || mov.anulado) return { errores: ["Ese movimiento ya está anulado."] };
  const campos = {};
  if (cambios.fecha !== undefined) {
    const dia = fechaDelMovimiento(cambios.fecha, ahora);
    if (dia.error) errores.push(dia.error);
    else campos.fecha = dia.fecha;
  }
  if (cambios.cantidad !== undefined) {
    const n = Number(cambios.cantidad);
    if (!Number.isFinite(n) || n === 0 || Math.abs(n) >= 1e10) errores.push("La cantidad no es válida");
    else if (mov.tipo !== "ajuste" && n < 0) errores.push("La cantidad tiene que ser mayor a cero");
    else campos.cantidad = Math.round(n * 1000) / 1000;
  }
  if (cambios.ot !== undefined) campos.ot = cambios.ot ? String(cambios.ot).trim().slice(0, 40) || null : null;
  if (cambios.notas !== undefined) campos.notas = cambios.notas ? String(cambios.notas).replace(/\s+/g, " ").trim().slice(0, 300) || null : null;
  if (cambios.precio_unitario !== undefined) {
    if (mov.tipo !== "ingreso") errores.push("El precio solo va en un ingreso");
    else if (cambios.precio_unitario !== null && !(Number(cambios.precio_unitario) >= 0)) errores.push("El precio no es válido");
    else campos.precio_unitario = cambios.precio_unitario === null ? null : Math.round(Number(cambios.precio_unitario) * 100) / 100;
  }
  if (errores.length) return { errores };
  const antes = { ...mov, fecha: diaDelMovimiento(mov) };
  const detalle = Object.keys(CAMPOS_MOVIMIENTO)
    .filter((c) => c in campos)
    .filter((c) => (c === "cantidad" || c === "precio_unitario")
      ? (antes[c] == null ? campos[c] != null : campos[c] == null || Math.abs(Number(antes[c]) - Number(campos[c])) >= 0.0005)
      : String(antes[c] ?? "") !== String(campos[c] ?? ""))
    .map((c) => ({ campo: c, antes: c === "cantidad" || c === "precio_unitario" ? (antes[c] == null ? null : Number(antes[c])) : antes[c] ?? null, despues: campos[c] ?? null }));
  if (!detalle.length) return { errores: ["No cambiaste nada."] };
  return { campos, detalle, errores };
}
