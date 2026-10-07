// tests/component-empresa-no-encontrada.test.jsx — "Empresa no encontrada"
// ya no deja al usuario sin salida (F4-17).
import "./helpers/domSetup.js";
import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const { default: EmpresaNoEncontrada } = await import("../app/components/EmpresaNoEncontrada.jsx");
const { recordarEmpresa, ultimaEmpresa, normalizarCodigo } = await import("../app/lib/ultimaEmpresa.js");

beforeEach(() => { try { localStorage.clear(); } catch {} });
afterEach(() => cleanup());

test("normalizarCodigo — acepta el link entero, mayúsculas y espacios", () => {
  assert.equal(normalizarCodigo("  Mi-Empresa "), "mi-empresa");
  assert.equal(normalizarCodigo("https://gypi.app/acme?screen=chat"), "acme");
  assert.equal(normalizarCodigo("gypi.app/acme/unirse"), "acme");
  assert.equal(normalizarCodigo("a c m e!"), "acme");
});

test("recordarEmpresa / ultimaEmpresa — guarda la última empresa y descarta basura", () => {
  recordarEmpresa({ slug: "acme", nombre_corto: "ACME" });
  assert.deepEqual(ultimaEmpresa(), { slug: "acme", nombre: "ACME" });
  localStorage.setItem("gypi_ultima_empresa", JSON.stringify({ slug: "javascript:alert(1)" }));
  assert.equal(ultimaEmpresa(), null);
});

test("ofrece volver a la última empresa usada en este dispositivo", () => {
  recordarEmpresa({ slug: "acme", nombre_corto: "ACME" });
  render(<EmpresaNoEncontrada slugActual="acmee" />);
  const link = screen.getByRole("link", { name: "Ir a ACME" });
  assert.equal(link.getAttribute("href"), "/acme");
  assert.ok(screen.getByRole("link", { name: "Ir a la página de Gypi" }));
});

test("sin última empresa no muestra ese botón, pero sí el buscador", () => {
  render(<EmpresaNoEncontrada slugActual="xx" />);
  assert.equal(screen.queryByRole("link", { name: /^Ir a (?!la página)/ }), null);
  assert.ok(screen.getByLabelText("Código de tu empresa"));
});

test("buscar un código inexistente muestra un error claro", async () => {
  let pedido = null;
  global.fetch = async (url) => { pedido = String(url); return new Response(JSON.stringify({ error: "x" }), { status: 404 }); };
  render(<EmpresaNoEncontrada slugActual="xx" />);
  fireEvent.change(screen.getByLabelText("Código de tu empresa"), { target: { value: "gypi.app/Otra" } });
  fireEvent.click(screen.getByRole("button", { name: "Buscar mi empresa" }));
  await screen.findByText(/No encontramos ninguna empresa con ese código/);
  assert.equal(pedido, "/api/empresa?slug=otra");
});
