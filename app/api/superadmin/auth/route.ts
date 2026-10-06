import { NextRequest, NextResponse } from "next/server";
import { signAdminToken } from "../../../lib/jwt";
import { ventana15min } from "../../../lib/rateLimit";
import { createHash, timingSafeEqual } from "crypto";

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

// Comparación en tiempo constante (F2-13): con `!==` el tiempo de respuesta
// filtra cuántos caracteres iniciales coinciden. Se comparan los hashes para
// que ambos lados tengan siempre el mismo largo.
function claveCorrecta(key: string, secret: string): boolean {
  const a = createHash("sha256").update(key).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
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
    if (typeof key !== "string" || !key || !claveCorrecta(key, secret)) return NextResponse.json({ error: "Clave incorrecta" }, { status: 401 });

    const adminToken = await signAdminToken();

    const res = NextResponse.json({ ok: true });
    res.cookies.set({
      name: "gypi_superadmin",
      value: adminToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      // Strict: no viaja en pedidos iniciados desde otros sitios.
      sameSite: "strict",
      // "/" y no "/superadmin" (F2-13): el panel llama a /api/superadmin/* y
      // con el path anterior el navegador no mandaba la cookie a esas APIs.
      path: "/",
      maxAge: 8 * 60 * 60,
    });
    // Borrar la cookie vieja (path=/superadmin) para que no tape a la nueva.
    res.headers.append("Set-Cookie", "gypi_superadmin=; Path=/superadmin; Max-Age=0; HttpOnly; SameSite=Strict");
    return res;
  } catch (err) {
    console.error("[superadmin/auth]", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
