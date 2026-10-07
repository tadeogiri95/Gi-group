// tests/textos-tenant.test.js — Reglas y textos de la fábrica piloto fuera del
// producto (F4-13, H1-H2, H5): el historial de fichajes usa las reglas de cada
// empresa y la UI no habla de "presentismo", "Taller" ni "instaladores".
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { clasificarTardanzas } from "../app/lib/calc.js";

const TARDES = [
  { id: 1, fecha: "2026-10-01", llegada_tarde: true, minutos_tarde: 10 },
  { id: 2, fecha: "2026-10-02", llegada_tarde: false },
  { id: 3, fecha: "2026-10-03", llegada_tarde: true, minutos_tarde: 40 },
  { id: 4, fecha: "2026-10-06", llegada_tarde: true, minutos_tarde: 5 },
];

test("clasificarTardanzas — sin reglas de bloqueo nada excede (default del producto: solo registrar)", () => {
  const m = clasificarTardanzas(TARDES, { tolerancia_min: 5, bloqueo_min: null, bloqueo_tardanzas_mes: null });
  assert.deepEqual([...m.values()], [{ numero: 1, excede: false }, { numero: 2, excede: false }, { numero: 3, excede: false }]);
});

test("clasificarTardanzas — usa los minutos y la cantidad que configuró la empresa", () => {
  const m = clasificarTardanzas(TARDES, { tolerancia_min: 5, bloqueo_min: 30, bloqueo_tardanzas_mes: 3 });
  assert.equal(m.get(1).excede, false);
  assert.equal(m.get(3).excede, true, "40 min > 30");
  assert.equal(m.get(4).excede, true, "3ra tardanza del mes");
  const otra = clasificarTardanzas(TARDES, { tolerancia_min: 5, bloqueo_min: 60, bloqueo_tardanzas_mes: null });
  assert.equal(otra.get(3).excede, false, "con 60 min de límite, 40 no excede");
});

test("la interfaz no usa textos de la fábrica piloto", () => {
  const archivos = [
    "app/components/screens/HistorialFichajesScreen.jsx",
    "app/components/screens/HomeEmp.jsx",
    "app/dashboard_gerencia.jsx",
    "app/reportes_screen.jsx",
    "app/[slug]/HomeContent.jsx",
  ];
  for (const a of archivos) {
    const src = fs.readFileSync(new URL(`../${a}`, import.meta.url), "utf8");
    assert.ok(!/presentismo/i.test(src), `${a} menciona "presentismo"`);
    assert.ok(!/Estado Taller|"Taller"/.test(src), `${a} usa "Taller"`);
    assert.ok(!/instaladores/i.test(src), `${a} usa "instaladores"`);
  }
});
