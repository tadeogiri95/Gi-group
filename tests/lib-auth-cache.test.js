// tests/lib-auth-cache.test.js — validarToken no consulta la empresa en cada
// pedido (F3-05): el flag email_verificado se cachea 5 minutos por empresa.
import { test, before } from "node:test";
import assert from "node:assert/strict";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { validarToken } = await import(`../app/lib/auth.js?t=${Date.now()}`);

const EMPRESA_A = "aaaaaaaa-0000-0000-0000-000000000001";
const EMPRESA_B = "bbbbbbbb-0000-0000-0000-000000000002";

async function req(empresaId) {
  const { token } = await signAccessToken({ empleadoId: "22222222-2222-2222-2222-222222222222", empresaId, legajo: 7, rol: "operativo" });
  return new Request("http://x/api/data", { headers: { Authorization: `Bearer ${token}` } });
}

test("validarToken — varios pedidos de la misma empresa consultan email_verificado una sola vez", async () => {
  const consultas = [];
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/rest/v1/sesiones")) return Response.json([{ id: "s" }]);
    if (u.includes("select=email_verificado")) { consultas.push(u); return Response.json([{ email_verificado: false }]); }
    throw new Error("inesperado " + u);
  };
  const r1 = await validarToken(await req(EMPRESA_A));
  const r2 = await validarToken(await req(EMPRESA_A));
  const r3 = await validarToken(await req(EMPRESA_A));
  assert.equal(consultas.length, 1);
  assert.equal(r1.email_verificado, false);
  assert.equal(r3.email_verificado, false, "el valor cacheado es el mismo");
  assert.ok(r2);
  await validarToken(await req(EMPRESA_B));
  assert.equal(consultas.length, 2, "otra empresa sí consulta");
});
