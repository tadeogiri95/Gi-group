// tests/api-superadmin-historial-planes.test.js — Tests de GET /api/superadmin/historial-planes
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";
import { withNextCookies } from "./helpers/withNextCookies.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAdminToken } = await import("../app/lib/jwt.ts");
const { GET } = await import("../app/api/superadmin/historial-planes/route.ts");

const VALID_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

// La ruta lee req.nextUrl — un Request plano no lo expone, así que lo adjuntamos
// a mano (mismo patrón que tests/api-superadmin-empresas.test.js).
function getReq(qs = "") {
  const req = new Request(`http://localhost/api/superadmin/historial-planes${qs}`);
  req.nextUrl = new URL(req.url);
  return req;
}

function handlers() {
  return [
    { match: (url) => url.includes("/rest/v1/audit_log"), respond: () => ({ status: 200, body: [{ id: 1, accion: "cambiar_plan" }] }) },
    { match: (url) => url.includes("/rest/v1/suscripciones"), respond: () => ({ status: 200, body: [{ id: "s1", plan: "pro" }] }) },
    { match: (url) => url.includes("/rest/v1/pagos"), respond: () => ({ status: 200, body: [{ id: "p1", monto: 1000 }] }) },
  ];
}

async function withAdmin(fn) {
  const adminToken = await signAdminToken();
  return withNextCookies(`gypi_superadmin=${adminToken}`, fn);
}

test("historial-planes — sin cookie admin devuelve 401", async () => {
  global.fetch = createFetchMock(handlers());
  const res = await withNextCookies("", () => GET(getReq(`?empresa_id=${VALID_UUID}`)));
  assert.equal(res.status, 401);
});

test("historial-planes — sin empresa_id devuelve 400", async () => {
  global.fetch = createFetchMock(handlers());
  const res = await withAdmin(() => GET(getReq()));
  assert.equal(res.status, 400);
});

test("historial-planes — empresa_id no-UUID devuelve 400", async () => {
  global.fetch = createFetchMock(handlers());
  const res = await withAdmin(() => GET(getReq("?empresa_id=no-es-uuid")));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error.includes("UUID"));
});

test("historial-planes — éxito devuelve 200 con auditLogs, suscripciones y pagos", async () => {
  global.fetch = createFetchMock(handlers());
  const res = await withAdmin(() => GET(getReq(`?empresa_id=${VALID_UUID}`)));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.auditLogs.length, 1);
  assert.equal(json.suscripciones.length, 1);
  assert.equal(json.pagos.length, 1);
});
