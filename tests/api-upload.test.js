// tests/api-upload.test.js — Tests HTTP de POST /api/upload
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/upload/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

async function tokenConRol(rol) {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return token;
}

function postReq(token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/upload", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function storageOk() {
  return {
    match: (url, opts) => url.includes("/storage/v1/object/reportes-obra/") && opts?.method === "POST",
    respond: () => ({ status: 200, body: { Key: "ok" } }),
  };
}

function storageFalla(status = 500, text = "bucket error") {
  return {
    match: (url, opts) => url.includes("/storage/v1/object/reportes-obra/") && opts?.method === "POST",
    respond: () => ({ status, body: text }),
  };
}

const PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");

// ─── Auth ───

test("upload — sin token devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(postReq(null, { fileName: "logo.png", fileBase64: PNG_BASE64, fileType: "image/png" }));
  assert.equal(res.status, 401);
});

// ─── Validación ───

test("upload — sin fileName devuelve 400", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  const token = await tokenConRol("gerencial");
  const res = await POST(postReq(token, { fileBase64: PNG_BASE64, fileType: "image/png" }));
  assert.equal(res.status, 400);
});

test("upload — sin fileBase64 devuelve 400", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  const token = await tokenConRol("gerencial");
  const res = await POST(postReq(token, { fileName: "logo.png", fileType: "image/png" }));
  assert.equal(res.status, 400);
});

test("upload — tipo de archivo no permitido devuelve 400", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  const token = await tokenConRol("gerencial");
  const res = await POST(postReq(token, { fileName: "script.js", fileBase64: PNG_BASE64, fileType: "application/javascript" }));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error);
});

test("upload — sin fileType devuelve 400 (tipo no permitido)", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  const token = await tokenConRol("gerencial");
  const res = await POST(postReq(token, { fileName: "logo.png", fileBase64: PNG_BASE64 }));
  assert.equal(res.status, 400);
});

test("upload — archivo mayor a 5MB devuelve 413", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  const token = await tokenConRol("gerencial");
  const bigBase64 = Buffer.alloc(6 * 1024 * 1024).toString("base64");
  const res = await POST(postReq(token, { fileName: "logo.png", fileBase64: bigBase64, fileType: "image/png" }));
  assert.equal(res.status, 413);
});

// ─── Path traversal ───

test("upload — fileName con path traversal se sanitiza antes de subir", async () => {
  let urlSubida = null;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url, opts) => url.includes("/storage/v1/object/reportes-obra/") && opts?.method === "POST",
      respond: (url) => { urlSubida = url; return { status: 200, body: { Key: "ok" } }; },
    },
  ]);
  const token = await tokenConRol("gerencial");
  const res = await POST(postReq(token, { fileName: "../../etc/evil.png", fileBase64: PNG_BASE64, fileType: "image/png" }));
  assert.equal(res.status, 200);
  assert.ok(!urlSubida.includes(".."), `la URL de subida no debe contener "..": ${urlSubida}`);
  assert.ok(urlSubida.includes(`${EMPRESA_ID}/`), "el archivo debe quedar prefijado con el empresa_id de la sesión, no del cliente");
});

// ─── Éxito ───

test("upload — éxito devuelve 200 con url pública prefijada por empresa_id", async () => {
  global.fetch = createFetchMock([...authPassHandlers(), storageOk()]);
  const token = await tokenConRol("gerencial");
  const res = await POST(postReq(token, { fileName: "logo.png", fileBase64: PNG_BASE64, fileType: "image/png" }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.ok(json.url.includes(`${EMPRESA_ID}/logo.png`), `la url debe incluir el empresa_id: ${json.url}`);
});

// ─── Error de storage ───

test("upload — error del bucket de storage devuelve 500 sin exponer el texto crudo del backend", async () => {
  global.fetch = createFetchMock([...authPassHandlers(), storageFalla(500, "bucket error: signature mismatch on internal key xyz")]);
  const token = await tokenConRol("gerencial");
  const res = await POST(postReq(token, { fileName: "logo.png", fileBase64: PNG_BASE64, fileType: "image/png" }));
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.ok(!json.error.includes("signature mismatch"), "no debe exponer el texto crudo de Storage");
});
