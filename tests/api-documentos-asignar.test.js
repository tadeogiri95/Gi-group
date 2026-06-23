// tests/api-documentos-asignar.test.js — Tests HTTP de POST/DELETE /api/documentos/asignar
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST, DELETE } = await import("../app/api/documentos/asignar/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const ACTOR_ID = "22222222-2222-2222-2222-222222222222";
const TIPO_DOC_ID = "55555555-5555-5555-5555-555555555555";
const EMP_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EMP_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

async function tokenConRol(rol) {
  const { token } = await signAccessToken({ empleadoId: ACTOR_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return token;
}

function req(method, token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/documentos/asignar", { method, headers, body: JSON.stringify(body) });
}

function manyUUIDs(n) {
  return Array.from({ length: n }, (_, i) => `aaaaaaaa-aaaa-aaaa-aaaa-${String(i).padStart(12, "0")}`);
}

function tipoDocHandler(tipo) {
  return {
    match: (url) => url.includes("/rest/v1/tipos_documento_requerido") && url.includes(`id=eq.${TIPO_DOC_ID}`),
    respond: () => ({ status: 200, body: tipo ? [tipo] : [] }),
  };
}

function empleadosValidosHandler(empleados) {
  return {
    match: (url) => url.includes("/rest/v1/empleados") && url.includes("id=in."),
    respond: () => ({ status: 200, body: empleados }),
  };
}

function yaAsignadosHandler(asignados) {
  return {
    match: (url) => url.includes("/rest/v1/documentos_exigidos_empleado") && url.includes("select=empleado_id"),
    respond: () => ({ status: 200, body: asignados }),
  };
}

function insertHandler(ok = true) {
  return {
    match: (url, opts) => url.includes("/rest/v1/documentos_exigidos_empleado") && opts?.method === "POST",
    respond: (url, opts) => (ok ? { status: 201, body: JSON.parse(opts.body) } : { status: 500, body: "insert failed" }),
  };
}

function deleteHandler(ok = true) {
  return {
    match: (url, opts) => url.includes("/rest/v1/documentos_exigidos_empleado") && opts?.method === "DELETE",
    respond: () => (ok ? { status: 204 } : { status: 500, body: "delete failed" }),
  };
}

function handlersAsignar({ tipo = { id: TIPO_DOC_ID }, empleadosValidos = [{ id: EMP_A }, { id: EMP_B }], yaAsignados = [] } = {}) {
  return [...authPassHandlers(), tipoDocHandler(tipo), empleadosValidosHandler(empleadosValidos), yaAsignadosHandler(yaAsignados), insertHandler()];
}

// ─── POST — auth ───

test("asignar POST — sin token devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(req("POST", null, { tipo_documento_id: TIPO_DOC_ID, empleado_ids: [EMP_A] }));
  assert.equal(res.status, 401);
});

test("asignar POST — rol operativo devuelve 403", async () => {
  global.fetch = createFetchMock(authPassHandlers());
  const token = await tokenConRol("operativo");
  const res = await POST(req("POST", token, { tipo_documento_id: TIPO_DOC_ID, empleado_ids: [EMP_A] }));
  assert.equal(res.status, 403);
});

// ─── POST — validación ───

test("asignar POST — tipo_documento_id no-UUID devuelve 400", async () => {
  global.fetch = createFetchMock(authPassHandlers());
  const token = await tokenConRol("gerencial");
  const res = await POST(req("POST", token, { tipo_documento_id: "no-es-uuid", empleado_ids: [EMP_A] }));
  assert.equal(res.status, 400);
});

test("asignar POST — empleado_ids vacío devuelve 400", async () => {
  global.fetch = createFetchMock(authPassHandlers());
  const token = await tokenConRol("gerencial");
  const res = await POST(req("POST", token, { tipo_documento_id: TIPO_DOC_ID, empleado_ids: [] }));
  assert.equal(res.status, 400);
});

test("asignar POST — más de 500 empleados devuelve 400", async () => {
  global.fetch = createFetchMock(authPassHandlers());
  const token = await tokenConRol("gerencial");
  const res = await POST(req("POST", token, { tipo_documento_id: TIPO_DOC_ID, empleado_ids: manyUUIDs(501) }));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error.includes("500"));
});

test("asignar POST — tipo de documento no encontrado en la empresa devuelve 404", async () => {
  global.fetch = createFetchMock([...authPassHandlers(), tipoDocHandler(null)]);
  const token = await tokenConRol("gerencial");
  const res = await POST(req("POST", token, { tipo_documento_id: TIPO_DOC_ID, empleado_ids: [EMP_A] }));
  assert.equal(res.status, 404);
});

test("asignar POST — ningún empleado válido (todos de otra empresa) devuelve 400", async () => {
  global.fetch = createFetchMock([...authPassHandlers(), tipoDocHandler({ id: TIPO_DOC_ID }), empleadosValidosHandler([])]);
  const token = await tokenConRol("gerencial");
  const res = await POST(req("POST", token, { tipo_documento_id: TIPO_DOC_ID, empleado_ids: [EMP_A] }));
  assert.equal(res.status, 400);
});

// ─── POST — éxito ───

test("asignar POST — asigna a los nuevos y cuenta los ya asignados por separado", async () => {
  global.fetch = createFetchMock(handlersAsignar({ yaAsignados: [{ empleado_id: EMP_A }] }));
  const token = await tokenConRol("administrativo");
  const res = await POST(req("POST", token, { tipo_documento_id: TIPO_DOC_ID, empleado_ids: [EMP_A, EMP_B] }));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.asignados, 1, "solo EMP_B es nuevo");
  assert.equal(json.ya_asignados, 1, "EMP_A ya estaba asignado");
});

test("asignar POST — error de DB devuelve 500 sin exponer el detalle interno", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/tipos_documento_requerido") && url.includes(`id=eq.${TIPO_DOC_ID}`),
      respond: () => ({ status: 500, body: "permission denied for table tipos_documento_requerido" }),
    },
  ]);
  const token = await tokenConRol("gerencial");
  const res = await POST(req("POST", token, { tipo_documento_id: TIPO_DOC_ID, empleado_ids: [EMP_A] }));
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.ok(!json.error.includes("permission denied"), "no debe exponer el detalle interno de Postgres");
});

test("asignar POST — todos ya asignados no reinserta nada", async () => {
  let postLlamado = false;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    tipoDocHandler({ id: TIPO_DOC_ID }),
    empleadosValidosHandler([{ id: EMP_A }]),
    yaAsignadosHandler([{ empleado_id: EMP_A }]),
    { match: (url, opts) => url.includes("/rest/v1/documentos_exigidos_empleado") && opts?.method === "POST", respond: () => { postLlamado = true; return { status: 201, body: [] }; } },
  ]);
  const token = await tokenConRol("gerencial");
  const res = await POST(req("POST", token, { tipo_documento_id: TIPO_DOC_ID, empleado_ids: [EMP_A] }));
  const json = await res.json();

  assert.equal(json.asignados, 0);
  assert.equal(json.ya_asignados, 1);
  assert.equal(postLlamado, false, "no debe insertar si ya estaban todos asignados");
});

// ─── DELETE — auth ───

test("asignar DELETE — sin token devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await DELETE(req("DELETE", null, { tipo_documento_id: TIPO_DOC_ID, empleado_ids: [EMP_A] }));
  assert.equal(res.status, 401);
});

test("asignar DELETE — rol operativo devuelve 403", async () => {
  global.fetch = createFetchMock(authPassHandlers());
  const token = await tokenConRol("operativo");
  const res = await DELETE(req("DELETE", token, { tipo_documento_id: TIPO_DOC_ID, empleado_ids: [EMP_A] }));
  assert.equal(res.status, 403);
});

// ─── DELETE — validación ───

test("asignar DELETE — sin empleado_ids ni empleado_id devuelve 400", async () => {
  global.fetch = createFetchMock(authPassHandlers());
  const token = await tokenConRol("gerencial");
  const res = await DELETE(req("DELETE", token, { tipo_documento_id: TIPO_DOC_ID }));
  assert.equal(res.status, 400);
});

test("asignar DELETE — más de 500 empleados devuelve 400", async () => {
  global.fetch = createFetchMock(authPassHandlers());
  const token = await tokenConRol("gerencial");
  const res = await DELETE(req("DELETE", token, { tipo_documento_id: TIPO_DOC_ID, empleado_ids: manyUUIDs(501) }));
  assert.equal(res.status, 400);
});

// ─── DELETE — éxito ───

test("asignar DELETE — desasigna con empleado_ids[] (bulk)", async () => {
  global.fetch = createFetchMock([...authPassHandlers(), deleteHandler()]);
  const token = await tokenConRol("gerencial");
  const res = await DELETE(req("DELETE", token, { tipo_documento_id: TIPO_DOC_ID, empleado_ids: [EMP_A, EMP_B] }));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.desasignados, 2);
});

test("asignar DELETE — acepta empleado_id singular (retrocompatibilidad)", async () => {
  global.fetch = createFetchMock([...authPassHandlers(), deleteHandler()]);
  const token = await tokenConRol("administrativo");
  const res = await DELETE(req("DELETE", token, { tipo_documento_id: TIPO_DOC_ID, empleado_id: EMP_A }));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.desasignados, 1);
});

test("asignar DELETE — error de DB devuelve 500 sin exponer el detalle interno", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url, opts) => url.includes("/rest/v1/documentos_exigidos_empleado") && opts?.method === "DELETE",
      respond: () => ({ status: 500, body: "permission denied for table documentos_exigidos_empleado" }),
    },
  ]);
  const token = await tokenConRol("gerencial");
  const res = await DELETE(req("DELETE", token, { tipo_documento_id: TIPO_DOC_ID, empleado_ids: [EMP_A] }));
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.ok(!json.error.includes("permission denied"), "no debe exponer el detalle interno de Postgres");
});
