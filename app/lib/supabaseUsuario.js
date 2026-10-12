// ═══════════════════════════════════════════════════════════
// app/lib/supabaseUsuario.js — Pase de Supabase por usuario (RLS real, ítem 37)
//
// Firma un JWT corto con la clave propia de Supabase (SUPABASE_JWT_SECRET)
// con rol `authenticated` y el claim `eid`. Con ese pase, Supabase aplica las
// policies `tenant_isolation_auth_*` (migraciones 050, 058 y 089): aunque el
// código tuviera un error, la base no devuelve ni toca filas de otra empresa.
//
// Se activa con RLS_API_DATA=on. Apagado, todo sigue con service_role.
// ═══════════════════════════════════════════════════════════

import { SignJWT } from "jose";

const DURACION_SEGUNDOS = 5 * 60;

export function rlsActivo() {
  return process.env.RLS_API_DATA === "on";
}

// Falta de configuración con el interruptor prendido: se corta (fail-closed)
// en vez de volver en silencio a la llave maestra.
export function configRlsFaltante() {
  const faltan = [];
  if (!process.env.SUPABASE_JWT_SECRET) faltan.push("SUPABASE_JWT_SECRET");
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) faltan.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return faltan;
}

export async function firmarPaseSupabase(sesion) {
  const secreto = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
  return new SignJWT({ role: "authenticated", eid: sesion.empresa_id, rol: sesion.rol })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(String(sesion.empleado_id))
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime(`${DURACION_SEGUNDOS}s`)
    .sign(secreto);
}

// Headers para PostgREST con el pase del usuario (la anon key identifica el
// proyecto; el Authorization define el rol y los claims que ve la RLS).
export async function headersUsuario(sesion) {
  const pase = await firmarPaseSupabase(sesion);
  return {
    apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${pase}`,
  };
}
