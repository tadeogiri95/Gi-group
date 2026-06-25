// tests/api-auth-google-callback.test.js — Tests de GET /api/auth/google/callback
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { createFetchMock } from "./helpers/mockFetch.js";

const GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";
const KID = "test-key-1";

let privateKey, publicJwk;

before(async () => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.RESEND_API_KEY = "re_test_dummy_key";
  process.env.GOOGLE_CLIENT_ID = GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

  const { privateKey: priv, publicKey } = await generateKeyPair("RS256");
  privateKey = priv;
  publicJwk = await exportJWK(publicKey);
  publicJwk.kid = KID;
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
});

const { GET } = await import("../app/api/auth/google/callback/route.ts");
const { signOAuthState, verifyOAuthExchangeCode } = await import("../app/lib/jwt.ts");

async function signFakeIdToken(claims = {}) {
  const { sub = "google-sub-123", ...rest } = claims;
  return new SignJWT({
    email: "juan@gmail.com",
    email_verified: true,
    name: "Juan Pérez",
    ...rest,
  })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt()
    .setIssuer("https://accounts.google.com")
    .setAudience(GOOGLE_CLIENT_ID)
    .setSubject(sub)
    .setExpirationTime("10m")
    .sign(privateKey);
}

async function buildState(opts = {}) {
  const nonce = "nonce-fijo-de-test";
  const state = await signOAuthState({ intent: "registro", slug: null, nonce, ...opts });
  return { state, nonce };
}

function callbackReq({ code = "auth-code-123", state, oauthStateCookie, error } = {}) {
  const url = new URL("http://localhost/api/auth/google/callback");
  if (code) url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  if (error) url.searchParams.set("error", error);
  return new NextRequest(url, {
    headers: oauthStateCookie ? { cookie: `gypi_oauth_state=${oauthStateCookie}` } : {},
  });
}

function baseHandlers({ idToken, rateLimitCount = 0 } = {}) {
  return [
    { match: (url) => url.includes("/rpc/rpc_login_attempt"), respond: () => ({ status: 200, body: rateLimitCount }) },
    { match: (url) => url.includes("oauth2.googleapis.com/token"), respond: () => ({ status: 200, body: { id_token: idToken } }) },
    { match: (url) => url.includes("googleapis.com/oauth2/v3/certs"), respond: () => ({ status: 200, body: { keys: [publicJwk] } }) },
  ];
}

test("google/callback — error= de Google redirige con oauth_error=cancelado", async () => {
  global.fetch = createFetchMock(baseHandlers());
  const res = await GET(callbackReq({ error: "access_denied" }));
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get("location"));
  assert.equal(location.searchParams.get("oauth_error"), "cancelado");
});

test("google/callback — sin code redirige con oauth_error=solicitud_invalida", async () => {
  global.fetch = createFetchMock(baseHandlers());
  const res = await GET(callbackReq({ code: null }));
  const location = new URL(res.headers.get("location"));
  assert.equal(location.searchParams.get("oauth_error"), "solicitud_invalida");
});

test("google/callback — state sin cookie de nonce redirige con oauth_error=state_invalido", async () => {
  global.fetch = createFetchMock(baseHandlers());
  const { state } = await buildState();
  const res = await GET(callbackReq({ state }));
  const location = new URL(res.headers.get("location"));
  assert.equal(location.searchParams.get("oauth_error"), "state_invalido");
});

test("google/callback — nonce de la cookie no coincide redirige con oauth_error=state_invalido", async () => {
  global.fetch = createFetchMock(baseHandlers());
  const { state } = await buildState();
  const res = await GET(callbackReq({ state, oauthStateCookie: "otro-nonce-distinto" }));
  const location = new URL(res.headers.get("location"));
  assert.equal(location.searchParams.get("oauth_error"), "state_invalido");
});

test("google/callback — email_verified:false redirige con oauth_error=email_no_verificado", async () => {
  const idToken = await signFakeIdToken({ email_verified: false });
  global.fetch = createFetchMock(baseHandlers({ idToken }));
  const { state, nonce } = await buildState();
  const res = await GET(callbackReq({ state, oauthStateCookie: nonce }));
  const location = new URL(res.headers.get("location"));
  assert.equal(location.searchParams.get("oauth_error"), "email_no_verificado");
});

test("google/callback — intent=registro feliz crea empresa y redirige con ?oauth=<code>", async () => {
  const idToken = await signFakeIdToken({ sub: "google-sub-nuevo" });
  global.fetch = createFetchMock([
    ...baseHandlers({ idToken }),
    { match: (url) => url.includes("/rest/v1/empresa?slug=eq."), respond: () => ({ status: 200, body: [] }) },
    { match: (url, opts) => url.includes("/rpc/rpc_crear_empresa_con_admin"), respond: () => ({ status: 200, body: { empresa_id: EMPRESA_ID, empleado_id: EMPLEADO_ID } }) },
    { match: (url) => url.includes("/rpc/iniciar_trial_pro"), respond: () => ({ status: 200, body: {} }) },
    { match: (url, opts) => url.includes("/rest/v1/empresa?id=eq.") && opts?.method === "PATCH", respond: () => ({ status: 200, body: [] }) },
    { match: (url, opts) => url.includes("/rest/v1/empleados?id=eq.") && opts?.method === "PATCH", respond: () => ({ status: 200, body: [] }) },
  ]);
  const { state, nonce } = await buildState({ intent: "registro" });
  const res = await GET(callbackReq({ state, oauthStateCookie: nonce }));

  assert.equal(res.status, 302);
  const location = new URL(res.headers.get("location"));
  assert.ok(location.pathname.startsWith("/empresa-de-juan"), `slug inesperado: ${location.pathname}`);

  const code = location.searchParams.get("oauth");
  assert.ok(code, "debe incluir un código de intercambio");
  const payload = await verifyOAuthExchangeCode(code);
  assert.equal(payload.empleadoId, EMPLEADO_ID);
  assert.equal(payload.empresaId, EMPRESA_ID);
  assert.equal(payload.legajo, 1);
  assert.equal(payload.rol, "gerencial");
});

test("google/callback — intent=registro con email ya registrado redirige con oauth_error=email_en_uso", async () => {
  const idToken = await signFakeIdToken({ sub: "google-sub-dup" });
  global.fetch = createFetchMock([
    ...baseHandlers({ idToken }),
    { match: (url) => url.includes("/rest/v1/empresa?slug=eq."), respond: () => ({ status: 200, body: [] }) },
    {
      match: (url) => url.includes("/rpc/rpc_crear_empresa_con_admin"),
      respond: () => ({ status: 409, body: JSON.stringify({ message: "duplicate key value violates unique constraint \"empresa_admin_email_key\" 23505" }) }),
    },
  ]);
  const { state, nonce } = await buildState({ intent: "registro" });
  const res = await GET(callbackReq({ state, oauthStateCookie: nonce }));
  const location = new URL(res.headers.get("location"));
  assert.equal(location.searchParams.get("oauth_error"), "email_en_uso");
});

test("google/callback — intent=login sin empresa para el slug redirige con oauth_error=empresa_no_encontrada", async () => {
  const idToken = await signFakeIdToken({ sub: "google-sub-login" });
  global.fetch = createFetchMock([
    ...baseHandlers({ idToken }),
    { match: (url) => url.includes("/rest/v1/empresa?slug=eq."), respond: () => ({ status: 200, body: [] }) },
  ]);
  const { state, nonce } = await buildState({ intent: "login", slug: "acme" });
  const res = await GET(callbackReq({ state, oauthStateCookie: nonce }));
  const location = new URL(res.headers.get("location"));
  assert.equal(location.searchParams.get("oauth_error"), "empresa_no_encontrada");
});

test("google/callback — intent=login sin empleado con ese google_id ni email redirige con oauth_error=no_account", async () => {
  const idToken = await signFakeIdToken({ sub: "google-sub-sin-cuenta" });
  global.fetch = createFetchMock([
    ...baseHandlers({ idToken }),
    { match: (url) => url.includes("/rest/v1/empresa?slug=eq."), respond: () => ({ status: 200, body: [{ id: EMPRESA_ID, slug: "acme", activa: true }] }) },
    { match: (url) => url.includes("/rest/v1/empleados") && url.includes("google_id=eq."), respond: () => ({ status: 200, body: [] }) },
    { match: (url) => url.includes("/rest/v1/empleados") && url.includes("google_id=is.null"), respond: () => ({ status: 200, body: [] }) },
  ]);
  const { state, nonce } = await buildState({ intent: "login", slug: "acme" });
  const res = await GET(callbackReq({ state, oauthStateCookie: nonce }));
  const location = new URL(res.headers.get("location"));
  assert.equal(location.searchParams.get("oauth_error"), "no_account");
});

test("google/callback — intent=login con google_id ya linkeado entra directo", async () => {
  const idToken = await signFakeIdToken({ sub: "google-sub-ya-linkeado" });
  global.fetch = createFetchMock([
    ...baseHandlers({ idToken }),
    { match: (url) => url.includes("/rest/v1/empresa?slug=eq."), respond: () => ({ status: 200, body: [{ id: EMPRESA_ID, slug: "acme", activa: true }] }) },
    { match: (url) => url.includes("/rest/v1/empleados") && url.includes("google_id=eq."), respond: () => ({ status: 200, body: [{ id: EMPLEADO_ID, legajo: 5, rol: "operativo" }] }) },
  ]);
  const { state, nonce } = await buildState({ intent: "login", slug: "acme" });
  const res = await GET(callbackReq({ state, oauthStateCookie: nonce }));

  assert.equal(res.status, 302);
  const location = new URL(res.headers.get("location"));
  assert.equal(location.pathname, "/acme");
  const payload = await verifyOAuthExchangeCode(location.searchParams.get("oauth"));
  assert.equal(payload.empleadoId, EMPLEADO_ID);
  assert.equal(payload.legajo, 5);
  assert.equal(payload.rol, "operativo");
});

test("google/callback — intent=login auto-linkea por email cuando no hay google_id previo", async () => {
  const idToken = await signFakeIdToken({ sub: "google-sub-auto-link" });
  let linkPatchBody = null;
  global.fetch = createFetchMock([
    ...baseHandlers({ idToken }),
    { match: (url) => url.includes("/rest/v1/empresa?slug=eq."), respond: () => ({ status: 200, body: [{ id: EMPRESA_ID, slug: "acme", activa: true }] }) },
    { match: (url) => url.includes("/rest/v1/empleados") && url.includes("google_id=eq."), respond: () => ({ status: 200, body: [] }) },
    { match: (url) => url.includes("/rest/v1/empleados") && url.includes("google_id=is.null"), respond: () => ({ status: 200, body: [{ id: EMPLEADO_ID, legajo: 3, rol: "administrativo" }] }) },
    {
      match: (url, opts) => url.includes(`/rest/v1/empleados?id=eq.${EMPLEADO_ID}`) && opts?.method === "PATCH",
      respond: (url, opts) => { linkPatchBody = JSON.parse(opts.body); return { status: 200, body: [] }; },
    },
  ]);
  const { state, nonce } = await buildState({ intent: "login", slug: "acme" });
  const res = await GET(callbackReq({ state, oauthStateCookie: nonce }));

  assert.equal(res.status, 302);
  assert.deepEqual(linkPatchBody, { google_id: "google-sub-auto-link" });
  const location = new URL(res.headers.get("location"));
  const payload = await verifyOAuthExchangeCode(location.searchParams.get("oauth"));
  assert.equal(payload.empleadoId, EMPLEADO_ID);
  assert.equal(payload.rol, "administrativo");
});
