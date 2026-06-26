// tests/api-billing-iniciar-trial.test.js — Tests HTTP de POST /api/billing/iniciar-trial
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/billing/iniciar-trial/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

async function tokenConRol(rol) {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return token;
}

function postReq(token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/billing/iniciar-trial", { method: "POST", headers });
}

function sbEmpresa({ plan_activo = "free", trial_usado = false } = {}) {
  return {
    match: (url) => /\/rest\/v1\/empresa\?id=eq\..*select=plan_activo,trial_usado/.test(url),
    respond: () => ({ status: 200, body: [{ plan_activo, trial_usado }] }),
  };
}

function rpcIniciarTrialOk() {
  return { match: (url) => url.includes("/rpc/iniciar_trial_pro"), respond: () => ({ status: 200, body: {} }) };
}

function patchEmpresaOk() {
  return {
    match: (url, opts) => /\/rest\/v1\/empresa\?id=eq\./.test(url) && opts?.method === "PATCH",
    respond: () => ({ status: 200, body: [] }),
  };
}

test("iniciar-trial — sin token devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(postReq(null));
  assert.equal(res.status, 401);
});

test("iniciar-trial — rol operativo devuelve 403", async () => {
  global.fetch = createFetchMock(authPassHandlers());
  const res = await POST(postReq(await tokenConRol("operativo")));
  assert.equal(res.status, 403);
});

test("iniciar-trial — empresa en free sin trial usado, inicia el trial y devuelve ok", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    sbEmpresa({ plan_activo: "free", trial_usado: false }),
    rpcIniciarTrialOk(),
    patchEmpresaOk(),
  ]);
  const res = await POST(postReq(await tokenConRol("gerencial")));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.plan, "trial");
});

test("iniciar-trial — trial ya usado devuelve 409", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    sbEmpresa({ plan_activo: "free", trial_usado: true }),
  ]);
  const res = await POST(postReq(await tokenConRol("gerencial")));
  assert.equal(res.status, 409);
});

test("iniciar-trial — plan distinto de free devuelve 409", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    sbEmpresa({ plan_activo: "pro", trial_usado: false }),
  ]);
  const res = await POST(postReq(await tokenConRol("gerencial")));
  assert.equal(res.status, 409);
});
