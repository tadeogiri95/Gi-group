// tests/api-auth-google-exchange.test.js — Tests de POST /api/auth/google/exchange
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signOAuthExchangeCode, signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/auth/google/exchange/route.ts");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

function postReq(body) {
  return new Request("http://localhost/api/auth/google/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function handlers({ auditStatus = 200, empleado = { id: EMPLEADO_ID, legajo: 5, nombre: "Ana", rol: "operativo", empresa_id: EMPRESA_ID, activo: true }, sesionOk = true } = {}) {
  return [
    {
      match: (url, opts) => url.includes("/rest/v1/audit_log") && opts?.method === "POST",
      respond: () => ({ status: auditStatus, body: auditStatus === 409 ? "duplicate key value violates unique constraint" : null }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/sesiones") && opts?.method === "POST",
      respond: () => (sesionOk ? { status: 201, body: [{ id: "sesion-1" }] } : { status: 500, body: "db caída" }),
    },
    {
      match: (url) => url.includes("/rest/v1/empleados") && url.includes(`id=eq.${EMPLEADO_ID}`),
      respond: () => ({ status: 200, body: empleado ? [empleado] : [] }),
    },
  ];
}

test("google/exchange — sin exchangeCode devuelve 400", async () => {
  global.fetch = createFetchMock(handlers());
  const res = await POST(postReq({}));
  assert.equal(res.status, 400);
});

test("google/exchange — código que no es de exchange (ej. access token normal) devuelve 401", async () => {
  global.fetch = createFetchMock(handlers());
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 5, rol: "operativo" });
  const res = await POST(postReq({ exchangeCode: token }));
  assert.equal(res.status, 401);
});

test("google/exchange — empleadoId/empresaId no-UUID devuelve 401 (defensa en profundidad)", async () => {
  global.fetch = createFetchMock(handlers());
  const { token: exchangeCode } = await signOAuthExchangeCode({ empleadoId: "no-es-uuid", empresaId: EMPRESA_ID, legajo: 5, rol: "operativo" });
  const res = await POST(postReq({ exchangeCode }));
  assert.equal(res.status, 401);
});

test("google/exchange — código ya utilizado (409 en audit_log) devuelve 401", async () => {
  global.fetch = createFetchMock(handlers({ auditStatus: 409 }));
  const { token: exchangeCode } = await signOAuthExchangeCode({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 5, rol: "operativo" });
  const res = await POST(postReq({ exchangeCode }));
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.ok(json.error.includes("utilizado"));
});

test("google/exchange — error de constraint con status distinto de 409 pero '23505' en el body también devuelve 401", async () => {
  global.fetch = createFetchMock([
    { match: (url, opts) => url.includes("/rest/v1/audit_log") && opts?.method === "POST", respond: () => ({ status: 500, body: "error: duplicate key 23505" }) },
  ]);
  const { token: exchangeCode } = await signOAuthExchangeCode({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 5, rol: "operativo" });
  const res = await POST(postReq({ exchangeCode }));
  assert.equal(res.status, 401);
});

test("google/exchange — empleado no encontrado tras emitir sesión devuelve 404", async () => {
  global.fetch = createFetchMock(handlers({ empleado: null }));
  const { token: exchangeCode } = await signOAuthExchangeCode({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 5, rol: "operativo" });
  const res = await POST(postReq({ exchangeCode }));
  assert.equal(res.status, 404);
});

test("google/exchange — si falla el guardado de la sesión en DB devuelve 500", async () => {
  global.fetch = createFetchMock(handlers({ sesionOk: false }));
  const { token: exchangeCode } = await signOAuthExchangeCode({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 5, rol: "operativo" });
  const res = await POST(postReq({ exchangeCode }));
  assert.equal(res.status, 500);
});

test("google/exchange — éxito devuelve 200 con cookies httpOnly (access + refresh) y usuario", async () => {
  global.fetch = createFetchMock(handlers());
  const { token: exchangeCode } = await signOAuthExchangeCode({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 5, rol: "operativo" });
  const res = await POST(postReq({ exchangeCode }));
  assert.equal(res.status, 200);

  const json = await res.json();
  assert.equal(json.usuario.id, EMPLEADO_ID);
  assert.ok(json.token, "debe devolver el access token en el body, igual que impersonate-exchange");
  assert.equal(json.expires_in, 30 * 60);

  const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie") || ""];
  const cookies = setCookie.join("; ");
  assert.ok(cookies.includes("gypi_token="), "debe setear la cookie de access token");
  assert.ok(cookies.includes("gypi_refresh="), "debe setear la cookie de refresh token");
  assert.ok(/httponly/i.test(cookies), "las cookies de sesión deben ser httpOnly");
});

test("google/exchange — un segundo canje del mismo código falla (anti-replay real, no solo el mock)", async () => {
  let auditUsado = false;
  global.fetch = createFetchMock([
    {
      match: (url, opts) => url.includes("/rest/v1/audit_log") && opts?.method === "POST",
      respond: () => {
        if (auditUsado) return { status: 409, body: "duplicate key value violates unique constraint" };
        auditUsado = true;
        return { status: 201, body: null };
      },
    },
    { match: (url, opts) => url.includes("/rest/v1/sesiones") && opts?.method === "POST", respond: () => ({ status: 201, body: [{ id: "sesion-1" }] }) },
    { match: (url) => url.includes("/rest/v1/empleados") && url.includes(`id=eq.${EMPLEADO_ID}`), respond: () => ({ status: 200, body: [{ id: EMPLEADO_ID, legajo: 5, nombre: "Ana", rol: "operativo", empresa_id: EMPRESA_ID, activo: true }] }) },
  ]);
  const { token: exchangeCode } = await signOAuthExchangeCode({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 5, rol: "operativo" });

  const primero = await POST(postReq({ exchangeCode }));
  assert.equal(primero.status, 200);

  const segundo = await POST(postReq({ exchangeCode }));
  assert.equal(segundo.status, 401);
});
