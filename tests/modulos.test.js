// tests/modulos.test.js — Núcleo modular, parte 1 (ítem 36): qué módulos tiene
// cada empresa (plan + add-ons + ajustes propios) y el control en el servidor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";

const { MODULOS, modulosEfectivos, modulosContratados, modulosApagados, moduloApagado, configModulos } = await import("../app/lib/modulos.js");
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

test("catálogo — el de la app y el de las migraciones 083, 131 y 132 son el mismo (ids y disponibles)", () => {
  // 131 pisa a 083 (on conflict do update), como en la base
  const filas = ["083_modulos.sql", "131_modulos_apagados.sql", "132_maquinaria.sql"].flatMap((f) => {
    const sql = readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8");
    return [...sql.matchAll(/\('([a-z]+)',\s*'[^']+',\s*'[^']*',\s*(true|false),/g)].map((m) => [m[1], m[2] === "true"]);
  });
  assert.deepEqual(
    Object.fromEntries(filas),
    Object.fromEntries(Object.values(MODULOS).map((m) => [m.id, m.disponible]))
  );
});

// ─── Cálculo ────────────────────────────────────────────────────────────────

test("modulosEfectivos — sin ajustes es exactamente lo del plan y sus add-ons (nadie pierde nada)", () => {
  assert.deepEqual(modulosEfectivos({ plan: "asistencia_15" }), ["fichaje", "chat", "reportes", "calendario"]);
  assert.deepEqual(modulosEfectivos({ plan: "planta_40" }), ["fichaje", "chat", "reportes", "calendario", "actividad", "proyectos", "stock", "compras", "flota", "maquinaria"]);
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
    { modulo: "calidad", activo: true },    // todavía no disponible
    { modulo: "inventado", activo: true },  // no existe
  ];
  // Las OT dadas a mano traen Stock, Compras y Flota
  assert.deepEqual(modulosEfectivos({ plan: "asistencia_15", ajustes }), ["fichaje", "reportes", "calendario", "proyectos", "stock", "compras", "flota", "maquinaria"]);
  // Sacar las OT a mano saca también lo que viene con ellas; sacar Flota sola, solo Flota
  assert.deepEqual(modulosEfectivos({ plan: "planta_15", ajustes: [{ modulo: "proyectos", activo: false }] }), ["fichaje", "chat", "reportes", "calendario", "actividad"]);
  assert.ok(!modulosEfectivos({ plan: "planta_15", ajustes: [{ modulo: "flota", activo: false }] }).includes("flota"));
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
  assert.deepEqual(m.modulos, ["fichaje", "chat", "reportes", "calendario", "actividad", "proyectos", "stock", "compras", "flota", "maquinaria"]);
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
      { match: (u) => u.includes("/rest/v1/rpc/registrar_actividad"), respond: (u, o) => { cerrada = JSON.parse(o.body).p_nueva === null; return { status: 200, body: { ok: true, cerradas: 1 } }; } },
    ],
  });
  const iniciar = await pedir({ accion: "iniciar", etapa: 1, codigo_proyecto: "OT-1" });
  assert.equal(iniciar.status, 402);
  assert.equal((await iniciar.json()).modulo, "actividad");
  const fin = await pedir({ accion: "finalizar" });
  assert.equal(fin.status, 200);
  assert.equal(cerrada, true);
});

// ─── La empresa prende o apaga lo que contrató (migración 131) ──────────────

test("apagado — lo apagado sale de los efectivos pero sigue contratado; lo no contratado no se apaga ni se suma", () => {
  const ajustes = [
    { modulo: "flota", activo: null, apagado: true },
    { modulo: "fichaje", activo: null, apagado: true },
    { modulo: "obra", activo: null, apagado: true },   // no está en planta_15: no cuenta ni se suma
  ];
  const p = { plan: "planta_15", ajustes };
  assert.ok(!modulosEfectivos(p).includes("flota"));
  // El fichaje también se apaga (empresas con su propio control de acceso)
  assert.ok(!modulosEfectivos(p).includes("fichaje"));
  assert.ok(modulosContratados(p).includes("flota"));
  assert.deepEqual(modulosApagados(p), ["fichaje", "flota"]);
  assert.ok(!modulosContratados(p).includes("obra"));
  // Apagar las OT no apaga Stock ni Compras
  const sinOt = modulosEfectivos({ plan: "planta_15", ajustes: [{ modulo: "proyectos", apagado: true }] });
  assert.ok(!sinOt.includes("proyectos") && sinOt.includes("stock") && sinOt.includes("compras"));
  assert.equal(moduloApagado({ modulos_apagados: ["flota"] }, "flota"), true);
  assert.equal(moduloApagado({}, "flota"), false);
});

test("requireModulo — un módulo apagado por la empresa bloquea en el servidor", async () => {
  empresaCon({ plan: "planta_15", ajustes: [{ modulo: "compras", activo: null, apagado: true, config: {} }] });
  assert.equal((await requireModulo(E, "compras")).status, 402);
  empresaCon({ plan: "planta_15", ajustes: [{ modulo: "compras", activo: null, apagado: true, config: {} }] });
  assert.equal(await requireModulo(E, "stock"), null);
});

test("getModulosEmpresa — sin la migración 131 (sin columna apagado) lee los ajustes igual", async () => {
  invalidarCachePlan(E);
  global.fetch = createFetchMock([
    { match: (u) => u.includes("select=plan_activo,plan_vence"), respond: () => ({ status: 200, body: [{ plan_activo: "asistencia_15" }] }) },
    { match: (u) => u.includes("select=addons"), respond: () => ({ status: 200, body: [{ addons: [] }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos") && u.includes("apagado"), respond: () => ({ status: 400, body: { message: "column empresa_modulos.apagado does not exist" } }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [{ modulo: "proyectos", activo: true, config: {} }] }) },
  ]);
  const m = await getModulosEmpresa(E);
  assert.ok(m.modulos.includes("proyectos"));
  assert.deepEqual(m.apagados, []);
});

test("/api/modulos — el dueño apaga Flota; el operario no puede; lo no contratado no se prende", async () => {
  const { PATCH } = await import("../app/api/modulos/route.js");
  const tok = async (rol) => (await signAccessToken({ empleadoId: "22222222-2222-2222-2222-222222222222", empresaId: E, legajo: 1, rol })).token;
  const pedir = async (rol, body) => PATCH(new Request("http://localhost/api/modulos", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await tok(rol)}` },
    body: JSON.stringify(body),
  }));
  let guardado = null;
  const ajustes = [];
  empresaCon({
    plan: "planta_15",
    ajustes,
    extra: [
      ...authPassHandlers(),
      { match: (u, o) => u.includes("/rest/v1/empresa_modulos?on_conflict") && o.method === "POST", respond: (u, o) => { guardado = JSON.parse(o.body); ajustes.push({ ...guardado, activo: null, config: {} }); return { status: 201 }; } },
    ],
  });
  const res = await pedir("gerencial", { modulo: "flota", prendido: false });
  assert.equal(res.status, 200);
  assert.equal(guardado.apagado, true);
  assert.equal(guardado.empresa_id, E);
  assert.ok(!("activo" in guardado), "no pisa el activo de un ajuste a mano");
  const json = await res.json();
  assert.deepEqual(json.modulos_apagados, ["flota"]);
  assert.equal(json.lista.find((m) => m.id === "flota").prendido, false);

  assert.equal((await pedir("operativo", { modulo: "flota", prendido: false })).status, 403);
  assert.equal((await pedir("gerencial", { modulo: "obra", prendido: true })).status, 403);
  assert.equal((await pedir("gerencial", { modulo: "fichaje", prendido: false })).status, 200);
  assert.equal(guardado.modulo, "fichaje");
  assert.equal((await pedir("gerencial", { modulo: "calidad", prendido: true })).status, 400);
});
