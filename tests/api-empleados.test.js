// tests/api-empleados.test.js — Tests HTTP de /api/empleados (GET/POST/PATCH/DELETE)
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  if (!process.env.RESEND_API_KEY) process.env.RESEND_API_KEY = "re_test_fake_key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { GET, POST, PATCH, DELETE } = await import("../app/api/empleados/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";
const OTRO_EMPLEADO_ID = "33333333-3333-3333-3333-333333333333";

async function tokenConRol(rol) {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return token;
}

function jsonReq(method, body, token, params = {}) {
  const url = new URL("http://localhost/api/empleados");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(url.toString(), {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function handlersListado() {
  return [
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/empleados") && url.includes("select=id,legajo"),
      respond: () => ({
        status: 200,
        body: [
          { id: EMPLEADO_ID, legajo: 7, nombre: "Ana", rol: "gerencial", activo: true },
          { id: OTRO_EMPLEADO_ID, legajo: 8, nombre: "Juan", rol: "operativo", activo: true },
        ],
      }),
    },
  ];
}

function handlersCreacion({ legajoExiste = false, empleadosActuales = 2 } = {}) {
  return [
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/empleados") && url.includes("legajo=eq."),
      respond: () => ({
        status: 200,
        body: legajoExiste ? [{ id: "existente" }] : [],
      }),
    },
    {
      match: (url) => url.includes("/rest/v1/empresa?id=eq.") && url.includes("select=plan_activo"),
      respond: () => ({
        status: 200,
        body: [{ plan_activo: "starter", slug: "test-co", nombre: "Test Co", nombre_corto: "Test" }],
      }),
    },
    {
      match: (url) => url.includes("/rest/v1/empleados") && url.includes("activo=eq.true") && url.includes("select=id") && !url.includes("legajo=eq."),
      respond: () => ({
        status: 200,
        body: Array(empleadosActuales).fill({ id: "emp" }),
      }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/empleados") && opts?.method === "POST",
      respond: (url, opts) => {
        const body = JSON.parse(opts.body);
        return {
          status: 201,
          body: [{ id: "nuevo-emp", ...body }],
        };
      },
    },
  ];
}

// ─── GET ───

test("GET empleados — sin token devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(jsonReq("GET", null, null));
  assert.equal(res.status, 401);
});

test("GET empleados — lista empleados de la empresa", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/empleados") && url.includes("empresa_id=eq."),
      respond: () => ({
        status: 200,
        body: [
          { id: EMPLEADO_ID, legajo: 7, nombre: "Ana", rol: "gerencial" },
          { id: OTRO_EMPLEADO_ID, legajo: 8, nombre: "Juan", rol: "operativo" },
        ],
      }),
    },
  ]);

  const res = await GET(jsonReq("GET", null, token));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.length, 2);
  assert.equal(json[0].password, undefined, "no debe exponer password");
});

// ─── POST ───

test("POST empleados — operativo recibe 403", async () => {
  const token = await tokenConRol("operativo");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await POST(jsonReq("POST", { legajo: 10, nombre: "Test" }, token));
  assert.equal(res.status, 403);
});

test("POST empleados — sin legajo/nombre devuelve 400", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await POST(jsonReq("POST", { legajo: 10 }, token));
  assert.equal(res.status, 400);
});

test("POST empleados — legajo no numérico devuelve 400", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await POST(jsonReq("POST", { legajo: "abc", nombre: "Test" }, token));
  assert.equal(res.status, 400);
});

test("POST empleados — legajo negativo devuelve 400", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await POST(jsonReq("POST", { legajo: -5, nombre: "Test" }, token));
  assert.equal(res.status, 400);
});

test("POST empleados — email inválido devuelve 400", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await POST(jsonReq("POST", { legajo: 10, nombre: "Test", email: "no-es-email" }, token));
  assert.equal(res.status, 400);
});

test("POST empleados — legajo duplicado devuelve 409", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock(handlersCreacion({ legajoExiste: true }));
  const res = await POST(jsonReq("POST", { legajo: 7, nombre: "Duplicado" }, token));
  assert.equal(res.status, 409);
});

test("POST empleados — excede límite de plan devuelve 403 con upgrade", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock(handlersCreacion({ empleadosActuales: 25 }));
  const res = await POST(jsonReq("POST", { legajo: 99, nombre: "Excedente" }, token));
  const json = await res.json();

  assert.equal(res.status, 403);
  assert.equal(json.upgrade, true, "debe indicar al frontend que muestre upgrade");
});

test("POST empleados — crea empleado correctamente con empresa_id del token", async () => {
  const token = await tokenConRol("gerencial");
  let insertedData = null;

  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/empleados") && url.includes("legajo=eq."),
      respond: () => ({ status: 200, body: [] }),
    },
    {
      match: (url) => url.includes("/rest/v1/empresa?id=eq.") && url.includes("select=plan_activo"),
      respond: () => ({ status: 200, body: [{ plan_activo: "starter", slug: "test-co", nombre: "Test", nombre_corto: "Test" }] }),
    },
    {
      match: (url) => url.includes("/rest/v1/empleados") && url.includes("activo=eq.true") && url.includes("select=id") && !url.includes("legajo=eq."),
      respond: () => ({ status: 200, body: [{ id: "a" }, { id: "b" }] }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/empleados") && opts?.method === "POST",
      respond: (url, opts) => {
        insertedData = JSON.parse(opts.body);
        return { status: 201, body: [{ id: "nuevo-emp", ...insertedData }] };
      },
    },
  ]);

  const res = await POST(jsonReq("POST", { legajo: 99, nombre: " María López ", email: "maria@test.com" }, token));
  const json = await res.json();

  assert.equal(res.status, 201);
  assert.equal(insertedData.empresa_id, EMPRESA_ID, "empresa_id del token, no del body");
  assert.equal(insertedData.legajo, 99);
  assert.equal(insertedData.nombre, "María López", "nombre debe estar trimmed");
  assert.ok(insertedData.password, "debe generar password hash");
  assert.equal(insertedData.debe_cambiar_password, true);
  assert.equal(json.password, undefined, "no debe devolver password en la respuesta");
});

test("POST empleados — administrativo no puede crear rol gerencial", async () => {
  const token = await tokenConRol("administrativo");
  let insertedData = null;

  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/empleados") && url.includes("legajo=eq."),
      respond: () => ({ status: 200, body: [] }),
    },
    {
      match: (url) => url.includes("/rest/v1/empresa?id=eq."),
      respond: () => ({ status: 200, body: [{ plan_activo: "starter", slug: "t", nombre: "T", nombre_corto: "T" }] }),
    },
    {
      match: (url) => url.includes("/rest/v1/empleados") && url.includes("activo=eq.true") && url.includes("select=id") && !url.includes("legajo=eq."),
      respond: () => ({ status: 200, body: [] }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/empleados") && opts?.method === "POST",
      respond: (url, opts) => {
        insertedData = JSON.parse(opts.body);
        return { status: 201, body: [{ id: "nuevo", ...insertedData }] };
      },
    },
  ]);

  await POST(jsonReq("POST", { legajo: 50, nombre: "Test", rol: "gerencial" }, token));
  assert.equal(insertedData.rol, "operativo", "administrativo no puede asignar gerencial, cae a operativo");
});

// ─── PATCH ───

test("PATCH empleados — sin id devuelve 400", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await PATCH(jsonReq("PATCH", { nombre: "X" }, token));
  assert.equal(res.status, 400);
});

test("PATCH empleados — id no UUID devuelve 400", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await PATCH(jsonReq("PATCH", { nombre: "X" }, token, { id: "no-uuid" }));
  assert.equal(res.status, 400);
});

test("PATCH empleados — empleado de otra empresa devuelve 404", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/empleados") && url.includes(`id=eq.${OTRO_EMPLEADO_ID}`),
      respond: () => ({ status: 200, body: [] }),
    },
  ]);
  const res = await PATCH(jsonReq("PATCH", { nombre: "Hack" }, token, { id: OTRO_EMPLEADO_ID }));
  assert.equal(res.status, 404);
});

test("PATCH empleados — actualiza campos válidos", async () => {
  const token = await tokenConRol("gerencial");
  let patchedData = null;

  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url, opts) => url.includes("/rest/v1/empleados") && url.includes(`id=eq.${OTRO_EMPLEADO_ID}`) && (!opts?.method || opts.method === "GET"),
      respond: () => ({ status: 200, body: [{ id: OTRO_EMPLEADO_ID }] }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/empleados") && opts?.method === "PATCH",
      respond: (url, opts) => {
        patchedData = JSON.parse(opts.body);
        return { status: 200, body: [{ id: OTRO_EMPLEADO_ID, ...patchedData }] };
      },
    },
  ]);

  const res = await PATCH(jsonReq("PATCH", {
    nombre: "Juan Actualizado",
    rol: "administrativo",
    empresa_id: "intento-inyeccion",
  }, token, { id: OTRO_EMPLEADO_ID }));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(patchedData.nombre, "Juan Actualizado");
  assert.equal(patchedData.rol, "administrativo");
  assert.equal(patchedData.empresa_id, undefined, "empresa_id no debe ser editable");
  assert.equal(json.password, undefined, "no debe devolver password");
});

// ─── DELETE ───

test("DELETE empleados — no puede desactivarse a sí mismo", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await DELETE(jsonReq("DELETE", null, token, { id: EMPLEADO_ID }));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error.includes("propio"));
});

test("DELETE empleados — soft-delete empleado de la empresa", async () => {
  const token = await tokenConRol("gerencial");
  let patchedData = null;

  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url, opts) => url.includes("/rest/v1/empleados") && url.includes(`id=eq.${OTRO_EMPLEADO_ID}`) && (!opts?.method || opts.method === "GET"),
      respond: () => ({ status: 200, body: [{ id: OTRO_EMPLEADO_ID, legajo: 8, nombre: "Juan" }] }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/empleados") && opts?.method === "PATCH",
      respond: (url, opts) => {
        patchedData = JSON.parse(opts.body);
        return { status: 200, body: [{ id: OTRO_EMPLEADO_ID }] };
      },
    },
  ]);

  const res = await DELETE(jsonReq("DELETE", null, token, { id: OTRO_EMPLEADO_ID }));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(patchedData.activo, false, "soft-delete debe poner activo=false");
});
