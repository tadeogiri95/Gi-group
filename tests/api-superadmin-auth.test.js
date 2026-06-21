// tests/api-superadmin-auth.test.js — Tests HTTP de POST /api/superadmin/auth
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.SUPERADMIN_SECRET = "mi-secreto-de-superadmin";
});

const { POST } = await import("../app/api/superadmin/auth/route.ts");

function req(body) {
  return new Request("http://localhost/api/superadmin/auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "1.2.3.4",
    },
    body: JSON.stringify(body),
  });
}

function handlersBase({ rateLimitCount = 0 } = {}) {
  return [
    {
      match: (url) => url.includes("/rpc/rpc_login_attempt"),
      respond: () => ({ status: 200, body: rateLimitCount }),
    },
  ];
}

beforeEach(() => {
  process.env.SUPERADMIN_SECRET = "mi-secreto-de-superadmin";
  global.fetch = createFetchMock(handlersBase());
});

test("superadmin auth — clave correcta devuelve 200 y cookie httpOnly", async () => {
  const res = await POST(req({ key: "mi-secreto-de-superadmin" }));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);

  const setCookie = res.headers.get("set-cookie") || "";
  assert.ok(setCookie.includes("gypi_superadmin="), "debe setear cookie superadmin");
  assert.ok(setCookie.includes("HttpOnly") || setCookie.includes("httponly"), "cookie debe ser httpOnly");
  assert.ok(setCookie.includes("Path=/superadmin"), "cookie debe estar scoped a /superadmin");
});

test("superadmin auth — clave incorrecta devuelve 401", async () => {
  const res = await POST(req({ key: "clave-equivocada" }));
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.ok(json.error.includes("incorrecta"));
});

test("superadmin auth — sin clave devuelve 401", async () => {
  const res = await POST(req({}));
  assert.equal(res.status, 401);
});

test("superadmin auth — SUPERADMIN_SECRET no configurado devuelve 500", async () => {
  delete process.env.SUPERADMIN_SECRET;
  const res = await POST(req({ key: "algo" }));
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.ok(json.error.includes("no configurado"));
});

test("superadmin auth — rate limit excedido devuelve 429", async () => {
  global.fetch = createFetchMock(handlersBase({ rateLimitCount: 10 }));
  const res = await POST(req({ key: "mi-secreto-de-superadmin" }));
  assert.equal(res.status, 429);
  const json = await res.json();
  assert.ok(json.error.includes("intentos"));
});

test("superadmin auth — rate limit en el límite exacto (5) no bloquea", async () => {
  global.fetch = createFetchMock(handlersBase({ rateLimitCount: 5 }));
  const res = await POST(req({ key: "mi-secreto-de-superadmin" }));
  assert.equal(res.status, 200, "count=5 es el máximo permitido (>MAX_ATTEMPTS bloquea, no >=)");
});

test("superadmin auth — fallo de rate limit RPC no bloquea (fail-open)", async () => {
  global.fetch = createFetchMock([
    {
      match: (url) => url.includes("/rpc/rpc_login_attempt"),
      respond: () => ({ status: 500, body: "DB error" }),
    },
  ]);
  const res = await POST(req({ key: "mi-secreto-de-superadmin" }));
  assert.equal(res.status, 200, "si el rate limit falla, debe dejar pasar (fail-open)");
});
