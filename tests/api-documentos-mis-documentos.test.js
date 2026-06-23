// tests/api-documentos-mis-documentos.test.js — Tests HTTP de GET /api/documentos/mis-documentos
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { GET } = await import("../app/api/documentos/mis-documentos/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";
const TIPO_DOC_ID = "55555555-5555-5555-5555-555555555555";

async function tokenConRol(rol, empleadoId = EMPLEADO_ID) {
  const { token } = await signAccessToken({ empleadoId, empresaId: EMPRESA_ID, legajo: 7, rol });
  return token;
}

function getReq(token, query = "") {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`http://localhost/api/documentos/mis-documentos${query}`, { headers });
}

function exigidosHandler(exigidos, capturar) {
  return {
    match: (url) => url.includes("/rest/v1/documentos_exigidos_empleado"),
    respond: (url) => { if (capturar) capturar(url); return { status: 200, body: exigidos }; },
  };
}

function cargadosHandler(cargados) {
  return {
    match: (url) => url.includes("/rest/v1/documentos_empleado?"),
    respond: () => ({ status: 200, body: cargados }),
  };
}

test("mis-documentos — sin token devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(getReq(null));
  assert.equal(res.status, 401);
});

test("mis-documentos — sin exigidos ni cargados devuelve lista vacía", async () => {
  global.fetch = createFetchMock([...authPassHandlers(), exigidosHandler([]), cargadosHandler([])]);
  const token = await tokenConRol("operativo");
  const res = await GET(getReq(token));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.deepEqual(json.exigidos, []);
});

test("mis-documentos — anida los documentos cargados dentro de cada tipo exigido", async () => {
  const exigidos = [
    { tipo_documento_id: TIPO_DOC_ID, tipos_documento_requerido: { id: TIPO_DOC_ID, nombre: "DNI", formatos_aceptados: ["pdf"], admite_multiples: false } },
  ];
  const cargados = [
    { id: "doc-1", tipo_documento_id: TIPO_DOC_ID, nombre_archivo: "dni.pdf", mime_type: "application/pdf", estado: "cargado", fecha_carga: "2026-06-20T10:00:00Z" },
  ];
  global.fetch = createFetchMock([...authPassHandlers(), exigidosHandler(exigidos), cargadosHandler(cargados)]);
  const token = await tokenConRol("operativo");
  const res = await GET(getReq(token));
  const json = await res.json();

  assert.equal(json.exigidos.length, 1);
  assert.equal(json.exigidos[0].id, TIPO_DOC_ID);
  assert.equal(json.exigidos[0].nombre, "DNI");
  assert.equal(json.exigidos[0].documentos.length, 1);
  assert.equal(json.exigidos[0].documentos[0].id, "doc-1");
});

test("mis-documentos — un exigido con relación rota (tipo borrado) se filtra de la respuesta", async () => {
  const exigidos = [
    { tipo_documento_id: TIPO_DOC_ID, tipos_documento_requerido: null },
    { tipo_documento_id: "otro-tipo", tipos_documento_requerido: { id: "otro-tipo", nombre: "Carnet", formatos_aceptados: ["pdf"], admite_multiples: false } },
  ];
  global.fetch = createFetchMock([...authPassHandlers(), exigidosHandler(exigidos), cargadosHandler([])]);
  const token = await tokenConRol("operativo");
  const res = await GET(getReq(token));
  const json = await res.json();

  assert.equal(json.exigidos.length, 1, "el exigido con tipo null no debe aparecer");
  assert.equal(json.exigidos[0].nombre, "Carnet");
});

test("mis-documentos — un documento cargado de otro tipo no se mezcla en el grupo equivocado", async () => {
  const OTRO_TIPO = "66666666-6666-6666-6666-666666666666";
  const exigidos = [
    { tipo_documento_id: TIPO_DOC_ID, tipos_documento_requerido: { id: TIPO_DOC_ID, nombre: "DNI", formatos_aceptados: ["pdf"], admite_multiples: false } },
    { tipo_documento_id: OTRO_TIPO, tipos_documento_requerido: { id: OTRO_TIPO, nombre: "Carnet", formatos_aceptados: ["pdf"], admite_multiples: false } },
  ];
  const cargados = [
    { id: "doc-1", tipo_documento_id: OTRO_TIPO, nombre_archivo: "carnet.pdf", mime_type: "application/pdf", estado: "cargado", fecha_carga: "2026-06-20T10:00:00Z" },
  ];
  global.fetch = createFetchMock([...authPassHandlers(), exigidosHandler(exigidos), cargadosHandler(cargados)]);
  const token = await tokenConRol("operativo");
  const res = await GET(getReq(token));
  const json = await res.json();

  const dni = json.exigidos.find((e) => e.id === TIPO_DOC_ID);
  const carnet = json.exigidos.find((e) => e.id === OTRO_TIPO);
  assert.equal(dni.documentos.length, 0);
  assert.equal(carnet.documentos.length, 1);
});

test("mis-documentos — el empleado_id viene del token, ignora cualquier query param del cliente", async () => {
  let urlCapturada = null;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    exigidosHandler([], (url) => { urlCapturada = url; }),
    cargadosHandler([]),
  ]);
  const otroId = "99999999-9999-9999-9999-999999999999";
  const token = await tokenConRol("operativo", EMPLEADO_ID);
  const res = await GET(getReq(token, `?empleado_id=${otroId}`));

  assert.equal(res.status, 200);
  assert.ok(urlCapturada.includes(`empleado_id=eq.${EMPLEADO_ID}`), "debe consultar con el empleado_id de la sesión");
  assert.ok(!urlCapturada.includes(otroId), "no debe usar el empleado_id del query param");
});

test("mis-documentos — error de DB devuelve 500 sin exponer el detalle interno", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/documentos_exigidos_empleado"),
      respond: () => ({ status: 500, body: "permission denied for table documentos_exigidos_empleado" }),
    },
    cargadosHandler([]),
  ]);
  const token = await tokenConRol("operativo");
  const res = await GET(getReq(token));
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.ok(!json.error.includes("permission denied"), "no debe exponer el detalle interno de Postgres");
});
