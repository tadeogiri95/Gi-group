// tests/api-reportes-liquidacion.test.js — Tests de GET /api/reportes/liquidacion
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { GET } = await import("../app/api/reportes/liquidacion/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";
const OTRA_EMPRESA_ID = "33333333-3333-3333-3333-333333333333";

async function tokenConRol(rol, empresaId = EMPRESA_ID) {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId, legajo: 7, rol });
  return token;
}

function liqReq(qs, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`http://localhost/api/reportes/liquidacion${qs}`, { headers });
}

// Plan de la empresa — getPlanEmpresa() en planEnforcement.js cachea por
// empresaId 5 min en memoria, así que cada escenario de plan distinto en
// este archivo usa su propio empresa_id para no pisarse con otro test.
function planHandler(plan) {
  return {
    match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=plan_activo"),
    respond: () => ({ status: 200, body: [{ plan_activo: plan, plan_vence: null }] }),
  };
}

function datosHandlers({ empleados = [], fichadas = [], solicitudes = [], capturadas } = {}) {
  return [
    {
      match: (url) => url.includes("/rest/v1/empleados"),
      respond: (url) => { capturadas?.push(url); return { status: 200, body: empleados }; },
    },
    {
      match: (url) => url.includes("/rest/v1/fichadas"),
      respond: (url) => { capturadas?.push(url); return { status: 200, body: fichadas }; },
    },
    {
      match: (url) => url.includes("/rest/v1/solicitudes"),
      respond: (url) => { capturadas?.push(url); return { status: 200, body: solicitudes }; },
    },
  ];
}

test("reportes/liquidacion — sin token devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(liqReq("?desde=2026-06-01&hasta=2026-06-30", null));
  assert.equal(res.status, 401);
});

test("reportes/liquidacion — rol operativo devuelve 403", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  const token = await tokenConRol("operativo");
  const res = await GET(liqReq("?desde=2026-06-01&hasta=2026-06-30", token));
  assert.equal(res.status, 403);
});

test("reportes/liquidacion — sin desde/hasta devuelve 400", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  const token = await tokenConRol("gerencial");
  const res = await GET(liqReq("", token));
  assert.equal(res.status, 400);
});

test("reportes/liquidacion — formato de fecha inválido devuelve 400", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  const token = await tokenConRol("administrativo");
  const res = await GET(liqReq("?desde=01-06-2026&hasta=2026-06-30", token));
  assert.equal(res.status, 400);
});

test("reportes/liquidacion — desde posterior a hasta devuelve 400", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  const token = await tokenConRol("gerencial");
  const res = await GET(liqReq("?desde=2026-06-30&hasta=2026-06-01", token));
  assert.equal(res.status, 400);
});

test("reportes/liquidacion — plan free sin módulo reportes devuelve 402", async () => {
  const empresaFree = "44444444-4444-4444-4444-444444444444";
  global.fetch = createFetchMock([...authPassHandlers(), planHandler("free")]);
  const token = await tokenConRol("gerencial", empresaFree);
  const res = await GET(liqReq("?desde=2026-06-01&hasta=2026-06-30", token));
  assert.equal(res.status, 402);
  const json = await res.json();
  assert.equal(json.upgrade_a, "starter");
  assert.equal(json.paywall, true);
});

test("reportes/liquidacion — usa el empresa_id del JWT e ignora el de query params", async () => {
  const empresaAislada = "55555555-5555-5555-5555-555555555555";
  const capturadas = [];
  global.fetch = createFetchMock([...authPassHandlers(), planHandler("pro"), ...datosHandlers({ capturadas })]);
  const token = await tokenConRol("gerencial", empresaAislada);
  const res = await GET(liqReq(`?desde=2026-06-01&hasta=2026-06-30&empresa_id=${OTRA_EMPRESA_ID}`, token));
  assert.equal(res.status, 200);
  assert.ok(capturadas.length === 3, "debe consultar empleados, fichadas y solicitudes");
  assert.ok(capturadas.every((u) => u.includes(`empresa_id=eq.${empresaAislada}`)), "todas las queries deben filtrar por el empresa_id del JWT");
  assert.ok(capturadas.every((u) => !u.includes(OTRA_EMPRESA_ID)), "ninguna query debe usar el empresa_id de query params");
});

test("reportes/liquidacion — agrega horas, tardanzas, horas extra y ausencias por empleado activo", async () => {
  const empresaAgg = "66666666-6666-6666-6666-666666666666";
  const empleados = [
    { legajo: 1, nombre: "Juan Pérez" },
    { legajo: 2, nombre: "Ana Gómez" },
  ];
  const fichadas = [
    { legajo: 1, horas_trabajadas: 8, llegada_tarde: true, minutos_tarde: 10, horas_extra: 1 },
    { legajo: 1, horas_trabajadas: 8, llegada_tarde: false, minutos_tarde: 0, horas_extra: 0 },
    { legajo: 1, horas_trabajadas: 7.5, llegada_tarde: true, minutos_tarde: 5, horas_extra: 0 },
    { legajo: 2, horas_trabajadas: 8, llegada_tarde: false, minutos_tarde: 0, horas_extra: 2 },
    // legajo 99 no está entre los empleados activos — debe ignorarse
    { legajo: 99, horas_trabajadas: 100, llegada_tarde: true, minutos_tarde: 999, horas_extra: 50 },
  ];
  const solicitudes = [
    { legajo: 1, tipo: "vacaciones", fecha: "2026-06-10" },
    { legajo: 2, tipo: "ausencia", fecha: "2026-06-12" },
  ];
  global.fetch = createFetchMock([...authPassHandlers(), planHandler("pro"), ...datosHandlers({ empleados, fichadas, solicitudes })]);
  const token = await tokenConRol("gerencial", empresaAgg);
  const res = await GET(liqReq("?desde=2026-06-01&hasta=2026-06-30", token));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.empleados.length, 2);

  const emp1 = json.empleados.find((e) => e.legajo === 1);
  assert.equal(emp1.nombre, "Juan Pérez");
  assert.equal(emp1.horas_trabajadas, 23.5);
  assert.equal(emp1.tardanzas, 2);
  assert.equal(emp1.minutos_tarde, 15);
  assert.equal(emp1.horas_extra, 1);
  assert.equal(emp1.dias_ausencia, 1);

  const emp2 = json.empleados.find((e) => e.legajo === 2);
  assert.equal(emp2.horas_trabajadas, 8);
  assert.equal(emp2.tardanzas, 0);
  assert.equal(emp2.horas_extra, 2);
  assert.equal(emp2.dias_ausencia, 1);
});

test("reportes/liquidacion — empleado activo sin fichadas ni solicitudes aparece con todo en cero", async () => {
  const empresaVacia = "77777777-7777-7777-7777-777777777777";
  const empleados = [{ legajo: 5, nombre: "Sin Actividad" }];
  global.fetch = createFetchMock([...authPassHandlers(), planHandler("pro"), ...datosHandlers({ empleados })]);
  const token = await tokenConRol("gerencial", empresaVacia);
  const res = await GET(liqReq("?desde=2026-06-01&hasta=2026-06-30", token));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json.empleados, [
    { legajo: 5, nombre: "Sin Actividad", horas_trabajadas: 0, tardanzas: 0, minutos_tarde: 0, horas_extra: 0, dias_ausencia: 0 },
  ]);
});
