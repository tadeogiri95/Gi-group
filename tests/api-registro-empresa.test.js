// tests/api-registro-empresa.test.js — Tests HTTP de POST /api/registro-empresa
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.RESEND_API_KEY = "re_test_dummy_key"; // ver mockFetch: Resend se mockea como fire-and-forget
});

const { POST } = await import("../app/api/registro-empresa/route.js");

function req(body) {
  return new Request("http://localhost/api/registro-empresa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const FORM_OK = {
  nombre_empresa: "Metalúrgica Test",
  nombre_admin: "Juan Pérez",
  email: "juan@metalurgica-test.com",
  password: "Segura123",
  rubro: "industria",
};

function handlersBase({ rateLimitCount = 0, emailExiste = false, slugExiste = false } = {}) {
  return [
    { match: (url) => url.includes("/rpc/rpc_login_attempt"), respond: () => ({ status: 200, body: rateLimitCount }) },
    { match: (url) => url.includes("/rest/v1/empresa?admin_email"), respond: () => ({ status: 200, body: emailExiste ? [{ id: "ya-existe" }] : [] }) },
    { match: (url) => url.includes("/rest/v1/empresa?slug"), respond: () => ({ status: 200, body: slugExiste ? [{ id: "ya-existe" }] : [] }) },
    {
      match: (url) => url.includes("/rpc/rpc_crear_empresa_con_admin"),
      respond: () => ({ status: 200, body: { empresa_id: "emp-1", empleado_id: "adm-1" } }),
    },
    { match: (url) => url.includes("/rpc/iniciar_trial_pro"), respond: () => ({ status: 200, body: {} }) },
  ];
}

beforeEach(() => {
  global.fetch = createFetchMock(handlersBase());
});

test("registro — datos válidos crea empresa y admin, devuelve slug", async () => {
  const res = await POST(req(FORM_OK));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.empresa.id, "emp-1");
  assert.ok(json.empresa.slug.startsWith("metalurgica-test"));
  assert.equal(json.usuario.rol, "gerencial");
});

test("registro — faltan campos devuelve 400", async () => {
  const res = await POST(req({ nombre_empresa: "X" }));
  assert.equal(res.status, 400);
});

test("registro — password débil devuelve 400 con mensaje de validarPassword", async () => {
  const res = await POST(req({ ...FORM_OK, password: "abc" }));
  const json = await res.json();
  assert.equal(res.status, 400);
  assert.ok(json.error);
});

test("registro — email ya registrado devuelve 400", async () => {
  global.fetch = createFetchMock(handlersBase({ emailExiste: true }));
  const res = await POST(req(FORM_OK));
  assert.equal(res.status, 400);
});

test("registro — slug duplicado se resuelve agregando sufijo, no falla", async () => {
  global.fetch = createFetchMock(handlersBase({ slugExiste: true }));
  const res = await POST(req(FORM_OK));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.notEqual(json.empresa.slug, "metalurgica-test");
});

test("registro — rate limit excedido devuelve 429", async () => {
  global.fetch = createFetchMock(handlersBase({ rateLimitCount: 10 }));
  const res = await POST(req(FORM_OK));
  assert.equal(res.status, 429);
});
