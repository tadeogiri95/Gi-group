// tests/api-login-empresa.test.js — Tests HTTP de POST /api/login-empresa
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { POST } = await import("../app/api/login-empresa/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const PASSWORD_OK = "Segura123";
let HASH_OK;
before(async () => { HASH_OK = await bcrypt.hash(PASSWORD_OK, 10); });

function req(body) {
  return new Request("http://localhost/api/login-empresa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function handlersBase({ rateLimitCount = 0 } = {}) {
  return [
    { match: (url) => url.includes("/rpc/rpc_login_attempt"), respond: () => ({ status: 200, body: rateLimitCount }) },
    {
      match: (url) => url.includes("/rest/v1/empleados"),
      respond: () => ({
        status: 200,
        body: [{
          id: "emp-1", empresa_id: EMPRESA_ID, legajo: 7, rol: "gerencial",
          nombre: "Ana Test", apodo: "Ana", password: HASH_OK, activo: true,
        }],
      }),
    },
    { match: (url) => url.includes("/rest/v1/sesiones") && (url.includes("token_hash") || url.includes("token=eq")), respond: () => ({ status: 200, body: [{ id: "sesion-1" }] }) },
    { match: (url, opts) => url.includes("/rest/v1/sesiones") && opts?.method === "POST", respond: () => ({ status: 201, body: [{ id: "sesion-new" }] }) },
    {
      match: (url) => url.includes("/rest/v1/empresa"),
      respond: () => ({ status: 200, body: [{ id: EMPRESA_ID, nombre: "Empresa Test", slug: "empresa-test" }] }),
    },
  ];
}

beforeEach(() => {
  global.fetch = createFetchMock(handlersBase());
});

test("login — credenciales correctas devuelve 200 sin token en el body (solo cookies)", async () => {
  const res = await POST(req({ legajo: "7", password: PASSWORD_OK, empresa_id: EMPRESA_ID }));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.usuario.legajo, 7);
  assert.equal(json.token, undefined, "el access token no debe viajar en el JSON body (XSS)");
  assert.equal(json.refresh_token, undefined, "el refresh token no debe viajar en el JSON body (XSS)");
  assert.equal(json.expires_in, 30 * 60, "expires_in debe coincidir con la duración real del access token");
  assert.equal(json.usuario.password, undefined, "el hash de password nunca debe salir en la respuesta");

  const setCookie = res.headers.get("set-cookie") || "";
  assert.ok(setCookie.includes("gypi_token="), "debe setear la cookie httpOnly gypi_token");
});

test("login — password incorrecta devuelve 401 y mensaje genérico", async () => {
  const res = await POST(req({ legajo: "7", password: "incorrecta", empresa_id: EMPRESA_ID }));
  const json = await res.json();
  assert.equal(res.status, 401);
  assert.ok(json.error);
});

test("login — faltan campos devuelve 400", async () => {
  const res = await POST(req({ legajo: "7" }));
  assert.equal(res.status, 400);
});

test("login — legajo inexistente devuelve 401 (no 500)", async () => {
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/rest/v1/empleados"), respond: () => ({ status: 200, body: [] }) },
    ...handlersBase(),
  ]);
  const res = await POST(req({ legajo: "999", password: PASSWORD_OK, empresa_id: EMPRESA_ID }));
  assert.equal(res.status, 401);
});

test("login — rate limit excedido devuelve 429", async () => {
  global.fetch = createFetchMock(handlersBase({ rateLimitCount: 50 }));
  const res = await POST(req({ legajo: "7", password: PASSWORD_OK, empresa_id: EMPRESA_ID }));
  assert.equal(res.status, 429);
});

test("login — error interno no expone err.message crudo", async () => {
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/rpc/rpc_login_attempt"), respond: () => ({ status: 200, body: 0 }) },
    { match: (url) => url.includes("/rest/v1/empleados"), respond: () => ({ status: 500, body: { message: "detalle interno sensible de postgres" } }) },
  ]);
  const res = await POST(req({ legajo: "7", password: PASSWORD_OK, empresa_id: EMPRESA_ID }));
  const json = await res.json();
  assert.equal(res.status, 500);
  assert.equal(json.error, "Error interno del servidor");
});
