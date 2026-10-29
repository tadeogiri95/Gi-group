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

// ─── Script del Plan de trabajo y su ruta ───
const { scriptPlanPlanilla, semanasParaPlanilla, CLAVE_PLANILLA_PLAN, generarClave } = await import("../app/lib/planillaPlan.js");

/** Hoja falsa de Apps Script: filas de texto; setValue anota en la celda. */
function hojaFalsa(filas, formulas = {}) {
  const ancho = Math.max(...filas.map((f) => f.length));
  const celda = (r, c) => String(filas[r - 1]?.[c - 1] ?? "");
  return {
    filas,
    getLastRow: () => filas.length,
    getLastColumn: () => ancho,
    getRange: (r, c, n = 1, m = 1) => ({
      getDisplayValues: () => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => celda(r + i, c + j))),
      getFormulas: () => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => formulas[`${r + i},${c + j}`] || "")),
      setValue: (v) => { filas[r - 1][c - 1] = v; },
    }),
  };
}

function correrScript(hojas, semanas) {
  const pedidos = [];
  const entorno = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheets: () => hojas }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ScriptApp: { getProjectTriggers: () => [] },
    UrlFetchApp: { fetch: (url, o) => {
      pedidos.push({ url, metodo: o.method, cuerpo: o.payload ? JSON.parse(o.payload) : null, auth: o.headers.Authorization });
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(o.method === "get" ? { semanas } : { ok: true }) };
    } },
  };
  const script = scriptPlanPlanilla({ url: "https://gypi.test/api/proyectos/semanas-planilla", clave: "gyp_x" });
  new Function(...Object.keys(entorno), `${script}\npasarSemanasGypi();`)(...Object.values(entorno));
  return pedidos;
}

test("script del Plan — anota la SEMANA en todos los renglones de la OT y en todas las hojas; no pisa lo cambiado en la planilla", () => {
  const plan = hojaFalsa([
    ["NUMERO SIGUIENTE", "", ""],
    ["", "", ""],
    ["OT", "CLIENTE", "SEMANA "],
    ["M-1", "A", "44"],
    ["M-1", "A", "43"],
    ["M-2", "B", "50"],
    ["M-3", "C", "44"],
  ]);
  const obra = hojaFalsa([["OT", "SEMANA"], ["M-1", "44"], ["M-4", "44"]], { "2,2": "" });
  const personas = hojaFalsa([["NOMBRE", "DNI"], ["Juan", "1"]]);
  const pedidos = correrScript([plan, obra, personas], [
    { ot: "M-1", semana: 46, antes: 44 },
    { ot: "M-2", semana: 47, antes: 44 }, // en la planilla ya dice 50: alguien la cambió
    { ot: "M-3", semana: 44, antes: 40 }, // ya está
    { ot: "M-9", semana: 45, antes: 44 }, // no está en la planilla
  ]);
  assert.deepEqual(plan.filas.slice(3).map((f) => f[2]), [46, 46, "50", "44"]);
  assert.equal(obra.filas[1][1], 46);
  assert.equal(obra.filas[2][1], "44");
  assert.equal(pedidos[0].metodo, "get");
  assert.equal(pedidos[0].auth, "Bearer gyp_x");
  assert.deepEqual(pedidos[1], { url: "https://gypi.test/api/proyectos/semanas-planilla", metodo: "patch", cuerpo: { escritas: [{ ot: "M-1", semana: 46 }, { ot: "M-3", semana: 44 }] }, auth: "Bearer gyp_x" });
});

test("script del Plan — no toca celdas con fórmula; sin semanas pendientes no hace nada más", () => {
  const plan = hojaFalsa([["OT", "SEMANA"], ["M-1", "44"]], { "2,2": "=A1" });
  const pedidos = correrScript([plan], [{ ot: "M-1", semana: 46, antes: 44 }]);
  assert.equal(plan.filas[1][1], "44");
  assert.equal(pedidos.length, 1);
  assert.equal(correrScript([plan], []).length, 1);
});

test("semanasParaPlanilla — solo las pendientes", () => {
  assert.deepEqual(semanasParaPlanilla([{ ot: "M-1", semana_app: 46, semana_planilla: 44 }, { ot: "M-2", semana_app: null }, { ot: "M-3", semana_app: 47, semana_planilla: null }]),
    [{ ot: "M-1", semana: 46, antes: 44 }, { ot: "M-3", semana: 47, antes: null }]);
});

test("/api/proyectos/semanas-planilla — GET y PATCH con la clave; sin clave válida, 401", async () => {
  const { GET, PATCH } = await import("../app/api/proyectos/semanas-planilla/route.js");
  const E = "11111111-1111-1111-1111-111111111111";
  const { clave, hash } = generarClave(E);
  const patches = [];
  global.fetch = createFetchMock([
    { match: (u) => u.includes("/rest/v1/config_sistema") && u.includes(`clave=eq.${CLAVE_PLANILLA_PLAN}`) && u.includes("select=valor"), respond: () => ({ status: 200, body: [{ valor: { hash } }] }) },
    { match: (u, o) => u.includes("/rest/v1/config_sistema") && o?.method === "PATCH", respond: () => ({ status: 200, body: null }) },
    { match: (u, o) => u.includes("/rest/v1/proyectos?") && u.includes("semana_app=not.is.null") && (!o?.method || o.method === "GET"), respond: () => ({ status: 200, body: [{ ot: "M-1", semana_app: 46, semana_planilla: 44 }] }) },
    { match: (u, o) => u.includes("/rest/v1/proyectos?") && o?.method === "PATCH", respond: (u, o) => { patches.push([decodeURIComponent(u), JSON.parse(o.body)]); return { status: 200, body: null }; } },
  ]);
  const req = (metodo, auth, body) => new Request("http://localhost/api/proyectos/semanas-planilla", { method: metodo, headers: { Authorization: `Bearer ${auth}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await GET(req("GET", "gyp_mala"))).status, 401);
  assert.equal((await GET(req("GET", generarClave(E).clave))).status, 401, "otra clave de la misma empresa");
  const data = await (await GET(req("GET", clave))).json();
  assert.deepEqual(data, { semanas: [{ ot: "M-1", semana: 46, antes: 44 }] });
  const r = await (await PATCH(req("PATCH", clave, { escritas: [{ ot: "M-1", semana: 46 }, { ot: "", semana: 3 }] }))).json();
  assert.equal(r.listas, 1);
  assert.equal(patches.length, 1);
  assert.match(patches[0][0], /empresa_id=eq\.11111111-1111-1111-1111-111111111111&ot=eq\.M-1&semana_app=eq\.46/);
  assert.deepEqual(patches[0][1], { semana_app: null, semana_app_at: null, semana_planilla: 46 });
});
