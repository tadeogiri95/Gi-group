// tests/finanzas-pago-junto.test.jsx — 19/11 (punto 14): devengar y pagar (o
// cobrar) en el mismo cuadro de Nueva operación, con "Lo pagué ahora".
import "./helpers/domSetup.js";
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFetchMock, authPassHandlers } from "./helpers/mockFetch.js";
import { miCajaConProveedor, operacionDelPago, pendienteDe } from "../app/lib/finanzasPagoJunto.js";

before(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test_secret_de_al_menos_32_caracteres_ok";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => cleanup());

const { signAccessToken } = await import("../app/lib/jwt.ts");
const api = await import("../app/api/finanzas/operaciones/route.js");
const { NuevaOperacion } = await import("../app/components/FinanzasNuevaOperacion.jsx");

const E = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";
const PROV = "02.01.02.001.001";
const TERC = "05.01.07";
const DEUD = "01.01.02.001.001";
const VENTAS = "04.01.01.001.001";
const CAJA = "01.01.01.001.001.01";
const BANCO = "01.01.01.003.002";
const USD = "01.01.01.008.001";
const CUENTAS = [
  { codigo: PROV, nombre: "Proveedores", activa: true }, { codigo: TERC, nombre: "Trabajos de terceros", activa: true },
  { codigo: DEUD, nombre: "Deudores por Ventas", activa: true }, { codigo: VENTAS, nombre: "Ventas", activa: true },
  { codigo: CAJA, nombre: "Caja Principal", activa: true }, { codigo: BANCO, nombre: "Banco Credicoop", activa: true }, { codigo: USD, nombre: "USD Físico", activa: true },
];
const TESORERIA = [
  { cuenta: CAJA, nombre: "Caja Principal", tipo: "caja", moneda: "ARS", activa: true },
  { cuenta: BANCO, nombre: "Banco Credicoop", tipo: "banco", moneda: "ARS", activa: true },
  { cuenta: USD, nombre: "USD Físico", tipo: "caja", moneda: "USD", activa: true },
];
const TIPOS = [
  { codigo: "TRABAJOS DE TERCEROS", grupo: "SERVICIOS", cuenta_debe: TERC, cuenta_haber: PROV, pide_entidad: false, activo: true },
  { codigo: "VENTA", grupo: "VENTAS", cuenta_debe: DEUD, cuenta_haber: VENTAS, activo: true },
  { codigo: "PAGO EFECTIVO", grupo: "PAGOS", cuenta_debe: PROV, cuenta_haber: CAJA, activo: true },
];
const CTX = { tipos: TIPOS, cuentas: CUENTAS, tesoreria: TESORERIA, centros: [], proveedores: [{ id: 5, nombre: "Carpintería Sur", activo: true }], proyectos: [] };
const trabajo = { fecha: "2026-11-10", tipo: "TRABAJOS DE TERCEROS", proveedor_id: 5, entidad: null, neto: 1000, iva: 210, otros_impuestos: 0, total: 1210, total_ars: 1210, moneda: "ARS", cuenta_debe: TERC, cuenta_haber: PROV, descripcion: "Lustre", origen: "manual", estado: "confirmada" };

test("pendienteDe — una deuda se paga, un crédito se cobra; si ya toca caja, nada", () => {
  assert.deepEqual(pendienteDe(trabajo, CTX), { lado: "pagar", cuenta: PROV });
  assert.deepEqual(pendienteDe({ ...trabajo, cuenta_debe: DEUD, cuenta_haber: VENTAS }, CTX), { lado: "cobrar", cuenta: DEUD });
  assert.equal(pendienteDe({ ...trabajo, cuenta_debe: PROV, cuenta_haber: CAJA }, CTX), null);
  assert.equal(pendienteDe({ ...trabajo, cuenta_debe: PROV, cuenta_haber: "02.03.01" }, CTX), null, "entre dos pasivos no");
});

test("operacionDelPago — Proveedores / Caja por el total, con la misma persona", () => {
  const { op } = operacionDelPago(trabajo, { cuenta_caja: BANCO, fecha: "2026-11-12" }, CTX);
  assert.deepEqual([op.cuenta_debe, op.cuenta_haber, op.total, op.iva, op.neto, op.fecha, op.proveedor_id, op.tipo], [PROV, BANCO, 1210, 0, 1210, "2026-11-12", 5, "TRABAJOS DE TERCEROS"]);
  const cobro = operacionDelPago({ ...trabajo, cuenta_debe: DEUD, cuenta_haber: VENTAS }, { cuenta_caja: CAJA }, CTX).op;
  assert.deepEqual([cobro.cuenta_debe, cobro.cuenta_haber, cobro.fecha], [CAJA, DEUD, "2026-11-10"]);
  assert.match(operacionDelPago(trabajo, { cuenta_caja: USD }, CTX).error, /en pesos/);
  assert.match(operacionDelPago(trabajo, { cuenta_caja: "" }, CTX).error, /Elegí con qué caja/);
  assert.match(operacionDelPago(trabajo, { cuenta_caja: CAJA, fecha: "2026-11-01" }, CTX).error, /antes/);
});

test("miCajaConProveedor — sin proveedor o sin la cuenta Proveedores queda igual", () => {
  const op = { ...trabajo, cuenta_haber: CAJA };
  assert.deepEqual(miCajaConProveedor({ ...op, proveedor_id: null }, { cuentas: CUENTAS }), [{ ...op, proveedor_id: null }]);
  assert.equal(miCajaConProveedor(op, { cuentas: [] }).length, 1);
  const [d, p] = miCajaConProveedor(op, { cuentas: CUENTAS });
  assert.deepEqual([d.cuenta_debe, d.cuenta_haber, p.cuenta_debe, p.cuenta_haber], [TERC, PROV, PROV, CAJA]);
  assert.equal(miCajaConProveedor({ ...op, cuenta_debe: PROV }, { cuentas: CUENTAS }).length, 1, "un pago a proveedor no se devenga");
});

const token = async () => (await signAccessToken({ empleadoId: EMP, empresaId: E, legajo: 7, rol: "gerencial" })).token;
const pedir = async (body) => api.POST(new Request("http://localhost/api/finanzas/operaciones", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify(body),
}));

function mockApi() {
  const escrito = [];
  const lista = (body) => ({ status: 200, body });
  global.fetch = createFetchMock([
    ...authPassHandlers(),
    { match: (u) => u.includes("/rest/v1/empresa?id=eq."), respond: () => lista([{ plan_activo: "pro", plan_vence: "2099-01-01" }]) },
    { match: (u) => u.includes("/rest/v1/empresa_modulos"), respond: () => lista([]) },
    { match: (u) => u.includes("/rest/v1/empleados?"), respond: () => lista([{ id: EMP, nombre: "Tadeo" }]) },
    { match: (u) => u.includes("/rest/v1/config_sistema"), respond: () => lista([]) },
    { match: (u) => u.includes("/rest/v1/fin_tesoreria"), respond: () => lista(TESORERIA) },
    { match: (u) => u.includes("/rest/v1/fin_cuentas"), respond: () => lista(CUENTAS) },
    { match: (u) => u.includes("/rest/v1/fin_tipos_operacion"), respond: () => lista(TIPOS) },
    { match: (u) => u.includes("/rest/v1/fin_centros_costo"), respond: () => lista([]) },
    { match: (u) => u.includes("/rest/v1/proveedores"), respond: () => lista(CTX.proveedores) },
    { match: (u) => u.includes("/rest/v1/proyectos"), respond: () => lista([]) },
    { match: (u) => u.includes("/rest/v1/fin_clientes"), respond: () => lista([]) },
    {
      match: (u) => u.includes("/rest/v1/fin_operaciones"),
      respond: (u, o) => {
        if (o?.method === "POST") {
          const body = JSON.parse(o.body);
          escrito.push(body);
          return { status: 201, body: (Array.isArray(body) ? body : [body]).map((b, i) => ({ id: 30 + i, ...b })) };
        }
        return lista([]);
      },
    },
  ]);
  return escrito;
}

const OPERACION = { fecha: "2026-11-10", tipo: "TRABAJOS DE TERCEROS", proveedor_id: "5", neto: "1000", iva: "210", otros_impuestos: "", moneda: "ARS", cuenta_debe: TERC, cuenta_haber: PROV, descripcion: "Lustre" };

test("/api/finanzas/operaciones crear con pago — las dos juntas", async () => {
  const escrito = mockApi();
  const res = await pedir({ accion: "crear", operacion: OPERACION, pago: { cuenta_caja: BANCO, fecha: "2026-11-10" } });
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.ok(d.pago);
  assert.equal(escrito.length, 1);
  const [dev, pago] = escrito[0];
  assert.deepEqual([dev.cuenta_debe, dev.cuenta_haber, dev.total], [TERC, PROV, 1210]);
  assert.deepEqual([pago.cuenta_debe, pago.cuenta_haber, pago.total, pago.proveedor_id, pago.cargada_por_nombre], [PROV, BANCO, 1210, 5, "Tadeo"]);
  // Sin pago, una sola como siempre
  const sola = mockApi();
  await pedir({ accion: "crear", operacion: OPERACION });
  assert.equal(Array.isArray(sola[0]), false);
  // Una que ya toca la caja no lleva pago
  mockApi();
  const mal = await pedir({ accion: "crear", operacion: { ...OPERACION, tipo: "PAGO EFECTIVO", iva: "", cuenta_debe: PROV, cuenta_haber: CAJA }, pago: { cuenta_caja: BANCO } });
  assert.equal(mal.status, 400);
});

test("Nueva operación — 'Lo pagué ahora' pide la caja y manda el pago", async () => {
  const pedidos = [];
  global.fetch = async (u, o) => {
    if (o?.method === "POST" && String(u).includes("/api/finanzas/operaciones")) { pedidos.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ok: true, operacion: { id: 1 }, pago: { id: 2 } }), { status: 200 }); }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  let guardada = 0;
  render(<NuevaOperacion datos={CTX} inicial={{ tipo: "TRABAJOS DE TERCEROS" }} onCerrar={() => {}} onGuardada={() => { guardada += 1; }} />);
  fireEvent.change(screen.getByLabelText("Neto"), { target: { value: "1000" } });
  const casilla = screen.getByRole("checkbox", { name: /Lo pagué ahora/ });
  assert.match(screen.getByRole("region", { name: "Lo pagué ahora" }).textContent, /Queda la deuda en Proveedores/);
  fireEvent.click(casilla);
  fireEvent.click(screen.getByRole("button", { name: "Guardar operación" }));
  await waitFor(() => assert.match(screen.getByRole("alert").textContent, /Elegí con qué caja o banco lo pagué/));
  fireEvent.change(screen.getByLabelText("Caja o banco con que se pagó"), { target: { value: BANCO } });
  assert.match(screen.getByRole("region", { name: "Lo pagué ahora" }).textContent, /Y el pago: Debe Proveedores · Haber Banco Credicoop/);
  fireEvent.click(screen.getByRole("button", { name: "Guardar operación" }));
  await waitFor(() => assert.equal(guardada, 1));
  assert.deepEqual(pedidos[0].pago, { cuenta_caja: BANCO, fecha: pedidos[0].operacion.fecha });
  cleanup();
  // Una venta: "Lo cobré ahora"
  render(<NuevaOperacion datos={CTX} inicial={{ tipo: "VENTA" }} onCerrar={() => {}} onGuardada={() => {}} />);
  assert.ok(screen.getByRole("checkbox", { name: /Lo cobré ahora/ }));
  cleanup();
  // Un pago que ya sale de la caja: no aparece
  render(<NuevaOperacion datos={CTX} inicial={{ tipo: "PAGO EFECTIVO" }} onCerrar={() => {}} onGuardada={() => {}} />);
  assert.equal(screen.queryByRole("checkbox", { name: /Lo pagué ahora/ }), null);
});
