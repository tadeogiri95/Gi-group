// ═══════════════════════════════════════════════════════════
// app/lib/db.js — Helper REST de Supabase (fuente única)
//
// Usar en todos los nuevos route handlers en lugar de definir
// sbGet/sbPost/sbPatch localmente en cada archivo.
// ═══════════════════════════════════════════════════════════

function headers(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

const BASE = () => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;

export async function dbGet(path) {
  const r = await fetch(`${BASE()}/${path}`, { headers: headers() });
  if (!r.ok) throw new Error(`DB GET ${path}: ${await r.text()}`);
  return r.json();
}

export async function dbPost(path, body) {
  const r = await fetch(`${BASE()}/${path}`, {
    method: "POST",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`DB POST ${path}: ${await r.text()}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

export async function dbPatch(path, body) {
  const r = await fetch(`${BASE()}/${path}`, {
    method: "PATCH",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`DB PATCH ${path}: ${await r.text()}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

export async function dbDelete(path) {
  const r = await fetch(`${BASE()}/${path}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!r.ok) throw new Error(`DB DELETE ${path}: ${await r.text()}`);
  return null;
}

export async function dbRpc(fnName, params) {
  const r = await fetch(`${BASE()}/rpc/${fnName}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(params),
  });
  if (!r.ok) throw new Error(`DB RPC ${fnName}: ${await r.text()}`);
  return r.json();
}
