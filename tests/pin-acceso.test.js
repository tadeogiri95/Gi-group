// tests/pin-acceso.test.js — Reforma UX R6: el operario entra con PIN.
// Activa su cuenta eligiendo un PIN de 4 números (sin contraseña con
// mayúsculas) y administración le puede dar o reiniciar el PIN, así el que no
// tiene celular ficha en el kiosco desde el primer día.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { _resetBuckets } from "../app/lib/rateLimitMemory.js";
import { hashCodigo } from "../app/lib/activacion.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { POST: unirse } = await import("../app/api/unirse/route.js");
const { POST: darPin } = await import("../app/api/empleados/pin/route.js");
const { pinAleatorio } = await import("../app/lib/pinServidor.js");
const { problemaPin } = await import("../app/lib/pin.js");
const { signAccessToken } = await import("../app/lib/jwt.ts");

const E = "11111111-1111-1111-1111-111111111111";
const YO = "22222222-2222-2222-2222-222222222222";
const OP = "33333333-3333-3333-3333-333333333333";
const CODIGO = "K7P2-M9QX";
const FUTURO = new Date(Date.now() + 86_400_000).toISOString();

beforeEach(() => _resetBuckets());

// ─── Activación con PIN ─────────────────────────────────────────────────────

function mockUnirse(rol = "operativo") {
  const llamadas = { patch: null };
  global.fetch = createFetchMock([
    { match: (u) => u.includes("/rest/v1/empresa?slug=eq."), respond: () => ({ status: 200, body: [{ id: E, nombre: "Acme", nombre_corto: "Acme", activa: true }] }) },
    {
      match: (u, o) => u.includes("/rest/v1/empleados?empresa_id=eq.") && (!o?.method || o.method === "GET"),
      respond: (u) => ({ status: 200, body: u.includes(hashCodigo(CODIGO)) ? [{ id: OP, nombre: "Juan Pérez", apodo: "Juan", legajo: 7, rol, activacion_expira: FUTURO }] : [] }),
    },
    { match: (u, o) => u.includes("/rest/v1/empleados?id=eq.") && o?.method === "PATCH", respond: (u, o) => { llamadas.patch = JSON.parse(o.body); return { status: 200, body: [{ id: OP }] }; } },
    { match: (u) => u.includes("/rest/v1/sesiones"), respond: () => ({ status: 200, body: [] }) },
  ]);
  return llamadas;
}
const pedirUnirse = (body) => unirse(new Request("http://localhost/api/unirse", {
  method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "9.9.9.9" },
  body: JSON.stringify({ slug: "acme", codigo: CODIGO, ...body }),
}));

test("unirse — verificar dice el rol: al operario se le ofrece PIN", async () => {
  mockUnirse();
  const json = await (await pedirUnirse({ action: "verificar" })).json();
  assert.equal(json.rol, "operativo");
  assert.equal(json.legajo, 7);
});

test("unirse — el operario activa con un PIN: se guarda el hash, sin contraseña ni cambio obligatorio", async () => {
  const llamadas = mockUnirse();
  const res = await pedirUnirse({ action: "activar", pin: "4829" });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.con_pin, true);
  assert.equal(json.legajo, 7);
  const p = llamadas.patch;
  assert.ok(await bcrypt.compare("4829", p.pin_hash));
  assert.equal(p.password, undefined, "la contraseña no se toca");
  assert.equal(p.estado_activacion, "activo");
  assert.equal(p.debe_cambiar_password, false);
  assert.equal(p.activacion_codigo_hash, null);
});

test("unirse — PIN débil o gestión con PIN: no se activa", async () => {
  let llamadas = mockUnirse();
  let res = await pedirUnirse({ action: "activar", pin: "1234" });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /escalera/);
  assert.equal(llamadas.patch, null);

  llamadas = mockUnirse("gerencial");
  res = await pedirUnirse({ action: "activar", pin: "4829" });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /entra con contraseña/);
  assert.equal(llamadas.patch, null);
});

test("unirse — sigue funcionando con contraseña para quien la prefiera", async () => {
  const llamadas = mockUnirse();
  const res = await pedirUnirse({ action: "activar", password: "Segura123" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).con_pin, false);
  assert.ok(await bcrypt.compare("Segura123", llamadas.patch.password));
  assert.equal(llamadas.patch.pin_hash, undefined);
});

// ─── Administración da el PIN ───────────────────────────────────────────────

test("pinAleatorio — siempre 4 números que cumplen las reglas", () => {
  for (let i = 0; i < 300; i++) {
    const pin = pinAleatorio();
    assert.match(pin, /^\d{4}$/);
    assert.equal(problemaPin(pin), null, pin);
  }
});

function mockDarPin({ rol = "operativo" } = {}) {
  const llamadas = { patch: null, auditoria: null };
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empleados?id=eq.") && u.includes("select=id,legajo,nombre,rol"), respond: () => ({ status: 200, body: [{ id: OP, legajo: 7, nombre: "Juan Pérez", rol }] }) },
    { match: (u, o) => u.includes("/rest/v1/empleados?id=eq.") && o?.method === "PATCH", respond: (u, o) => { llamadas.patch = JSON.parse(o.body); return { status: 200, body: [{ id: OP }] }; } },
    { match: (u, o) => u.includes("/rest/v1/audit_log") && o?.method === "POST", respond: (u, o) => { llamadas.auditoria = JSON.parse(o.body); return { status: 201, body: [] }; } },
  ]);
  return llamadas;
}
async function pedirPin(rolSesion = "administrativo", empleado_id = OP) {
  const { token } = await signAccessToken({ empleadoId: YO, empresaId: E, legajo: 1, rol: rolSesion });
  return darPin(new Request("http://localhost/api/empleados/pin", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ empleado_id }),
  }));
}

test("dar PIN — administración genera uno nuevo; la cuenta queda lista para entrar", async () => {
  const llamadas = mockDarPin();
  const res = await pedirPin();
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(problemaPin(json.pin), null);
  assert.equal(json.legajo, 7);
  const p = llamadas.patch;
  assert.ok(await bcrypt.compare(json.pin, p.pin_hash));
  assert.equal(p.pin_intentos, 0);
  assert.equal(p.pin_bloqueado_hasta, null);
  assert.equal(p.estado_activacion, "activo");
  assert.equal(p.debe_cambiar_password, false);
  assert.equal(res.headers.get("Cache-Control"), "private, no-store");
});

test("dar PIN — solo gestión, solo a operarios", async () => {
  mockDarPin();
  assert.equal((await pedirPin("operativo")).status, 403);
  const llamadas = mockDarPin({ rol: "gerencial" });
  const res = await pedirPin("gerencial");
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /solo para operarios/);
  assert.equal(llamadas.patch, null);
  mockDarPin();
  assert.equal((await pedirPin("gerencial", "no-es-uuid")).status, 400);
});

test("mensajes — si el PIN se bloquea, se le dice que pida uno a administración", () => {
  const src = readFileSync(new URL("../app/lib/pinServidor.js", import.meta.url), "utf8");
  assert.match(src, /alBloquear = "pedile a administración un PIN nuevo"/);
  assert.match(src, /Pedile a administración uno nuevo/);
  const login = readFileSync(new URL("../app/components/screens/LoginScreen.jsx", import.meta.url), "utf8");
  assert.match(login, /¿Te olvidaste el PIN\? Pedile uno nuevo a administración\./);
});

test("pantallas — activación con PIN por defecto para operarios y botón 'Dar PIN' en Equipo", () => {
  const unirsePage = readFileSync(new URL("../app/[slug]/unirse/page.js", import.meta.url), "utf8");
  assert.match(unirsePage, /setUsarPin\(data\.rol === "operativo"\)/);
  assert.match(unirsePage, /Prefiero una contraseña/);
  assert.match(unirsePage, /recordarLegajoPin\(slug/);
  const equipo = readFileSync(new URL("../app/gestion_personal_screen.jsx", import.meta.url), "utf8");
  assert.match(equipo, /apiFetch\("\/api\/empleados\/pin"/);
  assert.match(equipo, />\s*Dar PIN\s*</);
  assert.match(equipo, /no se vuelve a mostrar/);
});
