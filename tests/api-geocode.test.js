// tests/api-geocode.test.js — Tests de GET /api/geocode (proxy a Nominatim)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFetchMock } from "./helpers/mockFetch.js";

const { GET } = await import("../app/api/geocode/route.js");

function getReq(q) {
  const url = q === undefined
    ? "http://localhost/api/geocode"
    : `http://localhost/api/geocode?q=${encodeURIComponent(q)}`;
  const req = new Request(url);
  req.nextUrl = new URL(req.url);
  return req;
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

test("geocode — sin query devuelve array vacío", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(getReq());
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json, []);
});

test("geocode — query de un solo caracter devuelve array vacío (no llama a Nominatim)", async () => {
  global.fetch = createFetchMock([]);
  const res = await GET(getReq("a"));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json, []);
});

test("geocode — query válida devuelve resultados mapeados a {lat,lng,label}", async () => {
  global.fetch = createFetchMock([
    nominatimOk([
      { lat: "-34.603722", lon: "-58.381592", display_name: "Buenos Aires, Argentina" },
    ]),
  ]);
  const res = await GET(getReq("Buenos Aires"));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.length, 1);
  assert.equal(json[0].lat, -34.603722);
  assert.equal(json[0].lng, -58.381592);
  assert.equal(json[0].label, "Buenos Aires, Argentina");
});

test("geocode — Nominatim devuelve error HTTP: responde array vacío, no falla", async () => {
  global.fetch = createFetchMock([nominatimFalla(503)]);
  const res = await GET(getReq("algo"));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json, []);
});

test("geocode — fetch lanza (timeout/red caída) devuelve 502", async () => {
  global.fetch = createFetchMock([
    {
      match: (url) => url.includes("nominatim.openstreetmap.org/search"),
      respond: () => { throw new Error("network down"); },
    },
  ]);
  const res = await GET(getReq("algo"));
  assert.equal(res.status, 502);
  const json = await res.json();
  assert.equal(json.error, "geocode_failed");
});

test("geocode — query con caracteres especiales se encodea en la URL a Nominatim", async () => {
  let urlLlamada = null;
  global.fetch = createFetchMock([
    {
      match: (url) => url.includes("nominatim.openstreetmap.org/search"),
      respond: (url) => { urlLlamada = url; return { status: 200, body: [] }; },
    },
  ]);
  await GET(getReq("Av. Corrientes & 9 de Julio"));
  assert.ok(urlLlamada.includes(encodeURIComponent("Av. Corrientes & 9 de Julio")), `la query debe ir encodeada: ${urlLlamada}`);
});
