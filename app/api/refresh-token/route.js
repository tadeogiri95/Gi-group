// ═══════════════════════════════════════════════════════════
// POST /api/refresh-token
// Body: { refresh_token: "eyJ..." }
// Retorna: { token, expires_in }
//
// ENTREGA 1E: Recibe un refresh token válido y devuelve
// un nuevo access token. No genera nuevo refresh token
// (el refresh original sigue válido hasta su expiración de 30d).
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { verifyToken } from "../../lib/jwt";
import { signAccessToken } from "../../lib/jwt";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) return null;
  return r.json();
}

export async function POST(request) {
  try {
    const { refresh_token } = await request.json();

    if (!refresh_token) {
      return NextResponse.json({ error: "refresh_token requerido" }, { status: 400 });
    }

    // Verificar refresh token
    const payload = await verifyToken(refresh_token);
    if (!payload || payload.type !== "refresh") {
      return NextResponse.json({ error: "Refresh token inválido o expirado" }, { status: 401 });
    }

    // Verificar que la sesión no fue revocada
    // (buscamos por refresh_jti en la tabla sesiones)
    const sesiones = await sbGet(
      `sesiones?refresh_jti=eq.${payload.jti}&select=id,empleado_id,empresa_id`
    );
    if (!sesiones || sesiones.length === 0) {
      return NextResponse.json(
        { error: "Sesión revocada. Iniciá sesión de nuevo." },
        { status: 401 }
      );
    }

    // Verificar que el empleado sigue activo
    const empleados = await sbGet(
      `empleados?id=eq.${payload.sub}&activo=eq.true&select=id,legajo,empresa_id,rol`
    );
    if (!empleados || empleados.length === 0) {
      return NextResponse.json(
        { error: "Usuario inactivo. Contactá a tu administrador." },
        { status: 401 }
      );
    }

    const emp = empleados[0];

    // Generar nuevo access token
    const { token: newAccessToken, jti: newJti } = await signAccessToken({
      empleadoId: emp.id,
      empresaId: emp.empresa_id,
      legajo: emp.legajo,
      rol: emp.rol,
    });

    // Actualizar el jti en la sesión (para tracking)
    try {
      await fetch(`${SB_URL}/rest/v1/sesiones?id=eq.${sesiones[0].id}`, {
        method: "PATCH",
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jti: newJti }),
      });
    } catch (e) {
      // No bloquea el refresh si falla el update
      console.error("[refresh] Error actualizando jti:", e.message);
    }

    return NextResponse.json({
      token: newAccessToken,
      expires_in: 7 * 24 * 60 * 60,
    });
  } catch (err) {
    console.error("[refresh-token] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
