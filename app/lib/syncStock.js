// app/lib/syncStock.js — Copia los artículos y el stock de la planilla MRP de
// una empresa (Stock, parte 13; ítem 40; migración 106).
//
// Los links están en config_sistema, clave stock_csv_url:
//   { inventario: "https://…output=csv", articulos: "https://…" | null,
//     necesidades: "https://…" | null, ultima_sync }
// La hoja de necesidades (fact_necesidades_stock, parte 16) es opcional y va
// a necesidades_stock (108); si falla, el resto de la sincronización sigue.
// Lo usan /api/stock/sync (botón Sincronizar) y /api/cron/sync-ot (todas las
// mañanas, después de las OT). La planilla manda: lo que dejó de estar en
// ella queda inactivo en la app, no se borra.

import { logger } from "./logger";
import { safeErrorMessage } from "./validate";
import { sbHeaders } from "./sbHelpers";
import { descargarCsv } from "./syncOt";
import { CLAVE_STOCK_CSV, unirArticulos, leerNecesidades } from "./stock";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const BATCH = 500;

/* Con `sesion` y RLS_RUTAS=on va con el pase del usuario; sin sesión (el
 * cron, que recorre todas las empresas) sigue con service_role. */
async function sbFetch(path, opts = {}, sesion) {
  if (!SB_URL || !SB_KEY) throw new Error("SUPABASE_URL/KEY no configuradas");
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: await sbHeaders({ sesion }, { Prefer: "return=representation", ...opts.headers }),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

/** Error que se le puede mostrar tal cual al usuario (la ruta oculta los demás). */
function aviso(mensaje) {
  const e = new Error(mensaje);
  e.aviso = true;
  return e;
}

async function descargarHoja(url, hoja) {
  try {
    return await descargarCsv(url);
  } catch (e) {
    throw aviso(`No pude leer la hoja ${hoja} de la planilla MRP (${e.message}). Revisá que esté publicada como CSV.`);
  }
}

/** ¿El error es porque falta correr la migración 106? */
export function faltaMigracionStock(err) {
  return String(err?.message).includes("articulos_stock");
}

/**
 * @param {string} empresaId
 * @param {{ sesion?: object }} [opts]
 * @returns {Promise<{ articulos: number, desactivados: number, sinSku: number, errores: string[] }>}
 */
export async function syncStockEmpresa(empresaId, { sesion } = {}) {
  const [cfg] = (await sbFetch(
    `config_sistema?empresa_id=eq.${empresaId}&clave=eq.${CLAVE_STOCK_CSV}&select=valor&limit=1`,
    {},
    sesion
  )) || [];
  const urls = cfg?.valor || {};
  if (!urls.inventario) throw aviso("Falta el link de la hoja INVENTARIO de la planilla MRP");

  const [inventario, articulos] = await Promise.all([
    descargarHoja(urls.inventario, "INVENTARIO"),
    urls.articulos ? descargarHoja(urls.articulos, "ARTICULOS") : null,
  ]);
  const { filas, sinSku, faltaColumnaSku } = unirArticulos({ inventario, articulos });
  if (faltaColumnaSku) throw aviso("No encontré la columna SKU en la planilla. ¿El link es de la hoja INVENTARIO (y ARTICULOS)?");
  if (!filas.length) throw aviso("La planilla no trae artículos con SKU");

  const ahora = new Date().toISOString();
  const errores = [];
  for (let i = 0; i < filas.length; i += BATCH) {
    const lote = filas.slice(i, i + BATCH).map((f) => ({ empresa_id: empresaId, ...f, activo: true, sincronizado_at: ahora }));
    try {
      await sbFetch("articulos_stock?on_conflict=empresa_id,sku", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(lote),
      }, sesion);
    } catch (e) {
      if (faltaMigracionStock(e)) throw e;
      logger.error(`[stock/sync] Error en lote ${Math.floor(i / BATCH) + 1}`, e);
      errores.push(`Lote ${Math.floor(i / BATCH) + 1}: ${safeErrorMessage(e)}`);
    }
  }

  // Lo que ya no está en la planilla queda inactivo. Si un lote falló no se
  // toca nada: esos artículos parecerían borrados sin estarlo.
  let desactivados = 0;
  if (!errores.length) {
    const viejos = await sbFetch(
      `articulos_stock?empresa_id=eq.${empresaId}&activo=eq.true&sincronizado_at=lt.${encodeURIComponent(ahora)}&select=sku`,
      { method: "PATCH", body: JSON.stringify({ activo: false }) },
      sesion
    );
    desactivados = Array.isArray(viejos) ? viejos.length : 0;
  }

  const nec = urls.necesidades ? await syncNecesidades(empresaId, urls.necesidades, ahora, sesion) : { necesidades: 0, avisoNecesidades: null };

  try {
    await sbFetch(
      `config_sistema?empresa_id=eq.${empresaId}&clave=eq.${CLAVE_STOCK_CSV}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ valor: { ...urls, ultima_sync: ahora, articulos_sync: filas.length } }),
      },
      sesion
    );
  } catch (e) {
    logger.error("[stock/sync] No se pudo guardar la fecha de sincronización", e);
  }

  return { articulos: filas.length, desactivados, sinSku, errores, ...nec };
}

/**
 * Copia la hoja de necesidades por OT. Un renglón por OT y artículo; lo que ya
 * no está en la planilla se borra (si todo se guardó bien).
 * @returns {Promise<{ necesidades: number, avisoNecesidades: string|null }>}
 */
async function syncNecesidades(empresaId, url, ahora, sesion) {
  let texto;
  try {
    texto = await descargarCsv(url);
  } catch (e) {
    return { necesidades: 0, avisoNecesidades: `No pude leer la hoja de necesidades (${e.message}). Revisá que esté publicada como CSV.` };
  }
  const { filas, faltaColumnas } = leerNecesidades(texto);
  if (faltaColumnas) return { necesidades: 0, avisoNecesidades: "No encontré las columnas SKU, OT y CANTIDAD en la hoja de necesidades. ¿El link es de fact_necesidades_stock?" };
  try {
    for (let i = 0; i < filas.length; i += BATCH) {
      const lote = filas.slice(i, i + BATCH).map((f) => ({ empresa_id: empresaId, ...f, sincronizado_at: ahora }));
      await sbFetch("necesidades_stock?on_conflict=empresa_id,ot,sku", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(lote),
      }, sesion);
    }
    await sbFetch(
      `necesidades_stock?empresa_id=eq.${empresaId}&sincronizado_at=lt.${encodeURIComponent(ahora)}`,
      { method: "DELETE", headers: { Prefer: "return=minimal" } },
      sesion
    );
    return { necesidades: filas.length, avisoNecesidades: null };
  } catch (e) {
    if (String(e?.message).includes("necesidades_stock")) {
      return { necesidades: 0, avisoNecesidades: "Para las necesidades por OT falta correr la migración 108 en Supabase." };
    }
    logger.error("[stock/sync] Error en necesidades", e);
    return { necesidades: 0, avisoNecesidades: "No se pudieron guardar las necesidades por OT. Probá de nuevo." };
  }
}

/** Sincroniza todas las empresas con planilla MRP; un error no frena a las demás. */
export async function syncStockTodas() {
  const rows = await sbFetch(`config_sistema?clave=eq.${CLAVE_STOCK_CSV}&select=empresa_id,valor&limit=500`);
  const results = [];
  for (const row of rows || []) {
    if (!row.valor?.inventario) continue;
    try {
      results.push({ empresa_id: row.empresa_id, ...(await syncStockEmpresa(row.empresa_id)) });
    } catch (e) {
      results.push({ empresa_id: row.empresa_id, error: e.message });
    }
  }
  return results;
}
