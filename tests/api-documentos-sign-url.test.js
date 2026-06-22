// tests/api-documentos-sign-url.test.js — Tests HTTP de POST /api/documentos/sign-url
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/documentos/sign-url/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";
const OTRO_EMPLEADO_ID = "33333333-3333-3333-3333-333333333333";
const DOC_ID = "44444444-4444-4444-4444-444444444444";

async function tokenConRol(rol, empleadoId = EMPLEADO_ID) {
  const { token } = await signAccessToken({ empleadoId, empresaId: EMPRESA_ID, legajo: 7, rol });
  return token;
}

function postReq(token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/documentos/sign-url", { method: "POST", headers, body: JSON.stringify(body) });
}

function docHandler(doc) {
  return {
    match: (url) => url.includes("/rest/v1/documentos_empleado") && url.includes(`id=eq.${DOC_ID}`),
    respond: () => ({ status: 200, body: doc ? [doc] : [] }),
  };
}

function signOk(signedURL = "/object/sign/documentos-empleado/abc?token=xyz") {
  return {
    match: (url, opts) => url.includes("/storage/v1/object/sign/documentos-empleado/") && opts?.method === "POST",
    respond: () => ({ status: 200, body: { signedURL } }),
  };
}

function signFalla() {
  return {
    match: (url, opts) => url.includes("/storage/v1/object/sign/documentos-empleado/") && opts?.method === "POST",
    respond: () => ({ status: 500, body: "internal storage key rotation in progress for bucket xyz" }),
  };
}

test("sign-url — sin token devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(postReq(null, { documento_id: DOC_ID }));
  assert.equal(res.status, 401);
});

test("sign-url — documento_id no-UUID devuelve 400", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  const token = await tokenConRol("operativo");
  const res = await POST(postReq(token, { documento_id: "no-es-uuid" }));
  assert.equal(res.status, 400);
});

test("sign-url — documento de otra empresa devuelve 404", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    docHandler({ id: DOC_ID, empresa_id: "otra-empresa", empleado_id: EMPLEADO_ID, storage_path: "x" }),
  ]);
  const token = await tokenConRol("operativo");
  const res = await POST(postReq(token, { documento_id: DOC_ID }));
  assert.equal(res.status, 404);
});

test("sign-url — operativo intentando ver documento de otro empleado devuelve 403", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    docHandler({ id: DOC_ID, empresa_id: EMPRESA_ID, empleado_id: OTRO_EMPLEADO_ID, storage_path: "x" }),
  ]);
  const token = await tokenConRol("operativo", EMPLEADO_ID);
  const res = await POST(postReq(token, { documento_id: DOC_ID }));
  assert.equal(res.status, 403);
});

test("sign-url — gerencial puede ver documento de otro empleado de su empresa", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    docHandler({ id: DOC_ID, empresa_id: EMPRESA_ID, empleado_id: OTRO_EMPLEADO_ID, storage_path: "x" }),
    signOk(),
  ]);
  const token = await tokenConRol("gerencial", EMPLEADO_ID);
  const res = await POST(postReq(token, { documento_id: DOC_ID }));
  assert.equal(res.status, 200);
});

test("sign-url — dueño del documento puede verlo", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    docHandler({ id: DOC_ID, empresa_id: EMPRESA_ID, empleado_id: EMPLEADO_ID, storage_path: "x" }),
    signOk(),
  ]);
  const token = await tokenConRol("operativo", EMPLEADO_ID);
  const res = await POST(postReq(token, { documento_id: DOC_ID }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.url.includes("/storage/v1/object/sign/"));
});

test("sign-url — error de DB al buscar el documento devuelve 500 sin exponer el detalle interno", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/documentos_empleado") && url.includes(`id=eq.${DOC_ID}`),
      respond: () => ({ status: 500, body: "permission denied for table documentos_empleado" }),
    },
  ]);
  const token = await tokenConRol("operativo");
  const res = await POST(postReq(token, { documento_id: DOC_ID }));
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.ok(!json.error.includes("permission denied"), "no debe exponer el detalle interno de Postgres");
});

test("sign-url — error generando la URL firmada devuelve 500", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    docHandler({ id: DOC_ID, empresa_id: EMPRESA_ID, empleado_id: EMPLEADO_ID, storage_path: "x" }),
    signFalla(),
  ]);
  const token = await tokenConRol("operativo", EMPLEADO_ID);
  const res = await POST(postReq(token, { documento_id: DOC_ID }));
  assert.equal(res.status, 500);
});
