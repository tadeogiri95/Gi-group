// tests/api-billing-portal.test.js — Tests HTTP de GET/POST /api/billing/portal
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
const { GET, POST } = await import("../app/api/billing/portal/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

async function tokenConRol(rol) {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return token;
}

function getReq(token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/billing/portal", { headers });
}

function postReq(token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/billing/portal", { method: "POST", headers });
}

// ── Helpers de mock ──
function sbSuscripciones(data) {
  return {
    match: (url) => /\/rest\/v1\/suscripciones\?empresa_id=eq\./.test(url),
    respond: () => ({ status: 200, body: data ? [data] : [] }),
  };
}

function mpCancelar(status = 200) {
  return {
    match: (url) => url.includes("api.mercadopago.com") && url.includes("/preapproval/"),
    respond: () => ({ status, body: { id: "mp-sub-1", status: "cancelled" } }),
  };
}

function mpCancelarFalla() {
  return {
    match: (url) => url.includes("api.mercadopago.com") && url.includes("/preapproval/"),
    respond: () => ({ status: 400, body: { message: "invalid access token for application internal-app-id-9f3e" } }),
  };
}

// P5: tras cancelar en MP, la ruta actualiza estado local (suscripción +
// empresa, con grace period si corresponde) en vez de esperar al webhook.
function patchSuscripcionCancelada() {
  return {
    match: (url, opts) => /\/rest\/v1\/suscripciones\?id=eq\./.test(url) && opts.method === "PATCH",
    respond: () => ({ status: 204 }),
  };
}

function patchEmpresaPlan() {
  return {
    match: (url, opts) => /\/rest\/v1\/empresa\?id=eq\./.test(url) && opts.method === "PATCH",
    respond: () => ({ status: 204 }),
  };
}

// ── GET tests ──

test("billing/portal GET — sin token devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(getReq());
  assert.equal(res.status, 401);
});

test("billing/portal GET — rol operativo devuelve 403", async () => {
  const token = await tokenConRol("operativo");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await GET(getReq(token));
  assert.equal(res.status, 403);
});

test("billing/portal GET — sin suscripcion gestionada por MP devuelve 404", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    sbSuscripciones(null),
  ]);
  const res = await GET(getReq(token));
  assert.equal(res.status, 404);
  const json = await res.json();
  assert.ok(json.error);
});

test("billing/portal GET — con suscripcion MP devuelve portal_url y descripcion", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    sbSuscripciones({ id: "sub-1", gateway_subscription_id: "mp-sub-1" }),
  ]);
  const res = await GET(getReq(token));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.portal_url, "debe tener portal_url");
  assert.ok(json.descripcion, "debe tener descripcion");
  assert.ok(json.portal_url.includes("mercadopago"), "portal_url debe apuntar a mercadopago");
});

// ── POST tests ──

test("billing/portal POST — sin token devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(postReq());
  assert.equal(res.status, 401);
});

test("billing/portal POST — rol operativo devuelve 403", async () => {
  const token = await tokenConRol("operativo");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await POST(postReq(token));
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.ok(json.error);
});

test("billing/portal POST — sin suscripcion activa devuelve 404", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    sbSuscripciones(null),
  ]);
  const res = await POST(postReq(token));
  assert.equal(res.status, 404);
  const json = await res.json();
  assert.ok(json.error);
});

test("billing/portal POST — suscripcion sin gateway_subscription_id devuelve 400", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    sbSuscripciones({ id: "sub-1", estado: "activa", gateway: "mercadopago", gateway_subscription_id: null }),
  ]);
  const res = await POST(postReq(token));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error);
});

test("billing/portal POST — cancelacion exitosa devuelve 200 con ok:true", async () => {
  const token = await tokenConRol("administrativo");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    sbSuscripciones({ id: "sub-1", estado: "activa", gateway: "mercadopago", gateway_subscription_id: "mp-sub-1" }),
    mpCancelar(),
    patchSuscripcionCancelada(),
    patchEmpresaPlan(),
  ]);
  const res = await POST(postReq(token));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
});

test("billing/portal POST — fallo cancelando en Mercado Pago devuelve 500 sin exponer el detalle de MP", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    sbSuscripciones({ id: "sub-1", estado: "activa", gateway: "mercadopago", gateway_subscription_id: "mp-sub-1" }),
    mpCancelarFalla(),
  ]);
  const res = await POST(postReq(token));
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.ok(!json.error.includes("internal-app-id"), "no debe exponer el mensaje crudo de la API de Mercado Pago");
});
