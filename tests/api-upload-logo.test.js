// tests/api-upload-logo.test.js — Tests HTTP de POST /api/upload-logo
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/upload-logo/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

async function tokenConRol(rol) {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return token;
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function postReq(token, { file, omitFile = false } = {}) {
  const fd = new FormData();
  if (!omitFile) fd.set("file", file ?? new File([PNG_BYTES], "logo.png", { type: "image/png" }));
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/upload-logo", { method: "POST", headers, body: fd });
}

function patchEmpresaOk() {
  return {
    match: (url, opts) => url.includes("/rest/v1/empresa?id=eq.") && opts?.method === "PATCH",
    respond: () => ({ status: 204 }),
  };
}

function storageOk() {
  return {
    match: (url, opts) => url.includes("/storage/v1/object/logos/") && opts?.method === "POST",
    respond: () => ({ status: 200, body: { Key: "ok" } }),
  };
}

function storageFalla(text) {
  return {
    match: (url, opts) => url.includes("/storage/v1/object/logos/") && opts?.method === "POST",
    respond: () => ({ status: 500, body: text }),
  };
}

test("upload-logo — sin token devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(postReq(null));
  assert.equal(res.status, 401);
});

test("upload-logo — sin file devuelve 400", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  const token = await tokenConRol("gerencial");
  const res = await POST(postReq(token, { omitFile: true }));
  assert.equal(res.status, 400);
});

test("upload-logo — tipo de archivo no permitido devuelve 400", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  const token = await tokenConRol("gerencial");
  const file = new File([PNG_BYTES], "logo.gif", { type: "image/gif" });
  const res = await POST(postReq(token, { file }));
  assert.equal(res.status, 400);
});

test("upload-logo — archivo mayor a 2MB devuelve 400", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  const token = await tokenConRol("gerencial");
  const big = new File([Buffer.alloc(3 * 1024 * 1024)], "logo.png", { type: "image/png" });
  const res = await POST(postReq(token, { file: big }));
  assert.equal(res.status, 400);
});

test("upload-logo — error de storage devuelve 500 sin exponer el texto crudo del backend", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    storageFalla("signature verification failed for key proj_internal_7f3a"),
  ]);
  const token = await tokenConRol("gerencial");
  const res = await POST(postReq(token));
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.ok(!json.error.includes("proj_internal"), "no debe exponer el texto crudo de Storage");
});

test("upload-logo — éxito devuelve logo_url prefijado por empresa_id del token", async () => {
  global.fetch = createFetchMock([...authPassHandlers(), storageOk(), patchEmpresaOk()]);
  const token = await tokenConRol("gerencial");
  const res = await POST(postReq(token));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.logo_url.includes(`${EMPRESA_ID}/logo.png`), `logo_url debe incluir el empresa_id: ${json.logo_url}`);
});
