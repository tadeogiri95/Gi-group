// tests/kiosco.test.js — Modo kiosco (D7, D11, ítem 19): activar/desactivar el
// dispositivo, fichar con legajo + PIN y que la cookie del kiosco no sirva
// como sesión de empleado.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { _resetBuckets } from "../app/lib/rateLimitMemory.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken, signKioscoToken } = await import("../app/lib/jwt.ts");
const { validarToken } = await import("../app/lib/auth.js");
const kioscoRoute = await import("../app/api/kiosco/route.js");
const { POST: ficharKiosco } = await import("../app/api/kiosco/fichar/route.js");
const { legajoDesdeQR } = await import("../app/lib/kioscoCliente.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const GERENTE_ID = "33333333-3333-3333-3333-333333333333";
const OPERARIO_ID = "22222222-2222-2222-2222-222222222222";
const PIN = "2580";
let PIN_HASH;
before(async () => { PIN_HASH = await bcrypt.hash(PIN, 10); });

beforeEach(() => _resetBuckets());

async function cookieKiosco() {
  const { token } = await signKioscoToken({ empresaId: EMPRESA_ID, activadoPor: GERENTE_ID });
  return `gypi_kiosco=${token}`;
}

const sesionKioscoValida = (valida = true) => ({
  match: (url, opts) => /\/rest\/v1\/sesiones\?token_hash=eq\./.test(url) && opts?.method !== "PATCH",
  respond: () => ({ status: 200, body: valida ? [{ id: "k1" }] : [] }),
});

// ── El token del kiosco no es una sesión ──

test("validarToken rechaza el token del kiosco (solo sirve para /api/kiosco/*)", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  const { token } = await signKioscoToken({ empresaId: EMPRESA_ID, activadoPor: GERENTE_ID });
  const sesion = await validarToken(new Request("http://localhost/api/data", { headers: { Authorization: `Bearer ${token}` } }));
  assert.equal(sesion, null);
});

// ── Activar / consultar / desactivar ──

async function reqActivar(rol, body = {}) {
  const { token } = await signAccessToken({ empleadoId: GERENTE_ID, empresaId: EMPRESA_ID, legajo: 1, rol });
  return new Request("http://localhost/api/kiosco", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("activar — sin sesión 401; operario 403", async () => {
  global.fetch = createFetchMock([...authPassHandlers()]);
  assert.equal((await kioscoRoute.POST(new Request("http://localhost/api/kiosco", { method: "POST", body: "{}" }))).status, 401);
  assert.equal((await kioscoRoute.POST(await reqActivar("operativo"))).status, 403);
});

test("activar — gestión: guarda el kiosco como sesión revocable y deja una cookie httpOnly", async () => {
  let fila = null;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url, opts) => url.includes("/rest/v1/sesiones") && opts?.method === "POST", respond: (url, opts) => { fila = JSON.parse(opts.body); return { status: 201, body: [{ id: "k1" }] }; } },
  ]);
  const res = await kioscoRoute.POST(await reqActivar("gerencial", { nombre: "Entrada" }));
  assert.equal(res.status, 200);
  const cookie = res.headers.get("set-cookie") || "";
  assert.match(cookie, /gypi_kiosco=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=strict/i);
  assert.equal(fila.empresa_id, EMPRESA_ID);
  assert.equal(fila.empleado_id, GERENTE_ID);
  assert.equal(fila.revocada, false);
  assert.match(fila.device_info, /^kiosco: Entrada/);
  assert.ok(fila.token_hash && fila.token_hash !== fila.jti, "se guarda el hash");
});

test("GET — sin cookie o con el kiosco desactivado: activo=false; activo: datos de la empresa", async () => {
  global.fetch = createFetchMock([]);
  assert.equal((await (await kioscoRoute.GET(new Request("http://localhost/api/kiosco"))).json()).activo, false);

  global.fetch = createFetchMock([sesionKioscoValida(false)]);
  const req = new Request("http://localhost/api/kiosco", { headers: { cookie: await cookieKiosco() } });
  assert.equal((await (await kioscoRoute.GET(req)).json()).activo, false, "revocado");

  global.fetch = createFetchMock([
    sesionKioscoValida(true),
    { match: (url) => url.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ nombre: "Gi Group", slug: "gi-group" }] }) },
  ]);
  const json = await (await kioscoRoute.GET(new Request("http://localhost/api/kiosco", { headers: { cookie: await cookieKiosco() } }))).json();
  assert.equal(json.activo, true);
  assert.equal(json.empresa.slug, "gi-group");
});

test("DELETE — revoca el kiosco y borra la cookie", async () => {
  let revocado = null;
  global.fetch = createFetchMock([
    sesionKioscoValida(true),
    { match: (url, opts) => url.includes("/rest/v1/sesiones?token_hash=eq.") && opts?.method === "PATCH", respond: (url, opts) => { revocado = JSON.parse(opts.body); return { status: 200, body: [{}] }; } },
  ]);
  const res = await kioscoRoute.DELETE(new Request("http://localhost/api/kiosco", { method: "DELETE", headers: { cookie: await cookieKiosco() } }));
  assert.deepEqual(revocado, { revocada: true });
  assert.match(res.headers.get("set-cookie") || "", /gypi_kiosco=;/);
});

// ── Fichar en el kiosco ──

const OPERARIO = { id: OPERARIO_ID, empresa_id: EMPRESA_ID, legajo: 7, rol: "operativo", nombre: "Ana Gómez", apodo: "Ana", activo: true, pin_hash: null, pin_intentos: 0 };

function servidorFichaje({ fichadas = [], empleado = { ...OPERARIO, pin_hash: PIN_HASH }, kioscoValido = true } = {}) {
  const registro = { insertada: null, patch: null };
  global.fetch = createFetchMock([
    sesionKioscoValida(kioscoValido),
    { match: (url) => url.includes("/rest/v1/empleados?legajo=eq."), respond: () => ({ status: 200, body: empleado ? [empleado] : [] }) },
    { match: (url, opts) => url.includes("/rest/v1/empleados?id=eq.") && opts?.method === "PATCH", respond: (url, opts) => { registro.patch = JSON.parse(opts.body); return { status: 200, body: [{}] }; } },
    { match: (url) => url.includes("/rest/v1/fichadas?empleado_id=eq.") && url.includes("select=fecha,ingreso,egreso"), respond: () => ({ status: 200, body: fichadas }) },
    // Camino de ingreso de lib/ficharServidor (como en api-fichar.test.js)
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=timezone"), respond: () => ({ status: 200, body: [{ timezone: "America/Argentina/Buenos_Aires", plan_activo: "free" }] }) },
    { match: (url) => url.includes("/rest/v1/fichadas") && url.includes("select=id,ingreso"), respond: () => ({ status: 200, body: [] }) },
    { match: (url) => url.includes("/rest/v1/empleados") && url.includes("select=diagrama"), respond: () => ({ status: 200, body: [{ diagrama: null }] }) },
    { match: (url, opts) => url.includes("/rest/v1/fichadas") && opts?.method === "POST", respond: (url, opts) => { registro.insertada = JSON.parse(opts.body); return { status: 201, body: [registro.insertada] }; } },
    { match: (url) => url.includes("/rest/v1/geo_zonas"), respond: () => ({ status: 200, body: [] }) },
    { match: (url) => url.includes("select=reglas_asistencia"), respond: () => ({ status: 200, body: [{ reglas_asistencia: null }] }) },
  ]);
  return registro;
}

async function reqFichar(body, { conCookie = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (conCookie) headers.cookie = await cookieKiosco();
  return new Request("http://localhost/api/kiosco/fichar", { method: "POST", headers, body: JSON.stringify(body) });
}

test("fichar — sin kiosco activado devuelve 401", async () => {
  servidorFichaje();
  assert.equal((await ficharKiosco(await reqFichar({ legajo: "7", pin: PIN }, { conCookie: false }))).status, 401);
  servidorFichaje({ kioscoValido: false });
  assert.equal((await ficharKiosco(await reqFichar({ legajo: "7", pin: PIN }))).status, 401);
});

test("fichar — PIN incorrecto: 401 y suma el intento, sin fichar", async () => {
  const registro = servidorFichaje();
  const res = await ficharKiosco(await reqFichar({ legajo: "7", pin: "1111" }));
  assert.equal(res.status, 401);
  assert.deepEqual(registro.patch, { pin_intentos: 1 });
  assert.equal(registro.insertada, null);
});

test("fichar — sin fichadas: registra el INGRESO del operario y lo saluda", async () => {
  const registro = servidorFichaje();
  const res = await ficharKiosco(await reqFichar({ legajo: "7", pin: PIN }));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.accion, "ingreso");
  assert.equal(json.apodo, "Ana");
  assert.equal(registro.insertada.legajo, 7);
  assert.equal(registro.insertada.empresa_id, EMPRESA_ID);
  assert.equal(json.pin_hash, undefined);
});

test("fichar — entrada y salida de hoy ya registradas: avisa y no ficha", async () => {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const registro = servidorFichaje({ fichadas: [{ fecha: hoy, ingreso: "08:00:00", egreso: "17:00:00" }] });
  const json = await (await ficharKiosco(await reqFichar({ legajo: "7", pin: PIN }))).json();
  assert.equal(json.ok, false);
  assert.equal(json.tipo, "cerrada");
  assert.equal(registro.insertada, null);
});

test("fichar — formato inválido devuelve 400", async () => {
  servidorFichaje();
  assert.equal((await ficharKiosco(await reqFichar({ legajo: "ana", pin: PIN }))).status, 400);
  assert.equal((await ficharKiosco(await reqFichar({ legajo: "7", pin: "12" }))).status, 400);
});

// ── QR personal ──

test("legajoDesdeQR — toma el legajo del QR de la misma empresa", () => {
  assert.equal(legajoDesdeQR("https://gypi.app/gi-group?legajo=7", "gi-group"), "7");
  assert.equal(legajoDesdeQR("https://gypi.app/otra?legajo=7", "gi-group"), "", "QR de otra empresa");
  assert.equal(legajoDesdeQR("https://gypi.app/gi-group?legajo=7x", "gi-group"), "");
  assert.equal(legajoDesdeQR("hola", "gi-group"), "");
});
