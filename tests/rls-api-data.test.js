// tests/rls-api-data.test.js — RLS real en /api/data (ítem 37, primera etapa)
// Con RLS_API_DATA=on la consulta principal va con un pase de Supabase por
// usuario (rol authenticated + claim eid) en vez de la llave service_role.
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jwtVerify } from "jose";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

const SUPABASE_JWT_SECRET = "secreto_jwt_de_supabase_para_tests_123456";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/data/route.js");
const { POLICY } = await import("../app/lib/dataPolicy.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

async function tokenValido() {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol: "gerencial" });
  return token;
}

function req(body, token) {
  return new Request("http://localhost/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

// Captura los headers con los que se pidió la tabla de la consulta principal.
function mockTabla(tabla, captura) {
  return createFetchMock([
    ...authPassHandlers(),
    {
      match: (url) => url.includes(`/rest/v1/${tabla}`),
      respond: (url, opts) => { captura.headers = opts.headers; return { status: 200, body: [{ id: "x" }] }; },
    },
  ]);
}

beforeEach(() => {
  process.env.SUPABASE_JWT_SECRET = SUPABASE_JWT_SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
});

afterEach(() => {
  delete process.env.RLS_API_DATA;
});

test("RLS apagado — la consulta sigue con service_role", async () => {
  const captura = {};
  global.fetch = mockTabla("empleados", captura);
  const res = await POST(req({ method: "GET", path: "empleados?select=id" }, await tokenValido()));
  assert.equal(res.status, 200);
  assert.equal(captura.headers.apikey, "test-service-key");
  assert.equal(captura.headers.Authorization, "Bearer test-service-key");
});

test("RLS prendido — la consulta va con el pase del usuario, no con service_role", async () => {
  process.env.RLS_API_DATA = "on";
  const captura = {};
  global.fetch = mockTabla("empleados", captura);
  const res = await POST(req({ method: "GET", path: "empleados?select=id" }, await tokenValido()));
  assert.equal(res.status, 200);
  assert.equal(captura.headers.apikey, "test-anon-key");
  assert.notEqual(captura.headers.Authorization, "Bearer test-service-key");

  const pase = captura.headers.Authorization.replace("Bearer ", "");
  const { payload } = await jwtVerify(pase, new TextEncoder().encode(SUPABASE_JWT_SECRET), { audience: "authenticated" });
  assert.equal(payload.role, "authenticated");
  assert.equal(payload.eid, EMPRESA_ID, "el claim eid sale de la sesión");
  assert.equal(payload.sub, EMPLEADO_ID);
  assert.ok(payload.exp - payload.iat <= 300, "el pase dura 5 minutos como máximo");
});

test("RLS prendido — también en escrituras", async () => {
  process.env.RLS_API_DATA = "on";
  const captura = {};
  global.fetch = mockTabla("empleados", captura);
  const res = await POST(req({ method: "PATCH", path: "empleados?id=eq.x", body: { nombre: "Ana" } }, await tokenValido()));
  assert.equal(res.status, 200);
  assert.equal(captura.headers.apikey, "test-anon-key");
});

test("RLS prendido sin RLS_RUTAS — las vistas de resumen siguen con service_role", async () => {
  process.env.RLS_API_DATA = "on";
  const captura = {};
  global.fetch = mockTabla("v_resumen_diario", captura);
  const res = await POST(req({ method: "GET", path: "v_resumen_diario?select=*" }, await tokenValido()));
  assert.equal(res.status, 200);
  assert.equal(captura.headers.apikey, "test-service-key");
});

test("RLS prendido sin SUPABASE_JWT_SECRET — corta con 500 y no consulta datos", async () => {
  process.env.RLS_API_DATA = "on";
  delete process.env.SUPABASE_JWT_SECRET;
  const captura = {};
  global.fetch = mockTabla("empleados", captura);
  const res = await POST(req({ method: "GET", path: "empleados?select=id" }, await tokenValido()));
  assert.equal(res.status, 500);
  assert.equal(captura.headers, undefined, "no debe volver en silencio a la llave maestra");
});

// ─── Migración 089: los permisos de authenticated acompañan a POLICY ────────
const SQL = readFileSync(new URL("../supabase/migrations/089_rls_api_data.sql", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").toLowerCase();

function permisosDe(tabla) {
  const re = new RegExp(`grant ([a-z, ]+?)\\s+on public\\.${tabla}\\s+to authenticated`);
  const m = SQL.match(re);
  return m ? m[1].split(",").map((s) => s.trim()) : [];
}

const SIN_RLS = ["v_resumen_diario", "v_scores_empleados", "plantas", "empresa"];
// Tablas con permisos en su propia migración (también los usa una ruta propia):
// avance_etapas → 100 (/api/avance escribe con el pase del usuario)
// no_conformidades → 101 (/api/no-conformidades, igual)
// sueltos_ot → 103 (/api/sueltos, igual)
// bultos_ot, cargas_ot → 104 (/api/carga, igual)
// actas_ot, pendientes_obra → 105 (/api/acta, igual)
// articulos_stock → 106 (la escribe /api/stock/sync con el pase del usuario)
// movimientos_stock → 107 (/api/stock/movimientos, igual)
// necesidades_stock → 108 (la sincronización de la planilla, igual)
// piezas_ot → 109 (/api/piezas, igual)
// pasos_pieza → 110 (/api/piezas/paso, igual)
// v_avance_piezas → 118 (vista security_invoker de piezas_ot y pasos_pieza)
// proveedores, pedidos_compra → 113 (/api/compras, igual)
// ordenes_compra, ordenes_compra_items → 114 (/api/compras, igual)
// recepciones_compra, recepciones_compra_items → 115 (/api/compras, igual)
// pedidos_compra_cambios → 121 (/api/compras, igual)
const MIGRACION_PROPIA = ["avance_etapas", "no_conformidades", "sueltos_ot", "bultos_ot", "cargas_ot", "actas_ot", "pendientes_obra", "articulos_stock", "movimientos_stock", "necesidades_stock", "piezas_ot", "pasos_pieza", "v_avance_piezas", "proveedores", "pedidos_compra", "ordenes_compra", "ordenes_compra_items", "recepciones_compra", "recepciones_compra_items", "pedidos_compra_cambios"];
const PRIVILEGIO = { GET: "select", POST: "insert", PATCH: "update", DELETE: "delete" };

test("089 — cada tabla del gateway tiene exactamente los permisos que usa", () => {
  for (const [tabla, reglas] of Object.entries(POLICY)) {
    if (SIN_RLS.includes(tabla) || MIGRACION_PROPIA.includes(tabla)) continue;
    const esperados = Object.keys(PRIVILEGIO).filter((m) => reglas[m]).map((m) => PRIVILEGIO[m]).sort();
    assert.deepEqual(permisosDe(tabla).sort(), esperados, `permisos de ${tabla}`);
  }
});

test("089 — sin TRUNCATE ni permisos para anon", () => {
  assert.ok(!SQL.includes("truncate"));
  assert.ok(!/to\s+anon/.test(SQL));
});

// ─── Migración 093: el arreglo de permisos que se corrió a mano ─────────────
// Misma lista que la 089, en un bloque que no se deshace si falta algo.
const SQL_093 = readFileSync(new URL("../supabase/migrations/093_permisos_api_data.sql", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").toLowerCase();

function permisos093(tabla) {
  const m = SQL_093.match(new RegExp(`\\('${tabla}', '([a-z, ]+)'\\)`));
  return m ? m[1].split(",").map((s) => s.trim()) : [];
}

test("093 — mismos permisos que la 089 para cada tabla del gateway", () => {
  for (const [tabla, reglas] of Object.entries(POLICY)) {
    if (SIN_RLS.includes(tabla) || MIGRACION_PROPIA.includes(tabla)) continue;
    const esperados = Object.keys(PRIVILEGIO).filter((m) => reglas[m]).map((m) => PRIVILEGIO[m]).sort();
    assert.deepEqual(permisos093(tabla).sort(), esperados, `permisos de ${tabla} en la 093`);
  }
});

test("093 — sin TRUNCATE, sin anon y tolerante a tablas que falten", () => {
  assert.ok(!SQL_093.includes("truncate"));
  assert.ok(!/to\s+anon/.test(SQL_093));
  assert.ok(SQL_093.includes("to_regclass"));
  assert.ok(!/^\s*begin;/m.test(SQL_093), "no va en una transacción que se deshaga entera");
});
