// app/lib/panelPlata.js — 💰 La plata en el Panel de control (auditoría del
// 12/11, parte 12). Sin migración: junta lo que ya calculan Finanzas → Flujo
// de caja (lo que viene) y Reportes → 💲 Costo por OT (el margen).

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const suma = (f) => (f ? f.valores.reduce((s, v) => s + (Number(v) || 0), 0) + (Number(f.despues) || 0) : 0);

/** Las semanas que mira el panel (las primeras 4 del flujo). */
export const SEMANAS_PANEL = 4;

/**
 * Lo importante del flujo para el dueño.
 * @param {object} previsto el "previsto" de /api/finanzas/flujo
 * @returns {{ hoy: number, nosDeben: number, debemos: number, en4: number|null, semana4: string|null, peor: { semana: string, saldo: number }|null }|null}
 */
export function resumenPlata(previsto) {
  if (!previsto || !Array.isArray(previsto.filas) || !Array.isArray(previsto.saldo)) return null;
  const fila = (id) => previsto.filas.find((f) => f.id === id);
  const n = Math.min(SEMANAS_PANEL, previsto.saldo.length);
  let peor = null;
  for (let i = 0; i < n; i++) {
    if (previsto.saldo[i] < 0 && (!peor || previsto.saldo[i] < peor.saldo)) peor = { semana: previsto.semanas[i], saldo: centavos(previsto.saldo[i]) };
  }
  return {
    hoy: centavos(previsto.saldo_hoy),
    nosDeben: centavos(suma(fila("cobros"))),
    // Facturas sin orden de pago más las órdenes de pago por pagar (en el flujo van en negativo)
    debemos: centavos(-(suma(fila("a_pagar")) + suma(fila("ordenes")))),
    en4: n ? centavos(previsto.saldo[n - 1]) : null,
    semana4: n ? previsto.semanas[n - 1] : null,
    peor,
  };
}

/**
 * Las OT con margen por debajo del mínimo (de Costo por OT), la peor primero.
 * @returns {{ ot: string, cliente: string|null, margen: number }[]}
 */
export function otsBajoMargen(filas = []) {
  return (filas || [])
    .filter((f) => f.margen_bajo && f.margen != null)
    .map((f) => ({ ot: String(f.ot), cliente: f.cliente || null, margen: Number(f.margen) }))
    .sort((a, b) => a.margen - b.margen);
}
