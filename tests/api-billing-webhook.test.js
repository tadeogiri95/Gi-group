// tests/api-billing-webhook.test.js — Tests HTTP de POST /api/billing/webhook
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createFetchMock } from "./helpers/mockFetch.js";

const WH_SECRET = "test-webhook-secret";

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  process.env.MERCADOPAGO_WEBHOOK_SECRET = WH_SECRET;
  process.env.MERCADOPAGO_ACCESS_TOKEN = "test-mp-token";
  // lib/email.js construye `new Resend(...)` al importarse — necesita una
  // key truthy o tira. Los envíos en sí son fire-and-forget (ver mockFetch).
  process.env.RESEND_API_KEY = "re_test_dummy_key";
});

const { POST } = await import("../app/api/billing/webhook/route.js");

const EMPRESA_ID = "11111111-1111-1111-1111-111111111111";
const SUSC_ID = "5";

function firmar({ dataId, requestId = "req-1", ts = String(Date.now()) }) {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac("sha256", WH_SECRET).update(manifest).digest("hex");
  return { signature: `ts=${ts},v1=${v1}`, requestId };
}

function req({ body, dataId, firmaValida = true, requestIdOverride }) {
  const url = `http://localhost/api/billing/webhook?data.id=${dataId}`;
  let headers = { "Content-Type": "application/json" };
  if (firmaValida) {
    const { signature, requestId } = firmar({ dataId, requestId: requestIdOverride });
    headers["x-signature"] = signature;
    headers["x-request-id"] = requestId;
  } else {
    headers["x-signature"] = "ts=123,v1=firmainvalida00000000000000000000000000000000000000000000000000";
    headers["x-request-id"] = "req-falso";
  }
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  global.fetch = createFetchMock([]);
});

test("webhook — firma HMAC inválida devuelve 401", async () => {
  const res = await POST(req({ body: { type: "payment", data: { id: "999" } }, dataId: "999", firmaValida: false }));
  const json = await res.json();
  assert.equal(res.status, 401);
  assert.equal(json.ok, false);
});

test("webhook — pago aprobado nuevo: inserta pago, activa suscripción y plan", async () => {
  const externalRef = `gypi-${EMPRESA_ID}-${SUSC_ID}`;
  let pagoInsertado = null;
  let empresaPatched = null;

  global.fetch = createFetchMock([
    { match: (url) => url.includes("api.mercadopago.com/v1/payments/"), respond: () => ({
      status: 200,
      body: { id: 777, status: "approved", transaction_amount: 35000, currency_id: "ARS", external_reference: externalRef, date_approved: "2026-01-01T00:00:00Z" },
    }) },
    { match: (url) => url.includes("/rest/v1/pagos") && url.includes("gateway_payment_id"), respond: () => ({ status: 200, body: [] }) }, // idempotencia: no existe todavía
    { match: (url, opts) => url.includes("/rest/v1/pagos") && opts.method === "POST", respond: (url, opts) => { pagoInsertado = JSON.parse(opts.body); return { status: 201, body: [{ id: 1 }] }; } },
    { match: (url, opts) => url.includes("/rest/v1/suscripciones") && opts.method === "PATCH", respond: () => ({ status: 204 }) },
    { match: (url) => url.includes("/rest/v1/suscripciones") && url.includes("select=plan"), respond: () => ({ status: 200, body: [{ plan: "pro" }] }) },
    { match: (url, opts) => url.includes("/rest/v1/empresa") && opts.method === "PATCH", respond: (url, opts) => { empresaPatched = JSON.parse(opts.body); return { status: 204 }; } },
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes("admin_email"), respond: () => ({ status: 200, body: [{ admin_email: null }] }) },
  ]);

  const res = await POST(req({ body: { type: "payment", data: { id: "777" } }, dataId: "777" }));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.accion, "pago_aprobado");
  assert.equal(pagoInsertado.estado, "aprobado");
  assert.equal(pagoInsertado.gateway_payment_id, "777");
  assert.equal(empresaPatched.plan_activo, "pro");
});

test("webhook — pago ya procesado (retry de MP) es idempotente", async () => {
  const externalRef = `gypi-${EMPRESA_ID}-${SUSC_ID}`;
  let seInsertoOtraVez = false;

  global.fetch = createFetchMock([
    { match: (url) => url.includes("api.mercadopago.com/v1/payments/"), respond: () => ({
      status: 200,
      body: { id: 777, status: "approved", transaction_amount: 35000, external_reference: externalRef },
    }) },
    { match: (url) => url.includes("/rest/v1/pagos") && url.includes("gateway_payment_id"), respond: () => ({ status: 200, body: [{ id: 1 }] }) }, // ya existe
    { match: (url) => url.includes("/rest/v1/suscripciones") && url.includes("select=plan"), respond: () => ({ status: 200, body: [{ plan: "pro" }] }) },
    { match: (url) => url.includes("/rest/v1/empresa") && url.includes("select=plan_activo"), respond: () => ({ status: 200, body: [{ plan_activo: "pro" }] }) },
    { match: (url, opts) => url.includes("/rest/v1/pagos") && opts.method === "POST", respond: () => { seInsertoOtraVez = true; return { status: 201, body: [{ id: 2 }] }; } },
  ]);

  const res = await POST(req({ body: { type: "payment", data: { id: "777" } }, dataId: "777" }));
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.accion, "pago_ya_procesado");
  assert.equal(seInsertoOtraVez, false, "no debe insertar el pago de nuevo");
});

test("webhook — sin MERCADOPAGO_WEBHOOK_SECRET configurado devuelve 500 (no bypass)", async () => {
  const prev = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
  try {
    // Query string fuerza una re-evaluación del módulo (con el WH_SECRET del
    // entorno actual, ya borrado) en vez de usar la copia cacheada.
    const mod = await import(`../app/api/billing/webhook/route.js?t=${Date.now()}`);
    const res = await mod.POST(req({ body: {}, dataId: "1", firmaValida: false }));
    assert.equal(res.status, 500);
  } finally {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = prev;
  }
});

// ─── Integration tests (nuevos) ───────────────────────────────────────────────

test("webhook — firma válida con timestamp fresco procesa pago aprobado", async () => {
  const externalRef = `gypi-${EMPRESA_ID}-${SUSC_ID}`;
  // ts = ahora (dentro de la ventana de 5 minutos)
  const tsAhora = String(Date.now());
  const dataId = "888";
  const manifest = `id:${dataId};request-id:req-fresco;ts:${tsAhora};`;
  const v1 = (await import("node:crypto")).default.createHmac("sha256", WH_SECRET).update(manifest).digest("hex");

  const headers = {
    "Content-Type": "application/json",
    "x-signature": `ts=${tsAhora},v1=${v1}`,
    "x-request-id": "req-fresco",
  };
  const url = `http://localhost/api/billing/webhook?data.id=${dataId}`;
  const request = new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "payment", data: { id: dataId } }),
  });

  global.fetch = createFetchMock([
    { match: (u) => u.includes("api.mercadopago.com/v1/payments/"), respond: () => ({ status: 200, body: { id: Number(dataId), status: "approved", transaction_amount: 35000, currency_id: "ARS", external_reference: externalRef, date_approved: "2026-06-16T00:00:00Z" } }) },
    { match: (u) => u.includes("/rest/v1/pagos") && u.includes("gateway_payment_id"), respond: () => ({ status: 200, body: [] }) },
    { match: (u, o) => u.includes("/rest/v1/pagos") && o.method === "POST", respond: () => ({ status: 201, body: [{ id: 10 }] }) },
    { match: (u, o) => u.includes("/rest/v1/suscripciones") && o.method === "PATCH", respond: () => ({ status: 204 }) },
    { match: (u) => u.includes("/rest/v1/suscripciones") && u.includes("select=plan"), respond: () => ({ status: 200, body: [{ plan: "pro" }] }) },
    { match: (u, o) => u.includes("/rest/v1/empresa") && o.method === "PATCH", respond: () => ({ status: 204 }) },
    { match: (u) => u.includes("/rest/v1/empresa") && u.includes("admin_email"), respond: () => ({ status: 200, body: [{ admin_email: null }] }) },
  ]);

  const res = await POST(request);
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.accion, "pago_aprobado");
});

test("webhook — firma válida pero timestamp obsoleto (>5min) devuelve 403 replay", async () => {
  const dataId = "999";
  // ts = hace 6 minutos (fuera de la ventana)
  const tsViejo = String(Date.now() - 6 * 60 * 1000);
  const manifest = `id:${dataId};request-id:req-viejo;ts:${tsViejo};`;
  const v1 = (await import("node:crypto")).default.createHmac("sha256", WH_SECRET).update(manifest).digest("hex");

  const headers = {
    "Content-Type": "application/json",
    "x-signature": `ts=${tsViejo},v1=${v1}`,
    "x-request-id": "req-viejo",
  };
  const url = `http://localhost/api/billing/webhook?data.id=${dataId}`;
  const request = new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "payment", data: { id: dataId } }),
  });

  const res = await POST(request);
  const json = await res.json();

  assert.equal(res.status, 403, "replay con timestamp viejo debe ser rechazado con 403");
  assert.equal(json.ok, false);
  assert.ok(json.error.toLowerCase().includes("replay"), "el error debe mencionar replay");
});

test("webhook — firma HMAC inválida devuelve 401 (integración reforzada)", async () => {
  const dataId = "321";
  const headers = {
    "Content-Type": "application/json",
    // Firma completamente falsa — no deriva del secret correcto
    "x-signature": `ts=${Date.now()},v1=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
    "x-request-id": "req-falso-integracion",
  };
  const url = `http://localhost/api/billing/webhook?data.id=${dataId}`;
  const request = new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "payment", data: { id: dataId } }),
  });

  const res = await POST(request);
  const json = await res.json();

  assert.equal(res.status, 401);
  assert.equal(json.ok, false);
  // Ninguna llamada a MP ni a Supabase debe haberse hecho
});

test("webhook — un fallo de facturación ARCA no rompe la aprobación del pago", async (t) => {
  const externalRef = `gypi-${EMPRESA_ID}-${SUSC_ID}`;
  t.mock.module("../app/lib/afip.js", {
    exports: { emitirFacturaC: async () => { throw new Error("ARCA caído (simulado)"); } },
  });

  global.fetch = createFetchMock([
    { match: (u) => u.includes("api.mercadopago.com/v1/payments/"), respond: () => ({ status: 200, body: { id: 555, status: "approved", transaction_amount: 35000, currency_id: "ARS", external_reference: externalRef, date_approved: "2026-06-16T00:00:00Z" } }) },
    { match: (u) => u.includes("/rest/v1/pagos") && u.includes("gateway_payment_id"), respond: () => ({ status: 200, body: [] }) },
    { match: (u, o) => u.includes("/rest/v1/pagos") && o.method === "POST", respond: () => ({ status: 201, body: [{ id: 99 }] }) },
    { match: (u, o) => u.includes("/rest/v1/suscripciones") && o.method === "PATCH", respond: () => ({ status: 204 }) },
    { match: (u) => u.includes("/rest/v1/suscripciones") && u.includes("select=plan"), respond: () => ({ status: 200, body: [{ plan: "pro" }] }) },
    { match: (u, o) => u.includes("/rest/v1/empresa") && o.method === "PATCH", respond: () => ({ status: 204 }) },
    { match: (u) => u.includes("/rest/v1/empresa") && u.includes("admin_email"), respond: () => ({ status: 200, body: [{ admin_email: null }] }) },
  ]);

  const mod = await import(`../app/api/billing/webhook/route.js?t=${Date.now()}`);
  const res = await mod.POST(req({ body: { type: "payment", data: { id: "555" } }, dataId: "555" }));
  const json = await res.json();

  assert.equal(res.status, 200, "el pago debe aprobarse igual aunque emitirFacturaC tire excepción");
  assert.equal(json.accion, "pago_aprobado");
});

test("webhook — mismo payment_id enviado dos veces: segundo call es no-op (idempotencia)", async () => {
  const externalRef = `gypi-${EMPRESA_ID}-${SUSC_ID}`;
  const dataId = "777";
  let insertCount = 0;

  // Primera llamada: pago no existe → lo inserta
  const mocksPrimeraVez = [
    { match: (u) => u.includes("api.mercadopago.com/v1/payments/"), respond: () => ({ status: 200, body: { id: Number(dataId), status: "approved", transaction_amount: 35000, currency_id: "ARS", external_reference: externalRef, date_approved: "2026-06-16T00:00:00Z" } }) },
    { match: (u) => u.includes("/rest/v1/pagos") && u.includes("gateway_payment_id"), respond: () => ({ status: 200, body: [] }) }, // no existe aún
    { match: (u, o) => u.includes("/rest/v1/pagos") && o.method === "POST", respond: () => { insertCount++; return { status: 201, body: [{ id: 1 }] }; } },
    { match: (u, o) => u.includes("/rest/v1/suscripciones") && o.method === "PATCH", respond: () => ({ status: 204 }) },
    { match: (u) => u.includes("/rest/v1/suscripciones") && u.includes("select=plan"), respond: () => ({ status: 200, body: [{ plan: "pro" }] }) },
    { match: (u, o) => u.includes("/rest/v1/empresa") && o.method === "PATCH", respond: () => ({ status: 204 }) },
    { match: (u) => u.includes("/rest/v1/empresa") && u.includes("admin_email"), respond: () => ({ status: 200, body: [{ admin_email: null }] }) },
  ];

  global.fetch = createFetchMock(mocksPrimeraVez);
  const res1 = await POST(req({ body: { type: "payment", data: { id: dataId } }, dataId }));
  const json1 = await res1.json();
  assert.equal(json1.accion, "pago_aprobado", "primera llamada debe procesar el pago");
  assert.equal(insertCount, 1);

  // Segunda llamada: pago ya existe → debe ser no-op
  const mocksSegundaVez = [
    { match: (u) => u.includes("api.mercadopago.com/v1/payments/"), respond: () => ({ status: 200, body: { id: Number(dataId), status: "approved", transaction_amount: 35000, currency_id: "ARS", external_reference: externalRef } }) },
    { match: (u) => u.includes("/rest/v1/pagos") && u.includes("gateway_payment_id"), respond: () => ({ status: 200, body: [{ id: 1 }] }) }, // ya existe
    { match: (u) => u.includes("/rest/v1/suscripciones") && u.includes("select=plan"), respond: () => ({ status: 200, body: [{ plan: "pro" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa") && u.includes("select=plan_activo"), respond: () => ({ status: 200, body: [{ plan_activo: "pro" }] }) },
    // Este handler captura un intento de inserción que NO debe ocurrir
    { match: (u, o) => u.includes("/rest/v1/pagos") && o.method === "POST", respond: () => { insertCount++; return { status: 201, body: [{ id: 2 }] }; } },
  ];

  global.fetch = createFetchMock(mocksSegundaVez);
  const res2 = await POST(req({ body: { type: "payment", data: { id: dataId } }, dataId }));
  const json2 = await res2.json();

  assert.equal(res2.status, 200);
  assert.equal(json2.accion, "pago_ya_procesado", "segunda llamada debe ser no-op");
  assert.equal(insertCount, 1, "no debe haber insertado el pago por segunda vez");
});
