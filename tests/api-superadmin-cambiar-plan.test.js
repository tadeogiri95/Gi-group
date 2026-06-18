// tests/api-superadmin-cambiar-plan.test.js — Tests de POST /api/superadmin/cambiar-plan
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";
import { withNextCookies } from "./helpers/withNextCookies.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAdminToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/superadmin/cambiar-plan/route.ts");

const VALID_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function postReq(body) {
  return new Request("http://localhost/api/superadmin/cambiar-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify(body),
  });
}

function handlersPatch({ patchOk = true } = {}) {
  return [
    {
      match: (url, opts) => url.includes("/rest/v1/empresa?id=eq.") && opts?.method === "PATCH",
      respond: () => patchOk
        ? { status: 200, body: [{ id: VALID_UUID, plan_activo: "pro" }] }
        : { status: 500, body: "Internal Server Error" },
    },
  ];
}

// ─── Auth ───

test("cambiar-plan — sin cookie devuelve 401", async () => {
  global.fetch = createFetchMock(handlersPatch());
  const res = await withNextCookies("", () => POST(postReq({ empresa_id: VALID_UUID, plan: "pro" })));
  assert.equal(res.status, 401);
});

// ─── Validation ───

test("cambiar-plan — sin empresa_id o plan devuelve 400", async () => {
  global.fetch = createFetchMock(handlersPatch());
  const adminToken = await signAdminToken();
  const res = await withNextCookies(`gypi_superadmin=${adminToken}`, () => POST(postReq({ empresa_id: VALID_UUID })));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error.includes("requeridos"));
});

test("cambiar-plan — UUID inválido devuelve 400", async () => {
  global.fetch = createFetchMock(handlersPatch());
  const adminToken = await signAdminToken();
  const res = await withNextCookies(`gypi_superadmin=${adminToken}`, () => POST(postReq({ empresa_id: "no-es-uuid", plan: "pro" })));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error.includes("UUID"));
});

test("cambiar-plan — plan inválido devuelve 400", async () => {
  global.fetch = createFetchMock(handlersPatch());
  const adminToken = await signAdminToken();
  const res = await withNextCookies(`gypi_superadmin=${adminToken}`, () => POST(postReq({ empresa_id: VALID_UUID, plan: "platinum" })));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error.includes("inválido"));
});

// ─── Success ───

test("cambiar-plan — datos válidos devuelve 200 con ok:true y plan", async () => {
  global.fetch = createFetchMock(handlersPatch());
  const adminToken = await signAdminToken();
  const res = await withNextCookies(`gypi_superadmin=${adminToken}`, () => POST(postReq({ empresa_id: VALID_UUID, plan: "pro" })));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.plan, "pro");
});
