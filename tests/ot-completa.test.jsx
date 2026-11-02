// tests/ot-completa.test.jsx — La OT se ve completa en toda la app: Código ·
// Cliente · Proyecto (columna OBRA) · Descripción (Tadeo, 02/11). Una sola
// pieza (app/lib/nombreOt.js + NombreOt) y las pantallas la usan.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup } from "@testing-library/react";
import { partesOt, textoOt, detalleOt, mapaOts, otCompleta, textoRenglonOt } from "../app/lib/nombreOt.js";
import { textoPedido } from "../app/lib/compras.js";
import { textoMovimiento } from "../app/lib/movimientosStock.js";

const { default: NombreOt, TituloOt } = await import("../app/components/NombreOt.jsx");
afterEach(() => cleanup());

const OT = { ot: "7961", cliente: "RIOFRIO IVAN", obra: "EDIFICIO MAIPU DEPTO 10", proyecto: "M-7961-01", descripcion: "COCINA" };

test("textoOt — Código · Cliente · Proyecto · Descripción, nunca la columna C", () => {
  assert.equal(textoOt(OT), "OT 7961 · RIOFRIO IVAN · EDIFICIO MAIPU DEPTO 10 · COCINA");
  assert.equal(detalleOt(OT), "RIOFRIO IVAN · EDIFICIO MAIPU DEPTO 10 · COCINA");
  assert.ok(!textoOt(OT).includes("M-7961-01"), "el código de PROYECTO (columna C) no sale");
});

test("partesOt — se saltean los vacíos y lo que repite el cliente o la obra", () => {
  assert.equal(textoOt({ ot: "1", cliente: "BCG", obra: "", descripcion: "Cocina" }), "OT 1 · BCG · Cocina");
  assert.equal(textoOt({ ot: "1", cliente: "BCG", obra: "bcg", descripcion: "BCG" }), "OT 1 · BCG");
  assert.equal(textoOt({ ot: "1", cliente: "  ", obra: "Torre", descripcion: "Torre" }), "OT 1 · Torre");
  assert.deepEqual(partesOt(null), { codigo: "", cliente: "", proyecto: "", descripcion: "" });
  assert.equal(textoOt({ ot: "7" }), "OT 7");
});

test("otCompleta — una OT que solo trae el número toma sus datos de la lista", () => {
  const mapa = mapaOts([OT, { ot: "7495", cliente: "BCG" }]);
  assert.equal(textoOt(otCompleta(" 7961 ", mapa)), "OT 7961 · RIOFRIO IVAN · EDIFICIO MAIPU DEPTO 10 · COCINA");
  assert.equal(textoOt(otCompleta("9999", mapa, { cliente: "Guardado" })), "OT 9999 · Guardado", "si no está, lo que traiga el renglón");
  assert.equal(otCompleta("", mapa), null);
});

test("textoRenglonOt — renglón de la minuta con OT o sin OT todavía", () => {
  const mapa = mapaOts([OT]);
  assert.equal(textoRenglonOt({ ot: "7961", proyecto: "viejo", cliente: "viejo" }, mapa), textoOt(OT));
  assert.equal(textoRenglonOt({ ot: "7000", proyecto: "Alacenas", cliente: "PRANA" }), "OT 7000 · PRANA · Alacenas");
  assert.equal(textoRenglonOt({ ot: null, proyecto: "Vestidor", cliente: "Pérez" }), "Vestidor · Pérez");
});

test("compras y stock — el pedido y el movimiento muestran la OT completa", () => {
  const mapa = mapaOts([OT]);
  assert.equal(textoPedido({ descripcion: "Placa MDF", cantidad: 4, unidad: "placas", ot: "7961" }, mapa),
    "Placa MDF · 4 placas · OT 7961 · RIOFRIO IVAN · EDIFICIO MAIPU DEPTO 10 · COCINA");
  assert.equal(textoMovimiento({ tipo: "consumo", cantidad: 3, unidad: "MT", ot: "7961" }, mapa),
    "📦 Retiro · 3 MT · OT 7961 · RIOFRIO IVAN · EDIFICIO MAIPU DEPTO 10 · COCINA");
  assert.equal(textoPedido({ descripcion: "Placa MDF", cantidad: 4, ot: "7961" }), "Placa MDF · 4 · OT 7961", "sin la lista, el número");
});

test("NombreOt — en un renglón y en bloque; TituloOt para las ventanas", () => {
  render(<NombreOt proyecto={OT} />);
  assert.ok(screen.getByText((_, el) => el?.hasAttribute?.("data-nombre-ot") && el.textContent === "OT 7961 · RIOFRIO IVAN · EDIFICIO MAIPU DEPTO 10 · COCINA"));
  cleanup();
  const { container } = render(<NombreOt proyecto={OT} forma="bloque" sinCodigo />);
  assert.equal(container.querySelector("[data-cliente]").textContent, "RIOFRIO IVAN");
  assert.equal(container.querySelector("[data-obra]").textContent, "EDIFICIO MAIPU DEPTO 10");
  assert.equal(container.querySelector("[data-descripcion]").textContent, "COCINA");
  assert.ok(!container.textContent.includes("OT 7961"));
  cleanup();
  const t = render(<TituloOt proyecto={OT} />);
  assert.equal(t.container.querySelector("h3").textContent, "RIOFRIO IVAN");
  assert.equal(t.container.querySelector("[data-obra-descripcion]").textContent, "EDIFICIO MAIPU DEPTO 10 · COCINA");
});

test("pantallas — ninguna arma el nombre de la OT a mano con la columna C", () => {
  const PANTALLAS = [
    "app/proyectos_screen.jsx", "app/components/TableroOt.jsx", "app/components/PlanificacionScreen.jsx",
    "app/components/CerrarOtViejas.jsx", "app/components/DetalleOp.jsx", "app/components/PiezasOt.jsx",
    "app/components/SueltosOt.jsx", "app/components/EtiquetasModulos.jsx", "app/components/CargaOt.jsx",
    "app/components/ActaOt.jsx", "app/dashboard_gerencia.jsx", "app/actividad_screen.jsx",
    "app/components/ElegirOtCarga.jsx",
  ];
  for (const f of PANTALLAS) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /cliente \|\| [\w?.]*proyecto/, `${f}: usá NombreOt / textoOt (app/lib/nombreOt.js)`);
  }
});
