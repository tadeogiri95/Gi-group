// tests/api-billing-create-subscription.test.js — Tests HTTP de POST /api/billing/create-subscription
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-fake-token";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/billing/create-subscription/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

async function tokenConRol(rol) {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return token;
}

function postReq(token, body = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/billing/create-subscription", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// ── Helpers de mock ──
function sbEmpresa(data) {
  return {
    match: (url) => /\/rest\/v1\/empresa\?id=eq\./.test(url) && !url.includes("email_verificado"),
    respond: () => ({ status: 200, body: data ? [data] : [] }),
  };
}

function sbPostSuscripciones(id = "susc-1") {
  return {
    match: (url, opts) => /\/rest\/v1\/suscripciones/.test(url) && opts.method === "POST",
    respond: () => ({ status: 201, body: [{ id }] }),
  };
}

function sbPatchOk() {
  return {
    match: (url, opts) => /\/rest\/v1\/suscripciones\?id=eq\./.test(url) && opts.method === "PATCH",
    respond: () => ({ status: 200, body: {} }),
  };
}

function mpCrearPreapproval(id = "mp-123", init_point = "https://mp.com/pay") {
  return {
    match: (url, opts) => url.includes("api.mercadopago.com") && url.includes("/preapproval") && opts.method === "POST",
    respond: () => ({ status: 200, body: { id, init_point } }),
  };
}

// ── Tests ──

test("create-subscription — sin token devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(postReq(null, { plan: "starter" }));
  assert.equal(res.status, 401);
});

test("create-subscription — rol operativo devuelve 403", async () => {
  const token = await tokenConRol("operativo");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await POST(postReq(token, { plan: "starter" }));
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.ok(json.error);
});

test("create-subscription — plan invalido devuelve 400", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await POST(postReq(token, { plan: "galaxy" }));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.match(json.error, /[Pp]lan/);
});

test("create-subscription — periodo invalido devuelve 400", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await POST(postReq(token, { plan: "starter", periodo: "semanal" }));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.match(json.error, /[Pp]eriodo/);
});

test("create-subscription — empresa sin admin_email devuelve 400", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    sbEmpresa({ admin_email: null, nombre: "Test", slug: "test" }),
  ]);
  const res = await POST(postReq(token, { plan: "starter" }));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error.includes("email"), `error deberia mencionar email: ${json.error}`);
});

test("create-subscription — flujo exitoso devuelve 200 con init_point y suscripcion_id", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    sbEmpresa({ admin_email: "a@test.com", nombre: "Test", slug: "test" }),
    sbPostSuscripciones("susc-1"),
    mpCrearPreapproval("mp-123", "https://mp.com/pay"),
    sbPatchOk(),
  ]);
  const res = await POST(postReq(token, { plan: "pro", periodo: "mensual" }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.init_point, "https://mp.com/pay");
  assert.equal(json.suscripcion_id, "susc-1");
  assert.equal(json.mp_preapproval_id, "mp-123");
});
