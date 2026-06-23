// tests/api-resetear-password.test.js — Tests HTTP de POST /api/resetear-password
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signPasswordResetToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/resetear-password/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";
const PASSWORD_FUERTE = "Abcdef12";

function postReq(body) {
  return new Request("http://localhost/api/resetear-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function empleadoHandler(rows) {
  return {
    match: (url) => url.includes("/rest/v1/empleados") && url.includes("select=id,password_reset_jti"),
    respond: () => ({ status: 200, body: rows }),
  };
}

test("resetear-password — sin token o sin nueva_password devuelve 400", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(postReq({ token: "x" }));
  assert.equal(res.status, 400);
});

test("resetear-password — token inválido/no es de reset devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(postReq({ token: "esto-no-es-un-jwt", nueva_password: PASSWORD_FUERTE }));
  assert.equal(res.status, 401);
});

test("resetear-password — password débil devuelve 400 antes de tocar la DB", async () => {
  global.fetch = createFetchMock([]);
  const { token } = await signPasswordResetToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID });
  const res = await POST(postReq({ token, nueva_password: "abc" }));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error.includes("8 caracteres"));
});

test("resetear-password — empleado no encontrado o inactivo devuelve 404", async () => {
  global.fetch = createFetchMock([empleadoHandler([])]);
  const { token } = await signPasswordResetToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID });
  const res = await POST(postReq({ token, nueva_password: PASSWORD_FUERTE }));
  assert.equal(res.status, 404);
});

test("resetear-password — jti ya usado (link reutilizado) devuelve 401", async () => {
  global.fetch = createFetchMock([empleadoHandler([{ id: EMPLEADO_ID, password_reset_jti: "otro-jti-distinto" }])]);
  const { token } = await signPasswordResetToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID });
  const res = await POST(postReq({ token, nueva_password: PASSWORD_FUERTE }));
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.ok(json.error.includes("expiró") || json.error.includes("usado"));
});

test("resetear-password — éxito actualiza password hasheada y limpia el jti", async () => {
  const { token, jti } = await signPasswordResetToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID });
  let patchBody = null;
  global.fetch = createFetchMock([
    empleadoHandler([{ id: EMPLEADO_ID, password_reset_jti: jti }]),
    { match: (url, opts) => url.includes("/rest/v1/empleados") && opts?.method === "PATCH", respond: (url, opts) => { patchBody = JSON.parse(opts.body); return { status: 204 }; } },
  ]);
  const res = await POST(postReq({ token, nueva_password: PASSWORD_FUERTE }));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(patchBody.password_reset_jti, null);
  assert.notEqual(patchBody.password, PASSWORD_FUERTE, "la password debe quedar hasheada, no en texto plano");
});

test("resetear-password — fallo al actualizar en DB devuelve 500", async () => {
  const { token, jti } = await signPasswordResetToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID });
  global.fetch = createFetchMock([
    empleadoHandler([{ id: EMPLEADO_ID, password_reset_jti: jti }]),
    { match: (url, opts) => url.includes("/rest/v1/empleados") && opts?.method === "PATCH", respond: () => ({ status: 500, body: "error" }) },
  ]);
  const res = await POST(postReq({ token, nueva_password: PASSWORD_FUERTE }));
  assert.equal(res.status, 500);
});

test("resetear-password — body no-JSON no rompe el handler (500 controlado)", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(postReq("esto no es json"));
  assert.equal(res.status, 500);
});
