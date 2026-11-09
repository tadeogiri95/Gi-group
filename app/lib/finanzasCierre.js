// app/lib/finanzasCierre.js — Finanzas, parte F6c: control de cierre, Gypi
// contra el libro. Sin migración.
//
// Para un período (por defecto el mes), con el libro bajado en .xlsx:
//   - Saldos al último día: cada caja y banco (por cuenta, en su moneda), cada
//     proveedor (lo que se le debe) y cada cliente (lo que nos debe). En Gypi
//     salen de las operaciones confirmadas (con los saldos iniciales); en el
//     libro, de T-OPERACIONES (solo CONFIRMADO), como en la carga de saldos.
//   - Operaciones del período que explican las diferencias:
//       · solo en el libro: renglones CONFIRMADO sin referencia "GY-F-…",
//         posteriores a los saldos iniciales (alguien las cargó a mano);
//       · de Gypi que no están en el libro (el script no las bajó todavía);
//       · distintas: el renglón "GY-F-<id>" no coincide con Gypi en fecha,
//         total o cuentas (se cambió a mano en el libro).
// Las operaciones para revisar de Gypi no cuentan: no van al libro hasta que
// se confirman.
import { PREFIJO_OPERACION } from "./finanzasLibro";
import { claveNombre, emparejarProveedor, fechaDelLibro, saldosDelLibro } from "./finanzasProveedores";
import { emparejarCliente, saldosClientesDelLibro } from "./finanzasClientes";
import { saldosCajasDelLibro } from "./finanzasTesoreria";

/** Diferencias de menos de un peso (redondeos) no se muestran. */
export const TOLERANCIA = 1;

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const numero = (v) => Number(String(v ?? "").replace(",", ".")) || 0;
const txt = (v, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Los renglones de T-OPERACIONES que sirven para comparar.
 * @param {string[][]} grilla la hoja, con títulos en la primera fila
 * @returns {{ filas: { fila: number, fecha: string, tipo: string, entidad: string, total: number, moneda: string, debe: string, haber: string, ref: string, confirmado: boolean }[], error?: string }}
 */
export function operacionesDelLibro(grilla) {
  const titulos = (grilla?.[0] || []).map((t) => String(t || "").trim().toLowerCase());
  const col = (n) => titulos.indexOf(n);
  const c = {
    fecha: col("fecha_operación"), tipo: col("cod_tipo_op"), entidad: col("id_entidad"), total: col("total"), moneda: col("moneda"),
    ref: col("referencia_externa"), estado: col("estado"), debe: col("cuenta_debe_final"), haber: col("cuenta_haber_final"), descripcion: col("descripcion"),
  };
  if ([c.fecha, c.total, c.debe, c.haber, c.ref].some((i) => i < 0)) {
    return { filas: [], error: "La hoja T-OPERACIONES no tiene las columnas fecha_operación, Total, referencia_externa, cuenta_debe_final y cuenta_haber_final." };
  }
  const filas = [];
  (grilla || []).slice(1).forEach((f, i) => {
    const fecha = fechaDelLibro(f[c.fecha]);
    const total = numero(f[c.total]);
    if (!fecha || !total) return;
    filas.push({
      fila: i + 2, fecha, total,
      tipo: c.tipo >= 0 ? txt(f[c.tipo], 60) : "",
      entidad: c.entidad >= 0 ? txt(f[c.entidad]) : "",
      descripcion: c.descripcion >= 0 ? txt(f[c.descripcion], 200) : "",
      moneda: c.moneda >= 0 && String(f[c.moneda] || "").trim().toUpperCase() === "USD" ? "USD" : "ARS",
      debe: String(f[c.debe] || "").trim(), haber: String(f[c.haber] || "").trim(),
      ref: String(f[c.ref] || "").trim(),
      confirmado: c.estado < 0 || String(f[c.estado] || "").trim().toUpperCase() === "CONFIRMADO",
    });
  });
  return { filas };
}

/** "GY-F-123" → 123 (o null si no es de Gypi). */
export function idDeReferencia(ref) {
  const s = String(ref || "").trim().toUpperCase();
  if (!s.startsWith(PREFIJO_OPERACION)) return null;
  const n = s.slice(PREFIJO_OPERACION.length);
  return /^\d+$/.test(n) ? Number(n) : null;
}

/** Junta lo de Gypi y lo del libro por clave; deja solo lo que no da igual. */
function cruzar(gypi, libro) {
  const por = new Map();
  for (const g of gypi) por.set(g.clave, { clave: g.clave, nombre: g.nombre, moneda: g.moneda, gypi: g.saldo, libro: 0 });
  for (const l of libro) {
    const x = por.get(l.clave) || { clave: l.clave, nombre: l.nombre, moneda: l.moneda, gypi: 0, libro: 0 };
    x.libro = centavos(x.libro + l.saldo);
    por.set(l.clave, x);
  }
  const todas = [...por.values()].map((x) => ({ ...x, gypi: centavos(x.gypi), diferencia: centavos(x.gypi - x.libro) }));
  const distintas = todas.filter((x) => Math.abs(x.diferencia) >= TOLERANCIA).sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));
  const suma = (k) => centavos(todas.reduce((s, x) => s + x[k], 0));
  return { filas: distintas, iguales: todas.length - distintas.length, total_gypi: suma("gypi"), total_libro: suma("libro") };
}

/**
 * Compara Gypi con el libro.
 * @param {{ gypi: object, grilla: string[][], desde: string, hasta: string }} p
 *   gypi = lo que da GET /api/finanzas/cierre: { cajas, proveedores, clientes,
 *   lista_proveedores, lista_clientes, cuentas_proveedores, cuentas_deudores,
 *   operaciones, corte }
 */
export function compararCierre({ gypi, grilla, desde, hasta }) {
  const libro = operacionesDelLibro(grilla);
  if (libro.error) return { error: libro.error };

  // Cajas y bancos, por cuenta
  const tes = gypi.cajas || [];
  const libroCajas = saldosCajasDelLibro(grilla, hasta, tes).filas;
  const cajas = cruzar(
    tes.map((t) => ({ clave: t.cuenta, nombre: t.nombre, moneda: t.moneda === "USD" ? "USD" : "ARS", saldo: t.saldo })),
    libroCajas.map((l) => { const t = tes.find((x) => x.cuenta === l.cuenta); return { clave: l.cuenta, nombre: t?.nombre || l.cuenta, moneda: t?.moneda === "USD" ? "USD" : "ARS", saldo: l.saldo }; }),
  );

  // Proveedores: el nombre del libro se busca en la lista de Gypi
  const provs = gypi.lista_proveedores || [];
  const libroProv = saldosDelLibro(grilla, hasta, new Set(gypi.cuentas_proveedores || [])).filas;
  const proveedores = cruzar(
    (gypi.proveedores || []).map((p) => ({ clave: p.clave, nombre: p.nombre, moneda: "ARS", saldo: p.deuda })),
    libroProv.map((l) => { const p = emparejarProveedor(l.nombre, provs); return { clave: p ? `p${p.id}` : `e${claveNombre(l.nombre)}`, nombre: p?.nombre || l.nombre, moneda: "ARS", saldo: l.deuda }; }),
  );

  const clis = gypi.lista_clientes || [];
  const libroCli = saldosClientesDelLibro(grilla, hasta, new Set(gypi.cuentas_deudores || [])).filas;
  const clientes = cruzar(
    (gypi.clientes || []).map((c) => ({ clave: c.clave, nombre: c.nombre, moneda: "ARS", saldo: c.saldo })),
    libroCli.map((l) => { const c = emparejarCliente(l.nombre, clis); return { clave: c ? `c${c.id}` : `e${claveNombre(l.nombre)}`, nombre: c?.nombre || l.nombre, moneda: "ARS", saldo: l.saldo }; }),
  );

  // Operaciones del período
  const enPeriodo = (f) => f >= desde && f <= hasta;
  const deGypi = new Map((gypi.operaciones || []).map((o) => [Number(o.id), o]));
  const enLibro = new Map();
  for (const f of libro.filas) {
    const id = idDeReferencia(f.ref);
    if (id) enLibro.set(id, f);
  }
  const corte = gypi.corte || "";
  const soloLibro = libro.filas.filter((f) => f.confirmado && !idDeReferencia(f.ref) && enPeriodo(f.fecha) && (!corte || f.fecha > corte));
  const soloGypi = [...deGypi.values()].filter((o) => enPeriodo(o.fecha) && !enLibro.has(Number(o.id)));
  const distintas = [];
  for (const [id, f] of enLibro) {
    const o = deGypi.get(id);
    if (!o || !(enPeriodo(o.fecha) || enPeriodo(f.fecha))) continue;
    const cambios = [];
    if (o.fecha !== f.fecha) cambios.push("fecha");
    if (Math.abs((Number(o.total) || 0) - f.total) >= 0.01) cambios.push("total");
    if (o.cuenta_debe !== f.debe || o.cuenta_haber !== f.haber) cambios.push("cuentas");
    if (cambios.length) distintas.push({ id, fila: f.fila, gypi: o, libro: f, cambios });
  }
  const porFecha = (a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0);
  const sinTilde = libro.filas.filter((f) => idDeReferencia(f.ref) && !f.confirmado && deGypi.has(idDeReferencia(f.ref)) && enPeriodo(f.fecha)).length;

  const diferencias = cajas.filas.length + proveedores.filas.length + clientes.filas.length + soloLibro.length + soloGypi.length + distintas.length + sinTilde;
  return {
    desde, hasta, corte: corte || null,
    cajas, proveedores, clientes,
    solo_libro: soloLibro.sort(porFecha),
    solo_gypi: soloGypi.sort(porFecha),
    distintas: distintas.sort((a, b) => porFecha(a.gypi, b.gypi)),
    sin_confirmar_en_libro: sinTilde,
    ok: diferencias === 0,
  };
}
