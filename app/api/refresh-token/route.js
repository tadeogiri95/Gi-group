// ═══════════════════════════════════════════════════════════
// POST /api/refresh-token
// Body: { refresh_token: "eyJ..." }
// Retorna: { token, expires_in }
//
// Recibe un refresh token válido, emite un nuevo access token
// y rota el refresh token (el viejo queda invalidado inmediatamente).
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { verifyToken, signAccessToken, signRefreshToken } from "../../lib/jwt";
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
      // Fallback solo para sesiones legacy (refresh_jti IS NULL — anteriores a la rotación).
      // Sesiones nuevas que no matchean por JTI son tokens ya rotados: 401.
      sesiones = await sbGet(
        `sesiones?empleado_id=eq.${payload.sub}&refresh_jti=is.null&select=id&limit=1`
      );
      if (!Array.isArray(sesiones) || sesiones.length === 0) {
        return NextResponse.json(
          { error: "Sesión revocada o token ya usado. Iniciá sesión de nuevo." },
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

    // Generar nuevo access token + nuevo refresh token (rotación)
    const [{ token: newAccessToken, jti: newJti }, { token: newRefreshToken, jti: newRefreshJti }] =
      await Promise.all([
        signAccessToken({
          empleadoId: emp.id,
          empresaId: emp.empresa_id,
          legajo: emp.legajo,
          rol: emp.rol,
        }),
        signRefreshToken({
          empleadoId: emp.id,
          empresaId: emp.empresa_id,
        }),
      ]);

    // Actualizar sesión: nuevo access JTI + nuevo refresh JTI.
    // El viejo refresh_jti queda invalidado — si alguien lo intenta usar
    // ya no matchea por refresh_jti=eq.{oldJti} ni por el fallback legacy.
    // Este PATCH es parte del camino crítico: si falla no emitimos tokens
    // para mantener la garantía de rotación. El cliente reintentará.
    if (sesiones?.[0]?.id) {
      const patchRes = await fetch(`${SB_URL}/rest/v1/sesiones?id=eq.${sesiones[0].id}`, {
        method: "PATCH",
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: newJti, jti: newJti, refresh_jti: newRefreshJti }),
      });
      if (!patchRes.ok) {
        const errText = await patchRes.text();
        logger.error("refresh-token: fallo al actualizar sesión — abortando rotación", new Error(errText));
        return NextResponse.json({ error: "Error de sesión. Reintentá en unos segundos." }, { status: 503 });
      }
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
    res.cookies.set({
      name: "gypi_refresh",
      value: newRefreshToken,
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    return res;
  } catch (err) {
    logger.error("refresh-token error", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
