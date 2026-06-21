// GET /api/superadmin/historial-planes?empresa_id=xxx
// Devuelve el historial de cambios de plan para una empresa:
//   - Entradas de audit_log con accion=cambiar_plan
//   - Historial de suscripciones (todos los estados)
//   - Últimos 20 pagos procesados
// Solo accesible por superadmin.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyAdminToken } from "../../../lib/jwt";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;

function sbFetch(path: string) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    cache: "no-store",
  }).then((r) => (r.ok ? r.json() : Promise.resolve([])));
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const adminToken = cookieStore.get("gypi_superadmin")?.value;
  if (!adminToken || !(await verifyAdminToken(adminToken))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const empresa_id = req.nextUrl.searchParams.get("empresa_id");
  if (!empresa_id) {
    return NextResponse.json({ error: "empresa_id requerido" }, { status: 400 });
  }

  const [auditLogs, suscripciones, pagos] = await Promise.all([
    sbFetch(
      `audit_log?empresa_id=eq.${empresa_id}&accion=in.(cambiar_plan,impersonate)&select=id,accion,datos_despues,ip,created_at&order=created_at.desc&limit=50`
    ),
    sbFetch(
      `suscripciones?empresa_id=eq.${empresa_id}&select=id,plan,estado,monto,trial_inicio,trial_fin,created_at,updated_at&order=created_at.desc&limit=20`
    ),
    sbFetch(
      `pagos?empresa_id=eq.${empresa_id}&select=id,monto,estado,plan,gateway_payment_id,created_at&order=created_at.desc&limit=20`
    ),
  ]);

  return NextResponse.json({ auditLogs, suscripciones, pagos });
}
