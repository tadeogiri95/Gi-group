// tests/tenant-isolation.test.js — Verify tenant isolation at the application layer
//
// Uses the same CAMPOS_PERMITIDOS whitelist that /api/data uses,
// without importing NextResponse (which breaks in node:test runner).
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
});

const { CAMPOS_PERMITIDOS } = await import("../app/lib/schemas.ts");

function stripUnallowedFields(body, tabla, method) {
  const allowed = CAMPOS_PERMITIDOS[tabla]?.[method];
  if (!allowed) return body;
  const clean = {};
  for (const key of allowed) {
    if (body[key] !== undefined) clean[key] = body[key];
  }
  return clean;
}

describe("Tenant isolation — empresa_id never accepted from client", () => {
  const TABLAS = Object.keys(CAMPOS_PERMITIDOS);

  for (const tabla of TABLAS) {
    const methods = Object.keys(CAMPOS_PERMITIDOS[tabla]);
    for (const method of methods) {
      test(`${tabla} ${method}: empresa_id stripped from client body`, () => {
        const body = { empresa_id: "attacker-uuid", legajo: 1, nombre: "test" };
        const clean = stripUnallowedFields(body, tabla, method);
        assert.equal(clean.empresa_id, undefined,
          `empresa_id must be stripped from ${tabla} ${method} — it's injected from session`);
      });
    }
  }
});

describe("Tenant isolation — sensitive fields never exposed via whitelist", () => {
  test("empleados PATCH whitelist excludes password", () => {
    const allowed = CAMPOS_PERMITIDOS.empleados?.PATCH || [];
    assert.ok(!allowed.includes("password"), "password must not be in empleados PATCH whitelist");
  });

  test("empleados PATCH whitelist excludes password_reset_jti", () => {
    const allowed = CAMPOS_PERMITIDOS.empleados?.PATCH || [];
    assert.ok(!allowed.includes("password_reset_jti"));
  });

  test("empresa PATCH whitelist excludes admin_password", () => {
    const allowed = CAMPOS_PERMITIDOS.empresa?.PATCH || [];
    assert.ok(!allowed.includes("admin_password"));
  });

  test("empresa PATCH whitelist excludes plan_activo", () => {
    const allowed = CAMPOS_PERMITIDOS.empresa?.PATCH || [];
    assert.ok(!allowed.includes("plan_activo"), "plan_activo must not be client-settable");
  });

  test("empresa PATCH whitelist excludes suscripcion_activa_id", () => {
    const allowed = CAMPOS_PERMITIDOS.empresa?.PATCH || [];
    assert.ok(!allowed.includes("suscripcion_activa_id"));
  });

  test("empresa PATCH whitelist excludes email_verify_token", () => {
    const allowed = CAMPOS_PERMITIDOS.empresa?.PATCH || [];
    assert.ok(!allowed.includes("email_verify_token"));
  });

  test("no table whitelist includes empresa_id", () => {
    for (const [tabla, methods] of Object.entries(CAMPOS_PERMITIDOS)) {
      for (const [method, fields] of Object.entries(methods)) {
        assert.ok(!fields.includes("empresa_id"),
          `${tabla}.${method} whitelist must NOT include empresa_id`);
      }
    }
  });
});
