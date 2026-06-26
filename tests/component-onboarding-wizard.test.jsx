// tests/component-onboarding-wizard.test.jsx — Test de componente (RTL) para
// OnboardingWizard: confirma que la alta de empleados al finalizar usa el
// endpoint masivo /api/empleados/import-csv (no el singular /api/empleados).
import "./helpers/domSetup.js";
import { test, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock } from "./helpers/mockFetch.js";

const { default: OnboardingWizard } = await import("../app/onboarding_wizard.jsx");
const { setToken } = await import("../app/lib/supabase.js");

before(() => setToken("fake-token-de-test"));
afterEach(() => cleanup());

const EMPRESA = { id: "emp-1" };

function completarNombre() {
  fireEvent.change(screen.getByPlaceholderText("Nombre de la empresa"), { target: { value: "Empresa Test" } });
}

function irAPasoEmpleados() {
  completarNombre();
  fireEvent.click(screen.getByText("Saltar plantilla")); // paso 1 → 2 (sin divisiones/etapas)
  fireEvent.click(screen.getByText("Siguiente →")); // paso 2 → 3
}

function handlerEmpresaPatch() {
  return { match: (url, opts) => url.includes("/api/data") && opts.method === "POST", respond: () => ({ status: 200, body: { ok: true, data: [{}] } }) };
}

test("OnboardingWizard — finalizar importa empleados vía /api/empleados/import-csv, no el endpoint singular", async () => {
  let legacySingularCalled = false;
  let importCsvBody = null;
  let importCsvContentType = null;

  global.fetch = createFetchMock([
    handlerEmpresaPatch(),
    {
      match: (url, opts) => url.endsWith("/api/empleados") && opts.method === "POST",
      respond: () => { legacySingularCalled = true; return { status: 201, body: {} }; },
    },
    {
      match: (url) => url.includes("/api/empleados/import-csv"),
      respond: (url, opts) => {
        importCsvBody = opts.body;
        importCsvContentType = opts.headers["Content-Type"];
        return { status: 200, body: { ok: true, created: 2, skipped: 0, errors: [] } };
      },
    },
  ]);

  let empresaRecibida = null;
  render(<OnboardingWizard empresa={EMPRESA} usuario={{ empresa_id: "emp-1" }} onComplete={(e) => { empresaRecibida = e; }} />);

  irAPasoEmpleados();

  // Fila 1: legajo explícito
  fireEvent.click(screen.getByText("+ Agregar"));
  fireEvent.change(screen.getByPlaceholderText("Nombre completo"), { target: { value: "Ana Gómez" } });
  fireEvent.change(screen.getByPlaceholderText("Legajo"), { target: { value: "55" } });

  // Fila 2: sin legajo — debe autogenerarse y no colisionar con la fila 1
  fireEvent.click(screen.getByText("+ Agregar"));
  const nombres = screen.getAllByPlaceholderText("Nombre completo");
  fireEvent.change(nombres[1], { target: { value: "Luis Díaz" } });

  fireEvent.click(screen.getByText("Siguiente →")); // paso 3 → 4
  fireEvent.click(screen.getByText("🚀 Empezar a usar Gypi"));

  await waitFor(() => assert.notEqual(importCsvBody, null));
  await waitFor(() => assert.notEqual(empresaRecibida, null));

  assert.equal(legacySingularCalled, false);
  assert.equal(importCsvContentType, "text/plain");

  const lineas = importCsvBody.trim().split("\n");
  assert.equal(lineas[0], "legajo,nombre,division,rol");
  assert.equal(lineas.length, 3);

  const fila1 = lineas[1].split(",");
  const fila2 = lineas[2].split(",");
  assert.equal(fila1[0], "55");
  assert.equal(fila1[1], "Ana Gómez");
  assert.equal(fila1[3], "operativo");
  assert.match(fila2[0], /^\d+$/);
  assert.notEqual(fila2[0], fila1[0]);
  assert.equal(fila2[1], "Luis Díaz");
});

test("OnboardingWizard — finalizar crea divisiones y etapas en paralelo (Promise.all), no secuencial", async () => {
  const llamadas = [];
  let enVuelo = 0;
  let maxConcurrentes = 0;

  global.fetch = createFetchMock([
    handlerEmpresaPatch(),
    {
      match: (url, opts) => url.endsWith("/api/config-empresa") && opts.method === "POST",
      respond: (url, opts) => {
        llamadas.push(JSON.parse(opts.body));
        enVuelo++;
        maxConcurrentes = Math.max(maxConcurrentes, enVuelo);
        return new Promise((resolve) => {
          setTimeout(() => { enVuelo--; resolve({ status: 200, body: { ok: true } }); }, 10);
        });
      },
    },
  ]);

  let empresaRecibida = null;
  render(<OnboardingWizard empresa={EMPRESA} usuario={{ empresa_id: "emp-1" }} onComplete={(e) => { empresaRecibida = e; }} />);

  // Plantilla "industria" autogenera 5 divisiones + 6 etapas (PLANTILLAS.industria)
  completarNombre();
  fireEvent.click(screen.getByText("Industria / Manufactura"));
  fireEvent.click(screen.getByText("Siguiente →")); // paso 1 → 2
  fireEvent.click(screen.getByText("Siguiente →")); // paso 2 → 3
  fireEvent.click(screen.getByText("Siguiente →")); // paso 3 → 4, sin empleados
  fireEvent.click(screen.getByText("🚀 Empezar a usar Gypi"));

  await waitFor(() => assert.notEqual(empresaRecibida, null));

  assert.equal(llamadas.length, 11, "5 divisiones + 6 etapas de la plantilla industria");
  assert.equal(llamadas.filter((b) => b.action === "add_division").length, 5);
  assert.equal(llamadas.filter((b) => b.action === "add_etapa").length, 6);
  assert.equal(maxConcurrentes, 11, "las 11 llamadas deben dispararse en paralelo vía Promise.all, no una por una");
});

test("OnboardingWizard — sin empleados cargados no llama a import-csv", async () => {
  let importCsvCalled = false;
  global.fetch = createFetchMock([
    handlerEmpresaPatch(),
    { match: (url) => url.includes("/api/empleados/import-csv"), respond: () => { importCsvCalled = true; return { status: 200, body: { ok: true, created: 0, skipped: 0, errors: [] } }; } },
  ]);

  let completado = false;
  render(<OnboardingWizard empresa={EMPRESA} usuario={{ empresa_id: "emp-1" }} onComplete={() => { completado = true; }} />);

  irAPasoEmpleados();
  fireEvent.click(screen.getByText("Siguiente →")); // paso 3 → 4, sin agregar empleados
  fireEvent.click(screen.getByText("🚀 Empezar a usar Gypi"));

  await waitFor(() => assert.equal(completado, true));
  assert.equal(importCsvCalled, false);
});
