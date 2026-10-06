// tests/api-send-push.test.js — Tests HTTP de POST /api/send-push
//
// El envío real de FCM no se cubre (requeriría mockear firebase-admin, sin
// precedente en este repo). Lo que se prueba es la lógica previa al envío:
// auth, validación, resolución de tokens y el manejo de Firebase no
// configurado — que ya devuelve un error controlado en vez de crashear.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_B64;
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/send-push/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

async function token(rol = "gerencial") {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return token;
}

function postReq(tok, body) {
  const headers = { "Content-Type": "application/json" };
  if (tok) headers.Authorization = `Bearer ${tok}`;
  return new Request("http://localhost/api/send-push", { method: "POST", headers, body: JSON.stringify(body) });
}

function empresaHandler() {
  return { match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=nombre_corto,nombre"), respond: () => ({ status: 200, body: [{ nombre_corto: "ACME" }] }) };
}

test("send-push — sin token devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(postReq(null, { legajo: 7, title: "Hola", body: "Mensaje" }));
  assert.equal(res.status, 401);
});

test("send-push — sin title devuelve 400", async () => {
  global.fetch = createFetchMock(authPassHandlers());
  const tok = await token();
  const res = await POST(postReq(tok, { legajo: 7, body: "Mensaje" }));
  assert.equal(res.status, 400);
});

test("send-push — sin tokens registrados para el destino devuelve sent:0", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    empresaHandler(),
    { match: (url) => url.includes("/rest/v1/push_tokens") && url.includes("legajo=eq."), respond: () => ({ status: 200, body: [] }) },
  ]);
  const tok = await token();
  const res = await POST(postReq(tok, { legajo: 99, title: "Hola", body: "Mensaje" }));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.sent, 0);
});

test("send-push — con tokens pero Firebase no configurado devuelve 500 controlado", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    empresaHandler(),
    { match: (url) => url.includes("/rest/v1/push_tokens") && url.includes("legajo=eq."), respond: () => ({ status: 200, body: [{ token: "tok-1" }] }) },
  ]);
  const tok = await token();
  const res = await POST(postReq(tok, { legajo: 99, title: "Hola", body: "Mensaje" }));
  assert.equal(res.status, 500, "debe fallar de forma controlada, no crashear, cuando Firebase no está configurado");
});

test("send-push — resuelve destinatarios por rol cuando no se pasa legajo", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    empresaHandler(),
    { match: (url) => url.includes("/rest/v1/empleados") && url.includes("rol=eq.gerencial"), respond: () => ({ status: 200, body: [{ legajo: 1 }, { legajo: 2 }] }) },
    { match: (url) => url.includes("/rest/v1/push_tokens") && url.includes("legajo=in."), respond: () => ({ status: 200, body: [] }) },
  ]);
  const tok = await token();
  const res = await POST(postReq(tok, { rol: "gerencial", title: "Hola", body: "Mensaje" }));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.sent, 0);
});

// ─── F2-08: push libre solo para gestión ───

test("send-push — un operario no puede mandar push a un legajo (403)", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await POST(postReq(await token("operativo"), { legajo: 8, title: "Urgente", body: "Entrá a este link" }));
  assert.equal(res.status, 403);
});

test("send-push — un operario no puede mandar push a otros operarios por rol (403)", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await POST(postReq(await token("operativo"), { rol: "operativo", title: "Urgente", body: "x" }));
  assert.equal(res.status, 403);
});

test("send-push — un operario puede avisar a gerencia, pero sin url ni datos extra", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    empresaHandler(),
    { match: (url) => url.includes("/rest/v1/empleados") && url.includes("rol=eq.gerencial"), respond: () => ({ status: 200, body: [] }) },
  ]);
  const res = await POST(postReq(await token("operativo"), { rol: "gerencial", title: "Permiso", body: "Pido permiso", data: { url: "https://phishing.example", tag: "permiso" } }));
  assert.equal(res.status, 200);
});

test("send-push — legajo con caracteres de filtro se rechaza (400)", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await POST(postReq(await token(), { legajo: "7&empresa_id=neq.x", title: "Hola", body: "x" }));
  assert.equal(res.status, 400);
});

test("send-push — rol inexistente se rechaza (400)", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await POST(postReq(await token(), { rol: "superadmin", title: "Hola", body: "x" }));
  assert.equal(res.status, 400);
});

test("sanitizarDataPush — gestión: solo urls internas; operario: solo tag", async () => {
  const { sanitizarDataPush } = await import("../app/lib/pushData.js");
  assert.deepEqual(sanitizarDataPush({ url: "/acme?screen=inbox", tag: "t", extra: "1" }, true), { url: "/acme?screen=inbox", tag: "t", extra: "1" });
  for (const mala of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
    assert.equal(sanitizarDataPush({ url: mala }, true).url, undefined, mala);
  }
  assert.deepEqual(sanitizarDataPush({ url: "/acme", tag: "t", extra: "1" }, false), { tag: "t" });
});
