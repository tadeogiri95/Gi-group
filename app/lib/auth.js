// ═══════════════════════════════════════════════════════════
// app/lib/auth.js — Middleware de autenticación compartido
//
// ENTREGA 1A: validarToken + respuestaNoAutorizado
// ENTREGA 1B: + validarPassword (policy reforzada)
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// ─── Validar sesión contra la DB ───
export async function validarToken(request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token || token.length < 20) return null;

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
    return data && data.length > 0 ? data[0] : null;
  } catch {
    return null;
  }
}

// ─── Respuesta estándar 401 ───
export function respuestaNoAutorizado(mensaje) {
  return NextResponse.json(
    { error: mensaje || "No autorizado — sesión inválida o expirada" },
    { status: 401 }
  );
}

// ─── Validar contraseña (policy compartida) ───
// ENTREGA 1B: Min 8 chars, 1 mayúscula, 1 minúscula, 1 número.
// Usada en: login-empresa (cambiar_password), registro-empresa, unirse.
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
