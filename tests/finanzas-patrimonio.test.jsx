// tests/finanzas-patrimonio.test.jsx — etapa 6 de la auditoría de Finanzas
// integrada (14/11): Situación patrimonial, Posición de liquidez y Orígenes y
// aplicaciones de fondos, desde el libro de Gypi.
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import {
  saldosHasta, situacionPatrimonial, posicionLiquidez, origenesAplicaciones, seccionDe, rubroDe, semaforo,
} from "../app/lib/finanzasPatrimonio.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/patrimonio/route.js");
const { default: FinanzasPatrimonio } = await import("../app/components/FinanzasPatrimonio.jsx");

const E = "12121212-1212-1212-1212-121212121212";
const EMP = "34343434-3434-3434-3434-343434343434";
const C = {
  caja: "01.01.01.001.001", deudores: "01.01.02.001.001", mp: "01.01.04.001.002", rodado: "01.02.02.003.001",
  proveedores: "02.01.02.001.001", prestamo: "02.02.01.001.001", capital: "03.01.01.001.001",
  entregas: "04.01.01.001.002", cmv: "04.02.01.001.009", sueldos: "04.02.01.007.001",
};
const CUENTAS = Object.entries(C).map(([k, codigo]) => ({ codigo, nombre: k, activa: true }));
let n = 0;
const op = (fecha, debe, haber, total, extra = {}) => ({ id: ++n, fecha, tipo: "X", cuenta_debe: debe, cuenta_haber: haber, neto: total, iva: 0, otros_impuestos: 0, total, total_ars: total, moneda: "ARS", ...extra });
const OPS = [
  op("2025-12-31", C.caja, C.capital, 1000000), // aporte inicial
  op("2026-01-10", C.mp, C.proveedores, 400000), // compra de material a pagar
  op("2026-02-05", C.deudores, C.entregas, 900000), // entrega de una OT
  op("2026-02-05", C.cmv, C.mp, 300000), // consumo de su material
  op("2026-02-20", C.caja, C.deudores, 500000), // cobro
  op("2026-03-01", C.proveedores, C.caja, 250000), // pago al proveedor
  op("2026-03-15", C.rodado, C.caja, 600000), // compra de un vehículo
  op("2026-03-20", C.caja, C.prestamo, 200000), // préstamo a largo plazo
  op("2026-03-31", C.sueldos, C.caja, 150000), // sueldos
  op("2026-03-31", C.sueldos, C.caja, 999999, { anulada_at: "x" }),
];

test("rubros — por los tres primeros niveles del código", () => {
  assert.equal(rubroDe("01.01.02.001.001"), "01.01.02");
  assert.deepEqual(["01.01.01.1", "01.02.02.1", "02.01.02.1", "02.02.01.1", "03.01.01.1", "04.01.01.1"].map(seccionDe), ["AC", "ANC", "PC", "PNC", "PN", "RES"]);
});

test("situación patrimonial — activo = pasivo + patrimonio, con el resultado acumulado", () => {
  const s = situacionPatrimonial(saldosHasta(OPS, "2026-03-31"));
  const sec = (id) => s.secciones.find((x) => x.id === id);
  // Caja: 1.000.000 + 500.000 − 250.000 − 600.000 + 200.000 − 150.000 = 700.000
  assert.deepEqual(sec("AC").rubros.map((r) => [r.nombre, r.saldo]), [["Caja y bancos", 700000], ["Créditos por ventas", 400000], ["Bienes de cambio (stock)", 100000]]);
  assert.equal(sec("ANC").total, 600000);
  assert.deepEqual([sec("PC").total, sec("PNC").total], [150000, 200000]);
  // Resultado: 900.000 − 300.000 − 150.000 = 450.000
  assert.deepEqual(sec("PN").rubros.map((r) => r.saldo), [1000000, 450000]);
  assert.deepEqual([s.activo, s.pasivo, s.patrimonio, s.resultado, s.cuadra], [1800000, 350000, 1450000, 450000, true]);
});

test("liquidez — corriente, ácida, inmediata, capital de trabajo y endeudamiento", () => {
  const l = posicionLiquidez(situacionPatrimonial(saldosHasta(OPS, "2026-03-31")));
  assert.deepEqual([l.activo_corriente, l.pasivo_corriente, l.disponible, l.stock, l.capital_trabajo], [1200000, 150000, 700000, 100000, 1050000]);
  assert.deepEqual([l.corriente, l.acida, l.inmediata, l.endeudamiento], [8, 7.33, 4.67, 0.24]);
  assert.equal(semaforo("corriente", 8), "verde");
  assert.equal(semaforo("acida", 0.8), "amarillo");
  assert.equal(semaforo("endeudamiento", 3), "rojo");
  assert.equal(semaforo("inmediata", null), "gris");
  // Sin deudas de corto plazo no hay cociente
  assert.equal(posicionLiquidez(situacionPatrimonial(saldosHasta(OPS.slice(0, 1)))).corriente, null);
});

test("orígenes y aplicaciones — de dónde salió la plata y en qué se usó, y cuadra con la caja", () => {
  const o = origenesAplicaciones(saldosHasta(OPS, "2025-12-31"), saldosHasta(OPS, "2026-03-31"));
  assert.deepEqual([o.fondos_inicio, o.fondos_fin, o.variacion], [1000000, 700000, -300000]);
  assert.deepEqual(o.origenes.map((x) => [x.codigo, x.importe]), [["RES", 450000], ["02.02.01", 200000], ["02.01.02", 150000]]);
  assert.deepEqual(o.aplicaciones.map((x) => [x.codigo, x.importe]), [["01.02.02", 600000], ["01.01.02", 400000], ["01.01.04", 100000]]);
  assert.equal(o.total_origenes - o.total_aplicaciones, o.variacion);
  assert.equal(o.cuadra, true);
  assert.match(o.origenes[0].nombre, /Ganancia/);
});

const token = async (rol) => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol })).token;
function mockApi() {
  const pedidos = [];
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => ({ status: 200, body: [{ plan_activo: "pro", plan_vence: "2099-01-01" }] }) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => ({ status: 200, body: [] }) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => ({ status: 200, body: CUENTAS }) },
    { match: (u) => u.includes("/rest/v1/fin_operaciones"), respond: (u) => { pedidos.push(decodeURIComponent(u)); return { status: 200, body: OPS.filter((o) => !o.anulada_at) }; } },
    { match: (u) => u.includes("/rest/v1/"), respond: () => ({ status: 200, body: [] }) },
  ]);
  return pedidos;
}

test("/api/finanzas/patrimonio — solo el Dueño; situación, liquidez y orígenes", async () => {
  mockApi();
  const get = async (rol, q = "") => api.GET(new Request(`http://localhost/api/finanzas/patrimonio${q}`, { headers: { Authorization: `Bearer ${await token(rol)}` } }));
  assert.equal((await get("administrativo")).status, 403);
  const pedidos = mockApi();
  const r = await get("gerencial", "?hasta=2026-03-31&desde=2026-01-01");
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.deepEqual([d.desde, d.hasta, d.situacion.activo, d.situacion.cuadra, d.liquidez.corriente, d.origenes.variacion], ["2026-01-01", "2026-03-31", 1800000, true, 8, -300000]);
  assert.match(pedidos[0], /anulada_at=is\.null&fecha=lte\.2026-03-31/);
  assert.equal((await get("gerencial", "?hasta=2026-01-01&desde=2026-03-01")).status, 400);
});

test("pantalla — las tres vistas", async () => {
  global.fetch = async () => new Response(JSON.stringify({
    hasta: "2026-03-31", desde: "2026-01-01",
    situacion: situacionPatrimonial(saldosHasta(OPS, "2026-03-31")),
    liquidez: posicionLiquidez(situacionPatrimonial(saldosHasta(OPS, "2026-03-31"))),
    origenes: origenesAplicaciones(saldosHasta(OPS, "2025-12-31"), saldosHasta(OPS, "2026-03-31")),
  }), { status: 200 });
  render(<FinanzasPatrimonio />);
  assert.ok(await screen.findByText("Lo que tiene la empresa (activo)"));
  assert.ok(screen.getByText(/El activo es igual al pasivo más el patrimonio/));
  fireEvent.click(screen.getByRole("button", { name: "💧 Liquidez" }));
  assert.ok(screen.getByText("Prueba ácida"));
  fireEvent.click(screen.getByRole("button", { name: "🔄 Orígenes y aplicaciones" }));
  assert.ok(screen.getByText("De dónde salió la plata (orígenes)"));
  assert.ok(screen.getByText("Ganancia del período"));
  assert.ok(screen.getByLabelText("Desde"));
});
