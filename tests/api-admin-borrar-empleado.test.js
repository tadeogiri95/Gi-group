// tests/api-admin-borrar-empleado.test.js — Tests HTTP de POST /api/admin/borrar-empleado
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/admin/borrar-empleado/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const ACTOR_ID = "22222222-2222-2222-2222-222222222222";
const OTRO_EMPLEADO_ID = "33333333-3333-3333-3333-333333333333";

async function tokenConRol(rol) {
  const { token } = await signAccessToken({ empleadoId: ACTOR_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return token;
}

function postReq(token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/admin/borrar-empleado", { method: "POST", headers, body: JSON.stringify(body) });
}

function empleadoHandler(emp) {
  return {
    match: (url) => url.includes("/rest/v1/empleados") && url.includes("select=id,legajo,nombre"),
    respond: () => ({ status: 200, body: emp ? [emp] : [] }),
  };
}

test("admin/borrar-empleado — sin token devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(postReq(null, { empleado_id: OTRO_EMPLEADO_ID }));
  assert.equal(res.status, 401);
});

test("admin/borrar-empleado — rol operativo devuelve 403", async () => {
  global.fetch = createFetchMock(authPassHandlers());
  const token = await tokenConRol("operativo");
  const res = await POST(postReq(token, { empleado_id: OTRO_EMPLEADO_ID }));
  assert.equal(res.status, 403);
});

test("admin/borrar-empleado — sin empleado_id devuelve 400", async () => {
  global.fetch = createFetchMock(authPassHandlers());
  const token = await tokenConRol("gerencial");
  const res = await POST(postReq(token, {}));
  assert.equal(res.status, 400);
});

test("admin/borrar-empleado — empleado no encontrado o de otra empresa devuelve 404", async () => {
  global.fetch = createFetchMock([...authPassHandlers(), empleadoHandler(null)]);
  const token = await tokenConRol("gerencial");
  const res = await POST(postReq(token, { empleado_id: OTRO_EMPLEADO_ID }));
  assert.equal(res.status, 404);
});

test("admin/borrar-empleado — no permite auto-borrado", async () => {
  global.fetch = createFetchMock([...authPassHandlers(), empleadoHandler({ id: ACTOR_ID, legajo: 7, nombre: "Yo Mismo" })]);
  const token = await tokenConRol("gerencial");
  const res = await POST(postReq(token, { empleado_id: ACTOR_ID }));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error.includes("propio perfil"));
});

test("admin/borrar-empleado — éxito anonimiza PII y desactiva al empleado", async () => {
  let patchBody = null;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    empleadoHandler({ id: OTRO_EMPLEADO_ID, legajo: 99, nombre: "Juan Pérez" }),
    { match: (url, opts) => url.includes("/rest/v1/empleados") && opts?.method === "PATCH", respond: (url, opts) => { patchBody = JSON.parse(opts.body); return { status: 204 }; } },
  ]);
  const token = await tokenConRol("administrativo");
  const res = await POST(postReq(token, { empleado_id: OTRO_EMPLEADO_ID }));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(patchBody.nombre, "Empleado 99");
  assert.equal(patchBody.email, null);
  assert.equal(patchBody.dni, null);
  assert.equal(patchBody.activo, false);
});

test("admin/borrar-empleado — fallo al anonimizar devuelve 500 con detail", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    empleadoHandler({ id: OTRO_EMPLEADO_ID, legajo: 99, nombre: "Juan Pérez" }),
    { match: (url, opts) => url.includes("/rest/v1/empleados") && opts?.method === "PATCH", respond: () => ({ status: 500, body: "constraint violation" }) },
  ]);
  const token = await tokenConRol("gerencial");
  const res = await POST(postReq(token, { empleado_id: OTRO_EMPLEADO_ID }));
  assert.equal(res.status, 500);
});
