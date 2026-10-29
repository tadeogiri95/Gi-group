// tests/semana-editable.test.js — SEMANA de la OT editable desde Gypi (144)
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { opcionesSemana, cambioSemana, resolverSemana, pendientePlanilla } = await import("../app/lib/semanaEditable.js");

test("opcionesSemana — de 8 antes a 30 después de la actual, con la fecha de cada una", () => {
  const ops = opcionesSemana("2026-10-29", "semana_domingo");
  assert.equal(ops[0].semana, 36);
  assert.equal(ops.at(-1).semana, 74);
  assert.equal(ops.find((o) => o.semana === 44).texto, "S44 · 25/10 al 31/10 (esta)");
  // La que tiene la OT aunque esté lejos
  assert.equal(opcionesSemana("2026-10-29", "semana_domingo", 20)[0].semana, 20);
});

test("cambioSemana — guarda la semana, su fecha y queda pendiente para la planilla; volver a la de la planilla no deja nada pendiente", () => {
  const c = cambioSemana({ semana_planilla: 44 }, "46", { modo: "semana_domingo", hoy: "2026-10-29", ahora: "2026-10-29T13:00:00Z" });
  assert.deepEqual(c, { semana_objetivo: 46, fecha_objetivo: "2026-11-14", semana_app: 46, semana_app_at: "2026-10-29T13:00:00Z" });
  assert.equal(pendientePlanilla({ ...c }), true);
  const vuelta = cambioSemana({ semana_planilla: 44 }, 44, { modo: "semana_domingo", hoy: "2026-10-29" });
  assert.equal(vuelta.semana_app, null);
  assert.equal(vuelta.semana_app_at, null);
});

test("resolverSemana — gana el cambio más reciente", () => {
  const sync = "2026-10-29T12:00:00Z";
  // Sin cambio en Gypi: manda la planilla
  assert.deepEqual(resolverSemana(undefined, 44, sync), { semana_planilla: 44, semana: 44, semana_app: null, semana_app_at: null, gano: null });
  // Cambiada en Gypi y la planilla igual que antes: sigue la de Gypi
  const app = { semana_app: 46, semana_app_at: "2026-10-29T13:00:00Z", semana_planilla: 44 };
  assert.equal(resolverSemana(app, 44, sync).semana, 46);
  assert.equal(resolverSemana(app, 44, sync).gano, "app");
  // Ya llegó a la planilla: no queda pendiente
  assert.deepEqual(resolverSemana(app, 46, sync), { semana_planilla: 46, semana: 46, semana_app: null, semana_app_at: null, gano: null });
  // La planilla cambió después de un cambio de Gypi anterior a la última sync: gana la planilla
  const vieja = { ...app, semana_app_at: "2026-10-29T11:00:00Z" };
  assert.deepEqual(resolverSemana(vieja, 48, sync), { semana_planilla: 48, semana: 48, semana_app: null, semana_app_at: null, gano: "planilla" });
  // Cambio de Gypi después de la última sync: es el más reciente
  assert.equal(resolverSemana(app, 48, sync).semana, 46);
});

test("sync — la semana cambiada en Gypi se respeta hasta que llega a la planilla", async () => {
  const CSV_URL = "https://files.example.com/ot.csv";
  const lotes = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && u.includes("proyectos_csv_url") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [{ valor: { url: CSV_URL, ultima_sync: "2026-10-29T12:00:00Z" } }] }) },
    { match: (u) => u === CSV_URL, respond: () => ({ status: 200, body: "OT,CLIENTE,SEMANA\nM-1,A,44\nM-2,B,44\nM-3,C,50" }) },
    { match: (u, o) => u.includes("semana_app=not.is.null") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [
      { ot: "M-1", semana_app: 46, semana_app_at: "2026-10-29T13:00:00Z", semana_planilla: 44 },
      { ot: "M-3", semana_app: 47, semana_app_at: "2026-10-29T11:00:00Z", semana_planilla: 44 },
    ] }) },
    { match: (u, o) => u.includes("/rest/v1/proyectos?on_conflict=") && o?.method === "POST", respond: (u, o) => { lotes.push(JSON.parse(o.body)); return { status: 200, body: null }; } },
    { match: (u, o) => u.includes("/rest/v1/proyectos?empresa_id=") && o?.method === "PATCH", respond: () => ({ status: 200, body: null }) },
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && o?.method === "PATCH", respond: () => ({ status: 200, body: null }) },
  ]);
  const { signAccessToken } = await import("../app/lib/jwt.ts");
  const { POST } = await import("../app/api/proyectos/sync-csv/route.js");
  const { token } = await signAccessToken({ empleadoId: "22222222-2222-2222-2222-222222222222", empresaId: "11111111-1111-1111-1111-111111111111", legajo: 7, rol: "gerencial" });
  const res = await POST(new Request("http://localhost/api/proyectos/sync-csv", { method: "POST", headers: { Authorization: `Bearer ${token}` } }));
  assert.equal(res.status, 200);
  const por = Object.fromEntries(lotes.flat().map((r) => [r.ot, r]));
  assert.equal(por["M-1"].semana_objetivo, 46, "cambiada en Gypi, la planilla no cambió");
  assert.equal(por["M-1"].semana_app, 46);
  assert.equal(por["M-1"].semana_planilla, 44);
  assert.equal(por["M-2"].semana_objetivo, 44);
  assert.equal(por["M-2"].semana_app, null);
  assert.equal(por["M-3"].semana_objetivo, 50, "la planilla cambió después: gana la planilla");
  assert.equal(por["M-3"].semana_app, null);
});

test("sync — sin la migración 144 sincroniza igual, sin las columnas nuevas", async () => {
  const CSV_URL = "https://files.example.com/ot.csv";
  const lotes = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && u.includes("proyectos_csv_url") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [{ valor: { url: CSV_URL } }] }) },
    { match: (u) => u === CSV_URL, respond: () => ({ status: 200, body: "OT,CLIENTE,SEMANA\nM-1,A,44" }) },
    { match: (u) => u.includes("semana_app=not.is.null"), respond: () => ({ status: 400, body: { message: "column proyectos.semana_app does not exist" } }) },
    { match: (u, o) => u.includes("/rest/v1/proyectos?on_conflict=") && o?.method === "POST", respond: (u, o) => { lotes.push(JSON.parse(o.body)); return { status: 200, body: null }; } },
    { match: (u, o) => u.includes("/rest/v1/proyectos?empresa_id=") && o?.method === "PATCH", respond: () => ({ status: 200, body: null }) },
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && o?.method === "PATCH", respond: () => ({ status: 200, body: null }) },
  ]);
  const { signAccessToken } = await import("../app/lib/jwt.ts");
  const { POST } = await import("../app/api/proyectos/sync-csv/route.js");
  const { token } = await signAccessToken({ empleadoId: "22222222-2222-2222-2222-222222222222", empresaId: "11111111-1111-1111-1111-111111111111", legajo: 7, rol: "gerencial" });
  const json = await (await POST(new Request("http://localhost/api/proyectos/sync-csv", { method: "POST", headers: { Authorization: `Bearer ${token}` } }))).json();
  assert.equal(json.procesados, 1);
  assert.equal(lotes.length, 1, "sin reintentos");
  assert.equal(lotes[0][0].semana_objetivo, 44);
  assert.equal("semana_app" in lotes[0][0], false);
});
