import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyAdminToken } from "../../../lib/jwt";
import type { Empresa } from "../../../types";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;

function sbFetch(path: string) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    cache: "no-store",
  }).then((r) => r.json());
}

interface Suscripcion { empresa_id: string; estado: string; plan: string; monto: number }
interface EmpleadoCount { empresa_id: string }

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const adminToken = cookieStore.get("gypi_superadmin")?.value;

  if (!adminToken || !(await verifyAdminToken(adminToken))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const [empresas, suscripciones, empleados]: [Empresa[], Suscripcion[], EmpleadoCount[]] =
    await Promise.all([
      sbFetch("empresa?select=id,nombre,nombre_corto,slug,plan_activo,activa,created_at,onboarding_completado&order=created_at.desc"),
      sbFetch("suscripciones?select=empresa_id,estado,plan,monto,created_at&order=created_at.desc"),
      sbFetch("empleados?select=empresa_id&activo=eq.true"),
    ]);

  const empCount: Record<string, number> = {};
  for (const e of (empleados ?? [])) empCount[e.empresa_id] = (empCount[e.empresa_id] ?? 0) + 1;

  const subMap: Record<string, Suscripcion> = {};
  for (const s of (suscripciones ?? [])) {
    if (!subMap[s.empresa_id] || s.estado === "activa") subMap[s.empresa_id] = s;
  }

  const data = (empresas ?? []).map((e) => ({
    ...e,
    empleados_activos: empCount[e.id] ?? 0,
    suscripcion: subMap[e.id] ?? null,
  }));

  return NextResponse.json({ empresas: data });
}
