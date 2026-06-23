// tests/api-superadmin-metricas.test.js — Tests HTTP de GET /api/superadmin/metricas
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";
import { withNextCookies } from "./helpers/withNextCookies.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAdminToken } = await import("../app/lib/jwt.ts");
const { GET } = await import("../app/api/superadmin/metricas/route.ts");

function getReq() {
  return new Request("http://localhost/api/superadmin/metricas");
}

async function withAdmin(fn) {
  const adminToken = await signAdminToken();
  return withNextCookies(`gypi_superadmin=${adminToken}`, fn);
}

function rpcHandler(nombre, body) {
  return { match: (url) => url.includes(`/rest/v1/rpc/${nombre}`), respond: () => ({ status: 200, body }) };
}

const RPCS = ["rpc_mrr_trending", "rpc_conversion_cohortes", "rpc_churn_mensual", "rpc_revenue_por_plan", "rpc_funnel_activacion", "rpc_health_score_empresas", "rpc_email_engagement"];

test("superadmin/metricas — sin cookie admin devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await withNextCookies("", () => GET(getReq()));
  assert.equal(res.status, 401);
});

test("superadmin/metricas — éxito devuelve las 7 métricas", async () => {
  global.fetch = createFetchMock(RPCS.map((r) => rpcHandler(r, [{ ok: true }])));
  const res = await withAdmin(() => GET(getReq()));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(json.mrr_trending, [{ ok: true }]);
  assert.deepEqual(json.cohortes, [{ ok: true }]);
  assert.deepEqual(json.churn, [{ ok: true }]);
  assert.deepEqual(json.revenue_plan, [{ ok: true }]);
  assert.deepEqual(json.funnel, [{ ok: true }]);
  assert.deepEqual(json.health_scores, [{ ok: true }]);
  assert.deepEqual(json.email_engagement, [{ ok: true }]);
});

test("superadmin/metricas — una RPC individual fallando no rompe la respuesta (fallback [])", async () => {
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/rest/v1/rpc/rpc_churn_mensual"), respond: () => ({ status: 500, body: "rpc error" }) },
    ...RPCS.filter((r) => r !== "rpc_churn_mensual").map((r) => rpcHandler(r, [{ ok: true }])),
  ]);
  const res = await withAdmin(() => GET(getReq()));
  const json = await res.json();

  assert.equal(res.status, 200, "una RPC caída no debe tirar abajo todo el endpoint");
  assert.deepEqual(json.churn, [], "debe usar el fallback [] cuando la RPC falla");
  assert.deepEqual(json.mrr_trending, [{ ok: true }], "las demás métricas no deben verse afectadas");
});
