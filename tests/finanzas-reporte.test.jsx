// tests/finanzas-reporte.test.jsx — Finanzas → 📑 Reporte financiero semanal y
// mensual (mejoras del 09/11, parte E; sin migración). Datos de mentira.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { periodoReporte, reporteFinanciero, htmlReporte } from "../app/lib/finanzasReporte.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/reporte/route.js");
const { default: FinanzasReporte } = await import("../app/components/FinanzasReporte.jsx");

const E = "31313131-3131-3131-3131-313131313131";
const EMP = "42424242-4242-4242-4242-424242424242";
const BANCO = "01.01.01.003.002";
const CAJA = "01.01.01.001.001";
const DEU = "01.01.02.001.001";
const PROV = "02.01.01.001.001";
const VENTAS = "04.01.01.001.001";
const ENTREGAS = "04.01.01.001.002";
const SUELDOS = "04.02.01.007.003";
const COMB = "04.02.05";
const CUENTAS = [
  { codigo: BANCO, nombre: "Banco Credicoop", rubro: "ACTIVO CORRIENTE" },
  { codigo: CAJA, nombre: "Caja", rubro: "ACTIVO CORRIENTE" },
  { codigo: DEU, nombre: "Deudores Por Ventas", rubro: "ACTIVO CORRIENTE" },
  { codigo: PROV, nombre: "Proveedores", rubro: "PASIVO CORRIENTE" },
  { codigo: VENTAS, nombre: "Ventas Generales", rubro: "RESULTADO", linea_eerr: "ING_VTA" },
  { codigo: ENTREGAS, nombre: "Entregas Generales", rubro: "RESULTADO", linea_eerr: "ING_ENT" },
  { codigo: SUELDOS, nombre: "Sueldos Administración", rubro: "RESULTADO", linea_eerr: "GO_ADM_SUE" },
  { codigo: COMB, nombre: "Combustibles y lubricantes", rubro: "RESULTADO", linea_eerr: "GO_LOG_COM" },
];
const TES = [{ cuenta: BANCO, nombre: "Credicoop", tipo: "banco", moneda: "ARS" }, { cuenta: CAJA, nombre: "Caja oficina", tipo: "caja", moneda: "ARS" }];
const CLIENTES = [{ id: 1, nombre: "Hotel Norte" }];
const PROVEEDORES = [{ id: 5, nombre: "Maderas SA" }];
let n = 0;
const op = (fecha, tipo, debe, haber, total, extra = {}) => ({ id: ++n, fecha, tipo, cuenta_debe: debe, cuenta_haber: haber, neto: 0, total, total_ars: total, ...extra });
const OPS = [
  op("2026-09-20", "SALDO INICIAL", BANCO, "03.01", 100000),
  op("2026-10-01", "VENTA", DEU, VENTAS, 500000, { cliente_id: 1, entidad: "Hotel Norte" }),
  op("2026-10-06", "VENTA", VENTAS, ENTREGAS, 300000, { cliente_id: 1, entidad: "Hotel Norte" }),
  op("2026-10-07", "COBRO A CLIENTES", BANCO, DEU, 200000, { cliente_id: 1, entidad: "Hotel Norte" }),
  op("2026-10-08", "COMPRAS", "01.01.04", PROV, 80000, { proveedor_id: 5, entidad: "Maderas SA" }),
  op("2026-10-09", "PAGO GASTOS DE LOGÍSTICA", COMB, CAJA, 5000),
  op("2026-10-31", "SUELDOS", SUELDOS, BANCO, 60000),
  op("2026-11-02", "COBRO A CLIENTES", BANCO, DEU, 999999, { cliente_id: 1 }), // después del período
  op("2026-10-10", "COBRO A CLIENTES", BANCO, DEU, 7777, { cliente_id: 1, estado: "para_revisar" }),
];
const CHEQUES = [
  { clase: "tercero", tipo: "echeq_diferido", estado: "en_cartera", fecha_pago: "2026-10-01", importe: 40000, librador: "Hotel Norte", numero: "11" },
  { clase: "propio", tipo: "echeq_diferido", estado: "pendiente", fecha_pago: "2026-12-01", importe: 25000, beneficiario: "Maderas SA", numero: "22" },
];
const base = { ops: OPS, cuentas: CUENTAS, tesoreria: TES, cheques: CHEQUES, clientes: CLIENTES, proveedores: PROVEEDORES, lineas: { tipos: {} }, materialesPct: 0, hoy: "2026-11-10" };

test("período: semana de lunes a domingo y mes entero", () => {
  assert.deepEqual(periodoReporte("semana", "2026-11-12"), { tipo: "semana", desde: "2026-11-09", hasta: "2026-11-15", titulo: "Semana del 09/11/2026 al 15/11/2026" });
  assert.deepEqual(periodoReporte("mes", "2028-02-10"), { tipo: "mes", desde: "2028-02-01", hasta: "2028-02-29", titulo: "Febrero 2028" });
  assert.equal(periodoReporte("año", "2026-11-12"), null);
  assert.equal(periodoReporte("mes", "x"), null);
});

test("reporte mensual — resultados, flujo, fondos, valores y cuentas", () => {
  const r = reporteFinanciero({ ...base, tipo: "mes", fecha: "2026-10-15" });
  assert.equal(r.titulo, "Octubre 2026");
  assert.equal(r.para_revisar, 1);
  // Resultados: solo la entrega es ingreso; la venta va aparte
  assert.equal(r.resumen.entregas, 300000);
  assert.equal(r.resultados.find((f) => f.id === "VTA").total, 200000);
  assert.equal(r.resultados.find((f) => f.id === "COM").total, 5000, "logística en comercialización");
  assert.equal(r.resumen.resultado, 235000);
  // Flujo: apertura de septiembre, el cobro y los pagos de octubre
  assert.deepEqual([r.flujo.ARS.apertura, r.flujo.ARS.neto, r.flujo.ARS.cierre], [100000, 135000, 235000]);
  // Fondos al 31/10 (no cuenta lo de noviembre ni lo para revisar)
  assert.deepEqual(r.fondos.map((g) => [g.nombre, g.cajas.map((c) => [c.nombre, c.saldo])]), [["Cajas", [["Caja oficina", -5000]]], ["Bancos", [["Credicoop", 240000]]]]);
  assert.equal(r.total_fondos.ARS, 235000);
  // Valores: como están hoy
  assert.deepEqual([r.valores.a_cobrar.total, r.valores.a_cobrar.vencidos, r.valores.a_pagar.total], [40000, 1, 25000]);
  // Cuentas al 31/10
  assert.equal(r.cuentas_a_cobrar.total, 300000);
  assert.deepEqual(r.cuentas_a_cobrar.renglones[0], { nombre: "Hotel Norte", saldo: 300000, ultimo: "2026-10-07" });
  assert.equal(r.cuentas_a_pagar.total, 80000);
  assert.deepEqual([r.resumen.a_cobrar, r.resumen.a_pagar], [340000, 105000]);
  const html = htmlReporte(r, { empresa: "Gi <Test>" });
  assert.match(html, /Reporte financiero mensual · Gi &lt;Test&gt;/);
  for (const t of ["1. Resultados", "2. Flujo de caja", "3. Posición de fondos", "4. Valores a cobrar y a pagar", "5. Cuentas a cobrar y a pagar", "Hotel Norte", "Maderas SA", "Combustibles y lubricantes"]) assert.ok(html.includes(t), t);
});

test("reporte semanal — solo lo de esa semana", () => {
  const r = reporteFinanciero({ ...base, tipo: "semana", fecha: "2026-10-07" });
  assert.equal(r.desde, "2026-10-05");
  assert.equal(r.resumen.entregas, 300000);
  assert.equal(r.flujo.ARS.apertura, 100000);
  assert.equal(r.flujo.ARS.neto, 195000, "cobro 200.000 − combustible 5.000");
  assert.equal(r.cuentas_a_cobrar.total, 300000);
  assert.equal(reporteFinanciero({ ...base, tipo: "dia", fecha: "2026-10-07" }), null);
});

const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;

test("/api/finanzas/reporte — solo el Dueño; lee hasta el fin del período", async () => {
  const pedidos = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ nombre: "Gi", plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_operaciones"), respond: (u) => { pedidos.push(decodeURIComponent(u)); return { status: 200, body: OPS.filter((o) => o.fecha <= "2026-10-31") }; } },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => ({ status: 200, body: TES }) },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_centros_costo"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/config_sistema"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_cheques"), respond: () => ({ status: 200, body: CHEQUES }) },
    { match: (u) => u.includes("/rest/v1/fin_clientes"), respond: () => ({ status: 200, body: CLIENTES }) },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: () => ({ status: 200, body: PROVEEDORES }) },
  ]);
  const pedir = async (rol, q) => api.GET(new Request(`http://localhost/api/finanzas/reporte?${q}`, { headers: { Authorization: `Bearer ${await token(rol)}` } }));
  assert.equal((await pedir("administrativo", "tipo=mes&fecha=2026-10-15")).status, 403);
  assert.equal((await pedir("gerencial", "tipo=año&fecha=2026-10-15")).status, 400);
  const res = await pedir("gerencial", "tipo=mes&fecha=2026-10-15");
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.titulo, "Octubre 2026");
  assert.equal(d.empresa, "Gi");
  assert.equal(d.cuentas_a_pagar.total, 80000);
  assert.match(pedidos[0], /fecha=lte\.2026-10-31/);
});

test("Reporte financiero — elegir período, generar y ver", async () => {
  const pedidos = [];
  const r = reporteFinanciero({ ...base, tipo: "semana", fecha: "2026-10-07" });
  global.fetch = async (u) => { pedidos.push(String(u)); return new Response(JSON.stringify({ ...r, empresa: "Gi" }), { status: 200 }); };
  render(<FinanzasReporte />);
  fireEvent.click(screen.getByRole("button", { name: "Semanal" }));
  fireEvent.change(screen.getByLabelText("Fecha del período"), { target: { value: "2026-10-07" } });
  assert.ok(screen.getByText("Semana del 05/10/2026 al 11/10/2026"));
  fireEvent.click(screen.getByRole("button", { name: /Generar reporte/ }));
  await waitFor(() => assert.ok(screen.getByTitle("Reporte financiero")));
  assert.match(pedidos[0], /tipo=semana&fecha=2026-10-07/);
  assert.ok(screen.getByRole("button", { name: /Imprimir o guardar PDF/ }));
  assert.match(screen.getByTitle("Reporte financiero").getAttribute("srcdoc"), /Posición de fondos/);
});
