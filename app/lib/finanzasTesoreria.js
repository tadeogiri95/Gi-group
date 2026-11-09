// app/lib/finanzasTesoreria.js — Finanzas, parte F3a: cajas y bancos
// (reemplaza TESORERIA y RESUMEN CAJA del libro). Sin migración: el saldo
// sale de las operaciones (fin_operaciones, 171) que tocan cada caja o banco
// de la lista (fin_tesoreria).
//
//   - Saldo = lo que entró (la caja al debe) menos lo que salió (al haber),
//     en la moneda de la caja (las de dólares cuentan el total en USD).
//   - Saldos iniciales: del libro (T-OPERACIONES) hasta la fecha de corte,
//     por caja, como "SALDO INICIAL" contra Ajuste De Capital (como los de
//     proveedores, F2a). origen saldo_inicial, origen_id "t<cuenta>".
//   - Pasar plata entre cajas: "TRANSF INTERNA", la que recibe al debe y la
//     que da al haber. Solo entre cajas de la misma moneda.
import { movimientoCaja } from "./finanzasOperaciones";
import { CUENTA_AJUSTE_CAPITAL, ORIGEN_SALDO_INICIAL, TIPO_SALDO_INICIAL, fechaDelLibro } from "./finanzasProveedores";

export const TIPO_TRANSFERENCIA = "TRANSF INTERNA";
export const ORDEN_TIPOS = ["caja", "banco", "fci", "plazo_fijo", "otro"];
export const NOMBRE_GRUPO = { caja: "Cajas", banco: "Bancos", fci: "Fondos comunes de inversión", plazo_fijo: "Plazos fijos", otro: "Otros" };

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Saldo de cada caja y banco, con lo último que se movió. */
export function saldosTesoreria(ops = [], tesoreria = []) {
  return tesoreria.map((caja) => {
    let saldo = 0;
    let ultimo = "";
    let movimientos = 0;
    for (const op of ops) {
      const m = movimientoCaja(op, caja);
      if (!m) continue;
      saldo += m;
      movimientos++;
      if (op.fecha > ultimo) ultimo = op.fecha;
    }
    return { ...caja, saldo: centavos(saldo), ultimo, movimientos };
  });
}

/** Totales por moneda (solo las activas). */
export function totalesTesoreria(saldos = []) {
  const t = { ARS: 0, USD: 0 };
  for (const s of saldos) if (s.activa !== false) t[s.moneda === "USD" ? "USD" : "ARS"] += s.saldo;
  return { ARS: centavos(t.ARS), USD: centavos(t.USD) };
}

/** Movimientos de una caja, del más viejo al más nuevo, con el saldo renglón por renglón. */
export function movimientosDeCaja(ops = [], caja) {
  let saldo = 0;
  return ops
    .filter((op) => movimientoCaja(op, caja))
    .sort((a, b) => (a.fecha === b.fecha ? Number(a.id) - Number(b.id) : a.fecha < b.fecha ? -1 : 1))
    .map((op) => {
      const m = movimientoCaja(op, caja);
      saldo = centavos(saldo + m);
      return { op, entra: m > 0 ? m : 0, sale: m < 0 ? -m : 0, saldo };
    });
}

/**
 * Saldo de cada caja y banco en el libro hasta la fecha de corte (incluida),
 * de la hoja T-OPERACIONES (solo los renglones CONFIRMADO).
 * @param {string[][]} grilla la hoja, con títulos en la primera fila
 * @returns {{ filas: { cuenta: string, saldo: number, movimientos: number }[], error?: string }}
 */
export function saldosCajasDelLibro(grilla, hasta, tesoreria = []) {
  const titulos = (grilla?.[0] || []).map((t) => String(t || "").trim().toLowerCase());
  const col = (n) => titulos.indexOf(n);
  const c = { fecha: col("fecha_operación"), total: col("total"), debe: col("cuenta_debe_final"), haber: col("cuenta_haber_final"), estado: col("estado") };
  if ([c.fecha, c.total, c.debe, c.haber].some((i) => i < 0)) {
    return { filas: [], error: "La hoja T-OPERACIONES no tiene las columnas fecha_operación, Total, cuenta_debe_final y cuenta_haber_final." };
  }
  const cuentas = new Set(tesoreria.map((t) => t.cuenta));
  const por = new Map();
  for (const f of grilla.slice(1)) {
    const fecha = fechaDelLibro(f[c.fecha]);
    if (!fecha || fecha > hasta) continue;
    if (c.estado >= 0 && String(f[c.estado] || "").toUpperCase() !== "CONFIRMADO") continue;
    const t = Number(String(f[c.total] ?? "").replace(",", ".")) || 0;
    if (!t) continue;
    for (const [lado, signo] of [[c.debe, 1], [c.haber, -1]]) {
      const cuenta = String(f[lado] || "").trim();
      if (!cuentas.has(cuenta)) continue;
      const s = por.get(cuenta) || { cuenta, saldo: 0, movimientos: 0 };
      s.saldo += signo * t;
      s.movimientos++;
      por.set(cuenta, s);
    }
  }
  return { filas: [...por.values()].map((s) => ({ ...s, saldo: centavos(s.saldo) })) };
}

/** La operación de saldo inicial de una caja: contra Ajuste De Capital. */
export function operacionSaldoInicialCaja({ fecha, caja, saldo, tipo_cambio = null }, cuentaAjuste) {
  const total = centavos(Math.abs(saldo));
  const usd = caja.moneda === "USD";
  const tc = usd ? Number(tipo_cambio) || 1 : null;
  return {
    fecha, tipo: TIPO_SALDO_INICIAL, proveedor_id: null, entidad: txt(caja.nombre, 120) || null,
    neto: total, iva: 0, otros_impuestos: 0, total, moneda: usd ? "USD" : "ARS", tipo_cambio: tc, total_ars: usd ? centavos(total * tc) : total,
    cuenta_debe: saldo > 0 ? caja.cuenta : cuentaAjuste,
    cuenta_haber: saldo > 0 ? cuentaAjuste : caja.cuenta,
    descripcion: `Saldo inicial de ${txt(caja.nombre, 80)} al ${fecha.split("-").reverse().join("/")}, copiado del libro`,
    origen: ORIGEN_SALDO_INICIAL, origen_id: `t${caja.cuenta}`.slice(0, 60), estado: "confirmada",
  };
}

/** La cuenta Ajuste De Capital del plan de cuentas. */
export const cuentaAjusteDe = (cuentas = []) => cuentas.find((c) => CUENTA_AJUSTE_CAPITAL.test(String(c.nombre || "").trim()))?.codigo || null;

/**
 * Pasar plata de una caja o banco a otro.
 * @returns {{ op?: object, errores: string[] }}
 */
export function validarTransferencia(f = {}, tesoreria = []) {
  const errores = [];
  const vivas = tesoreria.filter((t) => t.activa !== false);
  const desde = vivas.find((t) => t.cuenta === f.desde);
  const hacia = vivas.find((t) => t.cuenta === f.hacia);
  if (!desde) errores.push("Elegí de dónde sale la plata");
  if (!hacia) errores.push("Elegí a dónde va la plata");
  if (desde && hacia && desde.cuenta === hacia.cuenta) errores.push("Elegí dos cajas distintas");
  if (desde && hacia && (desde.moneda === "USD") !== (hacia.moneda === "USD")) errores.push("Las dos tienen que ser de la misma moneda");
  const importe = centavos(f.importe);
  if (!(importe > 0) || importe >= 1e13) errores.push("El importe tiene que ser mayor a cero");
  if (!FECHA.test(String(f.fecha || ""))) errores.push("Falta la fecha");
  const usd = desde?.moneda === "USD";
  const tc = usd ? Number(f.tipo_cambio) : null;
  if (usd && !(tc > 0)) errores.push("En dólares falta el tipo de cambio");
  if (errores.length) return { errores };
  const nota = txt(f.descripcion, 300);
  return {
    errores,
    op: {
      fecha: f.fecha, tipo: TIPO_TRANSFERENCIA, proveedor_id: null, entidad: null,
      neto: importe, iva: 0, otros_impuestos: 0, total: importe, moneda: usd ? "USD" : "ARS", tipo_cambio: tc, total_ars: usd ? centavos(importe * tc) : importe,
      cuenta_debe: hacia.cuenta, cuenta_haber: desde.cuenta,
      descripcion: txt(`De ${desde.nombre} a ${hacia.nombre}${nota ? ` · ${nota}` : ""}`, 500),
      origen: "manual", estado: "confirmada",
    },
  };
}
