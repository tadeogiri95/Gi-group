// tests/ux-alta-corta.test.jsx — R10 de la reforma UX: alta de empresa más corta.
// U-14: la plantilla del rubro se muestra para leer, sin campos técnicos.
// U-15: lo cargado se guarda solo; si cierra, sigue desde el mismo paso.
// Además: personalización opcional dentro del resumen y "mandármelas por email".
import "./helpers/domSetup.js";
import { test, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock } from "./helpers/mockFetch.js";

const { default: OnboardingWizard } = await import("../app/onboarding_wizard.jsx");
const { setToken } = await import("../app/lib/supabase.js");

before(() => setToken("fake-token-de-test"));
afterEach(() => { cleanup(); localStorage.clear(); });

const PROPS = { empresa: { id: "emp-1", nombre: "Mi empresa" }, usuario: { empresa_id: "emp-1" } };

test("Paso 1 — elegir el rubro muestra sectores y etapas para leer, sin clave, código, emoji ni color", () => {
  const { container } = render(<OnboardingWizard {...PROPS} />);
  assert.ok(screen.getByText("Paso 1 de 6 · Tu empresa"));
  fireEvent.click(screen.getByText("Industria / Manufactura"));
  assert.equal(screen.getByText("Industria / Manufactura").closest("button").getAttribute("aria-pressed"), "true");
  assert.ok(screen.getByText("Sectores (5)"));
  assert.ok(screen.getByText("🔥 Herrería"));
  assert.ok(screen.getByText("3. Soldadura"));
  assert.ok(screen.getByText(/Las cambiás cuando quieras/));
  // Lo único para escribir es el nombre de la empresa
  assert.equal(container.querySelectorAll("input").length, 1);
  assert.equal(container.querySelector('input[type="color"]'), null);
  assert.equal(screen.queryByPlaceholderText("clave"), null);
  assert.equal(screen.queryByText("Saltar plantilla"), null);
});

test("Paso 1 — sin nombre no avanza", () => {
  render(<OnboardingWizard {...PROPS} />);
  fireEvent.change(screen.getByLabelText("¿Cómo se llama tu empresa?"), { target: { value: "  " } });
  assert.equal(screen.getByText("Siguiente →").closest("button").disabled, true);
});

test("Borrador — si se cierra y vuelve, sigue en el mismo paso con lo cargado", () => {
  render(<OnboardingWizard {...PROPS} />);
  fireEvent.change(screen.getByLabelText("¿Cómo se llama tu empresa?"), { target: { value: "Metalúrgica Sur" } });
  fireEvent.click(screen.getByText("Construcción"));
  fireEvent.click(screen.getByText("Siguiente →")); // → 2
  fireEvent.click(screen.getByText("Saltar →")); // → 3
  fireEvent.click(screen.getByText("Siguiente →")); // → 4
  fireEvent.click(screen.getByText("+ Agregar"));
  fireEvent.change(screen.getByPlaceholderText("Nombre completo"), { target: { value: "Ana Gómez" } });
  cleanup(); // cerró la pestaña

  render(<OnboardingWizard {...PROPS} />);
  assert.ok(screen.getByText("Paso 4 de 6 · Equipo"));
  assert.ok(screen.getByText("Seguís donde lo dejaste."));
  assert.equal(screen.getByPlaceholderText("Nombre completo").value, "Ana Gómez");
  // El sector de la plantilla elegida sigue disponible
  assert.ok(screen.getByRole("option", { name: "Obra" }));
});

test("Borrador — «Empezar de nuevo» lo borra y vuelve al paso 1", () => {
  localStorage.setItem("gypi_alta_emp-1", JSON.stringify({ v: 1, step: 3, nombreEmpresa: "Vieja", rubro: "comercio" }));
  render(<OnboardingWizard {...PROPS} />);
  assert.ok(screen.getByText("Paso 3 de 6 · Horario"));
  fireEvent.click(screen.getByText("Empezar de nuevo"));
  assert.ok(screen.getByText("Paso 1 de 6 · Tu empresa"));
  assert.equal(screen.getByLabelText("¿Cómo se llama tu empresa?").value, "Mi empresa");
  assert.equal(screen.queryByText("Seguís donde lo dejaste."), null);
});

test("Borrador — uno roto o de otra versión se ignora", () => {
  localStorage.setItem("gypi_alta_emp-1", "{no es json");
  render(<OnboardingWizard {...PROPS} />);
  assert.ok(screen.getByText("Paso 1 de 6 · Tu empresa"));
  cleanup();
  localStorage.setItem("gypi_alta_emp-1", JSON.stringify({ v: 99, step: 5 }));
  render(<OnboardingWizard {...PROPS} />);
  assert.ok(screen.getByText("Paso 1 de 6 · Tu empresa"));
});

test("Resumen — logo y colores son opcionales y están plegados", () => {
  localStorage.setItem("gypi_alta_emp-1", JSON.stringify({ v: 1, step: 6, nombreEmpresa: "Acme" }));
  const { container } = render(<OnboardingWizard {...PROPS} />);
  const plegable = screen.getByRole("button", { name: /Logo y colores/ });
  assert.equal(plegable.getAttribute("aria-expanded"), "false");
  assert.equal(container.querySelector('input[type="color"]'), null);
  fireEvent.click(plegable);
  assert.equal(container.querySelectorAll('input[type="color"]').length, 2);
  assert.ok(screen.getByText("📤 Subir logo"));
});

test("Cierre — manda las tarjetas por email y al terminar borra el borrador", async () => {
  let pedidoEmail = null;
  global.fetch = createFetchMock([
    { match: (u) => u.includes("/api/data"), respond: () => ({ status: 200, body: { ok: true, data: [{}] } }) },
    {
      match: (u) => u.includes("/api/empleados/import-csv"),
      respond: () => ({ status: 200, body: { ok: true, created: 1, errors: [], activaciones: [{ legajo: 7, nombre: "Ana Gómez", codigo: "ABCD-2345", link: "https://gypi.app/acme/unirse?code=ABCD-2345" }] } }),
    },
    {
      match: (u) => u.includes("/api/empleados/tarjetas-email"),
      respond: (u, o) => { pedidoEmail = JSON.parse(o.body); return { status: 200, body: { ok: true, email: "duena@acme.com", enviadas: 1 } }; },
    },
  ]);
  localStorage.setItem("gypi_alta_emp-1", JSON.stringify({ v: 1, step: 6, nombreEmpresa: "Acme", empleados: [{ nombre: "Ana Gómez", legajo: "7", division: "", rol: "operativo" }] }));
  render(<OnboardingWizard {...PROPS} />);
  fireEvent.click(screen.getByText("🚀 Empezar a usar Gypi"));
  assert.ok(await screen.findByText("Tu equipo ya está cargado"));
  assert.equal(localStorage.getItem("gypi_alta_emp-1"), null, "terminó: no queda borrador");

  fireEvent.click(screen.getByText("📧 Mandármelas por email"));
  assert.ok(await screen.findByText(/te las mandamos a duena@acme.com/));
  assert.deepEqual(pedidoEmail, { tarjetas: [{ legajo: 7, codigo: "ABCD-2345" }] }, "solo legajo y código; el destino lo pone el servidor");
  assert.equal(screen.getByText("📧 Mandármelas por email").closest("button").disabled, true, "no se manda dos veces");
});

test("Cierre — si el email falla, lo dice y deja reintentar", async () => {
  global.fetch = createFetchMock([
    { match: (u) => u.includes("/api/data"), respond: () => ({ status: 200, body: { ok: true, data: [{}] } }) },
    { match: (u) => u.includes("/api/empleados/import-csv"), respond: () => ({ status: 200, body: { ok: true, created: 1, errors: [], activaciones: [{ legajo: 7, nombre: "Ana", codigo: "ABCD-2345", link: "x" }] } }) },
    { match: (u) => u.includes("/api/empleados/tarjetas-email"), respond: () => ({ status: 502, body: { error: "No pudimos mandar el email. Imprimilas desde acá o probá en un rato." } }) },
  ]);
  localStorage.setItem("gypi_alta_emp-1", JSON.stringify({ v: 1, step: 6, nombreEmpresa: "Acme", empleados: [{ nombre: "Ana", legajo: "7", division: "", rol: "operativo" }] }));
  render(<OnboardingWizard {...PROPS} />);
  fireEvent.click(screen.getByText("🚀 Empezar a usar Gypi"));
  fireEvent.click(await screen.findByText("📧 Mandármelas por email"));
  await waitFor(() => assert.match(screen.getByRole("alert").textContent, /No pudimos mandar el email/));
  assert.equal(screen.getByText("📧 Mandármelas por email").closest("button").disabled, false);
});

test("Fuente — 6 pasos y sin estilos sueltos", () => {
  const src = readFileSync(new URL("../app/onboarding_wizard.jsx", import.meta.url), "utf8");
  assert.match(src, /const TOTAL_PASOS = 6;/);
  assert.equal((src.match(/style=\{\{/g) || []).length, 0);
});
