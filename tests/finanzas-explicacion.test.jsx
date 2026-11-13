// tests/finanzas-explicacion.test.jsx — Finanzas (13/11, parte 2 del plan de
// Tesorería): la explicación del concepto bien visible al elegirlo y, corta,
// en la lista mientras se busca.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { LEYENDAS } from "../app/lib/finanzasTipos.js";

afterEach(() => cleanup());

const { default: ExplicacionConcepto, partesLeyenda, leyendaCorta } = await import("../app/components/ExplicacionConcepto.jsx");
const { default: SelectBuscable, filtrarOpciones, opcionesDe } = await import("../app/components/ui/SelectBuscable.jsx");

test("explicación — separa qué comprende y el ejemplo", () => {
  assert.deepEqual(partesLeyenda("Plata que entra de un cliente. Ej.: el cliente transfiere la seña."), { que: "Plata que entra de un cliente.", ejemplo: "el cliente transfiere la seña." });
  assert.deepEqual(partesLeyenda("Solo texto"), { que: "Solo texto", ejemplo: "" });
  assert.deepEqual(partesLeyenda(""), { que: "", ejemplo: "" });
  assert.equal(leyendaCorta("Primera frase. Segunda frase. Ej.: algo"), "Primera frase.");
  assert.ok(leyendaCorta("x".repeat(200)).length <= 90);
  // Todas las de la lista tienen su ejemplo
  for (const [codigo, texto] of Object.entries(LEYENDAS)) assert.ok(partesLeyenda(texto).ejemplo, `${codigo} sin ejemplo`);
});

test("explicación — recuadro con el nombre, lo que comprende y el ejemplo aparte", () => {
  render(<ExplicacionConcepto texto="Pago de una factura. Ej.: transferencia a Bosques." nombre="Pago a proveedores" />);
  const r = screen.getByRole("note", { name: "Qué comprende este tipo" });
  assert.match(r.textContent, /Qué es «Pago a proveedores»/);
  assert.match(r.textContent, /Pago de una factura\./);
  assert.match(r.textContent, /Ejemplo: transferencia a Bosques\./);
});

test("lista — cada opción muestra su explicación corta y se busca también por ella", () => {
  const hijos = [
    <option key="a" value="A" data-detalle="Nafta, gasoil y peajes de los vehículos.">Combustibles</option>,
    <option key="b" value="B">Sueldos</option>,
  ];
  const ops = opcionesDe(hijos);
  assert.equal(ops[0].detalle, "Nafta, gasoil y peajes de los vehículos.");
  assert.equal(ops[1].detalle, undefined);
  assert.deepEqual(filtrarOpciones(ops, "nafta").map((o) => o.value), ["A"]);
  render(<SelectBuscable aria-label="Concepto" value="" onChange={() => {}}>{hijos}</SelectBuscable>);
  fireEvent.focus(screen.getByLabelText("Concepto"));
  assert.ok(screen.getByText("Nafta, gasoil y peajes de los vehículos."));
});
