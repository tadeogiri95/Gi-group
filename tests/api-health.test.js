// tests/api-health.test.js — Tests HTTP de GET /api/health
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
});

const { GET } = await import("../app/api/health/route.js");

function getReq(auth) {
  return new Request("http://localhost/api/health", { headers: auth ? { Authorization: auth } : {} });
}

function dbOk() {
  return { match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=id"), respond: () => ({ status: 200, body: [{ id: "x" }] }) };
}

test("health — todo configurado y DB ok devuelve status ok sin detalle interno", async () => {
  global.fetch = createFetchMock([dbOk()]);
  const res = await GET(getReq(null));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.status, "ok");
  assert.equal(json.env, undefined, "sin CRON_SECRET no debe exponer detalle de env vars");
});

test("health — DB inalcanzable devuelve degraded 503", async () => {
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=id"), respond: () => { throw new Error("timeout"); } },
  ]);
  const res = await GET(getReq(null));
  const json = await res.json();
  assert.equal(res.status, 503);
  assert.equal(json.status, "degraded");
});

test("health — falta una variable de entorno requerida devuelve degraded", async () => {
  const prev = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  try {
    global.fetch = createFetchMock([dbOk()]);
    const res = await GET(getReq(null));
    const json = await res.json();
    assert.equal(res.status, 503);
    assert.equal(json.status, "degraded");
  } finally {
    process.env.JWT_SECRET = prev;
  }
});

test("health — con CRON_SECRET válido incluye detalle de env vars faltantes/opcionales", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  try {
    global.fetch = createFetchMock([dbOk()]);
    const res = await GET(getReq("Bearer test-cron-secret"));
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(json.env.missing, []);
    assert.ok(Array.isArray(json.env.warnings), "debe listar las vars opcionales faltantes");
  } finally {
    delete process.env.CRON_SECRET;
  }
});

test("health — CRON_SECRET incorrecto no desbloquea el detalle", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  try {
    global.fetch = createFetchMock([dbOk()]);
    const res = await GET(getReq("Bearer secreto-equivocado"));
    const json = await res.json();
    assert.equal(json.env, undefined);
  } finally {
    delete process.env.CRON_SECRET;
  }
});
