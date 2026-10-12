// tests/rls-rutas-documentos.test.js — RLS real en las rutas de documentos
// (ítem 37, etapa 2). Con RLS_RUTAS=on, las consultas a la base que reciben
// `{ sesion }` van con el pase del usuario (rol authenticated + claim eid) en
// vez de la llave service_role. Storage sigue con service_role.
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
const { sbGet, sbPost, sbDelete } = await import("../app/lib/sbHelpers.js");
const upload = await import("../app/api/documentos/upload/route.js");
const misDocumentos = await import("../app/api/documentos/mis-documentos/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";
const TIPO_DOC_ID = "55555555-5555-5555-5555-555555555555";
const SESION = { empresa_id: EMPRESA_ID, empleado_id: EMPLEADO_ID, rol: "operativo" };

beforeEach(() => {
  process.env.SUPABASE_JWT_SECRET = SUPABASE_JWT_SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
});

afterEach(() => {
  delete process.env.RLS_RUTAS;
});

async function claimsDe(headers) {
  const pase = headers.Authorization.replace(/^Bearer /, "");
  const { payload } = await jwtVerify(pase, new TextEncoder().encode(SUPABASE_JWT_SECRET), { audience: "authenticated" });
  return payload;
}

// Guarda los headers de cada pedido a la base o a Storage.
function capturar(capturas, respuestas = {}) {
  return {
    match: (url) => url.includes("/rest/v1/documentos") || url.includes("/rest/v1/tipos_documento") || url.includes("/storage/v1/"),
    respond: (url, opts) => {
      capturas.push({ url, method: opts.method || "GET", headers: opts.headers });
      for (const [clave, r] of Object.entries(respuestas)) if (url.includes(clave)) return r(url, opts);
      return { status: 200, body: [] };
    },
  };
}

// ─── sbHelpers ──────────────────────────────────────────────────────────────

test("sbHelpers — RLS_RUTAS apagado: con sesión sigue con service_role", async () => {
  const capturas = [];
  global.fetch = createFetchMock([capturar(capturas)]);
  await sbGet("documentos_empleado?select=id", { sesion: SESION });
  assert.equal(capturas[0].headers.Authorization, "Bearer test-service-key");
});

test("sbHelpers — RLS_RUTAS prendido: con sesión va con el pase del usuario", async () => {
  process.env.RLS_RUTAS = "on";
  const capturas = [];
  global.fetch = createFetchMock([capturar(capturas)]);
  await sbGet("documentos_empleado?select=id", { sesion: SESION });
  await sbPost("documentos_empleado", { id: "x" }, { sesion: SESION });
  await sbDelete("documentos_empleado?id=eq.x", { sesion: SESION });
  for (const c of capturas) {
    assert.equal(c.headers.apikey, "test-anon-key", `${c.method} usa la anon key`);
    assert.notEqual(c.headers.Authorization, "Bearer test-service-key", `${c.method} no usa service_role`);
    const claims = await claimsDe(c.headers);
    assert.equal(claims.role, "authenticated");
    assert.equal(claims.eid, EMPRESA_ID);
  }
  assert.equal(capturas[1].headers.Prefer, "return=representation");
});

test("sbHelpers — RLS_RUTAS prendido: sin sesión sigue con service_role", async () => {
  process.env.RLS_RUTAS = "on";
  const capturas = [];
  global.fetch = createFetchMock([capturar(capturas)]);
  await sbGet("documentos_empleado?select=id");
  assert.equal(capturas[0].headers.Authorization, "Bearer test-service-key");
});

test("sbHelpers — RLS_RUTAS prendido sin SUPABASE_JWT_SECRET: corta sin consultar", async () => {
  process.env.RLS_RUTAS = "on";
  delete process.env.SUPABASE_JWT_SECRET;
  const capturas = [];
  global.fetch = createFetchMock([capturar(capturas)]);
  await assert.rejects(() => sbGet("documentos_empleado?select=id", { sesion: SESION }), /SUPABASE_JWT_SECRET/);
  assert.equal(await sbGet("documentos_empleado?select=id", { sesion: SESION, silent: true }), null);
  assert.equal(capturas.length, 0, "no vuelve en silencio a la llave maestra");
});

// ─── Rutas de documentos ────────────────────────────────────────────────────

async function tokenOperativo() {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol: "operativo" });
  return token;
}

test("documentos/upload con RLS_RUTAS=on — la base con el pase del usuario, Storage con service_role", async () => {
  process.env.RLS_RUTAS = "on";
  const capturas = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    capturar(capturas, {
      tipos_documento_requerido: () => ({ status: 200, body: [{ id: TIPO_DOC_ID, formatos_aceptados: ["pdf"], admite_multiples: false }] }),
      "documentos_empleado?empresa_id": () => ({ status: 200, body: [{ id: "viejo", storage_path: "a/b/c.pdf" }] }),
      "storage/v1/object/remove": () => ({ status: 200, body: [] }),
      "storage/v1/object/documentos-empleado/": () => ({ status: 200, body: { Key: "ok" } }),
      "documentos_empleado?id=in": () => ({ status: 204 }),
      "rest/v1/documentos_empleado": (url, opts) => ({ status: 201, body: [{ id: "doc-1", ...JSON.parse(opts.body) }] }),
    }),
  ]);
  const fd = new FormData();
  fd.set("file", new File([Buffer.from("%PDF-1.4")], "doc.pdf", { type: "application/pdf" }));
  fd.set("tipo_documento_id", TIPO_DOC_ID);
  const res = await upload.POST(new Request("http://localhost/api/documentos/upload", {
    method: "POST", headers: { Authorization: `Bearer ${await tokenOperativo()}` }, body: fd,
  }));
  assert.equal(res.status, 200);

  const base = capturas.filter((c) => c.url.includes("/rest/v1/"));
  const storage = capturas.filter((c) => c.url.includes("/storage/v1/"));
  assert.deepEqual(base.map((c) => c.method), ["GET", "GET", "DELETE", "POST"]);
  for (const c of base) assert.equal((await claimsDe(c.headers)).eid, EMPRESA_ID, `${c.method} ${c.url}`);
  assert.equal(storage.length, 2);
  for (const c of storage) assert.equal(c.headers.Authorization, "Bearer test-service-key");
});

test("documentos/mis-documentos con RLS_RUTAS=on — consulta con el pase del usuario", async () => {
  process.env.RLS_RUTAS = "on";
  const capturas = [];
  global.fetch = createFetchMock([...authPassHandlers(), capturar(capturas)]);
  const res = await misDocumentos.GET(new Request("http://localhost/api/documentos/mis-documentos", {
    headers: { Authorization: `Bearer ${await tokenOperativo()}` },
  }));
  assert.equal(res.status, 200);
  assert.equal(capturas.length, 2);
  for (const c of capturas) assert.equal((await claimsDe(c.headers)).eid, EMPRESA_ID);
});

// ─── Migración 094 ──────────────────────────────────────────────────────────

const SQL_094 = readFileSync(new URL("../supabase/migrations/094_rls_rutas_documentos.sql", import.meta.url), "utf8")
  .replace(/--.*$/gm, "")
  .toLowerCase();

test("094 — upload puede registrar y reemplazar documentos con el pase del usuario", () => {
  assert.match(SQL_094, /grant\s+select,\s*insert,\s*delete\s+on\s+public\.documentos_empleado\s+to\s+authenticated/);
});

test("094 — sin TRUNCATE, sin UPDATE, sin anon y sin transacción", () => {
  assert.ok(!SQL_094.includes("truncate"));
  assert.ok(!/grant[^;]*update/.test(SQL_094));
  assert.ok(!/to\s+anon/.test(SQL_094));
  assert.ok(SQL_094.includes("to_regclass"));
  assert.ok(!/^\s*begin;/m.test(SQL_094));
});
