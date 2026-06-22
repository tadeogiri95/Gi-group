// tests/api-proyectos-import-csv.test.js — Tests de POST /api/proyectos/import-csv
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/proyectos/import-csv/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

async function tokenConRol(rol) {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return token;
}

function csvReq(csvText, token) {
  const headers = { "Content-Type": "text/plain" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/proyectos/import-csv", { method: "POST", headers, body: csvText });
}

function handlersImport({ existingOts = [], insertOk = true, plan = "pro" } = {}) {
  return [
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=plan_activo"),
      respond: () => ({ status: 200, body: [{ plan_activo: plan }] }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/proyectos") && url.includes("select=ot") && opts?.method !== "POST",
      respond: () => ({ status: 200, body: existingOts.map((ot) => ({ ot })) }),
    },
    {
      match: (url, opts) => url.includes("/rest/v1/proyectos") && opts?.method === "POST",
      respond: (url, opts) => {
        if (!insertOk) return { status: 500, body: { message: "duplicate key value violates unique constraint \"proyectos_empresa_id_ot_key\"" } };
        const rows = JSON.parse(opts.body);
        return { status: 201, body: rows.map((r, i) => ({ id: `proy-${i}`, ...r })) };
      },
    },
  ];
}

test("proyectos/import-csv — sin token devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(csvReq("ot,cliente\n1,Acme", null));
  assert.equal(res.status, 401);
});

test("proyectos/import-csv — rol operativo devuelve 403", async () => {
  global.fetch = createFetchMock(handlersImport());
  const token = await tokenConRol("operativo");
  const res = await POST(csvReq("ot,cliente\n1,Acme", token));
  assert.equal(res.status, 403);
});

test("proyectos/import-csv — CSV sin columna ot devuelve 400", async () => {
  global.fetch = createFetchMock(handlersImport());
  const token = await tokenConRol("gerencial");
  const res = await POST(csvReq("cliente,obra\nAcme,Torre 1", token));
  assert.equal(res.status, 400);
});

test("proyectos/import-csv — CSV válido crea proyectos", async () => {
  global.fetch = createFetchMock(handlersImport());
  const token = await tokenConRol("administrativo");
  const res = await POST(csvReq("ot,cliente,obra\n100,Acme,Torre 1\n200,Acme,Torre 2", token));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.created, 2);
});

test("proyectos/import-csv — ot existente se salta", async () => {
  global.fetch = createFetchMock(handlersImport({ existingOts: ["100"] }));
  const token = await tokenConRol("gerencial");
  const res = await POST(csvReq("ot,cliente\n100,Acme\n200,Acme", token));
  const json = await res.json();
  assert.equal(json.created, 1);
  assert.equal(json.skipped, 1);
});

test("proyectos/import-csv — fallo de Postgres en el insert no expone el detalle interno en el error por fila", async () => {
  global.fetch = createFetchMock(handlersImport({ insertOk: false }));
  const token = await tokenConRol("gerencial");
  const res = await POST(csvReq("ot,cliente\n100,Acme", token));
  const json = await res.json();

  assert.equal(json.ok, true);
  assert.equal(json.created, 0);
  assert.ok(json.errors.length > 0, "debe reportar el lote como error");
  assert.ok(!json.errors[0].includes("unique constraint"), "no debe exponer el detalle interno de Postgres en el mensaje por fila");
});
