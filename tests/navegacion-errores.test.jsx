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

// Parte 2 (13/11): la sección y la pestaña van en la dirección (?sec=) para que
// el botón Atrás del celular o del navegador vuelva al paso anterior.
test("la sección abierta sale de la dirección, no de un estado que Atrás no ve", () => {
  const home = leer("[slug]/HomeContent.jsx");
  assert.match(home, /searchParams\.get\("sec"\)/);
  assert.doesNotMatch(home, /useState\(null\);\s*\n\s*const irA/);
  assert.match(home, /if \(seccion\) params\.set\("sec", seccion\); else params\.delete\("sec"\);/);
});

test("las pestañas de los botones y de Equipo cambian la dirección", async () => {
  const { default: BotonGestionScreen } = await import("../app/components/screens/BotonGestionScreen.jsx");
  const pedidas = [];
  render(<BotonGestionScreen boton="inventario" empresa={{ modulos: ["proyectos", "stock", "compras"] }} usuario={{ rol: "gerencial" }} seccion="stock" onSeccion={(id) => pedidas.push(id)} />);
  fireEvent.click(screen.getByRole("tab", { name: /Compras/ }));
  assert.deepEqual(pedidas, ["compras"]);
  assert.match(leer("components/screens/EquipoScreen.jsx"), /const setOpcion = onSeccion \|\| setOpcionLocal;/);
});

test("el Panel abre Flota y Maquinaria en Alertas sin chocar con las pestañas", () => {
  const b = leer("components/screens/BotonGestionScreen.jsx");
  assert.match(b, /"flota-alertas": "flota"/);
  assert.match(b, /seccion === "flota-alertas" \? "alertas" : "vehiculos"/);
});

// Parte 3 (13/11): los arreglos chicos
test("primeros pasos: «Crear la primera OT» va a Producción → OT", async () => {
  const { pasosActivacion } = await import("../app/lib/onboarding.js");
  assert.equal(pasosActivacion().find((p) => p.id === "ot").ir, "proyectos:ot");
});

test("operario: Mi documentación tiene «← Mi cuenta»; en la PC Equipo y Permisos sin «← Más»", () => {
  const home = leer("[slug]/HomeContent.jsx");
  assert.match(home, /!uIsGer && screen === "documentos" && \(\s*<button onClick=\{\(\) => setScreen\("cuenta"\)\}/);
  assert.match(home, /className="solo-cel [^"]*">\s*← Más/);
});

test("Finanzas → Configuración no se rompe si faltan listas", async () => {
  const s = leer("components/FinanzasConfig.jsx");
  assert.match(s, /cuentas: d\.cuentas \|\| \[\], tipos: d\.tipos \|\| \[\], tesoreria: d\.tesoreria \|\| \[\], centros: d\.centros \|\| \[\]/);
});
