// POST /api/superadmin/impersonate-exchange
// Intercambia el código de corta duración (60s) por una sesión real (1h).
// El código viene de ?imp= en la URL generada por /api/superadmin/impersonate.
// Flujo: superadmin abre URL → cliente lee ?imp= → POST aquí → cookie + user data.
//
// Anti-replay (A-01): el JTI del código se inserta en audit_log con accion=
// 'impersonate_exchange'. El índice único (migración 020) hace que un segundo
// intento con el mismo código falle con 409 → rechazamos con 401.
// Audit trail (M-06): el INSERT también sirve como registro del inicio de sesión.

import { NextRequest, NextResponse } from "next/server";
import { verifyToken, signImpersonateToken } from "../../../lib/jwt";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { code } = await req.json() as { code?: string };
  if (!code) return NextResponse.json({ error: "Código requerido" }, { status: 400 });

  // Verificar firma JWT y que sea un código de impersonación válido
  const payload = await verifyToken(code);
  if (
    !payload || !payload.imp || !payload.code ||
    !payload.sub || !payload.eid || payload.leg === undefined ||
    !payload.rol || !payload.jti
  ) {
    return NextResponse.json({ error: "Código inválido o expirado" }, { status: 401 });
  }

  const codeJti = payload.jti as string;

  // Intentar registrar el uso del código en audit_log.
  // El índice único idx_audit_log_impersonate_exchange_jti (migración 020) rechaza
  // el INSERT si este JTI ya fue usado — previene replay incluso ante concurrencia.
  const auditInsert = await fetch(`${SB_URL}/rest/v1/audit_log`, {
    method: "POST",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      empresa_id: payload.eid as string,
      actor_id: null,
      actor_rol: "superadmin",
      accion: "impersonate_exchange",
      entidad: "code",
      entidad_id: codeJti,
      datos_despues: { empleado_id: payload.sub, legajo: payload.leg, rol: payload.rol },
      ip: req.headers.get("x-forwarded-for") || "unknown",
    }),
  });

  if (!auditInsert.ok) {
    const errText = await auditInsert.text();
    // 409 o constraint 23505 = el código ya fue canjeado anteriormente
    if (auditInsert.status === 409 || errText.includes("23505")) {
      return NextResponse.json({ error: "Código ya utilizado" }, { status: 401 });
    }
    // Otro error de DB: rechazar para no bypassear la protección anti-replay
    return NextResponse.json({ error: "Error al validar el código" }, { status: 500 });
  }

  const claims = {
    empleadoId: payload.sub as string,
    empresaId: payload.eid as string,
    legajo: payload.leg as number,
    rol: payload.rol as string,
  };

  // Emitir token de sesión real (1h)
  const { token: accessToken } = await signImpersonateToken(claims);

  // Traer datos del empleado para el cliente
  const r = await fetch(
    `${SB_URL}/rest/v1/empleados?id=eq.${claims.empleadoId}&empresa_id=eq.${claims.empresaId}&select=id,legajo,nombre,apodo,rol,area,division,empresa_id,activo&limit=1`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
  );
  const [empleado] = await r.json() as Record<string, unknown>[];
  if (!empleado) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

  const isProd = process.env.NODE_ENV === "production";
  const res = NextResponse.json({ usuario: empleado, token: accessToken });
  res.cookies.set({
    name: "gypi_token",
    value: accessToken,
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });
  return res;
}
