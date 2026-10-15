// app/lib/movimientosStock.js — Movimientos de stock cargados en la app
// (Stock, parte 14; ítem 40; migración 107).
//
// El operario retira material (consumo) escaneando el QR del artículo, con la
// OT y la cantidad; también puede devolver lo que sobró. La oficina carga los
// ingresos de compras y los ajustes de inventario. La planilla MRP sigue
// mandando: en la parte 15 su script trae estos movimientos.

export const TIPOS_MOVIMIENTO = {
  consumo:    { id: "consumo",    nombre: "Retiro",     icono: "📦", gestion: false },
  devolucion: { id: "devolucion", nombre: "Devolución", icono: "↩️", gestion: false },
  ingreso:    { id: "ingreso",    nombre: "Ingreso",    icono: "🚛", gestion: true },
  ajuste:     { id: "ajuste",     nombre: "Ajuste",     icono: "⚖️", gestion: true },
};

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
export function textoMovimiento(m) {
  const t = TIPOS_MOVIMIENTO[m?.tipo];
  const cant = Number(m?.cantidad);
  const cantidad = Number.isFinite(cant) ? cant.toLocaleString("es-AR", { maximumFractionDigits: 3 }) : "?";
  return [
    `${t?.icono || ""} ${t?.nombre || m?.tipo || ""}`.trim(),
    `${m?.tipo === "ajuste" && cant > 0 ? "+" : ""}${cantidad}${m?.unidad ? ` ${m.unidad}` : ""}`,
    m?.ot ? `OT ${m.ot}` : null,
  ].filter(Boolean).join(" · ");
}
