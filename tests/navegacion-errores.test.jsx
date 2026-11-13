// tests/navegacion-errores.test.jsx — Revisión de la navegación (13/11):
// un error en una pantalla no queda pegado en las demás, y el Mayor de
// cuentas y Devengamiento se pueden bajar hasta el final.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ErrorBoundary from "../app/components/ErrorBoundary.jsx";

afterEach(() => cleanup());
const leer = (f) => readFileSync(new URL(`../app/${f}`, import.meta.url), "utf8");

function Rompe() { throw new Error("falla de prueba"); }
function Pantallas() {
  const [p, setP] = useState("rota");
  return (
    <>
      <button onClick={() => setP("buena")}>Ir a otra</button>
      <ErrorBoundary key={p} name={p}>{p === "rota" ? <Rompe /> : <p>Pantalla buena</p>}</ErrorBoundary>
    </>
  );
}

test("con key, al cambiar de pantalla se va el «Algo salió mal»", () => {
  const original = console.error; console.error = () => {};
  try {
    render(<Pantallas />);
    assert.ok(screen.getByText(/Algo salió mal/));
    fireEvent.click(screen.getByText("Ir a otra"));
    assert.equal(screen.queryByText(/Algo salió mal/), null);
    assert.ok(screen.getByText("Pantalla buena"));
  } finally { console.error = original; }
});

test("la app reinicia el aviso de error por pantalla y por pestaña", () => {
  assert.match(leer("[slug]/HomeContent.jsx"), /<ErrorBoundary key=\{`\$\{screen\}:\$\{seccionMas \|\| ""\}`\} name=\{screen\}>/);
  assert.match(leer("components/screens/BotonGestionScreen.jsx"), /<ErrorBoundary key=\{actual\.id\} name=\{actual\.label\}>/);
});

test("Mayor de cuentas y Devengamiento tienen su barra para bajar", () => {
  for (const f of ["FinanzasMayor.jsx", "FinanzasDevengamiento.jsx"]) {
    const s = leer(`components/${f}`);
    const raiz = s.slice(s.indexOf("export default function")).match(/return \(\s*(?:\/\/[^\n]*\n\s*)*<div className="([^"]+)"/)[1];
    assert.match(raiz, /flex-1/, f);
    assert.match(raiz, /overflow-y-auto/, f);
  }
});
