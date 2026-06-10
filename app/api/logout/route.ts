import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "../../lib/jwt";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Revocar la sesión en DB antes de limpiar la cookie
  const cookieToken = request.cookies?.get("gypi_token")?.value;
  if (cookieToken && SB_URL && SB_KEY) {
    try {
      const payload = await verifyToken(cookieToken);
      if (payload?.jti) {
        await fetch(`${SB_URL}/rest/v1/sesiones?token=eq.${payload.jti}`, {
          method: "DELETE",
          headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
        });
      }
    } catch {
      // No bloquear el logout si falla la revocación en DB
    }
  }

  const res = NextResponse.json({ ok: true });
  const cookieBase = { path: "/" as const, maxAge: 0 };
  res.cookies.set({ name: "gypi_token",   value: "", ...cookieBase });
  res.cookies.set({ name: "gypi_refresh", value: "", ...cookieBase });
  return res;
}
