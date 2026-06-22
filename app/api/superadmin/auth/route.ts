import { NextRequest, NextResponse } from "next/server";
import { signAdminToken } from "../../../lib/jwt";
import { ventana15min } from "../../../lib/rateLimit";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const MAX_ATTEMPTS = 5;

// Fail-closed: si la DB no responde, se bloquea el intento (mismo criterio
// que checkLoginRateLimit en login-empresa/route.js — seguridad > disponibilidad
// en este edge case, más aún en el endpoint que controla acceso a TODAS las empresas).
async function checkRateLimit(ip: string): Promise<boolean> {
  if (!SB_URL || !SB_KEY) return true;
  try {
    const ventana = `superadmin_${ventana15min()}`;
    const res = await fetch(`${SB_URL}/rest/v1/rpc/rpc_login_attempt`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_ip: ip, p_ventana: ventana }),
    });
    if (!res.ok) return true;
    const count = await res.json();
    return typeof count === "number" ? count > MAX_ATTEMPTS : true;
  } catch {
    return true;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (await checkRateLimit(ip)) {
      return NextResponse.json({ error: "Demasiados intentos. Intentá de nuevo en 15 minutos." }, { status: 429 });
    }

    const { key } = await req.json() as { key?: string };
    const secret = process.env.SUPERADMIN_SECRET;

    if (!secret) return NextResponse.json({ error: "SUPERADMIN_SECRET no configurado" }, { status: 500 });
    if (!key || key !== secret) return NextResponse.json({ error: "Clave incorrecta" }, { status: 401 });

    const adminToken = await signAdminToken();

    const res = NextResponse.json({ ok: true });
    res.cookies.set({
      name: "gypi_superadmin",
      value: adminToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/superadmin",
      maxAge: 8 * 60 * 60,
    });
    return res;
  } catch (err) {
    console.error("[superadmin/auth]", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
