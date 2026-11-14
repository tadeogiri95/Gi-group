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
import { ORIGEN_COBRO, clienteDeOt, cuentasDeudores, emparejarCliente, indiceClientes } from "./finanzasClientes";
import { FECHA, hoyAr } from "./finanzasOperaciones";
import {
  ORIGEN_CONSUMO, ORIGEN_ESTIMADA, clientesNuevosDe, cuentasConsumo, otsParaCalcular, planConsumos, planEstimadas,
} from "./finanzasConsumoOt";
import { materialesRealesDeOts } from "./costoRealServidor";
import { materialesDeOts } from "./finanzasMaterialesOt";
import { valorOt } from "./finanzasOtClientes";

export const CLAVE_VENTAS_OT = "finanzas_ventas_ot";
/**
 * Las OT terminadas SIN precio en el Plan no tienen entrega (no hay importe).
 * Para que el estado de resultados las muestre con un valor estimado (13/11)
 * se guarda el día en que Gypi las vio terminadas, igual que la fecha de una
 * entrega con precio: config_sistema { fechas: { p<id>: "AAAA-MM-DD" } }.
 */
export const CLAVE_ENTREGAS_ESTIMADAS = "finanzas_entregas_estimadas";
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
  const indice = indiceClientes(clientes);
  const nombreDe = new Map(clientes.map((c) => [Number(c.id), c.nombre]));

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
    // Manda el cliente de la OT (parte 6): si en la OT cambió, la venta y la entrega lo siguen
    const delOt = clienteDeOt(p, clientes, indice);
    const otroCliente = (o) => delOt && o.cliente_id !== undefined && indice.destino(o.cliente_id) !== delOt;
    const deCliente = delOt ? { cliente_id: delOt, entidad: txt(nombreDe.get(delOt), 120) || null } : {};
    for (const o of [venta, entrega]) {
      if (!o) continue;
      const c = { ...(cambio(o) ? importe : {}), ...(otroCliente(o) ? deCliente : {}) };
      if (Object.keys(c).length) corregir.push({ id: o.id, cambios: c });
    }
    if (entrega && !cerrada) anular.push({ id: entrega.id, motivo: "Gypi (la OT se volvió a abrir)" });

    if (!enRango) continue;
    const nombreCliente = txt(p.cliente, 120);
    const cliente = delOt ? { id: delOt, nombre: nombreDe.get(delOt) } : null;
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

/**
 * El día en que cada OT terminada sin precio quedó "entregada" (13/11). Pura.
 * Mismas reglas que la entrega con precio: OT cargada desde "desde", cerrada
 * y la fecha es la primera pasada que la ve así (nunca antes de su carga). Si
 * la OT se reabre o le ponen precio (ahí va la entrega de verdad), sale.
 * @returns {{ fechas: Record<string, string>, cambio: boolean }}
 */
export function planEntregasEstimadas({ proyectos = [], precios, config, fechas = {}, hoy }) {
  const precioDe = (ot) => Number(precios instanceof Map ? precios.get(String(ot)) : precios?.[String(ot)]) || 0;
  const antes = fechas && typeof fechas === "object" ? fechas : {};
  const nuevas = {};
  for (const p of proyectos) {
    const fecha = fechaCarga(p);
    if (p.estado !== "cerrado" || precioDe(p.ot) > 0) continue;
    if (!(fecha && config?.desde && fecha >= config.desde)) continue;
    const id = `p${p.id}`;
    nuevas[id] = FECHA.test(String(antes[id] || "")) ? antes[id] : hoy < fecha ? fecha : hoy;
  }
  const claves = (o) => Object.keys(o).sort().map((k) => `${k}=${o[k]}`).join(",");
  return { fechas: nuevas, cambio: claves(nuevas) !== claves(antes) };
}

/** Guarda las fechas de las entregas sin precio, si cambiaron. Devuelve las fechas (p<id> → fecha). */
async function guardarEntregasEstimadas(e, proyectos, precios, config, hoy) {
  const [fila] = (await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_ENTREGAS_ESTIMADAS}&select=valor&limit=1`, { silent: true, fallback: [] })) || [];
  const plan = planEntregasEstimadas({ proyectos, precios, config, fechas: fila?.valor?.fechas, hoy });
  if (!plan.cambio) return plan.fechas;
  const valor = { fechas: plan.fechas };
  if (fila) await sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_ENTREGAS_ESTIMADAS}`, { valor });
  else await sbPost("config_sistema", { empresa_id: e, clave: CLAVE_ENTREGAS_ESTIMADAS, valor });
  return plan.fechas;
}

/**
 * Las OT entregadas y su fecha (las con precio: la fecha de su entrega; las
 * sin precio: la de su entrega estimada). Pura.
 * @param {object[]} operaciones ventas y entregas leídas antes de este paso (con fecha)
 * @param {{ crear: object[], anular: {id: number}[] }} plan el de planVentas
 * @param {Record<string, string>} fechasEstimadas
 * @returns {Map<string, string>} p<id> → fecha
 */
export function entregasDeOts(operaciones = [], plan = { crear: [], anular: [] }, fechasEstimadas = {}) {
  const anuladas = new Set(plan.anular.map((a) => a.id));
  const out = new Map();
  for (const o of operaciones) {
    if (o.origen === ORIGEN_ENTREGA && !o.anulada_at && !anuladas.has(o.id) && o.fecha) out.set(String(o.origen_id), String(o.fecha));
  }
  for (const o of plan.crear) if (o.origen === ORIGEN_ENTREGA) out.set(String(o.origen_id), o.fecha);
  for (const [id, f] of Object.entries(fechasEstimadas || {})) if (!out.has(id) && f) out.set(id, f);
  return out;
}

/**
 * Etapa 5 (14/11): el consumo de materiales de cada OT entregada y las
 * entregas estimadas de las OT sin precio, en el libro (finanzasConsumoOt.js).
 * Si algo falla, las ventas y las entregas quedan igual.
 */
async function sincronizarConsumosOt(e, { proyectos, entregas, fechasEstimadas, cuentasPlan, centros, clientes, cuentasVenta, hoy, ahora }) {
  const consumo = cuentasConsumo(cuentasPlan);
  const operaciones = await leer(`fin_operaciones?empresa_id=eq.${e}&origen=in.(${ORIGEN_CONSUMO},${ORIGEN_ESTIMADA})&select=id,origen,origen_id,fecha,total,estado,anulada_at,anulada_por_nombre&order=id.asc`);
  const deOrigen = (o) => operaciones.filter((x) => x.origen === o);
  const aCalcular = consumo.error ? new Set() : otsParaCalcular({ entregas, operaciones: deOrigen(ORIGEN_CONSUMO), hoy });
  const estimadasMap = new Map(Object.entries(fechasEstimadas || {}));
  const aEstimar = otsParaCalcular({ entregas: estimadasMap, operaciones: deOrigen(ORIGEN_ESTIMADA), hoy, origen: ORIGEN_ESTIMADA });
  const ids = [...new Set([...aCalcular, ...aEstimar])].map((id) => Number(id.slice(1))).filter((n) => n > 0);
  const completos = [];
  for (let i = 0; i < ids.length; i += 150) completos.push(...await leer(`proyectos?empresa_id=eq.${e}&id=in.(${ids.slice(i, i + 150).join(",")})&select=*`, 1000));
  const porId = new Map(completos.map((p) => [`p${p.id}`, p]));
  const de = (set) => [...set].map((id) => porId.get(id)).filter(Boolean);
  const reales = aCalcular.size ? await materialesRealesDeOts(e, de(aCalcular)) : new Map();
  const materiales = new Map(de(aCalcular).map((p) => [`p${p.id}`, Number(reales.get(String(p.ot))) || 0]));
  const necesidades = aEstimar.size ? await materialesDeOts(null, de(aEstimar), e) : new Map();
  const valores = new Map(de(aEstimar).map((p) => [`p${p.id}`, valorOt(0, necesidades.get(String(p.ot))).valor]));
  const centro = (division) => centroDeDivision(division, centros);

  const pc = consumo.error ? { crear: [], corregir: [], anular: [] }
    : planConsumos({ proyectos, entregas, materiales, operaciones: deOrigen(ORIGEN_CONSUMO), cuentas: consumo, centro, hoy });
  const pe = planEstimadas({ proyectos, fechas: fechasEstimadas || {}, valores, operaciones: deOrigen(ORIGEN_ESTIMADA), clientes, cuentas: cuentasVenta, centro, hoy });
  for (const nombre of clientesNuevosDe(pe.crear)) {
    if (emparejarCliente(nombre, clientes)) continue;
    const [c] = (await sbPost("fin_clientes", { empresa_id: e, nombre, notas: "Creado por Gypi desde el Plan de trabajo", created_at: ahora, updated_at: ahora })) || [];
    if (c) clientes.push(c);
  }
  const filas = [...pc.crear, ...pe.crear].map(({ cliente_nombre, ...op }) => {
    const c = op.cliente_id || !cliente_nombre ? null : emparejarCliente(cliente_nombre, clientes);
    return {
      ...op, ...(c ? { cliente_id: Number(c.id), entidad: txt(c.nombre, 120) } : {}),
      empresa_id: e, cargada_por_nombre: "Gypi (entrega de la OT)", created_at: ahora, updated_at: ahora,
    };
  });
  for (let i = 0; i < filas.length; i += 500) await sbPost("fin_operaciones", filas.slice(i, i + 500));
  for (const { id, cambios } of [...pc.corregir, ...pe.corregir]) await sbPatch(`fin_operaciones?id=eq.${id}&empresa_id=eq.${e}&anulada_at=is.null`, { ...cambios, updated_at: ahora });
  for (const { id, motivo } of [...pc.anular, ...pe.anular]) await sbPatch(`fin_operaciones?id=eq.${id}&empresa_id=eq.${e}&anulada_at=is.null`, { anulada_at: ahora, anulada_por_nombre: motivo, updated_at: ahora });
  return {
    consumos: { creados: pc.crear.length, corregidos: pc.corregir.length, anulados: pc.anular.length, ...(consumo.error ? { error: consumo.error } : {}) },
    estimadas: { creadas: pe.crear.length, corregidas: pe.corregir.length, anuladas: pe.anular.length },
  };
}

/**
 * Qué OT quedan unidas a qué cliente (proyectos.cliente_id, 184) y qué cobros
 * de una OT se pasan al cliente de la OT (parte 6: manda el de la OT). Pura.
 * @param {object[]} proyectos con id, ot, cliente, cliente_id
 * @param {object[]} clientes fin_clientes
 * @param {object[]} [cobros] operaciones de cobro con id, proyecto_id, cliente_id
 * @returns {{ ligar: Map<number|null, number[]>, cobros: {id: number, cambios: object}[] }}
 *   ligar: cliente_id → ids de OT a unir (null = soltar)
 */
export function planClientesOt(proyectos = [], clientes = [], cobros = []) {
  const indice = indiceClientes(clientes);
  const nombreDe = new Map(clientes.map((c) => [Number(c.id), c.nombre]));
  const ligar = new Map();
  const delOt = new Map();
  for (const p of proyectos) {
    const id = clienteDeOt(p, clientes, indice);
    delOt.set(Number(p.id), id);
    if (p.cliente_id === undefined) continue; // sin la 184
    const ahora = p.cliente_id == null ? null : Number(p.cliente_id);
    // Una OT sin nombre de cliente que ya tenía uno queda como estaba
    if (id === ahora || (id == null && !String(p.cliente || "").trim())) continue;
    if (id == null && ahora != null && clientes.some((c) => Number(c.id) === ahora)) continue;
    if (!ligar.has(id)) ligar.set(id, []);
    ligar.get(id).push(Number(p.id));
  }
  const cambiosCobros = [];
  for (const op of cobros) {
    const id = delOt.get(Number(op.proyecto_id));
    if (!id || !op.cliente_id || indice.destino(op.cliente_id) === id) continue;
    cambiosCobros.push({ id: op.id, cambios: { cliente_id: id, entidad: txt(nombreDe.get(id), 120) || null } });
  }
  return { ligar, cobros: cambiosCobros };
}

/**
 * Une cada OT a su cliente y pasa al cliente de la OT los cobros que se
 * cargaron con la OT a nombre de otro. Sin la 184 solo hace lo segundo.
 */
async function ligarClientesOt(e, clientes) {
  const base = `proyectos?empresa_id=eq.${e}&order=id.asc&select=id,ot,cliente`;
  const proyectos = await leer(`${base},cliente_id`).catch(() => leer(base));
  const cobros = await leer(`fin_operaciones?empresa_id=eq.${e}&origen=eq.${ORIGEN_COBRO}&anulada_at=is.null&proyecto_id=not.is.null&select=id,proyecto_id,cliente_id&order=id.asc`).catch(() => []);
  const plan = planClientesOt(proyectos, clientes, cobros);
  const ahora = new Date().toISOString();
  let ligadas = 0;
  for (const [clienteId, ids] of plan.ligar) {
    for (let i = 0; i < ids.length; i += 200) {
      await sbPatch(`proyectos?empresa_id=eq.${e}&id=in.(${ids.slice(i, i + 200).join(",")})`, { cliente_id: clienteId }, { silent: true });
    }
    ligadas += ids.length;
  }
  for (const { id, cambios } of plan.cobros) await sbPatch(`fin_operaciones?id=eq.${id}&empresa_id=eq.${e}&anulada_at=is.null`, { ...cambios, updated_at: ahora });
  return { ligadas, cobros_pasados: plan.cobros.length };
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
    if (!config.activo) {
      // Aunque no se anoten las ventas, cada OT queda unida a su cliente (184)
      const clientes = await leer(`fin_clientes?empresa_id=eq.${e}&select=id,nombre,alias,activo,unido_a&order=id.asc`).catch(() => null);
      if (clientes) await ligarClientesOt(e, clientes).catch((err) => logger.warn(`[finanzas] no se pudieron unir las OT a sus clientes en ${e}`, err));
      return { accion: "apagada" };
    }

    const [cuentasPlan, centros, clientesAntes, proyectos, preciosFilas, operaciones] = await Promise.all([
      leer(`fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,activa&order=codigo.asc`),
      leer(`fin_centros_costo?empresa_id=eq.${e}&select=codigo,division,activo&order=codigo.asc`),
      leer(`fin_clientes?empresa_id=eq.${e}&select=id,nombre,alias,activo,unido_a&order=id.asc`),
      // Las de antes de "desde" igual se leen si tienen venta (para corregir o anular)
      leer(`proyectos?empresa_id=eq.${e}&select=id,ot,cliente,cliente_id,obra,descripcion,division,estado,created_at&order=id.asc`)
        .catch(() => leer(`proyectos?empresa_id=eq.${e}&select=id,ot,cliente,obra,descripcion,division,estado,created_at&order=id.asc`)),
      leer(`precios_ot?empresa_id=eq.${e}&select=ot,precio&order=ot.asc`),
      leer(`fin_operaciones?empresa_id=eq.${e}&origen=in.(${ORIGEN_VENTA},${ORIGEN_ENTREGA})&select=id,origen,origen_id,fecha,total,cliente_id,anulada_at,anulada_por_nombre&order=id.asc`),
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
    // Las OT terminadas sin precio: el día de su entrega estimada (13/11)
    const fechasEstimadas = await guardarEntregasEstimadas(e, proyectos, precios, config, hoy).catch((err) => {
      logger.warn(`[finanzas] no se pudieron anotar las entregas sin precio de ${e}`, err);
      return null;
    });
    const estimadas = Object.keys(fechasEstimadas || {}).length;
    // Etapa 5: consumo de materiales de las entregadas y entregas estimadas para revisar
    const consumos = await sincronizarConsumosOt(e, {
      proyectos, entregas: entregasDeOts(operaciones, plan, fechasEstimadas || {}), fechasEstimadas: fechasEstimadas || {},
      cuentasPlan, centros, clientes, cuentasVenta: cuentas, hoy, ahora,
    }).catch((err) => {
      logger.warn(`[finanzas] no se pudo anotar el consumo de materiales de las OT de ${e}`, err);
      return { error: "No se pudo anotar el consumo de materiales" };
    });
    // Cada OT unida a su cliente y sus cobros a ese cliente (parte 6; 184)
    const ligado = await ligarClientesOt(e, clientes).catch((err) => {
      logger.warn(`[finanzas] no se pudieron unir las OT a sus clientes en ${e}`, err);
      return { ligadas: 0, cobros_pasados: 0 };
    });
    return {
      accion: "hecha", creadas: filas.length, corregidas: plan.corregir.length, anuladas: plan.anular.length,
      clientes_nuevos: clientes.length - clientesAntes.length, entregas_sin_precio: estimadas, ...ligado, ...consumos,
    };
  } catch (err) {
    // Sin las migraciones 171/177 o la base no respondió: la sync del Plan sigue igual
    logger.warn(`[finanzas] no se pudieron pasar las ventas de las OT de ${e}`, err);
    return { accion: "omitida", error: "No se pudieron revisar las ventas de las OT" };
  }
}
