// tests/finanzas-cierre.test.jsx — Finanzas, parte F6c: control de cierre,
// Gypi contra el libro (saldos y operaciones del mes). Datos inventados.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { compararCierre, idDeReferencia, operacionesDelLibro } from "../app/lib/finanzasCierre.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/cierre/route.js");
const { default: FinanzasCierre } = await import("../app/components/FinanzasCierre.jsx");

const E = "57575757-5757-5757-5757-575757575757";
const EMP = "79797979-7979-7979-7979-797979797979";
const CAJA = "01.01.01.001.001.01";
const PROV = "02.01.01.001";
const DEU = "01.01.02.001.001";
const AJ = "03.01.01.002.001";
const GASTO = "04.01.01";
const VENTAS = "05.01.01";
const MP = "01.01.04.001.002";
const CUENTAS = [
  { codigo: CAJA, nombre: "Caja Principal" }, { codigo: PROV, nombre: "Proveedores" }, { codigo: DEU, nombre: "Deudores por Ventas" },
  { codigo: AJ, nombre: "Ajuste De Capital" }, { codigo: GASTO, nombre: "Gastos de logística" }, { codigo: VENTAS, nombre: "Ventas" }, { codigo: MP, nombre: "Materias Primas" },
];
const op = (id, fecha, tipo, debe, haber, total, extra = {}) => ({ id, fecha, tipo, cuenta_debe: debe, cuenta_haber: haber, total, total_ars: total, moneda: "ARS", estado: "confirmada", origen: null, ...extra });
const OPS = [
  op(1, "2026-09-30", "SALDO INICIAL", CAJA, AJ, 1000, { origen: "saldo_inicial", entidad: "Caja Principal" }),
  op(2, "2026-09-30", "SALDO INICIAL", AJ, PROV, 500, { origen: "saldo_inicial", proveedor_id: 1 }),
  op(10, "2026-10-05", "PAGO TRANSF", PROV, CAJA, 200, { proveedor_id: 1 }),
  op(11, "2026-10-06", "PAGO GASTOS DE LOGÍSTICA", GASTO, CAJA, 50, { entidad: "YPF" }),
  op(12, "2026-10-07", "VENTA", DEU, VENTAS, 300, { cliente_id: 5 }),
];
const TITULOS = ["C", "fecha_operación", "cod_tipo_op", "id_entidad", "Total", "moneda", "descripcion", "referencia_externa", "estado", "cuenta_debe_final", "cuenta_haber_final"];
const GRILLA = [
  TITULOS,
  [1, "01/09/2026", "COBRO EFECTIVO", "SIL Y RUBEN", "1000", "ARS", "", "", "CONFIRMADO", CAJA, DEU],
  [2, "02/09/2026", "VENTA", "SIL Y RUBEN", "1000", "ARS", "", "", "CONFIRMADO", DEU, VENTAS],
  [3, "02/09/2026", "COMPRA MP", "ACERCO S A", "500", "ARS", "", "", "CONFIRMADO", MP, PROV],
  [4, "05/10/2026", "PAGO TRANSF", "ACERCO SA", "200", "ARS", "", "GY-F-10", "CONFIRMADO", PROV, CAJA],
  [5, "06/10/2026", "PAGO GASTOS DE LOGÍSTICA", "YPF", "60", "ARS", "", "GY-F-11", "CONFIRMADO", GASTO, CAJA],
  [6, "08/10/2026", "PAGO GASTOS DE LOGÍSTICA", "", "30", "ARS", "Peaje", "", "CONFIRMADO", GASTO, CAJA],
  [7, "09/10/2026", "PAGO GASTOS DE LOGÍSTICA", "", "999", "ARS", "Borrador", "", "", GASTO, CAJA],
  [8, "02/11/2026", "PAGO GASTOS DE LOGÍSTICA", "", "70", "ARS", "", "", "CONFIRMADO", GASTO, CAJA],
];

const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
function mockApi() {
  const pedidos = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_operaciones") && u.includes("para_revisar"), respond: () => ({ status: 200, body: [{ id: 99 }] }) },
    { match: (u) => u.includes("/rest/v1/fin_operaciones"), respond: (u) => { pedidos.push(decodeURIComponent(u)); return { status: 200, body: OPS }; } },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => ({ status: 200, body: [{ cuenta: CAJA, nombre: "Caja Principal", tipo: "caja", moneda: "ARS", activa: true }] }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: () => ({ status: 200, body: [{ id: 1, nombre: "ACERCO SA" }] }) },
    { match: (u) => u.includes("/rest/v1/fin_clientes"), respond: () => ({ status: 200, body: [{ id: 5, nombre: "Sil y Rubén", alias: [], activo: true }] }) },
  ]);
  return pedidos;
}
const get = async (rol, q = "") => api.GET(new Request(`http://localhost/api/finanzas/cierre${q}`, { headers: { Authorization: `Bearer ${await token(rol)}` } }));

test("renglones del libro y referencias de Gypi", () => {
  const { filas } = operacionesDelLibro(GRILLA);
  assert.equal(filas.length, 8);
  assert.deepEqual([filas[3].fila, filas[3].fecha, filas[3].ref, filas[3].confirmado], [5, "2026-10-05", "GY-F-10", true]);
  assert.equal(filas[6].confirmado, false);
  assert.equal(idDeReferencia("gy-f-12"), 12);
  assert.equal(idDeReferencia("GY-C-12"), null);
  assert.ok(operacionesDelLibro([["fecha"]]).error);
});

test("/api/finanzas/cierre — solo el Dueño; saldos de Gypi y operaciones del mes", async () => {
  const pedidos = mockApi();
  assert.equal((await get("administrativo")).status, 403);
  const r = await get("gerencial", "?desde=2026-10-01&hasta=2026-10-31");
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.ok(pedidos.some((p) => p.includes("estado=eq.confirmada") && p.includes("fecha=lte.2026-10-31")));
  assert.equal(d.corte, "2026-09-30");
  assert.equal(d.cajas[0].saldo, 750);
  assert.equal(d.proveedores[0].deuda, 300);
  assert.equal(d.clientes[0].saldo, 300);
  assert.deepEqual(d.operaciones.map((o) => o.id), [10, 11, 12]);
  assert.equal(d.para_revisar, 1);
});

test("comparar con el libro: saldos y qué los explica", async () => {
  mockApi();
  const gypi = await (await get("gerencial", "?desde=2026-10-01&hasta=2026-10-31")).json();
  const r = compararCierre({ gypi, grilla: GRILLA, desde: "2026-10-01", hasta: "2026-10-31" });
  assert.equal(r.ok, false);
  // Caja: Gypi 1000 − 200 − 50 = 750; libro 1000 − 200 − 60 − 30 = 710
  assert.deepEqual(r.cajas.filas.map((f) => [f.nombre, f.gypi, f.libro, f.diferencia]), [["Caja Principal", 750, 710, 40]]);
  // Proveedor: "ACERCO S A" del libro es "ACERCO SA" de Gypi y da igual
  assert.equal(r.proveedores.filas.length, 0);
  assert.equal(r.proveedores.iguales, 1);
  // Cliente: la venta 12 no bajó al libro
  assert.deepEqual(r.clientes.filas.map((f) => [f.nombre, f.gypi, f.libro]), [["Sil y Rubén", 300, 0]]);
  assert.deepEqual(r.solo_libro.map((f) => f.fila), [7]);
  assert.deepEqual(r.solo_gypi.map((o) => o.id), [12]);
  assert.deepEqual(r.distintas.map((d) => [d.id, d.cambios]), [[11, ["total"]]]);
});

test("todo igual → ok; los renglones de Gypi sin CONFIRMADO avisan", () => {
  const gypi = {
    corte: null, cajas: [{ cuenta: CAJA, nombre: "Caja", moneda: "ARS", saldo: -200 }], proveedores: [], clientes: [],
    operaciones: [{ id: 10, fecha: "2026-10-05", tipo: "PAGO TRANSF", total: 200, moneda: "ARS", cuenta_debe: PROV, cuenta_haber: CAJA }],
  };
  const igual = [TITULOS, GRILLA[4]];
  assert.equal(compararCierre({ gypi, grilla: igual, desde: "2026-10-01", hasta: "2026-10-31" }).ok, true);
  const sinTilde = [TITULOS, [...GRILLA[4].slice(0, 8), "", CAJA, PROV]];
  const r = compararCierre({ gypi, grilla: sinTilde, desde: "2026-10-01", hasta: "2026-10-31" });
  assert.equal(r.sin_confirmar_en_libro, 1);
  assert.equal(r.ok, false);
});

test("Cierre — pide el libro y el mes", async () => {
  global.fetch = async () => new Response(JSON.stringify({ desde: "2026-11-01", hasta: "2026-11-09", cajas: [], proveedores: [], clientes: [], operaciones: [] }), { status: 200 });
  render(<FinanzasCierre />);
  assert.ok(await screen.findByText("Cierre: Gypi contra el libro"));
  assert.ok(screen.getByLabelText("Libro (.xlsx)"));
  assert.ok(screen.getByText(/Subí el libro para ver la comparación/));
});
