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

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// ─── Validar sesión: JWT primero, fallback a DB ───
export async function validarToken(request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
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

  // ═══ INTENTO 2: Token legacy (hex random → validar_sesion RPC) ═══
  // TEMPORAL: eliminar este bloque 30 días después del deploy de 1E.
  // Para esa fecha todas las sesiones legacy habrán expirado.
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/validar_sesion`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_token: token }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.length > 0) {
      return { ...data[0], _auth_method: "legacy_rpc" };
    }
  } catch {
    // silently fail
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

// ─── Validar contraseña (policy compartida) ───
export function validarPassword(pw) {
  if (!pw || typeof pw !== "string") {
    return { valido: false, error: "La contraseña es requerida" };
  }
  if (pw.length < 8) {
    return { valido: false, error: "La contraseña debe tener al menos 8 caracteres" };
  }
  if (!/[A-Z]/.test(pw)) {
    return { valido: false, error: "Debe contener al menos una letra mayúscula" };
  }
  if (!/[a-z]/.test(pw)) {
    return { valido: false, error: "Debe contener al menos una letra minúscula" };
  }
  if (!/[0-9]/.test(pw)) {
    return { valido: false, error: "Debe contener al menos un número" };
  }
  return { valido: true };
}
