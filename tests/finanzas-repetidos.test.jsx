// Finanzas (13/11, parte 1 del plan de Tesorería): una sola regla contra los
// movimientos repetidos en cajas y bancos (app/lib/finanzasRepetidos.js).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { buscarRepetidos, cajasDeOperacion, rangoRevision, respuestaRepetidos, textoRepetido } from "../app/lib/finanzasRepetidos.js";

const { default: AvisoRepetidos, repetidosDe } = await import("../app/components/FinanzasAvisoRepetidos.jsx");
const { repetidosPorCaja } = await import("../app/components/FinanzasTesoreria.jsx");

afterEach(() => cleanup());

const BANCO = "01.01.01.003.002";
const CAJA = "01.01.01.001.001";
const PROV = "02.01.02.001.001";
const CAJAS = [BANCO, CAJA];

const pago = (extra = {}) => ({ fecha: "2026-11-10", cuenta_debe: PROV, cuenta_haber: BANCO, total: 5000, total_ars: 5000, ...extra });

test("cajas de una operación — solo las de tesorería, sin repetir", () => {
  assert.deepEqual(cajasDeOperacion(pago(), new Set(CAJAS)), [BANCO]);
  assert.deepEqual(cajasDeOperacion({ cuenta_debe: CAJA, cuenta_haber: BANCO }, new Set(CAJAS)), [CAJA, BANCO]);
  assert.deepEqual(cajasDeOperacion({ cuenta_debe: PROV, cuenta_haber: "04.01" }, new Set(CAJAS)), []);
});

test("buscar repetidos — 🔴 mismo día, 🟡 hasta 3 días, mismo sentido y al centavo", () => {
  const existentes = [
    { id: 1, ...pago(), tipo: "PAGO TRANSF", origen: "banco" },
    { id: 2, ...pago({ fecha: "2026-11-12" }), origen: "manual" },
    { id: 3, ...pago({ fecha: "2026-11-14" }) },
    { id: 4, ...pago({ cuenta_debe: BANCO, cuenta_haber: PROV }) },
    { id: 5, ...pago({ total: 5000.01, total_ars: 5000.01 }) },
    { id: 6, ...pago(), anulada_at: "2026-11-11" },
  ];
  const [r] = buscarRepetidos([pago()], existentes, CAJAS);
  assert.deepEqual([r.i, r.nivel, r.cuenta, r.importe], [0, "rojo", BANCO, -5000]);
  assert.deepEqual(r.parecidas.map((p) => p.id), [1, 2], "a 4 días no, la que entra no, otro importe no, anulada no");
  const [am] = buscarRepetidos([pago({ fecha: "2026-11-11" })], existentes.slice(1, 3), CAJAS);
  assert.equal(am.nivel, "amarillo");
  assert.deepEqual(buscarRepetidos([pago()], existentes, CAJAS, { excluir: [1, 2] }), [], "la que se corrige no cuenta");
  assert.deepEqual(buscarRepetidos([{ ...pago(), cuenta_haber: "otra" }], existentes, CAJAS), [], "sin caja no se revisa");
  assert.deepEqual(rangoRevision([pago(), pago({ fecha: "2026-11-01" })]), { desde: "2026-10-29", hasta: "2026-11-13" });
  assert.match(textoRepetido(r, "Credicoop"), /^🔴 Ya hay en Credicoop un movimiento por el mismo importe el mismo día: 10\/11\/2026 · PAGO TRANSF/);
  assert.equal(respuestaRepetidos([r]).repetidos.length, 1);
});

test("aviso — muestra lo que ya está y deja elegir: no cargar, cargar igual o es este", () => {
  const rep = [{ nivel: "rojo", cuenta: BANCO, parecidas: [{ id: 9, fecha: "2026-11-10", tipo: "PAGO ECHEQ", descripcion: "ECHEQ 122", origen: "banco", importe: -5000 }] }];
  assert.equal(repetidosDe(409, { repetidos: rep }), rep);
  assert.equal(repetidosDe(400, { repetidos: rep }), null);
  assert.equal(repetidosDe(409, { error: "x" }), null);
  const hechos = [];
  render(<AvisoRepetidos repetidos={rep} onCargarIgual={() => hechos.push("igual")} onCancelar={() => hechos.push("no")} onUsar={(id) => hechos.push(id)} />);
  assert.ok(screen.getByText(/Muy sospechoso/));
  assert.ok(screen.getByText(/PAGO ECHEQ · ECHEQ 122/));
  fireEvent.click(screen.getByText("Es este"));
  fireEvent.click(screen.getByText("Es otro distinto, cargarlo igual"));
  fireEvent.click(screen.getByText("No cargarlo"));
  assert.deepEqual(hechos, [9, "igual", "no"]);
});

test("🔎 posibles repetidos — por caja, solo las que tienen", () => {
  const tesoreria = [{ cuenta: BANCO, nombre: "Credicoop", activa: true }, { cuenta: CAJA, nombre: "Caja", activa: true }];
  const ops = [{ id: 1, ...pago() }, { id: 2, ...pago({ fecha: "2026-11-11" }) }, { id: 3, fecha: "2026-11-10", cuenta_debe: CAJA, cuenta_haber: PROV, total_ars: 10 }];
  const r = repetidosPorCaja(ops, tesoreria);
  assert.deepEqual(r.map((x) => [x.caja.nombre, x.grupos.length, x.grupos[0].ops.length]), [["Credicoop", 1, 2]]);
});
