// tests/teclado-lista.test.jsx — elegir artículos con flechas y Enter (22/11).
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useTecladoLista } from "../app/hooks/useTecladoLista.js";
import { ElegirArticulo } from "../app/components/FacturasSueltas.jsx";

afterEach(() => cleanup());

const ARTS = [
  { sku: "B1", nombre: "Bisagra cazoleta 35" },
  { sku: "B2", nombre: "Bisagra recta" },
  { sku: "B3", nombre: "Bisagra acodada" },
];

function Prueba({ alElegir }) {
  const [texto, setTexto] = useState("bis");
  const lista = texto ? ARTS : [];
  const t = useTecladoLista(lista, alElegir, () => setTexto(""));
  return (
    <div>
      <input aria-label="Buscar" value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={t.onKeyDown} />
      <ul>{lista.map((a, i) => <li key={a.sku}><button {...t.props(i)}>{a.nombre}</button></li>)}</ul>
    </div>
  );
}

const marcado = () => document.querySelector('[aria-current="true"]')?.textContent;

test("Teclado — el primero queda marcado; ↓ ↑ recorren y dan la vuelta; Enter elige", () => {
  const elegidos = [];
  render(<Prueba alElegir={(a) => elegidos.push(a.sku)} />);
  const input = screen.getByLabelText("Buscar");
  assert.equal(marcado(), "Bisagra cazoleta 35");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  assert.equal(marcado(), "Bisagra acodada");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  assert.equal(marcado(), "Bisagra cazoleta 35", "después del último vuelve al primero");
  fireEvent.keyDown(input, { key: "ArrowUp" });
  assert.equal(marcado(), "Bisagra acodada", "antes del primero va al último");
  fireEvent.keyDown(input, { key: "Enter" });
  assert.deepEqual(elegidos, ["B3"]);
});

test("Teclado — Escape borra lo escrito; sin lista, Enter no hace nada", () => {
  const elegidos = [];
  render(<Prueba alElegir={(a) => elegidos.push(a.sku)} />);
  const input = screen.getByLabelText("Buscar");
  fireEvent.keyDown(input, { key: "Escape" });
  assert.equal(input.value, "");
  fireEvent.keyDown(input, { key: "Enter" });
  assert.deepEqual(elegidos, []);
});

test("Teclado — en Facturas sueltas, buscar y Enter elige el primero", () => {
  const elegidos = [];
  render(<ElegirArticulo articulos={ARTS} etiqueta="Artículo" onElegir={(a) => elegidos.push(a.sku)} />);
  const input = screen.getByLabelText("Artículo");
  fireEvent.change(input, { target: { value: "bisagra recta" } });
  fireEvent.keyDown(input, { key: "Enter" });
  assert.deepEqual(elegidos, ["B2"]);
  assert.equal(input.value, "", "después de elegir queda listo para el siguiente");
});

test("Teclado — los 5 buscadores de artículos usan flechas y Enter", () => {
  for (const f of ["ComprasScreen", "MovimientosStock", "RemitosFoto", "FacturasSueltas", "PedirParaProblema"]) {
    const src = readFileSync(new URL(`../app/components/${f}.jsx`, import.meta.url), "utf8");
    assert.match(src, /useTecladoLista\(/, f);
    assert.match(src, /onKeyDown=\{teclado\.onKeyDown\}/, f);
  }
});
