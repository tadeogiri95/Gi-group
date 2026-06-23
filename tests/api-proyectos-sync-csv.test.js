// tests/api-proyectos-sync-csv.test.js — Tests HTTP de POST /api/proyectos/sync-csv
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.CRON_SECRET = "test-cron-secret";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/proyectos/sync-csv/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";
const CSV_URL = "https://files.example.com/proyectos.csv";

async function tokenConRol(rol) {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return token;
}

function jwtReq(tok) {
  const headers = {};
  if (tok) headers.Authorization = `Bearer ${tok}`;
  return new Request("http://localhost/api/proyectos/sync-csv", { method: "POST", headers });
}

function cronReq(secret) {
  const headers = {};
  if (secret) headers["x-cron-secret"] = secret;
  return new Request("http://localhost/api/proyectos/sync-csv", { method: "POST", headers });
}

function configHandler(url, empresaId = EMPRESA_ID) {
  return {
    match: (u, o) => u.includes("/rest/v1/config_sistema") && u.includes(`empresa_id=eq.${empresaId}`) && u.includes("clave=eq.proyectos_csv_url") && (!o?.method || o.method === "GET"),
    respond: () => ({ status: 200, body: url ? [{ valor: { url } }] : [] }),
  };
}

const CSV_TEXTO = "ot,cliente,obra,proyecto,division\nOT-1,ClienteA,ObraA,ProyA,div1\nOT-2,ClienteB,ObraB,ProyB,div2";

function csvHandler(texto = CSV_TEXTO) {
  return { match: (u) => u === CSV_URL, respond: () => ({ status: 200, body: texto }) };
}

function upsertHandler() {
  return { match: (u, o) => u.includes("/rest/v1/proyectos?on_conflict=") && o?.method === "POST", respond: () => ({ status: 200, body: null }) };
}

function patchConfigHandler() {
  return { match: (u, o) => u.includes("/rest/v1/config_sistema") && o?.method === "PATCH", respond: () => ({ status: 200, body: null }) };
}

test("sync-csv — sin cron-secret y sin JWT devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(jwtReq(null));
  assert.equal(res.status, 401);
});

test("sync-csv — cron-secret incorrecto devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await POST(cronReq("secreto-equivocado"));
  assert.equal(res.status, 401);
});

test("sync-csv — rol operativo devuelve 403", async () => {
  global.fetch = createFetchMock(authPassHandlers());
  const tok = await tokenConRol("operativo");
  const res = await POST(jwtReq(tok));
  assert.equal(res.status, 403);
});

test("sync-csv — sin URL de CSV configurada devuelve 500", async () => {
  global.fetch = createFetchMock([...authPassHandlers(), configHandler(null)]);
  const tok = await tokenConRol("gerencial");
  const res = await POST(jwtReq(tok));
  assert.equal(res.status, 500);
});

test("sync-csv — URL apuntando a red privada se rechaza (SSRF) y devuelve 500", async () => {
  global.fetch = createFetchMock([...authPassHandlers(), configHandler("https://192.168.1.50/data.csv")]);
  const tok = await tokenConRol("gerencial");
  const res = await POST(jwtReq(tok));
  assert.equal(res.status, 500);
});

test("sync-csv — éxito vía JWT sincroniza solo la empresa del token", async () => {
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    configHandler(CSV_URL),
    csvHandler(),
    upsertHandler(),
    patchConfigHandler(),
  ]);
  const tok = await tokenConRol("gerencial");
  const res = await POST(jwtReq(tok));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.procesados, 2);
  assert.equal(json.total, 2);
});

test("sync-csv — modo cron sincroniza todas las empresas configuradas y tolera errores individuales", async () => {
  const OTRA_EMPRESA = "33333333-3333-3333-3333-333333333333";
  const OTRA_URL = "https://files.example.com/otra.csv";
  global.fetch = createFetchMock([
    { match: (u) => u.includes("/rest/v1/config_sistema") && u.includes("limit=500"), respond: () => ({ status: 200, body: [{ empresa_id: EMPRESA_ID, valor: { url: CSV_URL } }, { empresa_id: OTRA_EMPRESA, valor: { url: OTRA_URL } }] }) },
    // syncEmpresa() vuelve a consultar config_sistema por su cuenta (no reusa
    // `row.valor` del listado de arriba) — cada empresa necesita su propio handler.
    configHandler(CSV_URL, EMPRESA_ID),
    configHandler(OTRA_URL, OTRA_EMPRESA),
    patchConfigHandler(),
    csvHandler(),
    { match: (u) => u === OTRA_URL, respond: () => { throw new Error("404 not found"); } },
    upsertHandler(),
  ]);
  const res = await POST(cronReq("test-cron-secret"));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.results.length, 2);
  const ok1 = json.results.find((r) => r.empresa_id === EMPRESA_ID);
  const errOtra = json.results.find((r) => r.empresa_id === OTRA_EMPRESA);
  assert.equal(ok1.procesados, 2);
  assert.ok(errOtra.error, "la empresa con CSV inalcanzable debe reportar error sin frenar a las demás");
});
