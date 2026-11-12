// app/lib/facturaUnicaServidor.js — Busca en la base si una factura de
// proveedor ya está cargada (reglas en facturaUnica.js). Lee con la clave
// del servidor y siempre filtrando por la empresa: quien compra no ve
// Finanzas, pero el aviso tiene que encontrar lo que se cargó ahí.
import { sbGet } from "./sbHelpers";
import { claveComprobante } from "./finanzasComprobantes";
import { TIPO_DE_ORIGEN, facturaRepetida } from "./facturaUnica";

const LIMITE = 200;
const leer = (path) => sbGet(path, { silent: true, fallback: [] }).then((r) => r || []).catch(() => []);

/**
 * La factura ya cargada con ese número y ese proveedor, o null.
 * @param {string} empresaId
 * @param {{ numero, proveedor_id?, proveedor_nombre? }} nueva
 * @param {{ oc?: number, oc_otra?: number, suelta?: number }} [excluir] la misma factura que se está corrigiendo
 */
export async function buscarFacturaRepetida(empresaId, nueva, excluir = {}) {
  const clave = claveComprobante(nueva?.numero);
  if (!clave || !empresaId) return null;
  const e = empresaId;
  const n = clave.numero;
  const [ocs, otras, sueltas, ops] = await Promise.all([
    leer(`ordenes_compra?empresa_id=eq.${e}&estado=neq.anulada&factura_numero=ilike.*${n}*&select=id,numero,proveedor_id,proveedor_nombre,factura_numero,factura_fecha&limit=${LIMITE}`),
    leer(`ordenes_compra_facturas?empresa_id=eq.${e}&anulada_at=is.null&numero=ilike.*${n}*&select=id,orden_id,proveedor_id,proveedor_nombre,numero,fecha&limit=${LIMITE}`),
    leer(`facturas_sueltas?empresa_id=eq.${e}&anulada_at=is.null&numero=ilike.*${n}*&select=id,tipo,numero,fecha,proveedor,proveedor_id&limit=${LIMITE}`),
    // Lo cargado en Finanzas a mano (Mi caja, gasto, S.O.S, compra): lo que vino de Compras ya está arriba
    leer(`fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&referencia=ilike.*${n}*&origen=in.(${Object.keys(TIPO_DE_ORIGEN).join(",")})&select=id,fecha,origen,referencia,proveedor_id,entidad&limit=${LIMITE}`),
  ]);

  // Número de OC de las "otras facturas"
  const faltan = [...new Set(otras.map((f) => f.orden_id).filter(Boolean))];
  const numerosOc = new Map(ocs.map((o) => [o.id, o.numero]));
  if (faltan.some((id) => !numerosOc.has(id))) {
    for (const o of await leer(`ordenes_compra?empresa_id=eq.${e}&id=in.(${faltan.join(",")})&select=id,numero`)) numerosOc.set(o.id, o.numero);
  }
  // Nombre del proveedor de lo cargado en Finanzas con proveedor de la lista
  const idsProv = [...new Set(ops.map((o) => o.proveedor_id).filter(Boolean))];
  const nombres = new Map(idsProv.length ? (await leer(`proveedores?empresa_id=eq.${e}&id=in.(${idsProv.join(",")})&select=id,nombre`)).map((p) => [Number(p.id), p.nombre]) : []);

  const cargadas = [
    ...ocs.filter((o) => o.id !== excluir.oc).map((o) => ({ tipo: "oc", numero: o.factura_numero, fecha: o.factura_fecha, proveedor_id: o.proveedor_id, proveedor_nombre: o.proveedor_nombre, oc_numero: o.numero })),
    ...otras.filter((f) => f.id !== excluir.oc_otra).map((f) => ({ tipo: "oc_otra", numero: f.numero, fecha: f.fecha, proveedor_id: f.proveedor_id, proveedor_nombre: f.proveedor_nombre, oc_numero: numerosOc.get(f.orden_id) ?? "?" })),
    ...sueltas.filter((s) => s.id !== excluir.suelta && (!s.tipo || s.tipo === "factura")).map((s) => ({ tipo: "suelta", numero: s.numero, fecha: s.fecha, proveedor_id: s.proveedor_id, proveedor_nombre: s.proveedor })),
    ...ops.map((o) => ({ tipo: TIPO_DE_ORIGEN[o.origen], numero: o.referencia, fecha: o.fecha, proveedor_id: o.proveedor_id, proveedor_nombre: o.proveedor_id ? nombres.get(Number(o.proveedor_id)) || o.entidad : o.entidad })),
  ];
  return facturaRepetida(nueva, cargadas);
}
