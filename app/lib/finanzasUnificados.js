// app/lib/finanzasUnificados.js — Finanzas, parte 5 del plan del 09/11:
// cliente que también es proveedor. Sin migración.
//
//   - El cliente se une con un proveedor (config_sistema
//     "finanzas_cliente_proveedor"). Gypi sugiere la unión cuando tienen el
//     mismo CUIT o el mismo nombre.
//   - Las dos cuentas siguen separadas (Deudores por Ventas y Proveedores, que
//     para impuestos y el Estado de Resultados son cosas distintas): lo que se
//     une es la vista y el saldo neto.
//   - ⚖ Compensar cancela una deuda contra la otra: Proveedores al debe,
//     Deudores por Ventas al haber, con el cliente y el proveedor en la misma
//     operación. No mueve caja.
import { saldosClientes } from "./finanzasClientes";
import { claveNombre, saldosProveedores } from "./finanzasProveedores";
import { mismoNombre } from "./finanzasSos";

export const CLAVE_UNIFICADOS = "finanzas_cliente_proveedor";
export const TIPO_COMPENSACION = "COMPENSACIÓN DE SALDOS";
export const ORIGEN_COMPENSACION = "compensacion";

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const cuit = (s) => String(s || "").replace(/\D/g, "");

/** Lo guardado: [{ cliente_id, proveedor_id }], uno con uno. */
export function leerPares(valor) {
  const lista = Array.isArray(valor?.pares) ? valor.pares : [];
  const vistosC = new Set();
  const vistosP = new Set();
  const out = [];
  for (const p of lista.slice(0, 5000)) {
    const c = Number(p?.cliente_id);
    const v = Number(p?.proveedor_id);
    if (!(c > 0) || !(v > 0) || vistosC.has(c) || vistosP.has(v)) continue;
    vistosC.add(c);
    vistosP.add(v);
    out.push({ cliente_id: c, proveedor_id: v });
  }
  return out;
}

/**
 * Los pares guardados más los de la agenda (una persona cliente y proveedor,
 * migración 191), uno con uno: si un cliente o un proveedor ya está en un
 * par guardado, manda ese.
 */
export function juntarPares(guardados = [], deAgenda = []) {
  return leerPares({ pares: [...guardados, ...deAgenda.map((p) => ({ cliente_id: p.cliente_id, proveedor_id: p.proveedor_id }))] });
}

/** Clientes y proveedores con el mismo CUIT o el mismo nombre, que todavía no están unidos. */
export function sugerirPares(clientes = [], proveedores = [], pares = []) {
  const usadosC = new Set(pares.map((p) => p.cliente_id));
  const usadosP = new Set(pares.map((p) => p.proveedor_id));
  const libresP = proveedores.filter((p) => !usadosP.has(Number(p.id)));
  const out = [];
  for (const c of clientes) {
    if (c.unido_a || c.activo === false || usadosC.has(Number(c.id))) continue;
    const kc = cuit(c.cuit);
    const nombres = [c.nombre, ...(c.alias || [])];
    const p = (kc.length === 11 && libresP.find((x) => cuit(x.cuit) === kc))
      || libresP.find((x) => nombres.some((n) => claveNombre(n) === claveNombre(x.nombre)))
      || libresP.find((x) => nombres.some((n) => mismoNombre(n, x.nombre)));
    if (!p) continue;
    usadosP.add(Number(p.id));
    libresP.splice(libresP.indexOf(p), 1);
    out.push({ cliente_id: Number(c.id), proveedor_id: Number(p.id), cliente: c.nombre, proveedor: p.nombre, por: kc.length === 11 && cuit(p.cuit) === kc ? "cuit" : "nombre" });
  }
  return out;
}

/**
 * La cuenta unificada de cada par: lo que nos debe como cliente, lo que le
 * debemos como proveedor y el neto (+ nos debe, - le debemos).
 */
export function cuentasUnificadas(pares, { ops = [], clientes = [], proveedores = [], cuentasDeu, cuentasProv }) {
  const cli = new Map(saldosClientes(ops, cuentasDeu, clientes).map((s) => [s.clave, s]));
  const prov = new Map(saldosProveedores(ops, cuentasProv, proveedores).map((s) => [s.clave, s]));
  const nombreC = new Map(clientes.map((c) => [Number(c.id), c.nombre]));
  const nombreP = new Map(proveedores.map((p) => [Number(p.id), p.nombre]));
  return pares.map((p) => {
    const nosDebe = centavos(cli.get(`c${p.cliente_id}`)?.saldo);
    const leDebemos = centavos(prov.get(`p${p.proveedor_id}`)?.deuda);
    return {
      ...p, cliente: nombreC.get(p.cliente_id) || "", proveedor: nombreP.get(p.proveedor_id) || "",
      nos_debe: nosDebe, le_debemos: leDebemos, neto: centavos(nosDebe - leDebemos),
      compensable: centavos(Math.max(0, Math.min(nosDebe, leDebemos))),
    };
  });
}

/**
 * La operación que compensa: baja lo que le debemos (Proveedores al debe) y
 * lo que nos debe (Deudores por Ventas al haber), por el mismo importe.
 * @returns {{ op?: object, error?: string }}
 */
export function operacionCompensacion(d, { cuenta, cuentaDeudores, cuentaProveedores }) {
  if (!cuenta) return { error: "Ese cliente no está unido con un proveedor" };
  if (!cuentaDeudores || !cuentaProveedores) return { error: "Faltan las cuentas \"Deudores por Ventas\" o \"Proveedores\" en el plan de cuentas" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d?.fecha || ""))) return { error: "Falta la fecha" };
  const importe = centavos(d.importe);
  if (!(importe > 0)) return { error: "El importe tiene que ser mayor a cero" };
  if (importe > cuenta.compensable + 0.009) {
    return { error: cuenta.compensable > 0 ? `Se puede compensar hasta $ ${cuenta.compensable.toLocaleString("es-AR", { minimumFractionDigits: 2 })}` : "No hay nada para compensar: hace falta que nos deba y que le debamos" };
  }
  const nota = String(d.descripcion || "").replace(/\s+/g, " ").trim().slice(0, 200);
  return {
    op: {
      fecha: d.fecha, tipo: TIPO_COMPENSACION, cliente_id: cuenta.cliente_id, proveedor_id: cuenta.proveedor_id, entidad: null,
      neto: importe, iva: 0, otros_impuestos: 0, total: importe, moneda: "ARS", tipo_cambio: null, total_ars: importe,
      cuenta_debe: cuentaProveedores, cuenta_haber: cuentaDeudores,
      descripcion: [`Compensación de saldos: ${cuenta.cliente || "cliente"} / ${cuenta.proveedor || "proveedor"}`, nota].filter(Boolean).join(" · ").slice(0, 500),
      origen: ORIGEN_COMPENSACION, estado: "confirmada",
    },
  };
}
