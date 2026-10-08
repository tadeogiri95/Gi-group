// tests/pin.test.js — PIN de 4 números del operario (F4-06, D7): reglas,
// ingreso con legajo + PIN (con bloqueo por intentos) y alta/borrado del PIN.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { problemaPin, minutosBloqueo, registrarFalloPin, MAX_INTENTOS_PIN, MAX_FALLOS_TOTALES_PIN } = await import("../app/lib/pin.js");
const { POST: login } = await import("../app/api/login-empresa/route.js");
const { POST: crearPin, DELETE: borrarPin } = await import("../app/api/pin/route.js");
const { signAccessToken } = await import("../app/lib/jwt.ts");
const { validarConsulta } = await import("../app/lib/dataPolicy.js");
const { usuarioSeguro } = await import("../app/lib/usuarioSeguro.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const EMPLEADO_ID = "22222222-2222-2222-2222-222222222222";
const PIN_OK = "2580";
let PIN_HASH;
before(async () => { PIN_HASH = await bcrypt.hash(PIN_OK, 10); });

// ── Reglas ──

test("problemaPin — exige 4 números y rechaza repetidos y escaleras", () => {
  assert.equal(problemaPin("2580"), null);
  assert.equal(problemaPin("1357"), null);
  assert.match(problemaPin("123"), /4 números/);
  assert.match(problemaPin("12a4"), /4 números/);
  assert.match(problemaPin(1234), /4 números/);
  assert.match(problemaPin("7777"), /repita/);
  assert.match(problemaPin("1234"), /escalera/);
  assert.match(problemaPin("9876"), /escalera/);
  assert.match(problemaPin("0123"), /escalera/);
});

test("registrarFalloPin / minutosBloqueo — bloquea 15 min cada 5 fallos y borra el PIN a los 15", () => {
  const ahora = Date.parse("2026-10-07T12:00:00Z");
  assert.deepEqual(registrarFalloPin({ pin_intentos: 0 }, ahora), { cambios: { pin_intentos: 1 }, bloqueado: false, borrado: false, restantes: 4 });
  const quinto = registrarFalloPin({ pin_intentos: MAX_INTENTOS_PIN - 1 }, ahora);
  assert.equal(quinto.bloqueado, true);
  assert.equal(quinto.cambios.pin_intentos, 5, "el contador sigue: los fallos son seguidos");
  assert.equal(minutosBloqueo({ pin_bloqueado_hasta: quinto.cambios.pin_bloqueado_hasta }, ahora), 15);
  assert.equal(minutosBloqueo({ pin_bloqueado_hasta: quinto.cambios.pin_bloqueado_hasta }, ahora + 16 * 60000), 0);
  assert.equal(minutosBloqueo({ pin_bloqueado_hasta: null }, ahora), 0);
  assert.equal(registrarFalloPin({ pin_intentos: 6 }, ahora).restantes, 3, "después del bloqueo vuelven a quedar intentos");
  assert.equal(registrarFalloPin({ pin_intentos: 9 }, ahora).bloqueado, true);
  const ultimo = registrarFalloPin({ pin_intentos: MAX_FALLOS_TOTALES_PIN - 1 }, ahora);
  assert.equal(ultimo.borrado, true);
  assert.deepEqual(ultimo.cambios, { pin_hash: null, pin_intentos: 0, pin_bloqueado_hasta: null });
});

test("el PIN nunca sale del servidor: ni en /api/data ni en el usuario de la sesión", () => {
  assert.ok(validarConsulta("empleados", "empleados?select=id,pin_hash"));
  assert.ok(validarConsulta("empleados", "empleados?pin_hash=like.$2*"));
  const u = usuarioSeguro({ id: "x", pin_hash: "$2a$...", pin_intentos: 2, pin_bloqueado_hasta: null });
  assert.deepEqual(u, { id: "x", tiene_pin: true });
  assert.equal(usuarioSeguro({ id: "x", pin_hash: null }).tiene_pin, false);
});

// ── Ingreso con legajo + PIN ──

function reqLogin(body) {
  return new Request("http://localhost/api/login-empresa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function servidorLogin(empleado, { rateLimit = 0 } = {}) {
  const patches = [];
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/rpc/rpc_login_attempt"), respond: () => ({ status: 200, body: rateLimit }) },
    {
      match: (url, opts) => url.includes("/rest/v1/empleados?id=eq.") && opts?.method === "PATCH",
      respond: (url, opts) => { patches.push(JSON.parse(opts.body)); return { status: 200, body: [{}] }; },
    },
    { match: (url) => url.includes("/rest/v1/empleados?legajo=eq."), respond: () => ({ status: 200, body: empleado ? [empleado] : [] }) },
    { match: (url, opts) => url.includes("/rest/v1/sesiones") && opts?.method === "POST", respond: () => ({ status: 201, body: [{ id: "s" }] }) },
    { match: (url) => url.includes("/rest/v1/empresa"), respond: () => ({ status: 200, body: [{ id: EMPRESA_ID, slug: "gi-group" }] }) },
  ]);
  return patches;
}

const OPERARIO = () => ({ id: EMPLEADO_ID, empresa_id: EMPRESA_ID, legajo: 7, rol: "operativo", nombre: "Ana", apodo: "Ana", activo: true, password: "$2a$x", pin_hash: PIN_HASH, pin_intentos: 0, pin_bloqueado_hasta: null });

test("login con PIN — correcto: entra con cookies y sin datos del PIN", async () => {
  servidorLogin(OPERARIO());
  const res = await login(reqLogin({ legajo: "7", pin: PIN_OK, empresa_id: EMPRESA_ID }));
  assert.equal(res.status, 200);
  const { usuario } = await res.json();
  assert.equal(usuario.id, EMPLEADO_ID);
  assert.equal(usuario.pin_hash, undefined);
  assert.equal(usuario.tiene_pin, true);
  assert.ok((res.headers.get("set-cookie") || "").includes("gypi_token="));
});

test("login con PIN — correcto después de fallos: reinicia el contador", async () => {
  const patches = servidorLogin({ ...OPERARIO(), pin_intentos: 3 });
  const res = await login(reqLogin({ legajo: 7, pin: PIN_OK, empresa_id: EMPRESA_ID }));
  assert.equal(res.status, 200);
  assert.deepEqual(patches, [{ pin_intentos: 0, pin_bloqueado_hasta: null }]);
});

test("login con PIN — incorrecto: 401, suma el intento y avisa cuando quedan pocos", async () => {
  let patches = servidorLogin(OPERARIO());
  let res = await login(reqLogin({ legajo: "7", pin: "1111", empresa_id: EMPRESA_ID }));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "Legajo o PIN incorrectos.");
  assert.deepEqual(patches, [{ pin_intentos: 1 }]);

  patches = servidorLogin({ ...OPERARIO(), pin_intentos: 2 });
  res = await login(reqLogin({ legajo: "7", pin: "1111", empresa_id: EMPRESA_ID }));
  assert.match((await res.json()).error, /Te quedan 2 intentos/);
});

test("login con PIN — al 5.º fallo bloquea el PIN (429)", async () => {
  const patches = servidorLogin({ ...OPERARIO(), pin_intentos: 4 });
  const res = await login(reqLogin({ legajo: "7", pin: "1111", empresa_id: EMPRESA_ID }));
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /bloqueado/);
  assert.ok(patches[0].pin_bloqueado_hasta);
});

test("login con PIN — a los 15 fallos seguidos borra el PIN", async () => {
  const patches = servidorLogin({ ...OPERARIO(), pin_intentos: 14 });
  const res = await login(reqLogin({ legajo: "7", pin: "1111", empresa_id: EMPRESA_ID }));
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /borramos tu PIN/);
  assert.equal(patches[0].pin_hash, null);
});

test("login con PIN — bloqueado: no prueba el PIN aunque sea correcto", async () => {
  const hasta = new Date(Date.now() + 10 * 60000).toISOString();
  servidorLogin({ ...OPERARIO(), pin_bloqueado_hasta: hasta });
  const res = await login(reqLogin({ legajo: "7", pin: PIN_OK, empresa_id: EMPRESA_ID }));
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /Probá en 10 min o pedile a administración un PIN nuevo/);
});

test("login con PIN — gestión no entra con PIN; sin PIN creado tampoco", async () => {
  servidorLogin({ ...OPERARIO(), rol: "gerencial" });
  assert.equal((await login(reqLogin({ legajo: "7", pin: PIN_OK, empresa_id: EMPRESA_ID }))).status, 401);
  servidorLogin({ ...OPERARIO(), pin_hash: null });
  assert.equal((await login(reqLogin({ legajo: "7", pin: PIN_OK, empresa_id: EMPRESA_ID }))).status, 401);
  servidorLogin(null);
  assert.equal((await login(reqLogin({ legajo: "7", pin: PIN_OK, empresa_id: EMPRESA_ID }))).status, 401);
});

test("login con PIN — formato inválido (email, PIN de 6) devuelve 400", async () => {
  servidorLogin(OPERARIO());
  assert.equal((await login(reqLogin({ legajo: "ana@x.com", pin: PIN_OK, empresa_id: EMPRESA_ID }))).status, 400);
  assert.equal((await login(reqLogin({ legajo: "7", pin: "123456", empresa_id: EMPRESA_ID }))).status, 400);
});

test("login con PIN — respeta el límite de intentos por IP", async () => {
  servidorLogin(OPERARIO(), { rateLimit: 11 });
  assert.equal((await login(reqLogin({ legajo: "7", pin: PIN_OK, empresa_id: EMPRESA_ID }))).status, 429);
});

// ── Crear / borrar el PIN ──

async function reqPin(method, body, rol = "operativo") {
  const { token } = await signAccessToken({ empleadoId: EMPLEADO_ID, empresaId: EMPRESA_ID, legajo: 7, rol });
  return new Request("http://localhost/api/pin", {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function servidorPin() {
  const patches = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    {
      match: (url, opts) => url.includes("/rest/v1/empleados?id=eq.") && opts?.method === "PATCH",
      respond: (url, opts) => { patches.push({ url, body: JSON.parse(opts.body) }); return { status: 200, body: [{ id: EMPLEADO_ID }] }; },
    },
  ]);
  return patches;
}

test("/api/pin — sin sesión 401; gestión 403", async () => {
  servidorPin();
  assert.equal((await crearPin(new Request("http://localhost/api/pin", { method: "POST", body: "{}" }))).status, 401);
  assert.equal((await crearPin(await reqPin("POST", { pin: PIN_OK }, "gerencial"))).status, 403);
});

test("/api/pin — rechaza PIN fáciles", async () => {
  const patches = servidorPin();
  const res = await crearPin(await reqPin("POST", { pin: "1234" }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /escalera/);
  assert.equal(patches.length, 0);
});

test("/api/pin — guarda solo el hash, sobre el propio empleado y su empresa", async () => {
  const patches = servidorPin();
  const res = await crearPin(await reqPin("POST", { pin: PIN_OK }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, tiene_pin: true });
  const [p] = patches;
  assert.ok(p.url.includes(`id=eq.${EMPLEADO_ID}`) && p.url.includes(`empresa_id=eq.${EMPRESA_ID}`));
  assert.notEqual(p.body.pin_hash, PIN_OK);
  assert.ok(await bcrypt.compare(PIN_OK, p.body.pin_hash));
  assert.equal(p.body.pin_intentos, 0);
});

test("/api/pin DELETE — borra el PIN", async () => {
  const patches = servidorPin();
  const res = await borrarPin(await reqPin("DELETE"));
  assert.equal(res.status, 200);
  assert.deepEqual(patches[0].body, { pin_hash: null, pin_intentos: 0, pin_bloqueado_hasta: null });
});
