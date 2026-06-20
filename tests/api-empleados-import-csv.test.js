// tests/api-empleados-import-csv.test.js — Tests de POST /api/empleados/import-csv
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  if (!process.env.RESEND_API_KEY) process.env.RESEND_API_KEY = "re_test_fake_key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/empleados/import-csv/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

async function tokenConRol(rol) {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return token;
}

function csvReq(csvText, token, contentType = "text/plain") {
  const headers = { "Content-Type": contentType };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/empleados/import-csv", {
    method: "POST",
    headers,
    body: contentType.includes("json") ? JSON.stringify({ csv: csvText }) : csvText,
  });
}

/** Handlers base para la ruta de import CSV (auth + legajos existentes + plan + insert) */
function handlersImport({ existingLegajos = [], plan = "pro", insertOk = true } = {}) {
  return [
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/empleados") && url.includes("select=legajo") && !url.includes("method=POST"),
      respond: () => ({
        status: 200,
        body: existingLegajos.map((l) => ({ legajo: l })),
      }),
    },
    {
      match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=plan_activo"),
      respond: () => ({ status: 200, body: [{ plan_activo: plan }] }),
    },
    {
      // La ruta hace bulk insert (un POST con array de filas por lote de 50),
      // no un POST por fila — la respuesta debe tener tantos elementos como
      // filas vinieron en el body para que `created.length` sea correcto.
      match: (url, opts) => url.includes("/rest/v1/empleados") && opts?.method === "POST",
      respond: (url, opts) => {
        if (!insertOk) return { status: 409, body: { code: "23505", message: "duplicate key" } };
        const rows = JSON.parse(opts.body);
        return { status: 201, body: rows.map((r, i) => ({ id: `new-id-${i}`, legajo: r.legajo })) };
      },
    },
  ];
}

// ─── Auth ───

test("import-csv — sin token devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(csvReq("legajo,nombre\n1,Juan", null));
  assert.equal(res.status, 401);
});

test("import-csv — rol operativo devuelve 403", async () => {
  global.fetch = createFetchMock(handlersImport());
  const token = await tokenConRol("operativo");
  const res = await POST(csvReq("legajo,nombre\n1,Juan", token));
  assert.equal(res.status, 403);
});

// ─── Validation ───

test("import-csv — body vacío devuelve 400", async () => {
  global.fetch = createFetchMock(handlersImport());
  const token = await tokenConRol("gerencial");
  const res = await POST(csvReq("", token));
  assert.equal(res.status, 400);
});

test("import-csv — CSV sin columna legajo devuelve 400", async () => {
  global.fetch = createFetchMock(handlersImport());
  const token = await tokenConRol("gerencial");
  const res = await POST(csvReq("nombre,email\nJuan,j@x.com", token));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error.includes("legajo"));
});

// ─── Success ───

test("import-csv — CSV válido con 2 filas crea 2 empleados", async () => {
  global.fetch = createFetchMock(handlersImport());
  const token = await tokenConRol("administrativo");
  const csv = "legajo,nombre,email,rol\n100,Juan Pérez,juan@test.com,operativo\n200,María López,maria@test.com,gerencial";
  const res = await POST(csvReq(csv, token));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.created, 2);
  assert.equal(json.total_procesadas, 2);
});

// ─── Duplicates ───

test("import-csv — legajo existente se salta (skipped:1)", async () => {
  global.fetch = createFetchMock(handlersImport({ existingLegajos: [100] }));
  const token = await tokenConRol("gerencial");
  const csv = "legajo,nombre\n100,Juan\n200,María";
  const res = await POST(csvReq(csv, token));
  const json = await res.json();

  assert.equal(json.ok, true);
  assert.equal(json.skipped, 1);
  assert.equal(json.created, 1);
});

// ─── Plan quota ───

test("import-csv — límite de plan genera error en fila excedente", async () => {
  // free plan has max_empleados = 5, and we simulate 5 existing
  global.fetch = createFetchMock(handlersImport({ existingLegajos: [1, 2, 3, 4, 5], plan: "free" }));
  const token = await tokenConRol("gerencial");
  const csv = "legajo,nombre\n100,Nuevo Empleado";
  const res = await POST(csvReq(csv, token));
  const json = await res.json();

  assert.equal(json.ok, true);
  assert.equal(json.created, 0);
  assert.ok(json.errors.some((e) => e.includes("límite")), "debe indicar límite alcanzado");
});

// ─── Invalid data ───

test("import-csv — legajo inválido y nombre vacío generan errores por fila", async () => {
  global.fetch = createFetchMock(handlersImport());
  const token = await tokenConRol("gerencial");
  const csv = "legajo,nombre\nabc,Juan\n100,";
  const res = await POST(csvReq(csv, token));
  const json = await res.json();

  assert.equal(json.ok, true);
  assert.equal(json.created, 0);
  assert.ok(json.errors.some((e) => e.includes("legajo inválido")), "debe reportar legajo inválido");
  assert.ok(json.errors.some((e) => e.includes("nombre vacío")), "debe reportar nombre vacío");
});
