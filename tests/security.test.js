// tests/security.test.js — Tests de seguridad: inyección de campos,
// payloads malformados, XSS en inputs, rate limiting in-memory
import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

// ═══ 1. Schemas — rechazan payloads malformados ═══

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
});

const schemas = await import("../app/lib/schemas.ts");
const { validateBody, stripUnallowedFields, sanitizePostgrestParam, isUUID } = await import("../app/lib/validate.ts");
const { checkRateLimit, _resetBuckets } = await import("../app/lib/rateLimitMemory.js");

describe("Zod schemas — rechazan inputs maliciosos", () => {
  test("ficharBody rechaza geo_lat fuera de rango", () => {
    const r = schemas.ficharBody.safeParse({ accion: "ingreso", geo_lat: 999 });
    assert.equal(r.success, false);
  });

  test("ficharBody rechaza geo_lng fuera de rango", () => {
    const r = schemas.ficharBody.safeParse({ accion: "ingreso", geo_lng: -999 });
    assert.equal(r.success, false);
  });

  test("ficharBody rechaza accion inexistente", () => {
    const r = schemas.ficharBody.safeParse({ accion: "hackear" });
    assert.equal(r.success, false);
  });

  test("ficharBody acepta ingreso válido con geo", () => {
    const r = schemas.ficharBody.safeParse({ accion: "ingreso", geo_lat: -34.6, geo_lng: -58.4 });
    assert.equal(r.success, true);
  });

  test("ficharBody descarta campos extra (strip)", () => {
    const r = schemas.ficharBody.safeParse({ accion: "ingreso", empresa_id: "inyectado", rol: "gerencial" });
    assert.equal(r.success, true);
    assert.equal(r.data.empresa_id, undefined);
    assert.equal(r.data.rol, undefined);
  });

  test("loginBody rechaza empresa_id no-UUID", () => {
    const r = schemas.loginBody.safeParse({ legajo: "1", password: "test", empresa_id: "not-a-uuid" });
    assert.equal(r.success, false);
  });

  test("loginBody acepta UUID válido", () => {
    const r = schemas.loginBody.safeParse({ legajo: "7", password: "Segura123", empresa_id: "11111111-1111-1111-1111-111111111111" });
    assert.equal(r.success, true);
  });

  test("registroEmpresaBody rechaza nombre_empresa > 100 chars", () => {
    const r = schemas.registroEmpresaBody.safeParse({
      nombre_empresa: "x".repeat(101),
      nombre_admin: "Test",
      email: "test@test.com",
      password: "Segura123",
    });
    assert.equal(r.success, false);
  });

  test("registroEmpresaBody rechaza email inválido", () => {
    const r = schemas.registroEmpresaBody.safeParse({
      nombre_empresa: "Test",
      nombre_admin: "Test",
      email: "not-an-email",
      password: "Segura123",
    });
    assert.equal(r.success, false);
  });

  test("sendPushBody rechaza title vacío", () => {
    const r = schemas.sendPushBody.safeParse({ title: "", body: "test" });
    assert.equal(r.success, false);
  });

  test("sendPushBody rechaza body > 2000 chars", () => {
    const r = schemas.sendPushBody.safeParse({ title: "test", body: "x".repeat(2001) });
    assert.equal(r.success, false);
  });

  test("empresaPatchBody rechaza color inválido", () => {
    const r = schemas.empresaPatchBody.safeParse({ color_primario: "not-a-color" });
    assert.equal(r.success, false);
  });

  test("empresaPatchBody acepta color válido", () => {
    const r = schemas.empresaPatchBody.safeParse({ color_primario: "#FF5500" });
    assert.equal(r.success, true);
  });

  test("unirseBody rechaza action inválida", () => {
    const r = schemas.unirseBody.safeParse({ action: "hackear", slug: "test", legajo: 1 });
    assert.equal(r.success, false);
  });

  test("chatQueryBody rechaza campos extra (strict)", () => {
    const r = schemas.chatQueryBody.safeParse({ query_type: "test", params: {}, extra: "campo" });
    assert.equal(r.success, false);
  });
});

// ═══ 2. Campo whitelist — stripUnallowedFields ═══

describe("stripUnallowedFields — previene inyección de campos", () => {
  test("empleados POST: solo permite campos whitelisteados", () => {
    const body = {
      legajo: 1, nombre: "Test", rol: "gerencial",
      empresa_id: "inyectado", activo: true, campo_raro: "xss<script>",
    };
    const clean = stripUnallowedFields(body, "empleados", "POST");
    assert.equal(clean.legajo, 1);
    assert.equal(clean.nombre, "Test");
    assert.equal(clean.rol, "gerencial");
    assert.equal(clean.empresa_id, undefined, "empresa_id no debe pasar — se inyecta del token");
    assert.equal(clean.campo_raro, undefined, "campos no whitelisteados se descartan");
  });

  test("fichadas PATCH: solo egreso/horas", () => {
    const body = {
      egreso: "18:00", empresa_id: "inyectado", empleado_id: "hack",
      horas_trabajadas: "8.00", password: "secreto",
    };
    const clean = stripUnallowedFields(body, "fichadas", "PATCH");
    assert.equal(clean.egreso, "18:00");
    assert.equal(clean.horas_trabajadas, "8.00");
    assert.equal(clean.empresa_id, undefined);
    assert.equal(clean.empleado_id, undefined);
    assert.equal(clean.password, undefined);
  });

  test("empresa PATCH: no permite admin_password ni plan_activo", () => {
    const body = {
      nombre: "Empresa OK", admin_password: "hack", plan_activo: "enterprise",
      suscripcion_activa_id: "hack", color_primario: "#FF0000",
    };
    const clean = stripUnallowedFields(body, "empresa", "PATCH");
    assert.equal(clean.nombre, "Empresa OK");
    assert.equal(clean.color_primario, "#FF0000");
    assert.equal(clean.admin_password, undefined);
    assert.equal(clean.plan_activo, undefined);
    assert.equal(clean.suscripcion_activa_id, undefined);
  });

  test("tabla sin whitelist devuelve body original", () => {
    const body = { foo: "bar" };
    const clean = stripUnallowedFields(body, "tabla_inexistente", "POST");
    assert.deepEqual(clean, body);
  });
});

// ═══ 3. sanitizePostgrestParam — previene inyección PostgREST ═══

describe("sanitizePostgrestParam — sanitiza operadores PostgREST", () => {
  test("remueve paréntesis y operadores", () => {
    assert.equal(sanitizePostgrestParam("valor.in.(1,2,3)"), "valor.in.123");
  });

  test("remueve comillas y punto-y-coma", () => {
    assert.equal(sanitizePostgrestParam("Robert'; DROP TABLE--"), "Robert DROP TABLE--");
  });

  test("trunca a 200 chars", () => {
    const largo = "a".repeat(300);
    assert.equal(sanitizePostgrestParam(largo).length, 200);
  });

  test("deja strings normales intactos", () => {
    assert.equal(sanitizePostgrestParam("producción general"), "producción general");
  });

  test("permite caracteres acentuados", () => {
    assert.equal(sanitizePostgrestParam("División Técnica ñ"), "División Técnica ñ");
  });
});

// ═══ 4. isUUID — valida UUIDs ═══

describe("isUUID", () => {
  test("acepta UUID válido", () => {
    assert.ok(isUUID("11111111-1111-1111-1111-111111111111"));
  });

  test("rechaza string corto", () => {
    assert.ok(!isUUID("not-uuid"));
  });

  test("rechaza con caracteres inválidos", () => {
    assert.ok(!isUUID("1111111g-1111-1111-1111-111111111111"));
  });

  test("rechaza vacío", () => {
    assert.ok(!isUUID(""));
  });
});

// ═══ 5. Rate limiting in-memory ═══

describe("checkRateLimit — sliding window in-memory", () => {
  beforeEach(() => _resetBuckets());

  test("permite hasta maxRequests", () => {
    for (let i = 0; i < 5; i++) {
      const r = checkRateLimit("test-key", 5, 60000);
      assert.equal(r.limited, false);
    }
  });

  test("bloquea después de maxRequests", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("test-key", 5, 60000);
    const r = checkRateLimit("test-key", 5, 60000);
    assert.equal(r.limited, true);
    assert.equal(r.remaining, 0);
  });

  test("keys distintas son independientes", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("key-a", 5, 60000);
    const r = checkRateLimit("key-b", 5, 60000);
    assert.equal(r.limited, false);
  });

  test("ventana expira y resetea conteo", async () => {
    for (let i = 0; i < 5; i++) checkRateLimit("expire-key", 5, 50);
    await new Promise(r => setTimeout(r, 60));
    const r = checkRateLimit("expire-key", 5, 50);
    assert.equal(r.limited, false);
  });

  test("remaining decrece correctamente", () => {
    const r1 = checkRateLimit("rem-key", 3, 60000);
    assert.equal(r1.remaining, 2);
    const r2 = checkRateLimit("rem-key", 3, 60000);
    assert.equal(r2.remaining, 1);
    const r3 = checkRateLimit("rem-key", 3, 60000);
    assert.equal(r3.remaining, 0);
  });
});

// ═══ 6. XSS — schemas rechazan scripts en inputs texto ═══

describe("XSS prevention — schemas con strict no pasan scripts", () => {
  test("sanitizePostgrestParam neutraliza operadores peligrosos en inputs con HTML", () => {
    const malicious = "test';DROP TABLE empleados--";
    const cleaned = sanitizePostgrestParam(malicious);
    assert.ok(!cleaned.includes("'"), "comillas simples removidas");
    assert.ok(!cleaned.includes(";"), "punto y coma removido");
    // HTML tags (<>) no son operadores PostgREST — la protección XSS
    // depende de que la API devuelve JSON (Content-Type: application/json),
    // no HTML, por lo que los browsers no ejecutan scripts.
    const html = "<script>alert(1)</script>";
    const cleanedHtml = sanitizePostgrestParam(html);
    assert.ok(!cleanedHtml.includes("("), "paréntesis removidos de script tag");
  });

  test("configPostBody no rechaza HTML en clave — solo valida longitud, no contenido", () => {
    const r = schemas.configPostBody.safeParse({
      action: "add_division",
      clave: "<img onerror=alert(1)>",
      label: "test",
    });
    // El schema solo aplica min(1).max(50) sobre clave — no hay sanitización de
    // HTML a este nivel. La protección real es que la respuesta es JSON
    // (Content-Type: application/json), no HTML, así que el browser nunca lo ejecuta.
    assert.equal(r.success, true);
    assert.equal(r.data.clave, "<img onerror=alert(1)>");
  });
});
