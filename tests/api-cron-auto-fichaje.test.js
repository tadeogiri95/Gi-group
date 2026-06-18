// tests/api-cron-auto-fichaje.test.js — Tests de GET /api/cron/auto-fichaje
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.CRON_SECRET = "test-cron-secret";
});

const { GET } = await import("../app/api/cron/auto-fichaje/route.js");

function cronReq(secret) {
  const headers = {};
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return new Request("http://localhost/api/cron/auto-fichaje", { headers });
}

// ─── Auth ───

test("auto-fichaje — sin header Authorization devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(cronReq(null));
  assert.equal(res.status, 401);
});

test("auto-fichaje — CRON_SECRET incorrecto devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(cronReq("secreto-equivocado"));
  assert.equal(res.status, 401);
});

// ─── Config faltante ───

test("auto-fichaje — sin SUPABASE config devuelve 500", async () => {
  const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const savedKey = process.env.SUPABASE_SERVICE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  try {
    const res = await GET(cronReq("test-cron-secret"));
    assert.equal(res.status, 500);
    const json = await res.json();
    assert.ok(json.error.includes("Config faltante"));
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
    process.env.SUPABASE_SERVICE_KEY = savedKey;
  }
});

// ─── Success ───

test("auto-fichaje — ambos RPCs exitosos devuelve 200 con ok:true y resultado", async () => {
  const rpcResult = { fichados: 3, detalle: ["emp1", "emp2", "emp3"] };

  global.fetch = createFetchMock([
    {
      match: (url) => url.includes("/rpc/auto_fichar_egresos"),
      respond: () => ({ status: 200, body: rpcResult }),
    },
    {
      match: (url) => url.includes("/rpc/limpiar_sesiones_expiradas"),
      respond: () => ({ status: 200, body: null }),
    },
  ]);

  const res = await GET(cronReq("test-cron-secret"));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.ok(json.timestamp, "debe incluir timestamp");
  assert.deepStrictEqual(json.resultado, rpcResult);
});

// ─── RPC failure ───

test("auto-fichaje — fallo en RPC auto_fichar_egresos devuelve 500", async () => {
  global.fetch = createFetchMock([
    {
      match: (url) => url.includes("/rpc/auto_fichar_egresos"),
      respond: () => { throw new Error("DB connection failed"); },
    },
  ]);

  const res = await GET(cronReq("test-cron-secret"));
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.ok(json.error.includes("DB connection failed"));
});
