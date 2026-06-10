import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyAdminToken } from "../../../lib/jwt";
import { logAudit } from "../../../lib/audit";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;

const PLANES_VALIDOS = ["free", "trial", "starter", "pro", "enterprise"];

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const adminToken = cookieStore.get("gypi_superadmin")?.value;

  if (!adminToken || !(await verifyAdminToken(adminToken))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { empresa_id, plan } = await req.json() as { empresa_id?: string; plan?: string };

  if (!empresa_id || !plan) {
    return NextResponse.json({ error: "empresa_id y plan requeridos" }, { status: 400 });
  }
  if (!PLANES_VALIDOS.includes(plan)) {
    return NextResponse.json({ error: `Plan inválido. Valores permitidos: ${PLANES_VALIDOS.join(", ")}` }, { status: 400 });
  }

  const r = await fetch(`${SB_URL}/rest/v1/empresa?id=eq.${empresa_id}`, {
    method: "PATCH",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ plan_activo: plan }),
  });

  if (!r.ok) {
    const err = await r.text();
    console.error("[cambiar-plan] Supabase error:", err);
    return NextResponse.json({ error: "Error actualizando plan en DB" }, { status: 500 });
  }

  logAudit({
    empresa_id,
    actor_id: "superadmin",
    actor_rol: "superadmin",
    accion: "cambiar_plan",
    entidad: "empresa",
    entidad_id: empresa_id,
    datos_despues: { plan_activo: plan },
    ip: req.headers.get("x-forwarded-for") || "unknown",
  });

  return NextResponse.json({ ok: true, plan });
}
