import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyAdminToken } from "../../../lib/jwt";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;

function sbRpc(fnName: string, params: Record<string, unknown>) {
  return fetch(`${SB_URL}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
    cache: "no-store",
  }).then((r) => r.json());
}

const PAGE_SIZE = 50;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const adminToken = cookieStore.get("gypi_superadmin")?.value;

  if (!adminToken || !(await verifyAdminToken(adminToken))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const url = req.nextUrl;
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const search = url.searchParams.get("search") || "";
  const limit = Math.min(100, parseInt(url.searchParams.get("limit") || String(PAGE_SIZE), 10));
  const offset = (page - 1) * limit;

  const [result, stats] = await Promise.all([
    sbRpc("rpc_superadmin_empresas", { p_limit: limit, p_offset: offset, p_search: search || null }),
    sbRpc("rpc_superadmin_stats", {}),
  ]);

  return NextResponse.json({
    empresas: result.empresas ?? [],
    total: result.total ?? 0,
    page,
    pageSize: limit,
    stats: stats ?? null,
  });
}
