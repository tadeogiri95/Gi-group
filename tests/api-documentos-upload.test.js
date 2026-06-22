// tests/api-documentos-upload.test.js — Tests HTTP de POST /api/documentos/upload
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/documentos/upload/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";
const TIPO_DOC_ID = "55555555-5555-5555-5555-555555555555";

async function tokenConRol(rol) {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return token;
}

const PDF_BYTES = Buffer.from("%PDF-1.4");

function postReq(token, { file, tipoDocumentoId = TIPO_DOC_ID, omitFile = false } = {}) {
  const fd = new FormData();
  if (!omitFile) fd.set("file", file ?? new File([PDF_BYTES], "doc.pdf", { type: "application/pdf" }));
  if (tipoDocumentoId) fd.set("tipo_documento_id", tipoDocumentoId);
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/documentos/upload", { method: "POST", headers, body: fd });
}

function tipoDocHandler(tipo) {
  return {
    match: (url) => url.includes("/rest/v1/tipos_documento_requerido") && url.includes(`id=eq.${TIPO_DOC_ID}`),
    respond: () => ({ status: 200, body: tipo ? [tipo] : [] }),
  };
}

function sinDocumentosPrevios() {
  return {
    match: (url) => url.includes("/rest/v1/documentos_empleado") && url.includes("select=id,storage_path"),
    respond: () => ({ status: 200, body: [] }),
  };
}

function storageOk() {
  return {
    match: (url, opts) => url.includes("/storage/v1/object/documentos-empleado/") && opts?.method === "POST",
    respond: () => ({ status: 200, body: { Key: "ok" } }),
  };
}

function storageFalla() {
  return {
    match: (url, opts) => url.includes("/storage/v1/object/documentos-empleado/") && opts?.method === "POST",
    respond: () => ({ status: 500, body: "service role key expired - rotate at vault/internal/sb-key-3" }),
  };
}

function insertDocOk() {
  return {
    match: (url, opts) => url.includes("/rest/v1/documentos_empleado") && opts?.method === "POST",
    respond: (url, opts) => ({ status: 201, body: [{ id: "doc-1", ...JSON.parse(opts.body) }] }),
  };
}

const TIPO_PDF = { id: TIPO_DOC_ID, formatos_aceptados: ["pdf"], admite_multiples: true };

test("documentos/upload — sin token devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(postReq(null));
  assert.equal(res.status, 401);
});

test("documentos/upload — sin file devuelve 400", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  const token = await tokenConRol("operativo");
  const res = await POST(postReq(token, { omitFile: true }));
  assert.equal(res.status, 400);
});

test("documentos/upload — tipo_documento_id no-UUID devuelve 400", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  const token = await tokenConRol("operativo");
  const res = await POST(postReq(token, { tipoDocumentoId: "no-es-uuid" }));
  assert.equal(res.status, 400);
});

test("documentos/upload — tipo de documento inexistente devuelve 404", async () => {
  global.fetch = createFetchMock([...authPassHandlers(), tipoDocHandler(null)]);
  const token = await tokenConRol("operativo");
  const res = await POST(postReq(token));
  assert.equal(res.status, 404);
});

test("documentos/upload — formato no aceptado para ese tipo de documento devuelve 400", async () => {
  global.fetch = createFetchMock([...authPassHandlers(), tipoDocHandler({ id: TIPO_DOC_ID, formatos_aceptados: ["image"], admite_multiples: true })]);
  const token = await tokenConRol("operativo");
  const res = await POST(postReq(token)); // sube un PDF, solo se aceptan imágenes
  assert.equal(res.status, 400);
});

test("documentos/upload — error de storage devuelve 500 sin exponer el texto crudo del backend", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    tipoDocHandler(TIPO_PDF),
    sinDocumentosPrevios(),
    storageFalla(),
  ]);
  const token = await tokenConRol("operativo");
  const res = await POST(postReq(token));
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.ok(!json.error.includes("vault/internal"), "no debe exponer el texto crudo de Storage");
});

test("documentos/upload — éxito devuelve 200 con el documento creado", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    tipoDocHandler(TIPO_PDF),
    sinDocumentosPrevios(),
    storageOk(),
    insertDocOk(),
  ]);
  const token = await tokenConRol("operativo");
  const res = await POST(postReq(token));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.documento.empleado_id, EMPLEADO_ID, "debe quedar asociado al empleado de la sesión");
});
