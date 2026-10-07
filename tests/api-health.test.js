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

// ─── F3-12: crons atrasados ───

function cronsHandler(filas, status = 200) {
  return { match: (url) => url.includes("/rest/v1/cron_ejecuciones"), respond: () => ({ status, body: filas }) };
}

test("health — un cron atrasado pone el estado en degraded (503) para que el monitor avise", async () => {
  const { CRONS_ESPERADOS } = await import("../app/lib/cronMonitor.js");
  const reciente = new Date().toISOString();
  const filas = Object.keys(CRONS_ESPERADOS).map((nombre) => ({ nombre, ultima_ok: nombre === "auto-fichaje" ? "2020-01-01T00:00:00Z" : reciente }));
  global.fetch = createFetchMock([dbOk(), cronsHandler(filas)]);
  const res = await GET(getReq(null));
  const json = await res.json();
  assert.equal(res.status, 503);
  assert.equal(json.crons, "atrasados");
  assert.equal(json.crons_atrasados, undefined, "sin CRON_SECRET no expone los nombres");
});

test("health — todos los crons al día: ok", async () => {
  const { CRONS_ESPERADOS } = await import("../app/lib/cronMonitor.js");
  const filas = Object.keys(CRONS_ESPERADOS).map((nombre) => ({ nombre, ultima_ok: new Date().toISOString() }));
  global.fetch = createFetchMock([dbOk(), cronsHandler(filas)]);
  const res = await GET(getReq(null));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.crons, "ok");
});

test("health — si la tabla de crons no existe todavía (migración pendiente) no degrada", async () => {
  global.fetch = createFetchMock([dbOk(), cronsHandler({ message: "relation does not exist" }, 404)]);
  const res = await GET(getReq(null));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.crons, "sin_datos");
});
