// app/lib/finanzasVentas.js — Finanzas, parte F4b: la venta y la entrega de
// cada OT salen solas del Plan de trabajo (sin migración; usa fin_clientes y
// fin_operaciones.cliente_id de la 177 y el PRECIO de precios_ot, 142).
//
// Lo que eligió Tadeo (09/11, "Venta a cobrar, entrega pasa a ingreso"):
//   - VENDIDA cuando la OT se carga en el Plan con su PRECIO (sin IVA):
//     Deudores por Ventas (el cliente nos debe) contra Ventas Generales.
//   - ENTREGADA cuando la OT se termina: Ventas Generales contra Entregas
//     Generales. Recién ahí es ingreso del mes; Ventas Generales queda como
//     "vendido sin entregar" y no se cuenta dos veces.
// Las dos van con el tipo VENTA del libro (sus cuentas por defecto son
// Deudores / Ventas Generales; la entrega cambia las dos cuentas, como hace
// el libro con cuenta_debe_override / cuenta_haber_override).
//
// Solo las OT cargadas desde la fecha que elige el dueño ("desde"): las de
// antes ya están en los saldos iniciales del libro. Si cambia el precio, se
// corrige el importe de la venta y de la entrega; si se borra el precio, se
// anulan; si la OT se reabre, se anula la entrega. Si el dueño anuló a mano
// una venta o una entrega, Gypi no la vuelve a crear.
//
// Corre al final de cada sincronización del Plan (syncOt) y con el botón
// "Revisar ahora" de Finanzas → Clientes. Escribe con la llave del servidor
// (quien sincroniza puede ser un operario) y nunca hace fallar la sync.
import { sbGet, sbGetAll, sbPatch, sbPost } from "./sbHelpers";
import { getModulosEmpresa } from "./planEnforcement";
import { logger } from "./logger";
import { textoOt } from "./nombreOt";
import { claveNombre } from "./finanzasProveedores";
import { cuentasDeudores, emparejarCliente } from "./finanzasClientes";
import { FECHA, hoyAr } from "./finanzasOperaciones";

export const CLAVE_VENTAS_OT = "finanzas_ventas_ot";
export const ORIGEN_VENTA = "venta_ot";
export const ORIGEN_ENTREGA = "entrega_ot";
export const TIPO_VENTA = "VENTA";
export const CUENTA_VENTAS = /^ventas generales$/i;
export const CUENTA_ENTREGAS = /^entregas generales$/i;
/** Quien anula sin ser una persona: "Gypi (…)". Esas sí se pueden volver a crear. */
const ANULO_GYPI = /^Gypi\b/;

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** La configuración guardada: { activo, desde }. Apagada si no hay fecha válida. */
export function leerConfigVentas(valor) {
  const desde = FECHA.test(String(valor?.desde || "")) ? String(valor.desde) : null;
  return { activo: Boolean(valor?.activo) && Boolean(desde), desde };
}

/** Los códigos de las tres cuentas, o el error para mostrar si falta alguna. */
export function cuentasVentas(cuentas = []) {
  const por = (re) => cuentas.find((c) => c.activa !== false && re.test(String(c.nombre || "").trim()))?.codigo || null;
  const r = { deudores: [...cuentasDeudores(cuentas)][0] || null, ventas: por(CUENTA_VENTAS), entregas: por(CUENTA_ENTREGAS) };
  const faltan = [!r.deudores && "Deudores por Ventas", !r.ventas && "Ventas Generales", !r.entregas && "Entregas Generales"].filter(Boolean);
  return faltan.length ? { ...r, error: `Faltan en el plan de cuentas: ${faltan.join(", ")}. Copiá el libro en Configuración.` } : r;
}

/** Fecha (Argentina) en que la OT entró a Gypi. */
export function fechaCarga(p) {
  const t = Date.parse(p?.created_at || "");
  return Number.isFinite(t) ? hoyAr(new Date(t)) : null;
}

/** El centro de costo de la división de la OT (MADERA, HIERRO…), o null. */
export function centroDeDivision(division, centros = []) {
  const k = claveNombre(division);
  if (!k) return null;
  const vivos = centros.filter((c) => c.activo !== false);
  return (vivos.find((c) => claveNombre(c.division) === k) || vivos.find((c) => claveNombre(c.codigo) === k))?.codigo || null;
}

/**
 * Qué hay que hacer con las ventas y entregas de las OT. Función pura.
 * @param {object} d
 * @param {object[]} d.proyectos OT con id, ot, cliente, obra, descripcion, division, estado, created_at
 * @param {Map<string, number>|object} d.precios precio sin IVA por código de OT
 * @param {object[]} d.operaciones ventas y entregas (vivas y anuladas) con id, origen, origen_id, total, anulada_at, anulada_por_nombre
 * @param {object[]} d.clientes fin_clientes
 * @param {{deudores: string, ventas: string, entregas: string}} d.cuentas
 * @param {object[]} [d.centros] fin_centros_costo
 * @param {{desde: string}} d.config
 * @param {string} d.hoy AAAA-MM-DD
 * @returns {{ crear: object[], corregir: {id: number, cambios: object}[], anular: {id: number, motivo: string}[], clientesNuevos: string[] }}
 */
export function planVentas({ proyectos = [], precios, operaciones = [], clientes = [], cuentas, centros = [], config, hoy }) {
  const precioDe = (ot) => {
    const v = precios instanceof Map ? precios.get(String(ot)) : precios?.[String(ot)];
    return centavos(v);
  };
  const vivas = new Map();
  const anuladasAMano = new Set();
  for (const o of operaciones) {
    const k = `${o.origen}|${o.origen_id}`;
    if (!o.anulada_at) vivas.set(k, o);
    else if (!ANULO_GYPI.test(String(o.anulada_por_nombre || ""))) anuladasAMano.add(k);
  }
  const crear = [];
  const corregir = [];
  const anular = [];

  for (const p of proyectos) {
    const id = `p${p.id}`;
    const kv = `${ORIGEN_VENTA}|${id}`;
    const ke = `${ORIGEN_ENTREGA}|${id}`;
    const venta = vivas.get(kv);
    const entrega = vivas.get(ke);
    const fecha = fechaCarga(p);
    const precio = precioDe(p.ot);
    const cerrada = p.estado === "cerrado";
    // Las de antes de "desde" no generan nada nuevo (ya están en el libro)
    const enRango = Boolean(fecha && config?.desde && fecha >= config.desde);

    if (!(precio > 0)) {
      // Sin precio: lo que Gypi había anotado se anula
      if (venta) anular.push({ id: venta.id, motivo: "Gypi (la OT quedó sin precio)" });
      if (entrega) anular.push({ id: entrega.id, motivo: "Gypi (la OT quedó sin precio)" });
      continue;
    }
    const importe = { neto: precio, iva: 0, otros_impuestos: 0, total: precio, total_ars: precio };
    const cambio = (o) => Math.abs(centavos(o.total) - precio) >= 0.01;
    if (venta && cambio(venta)) corregir.push({ id: venta.id, cambios: importe });
    if (entrega && cambio(entrega)) corregir.push({ id: entrega.id, cambios: importe });
    if (entrega && !cerrada) anular.push({ id: entrega.id, motivo: "Gypi (la OT se volvió a abrir)" });

    if (!enRango) continue;
    const nombreCliente = txt(p.cliente, 120);
    const cliente = emparejarCliente(nombreCliente, clientes);
    const comun = {
      fecha, tipo: TIPO_VENTA, proveedor_id: null,
      cliente_id: cliente ? Number(cliente.id) : null,
      // El nombre del cliente nuevo se completa al crearlo (ver sincronizarVentasOt)
      entidad: txt(cliente?.nombre || nombreCliente, 120) || null,
      cliente_nombre: cliente ? null : nombreCliente || null,
      proyecto_id: Number(p.id),
      centro_costo: centroDeDivision(p.division, centros),
      ...importe, moneda: "ARS", tipo_cambio: null,
    };
    const ot = textoOt(p).slice(0, 400);
    if (!venta && !anuladasAMano.has(kv)) {
      crear.push({
        ...comun, cuenta_debe: cuentas.deudores, cuenta_haber: cuentas.ventas,
        descripcion: `Venta ${ot}`.slice(0, 500), referencia: `OT ${txt(p.ot, 100)}`,
        origen: ORIGEN_VENTA, origen_id: id, estado: "confirmada",
      });
    }
    // La entrega solo si hay venta (viva o recién creada)
    const conVenta = Boolean(venta) || !anuladasAMano.has(kv);
    if (cerrada && conVenta && !entrega && !anuladasAMano.has(ke)) {
      crear.push({
        ...comun, fecha: hoy < fecha ? fecha : hoy, cuenta_debe: cuentas.ventas, cuenta_haber: cuentas.entregas,
        descripcion: `Entrega ${ot}`.slice(0, 500), referencia: `OT ${txt(p.ot, 100)}`,
        origen: ORIGEN_ENTREGA, origen_id: id, estado: "confirmada",
      });
    }
  }
  // Los clientes que no están en la lista se crean (uno por nombre)
  const nuevos = new Map(crear.filter((o) => o.cliente_nombre).map((o) => [claveNombre(o.cliente_nombre), o.cliente_nombre]));
  return { crear, corregir, anular, clientesNuevos: [...nuevos.values()].sort((a, b) => a.localeCompare(b)) };
}

const leer = (path, maxFilas = 20000) => sbGetAll(path, { maxFilas }).then((r) => r.data);

/** Lee la configuración de la empresa (con la llave del servidor). */
export async function configVentas(empresaId) {
  const [fila] = (await sbGet(`config_sistema?empresa_id=eq.${empresaId}&clave=eq.${CLAVE_VENTAS_OT}&select=valor&limit=1`, { silent: true, fallback: [] })) || [];
  return leerConfigVentas(fila?.valor);
}

/**
 * Anota las ventas y entregas que falten de las OT de la empresa.
 * @returns {Promise<{ accion: string, creadas?: number, corregidas?: number, anuladas?: number, clientes_nuevos?: number, error?: string }>}
 */
export async function sincronizarVentasOt(empresaId, { hoy = hoyAr() } = {}) {
  const e = empresaId;
  try {
    const { modulos } = await getModulosEmpresa(e);
    if (!modulos.includes("finanzas")) return { accion: "omitida" };
    const config = await configVentas(e);
    if (!config.activo) return { accion: "apagada" };

    const [cuentasPlan, centros, clientesAntes, proyectos, preciosFilas, operaciones] = await Promise.all([
      leer(`fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa&order=codigo.asc`),
      leer(`fin_centros_costo?empresa_id=eq.${e}&select=codigo,division,activo&order=codigo.asc`),
      leer(`fin_clientes?empresa_id=eq.${e}&select=id,nombre,alias,activo,unido_a&order=id.asc`),
      // Las de antes de "desde" igual se leen si tienen venta (para corregir o anular)
      leer(`proyectos?empresa_id=eq.${e}&select=id,ot,cliente,obra,descripcion,division,estado,created_at&order=id.asc`),
      leer(`precios_ot?empresa_id=eq.${e}&select=ot,precio&order=ot.asc`),
      leer(`fin_operaciones?empresa_id=eq.${e}&origen=in.(${ORIGEN_VENTA},${ORIGEN_ENTREGA})&select=id,origen,origen_id,total,anulada_at,anulada_por_nombre&order=id.asc`),
    ]);
    const cuentas = cuentasVentas(cuentasPlan);
    if (cuentas.error) return { accion: "omitida", error: cuentas.error };
    const precios = new Map(preciosFilas.map((f) => [String(f.ot), Number(f.precio) || 0]));
    const plan = planVentas({ proyectos, precios, operaciones, clientes: clientesAntes, cuentas, centros, config, hoy });

    const ahora = new Date().toISOString();
    // Clientes que todavía no estaban: se crean, y las operaciones quedan con su id
    const clientes = [...clientesAntes];
    for (const nombre of plan.clientesNuevos) {
      const [c] = (await sbPost("fin_clientes", { empresa_id: e, nombre, notas: "Creado por Gypi desde el Plan de trabajo", created_at: ahora, updated_at: ahora })) || [];
      if (c) clientes.push(c);
    }
    const filas = plan.crear.map(({ cliente_nombre, ...op }) => {
      const c = op.cliente_id ? null : emparejarCliente(cliente_nombre, clientes);
      return {
        ...op, ...(c ? { cliente_id: Number(c.id), entidad: txt(c.nombre, 120) } : {}),
        empresa_id: e, cargada_por_nombre: "Gypi (Plan de trabajo)", created_at: ahora, updated_at: ahora,
      };
    });
    for (let i = 0; i < filas.length; i += 500) await sbPost("fin_operaciones", filas.slice(i, i + 500));
    for (const { id, cambios } of plan.corregir) await sbPatch(`fin_operaciones?id=eq.${id}&empresa_id=eq.${e}&anulada_at=is.null`, { ...cambios, updated_at: ahora });
    for (const { id, motivo } of plan.anular) await sbPatch(`fin_operaciones?id=eq.${id}&empresa_id=eq.${e}&anulada_at=is.null`, { anulada_at: ahora, anulada_por_nombre: motivo, updated_at: ahora });
    return {
      accion: "hecha", creadas: filas.length, corregidas: plan.corregir.length, anuladas: plan.anular.length,
      clientes_nuevos: clientes.length - clientesAntes.length,
    };
  } catch (err) {
    // Sin las migraciones 171/177 o la base no respondió: la sync del Plan sigue igual
    logger.warn(`[finanzas] no se pudieron pasar las ventas de las OT de ${e}`, err);
    return { accion: "omitida", error: "No se pudieron revisar las ventas de las OT" };
  }
}
