// tests/sesion-persistente.test.js — Sesión que sobrevive al cerrar la app (F1-03):
// GET /api/me, restaurarSesion() del cliente y redirección de la app instalada.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { GET } = await import("../app/api/me/route.js");
const { restaurarSesion } = await import("../app/lib/restaurarSesion.js");
const { destinoAppInstalada } = await import("../app/lib/ultimaEmpresa.js");
const { usuarioSeguro } = await import("../app/lib/usuarioSeguro.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";

const EMPLEADO = {
  id: EMPLEADO_ID, empresa_id: EMPRESA_ID, legajo: 7, nombre: "Ana Gómez", apodo: "Ana", rol: "operativo",
  password: "$2a$10$hash", password_reset_jti: "jti", activacion_codigo_hash: "abc", activacion_expira: "2026-10-20",
};
const EMPRESA = { id: EMPRESA_ID, nombre: "Gi Group", nombre_corto: "Gi", slug: "gi-group" };

async function reqConToken() {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol: "operativo" });
  return new Request("http://localhost/api/me", { headers: { Authorization: `Bearer ${token}` } });
}

function sbEmpleado(filas) {
  return { match: (url) => url.includes("/rest/v1/empleados?id=eq."), respond: () => ({ status: 200, body: filas }) };
}
function sbEmpresa() {
  return { match: (url) => /\/rest\/v1\/empresa\?id=eq\..*select=id,nombre/.test(url), respond: () => ({ status: 200, body: [EMPRESA] }) };
}

// ── /api/me ──

test("/api/me — sin sesión devuelve 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(new Request("http://localhost/api/me"));
  assert.equal(res.status, 401);
});

test("/api/me — devuelve el usuario con su empresa y sin contraseña ni secretos", async () => {
  let consultaEmpleado = "";
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url) => url.includes("/rest/v1/empleados?id=eq."), respond: (url) => { consultaEmpleado = url; return { status: 200, body: [EMPLEADO] }; } },
    sbEmpresa(),
  ]);
  const res = await GET(await reqConToken());
  assert.equal(res.status, 200);
  const { usuario } = await res.json();
  assert.equal(usuario.id, EMPLEADO_ID);
  assert.equal(usuario.empresa.slug, "gi-group");
  for (const c of ["password", "password_reset_jti", "activacion_codigo_hash", "activacion_expira"]) {
    assert.ok(!(c in usuario), `no expone ${c}`);
  }
  assert.ok(consultaEmpleado.includes(`empresa_id=eq.${EMPRESA_ID}`) && consultaEmpleado.includes("activo=eq.true"));
});

test("/api/me — empleado dado de baja devuelve 401", async () => {
  global.fetch = createFetchMock([...authPassHandlers(), sbEmpleado([]), sbEmpresa()]);
  const res = await GET(await reqConToken());
  assert.equal(res.status, 401);
});

test("usuarioSeguro — saca los campos privados sin tocar el original", () => {
  const u = usuarioSeguro(EMPLEADO);
  assert.equal(u.password, undefined);
  assert.equal(EMPLEADO.password, "$2a$10$hash");
});

// ── restaurarSesion (cliente) ──

function servidor({ me = [], refresh = 200 } = {}) {
  const llamadas = [];
  global.fetch = async (url) => {
    const u = String(url);
    llamadas.push(u);
    if (u === "/api/me") {
      const r = me.shift() ?? { status: 401 };
      return new Response(JSON.stringify(r.body ?? { error: "x" }), { status: r.status });
    }
    if (u === "/api/refresh-token") {
      return new Response(JSON.stringify(refresh === 200 ? { token: "eyJnuevo" } : { error: "x" }), { status: refresh });
    }
    throw new Error("fetch inesperado " + u);
  };
  return llamadas;
}

const USUARIO = { id: EMPLEADO_ID, empresa_id: EMPRESA_ID, empresa: EMPRESA };

test("restaurarSesion — con la cookie vigente devuelve el usuario", async () => {
  servidor({ me: [{ status: 200, body: { usuario: USUARIO } }] });
  const u = await restaurarSesion("gi-group");
  assert.equal(u.id, EMPLEADO_ID);
});

test("restaurarSesion — acceso vencido: renueva con la cookie de 30 días y reintenta", async () => {
  const llamadas = servidor({ me: [{ status: 401 }, { status: 200, body: { usuario: USUARIO } }] });
  const u = await restaurarSesion("gi-group");
  assert.equal(u.id, EMPLEADO_ID);
  assert.deepEqual(llamadas, ["/api/me", "/api/refresh-token", "/api/me"]);
});

test("restaurarSesion — sin sesión (no se puede renovar) devuelve null", async () => {
  servidor({ me: [{ status: 401 }], refresh: 401 });
  assert.equal(await restaurarSesion("gi-group"), null);
});

test("restaurarSesion — la sesión es de otra empresa: no la usa en este link", async () => {
  servidor({ me: [{ status: 200, body: { usuario: USUARIO } }] });
  assert.equal(await restaurarSesion("otra-empresa"), null);
});

test("restaurarSesion — sin red devuelve null", async () => {
  global.fetch = async () => { throw new TypeError("Failed to fetch"); };
  assert.equal(await restaurarSesion("gi-group"), null);
});

// ── Redirección de la app instalada ──

test("destinoAppInstalada — la app instalada va a la última empresa; el navegador ve la landing", () => {
  const ultima = { slug: "gi-group", nombre: "Gi" };
  assert.equal(destinoAppInstalada("?source=pwa", false, ultima), "/gi-group");
  assert.equal(destinoAppInstalada("", true, ultima), "/gi-group", "modo app (standalone)");
  assert.equal(destinoAppInstalada("", false, ultima), null, "navegador común: página comercial");
  assert.equal(destinoAppInstalada("?source=pwa", false, null), null, "sin empresa recordada");
});

test("manifest — la app instalada abre con ?source=pwa", async () => {
  const fs = await import("node:fs");
  const m = JSON.parse(fs.readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8"));
  assert.equal(m.start_url, "/?source=pwa");
});
