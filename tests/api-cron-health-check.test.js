// tests/api-cron-health-check.test.js — Tests de GET /api/cron/health-check
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  process.env.CRON_SECRET = "test-cron-secret";
});

const { GET } = await import("../app/api/cron/health-check/route.js");

function cronReq() {
  return new Request("http://localhost/api/cron/health-check", { headers: { Authorization: "Bearer test-cron-secret" } });
}

test("cron/health-check — sin auth devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(new Request("http://localhost/api/cron/health-check"));
  assert.equal(res.status, 401);
});

test("cron/health-check — /api/health responde ok devuelve 200", async () => {
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/api/health"), respond: () => ({ status: 200, body: { status: "ok", ts: "2026-06-22T00:00:00Z" } }) },
  ]);
  const res = await GET(cronReq());
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
});

test("cron/health-check — /api/health responde degradado devuelve 503 alerted", async () => {
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/api/health"), respond: () => ({ status: 503, body: { status: "degraded", db: "timeout_or_unreachable" } }) },
  ]);
  const res = await GET(cronReq());
  const json = await res.json();
  assert.equal(res.status, 503);
  assert.equal(json.alerted, true);
});

test("cron/health-check — /api/health inalcanzable devuelve 503 sin romper", async () => {
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/api/health"), respond: () => { throw new Error("network error"); } },
  ]);
  const res = await GET(cronReq());
  const json = await res.json();
  assert.equal(res.status, 503);
  assert.equal(json.error, "health unreachable");
});
