// tests/api-cron-limpiar-tokens.test.js — Tests de GET /api/cron/limpiar-tokens
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.CRON_SECRET = "test-cron-secret";
});

const { GET } = await import("../app/api/cron/limpiar-tokens/route.js");

function cronReq(secret) {
  const headers = {};
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return new Request("http://localhost/api/cron/limpiar-tokens", { headers });
}

// ─── Auth ───

test("limpiar-tokens — sin header Authorization devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(cronReq(null));
  assert.equal(res.status, 401);
});

test("limpiar-tokens — CRON_SECRET incorrecto devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(cronReq("secreto-equivocado"));
  assert.equal(res.status, 401);
});

// ─── Success: all 4 deletes OK ───

test("limpiar-tokens — las 4 limpiezas exitosas devuelve 200 con todos los campos", async () => {
  global.fetch = createFetchMock([
    {
      match: (url, opts) => url.includes("/rest/v1/push_tokens") && opts?.method === "DELETE",
      respond: () => ({ status: 200, body: [{ id: 1 }, { id: 2 }] }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/login_attempts") && opts?.method === "DELETE",
      respond: () => ({ status: 204 }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/rate_limits") && opts?.method === "DELETE",
      respond: () => ({ status: 204 }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/sesiones") && opts?.method === "DELETE",
      respond: () => ({ status: 204 }),
    },
  ]);

  const res = await GET(cronReq("test-cron-secret"));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.push_tokens_eliminados, 2);
  assert.equal(json.login_attempts_limpiados, true);
  assert.equal(json.rate_limits_limpiados, true);
  assert.equal(json.sesiones_expiradas_limpiadas, true);
});

// ─── Partial failure: one DELETE throws ───

test("limpiar-tokens — fallo parcial en push_tokens no impide las demás limpiezas", async () => {
  global.fetch = createFetchMock([
    {
      match: (url, opts) => url.includes("/rest/v1/push_tokens") && opts?.method === "DELETE",
      respond: () => { throw new Error("push_tokens table locked"); },
    },
    {
      match: (url, opts) => url.includes("/rest/v1/login_attempts") && opts?.method === "DELETE",
      respond: () => ({ status: 204 }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/rate_limits") && opts?.method === "DELETE",
      respond: () => ({ status: 204 }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/sesiones") && opts?.method === "DELETE",
      respond: () => ({ status: 204 }),
    },
  ]);

  const res = await GET(cronReq("test-cron-secret"));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.ok(json.push_tokens_error, "debe reportar el error de push_tokens");
  assert.equal(json.login_attempts_limpiados, true);
  assert.equal(json.rate_limits_limpiados, true);
  assert.equal(json.sesiones_expiradas_limpiadas, true);
});

// ─── audit_log / geo_registros (retención) ───

test("limpiar-tokens — limpia audit_log y geo_registros con éxito", async () => {
  global.fetch = createFetchMock([
    { match: (url, opts) => url.includes("/rest/v1/push_tokens") && opts?.method === "DELETE", respond: () => ({ status: 200, body: [] }) },
    { match: (url, opts) => url.includes("/rest/v1/login_attempts") && opts?.method === "DELETE", respond: () => ({ status: 204 }) },
    { match: (url, opts) => url.includes("/rest/v1/rate_limits") && opts?.method === "DELETE", respond: () => ({ status: 204 }) },
    { match: (url, opts) => url.includes("/rest/v1/sesiones") && opts?.method === "DELETE", respond: () => ({ status: 204 }) },
    { match: (url, opts) => url.includes("/rest/v1/audit_log") && opts?.method === "DELETE", respond: () => ({ status: 204 }) },
    { match: (url, opts) => url.includes("/rest/v1/geo_registros") && opts?.method === "DELETE", respond: () => ({ status: 204 }) },
  ]);

  const res = await GET(cronReq("test-cron-secret"));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.audit_log_limpiado, true);
  assert.equal(json.geo_registros_limpiados, true);
});

test("limpiar-tokens — fallo en audit_log no impide la limpieza de geo_registros ni de las demás", async () => {
  global.fetch = createFetchMock([
    { match: (url, opts) => url.includes("/rest/v1/push_tokens") && opts?.method === "DELETE", respond: () => ({ status: 200, body: [] }) },
    { match: (url, opts) => url.includes("/rest/v1/login_attempts") && opts?.method === "DELETE", respond: () => ({ status: 204 }) },
    { match: (url, opts) => url.includes("/rest/v1/rate_limits") && opts?.method === "DELETE", respond: () => ({ status: 204 }) },
    { match: (url, opts) => url.includes("/rest/v1/sesiones") && opts?.method === "DELETE", respond: () => ({ status: 204 }) },
    { match: (url, opts) => url.includes("/rest/v1/audit_log") && opts?.method === "DELETE", respond: () => { throw new Error("audit_log table locked"); } },
    { match: (url, opts) => url.includes("/rest/v1/geo_registros") && opts?.method === "DELETE", respond: () => ({ status: 204 }) },
  ]);

  const res = await GET(cronReq("test-cron-secret"));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.ok(json.audit_log_error, "debe reportar el error de audit_log");
  assert.equal(json.geo_registros_limpiados, true);
  assert.equal(json.login_attempts_limpiados, true);
  assert.equal(json.rate_limits_limpiados, true);
  assert.equal(json.sesiones_expiradas_limpiadas, true);
});

// ─── push_tokens count ───

test("limpiar-tokens — push_tokens_eliminados refleja la cantidad de items borrados", async () => {
  const deletedItems = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
  global.fetch = createFetchMock([
    {
      match: (url, opts) => url.includes("/rest/v1/push_tokens") && opts?.method === "DELETE",
      respond: () => ({ status: 200, body: deletedItems }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/login_attempts") && opts?.method === "DELETE",
      respond: () => ({ status: 204 }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/rate_limits") && opts?.method === "DELETE",
      respond: () => ({ status: 204 }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/sesiones") && opts?.method === "DELETE",
      respond: () => ({ status: 204 }),
    },
  ]);

  const res = await GET(cronReq("test-cron-secret"));
  const json = await res.json();

  assert.equal(json.push_tokens_eliminados, 5);
});
