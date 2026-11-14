// app/lib/finanzasConsumoOt.js — etapa 5 de la auditoría de Finanzas integrada
// (14/11): el stock y las ventas estimadas entran al libro. Sin migración.
//
// 1. Consumo de materiales al entregar la OT (lo que eligió Tadeo el 14/11:
//    "el material baja al entregar la OT, con su costo real"). Antes cada
//    compra subía Materias Primas y el retiro para una OT no hacía nada, así
//    que el Mayor de Materias Primas solo crecía y no coincidía con el stock.
//    Ahora, cuando la OT se entrega (la misma fecha que su entrega), Gypi
//    anota: Costo de Mercadería Vendida (debe) contra Materias Primas (haber),
//    por el costo real de materiales de la OT (MRP + retirado de más + compras
//    sin stock; app/lib/costoReal.js). El estado de resultados toma ese
//    asiento como el costo de materiales de la OT, en vez del %.
//
// 2. Entregas de OT sin precio, para revisar. Las OT terminadas sin PRECIO en
//    el Plan se estimaban (materiales ÷ 0,3) solo en el estado de resultados y
//    en la cuenta corriente por OT: el Mayor de Deudores por Ventas decía otra
//    cosa. Ahora Gypi anota la entrega estimada (Deudores por Ventas contra
//    Entregas Generales) como "para revisar": el Dueño la mira y la confirma,
//    o le pone el precio en el Plan (ahí se anula sola y va la venta y la
//    entrega de verdad).
//
// Mismas reglas que las ventas (finanzasVentas.js): solo las OT cargadas desde
// la fecha "desde"; si la OT se reabre se anulan; si el Dueño anuló una a mano,
// Gypi no la vuelve a crear. El importe se corrige solo durante DIAS_CORREGIR
// días después de la entrega (los precios de los materiales se completan de a
// poco); después queda fijo.
import { claveNombre } from "./finanzasProveedores";
import { clienteDeOt, indiceClientes } from "./finanzasClientes";
import { textoOt } from "./nombreOt";

export const ORIGEN_CONSUMO = "consumo_ot";
export const ORIGEN_ESTIMADA = "entrega_estimada";
/** El tipo del libro para pasar de una cuenta a otra (Materias Primas → costo). */
export const TIPO_CONSUMO = "RECLASIF";
export const TIPO_ESTIMADA = "VENTA";
export const CUENTA_CMV = /^costo de (la )?mercader[ií]a vendida$/i;
export const CUENTA_MATERIAS_PRIMAS = /^materias primas$/i;
/** Días después de la entrega en que el importe todavía se corrige solo. */
export const DIAS_CORREGIR = 60;
const ANULO_GYPI = /^Gypi\b/;

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const dias = (a, b) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);

/** Las dos cuentas del consumo, o el error si falta alguna en el plan de cuentas. */
export function cuentasConsumo(cuentas = []) {
  const por = (re) => cuentas.find((c) => c.activa !== false && re.test(String(c.nombre || "").trim()))?.codigo || null;
  const r = { costo: por(CUENTA_CMV), materias: por(CUENTA_MATERIAS_PRIMAS) };
  const faltan = [!r.costo && "Costo De Mercaderia Vendida", !r.materias && "Materias Primas"].filter(Boolean);
  return faltan.length ? { ...r, error: `Para el consumo de materiales faltan en el plan de cuentas: ${faltan.join(", ")}` } : r;
}

/** Las operaciones vivas por clave origen|origen_id y las anuladas a mano. */
function indiceOps(operaciones) {
  const vivas = new Map();
  const aMano = new Set();
  for (const o of operaciones) {
    const k = `${o.origen}|${o.origen_id}`;
    if (!o.anulada_at) vivas.set(k, o);
    else if (!ANULO_GYPI.test(String(o.anulada_por_nombre || ""))) aMano.add(k);
  }
  return { vivas, aMano };
}

/** Las que todavía se corrigen solas (entregadas hace menos de DIAS_CORREGIR días). */
const seCorrige = (fecha, hoy) => !fecha || dias(hoy, fecha) <= DIAS_CORREGIR;

/**
 * De qué OT hay que calcular el costo de materiales: las entregadas que no
 * tienen consumo (y no se anuló a mano) y las que todavía se corrigen. Pura.
 * Las entregadas hace más de DIAS_CORREGIR días sin consumo quedan con el %
 * del estado de resultados (no se recalculan en cada sincronización).
 * @param {{ entregas: Map<string, string>, operaciones: object[], hoy: string, origen?: string }} d entregas: id de OT (p<id>) → fecha
 * @returns {Set<string>} ids p<id>
 */
export function otsParaCalcular({ entregas, operaciones = [], hoy, origen = ORIGEN_CONSUMO }) {
  const { vivas, aMano } = indiceOps(operaciones);
  const out = new Set();
  for (const [id, fecha] of entregas) {
    const k = `${origen}|${id}`;
    const viva = vivas.get(k);
    // Una entrega estimada que el Dueño ya confirmó no se toca más
    if (viva && origen === ORIGEN_ESTIMADA && viva.estado !== "para_revisar") continue;
    if (viva ? seCorrige(viva.fecha, hoy) : !aMano.has(k) && seCorrige(fecha, hoy)) out.add(id);
  }
  return out;
}

/**
 * Qué hacer con los asientos de consumo de materiales. Pura.
 * @param {object} d
 * @param {object[]} d.proyectos OT con id, ot, cliente, obra, descripcion, division
 * @param {Map<string, string>} d.entregas id de OT (p<id>) → fecha de entrega (las entregadas, con o sin precio)
 * @param {Map<string, number>} d.materiales id de OT (p<id>) → costo real de materiales (solo las calculadas)
 * @param {object[]} d.operaciones consumos (vivos y anulados) con id, origen_id, fecha, total, anulada_at, anulada_por_nombre
 * @param {{costo: string, materias: string}} d.cuentas
 * @param {(division: string) => string|null} [d.centro] el centro de costo de la división
 * @returns {{ crear: object[], corregir: {id: number, cambios: object}[], anular: {id: number, motivo: string}[] }}
 */
export function planConsumos({ proyectos = [], entregas = new Map(), materiales = new Map(), operaciones = [], cuentas, centro = () => null, hoy }) {
  const { vivas, aMano } = indiceOps(operaciones.map((o) => ({ origen: ORIGEN_CONSUMO, ...o })));
  const porId = new Map(proyectos.map((p) => [`p${p.id}`, p]));
  const crear = [];
  const corregir = [];
  const anular = [];
  // La OT ya no está entregada (se reabrió o se borró): el consumo se anula
  for (const [k, o] of vivas) {
    const id = k.slice(ORIGEN_CONSUMO.length + 1);
    if (!entregas.has(id)) anular.push({ id: o.id, motivo: "Gypi (la OT se volvió a abrir)" });
  }
  for (const [id, fecha] of entregas) {
    if (!materiales.has(id)) continue; // no se calculó: queda como está
    const p = porId.get(id);
    if (!p) continue;
    const k = `${ORIGEN_CONSUMO}|${id}`;
    const viva = vivas.get(k);
    const costo = centavos(materiales.get(id));
    if (viva) {
      if (!seCorrige(viva.fecha, hoy)) continue;
      if (!(costo > 0)) anular.push({ id: viva.id, motivo: "Gypi (la OT quedó sin materiales)" });
      else if (Math.abs(centavos(viva.total) - costo) >= 0.01) corregir.push({ id: viva.id, cambios: { neto: costo, total: costo, total_ars: costo } });
      continue;
    }
    if (!(costo > 0) || aMano.has(k)) continue;
    const ot = textoOt(p).slice(0, 400);
    crear.push({
      fecha, tipo: TIPO_CONSUMO, proveedor_id: null, cliente_id: null, entidad: null,
      proyecto_id: Number(p.id), centro_costo: centro(p.division) || null,
      neto: costo, iva: 0, otros_impuestos: 0, total: costo, total_ars: costo, moneda: "ARS", tipo_cambio: null,
      cuenta_debe: cuentas.costo, cuenta_haber: cuentas.materias,
      descripcion: `Consumo de materiales ${ot}`.slice(0, 500), referencia: `OT ${txt(p.ot, 100)}`,
      origen: ORIGEN_CONSUMO, origen_id: id, estado: "confirmada",
    });
  }
  return { crear, corregir, anular };
}

/**
 * Qué hacer con las entregas estimadas de las OT sin precio. Pura.
 * @param {object} d
 * @param {object[]} d.proyectos OT con id, ot, cliente, cliente_id, obra, descripcion, division
 * @param {Record<string, string>} d.fechas las OT terminadas sin precio: p<id> → fecha (planEntregasEstimadas)
 * @param {Map<string, number>} d.valores p<id> → valor estimado (solo las calculadas)
 * @param {object[]} d.operaciones entregas estimadas (vivas y anuladas)
 * @param {object[]} d.clientes fin_clientes
 * @param {{deudores: string, entregas: string}} d.cuentas
 * @returns {{ crear: object[], corregir: {id: number, cambios: object}[], anular: {id: number, motivo: string}[] }}
 *   crear lleva cliente_nombre cuando el cliente no está en la lista (se crea al guardar)
 */
export function planEstimadas({ proyectos = [], fechas = {}, valores = new Map(), operaciones = [], clientes = [], cuentas, centro = () => null, hoy }) {
  const { vivas, aMano } = indiceOps(operaciones.map((o) => ({ origen: ORIGEN_ESTIMADA, ...o })));
  const porId = new Map(proyectos.map((p) => [`p${p.id}`, p]));
  const indice = indiceClientes(clientes);
  const nombreDe = new Map(clientes.map((c) => [Number(c.id), c.nombre]));
  const crear = [];
  const corregir = [];
  const anular = [];
  for (const [k, o] of vivas) {
    const id = k.slice(ORIGEN_ESTIMADA.length + 1);
    if (!fechas[id]) anular.push({ id: o.id, motivo: "Gypi (la OT tiene precio o se volvió a abrir)" });
  }
  for (const [id, fecha] of Object.entries(fechas)) {
    if (!valores.has(id)) continue;
    const p = porId.get(id);
    if (!p) continue;
    const k = `${ORIGEN_ESTIMADA}|${id}`;
    const viva = vivas.get(k);
    const valor = centavos(valores.get(id));
    if (viva) {
      // Ya confirmada por el Dueño, queda como la confirmó
      if (viva.estado !== "para_revisar" || !seCorrige(viva.fecha, hoy)) continue;
      if (!(valor > 0)) anular.push({ id: viva.id, motivo: "Gypi (la OT quedó sin materiales con precio)" });
      else if (Math.abs(centavos(viva.total) - valor) >= 0.01) corregir.push({ id: viva.id, cambios: { neto: valor, total: valor, total_ars: valor } });
      continue;
    }
    if (!(valor > 0) || aMano.has(k)) continue;
    const delOt = clienteDeOt(p, clientes, indice);
    const nombreCliente = txt(p.cliente, 120);
    const ot = textoOt(p).slice(0, 400);
    crear.push({
      fecha, tipo: TIPO_ESTIMADA, proveedor_id: null,
      cliente_id: delOt || null, entidad: txt(delOt ? nombreDe.get(delOt) : nombreCliente, 120) || null,
      cliente_nombre: delOt ? null : nombreCliente || null,
      proyecto_id: Number(p.id), centro_costo: centro(p.division) || null,
      neto: valor, iva: 0, otros_impuestos: 0, total: valor, total_ars: valor, moneda: "ARS", tipo_cambio: null,
      cuenta_debe: cuentas.deudores, cuenta_haber: cuentas.entregas,
      descripcion: `Entrega estimada ${ot} (sin precio en el Plan: materiales ÷ 0,3)`.slice(0, 500), referencia: `OT ${txt(p.ot, 100)}`,
      origen: ORIGEN_ESTIMADA, origen_id: id, estado: "para_revisar",
    });
  }
  return { crear, corregir, anular };
}

/** Los nombres de clientes que hay que crear para las entregas estimadas. */
export const clientesNuevosDe = (crear = []) => [...new Map(crear.filter((o) => o.cliente_nombre).map((o) => [claveNombre(o.cliente_nombre), o.cliente_nombre])).values()];
