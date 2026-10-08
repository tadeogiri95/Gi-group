// app/lib/cotizacion.js — Tipo de cambio de referencia para cobrar en pesos
// los precios en dólares (D18, ítem 25).
//
// Referencia: dólar oficial del Banco Nación, valor de venta, que publica
// dolarapi.com. Se guarda uno por día en la tabla cotizaciones (082) para que
// todos los cobros del día usen el mismo número y quede registro de cuál fue.
// Si la fuente no responde: la variable COTIZACION_USD_ARS (valor manual) o la
// última guardada de los últimos 7 días. Sin ninguna, no se calcula el precio.

import { sbGet } from "./sbHelpers";
import { logger } from "./logger";

const FUENTE_URL = process.env.COTIZACION_URL || "https://dolarapi.com/v1/dolares/oficial";
const FUENTE = "Dólar oficial BNA, venta (dolarapi.com)";
const DIAS_RESPALDO = 7;

// Un valor fuera de este rango es un error de la fuente, no una cotización
export function cotizacionValida(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 100 && n <= 100000;
}

/** Fecha de hoy en Argentina (YYYY-MM-DD). */
export function hoyArgentina(ahora = new Date()) {
  return new Date(ahora.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Consulta la fuente. Devuelve { usd_ars, fuente } o null. */
export async function consultarFuente() {
  try {
    const r = await fetch(FUENTE_URL, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const d = await r.json();
    const venta = Number(d?.venta);
    return cotizacionValida(venta) ? { usd_ars: venta, fuente: FUENTE } : null;
  } catch {
    return null;
  }
}

async function guardar(fecha, { usd_ars, fuente }) {
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  try {
    await fetch(`${SB_URL}/rest/v1/cotizaciones?on_conflict=fecha`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify({ fecha, usd_ars, fuente }),
    });
  } catch (e) {
    logger.warn("[cotizacion] no se pudo guardar", { error: e?.message });
  }
}

/**
 * Cotización a usar hoy: { usd_ars, fuente, fecha } o null si no hay ninguna.
 * La primera consulta del día la guarda; las siguientes leen la guardada.
 */
export async function cotizacionVigente(ahora = new Date()) {
  const hoy = hoyArgentina(ahora);
  const [guardada] = (await sbGet(`cotizaciones?fecha=eq.${hoy}&select=fecha,usd_ars,fuente&limit=1`, { silent: true, fallback: [] })) || [];
  if (guardada && cotizacionValida(guardada.usd_ars)) {
    return { usd_ars: Number(guardada.usd_ars), fuente: guardada.fuente, fecha: guardada.fecha };
  }

  const fuente = await consultarFuente();
  if (fuente) {
    await guardar(hoy, fuente);
    return { ...fuente, fecha: hoy };
  }

  const manual = process.env.COTIZACION_USD_ARS;
  if (cotizacionValida(manual)) {
    return { usd_ars: Number(manual), fuente: "Valor manual (COTIZACION_USD_ARS)", fecha: hoy };
  }

  const desde = hoyArgentina(new Date(ahora.getTime() - DIAS_RESPALDO * 86400000));
  const [ultima] = (await sbGet(`cotizaciones?fecha=gte.${desde}&select=fecha,usd_ars,fuente&order=fecha.desc&limit=1`, { silent: true, fallback: [] })) || [];
  if (ultima && cotizacionValida(ultima.usd_ars)) {
    return { usd_ars: Number(ultima.usd_ars), fuente: `${ultima.fuente} (del ${ultima.fecha})`, fecha: ultima.fecha };
  }

  logger.error("[cotizacion] sin cotización disponible", new Error("sin cotizacion"));
  return null;
}
