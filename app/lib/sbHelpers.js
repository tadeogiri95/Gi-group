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
// ═══════════════════════════════════════════════════════════

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

function headers(extra = {}) {
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
      headers: headers(),
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

// ─── POST (con return=representation) ───
export async function sbPost(path, body, opts = {}) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
      method: "POST",
      headers: headers({ Prefer: "return=representation" }),
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
      headers: headers({ Prefer: "return=representation" }),
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
export async function sbPatchOk(path, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(body),
  });
  return r.ok;
}

// ─── DELETE ───
export async function sbDelete(path, opts = {}) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
      method: "DELETE",
      headers: headers(),
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
      headers: headers(),
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
