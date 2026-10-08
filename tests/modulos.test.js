// tests/modulos.test.js — Núcleo modular, parte 1 (ítem 36): qué módulos tiene
// cada empresa (plan + add-ons + ajustes propios) y el control en el servidor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";

const { MODULOS, modulosEfectivos, configModulos } = await import("../app/lib/modulos.js");
const { requireModulo, validarLimite, invalidarCachePlan, getModulosEmpresa } = await import("../app/lib/planEnforcement.js");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST: actividad } = await import("../app/api/actividad/route.js");

const E = "11111111-1111-1111-1111-111111111111";

/** Base simulada: plan, add-ons y ajustes de módulos de la empresa. */
function empresaCon({ plan = "asistencia_15", addons = [], ajustes = [], ajustesStatus = 200, extra = [] } = {}) {
  invalidarCachePlan(E);
  global.fetch = createFetchMock([
    ...extra,
    { match: (u) => u.includes("select=plan_activo,plan_vence"), respond: () => ({ status: 200, body: [{ plan_activo: plan }] }) },
    { match: (u) => u.includes("select=addons"), respond: () => ({ status: 200, body: [{ addons }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: ajustesStatus, body: ajustesStatus === 200 ? ajustes : { message: "relation does not exist" } }) },
  ]);
}

// ─── Catálogo ───────────────────────────────────────────────────────────────

test("catálogo — el de la app y el de la migración 083 son el mismo (ids y disponibles)", () => {
  const sql = readFileSync(new URL("../supabase/migrations/083_modulos.sql", import.meta.url), "utf8");
  const filas = [...sql.matchAll(/\('([a-z]+)',\s*'[^']+',\s*'[^']*',\s*(true|false),/g)].map((m) => [m[1], m[2] === "true"]);
  assert.deepEqual(
    Object.fromEntries(filas),
    Object.fromEntries(Object.values(MODULOS).map((m) => [m.id, m.disponible]))
  );
});

// ─── Cálculo ────────────────────────────────────────────────────────────────

test("modulosEfectivos — sin ajustes es exactamente lo del plan y sus add-ons (nadie pierde nada)", () => {
  assert.deepEqual(modulosEfectivos({ plan: "asistencia_15" }), ["fichaje", "chat", "reportes", "calendario"]);
  assert.deepEqual(modulosEfectivos({ plan: "planta_40" }), ["fichaje", "chat", "reportes", "calendario", "actividad", "proyectos"]);
  assert.ok(modulosEfectivos({ plan: "asistencia_15", addons: ["campo"] }).includes("obra"));
  // Planes de antes y la empresa piloto, igual que hoy
  assert.ok(modulosEfectivos({ plan: "pro" }).includes("obra"));
  assert.ok(modulosEfectivos({ plan: "enterprise" }).includes("proyectos"));
  assert.deepEqual(modulosEfectivos({ plan: "free" }), ["fichaje", "chat", "actividad"]);
});

test("modulosEfectivos — ajustes de la empresa: dar un módulo, sacar uno del plan; los que no existen no cuentan", () => {
  const ajustes = [
    { modulo: "proyectos", activo: true },
    { modulo: "chat", activo: false },
    { modulo: "stock", activo: true },      // todavía no disponible
    { modulo: "inventado", activo: true },  // no existe
  ];
  assert.deepEqual(modulosEfectivos({ plan: "asistencia_15", ajustes }), ["fichaje", "reportes", "calendario", "proyectos"]);
  assert.deepEqual(configModulos([{ modulo: "fichaje", activo: true, config: { tolerancia: 5 } }, { modulo: "chat", activo: false, config: { x: 1 } }]), { fichaje: { tolerancia: 5 } });
});

// ─── En el servidor ─────────────────────────────────────────────────────────

test("requireModulo — sin el módulo corta con 402 y dice cómo sumarlo", async () => {
  empresaCon({ plan: "asistencia_40" });
  let res = await requireModulo(E, "proyectos");
  assert.equal(res.status, 402);
  let json = await res.json();
  assert.equal(json.tipo, "sin_modulo");
  assert.equal(json.upgrade_a, "planta_40");
  assert.match(json.error, /Planta/);

  empresaCon({ plan: "planta_15" });
  json = await (await requireModulo(E, "obra")).json();
  assert.equal(json.upgrade_a, "campo");

  empresaCon({ plan: "planta_15" });
  assert.equal(await requireModulo(E, "proyectos"), null);
});

test("requireModulo — un módulo dado a mano habilita; uno sacado a mano bloquea", async () => {
  empresaCon({ plan: "asistencia_15", ajustes: [{ modulo: "proyectos", activo: true, config: {} }] });
  assert.equal(await requireModulo(E, "proyectos"), null);
  empresaCon({ plan: "planta_80", ajustes: [{ modulo: "actividad", activo: false, config: {} }] });
  assert.equal((await requireModulo(E, "actividad")).status, 402);
});

test("getModulosEmpresa — sin la migración 083 (tabla inexistente) vale lo del plan", async () => {
  empresaCon({ plan: "planta_15", ajustesStatus: 404 });
  const m = await getModulosEmpresa(E);
  assert.deepEqual(m.modulos, ["fichaje", "chat", "reportes", "calendario", "actividad", "proyectos"]);
  assert.equal(m.capacidades.ia_consultas_mes, 200);
});

test("validarLimite — cada tabla pide su módulo; con OT dadas a mano, Asistencia no tiene tope", async () => {
  const intento = (tabla) => validarLimite({ tabla, empresaId: E, body: {}, method: "POST" });

  empresaCon({ plan: "asistencia_15" });
  const tarea = await intento("registro_actividades");
  assert.equal(tarea.ok, false);
  assert.equal(tarea.upgrade_a, "planta_15");

  empresaCon({ plan: "planta_15", ajustes: [{ modulo: "calendario", activo: false, config: {} }] });
  assert.equal((await intento("turnos_planificados")).ok, false);

  empresaCon({
    plan: "asistencia_15",
    ajustes: [{ modulo: "proyectos", activo: true, config: {} }],
    extra: [{ match: (u) => u.includes("/rest/v1/proyectos"), respond: () => ({ status: 200, body: [], headers: { "content-range": "0-0/3" } }) }],
  });
  assert.equal((await intento("proyectos")).ok, true);
});

test("/api/actividad — sin el módulo no se empieza una tarea, pero una abierta se puede terminar", async () => {
  const { token } = await signAccessToken({ empleadoId: "22222222-2222-2222-2222-222222222222", empresaId: E, legajo: 7, rol: "operativo" });
  const pedir = (body) => actividad(new Request("http://localhost/api/actividad", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }));
  let cerrada = false;
  empresaCon({
    plan: "asistencia_15",
    extra: [
      ...authPassHandlers(),
      { match: (u, o) => u.includes("/rest/v1/registro_actividades") && o?.method === "PATCH", respond: () => { cerrada = true; return { status: 200, body: [{}] }; } },
      { match: (u) => u.includes("/rest/v1/registro_actividades"), respond: () => ({ status: 200, body: [{ id: 9, hora_inicio: "2026-10-08T10:00:00Z" }] }) },
    ],
  });
  const iniciar = await pedir({ accion: "iniciar", etapa: 1, codigo_proyecto: "OT-1" });
  assert.equal(iniciar.status, 402);
  assert.equal((await iniciar.json()).modulo, "actividad");
  const fin = await pedir({ accion: "finalizar" });
  assert.equal(fin.status, 200);
  assert.equal(cerrada, true);
});
