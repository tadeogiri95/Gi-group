// tests/api-analytics-event.test.js — Tests HTTP de POST /api/analytics/event
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/analytics/event/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

async function token() {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol: "operativo" });
  return token;
}

function postReq(tok, bodyStr) {
  const headers = { "Content-Type": "application/json" };
  if (tok) headers.Authorization = `Bearer ${tok}`;
  return new Request("http://localhost/api/analytics/event", { method: "POST", headers, body: bodyStr });
}

test("analytics/event — sin token devuelve 401 con ok:false", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(postReq(null, JSON.stringify({ evento: "onboarding_step" })));
  const json = await res.json();
  assert.equal(res.status, 401);
  assert.equal(json.ok, false);
});

test("analytics/event — evento fuera de la whitelist devuelve 400", async () => {
  global.fetch = createFetchMock(authPassHandlers());
  const tok = await token();
  const res = await POST(postReq(tok, JSON.stringify({ evento: "evento_inventado" })));
  const json = await res.json();
  assert.equal(res.status, 400);
  assert.equal(json.ok, false);
});

test("analytics/event — evento permitido devuelve 200 ok:true", async () => {
  global.fetch = createFetchMock(authPassHandlers());
  const tok = await token();
  const res = await POST(postReq(tok, JSON.stringify({ evento: "onboarding_complete", meta: { rubro: "tecnologia" } })));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
});

test("analytics/event — body inválido no rompe la UX (devuelve 200 igual)", async () => {
  global.fetch = createFetchMock(authPassHandlers());
  const tok = await token();
  const res = await POST(postReq(tok, "esto no es json"));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
});
