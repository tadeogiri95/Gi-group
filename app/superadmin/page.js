import { cookies } from "next/headers";
import LoginForm from "./LoginForm";
import Dashboard from "./Dashboard";
import { verifyAdminToken } from "../lib/jwt";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

function sbRpc(fnName, params) {
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

async function fetchData() {
  if (!SB_URL || !SB_KEY) {
    console.error("Superadmin fetchData: NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_KEY no configuradas");
    return { empresas: [], total: 0, page: 1, pageSize: 50, stats: null };
  }
  try {
    const [result, stats] = await Promise.all([
      sbRpc("rpc_superadmin_empresas", { p_limit: 50, p_offset: 0, p_search: null }),
      sbRpc("rpc_superadmin_stats", {}),
    ]);

    return {
      empresas: result.empresas ?? [],
      total: result.total ?? 0,
      page: 1,
      pageSize: 50,
      stats: stats ?? null,
    };
  } catch (err) {
    console.error("Superadmin fetchData error:", err);
    return { empresas: [], total: 0, page: 1, pageSize: 50, stats: null };
  }
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
