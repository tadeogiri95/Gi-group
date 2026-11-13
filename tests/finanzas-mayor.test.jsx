// tests/finanzas-mayor.test.jsx — Finanzas → 📚 Mayor de cuentas (13/11,
// pedido de Tadeo): sumas y saldos, el mayor de una cuenta con su saldo, el
// aviso de saldo al revés y el asiento de registro o de ajuste.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { sumasYSaldos, movimientosDeCuenta, saldoAlReves, asientoPropuesto, factorPesos, diaAnterior } from "../app/lib/finanzasMayor.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/mayor/route.js");
const { default: FinanzasMayor } = await import("../app/components/FinanzasMayor.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const CAJA = "01.01.01.001.001";
const CAJA_A = "01.01.01.001.001.01";
const CAJA_B = "01.01.01.001.001.02";
const DOLAR = "01.01.01.003.009";
const TITULOS = "01.01.02.001";
const IVA_CF = "01.01.03.001";
const PROV = "02.01.02.001.001";
const AJUSTE = "03.01.01.003.001";
const GASTO = "04.02.01.001";
const VENTA_T = "04.01.03.001";
const CUENTAS = [
  { codigo: CAJA, nombre: "Caja" }, { codigo: CAJA_A, nombre: "Caja Principal" }, { codigo: CAJA_B, nombre: "Caja Juan" },
  { codigo: DOLAR, nombre: "Banco Dólar" }, { codigo: TITULOS, nombre: "Títulos Públicos y Privados" }, { codigo: IVA_CF, nombre: "IVA Credito Fiscal" },
  { codigo: PROV, nombre: "Proveedores" }, { codigo: AJUSTE, nombre: "Ajuste De Capital" }, { codigo: GASTO, nombre: "Gastos varios" },
  { codigo: VENTA_T, nombre: "Resultado venta títulos" },
];
const TIPOS = [
  { codigo: "COMPRA", nombre: "Compra", grupo: "COMPRAS" },
  { codigo: "VENTA TITULOS", nombre: "Venta de títulos", grupo: "INVERSIÓN" },
  { codigo: "SALDO INICIAL", nombre: "Saldo inicial", grupo: "AJUSTES" },
  { codigo: "RECLASIF", nombre: "Reclasificación de cuenta", grupo: "AJUSTES" },
];
const TESORERIA = [
  { cuenta: CAJA_A, nombre: "Caja Principal", tipo: "caja", moneda: "ARS", activa: true },
  { cuenta: CAJA_B, nombre: "Caja Juan", tipo: "caja", moneda: "ARS", activa: true },
  { cuenta: DOLAR, nombre: "Banco Dólar", tipo: "banco", moneda: "USD", activa: true },
];
const OPS = [
  { id: 1, fecha: "2026-10-01", tipo: "SALDO INICIAL", neto: 1000, total: 1000, total_ars: 1000, moneda: "ARS", cuenta_debe: CAJA_A, cuenta_haber: AJUSTE },
  // Compra con IVA: gasto 100 + IVA 21 contra proveedores 121
  { id: 2, fecha: "2026-10-05", tipo: "COMPRA", neto: 100, iva: 21, total: 121, total_ars: 121, moneda: "ARS", cuenta_debe: GASTO, cuenta_haber: PROV },
  // Venta de títulos sin saldo inicial: el activo queda negativo
  { id: 3, fecha: "2026-10-10", tipo: "VENTA TITULOS", neto: 500, total: 500, total_ars: 500, moneda: "ARS", cuenta_debe: CAJA_B, cuenta_haber: TITULOS },
  { id: 4, fecha: "2026-11-02", tipo: "VENTA TITULOS", neto: 10, total: 10, moneda: "USD", tipo_cambio: 1000, total_ars: 10000, cuenta_debe: DOLAR, cuenta_haber: TITULOS },
  { id: 5, fecha: "2026-11-03", tipo: "COMPRA", neto: 999, total: 999, total_ars: 999, cuenta_debe: GASTO, cuenta_haber: CAJA_A, anulada_at: "2026-11-03" },
];
const ctx = { cuentas: CUENTAS, tipos: TIPOS };

// ─── Reglas ───

test("sumas y saldos — debe menos haber, el IVA en su cuenta, dólares en pesos, sin anuladas", () => {
  const s = Object.fromEntries(sumasYSaldos(OPS, ctx).map((x) => [x.codigo, x]));
  assert.equal(s[GASTO].saldo, 100);
  assert.equal(s[IVA_CF].saldo, 21, "el IVA crédito tiene su propio movimiento");
  assert.equal(s[PROV].saldo, -121);
  assert.equal(s[TITULOS].saldo, -10500, "USD 10 a 1000 = $ 10.000");
  assert.equal(s[CAJA].saldo, 1500, "la cuenta general suma las cajas de abajo");
  assert.equal(s[CAJA].hijas, true);
  assert.equal(s[CAJA_A].movimientos, 1, "la anulada no cuenta");
  assert.match(s[TITULOS].al_reves, /activo no puede quedar en negativo/);
  assert.equal(s[PROV].al_reves, null);
  assert.equal(sumasYSaldos(OPS, { ...ctx, hasta: "2026-10-31" }).find((x) => x.codigo === TITULOS).saldo, -500, "hasta una fecha");
});

test("saldo al revés — activo negativo, pasivo o patrimonio deudor; resultados nunca", () => {
  assert.ok(saldoAlReves("01.1", -1));
  assert.equal(saldoAlReves("01.1", 5), null);
  assert.ok(saldoAlReves("02.1", 5));
  assert.ok(saldoAlReves("03.1", 0.5));
  assert.equal(saldoAlReves("02.1", -5), null);
  assert.equal(saldoAlReves("04.1", -5), null);
  assert.equal(factorPesos({ moneda: "USD", total: 10, total_ars: 12000 }), 1200);
  assert.equal(factorPesos({ moneda: "ARS" }), 1);
  assert.equal(diaAnterior("2026-11-01"), "2026-10-31");
});

test("mayor de una cuenta — apertura con lo anterior, saldo renglón por renglón y contra qué fue", () => {
  const m = movimientosDeCuenta(OPS, TITULOS, { ...ctx, desde: "2026-11-01", hasta: "2026-11-30" });
  assert.equal(m.apertura, -500);
  assert.deepEqual(m.renglones.map((r) => [r.op.id, r.debe, r.haber, r.saldo]), [[4, 0, 10000, -10500]]);
  assert.deepEqual(m.renglones[0].contra, [DOLAR]);
  assert.equal(m.primera, "2026-10-10");
  assert.equal(m.saldo, -10500);
  const caja = movimientosDeCuenta(OPS, CAJA, { ...ctx, desde: "2026-10-01", hasta: "2026-11-30" });
  assert.deepEqual(caja.renglones.map((r) => [r.op.id, r.saldo]), [[1, 1000], [3, 1500]], "la general junta las de abajo");
  const vacio = movimientosDeCuenta(OPS, TITULOS, { ...ctx, desde: "2026-12-01", hasta: "2026-12-31" });
  assert.deepEqual([vacio.renglones.length, vacio.saldo], [0, -10500]);
});

test("asiento propuesto — el saldo inicial que deja la cuenta en cero, el día antes del primer movimiento", () => {
  const fila = sumasYSaldos(OPS, ctx).find((x) => x.codigo === TITULOS);
  const p = asientoPropuesto(fila, { cuentas: CUENTAS, primera: "2026-10-10", hoy: "2026-11-13" });
  assert.deepEqual([p.fecha, p.tipo, p.cuenta_debe, p.cuenta_haber, p.importe], ["2026-10-09", "SALDO INICIAL", TITULOS, AJUSTE, "10500,00"]);
  const pasivo = asientoPropuesto({ codigo: PROV, nombre: "Proveedores", saldo: 50, al_reves: "x", hijas: false }, { cuentas: CUENTAS, primera: "2026-10-05", hoy: "2026-11-13" });
  assert.deepEqual([pasivo.cuenta_debe, pasivo.cuenta_haber], [AJUSTE, PROV]);
  const normal = asientoPropuesto({ codigo: GASTO, saldo: 100, al_reves: null }, { cuentas: CUENTAS, hoy: "2026-11-13" });
  assert.deepEqual([normal.tipo, normal.cuenta_debe, normal.cuenta_haber, normal.fecha], ["", GASTO, "", "2026-11-13"]);
});

// ─── Servidor ───

async function token(rol) {
  return (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
}
const pedir = async (rol, q = "") => api.GET(new Request(`http://localhost/api/finanzas/mayor${q}`, { headers: { Authorization: `Bearer ${await token(rol)}` } }));

function mockApi() {
  const leido = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => ({ status: 200, body: TESORERIA }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/fin_tipos_operacion"), respond: () => ({ status: 200, body: TIPOS }) },
    { match: (u) => u.includes("/rest/v1/fin_centros_costo"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: () => ({ status: 200, body: [] }) },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u) => {
        leido.push(decodeURIComponent(u));
        const ids = /id=in\.\(([^)]*)\)/.exec(decodeURIComponent(u));
        const vivas = OPS.filter((x) => !x.anulada_at);
        if (ids) {
          const set = new Set(ids[1].split(",").map(Number));
          return { status: 200, body: vivas.filter((o) => set.has(o.id)).map((o) => ({ ...o, descripcion: `op ${o.id}` })) };
        }
        return { status: 200, body: vivas };
      },
    },
  ]);
  return { leido };
}

test("/api/finanzas/mayor — solo el Dueño", async () => {
  mockApi();
  for (const rol of ["administrativo", "operativo"]) assert.equal((await pedir(rol)).status, 403, rol);
});

test("/api/finanzas/mayor — sumas y saldos y el mayor de una cuenta con las operaciones completas", async () => {
  const { leido } = mockApi();
  const res = await pedir("gerencial", "?hasta=2026-11-30");
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.saldos.find((s) => s.codigo === TITULOS).saldo, -10500);
  assert.match(leido[0], /anulada_at=is\.null&fecha=lte\.2026-11-30/);
  assert.ok(d.tipos.length && d.tesoreria.length, "trae las listas para el asiento");
  const r2 = await pedir("gerencial", `?cuenta=${TITULOS}&desde=2026-11-01&hasta=2026-11-30`);
  const m = (await r2.json()).mayor;
  assert.deepEqual([m.cuenta, m.apertura, m.renglones.length, m.renglones[0].op.descripcion], [TITULOS, -500, 1, "op 4"]);
  assert.equal((await pedir("gerencial", `?cuenta=${TITULOS}&desde=2026-12-01&hasta=2026-11-30`)).status, 400);
});

// ─── Pantalla ───

function mockPantalla() {
  const posts = [];
  const leidos = [];
  const saldos = sumasYSaldos(OPS, ctx);
  global.fetch = async (url, o = {}) => {
    const u = String(url);
    if (o.method === "POST") {
      posts.push(JSON.parse(o.body));
      return new Response(JSON.stringify({ ok: true, id: 99 }), { status: 200 });
    }
    leidos.push(u);
    const base = { hasta: "2026-11-13", saldos, cuentas: CUENTAS, tipos: TIPOS, tesoreria: TESORERIA, centros: [], proveedores: [], proyectos: [] };
    const cuenta = /cuenta=([^&]+)/.exec(u)?.[1];
    const body = cuenta
      ? { ...base, mayor: { ...movimientosDeCuenta(OPS, decodeURIComponent(cuenta), { ...ctx, desde: "2026-11-01", hasta: "2026-11-13" }), cuenta: decodeURIComponent(cuenta), desde: "2026-11-01", recortado: false } }
      : base;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { posts, leidos };
}

test("pantalla — lista con el aviso de al revés, entrar a Títulos y cargar el saldo inicial", async () => {
  const { posts } = mockPantalla();
  render(<FinanzasMayor />);
  await screen.findByText(/1 cuenta tiene el saldo al revés/);
  fireEvent.click(screen.getByRole("button", { name: /Títulos Públicos y Privados/ }));
  await screen.findByRole("table", { name: "Movimientos de la cuenta" });
  assert.ok(screen.getByText("Saldo de apertura (todo lo anterior)"));
  fireEvent.click(screen.getByRole("button", { name: /Cargar el saldo inicial/ }));
  await screen.findByText(/deja la cuenta en cero/);
  assert.equal(screen.getByPlaceholderText("0,00").value, "10500,00");
  fireEvent.click(screen.getByRole("button", { name: "Guardar asiento" }));
  await waitFor(() => assert.equal(posts.length, 1));
  const op = posts[0].operacion;
  assert.equal(posts[0].accion, "crear");
  assert.deepEqual([op.tipo, op.cuenta_debe, op.cuenta_haber, op.neto, op.fecha], ["SALDO INICIAL", TITULOS, AJUSTE, "10500,00", "2026-10-09"]);
});

test("pantalla — asiento libre: sin cuentas no deja guardar", async () => {
  const { posts } = mockPantalla();
  render(<FinanzasMayor />);
  fireEvent.click(await screen.findByRole("button", { name: /Asiento de registro o de ajuste/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Guardar asiento" }));
  await screen.findByText(/Falta la cuenta del debe/);
  assert.equal(posts.length, 0);
});
