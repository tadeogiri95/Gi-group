// app/lib/finanzasAnticipos.js — anticipos de sueldo de los dueños (14/11,
// pedido de Tadeo). Sin migración.
//
// Cada dueño tiene un sueldo mensual fijo (Finanzas → Sueldos → ⚙, en
// config_sistema "finanzas_sueldos".fijos). Lo que carga en su caja como
// "Anticipo de sueldo por carga de combustible" va a Anticipo de sueldos (no
// es gasto de la empresa). En su caja ve, por mes:
//   "Anticipos de sueldo por cargas de combustible - Noviembre" = $35
//   "Sueldo Noviembre a liquidar" = $65   (sueldo fijo − anticipos del mes)
// Al pagar el sueldo de ese mes en 👷 Sueldos, los anticipos se descuentan:
// un renglón Sueldos A Pagar contra Anticipo de sueldos (origen pago_sueldo,
// origen_id l<liq>:<empleado>:a<AAAAMM>), que cuenta como pagado; el resto
// se paga desde la caja o el banco. Las dos partes van a T-OPERACIONES.
//
// El anticipo es de la persona a cargo de la caja desde donde se cargó.

import { MESES } from "./constants";

export const CUENTA_ANTICIPO = /^anticipo de sueldos$/i;
export const NOMBRE_COMBUSTIBLE = "Anticipo de sueldo por carga de combustible";
const MESES_ATRAS = 3;

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const importe = (o) => Number(o.total_ars ?? o.total) || 0;

/** La cuenta Anticipo de sueldos del plan, o null. */
export const cuentaAnticipos = (cuentas = []) => cuentas.find((c) => c.activa !== false && CUENTA_ANTICIPO.test(String(c.nombre || "").trim()))?.codigo || null;

/** "2026-11" → "Noviembre". */
export const nombreMesLargo = (mes) => MESES[Number(String(mes).slice(5, 7)) - 1] || mes;

/** El mes que liquida una liquidación: por el período ("Noviembre 2026") o, si no se entiende, por la fecha. */
export function mesDeLiquidacion(liq) {
  const p = String(liq?.periodo || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const i = MESES.findIndex((m) => p.includes(m.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()));
  const anio = p.match(/\b(20\d{2})\b/)?.[1];
  if (i >= 0 && anio) return `${anio}-${String(i + 1).padStart(2, "0")}`;
  return String(liq?.fecha || "").slice(0, 7) || null;
}

/** Los sueldos fijos guardados, limpios: { empleado_id: importe }. */
export function leerFijos(valor) {
  const out = {};
  for (const [k, v] of Object.entries(valor && typeof valor === "object" ? valor : {}).slice(0, 500)) {
    const n = centavos(v);
    if (/^[0-9a-f-]{1,40}$/i.test(k) && n > 0 && n < 1e11) out[k] = n;
  }
  return out;
}

/**
 * Los anticipos de cada mes desde las cajas de una persona.
 * @returns {Map<string, { lineas: Map<string, number>, total: number }>} mes → renglones
 */
export function anticiposPorMes(ops = [], { cuentaAnticipo, cajas = [] } = {}) {
  const enCaja = new Set(cajas);
  const meses = new Map();
  const sumar = (mes, nombre, n) => {
    const m = meses.get(mes) || { lineas: new Map(), total: 0 };
    m.lineas.set(nombre, centavos((m.lineas.get(nombre) || 0) + n));
    m.total = centavos(m.total + n);
    meses.set(mes, m);
  };
  if (!cuentaAnticipo) return meses;
  for (const o of ops) {
    if (!o || o.anulada_at || !o.fecha) continue;
    const mes = String(o.fecha).slice(0, 7);
    // Solo las cargas de combustible: un "Adelanto de sueldo" desde la caja
    // del dueño puede ser para un empleado, y no dice para quién
    if (o.cuenta_debe === cuentaAnticipo && enCaja.has(o.cuenta_haber) && String(o.descripcion || "").startsWith(NOMBRE_COMBUSTIBLE)) {
      sumar(mes, "Anticipos de sueldo por cargas de combustible", importe(o));
    }
  }
  return meses;
}

/** Los meses ya descontados al pagar un sueldo: { "2026-11": importe }. */
export function descontadosDe(ops = [], empleadoId) {
  const re = new RegExp(`^l\\d+:${String(empleadoId).replace(/[^0-9a-f-]/gi, "")}:a(\\d{4})(\\d{2})$`, "i");
  const out = {};
  for (const o of ops) {
    if (o.anulada_at) continue;
    const m = String(o.origen_id || "").match(re);
    if (m) out[`${m[1]}-${m[2]}`] = centavos((out[`${m[1]}-${m[2]}`] || 0) + importe(o));
  }
  return out;
}

/**
 * Lo que ve el dueño en su caja: el mes actual y los anteriores (hasta 3)
 * con anticipos que todavía no se descontaron del sueldo.
 * @returns {{ sueldo: number, meses: { mes, nombre, lineas: { nombre, importe }[], anticipos: number, a_liquidar: number, descontado: boolean }[] } | null}
 */
export function resumenAnticipos({ ops = [], descuentos = [], cuentaAnticipo, cajas = [], sueldo, empleadoId, hoy }) {
  if (!(Number(sueldo) > 0) || !hoy) return null;
  const porMes = anticiposPorMes(ops, { cuentaAnticipo, cajas });
  const hechos = descontadosDe(descuentos, empleadoId);
  const actual = String(hoy).slice(0, 7);
  const desde = (() => { const d = new Date(`${actual}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - MESES_ATRAS); return d.toISOString().slice(0, 7); })();
  const meses = [...new Set([actual, ...porMes.keys()])]
    .filter((m) => m <= actual && m >= desde && (m === actual || ((porMes.get(m)?.total || 0) > 0 && !hechos[m])))
    .sort((a, b) => (a < b ? 1 : -1));
  return {
    sueldo: centavos(sueldo),
    meses: meses.map((mes) => {
      const m = porMes.get(mes) || { lineas: new Map(), total: 0 };
      const nombre = nombreMesLargo(mes);
      return {
        mes, nombre,
        lineas: [...m.lineas.entries()].filter(([, n]) => n !== 0).map(([n, imp]) => ({ nombre: `${n} - ${nombre}`, importe: imp })),
        anticipos: m.total, a_liquidar: centavos(sueldo - m.total), descontado: Boolean(hechos[mes]),
      };
    }),
  };
}

/** El renglón que descuenta los anticipos del sueldo al pagarlo. */
export function operacionDescuentoAnticipos({ liq, renglon, importe: total, fecha, mes }, { cuentaAPagar, cuentaAnticipo }) {
  const t = centavos(total);
  return {
    fecha, tipo: "SUELDOS", proveedor_id: null, entidad: String(renglon.nombre || "").slice(0, 120),
    neto: t, iva: 0, otros_impuestos: 0, total: t, moneda: "ARS", tipo_cambio: null, total_ars: t,
    cuenta_debe: cuentaAPagar, cuenta_haber: cuentaAnticipo,
    descripcion: `Descuento de anticipos de sueldo de ${nombreMesLargo(mes)} · ${liq.periodo} · ${renglon.nombre}`.slice(0, 500),
    origen: "pago_sueldo", origen_id: `l${liq.id}:${renglon.empleado_id}:a${String(mes).replace("-", "")}`.slice(0, 60), estado: "confirmada",
  };
}
