// tests/api-contacto-enterprise.test.js — Tests HTTP de POST /api/contacto-enterprise
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.RESEND_API_KEY = "re_test_dummy_key";
});

const { POST } = await import("../app/api/contacto-enterprise/route.js");

function postReq(body, ip = "1.2.3.4") {
  return new Request("http://localhost/api/contacto-enterprise", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

function rateLimitHandler(count) {
  return { match: (url) => url.includes("/rest/v1/rpc/rpc_login_attempt"), respond: () => ({ status: 200, body: count }) };
}

const BODY_VALIDO = { nombre: "Ana Gómez", email: "ana@empresa.com", empresa: "ACME SA" };

test("contacto-enterprise — rate limit excedido (fail-closed si la DB no responde) devuelve 429", async () => {
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/rest/v1/rpc/rpc_login_attempt"), respond: () => ({ status: 500, body: "error" }) },
  ]);
  const res = await POST(postReq(BODY_VALIDO));
  assert.equal(res.status, 429);
});

test("contacto-enterprise — más de 3 intentos en la ventana devuelve 429", async () => {
  global.fetch = createFetchMock([rateLimitHandler(4)]);
  const res = await POST(postReq(BODY_VALIDO));
  assert.equal(res.status, 429);
});

test("contacto-enterprise — body inválido (falta email) devuelve 400", async () => {
  global.fetch = createFetchMock([rateLimitHandler(1)]);
  const res = await POST(postReq({ nombre: "Ana", empresa: "ACME" }));
  assert.equal(res.status, 400);
});

test("contacto-enterprise — éxito devuelve 200 ok:true", async () => {
  global.fetch = createFetchMock([rateLimitHandler(1)]);
  const res = await POST(postReq(BODY_VALIDO));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
});
