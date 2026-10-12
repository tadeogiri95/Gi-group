// app/lib/syncOt.js — Sincroniza las OT de una empresa desde su planilla
// (CSV publicado, URL en config_sistema clave proyectos_csv_url).
// Lo usan /api/proyectos/sync-csv (botón Sincronizar, y el empleado que no
// encuentra una OT) y /api/cron/sync-ot (todas las mañanas).

import { logger } from "./logger";
import { safeErrorMessage } from "./validate";
import { parseCsvProyectos } from "./csvProyectos";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const BATCH = 100;

/* ─── Supabase helper (service key, sin proxy) ─── */
async function sbFetch(path, opts = {}) {
  if (!SB_URL || !SB_KEY) throw new Error("SUPABASE_URL/KEY no configuradas");
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${res.status}: ${err}`);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

/* ─── Sync de una empresa ─── */
/**
 * @param {string} empresaId
 * @param {{ minIntervaloMs?: number }} [opts] si la última sincronización fue
 *   hace menos de esto, no hace nada y devuelve { omitido: true }.
 */
export async function syncEmpresa(empresaId, { minIntervaloMs = 0 } = {}) {
  const cfg = await sbFetch(
    `config_sistema?empresa_id=eq.${empresaId}&clave=eq.proyectos_csv_url&select=valor&limit=1`
  );
  const csvUrl = cfg?.[0]?.valor?.url;
  if (!csvUrl) throw new Error("No hay URL de CSV configurada");
  const ultima = Date.parse(cfg?.[0]?.valor?.ultima_sync || "");
  if (minIntervaloMs > 0 && Number.isFinite(ultima) && Date.now() - ultima < minIntervaloMs) {
    return { omitido: true, procesados: 0, total: 0, repetidas: 0, errores: [] };
  }

  let parsed;
  try { parsed = new URL(csvUrl); } catch { throw new Error("URL de CSV inválida"); }
  if (parsed.protocol !== "https:") throw new Error("Solo se permiten URLs HTTPS");
  const host = parsed.hostname;
  if (host === "localhost" || host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    throw new Error("URL apunta a red privada");
  }

  const csvRes = await fetch(csvUrl, {
    headers: { "User-Agent": "Gypi-CSV-Sync/1.0" },
    signal: AbortSignal.timeout(10000),
  });
  if (!csvRes.ok) throw new Error(`HTTP ${csvRes.status} al descargar CSV`);
  const csvText = await csvRes.text();

  const { filas, repetidas } = parseCsvProyectos(csvText);
  if (!filas.length) throw new Error("CSV sin datos válidos (columna OT requerida)");

  let procesados = 0;
  const errores = [];
  // Sin la migración 091 la tabla no tiene `descripcion`: se reintenta sin ella
  // para que la sincronización no se corte.
  let conDescripcion = true;
  const subir = (batch) => sbFetch("proyectos?on_conflict=empresa_id,ot", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(conDescripcion ? batch : batch.map(({ descripcion, ...r }) => r)),
  });
  for (let i = 0; i < filas.length; i += BATCH) {
    const batch = filas.slice(i, i + BATCH).map(r => ({
      empresa_id:  empresaId,
      ot:          r.ot,
      cliente:     r.cliente,
      obra:        r.obra,
      proyecto:    r.proyecto,
      division:    r.division,
      descripcion: r.descripcion,
      estado:      "activo",
    }));
    try {
      // on_conflict explícito: sin esto, PostgREST usa la PK (id, siempre ausente
      // en este insert) como target de conflicto y el upsert por OT nunca matchea.
      try {
        await subir(batch);
      } catch (e) {
        if (!conDescripcion || !String(e.message).includes("descripcion")) throw e;
        conDescripcion = false;
        await subir(batch);
      }
      procesados += batch.length;
    } catch (e) {
      logger.error(`[proyectos/sync-csv] Error en lote ${Math.floor(i / BATCH) + 1}`, e);
      errores.push(`Lote ${Math.floor(i / BATCH) + 1}: ${safeErrorMessage(e)}`);
    }
  }

  // Actualizar última sync en config
  try {
    await sbFetch(
      `config_sistema?empresa_id=eq.${empresaId}&clave=eq.proyectos_csv_url`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          valor: { url: csvUrl, ultima_sync: new Date().toISOString() },
        }),
      }
    );
  } catch {}

  return { procesados, total: filas.length, repetidas, errores };
}

/** Sincroniza todas las empresas con planilla configurada; un error no frena a las demás. */
export async function syncTodas() {
  const rows = await sbFetch("config_sistema?clave=eq.proyectos_csv_url&select=empresa_id,valor&limit=500");
  const results = [];
  for (const row of rows || []) {
    if (!row.valor?.url) continue;
    try {
      const r = await syncEmpresa(row.empresa_id);
      results.push({ empresa_id: row.empresa_id, ...r });
    } catch (e) {
      results.push({ empresa_id: row.empresa_id, error: e.message });
    }
  }
  return results;
}
