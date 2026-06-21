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
      respond: () => ({ status: 200, body: { plan: "starter", estado: "activa", precio: 15000, moneda: "ARS", gateway: "mercadopago" } }),
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
  assert.ok(screen.getAllByText("Starter").length > 0);
  assert.ok(screen.getByText("Activa"));
});

test("BillingScreen — click en Suscribirme a Pro llama a create-subscription con el plan correcto", async () => {
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

  fireEvent.click(screen.getByText("Suscribirme a Pro"));

  await waitFor(() => assert.notEqual(bodyEnviado, null));
  assert.equal(bodyEnviado.plan, "pro");
});

test("BillingScreen — error de la API de info se muestra como mensaje de error", async () => {
  global.fetch = createFetchMock([
    { match: (url) => url.includes("/api/billing/info"), respond: () => ({ status: 200, body: { error: "Suscripción no encontrada" } }) },
  ]);

  render(<BillingScreen onClose={() => {}} />);
  await waitFor(() => assert.ok(screen.queryByText(/Suscripción no encontrada/)));
});
