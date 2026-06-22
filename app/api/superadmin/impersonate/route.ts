import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { signImpersonateCode, verifyAdminToken } from "../../../lib/jwt";
import { logAudit } from "../../../lib/audit";
import { isUUID } from "../../../lib/validate";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const adminToken = cookieStore.get("gypi_superadmin")?.value;

  if (!adminToken || !(await verifyAdminToken(adminToken))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { empresa_id } = await req.json() as { empresa_id?: string };
  if (!empresa_id) return NextResponse.json({ error: "empresa_id requerido" }, { status: 400 });
  if (!isUUID(empresa_id)) return NextResponse.json({ error: "empresa_id debe ser un UUID válido" }, { status: 400 });

  const r = await fetch(
    `${SB_URL}/rest/v1/empleados?empresa_id=eq.${empresa_id}&rol=in.(gerencial,administrativo)&activo=eq.true&select=id,legajo,rol,empresa_id,nombre&limit=1&order=legajo.asc`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
  );
  const empleados = await r.json() as { id: string; legajo: number; rol: string; empresa_id: string; nombre: string }[];
  if (!empleados?.length) {
    return NextResponse.json({ error: "No hay gerencial activo en esa empresa" }, { status: 404 });
  }

  const u = empleados[0];
  // Short-lived code (60s) — el token completo nunca va en la URL
  const { token: code } = await signImpersonateCode({
    empleadoId: u.id,
    empresaId: u.empresa_id,
    legajo: u.legajo,
    rol: u.rol,
  });

  const er = await fetch(`${SB_URL}/rest/v1/empresa?id=eq.${empresa_id}&select=slug&limit=1`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  const [empresa] = await er.json() as { slug: string }[];

  logAudit({
    empresa_id: empresa_id,
    actor_id: "superadmin",
    actor_rol: "superadmin",
    accion: "impersonate",
    entidad: "empresa",
    entidad_id: empresa_id,
    datos_despues: { empleado: u.nombre, legajo: u.legajo },
    ip: req.headers.get("x-forwarded-for") || "unknown",
  });

  return NextResponse.json({
    url: `/${empresa.slug}?imp=${code}`,
    empleado: { nombre: u.nombre, legajo: u.legajo, rol: u.rol },
  });
}
