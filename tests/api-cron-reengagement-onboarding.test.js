// tests/api-cron-reengagement-onboarding.test.js — Tests de GET /api/cron/reengagement-onboarding
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.CRON_SECRET = "test-cron-secret";
  process.env.RESEND_API_KEY = "re_test_dummy_key";
});

const { GET } = await import("../app/api/cron/reengagement-onboarding/route.ts");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";

function cronReq() {
  return new Request("http://localhost/api/cron/reengagement-onboarding", { headers: { Authorization: "Bearer test-cron-secret" } });
}

function handlersEmpresa(fila) {
  return [
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes("onboarding_completado=eq.false"), respond: () => ({ status: 200, body: fila ? [fila] : [] }) },
  ];
}

test("cron/reengagement-onboarding — sin auth devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(new Request("http://localhost/api/cron/reengagement-onboarding"));
  assert.equal(res.status, 401);
});

test("cron/reengagement-onboarding — sin empresas pendientes devuelve enviados:0", async () => {
  global.fetch = createFetchMock(handlersEmpresa(null));
  const res = await GET(cronReq());
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.enviados, 0);
});

test("cron/reengagement-onboarding — empresa sin admin_email no cuenta como enviado", async () => {
  global.fetch = createFetchMock(handlersEmpresa({ id: EMPRESA_ID, nombre: "ACME", nombre_corto: "ACME", slug: "acme", admin_email: null }));
  const res = await GET(cronReq());
  const json = await res.json();
  assert.equal(json.enviados, 0);
});

test("cron/reengagement-onboarding — empresa pendiente con admin_email envía recordatorio", async () => {
  // Misma fila matchea las 3 ventanas (3/7/14 días) — el mock no distingue
  // por rango real, por eso se esperan 3 envíos.
  global.fetch = createFetchMock(handlersEmpresa({ id: EMPRESA_ID, nombre: "ACME", nombre_corto: "ACME", slug: "acme", admin_email: "admin@acme.com" }));
  const res = await GET(cronReq());
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.enviados, 3);
});

test("cron/reengagement-onboarding — error fatal devuelve 500", async () => {
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes("onboarding_completado=eq.false"), respond: () => { throw new Error("DB caída"); } },
  ]);
  const res = await GET(cronReq());
  assert.equal(res.status, 500);
});
