// ═══════════════════════════════════════════════════════════
// POST /api/refresh-token
// Body: { refresh_token: "eyJ..." }
// Retorna: { token, expires_in }
//
// Recibe un refresh token válido, emite un nuevo access token
// y rota el refresh token. El viejo sigue valiendo 2 minutos (migración 212)
// para que dos pestañas que renuevan juntas, o una respuesta perdida por un
// corte de señal, no cierren la sesión.
//
// 401 = la sesión venció de verdad (el navegador cierra la sesión).
// 503 = problema pasajero de la base (el navegador reintenta, no la cierra).
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { verifyToken, signAccessToken, signRefreshToken } from "../../lib/jwt";
import { logger } from "../../lib/logger";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// Cuánto tiempo sigue valiendo el refresh token recién reemplazado.
const GRACIA_MS = 2 * 60 * 1000;

const sbHeaders = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` });

// GET a la base que distingue "no hay filas" de "la base no respondió".
async function buscarSesion(path) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHeaders() });
    if (!r.ok) return { error: true, filas: [] };
    const filas = await r.json();
    return { error: false, filas: Array.isArray(filas) ? filas : [] };
  } catch {
    return { error: true, filas: [] };
  }
}

async function patchSesion(id, body) {
  try {
    return await fetch(`${SB_URL}/rest/v1/sesiones?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...sbHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

// 503: problema pasajero, el navegador reintenta sin cerrar la sesión.
function respuestaReintentar() {
  return NextResponse.json({ error: "Error de sesión. Reintentá en unos segundos." }, { status: 503 });
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
    const payload = await verifyToken(refresh_token, "refresh");
    if (!payload || payload.type !== "refresh") {
      return NextResponse.json({ error: "Refresh token inválido o expirado" }, { status: 401 });
    }

    // Verificar que la sesión no fue revocada (revocada=false: una sesión cerrada
    // por cambio o reseteo de contraseña no puede renovarse).
    // Solo acepta sesiones con refresh_jti exacto. Sesiones sin refresh_jti
    // (legacy anteriores a la migración JTI) quedan inválidas — el usuario
    // debe iniciar sesión nuevamente.
    //
    // Una falla de la base NO es "sesión vencida": devuelve 503 para que el
    // navegador reintente en vez de cerrar la sesión (antes se cerraba sola
    // ante cualquier corte de un segundo).
    const buscada = await buscarSesion(
      `sesiones?refresh_jti=eq.${payload.jti}&revocada=eq.false&select=id,jti,refresh_jti&limit=1`
    );
    if (buscada.error) return respuestaReintentar();
    let sesion = buscada.filas[0] || null;

    // Gracia de 2 minutos (migración 212): si este refresh_jti es el que se
    // acaba de reemplazar, es otra pestaña que renovó al mismo tiempo, o una
    // renovación cuya respuesta no llegó al navegador (corte de señal). En vez
    // de cerrar la sesión, se le devuelve el pase vigente (mismos JTI), sin
    // volver a rotar. Sin la migración, la consulta falla y sigue como antes.
    let enGracia = false;
    if (!sesion) {
      const desde = new Date(Date.now() - GRACIA_MS).toISOString();
      const gracia = await buscarSesion(
        `sesiones?refresh_jti_anterior=eq.${payload.jti}&rotado_en=gt.${encodeURIComponent(desde)}` +
          `&revocada=eq.false&select=id,jti,refresh_jti&limit=1`
      );
      sesion = (!gracia.error && gracia.filas[0]) || null;
      enGracia = !!(sesion?.jti && sesion?.refresh_jti);
      if (!enGracia) sesion = null;
    }
    if (!sesion) {
      return NextResponse.json(
        { error: "Sesión expirada, iniciá sesión de nuevo." },
        { status: 401 }
      );
    }

    // Verificar que el empleado sigue activo
    const empleados = await buscarSesion(
      `empleados?id=eq.${payload.sub}&activo=eq.true&select=id,legajo,empresa_id,rol`
    );
    if (empleados.error) return respuestaReintentar();
    if (empleados.filas.length === 0) {
      return NextResponse.json(
        { error: "Usuario inactivo. Contactá a tu administrador." },
        { status: 401 }
      );
    }

    const emp = empleados.filas[0];

    // Rotación normal: nuevo access JTI + nuevo refresh JTI. En gracia se
    // reusan los JTI vigentes, así las dos pestañas quedan con el mismo pase.
    const [{ token: newAccessToken, jti: newJti }, { token: newRefreshToken, jti: newRefreshJti }] =
      await Promise.all([
        signAccessToken({
          empleadoId: emp.id,
          empresaId: emp.empresa_id,
          legajo: emp.legajo,
          rol: emp.rol,
          jti: enGracia ? sesion.jti : undefined,
        }),
        signRefreshToken({
          empleadoId: emp.id,
          empresaId: emp.empresa_id,
          jti: enGracia ? sesion.refresh_jti : undefined,
        }),
      ]);

    // Actualizar sesión: nuevo access JTI + nuevo refresh JTI.
    // El viejo refresh_jti queda invalidado (salvo los 2 minutos de gracia).
    // Este PATCH es parte del camino crítico: si falla no emitimos tokens
    // para mantener la garantía de rotación. El cliente reintentará.
    if (!enGracia) {
      const base = {
        token: newJti,
        jti: newJti,
        token_hash: (await import("crypto")).createHash("sha256").update(newJti).digest("hex"),
        refresh_jti: newRefreshJti,
        // La sesión dura 30 días desde el último uso, no desde el login (F1-03):
        // el cron limpiar-tokens borra las filas con expira_en vencido.
        expira_en: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };
      const conGracia = { ...base, refresh_jti_anterior: payload.jti, rotado_en: new Date().toISOString() };
      let patchRes = await patchSesion(sesion.id, conGracia);
      // Sin la migración 212 las columnas de gracia no existen (400): se
      // guarda igual, sin gracia, como antes.
      if (patchRes && patchRes.status === 400) patchRes = await patchSesion(sesion.id, base);
      if (!patchRes || !patchRes.ok) {
        const errText = patchRes ? await patchRes.text().catch(() => "") : "sin respuesta";
        logger.error("refresh-token: fallo al actualizar sesión — abortando rotación", new Error(errText));
        return respuestaReintentar();
      }
    }

    const isProd = process.env.NODE_ENV === "production";
    const res = NextResponse.json({
      token: newAccessToken,
      expires_in: 30 * 60,
    });
    res.cookies.set({
      name: "gypi_token",
      value: newAccessToken,
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 60,
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
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
