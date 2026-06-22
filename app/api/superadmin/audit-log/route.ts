// GET /api/superadmin/audit-log?empresa_id=xxx&limit=100&offset=0
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifyAdminToken } from "../../../lib/jwt";
import { isUUID } from "../../../lib/validate";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const adminToken = cookieStore.get("gypi_superadmin")?.value;
  if (!adminToken || !(await verifyAdminToken(adminToken))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const empresa_id = searchParams.get("empresa_id");
  if (empresa_id && !isUUID(empresa_id)) {
    return NextResponse.json({ error: "empresa_id debe ser un UUID válido" }, { status: 400 });
  }
  const limit = Math.min(Number(searchParams.get("limit") || "100"), 500);
  const offset = Number(searchParams.get("offset") || "0");
  const accion = searchParams.get("accion");

  let query = `audit_log?order=created_at.desc&limit=${limit}&offset=${offset}&select=*`;
  if (empresa_id) query += `&empresa_id=eq.${empresa_id}`;
  if (accion) query += `&accion=eq.${encodeURIComponent(accion)}`;

  const r = await fetch(`${SB_URL}/rest/v1/${query}`, {
    headers: { apikey: SB_KEY!, Authorization: `Bearer ${SB_KEY}` },
  });

  if (!r.ok) {
    const err = await r.text();
    return NextResponse.json({ error: err }, { status: 500 });
  }

  const rows = await r.json();
  return NextResponse.json({ rows, total: rows.length });
}
