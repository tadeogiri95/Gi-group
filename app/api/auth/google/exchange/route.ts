// POST /api/auth/google/exchange
//
// Canjea el código de un solo uso emitido por google/callback (?oauth=code)
// por una sesión real — mismo shape que login-empresa (access+refresh JWT +
// fila en sesiones), no el token de 1h de impersonación.
//
// Anti-replay: el jti del código se inserta en audit_log con accion=
// 'oauth_exchange'. El índice único idx_audit_log_oauth_exchange_jti
// (migración 062) rechaza el INSERT si ya fue usado — mismo mecanismo que
// /api/superadmin/impersonate-exchange (migración 020), con su propio
// namespace de accion para no compartirlo con impersonation.

import { NextRequest, NextResponse } from "next/server";
import { verifyOAuthExchangeCode, signAccessToken, signRefreshToken } from "../../../../lib/jwt";
import { isUUID } from "../../../../lib/validate";
import { logger } from "../../../../lib/logger";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;

async function guardarSesionJWT(input: {
  empleadoId: string; empresaId: string; legajo: number;
  jti: string; refreshJti: string; ip: string; userAgent: string;
}): Promise<void> {
  const crypto = await import("crypto");
  const tokenHash = crypto.createHash("sha256").update(input.jti).digest("hex");
  const now = Date.now();
  const res = await fetch(`${SB_URL}/rest/v1/sesiones`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      empleado_id: input.empleadoId,
      empresa_id: input.empresaId,
      legajo: input.legajo,
      token_hash: tokenHash,
      expires_at: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
      revocada: false,
      device_info: [input.ip, input.userAgent].filter(Boolean).join(" | ") || null,
      jti: input.jti,
      refresh_jti: input.refreshJti,
      expira_en: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
      token: input.jti,
    }),
  });
  if (!res.ok) throw new Error("No se pudo guardar la sesión: " + (await res.text()));
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { exchangeCode } = (await req.json()) as { exchangeCode?: string };
  if (!exchangeCode) return NextResponse.json({ error: "Código requerido" }, { status: 400 });

  const payload = await verifyOAuthExchangeCode(exchangeCode);
  if (!payload) return NextResponse.json({ error: "Código inválido o expirado" }, { status: 401 });

  // Defensa en profundidad: el JWT ya está verificado por firma, pero se
  // valida el shape antes de interpolar en URLs de fetch a PostgREST.
  if (!isUUID(payload.empleadoId) || !isUUID(payload.empresaId)) {
    return NextResponse.json({ error: "Código inválido o expirado" }, { status: 401 });
  }

  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";

  const auditInsert = await fetch(`${SB_URL}/rest/v1/audit_log`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      empresa_id: payload.empresaId,
      actor_id: payload.empleadoId,
      actor_legajo: payload.legajo,
      actor_rol: payload.rol,
      accion: "oauth_exchange",
      entidad: "code",
      entidad_id: payload.jti,
      datos_despues: { empleado_id: payload.empleadoId, legajo: payload.legajo, rol: payload.rol },
      ip,
    }),
  });

  if (!auditInsert.ok) {
    const errText = await auditInsert.text();
    if (auditInsert.status === 409 || errText.includes("23505")) {
      return NextResponse.json({ error: "Código ya utilizado" }, { status: 401 });
    }
    return NextResponse.json({ error: "Error al validar el código" }, { status: 500 });
  }

  let accessToken: string;
  let refreshToken: string;
  try {
    const access = await signAccessToken(payload);
    const refresh = await signRefreshToken(payload);
    accessToken = access.token;
    refreshToken = refresh.token;

    await guardarSesionJWT({
      empleadoId: payload.empleadoId,
      empresaId: payload.empresaId,
      legajo: payload.legajo,
      jti: access.jti,
      refreshJti: refresh.jti,
      ip,
      userAgent: (req.headers.get("user-agent") || "unknown").substring(0, 200),
    });
  } catch (e) {
    logger.error("google/exchange: no se pudo emitir la sesión", e as Error);
    return NextResponse.json({ error: "Error al iniciar sesión" }, { status: 500 });
  }

  const r = await fetch(
    `${SB_URL}/rest/v1/empleados?id=eq.${payload.empleadoId}&empresa_id=eq.${payload.empresaId}&select=id,legajo,nombre,apodo,email,rol,area,division,empresa_id,activo,debe_cambiar_password&limit=1`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
  );
  const [usuario] = (await r.json()) as Record<string, unknown>[];
  if (!usuario) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

  const isProd = process.env.NODE_ENV === "production";
  const res = NextResponse.json({ usuario, token: accessToken, expires_in: 30 * 60 });
  res.cookies.set({
    name: "gypi_token", value: accessToken, httpOnly: true,
    secure: isProd, sameSite: "lax", path: "/", maxAge: 30 * 60,
  });
  res.cookies.set({
    name: "gypi_refresh", value: refreshToken, httpOnly: true,
    secure: isProd, sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60,
  });
  return res;
}
