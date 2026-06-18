import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyAdminToken } from "../../../lib/jwt";
import { sbRpc } from "../../../lib/sbHelpers";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const adminToken = cookieStore.get("gypi_superadmin")?.value;
  if (!adminToken || !(await verifyAdminToken(adminToken))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const [mrr_trending, cohortes, churn, revenue_plan, funnel] = await Promise.all([
    sbRpc("rpc_mrr_trending", {}, { silent: true, fallback: [] }),
    sbRpc("rpc_conversion_cohortes", {}, { silent: true, fallback: [] }),
    sbRpc("rpc_churn_mensual", {}, { silent: true, fallback: [] }),
    sbRpc("rpc_revenue_por_plan", {}, { silent: true, fallback: [] }),
    sbRpc("rpc_funnel_activacion", {}, { silent: true, fallback: [] }),
  ]);

  return NextResponse.json({
    mrr_trending,
    cohortes,
    churn,
    revenue_plan,
    funnel,
  }, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
