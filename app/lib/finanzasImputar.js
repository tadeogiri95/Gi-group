// app/lib/finanzasImputar.js — Imputar después (pedido de Tadeo 19/11, punto
// 13 del plan; migración 200). En Finanzas → Movimientos se tildan una o
// varias operaciones y se les pone, todas juntas, un cliente, un proveedor,
// una OT, un centro de costo, una cuenta, una caja, un vehículo o una máquina.
// Cada cambio queda en el historial de la operación (199).
//
// Qué se puede imputar en cada una:
//   - centro de costo, vehículo y máquina: en cualquiera (no mueven saldos).
//   - OT: en cualquiera, menos las que Gypi arma con la OT (venta, entrega,
//     consumo de materiales y entrega estimada).
//   - cliente, proveedor, cuenta y caja: solo en las que se corrigen acá
//     (finanzasCorregir.js), porque mueven la cuenta corriente o el asiento;
//     las de una factura, un cheque o una orden se cambian desde donde salieron.
//   - cuenta = el lado que no es caja; caja = el lado que es caja. Un pase
//     entre dos cajas o un asiento sin caja se corrige con ✏ Corregir.
import { puedeCorregir } from "./finanzasCorregir";

export const CAMPOS_IMPUTAR = {
  cliente: "Cliente", proveedor: "Proveedor", ot: "OT", centro_costo: "Centro de costo",
  cuenta: "Cuenta", caja: "Caja o banco", vehiculo: "Vehículo", maquina: "Máquina",
};
/** El nombre de cada columna en el historial. */
export const COLUMNAS_IMPUTAR = {
  cliente_id: "Cliente", proveedor_id: "Proveedor", entidad: "Proveedor o cliente", proyecto_id: "OT", centro_costo: "Centro de costo",
  cuenta_debe: "Debe", cuenta_haber: "Haber", vehiculo_id: "Vehículo", maquina_id: "Máquina",
};
/** Las que Gypi arma con su OT: la OT no se cambia a mano. */
export const ORIGENES_CON_OT = new Set(["venta_ot", "entrega_ot", "consumo_ot", "entrega_estimada"]);
export const MAX_IMPUTAR = 200;
/** Lo que necesita la migración 200. */
export const CAMPOS_200 = new Set(["vehiculo", "maquina"]);

/**
 * ¿Se le puede imputar este campo? Devuelve null si sí, o por qué no.
 * @param {{ espejo?: boolean }} [opts]
 */
export function porQueNoImputar(op, campo, { espejo = false } = {}) {
  if (!op) return "No encontré la operación";
  if (op.anulada_at) return "Está anulada";
  if (!CAMPOS_IMPUTAR[campo]) return "No sé imputar eso";
  if (["centro_costo", "vehiculo", "maquina"].includes(campo)) return null;
  if (campo === "ot") return ORIGENES_CON_OT.has(op.origen) ? "La OT la pone Gypi (sale de la OT)" : null;
  if (!puedeCorregir(op, { espejo })) return "Sale de otra pantalla: se cambia desde ahí";
  return null;
}

/** El lado de la caja: "debe", "haber", "los dos" o null. */
export function ladoDeCaja(op, cajas = new Set()) {
  const d = cajas.has(op.cuenta_debe);
  const h = cajas.has(op.cuenta_haber);
  return d && h ? "los dos" : d ? "debe" : h ? "haber" : null;
}

/**
 * Lo que cambia en la operación al imputarle el valor.
 * ctx = { tesoreria, cuentas, clientes, proveedores, proyectos, centros, vehiculos, maquinas }
 * @returns {{ campos?: object, detalle?: { campo: string, antes: any, despues: any }[], error?: string }}
 */
export function imputacion(op, campo, valor, ctx = {}, opts = {}) {
  const no = porQueNoImputar(op, campo, opts);
  if (no) return { error: no };
  const vacio = valor === null || valor === undefined || valor === "";
  const buscar = (lista, k, v) => (lista || []).find((x) => String(x[k]) === String(v));
  let campos;
  if (campo === "cliente" || campo === "proveedor") {
    if (vacio) {
      campos = campo === "cliente" ? { cliente_id: null } : { proveedor_id: null };
      if ((campo === "cliente" ? op.cliente_id : op.proveedor_id) != null) campos.entidad = null;
    } else {
      const x = buscar(campo === "cliente" ? ctx.clientes : ctx.proveedores, "id", valor);
      if (!x) return { error: campo === "cliente" ? "Ese cliente no está en la Agenda" : "Ese proveedor no está en la Agenda" };
      // Una operación es de un cliente o de un proveedor, no de los dos
      campos = campo === "cliente"
        ? { cliente_id: Number(x.id), proveedor_id: null, entidad: String(x.nombre || "").slice(0, 120) || null }
        : { proveedor_id: Number(x.id), cliente_id: null, entidad: String(x.nombre || "").slice(0, 120) || null };
    }
  } else if (campo === "ot") {
    if (vacio) campos = { proyecto_id: null };
    else {
      const p = buscar(ctx.proyectos, "id", valor);
      if (!p) return { error: "Esa OT no está" };
      campos = { proyecto_id: Number(p.id) };
    }
  } else if (campo === "centro_costo") {
    if (vacio) campos = { centro_costo: null };
    else {
      const c = buscar(ctx.centros, "codigo", valor);
      if (!c) return { error: "Ese centro de costo no está" };
      campos = { centro_costo: c.codigo };
    }
  } else if (campo === "vehiculo" || campo === "maquina") {
    const col = campo === "vehiculo" ? "vehiculo_id" : "maquina_id";
    if (vacio) campos = { [col]: null };
    else {
      const x = buscar(campo === "vehiculo" ? ctx.vehiculos : ctx.maquinas, "id", valor);
      if (!x) return { error: campo === "vehiculo" ? "Ese vehículo no está en Flota" : "Esa máquina no está en Maquinaria" };
      campos = { [col]: Number(x.id) };
    }
  } else {
    // cuenta o caja: un lado del asiento
    if (vacio) return { error: `Elegí ${campo === "caja" ? "la caja o el banco" : "la cuenta"}` };
    const cajas = new Set((ctx.tesoreria || []).map((t) => t.cuenta));
    const lado = ladoDeCaja(op, cajas);
    if (!lado || lado === "los dos") return { error: lado ? "Es un pase entre dos cajas: corregila con ✏ Corregir" : "No tiene caja ni banco: corregila con ✏ Corregir" };
    const ladoCambia = campo === "caja" ? lado : lado === "debe" ? "haber" : "debe";
    if (campo === "caja" && !cajas.has(valor)) return { error: "Esa no es una caja ni un banco" };
    if (campo === "cuenta") {
      if (!buscar(ctx.cuentas, "codigo", valor)) return { error: `La cuenta ${valor} no está en el plan de cuentas` };
      if (cajas.has(valor)) return { error: "Esa es una caja: para cambiar la caja elegí Caja o banco" };
    }
    const col = ladoCambia === "debe" ? "cuenta_debe" : "cuenta_haber";
    const otra = ladoCambia === "debe" ? op.cuenta_haber : op.cuenta_debe;
    if (otra === valor) return { error: "El debe y el haber quedarían en la misma cuenta" };
    campos = { [col]: valor };
  }
  const detalle = Object.keys(campos)
    .filter((k) => String(op[k] ?? "") !== String(campos[k] ?? ""))
    .map((k) => ({ campo: k, antes: op[k] ?? null, despues: campos[k] ?? null }));
  if (!detalle.length) return { error: "Ya estaba así" };
  return { campos, detalle };
}
