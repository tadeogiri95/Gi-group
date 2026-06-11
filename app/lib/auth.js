// ═══════════════════════════════════════════════════════════
// app/lib/auth.js — Middleware de autenticación compartido
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { verifyToken } from "./jwt";
export { validarPassword } from "./validators";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// ─── Validar sesión: verifica firma JWT + revocación en DB ───
export async function validarToken(request) {
  const cookieToken = request.cookies?.get?.("gypi_token")?.value;
  const authHeader = request.headers.get("authorization");
  const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const token = cookieToken || headerToken;
  if (!token || token.length < 20) return null;

  if (!token.startsWith("eyJ")) return null;

  let payload;
  try {
    payload = await verifyToken(token);
  } catch {
    return null;
  }

  if (!payload || !payload.sub || !payload.eid) return null;
  if (payload.type === "refresh") return null;

  // Tokens de impersonación (1h) se validan solo por firma — no tienen sesión en DB.
  // Consultamos por la columna `token` (existe desde el schema base) que almacena el jti.
  // La columna `jti` (migración 010) es un alias indexado que puede no estar aplicada aún.
  if (!payload.imp && payload.jti && SB_URL && SB_KEY) {
    try {
      const r = await fetch(
        `${SB_URL}/rest/v1/sesiones?token=eq.${payload.jti}&select=id&limit=1`,
        { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
      );
      if (r.ok) {
        // Solo bloqueamos si Supabase confirmó explícitamente que no existe la sesión.
        // Si la respuesta no es un array (error de schema, permiso, etc.) → fail-open.
        const rows = await r.json();
        if (Array.isArray(rows) && rows.length === 0) return null;
      }
      // r.ok = false → error de DB/RLS → fail-open (no expulsamos si Supabase falla)
    } catch {
      // Error de red o parsing → fail-open
    }
  }

  return {
    empleado_id: payload.sub,
    empresa_id: payload.eid,
    legajo: payload.leg,
    rol: payload.rol,
    jti: payload.jti,
    imp: payload.imp || false,
    _auth_method: "jwt",
  };
}

// ─── Respuesta estándar 401 ───
export function respuestaNoAutorizado(mensaje) {
  return NextResponse.json(
    { error: mensaje || "No autorizado — sesión inválida o expirada" },
    { status: 401 }
  );
}

