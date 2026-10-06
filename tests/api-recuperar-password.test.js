// tests/api-recuperar-password.test.js — Tests HTTP de POST /api/recuperar-password
//
// La ruta SIEMPRE responde 200 con un mensaje genérico (anti-enumeración) y
// aplica un retardo mínimo de 300ms para nivelar timing entre "no existe" y
// "existe" — por diseño, cada test de este archivo tarda >=300ms.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.RESEND_API_KEY = "re_test_dummy_key";
});

const { POST } = await import("../app/api/recuperar-password/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";

function rateLimitOk(count = 1) {
  return { match: (url) => url.includes("/rpc/rpc_login_attempt"), respond: () => ({ status: 200, body: count }) };
}

function postReq(body) {
  return new Request("http://localhost/api/recuperar-password", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "9.9.9.9" },
    body: JSON.stringify(body),
  });
}

test("recuperar-password — sin email/empresa_id responde 200 genérico", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(postReq({}));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
});

test("recuperar-password — email no registrado responde 200 con el mismo mensaje genérico (no filtra)", async () => {
  global.fetch = createFetchMock([
    rateLimitOk(),
    { match: (url) => url.includes("/rest/v1/empleados") && url.includes("select=id,nombre,empresa_id"), respond: () => ({ status: 200, body: [] }) },
  ]);
  const res = await POST(postReq({ email: "noexiste@test.com", empresa_id: EMPRESA_ID }));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.mensaje, "Si el email está registrado, recibirás un link en minutos.");
});

test("recuperar-password — empleado encontrado genera token, guarda jti y dispara el envío", async () => {
  let jtiGuardado = null;
  global.fetch = createFetchMock([
    rateLimitOk(),
    { match: (url) => url.includes("/rest/v1/empleados") && url.includes("select=id,nombre,empresa_id"), respond: () => ({ status: 200, body: [{ id: "emp-1", nombre: "Ana", empresa_id: EMPRESA_ID }] }) },
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=nombre,slug"), respond: () => ({ status: 200, body: [{ nombre: "ACME", slug: "acme" }] }) },
    { match: (url, opts) => url.includes("/rest/v1/empleados") && opts?.method === "PATCH", respond: (url, opts) => { jtiGuardado = JSON.parse(opts.body).password_reset_jti; return { status: 204 }; } },
  ]);
  const res = await POST(postReq({ email: "ana@test.com", empresa_id: EMPRESA_ID }));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.ok(jtiGuardado, "debe guardar un jti para permitir uso único del link");
});

test("recuperar-password — siempre responde 200 aunque ocurra un error inesperado", async () => {
  global.fetch = createFetchMock([
    rateLimitOk(),
    { match: (url) => url.includes("/rest/v1/empleados") && url.includes("select=id,nombre,empresa_id"), respond: () => { throw new Error("DB caída"); } },
  ]);
  const res = await POST(postReq({ email: "ana@test.com", empresa_id: EMPRESA_ID }));
  assert.equal(res.status, 200);
});

// ─── F2-12: rate limit y validación de empresa_id ───

test("recuperar-password — empresa_id que no es UUID responde 200 genérico sin consultar la base", async () => {
  global.fetch = createFetchMock([]); // cualquier fetch fallaría con "Sin handler"
  const res = await POST(postReq({ email: "ana@test.com", empresa_id: "x&empresa_id=neq.0" }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test("recuperar-password — demasiados pedidos desde la misma IP devuelve 429 y no manda mail", async () => {
  let buscoEmpleado = false;
  global.fetch = createFetchMock([
    rateLimitOk(6),
    { match: (url) => url.includes("/rest/v1/empleados"), respond: () => { buscoEmpleado = true; return { status: 200, body: [] }; } },
  ]);
  const res = await POST(postReq({ email: "ana@test.com", empresa_id: EMPRESA_ID }));
  assert.equal(res.status, 429);
  assert.equal(buscoEmpleado, false);
});

test("recuperar-password — cuenta por IP y por email (normalizado)", async () => {
  const claves = [];
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/rpc/rpc_login_attempt"), respond: (url, opts) => { claves.push(JSON.parse(opts.body).p_ip); return { status: 200, body: 1 }; } },
    { match: (url) => url.includes("/rest/v1/empleados"), respond: () => ({ status: 200, body: [] }) },
  ]);
  await POST(postReq({ email: "  Ana@Test.com ", empresa_id: EMPRESA_ID }));
  assert.deepEqual(claves, ["recupero-ip:9.9.9.9", "recupero-email:ana@test.com"]);
});

test("recuperar-password — 4to pedido para el mismo email devuelve 429", async () => {
  global.fetch = createFetchMock([
    { match: (url, opts) => url.includes("/rpc/rpc_login_attempt"), respond: (url, opts) => ({ status: 200, body: JSON.parse(opts.body).p_ip.startsWith("recupero-email:") ? 4 : 1 }) },
  ]);
  const res = await POST(postReq({ email: "ana@test.com", empresa_id: EMPRESA_ID }));
  assert.equal(res.status, 429);
});

test("recuperar-password — si la base del rate limit no responde, bloquea (fail-closed)", async () => {
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/rpc/rpc_login_attempt"), respond: () => ({ status: 500, body: "caída" }) },
  ]);
  const res = await POST(postReq({ email: "ana@test.com", empresa_id: EMPRESA_ID }));
  assert.equal(res.status, 429);
});
