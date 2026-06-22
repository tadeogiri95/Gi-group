// tests/api-superadmin-impersonate-exchange.test.js — Tests de POST /api/superadmin/impersonate-exchange
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signImpersonateCode, signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/superadmin/impersonate-exchange/route.ts");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

function postReq(body) {
  return new Request("http://localhost/api/superadmin/impersonate-exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function handlers({ auditStatus = 200, empleado = { id: EMPLEADO_ID, legajo: 7, nombre: "Ana", rol: "gerencial", empresa_id: EMPRESA_ID, activo: true } } = {}) {
  return [
    {
      match: (url, opts) => url.includes("/rest/v1/audit_log") && opts?.method === "POST",
      respond: () => ({ status: auditStatus, body: auditStatus === 409 ? "duplicate key value violates unique constraint" : null }),
    },
    {
      match: (url) => url.includes("/rest/v1/empleados") && url.includes(`id=eq.${EMPLEADO_ID}`),
      respond: () => ({ status: 200, body: empleado ? [empleado] : [] }),
    },
  ];
}

test("impersonate-exchange — sin code devuelve 400", async () => {
  global.fetch = createFetchMock(handlers());
  const res = await POST(postReq({}));
  assert.equal(res.status, 400);
});

test("impersonate-exchange — code que no es de impersonación devuelve 401", async () => {
  global.fetch = createFetchMock(handlers());
  // Un access token normal (sin imp/code) no debe servir como código de canje
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol: "gerencial" });
  const res = await POST(postReq({ code: token }));
  assert.equal(res.status, 401);
});

test("impersonate-exchange — code con sub/eid no-UUID devuelve 401 (defensa en profundidad)", async () => {
  global.fetch = createFetchMock(handlers());
  const { token: code } = await signImpersonateCode({ empleadoId: "not-a-uuid", empresaId: EMPRESA_ID, legajo: 7, rol: "gerencial" });
  const res = await POST(postReq({ code }));
  assert.equal(res.status, 401);
});

test("impersonate-exchange — code ya utilizado (409 en audit_log) devuelve 401", async () => {
  global.fetch = createFetchMock(handlers({ auditStatus: 409 }));
  const { token: code } = await signImpersonateCode({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol: "gerencial" });
  const res = await POST(postReq({ code }));
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.ok(json.error.includes("utilizado"));
});

test("impersonate-exchange — empleado no encontrado devuelve 404", async () => {
  global.fetch = createFetchMock(handlers({ empleado: null }));
  const { token: code } = await signImpersonateCode({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol: "gerencial" });
  const res = await POST(postReq({ code }));
  assert.equal(res.status, 404);
});

test("impersonate-exchange — éxito devuelve 200 con cookie httpOnly y usuario", async () => {
  global.fetch = createFetchMock(handlers());
  const { token: code } = await signImpersonateCode({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol: "gerencial" });
  const res = await POST(postReq({ code }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.usuario.id, EMPLEADO_ID);

  const setCookie = res.headers.get("set-cookie") || "";
  assert.ok(setCookie.includes("gypi_token="), "debe setear cookie de sesión");
  assert.ok(setCookie.includes("HttpOnly") || setCookie.includes("httponly"), "cookie debe ser httpOnly");
});
