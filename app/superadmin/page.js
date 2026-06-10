import { cookies } from "next/headers";
import LoginForm from "./LoginForm";
import Dashboard from "./Dashboard";
import { verifyAdminToken } from "../lib/jwt";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function fetchData() {
  const [empresasRes, suscripcionesRes, empleadosRes] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/empresa?select=id,nombre,nombre_corto,slug,plan_activo,activa,created_at,onboarding_completado&order=created_at.desc`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      cache: "no-store",
    }),
    fetch(`${SB_URL}/rest/v1/suscripciones?select=empresa_id,estado,plan,monto&order=created_at.desc`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      cache: "no-store",
    }),
    fetch(`${SB_URL}/rest/v1/empleados?select=empresa_id&activo=eq.true`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      cache: "no-store",
    }),
  ]);

  const empresas = await empresasRes.json();
  const suscripciones = await suscripcionesRes.json();
  const empleados = await empleadosRes.json();

  const empCount = {};
  for (const e of (empleados || [])) empCount[e.empresa_id] = (empCount[e.empresa_id] || 0) + 1;

  const subMap = {};
  for (const s of (suscripciones || [])) {
    if (!subMap[s.empresa_id] || s.estado === "activa") subMap[s.empresa_id] = s;
  }

  return {
    empresas: (empresas || []).map((e) => ({
      ...e,
      empleados_activos: empCount[e.id] || 0,
      suscripcion: subMap[e.id] || null,
    })),
  };
}

export default async function SuperadminPage() {
  const cookieStore = await cookies();
  const adminToken = cookieStore.get("gypi_superadmin")?.value;

  if (!adminToken || !(await verifyAdminToken(adminToken))) {
    return <LoginForm />;
  }

  const data = await fetchData();
  return <Dashboard initialData={data} />;
}
