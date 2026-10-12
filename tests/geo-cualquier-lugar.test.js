// tests/geo-cualquier-lugar.test.js — Modos de control de ubicación por empleado
// Caso real: el dueño "sacó la ubicación requerida" a un empleado y la app se
// la seguía pidiendo, porque desactivar solo lo pasaba a "ubicaciones de la
// empresa". Ahora hay un modo "Cualquier lugar" (geo_config.libre = true).
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { _resetBuckets } from "../app/lib/rateLimitMemory.js";
import { modoGeo, configParaModo, avisoGeo, resumenGeo } from "../app/lib/geoConfig.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { POST } = await import("../app/api/fichar/route.js");
const { obtenerGeo } = await import("../app/lib/fichar.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

async function tokenValido() {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol: "empleado" });
  return token;
}

function req(body, token) {
  return new Request("http://localhost/api/fichar", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

// Empresa con una zona cargada; el empleado tiene el geo_config indicado.
function mockConZona(geoConfig) {
  return createFetchMock([
    ...authPassHandlers(),
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=timezone"), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "pro" }] }) },
    { match: (url) => url.includes("/rest/v1/geo_zonas"), respond: () => ({ status: 200, body: [{ id: 1, lat: -31.42, lng: -64.18, radio: 150, nombre: "Planta" }] }) },
    { match: (url) => url.includes("select=geo_config"), respond: () => ({ status: 200, body: [{ geo_config: geoConfig }] }) },
    { match: (url) => url.includes("select=reglas_asistencia"), respond: () => ({ status: 200, body: [{ reglas_asistencia: null }] }) },
    { match: (url) => url.includes("/rest/v1/fichadas") && url.includes("select=id,ingreso"), respond: () => ({ status: 200, body: [] }) },
    { match: (url) => url.includes("/rest/v1/empleados") && url.includes("select=diagrama"), respond: () => ({ status: 200, body: [{ diagrama: null }] }) },
    { match: (url, opts) => url.includes("/rest/v1/fichadas") && opts.method === "POST", respond: () => ({ status: 201, body: [{ id: "nueva" }] }) },
  ]);
}

beforeEach(() => _resetBuckets());

// ─── Modos ──────────────────────────────────────────────────────────────────
test("modoGeo — sin config o desactivado es 'empresa'; activo es 'asignada'; libre es 'libre'", () => {
  assert.equal(modoGeo(null), "empresa");
  assert.equal(modoGeo({ activo: false, ubicacion_id: null, radio: 150 }), "empresa");
  assert.equal(modoGeo({ activo: true, ubicacion_id: 2, radio: 150 }), "asignada");
  assert.equal(modoGeo({ activo: false, libre: true }), "libre");
});

test("configParaModo — cada modo arma su geo_config y conserva el radio", () => {
  assert.deepEqual(configParaModo("libre", { radio: 300 }), { activo: false, libre: true, ubicacion_id: null, radio: 300 });
  assert.deepEqual(configParaModo("asignada", { ubicacion_id: 5 }), { activo: true, libre: false, ubicacion_id: 5, radio: 150 });
  assert.deepEqual(configParaModo("empresa", { activo: true, ubicacion_id: 5, radio: 80 }), { activo: false, libre: false, ubicacion_id: null, radio: 80 });
});

test("avisoGeo — el aviso dice lo que de verdad pasa en cada modo", () => {
  assert.match(avisoGeo({ libre: true }).asunto, /cualquier lugar/);
  assert.match(avisoGeo({ activo: false }).detalle, /ubicación de la empresa/);
  assert.doesNotMatch(avisoGeo({ activo: false }).asunto, /cualquier lugar/);
  assert.match(avisoGeo({ activo: true, radio: 200 }, "Obra Norte").detalle, /Obra Norte \(radio 200m\)/);
  assert.equal(resumenGeo({ libre: true }), "Ficha desde cualquier lugar");
});

// ─── Servidor ───────────────────────────────────────────────────────────────
test("fichar — 'Cualquier lugar': ficha sin GPS aunque la empresa tenga zonas", async () => {
  global.fetch = mockConZona({ activo: false, libre: true, ubicacion_id: null, radio: 150 });
  const res = await POST(req({ accion: "ingreso" }, await tokenValido()));
  const json = await res.json();
  assert.notEqual(json.tipo, "geo_requerida");
  assert.equal(json.ok, true);
});

test("fichar — 'Cualquier lugar': ficha lejos de la zona", async () => {
  global.fetch = mockConZona({ activo: false, libre: true, ubicacion_id: null, radio: 150 });
  const res = await POST(req({ accion: "ingreso", geo_lat: -34.6, geo_lng: -58.4 }, await tokenValido()));
  const json = await res.json();
  assert.equal(json.ok, true);
});

test("fichar — 'Ubicaciones de la empresa' sigue pidiendo estar en una zona", async () => {
  global.fetch = mockConZona({ activo: false, ubicacion_id: null, radio: 150 });
  const sinGps = await (await POST(req({ accion: "ingreso" }, await tokenValido()))).json();
  assert.equal(sinGps.tipo, "geo_requerida");
  const lejos = await (await POST(req({ accion: "ingreso", geo_lat: -34.6, geo_lng: -58.4 }, await tokenValido()))).json();
  assert.equal(lejos.tipo, "fuera_de_zona");
});

// ─── Celular ────────────────────────────────────────────────────────────────
test("obtenerGeo — 'Cualquier lugar' no le pide el GPS al celular", async () => {
  const geo = await obtenerGeo({ geo_config: { libre: true } });
  assert.deepEqual(geo, { lat: null, lng: null, distancia: null, msg: null });
});
