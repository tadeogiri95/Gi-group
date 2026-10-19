// tests/rls-rutas-sync-ot.test.js — RLS real en la sincronización de OT
// (ítem 37, etapa 2). Con RLS_RUTAS=on, el botón Sincronizar (y el empleado
// que busca una OT) leen la config y suben las OT con el pase del usuario. El
// cron, que no tiene sesión y recorre todas las empresas, sigue con service_role.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { jwtVerify } from "jose";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

const SUPABASE_JWT_SECRET = "secreto_jwt_de_supabase_para_tests_123456";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/proyectos/sync-csv/route.js");
const { syncTodas } = await import("../app/lib/syncOt.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/x/pub?output=csv";

beforeEach(() => {
  process.env.SUPABASE_JWT_SECRET = SUPABASE_JWT_SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.RLS_RUTAS = "on";
});

afterEach(() => {
  delete process.env.RLS_RUTAS;
});

// Config, planilla y upsert; registra los headers de cada pedido a la base.
function mock(capturas) {
  return createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes("/rest/v1/config_sistema") || url.includes("/rest/v1/proyectos"),
      respond: (url, opts) => {
        capturas.push({ url, method: opts.method || "GET", headers: opts.headers });
        if (url.includes("config_sistema") && (opts.method || "GET") === "GET") {
          return { status: 200, body: [{ empresa_id: EMPRESA_ID, valor: { url: CSV_URL } }] };
        }
        return { status: 204 };
      },
    },
    { match: (url) => url === CSV_URL, respond: () => ({ status: 200, body: "OT,CLIENTE,OBRA\nM-1,Acme,Planta\nM-2,Beta,Taller\n" }) },
  ]);
}

async function eidDe(headers) {
  const pase = headers.Authorization.replace(/^Bearer /, "");
  const { payload } = await jwtVerify(pase, new TextEncoder().encode(SUPABASE_JWT_SECRET), { audience: "authenticated" });
  return payload.eid;
}

async function pedido(rol) {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return new Request("http://localhost/api/proyectos/sync-csv", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
}

test("sync de OT con RLS_RUTAS=on — config y upsert con el pase del usuario", async () => {
  const capturas = [];
  global.fetch = mock(capturas);
  const res = await POST(await pedido("gerencial"));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).procesados, 2);
  assert.deepEqual(capturas.map((c) => c.method), ["GET", "POST", "PATCH", "PATCH", "PATCH"]);
  for (const c of capturas) assert.equal(await eidDe(c.headers), EMPRESA_ID, `${c.method} ${c.url}`);
  assert.equal(capturas[1].headers.Prefer, "resolution=merge-duplicates,return=minimal");
});

test("sync de OT con RLS_RUTAS apagado — sigue con service_role", async () => {
  delete process.env.RLS_RUTAS;
  const capturas = [];
  global.fetch = mock(capturas);
  const res = await POST(await pedido("gerencial"));
  assert.equal(res.status, 200);
  for (const c of capturas) assert.equal(c.headers.Authorization, "Bearer test-service-key");
});

test("cron de OT con RLS_RUTAS=on — sigue con service_role (no tiene sesión)", async () => {
  const capturas = [];
  global.fetch = mock(capturas);
  const results = await syncTodas();
  assert.equal(results[0].procesados, 2);
  assert.ok(capturas.length >= 4);
  for (const c of capturas) assert.equal(c.headers.Authorization, "Bearer test-service-key");
});
