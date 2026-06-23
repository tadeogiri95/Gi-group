// tests/api-verificar-email.test.js — Tests HTTP de GET /api/verificar-email
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { GET } = await import("../app/api/verificar-email/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";

function getReq(query) {
  return new Request(`http://localhost/api/verificar-email${query}`);
}

test("verificar-email — sin token ni empresa_id devuelve 400", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(getReq(""));
  assert.equal(res.status, 400);
  const text = await res.text();
  assert.ok(text.includes("inválido"));
});

test("verificar-email — sin match en DB (token/empresa no coinciden) devuelve 400", async () => {
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes(`id=eq.${EMPRESA_ID}`), respond: () => ({ status: 200, body: [] }) },
  ]);
  const res = await GET(getReq(`?token=abc&e=${EMPRESA_ID}`));
  assert.equal(res.status, 400);
  const text = await res.text();
  assert.ok(text.includes("expirado") || text.includes("inválido"));
});

test("verificar-email — match exitoso activa email_verificado y redirige al slug", async () => {
  let patchBody = null;
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes(`id=eq.${EMPRESA_ID}`) && url.includes("email_verify_token=eq.tok123"), respond: () => ({ status: 200, body: [{ id: EMPRESA_ID, slug: "acme", email_verificado: false }] }) },
    { match: (url, opts) => url.includes("/rest/v1/empresa") && opts?.method === "PATCH", respond: (url, opts) => { patchBody = JSON.parse(opts.body); return { status: 204 }; } },
  ]);
  const res = await GET(getReq(`?token=tok123&e=${EMPRESA_ID}`));

  assert.equal(res.status, 307);
  assert.ok(res.headers.get("location").includes("/acme?verificado=1"));
  assert.equal(patchBody.email_verificado, true);
  assert.equal(patchBody.email_verify_token, null);
});
