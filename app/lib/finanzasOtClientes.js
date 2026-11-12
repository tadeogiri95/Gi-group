// app/lib/finanzasOtClientes.js — Finanzas, parte 6 del plan del 09/11:
// cuenta corriente de clientes por OT. Sin migración.
//
// Es una vista de gestión (no crea asientos): cada OT del cliente es un
// renglón con su valor, y se restan todos los cobros.
//   - Valor = el presupuesto (PRECIO del Plan, sin IVA). Si no tiene, costo de
//     materiales ÷ 0,3, marcado como estimado. El costo de materiales sale de
//     las necesidades de la OT con el precio de cada artículo, igual que el
//     Costo de la OT (precio fijo de la OT o el elegido por fecha).
//   - Cobros = todo lo que baja lo que nos debe (efectivo, transferencia,
//     cheques, dólares, compensaciones, anticipos). Los que tienen OT van a
//     esa OT; los demás quedan "sin OT" y restan del total del cliente.
//   - Con IVA: el valor de las OT × 1,21 (los cobros ya son lo cobrado).
//   - Todas las OT, con un "desde" opcional que también recorta los cobros.
import { claveNombre } from "./finanzasProveedores";
import { claveCliente, clienteDeOt, efectoCliente, indiceClientes } from "./finanzasClientes";
import { elegirPrecio, fechaCargaOt } from "./costoMateriales";

export const FACTOR_ESTIMADO = 0.3;
export const IVA_OT = 0.21;

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Costo de materiales de una OT sin guardar nada: precio fijo de la OT si lo
 * tiene, si no el elegido por fecha.
 * @param {{ necesidades: object[], fijos: Map<string, object>, precios: Map<string, object[]>, fechaOt: string|null }} d
 * @returns {{ total: number, sinPrecio: number, articulos: number }}
 */
export function materialesOt({ necesidades = [], fijos = new Map(), precios = new Map(), fechaOt = null }) {
  const cant = new Map();
  for (const n of necesidades) cant.set(n.sku, (cant.get(n.sku) || 0) + (Number(n.cantidad) || 0));
  let total = 0;
  let sinPrecio = 0;
  let articulos = 0;
  for (const [sku, c] of cant) {
    if (!(c > 0)) continue;
    articulos++;
    const p = fijos.get(sku) || elegirPrecio(precios.get(sku) || [], fechaOt);
    if (!p) { sinPrecio++; continue; }
    total += c * Number(p.precio_ars);
  }
  return { total: centavos(total), sinPrecio, articulos };
}

/** Valor de la OT: el presupuesto, o materiales ÷ 0,3 (estimado), o nada. */
export function valorOt(precio, materiales) {
  const p = Number(precio) || 0;
  if (p > 0) return { valor: centavos(p), estimado: false };
  const m = Number(materiales?.total) || 0;
  if (m > 0) return { valor: centavos(m / FACTOR_ESTIMADO), estimado: true };
  return { valor: 0, estimado: false, sin_valor: true };
}

/**
 * Las OT y los cobros de cada cliente (sin recortar por fecha).
 * @returns {{ clave, cliente_id, nombre, ots: object[], cobros: object[] }[]}
 */
export function cuentasPorOt({ proyectos = [], precios = new Map(), materiales = new Map(), ops = [], cuentasDeu, clientes = [] }) {
  const indice = indiceClientes(clientes);
  const nombreDe = new Map(clientes.map((c) => [Number(c.id), c.nombre]));
  const por = new Map();
  const de = (clave, nombre) => {
    if (!por.has(clave)) por.set(clave, { clave, cliente_id: clave.startsWith("c") ? Number(clave.slice(1)) : null, nombre, ots: [], cobros: [] });
    return por.get(clave);
  };
  const otDe = new Map();
  for (const p of proyectos) {
    const k = claveNombre(p.cliente);
    // Manda el cliente de la OT (parte 6): el que tiene unido, o el de su nombre
    const id = clienteDeOt(p, clientes, indice);
    if (!k && !id) continue;
    const clave = id ? `c${id}` : `e${k}`;
    const v = valorOt(precios.get(String(p.ot)), materiales.get(String(p.ot)));
    const ot = {
      proyecto_id: Number(p.id), ot: String(p.ot), obra: p.obra || "", descripcion: p.descripcion || "", estado: p.estado || "",
      fecha: fechaCargaOt(p) || "", ...v, materiales: centavos(materiales.get(String(p.ot))?.total),
      sin_precio_materiales: materiales.get(String(p.ot))?.sinPrecio || 0,
    };
    de(clave, id ? nombreDe.get(id) || p.cliente : String(p.cliente).trim()).ots.push(ot);
    otDe.set(Number(p.id), clave);
  }
  for (const op of ops) {
    const ef = efectoCliente(op, cuentasDeu);
    if (ef >= 0) continue;
    const pid = op.proyecto_id ? Number(op.proyecto_id) : null;
    const propia = claveCliente(op, indice);
    // El cobro de una OT va a la cuenta del cliente de la OT, aunque se haya cargado a otro nombre
    const clave = (pid && otDe.get(pid)) || propia;
    if (!clave) continue;
    const s = de(clave, clave.startsWith("c") ? nombreDe.get(Number(clave.slice(1))) || op.entidad || "" : String(op.entidad || "").trim());
    s.cobros.push({
      id: op.id, fecha: op.fecha, importe: centavos(-ef), proyecto_id: pid && otDe.get(pid) === clave ? pid : null, tipo: op.tipo || "", descripcion: op.descripcion || "",
      ...(propia && propia !== clave ? { a_nombre_de: String(op.entidad || "").trim() || null } : {}),
    });
  }
  return [...por.values()].filter((s) => s.ots.length);
}

/**
 * El resumen de un cliente con IVA o sin IVA y desde una fecha.
 * @returns {{ ots: object[], sin_ot: number, valor: number, cobrado: number, saldo: number, estimadas: number }}
 */
export function resumirCliente(c, { conIva = false, desde = "" } = {}) {
  const f = conIva ? 1 + IVA_OT : 1;
  const ots = c.ots.filter((o) => !desde || !o.fecha || o.fecha >= desde);
  const ids = new Set(ots.map((o) => o.proyecto_id));
  const cobros = c.cobros.filter((x) => !desde || x.fecha >= desde);
  const cobradoOt = new Map();
  let sinOt = 0;
  for (const x of cobros) {
    if (x.proyecto_id && ids.has(x.proyecto_id)) cobradoOt.set(x.proyecto_id, (cobradoOt.get(x.proyecto_id) || 0) + x.importe);
    else sinOt += x.importe;
  }
  const filas = ots.map((o) => {
    const valor = centavos(o.valor * f);
    const cobrado = centavos(cobradoOt.get(o.proyecto_id) || 0);
    return { ...o, valor, cobrado, saldo: centavos(valor - cobrado) };
  }).sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "") || b.ot.localeCompare(a.ot));
  const valor = centavos(filas.reduce((s, o) => s + o.valor, 0));
  const cobrado = centavos(cobros.reduce((s, x) => s + x.importe, 0));
  return { ots: filas, sin_ot: centavos(sinOt), valor, cobrado, saldo: centavos(valor - cobrado), estimadas: filas.filter((o) => o.estimado).length };
}
