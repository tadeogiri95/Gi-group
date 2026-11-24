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
import { importeResultado } from "./finanzasResultados";
import { claveNombre } from "./finanzasProveedores";
import { ORIGENES } from "./finanzasOperaciones";

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

/** Días que puede haber entre dos entregas del mismo cliente para avisar que podrían ser la misma. */
export const DIAS_REPETIDA = 62;
const ORIGEN_TEXTO = {
  entrega_ot: "Gypi (OT terminada)",
  libro: "Libro",
  plan: "Plan (precio, sin entrega anotada)",
  estimada: "Estimada (por materiales)",
};
const dias = (a, b) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000;

/**
 * Todas las entregas de la ventana, una por renglón, como las suma el estado
 * de resultados (24/11, pedido de Tadeo: "debería poder verse el detalle de
 * todas las entregas para un determinado mes"). Pura.
 *
 * Posible repetida: una entrega del libro (o cargada a mano) que no está
 * ligada a ninguna OT y otra que sí sale de una OT (la de Gypi, la del Plan o
 * la estimada), del mismo cliente y con menos de DIAS_REPETIDA días entre una
 * y otra. Las dos quedan marcadas con la otra.
 * @param {object} d
 * @param {object[]} d.ops renglones vivos y confirmados en cuentas de Entregas (con fecha, cuenta_debe, cuenta_haber, importes, proyecto_id, origen, descripcion, referencia, entidad, centro_costo)
 * @param {Set<string>} d.cuentasEntregas códigos de las cuentas de Entregas
 * @param {object[]} d.proyectos con id, ot, cliente, obra, division
 * @param {{ proyecto_id: number, fecha: string, valor: number }[]} [d.entregasPlan]
 * @param {{ proyecto_id: number, fecha: string, valor: number }[]} [d.estimadas]
 * @param {string[]} d.meses AAAA-MM de la ventana
 * @returns {{ fecha: string, mes: string, ot: string, cliente: string, division: string, origen: string, origen_texto: string, descripcion: string, importe: number, repetida?: string }[]}
 */
export function detalleEntregas({ ops = [], cuentasEntregas = new Set(), proyectos = [], entregasPlan = [], estimadas = [], meses = [] }) {
  const enVentana = new Set(meses);
  const porId = new Map(proyectos.map((p) => [Number(p.id), p]));
  const filas = [];
  const conEntrega = new Set();
  for (const o of ops) {
    if (o.anulada_at || o.estado === "para_revisar") continue;
    const mes = String(o.fecha || "").slice(0, 7);
    if (!enVentana.has(mes)) continue;
    // Haber en Entregas suma; debe (un descuento, una nota de crédito) resta
    const signo = (cuentasEntregas.has(o.cuenta_haber) ? 1 : 0) - (cuentasEntregas.has(o.cuenta_debe) ? 1 : 0);
    if (!signo) continue;
    const p = o.proyecto_id ? porId.get(Number(o.proyecto_id)) : null;
    if (p) conEntrega.add(Number(p.id));
    filas.push({
      fecha: String(o.fecha).slice(0, 10), mes, ot: p ? String(p.ot || "") : "",
      cliente: String(o.entidad || p?.cliente || p?.obra || "").trim(),
      division: String(p?.division || o.centro_costo || "").trim(),
      origen: o.origen === "entrega_ot" ? "entrega_ot" : o.origen || "manual",
      origen_texto: ORIGEN_TEXTO[o.origen] || ORIGENES[o.origen] || "Cargada a mano",
      descripcion: String(o.descripcion || o.referencia || "").replace(/\s+/g, " ").trim().slice(0, 160),
      importe: centavos(importeResultado(o) * signo),
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
        origen, origen_texto: ORIGEN_TEXTO[origen], descripcion: "", importe: centavos(x.valor),
      });
    }
  }
  // Posibles repetidas: del libro sin OT contra una que sale de una OT, mismo cliente y fechas cercanas
  const sinOt = filas.filter((f) => !f.ot && f.importe > 0 && claveNombre(f.cliente));
  const deOt = filas.filter((f) => f.ot && f.importe > 0 && claveNombre(f.cliente));
  for (const a of sinOt) {
    const k = claveNombre(a.cliente);
    for (const b of deOt) {
      if (claveNombre(b.cliente) !== k || dias(a.fecha, b.fecha) > DIAS_REPETIDA) continue;
      const deA = `${a.origen_texto} del ${a.fecha}${a.descripcion ? ` (${a.descripcion.slice(0, 60)})` : ""}`;
      a.repetida = a.repetida ? a.repetida : `OT ${b.ot} · ${b.origen_texto} del ${b.fecha}`;
      if (!b.repetida) b.repetida = deA;
    }
  }
  return filas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.ot.localeCompare(b.ot) || a.cliente.localeCompare(b.cliente));
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
