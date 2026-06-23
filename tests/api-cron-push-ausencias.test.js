// tests/api-cron-push-ausencias.test.js — Tests de GET /api/cron/push-ausencias
//
// El envío real de FCM no se cubre (requeriría mockear el SDK firebase-admin,
// sin precedente en este repo); sin FIREBASE_SERVICE_ACCOUNT configurado,
// getFirebaseApp() lanza y enviarPushGerencia devuelve 0 de forma controlada.
// Lo que se prueba es la lógica de negocio: auth, skip de fin de semana, y el
// conteo correcto de ausentes — que es independiente del envío de push.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.CRON_SECRET = "test-cron-secret";
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_B64;
});

const { GET } = await import("../app/api/cron/push-ausencias/route.ts");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "33333333-3333-3333-3333-333333333333";

function cronReq() {
  return new Request("http://localhost/api/cron/push-ausencias", { headers: { Authorization: "Bearer test-cron-secret" } });
}

// Lunes 2026-06-22 10:00 ART (UTC-3) — día hábil.
const LUNES = new Date("2026-06-22T13:00:00.000Z");
// Sábado 2026-06-20 10:00 ART — fin de semana.
const SABADO = new Date("2026-06-20T13:00:00.000Z");

function handlerEmpleadosConTurno(empleados) {
  return { match: (url) => url.includes("/rest/v1/empleados") && url.includes("diagrama=not.is.null"), respond: () => ({ status: 200, body: empleados }) };
}
function handlerFichadasHoy(fichados) {
  return { match: (url) => url.includes("/rest/v1/fichadas") && url.includes("ingreso=not.is.null"), respond: () => ({ status: 200, body: fichados }) };
}
function handlerGerenciales(legajos) {
  return { match: (url) => url.includes("/rest/v1/empleados") && url.includes("rol=in.(gerencial,administrativo)"), respond: () => ({ status: 200, body: legajos }) };
}
function handlerPushTokens(tokens) {
  return { match: (url) => url.includes("/rest/v1/push_tokens"), respond: () => ({ status: 200, body: tokens }) };
}

test("cron/push-ausencias — sin auth devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(new Request("http://localhost/api/cron/push-ausencias"));
  assert.equal(res.status, 401);
});

test("cron/push-ausencias — fin de semana se salta sin consultar empleados", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: SABADO });
  try {
    global.fetch = createFetchMock([]);
    const res = await GET(cronReq());
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.skipped, "fin_de_semana");
  } finally {
    t.mock.timers.reset();
  }
});

test("cron/push-ausencias — día hábil sin empleados con turno hoy devuelve ausentes:0", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: LUNES });
  try {
    global.fetch = createFetchMock([handlerEmpleadosConTurno([])]);
    const res = await GET(cronReq());
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.ausentes, 0);
  } finally {
    t.mock.timers.reset();
  }
});

test("cron/push-ausencias — empleado con turno hoy que ya fichó no cuenta como ausente", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: LUNES });
  try {
    global.fetch = createFetchMock([
      handlerEmpleadosConTurno([{ id: EMPLEADO_ID, empresa_id: EMPRESA_ID, legajo: 7, diagrama: { lun: { in: "08:00", out: "16:00" } } }]),
      handlerFichadasHoy([{ empleado_id: EMPLEADO_ID }]),
    ]);
    const res = await GET(cronReq());
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.ausentes, 0);
  } finally {
    t.mock.timers.reset();
  }
});

test("cron/push-ausencias — empleado con turno hoy sin fichar cuenta como ausente (sin Firebase, 0 notificaciones)", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: LUNES });
  try {
    global.fetch = createFetchMock([
      handlerEmpleadosConTurno([{ id: EMPLEADO_ID, empresa_id: EMPRESA_ID, legajo: 7, diagrama: { lun: { in: "08:00", out: "16:00" } } }]),
      handlerFichadasHoy([]),
      handlerGerenciales([{ legajo: 1 }]),
      handlerPushTokens([{ token: "tok-1" }]),
    ]);
    const res = await GET(cronReq());
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.ausentes, 1);
    assert.equal(json.notificaciones_enviadas, 0, "sin FIREBASE_SERVICE_ACCOUNT configurado no se envía nada, pero no debe romper el cron");
  } finally {
    t.mock.timers.reset();
  }
});

test("cron/push-ausencias — empleado sin turno hoy (diagrama no tiene la clave del día) no cuenta", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: LUNES });
  try {
    global.fetch = createFetchMock([
      handlerEmpleadosConTurno([{ id: EMPLEADO_ID, empresa_id: EMPRESA_ID, legajo: 7, diagrama: { mar: { in: "08:00", out: "16:00" } } }]),
    ]);
    const res = await GET(cronReq());
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.ausentes, 0);
  } finally {
    t.mock.timers.reset();
  }
});

test("cron/push-ausencias — error fatal devuelve 500", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: LUNES });
  try {
    global.fetch = createFetchMock([
      { match: (url) => url.includes("/rest/v1/empleados") && url.includes("diagrama=not.is.null"), respond: () => { throw new Error("DB caída"); } },
    ]);
    const res = await GET(cronReq());
    assert.equal(res.status, 500);
  } finally {
    t.mock.timers.reset();
  }
});
