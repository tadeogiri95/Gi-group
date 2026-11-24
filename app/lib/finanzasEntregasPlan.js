// app/lib/finanzasEntregasPlan.js — las OT terminadas CON precio en el Plan
// que no tienen entrega anotada (24/11, pedido de Tadeo: "que la información
// sea completa y confiable").
//
// Gypi anota la entrega de una OT con precio (finanzasVentas.js) solo si la
// OT entró a Gypi desde la fecha de inicio de "Ventas de las OT"; casi todas
// entraron en octubre, cuando se conectó la planilla. Y las entregas
// estimadas son solo para las OT SIN precio. Esas OT quedaban afuera del
// Estado de Resultados y del Reporte financiero.
//
// Lo que eligió Tadeo ("Por fecha de ENTREGA, sin repetir"): se suman con su
// PRECIO en el mes de su ENTREGA del Plan (si ENTREGA no es una fecha, el
// último día de su SEMANA), salteando las que ya tienen una entrega anotada:
// la de Gypi, o un renglón del libro (o cargado a mano) en una cuenta de
// Entregas que nombra la OT o está ligado a ella. Las salteadas se muestran
// en una lista, para revisar. Solo servidor (lo de arriba de leer es puro).
import { sbGetAll } from "./sbHelpers";
import { leerPreciosOt } from "./finanzasMaterialesOt";
import { logger } from "./logger";

/** Quien anula sin ser una persona (como en finanzasVentas.js). */
const ANULO_GYPI = /^Gypi\b/;
const ORIGEN_ENTREGA = "entrega_ot";
const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const mayus = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Si un texto del libro nombra la OT: "M-7795", "M 7795", "OT 7795",
 * "OT N° 7795" o, si el número tiene 4 cifras o más, "7795" solo. Una sub-OT
 * ("M-7751-29") no cuenta como la OT "M-7751", y al revés tampoco. Pura.
 * @param {string} texto
 * @param {string} ot
 * @returns {boolean}
 */
export function otMencionada(texto, ot) {
  const t = mayus(texto);
  const m = /^([A-Z]+)\s*-?\s*(\d+)((?:-\d+)*)$/.exec(mayus(ot).trim());
  if (!t || !m) return false;
  const [, letra, numero, resto] = m;
  const sigue = `${escapar(resto)}(?![0-9])${resto ? "" : "(?!-[0-9])"}`;
  const formas = [
    `(?<![A-Z0-9])${escapar(letra)}\\s*-?\\s*${numero}${sigue}`,
    `(?<![A-Z0-9])OT\\s*(?:N[°º.]?|#|:)?\\s*(?:${escapar(letra)}\\s*-?\\s*)?${numero}${sigue}`,
    ...(numero.length >= 4 ? [`(?<![A-Z0-9-])${numero}${sigue}`] : []),
  ];
  return formas.some((f) => new RegExp(f).test(t));
}

/**
 * Qué OT con precio se suman como entregas del Plan y cuáles se saltean
 * porque ya tienen su entrega anotada. Pura.
 * @param {object} d
 * @param {object[]} d.proyectos OT terminadas con id, ot, cliente, obra, fecha_entrega, fecha_objetivo
 * @param {Map<string, number>} d.precios PRECIO sin IVA por código de OT
 * @param {object[]} d.entregas renglones en cuentas de Entregas (todas las fechas), con id, origen, origen_id, proyecto_id, descripcion, referencia, fecha, anulada_at, anulada_por_nombre
 * @param {string} d.desde AAAA-MM-DD
 * @param {string} d.hasta AAAA-MM-DD
 * @returns {{ entregas: { proyecto_id: number, ot: string, cliente: string, fecha: string, valor: number }[], enLibro: { ot: string, cliente: string, fecha: string, valor: number, libro_fecha: string, libro: string }[] }}
 */
export function planEntregasPlan({ proyectos = [], precios = new Map(), entregas = [], desde, hasta }) {
  // Las OT con la entrega de Gypi (viva, o anulada a mano por alguien: esa no se vuelve a sumar)
  const conGypi = new Set();
  const otras = [];
  for (const o of entregas) {
    if (o.origen === ORIGEN_ENTREGA) {
      if (!o.anulada_at || !ANULO_GYPI.test(String(o.anulada_por_nombre || ""))) conGypi.add(String(o.origen_id || ""));
    } else if (!o.anulada_at) otras.push(o);
  }
  const salida = { entregas: [], enLibro: [] };
  for (const p of proyectos) {
    if (p.estado && p.estado !== "cerrado") continue;
    const valor = centavos(precios.get(String(p.ot)));
    if (!(valor > 0) || conGypi.has(`p${p.id}`)) continue;
    const fecha = String(p.fecha_entrega || p.fecha_objetivo || "").slice(0, 10);
    if (!(fecha >= desde && fecha <= hasta)) continue;
    const cliente = String(p.cliente || p.obra || "").trim();
    const ya = otras.find((o) => Number(o.proyecto_id) === Number(p.id) || otMencionada(`${o.descripcion || ""} ${o.referencia || ""}`, p.ot));
    if (ya) {
      salida.enLibro.push({ ot: String(p.ot), cliente, fecha, valor, libro_fecha: String(ya.fecha || "").slice(0, 10), libro: String(ya.descripcion || ya.referencia || "").replace(/\s+/g, " ").trim().slice(0, 120) });
      continue;
    }
    salida.entregas.push({ proyecto_id: Number(p.id), ot: String(p.ot), cliente, fecha, valor });
  }
  const orden = (a, b) => a.fecha.localeCompare(b.fecha) || a.ot.localeCompare(b.ot);
  salida.entregas.sort(orden);
  salida.enLibro.sort(orden);
  return salida;
}

const leer = (sesion, path, maxFilas = 20000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data || []);

/**
 * Las OT terminadas con precio y sin entrega anotada, con fecha de entrega
 * entre desde y hasta. Si algo falla, quedan afuera (el estado se arma igual).
 * @returns {Promise<ReturnType<typeof planEntregasPlan>>}
 */
export async function entregasDelPlan(sesion, desde, hasta) {
  const e = sesion.empresa_id;
  try {
    // Las cuentas de Entregas (las que clasifica el estado como ING_ENT)
    const cuentas = await leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,linea_eerr&order=codigo.asc`, 5000);
    const codigos = cuentas.filter((c) => /^ING_ENT/i.test(String(c.linea_eerr || ""))).map((c) => c.codigo);
    if (!codigos.length) return { entregas: [], enLibro: [] };
    const lista = codigos.map((c) => `"${String(c).replace(/"/g, "")}"`).join(",");
    const COLS = "id,ot,cliente,obra,estado,fecha_entrega,fecha_objetivo";
    const enVentana = `or=(and(fecha_entrega.gte.${desde},fecha_entrega.lte.${hasta}),and(fecha_entrega.is.null,fecha_objetivo.gte.${desde},fecha_objetivo.lte.${hasta}))`;
    const [proyectos, precios, entregas] = await Promise.all([
      leer(sesion, `proyectos?empresa_id=eq.${e}&estado=eq.cerrado&${enVentana}&select=${COLS}&order=id.asc`)
        // Sin la 135 (fecha_objetivo): solo ENTREGA
        .catch(() => leer(sesion, `proyectos?empresa_id=eq.${e}&estado=eq.cerrado&fecha_entrega=gte.${desde}&fecha_entrega=lte.${hasta}&select=id,ot,cliente,obra,estado,fecha_entrega&order=id.asc`)),
      leerPreciosOt(sesion, e),
      leer(sesion, `fin_operaciones?empresa_id=eq.${e}&or=(cuenta_haber.in.(${lista}),cuenta_debe.in.(${lista}))&select=id,origen,origen_id,proyecto_id,descripcion,referencia,fecha,anulada_at,anulada_por_nombre&order=id.asc`, 100000),
    ]);
    return planEntregasPlan({ proyectos, precios, entregas, desde, hasta });
  } catch (err) {
    logger.warn(`[finanzas] entregas del Plan ${err?.message}`);
    return { entregas: [], enLibro: [] };
  }
}
