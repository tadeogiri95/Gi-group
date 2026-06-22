// tests/api-cron-reconciliacion-mp.test.js — Tests de GET /api/cron/reconciliacion-mp
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.CRON_SECRET = "test-cron-secret";
  process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-fake-token";
  // lib/email.js construye `new Resend(...)` al importarse — necesita una
  // key truthy o tira. El envío en sí es fire-and-forget (ver mockFetch).
  if (!process.env.RESEND_API_KEY) process.env.RESEND_API_KEY = "re_test_fake_key";
});

const { GET } = await import("../app/api/cron/reconciliacion-mp/route.ts");

function cronReq(secret) {
  const headers = {};
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return new Request("http://localhost/api/cron/reconciliacion-mp", { headers });
}

function sbSuscripcionesActivas(rows) {
  return {
    match: (url) => url.includes("/rest/v1/suscripciones") && url.includes("estado=in.(activa,suspendida)"),
    respond: () => ({ status: 200, body: rows }),
  };
}

function mpPreapproval(id, status) {
  return {
    match: (url) => url.includes("api.mercadopago.com") && url.includes(`/preapproval/${id}`),
    respond: () => ({ status: 200, body: { id, status } }),
  };
}

// ─── Auth ───

test("reconciliacion-mp — sin CRON_SECRET devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(cronReq(null));
  assert.equal(res.status, 401);
});

test("reconciliacion-mp — CRON_SECRET incorrecto devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(cronReq("secreto-equivocado"));
  assert.equal(res.status, 401);
});

// ─── Sin suscripciones para revisar ───

test("reconciliacion-mp — sin suscripciones activas/suspendidas devuelve revisadas:0", async () => {
  global.fetch = createFetchMock([sbSuscripcionesActivas([])]);
  const res = await GET(cronReq("test-cron-secret"));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.revisadas, 0);
  assert.deepEqual(json.discrepancias, []);
});

// ─── Estados coinciden ───

test("reconciliacion-mp — estado local coincide con MP no genera discrepancias", async () => {
  global.fetch = createFetchMock([
    sbSuscripcionesActivas([
      { id: 1, empresa_id: "e1", estado: "activa", plan: "pro", gateway_subscription_id: "mp-1" },
    ]),
    mpPreapproval("mp-1", "authorized"),
  ]);
  const res = await GET(cronReq("test-cron-secret"));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.revisadas, 1);
  assert.deepEqual(json.discrepancias, []);
});

// ─── Estados no coinciden: el caso que justifica el cron ───

test("reconciliacion-mp — MP dice cancelled pero local sigue activa => discrepancia", async () => {
  global.fetch = createFetchMock([
    sbSuscripcionesActivas([
      { id: 2, empresa_id: "e2", estado: "activa", plan: "starter", gateway_subscription_id: "mp-2" },
    ]),
    mpPreapproval("mp-2", "cancelled"),
  ]);
  const res = await GET(cronReq("test-cron-secret"));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.discrepancias.length, 1);
  assert.equal(json.discrepancias[0].estado_local, "activa");
  assert.equal(json.discrepancias[0].estado_mp, "cancelada");
  assert.equal(json.discrepancias[0].mp_status_raw, "cancelled");
  assert.equal(json.discrepancias[0].suscripcion_id, 2);
});

test("reconciliacion-mp — no escribe nada en Supabase (modo dry-run)", async () => {
  let escrituras = 0;
  global.fetch = createFetchMock([
    sbSuscripcionesActivas([
      { id: 3, empresa_id: "e3", estado: "suspendida", plan: "pro", gateway_subscription_id: "mp-3" },
    ]),
    mpPreapproval("mp-3", "authorized"),
    {
      match: (url, opts) => /\/rest\/v1\/(suscripciones|empresa)/.test(url) && ["PATCH", "POST", "DELETE"].includes(opts?.method),
      respond: () => { escrituras++; return { status: 204 }; },
    },
  ]);
  const res = await GET(cronReq("test-cron-secret"));
  await res.json();
  assert.equal(escrituras, 0, "el cron no debe escribir nada en modo dry-run, ni siquiera con discrepancias");
});

// ─── Errores parciales al consultar MP no abortan la corrida ───

test("reconciliacion-mp — error consultando una suscripcion en MP no aborta el resto", async () => {
  global.fetch = createFetchMock([
    sbSuscripcionesActivas([
      { id: 4, empresa_id: "e4", estado: "activa", plan: "pro", gateway_subscription_id: "mp-4" },
      { id: 5, empresa_id: "e5", estado: "activa", plan: "pro", gateway_subscription_id: "mp-5" },
    ]),
    {
      match: (url) => url.includes("/preapproval/mp-4"),
      respond: () => ({ status: 404, body: { message: "not found" } }),
    },
    mpPreapproval("mp-5", "authorized"),
  ]);
  const res = await GET(cronReq("test-cron-secret"));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.revisadas, 2);
  assert.equal(json.errores, 1);
  assert.deepEqual(json.discrepancias, []);
});
