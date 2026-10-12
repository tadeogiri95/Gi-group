// tests/rls-vistas.test.js — RLS en las vistas de resumen (ítem 37, etapa 3).
// Con RLS_API_DATA=on y RLS_RUTAS=on, /api/data lee v_resumen_diario y
// v_scores_empleados con el pase del usuario: desde la migración 096 las
// vistas son security_invoker y aplican la RLS de sus tablas.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jwtVerify } from "jose";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

const SUPABASE_JWT_SECRET = "secreto_jwt_de_supabase_para_tests_123456";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/data/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";
const VISTAS = ["v_resumen_diario", "v_scores_empleados"];

beforeEach(() => {
  process.env.SUPABASE_JWT_SECRET = SUPABASE_JWT_SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
});

afterEach(() => {
  delete process.env.RLS_API_DATA;
  delete process.env.RLS_RUTAS;
});

async function token() {
  const { token: t } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol: "gerencial" });
  return t;
}

async function consultarVista(vista) {
  const captura = {};
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url) => url.includes(`/rest/v1/${vista}`), respond: (url, opts) => { captura.url = url; captura.headers = opts.headers; return { status: 200, body: [] }; } },
  ]);
  const res = await POST(new Request("http://localhost/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ method: "GET", path: `${vista}?select=*` }),
  }));
  return { res, captura };
}

for (const vista of VISTAS) {
  test(`${vista} con RLS_API_DATA=on y RLS_RUTAS=on — va con el pase del usuario`, async () => {
    process.env.RLS_API_DATA = "on";
    process.env.RLS_RUTAS = "on";
    const { res, captura } = await consultarVista(vista);
    assert.equal(res.status, 200);
    const pase = captura.headers.Authorization.replace(/^Bearer /, "");
    const { payload } = await jwtVerify(pase, new TextEncoder().encode(SUPABASE_JWT_SECRET), { audience: "authenticated" });
    assert.equal(payload.eid, EMPRESA_ID);
    assert.ok(captura.url.includes(`empresa_id=eq.${EMPRESA_ID}`), "el gateway sigue filtrando por empresa");
  });

  test(`${vista} con RLS_RUTAS=on pero RLS_API_DATA apagado — sigue con service_role`, async () => {
    process.env.RLS_RUTAS = "on";
    const { res, captura } = await consultarVista(vista);
    assert.equal(res.status, 200);
    assert.equal(captura.headers.Authorization, "Bearer test-service-key");
  });
}

// ─── Migración 096 ──────────────────────────────────────────────────────────

const SQL_096 = readFileSync(new URL("../supabase/migrations/096_rls_vistas_resumen.sql", import.meta.url), "utf8")
  .replace(/--.*$/gm, "")
  .toLowerCase();

test("096 — las dos vistas quedan security_invoker", () => {
  assert.match(SQL_096, /create or replace view public\.v_resumen_diario\s+with \(security_invoker = true\)/);
  assert.match(SQL_096, /alter view public\.v_scores_empleados set \(security_invoker = true\)/);
});

test("096 — v_resumen_diario une fichadas por legajo Y empresa", () => {
  assert.match(SQL_096, /left join public\.fichadas f on \(\(\(f\.legajo = e\.legajo\) and \(f\.empresa_id = e\.empresa_id\)/);
});

test("096 — solo SELECT para authenticated, sin anon y sin transacción", () => {
  assert.match(SQL_096, /grant select on public\.v_resumen_diario to authenticated/);
  assert.ok(!/to\s+anon/.test(SQL_096));
  assert.ok(!/grant\s+(insert|update|delete|all|truncate)/.test(SQL_096));
  assert.ok(!/^\s*begin;/m.test(SQL_096));
});
