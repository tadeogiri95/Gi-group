// tests/cuenta-en-pausa.test.jsx — Solo versión paga con prueba de 30 días (D20, ítem 25):
// la prueba arranca sola y, sin plan vigente, no se cargan datos nuevos.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";

const { planVigente, DIAS_TRIAL } = await import("../app/lib/plans.js");
const { rechazarSiSinPlan, invalidarCachePlan } = await import("../app/lib/planEnforcement.js");
const { iniciarTrialEmpresa } = await import("../app/lib/empresaSignup.js");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST: data } = await import("../app/api/data/route.js");
const { POST: fichar } = await import("../app/api/fichar/route.js");
const { POST: actividad } = await import("../app/api/actividad/route.js");
const { default: CuentaEnPausa } = await import("../app/components/CuentaEnPausa.jsx");

afterEach(() => cleanup());

const E = "11111111-1111-1111-1111-111111111111";

test("planVigente — 'free' es la cuenta en pausa; prueba y planes pagos están vigentes", () => {
  assert.equal(DIAS_TRIAL, 30);
  for (const p of ["trial", "starter", "pro", "enterprise"]) assert.equal(planVigente(p), true, p);
  assert.equal(planVigente("free"), false);
  assert.equal(planVigente(null), false);
});

function planEs(plan, status = 200) {
  return { match: (url) => url.includes("/rest/v1/empresa?id=eq.") && url.includes("select=plan_activo,plan_vence"), respond: () => ({ status, body: status === 200 ? [{ plan_activo: plan }] : { message: "caído" } }) };
}

test("rechazarSiSinPlan — corta con 402 sin plan; deja pasar con plan o si la base no responde", async () => {
  invalidarCachePlan(E);
  global.fetch = createFetchMock([planEs("free")]);
  const r = await rechazarSiSinPlan(E);
  assert.equal(r.status, 402);
  assert.equal((await r.json()).tipo, "sin_plan");

  invalidarCachePlan(E);
  global.fetch = createFetchMock([planEs("trial")]);
  assert.equal(await rechazarSiSinPlan(E), null);

  invalidarCachePlan(E);
  global.fetch = createFetchMock([planEs(null, 503)]);
  assert.equal(await rechazarSiSinPlan(E), null, "un corte de la base no bloquea a nadie");
});

async function tk(rol = "operativo") {
  return (await signAccessToken({ empleadoId: "22222222-2222-2222-2222-222222222222", empresaId: E, legajo: 7, rol })).token;
}

test("/api/data — en pausa se puede leer pero no cargar", async () => {
  invalidarCachePlan(E);
  let escrito = false;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    planEs("free"),
    { match: (url, o) => url.includes("/rest/v1/solicitudes") && o?.method === "POST", respond: () => { escrito = true; return { status: 201, body: [{}] }; } },
    { match: (url) => url.includes("/rest/v1/solicitudes"), respond: () => ({ status: 200, body: [{ id: 1 }] }) },
  ]);
  const pedir = async (body) => data(new Request("http://localhost/api/data", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await tk()}` }, body: JSON.stringify(body) }));
  const lectura = await pedir({ path: "solicitudes?select=id" });
  assert.equal(lectura.status, 200);
  const carga = await pedir({ method: "POST", path: "solicitudes", body: { legajo: 7, empleado_id: "22222222-2222-2222-2222-222222222222", nombre_empleado: "Ana", tipo: "permiso", motivo: "x", fecha: "2026-10-08" } });
  assert.equal(carga.status, 402);
  assert.equal((await carga.json()).tipo, "sin_plan");
  assert.equal(escrito, false);
});

test("/api/fichar — en pausa no se ficha (con el plan leído de la base)", async () => {
  let fichada = false;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url) => url.includes("select=timezone,plan_activo"), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "free" }] }) },
    { match: (url, o) => url.includes("/rest/v1/fichadas") && o?.method === "POST", respond: () => { fichada = true; return { status: 201, body: [{}] }; } },
  ]);
  const res = await fichar(new Request("http://localhost/api/fichar", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await tk()}` }, body: JSON.stringify({ accion: "ingreso" }) }));
  assert.equal(res.status, 402);
  assert.equal(fichada, false);
});

test("/api/actividad — en pausa no se cargan tareas (tampoco las guardadas sin conexión)", async () => {
  invalidarCachePlan(E);
  let tocada = false;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    planEs("free"),
    { match: (url) => url.includes("/rest/v1/registro_actividades") || url.includes("/rest/v1/operaciones_offline"), respond: () => { tocada = true; return { status: 201, body: [{}] }; } },
  ]);
  const res = await actividad(new Request("http://localhost/api/actividad", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await tk()}` }, body: JSON.stringify({ accion: "iniciar", etapa: 1, codigo_proyecto: "OT-1" }) }));
  assert.equal(res.status, 402);
  assert.equal((await res.json()).tipo, "sin_plan");
  assert.equal(tocada, false);
});

test("iniciarTrialEmpresa — con la función de la base pasa a 'trial'; si ya usó la prueba no la reabre", async () => {
  let patch = null;
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/rpc/iniciar_trial_pro"), respond: () => ({ status: 200, body: '"susc-1"' }) },
    { match: (url, o) => url.includes("/rest/v1/empresa?id=eq.") && o?.method === "PATCH", respond: (url, o) => { patch = JSON.parse(o.body); return { status: 200, body: [{}] }; } },
  ]);
  assert.equal(await iniciarTrialEmpresa(E), true);
  assert.equal(patch.plan_activo, "trial");

  patch = null;
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/rpc/iniciar_trial_pro"), respond: () => ({ status: 200, body: null }) },
    { match: (url, o) => o?.method === "PATCH", respond: (url, o) => { patch = JSON.parse(o.body); return { status: 200, body: [{}] }; } },
  ]);
  assert.equal(await iniciarTrialEmpresa(E), false);
  assert.equal(patch, null, "no se pasa a 'trial' una empresa que ya usó la prueba");
});

test("iniciarTrialEmpresa — si la función falla, el respaldo crea 30 días con un gateway que la base acepta", async () => {
  let susc = null;
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/rpc/iniciar_trial_pro"), respond: () => ({ status: 500, body: { message: "caído" } }) },
    { match: (url, o) => url.includes("/rest/v1/suscripciones") && o?.method === "POST", respond: (url, o) => { susc = JSON.parse(o.body); return { status: 201, body: [{ id: "s1" }] }; } },
    { match: (url, o) => url.includes("/rest/v1/empresa") && o?.method === "PATCH", respond: () => ({ status: 200, body: [{}] }) },
  ]);
  assert.equal(await iniciarTrialEmpresa(E), true);
  assert.equal(susc.gateway, "manual");
  const dias = (Date.parse(susc.trial_fin) - Date.now()) / 86400000;
  assert.ok(dias > 29.9 && dias <= 30, `trial de 30 días, fue ${dias}`);
});

test("CuentaEnPausa — el dueño puede elegir un plan; el resto ve el aviso", () => {
  render(<CuentaEnPausa usuario={{ rol: "gerencial" }} empresa={{ nombre: "Acme" }} onLogout={() => {}} />);
  assert.ok(screen.getByText("La cuenta de Acme está en pausa"));
  assert.ok(screen.getByText("Elegir un plan"));
  cleanup();
  render(<CuentaEnPausa usuario={{ rol: "operativo" }} empresa={{ nombre: "Acme" }} onLogout={() => {}} />);
  assert.equal(screen.queryByText("Elegir un plan"), null);
  assert.ok(screen.getByText(/Avisale a tu encargado/));
});
