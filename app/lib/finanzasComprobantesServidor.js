// app/lib/finanzasComprobantesServidor.js — buscar en la base si un
// comprobante ya está cargado (reglas en finanzasComprobantes.js).
import { sbGet } from "./sbHelpers";
import { claveComprobante, comprobanteRepetido, movimientoParecido } from "./finanzasComprobantes";

const COLUMNAS = "id,fecha,origen,referencia,proveedor_id,entidad,total,cuenta_debe,cuenta_haber,descripcion,anulada_at";

/**
 * La operación viva con el mismo número del mismo proveedor, venga de donde venga, o null.
 * @param {string} empresaId
 * @param {{ referencia, proveedor_id?, entidad? }} nuevo
 * @param {{ sesion?: object }} [opts] sin sesion lee con la clave de servicio (Mi caja: el empleado no ve Finanzas)
 */
export async function buscarComprobanteRepetido(empresaId, nuevo, { sesion } = {}) {
  const clave = claveComprobante(nuevo?.referencia);
  if (!clave || !empresaId) return null;
  const o = sesion ? { sesion, silent: true, fallback: [] } : { silent: true, fallback: [] };
  const ops = (await sbGet(`fin_operaciones?empresa_id=eq.${empresaId}&anulada_at=is.null&referencia=ilike.*${clave.numero}*&select=${COLUMNAS}&order=fecha.desc&limit=200`, o)) || [];
  if (!ops.length) return null;
  const ids = [...new Set([...ops.map((x) => x.proveedor_id), nuevo.proveedor_id].filter(Boolean).map(Number))];
  const proveedores = ids.length ? (await sbGet(`proveedores?empresa_id=eq.${empresaId}&id=in.(${ids.join(",")})&select=id,nombre`, o)) || [] : [];
  return comprobanteRepetido(nuevo, ops, proveedores);
}

/** Otro movimiento de la misma caja, mismo importe y fecha cerca, o null. */
export async function buscarMovimientoParecido(empresaId, nuevo, caja) {
  if (!empresaId || !caja || !/^\d{4}-\d{2}-\d{2}$/.test(String(nuevo?.fecha || ""))) return null;
  const d = new Date(`${nuevo.fecha}T12:00:00Z`);
  const desde = new Date(d.getTime() - 4 * 86400000).toISOString().slice(0, 10);
  const hasta = new Date(d.getTime() + 4 * 86400000).toISOString().slice(0, 10);
  const lado = nuevo.cuenta_haber === caja ? "cuenta_haber" : "cuenta_debe";
  const ops = (await sbGet(`fin_operaciones?empresa_id=eq.${empresaId}&anulada_at=is.null&${lado}=eq.${encodeURIComponent(caja)}&total=eq.${Number(nuevo.total)}&fecha=gte.${desde}&fecha=lte.${hasta}&select=${COLUMNAS}&limit=20`, { silent: true, fallback: [] })) || [];
  return movimientoParecido(nuevo, ops, caja);
}
