// app/lib/syncOt.js — Sincroniza las OT de una empresa desde su planilla
// (CSV publicado, URL en config_sistema clave proyectos_csv_url).
// Lo usan /api/proyectos/sync-csv (botón Sincronizar, y el empleado que no
// encuentra una OT) y /api/cron/sync-ot (todas las mañanas).

import { logger } from "./logger";
import { safeErrorMessage } from "./validate";
import { parseCsvProyectos, CAMPOS_MATERIAL, linksPlanilla } from "./csvProyectos";
import { sbHeaders } from "./sbHelpers";
import { CLAVE_FECHA_OBJETIVO, normalizarModo, fechaObjetivo } from "./semanaObjetivo";
import { resolverSemana } from "./semanaEditable";
import { hoyArg } from "./dates";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const BATCH = 100;

/* ─── Supabase helper ───
 * Con `sesion` y RLS_RUTAS=on va con el pase del usuario (ítem 37, etapa 2);
 * sin sesión (el cron, que recorre todas las empresas) sigue con service_role. */
async function sbFetch(path, opts = {}, sesion) {
  if (!SB_URL || !SB_KEY) throw new Error("SUPABASE_URL/KEY no configuradas");
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: await sbHeaders({ sesion }, { Prefer: "return=representation", ...opts.headers }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${res.status}: ${err}`);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

/* ─── Descarga de una planilla publicada como CSV ───
 * Solo HTTPS y nunca a la red interna. También la usa la planilla MRP (syncStock.js).
 *
 * Google tarda en armar la hoja de un libro pesado (el MRP), así que se espera
 * hasta 25 s y, si falla por tiempo, red o un error de Google (5xx), se
 * reintenta una vez. Un 4xx (link mal, hoja sin publicar) no se reintenta. */
const ESPERA_CSV_MS = 25000;
const PAUSA_REINTENTO_MS = 1000;

/** Las hojas publicadas de Google se guardan un rato en caché: un parámetro
 *  distinto en cada pedido hace que traiga la copia más nueva que tenga. */
export function urlSinCache(csvUrl, ahora = Date.now()) {
  const u = new URL(csvUrl);
  if (u.hostname !== "docs.google.com") return csvUrl;
  u.searchParams.set("_gypi", String(ahora));
  return u.toString();
}

export async function descargarCsv(csvUrl, { reintentos = 1, pausaMs = PAUSA_REINTENTO_MS } = {}) {
  let parsed;
  try { parsed = new URL(csvUrl); } catch { throw new Error("URL de CSV inválida"); }
  if (parsed.protocol !== "https:") throw new Error("Solo se permiten URLs HTTPS");
  const host = parsed.hostname;
  if (host === "localhost" || host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    throw new Error("URL apunta a red privada");
  }

  for (let intento = 0; ; intento++) {
    let reintentable;
    try {
      const csvRes = await fetch(urlSinCache(csvUrl), {
        headers: { "User-Agent": "Gypi-CSV-Sync/1.0", "Cache-Control": "no-cache" },
        cache: "no-store",
        signal: AbortSignal.timeout(ESPERA_CSV_MS),
      });
      if (csvRes.ok) return csvRes.text();
      reintentable = csvRes.status >= 500;
      if (!reintentable || intento >= reintentos) throw new Error(`HTTP ${csvRes.status} al descargar CSV`);
    } catch (e) {
      if (reintentable === false || intento >= reintentos) {
        if (e?.name === "TimeoutError") throw new Error("la planilla tardó demasiado en responder");
        throw e;
      }
    }
    logger.warn(`[csv] reintento ${intento + 1} de ${host}`);
    if (pausaMs) await new Promise((r) => setTimeout(r, pausaMs));
  }
}

/* ─── Varias hojas ───
 * Las obras grandes tienen su hoja propia en el Plan de trabajo (OCAMPOURB,
 * MALMÖ…) y en la hoja PLAN queda un solo renglón resumen ("M-7751"). Cada
 * hoja se publica por separado (linksPlanilla). */

/** Junta las OT de varias hojas (ya leídas, en el orden de los links). Si una
 *  OT está en más de una hoja vale la primera, para no sumar dos veces su
 *  cantidad ni su material. */
export function juntarHojas(hojas) {
  const porOt = new Map();
  let repetidas = 0;
  let enVariasHojas = 0;
  for (const hoja of hojas) {
    repetidas += hoja.repetidas || 0;
    for (const fila of hoja.filas) {
      if (porOt.has(fila.ot)) { enVariasHojas++; continue; }
      porOt.set(fila.ot, fila);
    }
  }
  return { filas: [...porOt.values()], repetidas, enVariasHojas };
}

/* ─── Sync de una empresa ─── */
/**
 * @param {string} empresaId
 * @param {{ minIntervaloMs?: number, sesion?: object }} [opts] si la última
 *   sincronización fue hace menos de minIntervaloMs, no hace nada y devuelve
 *   { omitido: true }. Con `sesion`, la base se consulta con el pase del usuario.
 */
export async function syncEmpresa(empresaId, { minIntervaloMs = 0, sesion } = {}) {
  const cfg = await sbFetch(
    `config_sistema?empresa_id=eq.${empresaId}&clave=eq.proyectos_csv_url&select=valor&limit=1`,
    {},
    sesion
  );
  const valorCfg = cfg?.[0]?.valor;
  const links = linksPlanilla(valorCfg);
  if (!links.length) throw new Error("No hay URL de CSV configurada");
  const ultima = Date.parse(valorCfg?.ultima_sync || "");
  if (minIntervaloMs > 0 && Number.isFinite(ultima) && Date.now() - ultima < minIntervaloMs) {
    return { omitido: true, procesados: 0, total: 0, repetidas: 0, errores: [] };
  }

  // Todas las hojas a la vez. Si falla la principal se corta como siempre; si
  // falla otra, se sincroniza lo demás y se avisa cuál no se pudo leer.
  const errores = [];
  const descargas = await Promise.allSettled(links.map((u) => descargarCsv(u)));
  if (descargas[0].status === "rejected") throw descargas[0].reason;
  const hojas = [];
  descargas.forEach((d, i) => {
    if (d.status === "rejected") { errores.push(`Hoja ${i + 1}: ${safeErrorMessage(d.reason)}`); return; }
    const hoja = parseCsvProyectos(d.value);
    if (i > 0 && !hoja.filas.length) errores.push(`Hoja ${i + 1}: sin OT (falta la columna OT)`);
    hojas.push(hoja);
  });
  const { filas, repetidas, enVariasHojas } = juntarHojas(hojas);
  if (!hojas[0].filas.length) throw new Error("CSV sin datos válidos (columna OT requerida)");

  // Fecha objetivo de cada OT (135): según cómo cuenta las semanas la empresa.
  // La fecha que ya tenía una OT abierta se respeta si es de la misma semana
  // (no cambia de año sola).
  const [cfgModo, previas] = await Promise.all([
    sbFetch(`config_sistema?empresa_id=eq.${empresaId}&clave=eq.${CLAVE_FECHA_OBJETIVO}&select=valor&limit=1`, {}, sesion).catch(() => null),
    sbFetch(`proyectos?empresa_id=eq.${empresaId}&estado=neq.cerrado&fecha_objetivo=not.is.null&select=ot,fecha_objetivo`, {}, sesion).catch(() => null),
  ]);
  const modo = normalizarModo(cfgModo?.[0]?.valor?.modo);
  const fechaPrevia = new Map((previas || []).map((p) => [String(p.ot), p.fecha_objetivo]));
  // SEMANA cambiada en Gypi (144): sigue la de Gypi hasta que llega a la
  // planilla, salvo que la planilla haya cambiado después (gana la más reciente)
  const cambiadas = await sbFetch(`proyectos?empresa_id=eq.${empresaId}&semana_app=not.is.null&select=ot,semana_app,semana_app_at,semana_planilla`, {}, sesion).catch(() => null);
  const conSemana144 = Array.isArray(cambiadas);
  const semanaApp = new Map((cambiadas || []).map((p) => [String(p.ot), p]));
  const ultimaSync = valorCfg?.ultima_sync || null;
  const hoy = hoyArg();

  let procesados = 0;
  // Columnas que agregaron migraciones posteriores (091: descripcion; 097:
  // fecha_entrega, cantidad, terminado_planilla; 101: total_modulos; 135:
  // semana_objetivo, fecha_objetivo; 136: placas, fondos, metros_canto,
  // placas_mecanizadas). Si la base todavía no tiene alguna, se
  // reintenta sin ella para que la sincronización no se corte.
  const omitidas = new Set();
  const OPCIONALES = ["descripcion", "fecha_entrega", "cantidad", "terminado_planilla", "total_modulos", "semana_objetivo", "fecha_objetivo", "semana_app_at", "semana_app", "semana_planilla", ...CAMPOS_MATERIAL];
  if (!conSemana144) ["semana_app", "semana_app_at", "semana_planilla"].forEach((c) => omitidas.add(c));
  const subir = (batch) => sbFetch("proyectos?on_conflict=empresa_id,ot", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(batch.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !omitidas.has(k))))),
  }, sesion);
  for (let i = 0; i < filas.length; i += BATCH) {
    // Sin `estado`: las nuevas toman el valor por defecto y abajo la columna
    // TERMINADO cierra o reabre las que están en la planilla.
    const batch = filas.slice(i, i + BATCH).map(r => {
      const sem = resolverSemana(semanaApp.get(String(r.ot)), r.semana_objetivo ?? null, ultimaSync);
      return {
      empresa_id:         empresaId,
      ot:                 r.ot,
      cliente:            r.cliente,
      obra:               r.obra,
      proyecto:           r.proyecto,
      division:           r.division,
      descripcion:        r.descripcion,
      fecha_entrega:      r.fecha_entrega,
      cantidad:           r.cantidad,
      terminado_planilla: r.terminado_planilla,
      semana_objetivo:    sem.semana,
      fecha_objetivo:     fechaObjetivo({ ...r, semana_objetivo: sem.semana }, { modo, hoy, previa: fechaPrevia.get(String(r.ot)) }),
      semana_app:         sem.semana_app,
      semana_app_at:      sem.semana_app_at,
      semana_planilla:    sem.semana_planilla,
      // Solo si la planilla tiene la columna (todas las filas la traen o
      // ninguna: PostgREST pide las mismas claves en todo el lote)
      ...("total_modulos" in r ? { total_modulos: r.total_modulos } : {}),
      ...Object.fromEntries(CAMPOS_MATERIAL.filter((k) => k in r).map((k) => [k, r[k]])),
      };
    });
    try {
      // on_conflict explícito: sin esto, PostgREST usa la PK (id, siempre ausente
      // en este insert) como target de conflicto y el upsert por OT nunca matchea.
      for (;;) {
        try {
          await subir(batch);
          break;
        } catch (e) {
          const falta = OPCIONALES.find(c => !omitidas.has(c) && String(e.message).includes(c));
          if (!falta) throw e;
          omitidas.add(falta);
        }
      }
      procesados += batch.length;
    } catch (e) {
      logger.error(`[proyectos/sync-csv] Error en lote ${Math.floor(i / BATCH) + 1}`, e);
      errores.push(`Lote ${Math.floor(i / BATCH) + 1}: ${safeErrorMessage(e)}`);
    }
  }

  // Las OT nuevas quedan activas. La 097 pone 'activo' como valor por defecto;
  // esto cubre la base que todavía no la tiene (estado vacío).
  try {
    await sbFetch(
      `proyectos?empresa_id=eq.${empresaId}&estado=is.null`,
      { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ estado: "activo" }) },
      sesion
    );
  } catch (e) {
    logger.error("[proyectos/sync-csv] No se pudo activar las OT nuevas", e);
  }

  // La planilla manda en el estado: TERMINADO = SI cierra la OT y NO (o vacío)
  // la vuelve a abrir. Solo se reabren las OT que están en esta planilla: una
  // OT cargada a mano en la app, o que ya no figura en la planilla, queda como
  // esté. Sin la columna TERMINADO no se toca nada.
  if (!omitidas.has("terminado_planilla")) {
    try {
      await sbFetch(
        `proyectos?empresa_id=eq.${empresaId}&terminado_planilla=is.true&estado=neq.cerrado`,
        { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ estado: "cerrado" }) },
        sesion
      );
    } catch (e) {
      logger.error("[proyectos/sync-csv] No se pudo cerrar las OT terminadas", e);
    }
    const abiertas = filas.filter((r) => r.terminado_planilla === false).map((r) => r.ot);
    for (let i = 0; i < abiertas.length; i += BATCH) {
      const lista = abiertas.slice(i, i + BATCH).map((ot) => encodeURIComponent(`"${String(ot).replace(/"/g, '\\"')}"`)).join(",");
      try {
        await sbFetch(
          `proyectos?empresa_id=eq.${empresaId}&estado=eq.cerrado&terminado_planilla=is.false&ot=in.(${lista})`,
          { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ estado: "activo" }) },
          sesion
        );
      } catch (e) {
        logger.error("[proyectos/sync-csv] No se pudo reabrir las OT no terminadas", e);
        break;
      }
    }
  }

  // PRECIO de cada OT (142, columna AE del Plan de trabajo): va a precios_ot,
  // que solo leen Dueño y Administración. Se escribe con service_role a
  // propósito: el botón Sincronizar también lo aprieta un operario que busca
  // su OT, y la RLS de precios_ot no le deja ver (ni pisar) esas filas.
  // Sin la columna en la planilla no se toca nada; sin la migración, se sigue.
  const conPrecio = filas.filter((r) => "precio" in r);
  for (let i = 0; i < conPrecio.length; i += BATCH) {
    try {
      await sbFetch("precios_ot?on_conflict=empresa_id,ot", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(conPrecio.slice(i, i + BATCH).map((r) => ({ empresa_id: empresaId, ot: r.ot, precio: r.precio, updated_at: new Date().toISOString() }))),
      });
    } catch (e) {
      logger.error("[proyectos/sync-csv] No se pudieron guardar los precios (¿falta la migración 142?)", e);
      break;
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
          valor: { ...valorCfg, ultima_sync: new Date().toISOString() },
        }),
      },
      sesion
    );
  } catch {}

  return { procesados, total: filas.length, repetidas, enVariasHojas, hojas: links.length, errores };
}

/** Sincroniza todas las empresas con planilla configurada; un error no frena a las demás. */
export async function syncTodas() {
  const rows = await sbFetch("config_sistema?clave=eq.proyectos_csv_url&select=empresa_id,valor&limit=500");
  const results = [];
  for (const row of rows || []) {
    if (!linksPlanilla(row.valor).length) continue;
    try {
      const r = await syncEmpresa(row.empresa_id);
      results.push({ empresa_id: row.empresa_id, ...r });
    } catch (e) {
      results.push({ empresa_id: row.empresa_id, error: e.message });
    }
  }
  return results;
}
