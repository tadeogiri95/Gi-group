// tests/api-chat-query.test.js — Tests HTTP de /api/chat/query
// Valida auth, body schema, control de acceso por rol, rate limiting
// y ejecución de queries con mock de Supabase.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { _resetBuckets } = await import("../app/lib/rateLimitMemory.js");
const { POST } = await import("../app/api/chat/query/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

async function tokenConRol(rol) {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return token;
}

function req(body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/chat/query", {
    method: "POST", headers, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  _resetBuckets();
  global.fetch = createFetchMock(authPassHandlers());
});

// ─── 1. Auth ───────────────────────────────────────────────

test("POST /api/chat/query — sin token devuelve 401", async () => {
  const res = await POST(req({ query_type: "proyectos_hoy" }, null));
  assert.equal(res.status, 401);
});

// ─── 2. Validación de body ─────────────────────────────────

test("POST /api/chat/query — body sin query_type devuelve 400", async () => {
  const token = await tokenConRol("gerencial");
  const res = await POST(req({ params: {} }, token));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error);
});

// ─── 3. query_type desconocido ─────────────────────────────

test("POST /api/chat/query — query_type inexistente devuelve 400", async () => {
  const token = await tokenConRol("gerencial");
  const res = await POST(req({ query_type: "no_existe_este_tipo" }, token));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error);
});

// ─── 4. Operativo accede a query GERENCIAL_ONLY → 403 ─────

test("POST /api/chat/query — operativo no puede ejecutar fichadas_hoy (gerencial only)", async () => {
  const token = await tokenConRol("operativo");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url) => url.includes("/rest/v1/fichadas"), respond: () => ({ status: 200, body: [] }) },
    { match: (url) => url.includes("/rest/v1/empleados"), respond: () => ({ status: 200, body: [] }) },
  ]);
  const res = await POST(req({ query_type: "fichadas_hoy" }, token));
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.match(json.error, /gerencial/i);
});

// ─── 5. Operativo accede a query no restringida → 200 ─────

test("POST /api/chat/query — operativo puede ejecutar proyectos_hoy", async () => {
  const token = await tokenConRol("operativo");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/registro_actividades"),
      respond: () => ({ status: 200, body: [] }),
    },
  ]);
  const res = await POST(req({ query_type: "proyectos_hoy" }, token));
  assert.equal(res.status, 200);
});

// ─── 6. Gerencial accede a query restringida → 200 ────────

test("POST /api/chat/query — gerencial puede ejecutar fichadas_hoy", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/fichadas"),
      respond: () => ({ status: 200, body: [{ legajo: 7, ingreso: "08:00", egreso: "17:00", horas_trabajadas: 9, horas_extra: 0 }] }),
    },
    {
      match: (url) => url.includes("/rest/v1/empleados"),
      respond: () => ({ status: 200, body: [{ legajo: 7, nombre: "Ana Test" }] }),
    },
  ]);
  const res = await POST(req({ query_type: "fichadas_hoy" }, token));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.resultado);
  assert.ok(typeof json.resultado === "string");
});

// ─── 7. Rate limit → 429 ──────────────────────────────────

test("POST /api/chat/query — exceder rate limit devuelve 429", async () => {
  const token = await tokenConRol("gerencial");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/registro_actividades"),
      respond: () => ({ status: 200, body: [] }),
    },
  ]);

  // Disparar 30 requests para agotar el bucket
  for (let i = 0; i < 30; i++) {
    await POST(req({ query_type: "proyectos_hoy" }, token));
  }

  // La 31ra debe devolver 429
  const res = await POST(req({ query_type: "proyectos_hoy" }, token));
  assert.equal(res.status, 429);
  const json = await res.json();
  assert.ok(json.error);
});

// ─── 8. Query con datos → resultado es string ─────────────

test("POST /api/chat/query — proyectos_hoy con datos devuelve resultado string", async () => {
  const token = await tokenConRol("operativo");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/registro_actividades"),
      respond: () => ({
        status: 200,
        body: [
          { codigo_proyecto: "OT-1", empleado_id: "e1", legajo: 7, duracion_min: 60, etapa: 1, observaciones: null },
          { codigo_proyecto: "OT-1", empleado_id: "e2", legajo: 8, duracion_min: 45, etapa: 2, observaciones: null },
          { codigo_proyecto: "OT-2", empleado_id: "e1", legajo: 7, duracion_min: 30, etapa: 1, observaciones: null },
        ],
      }),
    },
  ]);

  const res = await POST(req({ query_type: "proyectos_hoy" }, token));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(typeof json.resultado === "string");
  assert.ok(json.resultado.includes("OT-1"));
  assert.ok(json.resultado.includes("OT-2"));
});

// ─── 9. Query sin datos → mensaje "no data" ───────────────

test("POST /api/chat/query — proyectos_hoy sin datos devuelve mensaje informativo", async () => {
  const token = await tokenConRol("operativo");
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/registro_actividades"),
      respond: () => ({ status: 200, body: [] }),
    },
  ]);

  const res = await POST(req({ query_type: "proyectos_hoy" }, token));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(typeof json.resultado === "string");
  assert.ok(json.resultado.toLowerCase().includes("no hay"));
});
