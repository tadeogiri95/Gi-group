// tests/select-buscable.test.jsx — desplegable con buscador (Finanzas, 11/11).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import SelectBuscable, { filtrarOpciones, opcionesDe } from "../app/components/ui/SelectBuscable.jsx";

afterEach(() => cleanup());

function Prueba({ alCambiar }) {
  const [v, setV] = useState("");
  return (
    <label>Proveedor
      <SelectBuscable className="g-input min-w-[150px] flex-1" value={v} onChange={(e) => { setV(e.target.value); alCambiar?.(e.target.value); }}>
        <option value="">Elegí…</option>
        <optgroup label="GASTOS">
          <option value="L">Gastos de logística</option>
          <option value="A">Gastos de administración</option>
        </optgroup>
        <optgroup label="COBROS">
          <option value="C">Cobro a clientes</option>
        </optgroup>
      </SelectBuscable>
    </label>
  );
}

test("SelectBuscable — lee las opciones y filtra sin importar tildes ni el orden de las palabras", () => {
  const ops = opcionesDe([<option key="1" value="1">Uno</option>, <optgroup key="g" label="G"><option value="2">{"Dos"}{" · x"}</option></optgroup>]);
  assert.deepEqual(ops.map((o) => [o.value, o.label, o.grupo]), [["1", "Uno", null], ["2", "Dos · x", "G"]]);
  const lista = [{ value: "1", label: "Gastos de logística", grupo: "GASTOS" }, { value: "2", label: "Cobro a clientes", grupo: "COBROS" }];
  assert.deepEqual(filtrarOpciones(lista, "LOGISTICA gas").map((o) => o.value), ["1"]);
  assert.deepEqual(filtrarOpciones(lista, "cobros").map((o) => o.value), ["2"], "busca también en el grupo");
  assert.equal(filtrarOpciones(lista, "").length, 2);
});

test("SelectBuscable — escribir filtra, Enter elige y muestra el nombre", () => {
  const elegidos = [];
  render(<Prueba alCambiar={(v) => elegidos.push(v)} />);
  const input = screen.getByLabelText("Proveedor");
  assert.equal(input.getAttribute("role"), "combobox");
  fireEvent.focus(input);
  assert.equal(screen.getAllByRole("option").length, 4, "al abrir se ve todo");
  fireEvent.change(input, { target: { value: "admin" } });
  assert.deepEqual(screen.getAllByRole("option").map((o) => o.textContent), ["Gastos de administración"]);
  fireEvent.keyDown(input, { key: "Enter" });
  assert.deepEqual(elegidos, ["A"]);
  assert.equal(input.value, "Gastos de administración");
  assert.equal(screen.queryByRole("listbox"), null, "se cierra al elegir");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "zzz" } });
  assert.ok(screen.getByText("No hay coincidencias"));
  fireEvent.keyDown(input, { key: "Escape" });
  assert.equal(input.value, "Gastos de administración", "Escape no cambia lo elegido");
});

test("SelectBuscable — con el mouse y con flechas", () => {
  const elegidos = [];
  render(<Prueba alCambiar={(v) => elegidos.push(v)} />);
  const input = screen.getByLabelText("Proveedor");
  fireEvent.focus(input);
  fireEvent.mouseDown(screen.getByRole("option", { name: "Cobro a clientes" }));
  assert.deepEqual(elegidos, ["C"]);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "gastos" } });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  assert.deepEqual(elegidos, ["C", "A"], "la flecha baja a la segunda");
});

test("SelectBuscable — con listaAncha la lista se abre más ancha que el casillero y las cuentas se leen enteras (12/11)", () => {
  const { rerender } = render(
    <SelectBuscable aria-label="Cuenta del debe" value="" onChange={() => {}}>
      <option value="">Elegí…</option>
      <option value="01.01.01.003.002">01.01.01.003.002 · BANCO CREDICOOP CTA CTE</option>
    </SelectBuscable>,
  );
  fireEvent.focus(screen.getByRole("combobox", { name: "Cuenta del debe" }));
  let lista = screen.getByRole("listbox");
  assert.match(lista.className, /right-0/, "sin listaAncha, del ancho del casillero (como siempre)");
  rerender(
    <SelectBuscable aria-label="Cuenta del debe" listaAncha value="" onChange={() => {}}>
      <option value="">Elegí…</option>
      <option value="01.01.01.003.002">01.01.01.003.002 · BANCO CREDICOOP CTA CTE</option>
    </SelectBuscable>,
  );
  lista = screen.getByRole("listbox");
  assert.doesNotMatch(lista.className, /right-0/);
  assert.match(lista.className, /min-w-full w-max max-w-\[min\(34rem,calc\(100vw-2rem\)\)\]/);
  assert.match(screen.getByRole("option", { name: /BANCO CREDICOOP/ }).className, /whitespace-normal/);
});
