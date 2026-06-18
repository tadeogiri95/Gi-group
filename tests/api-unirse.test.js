// tests/api-unirse.test.js — Tests HTTP de POST /api/unirse
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { createFetchMock } from "./helpers/mockFetch.js";
import { _resetBuckets } from "../app/lib/rateLimitMemory.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { POST } = await import("../app/api/unirse/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";
const PASSWORD_OK = "Segura123";

function req(body) {
  return new Request("http://localhost/api/unirse", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify(body),
  });
}

function handlersBase({ empresaActiva = true, empleadoEstado = "pendiente_activacion", empleadoFound = true, empresaFound = true } = {}) {
  let patchCalled = null;
  const handlers = [
    {
      match: (url) => url.includes("/rest/v1/empresa?slug=eq."),
      respond: () => ({
        status: 200,
        body: empresaFound
          ? [{ id: EMPRESA_ID, nombre: "Empresa Test", nombre_corto: "EmpTest", activa: empresaActiva }]
          : [],
      }),
    },
    {
      match: (url) => url.includes("/rest/v1/empleados?empresa_id=eq.") && url.includes("legajo=eq."),
      respond: () => ({
        status: 200,
        body: empleadoFound
          ? [{ id: EMPLEADO_ID, nombre: "Juan Perez", apodo: "Juancho", estado_activacion: empleadoEstado }]
          : [],
      }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/empleados?id=eq.") && opts?.method === "PATCH",
      respond: (_url, opts) => {
        patchCalled = JSON.parse(opts.body);
        return { status: 200, body: [{ id: EMPLEADO_ID }] };
      },
    },
  ];
  handlers.getPatchCalled = () => patchCalled;
  return handlers;
}

beforeEach(() => {
  _resetBuckets();
  global.fetch = createFetchMock(handlersBase());
});

// ── 1. Missing fields → 400 ──
test("unirse — faltan campos devuelve 400", async () => {
  const res = await POST(req({ slug: "empresa-test" }));
  assert.equal(res.status, 400);
});

// ── 2. Invalid action → 400 ──
test("unirse — action inválida devuelve 400", async () => {
  const res = await POST(req({ action: "destruir", slug: "empresa-test", legajo: 7 }));
  assert.equal(res.status, 400);
});

// ── 3. Empresa not found → 404 ──
test("unirse — empresa no encontrada devuelve 404", async () => {
  global.fetch = createFetchMock(handlersBase({ empresaFound: false }));
  const res = await POST(req({ action: "verificar", slug: "no-existe", legajo: 7 }));
  const json = await res.json();
  assert.equal(res.status, 404);
  assert.ok(json.error.includes("no encontrada"));
});

// ── 4. Empresa inactive → 403 ──
test("unirse — empresa inactiva devuelve 403", async () => {
  global.fetch = createFetchMock(handlersBase({ empresaActiva: false }));
  const res = await POST(req({ action: "verificar", slug: "empresa-test", legajo: 7 }));
  const json = await res.json();
  assert.equal(res.status, 403);
  assert.ok(json.error.includes("inactiva"));
});

// ── 5. Legajo not found → 404 ──
test("unirse — legajo no encontrado devuelve 404", async () => {
  global.fetch = createFetchMock(handlersBase({ empleadoFound: false }));
  const res = await POST(req({ action: "verificar", slug: "empresa-test", legajo: 999 }));
  const json = await res.json();
  assert.equal(res.status, 404);
  assert.ok(json.error.includes("Legajo no encontrado"));
});

// ── 6. Already activated → 409 ──
test("unirse — cuenta ya activada devuelve 409", async () => {
  global.fetch = createFetchMock(handlersBase({ empleadoEstado: "activo" }));
  const res = await POST(req({ action: "verificar", slug: "empresa-test", legajo: 7 }));
  const json = await res.json();
  assert.equal(res.status, 409);
  assert.ok(json.error.includes("ya está activada"));
});

// ── 7. verificar success → 200 ──
test("unirse — verificar devuelve nombre, apodo, empresaNombre", async () => {
  const res = await POST(req({ action: "verificar", slug: "empresa-test", legajo: 7 }));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.nombre, "Juan Perez");
  assert.equal(json.apodo, "Juancho");
  assert.equal(json.empresaNombre, "EmpTest");
});

// ── 8. activar with weak password → 400 ──
test("unirse — activar con password débil devuelve 400", async () => {
  const res = await POST(req({ action: "activar", slug: "empresa-test", legajo: 7, password: "123" }));
  const json = await res.json();
  assert.equal(res.status, 400);
  assert.ok(json.error);
});

// ── 9. activar success → 200, verifica sbPatch con hash ──
test("unirse — activar con password válida devuelve 200 y actualiza con hash", async () => {
  const handlers = handlersBase();
  global.fetch = createFetchMock(handlers);
  const res = await POST(req({ action: "activar", slug: "empresa-test", legajo: 7, password: PASSWORD_OK }));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.nombre, "Juan Perez");
  assert.equal(json.empresaNombre, "EmpTest");

  const patch = handlers.getPatchCalled();
  assert.ok(patch, "sbPatch debe haber sido llamado");
  assert.equal(patch.estado_activacion, "activo");
  assert.equal(patch.debe_cambiar_password, false);
  // Verify the password was hashed (bcrypt hashes start with $2)
  assert.ok(patch.password.startsWith("$2"), "password debe estar hasheada con bcrypt");
  const match = await bcrypt.compare(PASSWORD_OK, patch.password);
  assert.ok(match, "el hash debe corresponder al password original");
});

// ── 10. Rate limit → 429 ──
test("unirse — rate limit devuelve 429", async () => {
  // Send 20 requests to exhaust the limit
  for (let i = 0; i < 20; i++) {
    await POST(req({ action: "verificar", slug: "empresa-test", legajo: 7 }));
  }
  // The 21st should be rate limited
  const res = await POST(req({ action: "verificar", slug: "empresa-test", legajo: 7 }));
  assert.equal(res.status, 429);
  const json = await res.json();
  assert.ok(json.error.includes("Demasiados intentos"));
  assert.ok(res.headers.get("Retry-After"));
});
