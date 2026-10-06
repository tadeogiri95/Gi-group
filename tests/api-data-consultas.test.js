// tests/api-data-consultas.test.js — /api/data: columnas sensibles, datos
// relacionados (embebidos de PostgREST) y referencias entre empresas
// (auditoría F2-02).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/data/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";
const AJENO_ID = "99999999-9999-9999-9999-999999999999";

async function token(rol = "gerencial") {
  const { token: t } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return t;
}

function req(body, t) {
  return new Request("http://localhost/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    body: JSON.stringify(body),
  });
}

function mockOk(extra = []) {
  const llamadas = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url) => url.includes("/rest/v1/empresa?id=eq.") && url.includes("select=plan_activo"), respond: () => ({ status: 200, body: [{ plan_activo: "pro" }] }) },
    ...extra,
    {
      match: (url) => url.includes("/rest/v1/"),
      respond: (url, opts) => { llamadas.push({ url: decodeURIComponent(url), method: opts?.method || "GET" }); return { status: 200, body: [{ id: 1 }] }; },
    },
  ]);
  return llamadas;
}

// ─── Columnas sensibles ───

test("no se pueden traer contraseñas a través de datos relacionados", async () => {
  const llamadas = mockOk();
  const res = await POST(req({ method: "GET", path: "fichadas?select=*,empleados(password)" }, await token()));
  assert.equal(res.status, 403);
  assert.equal(llamadas.length, 0, "no debe llegar a Supabase");
});

test("no se puede filtrar ni ordenar por columnas sensibles (evita deducir hashes)", async () => {
  mockOk();
  const t = await token();
  for (const path of ["empleados?password=like.$2a*", "empleados?or=(password.like.a*,id.eq.1)", "empleados?order=password.asc", "empresa?select=admin_password"]) {
    const res = await POST(req({ method: "GET", path }, t));
    assert.equal(res.status, 403, path);
  }
});

test("no se puede buscar por hash de código de activación ni recibirlo en la respuesta", async () => {
  const t = await token();
  mockOk();
  const res = await POST(req({ method: "GET", path: "empleados?activacion_codigo_hash=eq.abc" }, t));
  assert.equal(res.status, 403);

  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url) => url.includes("/rest/v1/empleados"), respond: () => ({ status: 200, body: [{ id: 1, nombre: "Ana", activacion_codigo_hash: "abc", password: "x" }] }) },
  ]);
  const ok = await POST(req({ method: "GET", path: "empleados?select=*" }, t));
  const json = await ok.json();
  assert.equal(ok.status, 200);
  const fila = (json.data ?? json)[0];
  assert.equal(fila.nombre, "Ana");
  assert.equal(fila.activacion_codigo_hash, undefined);
  assert.equal(fila.password, undefined);
});

test("la codificación URL no saltea el control", async () => {
  mockOk();
  const res = await POST(req({ method: "GET", path: "fichadas?select=%2A%2Cempleados%28password%29" }, await token()));
  assert.equal(res.status, 403);
});

// ─── Datos relacionados ───

test("solo se permiten los datos relacionados que usa la app", async () => {
  const llamadas = mockOk();
  const t = await token();
  const ok = await POST(req({ method: "GET", path: "fichadas?select=legajo,ingreso,empleados(nombre,division)&fecha=eq.2026-10-06" }, t));
  assert.equal(ok.status, 200);
  assert.equal(llamadas.length, 1);
  const otros = [
    "fichadas?select=*,empleados(email)",
    "empleados?select=*,empresa(nombre)",
    "solicitudes?select=*,empleados(nombre)",
    "fichadas?select=*,empleados!inner(nombre)",
    "fichadas?select=*,empleados(nombre)&empleados.division=eq.prod",
  ];
  for (const path of otros) {
    const res = await POST(req({ method: "GET", path }, t));
    assert.equal(res.status, 403, path);
  }
});

test("los filtros normales siguen funcionando (in, or, order)", async () => {
  mockOk();
  const res = await POST(req({ method: "GET", path: "solicitudes?tipo=in.(permiso,vacaciones)&or=(estado.eq.pendiente,estado.eq.aprobado)&order=created_at.desc" }, await token()));
  assert.equal(res.status, 200);
});

// ─── Referencias entre empresas ───

test("no se puede asignar un turno a un empleado de otra empresa", async () => {
  const llamadas = mockOk([
    { match: (url) => url.includes(`/rest/v1/empleados?id=eq.${AJENO_ID}`) && url.includes(`empresa_id=eq.${EMPRESA_ID}`), respond: () => ({ status: 200, body: [] }) },
  ]);
  const res = await POST(req({ method: "POST", path: "turnos_planificados", body: { empleado_id: AJENO_ID, fecha: "2026-10-07", hora_inicio: "07:00", hora_fin: "16:00" } }, await token()));
  assert.equal(res.status, 400);
  assert.ok(!llamadas.some((l) => l.url.includes("/rest/v1/turnos_planificados")), "no debe insertar");
});

test("asignar un turno a un empleado de la misma empresa funciona", async () => {
  const llamadas = mockOk([
    { match: (url) => url.includes("/rest/v1/empleados?id=eq.") && url.includes(`empresa_id=eq.${EMPRESA_ID}`), respond: () => ({ status: 200, body: [{ id: "propio" }] }) },
  ]);
  const res = await POST(req({ method: "POST", path: "turnos_planificados", body: { empleado_id: "33333333-3333-3333-3333-333333333333", fecha: "2026-10-07", hora_inicio: "07:00", hora_fin: "16:00" } }, await token()));
  assert.equal(res.status, 200);
  assert.ok(llamadas.some((l) => l.url.includes("/rest/v1/turnos_planificados") && l.method === "POST"));
});

test("no se puede exigir un tipo de documento de otra empresa", async () => {
  mockOk([
    { match: (url) => url.includes("/rest/v1/empleados?id=eq.") && url.includes("select=id&limit=1"), respond: () => ({ status: 200, body: [{ id: "propio" }] }) },
    { match: (url) => url.includes("/rest/v1/tipos_documento_requerido?id=eq."), respond: () => ({ status: 200, body: [] }) },
  ]);
  const res = await POST(req({ method: "POST", path: "documentos_exigidos_empleado", body: { empleado_id: "33333333-3333-3333-3333-333333333333", tipo_documento_id: AJENO_ID } }, await token()));
  assert.equal(res.status, 400);
});
