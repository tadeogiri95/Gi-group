// tests/api-cron-trial-reminder.test.js — Tests de GET /api/cron/trial-reminder
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.CRON_SECRET = "test-cron-secret";
  process.env.RESEND_API_KEY = "re_test_dummy_key";
});

const { GET } = await import("../app/api/cron/trial-reminder/route.ts");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";

function cronReq() {
  return new Request("http://localhost/api/cron/trial-reminder", { headers: { Authorization: "Bearer test-cron-secret" } });
}

function handlersTrial(fila) {
  return [
    { match: (url) => url.includes("/rest/v1/suscripciones") && url.includes("estado=eq.trial"), respond: () => ({ status: 200, body: fila ? [fila] : [] }) },
  ];
}

test("cron/trial-reminder — sin auth devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(new Request("http://localhost/api/cron/trial-reminder"));
  assert.equal(res.status, 401);
});

test("cron/trial-reminder — sin trials por vencer devuelve enviados:0", async () => {
  global.fetch = createFetchMock(handlersTrial(null));
  const res = await GET(cronReq());
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.enviados, 0);
});

test("cron/trial-reminder — empresa sin admin_email no cuenta como enviado", async () => {
  global.fetch = createFetchMock([
    ...handlersTrial({ empresa_id: EMPRESA_ID }),
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=id,nombre,nombre_corto,slug,admin_email"), respond: () => ({ status: 200, body: [{ id: EMPRESA_ID, nombre: "ACME", nombre_corto: "ACME", slug: "acme", admin_email: null }] }) },
  ]);
  const res = await GET(cronReq());
  const json = await res.json();
  assert.equal(json.enviados, 0);
});

test("cron/trial-reminder — empresa con admin_email envía el recordatorio", async () => {
  // La misma fila matchea las 4 ventanas (11/7/4/1 días) porque el mock no
  // distingue por rango de fecha real — por eso se esperan 4 envíos, no 1.
  global.fetch = createFetchMock([
    ...handlersTrial({ empresa_id: EMPRESA_ID }),
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=id,nombre,nombre_corto,slug,admin_email"), respond: () => ({ status: 200, body: [{ id: EMPRESA_ID, nombre: "ACME", nombre_corto: "ACME", slug: "acme", admin_email: "admin@acme.com" }] }) },
  ]);
  const res = await GET(cronReq());
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.enviados, 4);
});

test("cron/trial-reminder — error fatal devuelve 500 con detalle", async () => {
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/rest/v1/suscripciones") && url.includes("estado=eq.trial"), respond: () => { throw new Error("DB caída"); } },
  ]);
  const res = await GET(cronReq());
  assert.equal(res.status, 500);
});
