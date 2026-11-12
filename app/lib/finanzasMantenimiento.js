// app/lib/finanzasMantenimiento.js — Mantenimiento a Finanzas solo (auditoría
// del 12/11, parte 9; Tadeo: "automático, para revisar"). Sin migración.
//
// Cuando se carga un service, una reparación o un arreglo de un vehículo con
// costo (Flota), o se arregla una falla de una máquina con costo (Maquinaria),
// Gypi crea el gasto en Finanzas sin que nadie toque nada: tipo de logística o
// de mantenimiento, el importe, la fecha, el detalle y el taller (proveedor si
// es de la lista). Queda "para revisar": el Dueño lo mira en Movimientos,
// confirma o cambia el tipo, o lo anula y lo carga a mano (con su factura).
//
// Usa la misma clave fija que el "Cargar" de un toque (finanzasIntegracion:
// g + a|b + id), así un arreglo nunca entra dos veces. Si se borra el service
// en Flota, el gasto que creó Gypi se anula solo (el que cargó una persona, o
// uno ya pagado, no se toca).
//
// Escribe con la llave del servidor (quien carga el arreglo no ve Finanzas) y
// nunca hace fallar el guardado del arreglo: si algo sale mal, lo anota en el
// log y sigue.
import { sbGet, sbPatch, sbPost } from "./sbHelpers";
import { getModulosEmpresa } from "./planEnforcement";
import { logger } from "./logger";
import { CARGADA_POR, CLAVE_QUITADOS, costosMantenimiento, esDeMantenimiento, gastoDeCosto, grupoDeVinculo, leerQuitados } from "./finanzasIntegracion";
import { ORIGEN_GASTO, cuentasDeuda } from "./finanzasGastos";

export { CARGADA_POR, esDeMantenimiento };

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * El gasto "para revisar" de un costo de mantenimiento (de costosMantenimiento).
 * @param {object} item un pendiente de costosMantenimiento
 * @param {{ tipos: object[], cuentas: object[], proveedores: object[], proveedorId?: number|null }} ctx
 * @returns {{ op: object|null, motivo?: string }}
 */
export function gastoParaRevisar(item, { tipos = [], cuentas = [], proveedores = [], proveedorId = null } = {}) {
  if (!item || !(Number(item.costo) > 0)) return { op: null, motivo: "sin costo" };
  const grupo = grupoDeVinculo({ modulo: item.modulo, id: Number(String(item.vinculo).slice(2)) });
  if (!grupo) return { op: null, motivo: "sin clave" };
  const base = gastoDeCosto(item, { tipos, proveedores });
  const tipo = tipos.find((t) => t.codigo === base.tipo);
  if (!tipo || !base.cuenta_gasto) return { op: null, motivo: "sin tipo de gasto con cuenta" };
  // El proveedor guardado en el arreglo (183) manda sobre el nombre del taller
  const prov = proveedores.find((p) => Number(p.id) === Number(proveedorId) && p.activo !== false) || proveedores.find((p) => String(p.id) === base.proveedor_id) || null;
  const vivas = cuentas.filter((c) => c.activa !== false);
  const deudas = cuentasDeuda(vivas);
  const cuentaProv = vivas.find((c) => /^proveedores$/i.test(String(c.nombre || "").trim()))?.codigo || null;
  const cuentaHaber = prov && cuentaProv
    ? cuentaProv
    : (deudas.find((c) => c.codigo === tipo.cuenta_haber) || deudas.find((c) => /acreedores/i.test(String(c.nombre || ""))) || deudas.find((c) => c.codigo === cuentaProv) || deudas[0])?.codigo || null;
  if (!cuentaHaber) return { op: null, motivo: "sin cuenta de deuda" };
  const costo = centavos(item.costo);
  return {
    op: {
      fecha: item.fecha, tipo: tipo.codigo,
      proveedor_id: prov && cuentaHaber === cuentaProv ? Number(prov.id) : null,
      entidad: prov && cuentaHaber === cuentaProv ? null : txt(prov?.nombre || item.taller, 120) || null,
      proyecto_id: null, centro_costo: null,
      neto: costo, iva: 0, otros_impuestos: 0, total: costo, total_ars: costo, moneda: "ARS", tipo_cambio: null,
      cuenta_debe: base.cuenta_gasto, cuenta_haber: cuentaHaber,
      descripcion: txt(`${item.titulo.replace(/^\S+\s/, "")}${item.detalle ? ` · ${item.detalle}` : ""}`, 500),
      referencia: null, origen: ORIGEN_GASTO, origen_id: grupo, estado: "para_revisar",
    },
  };
}

/**
 * Pasa a Finanzas el costo de un mantenimiento de vehículo o de una falla de máquina.
 * @param {string} empresaId
 * @param {{ modulo: "vehiculo"|"maquina", id: number }} vinculo
 * @returns {Promise<{ accion: "creada"|"nada"|"omitida", motivo?: string }>}
 */
export async function pasarMantenimientoAFinanzas(empresaId, { modulo, id }) {
  const e = empresaId;
  try {
    const { modulos } = await getModulosEmpresa(e);
    if (!modulos.includes("finanzas")) return { accion: "omitida", motivo: "sin Finanzas" };
    const grupo = grupoDeVinculo({ modulo, id });
    if (!grupo) return { accion: "nada" };
    const [ya] = (await sbGet(`fin_operaciones?empresa_id=eq.${e}&origen=eq.${ORIGEN_GASTO}&origen_id=eq.${grupo}&anulada_at=is.null&select=id&limit=1`)) || [];
    if (ya) return { accion: "nada", motivo: "ya está" };

    let item = null;
    let proveedorId = null;
    if (modulo === "vehiculo") {
      const [m] = (await sbGet(`vehiculo_mantenimientos?id=eq.${Number(id)}&empresa_id=eq.${e}&select=*&limit=1`)) || [];
      if (!m) return { accion: "nada" };
      const veh = (await sbGet(`vehiculos?id=eq.${m.vehiculo_id}&empresa_id=eq.${e}&select=id,marca,modelo,patente&limit=1`)) || [];
      item = costosMantenimiento({ mantenimientos: [m], vehiculos: veh }).pendientes[0] || null;
      proveedorId = m.proveedor_id || null;
    } else {
      const [f] = (await sbGet(`maquina_fallas?id=eq.${Number(id)}&empresa_id=eq.${e}&select=*&limit=1`)) || [];
      if (!f) return { accion: "nada" };
      const maq = (await sbGet(`maquinas?id=eq.${f.maquina_id}&empresa_id=eq.${e}&select=id,codigo,nombre&limit=1`)) || [];
      item = costosMantenimiento({ fallas: [f], maquinas: maq }).pendientes[0] || null;
      proveedorId = f.proveedor_id || null;
    }
    if (!item) return { accion: "nada", motivo: "sin costo" };

    const [tipos, cuentas, proveedores, cfg] = await Promise.all([
      sbGet(`fin_tipos_operacion?empresa_id=eq.${e}&select=codigo,nombre,grupo,cuenta_debe,cuenta_haber,activo`),
      sbGet(`fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa`),
      sbGet(`proveedores?empresa_id=eq.${e}&select=id,nombre,activo`),
      sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_QUITADOS}&select=valor&limit=1`, { silent: true, fallback: [] }),
    ]);
    // El Dueño ya lo había marcado "Ya está cargado": no se repite
    if (leerQuitados(cfg?.[0]?.valor)[item.vinculo]) return { accion: "nada", motivo: "quitado" };
    const { op, motivo } = gastoParaRevisar(item, { tipos: tipos || [], cuentas: cuentas || [], proveedores: proveedores || [], proveedorId });
    if (!op) {
      logger.warn(`[finanzas] no se pasó el costo de ${item.vinculo}: ${motivo}`);
      return { accion: "omitida", motivo };
    }
    const ahora = new Date().toISOString();
    await sbPost("fin_operaciones", { ...op, empresa_id: e, cargada_por_nombre: CARGADA_POR, created_at: ahora, updated_at: ahora });
    return { accion: "creada" };
  } catch (err) {
    // Sin Finanzas (migración 171 sin correr) o la base no respondió: el arreglo igual se guardó
    logger.warn(`[finanzas] no se pudo pasar el costo de ${modulo} ${id}`, err);
    return { accion: "omitida", motivo: "error" };
  }
}

/**
 * Se borró el service o el arreglo: el gasto que creó Gypi se anula (si nadie lo pagó).
 * @returns {Promise<{ accion: "anulada"|"nada"|"omitida" }>}
 */
export async function anularMantenimientoEnFinanzas(empresaId, { modulo, id }) {
  const e = empresaId;
  try {
    const grupo = grupoDeVinculo({ modulo, id });
    if (!grupo) return { accion: "nada" };
    const ops = (await sbGet(`fin_operaciones?empresa_id=eq.${e}&origen=eq.${ORIGEN_GASTO}&origen_id=in.(${grupo},${grupo}-p)&anulada_at=is.null&select=id,origen,origen_id,cargada_por_nombre`, { silent: true, fallback: [] })) || [];
    const suya = ops.find((o) => o.origen_id === grupo && esDeMantenimiento(o));
    if (!suya || ops.some((o) => o.origen_id === `${grupo}-p`)) return { accion: "nada" };
    const ahora = new Date().toISOString();
    await sbPatch(`fin_operaciones?id=eq.${suya.id}&empresa_id=eq.${e}&anulada_at=is.null`, { anulada_at: ahora, anulada_por_nombre: "Gypi (se borró en Mantenimiento)", updated_at: ahora });
    return { accion: "anulada" };
  } catch (err) {
    logger.warn(`[finanzas] no se pudo anular el costo de ${modulo} ${id}`, err);
    return { accion: "omitida" };
  }
}
