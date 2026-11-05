// tests/supervisor-division.test.js — El Supervisor (administrativo con
// solo_su_division) puede lo mismo que el Dueño desde el 05/11 (antes estaba
// limitado a su división, D2). Facturación y nombrar supervisores siguen
// siendo solo del dueño.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { esSupervisorSesion, comoDueno, _limpiarCacheAlcance } = await import("../app/lib/alcance.js");
const { POST: planificacion } = await import("../app/api/planificacion/route.js");
const { POST: data } = await import("../app/api/data/route.js");
const empleadosRoute = await import("../app/api/empleados/route.js");
const { GET: liquidacion } = await import("../app/api/reportes/liquidacion/route.js");
const { POST: crearSuscripcion } = await import("../app/api/billing/create-subscription/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const SUPER_ID = "33333333-3333-3333-3333-333333333333";
const DE_SU_DIVISION = { id: "44444444-4444-4444-4444-444444444444", legajo: 21 };
const DE_OTRA = { id: "55555555-5555-5555-5555-555555555555", legajo: 99 };

beforeEach(() => _limpiarCacheAlcance());

async function token(rol, empleadoId = SUPER_ID) {
  return (await signAccessToken({ empleadoId, empresaId: EMPRESA_ID, legajo: 5, rol })).token;
}

// El que pide es supervisor de "herreria" (o administrador si supervisor=false)
function soy({ supervisor = true, division = "herreria" } = {}) {
  return [
    {
      match: (url) => url.includes("select=id,solo_su_division"),
      respond: () => ({ status: 200, body: [{ id: SUPER_ID, division, solo_su_division: supervisor }] }),
    },
  ];
}

// ── lib/alcance ──

test("esSupervisorSesion / comoDueno — solo un administrativo marcado es supervisor", async () => {
  global.fetch = createFetchMock([...soy({ supervisor: false })]);
  assert.equal(await esSupervisorSesion({ rol: "administrativo", empleado_id: SUPER_ID, empresa_id: EMPRESA_ID }), false);
  assert.equal(await comoDueno({ rol: "administrativo", empleado_id: SUPER_ID, empresa_id: EMPRESA_ID }), false);
  assert.equal(await comoDueno({ rol: "gerencial", empleado_id: SUPER_ID, empresa_id: EMPRESA_ID }), true);
  assert.equal(await comoDueno({ rol: "operativo", empleado_id: SUPER_ID, empresa_id: EMPRESA_ID }), false);

  _limpiarCacheAlcance();
  global.fetch = createFetchMock([...soy()]);
  assert.equal(await esSupervisorSesion({ rol: "administrativo", empleado_id: SUPER_ID, empresa_id: EMPRESA_ID }), true);
  assert.equal(await comoDueno({ rol: "administrativo", empleado_id: SUPER_ID, empresa_id: EMPRESA_ID }), true);
});

test("esSupervisorSesion — sin la migración 075 nadie es supervisor; otro error corta", async () => {
  global.fetch = createFetchMock([
    { match: (url) => url.includes("solo_su_division"), respond: () => ({ status: 400, body: { message: "column empleados.solo_su_division does not exist" } }) },
  ]);
  assert.equal(await esSupervisorSesion({ rol: "administrativo", empleado_id: SUPER_ID, empresa_id: EMPRESA_ID }), false);

  _limpiarCacheAlcance();
  global.fetch = createFetchMock([{ match: (url) => url.includes("solo_su_division"), respond: () => ({ status: 503, body: "caído" }) }]);
  await assert.rejects(esSupervisorSesion({ rol: "administrativo", empleado_id: SUPER_ID, empresa_id: EMPRESA_ID }));
});

// ── /api/data ──

function capturar(tabla, extra = []) {
  const llamadas = [];
  global.fetch = createFetchMock([
    ...extra,
    ...authPassHandlers(),
    { match: (url) => url.includes("/rest/v1/empresa?id=eq.") && url.includes("select=plan_activo"), respond: () => ({ status: 200, body: [{ plan_activo: "pro" }] }) },
    {
      match: (url) => url.includes(`/rest/v1/${tabla}`),
      respond: (url, opts) => {
        llamadas.push({ url: decodeURIComponent(url), method: opts?.method || "GET" });
        return { status: 200, body: [{ id: 1 }] };
      },
    },
  ]);
  return llamadas;
}

async function pedir(body, rol = "administrativo") {
  return data(new Request("http://localhost/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(rol)}` },
    body: JSON.stringify(body),
  }));
}

test("/api/data — el supervisor ve toda la empresa (sin filtro por división)", async () => {
  let llamadas = capturar("fichadas", soy());
  assert.equal((await pedir({ path: "fichadas?fecha=eq.2026-10-07" })).status, 200);
  assert.ok(!llamadas.at(-1).url.includes("legajo=in."));

  llamadas = capturar("empleados", soy());
  await pedir({ path: "empleados?select=id,nombre" });
  assert.ok(!llamadas.at(-1).url.includes("id=in."));

  llamadas = capturar("precios_ot", soy());
  assert.equal((await pedir({ path: "precios_ot?select=ot,precio" })).status, 200, "ve el precio de las OT");
});

test("/api/data — el supervisor carga y cambia datos de cualquier división", async () => {
  capturar("solicitudes", soy());
  const otra = await pedir({ method: "POST", path: "solicitudes", body: { legajo: DE_OTRA.legajo, empleado_id: DE_OTRA.id, nombre_empleado: "X", tipo: "permiso", motivo: "m" } });
  assert.notEqual(otra.status, 403);

  capturar("empleados", soy());
  const cambiarDivision = await pedir({ method: "PATCH", path: `empleados?id=eq.${DE_SU_DIVISION.id}`, body: { division: "muebles" } });
  assert.equal(cambiarDivision.status, 200);
});

test("/api/data — pagos y suscripciones son solo del dueño (tampoco el supervisor)", async () => {
  capturar("pagos", soy({ supervisor: false }));
  assert.equal((await pedir({ path: "pagos?select=id" }, "administrativo")).status, 403);
  capturar("pagos", soy());
  assert.equal((await pedir({ path: "pagos?select=id" }, "administrativo")).status, 403);
  capturar("pagos");
  assert.equal((await pedir({ path: "pagos?select=id" }, "gerencial")).status, 200);
});

// ── /api/empleados ──

function reqEmpleados(method, { id, body, rol = "administrativo" } = {}) {
  return token(rol).then((t) => new Request(`http://localhost/api/empleados${id ? `?id=${id}` : ""}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    body: body ? JSON.stringify(body) : undefined,
  }));
}

test("/api/empleados — el listado es solo de gestión", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  assert.equal((await empleadosRoute.GET(await reqEmpleados("GET", { rol: "operativo" }))).status, 403);
});

function handlersPatch(extra = [], alGuardar) {
  return [
    ...extra,
    ...authPassHandlers(),
    { match: (url, opts) => url.includes("empleados?id=eq.") && opts?.method === "PATCH", respond: (url, opts) => { const c = JSON.parse(opts.body); alGuardar(c); return { status: 200, body: [{ id: DE_OTRA.id, ...c }] }; } },
    { match: (url) => url.includes("empleados?id=eq."), respond: () => ({ status: 200, body: [{ id: DE_OTRA.id }] }) },
  ];
}

test("/api/empleados PATCH — el supervisor edita a cualquiera y marca instalador, división y planta", async () => {
  let cambios = null;
  global.fetch = createFetchMock(handlersPatch(soy(), (c) => { cambios = c; }));
  const res = await empleadosRoute.PATCH(await reqEmpleados("PATCH", { id: DE_OTRA.id, body: { nombre: "Ana", es_instalador: true, division: "muebles" } }));
  assert.equal(res.status, 200);
  assert.equal(cambios.nombre, "Ana");
  assert.equal(cambios.es_instalador, true);
  assert.equal(cambios.division, "muebles");

  global.fetch = createFetchMock(handlersPatch(soy(), () => {}));
  const mal = await empleadosRoute.PATCH(await reqEmpleados("PATCH", { id: DE_OTRA.id, body: { es_instalador: "si" } }));
  assert.equal(mal.status, 400);
});

test("/api/empleados PATCH — solo el dueño marca a un supervisor o cambia el rol", async () => {
  let cambios = null;
  global.fetch = createFetchMock(handlersPatch([], (c) => { cambios = c; }));
  await empleadosRoute.PATCH(await reqEmpleados("PATCH", { id: DE_SU_DIVISION.id, body: { solo_su_division: true }, rol: "gerencial" }));
  assert.equal(cambios.solo_su_division, true);

  for (const supervisor of [false, true]) {
    cambios = null;
    _limpiarCacheAlcance();
    global.fetch = createFetchMock(handlersPatch(soy({ supervisor }), (c) => { cambios = c; }));
    const res = await empleadosRoute.PATCH(await reqEmpleados("PATCH", { id: DE_SU_DIVISION.id, body: { solo_su_division: false, rol: "gerencial", nombre: "Ana" } }));
    assert.equal(res.status, 200);
    assert.equal(cambios.solo_su_division, undefined, "ni administración ni el supervisor lo cambian");
    assert.equal(cambios.rol, undefined);
  }
});

// ── Lo que antes era solo del dueño ──

test("planificación — el supervisor la guarda; un administrativo común no", async () => {
  const pedirPlan = async () => planificacion(new Request("http://localhost/api/planificacion", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token("administrativo")}` },
    body: JSON.stringify({}),
  }));
  const modulos = { match: (url) => url.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", modulos: null, modulos_apagados: [] }] }) };
  global.fetch = createFetchMock([...soy({ supervisor: false }), ...authPassHandlers(), modulos]);
  const comun = await pedirPlan();
  assert.equal(comun.status, 403);

  _limpiarCacheAlcance();
  global.fetch = createFetchMock([...soy(), ...authPassHandlers(), modulos]);
  const sup = await pedirPlan();
  assert.notEqual(sup.status, 403, "el supervisor pasa el control (el cuerpo vacío lo rechaza la validación)");
});

// ── Facturación ──

test("billing — cambiar el plan es solo del dueño", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  const res = await crearSuscripcion(new Request("http://localhost/api/billing/create-subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token("administrativo")}` },
    body: JSON.stringify({ plan: "pro" }),
  }));
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /dueño/);
});
