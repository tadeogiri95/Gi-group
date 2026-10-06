// tests/api-superadmin-impersonate.test.js — Tests de POST /api/superadmin/impersonate
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
const { POST } = await import("../app/api/superadmin/impersonate/route.ts");

const VALID_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function postReq(body) {
  return new Request("http://localhost/api/superadmin/impersonate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify(body),
  });
}

function handlers({ empleados = [{ id: "emp-1", legajo: 7, rol: "gerencial", empresa_id: VALID_UUID, nombre: "Ana" }], slug = "acme" } = {}) {
  return [
    {
      match: (url) => url.includes("/rest/v1/empleados") && url.includes("rol=in.(gerencial,administrativo)"),
      respond: () => ({ status: 200, body: empleados }),
    },
    {
      match: (url) => url.includes("/rest/v1/empresa?id=eq.") && url.includes("select=slug"),
      respond: () => ({ status: 200, body: [{ slug }] }),
    },
  ];
}

async function withAdmin(fn) {
  const adminToken = await signAdminToken();
  return withNextCookies(`gypi_superadmin=${adminToken}`, fn);
}

test("impersonate — sin cookie admin devuelve 401", async () => {
  global.fetch = createFetchMock(handlers());
  const res = await withNextCookies("", () => POST(postReq({ empresa_id: VALID_UUID })));
  assert.equal(res.status, 401);
});

test("impersonate — sin empresa_id devuelve 400", async () => {
  global.fetch = createFetchMock(handlers());
  const res = await withAdmin(() => POST(postReq({})));
  assert.equal(res.status, 400);
});

test("impersonate — empresa_id no-UUID devuelve 400", async () => {
  global.fetch = createFetchMock(handlers());
  const res = await withAdmin(() => POST(postReq({ empresa_id: "no-es-uuid" })));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error.includes("UUID"));
});

test("impersonate — sin gerencial/administrativo activo devuelve 404", async () => {
  global.fetch = createFetchMock(handlers({ empleados: [] }));
  const res = await withAdmin(() => POST(postReq({ empresa_id: VALID_UUID })));
  assert.equal(res.status, 404);
});

test("impersonate — éxito devuelve 200 con url y datos del empleado", async () => {
  global.fetch = createFetchMock(handlers());
  const res = await withAdmin(() => POST(postReq({ empresa_id: VALID_UUID })));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.url.startsWith("/acme?imp="), `url debe apuntar al slug con el código: ${json.url}`);
  assert.equal(json.empleado.legajo, 7);
  assert.equal(json.empleado.rol, "gerencial");
});

// ─── F2-13: la auditoría de la impersonación no falla en silencio ───

test("impersonate — registra la auditoría con actor_id null (columna uuid) y actor_rol superadmin", async () => {
  let audit = null;
  global.fetch = createFetchMock([
    ...handlers(),
    { match: (url, opts) => url.includes("/rest/v1/audit_log") && opts?.method === "POST", respond: (url, opts) => { audit = JSON.parse(opts.body); return { status: 201 }; } },
  ]);
  const res = await withAdmin(() => POST(postReq({ empresa_id: VALID_UUID })));
  assert.equal(res.status, 200);
  assert.equal(audit.accion, "impersonate");
  assert.equal(audit.actor_id, null);
  assert.equal(audit.actor_rol, "superadmin");
});

test("impersonate — si la auditoría no se puede guardar, no entrega el código (500)", async () => {
  global.fetch = createFetchMock([
    ...handlers(),
    { match: (url) => url.includes("/rest/v1/audit_log"), respond: () => ({ status: 400, body: { code: "22P02", message: "invalid input syntax for type uuid" } }) },
  ]);
  const res = await withAdmin(() => POST(postReq({ empresa_id: VALID_UUID })));
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.equal(json.url, undefined);
});
