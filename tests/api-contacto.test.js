// tests/api-contacto.test.js — Tests HTTP de POST /api/contacto
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.RESEND_API_KEY = "re_test_dummy_key";
});

const { POST } = await import("../app/api/contacto/route.js");

function postReq(body, ip = "1.2.3.4") {
  return new Request("http://localhost/api/contacto", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

function rateLimitHandler(count) {
  return { match: (url) => url.includes("/rest/v1/rpc/rpc_login_attempt"), respond: () => ({ status: 200, body: count }) };
}

const BODY_VALIDO = { nombre: "Ana Gómez", email: "ana@empresa.com", mensaje: "Hola, quería preguntar sobre el plan Pro." };

test("contacto — rate limit excedido (fail-closed si la DB no responde) devuelve 429", async () => {
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/rest/v1/rpc/rpc_login_attempt"), respond: () => ({ status: 500, body: "error" }) },
  ]);
  const res = await POST(postReq(BODY_VALIDO));
  assert.equal(res.status, 429);
});

test("contacto — más de 3 intentos en la ventana devuelve 429", async () => {
  global.fetch = createFetchMock([rateLimitHandler(4)]);
  const res = await POST(postReq(BODY_VALIDO));
  assert.equal(res.status, 429);
});

test("contacto — body inválido (falta nombre) devuelve 400", async () => {
  global.fetch = createFetchMock([rateLimitHandler(1)]);
  const { nombre, ...sinNombre } = BODY_VALIDO;
  const res = await POST(postReq(sinNombre));
  assert.equal(res.status, 400);
});

test("contacto — body inválido (falta email) devuelve 400", async () => {
  global.fetch = createFetchMock([rateLimitHandler(1)]);
  const { email, ...sinEmail } = BODY_VALIDO;
  const res = await POST(postReq(sinEmail));
  assert.equal(res.status, 400);
});

test("contacto — body inválido (falta mensaje) devuelve 400", async () => {
  global.fetch = createFetchMock([rateLimitHandler(1)]);
  const { mensaje, ...sinMensaje } = BODY_VALIDO;
  const res = await POST(postReq(sinMensaje));
  assert.equal(res.status, 400);
});

test("contacto — éxito devuelve 200 ok:true", async () => {
  global.fetch = createFetchMock([rateLimitHandler(1)]);
  const res = await POST(postReq(BODY_VALIDO));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
});

test("contacto — fallo silencioso de Resend no rompe la respuesta", async () => {
  global.fetch = createFetchMock([
    rateLimitHandler(1),
    { match: (url) => url.includes("api.resend.com"), respond: () => ({ status: 500, body: { name: "application_error", message: "boom" } }) },
  ]);
  const res = await POST(postReq(BODY_VALIDO));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
});
