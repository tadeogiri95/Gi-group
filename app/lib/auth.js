// ═══════════════════════════════════════════════════════════
// app/lib/auth.js — Middleware de autenticación compartido
//
// ENTREGA 1A: Centraliza validarToken que antes estaba copiado
// en data/route.js, fichar/route.js, config-empresa/route.js,
// billing/info, billing/portal, billing/create-subscription.
//
// ÚNICO PUNTO DE VALIDACIÓN DE SESIÓN.
// Todos los routes protegidos importan de acá.
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// ─── Validar sesión contra la DB ───
// Extrae el Bearer token del header, llama a validar_sesion RPC,
// y devuelve { empleado_id, legajo, empresa_id, rol } o null.
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
