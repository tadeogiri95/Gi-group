// tests/precios-usd.test.jsx — Precios en USD por tramos + add-ons, cobrados en
// pesos al dólar oficial (D16, D18, ítem 25): catálogo, cotización, webhook que
// valida suscripción/empresa/monto, cron que actualiza el precio con aviso.
import "./helpers/domSetup.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { createFetchMock } from "./helpers/mockFetch.js";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
process.env.MERCADOPAGO_WEBHOOK_SECRET = "test-webhook-secret";
process.env.MERCADOPAGO_ACCESS_TOKEN = "test-mp-token";
process.env.RESEND_API_KEY = "re_test_dummy_key";
process.env.CRON_SECRET = "cron-test";
delete process.env.COTIZACION_USD_ARS;

const plans = await import("../app/lib/plans.js");
const { PLANES, LINEAS, ADDONS, TRAMOS, planParaOperarios, precioUsd, aPesos, capacidades, planSiguiente, montoCobro, addonsValidos } = plans;
const { cotizacionVigente, cotizacionValida, hoyArgentina } = await import("../app/lib/cotizacion.js");
const { verificarSuscripcion, montoCoincide, montosEsperados } = await import("../app/lib/validarCobro.js");
const { decidirPrecio, DIAS_AVISO } = await import("../app/lib/actualizarPrecios.js");
const { validarLimite, invalidarCachePlan } = await import("../app/lib/planEnforcement.js");
const { POST: webhook } = await import("../app/api/billing/webhook/route.js");
const { GET: cronPrecios } = await import("../app/api/cron/actualizar-precios/route.js");
const { default: TablaPrecios } = await import("../app/components/TablaPrecios.jsx");

afterEach(() => cleanup());

const EMPRESA = "11111111-1111-1111-1111-111111111111";
const OTRA = "99999999-9999-9999-9999-999999999999";
const SUSC = "5";

// ─── Catálogo ───────────────────────────────────────────────────────────────

test("catálogo — Asistencia y Planta en tramos de 15/40/80 con los precios de la fase 6", () => {
  assert.deepEqual(TRAMOS, [15, 40, 80]);
  assert.deepEqual(LINEAS.asistencia.usd, { 15: 20, 40: 45, 80: 80 });
  assert.deepEqual(LINEAS.planta.usd, { 15: 45, 40: 95, 80: 160 });
  for (const a of Object.values(ADDONS)) assert.ok(a.usd >= 15 && a.usd <= 40, `${a.id} entre USD 15 y 40`);
  assert.equal(PLANES.planta_40.max_empleados, 40);
  assert.equal(PLANES.asistencia_80.precio_usd, 80);
  // Asistencia no tiene OT; Planta sí. Ninguna trae el reporte de obra (es add-on)
  assert.equal(PLANES.asistencia_15.max_proyectos, 0);
  assert.ok(PLANES.planta_15.modulos.includes("proyectos"));
  assert.ok(!PLANES.planta_80.modulos.includes("obra"));
  // La liquidación de horas (módulo reportes) está en las dos
  assert.ok(PLANES.asistencia_15.modulos.includes("reportes"));
});

test("catálogo — tramo según operarios, precio con add-ons y descuento anual, pesos redondeados", () => {
  assert.equal(planParaOperarios("asistencia", 0), "asistencia_15");
  assert.equal(planParaOperarios("asistencia", 15), "asistencia_15");
  assert.equal(planParaOperarios("planta", 16), "planta_40");
  assert.equal(planParaOperarios("planta", 81), null);
  assert.deepEqual(addonsValidos(["ia", "ia", "stock", "campo"]), ["ia", "campo"]);
  assert.equal(precioUsd({ plan: "planta_40", addons: ["ia", "campo"] }), 130);
  assert.equal(precioUsd({ plan: "planta_40", addons: ["ia", "campo"], periodo: "anual" }), 104);
  assert.equal(precioUsd({ plan: "pro" }), null);
  assert.equal(aPesos(20, 1185.5), 23800); // 23.710 → $23.800
  assert.equal(aPesos(20, null), null);
  assert.equal(montoCobro(64000, "anual"), 768000);
  assert.equal(montoCobro(64000, "mensual"), 64000);
});

test("catálogo — los add-ons suman módulos y cupo de IA; planSiguiente sugiere el tramo de arriba", () => {
  const base = capacidades("asistencia_15");
  assert.equal(base.ia_consultas_mes, 200);
  assert.ok(!base.modulos.includes("obra"));
  const full = capacidades("asistencia_15", ["ia", "campo"]);
  assert.equal(full.ia_consultas_mes, 2000);
  assert.ok(full.modulos.includes("obra"));
  assert.equal(planSiguiente("asistencia_15"), "asistencia_40");
  assert.equal(planSiguiente("planta_80"), "enterprise");
  assert.equal(planSiguiente("asistencia_40", { necesitaPlanta: true }), "planta_40");
  assert.equal(planSiguiente("free"), "asistencia_15");
});

test("migración 082 — el check de la base acepta exactamente los planes del catálogo", () => {
  const sql = readFileSync(new URL("../supabase/migrations/082_precios_usd_tramos.sql", import.meta.url), "utf8");
  const bloque = sql.match(/suscripciones_plan_check check \(plan in \(([\s\S]*?)\)\);/)[1];
  const enSql = [...bloque.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]).sort();
  const enCodigo = Object.keys(PLANES).filter((p) => p !== "trial").sort();
  assert.deepEqual(enSql, enCodigo);
  const addonsSql = [...sql.match(/empresa_addons_check check \(addons <@ array\[(.*?)\]/)[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(addonsSql, Object.keys(ADDONS).sort());
});

// ─── Cotización ─────────────────────────────────────────────────────────────

test("cotización — usa la guardada del día sin consultar afuera", async () => {
  let afuera = false;
  global.fetch = createFetchMock([
    { match: (u) => u.includes("/rest/v1/cotizaciones?fecha=eq."), respond: () => ({ status: 200, body: [{ fecha: "2026-10-08", usd_ars: "1190.5", fuente: "BNA" }] }) },
    { match: (u) => u.includes("dolarapi"), respond: () => { afuera = true; return { status: 200, body: { venta: 1 } }; } },
  ]);
  const c = await cotizacionVigente();
  assert.equal(c.usd_ars, 1190.5);
  assert.equal(afuera, false);
});

test("cotización — sin guardada consulta la fuente y la guarda; un valor absurdo se descarta", async () => {
  let guardada = null;
  global.fetch = createFetchMock([
    { match: (u, o) => u.includes("/rest/v1/cotizaciones") && o.method === "POST", respond: (u, o) => { guardada = JSON.parse(o.body); return { status: 201 }; } },
    { match: (u) => u.includes("/rest/v1/cotizaciones"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("dolarapi"), respond: () => ({ status: 200, body: { compra: 1140, venta: 1185 } }) },
  ]);
  const c = await cotizacionVigente(new Date("2026-10-08T15:00:00Z"));
  assert.equal(c.usd_ars, 1185);
  assert.equal(guardada.fecha, "2026-10-08");
  assert.equal(guardada.usd_ars, 1185);
  assert.equal(cotizacionValida(5), false);
  assert.equal(cotizacionValida("1185"), true);
  assert.equal(hoyArgentina(new Date("2026-10-09T02:00:00Z")), "2026-10-08"); // 23:00 en Argentina
});

test("cotización — fuente caída: valor manual de la variable, y si no, la última de la semana", async () => {
  const sinFuente = (ultima) => createFetchMock([
    { match: (u) => u.includes("/rest/v1/cotizaciones?fecha=eq."), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/cotizaciones?fecha=gte."), respond: () => ({ status: 200, body: ultima }) },
    { match: (u) => u.includes("dolarapi"), respond: () => ({ status: 500, body: {} }) },
  ]);
  process.env.COTIZACION_USD_ARS = "1200";
  global.fetch = sinFuente([]);
  assert.equal((await cotizacionVigente()).usd_ars, 1200);
  delete process.env.COTIZACION_USD_ARS;
  global.fetch = sinFuente([{ fecha: "2026-10-06", usd_ars: 1170, fuente: "BNA" }]);
  const c = await cotizacionVigente();
  assert.equal(c.usd_ars, 1170);
  assert.match(c.fuente, /2026-10-06/);
  global.fetch = sinFuente([]);
  assert.equal(await cotizacionVigente(), null);
});

// ─── Validación del cobro ───────────────────────────────────────────────────

test("validarCobro — la suscripción tiene que ser de la empresa y del preapproval; el monto, el acordado", () => {
  const s = { empresa_id: EMPRESA, gateway_subscription_id: "mp-1", precio: 23800, precio_nuevo: null, periodo: "mensual" };
  assert.deepEqual(verificarSuscripcion(s, { empresaId: EMPRESA, preapprovalId: "mp-1" }), { ok: true });
  assert.equal(verificarSuscripcion(s, { empresaId: OTRA }).motivo, "empresa_no_coincide");
  assert.equal(verificarSuscripcion(s, { empresaId: EMPRESA, preapprovalId: "mp-2" }).motivo, "preapproval_no_coincide");
  assert.equal(verificarSuscripcion(null, { empresaId: EMPRESA }).motivo, "suscripcion_inexistente");
  assert.equal(montoCoincide(s, 23800), true);
  assert.equal(montoCoincide(s, 23800.5), true);
  assert.equal(montoCoincide(s, 100), false);
  // Con un cambio ya avisado vale cualquiera de los dos; anual = 12 meses
  assert.deepEqual(montosEsperados({ precio: 1000, precio_nuevo: 1100, periodo: "anual" }), [12000, 13200]);
  // Precio 0 (prueba o manual): ningún cobro corresponde
  assert.equal(montoCoincide({ precio: 0, periodo: "mensual" }, 5000), false);
});

// ─── Actualización del precio por el dólar ──────────────────────────────────

test("decidirPrecio — menos de 5%: nada; 5% o más: aviso a 30 días; vencido el aviso: aplicar", () => {
  const ahora = new Date("2026-10-08T12:00:00Z");
  const s = { precio_usd: 20, precio: 23800 };
  assert.equal(decidirPrecio(s, 1200, ahora).accion, "nada"); // $24.000: +0,8%
  const d = decidirPrecio(s, 1300, ahora); // $26.000: +9,2%
  assert.equal(d.accion, "avisar");
  assert.equal(d.precio, 26000);
  assert.equal(new Date(d.desde).getTime() - ahora.getTime(), DIAS_AVISO * 86400000);
  assert.equal(decidirPrecio({ ...s, precio_nuevo: 26000, precio_nuevo_desde: "2026-11-01T00:00:00Z" }, 1300, ahora).accion, "esperar");
  assert.deepEqual(decidirPrecio({ ...s, precio_nuevo: 26000, precio_nuevo_desde: "2026-10-01T00:00:00Z" }, 1300, ahora), { accion: "aplicar", precio: 26000 });
  // Planes viejos en pesos (sin precio en USD) no se tocan
  assert.equal(decidirPrecio({ precio: 15000, precio_usd: null }, 1300, ahora).accion, "nada");
});

function cronReq(auth = "Bearer cron-test") {
  return new Request("http://localhost/api/cron/actualizar-precios", { headers: { authorization: auth } });
}

test("cron actualizar-precios — sin el secreto, 401", async () => {
  global.fetch = createFetchMock([]);
  const res = await cronPrecios(cronReq("Bearer otro"));
  assert.equal(res.status, 401);
});

test("cron actualizar-precios — el dólar subió: programa el precio nuevo a 30 días y avisa al dueño", async () => {
  let patch = null, patchUrl = null, email = null;
  global.fetch = createFetchMock([
    { match: (u) => u.includes("/rest/v1/cotizaciones?fecha=eq."), respond: () => ({ status: 200, body: [{ fecha: "2026-10-08", usd_ars: 1300, fuente: "BNA" }] }) },
    { match: (u) => u.includes("/rest/v1/suscripciones?estado=eq.activa"), respond: () => ({ status: 200, body: [{ id: "s1", empresa_id: EMPRESA, plan: "asistencia_15", precio: 23800, precio_usd: 20, periodo: "mensual", gateway_subscription_id: "mp-1", precio_nuevo: null, precio_nuevo_desde: null }] }) },
    { match: (u, o) => u.includes("/rest/v1/suscripciones?id=eq.s1") && o.method === "PATCH", respond: (u, o) => { patchUrl = u; patch = JSON.parse(o.body); return { status: 200, body: [{ id: "s1" }] }; } },
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ admin_email: "duenio@test.com", nombre: "Metalúrgica", slug: "metal" }] }) },
    { match: (u, o) => u.includes("api.resend.com"), respond: (u, o) => { email = JSON.parse(o.body); return { status: 200, body: { id: "em-1" } }; } },
    { match: (u) => u.includes("api.mercadopago.com"), respond: () => { throw new Error("no se debe tocar Mercado Pago todavía"); } },
  ]);
  const res = await cronPrecios(cronReq());
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.avisadas, 1);
  assert.equal(json.aplicadas, 0);
  assert.ok(patchUrl.includes("precio_nuevo=is.null"), "solo si no había otro aviso en curso");
  assert.equal(patch.precio_nuevo, 26000);
  assert.equal(patch.cotizacion_nueva, 1300);
  assert.equal(email.to, "duenio@test.com");
  assert.match(email.html, /\$26\.000/);
});

test("cron actualizar-precios — vencido el aviso: cambia el monto en Mercado Pago (12 meses si es anual) y lo guarda", async () => {
  let mp = null, patch = null;
  global.fetch = createFetchMock([
    { match: (u) => u.includes("/rest/v1/cotizaciones?fecha=eq."), respond: () => ({ status: 200, body: [{ fecha: "2026-10-08", usd_ars: 1300, fuente: "BNA" }] }) },
    { match: (u) => u.includes("/rest/v1/suscripciones?estado=eq.activa"), respond: () => ({ status: 200, body: [{ id: "s2", empresa_id: EMPRESA, plan: "planta_15", precio: 36000, precio_usd: 36, periodo: "anual", gateway_subscription_id: "mp-2", precio_nuevo: 46800, precio_nuevo_desde: "2026-10-01T00:00:00Z", cotizacion_nueva: 1300 }] }) },
    { match: (u, o) => u.includes("api.mercadopago.com/preapproval/mp-2") && o.method === "PUT", respond: (u, o) => { mp = JSON.parse(o.body); return { status: 200, body: { id: "mp-2" } }; } },
    { match: (u, o) => u.includes("/rest/v1/suscripciones?id=eq.s2") && o.method === "PATCH", respond: (u, o) => { patch = JSON.parse(o.body); return { status: 200, body: [{ id: "s2" }] }; } },
  ]);
  const res = await cronPrecios(cronReq());
  const json = await res.json();
  assert.equal(json.aplicadas, 1);
  assert.equal(mp.auto_recurring.transaction_amount, 46800 * 12);
  assert.equal(patch.precio, 46800);
  assert.equal(patch.cotizacion, 1300);
  assert.equal(patch.precio_nuevo, null);
});

test("cron actualizar-precios — si Mercado Pago falla, no se marca como aplicado y el cron queda en error", async () => {
  let patch = false;
  global.fetch = createFetchMock([
    { match: (u) => u.includes("/rest/v1/cotizaciones?fecha=eq."), respond: () => ({ status: 200, body: [{ fecha: "2026-10-08", usd_ars: 1300, fuente: "BNA" }] }) },
    { match: (u) => u.includes("/rest/v1/suscripciones?estado=eq.activa"), respond: () => ({ status: 200, body: [{ id: "s3", empresa_id: EMPRESA, plan: "planta_15", precio: 45000, precio_usd: 45, periodo: "mensual", gateway_subscription_id: "mp-3", precio_nuevo: 58500, precio_nuevo_desde: "2026-10-01T00:00:00Z" }] }) },
    { match: (u) => u.includes("api.mercadopago.com"), respond: () => ({ status: 500, body: { message: "caído" } }) },
    { match: (u, o) => u.includes("/rest/v1/suscripciones?id=eq.s3") && o.method === "PATCH", respond: () => { patch = true; return { status: 200, body: [{}] }; } },
  ]);
  const res = await cronPrecios(cronReq());
  assert.equal(res.status, 500);
  assert.deepEqual((await res.json()).errores, ["s3"]);
  assert.equal(patch, false);
});

// ─── Webhook: validar suscripción, empresa y monto (F2-11) ──────────────────

function firmado(body, dataId) {
  const ts = String(Date.now());
  const manifest = `id:${dataId};request-id:req-1;ts:${ts};`;
  const v1 = crypto.createHmac("sha256", process.env.MERCADOPAGO_WEBHOOK_SECRET).update(manifest).digest("hex");
  return new Request(`http://localhost/api/billing/webhook?data.id=${dataId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": "req-1" },
    body: JSON.stringify(body),
  });
}

const SUSC_FILA = { plan: "planta_15", estado: "suspendida", empresa_id: EMPRESA, gateway_subscription_id: "mp-77", precio: 94800, precio_nuevo: null, periodo: "mensual", addons: ["ia", "campo"] };

function pagoMP({ monto = 94800, ref = `gypi-${EMPRESA}-${SUSC}` } = {}) {
  return { match: (u) => u.includes("api.mercadopago.com/v1/payments/"), respond: () => ({ status: 200, body: { id: 777, status: "approved", transaction_amount: monto, currency_id: "ARS", external_reference: ref, date_approved: "2026-10-08T00:00:00Z" } }) };
}

test("webhook — pago aprobado con el monto acordado activa el plan con sus add-ons", async () => {
  let empresa = null;
  global.fetch = createFetchMock([
    pagoMP(),
    { match: (u) => u.includes("/rest/v1/suscripciones?id=eq.") && u.includes("select=plan,estado,empresa_id"), respond: () => ({ status: 200, body: [SUSC_FILA] }) },
    { match: (u) => u.includes("/rest/v1/pagos") && u.includes("gateway_payment_id"), respond: () => ({ status: 200, body: [] }) },
    { match: (u, o) => u.includes("/rest/v1/pagos") && o.method === "POST", respond: () => ({ status: 201, body: [{ id: 1 }] }) },
    { match: (u, o) => u.includes("/rest/v1/suscripciones") && o.method === "PATCH", respond: () => ({ status: 204 }) },
    { match: (u) => u.includes("/rest/v1/suscripciones") && u.includes("select=plan"), respond: () => ({ status: 200, body: [{ plan: "planta_15" }] }) },
    { match: (u, o) => u.includes("/rest/v1/empresa") && o.method === "PATCH", respond: (u, o) => { empresa = JSON.parse(o.body); return { status: 204 }; } },
    { match: (u) => u.includes("/rest/v1/empresa"), respond: () => ({ status: 200, body: [{ admin_email: null }] }) },
  ]);
  const res = await webhook(firmado({ type: "payment", data: { id: "777" } }, "777"));
  assert.equal((await res.json()).accion, "pago_aprobado");
  assert.equal(empresa.plan_activo, "planta_15");
  assert.deepEqual(empresa.addons, ["ia", "campo"]);
});

test("webhook — pago con un monto distinto del acordado: se registra pero NO activa el plan", async () => {
  let pagoGuardado = false, empresaTocada = false;
  global.fetch = createFetchMock([
    pagoMP({ monto: 100 }),
    { match: (u) => u.includes("/rest/v1/suscripciones?id=eq.") && u.includes("select=plan,estado,empresa_id"), respond: () => ({ status: 200, body: [SUSC_FILA] }) },
    { match: (u) => u.includes("/rest/v1/pagos") && u.includes("gateway_payment_id"), respond: () => ({ status: 200, body: [] }) },
    { match: (u, o) => u.includes("/rest/v1/pagos") && o.method === "POST", respond: () => { pagoGuardado = true; return { status: 201, body: [{ id: 1 }] }; } },
    { match: (u, o) => u.includes("/rest/v1/empresa") && o.method === "PATCH", respond: () => { empresaTocada = true; return { status: 204 }; } },
    { match: (u, o) => u.includes("/rest/v1/suscripciones") && o.method === "PATCH", respond: () => { empresaTocada = true; return { status: 204 }; } },
  ]);
  const res = await webhook(firmado({ type: "payment", data: { id: "777" } }, "777"));
  assert.equal((await res.json()).accion, "pago_monto_no_coincide");
  assert.equal(pagoGuardado, true, "el pago queda registrado para revisarlo");
  assert.equal(empresaTocada, false);
});

test("webhook — pago cuyo external_reference apunta a la suscripción de OTRA empresa se ignora", async () => {
  let algoEscrito = false;
  global.fetch = createFetchMock([
    pagoMP({ ref: `gypi-${OTRA}-${SUSC}` }),
    { match: (u) => u.includes("/rest/v1/suscripciones?id=eq."), respond: () => ({ status: 200, body: [SUSC_FILA] }) },
    { match: (u, o) => ["POST", "PATCH"].includes(o.method), respond: () => { algoEscrito = true; return { status: 201, body: [{}] }; } },
  ]);
  const res = await webhook(firmado({ type: "payment", data: { id: "777" } }, "777"));
  assert.equal((await res.json()).ignorado, "empresa_no_coincide");
  assert.equal(algoEscrito, false);
});

function preapprovalMP({ id = "mp-77", monto = 94800, status = "authorized" } = {}) {
  return { match: (u) => u.includes("api.mercadopago.com/preapproval/"), respond: () => ({ status: 200, body: { id, status, external_reference: `gypi-${EMPRESA}-${SUSC}`, auto_recurring: { transaction_amount: monto }, next_payment_date: "2026-11-08T00:00:00Z" } }) };
}

test("webhook — preapproval autorizado por el monto acordado activa el plan con los add-ons", async () => {
  let empresa = null;
  global.fetch = createFetchMock([
    preapprovalMP(),
    { match: (u) => u.includes("/rest/v1/suscripciones?id=eq.") && u.includes("select=plan,estado"), respond: () => ({ status: 200, body: [SUSC_FILA] }) },
    { match: (u, o) => u.includes("/rest/v1/suscripciones") && o.method === "PATCH", respond: () => ({ status: 204 }) },
    { match: (u) => u.includes("/rest/v1/suscripciones?empresa_id=eq."), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/empresa") && u.includes("select=plan_override_manual"), respond: () => ({ status: 200, body: [{ plan_override_manual: false }] }) },
    { match: (u, o) => u.includes("/rest/v1/empresa") && o.method === "PATCH", respond: (u, o) => { empresa = JSON.parse(o.body); return { status: 204 }; } },
  ]);
  const res = await webhook(firmado({ type: "subscription_preapproval", data: { id: "mp-77" } }, "mp-77"));
  assert.equal((await res.json()).accion, "susc_activa");
  assert.equal(empresa.plan_activo, "planta_15");
  assert.deepEqual(empresa.addons, ["ia", "campo"]);
});

test("webhook — preapproval con otro monto o de otro preapproval no activa nada", async () => {
  for (const [mp, esperado] of [[preapprovalMP({ monto: 10 }), { accion: "monto_no_coincide" }], [preapprovalMP({ id: "mp-otro" }), { ignorado: "preapproval_no_coincide" }]]) {
    let escrito = false;
    global.fetch = createFetchMock([
      mp,
      { match: (u) => u.includes("/rest/v1/suscripciones?id=eq."), respond: () => ({ status: 200, body: [SUSC_FILA] }) },
      { match: (u, o) => ["POST", "PATCH"].includes(o.method), respond: () => { escrito = true; return { status: 204 }; } },
    ]);
    const res = await webhook(firmado({ type: "subscription_preapproval", data: { id: "x" } }, "x"));
    const json = await res.json();
    for (const [k, v] of Object.entries(esperado)) assert.equal(json[k], v);
    assert.equal(escrito, false);
  }
});

// ─── Add-on Trabajo en campo en el servidor ─────────────────────────────────

test("reportes de obra — Asistencia sin el add-on no puede cargarlos; con el add-on, sí", async () => {
  const conAddons = (addons) => createFetchMock([
    { match: (u) => u.includes("select=plan_activo,plan_vence"), respond: () => ({ status: 200, body: [{ plan_activo: "asistencia_15" }] }) },
    { match: (u) => u.includes("select=addons"), respond: () => ({ status: 200, body: [{ addons }] }) },
  ]);
  invalidarCachePlan(EMPRESA);
  global.fetch = conAddons([]);
  const sin = await validarLimite({ tabla: "reportes_obra", empresaId: EMPRESA, body: {}, method: "POST" });
  assert.equal(sin.ok, false);
  assert.equal(sin.upgrade_a, "campo");
  invalidarCachePlan(EMPRESA);
  global.fetch = conAddons(["campo"]);
  assert.equal((await validarLimite({ tabla: "reportes_obra", empresaId: EMPRESA, body: {}, method: "POST" })).ok, true);
  // Asistencia no tiene órdenes de trabajo: sugiere Planta del mismo tramo
  invalidarCachePlan(EMPRESA);
  global.fetch = createFetchMock([
    { match: (u) => u.includes("select=plan_activo,plan_vence"), respond: () => ({ status: 200, body: [{ plan_activo: "asistencia_40" }] }) },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: () => ({ status: 200, body: [], headers: { "content-range": "0-0/0" } }) },
  ]);
  const ot = await validarLimite({ tabla: "proyectos", empresaId: EMPRESA, body: {}, method: "POST" });
  assert.equal(ot.ok, false);
  assert.equal(ot.upgrade_a, "planta_40");
  assert.match(ot.error, /Planta/);
});

// ─── Precios públicos ───────────────────────────────────────────────────────

test("TablaPrecios — muestra los tramos en USD, los add-ons y cambia a anual con 20% menos", () => {
  let empezar = 0;
  render(<TablaPrecios onEmpezar={() => { empezar++; }} />);
  assert.equal(screen.getAllByText("USD 45").length, 2); // Asistencia 40 y Planta 15
  assert.ok(screen.getByText("USD 160"));
  assert.ok(screen.getByText("Asistente IA"));
  assert.ok(screen.getByText(/dólar oficial/));
  fireEvent.click(screen.getByRole("button", { name: /pagando un año/ }));
  assert.ok(screen.getByText("USD 128")); // 160 × 0,8
  fireEvent.click(screen.getAllByText(/Probar 30 días gratis/)[0]);
  assert.equal(empezar, 1);
});

test("webhook — sin la migración 082 (faltan columnas) igual activa el plan leyendo los campos de antes", async () => {
  let empresa = null;
  global.fetch = createFetchMock([
    pagoMP({ monto: 35000 }),
    { match: (u) => u.includes("/rest/v1/suscripciones?id=eq.") && u.includes("precio_nuevo"), respond: () => ({ status: 400, body: { message: "column suscripciones.precio_nuevo does not exist" } }) },
    { match: (u) => u.includes("/rest/v1/suscripciones?id=eq.") && u.includes("select=plan,estado,empresa_id"), respond: () => ({ status: 200, body: [{ plan: "pro", estado: "activa", empresa_id: EMPRESA, precio: 35000, periodo: "mensual" }] }) },
    { match: (u) => u.includes("/rest/v1/pagos") && u.includes("gateway_payment_id"), respond: () => ({ status: 200, body: [] }) },
    { match: (u, o) => u.includes("/rest/v1/pagos") && o.method === "POST", respond: () => ({ status: 201, body: [{ id: 1 }] }) },
    { match: (u, o) => u.includes("/rest/v1/suscripciones") && o.method === "PATCH", respond: () => ({ status: 204 }) },
    { match: (u) => u.includes("/rest/v1/suscripciones") && u.includes("select=plan"), respond: () => ({ status: 200, body: [{ plan: "pro" }] }) },
    { match: (u, o) => u.includes("/rest/v1/empresa") && o.method === "PATCH", respond: (u, o) => { empresa = JSON.parse(o.body); return { status: 204 }; } },
    { match: (u) => u.includes("/rest/v1/empresa"), respond: () => ({ status: 200, body: [{ admin_email: null }] }) },
  ]);
  const res = await webhook(firmado({ type: "payment", data: { id: "777" } }, "777"));
  assert.equal((await res.json()).accion, "pago_aprobado");
  assert.equal(empresa.plan_activo, "pro");
  assert.equal("addons" in empresa, false);
});

test("términos publicados — explican el cobro en dólares y no nombran planes que ya no se venden", () => {
  const terminos = readFileSync(new URL("../app/terms/page.js", import.meta.url), "utf8");
  assert.match(terminos, /Banco Nación/);
  assert.match(terminos, /30 días de anticipación/);
  assert.doesNotMatch(terminos, /Starter|plan gratuito \(Free\)/);
});
