// tests/jwt-audiencia.test.js — Un `aud` por tipo de token (F2-14, ítem 37
// etapa 4). Todos se firman con JWT_SECRET; el `aud` impide que un token de
// un tipo se acepte como otro. Los tokens viejos (sin `aud`) siguen valiendo
// solo para el tipo que indican sus claims.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";

const jwt = await import("../app/lib/jwt.ts");
const { validarToken } = await import("../app/lib/auth.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";
const PERSONA = { empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol: "gerencial" };

const TIPOS = ["acceso", "refresh", "kiosco", "password_reset", "reactivar_empresa", "oauth_state", "oauth_exchange", "impersonate_code", "admin"];

// Un token de cada tipo, firmado por la función que lo emite en la app.
async function tokenDeCadaTipo() {
  return {
    acceso: (await jwt.signAccessToken(PERSONA)).token,
    impersonacion: (await jwt.signImpersonateToken(PERSONA)).token,
    refresh: (await jwt.signRefreshToken(PERSONA)).token,
    kiosco: (await jwt.signKioscoToken({ empresaId: EMPRESA_ID, activadoPor: EMPLEADO_ID })).token,
    password_reset: (await jwt.signPasswordResetToken(PERSONA)).token,
    reactivar_empresa: await jwt.signReactivarToken({ empresaId: EMPRESA_ID, baja: "2026-10-01" }),
    oauth_state: await jwt.signOAuthState({ intent: "login", slug: "acme", nonce: "n1" }),
    oauth_exchange: (await jwt.signOAuthExchangeCode(PERSONA)).token,
    impersonate_code: (await jwt.signImpersonateCode(PERSONA)).token,
    admin: await jwt.signAdminToken(),
  };
}

// Tipo con el que se verifica cada token (la impersonación es una sesión).
const TIPO_ESPERADO = { impersonacion: "acceso" };

test("cada token se acepta solo con su propio tipo", async () => {
  const tokens = await tokenDeCadaTipo();
  for (const [nombre, token] of Object.entries(tokens)) {
    const propio = TIPO_ESPERADO[nombre] || nombre;
    for (const tipo of TIPOS) {
      const p = await jwt.verifyToken(token, tipo);
      if (tipo === propio) assert.ok(p, `${nombre} se acepta como ${tipo}`);
      else assert.equal(p, null, `${nombre} NO se acepta como ${tipo}`);
    }
  }
});

test("cada token lleva aud gypi:<tipo>", async () => {
  const tokens = await tokenDeCadaTipo();
  for (const [nombre, token] of Object.entries(tokens)) {
    const { aud } = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    assert.equal(aud, `gypi:${TIPO_ESPERADO[nombre] || nombre}`, nombre);
  }
});

test("los verify específicos rechazan tokens de otro tipo", async () => {
  const t = await tokenDeCadaTipo();
  assert.equal(await jwt.verifyPasswordResetToken(t.acceso), null);
  assert.equal(await jwt.verifyReactivarToken(t.password_reset), null);
  assert.equal(await jwt.verifyOAuthExchangeCode(t.impersonate_code), null);
  assert.equal(await jwt.verifyImpersonateCode(t.oauth_exchange), null);
  assert.equal(await jwt.verifyOAuthState(t.acceso), null);
  assert.equal(await jwt.verifyAdminToken(t.acceso), false);
  assert.ok(await jwt.verifyPasswordResetToken(t.password_reset));
  assert.ok(await jwt.verifyAdminToken(t.admin));
});

// ─── Sesión: validarToken ───────────────────────────────────────────────────

function req(token) {
  return new Request("http://localhost/api/x", { headers: { Authorization: `Bearer ${token}` } });
}

test("validarToken — rechaza un link de reseteo de contraseña y un código de Google como sesión", async () => {
  // La sesión en la base "existe" para cualquier jti: solo el aud puede frenarlos.
  global.fetch = createFetchMock(authPassHandlers());
  const t = await tokenDeCadaTipo();
  assert.ok(await validarToken(req(t.acceso)), "una sesión normal pasa");
  assert.equal(await validarToken(req(t.password_reset)), null);
  assert.equal(await validarToken(req(t.oauth_exchange)), null);
});

// ─── Tokens viejos, firmados antes del aud ──────────────────────────────────

const secreto = () => new TextEncoder().encode(process.env.JWT_SECRET);
async function viejo(claims, vence = "1h") {
  return new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(vence).setIssuer("gypi").sign(secreto());
}

test("tokens sin aud — valen solo para el tipo que dicen sus claims", async () => {
  const persona = { sub: EMPLEADO_ID, eid: EMPRESA_ID, leg: 7, rol: "gerencial", jti: "j1" };
  const casos = [
    [await viejo(persona), "acceso"],
    [await viejo({ ...persona, imp: true }), "acceso"],
    [await viejo({ sub: EMPLEADO_ID, eid: EMPRESA_ID, type: "refresh", jti: "j2" }), "refresh"],
    [await viejo({ sub: EMPLEADO_ID, eid: EMPRESA_ID, type: "kiosco", jti: "j3" }), "kiosco"],
    [await viejo({ sub: EMPLEADO_ID, eid: EMPRESA_ID, type: "password_reset", jti: "j4" }), "password_reset"],
    [await viejo({ eid: EMPRESA_ID, baja: "x", type: "reactivar_empresa", jti: "j5" }), "reactivar_empresa"],
    [await viejo({ intent: "login", slug: null, nonce: "n" }), "oauth_state"],
    [await viejo({ ...persona, typ: "oauth_exchange" }), "oauth_exchange"],
    [await viejo({ ...persona, imp: true, code: true }), "impersonate_code"],
    [await viejo({ sub: "superadmin", jti: "j6", ver: "1" }), "admin"],
  ];
  for (const [token, propio] of casos) {
    for (const tipo of TIPOS) {
      const p = await jwt.verifyToken(token, tipo);
      if (tipo === propio) assert.ok(p, `viejo ${propio} se acepta como ${tipo}`);
      else assert.equal(p, null, `viejo ${propio} NO se acepta como ${tipo}`);
    }
  }
});

test("tokens sin aud con un type desconocido o un code suelto — no valen para nada", async () => {
  const raros = [
    await viejo({ sub: EMPLEADO_ID, eid: EMPRESA_ID, rol: "gerencial", type: "otro" }),
    await viejo({ sub: EMPLEADO_ID, eid: EMPRESA_ID, rol: "gerencial", code: true }),
  ];
  for (const token of raros) for (const tipo of TIPOS) assert.equal(await jwt.verifyToken(token, tipo), null);
});

test("un aud ajeno no se acepta aunque los claims coincidan", async () => {
  const token = await new SignJWT({ sub: EMPLEADO_ID, eid: EMPRESA_ID, leg: 7, rol: "gerencial", jti: "j7" })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").setIssuer("gypi").setAudience("authenticated").sign(secreto());
  for (const tipo of TIPOS) assert.equal(await jwt.verifyToken(token, tipo), null);
});
