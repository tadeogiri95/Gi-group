// tests/transaccion-cobros.test.js — El aviso de Mercado Pago guarda suscripción
// y plan de la empresa en una sola transacción (ítem 38, parte 3).
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createFetchMock } from "./helpers/mockFetch.js";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
process.env.MERCADOPAGO_WEBHOOK_SECRET = "test-webhook-secret";
process.env.MERCADOPAGO_ACCESS_TOKEN = "test-mp-token";
process.env.RESEND_API_KEY = "re_test_dummy_key";

const { POST } = await import("../app/api/billing/webhook/route.js");

const EMPRESA = "11111111-1111-1111-1111-111111111111";
const SUSC = "22222222-2222-2222-2222-222222222222";
const FILA = { plan: "planta_15", estado: "activa", empresa_id: EMPRESA, gateway_subscription_id: "mp-77", precio: 94800, precio_nuevo: null, periodo: "mensual", addons: [] };

function firmado(dataId) {
  const ts = String(Date.now());
  const v1 = crypto.createHmac("sha256", "test-webhook-secret").update(`id:${dataId};request-id:r;ts:${ts};`).digest("hex");
  return new Request(`http://localhost/api/billing/webhook?data.id=${dataId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": "r" },
    body: JSON.stringify({ type: "subscription_preapproval", data: { id: dataId } }),
  });
}

function mock({ status, fila = FILA, respuesta }) {
  const c = { orden: [], rpc: null, emails: 0 };
  global.fetch = createFetchMock([
    { match: (u) => u.includes("api.mercadopago.com/preapproval/mp-77") && !u.includes("PUT"), respond: (u, o) => {
      if (o?.method === "PUT") { c.orden.push(`cancelar:${u.split("/").pop()}`); return { status: 200, body: {} }; }
      return { status: 200, body: { id: "mp-77", status, external_reference: `gypi-${EMPRESA}-${SUSC}`, auto_recurring: { transaction_amount: 94800 }, date_created: "2026-10-01T00:00:00Z", next_payment_date: "2099-01-01T00:00:00Z" } };
    } },
    { match: (u, o) => u.includes("api.mercadopago.com/preapproval/") && o?.method === "PUT", respond: (u) => { c.orden.push(`cancelar:${u.split("/").pop()}`); return { status: 200, body: {} }; } },
    { match: (u) => u.includes("/rest/v1/suscripciones?id=eq."), respond: () => ({ status: 200, body: [fila] }) },
    { match: (u) => u.includes("/rest/v1/rpc/aplicar_suscripcion"), respond: (u, o) => { c.orden.push("rpc"); c.rpc = JSON.parse(o.body); return { status: 200, body: respuesta }; } },
    { match: (u) => u.includes("/rest/v1/empresa") && u.includes("admin_email"), respond: () => ({ status: 200, body: [{ admin_email: "duena@acme.com", nombre: "Acme", slug: "acme" }] }) },
    { match: (u, o) => (u.includes("/rest/v1/suscripciones") || u.includes("/rest/v1/empresa")) && o?.method === "PATCH", respond: () => { throw new Error("ya no se escriben suscripción ni empresa en pasos sueltos"); } },
    { match: (u) => u.includes("api.resend.com"), respond: () => { c.emails++; return { status: 200, body: { id: "e" } }; } },
  ]);
  return c;
}

test("activa: una transacción, y recién después se cancelan en MP las otras suscripciones", async () => {
  const c = mock({ status: "authorized", fila: { ...FILA, estado: "suspendida" }, respuesta: { ok: true, plan: "planta_15", override: false, canceladas: ["mp-vieja"] } });
  const res = await POST(firmado("mp-77"));
  assert.equal((await res.json()).accion, "susc_activa");
  assert.deepEqual(c.orden, ["rpc", "cancelar:mp-vieja"]);
  assert.equal(c.rpc.p_cancelar_otras, true);
  assert.equal(c.rpc.p_plan_vence, null);
});

test("cancelada: manda el fin del período pago (gracia) y avisa por email", async () => {
  const c = mock({ status: "cancelled", respuesta: { ok: true, plan: "planta_15", override: false, canceladas: [] } });
  const res = await POST(firmado("mp-77"));
  assert.equal((await res.json()).accion, "susc_cancelada");
  assert.equal(c.rpc.p_estado, "cancelada");
  assert.equal(c.rpc.p_cancelar_otras, false);
  assert.equal(c.rpc.p_plan_vence, "2099-01-01T00:00:00Z");
  assert.deepEqual(c.rpc.p_datos, { gateway_customer_id: null, periodo_inicio: "2026-10-01T00:00:00Z", periodo_fin: "2099-01-01T00:00:00Z" });
});

test("dos avisos a la vez: si la base dice que ya estaba así, no repite nada", async () => {
  const c = mock({ status: "authorized", fila: { ...FILA, estado: "suspendida" }, respuesta: { ok: true, sin_cambios: true, plan: "planta_15", override: false } });
  const res = await POST(firmado("mp-77"));
  assert.equal((await res.json()).accion, "susc_activa_ya_procesado");
  assert.deepEqual(c.orden, ["rpc"], "no cancela nada en MP");
});

test("si la transacción falla, responde 500 para que Mercado Pago reintente", async () => {
  mock({ status: "authorized", fila: { ...FILA, estado: "suspendida" }, respuesta: undefined });
  global.fetch = createFetchMock([
    { match: (u) => u.includes("api.mercadopago.com/preapproval/"), respond: () => ({ status: 200, body: { id: "mp-77", status: "authorized", external_reference: `gypi-${EMPRESA}-${SUSC}`, auto_recurring: { transaction_amount: 94800 } } }) },
    { match: (u) => u.includes("/rest/v1/suscripciones?id=eq."), respond: () => ({ status: 200, body: [{ ...FILA, estado: "suspendida" }] }) },
    { match: (u) => u.includes("/rest/v1/rpc/aplicar_suscripcion"), respond: () => ({ status: 500, body: { message: "caído" } }) },
  ]);
  const res = await POST(firmado("mp-77"));
  assert.equal(res.status, 500);
});

test("migración 088 — bloquea suscripción y empresa, respeta el plan fijado a mano y solo la usa el servidor", () => {
  const sql = readFileSync(new URL("../supabase/migrations/088_aplicar_suscripcion.sql", import.meta.url), "utf8");
  assert.match(sql, /from suscripciones\s+where id = p_susc and empresa_id = p_empresa\s+for update;/);
  assert.match(sql, /from empresa where id = p_empresa\s+for update;/);
  assert.match(sql, /if not v_override then/);
  assert.match(sql, /security definer\s+set search_path = public/);
  assert.match(sql, /revoke all on function public\.aplicar_suscripcion\([^)]*\) from anon, authenticated;/);
});

test("leerReferencia — lee empresa y suscripción completas (las dos son UUID con guiones)", async () => {
  const { leerReferencia } = await import("../app/lib/validarCobro.js");
  assert.deepEqual(leerReferencia(`gypi-${EMPRESA}-${SUSC}`), { empresaId: EMPRESA, suscId: SUSC });
  assert.deepEqual(leerReferencia(`GYPI-${EMPRESA.toUpperCase()}-${SUSC}`), { empresaId: EMPRESA, suscId: SUSC });
  assert.equal(leerReferencia(`gypi-${EMPRESA}-5`), null);
  assert.equal(leerReferencia(`gypi-${EMPRESA}-${SUSC}&x=1`), null);
  assert.equal(leerReferencia(null), null);
});
