// tests/api-logout.test.js — Tests HTTP de POST /api/logout
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/logout/route.ts");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

function reqConCookie(cookieHeader) {
  return new NextRequest("http://localhost/api/logout", {
    method: "POST",
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
}

function setCookiesDe(res) {
  const arr = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie") || ""];
  return arr.join("; ");
}

test("logout — sin cookie devuelve 200 ok:true y limpia las cookies igual", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(reqConCookie(null));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  const cookies = setCookiesDe(res);
  assert.ok(cookies.includes("gypi_token="), "debe limpiar gypi_token");
  assert.ok(cookies.includes("gypi_refresh="), "debe limpiar gypi_refresh");
  assert.ok(cookies.includes("Max-Age=0"), "debe expirar las cookies inmediatamente");
});

test("logout — con cookie de sesión revoca la sesión en DB por jti", async () => {
  const { token, jti } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol: "operativo" });
  let urlCapturada = null;
  global.fetch = createFetchMock([
    { match: (url, opts) => url.includes("/rest/v1/sesiones") && opts?.method === "DELETE", respond: (url) => { urlCapturada = url; return { status: 204 }; } },
  ]);

  const res = await POST(reqConCookie(`gypi_token=${token}`));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.ok(urlCapturada.includes(`token=eq.${jti}`), "debe revocar la sesión usando el jti del token");
});

test("logout — si falla la revocación en DB, igual responde 200", async () => {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol: "operativo" });
  global.fetch = createFetchMock([
    { match: (url, opts) => url.includes("/rest/v1/sesiones") && opts?.method === "DELETE", respond: () => { throw new Error("DB caída"); } },
  ]);

  const res = await POST(reqConCookie(`gypi_token=${token}`));
  const json = await res.json();

  assert.equal(res.status, 200, "el logout no debe bloquearse por un fallo de revocación en DB");
  assert.equal(json.ok, true);
});

test("logout — token de cookie ilegible no rompe el logout", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(reqConCookie("gypi_token=esto-no-es-un-jwt-valido"));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
});
