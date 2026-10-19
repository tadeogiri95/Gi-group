// app/lib/instalacion.js — Avance de la instalación de una OT (seguimiento de
// OT por escaneo, parte 24b; migración 117).
//
// El jefe de instalaciones deja un reporte por día: módulos colocados y lo que
// quedó pendiente. Los módulos salen de las piezas de la OT (piezas_ot, el
// prefijo del nombre en la planilla); las piezas sin módulo cuentan como uno
// más, "Sueltas".
//
// % de instalación: cada módulo pesa por la superficie de sus piezas (largo ×
// ancho). Si alguna pieza no tiene medidas, todas pesan igual (por cantidad).
// Un pendiente abierto le resta a su módulo la superficie de las piezas que
// faltan o, si no se eligieron piezas, un % fijo de la OT (1 si no se dice
// otro): 4 módulos colocados con un ajuste pendiente cada uno = 96%. Un
// módulo no resta más que lo que pesa.

export const SIN_MODULO = "Sueltas";
export const PORCENTAJE_PENDIENTE = 1;

const area = (p) => {
  const l1 = Number(p?.l1), l2 = Number(p?.l2);
  return l1 > 0 && l2 > 0 ? (l1 * l2) / 1e6 : null; // mm × mm → m²
};

/**
 * Módulos de la OT a partir de sus piezas.
 * @param {{ id: number, nombre: string, modulo?: string|null, l1?: number|null, l2?: number|null }[]} piezas
 * @returns {{ porArea: boolean, modulos: { modulo: string, piezas: object[], peso: number }[] }}
 */
export function modulosDeOt(piezas = []) {
  const lista = Array.isArray(piezas) ? piezas : [];
  const porArea = lista.length > 0 && lista.every((p) => area(p) !== null);
  const grupos = new Map();
  for (const p of lista) {
    const m = String(p.modulo || "").trim() || SIN_MODULO;
    if (!grupos.has(m)) grupos.set(m, []);
    grupos.get(m).push(p);
  }
  const peso = (ps) => ps.reduce((s, p) => s + (porArea ? area(p) : 1), 0);
  const modulos = [...grupos.entries()]
    .map(([modulo, ps]) => ({ modulo, piezas: ps, peso: peso(ps) }))
    .sort((a, b) => (a.modulo === SIN_MODULO) - (b.modulo === SIN_MODULO) || a.modulo.localeCompare(b.modulo, "es", { numeric: true }));
  return { porArea, modulos };
}

/** Cuánto resta un pendiente abierto, en el mismo peso que los módulos (total = peso de la OT). */
export function descuentoPendiente(pendiente, modulo, porArea, total) {
  const ids = new Set((pendiente?.piezas || []).map(Number));
  if (ids.size > 0) {
    const faltan = modulo.piezas.filter((p) => ids.has(Number(p.id)));
    if (faltan.length > 0) return faltan.reduce((s, p) => s + (porArea ? area(p) : 1), 0);
  }
  const pct = pendiente?.porcentaje ?? PORCENTAJE_PENDIENTE;
  return (Math.max(0, Number(pct) || 0) / 100) * total;
}

/**
 * % de instalación de la OT.
 * @param {{ piezas: object[], instalados: string[], pendientes?: { modulo?: string|null, piezas?: number[]|null, porcentaje?: number|null, resuelto?: boolean }[] }} datos
 * @returns {{ porcentaje: number|null, colocados: number, total: number, porArea: boolean, modulos: object[] }}
 *   porcentaje null cuando la OT no tiene piezas cargadas
 */
export function avanceInstalacion({ piezas = [], instalados = [], pendientes = [] } = {}) {
  const { porArea, modulos } = modulosDeOt(piezas);
  const colocados = new Set((instalados || []).map(String));
  const total = modulos.reduce((s, m) => s + m.peso, 0);
  const abiertos = (pendientes || []).filter((p) => !p.resuelto && p.modulo);
  let hecho = 0;
  const detalle = modulos.map((m) => {
    const instalado = colocados.has(m.modulo);
    const resta = Math.min(m.peso, abiertos.filter((p) => p.modulo === m.modulo).reduce((s, p) => s + descuentoPendiente(p, m, porArea, total), 0));
    if (instalado) hecho += m.peso - resta;
    return { ...m, instalado, resta };
  });
  const porcentaje = total > 0 ? Math.round((hecho / total) * 1000) / 10 : null;
  return { porcentaje, colocados: detalle.filter((m) => m.instalado).length, total: modulos.length, porArea, modulos: detalle };
}
