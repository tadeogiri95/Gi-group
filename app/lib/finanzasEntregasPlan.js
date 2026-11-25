// app/lib/finanzasEntregasPlan.js — las entregas del Estado de Resultados
// salen solo del Nuevo Plan de Trabajo (24-25/11, pedidos de Tadeo).
//
// Gypi anota la entrega de una OT con precio (finanzasVentas.js) solo si la
// OT entró a Gypi desde la fecha de inicio de "Ventas de las OT"; casi todas
// entraron en octubre, cuando se conectó la planilla. Las OT terminadas con
// PRECIO que Gypi no anotó suman su PRECIO en el mes de su ENTREGA del Plan
// (si ENTREGA no es una fecha, el último día de su SEMANA).
//
// 25/11: las entregas cargadas a mano en el libro ya no cuentan ("solo me
// generan duplicados"): ni en el estado ni para saltear OT del Plan.
// Solo servidor (lo de arriba de leer es puro).
import { sbGetAll } from "./sbHelpers";
import { leerPreciosOt } from "./finanzasMaterialesOt";
import { logger } from "./logger";
import { importeResultado } from "./finanzasResultados";

/** Quien anula sin ser una persona (como en finanzasVentas.js). */
const ANULO_GYPI = /^Gypi\b/;
const ORIGEN_ENTREGA = "entrega_ot";
const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Qué OT con PRECIO se suman como entregas del Plan (las que no tienen la
 * entrega que anota Gypi). Pura.
 * @param {object} d
 * @param {object[]} d.proyectos OT terminadas con id, ot, cliente, obra, fecha_entrega, fecha_objetivo
 * @param {Map<string, number>} d.precios PRECIO sin IVA por código de OT
 * @param {object[]} d.entregas entregas de Gypi (origen entrega_ot, todas las fechas) con origen_id, anulada_at, anulada_por_nombre
 * @param {string} d.desde AAAA-MM-DD
 * @param {string} d.hasta AAAA-MM-DD
 * @returns {{ entregas: { proyecto_id: number, ot: string, cliente: string, fecha: string, valor: number }[] }}
 */
export function planEntregasPlan({ proyectos = [], precios = new Map(), entregas = [], desde, hasta }) {
  // Las OT con la entrega de Gypi (viva, o anulada a mano por alguien: esa no se vuelve a sumar)
  const conGypi = new Set();
  for (const o of entregas) {
    if (o.origen !== ORIGEN_ENTREGA) continue;
    if (!o.anulada_at || !ANULO_GYPI.test(String(o.anulada_por_nombre || ""))) conGypi.add(String(o.origen_id || ""));
  }
  const salida = [];
  for (const p of proyectos) {
    if (p.estado && p.estado !== "cerrado") continue;
    const valor = centavos(precios.get(String(p.ot)));
    if (!(valor > 0) || conGypi.has(`p${p.id}`)) continue;
    const fecha = String(p.fecha_entrega || p.fecha_objetivo || "").slice(0, 10);
    if (!(fecha >= desde && fecha <= hasta)) continue;
    salida.push({ proyecto_id: Number(p.id), ot: String(p.ot), cliente: String(p.cliente || p.obra || "").trim(), fecha, valor });
  }
  salida.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.ot.localeCompare(b.ot));
  return { entregas: salida };
}

// Los mismos nombres que los renglones del estado (24/11, pedido de Tadeo)
const ORIGEN_TEXTO = { entrega_ot: "Precio del Plan", plan: "Precio del Plan", estimada: "Estimada por materiales" };

/**
 * Todas las entregas de la ventana, una por renglón, como las suma el estado
 * de resultados (24/11, pedido de Tadeo: "debería poder verse el detalle de
 * todas las entregas para un determinado mes"). Desde el 25/11 solo las del
 * Plan: la que anota Gypi, las del Plan sin anotar y las estimadas. Pura.
 * @param {object} d
 * @param {object[]} d.ops renglones vivos y confirmados en cuentas de Entregas (con fecha, cuenta_debe, cuenta_haber, importes, proyecto_id, origen, entidad)
 * @param {Set<string>} d.cuentasEntregas códigos de las cuentas de Entregas
 * @param {object[]} d.proyectos con id, ot, cliente, obra, division
 * @param {{ proyecto_id: number, fecha: string, valor: number }[]} [d.entregasPlan]
 * @param {{ proyecto_id: number, fecha: string, valor: number }[]} [d.estimadas]
 * @param {string[]} d.meses AAAA-MM de la ventana
 * @returns {{ fecha: string, mes: string, ot: string, cliente: string, division: string, origen: string, origen_texto: string, importe: number }[]}
 */
export function detalleEntregas({ ops = [], cuentasEntregas = new Set(), proyectos = [], entregasPlan = [], estimadas = [], meses = [] }) {
  const enVentana = new Set(meses);
  const porId = new Map(proyectos.map((p) => [Number(p.id), p]));
  const filas = [];
  const conEntrega = new Set();
  for (const o of ops) {
    if (o.anulada_at || o.estado === "para_revisar" || o.origen !== ORIGEN_ENTREGA) continue;
    const mes = String(o.fecha || "").slice(0, 7);
    if (!enVentana.has(mes)) continue;
    // Haber en Entregas suma; debe resta
    const signo = (cuentasEntregas.has(o.cuenta_haber) ? 1 : 0) - (cuentasEntregas.has(o.cuenta_debe) ? 1 : 0);
    if (!signo) continue;
    const p = o.proyecto_id ? porId.get(Number(o.proyecto_id)) : null;
    if (p) conEntrega.add(Number(p.id));
    filas.push({
      fecha: String(o.fecha).slice(0, 10), mes, ot: p ? String(p.ot || "") : "",
      cliente: String(o.entidad || p?.cliente || p?.obra || "").trim(), division: String(p?.division || "").trim(),
      origen: ORIGEN_ENTREGA, origen_texto: ORIGEN_TEXTO[ORIGEN_ENTREGA], importe: centavos(importeResultado(o) * signo),
    });
  }
  // Las del Plan y las estimadas, igual que el estado: no si la OT ya tiene una entrega en la ventana
  for (const [lista, origen] of [[entregasPlan, "plan"], [estimadas, "estimada"]]) {
    for (const x of lista) {
      const mes = String(x.fecha || "").slice(0, 7);
      const pid = Number(x.proyecto_id);
      if (!enVentana.has(mes) || !(Number(x.valor) > 0) || !pid || conEntrega.has(pid)) continue;
      conEntrega.add(pid);
      const p = porId.get(pid);
      filas.push({
        fecha: String(x.fecha).slice(0, 10), mes, ot: String(p?.ot || x.ot || ""),
        cliente: String(p?.cliente || p?.obra || x.cliente || "").trim(), division: String(p?.division || "").trim(),
        origen, origen_texto: ORIGEN_TEXTO[origen], importe: centavos(x.valor),
      });
    }
  }
  return filas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.ot.localeCompare(b.ot) || a.cliente.localeCompare(b.cliente));
}

const leer = (sesion, path, maxFilas = 20000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);

/**
 * Las OT terminadas con PRECIO sin la entrega de Gypi, con fecha de entrega
 * entre desde y hasta. Si algo falla, quedan afuera (el estado se arma igual).
 * @returns {Promise<ReturnType<typeof planEntregasPlan>>}
 */
export async function entregasDelPlan(sesion, desde, hasta) {
  const e = sesion.empresa_id;
  try {
    const COLS = "id,ot,cliente,obra,estado,fecha_entrega,fecha_objetivo";
    const enVentana = `or=(and(fecha_entrega.gte.${desde},fecha_entrega.lte.${hasta}),and(fecha_entrega.is.null,fecha_objetivo.gte.${desde},fecha_objetivo.lte.${hasta}))`;
    const [proyectos, precios, entregas] = await Promise.all([
      leer(sesion, `proyectos?empresa_id=eq.${e}&estado=eq.cerrado&${enVentana}&select=${COLS}&order=id.asc`)
        // Sin la 135 (fecha_objetivo): solo ENTREGA
        .catch(() => leer(sesion, `proyectos?empresa_id=eq.${e}&estado=eq.cerrado&fecha_entrega=gte.${desde}&fecha_entrega=lte.${hasta}&select=id,ot,cliente,obra,estado,fecha_entrega&order=id.asc`)),
      leerPreciosOt(sesion, e),
      leer(sesion, `fin_operaciones?empresa_id=eq.${e}&origen=eq.${ORIGEN_ENTREGA}&select=id,origen,origen_id,anulada_at,anulada_por_nombre&order=id.asc`, 100000),
    ]);
    return planEntregasPlan({ proyectos, precios, entregas, desde, hasta });
  } catch (err) {
    logger.warn(`[finanzas] entregas del Plan ${err?.message}`);
    return { entregas: [] };
  }
}
