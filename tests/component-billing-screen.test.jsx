// tests/component-billing-screen.test.jsx — Test de componente (RTL) para
// BillingScreen: carga de info de plan + flujo de upgrade.
import "./helpers/domSetup.js";
import { test, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock } from "./helpers/mockFetch.js";

const { default: BillingScreen } = await import("../app/components/BillingScreen.jsx");
const { setToken } = await import("../app/lib/supabase.js");

before(() => setToken("fake-token-de-test"));
afterEach(() => cleanup());

function handlersBase() {
  return [
    {
      match: (url) => url.includes("/api/billing/info"),
      respond: () => ({ status: 200, body: { plan: "asistencia_15", estado: "activa", precio: 23800, moneda: "ARS", gateway: "mercadopago", precio_usd: 20, addons: [] } }),
    },
    {
      match: (url) => url.includes("/api/billing/precios"),
      respond: () => ({ status: 200, body: { operarios: 12, tramo_minimo: { asistencia: 15, planta: 15 }, cotizacion: { usd_ars: 1185, fuente: "test", fecha: "2026-10-08" } } }),
    },
    {
      match: (url, opts) => url.includes("/api/data") && opts.method === "POST",
      respond: () => ({ status: 200, body: { ok: true, data: [] } }),
    },
  ];
}

test("BillingScreen — muestra el plan actual tras cargar", async () => {
  global.fetch = createFetchMock(handlersBase());
  render(<BillingScreen onClose={() => {}} />);

  await waitFor(() => assert.ok(screen.queryByText("Plan actual")));
  assert.ok(screen.getAllByText("Asistencia · hasta 15").length > 0);
  assert.ok(screen.getByText("Activa"));
  assert.ok(screen.getByText(/USD 20 al dólar oficial/));
});

test("BillingScreen — elegir Planta hasta 40 con el add-on de IA manda línea, tramo y add-ons", async () => {
  let bodyEnviado = null;
  global.fetch = createFetchMock([
    ...handlersBase(),
    {
      match: (url) => url.includes("/api/billing/create-subscription"),
      respond: (url, opts) => { bodyEnviado = JSON.parse(opts.body); return { status: 200, body: { init_point: "https://mp.test/checkout" } }; },
    },
  ]);

  render(<BillingScreen onClose={() => {}} />);
  await waitFor(() => assert.ok(screen.queryByText("Plan actual")));

  // Segunda tarjeta = Planta: tramo de 40 y el add-on Asistente IA
  fireEvent.click(screen.getAllByRole("button", { name: /Hasta 40/ })[1]);
  fireEvent.click(screen.getAllByRole("checkbox", { name: /Asistente IA/ })[1]);
  // USD 95 + 15 = 110 → 110 × 1185 = 130.350 → redondeado a $130.400
  assert.ok(screen.getByText("USD 110"));
  assert.ok(screen.getByText("$130.400"));
  fireEvent.click(screen.getByText("Suscribirme a Planta · hasta 40"));

  await waitFor(() => assert.notEqual(bodyEnviado, null));
  assert.deepEqual(bodyEnviado, { linea: "planta", tramo: 40, addons: ["ia"], periodo: "mensual" });
});

test("BillingScreen — error de la API de info se muestra como mensaje de error", async () => {
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/api/billing/info"), respond: () => ({ status: 200, body: { error: "Suscripción no encontrada" } }) },
  ]);

  render(<BillingScreen onClose={() => {}} />);
  await waitFor(() => assert.ok(screen.queryByText(/Suscripción no encontrada/)));
});

test("BillingScreen — con más operarios que el tramo, los tramos chicos no se pueden elegir", async () => {
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/api/billing/info"), respond: () => ({ status: 200, body: { plan: "trial", estado: "trial", dias_restantes: 10, precio: 0 } }) },
    { match: (url) => url.includes("/api/billing/precios"), respond: () => ({ status: 200, body: { operarios: 22, tramo_minimo: { asistencia: 40, planta: 40 }, cotizacion: { usd_ars: 1185 } } }) },
    { match: (url, opts) => url.includes("/api/data") && opts.method === "POST", respond: () => ({ status: 200, body: { ok: true, data: [] } }) },
  ]);
  render(<BillingScreen onClose={() => {}} />);
  await waitFor(() => assert.ok(screen.queryByText("Suscribirme a Asistencia · hasta 40")));
  for (const b of screen.getAllByRole("button", { name: /Hasta 15/ })) assert.equal(b.disabled, true);
  assert.ok(screen.getByText(/Hoy tenés/).textContent.includes("22"));
});
