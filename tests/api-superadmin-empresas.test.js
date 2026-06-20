// tests/api-superadmin-empresas.test.js — Tests de GET /api/superadmin/empresas
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";
import { withNextCookies } from "./helpers/withNextCookies.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAdminToken } = await import("../app/lib/jwt.ts");
const { GET } = await import("../app/api/superadmin/empresas/route.ts");

// La ruta lee req.nextUrl — un Request plano no lo expone. Evitamos importar
// NextRequest de next/server (dispara internals de app-render que necesitan
// el polyfill de AsyncLocalStorage de withNextCookies.js, y el orden de
// imports ESM lo cargaría antes de que ese polyfill exista). Un URL plano
// adjunto alcanza porque la ruta solo usa nextUrl.searchParams.
function getReq(qs = "") {
  const req = new Request(`http://localhost/api/superadmin/empresas${qs}`);
  req.nextUrl = new URL(req.url);
  return req;
}

// La ruta ahora delega paginación + enriquecimiento (suscripción, empleados_activos)
// a las RPC rpc_superadmin_empresas/rpc_superadmin_stats (migración 046) — ya no
// hace 3 queries paralelas a empresa/suscripciones/empleados.
function handlersEmpresas() {
  return [
    {
      match: (url) => url.includes("/rest/v1/rpc/rpc_superadmin_empresas"),
      respond: () => ({
        status: 200,
        body: {
          empresas: [
            { id: "e1", nombre: "Empresa 1", nombre_corto: "E1", slug: "e1", plan_activo: "pro", activa: true, created_at: "2025-01-01", onboarding_completado: true, trial_usado: false, empleados_activos: 3, suscripcion: { empresa_id: "e1", estado: "activa", plan: "pro", monto: 5000, created_at: "2025-01-01", trial_fin: null } },
            { id: "e2", nombre: "Empresa 2", nombre_corto: "E2", slug: "e2", plan_activo: "free", activa: true, created_at: "2025-02-01", onboarding_completado: false, trial_usado: true, empleados_activos: 1, suscripcion: null },
          ],
          total: 2,
        },
      }),
    },
    {
      match: (url) => url.includes("/rest/v1/rpc/rpc_superadmin_stats"),
      respond: () => ({ status: 200, body: { total_empresas: 2, total_empleados: 4 } }),
    },
  ];
}

// ─── Auth ───

test("superadmin empresas — sin cookie devuelve 401", async () => {
  global.fetch = createFetchMock(handlersEmpresas());
  const res = await withNextCookies("", () => GET(getReq()));
  assert.equal(res.status, 401);
});

test("superadmin empresas — token inválido devuelve 401", async () => {
  global.fetch = createFetchMock(handlersEmpresas());
  const res = await withNextCookies("gypi_superadmin=token-invalido-basura", () => GET(getReq()));
  assert.equal(res.status, 401);
});

// ─── Success ───

test("superadmin empresas — token válido devuelve 200 con empresas enriquecidas", async () => {
  global.fetch = createFetchMock(handlersEmpresas());
  const adminToken = await signAdminToken();
  const res = await withNextCookies(`gypi_superadmin=${adminToken}`, () => GET(getReq()));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(json.empresas), "debe devolver array de empresas");
  assert.equal(json.empresas.length, 2);
  assert.equal(json.total, 2);

  const e1 = json.empresas.find((e) => e.id === "e1");
  assert.equal(e1.empleados_activos, 3, "Empresa 1 tiene 3 empleados activos");
  assert.ok(e1.suscripcion, "Empresa 1 tiene suscripción");
  assert.equal(e1.suscripcion.estado, "activa");

  const e2 = json.empresas.find((e) => e.id === "e2");
  assert.equal(e2.empleados_activos, 1, "Empresa 2 tiene 1 empleado activo");
  assert.equal(e2.suscripcion, null, "Empresa 2 no tiene suscripción");
});
