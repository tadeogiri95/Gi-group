// tests/api-cron-refresh-scores.test.js — Tests de GET /api/cron/refresh-scores
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.CRON_SECRET = "test-cron-secret";
});

const { GET } = await import("../app/api/cron/refresh-scores/route.js");

function cronReq() {
  return new Request("http://localhost/api/cron/refresh-scores", { headers: { Authorization: "Bearer test-cron-secret" } });
}

test("cron/refresh-scores — sin auth devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(new Request("http://localhost/api/cron/refresh-scores"));
  assert.equal(res.status, 401);
});

test("cron/refresh-scores — refresca la vista materializada con éxito", async () => {
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/rest/v1/rpc/refresh_scores_empleados"), respond: () => ({ status: 200, body: null }) },
  ]);
  const res = await GET(cronReq());
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
});

test("cron/refresh-scores — error en la RPC devuelve 500", async () => {
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/rest/v1/rpc/refresh_scores_empleados"), respond: () => ({ status: 500, body: "rpc failed" }) },
  ]);
  const res = await GET(cronReq());
  assert.equal(res.status, 500);
});
