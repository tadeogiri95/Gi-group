// app/lib/esquemaServidor.js — Corre el chequeo de la base (PR 7 de la
// auditoría) con la llave del servidor. Solo lee. Guarda el resultado 10
// minutos por instancia para no consultar a Supabase en cada Inicio.
import { MIGRACIONES, faltantesDesdeIndice, faltantesProbando, resumenFaltantes } from "./esquemaMigraciones";

const CACHE_MS = 10 * 60 * 1000;
let cache = null;

const headers = () => {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}` };
};

/** @returns {Promise<{ faltan: object[], metodo: "indice"|"tablas", revisado_at: string }>} */
export async function chequearEsquema({ forzar = false, fetchImpl = fetch, ahora = Date.now() } = {}) {
  if (!forzar && cache && ahora - cache.ts < CACHE_MS) return cache.valor;
  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`;
  let faltan = null;
  let metodo = "indice";
  try {
    const r = await fetchImpl(base, { headers: { ...headers(), Accept: "application/openapi+json" }, cache: "no-store" });
    if (r.ok) faltan = faltantesDesdeIndice(await r.json());
  } catch {
    faltan = null;
  }
  if (!faltan) {
    metodo = "tablas";
    faltan = await faltantesProbando(async (ruta) => {
      const r = await fetchImpl(base + ruta, { headers: headers(), cache: "no-store" });
      return r.status;
    });
  }
  const valor = { faltan: resumenFaltantes(faltan), metodo, revisado_at: new Date(ahora).toISOString(), total: MIGRACIONES.length };
  cache = { ts: ahora, valor };
  return valor;
}

export function _limpiarCacheEsquema() {
  cache = null;
}
