// app/lib/finanzasEntregasEstimadas.js — las OT terminadas sin precio en el
// Plan, con su valor estimado por materiales (÷ el % de materiales de
// Configuración, 30 % por defecto; igual que la cuenta
// corriente de clientes). Lo usan el Estado de Resultados (13/11) y el Reporte
// financiero (18/11), los dos pedidos de Tadeo. Solo servidor.
import { sbGet, sbGetAll } from "./sbHelpers";
import { CLAVE_ENTREGAS_ESTIMADAS } from "./finanzasVentas";
import { materialesDeOts } from "./finanzasMaterialesOt";
import { valorOt } from "./finanzasOtClientes";
import { hoyAr } from "./finanzasOperaciones";
import { logger } from "./logger";
import { factorMateriales } from "./finanzasPctMateriales";

const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data);

/** Por qué una OT sin precio no se pudo estimar (13/11, pedido de Tadeo). */
export const MOTIVOS_NO_ESTIMADA = {
  sin_necesidades: "No tiene materiales en Gypi (no pasó por el MRP)",
  sin_precios: "Sus materiales no tienen precio cargado",
  sin_fecha: "Está terminada pero no tiene ENTREGA (con fecha) ni SEMANA en el Plan",
  sin_terminar: "Su fecha de entrega ya pasó pero no está terminada en el Plan (TERMINADO)",
};

/**
 * Las OT terminadas sin precio en la ventana, con su valor estimado, y las
 * que no se pudieron estimar con el motivo. Si algo falla, quedan afuera (el
 * estado se arma igual).
 * @returns {Promise<{ estimadas: { proyecto_id: number, ot: string, fecha: string, valor: number }[], noEstimadas: { ot: string, cliente: string, fecha: string, motivo: string }[] }>}
 */
export async function entregasEstimadas(sesion, desde, hasta) {
  const e = sesion.empresa_id;
  const COLS = "id,ot,cliente,obra,estado,created_at,fecha_entrega,fecha_objetivo";
  const COLS_SIN_135 = "id,ot,cliente,obra,estado,created_at,fecha_entrega";
  // ENTREGA del Plan casi siempre es texto libre: si no es una fecha, va el
  // último día de la SEMANA (fecha_objetivo, 135). Sin la 135, solo ENTREGA.
  const enVentana = (a, b) => `or=(and(fecha_entrega.gte.${a},fecha_entrega.lte.${b}),and(fecha_entrega.is.null,fecha_objetivo.gte.${a},fecha_objetivo.lte.${b}))`;
  const conFecha = async (filtro, a, b) => leer(sesion, `proyectos?empresa_id=eq.${e}&${filtro}&${enVentana(a, b)}&select=${COLS}`, 20000)
    .catch(() => leer(sesion, `proyectos?empresa_id=eq.${e}&${filtro}&fecha_entrega=gte.${a}&fecha_entrega=lte.${b}&select=${COLS_SIN_135}`, 20000))
    .catch(() => []);
  try {
    const [fila] = (await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_ENTREGAS_ESTIMADAS}&select=valor&limit=1`, { silent: true, fallback: [] })) || [];
    const anotadas = new Map(Object.entries(fila?.valor?.fechas || {})
      .map(([k, f]) => [Number(String(k).slice(1)), String(f || "")])
      .filter(([id, f]) => id > 0 && f));
    const ids = [...anotadas].filter(([, f]) => f >= desde && f <= hasta).map(([id]) => id);
    const proyectos = new Map();
    for (let i = 0; i < ids.length; i += 150) {
      for (const p of await leer(sesion, `proyectos?empresa_id=eq.${e}&id=in.(${ids.slice(i, i + 150).join(",")})&select=${COLS}`, 1000)) proyectos.set(Number(p.id), p);
    }
    // Las terminadas que Gypi no anotó (cargadas antes del "desde" o de este
    // cambio): el mes de su fecha de entrega del Plan (13/11, pedido de Tadeo)
    const viejas = await conFecha("estado=eq.cerrado", desde, hasta);
    for (const p of viejas) if (!anotadas.has(Number(p.id))) proyectos.set(Number(p.id), p);
    // Para la lista de las que no se pudieron estimar: terminadas sin fecha de
    // entrega, y abiertas con la fecha de entrega ya pasada dentro de la ventana
    const hoy = hoyAr();
    const tope = hoy < hasta ? hoy : hasta;
    const [sinFecha, sinTerminar] = await Promise.all([
      leer(sesion, `proyectos?empresa_id=eq.${e}&estado=eq.cerrado&fecha_entrega=is.null&fecha_objetivo=is.null&select=${COLS}`, 20000)
        .catch(() => leer(sesion, `proyectos?empresa_id=eq.${e}&estado=eq.cerrado&fecha_entrega=is.null&select=${COLS_SIN_135}`, 20000))
        .catch(() => []),
      conFecha("estado=neq.cerrado", desde, tope),
    ]);
    // Si le pusieron precio desde la última sync, ya no se estima
    const precios = await sbGet(`precios_ot?empresa_id=eq.${e}&select=ot,precio`, { sesion, silent: true, fallback: [] });
    const conPrecio = new Set((precios || []).filter((f) => Number(f.precio) > 0).map((f) => String(f.ot)));
    const sinPrecio = (p) => !conPrecio.has(String(p.ot));
    const vivos = [...proyectos.values()].filter((p) => p.estado === "cerrado" && sinPrecio(p));
    const [materiales, factor] = await Promise.all([materialesDeOts(sesion, vivos), factorMateriales(e)]);
    const estimadas = [];
    const noEstimadas = [];
    const fila_ = (p, fecha, motivo) => ({ ot: String(p.ot), cliente: String(p.cliente || p.obra || "").trim(), fecha, motivo });
    for (const p of vivos) {
      const fecha = anotadas.get(Number(p.id)) || String(p.fecha_entrega || p.fecha_objetivo || "").slice(0, 10);
      if (!(fecha >= desde && fecha <= hasta)) continue;
      const m = materiales.get(String(p.ot));
      const valor = valorOt(0, m, factor).valor;
      if (valor > 0) estimadas.push({ proyecto_id: Number(p.id), ot: String(p.ot), fecha, valor });
      else noEstimadas.push(fila_(p, fecha, !(m?.articulos > 0) ? "sin_necesidades" : "sin_precios"));
    }
    for (const p of sinFecha) if (sinPrecio(p) && !anotadas.has(Number(p.id))) noEstimadas.push(fila_(p, "", "sin_fecha"));
    for (const p of sinTerminar) if (sinPrecio(p)) noEstimadas.push(fila_(p, String(p.fecha_entrega || p.fecha_objetivo || "").slice(0, 10), "sin_terminar"));
    return { estimadas, noEstimadas };
  } catch (err) {
    logger.warn(`[finanzas] entregas estimadas ${err?.message}`);
    return { estimadas: [], noEstimadas: [] };
  }
}
