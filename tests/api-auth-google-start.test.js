// tests/api-auth-google-start.test.js — Tests de GET /api/auth/google/start
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
});

const { GET } = await import("../app/api/auth/google/start/route.ts");
const { verifyOAuthState } = await import("../app/lib/jwt.ts");

function req(qs) {
  return new NextRequest(`http://localhost/api/auth/google/start${qs}`);
}

function setCookiesDe(res) {
  const arr = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie") || ""];
  return arr.join("; ");
}

test("google/start — intent inválido devuelve 400", async () => {
  const res = await GET(req("?intent=otra-cosa"));
  assert.equal(res.status, 400);
});

test("google/start — intent=login sin slug devuelve 400", async () => {
  const res = await GET(req("?intent=login"));
  assert.equal(res.status, 400);
});

test("google/start — intent=login con slug inválido devuelve 400", async () => {
  const res = await GET(req("?intent=login&slug=" + encodeURIComponent("ACME Corp!")));
  assert.equal(res.status, 400);
});

test("google/start — intent=registro redirige a Google con state firmado y cookie httpOnly", async () => {
  const res = await GET(req("?intent=registro"));
  assert.equal(res.status, 302);

  const location = res.headers.get("location");
  assert.ok(location.startsWith("https://accounts.google.com/o/oauth2/v2/auth"));

  const url = new URL(location);
  assert.equal(url.searchParams.get("client_id"), "test-client-id.apps.googleusercontent.com");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:3000/api/auth/google/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "openid email profile");

  const state = await verifyOAuthState(url.searchParams.get("state"));
  assert.equal(state.intent, "registro");
  assert.equal(state.slug, null);

  const cookies = setCookiesDe(res);
  assert.ok(cookies.includes("gypi_oauth_state="), "debe setear la cookie de state");
  assert.ok(/httponly/i.test(cookies), "la cookie de state debe ser httpOnly");

  const nonceCookie = cookies.match(/gypi_oauth_state=([^;]+)/)[1];
  assert.equal(state.nonce, nonceCookie, "el nonce del state debe coincidir con el valor de la cookie");
});

test("google/start — intent=login con slug válido lo incluye en el state", async () => {
  const res = await GET(req("?intent=login&slug=metalurgica-test"));
  assert.equal(res.status, 302);
  const url = new URL(res.headers.get("location"));
  const state = await verifyOAuthState(url.searchParams.get("state"));
  assert.equal(state.intent, "login");
  assert.equal(state.slug, "metalurgica-test");
});
