// tests/jwt.test.js — Round-trip sign/verify de tokens JWT
// Requiere Node 20+ y JWT_SECRET >= 32 chars en el entorno
import { test, before } from "node:test";
import assert from "node:assert/strict";

// Necesitamos JWT_SECRET para que jose funcione
before(() => {
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  }
});

const { signAccessToken, signRefreshToken, signImpersonateToken, verifyToken } =
  await import("../app/lib/jwt.ts");

// ─── Access token ───
test("signAccessToken — genera token no vacío", async () => {
  const { token, jti } = await signAccessToken({
    empleadoId: "emp-uuid-001",
    empresaId: "emp-uuid-002",
    legajo: 42,
    rol: "empleado",
  });
  assert.ok(token.startsWith("eyJ"), "debe ser JWT base64");
  assert.ok(jti.length === 32, "jti debe ser 32 hex chars");
});

test("access token — verifyToken devuelve payload correcto", async () => {
  const { token } = await signAccessToken({
    empleadoId: "emp-001",
    empresaId: "org-001",
    legajo: 7,
    rol: "gerencial",
  });
  const payload = await verifyToken(token);
  assert.equal(payload.sub, "emp-001");
  assert.equal(payload.eid, "org-001");
  assert.equal(payload.leg, 7);
  assert.equal(payload.rol, "gerencial");
  assert.ok(payload.jti);
});

test("access token — no tiene type:refresh", async () => {
  const { token } = await signAccessToken({ empleadoId: "x", empresaId: "y", legajo: 1, rol: "empleado" });
  const p = await verifyToken(token);
  assert.notEqual(p.type, "refresh");
});

// ─── Refresh token ───
test("signRefreshToken — genera token distinto al access", async () => {
  const a = await signAccessToken({ empleadoId: "x", empresaId: "y", legajo: 1, rol: "empleado" });
  const r = await signRefreshToken({ empleadoId: "x", empresaId: "y" });
  assert.notEqual(a.token, r.token);
});

test("refresh token — payload tiene type:refresh", async () => {
  const { token } = await signRefreshToken({ empleadoId: "x", empresaId: "y" });
  const p = await verifyToken(token);
  assert.equal(p.type, "refresh");
});

// ─── Impersonate token ───
test("signImpersonateToken — payload tiene imp:true", async () => {
  const { token } = await signImpersonateToken({ empleadoId: "a", empresaId: "b", legajo: 1, rol: "gerencial" });
  const p = await verifyToken(token);
  assert.equal(p.imp, true);
  assert.equal(p.rol, "gerencial");
});

// ─── verifyToken con token inválido ───
test("verifyToken — devuelve null para token falso", async () => {
  const r = await verifyToken("eyJhbGciOiJIUzI1NiJ9.fake.payload");
  assert.equal(r, null);
});

test("verifyToken — devuelve null para string vacío", async () => {
  assert.equal(await verifyToken(""), null);
});

test("verifyToken — devuelve null para undefined", async () => {
  assert.equal(await verifyToken(undefined), null);
});

// ─── JTIs únicos ───
test("cada token tiene jti único", async () => {
  const tokens = await Promise.all(
    Array.from({ length: 20 }, () =>
      signAccessToken({ empleadoId: "x", empresaId: "y", legajo: 1, rol: "empleado" })
    )
  );
  const jtis = new Set(tokens.map((t) => t.jti));
  assert.equal(jtis.size, 20, "todos los JTIs deben ser únicos");
});
