// app/lib/margenOt.js — Margen de cada OT (auditoría 12/11, parte 4; sin
// migración).
//
//   Ganancia = precio de la OT (PRECIO del Plan de trabajo, sin IVA; precios_ot)
//              − costo real (app/lib/costoReal.js)
//   Margen   = ganancia ÷ precio
//
// Se avisa cuando el margen baja del mínimo de la empresa (10 % si no se
// cambió; config_sistema "costos_margen"). También el margen previsto (precio
// contra el costo previsto), para ver si ya se cotizó corto.
export const CLAVE_MARGEN = "costos_margen";
export const MARGEN_MINIMO = 10;

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** El margen mínimo guardado (0 a 100), o el de siempre. */
export function margenMinimoDe(valor) {
  const n = num(valor?.minimo);
  return n != null && n >= 0 && n <= 100 ? n : MARGEN_MINIMO;
}

/** ¿Es un mínimo válido para guardar? */
export const minimoValido = (v) => {
  const n = num(v);
  return n != null && n >= 0 && n <= 100;
};

/**
 * @param {{ precio: number|null, costo: number|null, minimo?: number }} d
 * @returns {{ precio, costo, ganancia, pct, bajo: boolean } | null} null si la OT no tiene precio
 */
export function margen({ precio, costo, minimo = MARGEN_MINIMO }) {
  const p = num(precio);
  const c = num(costo);
  if (p == null || p <= 0 || c == null) return null;
  const ganancia = r2(p - c);
  const pct = r1((ganancia / p) * 100);
  return { precio: p, costo: c, ganancia, pct, bajo: pct < minimo };
}

/** "12,5 %" */
export const textoPct = (pct) => (pct == null ? "—" : `${Number(pct).toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`);

/**
 * Margen por cliente o por división, de las filas del reporte que tienen precio.
 * @param {object[]} filas filas de filaReporte con precio y total
 * @param {(f: object) => string} clave cliente o división de la fila
 * @returns {{ clave, ots, precio, costo, ganancia, pct, bajo, bajas }[]} el de menor margen primero
 */
export function margenPor(filas, clave, minimo = MARGEN_MINIMO) {
  const grupos = new Map();
  for (const f of filas) {
    if (f.precio == null || f.precio <= 0 || f.total == null) continue;
    const k = clave(f) || "Sin dato";
    const g = grupos.get(k) || { clave: k, ots: 0, precio: 0, costo: 0, bajas: 0 };
    g.ots += 1;
    g.precio += f.precio;
    g.costo += f.total;
    if (f.margen_bajo) g.bajas += 1;
    grupos.set(k, g);
  }
  return [...grupos.values()].map((g) => {
    const m = margen({ precio: g.precio, costo: g.costo, minimo });
    return { ...g, precio: r2(g.precio), costo: r2(g.costo), ganancia: m.ganancia, pct: m.pct, bajo: m.bajo };
  }).sort((a, b) => a.pct - b.pct);
}
