// tests/api-billing-info.test.js — Tests HTTP de GET /api/billing/info
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { GET } = await import("../app/api/billing/info/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

async function tokenConRol(rol) {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return token;
}

function getReq(token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/billing/info", { headers });
}

// ── Helpers de mock Supabase ──
function sbEmpresa(data) {
  return {
    match: (url) => /\/rest\/v1\/empresa\?id=eq\./.test(url) && !url.includes("email_verificado"),
    respond: () => ({ status: 200, body: data ? [data] : [] }),
  };
}

function sbSuscripciones(data) {
  return {
    match: (url) => /\/rest\/v1\/suscripciones\?empresa_id=eq\./.test(url),
    respond: () => ({ status: 200, body: data ? [data] : [] }),
  };
}

// ── Tests ──

test("billing/info — sin token devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(getReq());
  assert.equal(res.status, 401);
});

test("billing/info — rol operativo devuelve 403", async () => {
  const token = await tokenConRol("operativo");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await GET(getReq(token));
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.ok(json.error);
});

test("billing/info — free plan sin suscripcion devuelve plan free, estado activa", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    sbEmpresa({ plan_activo: "free", trial_fin: null }),
    sbSuscripciones(null),
  ]);
  const res = await GET(getReq(token));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.plan, "free");
  assert.equal(json.estado, "activa");
  assert.equal(json.dias_restantes, null);
});

test("billing/info — trial activo (trial_fin en futuro) devuelve estado trial con dias_restantes > 0", async () => {
  const token = await tokenConRol("administrativo");
  const futuro = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    sbEmpresa({ plan_activo: "trial", trial_fin: futuro }),
    sbSuscripciones(null),
  ]);
  const res = await GET(getReq(token));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.estado, "trial");
  assert.ok(json.dias_restantes > 0, `dias_restantes deberia ser > 0, fue ${json.dias_restantes}`);
});

test("billing/info — trial vencido (trial_fin en pasado) devuelve estado vencida", async () => {
  const token = await tokenConRol("gerencial");
  const pasado = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    sbEmpresa({ plan_activo: "trial", trial_fin: pasado }),
    sbSuscripciones(null),
  ]);
  const res = await GET(getReq(token));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.estado, "vencida");
  assert.equal(json.dias_restantes, null);
});

test("billing/info — suscripcion activa devuelve plan, precio y gateway de la suscripcion", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    sbEmpresa({ plan_activo: "starter", trial_fin: null }),
    sbSuscripciones({
      plan: "pro",
      estado: "activa",
      precio: 35000,
      moneda: "ARS",
      gateway: "mercadopago",
      periodo_fin: "2026-07-15T00:00:00Z",
    }),
  ]);
  const res = await GET(getReq(token));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.plan, "pro");
  assert.equal(json.estado, "activa");
  assert.equal(json.precio, 35000);
  assert.equal(json.gateway, "mercadopago");
  assert.equal(json.periodo_fin, "2026-07-15T00:00:00Z");
});

test("billing/info — respuesta incluye header Cache-Control: private, no-store", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    sbEmpresa({ plan_activo: "free", trial_fin: null }),
    sbSuscripciones(null),
  ]);
  const res = await GET(getReq(token));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "private, no-store");
});
