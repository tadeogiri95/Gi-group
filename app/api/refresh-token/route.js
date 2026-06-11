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
import { verifyToken, signAccessToken } from "../../lib/jwt";
import { logger } from "../../lib/logger";

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
    const body = await request.json().catch(() => ({}));
    // Cookie httpOnly tiene prioridad; body como fallback para clientes legacy
    const refresh_token = request.cookies?.get?.('gypi_refresh')?.value || body.refresh_token;

    if (!refresh_token) {
      return NextResponse.json({ error: "refresh_token requerido" }, { status: 400 });
    }

    // Verificar refresh token
    const payload = await verifyToken(refresh_token);
    if (!payload || payload.type !== "refresh") {
      return NextResponse.json({ error: "Refresh token inválido o expirado" }, { status: 401 });
    }

    // Verificar que la sesión no fue revocada.
    // Primero intenta por refresh_jti (preciso). Si falla o no encuentra nada
    // (columna con NULL en sesiones viejas), hace fallback: chequea que exista
    // al menos una sesión activa para este empleado. Solo bloquea si el
    // empleado no tiene NINGUNA sesión (logout-all o revocación explícita).
    let sesiones = await sbGet(
      `sesiones?refresh_jti=eq.${payload.jti}&select=id&limit=1`
    );
    if (!Array.isArray(sesiones) || sesiones.length === 0) {
      // Fallback: chequear por empleado_id
      sesiones = await sbGet(
        `sesiones?empleado_id=eq.${payload.sub}&select=id&limit=1`
      );
      if (Array.isArray(sesiones) && sesiones.length === 0) {
        return NextResponse.json(
          { error: "Sesión revocada. Iniciá sesión de nuevo." },
          { status: 401 }
        );
      }
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
      logger.error("Error actualizando jti en sesión", e);
    }

    const isProd = process.env.NODE_ENV === "production";
    const res = NextResponse.json({
      token: newAccessToken,
      expires_in: 7 * 24 * 60 * 60,
    });
    res.cookies.set({
      name: "gypi_token",
      value: newAccessToken,
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
    return res;
  } catch (err) {
    logger.error("refresh-token error", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
