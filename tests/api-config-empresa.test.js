// tests/api-config-empresa.test.js — Tests HTTP de /api/config-empresa
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { GET, POST, PATCH, DELETE } = await import("../app/api/config-empresa/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";
const DIV_ID = "33333333-3333-3333-3333-333333333333";
const ETAPA_ID = "44444444-4444-4444-4444-444444444444";

async function tokenConRol(rol) {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return token;
}

function jsonReq(method, body, token, params = {}) {
  const url = new URL("http://localhost/api/config-empresa");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(url.toString(), {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ─── GET ───

test("GET config-empresa — sin token devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(jsonReq("GET", null, null));
  assert.equal(res.status, 401);
});

test("GET config-empresa — devuelve divisiones y etapas", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/divisiones"),
      respond: () => ({ status: 200, body: [{ id: DIV_ID, clave: "electrica", label: "Eléctrica" }] }),
    },
    {
      match: (url) => url.includes("/rest/v1/etapas"),
      respond: () => ({ status: 200, body: [{ id: ETAPA_ID, codigo: 1, nombre: "Replanteo" }] }),
    },
  ]);

  const res = await GET(jsonReq("GET", null, token));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.divisiones.length, 1);
  assert.equal(json.etapas.length, 1);
  assert.equal(json.divisiones[0].clave, "electrica");
});

test("GET config-empresa — error de Supabase devuelve 500 sin exponer el detalle interno", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/divisiones"),
      respond: () => ({ status: 500, body: { message: "relation \"divisiones\" violates row-level security policy" } }),
    },
  ]);

  const res = await GET(jsonReq("GET", null, token));
  const json = await res.json();

  assert.equal(res.status, 500);
  assert.ok(!json.error.includes("row-level security"), "no debe exponer el detalle interno de Postgres/RLS");
});

// ─── POST ───

test("POST config-empresa — operativo recibe 403", async () => {
  const token = await tokenConRol("operativo");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await POST(jsonReq("POST", { action: "add_division", clave: "x", label: "X" }, token));
  assert.equal(res.status, 403);
});

test("POST config-empresa — add_division crea división con empresa_id del token", async () => {
  const token = await tokenConRol("gerencial");
  let insertedData = null;

  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url, opts) => url.includes("/rest/v1/divisiones") && opts?.method === "POST",
      respond: (url, opts) => {
        insertedData = JSON.parse(opts.body);
        return { status: 201, body: [{ id: DIV_ID, ...insertedData }] };
      },
    },
  ]);

  const res = await POST(jsonReq("POST", {
    action: "add_division", clave: "plomeria", label: "Plomería",
    icon: "🔧", color: "#0000FF",
  }, token));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.ok(json.division);
  assert.equal(insertedData.empresa_id, EMPRESA_ID, "empresa_id debe venir del token");
  assert.equal(insertedData.clave, "plomeria");
});

test("POST config-empresa — add_etapa crea etapa", async () => {
  const token = await tokenConRol("gerencial");
  let insertedData = null;

  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url, opts) => url.includes("/rest/v1/etapas") && opts?.method === "POST",
      respond: (url, opts) => {
        insertedData = JSON.parse(opts.body);
        return { status: 201, body: [{ id: ETAPA_ID, ...insertedData }] };
      },
    },
  ]);

  const res = await POST(jsonReq("POST", {
    action: "add_etapa", codigo: 5, nombre: "Pintura",
  }, token));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.ok(json.etapa);
  assert.equal(insertedData.empresa_id, EMPRESA_ID);
  assert.equal(insertedData.nombre, "Pintura");
});

test("POST config-empresa — add_division con clave duplicada devuelve 409 sin detalle de Postgres", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url, opts) => url.includes("/rest/v1/divisiones") && opts?.method === "POST",
      respond: () => ({
        status: 409,
        body: { code: "23505", details: "Key (empresa_id, clave)=(11111111-1111-1111-1111-111111111111, electrica) already exists.", hint: null, message: 'duplicate key value violates unique constraint "divisiones_empresa_id_clave_key"' },
      }),
    },
  ]);

  const res = await POST(jsonReq("POST", { action: "add_division", clave: "electrica", label: "Eléctrica" }, token));
  const json = await res.json();

  assert.equal(res.status, 409);
  assert.ok(!json.error.includes("constraint"), "no debe exponer el detalle interno de Postgres");
  assert.match(json.error, /ya existe/i);
});

test("POST config-empresa — add_etapa con código duplicado devuelve 409 sin detalle de Postgres", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url, opts) => url.includes("/rest/v1/etapas") && opts?.method === "POST",
      respond: () => ({
        status: 409,
        body: { code: "23505", details: "Key (empresa_id, codigo)=(11111111-1111-1111-1111-111111111111, 6) already exists.", hint: null, message: 'duplicate key value violates unique constraint "etapas_empresa_id_codigo_key"' },
      }),
    },
  ]);

  const res = await POST(jsonReq("POST", { action: "add_etapa", codigo: 6, nombre: "Pintura" }, token));
  const json = await res.json();

  assert.equal(res.status, 409);
  assert.ok(!json.error.includes("constraint"), "no debe exponer el detalle interno de Postgres");
  assert.match(json.error, /ya existe/i);
});

test("POST config-empresa — add_etapa sin nombre devuelve 400", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await POST(jsonReq("POST", { action: "add_etapa", codigo: 5 }, token));
  assert.equal(res.status, 400);
});

test("POST config-empresa — action inválido devuelve 400", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await POST(jsonReq("POST", { action: "hackear_sistema" }, token));
  assert.equal(res.status, 400);
});

// ─── PATCH ───

test("PATCH config-empresa — update_division de otra empresa devuelve 403", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/divisiones") && url.includes("select=empresa_id"),
      respond: () => ({ status: 200, body: [{ empresa_id: "otra-empresa-id" }] }),
    },
  ]);

  const res = await PATCH(jsonReq("PATCH", {
    action: "update_division", id: DIV_ID, label: "Hackeada",
  }, token));
  assert.equal(res.status, 403);
});

test("PATCH config-empresa — update_division propia actualiza correctamente", async () => {
  const token = await tokenConRol("gerencial");
  let patchedData = null;

  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/divisiones") && url.includes("select=empresa_id"),
      respond: () => ({ status: 200, body: [{ empresa_id: EMPRESA_ID }] }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/divisiones") && opts?.method === "PATCH",
      respond: (url, opts) => {
        patchedData = JSON.parse(opts.body);
        return { status: 200, body: [{ id: DIV_ID, ...patchedData }] };
      },
    },
  ]);

  const res = await PATCH(jsonReq("PATCH", {
    action: "update_division", id: DIV_ID, label: "Eléctrica V2", color: "#00FF00",
  }, token));

  assert.equal(res.status, 200);
  assert.equal(patchedData.label, "Eléctrica V2");
  assert.equal(patchedData.color, "#00FF00");
});

test("PATCH config-empresa — update_etapa con código duplicado devuelve 409 sin detalle de Postgres", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/etapas") && url.includes("select=empresa_id"),
      respond: () => ({ status: 200, body: [{ empresa_id: EMPRESA_ID }] }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/etapas") && opts?.method === "PATCH",
      respond: () => ({
        status: 409,
        body: { code: "23505", details: "Key (empresa_id, codigo)=(11111111-1111-1111-1111-111111111111, 6) already exists.", hint: null, message: 'duplicate key value violates unique constraint "etapas_empresa_id_codigo_key"' },
      }),
    },
  ]);

  const res = await PATCH(jsonReq("PATCH", { action: "update_etapa", id: ETAPA_ID, codigo: 6 }, token));
  const json = await res.json();

  assert.equal(res.status, 409);
  assert.ok(!json.error.includes("constraint"), "no debe exponer el detalle interno de Postgres");
  assert.match(json.error, /ya existe/i);
});

// ─── DELETE ───

test("DELETE config-empresa — sin type/id devuelve 400", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await DELETE(jsonReq("DELETE", null, token));
  assert.equal(res.status, 400);
});

test("DELETE config-empresa — id no UUID devuelve 400", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await DELETE(jsonReq("DELETE", null, token, { type: "division", id: "no-es-uuid" }));
  assert.equal(res.status, 400);
});

test("DELETE config-empresa — type inválido devuelve 400", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await DELETE(jsonReq("DELETE", null, token, { type: "usuarios", id: DIV_ID }));
  assert.equal(res.status, 400);
});

test("DELETE config-empresa — soft-delete división propia (activa=false)", async () => {
  const token = await tokenConRol("gerencial");
  let patchedData = null;

  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/divisiones") && url.includes("select=empresa_id"),
      respond: () => ({ status: 200, body: [{ empresa_id: EMPRESA_ID }] }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/divisiones") && opts?.method === "PATCH",
      respond: (url, opts) => {
        patchedData = JSON.parse(opts.body);
        return { status: 200, body: [{ id: DIV_ID }] };
      },
    },
  ]);

  const res = await DELETE(jsonReq("DELETE", null, token, { type: "division", id: DIV_ID }));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(patchedData.activa, false, "debe hacer soft-delete con activa=false");
});

test("DELETE config-empresa — división de otra empresa devuelve 403", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/divisiones") && url.includes("select=empresa_id"),
      respond: () => ({ status: 200, body: [{ empresa_id: "otra-empresa" }] }),
    },
  ]);

  const res = await DELETE(jsonReq("DELETE", null, token, { type: "division", id: DIV_ID }));
  assert.equal(res.status, 403);
});
