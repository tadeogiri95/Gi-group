// tests/rls-chequeos-internos.test.js — RLS en los chequeos internos (ítem 37,
// etapa 3). Con RLS_API_DATA=on, el chequeo de REFERENCIAS de /api/data va con
// el pase del usuario (menos `plantas`, que sigue con service_role). Con
// RLS_RUTAS=on, el alcance de un supervisor (lib/alcance.js) se lee con el
// pase del usuario.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { jwtVerify } from "jose";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

const SUPABASE_JWT_SECRET = "secreto_jwt_de_supabase_para_tests_123456";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/data/route.js");
const { alcanceDe, _limpiarCacheAlcance } = await import("../app/lib/alcance.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";
const OTRO_EMPLEADO = "33333333-3333-3333-3333-333333333333";
const TIPO_DOC_ID = "55555555-5555-5555-5555-555555555555";
const SESION_SUPERVISOR = { empresa_id: EMPRESA_ID, empleado_id: EMPLEADO_ID, rol: "administrativo" };

beforeEach(() => {
  _limpiarCacheAlcance();
  process.env.SUPABASE_JWT_SECRET = SUPABASE_JWT_SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
});

afterEach(() => {
  delete process.env.RLS_API_DATA;
  delete process.env.RLS_RUTAS;
});

async function eidDe(headers) {
  const pase = headers.Authorization.replace(/^Bearer /, "");
  const { payload } = await jwtVerify(pase, new TextEncoder().encode(SUPABASE_JWT_SECRET), { audience: "authenticated" });
  return payload.eid;
}

const esServiceRole = (h) => h.Authorization === "Bearer test-service-key";

async function token(rol = "gerencial") {
  const { token: t } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return t;
}

function req(body, tok) {
  return new Request("http://localhost/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
    body: JSON.stringify(body),
  });
}

// Chequeos de referencia: GET con select=id&limit=1 sobre la tabla referida.
function referencias(capturas, filas = [{ id: "ok" }]) {
  return {
    match: (url) => /\/rest\/v1\/(empleados|tipos_documento_requerido|plantas)\?id=eq\..*select=id&limit=1/.test(url),
    respond: (url, opts) => {
      capturas.push({ tabla: url.match(/\/rest\/v1\/([a-z_]+)\?/)[1], headers: opts.headers });
      return { status: 200, body: filas };
    },
  };
}

const escritura = {
  match: (url) => url.includes("/rest/v1/documentos_exigidos_empleado"),
  respond: (url, opts) => ({ status: 201, body: [{ id: "nuevo", ...JSON.parse(opts.body) }] }),
};

const asignarDocumento = { method: "POST", path: "documentos_exigidos_empleado", body: { empleado_id: OTRO_EMPLEADO, tipo_documento_id: TIPO_DOC_ID } };

// ─── REFERENCIAS en /api/data ───────────────────────────────────────────────

test("REFERENCIAS con RLS_API_DATA=on — se chequean con el pase del usuario", async () => {
  process.env.RLS_API_DATA = "on";
  const capturas = [];
  global.fetch = createFetchMock([referencias(capturas), escritura, ...authPassHandlers()]);
  const res = await POST(req(asignarDocumento, await token()));
  assert.equal(res.status, 200);
  assert.deepEqual(capturas.map((c) => c.tabla).sort(), ["empleados", "tipos_documento_requerido"]);
  for (const c of capturas) assert.equal(await eidDe(c.headers), EMPRESA_ID, `${c.tabla} con el pase del usuario`);
});

test("REFERENCIAS con RLS_API_DATA=on — una referencia que la base no muestra se rechaza", async () => {
  process.env.RLS_API_DATA = "on";
  const capturas = [];
  global.fetch = createFetchMock([referencias(capturas, []), escritura, ...authPassHandlers()]);
  const res = await POST(req(asignarDocumento, await token()));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Referencia inválida/);
});

test("REFERENCIAS con RLS_API_DATA apagado — siguen con service_role", async () => {
  const capturas = [];
  global.fetch = createFetchMock([referencias(capturas), escritura, ...authPassHandlers()]);
  const res = await POST(req(asignarDocumento, await token()));
  assert.equal(res.status, 200);
  assert.equal(capturas.length, 2);
  for (const c of capturas) assert.ok(esServiceRole(c.headers), `${c.tabla} con service_role`);
});

// ─── Alcance de un supervisor (lib/alcance.js) ──────────────────────────────

function alcance(capturas) {
  return {
    match: (url) => url.includes("/rest/v1/empleados?"),
    respond: (url, opts) => {
      capturas.push({ url, headers: opts.headers });
      if (url.includes("solo_su_division")) return { status: 200, body: [{ id: EMPLEADO_ID, legajo: 7, division: "Taller", solo_su_division: true }] };
      return { status: 200, body: [{ id: OTRO_EMPLEADO, legajo: 8 }] };
    },
  };
}

test("alcance con RLS_RUTAS=on — lee al supervisor y a su división con el pase del usuario", async () => {
  process.env.RLS_RUTAS = "on";
  const capturas = [];
  global.fetch = createFetchMock([alcance(capturas)]);
  const a = await alcanceDe(SESION_SUPERVISOR);
  assert.equal(a.division, "Taller");
  assert.deepEqual(a.ids.sort(), [EMPLEADO_ID, OTRO_EMPLEADO].sort());
  assert.equal(capturas.length, 2);
  for (const c of capturas) assert.equal(await eidDe(c.headers), EMPRESA_ID);
});

test("alcance con RLS_RUTAS apagado — sigue con service_role", async () => {
  const capturas = [];
  global.fetch = createFetchMock([alcance(capturas)]);
  await alcanceDe(SESION_SUPERVISOR);
  assert.equal(capturas.length, 2);
  for (const c of capturas) assert.ok(esServiceRole(c.headers));
});

test("alcance con RLS_RUTAS=on sin SUPABASE_JWT_SECRET — corta sin consultar", async () => {
  process.env.RLS_RUTAS = "on";
  delete process.env.SUPABASE_JWT_SECRET;
  const capturas = [];
  global.fetch = createFetchMock([alcance(capturas)]);
  await assert.rejects(() => alcanceDe(SESION_SUPERVISOR), /SUPABASE_JWT_SECRET/);
  assert.equal(capturas.length, 0, "no vuelve en silencio a la llave maestra");
});
