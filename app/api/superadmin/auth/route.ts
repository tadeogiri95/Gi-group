import { NextRequest, NextResponse } from "next/server";
import { signAdminToken } from "../../../lib/jwt";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
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
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
