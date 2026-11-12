// tests/costo-hora-desglose.test.jsx — La hora en tres partes: Mano de obra,
// Costo Burden y GAC (auditoría del 12/11, parte 10; sin migración).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";
import { desgloseParaEditar, leerDesglose, repartirHora, totalDesglose } from "../app/lib/costoHoraDesglose.js";
import { costoPrevistoReal } from "../app/lib/costoReal.js";

const { default: CostoRealOt } = await import("../app/components/CostoRealOt.jsx");
afterEach(() => cleanup());

const D = { mano_obra: 9500, burden: 3000, gac: 1500 };

test("desglose — la hora es la suma; lo guardado mal no sirve", () => {
  assert.equal(totalDesglose(D), 14000);
  assert.deepEqual(leerDesglose({ ...D, actualizado_at: "x" }), D);
  assert.equal(leerDesglose({ mano_obra: 1, burden: 2 }), null, "faltan partes");
  assert.equal(leerDesglose({ mano_obra: -1, burden: 0, gac: 0 }), null);
  assert.equal(leerDesglose(null), null);
  assert.equal(leerDesglose([]), null);
});

test("desglose para editar — sin desglose, lo cargado antes va como mano de obra", () => {
  assert.deepEqual(desgloseParaEditar(null, 9000), { mano_obra: 9000, burden: 0, gac: 0 });
  assert.deepEqual(desgloseParaEditar(null, null), { mano_obra: 0, burden: 0, gac: 0 });
  assert.deepEqual(desgloseParaEditar(D, 1), D, "el guardado manda");
});

test("repartir — en proporción a la hora y la suma da justo", () => {
  const r = repartirHora(140000, D);
  assert.deepEqual(r.map((p) => p.importe), [95000, 30000, 15000]);
  const raro = repartirHora(100, { mano_obra: 1, burden: 1, gac: 1 });
  assert.equal(raro.reduce((s, p) => s + p.importe, 0), 100);
  assert.deepEqual(repartirHora(100, { mano_obra: 0, burden: 0, gac: 0 }), []);
  assert.deepEqual(repartirHora(100, null), []);
});

test("💲 Costo de la OT — la mano de obra real sale repartida en las tres partes", async () => {
  const comparativa = costoPrevistoReal({
    materiales: { total: 100000, sinPrecio: 0 }, horas: { total: { presupuestadas: { valor: 10 }, reales: { valor: 10 } } }, costoHora: 14000, retrabajo: 0, instalacion: null,
  });
  global.fetch = async () => new Response(JSON.stringify({ ok: true, ...comparativa, fuera: [], compras: [], gastos: [], hora: { desglose: D } }), { status: 200 });
  render(<CostoRealOt ot="M-1" />);
  await screen.findByText("💲 Costo previsto y real");
  const linea = screen.getByLabelText("Mano de obra repartida");
  assert.match(linea.textContent, /Mano de obra real \$ 140\.000: Mano de obra \$ 95\.000 · Costo Burden \$ 30\.000 · GAC \$ 15\.000/);
});

test("💲 Costo de la OT — sin desglose no aparece la línea", async () => {
  const comparativa = costoPrevistoReal({ materiales: { total: 100000, sinPrecio: 0 }, horas: { total: { presupuestadas: { valor: 10 }, reales: { valor: 10 } } }, costoHora: 14000 });
  global.fetch = async () => new Response(JSON.stringify({ ok: true, ...comparativa, fuera: [], compras: [], gastos: [], hora: { desglose: null } }), { status: 200 });
  render(<CostoRealOt ot="M-1" />);
  await screen.findByText("💲 Costo previsto y real");
  assert.equal(screen.queryByLabelText("Mano de obra repartida"), null);
});
