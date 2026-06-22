// tests/api-superadmin-audit-log.test.js — Tests de GET /api/superadmin/audit-log
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
const { GET } = await import("../app/api/superadmin/audit-log/route.ts");

const VALID_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

// La ruta lee req.nextUrl — un Request plano no lo expone, así que lo adjuntamos
// a mano (mismo patrón que tests/api-superadmin-empresas.test.js).
function getReq(qs = "") {
  const req = new Request(`http://localhost/api/superadmin/audit-log${qs}`);
  req.nextUrl = new URL(req.url);
  return req;
}

function handlers({ status = 200, rows = [{ id: 1, accion: "cambiar_plan" }] } = {}) {
  return [
    {
      match: (url) => url.includes("/rest/v1/audit_log"),
      respond: () => ({ status, body: status === 200 ? rows : "Internal Server Error" }),
    },
  ];
}

async function withAdmin(fn) {
  const adminToken = await signAdminToken();
  return withNextCookies(`gypi_superadmin=${adminToken}`, fn);
}

test("audit-log — sin cookie admin devuelve 401", async () => {
  global.fetch = createFetchMock(handlers());
  const res = await withNextCookies("", () => GET(getReq()));
  assert.equal(res.status, 401);
});

test("audit-log — empresa_id no-UUID en query devuelve 400", async () => {
  global.fetch = createFetchMock(handlers());
  const res = await withAdmin(() => GET(getReq("?empresa_id=no-es-uuid")));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error.includes("UUID"));
});

test("audit-log — sin empresa_id (listado global) devuelve 200", async () => {
  global.fetch = createFetchMock(handlers());
  const res = await withAdmin(() => GET(getReq()));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.rows.length, 1);
});

test("audit-log — empresa_id UUID válido devuelve 200", async () => {
  global.fetch = createFetchMock(handlers());
  const res = await withAdmin(() => GET(getReq(`?empresa_id=${VALID_UUID}`)));
  assert.equal(res.status, 200);
});

test("audit-log — error de Supabase devuelve 500 sin filtrar el texto crudo del backend", async () => {
  global.fetch = createFetchMock(handlers({ status: 500 }));
  const res = await withAdmin(() => GET(getReq()));
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.ok(!json.error.includes("Internal Server Error"), "no debe exponer el texto crudo de Supabase");
});
