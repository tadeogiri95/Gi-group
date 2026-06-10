// ═══════════════════════════════════════════════════════════
// app/lib/auth.js — Middleware de autenticación compartido
//
// ENTREGA 1A: validarToken + respuestaNoAutorizado
// ENTREGA 1B: + validarPassword
// ENTREGA 1E: validarToken ahora intenta JWT primero (rápido,
//   sin DB hit). Si falla, fallback a RPC validar_sesion
//   para tokens legacy que aún estén activos.
//   Después de 30 días del deploy, eliminar el fallback.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { verifyToken } from "./jwt";
export { validarPassword } from "./validators";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// ─── Validar sesión: JWT primero, fallback a DB ───
export async function validarToken(request) {
  // Cookie httpOnly tiene prioridad (Sprint 2); Authorization header como fallback
  const cookieToken = request.cookies?.get?.('gypi_token')?.value;
  const authHeader = request.headers.get("authorization");
  const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const token = cookieToken || headerToken;
  if (!token || token.length < 20) return null;

  // ═══ INTENTO 1: JWT (rápido, sin DB) ═══
  // Los JWT de Gypi empiezan con "eyJ" (base64 de {"alg":...})
  if (token.startsWith("eyJ")) {
    try {
      const payload = await verifyToken(token);
      if (payload && payload.sub && payload.eid) {
        // Verificar que no sea un refresh token usado como access token
        if (payload.type === "refresh") return null;

        return {
          empleado_id: payload.sub,
          empresa_id: payload.eid,
          legajo: payload.leg,
          rol: payload.rol,
          jti: payload.jti,
          // Marcar que vino por JWT (útil para logging/debugging)
          _auth_method: "jwt",
        };
      }
    } catch {
      // JWT inválido o expirado → no intentar fallback si era JWT
      // (un JWT malformado no debería caer al flujo legacy)
      return null;
    }
  }

  return null;
}

// ─── Respuesta estándar 401 ───
export function respuestaNoAutorizado(mensaje) {
  return NextResponse.json(
    { error: mensaje || "No autorizado — sesión inválida o expirada" },
    { status: 401 }
  );
}

