// tests/supervisor-division.test.js — Supervisor limitado a su división (D2, ítem 22)
// y facturación solo para el dueño.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { alcanceDe, filtroAlcance, dentroDelAlcance, _limpiarCacheAlcance } = await import("../app/lib/alcance.js");
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
      match: (url) => url.includes("select=id,legajo,division,solo_su_division"),
      respond: () => ({ status: 200, body: [{ id: SUPER_ID, legajo: 5, division, solo_su_division: supervisor }] }),
    },
    {
      match: (url) => url.includes("/rest/v1/empleados?empresa_id=eq.") && url.includes("division=eq.herreria") && url.includes("select=id,legajo"),
      respond: () => ({ status: 200, body: [DE_SU_DIVISION] }),
    },
  ];
}

// ── lib/alcance ──

test("alcanceDe — solo un administrativo marcado es supervisor", async () => {
  global.fetch = createFetchMock([...soy({ supervisor: false })]);
  assert.equal(await alcanceDe({ rol: "gerencial", empleado_id: SUPER_ID, empresa_id: EMPRESA_ID }), null);
  assert.equal(await alcanceDe({ rol: "administrativo", empleado_id: SUPER_ID, empresa_id: EMPRESA_ID }), null);

  _limpiarCacheAlcance();
  global.fetch = createFetchMock([...soy()]);
  const a = await alcanceDe({ rol: "administrativo", empleado_id: SUPER_ID, empresa_id: EMPRESA_ID });
  assert.equal(a.division, "herreria");
  assert.deepEqual(a.ids.sort(), [DE_SU_DIVISION.id, SUPER_ID].sort());
  assert.deepEqual(a.legajos.sort(), ["21", "5"]);
  assert.ok(dentroDelAlcance(a, { legajo: 21 }));
  assert.ok(!dentroDelAlcance(a, { id: DE_OTRA.id }));
  assert.match(filtroAlcance("fichadas", a), /^legajo=in\.\(/);
  assert.equal(filtroAlcance("proyectos", a), null, "catálogos de la empresa no se filtran");
});

test("alcanceDe — sin la migración 075 nadie es supervisor; otro error corta (no muestra de más)", async () => {
  global.fetch = createFetchMock([
    { match: (url) => url.includes("solo_su_division"), respond: () => ({ status: 400, body: { message: "column empleados.solo_su_division does not exist" } }) },
  ]);
  assert.equal(await alcanceDe({ rol: "administrativo", empleado_id: SUPER_ID, empresa_id: EMPRESA_ID }), null);

  _limpiarCacheAlcance();
  global.fetch = createFetchMock([{ match: (url) => url.includes("solo_su_division"), respond: () => ({ status: 503, body: "caído" }) }]);
  await assert.rejects(alcanceDe({ rol: "administrativo", empleado_id: SUPER_ID, empresa_id: EMPRESA_ID }));
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

test("/api/data — el supervisor solo ve fichadas y empleados de su división", async () => {
  let llamadas = capturar("fichadas", soy());
  assert.equal((await pedir({ path: "fichadas?fecha=eq.2026-10-07" })).status, 200);
  assert.match(llamadas.at(-1).url, /legajo=in\.\((21,5|5,21)\)/);

  _limpiarCacheAlcance();
  llamadas = capturar("empleados", soy());
  await pedir({ path: "empleados?select=id,nombre" });
  assert.match(llamadas.at(-1).url, /id=in\.\(/);
  assert.ok(!llamadas.at(-1).url.includes(DE_OTRA.id));
});

test("/api/data — un administrador (no supervisor) sigue viendo toda la empresa", async () => {
  const llamadas = capturar("fichadas", soy({ supervisor: false }));
  await pedir({ path: "fichadas?fecha=eq.2026-10-07" });
  assert.ok(!llamadas.at(-1).url.includes("legajo=in."));
});

test("/api/data — el supervisor no puede cargar ni cambiar datos de otra división", async () => {
  capturar("solicitudes", soy());
  const fuera = await pedir({ method: "POST", path: "solicitudes", body: { legajo: DE_OTRA.legajo, empleado_id: DE_OTRA.id, nombre_empleado: "X", tipo: "permiso", motivo: "m" } });
  assert.equal(fuera.status, 403);

  _limpiarCacheAlcance();
  capturar("empleados", soy());
  const cambiarDivision = await pedir({ method: "PATCH", path: `empleados?id=eq.${DE_SU_DIVISION.id}`, body: { division: "muebles" } });
  assert.equal(cambiarDivision.status, 403);

  _limpiarCacheAlcance();
  const llamadas = capturar("solicitudes", soy());
  await pedir({ method: "PATCH", path: "solicitudes?id=eq.10", body: { estado: "aprobado" } });
  assert.match(llamadas.at(-1).url, /legajo=in\./, "aprobar solo dentro de su división");
});

test("/api/data — pagos y suscripciones son solo del dueño", async () => {
  capturar("pagos", soy({ supervisor: false }));
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

test("/api/empleados PATCH — el supervisor no edita a alguien de otra división", async () => {
  global.fetch = createFetchMock([
    ...soy(),
    ...authPassHandlers(),
    { match: (url) => url.includes(`empleados?id=eq.${DE_OTRA.id}`) && url.includes("select=id&limit=1"), respond: () => ({ status: 200, body: [{ id: DE_OTRA.id }] }) },
  ]);
  const res = await empleadosRoute.PATCH(await reqEmpleados("PATCH", { id: DE_OTRA.id, body: { nombre: "X" } }));
  assert.equal(res.status, 403);
});

test("/api/empleados PATCH — solo el dueño marca a un supervisor", async () => {
  let cambios = null;
  const handlers = (extra = []) => [
    ...extra,
    ...authPassHandlers(),
    { match: (url, opts) => url.includes(`empleados?id=eq.${DE_SU_DIVISION.id}`) && opts?.method === "PATCH", respond: (url, opts) => { cambios = JSON.parse(opts.body); return { status: 200, body: [{ id: DE_SU_DIVISION.id, ...cambios }] }; } },
    { match: (url) => url.includes(`empleados?id=eq.${DE_SU_DIVISION.id}`), respond: () => ({ status: 200, body: [{ id: DE_SU_DIVISION.id }] }) },
  ];
  global.fetch = createFetchMock(handlers());
  await empleadosRoute.PATCH(await reqEmpleados("PATCH", { id: DE_SU_DIVISION.id, body: { solo_su_division: true }, rol: "gerencial" }));
  assert.equal(cambios.solo_su_division, true);

  cambios = null;
  global.fetch = createFetchMock(handlers(soy({ supervisor: false })));
  const res = await empleadosRoute.PATCH(await reqEmpleados("PATCH", { id: DE_SU_DIVISION.id, body: { solo_su_division: false, nombre: "Ana" } }));
  assert.equal(res.status, 200);
  assert.equal(cambios.solo_su_division, undefined, "un administrativo no lo puede cambiar");
});

// ── Rutas que todavía no filtran por división: el supervisor no entra ──

test("liquidación — un supervisor recibe 403", async () => {
  global.fetch = createFetchMock([...soy(), ...authPassHandlers()]);
  const res = await liquidacion(new Request("http://localhost/api/reportes/liquidacion?desde=2026-10-01&hasta=2026-10-07", { headers: { Authorization: `Bearer ${await token("administrativo")}` } }));
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /supervisor de división/);
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
