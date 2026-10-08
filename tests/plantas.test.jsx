// tests/plantas.test.jsx — Núcleo modular, parte 3 (ítem 36): plantas o sedes
// por empresa. Con una sola planta no cambia nada; con varias, cada persona y
// cada punto de fichaje tiene la suya.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { _resetBuckets } from "../app/lib/rateLimitMemory.js";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";

const { ordenarPlantas, hayVariasPlantas, zonasDePlanta } = await import("../app/lib/plantas.js");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const config = await import("../app/api/config-empresa/route.js");
const empleados = await import("../app/api/empleados/route.js");
const { POST: fichar } = await import("../app/api/fichar/route.js");
const { default: PlantasPanel } = await import("../app/components/PlantasPanel.jsx");
const { AuthContext } = await import("../app/context/AuthContext.jsx");
const { REFERENCIAS, autorizar } = await import("../app/lib/dataPolicy.js");

afterEach(() => cleanup());

const E = "11111111-1111-1111-1111-111111111111";
const YO = "22222222-2222-2222-2222-222222222222";
const PRINCIPAL = { id: "aaaaaaaa-0000-0000-0000-000000000001", nombre: "Planta principal", principal: true };
const NORTE = { id: "aaaaaaaa-0000-0000-0000-000000000002", nombre: "Norte", principal: false };

async function token(rol = "gerencial") {
  return (await signAccessToken({ empleadoId: YO, empresaId: E, legajo: 1, rol })).token;
}
async function pedir(handler, url, { method = "GET", body, rol } = {}) {
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` };
  return handler(new Request(`http://localhost${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined }));
}

// ─── Reglas ─────────────────────────────────────────────────────────────────

test("plantas — la principal primero; las dadas de baja no cuentan", () => {
  const lista = ordenarPlantas([{ ...NORTE }, { id: "x", nombre: "Vieja", activa: false }, PRINCIPAL, { id: "y", nombre: "Ala Sur" }]);
  assert.deepEqual(lista.map((p) => p.nombre), ["Planta principal", "Ala Sur", "Norte"]);
  assert.equal(hayVariasPlantas([PRINCIPAL]), false);
  assert.equal(hayVariasPlantas([PRINCIPAL, NORTE]), true);
  assert.deepEqual(ordenarPlantas(undefined), []);
});

test("zonasDePlanta — cada uno ficha en los puntos de su planta; si su planta no tiene, valen todos", () => {
  const zonas = [
    { id: 1, planta_id: PRINCIPAL.id },
    { id: 2, planta_id: NORTE.id },
    { id: 3, planta_id: null },
  ];
  assert.deepEqual(zonasDePlanta(zonas, NORTE.id).map((z) => z.id), [2, 3]);
  assert.deepEqual(zonasDePlanta(zonas, PRINCIPAL.id).map((z) => z.id), [1, 3]);
  assert.deepEqual(zonasDePlanta(zonas, "otra").map((z) => z.id), [1, 2, 3]);
  assert.deepEqual(zonasDePlanta(zonas, null).map((z) => z.id), [1, 2, 3]);
});

test("migración 084 — una principal por empresa, planta de la misma empresa y la principal por defecto", () => {
  const sql = readFileSync(new URL("../supabase/migrations/084_plantas.sql", import.meta.url), "utf8");
  assert.match(sql, /plantas_una_principal\s+on public\.plantas \(empresa_id\) where principal/);
  assert.match(sql, /foreign key \(planta_id, empresa_id\) references public\.plantas \(id, empresa_id\)/);
  assert.match(sql, /after insert on public\.empresa/);
  assert.match(sql, /before insert on public\.empleados/);
  assert.match(sql, /check \(activa or not principal\)/);
});

test("/api/data — plantas se leen pero no se escriben por el gateway; planta_id tiene que ser de la empresa", () => {
  assert.equal(REFERENCIAS.planta_id, "plantas");
  assert.equal(autorizar("plantas", "GET", { rol: "operativo" }).ok, true);
  assert.equal(autorizar("plantas", "POST", { rol: "gerencial" }).ok, false);
});

// ─── /api/config-empresa ────────────────────────────────────────────────────

function mockConfig(extra = []) {
  const llamadas = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u, o) => { llamadas.push([o?.method || "GET", u, o?.body]); return false; }, respond: () => ({}) },
    ...extra,
    { match: (u) => u.includes("/rest/v1/divisiones") || u.includes("/rest/v1/etapas"), respond: () => ({ status: 200, body: [] }) },
  ]);
  return llamadas;
}

test("config-empresa GET — manda las plantas (principal primero); sin la migración, lista vacía", async () => {
  mockConfig([{ match: (u) => u.includes("/rest/v1/plantas"), respond: () => ({ status: 200, body: [NORTE, PRINCIPAL] }) }]);
  let json = await (await pedir(config.GET, "/api/config-empresa")).json();
  assert.deepEqual(json.plantas.map((p) => p.nombre), ["Planta principal", "Norte"]);

  mockConfig([{ match: (u) => u.includes("/rest/v1/plantas"), respond: () => ({ status: 404, body: { message: "relation does not exist" } }) }]);
  json = await (await pedir(config.GET, "/api/config-empresa")).json();
  assert.deepEqual(json.plantas, []);
});

test("config-empresa — agregar planta; nombre repetido avisa con un mensaje claro", async () => {
  mockConfig([{ match: (u, o) => u.includes("/rest/v1/plantas") && o?.method === "POST", respond: () => ({ status: 201, body: [{ ...NORTE }] }) }]);
  let res = await pedir(config.POST, "/api/config-empresa", { method: "POST", body: { action: "add_planta", nombre: "  Norte " } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).planta.nombre, "Norte");

  mockConfig([{ match: (u, o) => u.includes("/rest/v1/plantas") && o?.method === "POST", respond: () => ({ status: 409, body: { code: "23505" } }) }]);
  res = await pedir(config.POST, "/api/config-empresa", { method: "POST", body: { action: "add_planta", nombre: "Norte" } });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Ya tenés una planta con ese nombre/);

  res = await pedir(config.POST, "/api/config-empresa", { method: "POST", body: { action: "add_planta", nombre: "   " } });
  assert.equal(res.status, 400);
  res = await pedir(config.POST, "/api/config-empresa", { method: "POST", body: { action: "add_planta", nombre: "X" }, rol: "operativo" });
  assert.equal(res.status, 403);
});

test("config-empresa — quitar una planta pasa su gente y sus puntos a la principal; la principal no se quita", async () => {
  const llamadas = mockConfig([
    { match: (u) => u.includes("/rest/v1/plantas") && u.includes("activa=eq.true&select=id,principal"), respond: () => ({ status: 200, body: [PRINCIPAL, NORTE] }) },
    { match: (u) => u.includes("solo_su_division"), respond: () => ({ status: 200, body: [{ solo_su_division: false }] }) },
    { match: (u, o) => o?.method === "PATCH" && u.includes("/rest/v1/empleados"), respond: () => ({ status: 200, body: [{}, {}] }) },
    { match: (u, o) => o?.method === "PATCH", respond: () => ({ status: 200, body: [{}] }) },
  ]);
  let res = await pedir(config.DELETE, `/api/config-empresa?type=planta&id=${PRINCIPAL.id}`, { method: "DELETE" });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /principal no se puede dar de baja/);

  res = await pedir(config.DELETE, `/api/config-empresa?type=planta&id=${NORTE.id}`, { method: "DELETE" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).empleados_movidos, 2);
  const patches = llamadas.filter(([m]) => m === "PATCH").map(([, u, b]) => [u.split("/rest/v1/")[1], JSON.parse(b)]);
  assert.deepEqual(patches, [
    [`empleados?empresa_id=eq.${E}&planta_id=eq.${NORTE.id}`, { planta_id: PRINCIPAL.id }],
    [`geo_zonas?empresa_id=eq.${E}&planta_id=eq.${NORTE.id}`, { planta_id: PRINCIPAL.id }],
    [`plantas?id=eq.${NORTE.id}&empresa_id=eq.${E}`, { activa: false }],
  ]);
});

// ─── /api/empleados ─────────────────────────────────────────────────────────

test("empleados — se puede cambiar de planta, pero no a una que no es de la empresa", async () => {
  let enviado = null;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("solo_su_division"), respond: () => ({ status: 200, body: [{ solo_su_division: false }] }) },
    { match: (u) => u.includes("/rest/v1/plantas") && u.includes(NORTE.id), respond: () => ({ status: 200, body: [{ id: NORTE.id }] }) },
    { match: (u) => u.includes("/rest/v1/plantas"), respond: () => ({ status: 200, body: [] }) },
    { match: (u, o) => u.includes("/rest/v1/empleados") && o?.method === "PATCH", respond: (u, o) => { enviado = JSON.parse(o.body); return { status: 200, body: [{ id: "e1", ...enviado }] }; } },
    { match: (u) => u.includes("/rest/v1/empleados"), respond: () => ({ status: 200, body: [{ id: "e1" }] }) },
  ]);
  const ID = "33333333-3333-3333-3333-333333333333";
  let res = await pedir(empleados.PATCH, `/api/empleados?id=${ID}`, { method: "PATCH", body: { planta_id: "99999999-9999-9999-9999-999999999999" } });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /planta elegida no existe/);
  assert.equal(enviado, null);

  res = await pedir(empleados.PATCH, `/api/empleados?id=${ID}`, { method: "PATCH", body: { planta_id: NORTE.id, nombre: "Ana" } });
  assert.equal(res.status, 200);
  assert.equal(enviado.planta_id, NORTE.id);
});

// ─── Fichaje ────────────────────────────────────────────────────────────────

const ZONA_PRINCIPAL = { id: 1, lat: -34.6037, lng: -58.3816, radio: 150, nombre: "Principal", planta_id: PRINCIPAL.id };
const ZONA_NORTE = { id: 2, lat: -31.42, lng: -64.18, radio: 150, nombre: "Norte", planta_id: NORTE.id };

function mockFichaje({ zonas, plantaEmpleado }) {
  _resetBuckets?.();
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa") && u.includes("select=timezone"), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "enterprise" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa") && u.includes("select=plan_activo"), respond: () => ({ status: 200, body: [{ plan_activo: "enterprise" }] }) },
    { match: (u) => u.includes("/rest/v1/geo_zonas"), respond: () => ({ status: 200, body: zonas }) },
    { match: (u) => u.includes("select=geo_config"), respond: () => ({ status: 200, body: [{ geo_config: { activo: false }, planta_id: plantaEmpleado }] }) },
    { match: (u) => u.includes("select=reglas_asistencia"), respond: () => ({ status: 200, body: [{ reglas_asistencia: null }] }) },
    { match: (u) => u.includes("/rest/v1/fichadas") && u.includes("select=id,ingreso"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empleados") && u.includes("select=diagrama"), respond: () => ({ status: 200, body: [{ diagrama: null }] }) },
    { match: (u, o) => u.includes("/rest/v1/fichadas") && o?.method === "POST", respond: () => ({ status: 201, body: [{ id: "f" }] }) },
  ]);
}
async function ficharEn(lat, lng) {
  const res = await pedir(fichar, "/api/fichar", { method: "POST", body: { accion: "ingreso", geo_lat: lat, geo_lng: lng }, rol: "operativo" });
  return res.json();
}

test("fichar — alguien de la planta Norte no ficha en el punto de la principal", async () => {
  mockFichaje({ zonas: [ZONA_PRINCIPAL, ZONA_NORTE], plantaEmpleado: NORTE.id });
  assert.equal((await ficharEn(ZONA_PRINCIPAL.lat, ZONA_PRINCIPAL.lng)).tipo, "fuera_de_zona");
  mockFichaje({ zonas: [ZONA_PRINCIPAL, ZONA_NORTE], plantaEmpleado: NORTE.id });
  assert.equal((await ficharEn(ZONA_NORTE.lat, ZONA_NORTE.lng)).ok, true);
});

test("fichar — si su planta todavía no tiene puntos cargados, vale cualquiera (nadie queda trabado)", async () => {
  mockFichaje({ zonas: [ZONA_PRINCIPAL], plantaEmpleado: NORTE.id });
  const json = await ficharEn(ZONA_PRINCIPAL.lat, ZONA_PRINCIPAL.lng);
  assert.equal(json.ok, true, JSON.stringify(json));
});

// ─── Pantalla ───────────────────────────────────────────────────────────────

function panel(plantas, rol = "gerencial") {
  return render(
    <AuthContext.Provider value={{ plantas, usuario: { rol }, recargarConfig: async () => {} }}>
      <PlantasPanel />
    </AuthContext.Provider>
  );
}

test("PlantasPanel — con una planta: su nombre y la invitación a sumar otra", () => {
  panel([PRINCIPAL]);
  assert.ok(screen.getByText("Planta principal"));
  assert.ok(screen.getByText(/Trabajan en más de un lugar/));
  assert.equal(screen.queryByText("Quitar"), null);
  fireEvent.click(screen.getByText("+ Agregar planta"));
  assert.ok(screen.getByLabelText("Nombre de la planta nueva"));
});

test("PlantasPanel — con varias: la principal marcada y solo las otras se pueden quitar; el operario solo mira", () => {
  panel([PRINCIPAL, NORTE]);
  assert.ok(screen.getByText("Plantas (2)"));
  assert.ok(screen.getByText("Principal"));
  assert.equal(screen.getAllByText("Quitar").length, 1);
  cleanup();
  panel([PRINCIPAL, NORTE], "operativo");
  assert.equal(screen.queryByText("+ Agregar planta"), null);
  assert.equal(screen.queryByText("Cambiar nombre"), null);
  cleanup();
  const { container } = panel([]);
  assert.equal(container.innerHTML, "", "sin la migración no se muestra nada");
});

test("Personal y Ubicaciones — la pregunta de planta aparece solo con más de una", () => {
  const personal = readFileSync(new URL("../app/gestion_personal_screen.jsx", import.meta.url), "utf8");
  assert.match(personal, /plantas\.length > 1 && \(\s*<div className="mb-3">\s*<label htmlFor="empleado-planta"/);
  const ubic = readFileSync(new URL("../app/geolocalizacion_screen.jsx", import.meta.url), "utf8");
  assert.match(ubic, /<PlantasPanel \/>/);
  assert.match(ubic, /plantas\.length > 1 && \(\s*<div className="mb-3">\s*<label htmlFor="ubicacion-planta"/);
});
