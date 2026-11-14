// /api/finanzas/resultados — Finanzas, parte F6a (migración 179): el estado
// de resultados (reglas en app/lib/finanzasResultados.js).
//
//   GET ?hasta=AAAA-MM[&division=X] → los 12 meses que terminan en ese mes
//       (por defecto, el mes en curso), ya calculados; con division, lo de esa
//       división y su % de lo compartido. Trae el resumen por división.
//   POST { accion: "config", materiales_pct?, ponderador? } → el % de las
//       entregas con que se estima el costo de materiales (0 = no estimar) y
//       el % de lo compartido que va a cada división (suman 100).
//       materiales_real?: true usa el costo real de materiales de cada OT
//       entregada (auditoría 12/11, parte 4); las demás entregas, el %.
//
// Entregas con valor estimado (13/11): las OT terminadas sin PRECIO en el
// Plan valen materiales de sus necesidades ÷ 0,3, como en la cuenta corriente
// de clientes. El mes: el día que la sync de ventas la vio terminada
// (config_sistema "finanzas_entregas_estimadas") o, si no la anotó (cargada
// antes del "desde"), su fecha de entrega del Plan o, si ENTREGA no es una
// fecha, el último día de su SEMANA. Van en un renglón aparte de Entregas.
//
// Solo el rol Dueño, con el pase del usuario (la base también lo exige). La
// configuración va en config_sistema.
import { NextResponse } from "next/server";
import { sbGet, sbGetAll, sbPatch, sbPost } from "../../../lib/sbHelpers";
import { rechazarSiSinPlan } from "../../../lib/planEnforcement";
import { sesionDueno, errorFinanzas } from "../../../lib/finanzasApi";
import { hoyAr } from "../../../lib/finanzasOperaciones";
import { logger } from "../../../lib/logger";
import { materialesRealesDeOts } from "../../../lib/costoRealServidor";
import { CLAVE_ENTREGAS_ESTIMADAS } from "../../../lib/finanzasVentas";
import { materialesDeOts } from "../../../lib/finanzasMaterialesOt";
import { valorOt } from "../../../lib/finanzasOtClientes";
import { CLAVE_RESULTADOS, configResultados, estadoResultados, finDeMes, mesesHasta, resumenDivisiones, validarPonderador } from "../../../lib/finanzasResultados";

export const maxDuration = 60;

const FALTA_179 = "Para el estado de resultados falta correr la migración 179 en Supabase.";
const falta179 = (err) => /linea_eerr|atribucion/.test(String(err?.message)) && /does not exist|42703|PGRST20[045]|schema cache/.test(String(err?.message));
const COLUMNAS = "id,fecha,cuenta_debe,cuenta_haber,neto,total,total_ars,proyecto_id,centro_costo,estado,origen,anulada_at";

const leer = (sesion, path, maxFilas = 5000) => sbGetAll(path, { sesion, maxFilas }).then((r) => r.data);

/** Materiales reales (MRP + de más + compras sin stock) de las OT con entregas en la ventana, por id de OT. */
async function materialesDeEntregas(e, ops, cuentas, otrasIds = []) {
  const ent = new Set(cuentas.filter((c) => /^ING_ENT/i.test(String(c.linea_eerr || ""))).map((c) => c.codigo));
  const ids = [...new Set([...ops.filter((o) => o.proyecto_id && (ent.has(o.cuenta_haber) || ent.has(o.cuenta_debe))).map((o) => Number(o.proyecto_id)), ...otrasIds])].slice(0, 400);
  if (!ids.length) return new Map();
  try {
    const proyectos = [];
    for (let i = 0; i < ids.length; i += 150) proyectos.push(...((await sbGetAll(`proyectos?empresa_id=eq.${e}&id=in.(${ids.slice(i, i + 150).join(",")})&select=*`, { maxFilas: 1000 })).data || []));
    const reales = await materialesRealesDeOts(e, proyectos);
    return new Map(proyectos.map((p) => [Number(p.id), reales.get(String(p.ot)) || 0]));
  } catch (err) {
    // Sin las migraciones del costo o la base no respondió: queda el %
    logger.warn(`[finanzas] resultados: materiales reales ${err?.message}`);
    return null;
  }
}

/** Por qué una OT sin precio no se pudo estimar (13/11, pedido de Tadeo). */
const MOTIVOS_NO_ESTIMADA = {
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
async function entregasEstimadas(sesion, desde, hasta) {
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
    const materiales = await materialesDeOts(sesion, vivos);
    const estimadas = [];
    const noEstimadas = [];
    const fila_ = (p, fecha, motivo) => ({ ot: String(p.ot), cliente: String(p.cliente || p.obra || "").trim(), fecha, motivo });
    for (const p of vivos) {
      const fecha = anotadas.get(Number(p.id)) || String(p.fecha_entrega || p.fecha_objetivo || "").slice(0, 10);
      if (!(fecha >= desde && fecha <= hasta)) continue;
      const m = materiales.get(String(p.ot));
      const valor = valorOt(0, m).valor;
      if (valor > 0) estimadas.push({ proyecto_id: Number(p.id), ot: String(p.ot), fecha, valor });
      else noEstimadas.push(fila_(p, fecha, !(m?.articulos > 0) ? "sin_necesidades" : "sin_precios"));
    }
    for (const p of sinFecha) if (sinPrecio(p) && !anotadas.has(Number(p.id))) noEstimadas.push(fila_(p, "", "sin_fecha"));
    for (const p of sinTerminar) if (sinPrecio(p)) noEstimadas.push(fila_(p, String(p.fecha_entrega || p.fecha_objetivo || "").slice(0, 10), "sin_terminar"));
    return { estimadas, noEstimadas };
  } catch (err) {
    logger.warn(`[finanzas] resultados: entregas estimadas ${err?.message}`);
    return { estimadas: [], noEstimadas: [] };
  }
}

async function leerConfig(e) {
  const cfg = await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_RESULTADOS}&select=valor&limit=1`, { silent: true, fallback: [] });
  return configResultados(cfg?.[0]?.valor);
}

export async function GET(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const e = sesion.empresa_id;
  const q = new URL(request.url).searchParams;
  const pedido = q.get("hasta");
  const hasta = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(pedido || "")) ? pedido : hoyAr().slice(0, 7);
  const meses = mesesHasta(hasta);
  try {
    const [cuentas, ops, proyectos, config, centros] = await Promise.all([
      leer(sesion, `fin_cuentas?empresa_id=eq.${e}&select=codigo,nombre,rubro,linea_eerr,atribucion&order=codigo.asc`),
      leer(sesion, `fin_operaciones?empresa_id=eq.${e}&anulada_at=is.null&fecha=gte.${meses[0]}-01&fecha=lte.${finDeMes(hasta)}&select=${COLUMNAS}&order=fecha.asc,id.asc`, 200000),
      leer(sesion, `proyectos?empresa_id=eq.${e}&select=id,division`, 20000),
      leerConfig(e),
      leer(sesion, `fin_centros_costo?empresa_id=eq.${e}&select=codigo,division`).catch(() => []),
    ]);
    // Las OT terminadas sin precio en el Plan, con su valor estimado (13/11)
    const { estimadas, noEstimadas } = await entregasEstimadas(sesion, `${meses[0]}-01`, finDeMes(hasta));
    // Costo real de materiales de cada OT entregada (auditoría 12/11, parte 4), si el Dueño lo eligió
    const materialesOt = config.materiales_real ? await materialesDeEntregas(e, ops || [], cuentas || [], estimadas.map((x) => x.proyecto_id)) : null;
    const base = { ops: ops || [], cuentas: cuentas || [], proyectos: proyectos || [], centros: centros || [], hasta, materialesPct: config.materiales_pct, ponderador: config.ponderador, materialesOt, entregasEstimadas: estimadas };
    const pedida = q.get("division") || "";
    const division = Object.keys(config.ponderador).includes(pedida) ? pedida : "";
    const estado = estadoResultados({ ...base, division });
    // Las divisiones de las OT, para armar el ponderador
    const divisiones = [...new Set([...(proyectos || []).map((p) => String(p.division || "").trim()).filter(Boolean), ...Object.keys(config.ponderador)])].sort((a, b) => a.localeCompare(b));
    const por_division = Object.keys(config.ponderador).length ? resumenDivisiones(base) : [];
    const estimadas_ot = estimadas.map(({ ot, fecha, valor }) => ({ ot, fecha, valor })).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.ot.localeCompare(b.ot));
    const no_estimadas_ot = noEstimadas
      .map((x) => ({ ...x, motivo_texto: MOTIVOS_NO_ESTIMADA[x.motivo] }))
      .sort((a, b) => a.motivo.localeCompare(b.motivo) || (a.fecha || "").localeCompare(b.fecha || "") || a.ot.localeCompare(b.ot));
    return NextResponse.json({ hasta, config, division, divisiones, por_division, estimadas_ot, no_estimadas_ot, ...estado });
  } catch (err) {
    if (falta179(err)) return NextResponse.json({ error: FALTA_179, falta_migracion: 179 }, { status: 409 });
    return errorFinanzas(err, "resultados GET");
  }
}

export async function POST(request) {
  const { sesion, response } = await sesionDueno(request);
  if (response) return response;
  const sinPlan = await rechazarSiSinPlan(sesion.empresa_id);
  if (sinPlan) return sinPlan;
  const d = await request.json().catch(() => null);
  if (d?.accion !== "config") return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  const e = sesion.empresa_id;
  const cambios = {};
  if ("materiales_pct" in d) {
    const n = Number(String(d.materiales_pct ?? "").replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 100) return NextResponse.json({ error: "El % de materiales va de 0 a 100" }, { status: 400 });
    cambios.materiales_pct = Math.round(n * 10) / 10;
  }
  if ("materiales_real" in d) cambios.materiales_real = d.materiales_real === true;
  if ("ponderador" in d) {
    const p = validarPonderador(d.ponderador);
    if (p.error) return NextResponse.json({ error: p.error }, { status: 400 });
    cambios.ponderador = p.ponderador;
  }
  if (!Object.keys(cambios).length) return NextResponse.json({ error: "No vino nada para guardar" }, { status: 400 });
  try {
    // Lo que no vino queda como estaba
    const valor = { ...(await leerConfig(e)), ...cambios };
    if (!valor.materiales_real) delete valor.materiales_real;
    const ya = await sbGet(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_RESULTADOS}&select=clave&limit=1`, { silent: true, fallback: [] });
    if (ya?.length) await sbPatch(`config_sistema?empresa_id=eq.${e}&clave=eq.${CLAVE_RESULTADOS}`, { valor });
    else await sbPost("config_sistema", { empresa_id: e, clave: CLAVE_RESULTADOS, valor });
    return NextResponse.json({ ok: true, config: valor });
  } catch (err) {
    return errorFinanzas(err, "resultados config");
  }
}
