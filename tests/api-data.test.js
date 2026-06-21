// tests/api-data.test.js — Tests HTTP del proxy /api/data
// Llama directamente al handler POST exportado por la route (sin servidor
// HTTP real) con fetch global mockeado en vez de pegarle a Supabase.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/data/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

async function tokenValido() {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol: "gerencial" });
  return token;
}

function req(body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/data", { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  global.fetch = createFetchMock(authPassHandlers());
});

test("POST /api/data — sin token devuelve 401", async () => {
  const res = await POST(req({ method: "GET", path: "empleados?select=id" }, null));
  assert.equal(res.status, 401);
});

test("POST /api/data — tabla no permitida devuelve 403", async () => {
  const token = await tokenValido();
  const res = await POST(req({ method: "GET", path: "auth.users?select=*" }, token));
  assert.equal(res.status, 403);
});

test("POST /api/data — GET válido inyecta empresa_id y devuelve data", async () => {
  const token = await tokenValido();
  let pathRecibido = null;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/empleados"),
      respond: (url) => { pathRecibido = url; return { status: 200, body: [{ id: "x", legajo: 1, nombre: "Ana" }] }; },
    },
  ]);

  const res = await POST(req({ method: "GET", path: "empleados?select=id,legajo,nombre" }, token));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.data.length, 1);
  assert.ok(pathRecibido.includes(`empresa_id=eq.${EMPRESA_ID}`), "debe inyectar empresa_id del token, no del cliente");
  assert.ok(pathRecibido.includes("limit="), "debe forzar un limit");
});

test("POST /api/data — GET respeta order= y devuelve nextCursor", async () => {
  const token = await tokenValido();
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/solicitudes"),
      respond: () => ({
        status: 200,
        body: [
          { id: 1, created_at: "2026-01-03T00:00:00Z" },
          { id: 2, created_at: "2026-01-02T00:00:00Z" },
        ],
      }),
    },
  ]);

  const res = await POST(req({ method: "GET", path: "solicitudes?select=*&order=created_at.desc&limit=2" }, token));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.nextCursor, "2026-01-02T00:00:00Z");
});

test("POST /api/data — PATCH inyecta empresa_id en el body, no en el del cliente", async () => {
  const token = await tokenValido();
  let bodyRecibido = null;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/empleados"),
      respond: (url, opts) => { bodyRecibido = JSON.parse(opts.body); return { status: 200, body: [{ id: "x" }] }; },
    },
  ]);

  await POST(req({ method: "PATCH", path: "empleados?id=eq.x", body: { empresa_id: "intento-de-cross-tenant", nombre: "Nuevo" } }, token));
  assert.equal(bodyRecibido.empresa_id, EMPRESA_ID, "el empresa_id del body del cliente debe ser ignorado/sobreescrito");
  assert.equal(bodyRecibido.nombre, "Nuevo");
});

test("POST /api/data — body inválido en POST a fichadas devuelve 400", async () => {
  const token = await tokenValido();
  const res = await POST(req({ method: "POST", path: "fichadas", body: { legajo: 1 } }, token)); // falta fecha
  assert.equal(res.status, 400);
});

// ─── Integration tests (nuevos) ───────────────────────────────────────────────

test("POST /api/data — empresa_id del cliente en el path es sobreescrito por el del token", async () => {
  const token = await tokenValido();
  let urlFinal = null;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/empleados"),
      respond: (url) => { urlFinal = url; return { status: 200, body: [{ id: "emp-1" }] }; },
    },
  ]);

  // El cliente intenta listar empleados de otra empresa pasando empresa_id=eq.<otro>
  const pathConEmpresaAjena = `empleados?empresa_id=eq.99999999-9999-9999-9999-999999999999&select=id`;
  const res = await POST(req({ method: "GET", path: pathConEmpresaAjena }, token));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  // La URL que llegó a Supabase debe tener el empresa_id del TOKEN, no el del cliente
  assert.ok(urlFinal.includes(`empresa_id=eq.${EMPRESA_ID}`), "debe inyectar empresa_id del token");
  assert.ok(!urlFinal.includes("99999999-9999-9999-9999-999999999999"), "no debe usar empresa_id del cliente");
});

test("POST /api/data — path con caracteres SQL injection es rechazado con 403", async () => {
  const token = await tokenValido();

  const pathsInvalidos = [
    "empleados?select=*;DROP TABLE empleados--",
    "empleados'OR'1'='1",
    `empleados?select=*&filter=nombre=eq."test"`,
    "empleados\\..\\empresa",
  ];

  for (const path of pathsInvalidos) {
    const res = await POST(req({ method: "GET", path }, token));
    assert.equal(res.status, 403, `debe rechazar path inválido: ${path}`);
  }
});

test("POST /api/data — limit > 1000 es capeado a 1000 en la query a Supabase", async () => {
  const token = await tokenValido();
  let urlFinal = null;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/empleados"),
      respond: (url) => { urlFinal = url; return { status: 200, body: [] }; },
    },
  ]);

  // El cliente pide 9999 filas — el proxy debe capearlo a 1000
  const res = await POST(req({ method: "GET", path: "empleados?select=id", limit: 9999 }, token));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  // La URL enviada a Supabase no debe tener limit mayor a 1000
  const limitMatch = urlFinal.match(/limit=(\d+)/);
  assert.ok(limitMatch, "la URL debe incluir un parámetro limit");
  assert.ok(Number(limitMatch[1]) <= 1000, `limit debe ser <= 1000, fue: ${limitMatch[1]}`);
});

test("POST /api/data — limit en path ya existente > 1000 también es capeado", async () => {
  const token = await tokenValido();
  let urlFinal = null;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/empleados"),
      respond: (url) => { urlFinal = url; return { status: 200, body: [] }; },
    },
  ]);

  // El cliente pone limit=5000 directamente en el path
  const res = await POST(req({ method: "GET", path: "empleados?select=id&limit=5000" }, token));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  const limitMatch = urlFinal.match(/limit=(\d+)/);
  assert.ok(limitMatch, "la URL debe incluir un parámetro limit");
  assert.ok(Number(limitMatch[1]) <= 1000, `limit capeado debe ser <= 1000, fue: ${limitMatch[1]}`);
});

test("POST /api/data — POST a empleados rechazado con 402 cuando el plan free tiene >= 5 empleados", async () => {
  const token = await tokenValido();
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    // Plan enforcement: getPlanEmpresa
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=plan_activo"), respond: () => ({ status: 200, body: [{ plan_activo: "free" }] }) },
    // contarFilas: la empresa ya tiene 5 empleados activos (límite del plan free)
    {
      match: (url) => url.includes("/rest/v1/empleados") && url.includes("activo=eq.true"),
      respond: () => {
        // Supabase devuelve content-range con el total en la respuesta HEAD/GET con Prefer:count=exact
        // El mock retorna una Response con el header content-range adecuado
        return {
          status: 200,
          body: [],
          headers: { "content-range": "0-4/5" }, // 5 filas totales
        };
      },
    },
  ]);

  const res = await POST(req({
    method: "POST",
    path: "empleados",
    body: { legajo: 99, nombre: "Nuevo Empleado" },
  }, token));
  const json = await res.json();

  assert.equal(res.status, 402, "debe devolver 402 cuando el límite del plan está excedido");
  assert.equal(json.paywall, true);
  assert.ok(json.error.toLowerCase().includes("plan") || json.error.toLowerCase().includes("empleados"), "el error debe mencionar el plan o el límite de empleados");
  assert.ok(json.upgrade_a, "debe sugerir un plan superior");
});
