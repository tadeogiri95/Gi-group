// tests/api-cron-vencer-trials.test.js — Tests de GET /api/cron/vencer-trials
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.CRON_SECRET = "test-cron-secret";
  if (!process.env.RESEND_API_KEY) process.env.RESEND_API_KEY = "re_test_fake_key";
});

const { GET } = await import("../app/api/cron/vencer-trials/route.ts");

function cronReq(secret) {
  const headers = {};
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return new Request("http://localhost/api/cron/vencer-trials", { headers });
}

// El cron siempre corre primero la query de empresas huérfanas (plan no-free
// sin fila en suscripciones). Por defecto no hay candidatas — los tests que
// quieren ejercitar ese camino agregan su propio handler antes de este.
function sinHuerfanas() {
  return {
    match: (url) => url.includes("/rest/v1/empresa") && url.includes("plan_activo=neq.free"),
    respond: () => ({ status: 200, body: [] }),
  };
}

// ─── Auth ───

test("vencer-trials — sin CRON_SECRET devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(cronReq(null));
  assert.equal(res.status, 401);
});

test("vencer-trials — CRON_SECRET incorrecto devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(cronReq("secreto-equivocado"));
  assert.equal(res.status, 401);
});

// ─── Batch RPC path ───

test("vencer-trials — RPC batch exitoso procesa trials y devuelve vencidos", async () => {
  global.fetch = createFetchMock([
    sinHuerfanas(),
    {
      match: (url) => url.includes("/rpc/vencer_trials_batch"),
      respond: () => ({
        status: 200,
        body: [
          { empresa_id: "e1", nombre: "Empresa 1", nombre_corto: "E1", slug: "e1", admin_email: "a@e1.com" },
          { empresa_id: "e2", nombre: "Empresa 2", nombre_corto: "E2", slug: "e2", admin_email: null },
        ],
      }),
    },
  ]);

  const res = await GET(cronReq("test-cron-secret"));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.vencidos, 2);
});

test("vencer-trials — RPC batch sin trials devuelve vencidos:0", async () => {
  global.fetch = createFetchMock([
    sinHuerfanas(),
    {
      match: (url) => url.includes("/rpc/vencer_trials_batch"),
      respond: () => ({ status: 200, body: [] }),
    },
  ]);

  const res = await GET(cronReq("test-cron-secret"));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.vencidos, 0);
});

// ─── Fallback path (RPC no disponible) ───

test("vencer-trials — fallback fila por fila cuando RPC batch no existe", async () => {
  global.fetch = createFetchMock([
    sinHuerfanas(),
    {
      match: (url) => url.includes("/rpc/vencer_trials_batch"),
      respond: () => ({ status: 404, body: '{"message":"function vencer_trials_batch does not exist"}' }),
    },
    {
      match: (url) => url.includes("/rest/v1/suscripciones") && url.includes("estado=eq.trial"),
      respond: () => ({
        status: 200,
        body: [{ id: 1, empresa_id: "e1" }],
      }),
    },
    {
      match: (url) => url.includes("/rest/v1/empresa") && url.includes("id=in."),
      respond: () => ({
        status: 200,
        body: [{ id: "e1", nombre: "Empresa 1", nombre_corto: "E1", slug: "e1", admin_email: "admin@e1.com" }],
      }),
    },
    {
      match: (url) => url.includes("/rpc/vencer_trial_atomico"),
      respond: () => ({ status: 200, body: null }),
    },
  ]);

  const res = await GET(cronReq("test-cron-secret"));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.vencidos, 1);
});

test("vencer-trials — fallback sin trials vencidos devuelve 0", async () => {
  global.fetch = createFetchMock([
    sinHuerfanas(),
    {
      match: (url) => url.includes("/rpc/vencer_trials_batch"),
      respond: () => ({ status: 404, body: '{"message":"function vencer_trials_batch does not exist"}' }),
    },
    {
      match: (url) => url.includes("/rest/v1/suscripciones") && url.includes("estado=eq.trial"),
      respond: () => ({ status: 200, body: [] }),
    },
  ]);

  const res = await GET(cronReq("test-cron-secret"));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.vencidos, 0);
});

test("vencer-trials — fallback doble: RPC batch + RPC atómico ambos no existen, usa PATCH secuencial", async () => {
  let empresaPatched = false;
  let suscripcionPatched = false;

  global.fetch = createFetchMock([
    sinHuerfanas(),
    {
      match: (url) => url.includes("/rpc/vencer_trials_batch"),
      respond: () => ({ status: 404, body: '{"message":"function vencer_trials_batch does not exist"}' }),
    },
    {
      match: (url) => url.includes("/rest/v1/suscripciones") && url.includes("estado=eq.trial"),
      respond: () => ({ status: 200, body: [{ id: 1, empresa_id: "e1" }] }),
    },
    {
      match: (url) => url.includes("/rest/v1/empresa") && url.includes("id=in."),
      respond: () => ({
        status: 200,
        body: [{ id: "e1", nombre: "E1", nombre_corto: "E1", slug: "e1", admin_email: "a@e1.com" }],
      }),
    },
    {
      match: (url) => url.includes("/rpc/vencer_trial_atomico"),
      respond: () => ({ status: 404, body: '{"message":"function vencer_trial_atomico does not exist"}' }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/empresa?id=eq.") && opts?.method === "PATCH",
      respond: () => { empresaPatched = true; return { status: 204 }; },
    },
    {
      match: (url, opts) => url.includes("/rest/v1/suscripciones?id=eq.") && opts?.method === "PATCH",
      respond: () => { suscripcionPatched = true; return { status: 204 }; },
    },
  ]);

  const res = await GET(cronReq("test-cron-secret"));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.vencidos, 1);
  assert.equal(empresaPatched, true, "debe hacer PATCH a empresa para cambiar plan a free");
  assert.equal(suscripcionPatched, true, "debe hacer PATCH a suscripciones para marcar vencida");
});

// ─── Huérfanas: plan no-free sin ninguna fila en suscripciones ───

test("vencer-trials — empresa huérfana (sin fila en suscripciones) se corrige a free y cuenta como vencida", async () => {
  let empresaHuerfanaPatched = false;

  global.fetch = createFetchMock([
    {
      match: (url) => url.includes("/rest/v1/empresa") && url.includes("plan_activo=neq.free"),
      respond: (url) => {
        // Confirma que respeta plan_override_manual (no debe tocar planes pactados a mano)
        assert.ok(url.includes("plan_override_manual=eq.false"), "debe excluir empresas con override manual");
        return {
          status: 200,
          body: [{ id: "huerfana-1", nombre: "Huerfana SA", nombre_corto: "Huerfana", slug: "huerfana", admin_email: "a@huerfana.com" }],
        };
      },
    },
    {
      match: (url) => url.includes("/rest/v1/suscripciones") && url.includes("empresa_id=in."),
      respond: () => ({ status: 200, body: [] }), // confirma: cero filas en suscripciones
    },
    {
      match: (url, opts) => url.includes("/rest/v1/empresa?id=eq.huerfana-1") && opts?.method === "PATCH",
      respond: () => { empresaHuerfanaPatched = true; return { status: 204 }; },
    },
    {
      match: (url) => url.includes("/rpc/vencer_trials_batch"),
      respond: () => ({ status: 200, body: [] }),
    },
  ]);

  const res = await GET(cronReq("test-cron-secret"));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.vencidos, 1);
  assert.equal(empresaHuerfanaPatched, true, "debe hacer PATCH a la empresa huérfana para bajarla a free");
});

test("vencer-trials — candidata huérfana que sí tiene fila en suscripciones no se toca", async () => {
  global.fetch = createFetchMock([
    {
      match: (url) => url.includes("/rest/v1/empresa") && url.includes("plan_activo=neq.free"),
      respond: () => ({
        status: 200,
        body: [{ id: "no-huerfana-1", nombre: "No Huerfana", nombre_corto: "NoHuerfana", slug: "no-huerfana", admin_email: "a@nohuerfana.com" }],
      }),
    },
    {
      match: (url) => url.includes("/rest/v1/suscripciones") && url.includes("empresa_id=in."),
      respond: () => ({ status: 200, body: [{ empresa_id: "no-huerfana-1" }] }), // tiene fila — no es huérfana
    },
    {
      match: (url) => url.includes("/rpc/vencer_trials_batch"),
      respond: () => ({ status: 200, body: [] }),
    },
  ]);

  const res = await GET(cronReq("test-cron-secret"));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.vencidos, 0);
});
