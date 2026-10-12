// ═══════════════════════════════════════════════════════════
// app/lib/sbHelpers.js — Supabase REST helpers (server-side)
//
// ENTREGA 2G: Centraliza sbGet/sbPost/sbPatch/sbDelete/sbRpc
// que estaban copiados verbatim en 8 API routes.
//
// Usa la service_role_key (server-side only).
// Por defecto lanza error si el request falla (throw on !ok).
// Con { silent: true } retorna null/[] en vez de lanzar.
//
// Uso:
//   import { sbGet, sbPost, sbPatch, sbDelete, sbRpc } from "../../lib/sbHelpers";
//   const empleados = await sbGet("empleados?activo=eq.true");
//   await sbPost("fichadas", { legajo: 1, fecha: "2025-01-01" });
//   await sbPatch("empleados?id=eq.123", { nombre: "Juan" });
//   await sbRpc("crear_sesion", { p_empleado_id: "..." });
//
// Para rutas que necesitan no lanzar (webhook, login):
//   const data = await sbGet("tabla?...", { silent: true }); // null si falla
//
// RLS por usuario (ítem 37, etapa 2): con { sesion } y RLS_RUTAS=on la consulta
// va con el pase del usuario (rol authenticated + claim eid) y la base aplica
// la separación por empresa por su cuenta. Sin { sesion }, o con el
// interruptor apagado, sigue con service_role como siempre.
//   await sbGet(`documentos_empleado?id=eq.${id}`, { sesion });
// ═══════════════════════════════════════════════════════════

import { rlsRutasActivo, configRlsFaltante, headersUsuario } from "./supabaseUsuario";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// Exportado para rutas que arman su propio fetch (timeouts, count=exact).
export async function sbHeaders(opts = {}, extra = {}) {
  if (opts.sesion && rlsRutasActivo()) {
    // Con el interruptor prendido y sin configuración se corta (fail-closed)
    // en vez de volver en silencio a la llave maestra.
    const faltan = configRlsFaltante();
    if (faltan.length) throw new Error(`RLS_RUTAS=on pero falta configuración: ${faltan.join(", ")}`);
    return { ...(await headersUsuario(opts.sesion)), "Content-Type": "application/json", ...extra };
  }
  return {
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

// ─── GET ───
// `silent` debe cubrir tanto !r.ok como fetch() lanzando (red caída, mock sin
// handler en tests) — antes solo cubría !r.ok, dejando pasar el throw de fetch().
export async function sbGet(path, opts = {}) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
      headers: await sbHeaders(opts),
    });
    if (!r.ok) {
      if (opts.silent) return opts.fallback ?? null;
      throw new Error(`GET ${path}: ${await r.text()}`);
    }
    return r.json();
  } catch (e) {
    if (opts.silent) return opts.fallback ?? null;
    throw e;
  }
}

// ─── GET de todas las páginas ───
// PostgREST (Supabase) corta cada respuesta en "max rows" (1000) SIN avisar.
// Para rangos que pueden pasarse (fichadas de un mes, etc.) se pagina con
// limit/offset. `path` debe tener un order= con desempate único (p. ej.
// order=fecha.asc,id.asc) para que las páginas no se pisen.
// Devuelve { data, truncado }: truncado=true si se llegó a maxFilas.
export async function sbGetAll(path, { pageSize = 1000, maxFilas = 20000, sesion } = {}) {
  const sep = path.includes("?") ? "&" : "?";
  const data = [];
  for (let offset = 0; offset < maxFilas; offset += pageSize) {
    const page = await sbGet(`${path}${sep}limit=${pageSize}&offset=${offset}`, { sesion });
    data.push(...(page || []));
    if (!page || page.length < pageSize) return { data, truncado: false };
  }
  return { data, truncado: true };
}

// ─── POST (con return=representation) ───
export async function sbPost(path, body, opts = {}) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
      method: "POST",
      headers: await sbHeaders(opts, { Prefer: "return=representation" }),
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      if (opts.silent) return opts.fallback ?? null;
      throw new Error(`POST ${path}: ${await r.text()}`);
    }
    return r.json();
  } catch (e) {
    if (opts.silent) return opts.fallback ?? null;
    throw e;
  }
}

// ─── PATCH (con return=representation) ───
export async function sbPatch(path, body, opts = {}) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
      method: "PATCH",
      headers: await sbHeaders(opts, { Prefer: "return=representation" }),
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      if (opts.silent) return opts.fallback ?? null;
      throw new Error(`PATCH ${path}: ${await r.text()}`);
    }
    return r.json();
  } catch (e) {
    if (opts.silent) return opts.fallback ?? null;
    throw e;
  }
}

// ─── PATCH sin representation (webhook style: retorna boolean) ───
export async function sbPatchOk(path, body, opts = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: await sbHeaders(opts),
    body: JSON.stringify(body),
  });
  return r.ok;
}

// ─── DELETE ───
export async function sbDelete(path, opts = {}) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
      method: "DELETE",
      headers: await sbHeaders(opts),
    });
    if (!r.ok && !opts.silent) {
      throw new Error(`DELETE ${path}: ${await r.text()}`);
    }
    return r.ok;
  } catch (e) {
    if (opts.silent) return false;
    throw e;
  }
}

// ─── RPC (funciones SQL) ───
export async function sbRpc(fnName, params = {}, opts = {}) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/${fnName}`, {
      method: "POST",
      headers: await sbHeaders(opts),
      body: JSON.stringify(params),
    });
    if (!r.ok) {
      if (opts.silent) return opts.fallback ?? null;
      throw new Error(`RPC ${fnName}: ${await r.text()}`);
    }
    return r.json();
  } catch (e) {
    if (opts.silent) return opts.fallback ?? null;
    throw e;
  }
}
