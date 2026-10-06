// tests/lib-audit.test.js — logAudit ya no falla en silencio (F2-13)
import { test, before } from "node:test";
import assert from "node:assert/strict";

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { logAudit } = await import("../app/lib/audit.ts");
const { logger } = await import("../app/lib/logger.ts");

function capturarErrores(fn) {
  const errores = [];
  const original = logger.error;
  logger.error = (...args) => { errores.push(args); };
  return fn().finally(() => { logger.error = original; }).then((r) => ({ r, errores }));
}

test("logAudit — insert OK devuelve true y no loguea errores", async () => {
  global.fetch = async () => new Response(null, { status: 201 });
  const { r, errores } = await capturarErrores(() => logAudit({ accion: "x" }));
  assert.equal(r, true);
  assert.equal(errores.length, 0);
});

test("logAudit — si la base rechaza el insert, devuelve false y lo loguea como error", async () => {
  global.fetch = async () => new Response('{"code":"22P02"}', { status: 400 });
  const { r, errores } = await capturarErrores(() => logAudit({ accion: "impersonate" }));
  assert.equal(r, false);
  assert.equal(errores.length, 1);
  assert.ok(String(errores[0][0]).includes("impersonate"));
});

test("logAudit — error de red devuelve false y lo loguea, sin lanzar", async () => {
  global.fetch = async () => { throw new Error("red caída"); };
  const { r, errores } = await capturarErrores(() => logAudit({ accion: "cambiar_plan" }));
  assert.equal(r, false);
  assert.equal(errores.length, 1);
});
