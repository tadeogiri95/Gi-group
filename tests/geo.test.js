// tests/geo.test.js — Tests de la función haversine
import { test } from "node:test";
import assert from "node:assert/strict";
import { haversine as distanciaMetros } from "../app/lib/calc.js";

test("distanciaMetros — mismo punto = 0", () => {
  const d = distanciaMetros(-34.6037, -58.3816, -34.6037, -58.3816);
  assert.ok(d < 0.01, `esperaba ~0, obtuvo ${d}`);
});

test("distanciaMetros — Buenos Aires a Córdoba ~650km", () => {
  // BA: -34.6037, -58.3816  |  Córdoba: -31.4201, -64.1888
  const d = distanciaMetros(-34.6037, -58.3816, -31.4201, -64.1888);
  assert.ok(d > 600_000 && d < 700_000, `esperaba ~650km, obtuvo ${d / 1000}km`);
});

test("distanciaMetros — 200m dentro de radio de 300m", () => {
  // Mueve ~200 metros al norte desde origen
  const lat1 = -34.6037;
  const lng1 = -58.3816;
  // 0.001° de latitud ≈ 111m → ~180m al norte
  const lat2 = lat1 - 0.0016;
  const d = distanciaMetros(lat1, lng1, lat2, lng1);
  assert.ok(d < 300, `${d}m debería ser < 300m`);
});

test("distanciaMetros — 500m fuera de radio de 300m", () => {
  const lat1 = -34.6037;
  const lng1 = -58.3816;
  // 0.005° de latitud ≈ 555m al norte
  const lat2 = lat1 - 0.005;
  const d = distanciaMetros(lat1, lng1, lat2, lng1);
  assert.ok(d > 300, `${d}m debería ser > 300m`);
});

test("distanciaMetros — simetría (A→B = B→A)", () => {
  const d1 = distanciaMetros(-34.6, -58.3, -34.7, -58.5);
  const d2 = distanciaMetros(-34.7, -58.5, -34.6, -58.3);
  assert.ok(Math.abs(d1 - d2) < 0.001);
});
