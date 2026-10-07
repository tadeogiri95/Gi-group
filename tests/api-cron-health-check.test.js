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

test("cron/health-check — /api/health responde degradado: alerta y devuelve 200 (el cron en sí funcionó)", async () => {
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/api/health"), respond: () => ({ status: 503, body: { status: "degraded", db: "timeout_or_unreachable" } }) },
  ]);
  const res = await GET(cronReq());
  const json = await res.json();
  assert.equal(res.status, 200);
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

test("cron/health-check — usa NEXT_PUBLIC_APP_URL cuando está configurada", async () => {
  const prevApp = process.env.NEXT_PUBLIC_APP_URL, prevVercel = process.env.VERCEL_URL;
  process.env.NEXT_PUBLIC_APP_URL = "https://gypi.app";
  process.env.VERCEL_URL = "gi-group-app-abc123.vercel.app";
  let urlLlamada = null;
  try {
    const mod = await import(`../app/api/cron/health-check/route.js?t=${Date.now()}`);
    global.fetch = createFetchMock([
      { match: (url) => url.includes("/api/health"), respond: (url) => { urlLlamada = url; return { status: 200, body: { status: "ok" } }; } },
    ]);
    await mod.GET(cronReq());
    assert.equal(urlLlamada, "https://gypi.app/api/health");
  } finally {
    if (prevApp === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = prevApp;
    if (prevVercel === undefined) delete process.env.VERCEL_URL; else process.env.VERCEL_URL = prevVercel;
  }
});

test("cron/health-check — registra su corrida en cron_ejecuciones (F3-12)", async () => {
  let registro = null;
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/api/health"), respond: () => ({ status: 200, body: { status: "ok" } }) },
    { match: (url, opts) => url.includes("/rest/v1/cron_ejecuciones") && opts.method === "POST", respond: (url, opts) => { registro = JSON.parse(opts.body); return { status: 201 }; } },
  ]);
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "test-service-key";
  await GET(cronReq());
  assert.equal(registro?.nombre, "health-check");
  assert.ok(registro.ultima_ok);
});
