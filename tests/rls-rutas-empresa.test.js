// tests/rls-rutas-empresa.test.js — RLS real en los datos de la empresa
// (ítem 37, etapa 2). Con RLS_RUTAS=on, /api/empresa (GET con sesión y PATCH)
// y /api/upload-logo leen y guardan la fila de la empresa con el pase del
// usuario. El GET por slug (sin sesión) y Storage siguen con service_role.
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
const empresa = await import("../app/api/empresa/route.js");
const uploadLogo = await import("../app/api/upload-logo/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  process.env.SUPABASE_JWT_SECRET = SUPABASE_JWT_SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.RLS_RUTAS = "on";
});

afterEach(() => {
  delete process.env.RLS_RUTAS;
});

async function token(rol = "gerencial") {
  const { token: t } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return t;
}

async function eidDe(headers) {
  const pase = headers.Authorization.replace(/^Bearer /, "");
  const { payload } = await jwtVerify(pase, new TextEncoder().encode(SUPABASE_JWT_SECRET), { audience: "authenticated" });
  return payload.eid;
}

const esServiceRole = (h) => h.Authorization === "Bearer test-service-key";

// Pedidos a la fila de la empresa y a Storage (sin los chequeos de auth).
function capturar(capturas) {
  return {
    match: (url) => (url.includes("/rest/v1/empresa?") && !url.includes("email_verificado")) || url.includes("/storage/v1/"),
    respond: (url, opts) => {
      capturas.push({ url, method: opts.method || "GET", headers: opts.headers });
      if (url.includes("/storage/v1/")) return { status: 200, body: { Key: "ok" } };
      return { status: 200, body: [{ id: EMPRESA_ID, nombre: "Acme", slug: "acme", activa: true, plan_activo: "pro" }] };
    },
  };
}

test("empresa GET con sesión y RLS_RUTAS=on — lee con el pase del usuario", async () => {
  const capturas = [];
  global.fetch = createFetchMock([...authPassHandlers(), capturar(capturas)]);
  const res = await empresa.GET(new Request("http://localhost/api/empresa", { headers: { Authorization: `Bearer ${await token()}` } }));
  assert.equal(res.status, 200);
  const filas = capturas.filter((c) => c.url.includes(`id=eq.${EMPRESA_ID}`) && c.url.includes("admin_email"));
  assert.equal(filas.length, 1);
  assert.equal(await eidDe(filas[0].headers), EMPRESA_ID);
});

test("empresa GET por slug (sin sesión) — sigue con service_role", async () => {
  const capturas = [];
  global.fetch = createFetchMock([capturar(capturas)]);
  const res = await empresa.GET(new Request("http://localhost/api/empresa?slug=acme"));
  assert.equal(res.status, 200);
  assert.equal(capturas.length, 1);
  assert.ok(esServiceRole(capturas[0].headers));
});

test("empresa PATCH con RLS_RUTAS=on — guarda con el pase del usuario", async () => {
  const capturas = [];
  global.fetch = createFetchMock([...authPassHandlers(), capturar(capturas)]);
  const res = await empresa.PATCH(new Request("http://localhost/api/empresa", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ nombre: "Acme SA" }),
  }));
  assert.equal(res.status, 200);
  const patch = capturas.filter((c) => c.method === "PATCH");
  assert.equal(patch.length, 1);
  assert.equal(await eidDe(patch[0].headers), EMPRESA_ID);
  assert.equal(patch[0].headers.Prefer, "return=representation");
});

test("empresa PATCH con RLS_RUTAS apagado — sigue con service_role", async () => {
  delete process.env.RLS_RUTAS;
  const capturas = [];
  global.fetch = createFetchMock([...authPassHandlers(), capturar(capturas)]);
  await empresa.PATCH(new Request("http://localhost/api/empresa", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ nombre: "Acme SA" }),
  }));
  const patch = capturas.filter((c) => c.method === "PATCH");
  assert.equal(patch.length, 1);
  assert.ok(esServiceRole(patch[0].headers));
});

test("upload-logo con RLS_RUTAS=on — el archivo con service_role, la fila con el pase del usuario", async () => {
  const capturas = [];
  global.fetch = createFetchMock([...authPassHandlers(), capturar(capturas)]);
  const fd = new FormData();
  fd.set("file", new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "logo.png", { type: "image/png" }));
  const res = await uploadLogo.POST(new Request("http://localhost/api/upload-logo", {
    method: "POST", headers: { Authorization: `Bearer ${await token()}` }, body: fd,
  }));
  assert.equal(res.status, 200);
  const storage = capturas.filter((c) => c.url.includes("/storage/v1/"));
  const fila = capturas.filter((c) => c.method === "PATCH");
  assert.equal(storage.length, 1);
  assert.ok(esServiceRole(storage[0].headers));
  assert.equal(fila.length, 1);
  assert.equal(await eidDe(fila[0].headers), EMPRESA_ID);
});

// ─── Migraciones 093 + 095: cada campo editable tiene UPDATE ────────────────

const sinComentarios = (f) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8").replace(/--.*$/gm, "");
const SQL_093 = sinComentarios("093_permisos_api_data.sql");
const SQL_095 = sinComentarios("095_rls_rutas_empresa.sql");

test("093 + 095 — authenticated puede actualizar cada campo que /api/empresa deja editar", () => {
  const ruta = readFileSync(new URL("../app/api/empresa/route.js", import.meta.url), "utf8");
  const editables = [...ruta.match(/const CAMPOS_EDITABLES = \[([\s\S]*?)\];/)[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(editables.length >= 10);
  const columnas093 = SQL_093.match(/grant update \(([^)]+)\) on public\.empresa/)[1].split(",").map((c) => c.trim());
  const columnas095 = [...SQL_095.match(/array\[([^\]]+)\]/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  const conPermiso = new Set([...columnas093, ...columnas095]);
  for (const campo of editables) assert.ok(conPermiso.has(campo), `falta UPDATE en empresa.${campo}`);
});

test("095 — solo UPDATE por columna, sin anon, sin TRUNCATE y sin transacción", () => {
  const sql = SQL_095.toLowerCase();
  assert.match(sql, /grant update \(%i\) on public\.empresa to authenticated/);
  assert.ok(!/to\s+anon/.test(sql));
  assert.ok(!sql.includes("truncate"));
  assert.ok(!/grant\s+(select|insert|delete)/.test(sql));
  assert.ok(!/^\s*begin;/m.test(sql));
});
