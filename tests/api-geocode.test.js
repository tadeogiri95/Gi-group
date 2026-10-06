// tests/api-geocode.test.js — Tests de GET /api/geocode (proxy a Nominatim)
//
// F2-16: exige sesión, cachea respuestas y limita pedidos por empresa.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});

const { signAccessToken } = await import("../app/lib/jwt.ts");
const { GET } = await import("../app/api/geocode/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const { token: TOKEN } = await signAccessToken({ empleadoId: "22222222-2222-2222-2222-222222222222", empresaId: EMPRESA_ID, legajo: 1, rol: "gerencial" });

function getReq(q, { conSesion = true } = {}) {
  const url = q === undefined
    ? "http://localhost/api/geocode"
    : `http://localhost/api/geocode?q=${encodeURIComponent(q)}`;
  const req = new Request(url, { headers: conSesion ? { Authorization: `Bearer ${TOKEN}` } : {} });
  req.nextUrl = new URL(req.url);
  return req;
}

function rateLimit(count = 1) {
  return { match: (url) => url.includes("/rpc/rpc_login_attempt"), respond: () => ({ status: 200, body: count }) };
}

function nominatimOk(results) {
  return {
    match: (url) => url.includes("nominatim.openstreetmap.org/search"),
    respond: () => ({ status: 200, body: results }),
  };
}

function nominatimFalla(status = 503) {
  return {
    match: (url) => url.includes("nominatim.openstreetmap.org/search"),
    respond: () => ({ status, body: "" }),
  };
}

function mock(extra) {
  return createFetchMock([...authPassHandlers(), rateLimit(), ...extra]);
}

test("geocode — sin sesión devuelve 401 y no llama a Nominatim", async () => {
  let llamado = false;
  global.fetch = createFetchMock([{ match: (url) => url.includes("nominatim"), respond: () => { llamado = true; return { status: 200, body: [] }; } }]);
  const res = await GET(getReq("Buenos Aires", { conSesion: false }));
  assert.equal(res.status, 401);
  assert.equal(llamado, false);
});

test("geocode — sin query devuelve array vacío", async () => {
  global.fetch = mock([]);
  const res = await GET(getReq());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test("geocode — query de un solo caracter devuelve array vacío (no llama a Nominatim)", async () => {
  global.fetch = mock([]);
  const res = await GET(getReq("a"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test("geocode — query válida devuelve resultados mapeados a {lat,lng,label}", async () => {
  global.fetch = mock([
    nominatimOk([{ lat: "-34.603722", lon: "-58.381592", display_name: "Buenos Aires, Argentina" }]),
  ]);
  const res = await GET(getReq("Buenos Aires"));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.length, 1);
  assert.equal(json[0].lat, -34.603722);
  assert.equal(json[0].lng, -58.381592);
  assert.equal(json[0].label, "Buenos Aires, Argentina");
});

test("geocode — la misma búsqueda se sirve desde el caché, sin volver a Nominatim", async () => {
  let llamadas = 0;
  global.fetch = mock([{ match: (url) => url.includes("nominatim"), respond: () => { llamadas++; return { status: 200, body: [{ lat: "1", lon: "2", display_name: "Rosario" }] }; } }]);
  await GET(getReq("Rosario centro"));
  const res = await GET(getReq("  ROSARIO centro "));
  assert.equal(res.status, 200);
  assert.equal((await res.json())[0].label, "Rosario");
  assert.equal(llamadas, 1);
});

test("geocode — límite por empresa excedido devuelve 429", async () => {
  let llamado = false;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    rateLimit(61),
    { match: (url) => url.includes("nominatim"), respond: () => { llamado = true; return { status: 200, body: [] }; } },
  ]);
  const res = await GET(getReq("Mendoza capital"));
  assert.equal(res.status, 429);
  assert.equal(llamado, false);
});

test("geocode — el contador del límite es por empresa", async () => {
  let clave = null;
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (url) => url.includes("/rpc/rpc_login_attempt"), respond: (url, opts) => { clave = JSON.parse(opts.body).p_ip; return { status: 200, body: 1 }; } },
    nominatimOk([]),
  ]);
  await GET(getReq("Córdoba barrio"));
  assert.equal(clave, `geocode:${EMPRESA_ID}`);
});

test("geocode — Nominatim devuelve error HTTP: responde array vacío, no falla", async () => {
  global.fetch = mock([nominatimFalla(503)]);
  const res = await GET(getReq("algo que falla"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test("geocode — fetch lanza (timeout/red caída) devuelve 502", async () => {
  global.fetch = mock([
    { match: (url) => url.includes("nominatim.openstreetmap.org/search"), respond: () => { throw new Error("network down"); } },
  ]);
  const res = await GET(getReq("algo sin red"));
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, "geocode_failed");
});

test("geocode — query con caracteres especiales se encodea en la URL a Nominatim", async () => {
  let urlLlamada = null;
  global.fetch = mock([
    { match: (url) => url.includes("nominatim.openstreetmap.org/search"), respond: (url) => { urlLlamada = url; return { status: 200, body: [] }; } },
  ]);
  await GET(getReq("Av. Corrientes & 9 de Julio"));
  assert.ok(urlLlamada.includes(encodeURIComponent("Av. Corrientes & 9 de Julio")), `la query debe ir encodeada: ${urlLlamada}`);
});
