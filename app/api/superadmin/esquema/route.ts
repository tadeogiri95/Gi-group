// /api/superadmin/esquema — Chequeo de la base en superadmin (auditoría 01/11,
// PR 7). GET → migraciones que faltan correr. ?forzar=1 vuelve a mirar sin
// esperar los 10 minutos de la memoria.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyAdminToken } from "../../../lib/jwt";
import { chequearEsquema } from "../../../lib/esquemaServidor";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const adminToken = cookieStore.get("gypi_superadmin")?.value;
  if (!adminToken || !(await verifyAdminToken(adminToken))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    const forzar = new URL(req.url).searchParams.get("forzar") === "1";
    return NextResponse.json(await chequearEsquema({ forzar }), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "No se pudo revisar la base" }, { status: 502 });
  }
}
